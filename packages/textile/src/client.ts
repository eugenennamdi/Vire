import {
  CELO_MAINNET_CHAIN_ID,
  CELO_TOKENS,
  DEFAULT_ATTRIBUTION_CODE,
  DEFAULT_TEXTILE_API_URL,
  isAllowedTextileTarget,
  validateAttributionCode,
} from "@vire/shared";
import {
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
import { ConcurrencyLimiter } from "./concurrency.js";
import { TakerProofManager } from "./taker-proof.js";
import type {
  CreateRfqRequest,
  RfqLevelsEnvelope,
  RfqOutcomeData,
  RfqOutcomeEnvelope,
  RfqPreviewData,
  RfqPreviewEnvelope,
  RfqStatusData,
  RfqStatusEnvelope,
  TextileErrorDetails,
  TextileErrorPayload,
} from "./types.js";

export const MIN_FIRM_RFQ_TIMEOUT_MS = 75_000;
export const DEFAULT_FIRM_RFQ_TIMEOUT_MS = 80_000;
export const DEFAULT_EXPIRY_SAFETY_BUFFER_MS = 3_000;

export class TextileApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly requestId?: string,
    public readonly details?: TextileErrorDetails
  ) {
    super(message);
    this.name = "TextileApiError";
  }
}

export class TextileQuoteExpiredError extends Error {
  constructor(
    public readonly rfqId: string,
    public readonly expiresAt: string
  ) {
    super(`Textile quote ${rfqId} expired at ${expiresAt} before swap broadcast`);
    this.name = "TextileQuoteExpiredError";
  }
}

export interface TextileClientConfig {
  baseUrl?: string;
  apiKey?: string;
  chainId?: number;
  builderCodes?: string[];
  /** Client HTTP timeout for POST /v2/rfq/request. Enforced >= 75,000ms per Textile v2 spec. */
  firmRequestTimeoutMs?: number;
  maxConcurrentRfqs?: number;
  fetchImpl?: typeof fetch;
}

export interface SwapExecutionResult {
  rfqId: string;
  approvalTxHash: Hash | null;
  swapTxHash: Hash;
  spender: Address;
  takerPaysAtomic: string;
  buyAmountAtomic: string;
  feeAmountAtomic: string;
  attributionSuffix: Hex | null;
  finalStatus: RfqStatusData;
}

export class TextileClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly chainId: number;
  private readonly builderCodes: string[];
  private readonly firmRequestTimeoutMs: number;
  private readonly limiter: ConcurrencyLimiter;
  private readonly takerProofs: TakerProofManager;
  private readonly fetchFn: typeof fetch;

  constructor(config: TextileClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_TEXTILE_API_URL).replace(/\/+$/, "");
    this.apiKey = config.apiKey?.trim() || undefined;
    this.chainId = config.chainId ?? CELO_MAINNET_CHAIN_ID;
    const rawCodes = config.builderCodes ?? [DEFAULT_ATTRIBUTION_CODE];
    if (rawCodes.length > 3) {
      throw new Error("Textile FX v2 allows at most 3 builderCodes");
    }
    this.builderCodes = rawCodes.map(validateAttributionCode);

    const requestedTimeout = config.firmRequestTimeoutMs ?? DEFAULT_FIRM_RFQ_TIMEOUT_MS;
    if (requestedTimeout < MIN_FIRM_RFQ_TIMEOUT_MS) {
      throw new Error(
        `Textile POST /v2/rfq/request timeout must be >= ${MIN_FIRM_RFQ_TIMEOUT_MS}ms (got ${requestedTimeout}ms)`
      );
    }
    this.firmRequestTimeoutMs = requestedTimeout;
    this.limiter = new ConcurrencyLimiter(Math.min(config.maxConcurrentRfqs ?? 4, 4));
    this.takerProofs = new TakerProofManager();
    this.fetchFn = config.fetchImpl ?? fetch;
  }

  get hasPartnerApiKey(): boolean {
    return Boolean(this.apiKey);
  }

  get activeRfqs(): number {
    return this.limiter.active;
  }

  get queuedRfqs(): number {
    return this.limiter.queued;
  }

  private buildHeaders(claimToken?: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    if (claimToken) {
      headers["X-Rfq-Claim"] = claimToken;
    }
    return headers;
  }

  private async requestJson<T>(
    path: string,
    options: {
      method: "GET" | "POST";
      body?: unknown;
      claimToken?: string;
      timeoutMs: number;
    }
  ): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: options.method,
      headers: this.buildHeaders(options.claimToken),
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    const text = await res.text();
    let parsed: unknown = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }

    if (!res.ok) {
      const errObj = (parsed as TextileErrorPayload)?.error;
      throw new TextileApiError(
        errObj?.message ?? `Textile API ${options.method} ${path} failed with HTTP ${res.status}`,
        res.status,
        errObj?.code,
        errObj?.request_id,
        errObj?.details
      );
    }

    return parsed as T;
  }

  /** Free indicative corridor price ladders (zero RFQ slots, cached ~2s upstream). */
  async getLevels(chainId: number = this.chainId): Promise<RfqLevelsEnvelope["data"]> {
    const envelope = await this.requestJson<RfqLevelsEnvelope>(`/rfq/levels?chainId=${chainId}`, {
      method: "GET",
      timeoutMs: 15_000,
    });
    return envelope.data;
  }

  /**
   * Free indicative exact-output quote preview (does NOT reserve maker inventory or consume an RFQ slot).
   */
  async previewExactOutput(params: {
    buyToken: Address;
    buyAmountAtomic: string;
    sellToken?: Address;
    taker?: Address;
    chainId?: number;
  }): Promise<RfqPreviewData> {
    const body: CreateRfqRequest = {
      chainId: params.chainId ?? this.chainId,
      sellToken: params.sellToken ?? CELO_TOKENS.USDT.address,
      buyToken: params.buyToken,
      buyAmount: params.buyAmountAtomic,
      ...(params.taker ? { taker: params.taker } : {}),
    };

    const envelope = await this.requestJson<RfqPreviewEnvelope>("/rfq/preview", {
      method: "POST",
      body,
      timeoutMs: 20_000,
    });
    return envelope.data;
  }

  /**
   * Request a firm exact-output quote (`POST /v2/rfq/request`).
   * - Respects max 4 concurrent open RFQs via in-process semaphore.
   * - Enforces HTTP timeout >= 75s.
   * - Enables Textile native ERC-8021 attribution (`includeAttribution: true`, `builderCodes`) in Partner Key mode.
   * - Invokes `onClaimToken` immediately so callers persist `claimToken` BEFORE any chain tx.
   */
  async requestFirmExactOutput(params: {
    buyToken: Address;
    buyAmountAtomic: string;
    taker: Address;
    sellToken?: Address;
    chainId?: number;
    /** Required only in keyless mode (when no Partner API key is configured). */
    takerAccount?: Account;
    /** Called synchronously/awaited immediately with the one-time claimToken before returning. */
    onClaimToken?: (outcome: RfqOutcomeData) => Promise<void> | void;
  }): Promise<RfqOutcomeData> {
    const chainId = params.chainId ?? this.chainId;
    const sellToken = params.sellToken ?? CELO_TOKENS.USDT.address;

    return this.limiter.run(async () => {
      const body: CreateRfqRequest = {
        chainId,
        sellToken,
        buyToken: params.buyToken,
        buyAmount: params.buyAmountAtomic,
        taker: params.taker,
      };

      if (this.apiKey) {
        // Partner API key mode: omit takerProof, enable native Textile ERC-8021 attribution.
        body.includeAttribution = true;
        body.builderCodes = this.builderCodes;
      } else {
        if (!params.takerAccount) {
          throw new Error("Keyless Textile RFQ mode requires takerAccount to sign TakerControl takerProof");
        }
        body.takerProof = await this.takerProofs.getOrCreateProof({
          account: params.takerAccount as Account & { signTypedData?: (args: unknown) => Promise<Hex> },
          chainId,
        });
      }

      let envelope: RfqOutcomeEnvelope;
      try {
        envelope = await this.requestJson<RfqOutcomeEnvelope>("/rfq/request", {
          method: "POST",
          body,
          timeoutMs: this.firmRequestTimeoutMs,
        });
      } catch (err) {
        // If keyless takerProof was stale/replayed, refresh once and retry cleanly.
        if (
          !this.apiKey &&
          params.takerAccount &&
          err instanceof TextileApiError &&
          err.statusCode === 401 &&
          err.details?.reason?.startsWith("proof_of_control_")
        ) {
          this.takerProofs.invalidate(params.taker, chainId);
          body.takerProof = await this.takerProofs.getOrCreateProof({
            account: params.takerAccount as Account & { signTypedData?: (args: unknown) => Promise<Hex> },
            chainId,
            forceFresh: true,
          });
          envelope = await this.requestJson<RfqOutcomeEnvelope>("/rfq/request", {
            method: "POST",
            body,
            timeoutMs: this.firmRequestTimeoutMs,
          });
        } else {
          throw err;
        }
      }

      const outcome = envelope.data;
      if (params.onClaimToken) {
        await params.onClaimToken(outcome);
      }
      return outcome;
    });
  }

  /** Release maker inventory cleanly when a firm quote is aborted or expired before broadcast. */
  async cancelQuote(rfqId: string, claimToken?: string): Promise<void> {
    await this.requestJson(`/rfq/${encodeURIComponent(rfqId)}/cancel`, {
      method: "POST",
      claimToken,
      timeoutMs: 15_000,
    });
  }

  /** Report broadcast swap tx hash to Textile (idempotent; retries transient 5xx/network errors). */
  async submitTxHash(rfqId: string, txHash: Hash, claimToken?: string): Promise<RfqStatusData> {
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const envelope = await this.requestJson<RfqStatusEnvelope>(
          `/rfq/${encodeURIComponent(rfqId)}/submit`,
          {
            method: "POST",
            body: { txHash },
            claimToken,
            timeoutMs: 15_000,
          }
        );
        return envelope.data;
      } catch (err) {
        lastError = err;
        // Do not retry 4xx client/conflict errors.
        if (err instanceof TextileApiError && err.statusCode >= 400 && err.statusCode < 500) {
          throw err;
        }
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, attempt * 1000));
        }
      }
    }
    throw lastError;
  }

  async getStatus(rfqId: string, claimToken?: string): Promise<RfqStatusData> {
    const envelope = await this.requestJson<RfqStatusEnvelope>(`/rfq/${encodeURIComponent(rfqId)}`, {
      method: "GET",
      claimToken,
      timeoutMs: 15_000,
    });
    return envelope.data;
  }

  /** Poll GET /v2/rfq/{id} until a terminal status (`filled`, `failed`, `expired`, `no_quote`). */
  async pollUntilTerminal(
    rfqId: string,
    claimToken?: string,
    options?: { maxWaitMs?: number; pollIntervalMs?: number }
  ): Promise<RfqStatusData> {
    const maxWaitMs = options?.maxWaitMs ?? 60_000;
    const pollIntervalMs = options?.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + maxWaitMs;

    let latest = await this.getStatus(rfqId, claimToken);
    while (
      latest.status !== "filled" &&
      latest.status !== "failed" &&
      latest.status !== "expired" &&
      latest.status !== "no_quote" &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      latest = await this.getStatus(rfqId, claimToken);
    }
    return latest;
  }

  /**
   * Execute a firm Textile FX quote safely on Celo Mainnet:
   * 1. Validates spender + swap.to against strict Textile contract allowlist.
   * 2. Refuses any walletClient extended with @celo/attribution-tags (zero double-tagging).
   * 3. Checks standing USD₮ allowance to quote.spender; if needed, broadcasts approval and AWAITS receipt confirmation.
   * 4. Re-checks clock against expiresAt; cancels cleanly via /cancel if lapsed.
   * 5. Broadcasts transactions.swap verbatim (preserving Textile's executeBatch + merged ERC-8021 tag).
   * 6. Reports tx hash via /submit and reconciles terminal fill status.
   */
  async executeFirmSwap(params: {
    outcome: RfqOutcomeData;
    untaggedWalletClient: WalletClient<Transport, Chain, Account>;
    publicClient: PublicClient<Transport, Chain>;
    sellToken?: Address;
    expirySafetyBufferMs?: number;
    onApprovalBroadcast?: (txHash: Hash) => Promise<void> | void;
    onSwapBroadcast?: (txHash: Hash) => Promise<void> | void;
  }): Promise<SwapExecutionResult> {
    const { outcome, untaggedWalletClient, publicClient } = params;

    if (outcome.status !== "quoted" || !outcome.quote || !outcome.transactions?.swap) {
      throw new Error(`Cannot execute Textile RFQ ${outcome.rfqId}: status=${outcome.status}`);
    }

    // Hard anti-double-tagging guard: swap wallet client MUST be untagged.
    if ((untaggedWalletClient as { __vireAttributedCode?: string }).__vireAttributedCode) {
      throw new Error(
        "Refusing to broadcast Textile swap with an attribution-wrapped wallet client (would double-tag calldata). Pass createUntaggedTextileWalletClient()."
      );
    }

    const { quote, transactions } = outcome;
    const swapTx = transactions.swap;
    if (!swapTx) {
      throw new Error(`Cannot execute Textile RFQ ${outcome.rfqId}: missing swap transaction`);
    }
    const approvalTx = transactions.approval;
    const sellToken = params.sellToken ?? CELO_TOKENS.USDT.address;

    if (swapTx.chainId !== this.chainId) {
      throw new Error(`Unexpected swap chainId ${swapTx.chainId}; expected ${this.chainId}`);
    }
    if (swapTx.value !== "0") {
      throw new Error(`Unexpected non-zero native value "${swapTx.value}" on Textile FX swap`);
    }
    if (!isAllowedTextileTarget(quote.spender) || !isAllowedTextileTarget(swapTx.to)) {
      throw new Error(
        `Blocked Textile swap targeting non-allowlisted contract: spender=${quote.spender}, swap.to=${swapTx.to}`
      );
    }

    const requiredAllowance = BigInt(quote.takerPays);
    const currentAllowance = await publicClient.readContract({
      address: sellToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [untaggedWalletClient.account.address, quote.spender],
    });

    let approvalTxHash: Hash | null = null;
    if (currentAllowance < requiredAllowance) {
      if (approvalTx.to.toLowerCase() !== sellToken.toLowerCase()) {
        throw new Error(
          `Blocked approval targeting unexpected contract ${approvalTx.to} (expected ${sellToken})`
        );
      }
      approvalTxHash = await untaggedWalletClient.sendTransaction({
        account: untaggedWalletClient.account,
        chain: untaggedWalletClient.chain,
        to: approvalTx.to,
        data: approvalTx.data,
        value: BigInt(approvalTx.value),
      });
      if (params.onApprovalBroadcast) {
        await params.onApprovalBroadcast(approvalTxHash);
      }
      // CRITICAL: Never approve and swap in the same block — await receipt confirmation first!
      const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalTxHash });
      if (approvalReceipt.status !== "success") {
        await this.safeCancel(outcome.rfqId, outcome.claimToken);
        throw new Error(`USD₮ approval transaction ${approvalTxHash} reverted onchain`);
      }
    }

    // Re-check accept cutoff BEFORE broadcasting swap!
    const safetyBufferMs = params.expirySafetyBufferMs ?? DEFAULT_EXPIRY_SAFETY_BUFFER_MS;
    const expiresAtMs = Date.parse(quote.expiresAt);
    if (!Number.isNaN(expiresAtMs) && Date.now() >= expiresAtMs - safetyBufferMs) {
      await this.safeCancel(outcome.rfqId, outcome.claimToken);
      throw new TextileQuoteExpiredError(outcome.rfqId, quote.expiresAt);
    }

    // Broadcast transactions.swap VERBATIM (preserving executeBatch + Textile native ERC-8021 suffix).
    const swapTxHash = await untaggedWalletClient.sendTransaction({
      account: untaggedWalletClient.account,
      chain: untaggedWalletClient.chain,
      to: swapTx.to,
      data: swapTx.data,
      value: BigInt(swapTx.value),
    });

    if (params.onSwapBroadcast) {
      await params.onSwapBroadcast(swapTxHash);
    }

    // Report hash immediately (idempotent) while awaiting onchain confirmation.
    const [swapReceipt, submittedStatus] = await Promise.all([
      publicClient.waitForTransactionReceipt({ hash: swapTxHash }),
      this.submitTxHash(outcome.rfqId, swapTxHash, outcome.claimToken),
    ]);

    if (swapReceipt.status !== "success") {
      throw new Error(`Textile swap transaction ${swapTxHash} reverted onchain`);
    }

    const finalStatus =
      submittedStatus.status === "filled"
        ? submittedStatus
        : await this.pollUntilTerminal(outcome.rfqId, outcome.claimToken, {
            maxWaitMs: 45_000,
            pollIntervalMs: 2_000,
          });

    return {
      rfqId: outcome.rfqId,
      approvalTxHash,
      swapTxHash,
      spender: quote.spender,
      takerPaysAtomic: quote.takerPays,
      buyAmountAtomic: quote.buyAmount,
      feeAmountAtomic: quote.feeAmount,
      attributionSuffix: outcome.attributionSuffix ?? null,
      finalStatus,
    };
  }

  private async safeCancel(rfqId: string, claimToken?: string): Promise<void> {
    try {
      await this.cancelQuote(rfqId, claimToken);
    } catch {
      // Best-effort cancel; never mask the primary expiry/approval error.
    }
  }
}
