import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { SettlementOrchestrator, type OrchestratorPersistenceAdapter } from "@vire/agent";
import {
  CeloBuyClient,
  createCeloPublicClient,
  createTaggedWalletClient,
  createUntaggedTextileWalletClient,
  getAgentIdentity,
  getReputationSummary,
  sendTaggedTx,
  type ReputationSummary,
} from "@vire/celo-infra";
import {
  CELO_MAINNET_CHAIN_ID,
  CELO_TOKENS,
  DEFAULT_ATTRIBUTION_CODE,
  DEFAULT_BUY_GATEWAY_URL,
  DEFAULT_CELO_RPC_URL,
  DEFAULT_TEXTILE_API_URL,
  parseTeamBlocklist,
  validateAttributionCode,
  VIRE_VAULT_ABI,
  type CorridorSymbol,
} from "@vire/shared";
import { TextileClient } from "@vire/textile";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { erc20Abi, getAddress, isAddress, parseAbiItem, type Address, type Hash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ensureDatabaseReady, getDb, schema } from "@/db";

export function getMinCampaignBudgetUsdtAtomic(): bigint {
  const raw = Number(process.env.VIRE_MIN_CAMPAIGN_BUDGET_USDT?.trim() || "10");
  const usd = Number.isFinite(raw) && raw >= 1 ? raw : 10;
  return BigInt(Math.round(usd * 1_000_000));
}

export function hashInviteCode(code: string, campaignId = ""): string {
  const secret = process.env.SESSION_SECRET?.trim() || "vire-invite-dev-key";
  return createHmac("sha256", secret)
    .update(`${campaignId.toLowerCase()}:${code.trim().toLowerCase()}`)
    .digest("hex");
}

export function verifyInviteCodeHash(provided: string, storedHash: string, campaignId: string): boolean {
  const keyed = hashInviteCode(provided, campaignId);
  const legacy = createHash("sha256").update(provided.trim().toLowerCase()).digest("hex");
  const target = Buffer.from(storedHash, "utf8");
  for (const candidate of [keyed, legacy]) {
    const buf = Buffer.from(candidate, "utf8");
    if (buf.length === target.length && timingSafeEqual(buf, target)) {
      return true;
    }
  }
  return false;
}

export function getAttributionCode(): string {
  return validateAttributionCode(process.env.VIRE_ATTRIBUTION_CODE || DEFAULT_ATTRIBUTION_CODE);
}

export function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function getCeloRpcUrl(): string {
  return process.env.CELO_RPC_URL?.trim() || DEFAULT_CELO_RPC_URL;
}

export function getVaultAddress(): Address | null {
  const raw = process.env.VIRE_VAULT_ADDRESS?.trim();
  if (!raw || !isAddress(raw)) return null;
  return getAddress(raw);
}

export function getAgentIdBigInt(): bigint | null {
  const raw = process.env.VIRE_AGENT_ID?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const val = BigInt(raw);
  return val > 0n ? val : null;
}

export function getAgentAddress(): Address | null {
  const pk = process.env.VIRE_AGENT_PRIVATE_KEY?.trim();
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) return null;
  return privateKeyToAccount(pk as Hex).address;
}

export function getPublicClient() {
  return createCeloPublicClient({
    rpcUrl: getCeloRpcUrl(),
    chainId: CELO_MAINNET_CHAIN_ID,
  });
}

export function getTextileClient() {
  return new TextileClient({
    baseUrl: process.env.TEXTILE_API_BASE_URL?.trim() || DEFAULT_TEXTILE_API_URL,
    apiKey: process.env.TEXTILE_API_KEY?.trim() || undefined,
    chainId: CELO_MAINNET_CHAIN_ID,
    builderCodes: [getAttributionCode()],
  });
}

export function getBuyClient() {
  const pk = process.env.VIRE_AGENT_PRIVATE_KEY?.trim();
  const dryRun = process.env.BUY_DRY_RUN === "true";
  const tokenEnv = process.env.BUY_PAYMENT_TOKEN?.trim().toUpperCase();
  const paymentToken = tokenEnv === "USDC" ? "USDC" : "USDT";

  return new CeloBuyClient({
    gatewayUrl: process.env.BUY_GATEWAY_URL?.trim() || DEFAULT_BUY_GATEWAY_URL,
    rpcUrl: getCeloRpcUrl(),
    agentPrivateKey: pk && /^0x[0-9a-fA-F]{64}$/.test(pk) ? (pk as Hex) : undefined,
    paymentToken,
    maxAmountUsd: process.env.BUY_MAX_AMOUNT_USD?.trim() || "0.05",
    dryRun,
  });
}

export interface VaultLiveSnapshot {
  deployed: boolean;
  address: Address | null;
  owner: Address | null;
  settlementAgent: Address | null;
  paused: boolean | null;
  usdtBalanceAtomic: string | null;
  totalCommittedBudgetAtomic: string | null;
  error?: string;
}

export async function getVaultSnapshot(): Promise<VaultLiveSnapshot> {
  const address = getVaultAddress();
  if (!address) {
    return {
      deployed: false,
      address: null,
      owner: null,
      settlementAgent: null,
      paused: null,
      usdtBalanceAtomic: null,
      totalCommittedBudgetAtomic: null,
    };
  }

  try {
    const client = getPublicClient();
    const [bytecode, owner, settlementAgent, paused, totalCommitted, usdtBal] = await Promise.all([
      client.getBytecode({ address }),
      client.readContract({ address, abi: VIRE_VAULT_ABI, functionName: "owner" }),
      client.readContract({ address, abi: VIRE_VAULT_ABI, functionName: "settlementAgent" }),
      client.readContract({ address, abi: VIRE_VAULT_ABI, functionName: "paused" }),
      client.readContract({ address, abi: VIRE_VAULT_ABI, functionName: "totalCampaignRemainingBudget" }),
      client.readContract({
        address: CELO_TOKENS.USDT.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);

    return {
      deployed: Boolean(bytecode && bytecode.length > 2),
      address,
      owner,
      settlementAgent,
      paused,
      usdtBalanceAtomic: usdtBal.toString(),
      totalCommittedBudgetAtomic: totalCommitted.toString(),
    };
  } catch (err) {
    return {
      deployed: false,
      address,
      owner: null,
      settlementAgent: null,
      paused: null,
      usdtBalanceAtomic: null,
      totalCommittedBudgetAtomic: null,
      error: err instanceof Error ? err.message : "Failed to read VireVault on Celo Mainnet",
    };
  }
}

export interface OnchainCampaignState {
  exists: boolean;
  creator: Address;
  active: boolean;
  vaultPaused: boolean;
  budgetUsdtAtomic: string;
  remainingBudgetUsdtAtomic: string;
  maxPerPayoutUsdtAtomic: string;
  dailyLimitUsdtAtomic: string;
  remainingDailyLimitUsdtAtomic: string;
  maxPayoutsPerRecipient: number;
}

function minAtomic(a: string, b: string): string {
  const ba = BigInt(a);
  const bb = BigInt(b);
  return (ba < bb ? ba : bb).toString();
}

/**
 * Read live onchain campaign budgets, creator, active status, and remaining 24h daily limits from VireVault v2.
 * Keeps UI readouts and Policy Gate 100% synced with Celo Mainnet even after creator topUpCampaign() calls.
 */
export async function getOnchainCampaignStates(
  campaignIds: Hex[]
): Promise<Map<string, OnchainCampaignState>> {
  const result = new Map<string, OnchainCampaignState>();
  const address = getVaultAddress();
  if (!address || campaignIds.length === 0) return result;

  try {
    const client = getPublicClient();
    const [vaultPaused, entries] = await Promise.all([
      client.readContract({ address, abi: VIRE_VAULT_ABI, functionName: "paused" }),
      Promise.all(
        campaignIds.map(async (id) => {
          const [camp, remDaily] = await Promise.all([
            client.readContract({
              address,
              abi: VIRE_VAULT_ABI,
              functionName: "getCampaign",
              args: [id],
            }),
            client.readContract({
              address,
              abi: VIRE_VAULT_ABI,
              functionName: "remainingDailyLimit",
              args: [id],
            }),
          ]);
          return { id, camp, remDaily };
        })
      ),
    ]);

    for (const { id, camp, remDaily } of entries) {
      if (!camp.exists) {
        result.set(id.toLowerCase(), {
          exists: false,
          creator: "0x0000000000000000000000000000000000000000",
          active: false,
          vaultPaused: Boolean(vaultPaused),
          budgetUsdtAtomic: "0",
          remainingBudgetUsdtAtomic: "0",
          maxPerPayoutUsdtAtomic: "0",
          dailyLimitUsdtAtomic: "0",
          remainingDailyLimitUsdtAtomic: "0",
          maxPayoutsPerRecipient: 0,
        });
        continue;
      }
      result.set(id.toLowerCase(), {
        exists: true,
        creator: camp.creator,
        active: Boolean(camp.active && !vaultPaused),
        vaultPaused: Boolean(vaultPaused),
        budgetUsdtAtomic: camp.budgetUsdt.toString(),
        remainingBudgetUsdtAtomic: camp.remainingBudget.toString(),
        maxPerPayoutUsdtAtomic: camp.maxPerPayoutUsdt.toString(),
        dailyLimitUsdtAtomic: camp.dailyLimitUsdt.toString(),
        remainingDailyLimitUsdtAtomic: remDaily.toString(),
        maxPayoutsPerRecipient: Number(camp.maxPayoutsPerRecipient),
      });
    }
  } catch {
    // Graceful fallback to DB cache if RPC is transiently unreachable
  }

  return result;
}

const CAMPAIGN_CREATED_EVENT = parseAbiItem(
  "event CampaignCreated(bytes32 indexed campaignId, address indexed creator, uint256 budgetUsdt, uint256 maxPerPayoutUsdt, uint256 dailyLimitUsdt, uint32 maxPayoutsPerRecipient, bool active)"
);

/**
 * Scan VireVault v2 CampaignCreated logs for a given creator wallet so owners can ALWAYS recover
 * funded onchain campaigns even if their browser dropped mid-publish.
 */
export async function getOnchainCampaignsByCreator(
  creator: Address
): Promise<Array<{ campaignId: Hex; txHash: Hash; state: OnchainCampaignState }>> {
  const address = getVaultAddress();
  if (!address) return [];

  try {
    const client = getPublicClient();
    const deployBlockRaw = process.env.NEXT_PUBLIC_VIRE_VAULT_DEPLOY_BLOCK?.trim();
    const fromBlock = deployBlockRaw && /^\d+$/.test(deployBlockRaw) ? BigInt(deployBlockRaw) : 83660000n;
    const logs = await client.getLogs({
      address,
      event: CAMPAIGN_CREATED_EVENT,
      args: { creator: getAddress(creator) },
      fromBlock,
      toBlock: "latest",
    });

    const ids = Array.from(new Set(logs.map((l) => l.args.campaignId).filter((x): x is Hex => Boolean(x))));
    const txById = new Map<string, Hash>();
    for (const l of logs) {
      if (l.args.campaignId && l.transactionHash) {
        txById.set(l.args.campaignId.toLowerCase(), l.transactionHash);
      }
    }

    const states = await getOnchainCampaignStates(ids);
    const out: Array<{ campaignId: Hex; txHash: Hash; state: OnchainCampaignState }> = [];
    for (const id of ids) {
      const state = states.get(id.toLowerCase());
      if (!state) continue;
      out.push({
        campaignId: id,
        txHash: txById.get(id.toLowerCase()) ?? ("0x0000000000000000000000000000000000000000000000000000000000000000" as Hash),
        state,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Merge a DB campaign row with its live onchain VireVault v2 state and optional deadline. */
export function mergeCampaignWithOnchain<
  T extends {
    id: string;
    active: boolean;
    budgetUsdtAtomic: string;
    remainingUsdtAtomic: string;
    maxPerPayoutUsdtAtomic: string;
    dailyLimitUsdtAtomic: string;
    maxPayoutsPerRecipient: number;
    creatorWallet?: string | null;
    endsAt?: number | null;
  },
>(
  row: T,
  onchainMap: Map<string, OnchainCampaignState>
): T & {
  remainingDailyLimitUsdtAtomic: string;
  onchainSynced: boolean;
  onchainCreator: Address | null;
  isExpired: boolean;
} {
  const isExpired = Boolean(row.endsAt && Date.now() > row.endsAt);
  const onchain = onchainMap.get(row.id.toLowerCase());
  if (!onchain) {
    // RPC unreachable or vault not configured — fall back gracefully to DB cache
    return {
      ...row,
      active: row.active && !isExpired,
      remainingDailyLimitUsdtAtomic: row.dailyLimitUsdtAtomic,
      onchainSynced: false,
      onchainCreator: null,
      isExpired,
    };
  }
  if (!onchain.exists) {
    // Confirmed on Celo Mainnet that this campaign is not funded on the active VireVault v2
    return {
      ...row,
      active: false,
      remainingUsdtAtomic: "0",
      remainingDailyLimitUsdtAtomic: "0",
      onchainSynced: false,
      onchainCreator: null,
      isExpired,
    };
  }
  return {
    ...row,
    creatorWallet: onchain.creator.toLowerCase(),
    active: row.active && onchain.active && !isExpired,
    budgetUsdtAtomic: onchain.budgetUsdtAtomic,
    remainingUsdtAtomic: onchain.remainingBudgetUsdtAtomic,
    maxPerPayoutUsdtAtomic: minAtomic(row.maxPerPayoutUsdtAtomic, onchain.maxPerPayoutUsdtAtomic),
    dailyLimitUsdtAtomic: minAtomic(row.dailyLimitUsdtAtomic, onchain.dailyLimitUsdtAtomic),
    remainingDailyLimitUsdtAtomic: minAtomic(
      row.dailyLimitUsdtAtomic,
      onchain.remainingDailyLimitUsdtAtomic
    ),
    maxPayoutsPerRecipient: Math.min(row.maxPayoutsPerRecipient, onchain.maxPayoutsPerRecipient),
    onchainSynced: true,
    onchainCreator: onchain.creator,
    isExpired,
  };
}

export interface ReputationLiveSnapshot {
  registered: boolean;
  agentId: string | null;
  owner: Address | null;
  agentUri: string | null;
  summary: ReputationSummary | null;
  error?: string;
}

export async function getLiveReputationSnapshot(): Promise<ReputationLiveSnapshot> {
  const agentId = getAgentIdBigInt();
  if (!agentId) {
    return { registered: false, agentId: null, owner: null, agentUri: null, summary: null };
  }

  try {
    const publicClient = getPublicClient();
    const [identity, summary] = await Promise.all([
      getAgentIdentity({ publicClient, agentId }),
      getReputationSummary({ publicClient, agentId }),
    ]);

    return {
      registered: true,
      agentId: agentId.toString(),
      owner: identity.owner,
      agentUri: identity.agentUri,
      summary,
    };
  } catch (err) {
    return {
      registered: false,
      agentId: agentId.toString(),
      owner: null,
      agentUri: null,
      summary: null,
      error: err instanceof Error ? err.message : "Failed to query ERC-8004 registries",
    };
  }
}

export function createDrizzlePersistenceAdapter(): OrchestratorPersistenceAdapter {
  return {
    async isDeliverableHashUsed(deliverableHash: Hex): Promise<boolean> {
      await ensureDatabaseReady();
      const db = getDb();
      const existing = await db
        .select({ status: schema.submissions.status })
        .from(schema.submissions)
        .where(eq(schema.submissions.deliverableHash, deliverableHash))
        .limit(1);

      const row = existing[0];
      if (row && ["AUTHORIZED", "SWAPPING", "PAYING", "COMPLETED"].includes(row.status)) {
        return true;
      }
      // Belt-and-suspenders: also verify onchain VireVault replay flag so DB resets can never allow replay.
      const vaultAddr = getVaultAddress();
      if (vaultAddr) {
        try {
          const usedOnchain = await getPublicClient().readContract({
            address: vaultAddr,
            abi: VIRE_VAULT_ABI,
            functionName: "usedDeliverableHashes",
            args: [deliverableHash],
          });
          if (usedOnchain) return true;
        } catch {
          // Fall back to DB check on transient RPC hiccup
        }
      }
      return false;
    },

    async getContributorPayoutStats(campaignIdBytes32: Hex, wallet: Address, identityHandle?: string | null) {
      await ensureDatabaseReady();
      const db = getDb();
      const walletLower = wallet.toLowerCase();
      const handleLower = identityHandle?.trim().replace(/^@/, "").toLowerCase() || null;

      const rows = await db
        .select({ settledAt: schema.settlements.settledAt })
        .from(schema.settlements)
        .where(
          and(
            eq(schema.settlements.campaignId, campaignIdBytes32),
            handleLower
              ? or(
                  eq(schema.settlements.recipientWallet, walletLower),
                  eq(schema.settlements.identityHandle, handleLower)
                )
              : eq(schema.settlements.recipientWallet, walletLower)
          )
        )
        .orderBy(desc(schema.settlements.settledAt));

      return {
        count: rows.length,
        lastPayoutAtMs: rows[0]?.settledAt ?? null,
      };
    },

    async isAuthorIdClaimedInCampaign(campaignIdBytes32: Hex, authorId: string): Promise<boolean> {
      await ensureDatabaseReady();
      const db = getDb();
      const rows = await db
        .select({ id: schema.settlements.id })
        .from(schema.settlements)
        .where(
          and(
            eq(schema.settlements.campaignId, campaignIdBytes32),
            eq(schema.settlements.authorId, authorId)
          )
        )
        .limit(1);
      return rows.length > 0;
    },

    async isContentHashUsedInCampaign(campaignIdBytes32: Hex, contentHash: Hex): Promise<boolean> {
      await ensureDatabaseReady();
      const db = getDb();
      const rows = await db
        .select({ id: schema.settlements.id })
        .from(schema.settlements)
        .where(
          and(
            eq(schema.settlements.campaignId, campaignIdBytes32),
            eq(schema.settlements.contentHash, contentHash)
          )
        )
        .limit(1);
      return rows.length > 0;
    },

    async hasReceivedWelcomeGasDrip(wallet: Address): Promise<boolean> {
      await ensureDatabaseReady();
      const db = getDb();
      const rows = await db
        .select({ gasDripTxHash: schema.contributors.gasDripTxHash })
        .from(schema.contributors)
        .where(eq(schema.contributors.walletAddress, wallet.toLowerCase()))
        .limit(1);
      return Boolean(rows[0]?.gasDripTxHash);
    },

    async markWelcomeGasDripSent(wallet: Address, txHash: Hash): Promise<void> {
      await ensureDatabaseReady();
      const db = getDb();
      await db
        .update(schema.contributors)
        .set({ gasDripTxHash: txHash })
        .where(eq(schema.contributors.walletAddress, wallet.toLowerCase()));
    },

    async updateSubmissionStatus(submissionId, patch) {
      await ensureDatabaseReady();
      const db = getDb();
      await db
        .update(schema.submissions)
        .set({
          status: patch.status,
          ...(patch.policyPassed !== undefined ? { policyPassed: patch.policyPassed } : {}),
          ...(patch.failedPolicyRule !== undefined ? { failedPolicyRule: patch.failedPolicyRule } : {}),
          ...(patch.policyDetailsJson !== undefined ? { policyDetailsJson: patch.policyDetailsJson } : {}),
          ...(patch.aiVerdict !== undefined ? { aiVerdict: patch.aiVerdict } : {}),
          ...(patch.aiScore !== undefined ? { aiScore: patch.aiScore } : {}),
          ...(patch.aiConfidence !== undefined ? { aiConfidence: patch.aiConfidence } : {}),
          ...(patch.aiReason !== undefined ? { aiReason: patch.aiReason } : {}),
          ...(patch.aiEvidenceSummary !== undefined ? { aiEvidenceSummary: patch.aiEvidenceSummary } : {}),
          updatedAt: Date.now(),
        })
        .where(eq(schema.submissions.id, submissionId));
    },

    async recordBuyPayment(submissionId, receipt) {
      await ensureDatabaseReady();
      const db = getDb();
      await db.insert(schema.buyPayments).values({
        id: `buy_${randomUUID()}`,
        submissionId,
        capabilityId: receipt.capabilityId,
        endpointUrl: receipt.endpointUrl,
        paymentToken: receipt.paymentToken,
        paymentAmountAtomic: receipt.paymentAmountAtomic,
        paymentTxHash: receipt.paymentTxHash,
        dryRun: receipt.dryRun,
        createdAt: Date.now(),
      });
    },

    async saveRfqQuote(submissionId, outcome, corridor: CorridorSymbol) {
      await ensureDatabaseReady();
      const db = getDb();
      await db
        .insert(schema.rfqQuotes)
        .values({
          rfqId: outcome.rfqId,
          submissionId,
          claimToken: outcome.claimToken ?? null,
          corridor,
          sellToken: CELO_TOKENS.USDT.address,
          buyToken: CELO_TOKENS[corridor].address,
          buyAmountAtomic: outcome.quote?.buyAmount ?? "0",
          takerPaysAtomic: outcome.quote?.takerPays ?? null,
          feeAmountAtomic: outcome.quote?.feeAmount ?? null,
          rateRay: outcome.quote?.rateRay ?? null,
          spender: outcome.quote?.spender ?? null,
          expiresAt: outcome.quote?.expiresAt ?? null,
          status: outcome.status,
          attributionSuffix: outcome.attributionSuffix ?? null,
          createdAt: Date.now(),
        })
        .onConflictDoNothing();
    },

    async updateRfqQuoteStatus(rfqId, status, swapTxHash?: Hash) {
      await ensureDatabaseReady();
      const db = getDb();
      await db
        .update(schema.rfqQuotes)
        .set({
          status,
          ...(swapTxHash ? { swapTxHash } : {}),
        })
        .where(eq(schema.rfqQuotes.rfqId, rfqId));
    },

    async recordCompletedSettlement(record) {
      await ensureDatabaseReady();
      const db = getDb();
      await db.insert(schema.settlements).values({
        id: `set_${randomUUID()}`,
        submissionId: record.submissionId,
        campaignId: record.campaignIdBytes32,
        recipientWallet: record.recipientWallet.toLowerCase(),
        identityHandle: record.identityHandle?.trim().replace(/^@/, "").toLowerCase() ?? null,
        authorId: record.authorId ?? null,
        contentHash: record.contentHash ?? null,
        corridor: record.corridor,
        localTokenAddress: record.localTokenAddress,
        localAmountAtomic: record.localAmountAtomic,
        usdtSpentAtomic: record.usdtSpentAtomic,
        usdtRefundedAtomic: record.usdtRefundedAtomic,
        vaultReleaseTxHash: record.vaultReleaseTxHash,
        textileSwapTxHash: record.textileSwapTxHash,
        payoutTxHash: record.payoutTxHash,
        receiptTxHash: record.receiptTxHash,
        offrampUrl: record.offrampUrl,
        erc8004Rated: false,
        settledAt: Date.now(),
      });

      // Decrement cached campaign remaining budget cleanly
      const existing = await db
        .select({ remainingUsdtAtomic: schema.campaigns.remainingUsdtAtomic })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, record.campaignIdBytes32))
        .limit(1);
      if (existing[0]) {
        const current = BigInt(existing[0].remainingUsdtAtomic);
        const spent = BigInt(record.usdtSpentAtomic);
        const next = current > spent ? current - spent : 0n;
        await db
          .update(schema.campaigns)
          .set({ remainingUsdtAtomic: next.toString() })
          .where(eq(schema.campaigns.id, record.campaignIdBytes32));
      }
    },
  };
}

const CONVERSION_GAS_TARGET_WEI = 250_000_000_000_000_000n; // 0.25 CELO (~$0.013)
const CONVERSION_GAS_THRESHOLD_WEI = 200_000_000_000_000_000n; // Top up if < 0.20 CELO
const CONVERSION_GAS_AGENT_RESERVE_WEI = 500_000_000_000_000_000n; // Preserve >= 0.50 CELO in agent

/**
 * Launch perk: best-effort 1-time-ever Celo gas top-up (to 0.25 CELO) for verified paid Vire contributors
 * converting their local payout into Celo USDT (for MiniPay / exchanges).
 * Strictly gated to wallets with a COMPLETED settlement + sufficient onchain sellToken balance + DB atomic lock.
 */
export async function ensureContributorConversionGas(params: {
  wallet: Address;
  sellTokenAddress: Address;
  sellAmountAtomic: bigint;
}): Promise<{ toppedUp: boolean; txHash?: Hash }> {
  const pk = process.env.VIRE_AGENT_PRIVATE_KEY?.trim();
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    return { toppedUp: false };
  }

  await ensureDatabaseReady();
  const db = getDb();
  const walletLower = params.wallet.toLowerCase();

  // 1. Only sponsor wallets that have actually earned a COMPLETED settlement on Vire
  const settled = await db
    .select({ id: schema.settlements.id })
    .from(schema.settlements)
    .where(eq(schema.settlements.recipientWallet, walletLower))
    .limit(1);
  if (settled.length === 0) {
    return { toppedUp: false };
  }

  // 2. Atomically claim the 1-time conversion gas top-up slot (prevents double-click race conditions)
  const claimed = await db
    .update(schema.contributors)
    .set({ gasTopupTxHash: "PENDING" })
    .where(and(eq(schema.contributors.walletAddress, walletLower), isNull(schema.contributors.gasTopupTxHash)))
    .returning({ walletAddress: schema.contributors.walletAddress });
  if (claimed.length === 0) {
    return { toppedUp: false };
  }

  const releaseSlot = async () => {
    await db
      .update(schema.contributors)
      .set({ gasTopupTxHash: null })
      .where(and(eq(schema.contributors.walletAddress, walletLower), eq(schema.contributors.gasTopupTxHash, "PENDING")))
      .catch(() => {});
  };

  try {
    const publicClient = getPublicClient();
    const agentWallet = createTaggedWalletClient({
      privateKey: pk as Hex,
      attributionCode: getAttributionCode(),
      rpcUrl: getCeloRpcUrl(),
    });

    const [recipientCelo, agentCelo, sellBalance] = await Promise.all([
      publicClient.getBalance({ address: params.wallet }),
      publicClient.getBalance({ address: agentWallet.account.address }),
      publicClient.readContract({
        address: params.sellTokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [params.wallet],
      }),
    ]);

    // Only sponsor when the wallet actually holds the local token being converted and needs CELO gas
    if (sellBalance < params.sellAmountAtomic || recipientCelo >= CONVERSION_GAS_THRESHOLD_WEI) {
      await releaseSlot();
      return { toppedUp: false };
    }

    const topUpWei = CONVERSION_GAS_TARGET_WEI - recipientCelo;
    if (topUpWei <= 0n || agentCelo < CONVERSION_GAS_AGENT_RESERVE_WEI + topUpWei) {
      await releaseSlot();
      return { toppedUp: false };
    }

    const dripTx = await sendTaggedTx({
      walletClient: agentWallet,
      publicClient,
      to: params.wallet,
      value: topUpWei,
      attributionCode: getAttributionCode(),
      useUsdtFeeAbstraction: false,
    });

    await db
      .update(schema.contributors)
      .set({ gasTopupTxHash: dripTx.hash })
      .where(eq(schema.contributors.walletAddress, walletLower));

    return { toppedUp: true, txHash: dripTx.hash };
  } catch {
    await releaseSlot();
    return { toppedUp: false };
  }
}

export async function createLiveOrchestrator(): Promise<SettlementOrchestrator> {
  const pk = process.env.VIRE_AGENT_PRIVATE_KEY?.trim();
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("VIRE_AGENT_PRIVATE_KEY is required on the server to execute live settlements.");
  }
  const vaultAddress = getVaultAddress();
  if (!vaultAddress) {
    throw new Error("VIRE_VAULT_ADDRESS is required on the server to execute live settlements.");
  }

  const rpcUrl = getCeloRpcUrl();
  const attributionCode = getAttributionCode();
  const publicClient = getPublicClient();
  const vaultSnap = await getVaultSnapshot();

  return new SettlementOrchestrator({
    publicClient,
    taggedWalletClient: createTaggedWalletClient({
      privateKey: pk as Hex,
      attributionCode,
      rpcUrl,
    }),
    untaggedTextileWalletClient: createUntaggedTextileWalletClient({
      privateKey: pk as Hex,
      rpcUrl,
    }),
    textileClient: getTextileClient(),
    buyClient: getBuyClient(),
    persistence: createDrizzlePersistenceAdapter(),
    vaultAddress,
    vaultOwnerAddress: vaultSnap.owner ?? undefined,
    teamBlocklist: parseTeamBlocklist(process.env.TEAM_WALLET_BLOCKLIST),
    attributionCode,
    useUsdtFeeAbstraction: process.env.VIRE_USE_USDT_FEE_ABSTRACTION === "true",
    useChainstackRpc: process.env.BUY_USE_CHAINSTACK_RPC === "true",
    githubApiToken: process.env.GITHUB_API_TOKEN?.trim() || undefined,
  });
}
