import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { z } from "zod";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import {
  generateVoucherCode,
  getAppUrl,
  getOnchainCampaignStates,
  hashVoucherCode,
} from "@/lib/runtime";
import { verifyWalletSessionCookie, WALLET_SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

const VoucherActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("issue"),
    orderRef: z.string().trim().max(64).optional().nullable(),
    orderValueLocal: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, "Order value must be a valid positive number")
      .optional()
      .nullable()
      .or(z.literal("")),
    count: z.number().int().min(1).max(20).default(1),
  }),
  z.object({
    action: z.literal("revoke"),
    voucherId: z.string().min(4).max(128),
  }),
]);

async function loadOwnedVoucherCampaign(req: NextRequest, slug: string) {
  const session = verifyWalletSessionCookie(req.cookies.get(WALLET_SESSION_COOKIE)?.value);
  if (!session) {
    return { error: NextResponse.json({ error: "Wallet session required." }, { status: 401 }) };
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.slug, slug))
    .limit(1);
  const campaign = rows[0];
  if (!campaign || campaign.hidden) {
    return { error: NextResponse.json({ error: "Campaign not found." }, { status: 404 }) };
  }

  const onchainMap = await getOnchainCampaignStates([campaign.id as Hex]);
  const onchain = onchainMap.get(campaign.id.toLowerCase());
  const effectiveCreator = (onchain?.exists ? onchain.creator : campaign.creatorWallet)?.toLowerCase();

  if (!effectiveCreator || effectiveCreator !== session.wallet.toLowerCase()) {
    return {
      error: NextResponse.json(
        { error: "Only the campaign owner can issue or manage cashback vouchers." },
        { status: 403 }
      ),
    };
  }

  return { campaign, ownerWallet: session.wallet.toLowerCase() };
}

/**
 * GET /api/campaigns/[slug]/vouchers
 * Owner-only list of issued vouchers + verified retail GMV stats.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  await ensureDatabaseReady();
  const { slug } = await context.params;
  const loaded = await loadOwnedVoucherCampaign(req, slug);
  if ("error" in loaded) return loaded.error;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.vouchers.id,
      codeHint: schema.vouchers.codeHint,
      orderRef: schema.vouchers.orderRef,
      orderValueLocal: schema.vouchers.orderValueLocal,
      status: schema.vouchers.status,
      claimedByWallet: schema.vouchers.claimedByWallet,
      submissionId: schema.vouchers.submissionId,
      createdAt: schema.vouchers.createdAt,
      claimedAt: schema.vouchers.claimedAt,
    })
    .from(schema.vouchers)
    .where(eq(schema.vouchers.campaignId, loaded.campaign.id))
    .orderBy(desc(schema.vouchers.createdAt));

  let active = 0;
  let claimed = 0;
  let revoked = 0;
  let verifiedGmvLocal = 0;
  let issuedGmvLocal = 0;

  for (const v of rows) {
    const val = v.orderValueLocal ? Number(v.orderValueLocal) : 0;
    const safeVal = Number.isFinite(val) && val > 0 ? val : 0;
    if (v.status === "ACTIVE" || v.status === "CLAIMING") {
      active += 1;
      issuedGmvLocal += safeVal;
    } else if (v.status === "CLAIMED") {
      claimed += 1;
      verifiedGmvLocal += safeVal;
      issuedGmvLocal += safeVal;
    } else if (v.status === "REVOKED") {
      revoked += 1;
    }
  }

  return NextResponse.json({
    vouchers: rows,
    stats: {
      total: rows.length,
      active,
      claimed,
      revoked,
      verifiedGmvLocal,
      issuedGmvLocal,
    },
  });
}

/**
 * POST /api/campaigns/[slug]/vouchers
 * Owner-only single-use cashback voucher issuance & revocation.
 * Stores ONLY keyed HMAC-SHA256 hashes in DB and reveals plaintext code(s) ONCE at creation.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  await ensureDatabaseReady();
  const { slug } = await context.params;
  const loaded = await loadOwnedVoucherCampaign(req, slug);
  if ("error" in loaded) return loaded.error;

  const { campaign, ownerWallet } = loaded;
  if (campaign.verificationMode !== "voucher") {
    return NextResponse.json(
      { error: "This campaign does not use cashback voucher mode." },
      { status: 400 }
    );
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = VoucherActionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid voucher request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = getDb();

  if (parsed.data.action === "revoke") {
    const updated = await db
      .update(schema.vouchers)
      .set({ status: "REVOKED" })
      .where(
        and(
          eq(schema.vouchers.id, parsed.data.voucherId),
          eq(schema.vouchers.campaignId, campaign.id),
          eq(schema.vouchers.status, "ACTIVE")
        )
      )
      .returning({ id: schema.vouchers.id });

    if (updated.length === 0) {
      return NextResponse.json(
        { error: "Voucher is already claimed, revoked, or not found." },
        { status: 409 }
      );
    }

    return NextResponse.json({ revoked: true, voucherId: parsed.data.voucherId });
  }

  // action === "issue"
  const orderRef = parsed.data.orderRef?.trim() || null;
  const orderValueLocal =
    parsed.data.orderValueLocal && parsed.data.orderValueLocal.trim().length > 0
      ? parsed.data.orderValueLocal.trim()
      : null;
  const count = parsed.data.count ?? 1;
  const now = Date.now();
  const appUrl = getAppUrl();

  const issued: Array<{
    id: string;
    code: string;
    codeHint: string;
    claimUrl: string;
    orderRef: string | null;
    orderValueLocal: string | null;
  }> = [];

  for (let i = 0; i < count; i++) {
    const id = `vch_${randomUUID()}`;
    const { code, codeHint } = generateVoucherCode(campaign.partnerName);
    const codeHash = hashVoucherCode(code, campaign.id);
    const itemOrderRef = orderRef && count > 1 ? `${orderRef}-${i + 1}` : orderRef;

    await db.insert(schema.vouchers).values({
      id,
      campaignId: campaign.id,
      codeHash,
      codeHint,
      orderRef: itemOrderRef,
      orderValueLocal,
      status: "ACTIVE",
      issuedByWallet: ownerWallet,
      createdAt: now + i,
    });

    issued.push({
      id,
      code,
      codeHint,
      claimUrl: `${appUrl}/c/${campaign.slug}?voucher=${encodeURIComponent(code)}`,
      orderRef: itemOrderRef,
      orderValueLocal,
    });
  }

  return NextResponse.json({ issued }, { status: 201 });
}
