import { CORRIDORS, formatTokenAmount, type CampaignStage, type CorridorSymbol } from "@vire/shared";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDatabaseReady();
  await ensureDefaultCampaignsSeeded();

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaigns)
    .orderBy(desc(schema.campaigns.isLaunchPartner), desc(schema.campaigns.createdAt));

  const campaigns = rows.map((row) => {
    const corridor = row.corridor as CorridorSymbol;
    const stages = JSON.parse(row.stagesJson) as CampaignStage[];
    return {
      ...row,
      corridorMeta: CORRIDORS[corridor],
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
