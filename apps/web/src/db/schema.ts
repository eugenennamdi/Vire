import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(), // bytes32 hex matching VireVault campaignId
  slug: text("slug").notNull().unique(),
  partnerName: text("partner_name").notNull(),
  partnerLocation: text("partner_location").notNull().default("Global"),
  isLaunchPartner: integer("is_launch_partner", { mode: "boolean" }).notNull().default(false),
  title: text("title").notNull(),
  description: text("description").notNull(),
  criteria: text("criteria").notNull(),
  deliverableType: text("deliverable_type").notNull(), // promo_post | referral | qa_bug | localization
  corridor: text("corridor").notNull(), // cNGN | IDRX | wARS | wBRL | wMXN | wCOP
  localTokenAddress: text("local_token_address").notNull(),
  localTokenDecimals: integer("local_token_decimals").notNull(),
  rewardLocalAtomic: text("reward_local_atomic").notNull(),
  stagesJson: text("stages_json").notNull(), // JSON array of CampaignStage
  budgetUsdtAtomic: text("budget_usdt_atomic").notNull(),
  remainingUsdtAtomic: text("remaining_usdt_atomic").notNull(),
  maxPerPayoutUsdtAtomic: text("max_per_payout_usdt_atomic").notNull(),
  dailyLimitUsdtAtomic: text("daily_limit_usdt_atomic").notNull(),
  maxPayoutsPerRecipient: integer("max_payouts_per_recipient").notNull().default(3),
  cooldownHours: integer("cooldown_hours").notNull().default(12),
  maxSpreadBps: integer("max_spread_bps").notNull().default(250),
  minPassScore: integer("min_pass_score").notNull().default(75),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdViaX402TxHash: text("created_via_x402_tx_hash"),
  createdAt: integer("created_at").notNull(),
});

export const contributors = sqliteTable("contributors", {
  walletAddress: text("wallet_address").primaryKey(), // lowercase checksum-normalized
  identityProvider: text("identity_provider").notNull(), // github | x | signed_proof
  identityHandle: text("identity_handle").notNull(),
  identityProfileUrl: text("identity_profile_url"),
  eip191Signature: text("eip191_signature"),
  verifiedAt: integer("verified_at").notNull(),
});

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id),
  stageIndex: integer("stage_index").notNull().default(1),
  contributorWallet: text("contributor_wallet").notNull(),
  deliverableUrl: text("deliverable_url").notNull(),
  deliverableNotes: text("deliverable_notes").notNull().default(""),
  deliverableHash: text("deliverable_hash").notNull().unique(),
  status: text("status").notNull(), // SUBMITTED | VERIFYING | REJECTED | AUTHORIZED | SWAPPING | PAYING | COMPLETED | REFUNDED | FAILED
  policyPassed: integer("policy_passed", { mode: "boolean" }),
  failedPolicyRule: text("failed_policy_rule"),
  policyDetailsJson: text("policy_details_json"),
  aiVerdict: text("ai_verdict"),
  aiScore: integer("ai_score"),
  aiConfidence: real("ai_confidence"),
  aiReason: text("ai_reason"),
  aiEvidenceSummary: text("ai_evidence_summary"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Stores Textile FX v2 firm quotes.
 * SECURITY: `claimToken` is strictly server-private and NEVER returned in any public API response.
 */
export const rfqQuotes = sqliteTable("rfq_quotes", {
  rfqId: text("rfq_id").primaryKey(),
  submissionId: text("submission_id")
    .notNull()
    .references(() => submissions.id),
  claimToken: text("claim_token"),
  corridor: text("corridor").notNull(),
  sellToken: text("sell_token").notNull(),
  buyToken: text("buy_token").notNull(),
  buyAmountAtomic: text("buy_amount_atomic").notNull(),
  takerPaysAtomic: text("taker_pays_atomic"),
  feeAmountAtomic: text("fee_amount_atomic"),
  rateRay: text("rate_ray"),
  spender: text("spender"),
  expiresAt: text("expires_at"),
  status: text("status").notNull(),
  swapTxHash: text("swap_tx_hash"),
  attributionSuffix: text("attribution_suffix"),
  createdAt: integer("created_at").notNull(),
});

export const settlements = sqliteTable("settlements", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id")
    .notNull()
    .unique()
    .references(() => submissions.id),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id),
  recipientWallet: text("recipient_wallet").notNull(),
  corridor: text("corridor").notNull(),
  localTokenAddress: text("local_token_address").notNull(),
  localAmountAtomic: text("local_amount_atomic").notNull(),
  usdtSpentAtomic: text("usdt_spent_atomic").notNull(),
  usdtRefundedAtomic: text("usdt_refunded_atomic").notNull().default("0"),
  vaultReleaseTxHash: text("vault_release_tx_hash").notNull(),
  textileSwapTxHash: text("textile_swap_tx_hash").notNull(),
  payoutTxHash: text("payout_tx_hash").notNull(),
  receiptTxHash: text("receipt_tx_hash").notNull(),
  offrampUrl: text("offramp_url").notNull(),
  erc8004Rated: integer("erc8004_rated", { mode: "boolean" }).notNull().default(false),
  erc8004FeedbackTxHash: text("erc8004_feedback_tx_hash"),
  settledAt: integer("settled_at").notNull(),
});

export const buyPayments = sqliteTable("buy_payments", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").references(() => submissions.id),
  capabilityId: text("capability_id").notNull(),
  endpointUrl: text("endpoint_url").notNull(),
  paymentToken: text("payment_token").notNull(),
  paymentAmountAtomic: text("payment_amount_atomic").notNull(),
  paymentTxHash: text("payment_tx_hash"),
  dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const x402Inflows = sqliteTable("x402_inflows", {
  id: text("id").primaryKey(),
  endpoint: text("endpoint").notNull(),
  payerWallet: text("payer_wallet").notNull(),
  payToWallet: text("pay_to_wallet").notNull(),
  assetAddress: text("asset_address").notNull(),
  assetSymbol: text("asset_symbol").notNull(),
  amountAtomic: text("amount_atomic").notNull(),
  settlementTxHash: text("settlement_tx_hash").notNull(),
  blockNumber: integer("block_number"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull(),
});
