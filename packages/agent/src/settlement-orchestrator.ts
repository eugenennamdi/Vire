import {
  CeloBuyClient,
  sendTaggedErc20Transfer,
  sendTaggedTx,
} from "@vire/celo-infra";
import {
  buildOfframpPackage,
  CELO_TOKENS,
  computeImpliedRateLocalPerUsdt,
  CORRIDORS,
  DEFAULT_ATTRIBUTION_CODE,
  VIRE_VAULT_ABI,
  type AutoVerificationRules,
  type BuyPaymentReceipt,
  type CorridorSymbol,
  type DeliverableType,
  type OfframpPackage,
  type PolicyGateDecision,
  type SubmissionStatus,
  type VerificationVerdict,
} from "@vire/shared";
import { TextileClient, type RfqOutcomeData, type RfqPreviewData } from "@vire/textile";
import {
  encodeFunctionData,
  erc20Abi,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { computeDeliverableHash } from "./artifact-fetcher.js";
import { applySlippageBuffer, evaluatePolicyGate } from "./policy-gate.js";
import { verifyDeliverableWithBuy } from "./verifier.js";

export interface OrchestratorCampaignRecord {
  idBytes32: Hex;
  slug: string;
  title: string;
  deliverableType: DeliverableType;
  criteria: string;
  corridor: CorridorSymbol;
  rewardLocalAtomic: string;
  active: boolean;
  remainingBudgetUsdtAtomic: string;
  maxPerPayoutUsdtAtomic: string;
  remainingDailyLimitUsdtAtomic: string;
  maxPayoutsPerRecipient: number;
  stageCooldownHours: number;
  maxSpreadBps: number;
  minPassScore: number;
  createdAtMs?: number;
  creatorWallet?: Address | null;
  autoRules?: AutoVerificationRules | null;
  minAuthorFollowers?: number;
  minAccountAgeDays?: number;
}

export interface OrchestratorPersistenceAdapter {
  isDeliverableHashUsed(deliverableHash: Hex): Promise<boolean>;
  getContributorPayoutStats(
    campaignIdBytes32: Hex,
    wallet: Address,
    identityHandle?: string | null
  ): Promise<{
    count: number;
    lastPayoutAtMs: number | null;
  }>;
  isAuthorIdClaimedInCampaign?(campaignIdBytes32: Hex, authorId: string): Promise<boolean>;
  isContentHashUsedInCampaign?(campaignIdBytes32: Hex, contentHash: Hex): Promise<boolean>;
  hasReceivedWelcomeGasDrip?(wallet: Address): Promise<boolean>;
  markWelcomeGasDripSent?(wallet: Address, txHash: Hash): Promise<void>;
  updateSubmissionStatus(submissionId: string, patch: {
    status: SubmissionStatus;
    policyPassed?: boolean;
    failedPolicyRule?: string | null;
    policyDetailsJson?: string;
    aiVerdict?: string;
    aiScore?: number;
    aiConfidence?: number;
    aiReason?: string;
    aiEvidenceSummary?: string;
  }): Promise<void>;
  recordBuyPayment(submissionId: string, receipt: BuyPaymentReceipt): Promise<void>;
  /** CRITICAL: Called IMMEDIATELY on POST /v2/rfq/request response BEFORE any chain tx. */
  saveRfqQuote(submissionId: string, outcome: RfqOutcomeData, corridor: CorridorSymbol): Promise<void>;
  updateRfqQuoteStatus(rfqId: string, status: string, swapTxHash?: Hash): Promise<void>;
  recordCompletedSettlement(record: {
    submissionId: string;
    campaignIdBytes32: Hex;
    recipientWallet: Address;
    identityHandle?: string | null;
    authorId?: string | null;
    contentHash?: Hex | null;
    corridor: CorridorSymbol;
    localTokenAddress: Address;
    localAmountAtomic: string;
    usdtSpentAtomic: string;
    usdtRefundedAtomic: string;
    vaultReleaseTxHash: Hash;
    textileSwapTxHash: Hash;
    payoutTxHash: Hash;
    receiptTxHash: Hash;
    offrampUrl: string;
  }): Promise<void>;
}

export interface OrchestratorDeps {
  publicClient: PublicClient<Transport, Chain>;
  taggedWalletClient: WalletClient<Transport, Chain, Account>;
  untaggedTextileWalletClient: WalletClient<Transport, Chain, Account>;
  textileClient: TextileClient;
  buyClient: CeloBuyClient;
  persistence: OrchestratorPersistenceAdapter;
  vaultAddress: Address;
  vaultOwnerAddress?: Address;
  teamBlocklist: ReadonlySet<string>;
  attributionCode?: string;
  useUsdtFeeAbstraction?: boolean;
  useChainstackRpc?: boolean;
  githubApiToken?: string;
  /** Optional fetch implementation for deliverable verification (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** Optional explicit reference rate fetcher; defaults to Textile live levels top-of-book. */
  getReferenceRate?: (corridor: CorridorSymbol) => Promise<number | undefined>;
  /**
   * Optional first-time recipient native CELO gas sponsorship (default 0.25 CELO when recipient holds < 0.20 CELO).
   * Covers Celo's 200 gwei base fee across ERC-20 approve, Textile FX local→USDT conversion, MiniPay USDT transfer, and ERC-8004 rating.
   * Set to 0n to disable.
   */
  recipientGasDripWei?: bigint;
}

const DEFAULT_RECIPIENT_GAS_DRIP_WEI = 250_000_000_000_000_000n; // 0.25 CELO (~$0.013 at live Celo rates)
const RECIPIENT_GAS_THRESHOLD_WEI = 200_000_000_000_000_000n; // 0.20 CELO
const AGENT_MIN_CELO_RESERVE_WEI = 500_000_000_000_000_000n; // Keep >= 0.50 CELO reserve in agent wallet

export interface ProcessSubmissionParams {
  submissionId: string;
  campaign: OrchestratorCampaignRecord;
  stageIndex: number;
  contributorWallet: Address;
  identityVerified: boolean;
  identityHandle: string | null;
  identityOAuthVerified?: boolean;
  deliverableUrl: string;
  deliverableNotes?: string;
  referralCode?: string;
}

export interface ProcessSubmissionResult {
  submissionId: string;
  deliverableHash: Hex;
  status: SubmissionStatus;
  verdict: VerificationVerdict;
  policyDecision: PolicyGateDecision;
  buyReceipts: BuyPaymentReceipt[];
  txHashes?: {
    vaultRelease: Hash;
    textileSwap: Hash;
    localPayout: Hash;
    vaultReceipt: Hash;
    gasDrip?: Hash;
  };
  refundTxHash?: Hash;
  offramp?: OfframpPackage;
  error?: string;
}

/**
 * Atomic Proof-of-Work → Paid `buy` Verification → Deterministic Policy Gate →
 * VireVault Release → Textile FX Exact-Output Swap → Tagged Local Payout → Onchain Audit Receipt.
 */
export class SettlementOrchestrator {
  private readonly attributionCode: string;

  constructor(private readonly deps: OrchestratorDeps) {
    this.attributionCode = deps.attributionCode ?? DEFAULT_ATTRIBUTION_CODE;
  }

  private async ensureVaultRefundAllowance(requiredAmount: bigint): Promise<void> {
    if (requiredAmount <= 0n) return;
    const current = await this.deps.publicClient.readContract({
      address: CELO_TOKENS.USDT.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [this.deps.taggedWalletClient.account.address, this.deps.vaultAddress],
    });
    if (current >= requiredAmount) return;

    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [this.deps.vaultAddress, requiredAmount],
    });
    await sendTaggedTx({
      walletClient: this.deps.taggedWalletClient,
      publicClient: this.deps.publicClient,
      to: CELO_TOKENS.USDT.address,
      data: approveData,
      attributionCode: this.attributionCode,
      useUsdtFeeAbstraction: this.deps.useUsdtFeeAbstraction,
    });
  }

  private async resolveReferenceRate(corridor: CorridorSymbol): Promise<number | undefined> {
    if (this.deps.getReferenceRate) {
      return this.deps.getReferenceRate(corridor);
    }
    try {
      const levels = await this.deps.textileClient.getLevels();
      const targetAddr = CORRIDORS[corridor].tokenAddress.toLowerCase();
      const pair = levels.pairs.find(
        (p) =>
          p.sellToken.toLowerCase() === CELO_TOKENS.USDT.address.toLowerCase() &&
          p.buyToken.toLowerCase() === targetAddr &&
          p.levels.length > 0
      );
      const top = pair?.levels[0];
      if (!top) return undefined;
      return computeImpliedRateLocalPerUsdt(top.buyAmount, top.sellAmount, corridor);
    } catch {
      return undefined;
    }
  }

  async processSubmission(params: ProcessSubmissionParams): Promise<ProcessSubmissionResult> {
    const { submissionId, campaign, contributorWallet } = params;
    const corridorMeta = CORRIDORS[campaign.corridor];
    const requestedBuyAmountAtomic = BigInt(campaign.rewardLocalAtomic);
    const deliverableHash = computeDeliverableHash({
      campaignIdBytes32: campaign.idBytes32,
      deliverableUrl: params.deliverableUrl,
      contributorHandle: params.identityHandle ?? undefined,
    });

    await this.deps.persistence.updateSubmissionStatus(submissionId, { status: "VERIFYING" });

    // 1a. Fast free deterministic pre-checks before paying $0.01 to `usebuy.ai`
    const [previewResult, refRate, hashAlreadyUsed, contributorStats] = await Promise.all([
      this.deps.textileClient
        .previewExactOutput({
          buyToken: corridorMeta.tokenAddress,
          buyAmountAtomic: requestedBuyAmountAtomic.toString(),
          taker: this.deps.untaggedTextileWalletClient.account.address,
        })
        .catch((): RfqPreviewData | null => null),
      this.resolveReferenceRate(campaign.corridor),
      this.deps.persistence.isDeliverableHashUsed(deliverableHash),
      this.deps.persistence.getContributorPayoutStats(
        campaign.idBytes32,
        contributorWallet,
        params.identityHandle
      ),
    ]);

    const walletLower = contributorWallet.toLowerCase();
    const isTeamWallet =
      this.deps.teamBlocklist.has(walletLower) ||
      (this.deps.vaultOwnerAddress && walletLower === this.deps.vaultOwnerAddress.toLowerCase()) ||
      (campaign.creatorWallet && walletLower === campaign.creatorWallet.toLowerCase()) ||
      walletLower === this.deps.taggedWalletClient.account.address.toLowerCase();
    const cooldownMs = campaign.stageCooldownHours * 60 * 60 * 1000;
    const elapsedMs =
      contributorStats.lastPayoutAtMs !== null
        ? Date.now() - contributorStats.lastPayoutAtMs
        : Number.POSITIVE_INFINITY;
    const preEligible =
      !hashAlreadyUsed &&
      params.identityVerified &&
      Boolean(params.identityHandle) &&
      !isTeamWallet &&
      campaign.active &&
      contributorStats.count < campaign.maxPayoutsPerRecipient &&
      params.stageIndex === contributorStats.count + 1 &&
      elapsedMs >= cooldownMs &&
      BigInt(campaign.remainingBudgetUsdtAtomic) > 0n;

    // 1b. Run Paid Verification via Celo `buy` ONLY when contributor & campaign pre-checks pass
    const verification = preEligible
      ? await verifyDeliverableWithBuy(this.deps.buyClient, {
          campaignIdBytes32: campaign.idBytes32,
          deliverableUrl: params.deliverableUrl,
          deliverableType: campaign.deliverableType,
          campaignTitle: campaign.title,
          criteria: campaign.criteria,
          contributorWallet,
          contributorHandle: params.identityHandle ?? undefined,
          identityOAuthVerified: params.identityOAuthVerified,
          campaignCreatedAtMs: campaign.createdAtMs,
          autoRules: campaign.autoRules,
          minAuthorFollowers: campaign.autoRules?.minAuthorFollowers ?? campaign.minAuthorFollowers,
          minAccountAgeDays: campaign.autoRules?.minAccountAgeDays ?? campaign.minAccountAgeDays,
          isAuthorAlreadyClaimed: this.deps.persistence.isAuthorIdClaimedInCampaign
            ? (authorId) =>
                this.deps.persistence.isAuthorIdClaimedInCampaign!(campaign.idBytes32, authorId)
            : undefined,
          isContentHashAlreadyUsed: this.deps.persistence.isContentHashUsedInCampaign
            ? (contentHash) =>
                this.deps.persistence.isContentHashUsedInCampaign!(campaign.idBytes32, contentHash)
            : undefined,
          deliverableNotes: params.deliverableNotes,
          referralCode: params.referralCode,
          githubApiToken: this.deps.githubApiToken,
          useChainstackRpc: this.deps.useChainstackRpc,
          fetchImpl: this.deps.fetchImpl,
        })
      : {
          artifact: {
            normalizedUrl: params.deliverableUrl,
            sourceKind: "web_post" as const,
            title: "Pre-check skipped",
            authorHandle: null,
            authorId: null,
            excerpt: "",
            httpStatus: 0,
            reachable: false,
          },
          verdict: {
            verdict: "reject" as const,
            score: 0,
            confidence: 1,
            reason: "Skipped paid AI verification because an eligibility or budget rule failed first.",
            evidenceSummary: "Deterministic pre-check blocked claim before incurring verification cost.",
          },
          buyReceipts: [] as BuyPaymentReceipt[],
          modelUsed: "pre-check-shortcircuit",
          contentHash: null,
        };

    for (const receipt of verification.buyReceipts) {
      await this.deps.persistence.recordBuyPayment(submissionId, receipt);
    }

    // 2. Deterministic 7-Rule Policy Gate (Zero funds move before all 7 rules pass)
    const policyDecision = evaluatePolicyGate({
      deliverableHashAlreadyUsed: hashAlreadyUsed,
      contributorWallet,
      identityVerified: params.identityVerified,
      identityHandle: params.identityHandle,
      teamBlocklist: this.deps.teamBlocklist,
      vaultOwnerAddress: this.deps.vaultOwnerAddress,
      campaignCreatorAddress: campaign.creatorWallet ?? undefined,
      settlementAgentAddress: this.deps.taggedWalletClient.account.address,
      campaignActive: campaign.active,
      campaignRemainingBudgetUsdtAtomic: BigInt(campaign.remainingBudgetUsdtAtomic),
      campaignMaxPerPayoutUsdtAtomic: BigInt(campaign.maxPerPayoutUsdtAtomic),
      campaignRemainingDailyLimitUsdtAtomic: BigInt(campaign.remainingDailyLimitUsdtAtomic),
      contributorPayoutCountInCampaign: contributorStats.count,
      maxPayoutsPerRecipient: campaign.maxPayoutsPerRecipient,
      requestedStageIndex: params.stageIndex,
      lastPayoutAtMs: contributorStats.lastPayoutAtMs,
      stageCooldownHours: campaign.stageCooldownHours,
      corridor: campaign.corridor,
      requestedBuyAmountAtomic,
      textilePreview: previewResult,
      referenceRateLocalPerUsdt: refRate,
      maxSpreadBps: campaign.maxSpreadBps,
      verificationVerdict: verification.verdict,
      minPassScore: campaign.minPassScore,
    });

    return this.executeAfterPolicyGate({
      submissionId,
      campaign,
      contributorWallet,
      identityHandle: params.identityHandle,
      deliverableHash,
      requestedBuyAmountAtomic,
      verdict: verification.verdict,
      policyDecision,
      buyReceipts: verification.buyReceipts,
      authorId: verification.artifact.authorId ?? null,
      contentHash: verification.contentHash ?? null,
    });
  }

  /**
   * Settle a Manual-mode submission after the campaign creator explicitly clicks "Approve & Pay".
   * Reuses the exact same 7-rule Policy Gate + VireVault release + Textile FX swap + onchain receipt pipeline.
   */
  async settleManuallyApprovedSubmission(
    params: ProcessSubmissionParams & { reviewerWallet: Address; reviewNote?: string }
  ): Promise<ProcessSubmissionResult> {
    const { submissionId, campaign, contributorWallet } = params;
    const corridorMeta = CORRIDORS[campaign.corridor];
    const requestedBuyAmountAtomic = BigInt(campaign.rewardLocalAtomic);
    const deliverableHash = computeDeliverableHash({
      campaignIdBytes32: campaign.idBytes32,
      deliverableUrl: params.deliverableUrl,
      contributorHandle: params.identityHandle ?? undefined,
    });

    await this.deps.persistence.updateSubmissionStatus(submissionId, { status: "VERIFYING" });

    const [previewResult, refRate, hashAlreadyUsed, contributorStats] = await Promise.all([
      this.deps.textileClient
        .previewExactOutput({
          buyToken: corridorMeta.tokenAddress,
          buyAmountAtomic: requestedBuyAmountAtomic.toString(),
          taker: this.deps.untaggedTextileWalletClient.account.address,
        })
        .catch((): RfqPreviewData | null => null),
      this.resolveReferenceRate(campaign.corridor),
      this.deps.persistence.isDeliverableHashUsed(deliverableHash),
      this.deps.persistence.getContributorPayoutStats(
        campaign.idBytes32,
        contributorWallet,
        params.identityHandle
      ),
    ]);

    const manualVerdict: VerificationVerdict = {
      verdict: "pass",
      score: 100,
      confidence: 1,
      reason: params.reviewNote?.trim() || "Approved by campaign owner.",
      evidenceSummary: `Manually approved by campaign owner ${params.reviewerWallet} for ${params.deliverableUrl}.`,
    };

    const policyDecision = evaluatePolicyGate({
      deliverableHashAlreadyUsed: hashAlreadyUsed,
      contributorWallet,
      identityVerified: params.identityVerified,
      identityHandle: params.identityHandle,
      teamBlocklist: this.deps.teamBlocklist,
      vaultOwnerAddress: this.deps.vaultOwnerAddress,
      campaignCreatorAddress: campaign.creatorWallet ?? undefined,
      settlementAgentAddress: this.deps.taggedWalletClient.account.address,
      campaignActive: campaign.active,
      campaignRemainingBudgetUsdtAtomic: BigInt(campaign.remainingBudgetUsdtAtomic),
      campaignMaxPerPayoutUsdtAtomic: BigInt(campaign.maxPerPayoutUsdtAtomic),
      campaignRemainingDailyLimitUsdtAtomic: BigInt(campaign.remainingDailyLimitUsdtAtomic),
      contributorPayoutCountInCampaign: contributorStats.count,
      maxPayoutsPerRecipient: campaign.maxPayoutsPerRecipient,
      requestedStageIndex: params.stageIndex,
      lastPayoutAtMs: contributorStats.lastPayoutAtMs,
      stageCooldownHours: campaign.stageCooldownHours,
      corridor: campaign.corridor,
      requestedBuyAmountAtomic,
      textilePreview: previewResult,
      referenceRateLocalPerUsdt: refRate,
      maxSpreadBps: campaign.maxSpreadBps,
      verificationVerdict: manualVerdict,
      minPassScore: campaign.minPassScore,
    });

    return this.executeAfterPolicyGate({
      submissionId,
      campaign,
      contributorWallet,
      identityHandle: params.identityHandle,
      deliverableHash,
      requestedBuyAmountAtomic,
      verdict: manualVerdict,
      policyDecision,
      buyReceipts: [],
      authorId: null,
      contentHash: null,
    });
  }

  private async executeAfterPolicyGate(ctx: {
    submissionId: string;
    campaign: OrchestratorCampaignRecord;
    contributorWallet: Address;
    identityHandle: string | null;
    deliverableHash: Hex;
    requestedBuyAmountAtomic: bigint;
    verdict: VerificationVerdict;
    policyDecision: PolicyGateDecision;
    buyReceipts: BuyPaymentReceipt[];
    authorId: string | null;
    contentHash: Hex | null;
  }): Promise<ProcessSubmissionResult> {
    const {
      submissionId,
      campaign,
      contributorWallet,
      deliverableHash,
      requestedBuyAmountAtomic,
      verdict,
      policyDecision,
      buyReceipts,
    } = ctx;
    const corridorMeta = CORRIDORS[campaign.corridor];

    if (!policyDecision.passed || !policyDecision.estimatedUsdtAtomic) {
      await this.deps.persistence.updateSubmissionStatus(submissionId, {
        status: "REJECTED",
        policyPassed: false,
        failedPolicyRule: policyDecision.failedRule,
        policyDetailsJson: JSON.stringify(policyDecision.checks),
        aiVerdict: verdict.verdict,
        aiScore: verdict.score,
        aiConfidence: verdict.confidence,
        aiReason: verdict.reason,
        aiEvidenceSummary: verdict.evidenceSummary,
      });

      return {
        submissionId,
        deliverableHash,
        status: "REJECTED",
        verdict,
        policyDecision,
        buyReceipts,
      };
    }

    const releaseAmountUsdt = BigInt(policyDecision.estimatedUsdtAtomic);

    // 3. Policy Gate PASS → VireVault.releaseForSettlement() (ERC-8021 tagged)
    const releaseCalldata = encodeFunctionData({
      abi: VIRE_VAULT_ABI,
      functionName: "releaseForSettlement",
      args: [campaign.idBytes32, deliverableHash, contributorWallet, releaseAmountUsdt],
    });

    const releaseTx = await sendTaggedTx({
      walletClient: this.deps.taggedWalletClient,
      publicClient: this.deps.publicClient,
      to: this.deps.vaultAddress,
      data: releaseCalldata,
      attributionCode: this.attributionCode,
      useUsdtFeeAbstraction: this.deps.useUsdtFeeAbstraction,
    });

    await this.deps.persistence.updateSubmissionStatus(submissionId, {
      status: "AUTHORIZED",
      policyPassed: true,
      failedPolicyRule: null,
      policyDetailsJson: JSON.stringify(policyDecision.checks),
      aiVerdict: verdict.verdict,
      aiScore: verdict.score,
      aiConfidence: verdict.confidence,
      aiReason: verdict.reason,
      aiEvidenceSummary: verdict.evidenceSummary,
    });

    // Helper to cleanly refund 100% of released USD₮ back to VireVault if Textile swap cannot execute
    const abortAndRefundVault = async (reason: string, rfqToCancel?: { rfqId: string; claimToken?: string }) => {
      if (rfqToCancel) {
        await this.deps.textileClient.cancelQuote(rfqToCancel.rfqId, rfqToCancel.claimToken).catch(() => {});
        await this.deps.persistence.updateRfqQuoteStatus(rfqToCancel.rfqId, "cancelled");
      }
      await this.ensureVaultRefundAllowance(releaseAmountUsdt);
      const refundData = encodeFunctionData({
        abi: VIRE_VAULT_ABI,
        functionName: "refundUnusedUsdt",
        args: [campaign.idBytes32, deliverableHash],
      });
      const refundTx = await sendTaggedTx({
        walletClient: this.deps.taggedWalletClient,
        publicClient: this.deps.publicClient,
        to: this.deps.vaultAddress,
        data: refundData,
        attributionCode: this.attributionCode,
        useUsdtFeeAbstraction: this.deps.useUsdtFeeAbstraction,
      });
      await this.deps.persistence.updateSubmissionStatus(submissionId, { status: "REFUNDED" });
      return {
        submissionId,
        deliverableHash,
        status: "REFUNDED" as const,
        verdict,
        policyDecision,
        buyReceipts,
        refundTxHash: refundTx.hash,
        error: reason,
      };
    };

    // 4. Request Firm Exact-Output Quote on Textile FX v2 (and persist claimToken IMMEDIATELY)
    let firmOutcome: RfqOutcomeData;
    try {
      firmOutcome = await this.deps.textileClient.requestFirmExactOutput({
        buyToken: corridorMeta.tokenAddress,
        buyAmountAtomic: requestedBuyAmountAtomic.toString(),
        taker: this.deps.untaggedTextileWalletClient.account.address,
        takerAccount: this.deps.untaggedTextileWalletClient.account,
        onClaimToken: async (outcome) => {
          await this.deps.persistence.saveRfqQuote(submissionId, outcome, campaign.corridor);
        },
      });
    } catch (err) {
      return abortAndRefundVault(
        `Textile firm RFQ request failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (firmOutcome.status !== "quoted" || !firmOutcome.quote) {
      return abortAndRefundVault(
        `Textile returned no_quote (${firmOutcome.reason ?? "empty book"})`
      );
    }

    const actualTakerPays = BigInt(firmOutcome.quote.takerPays);
    if (actualTakerPays > releaseAmountUsdt) {
      return abortAndRefundVault(
        `Firm Textile takerPays (${actualTakerPays}) exceeded released USD₮ cap (${releaseAmountUsdt})`,
        { rfqId: firmOutcome.rfqId, claimToken: firmOutcome.claimToken }
      );
    }

    // 5. Execute Verbatim Textile Swap (untagged client → preserves Textile's single merged ERC-8021 tag)
    await this.deps.persistence.updateSubmissionStatus(submissionId, { status: "SWAPPING" });
    let swapResult;
    try {
      swapResult = await this.deps.textileClient.executeFirmSwap({
        outcome: firmOutcome,
        untaggedWalletClient: this.deps.untaggedTextileWalletClient,
        publicClient: this.deps.publicClient,
        onSwapBroadcast: async (hash) => {
          await this.deps.persistence.updateRfqQuoteStatus(firmOutcome.rfqId, "submitted", hash);
        },
      });
    } catch (err) {
      return abortAndRefundVault(
        `Textile swap aborted before fill: ${err instanceof Error ? err.message : String(err)}`,
        { rfqId: firmOutcome.rfqId, claimToken: firmOutcome.claimToken }
      );
    }

    await this.deps.persistence.updateRfqQuoteStatus(
      firmOutcome.rfqId,
      swapResult.finalStatus.status,
      swapResult.swapTxHash
    );

    // 6. Transfer Exact Local Stablecoin Output directly to External Contributor (ERC-8021 tagged)
    await this.deps.persistence.updateSubmissionStatus(submissionId, { status: "PAYING" });
    const exactBuyAmount = BigInt(swapResult.buyAmountAtomic);
    const payoutTx = await sendTaggedErc20Transfer({
      walletClient: this.deps.taggedWalletClient,
      publicClient: this.deps.publicClient,
      tokenAddress: corridorMeta.tokenAddress,
      recipient: contributorWallet,
      amountAtomic: exactBuyAmount,
      attributionCode: this.attributionCode,
      useUsdtFeeAbstraction: this.deps.useUsdtFeeAbstraction,
    });

    // 7. Record Immutable Onchain Audit Receipt + Refund Unused USD₮ Slippage Buffer atomically
    const unusedUsdtRefund = releaseAmountUsdt > actualTakerPays ? releaseAmountUsdt - actualTakerPays : 0n;
    if (unusedUsdtRefund > 0n) {
      await this.ensureVaultRefundAllowance(unusedUsdtRefund);
    }

    const receiptData = encodeFunctionData({
      abi: VIRE_VAULT_ABI,
      functionName: "recordSettlementReceipt",
      args: [
        campaign.idBytes32,
        deliverableHash,
        contributorWallet,
        corridorMeta.tokenAddress,
        exactBuyAmount,
        swapResult.swapTxHash,
        payoutTx.hash,
        firmOutcome.rfqId,
        unusedUsdtRefund,
      ],
    });

    const vaultReceiptTx = await sendTaggedTx({
      walletClient: this.deps.taggedWalletClient,
      publicClient: this.deps.publicClient,
      to: this.deps.vaultAddress,
      data: receiptData,
      attributionCode: this.attributionCode,
      useUsdtFeeAbstraction: this.deps.useUsdtFeeAbstraction,
    });

    // 7b. Best-effort 1-time-ever native CELO gas drip (0.01 CELO) per unique wallet across Vire
    // (only for >= $1.00 payouts to prevent micro-payout gas farming).
    let gasDripTxHash: Hash | undefined;
    const dripWei = this.deps.recipientGasDripWei ?? DEFAULT_RECIPIENT_GAS_DRIP_WEI;
    if (dripWei > 0n && actualTakerPays >= 1_000_000n && typeof this.deps.publicClient.getBalance === "function") {
      try {
        const alreadyDripped = this.deps.persistence.hasReceivedWelcomeGasDrip
          ? await this.deps.persistence.hasReceivedWelcomeGasDrip(contributorWallet)
          : false;
        if (!alreadyDripped) {
          const [recipientCelo, agentCelo] = await Promise.all([
            this.deps.publicClient.getBalance({ address: contributorWallet }),
            this.deps.publicClient.getBalance({ address: this.deps.taggedWalletClient.account.address }),
          ]);
          if (recipientCelo < RECIPIENT_GAS_THRESHOLD_WEI && agentCelo >= AGENT_MIN_CELO_RESERVE_WEI + dripWei) {
            const dripTx = await sendTaggedTx({
              walletClient: this.deps.taggedWalletClient,
              publicClient: this.deps.publicClient,
              to: contributorWallet,
              value: dripWei,
              attributionCode: this.attributionCode,
              useUsdtFeeAbstraction: false,
            });
            gasDripTxHash = dripTx.hash;
            if (this.deps.persistence.markWelcomeGasDripSent) {
              await this.deps.persistence.markWelcomeGasDripSent(contributorWallet, dripTx.hash);
            }
          }
        }
      } catch {
        // Non-fatal: recipient already received their exact local stablecoin payout.
      }
    }

    const offramp = buildOfframpPackage({
      corridor: campaign.corridor,
      atomicAmount: exactBuyAmount,
      recipientAddress: contributorWallet,
    });

    await this.deps.persistence.recordCompletedSettlement({
      submissionId,
      campaignIdBytes32: campaign.idBytes32,
      recipientWallet: contributorWallet,
      identityHandle: ctx.identityHandle,
      authorId: ctx.authorId,
      contentHash: ctx.contentHash,
      corridor: campaign.corridor,
      localTokenAddress: corridorMeta.tokenAddress,
      localAmountAtomic: exactBuyAmount.toString(),
      usdtSpentAtomic: actualTakerPays.toString(),
      usdtRefundedAtomic: unusedUsdtRefund.toString(),
      vaultReleaseTxHash: releaseTx.hash,
      textileSwapTxHash: swapResult.swapTxHash,
      payoutTxHash: payoutTx.hash,
      receiptTxHash: vaultReceiptTx.hash,
      offrampUrl: offramp.primaryUrl,
    });

    await this.deps.persistence.updateSubmissionStatus(submissionId, { status: "COMPLETED" });

    return {
      submissionId,
      deliverableHash,
      status: "COMPLETED",
      verdict,
      policyDecision,
      buyReceipts,
      txHashes: {
        vaultRelease: releaseTx.hash,
        textileSwap: swapResult.swapTxHash,
        localPayout: payoutTx.hash,
        vaultReceipt: vaultReceiptTx.hash,
        ...(gasDripTxHash ? { gasDrip: gasDripTxHash } : {}),
      },
      offramp,
    };
  }
}

export { applySlippageBuffer };
