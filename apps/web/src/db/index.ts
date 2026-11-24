import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

let _client: Client | null = null;
let _db: LibSQLDatabase<typeof schema> | null = null;
let _initPromise: Promise<void> | null = null;

function resolveDbUrl(): string {
  const raw =
    process.env.DATABASE_URL?.trim() ||
    process.env.TURSO_DATABASE_URL?.trim() ||
    "file:./data/vire.db";
  if (raw.startsWith("file:")) {
    const filePart = raw.slice(5);
    // Vercel serverless filesystem (/var/task) is read-only; fall back safely to /tmp if no remote libsql:// URL is set.
    if (process.env.VERCEL === "1" && !filePart.startsWith("/tmp/")) {
      return "file:/tmp/vire.db";
    }
    const absPath = resolve(process.cwd(), filePart);
    mkdirSync(dirname(absPath), { recursive: true });
    return `file:${absPath}`;
  }
  return raw;
}

export function getLibsqlClient(): Client {
  if (!_client) {
    _client = createClient({
      url: resolveDbUrl(),
      authToken:
        process.env.DATABASE_AUTH_TOKEN?.trim() ||
        process.env.TURSO_AUTH_TOKEN?.trim() ||
        undefined,
    });
  }
  return _client;
}

export function getDb(): LibSQLDatabase<typeof schema> {
  if (!_db) {
    _db = drizzle(getLibsqlClient(), { schema });
  }
  return _db;
}

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    partner_name TEXT NOT NULL,
    partner_location TEXT NOT NULL DEFAULT 'Global',
    is_launch_partner INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    criteria TEXT NOT NULL,
    deliverable_type TEXT NOT NULL,
    corridor TEXT NOT NULL,
    local_token_address TEXT NOT NULL,
    local_token_decimals INTEGER NOT NULL,
    reward_local_atomic TEXT NOT NULL,
    stages_json TEXT NOT NULL,
    budget_usdt_atomic TEXT NOT NULL,
    remaining_usdt_atomic TEXT NOT NULL,
    max_per_payout_usdt_atomic TEXT NOT NULL,
    daily_limit_usdt_atomic TEXT NOT NULL,
    max_payouts_per_recipient INTEGER NOT NULL DEFAULT 3,
    cooldown_hours INTEGER NOT NULL DEFAULT 12,
    max_spread_bps INTEGER NOT NULL DEFAULT 250,
    min_pass_score INTEGER NOT NULL DEFAULT 75,
    active INTEGER NOT NULL DEFAULT 1,
    created_via_x402_tx_hash TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS contributors (
    wallet_address TEXT PRIMARY KEY,
    identity_provider TEXT NOT NULL,
    identity_handle TEXT NOT NULL,
    identity_profile_url TEXT,
    eip191_signature TEXT,
    oauth_verified INTEGER NOT NULL DEFAULT 0,
    verified_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id),
    stage_index INTEGER NOT NULL DEFAULT 1,
    contributor_wallet TEXT NOT NULL,
    deliverable_url TEXT NOT NULL,
    deliverable_notes TEXT NOT NULL DEFAULT '',
    deliverable_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    policy_passed INTEGER,
    failed_policy_rule TEXT,
    policy_details_json TEXT,
    ai_verdict TEXT,
    ai_score INTEGER,
    ai_confidence REAL,
    ai_reason TEXT,
    ai_evidence_summary TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rfq_quotes (
    rfq_id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES submissions(id),
    claim_token TEXT,
    corridor TEXT NOT NULL,
    sell_token TEXT NOT NULL,
    buy_token TEXT NOT NULL,
    buy_amount_atomic TEXT NOT NULL,
    taker_pays_atomic TEXT,
    fee_amount_atomic TEXT,
    rate_ray TEXT,
    spender TEXT,
    expires_at TEXT,
    status TEXT NOT NULL,
    swap_tx_hash TEXT,
    attribution_suffix TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),
    campaign_id TEXT NOT NULL REFERENCES campaigns(id),
    recipient_wallet TEXT NOT NULL,
    identity_handle TEXT,
    author_id TEXT,
    content_hash TEXT,
    corridor TEXT NOT NULL,
    local_token_address TEXT NOT NULL,
    local_amount_atomic TEXT NOT NULL,
    usdt_spent_atomic TEXT NOT NULL,
    usdt_refunded_atomic TEXT NOT NULL DEFAULT '0',
    vault_release_tx_hash TEXT NOT NULL,
    textile_swap_tx_hash TEXT NOT NULL,
    payout_tx_hash TEXT NOT NULL,
    receipt_tx_hash TEXT NOT NULL,
    offramp_url TEXT NOT NULL,
    erc8004_rated INTEGER NOT NULL DEFAULT 0,
    erc8004_feedback_tx_hash TEXT,
    settled_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS buy_payments (
    id TEXT PRIMARY KEY,
    submission_id TEXT REFERENCES submissions(id),
    capability_id TEXT NOT NULL,
    endpoint_url TEXT NOT NULL,
    payment_token TEXT NOT NULL,
    payment_amount_atomic TEXT NOT NULL,
    payment_tx_hash TEXT,
    dry_run INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS x402_inflows (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    payer_wallet TEXT NOT NULL,
    pay_to_wallet TEXT NOT NULL,
    asset_address TEXT NOT NULL,
    asset_symbol TEXT NOT NULL,
    amount_atomic TEXT NOT NULL,
    settlement_tx_hash TEXT NOT NULL,
    block_number INTEGER,
    metadata_json TEXT,
    created_at INTEGER NOT NULL
  )`,
];

const ADDITIVE_MIGRATIONS = [
  `ALTER TABLE contributors ADD COLUMN oauth_verified INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE settlements ADD COLUMN identity_handle TEXT`,
  `ALTER TABLE settlements ADD COLUMN author_id TEXT`,
  `ALTER TABLE settlements ADD COLUMN content_hash TEXT`,
];

/** Ensure schema tables & additive anti-Sybil columns exist idempotently on cold start before querying. */
export async function ensureDatabaseReady(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getLibsqlClient();
      for (const stmt of DDL_STATEMENTS) {
        await client.execute(stmt);
      }
      for (const alter of ADDITIVE_MIGRATIONS) {
        try {
          await client.execute(alter);
        } catch {
          // Column already exists on live DB
        }
      }
    })();
  }
  return _initPromise;
}

export { schema };
