import {
  CELO_TOKENS,
  CORRIDORS,
  formatTokenAmount,
  parseTokenAmount,
  PublishCampaignRequestSchema,
  toPlainDecimalAmount,
  type AutoVerificationRules,
  type CampaignStage,
  type CorridorSymbol,
} from "@vire/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";
import { getLiveCorridors } from "@/lib/corridors-live";
import {
  getMinCampaignBudgetUsdtAtomic,
  getOnchainCampaignStates,
  getPublicClient,
  getVaultAddress,
  hashInviteCode,
  mergeCampaignWithOnchain,
} from "@/lib/runtime";
import { verifyWalletSessionCookie, WALLET_SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDatabaseReady();
  await ensureDefaultCampaignsSeeded();

  const db = getDb();
  // Strictly hide unlisted (link-only) and admin-moderated (hidden) campaigns from the public directory.
  const rows = await db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.visibility, "public"), eq(schema.campaigns.hidden, false)))
    .orderBy(desc(schema.campaigns.isLaunchPartner), desc(schema.campaigns.createdAt));

  const [onchainMap, liveCorridors, reviewSubs, voucherRows] = await Promise.all([
    getOnchainCampaignStates(rows.map((r) => r.id as Hex)),
    getLiveCorridors().catch(() => ({ asOf: new Date().toISOString(), corridors: [] })),
    rows.length > 0
      ? db
          .select({
            campaignId: schema.submissions.campaignId,
            status: schema.submissions.status,
            reviewedByWallet: schema.submissions.reviewedByWallet,
          })
          .from(schema.submissions)
          .where(inArray(schema.submissions.campaignId, rows.map((r) => r.id)))
      : Promise.resolve([]),
    rows.length > 0
      ? db
          .select({
            campaignId: schema.vouchers.campaignId,
            status: schema.vouchers.status,
            orderValueLocal: schema.vouchers.orderValueLocal,
          })
          .from(schema.vouchers)
          .where(inArray(schema.vouchers.campaignId, rows.map((r) => r.id)))
      : Promise.resolve([]),
  ]);

  const gmvByCampaign = new Map<string, { verifiedGmvLocal: number; vouchersClaimed: number }>();
  for (const v of voucherRows) {
    if (v.status === "CLAIMED") {
      const cur = gmvByCampaign.get(v.campaignId) ?? { verifiedGmvLocal: 0, vouchersClaimed: 0 };
      cur.vouchersClaimed += 1;
      const n = v.orderValueLocal ? Number(v.orderValueLocal) : 0;
      if (Number.isFinite(n) && n > 0) cur.verifiedGmvLocal += n;
      gmvByCampaign.set(v.campaignId, cur);
    }
  }

  const approvalByCampaign = new Map<string, { approved: number; rejected: number; pending: number }>();
  for (const s of reviewSubs) {
    const cur = approvalByCampaign.get(s.campaignId) ?? { approved: 0, rejected: 0, pending: 0 };
    if (s.status === "COMPLETED") cur.approved += 1;
    else if (s.status === "REJECTED" && s.reviewedByWallet) cur.rejected += 1;
    else if (s.status === "PENDING_REVIEW") cur.pending += 1;
    approvalByCampaign.set(s.campaignId, cur);
  }

  const rateByCorridor = new Map(
    liveCorridors.corridors
      .filter((c) => c.impliedRateLocalPerUsdt && c.impliedRateLocalPerUsdt > 0)
      .map((c) => [c.corridor, c.impliedRateLocalPerUsdt!])
  );

  const campaigns = rows.map((rawRow) => {
    const row = mergeCampaignWithOnchain(rawRow, onchainMap);
    const corridor = row.corridor as CorridorSymbol;
    const stages = JSON.parse(row.stagesJson) as CampaignStage[];
    const stage1 = stages[0];
    const rate = rateByCorridor.get(corridor) ?? CORRIDORS[corridor].typicalFiatPerUsd;
    const rewardLocalFloat = stage1 ? Number(toPlainDecimalAmount(stage1.rewardLocalAtomic, corridor)) : 0;
    const usdtPerPayout = rate > 0 && rewardLocalFloat > 0 ? (rewardLocalFloat / rate) * 1.015 : 0;
    const remainingUsdtFloat = Number(toPlainDecimalAmount(row.remainingUsdtAtomic, "USDT"));
    const spotsRemaining =
      row.active && usdtPerPayout > 0 ? Math.max(0, Math.floor(remainingUsdtFloat / usdtPerPayout)) : 0;
    const autoRules = row.autoRulesJson ? (JSON.parse(row.autoRulesJson) as AutoVerificationRules) : null;

    // Never expose inviteCodeHash in public responses
    const { inviteCodeHash: _omit, ...safeRow } = row;
    void _omit;

    return {
      ...safeRow,
      corridorMeta: CORRIDORS[corridor],
      autoRules,
      requiresInviteCode: Boolean(row.inviteCodeHash),
      approvalStats: approvalByCampaign.get(row.id) ?? { approved: 0, rejected: 0, pending: 0 },
      verifiedGmvLocal: gmvByCampaign.get(row.id)?.verifiedGmvLocal ?? 0,
      vouchersClaimed: gmvByCampaign.get(row.id)?.vouchersClaimed ?? 0,
      spotsRemaining,
      stages: stages.map((st) => ({
        ...st,
        rewardLocalFormatted: formatTokenAmount(st.rewardLocalAtomic, corridor, 2),
      })),
      budgetUsdtFormatted: formatTokenAmount(row.budgetUsdtAtomic, "USDT", 2),
      remainingUsdtFormatted: formatTokenAmount(row.remainingUsdtAtomic, "USDT", 2),
      maxPerPayoutUsdtFormatted: formatTokenAmount(row.maxPerPayoutUsdtAtomic, "USDT", 2),
      dailyLimitUsdtFormatted: formatTokenAmount(row.dailyLimitUsdtAtomic, "USDT", 2),
    };
  });

  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  await ensureDatabaseReady();

  const session = verifyWalletSessionCookie(req.cookies.get(WALLET_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { error: "Please sign with your wallet to authenticate before publishing a campaign." },
      { status: 401 }
    );
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = PublishCampaignRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid campaign details", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const d = parsed.data;
  if (d.verificationMode === "auto" && (!d.autoRules || d.autoRules.requiredTokens.length === 0)) {
    return NextResponse.json(
      {
        error:
          "Automatic verification requires at least 1 required mention, hashtag, link, or keyword so payouts cannot be gamed.",
      },
      { status: 400 }
    );
  }

  if (d.endsAt && d.endsAt <= Date.now() + 5 * 60 * 1000) {
    return NextResponse.json(
      { error: "Campaign end date must be in the future." },
      { status: 400 }
    );
  }

  const vaultAddress = getVaultAddress();
  if (!vaultAddress) {
    return NextResponse.json(
      { error: "VireVault address is not configured on the server." },
      { status: 503 }
    );
  }

  const campaignId = d.campaignId.toLowerCase() as Hex;

  // If a txHash was supplied, wait briefly for confirmation receipt if needed
  if (d.txHash) {
    try {
      const publicClient = getPublicClient();
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: d.txHash as Hex,
        timeout: 25_000,
      });
      if (receipt.status !== "success") {
        return NextResponse.json(
          { error: "Onchain createCampaign transaction reverted." },
          { status: 400 }
        );
      }
    } catch {
      // Fall through to live getCampaign() contract state check below
    }
  }

  // Authoritative check: read live campaign custody & funding directly from VireVault v2 on Celo Mainnet
  const onchainMap = await getOnchainCampaignStates([campaignId]);
  const onchain = onchainMap.get(campaignId);
  if (!onchain || !onchain.exists) {
    return NextResponse.json(
      {
        error:
          "This campaign is not funded on VireVault yet. Please complete the onchain Fund transaction first.",
      },
      { status: 400 }
    );
  }

  if (onchain.creator.toLowerCase() !== session.wallet.toLowerCase()) {
    return NextResponse.json(
      {
        error: "Connected wallet does not match the onchain campaign creator address.",
      },
      { status: 403 }
    );
  }

  const minBudgetAtomic = getMinCampaignBudgetUsdtAtomic();
  if (BigInt(onchain.budgetUsdtAtomic) < minBudgetAtomic) {
    return NextResponse.json(
      {
        error: `Minimum campaign budget is $${formatTokenAmount(minBudgetAtomic, "USDT", 0)} USDT.`,
      },
      { status: 400 }
    );
  }

  // Validate reward clears Textile FX's ~$1.00 minimum notional floor (and prevents micro-payout gas farming)
  const rewardLocalAtomic = parseTokenAmount(d.rewardLocalHuman, d.corridor);
  if (rewardLocalAtomic <= 0n) {
    return NextResponse.json({ error: "Reward per person must be greater than 0." }, { status: 400 });
  }
  const liveCorridors = await getLiveCorridors().catch(() => ({ asOf: new Date().toISOString(), corridors: [] }));
  const liveRate =
    liveCorridors.corridors.find((c) => c.corridor === d.corridor)?.impliedRateLocalPerUsdt ??
    CORRIDORS[d.corridor].typicalFiatPerUsd;
  const rewardFloat = Number(toPlainDecimalAmount(rewardLocalAtomic, d.corridor));
  const estUsdtPerPayout = liveRate > 0 ? rewardFloat / liveRate : 0;
  if (estUsdtPerPayout < 1.02) {
    const minLocal = Math.ceil(liveRate * 1.1);
    return NextResponse.json(
      {
        error: `Minimum payout per person is ~$1.10 USDT (at least ${minLocal.toLocaleString("en-US")} ${d.corridor}) so every swap clears Textile FX's $1.00 mainnet floor.`,
      },
      { status: 400 }
    );
  }

  const token = CELO_TOKENS[d.corridor];
  const db = getDb();

  // Check for slug conflict on a different campaignId
  const existingSlug = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.slug, d.slug))
    .limit(1);

  const finalSlug =
    existingSlug[0] && existingSlug[0].id.toLowerCase() !== campaignId
      ? `${d.slug}-${campaignId.slice(2, 8)}`
      : d.slug;

  const stageCount = Math.max(1, Math.min(10, onchain.maxPayoutsPerRecipient));
  const stages: CampaignStage[] = Array.from({ length: stageCount }, (_, idx) => ({
    stageIndex: idx + 1,
    title: stageCount === 1 ? d.title : `${d.title} (Submission ${idx + 1}/${stageCount})`,
    instructions: d.criteria,
    rewardLocalAtomic: rewardLocalAtomic.toString(),
    cooldownHours: 0,
  }));

  const inviteCodeHash =
    d.visibility === "unlisted" && d.inviteCode?.trim()
      ? hashInviteCode(d.inviteCode.trim(), campaignId)
      : null;

  const now = Date.now();
  const existingById = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);

  if (existingById.length > 0) {
    return NextResponse.json({
      created: false,
      alreadyPublished: true,
      campaignId,
      slug: finalSlug,
      shortUrl: `/c/${finalSlug}`,
    });
  }

  await db.insert(schema.campaigns).values({
    id: campaignId,
    slug: finalSlug,
    partnerName: d.partnerName,
    partnerLocation: d.partnerLocation,
    isLaunchPartner: false,
    title: d.title,
    description: d.description,
    criteria: d.criteria,
    deliverableType: d.deliverableType,
    corridor: d.corridor,
    localTokenAddress: token.address,
    localTokenDecimals: token.decimals,
    rewardLocalAtomic: rewardLocalAtomic.toString(),
    stagesJson: JSON.stringify(stages),
    budgetUsdtAtomic: onchain.budgetUsdtAtomic,
    remainingUsdtAtomic: onchain.remainingBudgetUsdtAtomic,
    maxPerPayoutUsdtAtomic: onchain.maxPerPayoutUsdtAtomic,
    dailyLimitUsdtAtomic: onchain.dailyLimitUsdtAtomic,
    maxPayoutsPerRecipient: onchain.maxPayoutsPerRecipient,
    cooldownHours: 0,
    maxSpreadBps: d.maxSpreadBps,
    minPassScore: 75,
    active: onchain.active,
    creatorWallet: onchain.creator.toLowerCase(),
    visibility: d.visibility,
    verificationMode: d.verificationMode,
    autoRulesJson: d.verificationMode === "auto" && d.autoRules ? JSON.stringify(d.autoRules) : null,
    inviteCodeHash,
    endsAt: d.endsAt ?? null,
    hidden: false,
    createdTxHash: d.txHash ?? null,
    createdViaX402TxHash: null,
    createdAt: now,
  });

  return NextResponse.json(
    {
      created: true,
      campaignId,
      slug: finalSlug,
      shortUrl: `/c/${finalSlug}`,
      claimUrl: `/claim?campaign=${encodeURIComponent(finalSlug)}`,
    },
    { status: 201 }
  );
}
