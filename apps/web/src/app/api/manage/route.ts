import {
  CORRIDORS,
  formatTokenAmount,
  toPlainDecimalAmount,
  type CampaignStage,
  type CorridorSymbol,
} from "@vire/shared";
import { desc, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getAddress, type Hex } from "viem";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { getLiveCorridors } from "@/lib/corridors-live";
import {
  getOnchainCampaignsByCreator,
  getOnchainCampaignStates,
  getVaultAddress,
  mergeCampaignWithOnchain,
} from "@/lib/runtime";
import { verifyWalletSessionCookie, WALLET_SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureDatabaseReady();

  const session = verifyWalletSessionCookie(req.cookies.get(WALLET_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({
      authenticated: false,
      wallet: null,
      vaultAddress: getVaultAddress(),
      ownedCampaigns: [],
      unregisteredOnchainCampaigns: [],
      mySubmissions: [],
    });
  }

  const walletLower = session.wallet.toLowerCase();
  const walletChecksum = getAddress(session.wallet);
  const db = getDb();

  // 1. Discover ALL campaigns created onchain by this wallet (guarantees zero orphaned funds!)
  const [onchainOwned, dbOwnedRows, mySubRows, liveCorridors] = await Promise.all([
    getOnchainCampaignsByCreator(walletChecksum),
    db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.creatorWallet, walletLower))
      .orderBy(desc(schema.campaigns.createdAt)),
    db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.contributorWallet, walletLower))
      .orderBy(desc(schema.submissions.updatedAt)),
    getLiveCorridors().catch(() => ({ asOf: new Date().toISOString(), corridors: [] })),
  ]);

  // Also include any DB campaign whose creator was transferred onchain to this wallet!
  const onchainIds = onchainOwned.map((c) => c.campaignId.toLowerCase());
  const dbOwnedIdSet = new Set(dbOwnedRows.map((r) => r.id.toLowerCase()));
  const extraIds = onchainIds.filter((id) => !dbOwnedIdSet.has(id));
  const extraDbRows =
    extraIds.length > 0
      ? await db.select().from(schema.campaigns).where(inArray(schema.campaigns.id, extraIds))
      : [];

  const allOwnedDbRows = [...dbOwnedRows, ...extraDbRows];
  const allOwnedDbIdSet = new Set(allOwnedDbRows.map((r) => r.id.toLowerCase()));

  const onchainMap = await getOnchainCampaignStates(allOwnedDbRows.map((r) => r.id as Hex));

  const ownedIds = allOwnedDbRows.map((r) => r.id);
  const [ownedSubmissions, ownedSettlements, ownedVouchers, contributorsAll] = await Promise.all([
    ownedIds.length > 0
      ? db
          .select()
          .from(schema.submissions)
          .where(inArray(schema.submissions.campaignId, ownedIds))
          .orderBy(desc(schema.submissions.createdAt))
      : Promise.resolve([]),
    ownedIds.length > 0
      ? db
          .select()
          .from(schema.settlements)
          .where(inArray(schema.settlements.campaignId, ownedIds))
          .orderBy(desc(schema.settlements.settledAt))
      : Promise.resolve([]),
    ownedIds.length > 0
      ? db
          .select({
            id: schema.vouchers.id,
            campaignId: schema.vouchers.campaignId,
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
          .where(inArray(schema.vouchers.campaignId, ownedIds))
          .orderBy(desc(schema.vouchers.createdAt))
      : Promise.resolve([]),
    db.select().from(schema.contributors),
  ]);

  const handleByWallet = new Map(contributorsAll.map((c) => [c.walletAddress.toLowerCase(), c.identityHandle]));
  const settlementBySubId = new Map(ownedSettlements.map((s) => [s.submissionId, s]));
  const rateByCorridor = new Map(
    liveCorridors.corridors
      .filter((c) => c.impliedRateLocalPerUsdt && c.impliedRateLocalPerUsdt > 0)
      .map((c) => [c.corridor, c.impliedRateLocalPerUsdt!])
  );

  const ownedCampaigns = allOwnedDbRows
    .map((raw) => {
      const row = mergeCampaignWithOnchain(raw, onchainMap);
      // Skip if ownership was transferred away onchain
      if (row.onchainCreator && row.onchainCreator.toLowerCase() !== walletLower) {
        return null;
      }
      const corridor = row.corridor as CorridorSymbol;
      const stages = JSON.parse(row.stagesJson) as CampaignStage[];
      const stage1 = stages[0];
      const rate = rateByCorridor.get(corridor) ?? CORRIDORS[corridor].typicalFiatPerUsd;
      const rewardLocalFloat = stage1 ? Number(toPlainDecimalAmount(stage1.rewardLocalAtomic, corridor)) : 0;
      const usdtPerPayout = rate > 0 && rewardLocalFloat > 0 ? (rewardLocalFloat / rate) * 1.015 : 0;
      const remainingUsdtFloat = Number(toPlainDecimalAmount(row.remainingUsdtAtomic, "USDT"));
      const spotsRemaining =
        row.active && usdtPerPayout > 0 ? Math.max(0, Math.floor(remainingUsdtFloat / usdtPerPayout)) : 0;

      const subs = ownedSubmissions
        .filter((s) => s.campaignId === row.id)
        .map((s) => {
          const st = settlementBySubId.get(s.id);
          return {
            id: s.id,
            contributorWallet: s.contributorWallet,
            identityHandle: handleByWallet.get(s.contributorWallet.toLowerCase()) ?? null,
            deliverableUrl: s.deliverableUrl,
            deliverableNotes: s.deliverableNotes,
            status: s.status,
            reviewNote: s.reviewNote,
            aiReason: s.aiReason,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            settlement: st
              ? {
                  localAmountFormatted: formatTokenAmount(st.localAmountAtomic, corridor, 2),
                  usdtSpentFormatted: formatTokenAmount(st.usdtSpentAtomic, "USDT", 4),
                  usdtRefundedFormatted: formatTokenAmount(st.usdtRefundedAtomic, "USDT", 4),
                  textileSwapTxHash: st.textileSwapTxHash,
                  payoutTxHash: st.payoutTxHash,
                  settledAt: st.settledAt,
                }
              : null,
          };
        });

      const pendingCount = subs.filter((s) => s.status === "PENDING_REVIEW").length;
      const completedCount = subs.filter((s) => s.status === "COMPLETED").length;
      const campVouchers = ownedVouchers.filter((v) => v.campaignId === row.id);
      let verifiedGmvLocal = 0;
      let issuedGmvLocal = 0;
      for (const v of campVouchers) {
        const n = v.orderValueLocal ? Number(v.orderValueLocal) : 0;
        const safeN = Number.isFinite(n) && n > 0 ? n : 0;
        if (v.status === "CLAIMED") {
          verifiedGmvLocal += safeN;
          issuedGmvLocal += safeN;
        } else if (v.status === "ACTIVE" || v.status === "CLAIMING") {
          issuedGmvLocal += safeN;
        }
      }

      return {
        id: row.id,
        slug: row.slug,
        shortUrl: `/c/${row.slug}`,
        partnerName: row.partnerName,
        title: row.title,
        description: row.description,
        criteria: row.criteria,
        corridor,
        fiatCode: CORRIDORS[corridor].fiatCode,
        visibility: row.visibility,
        verificationMode: row.verificationMode,
        requiresInviteCode: Boolean(row.inviteCodeHash),
        endsAt: row.endsAt,
        isExpired: row.isExpired,
        active: row.active,
        onchainActive: onchainMap.get(row.id.toLowerCase())?.active ?? row.active,
        onchainSynced: row.onchainSynced,
        budgetUsdtAtomic: row.budgetUsdtAtomic,
        remainingUsdtAtomic: row.remainingUsdtAtomic,
        budgetUsdtFormatted: formatTokenAmount(row.budgetUsdtAtomic, "USDT", 2),
        remainingUsdtFormatted: formatTokenAmount(row.remainingUsdtAtomic, "USDT", 2),
        rewardLocalFormatted: stage1 ? formatTokenAmount(stage1.rewardLocalAtomic, corridor, 2) : "0",
        spotsRemaining,
        pendingCount,
        completedCount,
        verifiedGmvLocal,
        issuedGmvLocal,
        vouchers: campVouchers,
        createdAt: row.createdAt,
        submissions: subs,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Any funded onchain campaign created by this wallet that never finished saving metadata to DB
  const unregisteredOnchainCampaigns = onchainOwned
    .filter((c) => !allOwnedDbIdSet.has(c.campaignId.toLowerCase()) && c.state.creator.toLowerCase() === walletLower)
    .map((c) => ({
      campaignId: c.campaignId,
      txHash: c.txHash,
      budgetUsdtFormatted: formatTokenAmount(c.state.budgetUsdtAtomic, "USDT", 2),
      remainingUsdtAtomic: c.state.remainingBudgetUsdtAtomic,
      remainingUsdtFormatted: formatTokenAmount(c.state.remainingBudgetUsdtAtomic, "USDT", 2),
      active: c.state.active,
    }));

  // 2. Contributor's own submission history across ALL campaigns
  const subCampIds = Array.from(new Set(mySubRows.map((s) => s.campaignId)));
  const [subCampaigns, mySettlements] = await Promise.all([
    subCampIds.length > 0
      ? db.select().from(schema.campaigns).where(inArray(schema.campaigns.id, subCampIds))
      : Promise.resolve([]),
    mySubRows.length > 0
      ? db
          .select()
          .from(schema.settlements)
          .where(inArray(schema.settlements.submissionId, mySubRows.map((s) => s.id)))
      : Promise.resolve([]),
  ]);

  const campById = new Map(subCampaigns.map((c) => [c.id, c]));
  const mySettlementBySubId = new Map(mySettlements.map((s) => [s.submissionId, s]));

  const mySubmissions = mySubRows.map((s) => {
    const camp = campById.get(s.campaignId);
    const st = mySettlementBySubId.get(s.id);
    const corridor = (camp?.corridor ?? "cNGN") as CorridorSymbol;
    return {
      id: s.id,
      campaignSlug: camp?.slug ?? "",
      campaignTitle: camp?.title ?? "Campaign",
      partnerName: camp?.partnerName ?? "Vire",
      corridor,
      deliverableUrl: s.deliverableUrl,
      status: s.status,
      reviewNote: s.reviewNote,
      aiReason: s.aiReason,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      settlement: st
        ? {
            localAmountFormatted: formatTokenAmount(st.localAmountAtomic, corridor, 2),
            payoutTxHash: st.payoutTxHash,
            settledAt: st.settledAt,
          }
        : null,
    };
  });

  return NextResponse.json({
    authenticated: true,
    wallet: walletChecksum,
    vaultAddress: getVaultAddress(),
    ownedCampaigns,
    unregisteredOnchainCampaigns,
    mySubmissions,
  });
}
