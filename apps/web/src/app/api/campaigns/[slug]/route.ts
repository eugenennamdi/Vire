import {
  CampaignVisibilitySchema,
  CORRIDORS,
  formatTokenAmount,
  toPlainDecimalAmount,
  type AutoVerificationRules,
  type CampaignStage,
  type CorridorSymbol,
} from "@vire/shared";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { z } from "zod";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";
import { getLiveCorridors } from "@/lib/corridors-live";
import { getOnchainCampaignStates, hashInviteCode, mergeCampaignWithOnchain } from "@/lib/runtime";
import { verifyWalletSessionCookie, WALLET_SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  await ensureDatabaseReady();
  await ensureDefaultCampaignsSeeded();

  const { slug } = await context.params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.slug, slug))
    .limit(1);

  const rawRow = rows[0];
  if (!rawRow) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const session = verifyWalletSessionCookie(req.cookies.get(WALLET_SESSION_COOKIE)?.value);

  const [onchainMap, liveCorridors, allSubs] = await Promise.all([
    getOnchainCampaignStates([rawRow.id as Hex]),
    getLiveCorridors().catch(() => ({ asOf: new Date().toISOString(), corridors: [] })),
    db
      .select({
        id: schema.submissions.id,
        contributorWallet: schema.submissions.contributorWallet,
        deliverableUrl: schema.submissions.deliverableUrl,
        status: schema.submissions.status,
        aiReason: schema.submissions.aiReason,
        reviewNote: schema.submissions.reviewNote,
        reviewedByWallet: schema.submissions.reviewedByWallet,
        createdAt: schema.submissions.createdAt,
        updatedAt: schema.submissions.updatedAt,
      })
      .from(schema.submissions)
      .where(eq(schema.submissions.campaignId, rawRow.id))
      .orderBy(desc(schema.submissions.updatedAt)),
  ]);

  const row = mergeCampaignWithOnchain(rawRow, onchainMap);
  const corridor = row.corridor as CorridorSymbol;
  const stages = JSON.parse(row.stagesJson) as CampaignStage[];
  const stage1 = stages[0];
  const rate =
    liveCorridors.corridors.find((c) => c.corridor === corridor)?.impliedRateLocalPerUsdt ??
    CORRIDORS[corridor].typicalFiatPerUsd;
  const rewardLocalFloat = stage1 ? Number(toPlainDecimalAmount(stage1.rewardLocalAtomic, corridor)) : 0;
  const usdtPerPayout = rate > 0 && rewardLocalFloat > 0 ? (rewardLocalFloat / rate) * 1.015 : 0;
  const remainingUsdtFloat = Number(toPlainDecimalAmount(row.remainingUsdtAtomic, "USDT"));
  const spotsRemaining =
    row.active && usdtPerPayout > 0 ? Math.max(0, Math.floor(remainingUsdtFloat / usdtPerPayout)) : 0;

  let approved = 0;
  let rejected = 0;
  let pending = 0;
  for (const s of allSubs) {
    if (s.status === "COMPLETED") approved += 1;
    else if (s.status === "REJECTED" && s.reviewedByWallet) rejected += 1;
    else if (s.status === "PENDING_REVIEW") pending += 1;
  }

  let mySubmission: null | {
    id: string;
    deliverableUrl: string;
    status: string;
    reviewNote: string | null;
    aiReason: string | null;
    createdAt: number;
    updatedAt: number;
    settlement?: {
      localAmountFormatted: string;
      corridor: string;
      payoutTxHash: string;
      settledAt: number;
    } | null;
  } = null;

  if (session) {
    const mine = allSubs.find((s) => s.contributorWallet.toLowerCase() === session.wallet.toLowerCase());
    if (mine) {
      const settledRows =
        mine.status === "COMPLETED"
          ? await db
              .select()
              .from(schema.settlements)
              .where(eq(schema.settlements.submissionId, mine.id))
              .limit(1)
          : [];
      const st = settledRows[0];
      mySubmission = {
        id: mine.id,
        deliverableUrl: mine.deliverableUrl,
        status: mine.status,
        reviewNote: mine.reviewNote,
        aiReason: mine.aiReason,
        createdAt: mine.createdAt,
        updatedAt: mine.updatedAt,
        settlement: st
          ? {
              localAmountFormatted: formatTokenAmount(st.localAmountAtomic, st.corridor as CorridorSymbol, 2),
              corridor: st.corridor,
              payoutTxHash: st.payoutTxHash,
              settledAt: st.settledAt,
            }
          : null,
      };
    }
  }

  const autoRules = row.autoRulesJson ? (JSON.parse(row.autoRulesJson) as AutoVerificationRules) : null;
  const { inviteCodeHash: _omit, ...safeRow } = row;
  void _omit;

  return NextResponse.json({
    campaign: {
      ...safeRow,
      corridorMeta: CORRIDORS[corridor],
      autoRules,
      requiresInviteCode: Boolean(row.inviteCodeHash),
      spotsRemaining,
      approvalStats: { approved, rejected, pending },
      isOwner: Boolean(session && row.creatorWallet && session.wallet === row.creatorWallet.toLowerCase()),
      mySubmission,
      stages: stages.map((st) => ({
        ...st,
        rewardLocalFormatted: formatTokenAmount(st.rewardLocalAtomic, corridor, 2),
      })),
      budgetUsdtFormatted: formatTokenAmount(row.budgetUsdtAtomic, "USDT", 2),
      remainingUsdtFormatted: formatTokenAmount(row.remainingUsdtAtomic, "USDT", 2),
      maxPerPayoutUsdtFormatted: formatTokenAmount(row.maxPerPayoutUsdtAtomic, "USDT", 2),
      dailyLimitUsdtFormatted: formatTokenAmount(row.dailyLimitUsdtAtomic, "USDT", 2),
    },
  });
}

const PatchCampaignSchema = z.object({
  visibility: CampaignVisibilitySchema.optional(),
  endsAt: z.number().int().positive().nullable().optional(),
  inviteCode: z.string().trim().max(64).nullable().optional(),
});

/**
 * Owner-only safe metadata controls (visibility, deadline, invite code).
 * Deliberately locks criteria, reward, currency, and verificationMode after publication to prevent bait-and-switch.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  await ensureDatabaseReady();

  const session = verifyWalletSessionCookie(req.cookies.get(WALLET_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Wallet session required." }, { status: 401 });
  }

  const { slug } = await context.params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.slug, slug))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const onchainMap = await getOnchainCampaignStates([row.id as Hex]);
  const onchain = onchainMap.get(row.id.toLowerCase());
  const effectiveCreator = (onchain?.exists ? onchain.creator : row.creatorWallet)?.toLowerCase();

  if (!effectiveCreator || effectiveCreator !== session.wallet.toLowerCase()) {
    return NextResponse.json(
      { error: "Only the onchain campaign owner can update campaign settings." },
      { status: 403 }
    );
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = PatchCampaignSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid update payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const patch: Partial<typeof schema.campaigns.$inferInsert> = {};
  if (parsed.data.visibility !== undefined) patch.visibility = parsed.data.visibility;
  if (parsed.data.endsAt !== undefined) patch.endsAt = parsed.data.endsAt;
  if (parsed.data.inviteCode !== undefined) {
    patch.inviteCodeHash = parsed.data.inviteCode ? hashInviteCode(parsed.data.inviteCode) : null;
  }

  await db
    .update(schema.campaigns)
    .set(patch)
    .where(and(eq(schema.campaigns.id, row.id), eq(schema.campaigns.slug, slug)));

  return NextResponse.json({ updated: true, slug });
}
