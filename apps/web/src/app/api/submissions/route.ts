import { randomUUID } from "node:crypto";
import { computeDeliverableHash, evaluatePolicyGate, verifyDeliverableWithBuy } from "@vire/agent";
import {
  CORRIDORS,
  CreateSubmissionRequestSchema,
  parseTeamBlocklist,
  toPlainDecimalAmount,
  type AutoVerificationRules,
  type CampaignStage,
  type CorridorSymbol,
  type DeliverableType,
} from "@vire/shared";
import { and, eq, gt, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getAddress, type Address, type Hex } from "viem";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";
import { getLiveCorridors } from "@/lib/corridors-live";
import { verifyWalletSessionCookie, WALLET_SESSION_COOKIE } from "@/lib/session";
import {
  createDrizzlePersistenceAdapter,
  createLiveOrchestrator,
  getAgentAddress,
  getBuyClient,
  getOnchainCampaignStates,
  getTextileClient,
  getVaultAddress,
  getVaultSnapshot,
  mergeCampaignWithOnchain,
  verifyInviteCodeHash,
} from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  await ensureDatabaseReady();
  await ensureDefaultCampaignsSeeded();

  const rawBody = await req.json().catch(() => null);
  const parsed = CreateSubmissionRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid submission payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = getDb();
  const wallet = getAddress(parsed.data.contributorWallet);
  const walletLower = wallet.toLowerCase();

  // Require signed HttpOnly wallet session issued during Step 01 EIP-191 profile link
  const walletSession = verifyWalletSessionCookie(req.cookies.get(WALLET_SESSION_COOKIE)?.value);
  if (!walletSession || walletSession.wallet !== walletLower) {
    return NextResponse.json(
      {
        status: "REJECTED",
        failedRule: "VERIFIED_EXTERNAL_IDENTITY",
        error: "Please sign Step 01 (Link your profile) to confirm wallet ownership before submitting.",
      },
      { status: 401 }
    );
  }

  const campaignRows = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.slug, parsed.data.campaignSlug))
    .limit(1);

  const campaignRow = campaignRows[0];
  if (!campaignRow || campaignRow.hidden) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const now = Date.now();

  // Enforce optional campaign deadline immediately ($0.00 spent)
  if (campaignRow.endsAt && now > campaignRow.endsAt) {
    return NextResponse.json(
      {
        status: "REJECTED",
        failedRule: "CAMPAIGN_ACTIVE_AND_FUNDED",
        error: "This campaign has ended and is no longer accepting new submissions.",
      },
      { status: 422 }
    );
  }

  // Enforce optional invite code for link-only private campaigns (constant-time keyed HMAC verification)
  if (campaignRow.inviteCodeHash) {
    const provided = parsed.data.inviteCode?.trim();
    if (!provided || !verifyInviteCodeHash(provided, campaignRow.inviteCodeHash, campaignRow.id)) {
      return NextResponse.json(
        {
          status: "REJECTED",
          error: "A valid campaign invite code is required to submit work for this private campaign.",
        },
        { status: 403 }
      );
    }
  }

  // Atomic in-flight concurrency lock (closes 2-tab simultaneous double-spend race)
  const inFlight = await db
    .select({ id: schema.submissions.id })
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.contributorWallet, walletLower),
        inArray(schema.submissions.status, ["SUBMITTED", "VERIFYING", "AUTHORIZED", "SWAPPING", "PAYING"]),
        gt(schema.submissions.updatedAt, now - 120_000)
      )
    )
    .limit(1);

  if (inFlight.length > 0) {
    return NextResponse.json(
      {
        status: "REJECTED",
        error: "A payout for your wallet is already being processed. Please wait a moment.",
      },
      { status: 429 }
    );
  }

  // Per-wallet burst rate limit (max 5 attempts / 10 minutes — protects Celo `buy` balance)
  const recentAttempts = await db
    .select({ id: schema.submissions.id })
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.contributorWallet, walletLower),
        gt(schema.submissions.updatedAt, now - 10 * 60 * 1000)
      )
    )
    .limit(6);

  if (recentAttempts.length >= 5) {
    return NextResponse.json(
      {
        status: "REJECTED",
        error: "Too many submission attempts in the last 10 minutes. Please wait a few minutes and try again.",
      },
      { status: 429 }
    );
  }

  const stages = JSON.parse(campaignRow.stagesJson) as CampaignStage[];
  const selectedStage = stages.find((s) => s.stageIndex === parsed.data.stageIndex) ?? stages[0];
  if (!selectedStage) {
    return NextResponse.json({ error: "Invalid mission stage" }, { status: 400 });
  }

  const contributorRows = await db
    .select()
    .from(schema.contributors)
    .where(eq(schema.contributors.walletAddress, walletLower))
    .limit(1);
  const contributor = contributorRows[0] ?? null;

  const vaultAddress = getVaultAddress();
  const agentAddress = getAgentAddress();
  const onchainMap = await getOnchainCampaignStates([campaignRow.id as Hex]);
  const syncedCampaign = mergeCampaignWithOnchain(campaignRow, onchainMap);

  // Anti-wash-trade: block campaign creator from claiming their own campaign immediately
  const creatorLower = syncedCampaign.creatorWallet?.toLowerCase();
  if (creatorLower && walletLower === creatorLower) {
    return NextResponse.json(
      {
        status: "REJECTED",
        failedRule: "VERIFIED_EXTERNAL_IDENTITY",
        error: "Campaign creators cannot claim payouts from their own campaign.",
      },
      { status: 422 }
    );
  }

  const deliverableHash = computeDeliverableHash({
    campaignIdBytes32: campaignRow.id as Hex,
    deliverableUrl: parsed.data.deliverableUrl,
    contributorHandle: contributor?.identityHandle,
  });

  // Check if a submission row already exists with this exact deliverable hash
  const existingSub = await db
    .select({
      id: schema.submissions.id,
      status: schema.submissions.status,
      contributorWallet: schema.submissions.contributorWallet,
      reviewedByWallet: schema.submissions.reviewedByWallet,
    })
    .from(schema.submissions)
    .where(eq(schema.submissions.deliverableHash, deliverableHash))
    .limit(1);

  if (existingSub[0]) {
    if (["PENDING_REVIEW", "AUTHORIZED", "SWAPPING", "PAYING", "COMPLETED"].includes(existingSub[0].status)) {
      return NextResponse.json(
        {
          status: "REJECTED",
          failedRule: "UNIQUE_DELIVERABLE_HASH",
          error:
            existingSub[0].status === "PENDING_REVIEW"
              ? "This link is already in the campaign owner's review queue."
              : "Deliverable proof hash was already claimed or settled.",
          deliverableHash,
        },
        { status: 409 }
      );
    }
    if (existingSub[0].status === "REJECTED" && existingSub[0].reviewedByWallet) {
      return NextResponse.json(
        {
          status: "REJECTED",
          failedRule: "UNIQUE_DELIVERABLE_HASH",
          error: "This deliverable link was already reviewed and rejected by the campaign owner.",
          deliverableHash,
        },
        { status: 409 }
      );
    }
    if (existingSub[0].contributorWallet.toLowerCase() !== walletLower) {
      return NextResponse.json(
        {
          status: "REJECTED",
          failedRule: "UNIQUE_DELIVERABLE_HASH",
          error: "This deliverable link was already submitted by another wallet.",
          deliverableHash,
        },
        { status: 409 }
      );
    }
  }

  // MANUAL REVIEW MODE: free anti-spam + 1-claim-per-person lock + queue cap → PENDING_REVIEW
  if (syncedCampaign.verificationMode === "manual") {
    if (!syncedCampaign.active || BigInt(syncedCampaign.remainingUsdtAtomic) <= 0n) {
      return NextResponse.json(
        {
          status: "REJECTED",
          failedRule: "CAMPAIGN_ACTIVE_AND_FUNDED",
          error: "This campaign is paused or its payout pool is currently full.",
        },
        { status: 422 }
      );
    }

    if (!contributor) {
      return NextResponse.json(
        {
          status: "REJECTED",
          failedRule: "VERIFIED_EXTERNAL_IDENTITY",
          error: "Please complete Step 01 (Link your profile) before submitting work.",
        },
        { status: 422 }
      );
    }

    // Validate safe http/https URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(parsed.data.deliverableUrl);
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        throw new Error("Only http(s) URLs are supported.");
      }
    } catch {
      return NextResponse.json(
        { status: "REJECTED", error: "Please enter a valid public https:// deliverable URL." },
        { status: 422 }
      );
    }

    const persistence = createDrizzlePersistenceAdapter();
    const stats = await persistence.getContributorPayoutStats(
      campaignRow.id as Hex,
      wallet,
      contributor.identityHandle
    );
    if (stats.count >= syncedCampaign.maxPayoutsPerRecipient) {
      return NextResponse.json(
        {
          status: "REJECTED",
          failedRule: "STAGE_CAP_AND_COOLDOWN",
          error: "You have already claimed the maximum payouts allowed for this campaign.",
        },
        { status: 422 }
      );
    }

    // Block same wallet from stacking multiple pending submissions in the same campaign
    const existingPendingForWallet = await db
      .select({ id: schema.submissions.id })
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.campaignId, campaignRow.id),
          eq(schema.submissions.contributorWallet, walletLower),
          eq(schema.submissions.status, "PENDING_REVIEW")
        )
      )
      .limit(1);

    if (existingPendingForWallet.length > 0) {
      return NextResponse.json(
        {
          status: "REJECTED",
          error: "You already have a submission awaiting review for this campaign.",
        },
        { status: 409 }
      );
    }

    // Cap total pending queue size (max 3× remaining spots, capped at 50) to protect owner inbox from spam floods
    const allPending = await db
      .select({ id: schema.submissions.id })
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.campaignId, campaignRow.id),
          eq(schema.submissions.status, "PENDING_REVIEW")
        )
      );

    const corridor = syncedCampaign.corridor as CorridorSymbol;
    const liveCorridors = await getLiveCorridors().catch(() => ({ asOf: "", corridors: [] }));
    const rate =
      liveCorridors.corridors.find((c) => c.corridor === corridor)?.impliedRateLocalPerUsdt ??
      CORRIDORS[corridor].typicalFiatPerUsd;
    const rewardFloat = Number(toPlainDecimalAmount(selectedStage.rewardLocalAtomic, corridor));
    const remFloat = Number(toPlainDecimalAmount(syncedCampaign.remainingUsdtAtomic, "USDT"));
    const estSpots = rate > 0 && rewardFloat > 0 ? Math.max(1, Math.floor(remFloat / ((rewardFloat / rate) * 1.015))) : 5;
    const maxQueueSize = Math.min(50, Math.max(15, estSpots * 3));

    if (allPending.length >= maxQueueSize) {
      return NextResponse.json(
        {
          status: "REJECTED",
          error: "The review queue for this campaign is currently full. Please check back shortly.",
        },
        { status: 429 }
      );
    }

    const submissionId = existingSub[0]?.id ?? `sub_${randomUUID()}`;
    if (!existingSub[0]) {
      await db.insert(schema.submissions).values({
        id: submissionId,
        campaignId: campaignRow.id,
        stageIndex: selectedStage.stageIndex,
        contributorWallet: walletLower,
        deliverableUrl: parsedUrl.toString(),
        deliverableNotes: parsed.data.deliverableNotes,
        deliverableHash,
        status: "PENDING_REVIEW",
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await db
        .update(schema.submissions)
        .set({
          stageIndex: selectedStage.stageIndex,
          contributorWallet: walletLower,
          deliverableUrl: parsedUrl.toString(),
          deliverableNotes: parsed.data.deliverableNotes,
          status: "PENDING_REVIEW",
          failedPolicyRule: null,
          reviewNote: null,
          reviewedByWallet: null,
          reviewedAt: null,
          updatedAt: now,
        })
        .where(eq(schema.submissions.id, submissionId));
    }

    return NextResponse.json(
      {
        submissionId,
        deliverableHash,
        status: "PENDING_REVIEW",
        message:
          "Submitted for review. Once the campaign owner approves, Vire will automatically swap and send your exact local currency payout.",
      },
      { status: 202 }
    );
  }

  // AUTO VERIFICATION MODE
  const submissionId = existingSub[0]?.id ?? `sub_${randomUUID()}`;
  if (!existingSub[0]) {
    await db.insert(schema.submissions).values({
      id: submissionId,
      campaignId: campaignRow.id,
      stageIndex: selectedStage.stageIndex,
      contributorWallet: walletLower,
      deliverableUrl: parsed.data.deliverableUrl,
      deliverableNotes: parsed.data.deliverableNotes,
      deliverableHash,
      status: "SUBMITTED",
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(schema.submissions)
      .set({
        stageIndex: selectedStage.stageIndex,
        contributorWallet: walletLower,
        deliverableUrl: parsed.data.deliverableUrl,
        deliverableNotes: parsed.data.deliverableNotes,
        status: "SUBMITTED",
        failedPolicyRule: null,
        updatedAt: now,
      })
      .where(eq(schema.submissions.id, submissionId));
  }

  const autoRules = syncedCampaign.autoRulesJson
    ? (JSON.parse(syncedCampaign.autoRulesJson) as AutoVerificationRules)
    : null;
  const hasLiveExecutionKeys = Boolean(vaultAddress && agentAddress);

  if (hasLiveExecutionKeys) {
    try {
      const orchestrator = await createLiveOrchestrator();
      const result = await orchestrator.processSubmission({
        submissionId,
        campaign: {
          idBytes32: syncedCampaign.id as Hex,
          slug: syncedCampaign.slug,
          title: syncedCampaign.title,
          deliverableType: syncedCampaign.deliverableType as DeliverableType,
          criteria: `${syncedCampaign.criteria}\nStage ${selectedStage.stageIndex}: ${selectedStage.instructions}`,
          corridor: syncedCampaign.corridor as CorridorSymbol,
          rewardLocalAtomic: selectedStage.rewardLocalAtomic,
          active: syncedCampaign.active,
          remainingBudgetUsdtAtomic: syncedCampaign.remainingUsdtAtomic,
          maxPerPayoutUsdtAtomic: syncedCampaign.maxPerPayoutUsdtAtomic,
          remainingDailyLimitUsdtAtomic: syncedCampaign.remainingDailyLimitUsdtAtomic,
          maxPayoutsPerRecipient: syncedCampaign.maxPayoutsPerRecipient,
          stageCooldownHours: selectedStage.cooldownHours,
          maxSpreadBps: syncedCampaign.maxSpreadBps,
          minPassScore: syncedCampaign.minPassScore,
          createdAtMs: syncedCampaign.createdAt,
          creatorWallet: (syncedCampaign.creatorWallet as Address | null) ?? null,
          autoRules,
          minAuthorFollowers: autoRules?.minAuthorFollowers ?? 10,
          minAccountAgeDays: autoRules?.minAccountAgeDays ?? 30,
        },
        stageIndex: selectedStage.stageIndex,
        contributorWallet: wallet,
        identityVerified: Boolean(contributor),
        identityHandle: contributor?.identityHandle ?? null,
        identityOAuthVerified: Boolean(contributor?.oauthVerified),
        deliverableUrl: parsed.data.deliverableUrl,
        deliverableNotes: parsed.data.deliverableNotes,
        referralCode: parsed.data.referralCode,
      });

      return NextResponse.json(result, {
        status: result.status === "COMPLETED" ? 200 : result.status === "REJECTED" ? 422 : 502,
      });
    } catch (err) {
      console.error("[submissions] settlement pipeline failed:", err);
      await db
        .update(schema.submissions)
        .set({ status: "FAILED", updatedAt: Date.now() })
        .where(eq(schema.submissions.id, submissionId));

      return NextResponse.json(
        {
          submissionId,
          status: "FAILED",
          error: "Settlement pipeline encountered a temporary error. Please try again in a moment.",
        },
        { status: 500 }
      );
    }
  }

  // Pre-deployment inspection fallback (no mainnet keys)
  const persistence = createDrizzlePersistenceAdapter();
  const corridor = campaignRow.corridor as CorridorSymbol;
  const corridorMeta = CORRIDORS[corridor];
  const textile = getTextileClient();
  const buyClient = getBuyClient();

  const [verification, preview, stats, vaultSnap] = await Promise.all([
    verifyDeliverableWithBuy(buyClient, {
      deliverableUrl: parsed.data.deliverableUrl,
      deliverableType: campaignRow.deliverableType as DeliverableType,
      campaignTitle: campaignRow.title,
      criteria: `${campaignRow.criteria}\nStage ${selectedStage.stageIndex}: ${selectedStage.instructions}`,
      contributorHandle: contributor?.identityHandle ?? undefined,
      autoRules,
      deliverableNotes: parsed.data.deliverableNotes,
      referralCode: parsed.data.referralCode,
      githubApiToken: process.env.GITHUB_API_TOKEN?.trim() || undefined,
      useChainstackRpc: process.env.BUY_USE_CHAINSTACK_RPC === "true",
    }),
    textile
      .previewExactOutput({
        buyToken: corridorMeta.tokenAddress,
        buyAmountAtomic: selectedStage.rewardLocalAtomic,
      })
      .catch(() => null),
    persistence.getContributorPayoutStats(campaignRow.id as Hex, wallet),
    getVaultSnapshot(),
  ]);

  for (const r of verification.buyReceipts) {
    await persistence.recordBuyPayment(submissionId, r);
  }

  const policyDecision = evaluatePolicyGate({
    deliverableHashAlreadyUsed: false,
    contributorWallet: wallet,
    identityVerified: Boolean(contributor),
    identityHandle: contributor?.identityHandle ?? null,
    teamBlocklist: parseTeamBlocklist(process.env.TEAM_WALLET_BLOCKLIST),
    vaultOwnerAddress: vaultSnap.owner ?? undefined,
    campaignCreatorAddress: syncedCampaign.creatorWallet ?? undefined,
    settlementAgentAddress: agentAddress ?? undefined,
    campaignActive: syncedCampaign.active,
    campaignRemainingBudgetUsdtAtomic: BigInt(syncedCampaign.remainingUsdtAtomic),
    campaignMaxPerPayoutUsdtAtomic: BigInt(syncedCampaign.maxPerPayoutUsdtAtomic),
    campaignRemainingDailyLimitUsdtAtomic: BigInt(syncedCampaign.remainingDailyLimitUsdtAtomic),
    contributorPayoutCountInCampaign: stats.count,
    maxPayoutsPerRecipient: syncedCampaign.maxPayoutsPerRecipient,
    requestedStageIndex: selectedStage.stageIndex,
    lastPayoutAtMs: stats.lastPayoutAtMs,
    stageCooldownHours: selectedStage.cooldownHours,
    corridor,
    requestedBuyAmountAtomic: BigInt(selectedStage.rewardLocalAtomic),
    textilePreview: preview,
    maxSpreadBps: campaignRow.maxSpreadBps,
    verificationVerdict: verification.verdict,
    minPassScore: campaignRow.minPassScore,
  });

  if (!policyDecision.passed) {
    await persistence.updateSubmissionStatus(submissionId, {
      status: "REJECTED",
      policyPassed: false,
      failedPolicyRule: policyDecision.failedRule,
      policyDetailsJson: JSON.stringify(policyDecision.checks),
      aiVerdict: verification.verdict.verdict,
      aiScore: verification.verdict.score,
      aiConfidence: verification.verdict.confidence,
      aiReason: verification.verdict.reason,
      aiEvidenceSummary: verification.verdict.evidenceSummary,
    });

    return NextResponse.json(
      {
        submissionId,
        deliverableHash,
        status: "REJECTED",
        verdict: verification.verdict,
        policyDecision,
        buyReceipts: verification.buyReceipts,
      },
      { status: 422 }
    );
  }

  return NextResponse.json(
    {
      submissionId,
      deliverableHash,
      status: "SUBMITTED",
      verdict: verification.verdict,
      policyDecision,
      buyReceipts: verification.buyReceipts,
      error: "Mainnet custody keys are not configured on this environment.",
    },
    { status: 503 }
  );
}
