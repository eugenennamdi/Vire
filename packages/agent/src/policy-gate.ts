import {
  computeImpliedRateLocalPerUsdt,
  CORRIDORS,
  type CorridorSymbol,
  type PolicyCheckResult,
  type PolicyGateDecision,
  type PolicyRuleCode,
  type VerificationVerdict,
} from "@vire/shared";
import type { RfqPreviewData } from "@vire/textile";

/** Textile FX mainnet minimum notional floor (~$1.00 USD₮, 6 decimals). */
export const TEXTILE_MIN_USDT_FLOOR_ATOMIC = 1_000_000n;

/** Default slippage buffer added when releasing USD₮ from VireVault before firm RFQ (150 bps = 1.5%). */
export const DEFAULT_SLIPPAGE_BUFFER_BPS = 150n;

export interface PolicyGateInput {
  /** Rule 1: anti-duplicate deliverable hash check */
  deliverableHashAlreadyUsed: boolean;

  /** Rule 2: external verified identity & anti-Sybil / non-team / non-creator wallet guard */
  contributorWallet: string;
  identityVerified: boolean;
  identityHandle: string | null;
  teamBlocklist: ReadonlySet<string>;
  vaultOwnerAddress?: string;
  campaignCreatorAddress?: string;
  settlementAgentAddress?: string;

  /** Rule 3: campaign active & budget/limits check */
  campaignActive: boolean;
  campaignRemainingBudgetUsdtAtomic: bigint;
  campaignMaxPerPayoutUsdtAtomic: bigint;
  campaignRemainingDailyLimitUsdtAtomic: bigint;

  /** Rule 4: multi-stage repeat cap & cooldown check */
  contributorPayoutCountInCampaign: number;
  maxPayoutsPerRecipient: number;
  requestedStageIndex: number;
  lastPayoutAtMs: number | null;
  stageCooldownHours: number;
  nowMs?: number;

  /** Rule 5 & 6: corridor, exact-output reward, live Textile preview, and spread check */
  corridor: CorridorSymbol;
  requestedBuyAmountAtomic: bigint;
  textilePreview: RfqPreviewData | null;
  /** Reference local-per-USDT rate (e.g., from Textile public levels top-of-book or reference feed). */
  referenceRateLocalPerUsdt?: number;
  maxSpreadBps: number;
  slippageBufferBps?: bigint;

  /** Rule 7: paid `buy` AI verification verdict */
  verificationVerdict: VerificationVerdict;
  minPassScore: number;
}

export function applySlippageBuffer(usdtAtomic: bigint, bufferBps: bigint = DEFAULT_SLIPPAGE_BUFFER_BPS): bigint {
  return (usdtAtomic * (10_000n + bufferBps) + 9_999n) / 10_000n;
}

/**
 * Pure deterministic 7-rule Policy Gate.
 * Evaluates EVERY rule independently so rejected claims record exact transparent audit details.
 */
export function evaluatePolicyGate(input: PolicyGateInput): PolicyGateDecision {
  const checks: PolicyCheckResult[] = [];
  const nowMs = input.nowMs ?? Date.now();
  const walletLower = input.contributorWallet.toLowerCase();

  // Rule 1: Deliverable proof hash is globally unique (anti-duplicate)
  checks.push({
    rule: "UNIQUE_DELIVERABLE_HASH",
    passed: !input.deliverableHashAlreadyUsed,
    detail: input.deliverableHashAlreadyUsed
      ? "Deliverable proof hash was already claimed or settled."
      : "Deliverable proof hash is unique.",
  });

  // Rule 2: Linked external social/dev identity + non-team / non-creator wallet (anti-Sybil & no self-trading)
  const isTeamWallet =
    input.teamBlocklist.has(walletLower) ||
    (input.vaultOwnerAddress && walletLower === input.vaultOwnerAddress.toLowerCase()) ||
    (input.campaignCreatorAddress && walletLower === input.campaignCreatorAddress.toLowerCase()) ||
    (input.settlementAgentAddress && walletLower === input.settlementAgentAddress.toLowerCase());

  const identityPassed = Boolean(input.identityVerified && input.identityHandle && !isTeamWallet);
  checks.push({
    rule: "VERIFIED_EXTERNAL_IDENTITY",
    passed: identityPassed,
    detail: isTeamWallet
      ? "Wallet belongs to campaign creator, team, vault owner, or settlement agent (external recipients only)."
      : !input.identityVerified || !input.identityHandle
        ? "Contributor must link a verified external GitHub/X or EIP-191 signed identity."
        : `Verified external identity (${input.identityHandle}) on non-team wallet.`,
  });

  // Compute preview USD₮ cost & spread upfront for Rules 3, 5, 6
  const previewOk =
    input.textilePreview !== null &&
    input.textilePreview.status === "preview" &&
    typeof input.textilePreview.takerPays === "string" &&
    BigInt(input.textilePreview.takerPays) > 0n;

  const previewTakerPays = previewOk ? BigInt(input.textilePreview!.takerPays!) : null;
  const bufferedUsdt =
    previewTakerPays !== null
      ? applySlippageBuffer(previewTakerPays, input.slippageBufferBps ?? DEFAULT_SLIPPAGE_BUFFER_BPS)
      : null;

  // Rule 3: Campaign active and has sufficient remaining budget, per-payout cap, & daily limit
  let budgetPassed = false;
  let budgetDetail = "Campaign is inactive.";
  if (!input.campaignActive) {
    budgetDetail = "Campaign is currently paused or inactive.";
  } else if (bufferedUsdt === null) {
    budgetDetail = "Cannot verify budget sufficiency without an active Textile preview quote.";
  } else if (bufferedUsdt > input.campaignMaxPerPayoutUsdtAtomic) {
    budgetDetail = `Required ${bufferedUsdt} atomic USD₮ (incl. buffer) exceeds maxPerPayoutUsdt (${input.campaignMaxPerPayoutUsdtAtomic}).`;
  } else if (bufferedUsdt > input.campaignRemainingDailyLimitUsdtAtomic) {
    budgetDetail = `Required ${bufferedUsdt} atomic USD₮ exceeds remaining 24h daily limit (${input.campaignRemainingDailyLimitUsdtAtomic}).`;
  } else if (bufferedUsdt > input.campaignRemainingBudgetUsdtAtomic) {
    budgetDetail = `Required ${bufferedUsdt} atomic USD₮ exceeds remaining campaign budget (${input.campaignRemainingBudgetUsdtAtomic}).`;
  } else {
    budgetPassed = true;
    budgetDetail = `Campaign active; buffered release (${bufferedUsdt} atomic USD₮) fits budget, per-payout, and 24h limits.`;
  }
  checks.push({
    rule: "CAMPAIGN_ACTIVE_AND_FUNDED",
    passed: budgetPassed,
    detail: budgetDetail,
  });

  // Rule 4: Multi-stage repeat cap & cooldown window
  const cooldownMs = input.stageCooldownHours * 60 * 60 * 1000;
  const elapsedMs = input.lastPayoutAtMs !== null ? nowMs - input.lastPayoutAtMs : Number.POSITIVE_INFINITY;
  const withinRepeatCap = input.contributorPayoutCountInCampaign < input.maxPayoutsPerRecipient;
  const stageSequential = input.requestedStageIndex === input.contributorPayoutCountInCampaign + 1;
  const cooldownMet = elapsedMs >= cooldownMs;

  const stagePassed = withinRepeatCap && stageSequential && cooldownMet;
  let stageDetail = `Stage ${input.requestedStageIndex} eligible (${input.contributorPayoutCountInCampaign}/${input.maxPayoutsPerRecipient} completed).`;
  if (!withinRepeatCap) {
    stageDetail = `Contributor reached max repeat payout cap (${input.contributorPayoutCountInCampaign}/${input.maxPayoutsPerRecipient}).`;
  } else if (!stageSequential) {
    stageDetail = `Expected Stage ${input.contributorPayoutCountInCampaign + 1} next (requested Stage ${input.requestedStageIndex}).`;
  } else if (!cooldownMet) {
    const remainingMins = Math.ceil((cooldownMs - elapsedMs) / 60_000);
    stageDetail = `Stage cooldown active (${remainingMins} minutes remaining before next mission).`;
  }
  checks.push({
    rule: "STAGE_CAP_AND_COOLDOWN",
    passed: stagePassed,
    detail: stageDetail,
  });

  // Rule 5: Exact-output local reward clears Textile FX's ~$1.00 USD₮ mainnet minimum notional floor
  const floorPassed = previewTakerPays !== null && previewTakerPays >= TEXTILE_MIN_USDT_FLOOR_ATOMIC;
  checks.push({
    rule: "TEXTILE_MIN_NOTIONAL_FLOOR",
    passed: floorPassed,
    detail:
      previewTakerPays === null
        ? "Unable to validate $1.00 Textile notional floor without live preview."
        : floorPassed
          ? `Preview debit (${previewTakerPays} atomic USD₮) clears $1.00 Textile mainnet floor.`
          : `Preview debit (${previewTakerPays} atomic USD₮) is below Textile's $1.00 (${TEXTILE_MIN_USDT_FLOOR_ATOMIC}) mainnet floor.`,
  });

  // Rule 6: Live Textile preview exists, feed healthy, and spread within campaign maxSpreadBps
  let spreadPassed = false;
  let spreadDetail = "No live Textile preview quote available.";
  let quotedSpreadBps: number | null = null;

  if (!input.textilePreview) {
    spreadDetail = "Textile preview request failed or returned null.";
  } else if (input.textilePreview.status !== "preview" || previewTakerPays === null) {
    const feedNote = input.textilePreview.feed ? ` (feed: ${input.textilePreview.feed.status})` : "";
    spreadDetail = `Corridor unavailable: ${input.textilePreview.reason ?? "no_quote"}${feedNote}.`;
  } else if (input.textilePreview.feed && input.textilePreview.feed.status === "stale") {
    spreadDetail = `Corridor price feed is stale; deferring settlement to protect treasury.`;
  } else {
    const impliedRate = computeImpliedRateLocalPerUsdt(
      input.requestedBuyAmountAtomic,
      previewTakerPays,
      input.corridor
    );
    const refRate = input.referenceRateLocalPerUsdt ?? CORRIDORS[input.corridor].typicalFiatPerUsd;
    if (impliedRate <= 0 || refRate <= 0) {
      spreadDetail = "Invalid FX rate calculation on preview quote.";
    } else {
      // Lower local tokens per 1 USD₮ than reference = worse spread for taker
      const rawBps = Math.round(((refRate - impliedRate) / refRate) * 10_000);
      quotedSpreadBps = Math.max(0, rawBps);
      if (quotedSpreadBps > input.maxSpreadBps) {
        spreadDetail = `Quoted spread (${quotedSpreadBps} bps vs ref ${refRate.toFixed(2)}, implied ${impliedRate.toFixed(2)}) exceeds campaign maxSpreadBps (${input.maxSpreadBps} bps).`;
      } else {
        spreadPassed = true;
        spreadDetail = `Live Textile preview healthy (implied ${impliedRate.toFixed(2)} ${input.corridor}/USD₮, spread ${quotedSpreadBps} bps <= ${input.maxSpreadBps} bps).`;
      }
    }
  }
  checks.push({
    rule: "CORRIDOR_LIQUIDITY_AND_SPREAD",
    passed: spreadPassed,
    detail: spreadDetail,
  });

  // Rule 7: Paid Celo `buy` AI verification verdict meets campaign minPassScore
  const aiPassed =
    input.verificationVerdict.verdict === "pass" &&
    input.verificationVerdict.score >= input.minPassScore;
  checks.push({
    rule: "VERIFICATION_SCORE_THRESHOLD",
    passed: aiPassed,
    detail: aiPassed
      ? `AI verification passed (${input.verificationVerdict.score}/100 >= ${input.minPassScore}).`
      : `AI verification rejected (verdict=${input.verificationVerdict.verdict}, score=${input.verificationVerdict.score}/100 < ${input.minPassScore}): ${input.verificationVerdict.reason}`,
  });

  const firstFailure = checks.find((c) => !c.passed);
  const failedRule: PolicyRuleCode | null = firstFailure?.rule ?? null;

  return {
    passed: !firstFailure,
    failedRule,
    failedReason: firstFailure?.detail ?? null,
    checks,
    estimatedUsdtAtomic: bufferedUsdt?.toString() ?? null,
    quotedSpreadBps,
  };
}
