import { type CampaignStage, type CorridorSymbol, type DeliverableType } from "@vire/shared";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import {
  createLiveOrchestrator,
  getOnchainCampaignStates,
  mergeCampaignWithOnchain,
} from "@/lib/runtime";
import { verifyWalletSessionCookie, WALLET_SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ReviewBodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(400).optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  await ensureDatabaseReady();

  const session = verifyWalletSessionCookie(req.cookies.get(WALLET_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Wallet authentication required." }, { status: 401 });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = ReviewBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid review decision", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { id } = await context.params;
  const db = getDb();

  const subRows = await db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.id, id))
    .limit(1);

  const sub = subRows[0];
  if (!sub) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  if (sub.status !== "PENDING_REVIEW") {
    return NextResponse.json(
      { error: `Submission is already ${sub.status} and cannot be reviewed again.` },
      { status: 409 }
    );
  }

  const campRows = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, sub.campaignId))
    .limit(1);

  const campRow = campRows[0];
  if (!campRow) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const onchainMap = await getOnchainCampaignStates([campRow.id as Hex]);
  const syncedCampaign = mergeCampaignWithOnchain(campRow, onchainMap);
  const onchainCreator = (syncedCampaign.onchainCreator ?? syncedCampaign.creatorWallet)?.toLowerCase();

  if (!onchainCreator || onchainCreator !== session.wallet.toLowerCase()) {
    return NextResponse.json(
      { error: "Only the onchain campaign creator can approve or reject submissions." },
      { status: 403 }
    );
  }

  const now = Date.now();
  const reviewerWallet = getAddress(session.wallet);

  if (parsed.data.decision === "reject") {
    const note = parsed.data.note?.trim() || "Did not meet campaign requirements.";
    const rejected = await db
      .update(schema.submissions)
      .set({
        status: "REJECTED",
        reviewedByWallet: reviewerWallet.toLowerCase(),
        reviewNote: note,
        reviewedAt: now,
        aiReason: note,
        updatedAt: now,
      })
      .where(and(eq(schema.submissions.id, sub.id), eq(schema.submissions.status, "PENDING_REVIEW")))
      .returning({ id: schema.submissions.id });

    if (rejected.length === 0) {
      return NextResponse.json(
        { error: "Submission is already being processed or has already been reviewed." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      submissionId: sub.id,
      status: "REJECTED",
      reviewNote: note,
    });
  }

  // APPROVE & PAY — executes live VireVault release → Textile FX swap → exact local currency transfer!
  const stages = JSON.parse(syncedCampaign.stagesJson) as CampaignStage[];
  const selectedStage = stages.find((s) => s.stageIndex === sub.stageIndex) ?? stages[0];
  if (!selectedStage) {
    return NextResponse.json({ error: "Campaign stage configuration missing" }, { status: 500 });
  }

  const contributorRows = await db
    .select()
    .from(schema.contributors)
    .where(eq(schema.contributors.walletAddress, sub.contributorWallet.toLowerCase()))
    .limit(1);
  const contributor = contributorRows[0] ?? null;

  // Allow owner to finish approving already-submitted items even right after deadline, as long as onchain vault pool is active & funded
  const onchainState = onchainMap.get(campRow.id.toLowerCase());
  const canSettleOnchain = Boolean(onchainState?.exists && onchainState.active);

  // Atomic claim lock: only ONE concurrent review request can transition PENDING_REVIEW -> VERIFYING
  const claimed = await db
    .update(schema.submissions)
    .set({
      status: "VERIFYING",
      reviewedByWallet: reviewerWallet.toLowerCase(),
      reviewNote: parsed.data.note?.trim() || "Approved by campaign owner.",
      reviewedAt: now,
      updatedAt: now,
    })
    .where(and(eq(schema.submissions.id, sub.id), eq(schema.submissions.status, "PENDING_REVIEW")))
    .returning({ id: schema.submissions.id });

  if (claimed.length === 0) {
    return NextResponse.json(
      { error: "Submission is already being settled or has already been reviewed." },
      { status: 409 }
    );
  }

  try {
    const orchestrator = await createLiveOrchestrator();
    const result = await orchestrator.settleManuallyApprovedSubmission({
      submissionId: sub.id,
      campaign: {
        idBytes32: syncedCampaign.id as Hex,
        slug: syncedCampaign.slug,
        title: syncedCampaign.title,
        deliverableType: syncedCampaign.deliverableType as DeliverableType,
        criteria: syncedCampaign.criteria,
        corridor: syncedCampaign.corridor as CorridorSymbol,
        rewardLocalAtomic: selectedStage.rewardLocalAtomic,
        active: canSettleOnchain,
        remainingBudgetUsdtAtomic: syncedCampaign.remainingUsdtAtomic,
        maxPerPayoutUsdtAtomic: syncedCampaign.maxPerPayoutUsdtAtomic,
        remainingDailyLimitUsdtAtomic: syncedCampaign.remainingDailyLimitUsdtAtomic,
        maxPayoutsPerRecipient: syncedCampaign.maxPayoutsPerRecipient,
        stageCooldownHours: selectedStage.cooldownHours,
        maxSpreadBps: syncedCampaign.maxSpreadBps,
        minPassScore: syncedCampaign.minPassScore,
        createdAtMs: syncedCampaign.createdAt,
        creatorWallet: (syncedCampaign.creatorWallet as Address | null) ?? null,
      },
      stageIndex: selectedStage.stageIndex,
      contributorWallet: getAddress(sub.contributorWallet),
      identityVerified: Boolean(contributor),
      identityHandle: contributor?.identityHandle ?? sub.contributorWallet.slice(0, 10),
      deliverableUrl: sub.deliverableUrl,
      deliverableNotes: sub.deliverableNotes,
      reviewerWallet,
      reviewNote: parsed.data.note,
    });

    return NextResponse.json(result, {
      status: result.status === "COMPLETED" ? 200 : result.status === "REJECTED" ? 422 : 502,
    });
  } catch (err) {
    console.error("[review] manual approval settlement failed:", err);
    // Roll back to PENDING_REVIEW if infrastructure threw before settlement finalized (only if still VERIFYING)
    const latest = await db
      .select({ status: schema.submissions.status })
      .from(schema.submissions)
      .where(eq(schema.submissions.id, sub.id))
      .limit(1);
    if (latest[0]?.status === "VERIFYING") {
      await db
        .update(schema.submissions)
        .set({ status: "PENDING_REVIEW", updatedAt: Date.now() })
        .where(eq(schema.submissions.id, sub.id));
    }

    return NextResponse.json(
      {
        submissionId: sub.id,
        status: "FAILED",
        error: "Approval settlement encountered a temporary error. Please try again in a moment.",
      },
      { status: 500 }
    );
  }
}
