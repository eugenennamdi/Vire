import {
  CELO_MAINNET_CHAIN_ID,
  CELO_TOKENS,
  DEFAULT_BUY_GATEWAY_URL,
  DEFAULT_CELO_RPC_URL,
  type BuyPaymentReceipt,
} from "@vire/shared";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type BuyPaymentToken = "USDT" | "USDC";

export interface BuyClientConfig {
  gatewayUrl?: string;
  rpcUrl?: string;
  agentPrivateKey?: Hex;
  paymentToken?: BuyPaymentToken;
  /** Maximum spend per single x402 call in USD (e.g. "0.05"). Default "$0.05". */
  maxAmountUsd?: string;
  /** Explicit offline dry-run mode (for local unit tests without spending mainnet stablecoins). */
  dryRun?: boolean;
  /** Optional custom fetch implementation (used in unit tests). */
  fetchImpl?: typeof fetch;
}

export interface CencoriMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CencoriChatResult {
  content: string;
  model: string;
  raw: unknown;
  receipt: BuyPaymentReceipt;
}

export interface ChainstackRpcResult<T = unknown> {
  result: T;
  receipt: BuyPaymentReceipt;
}

export interface BuyTweetDetailResult {
  tweetId: string;
  text: string | null;
  authorHandle: string | null;
  raw: unknown;
  receipt: BuyPaymentReceipt;
}

export interface BuyCatalogCapability {
  id: string;
  platform: string;
  available: boolean;
  method: string;
  url: string;
  price?: {
    usd?: string;
    atomic?: string;
    tokens?: string[];
    pricingModel?: string;
  };
}

/** Decode base64 JSON `payment-response` / `x-payment-response` header emitted by x402 facilitators. */
export function parseX402PaymentResponseHeader(headerValue: string | null): {
  txHash: string | null;
  network?: string;
  payer?: string;
  raw?: Record<string, unknown>;
} {
  if (!headerValue) return { txHash: null };
  try {
    const decoded = Buffer.from(headerValue, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    const txHash =
      (typeof parsed.transaction === "string" && parsed.transaction) ||
      (typeof parsed.txHash === "string" && parsed.txHash) ||
      (typeof parsed.transactionHash === "string" && parsed.transactionHash) ||
      null;
    return {
      txHash,
      network: typeof parsed.network === "string" ? parsed.network : undefined,
      payer: typeof parsed.payer === "string" ? parsed.payer : undefined,
      raw: parsed,
    };
  } catch {
    return { txHash: null };
  }
}

/**
 * Programmatic Celo `buy` API Gateway client (`https://gateway.usebuy.ai`).
 * Pays per-request for Cencori LLM inference (`maximo-atlas-1.3`, $0.01) and Chainstack Celo RPC ($0.01)
 * on Celo Mainnet over x402 using the agent wallet, capturing every settlement tx hash for public audit.
 */
export class CeloBuyClient {
  private readonly gatewayUrl: string;
  private readonly rpcUrl: string;
  private readonly paymentToken: BuyPaymentToken;
  private readonly maxAmountUsd: string;
  private readonly dryRun: boolean;
  private readonly fetchImpl?: typeof fetch;
  private readonly paidFetch: typeof fetch | null;

  constructor(config: BuyClientConfig = {}) {
    this.gatewayUrl = (config.gatewayUrl ?? DEFAULT_BUY_GATEWAY_URL).replace(/\/+$/, "");
    this.rpcUrl = config.rpcUrl ?? DEFAULT_CELO_RPC_URL;
    this.paymentToken = config.paymentToken ?? "USDT";
    const cleanedMax = (config.maxAmountUsd ?? "0.05").replace(/^\$/, "");
    this.maxAmountUsd = `$${cleanedMax}`;
    this.dryRun = Boolean(config.dryRun);
    this.fetchImpl = config.fetchImpl;

    if (!this.dryRun && config.agentPrivateKey) {
      const account = privateKeyToAccount(config.agentPrivateKey);
      const token = CELO_TOKENS[this.paymentToken];
      const maxAtomic = BigInt(Math.ceil(Number(cleanedMax) * 10 ** token.decimals)).toString();
      const targetAssetLower = token.address.toLowerCase();
      const client = new x402Client();
      // Always set spendControls via setSpendControls() (constructor ignores config).
      client.setSpendControls({
        allowedAssets: [
          {
            network: `eip155:${CELO_MAINNET_CHAIN_ID}`,
            asset: token.address,
            maxAmountPerPayment: maxAtomic,
          },
        ],
        maxAmountPerPayment: this.maxAmountUsd,
      });
      // Register BOTH x402 v2 (eip155:*) and v1 schemes, plus a strict policy selecting
      // our configured paymentToken (e.g. USDT) — otherwise @x402/core keeps USDC as a
      // built-in default asset and picks accepts[0] (USDC) even when the agent holds USDT!
      registerExactEvmScheme(client, {
        signer: account as unknown as Parameters<typeof registerExactEvmScheme>[1]["signer"],
        schemeOptions: { rpcUrl: this.rpcUrl },
        policies: [
          (_version, requirements) => {
            const preferred = requirements.filter(
              (r) =>
                r.asset.toLowerCase() === targetAssetLower &&
                (r.network === `eip155:${CELO_MAINNET_CHAIN_ID}` ||
                  String(r.network) === "celo")
            );
            return preferred.length > 0 ? preferred : requirements;
          },
        ],
      });
      this.paidFetch = wrapFetchWithPayment(config.fetchImpl ?? fetch, client);
    } else {
      this.paidFetch = null;
    }
  }

  get isDryRun(): boolean {
    return this.dryRun;
  }

  /** Free catalog discovery against live `https://gateway.usebuy.ai/v1/catalog`. */
  async fetchCatalog(): Promise<{ capabilities: BuyCatalogCapability[] }> {
    const res = await fetch(`${this.gatewayUrl}/v1/catalog`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`buy catalog fetch failed with HTTP ${res.status}`);
    }
    const data = (await res.json()) as { capabilities?: BuyCatalogCapability[] };
    return { capabilities: data.capabilities ?? [] };
  }

  /**
   * Paid LLM inference via Cencori on Celo `buy` gateway ($0.01/call).
   * Strictly conforms to gateway schema: model="maximo-atlas-1.3", max_tokens in [256, 1024, 4096], no extra properties.
   */
  async callCencoriInference(params: {
    messages: CencoriMessage[];
    maxTokens?: 256 | 1024 | 4096;
    temperature?: number;
  }): Promise<CencoriChatResult> {
    const endpointUrl = `${this.gatewayUrl}/cencori/v1/chat/completions`;
    const maxTokens = params.maxTokens ?? 1024;
    const payload: {
      model: "maximo-atlas-1.3";
      messages: CencoriMessage[];
      max_tokens: 256 | 1024 | 4096;
      temperature?: number;
    } = {
      model: "maximo-atlas-1.3",
      messages: params.messages,
      max_tokens: maxTokens,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    };

    if (this.dryRun) {
      return {
        content: JSON.stringify({
          verdict: "pass",
          score: 88,
          confidence: 0.9,
          reason: "BUY_DRY_RUN local verification mode active; deliverable format validated.",
          evidenceSummary: "Local dry-run evaluation (no mainnet x402 payment executed).",
        }),
        model: "maximo-atlas-1.3 (dry-run)",
        raw: { dryRun: true },
        receipt: {
          capabilityId: "cencori.v1.chat.completions",
          endpointUrl,
          paymentToken: this.paymentToken,
          paymentAmountAtomic: "10000",
          paymentTxHash: null,
          dryRun: true,
          settledAt: new Date().toISOString(),
        },
      };
    }

    if (!this.paidFetch) {
      throw new Error(
        "CeloBuyClient requires agentPrivateKey when BUY_DRY_RUN is false. Set VIRE_AGENT_PRIVATE_KEY or enable BUY_DRY_RUN=true for local tests."
      );
    }

    const res = await this.paidFetch(endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    });

    const paymentHeader = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
    const paymentInfo = parseX402PaymentResponseHeader(paymentHeader);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Celo buy Cencori inference failed (${res.status}): ${errText.slice(0, 400)}`);
    }

    const body = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content ?? "";
    if (!content) {
      throw new Error("Celo buy Cencori returned empty completion content");
    }

    return {
      content,
      model: body.model ?? "maximo-atlas-1.3",
      raw: body,
      receipt: {
        capabilityId: "cencori.v1.chat.completions",
        endpointUrl,
        paymentToken: this.paymentToken,
        paymentAmountAtomic: "10000", // $0.01 atomic in 6-dec USDT/USDC
        paymentTxHash: paymentInfo.txHash,
        dryRun: false,
        settledAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Paid Chainstack Celo Mainnet JSON-RPC call via Celo `buy` gateway ($0.01/call or batch up to 2,000 calls).
   */
  async callChainstackRpc<T = unknown>(rpcBody: Record<string, unknown> | Record<string, unknown>[]): Promise<ChainstackRpcResult<T>> {
    const endpointUrl = `${this.gatewayUrl}/chainstack/celo`;

    if (this.dryRun) {
      let result: T = { jsonrpc: "2.0", id: 1, result: "0x0" } as T;
      if (this.fetchImpl) {
        const res = await this.fetchImpl(this.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rpcBody),
          signal: AbortSignal.timeout(15_000),
        });
        result = (await res.json()) as T;
      }
      return {
        result,
        receipt: {
          capabilityId: "chainstack.celo",
          endpointUrl,
          paymentToken: this.paymentToken,
          paymentAmountAtomic: "10000",
          paymentTxHash: null,
          dryRun: true,
          settledAt: new Date().toISOString(),
        },
      };
    }

    if (!this.paidFetch) {
      throw new Error("CeloBuyClient requires agentPrivateKey for paid Chainstack RPC calls.");
    }

    const res = await this.paidFetch(endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcBody),
      signal: AbortSignal.timeout(30_000),
    });

    const paymentHeader = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
    const paymentInfo = parseX402PaymentResponseHeader(paymentHeader);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Celo buy Chainstack RPC failed (${res.status}): ${errText.slice(0, 400)}`);
    }

    const json = (await res.json()) as T;
    return {
      result: json,
      receipt: {
        capabilityId: "chainstack.celo",
        endpointUrl,
        paymentToken: this.paymentToken,
        paymentAmountAtomic: "10000",
        paymentTxHash: paymentInfo.txHash,
        dryRun: false,
        settledAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Paid X (Twitter) single-tweet detail fetch via Celo `buy` gateway ($0.005/call).
   * Capability: `monid.x.tikhub.api-v1-twitter-web-fetch-tweet-detail`.
   */
  async fetchTweetDetail(tweetId: string): Promise<BuyTweetDetailResult> {
    const endpointUrl = `${this.gatewayUrl}/v1/social/x/tools/tikhub-api-v1-twitter-web-fetch-tweet-detail`;

    if (this.dryRun) {
      return {
        tweetId,
        text: null,
        authorHandle: null,
        raw: { dryRun: true, tweet_id: tweetId },
        receipt: {
          capabilityId: "monid.x.tikhub.api-v1-twitter-web-fetch-tweet-detail",
          endpointUrl,
          paymentToken: this.paymentToken,
          paymentAmountAtomic: "5000",
          paymentTxHash: null,
          dryRun: true,
          settledAt: new Date().toISOString(),
        },
      };
    }

    if (!this.paidFetch) {
      throw new Error("CeloBuyClient requires agentPrivateKey for paid X tweet detail lookups.");
    }

    const res = await this.paidFetch(endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ queryParams: { tweet_id: tweetId } }),
      signal: AbortSignal.timeout(30_000),
    });

    const paymentHeader = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
    const paymentInfo = parseX402PaymentResponseHeader(paymentHeader);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Celo buy X tweet detail failed (${res.status}): ${errText.slice(0, 400)}`);
    }

    const raw = (await res.json()) as Record<string, unknown>;
    const outerData = (raw.data as Record<string, unknown> | undefined) ?? raw;
    const innerData = (outerData.data as Record<string, unknown> | undefined) ?? outerData;
    const textCandidate =
      (typeof innerData.text === "string" && innerData.text) ||
      (typeof innerData.full_text === "string" && innerData.full_text) ||
      (typeof (innerData.legacy as Record<string, unknown> | undefined)?.full_text === "string"
        ? String((innerData.legacy as Record<string, unknown>).full_text)
        : null);
    const authorObj = (innerData.author as Record<string, unknown> | undefined) ??
      (innerData.user as Record<string, unknown> | undefined);
    const authorCandidate =
      (typeof authorObj?.screen_name === "string" && authorObj.screen_name) ||
      (typeof authorObj?.userName === "string" && authorObj.userName) ||
      (typeof innerData.screen_name === "string" && innerData.screen_name) ||
      null;

    return {
      tweetId,
      text: textCandidate,
      authorHandle: authorCandidate,
      raw,
      receipt: {
        capabilityId: "monid.x.tikhub.api-v1-twitter-web-fetch-tweet-detail",
        endpointUrl,
        paymentToken: this.paymentToken,
        paymentAmountAtomic: "5000", // $0.005 atomic in 6-dec USDT/USDC
        paymentTxHash: paymentInfo.txHash,
        dryRun: false,
        settledAt: new Date().toISOString(),
      },
    };
  }
}
