import { CORRIDORS, formatTokenAmount, type CampaignStage, type CorridorSymbol } from "@vire/shared";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";
import { getOnchainCampaignStates, mergeCampaignWithOnchain } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
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

  const onchainMap = await getOnchainCampaignStates([rawRow.id as Hex]);
  const row = mergeCampaignWithOnchain(rawRow, onchainMap);
  const corridor = row.corridor as CorridorSymbol;
  const stages = JSON.parse(row.stagesJson) as CampaignStage[];

  return NextResponse.json({
    campaign: {
      ...row,
      corridorMeta: CORRIDORS[corridor],
      stages: stages.map((st) => ({
        ...st,
        rewardLocalFormatted: formatTokenAmount(st.rewardLocalAtomic, corridor, 2),
      })),
      budgetUsdtFormatted: formatTokenAmount(row.budgetUsdtAtomic, "USDT", 2),
      remainingUsdtFormatted: formatTokenAmount(row.remainingUsdtAtomic, "USDT", 2),
    },
  });
}
