import {
  celoscanTxUrl,
  formatTokenAmount,
  type CorridorSymbol,
  type TokenSymbol,
} from "@vire/shared";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureDatabaseReady();
  await ensureDefaultCampaignsSeeded();

  const corridorFilter = req.nextUrl.searchParams.get("corridor")?.trim() || null;
  const db = getDb();

  const [allSettlements, allSubmissions, allBuyPayments, allX402Inflows, allCampaigns] = await Promise.all([
    db.select().from(schema.settlements).orderBy(desc(schema.settlements.settledAt)),
    db.select().from(schema.submissions).orderBy(desc(schema.submissions.createdAt)),
    db.select().from(schema.buyPayments).orderBy(desc(schema.buyPayments.createdAt)),
    db.select().from(schema.x402Inflows).orderBy(desc(schema.x402Inflows.createdAt)),
    db.select().from(schema.campaigns),
  ]);

  const campaignById = new Map(allCampaigns.map((c) => [c.id, c]));
  const buyBySubmission = new Map<string, (typeof allBuyPayments)[number]>();
  for (const bp of allBuyPayments) {
    if (bp.submissionId && !buyBySubmission.has(bp.submissionId)) {
      buyBySubmission.set(bp.submissionId, bp);
    }
  }

  // Metrics across real mainnet activity
  const recipientCounts = new Map<string, number>();
  const corridorsCleared = new Set<string>();
  let totalUsdtSettledAtomic = 0n;

  for (const s of allSettlements) {
    const w = s.recipientWallet.toLowerCase();
    recipientCounts.set(w, (recipientCounts.get(w) ?? 0) + 1);
    corridorsCleared.add(s.corridor);
    totalUsdtSettledAtomic += BigInt(s.usdtSpentAtomic);
  }

  const repeatContributorsCount = Array.from(recipientCounts.values()).filter((c) => c >= 2).length;
  const rejectedSubmissions = allSubmissions.filter((s) => s.status === "REJECTED");

  const filteredSettlements = corridorFilter
    ? allSettlements.filter((s) => s.corridor === corridorFilter)
    : allSettlements;

  const completedRows = filteredSettlements.map((s) => {
    const camp = campaignById.get(s.campaignId);
    const isPrivate = camp?.visibility === "unlisted";
    const buyRow = buyBySubmission.get(s.submissionId);
    const corridor = s.corridor as CorridorSymbol;
    return {
      id: s.id,
      submissionId: s.submissionId,
      campaignTitle: isPrivate ? "Private Campaign" : (camp?.title ?? s.campaignId),
      partnerName: isPrivate ? "Private Host" : (camp?.partnerName ?? "Vire"),
      recipientWallet: s.recipientWallet,
      corridor,
      localAmountAtomic: s.localAmountAtomic,
      localAmountFormatted: formatTokenAmount(s.localAmountAtomic, corridor, 2),
      usdtSpentAtomic: s.usdtSpentAtomic,
      usdtSpentFormatted: formatTokenAmount(s.usdtSpentAtomic, "USDT", 4),
      usdtRefundedFormatted: formatTokenAmount(s.usdtRefundedAtomic, "USDT", 4),
      vaultReleaseTxHash: s.vaultReleaseTxHash,
      vaultReleaseUrl: celoscanTxUrl(s.vaultReleaseTxHash),
      textileSwapTxHash: s.textileSwapTxHash,
      textileSwapUrl: celoscanTxUrl(s.textileSwapTxHash),
      payoutTxHash: s.payoutTxHash,
      payoutUrl: celoscanTxUrl(s.payoutTxHash),
      receiptTxHash: s.receiptTxHash,
      receiptUrl: celoscanTxUrl(s.receiptTxHash),
      buyPaymentTxHash: buyRow?.paymentTxHash ?? null,
      buyPaymentUrl: buyRow?.paymentTxHash ? celoscanTxUrl(buyRow.paymentTxHash) : null,
      offrampUrl: s.offrampUrl,
      erc8004Rated: s.erc8004Rated,
      erc8004FeedbackTxHash: s.erc8004FeedbackTxHash,
      settledAt: s.settledAt,
    };
  });

  const rejectedRows = rejectedSubmissions
    .filter((sub) => {
      if (!corridorFilter) return true;
      return campaignById.get(sub.campaignId)?.corridor === corridorFilter;
    })
    .map((sub) => {
      const camp = campaignById.get(sub.campaignId);
      const isPrivate = camp?.visibility === "unlisted";
      const buyRow = buyBySubmission.get(sub.id);
      return {
        id: sub.id,
        campaignTitle: isPrivate ? "Private Campaign" : (camp?.title ?? sub.campaignId),
        corridor: camp?.corridor ?? "unknown",
        contributorWallet: sub.contributorWallet,
        deliverableUrl: isPrivate ? null : sub.deliverableUrl,
        failedPolicyRule: sub.failedPolicyRule,
        aiVerdict: sub.aiVerdict,
        aiScore: sub.aiScore,
        aiReason: isPrivate ? "Blocked (private campaign details redacted)." : sub.aiReason,
        policyDetails: isPrivate ? [] : (sub.policyDetailsJson ? JSON.parse(sub.policyDetailsJson) : []),
        buyPaymentTxHash: buyRow?.paymentTxHash ?? null,
        createdAt: sub.createdAt,
      };
    });

  const paidBuyCalls = allBuyPayments.map((bp) => ({
    id: bp.id,
    submissionId: bp.submissionId,
    capabilityId: bp.capabilityId,
    endpointUrl: bp.endpointUrl,
    paymentToken: bp.paymentToken,
    paymentAmountFormatted: formatTokenAmount(
      bp.paymentAmountAtomic,
      (bp.paymentToken === "USDC" ? "USDC" : "USDT") as TokenSymbol,
      4
    ),
    paymentTxHash: bp.paymentTxHash,
    txUrl: bp.paymentTxHash ? celoscanTxUrl(bp.paymentTxHash) : null,
    dryRun: bp.dryRun,
    createdAt: bp.createdAt,
  }));

  const x402Rows = allX402Inflows.map((x) => ({
    id: x.id,
    endpoint: x.endpoint,
    payerWallet: x.payerWallet,
    payToWallet: x.payToWallet,
    assetSymbol: x.assetSymbol,
    amountAtomic: x.amountAtomic,
    settlementTxHash: x.settlementTxHash,
    txUrl: celoscanTxUrl(x.settlementTxHash),
    blockNumber: x.blockNumber,
    createdAt: x.createdAt,
  }));

  return NextResponse.json({
    metrics: {
      totalCompletedSettlements: allSettlements.length,
      totalExternalRecipients: recipientCounts.size,
      repeatContributorsCount,
      corridorsClearedCount: corridorsCleared.size,
      corridorsCleared: Array.from(corridorsCleared),
      totalUsdtSettledFormatted: formatTokenAmount(totalUsdtSettledAtomic, "USDT", 2),
      totalRejectedClaims: rejectedSubmissions.length,
      totalPaidBuyCalls: allBuyPayments.filter((b) => !b.dryRun && b.paymentTxHash).length,
      totalBuyCallsRecorded: allBuyPayments.length,
      totalX402Inflows: allX402Inflows.length,
    },
    completedSettlements: completedRows,
    rejectedClaims: rejectedRows,
    buyPayments: paidBuyCalls,
    x402Inflows: x402Rows,
  });
}
