import { randomUUID } from "node:crypto";
import { computeDeliverableHash, evaluatePolicyGate, verifyDeliverableWithBuy } from "@vire/agent";
import {
  CORRIDORS,
  CreateSubmissionRequestSchema,
  parseTeamBlocklist,
  type CampaignStage,
  type CorridorSymbol,
  type DeliverableType,
} from "@vire/shared";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getAddress, type Hex } from "viem";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";
import {
  createDrizzlePersistenceAdapter,
  createLiveOrchestrator,
  getAgentAddress,
  getBuyClient,
  getTextileClient,
  getVaultAddress,
  getVaultSnapshot,
} from "@/lib/runtime";

export const dynamic = "force-dynamic";

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

  const campaignRows = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.slug, parsed.data.campaignSlug))
    .limit(1);

  const campaignRow = campaignRows[0];
  if (!campaignRow) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
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

  const deliverableHash = computeDeliverableHash({
    campaignIdBytes32: campaignRow.id as Hex,
    deliverableUrl: parsed.data.deliverableUrl,
    contributorHandle: contributor?.identityHandle,
  });

  // Check if a submission row already exists with this exact deliverable hash
  const existingSub = await db
    .select({ id: schema.submissions.id, status: schema.submissions.status })
    .from(schema.submissions)
    .where(eq(schema.submissions.deliverableHash, deliverableHash))
    .limit(1);

  if (existingSub[0] && ["AUTHORIZED", "SWAPPING", "PAYING", "COMPLETED"].includes(existingSub[0].status)) {
    return NextResponse.json(
      {
        status: "REJECTED",
        failedRule: "UNIQUE_DELIVERABLE_HASH",
        error: "Deliverable proof hash was already claimed or settled.",
        deliverableHash,
      },
      { status: 409 }
    );
  }

  const submissionId = existingSub[0]?.id ?? `sub_${randomUUID()}`;
  const now = Date.now();
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
  }

  const vaultAddress = getVaultAddress();
  const agentAddress = getAgentAddress();
  const hasLiveExecutionKeys = Boolean(vaultAddress && agentAddress);

  // When mainnet vault & agent key are configured, run the full atomic SettlementOrchestrator.
  if (hasLiveExecutionKeys) {
    try {
      const orchestrator = await createLiveOrchestrator();
      const result = await orchestrator.processSubmission({
        submissionId,
        campaign: {
          idBytes32: campaignRow.id as Hex,
          slug: campaignRow.slug,
          title: campaignRow.title,
          deliverableType: campaignRow.deliverableType as DeliverableType,
          criteria: `${campaignRow.criteria}\nStage ${selectedStage.stageIndex}: ${selectedStage.instructions}`,
          corridor: campaignRow.corridor as CorridorSymbol,
          rewardLocalAtomic: selectedStage.rewardLocalAtomic,
          active: campaignRow.active,
          remainingBudgetUsdtAtomic: campaignRow.remainingUsdtAtomic,
          maxPerPayoutUsdtAtomic: campaignRow.maxPerPayoutUsdtAtomic,
          remainingDailyLimitUsdtAtomic: campaignRow.dailyLimitUsdtAtomic,
          maxPayoutsPerRecipient: campaignRow.maxPayoutsPerRecipient,
          stageCooldownHours: selectedStage.cooldownHours,
          maxSpreadBps: campaignRow.maxSpreadBps,
          minPassScore: campaignRow.minPassScore,
        },
        stageIndex: selectedStage.stageIndex,
        contributorWallet: wallet,
        identityVerified: Boolean(contributor),
        identityHandle: contributor?.identityHandle ?? null,
        deliverableUrl: parsed.data.deliverableUrl,
        deliverableNotes: parsed.data.deliverableNotes,
        referralCode: parsed.data.referralCode,
      });

      return NextResponse.json(result, {
        status: result.status === "COMPLETED" ? 200 : result.status === "REJECTED" ? 422 : 502,
      });
    } catch (err) {
      await db
        .update(schema.submissions)
        .set({ status: "FAILED", updatedAt: Date.now() })
        .where(eq(schema.submissions.id, submissionId));

      return NextResponse.json(
        {
          submissionId,
          status: "FAILED",
          error: err instanceof Error ? err.message : "Settlement pipeline failed",
        },
        { status: 500 }
      );
    }
  }

  // Pre-deployment inspection path: still runs REAL verification + REAL live Textile preview + REAL 7-rule Policy Gate.
  // NEVER fakes a settlement or transaction hash when mainnet custody keys aren't configured.
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
    settlementAgentAddress: agentAddress ?? undefined,
    campaignActive: campaignRow.active,
    campaignRemainingBudgetUsdtAtomic: BigInt(campaignRow.remainingUsdtAtomic),
    campaignMaxPerPayoutUsdtAtomic: BigInt(campaignRow.maxPerPayoutUsdtAtomic),
    campaignRemainingDailyLimitUsdtAtomic: BigInt(campaignRow.dailyLimitUsdtAtomic),
    contributorPayoutCountInCampaign: stats.count,
    maxPayoutsPerRecipient: campaignRow.maxPayoutsPerRecipient,
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

  await persistence.updateSubmissionStatus(submissionId, {
    status: "SUBMITTED",
    policyPassed: true,
    failedPolicyRule: null,
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
      status: "SUBMITTED",
      verdict: verification.verdict,
      policyDecision,
      buyReceipts: verification.buyReceipts,
      error:
        "All 7 Policy Gate rules PASSED with live Textile preview, but onchain Celo Mainnet execution requires VIRE_VAULT_ADDRESS and VIRE_AGENT_PRIVATE_KEY configured in .env.",
    },
    { status: 503 }
  );
}
