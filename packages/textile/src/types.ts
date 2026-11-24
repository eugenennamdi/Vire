import type { Address, Hex } from "viem";

/** Verified directly against https://api.textilecredit.com/v2/openapi.json (v2.0.0) */

export interface TakerProof {
  nonce: Hex;
  issuedAt: number;
  signature: Hex;
  nonceSecret?: Hex;
  scheme?: "eip712" | "eip191";
}

export interface CreateRfqRequestBase {
  chainId: number;
  sellToken: Address;
  buyToken: Address;
  taker?: Address;
  preferredLiquidityWallets?: Address[];
  restrictedLiquidityWallets?: Address[];
  /** Opt-in ERC-8021 tagging for Partner API keys. Must be true for builderCodes to apply. */
  includeAttribution?: boolean;
  /** Up to 3 codes matching ^[a-z0-9_]{1,32}$ (never starting with textile_ or tp_). */
  builderCodes?: string[];
  /** Only for keyless callers without a Partner API key; omitted when Authorization: Bearer is set. */
  takerProof?: TakerProof;
}

export type CreateRfqRequest =
  | (CreateRfqRequestBase & { buyAmount: string; sellAmount?: never })
  | (CreateRfqRequestBase & { sellAmount: string; buyAmount?: never });

export interface UnsignedTransaction {
  to: Address;
  data: Hex;
  /** Decimal string in wei; always "0" for Textile FX swaps. */
  value: string;
  chainId: number;
}

export interface RfqFeedState {
  status: "market_closed" | "stale" | "degraded";
  market?: "colombia_fx";
  opensAt?: string;
}

export interface RfqRoutingInfo {
  preferenceApplied?: boolean;
  restrictionApplied?: boolean;
  fallbackUsed?: boolean;
  targetMakerWallets?: string[];
  preferredQuotesReceived?: number;
  openMarketQuotesReceived?: number;
}

export interface RfqPreviewData {
  status: "preview" | "no_quote";
  reason?: string;
  sellAmount?: string;
  buyAmount?: string;
  feeAmount?: string;
  takerPays?: string;
  rateRay?: string;
  availableSellAmount?: string;
  availableBuyAmount?: string;
  reservedUntil?: string;
  retryAfterMs?: number;
  feed?: RfqFeedState;
  routing?: RfqRoutingInfo;
}

export interface RfqPreviewEnvelope {
  data: RfqPreviewData;
}

export interface RfqSignedOrderSlice {
  encodedOrder: Hex;
  signature: Hex;
  sellAmount: string;
  buyAmount: string;
  feeAmount: string;
  maker: Address;
}

export interface RfqFirmQuote {
  sellAmount: string;
  buyAmount: string;
  feeAmount: string;
  takerPays: string;
  rateRay: string;
  expiresAt: string;
  orderDeadline: string;
  latestOrderDeadline: string;
  reactor: Address;
  /** Contract to approve AND swap target (LimitOrderReactor or VaultOrderExecutor). */
  spender: Address;
  taker: Address;
  encodedOrder?: Hex;
  signature?: Hex;
  orders?: RfqSignedOrderSlice[];
}

export interface RfqOutcomeData {
  rfqId: string;
  /** Returned ONCE on POST /v2/rfq/request. Persist immediately and pass as X-Rfq-Claim. */
  claimToken?: string;
  status: "quoted" | "no_quote";
  reason?: string;
  availableSellAmount?: string;
  availableBuyAmount?: string;
  reservedUntil?: string;
  retryAfterMs?: number;
  feed?: RfqFeedState;
  quote?: RfqFirmQuote;
  transactions?: {
    approval: UnsignedTransaction;
    swap?: UnsignedTransaction;
  };
  /** Present when includeAttribution=true with a Partner API key; already appended to transactions.swap.data. */
  attributionSuffix?: Hex | null;
  routing?: RfqRoutingInfo;
}

export interface RfqOutcomeEnvelope {
  data: RfqOutcomeData;
}

export type RfqLifecycleStatus =
  | "soliciting"
  | "quoted"
  | "no_quote"
  | "submitted"
  | "filled"
  | "failed"
  | "expired";

export interface RfqStatusData {
  rfqId: string;
  status: RfqLifecycleStatus;
  chainId: number;
  sellToken: Address;
  buyToken: Address;
  sellAmount: string | null;
  buyAmount: string | null;
  feeAmount: string | null;
  taker: Address;
  quoteTtlMs?: number;
  replyBy?: string;
  expiresAt?: string;
  noQuoteReason?: string | null;
  txHash?: Hex | null;
  submittedAt?: string | null;
  filledAt?: string | null;
  failReason?: string | null;
  lateFillCorrectionClosed?: boolean;
  createdAt?: string;
}

export interface RfqStatusEnvelope {
  data: RfqStatusData;
}

export interface RfqLevelPoint {
  sellAmount: string;
  buyAmount: string;
}

export interface RfqLevelPair {
  sellToken: Address;
  buyToken: Address;
  sellDecimals: number;
  buyDecimals: number;
  minSellAmount: string;
  maxSellAmount: string;
  levels: RfqLevelPoint[];
}

export interface RfqLevelsEnvelope {
  data: {
    chainId: number;
    asOf: string;
    pairs: RfqLevelPair[];
  };
}

export interface TextileErrorDetails {
  reason?:
    | "corridor_unavailable"
    | "insufficient_funds"
    | "proof_of_control_required"
    | "proof_of_control_stale"
    | "proof_of_control_invalid"
    | "proof_of_control_replayed"
    | "taker_control_unverifiable";
  required?: string;
  available?: string;
  committed?: string;
  reservedUntil?: string;
  retryAfterMs?: number;
}

export interface TextileErrorPayload {
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
    details?: TextileErrorDetails;
  };
}
