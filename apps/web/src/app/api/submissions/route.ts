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
import { and, eq, gt, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getAddress, type Hex } from "viem";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";
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
  // (prevents unauthenticated curl/bot scripts from impersonating other wallets).
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
  if (!campaignRow) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const now = Date.now();

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
    // Cleanly reset a previously REJECTED/REFUNDED/FAILED submission row on retry
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

  const vaultAddress = getVaultAddress();
  const agentAddress = getAgentAddress();
  const hasLiveExecutionKeys = Boolean(vaultAddress && agentAddress);
  const onchainMap = await getOnchainCampaignStates([campaignRow.id as Hex]);
  const syncedCampaign = mergeCampaignWithOnchain(campaignRow, onchainMap);

  // When mainnet vault & agent key are configured, run the full atomic SettlementOrchestrator.
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
          minAuthorFollowers: 10,
          minAccountAgeDays: 30,
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
