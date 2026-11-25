import {
  CORRIDORS,
  formatTokenAmount,
  toPlainDecimalAmount,
  type CampaignStage,
  type CorridorSymbol,
} from "@vire/shared";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Hex } from "viem";
import { ClaimPageClient } from "@/components/claim-page-client";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";
import { getLiveCorridors } from "@/lib/corridors-live";
import { getOnchainCampaignStates, mergeCampaignWithOnchain } from "@/lib/runtime";

export const dynamic = "force-dynamic";

async function loadCampaignForMeta(slug: string) {
  await ensureDatabaseReady();
  await ensureDefaultCampaignsSeeded();
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.slug, slug))
    .limit(1);
  const rawRow = rows[0];
  if (!rawRow || rawRow.hidden) return null;

  const [onchainMap, liveCorridors] = await Promise.all([
    getOnchainCampaignStates([rawRow.id as Hex]),
    getLiveCorridors().catch(() => ({ asOf: "", corridors: [] })),
  ]);
  const row = mergeCampaignWithOnchain(rawRow, onchainMap);
  const corridor = row.corridor as CorridorSymbol;
  const stages = JSON.parse(row.stagesJson) as CampaignStage[];
  const stage1 = stages[0];
  const rewardFormatted = stage1 ? formatTokenAmount(stage1.rewardLocalAtomic, corridor, 2) : "0";
  const rate =
    liveCorridors.corridors.find((c) => c.corridor === corridor)?.impliedRateLocalPerUsdt ??
    CORRIDORS[corridor].typicalFiatPerUsd;
  const rewardFloat = stage1 ? Number(toPlainDecimalAmount(stage1.rewardLocalAtomic, corridor)) : 0;
  const remFloat = Number(toPlainDecimalAmount(row.remainingUsdtAtomic, "USDT"));
  const spotsRemaining =
    row.active && rate > 0 && rewardFloat > 0
      ? Math.max(0, Math.floor(remFloat / ((rewardFloat / rate) * 1.015)))
      : 0;

  return { row, corridor, rewardFormatted, spotsRemaining };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadCampaignForMeta(slug);
  if (!data) {
    return { title: "Campaign not found | Vire" };
  }

  const { row, corridor, rewardFormatted, spotsRemaining } = data;
  const title = `Earn ${rewardFormatted} ${corridor} · ${row.title}`;
  const spotsLabel = row.isExpired
    ? "Campaign ended"
    : spotsRemaining > 0
      ? `${spotsRemaining} ${spotsRemaining === 1 ? "spot" : "spots"} left`
      : "Pool currently full";
  const modeLabel = row.verificationMode === "manual" ? "Owner-reviewed" : "Instant payout";
  const description = `${spotsLabel} · ${modeLabel} in exact ${corridor} (${CORRIDORS[corridor].fiatCode}) on Celo · Hosted by ${row.partnerName} on Vire.`;

  return {
    title,
    description,
    robots: row.visibility === "unlisted" ? { index: false, follow: false } : undefined,
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ShortCampaignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await ensureDatabaseReady();
  await ensureDefaultCampaignsSeeded();
  const db = getDb();
  const exists = await db
    .select({ id: schema.campaigns.id, hidden: schema.campaigns.hidden })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.slug, slug))
    .limit(1);

  if (!exists[0] || exists[0].hidden) {
    notFound();
  }

  return <ClaimPageClient forcedSlug={slug} />;
}
