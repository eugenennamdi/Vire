import { z } from "zod";
import type { CorridorSymbol } from "./tokens.js";

export const DeliverableTypeSchema = z.enum(["promo_post", "referral", "qa_bug", "localization"]);
export type DeliverableType = z.infer<typeof DeliverableTypeSchema>;

export const CorridorSymbolSchema = z.enum(["cNGN", "IDRX", "wARS", "wBRL", "wMXN", "wCOP"]);

export const SubmissionStatusSchema = z.enum([
  "SUBMITTED",
  "VERIFYING",
  "PENDING_REVIEW",
  "REJECTED",
  "AUTHORIZED",
  "SWAPPING",
  "PAYING",
  "COMPLETED",
  "REFUNDED",
  "FAILED",
]);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

export const CampaignVisibilitySchema = z.enum(["public", "unlisted"]);
export type CampaignVisibility = z.infer<typeof CampaignVisibilitySchema>;

export const VerificationModeSchema = z.enum(["auto", "manual"]);
export type VerificationMode = z.infer<typeof VerificationModeSchema>;

export const AutoPlatformSchema = z.enum(["x", "github", "web"]);
export type AutoPlatform = z.infer<typeof AutoPlatformSchema>;

export const AutoVerificationRulesSchema = z.object({
  platform: AutoPlatformSchema,
  requiredTokens: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
  minAuthorFollowers: z.number().int().min(0).max(100_000).default(10),
  minAccountAgeDays: z.number().int().min(0).max(3650).default(30),
});
export type AutoVerificationRules = z.infer<typeof AutoVerificationRulesSchema>;

export const PolicyRuleCodeSchema = z.enum([
  "UNIQUE_DELIVERABLE_HASH",
  "VERIFIED_EXTERNAL_IDENTITY",
  "CAMPAIGN_ACTIVE_AND_FUNDED",
  "STAGE_CAP_AND_COOLDOWN",
  "TEXTILE_MIN_NOTIONAL_FLOOR",
  "CORRIDOR_LIQUIDITY_AND_SPREAD",
  "VERIFICATION_SCORE_THRESHOLD",
]);
export type PolicyRuleCode = z.infer<typeof PolicyRuleCodeSchema>;

export interface CampaignStage {
  stageIndex: number;
  title: string;
  instructions: string;
  rewardLocalAtomic: string;
  cooldownHours: number;
}

export const CampaignStageSchema = z.object({
  stageIndex: z.number().int().min(1).max(10),
  title: z.string().min(3).max(120),
  instructions: z.string().min(10).max(1000),
  rewardLocalAtomic: z.string().regex(/^\d+$/),
  cooldownHours: z.number().int().min(0).max(720),
});

export const VerificationVerdictSchema = z.object({
  verdict: z.enum(["pass", "reject"]),
  score: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(600),
  evidenceSummary: z.string().min(1).max(1000),
});
export type VerificationVerdict = z.infer<typeof VerificationVerdictSchema>;

export interface BuyPaymentReceipt {
  capabilityId: string;
  endpointUrl: string;
  paymentToken: string;
  paymentAmountAtomic: string;
  paymentTxHash: string | null;
  dryRun: boolean;
  settledAt: string;
}

export interface PolicyCheckResult {
  rule: PolicyRuleCode;
  passed: boolean;
  detail: string;
}

export interface PolicyGateDecision {
  passed: boolean;
  failedRule: PolicyRuleCode | null;
  failedReason: string | null;
  checks: PolicyCheckResult[];
  estimatedUsdtAtomic: string | null;
  quotedSpreadBps: number | null;
}

export interface CorridorLiveStatus {
  corridor: CorridorSymbol;
  fiatCode: string;
  countryName: string;
  tokenAddress: string;
  decimals: number;
  status: "live" | "no_makers_online" | "market_closed" | "degraded" | "error";
  sampleBuyAmountAtomic: string;
  sampleBuyAmountFormatted: string;
  sampleTakerPaysUsdtAtomic: string | null;
  sampleTakerPaysUsdtFormatted: string | null;
  impliedRateLocalPerUsdt: number | null;
  maxSellUsdtFormatted: string | null;
  levelsCount: number;
  feedStatus: string | null;
  updatedAt: string;
}

export const EthAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");

export const CreateSubmissionRequestSchema = z.object({
  campaignSlug: z.string().min(2).max(120),
  stageIndex: z.number().int().min(1).max(10).default(1),
  contributorWallet: EthAddressSchema,
  deliverableUrl: z.string().url().max(2048),
  deliverableNotes: z.string().max(2000).default(""),
  referralCode: z.string().max(128).optional(),
  inviteCode: z.string().max(64).optional(),
});
export type CreateSubmissionRequest = z.infer<typeof CreateSubmissionRequestSchema>;

export const PublishCampaignRequestSchema = z.object({
  campaignId: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid bytes32 campaignId"),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid transaction hash").optional(),
  slug: z
    .string()
    .min(3)
    .max(96)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Slug must be lowercase letters, numbers, and hyphens"),
  partnerName: z.string().trim().min(2).max(80),
  partnerLocation: z.string().trim().min(2).max(80).default("Global"),
  title: z.string().trim().min(4).max(120),
  description: z.string().trim().min(10).max(1200),
  criteria: z.string().trim().min(10).max(1500),
  deliverableType: DeliverableTypeSchema,
  corridor: CorridorSymbolSchema,
  rewardLocalHuman: z.string().regex(/^\d+(\.\d+)?$/, "Invalid reward amount"),
  visibility: CampaignVisibilitySchema.default("public"),
  verificationMode: VerificationModeSchema.default("auto"),
  autoRules: AutoVerificationRulesSchema.nullable().optional(),
  inviteCode: z.string().trim().max(64).optional(),
  endsAt: z.number().int().positive().nullable().optional(),
  maxSpreadBps: z.number().int().min(50).max(1000).default(250),
  maxPayoutsPerRecipient: z.number().int().min(1).max(10).default(1),
});
export type PublishCampaignRequest = z.infer<typeof PublishCampaignRequestSchema>;

export const X402VerifyRequestSchema = z.object({
  deliverableUrl: z.string().url().max(2048),
  deliverableType: DeliverableTypeSchema,
  criteria: z.string().min(10).max(1500),
  corridor: CorridorSymbolSchema,
  rewardLocalHuman: z.string().regex(/^\d+(\.\d+)?$/),
});
export type X402VerifyRequest = z.infer<typeof X402VerifyRequestSchema>;

export const X402CreateCampaignRequestSchema = z.object({
  partnerName: z.string().min(2).max(100),
  title: z.string().min(4).max(120),
  description: z.string().min(10).max(1200),
  deliverableType: DeliverableTypeSchema,
  corridor: CorridorSymbolSchema,
  rewardLocalHuman: z.string().regex(/^\d+(\.\d+)?$/),
  budgetUsdtHuman: z.string().regex(/^\d+(\.\d+)?$/),
  maxPerPayoutUsdtHuman: z.string().regex(/^\d+(\.\d+)?$/),
  dailyLimitUsdtHuman: z.string().regex(/^\d+(\.\d+)?$/),
  maxPayoutsPerRecipient: z.number().int().min(1).max(10).default(3),
  maxSpreadBps: z.number().int().min(10).max(1000).default(250),
  minPassScore: z.number().int().min(50).max(100).default(75),
});
export type X402CreateCampaignRequest = z.infer<typeof X402CreateCampaignRequestSchema>;

export function parseTeamBlocklist(raw?: string): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^0x[a-f0-9]{40}$/.test(s))
  );
}
