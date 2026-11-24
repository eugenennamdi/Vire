import {
  CORRIDORS,
  formatTokenAmount,
  toPlainDecimalAmount,
  type CampaignStage,
  type CorridorSymbol,
} from "@vire/shared";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";
import { getLiveCorridors } from "@/lib/corridors-live";
import { getOnchainCampaignStates, mergeCampaignWithOnchain } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDatabaseReady();
  await ensureDefaultCampaignsSeeded();

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaigns)
    .orderBy(desc(schema.campaigns.isLaunchPartner), desc(schema.campaigns.createdAt));

  const [onchainMap, liveCorridors] = await Promise.all([
    getOnchainCampaignStates(rows.map((r) => r.id as Hex)),
    getLiveCorridors().catch(() => ({ asOf: new Date().toISOString(), corridors: [] })),
  ]);

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
    // Include 1.5% slippage buffer so spotsRemaining matches what the Policy Gate will actually approve
    const usdtPerPayout = rate > 0 && rewardLocalFloat > 0 ? (rewardLocalFloat / rate) * 1.015 : 0;
    const remainingUsdtFloat = Number(toPlainDecimalAmount(row.remainingUsdtAtomic, "USDT"));
    const spotsRemaining =
      row.active && usdtPerPayout > 0 ? Math.max(0, Math.floor(remainingUsdtFloat / usdtPerPayout)) : 0;

    return {
      ...row,
      corridorMeta: CORRIDORS[corridor],
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
