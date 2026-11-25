import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import {
  celoscanTxUrl,
  CORRIDORS,
  DEFAULT_ATTRIBUTION_CODE,
  formatTokenAmount,
  type CampaignStage,
  type CorridorSymbol,
} from "@vire/shared";
import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import type { Hex } from "viem";
import { ClearingInspector, type InspectorCampaign } from "@/components/clearing-inspector";
import { HeroHyperboloid } from "@/components/hero-hyperboloid";
import { ProtocolProofBlock } from "@/components/protocol-proof-block";
import { buttonVariants } from "@/components/ui/button";
import { TokenIcon } from "@/components/ui/token-icon";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";
import { getLiveCorridors } from "@/lib/corridors-live";
import { getOnchainCampaignStates, mergeCampaignWithOnchain } from "@/lib/runtime";
import { truncateMiddle } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await ensureDatabaseReady();
  await ensureDefaultCampaignsSeeded();

  const db = getDb();
  const attributionCode = process.env.VIRE_ATTRIBUTION_CODE || DEFAULT_ATTRIBUTION_CODE;

  const [liveCorridors, rawCampaignRows, settlements] = await Promise.all([
    getLiveCorridors().catch(() => ({ asOf: new Date().toISOString(), corridors: [] })),
    db
      .select()
      .from(schema.campaigns)
      .where(and(eq(schema.campaigns.visibility, "public"), eq(schema.campaigns.hidden, false)))
      .orderBy(desc(schema.campaigns.isLaunchPartner), desc(schema.campaigns.createdAt)),
    db.select().from(schema.settlements).orderBy(desc(schema.settlements.settledAt)),
  ]);

  const onchainMap = await getOnchainCampaignStates(rawCampaignRows.map((r) => r.id as Hex));
  const campaignRows = rawCampaignRows.map((r) => mergeCampaignWithOnchain(r, onchainMap));

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
          ? "MiniPay Bank Transfer (via USDT) · Celo Exchanges"
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
    <div className="space-y-12 sm:space-y-16">
      {/* BAND 1: Morpho-Inspired Architectural Monochrome Hero */}
      <section className="vire-enter vire-card vire-blueprint relative flex min-h-[360px] flex-col justify-center overflow-hidden rounded-2xl px-5 py-7 sm:min-h-[410px] sm:px-10 sm:py-12 lg:min-h-[456px] lg:px-14 lg:py-14">
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

        <div className="relative z-10 grid gap-8 sm:gap-10 lg:grid-cols-12 lg:items-end">
          {/* Left: Ultra-light Editorial Display + Button-in-Button CTA */}
          <div className="min-w-0 lg:col-span-7">
            <div className="font-mono text-[11.5px] tracking-[0.02em] text-[#6E6E78] sm:text-[12px]">
              Automated Local Payouts
            </div>

            <h1 className="mt-4 max-w-[15ch] text-[32px] font-light leading-[1.06] tracking-[-0.04em] text-[#0A0A0C] sm:mt-5 sm:text-[48px] sm:leading-[1.04] lg:text-[54px]">
              Pay verified work in exact local currency.
            </h1>

            <p className="mt-4 max-w-[44ch] text-[14.5px] leading-[1.6] text-[#5C5C66] sm:mt-5 sm:text-[15px]">
              Automatically verify completed work, enforce onchain spending limits, and send exact
              payouts in local currencies.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2.5 sm:mt-8 sm:gap-3">
              <Link
                href="/claim"
                className="group vire-pressable inline-flex h-11 items-center gap-3 rounded-full bg-[#0A0A0C] pl-5 pr-1.5 text-[14px] font-medium text-white shadow-[0_1px_2px_rgba(10,10,12,0.16)] hover:bg-[#19191F]"
              >
                <span>Submit work</span>
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

          {/* Right: Floating Swiss Institutional Readouts (Compact 2-col row on mobile/tablet, right-aligned stack on desktop) */}
          <div className="grid grid-cols-2 gap-4 border-t border-black/[0.06] pt-6 sm:gap-7 sm:pt-7 lg:col-span-5 lg:flex lg:flex-col lg:items-end lg:border-t-0 lg:pb-1 lg:pt-0 lg:text-right">
            <div className="flex min-w-0 flex-col lg:items-end">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#7A7A86] sm:text-[11px] sm:tracking-[0.12em]">
                Available FX Liquidity
              </div>
              <div className="mt-1.5 text-[28px] font-light leading-none tracking-[-0.035em] text-[#0A0A0C] tabular-nums sm:text-[38px] lg:text-[42px]">
                {fxDepthFormatted}
              </div>
            </div>

            <div className="flex min-w-0 flex-col lg:items-end">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#7A7A86] sm:text-[11px] sm:tracking-[0.12em]">
                Active Payout Pool
              </div>
              <div className="mt-1.5 flex items-center gap-2 sm:mt-2 sm:gap-2.5 lg:justify-end">
                <TokenIcon symbol={featuredCorridor} size={22} />
                <div className="inline-flex items-baseline gap-1 sm:gap-1.5">
                  <span className="text-[26px] font-light leading-none tracking-[-0.035em] text-[#0A0A0C] tabular-nums sm:text-[36px] lg:text-[40px]">
                    {activePoolLocalFormatted}
                  </span>
                  <span className="font-mono text-[12px] font-medium text-[#6E6E78] sm:text-[13px]">
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
                Recent payouts
              </h2>
              <p className="mt-0.5 text-[13.5px] text-[#71717A]">
                Latest verified payouts sent on Celo Mainnet.
              </p>
            </div>
            <Link href="/ledger" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Public ledger
            </Link>
          </div>

          <div className="vire-card overflow-hidden rounded-2xl">
            {/* Mobile native statement cards (zero horizontal scroll) */}
            <div className="divide-y divide-black/[0.06] md:hidden">
              {recentSettlements.map((s) => (
                <div key={s.id} className="space-y-2.5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 font-mono text-[14px] font-medium text-[#0A0A0C] tabular-nums">
                      <TokenIcon symbol={s.corridor} size={20} />
                      {formatTokenAmount(s.localAmountAtomic, s.corridor as CorridorSymbol, 2)}{" "}
                      {s.corridor}
                    </span>
                    <a
                      href={celoscanTxUrl(s.textileSwapTxHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="vire-pill-surface inline-flex h-8 items-center gap-1 rounded-full px-3 font-mono text-[11.5px] font-medium text-[#0A0A0C]"
                    >
                      Celoscan <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11.5px] text-[#71717A]">
                    <span>{truncateMiddle(s.recipientWallet, 8, 6)}</span>
                    <span className="tabular-nums">{new Date(s.settledAt).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Tablet & Desktop institutional table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-black/[0.06] bg-[#FAFAFB] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#71717A]">
                  <tr>
                    <th className="px-5 py-3">Time</th>
                    <th className="px-5 py-3">Currency</th>
                    <th className="px-5 py-3">Recipient</th>
                    <th className="px-5 py-3 text-right">Amount Paid</th>
                    <th className="px-5 py-3 text-right">Receipt</th>
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
