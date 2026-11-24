import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import {
  celoscanTxUrl,
  CORRIDORS,
  DEFAULT_ATTRIBUTION_CODE,
  formatTokenAmount,
  type CampaignStage,
  type CorridorSymbol,
} from "@vire/shared";
import { desc } from "drizzle-orm";
import Link from "next/link";
import { ClearingInspector, type InspectorCampaign } from "@/components/clearing-inspector";
import { HeroHyperboloid } from "@/components/hero-hyperboloid";
import { ProtocolProofBlock } from "@/components/protocol-proof-block";
import { buttonVariants } from "@/components/ui/button";
import { TokenIcon } from "@/components/ui/token-icon";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";
import { getLiveCorridors } from "@/lib/corridors-live";
import { truncateMiddle } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await ensureDatabaseReady();
  await ensureDefaultCampaignsSeeded();

  const db = getDb();
  const attributionCode = process.env.VIRE_ATTRIBUTION_CODE || DEFAULT_ATTRIBUTION_CODE;

  const [liveCorridors, campaignRows, settlements] = await Promise.all([
    getLiveCorridors().catch(() => ({ asOf: new Date().toISOString(), corridors: [] })),
    db
      .select()
      .from(schema.campaigns)
      .orderBy(desc(schema.campaigns.isLaunchPartner), desc(schema.campaigns.createdAt)),
    db.select().from(schema.settlements).orderBy(desc(schema.settlements.settledAt)),
  ]);

  const inspectorCampaigns: InspectorCampaign[] = campaignRows.map((row) => {
    const corridor = row.corridor as CorridorSymbol;
    const stages = JSON.parse(row.stagesJson) as CampaignStage[];
    const stage1 = stages[0];
    const meta = CORRIDORS[corridor];
    return {
      id: row.id,
      slug: row.slug,
      partnerName: row.partnerName,
      partnerLocation: row.partnerLocation,
      title: row.title,
      deliverableType: row.deliverableType,
      corridor: row.corridor,
      localTokenDecimals: row.localTokenDecimals,
      stage1Title: stage1?.title ?? "Stage 1",
      stage1Instructions: stage1?.instructions ?? row.description,
      stage1RewardFormatted: stage1
        ? formatTokenAmount(stage1.rewardLocalAtomic, corridor, 2)
        : "0",
      budgetUsdtFormatted: formatTokenAmount(row.budgetUsdtAtomic, "USDT", 2),
      remainingUsdtFormatted: formatTokenAmount(row.remainingUsdtAtomic, "USDT", 2),
      maxPerPayoutUsdtFormatted: formatTokenAmount(row.maxPerPayoutUsdtAtomic, "USDT", 2),
      dailyLimitUsdtFormatted: formatTokenAmount(row.dailyLimitUsdtAtomic, "USDT", 2),
      maxSpreadBps: row.maxSpreadBps,
      minPassScore: row.minPassScore,
      offrampRail:
        meta?.offrampProvider === "cngn_venues"
          ? "Busha · Quidax · Yellow Card"
          : meta?.offrampProvider === "idrx_guide"
            ? "IDRX Bank Redeem (IDR)"
            : "Ripio Portal (CBU / PIX / CLABE)",
    };
  });

  const recentSettlements = settlements.slice(0, 4);

  // Live aggregate Textile FX maker depth across active Celo Mainnet corridors
  const totalFxDepthUsd = liveCorridors.corridors.reduce((acc, c) => {
    if (!c.maxSellUsdtFormatted) return acc;
    const parsed = Number(c.maxSellUsdtFormatted.replace(/,/g, ""));
    return Number.isFinite(parsed) ? acc + parsed : acc;
  }, 0);
  const fxDepthFormatted =
    totalFxDepthUsd > 0 ? `$${Math.round(totalFxDepthUsd).toLocaleString("en-US")}` : "—";

  // Active payout pool for the primary featured campaign in exact local token units
  const featuredCampaign = campaignRows.find((r) => r.isLaunchPartner) ?? campaignRows[0];
  const featuredCorridor = (featuredCampaign?.corridor as CorridorSymbol | undefined) ?? "cNGN";
  const featuredLive = liveCorridors.corridors.find((c) => c.corridor === featuredCorridor);
  const featuredRemainingUsdt = featuredCampaign
    ? Number(formatTokenAmount(featuredCampaign.remainingUsdtAtomic, "USDT", 2).replace(/,/g, ""))
    : 35;
  const activePoolLocalFormatted =
    featuredLive?.impliedRateLocalPerUsdt && Number.isFinite(featuredRemainingUsdt)
      ? Math.round(featuredRemainingUsdt * featuredLive.impliedRateLocalPerUsdt).toLocaleString(
          "en-US"
        )
      : "50,000";

  return (
    <div className="space-y-16">
      {/* BAND 1: Morpho-Inspired Architectural Monochrome Hero */}
      <section className="vire-enter vire-card vire-blueprint relative flex min-h-[410px] flex-col justify-center overflow-hidden rounded-2xl px-7 py-10 sm:px-10 sm:py-12 lg:min-h-[456px] lg:px-14 lg:py-14">
        {/* Real-time 2x Retina 3D Ruled Hyperboloid Clearing Sculpture */}
        <HeroHyperboloid />

        {/* Soft radial luminance veil preserving effortless contrast behind left display copy */}
        <div aria-hidden="true" className="vire-hero-veil pointer-events-none absolute inset-0" />

        {/* Precision Swiss Corner Registration Ticks */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-3.5 h-2.5 w-2.5 border-l border-t border-black/[0.22]"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3.5 top-3.5 h-2.5 w-2.5 border-r border-t border-black/[0.22]"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-3.5 left-3.5 h-2.5 w-2.5 border-b border-l border-black/[0.22]"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-3.5 right-3.5 h-2.5 w-2.5 border-b border-r border-black/[0.22]"
        />

        <div className="relative z-10 grid gap-10 lg:grid-cols-12 lg:items-end">
          {/* Left: Ultra-light Editorial Display + Button-in-Button CTA */}
          <div className="min-w-0 lg:col-span-7">
            <div className="font-mono text-[12px] tracking-[0.02em] text-[#6E6E78]">
              Autonomous FX Clearing
            </div>

            <h1 className="mt-5 max-w-[15ch] text-[36px] font-light leading-[1.04] tracking-[-0.04em] text-[#0A0A0C] sm:text-[48px] lg:text-[54px]">
              Pay verified work in exact local currency.
            </h1>

            <p className="mt-5 max-w-[45ch] text-[15px] leading-[1.6] text-[#5C5C66]">
              Verify off-chain deliverables autonomously, enforce onchain vault limits, and settle
              exact local stablecoins over Textile FX.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/claim"
                className="group vire-pressable inline-flex h-11 items-center gap-3 rounded-full bg-[#0A0A0C] pl-5 pr-1.5 text-[14px] font-medium text-white shadow-[0_1px_2px_rgba(10,10,12,0.16)] hover:bg-[#19191F]"
              >
                <span>Submit deliverable</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.14] transition-[transform,background-color] duration-200 ease-[var(--ease-out)] group-hover:translate-x-0.5 group-hover:bg-white/[0.2]">
                  <ArrowRight weight="bold" className="h-3.5 w-3.5" />
                </span>
              </Link>
              <Link
                href="/campaigns"
                className={`${buttonVariants({ variant: "secondary", size: "lg" })} h-11 bg-white/85 px-5 backdrop-blur-[2px]`}
              >
                Explore campaigns
              </Link>
            </div>
          </div>

          {/* Right: Floating Swiss Institutional Readouts (Zero Cards, Pure Type) */}
          <div className="flex flex-col gap-7 border-t border-black/[0.06] pt-7 lg:col-span-5 lg:items-end lg:border-t-0 lg:pb-1 lg:pt-0 lg:text-right">
            <div className="flex flex-col lg:items-end">
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#7A7A86]">
                Live Textile FX Depth
              </div>
              <div className="mt-1.5 text-[36px] font-light leading-none tracking-[-0.035em] text-[#0A0A0C] tabular-nums sm:text-[42px]">
                {fxDepthFormatted}
              </div>
            </div>

            <div className="flex flex-col lg:items-end">
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#7A7A86]">
                Active Payout Pool
              </div>
              <div className="mt-2 flex items-center gap-2.5 lg:justify-end">
                <TokenIcon symbol={featuredCorridor} size={24} />
                <div className="inline-flex items-baseline gap-1.5">
                  <span className="text-[34px] font-light leading-none tracking-[-0.035em] text-[#0A0A0C] tabular-nums sm:text-[40px]">
                    {activePoolLocalFormatted}
                  </span>
                  <span className="font-mono text-[13px] font-medium text-[#6E6E78]">
                    {featuredCorridor}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BAND 2 & 3: Interactive Clearing Flow + Aave Pro Live Corridors Table */}
      <ClearingInspector campaigns={inspectorCampaigns} attributionCode={attributionCode} />

      {/* BAND 4: Morpho-Inspired Verifiable Code & Trust Architecture */}
      <ProtocolProofBlock />

      {/* BAND 5: Recent Onchain Settlements (Shown cleanly once live settlements exist) */}
      {recentSettlements.length > 0 && (
        <section aria-labelledby="recent-settlements-heading" className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2
                id="recent-settlements-heading"
                className="text-[22px] font-medium tracking-[-0.03em] text-[#0A0A0C]"
              >
                Recent settlements
              </h2>
              <p className="mt-0.5 text-[13.5px] text-[#71717A]">
                Latest verified payouts cleared on Celo Mainnet.
              </p>
            </div>
            <Link href="/ledger" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Full audit ledger
            </Link>
          </div>

          <div className="vire-card overflow-hidden rounded-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-black/[0.06] bg-[#FAFAFB] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#71717A]">
                  <tr>
                    <th className="px-5 py-3">Timestamp</th>
                    <th className="px-5 py-3">Corridor</th>
                    <th className="px-5 py-3">Recipient</th>
                    <th className="px-5 py-3 text-right">Exact Output</th>
                    <th className="px-5 py-3 text-right">Proof</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.055]">
                  {recentSettlements.map((s) => (
                    <tr key={s.id} className="hover:bg-[#FAFAFB]">
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[12px] text-[#71717A] tabular-nums">
                        {new Date(s.settledAt).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <span className="inline-flex items-center gap-2 font-medium text-[#0A0A0C]">
                          <TokenIcon symbol={s.corridor} size={20} />
                          {s.corridor}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[12px] text-[#52525B]">
                        {truncateMiddle(s.recipientWallet, 8, 6)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right font-mono font-medium text-[#0A0A0C] tabular-nums">
                        {formatTokenAmount(s.localAmountAtomic, s.corridor as CorridorSymbol, 2)}{" "}
                        {s.corridor}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right">
                        <a
                          href={celoscanTxUrl(s.textileSwapTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[12px] text-[#0A0A0C] hover:underline"
                        >
                          Celoscan <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
