"use client";

import { ArrowClockwise, ArrowRight, ArrowUpRight, Check, Copy } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import type { CorridorLiveStatus } from "@vire/shared";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface TerminalStage {
  stageIndex: number;
  title: string;
  instructions: string;
  rewardLocalAtomic: string;
  rewardLocalFormatted: string;
  cooldownHours: number;
}

export interface TerminalCampaign {
  id: string;
  slug: string;
  partnerName: string;
  partnerLocation: string;
  isLaunchPartner: boolean;
  title: string;
  description: string;
  deliverableType: string;
  corridor: string;
  localTokenDecimals: number;
  stages: TerminalStage[];
  budgetUsdtFormatted: string;
  remainingUsdtFormatted: string;
  maxPerPayoutUsdtFormatted: string;
  dailyLimitUsdtFormatted: string;
  maxSpreadBps: number;
  minPassScore: number;
  offrampRail: string;
}

const CORRIDOR_ORDER = ["cNGN", "wARS", "wBRL", "IDRX", "wMXN"] as const;

const CURRENCY_GLYPHS: Record<string, string> = {
  cNGN: "₦",
  wARS: "AR$",
  wBRL: "R$",
  IDRX: "Rp",
  wMXN: "MX$",
};

function parseNumeric(formatted: string | null | undefined): number {
  if (!formatted) return 0;
  const n = Number(formatted.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatCompactUsd(amount: number): string {
  if (amount <= 0) return "$0";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}k`;
  return `$${Math.round(amount)}`;
}

export function ClearingTerminal({
  initialCampaigns,
}: {
  initialCampaigns: TerminalCampaign[];
}) {
  const [view, setView] = useState<"corridors" | "campaigns">("corridors");
  const [selectedCorridor, setSelectedCorridor] = useState<string>(
    initialCampaigns[0]?.corridor ?? "cNGN"
  );
  const [selectedStageIndex, setSelectedStageIndex] = useState<number>(1);
  const [copiedProbe, setCopiedProbe] = useState(false);

  const { data: liveData, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["live-corridors"],
    queryFn: async () => {
      const res = await fetch("/api/corridors/live");
      if (!res.ok) throw new Error("Unable to load Textile FX corridors");
      return (await res.json()) as { asOf: string; corridors: CorridorLiveStatus[] };
    },
    refetchInterval: 20_000,
  });

  const liveMap = useMemo(() => {
    const map = new Map<string, CorridorLiveStatus>();
    for (const c of liveData?.corridors ?? []) {
      map.set(c.corridor, c);
    }
    return map;
  }, [liveData]);

  const orderedCampaigns = useMemo(() => {
    return [...initialCampaigns].sort((a, b) => {
      const ia = CORRIDOR_ORDER.indexOf(a.corridor as (typeof CORRIDOR_ORDER)[number]);
      const ib = CORRIDOR_ORDER.indexOf(b.corridor as (typeof CORRIDOR_ORDER)[number]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [initialCampaigns]);

  const activeCampaign =
    orderedCampaigns.find((c) => c.corridor === selectedCorridor) ?? orderedCampaigns[0];
  const activeStage =
    activeCampaign?.stages.find((s) => s.stageIndex === selectedStageIndex) ??
    activeCampaign?.stages[0];
  const activeLive = activeCampaign ? liveMap.get(activeCampaign.corridor) : undefined;

  const isSelectedLive = activeLive?.status === "live";
  const localAmountNum = parseNumeric(activeStage?.rewardLocalFormatted);
  const impliedUsdtEstimate =
    activeLive?.impliedRateLocalPerUsdt && activeLive.impliedRateLocalPerUsdt > 0 && localAmountNum > 0
      ? localAmountNum / activeLive.impliedRateLocalPerUsdt
      : null;

  const depthNum = parseNumeric(activeLive?.maxSellUsdtFormatted);
  const depthCoveragePct =
    isSelectedLive && depthNum > 0 && impliedUsdtEstimate
      ? Math.min(100, Math.max(6, Math.round((impliedUsdtEstimate / Math.min(depthNum, 2500)) * 100)))
      : 0;

  async function handleCopyX402Probe() {
    if (!activeCampaign || !activeStage) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "https://usevire.xyz";
    const cmd = `curl -i -X POST ${origin}/api/x402/verify \\
  -H "Content-Type: application/json" \\
  -d '{"deliverableUrl":"https://github.com/celo-org/attribution-tags/pull/1","deliverableType":"${activeCampaign.deliverableType}","criteria":"${activeStage.title}","corridor":"${activeCampaign.corridor}","rewardLocalHuman":"${activeStage.rewardLocalFormatted.replace(/,/g, "")}"}'`;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedProbe(true);
      toast.success(`Copied x402 probe for ${activeCampaign.corridor}`);
      setTimeout(() => setCopiedProbe(false), 1600);
    } catch {
      toast.error("Unable to access clipboard");
    }
  }

  return (
    <section aria-label="Live FX Clearing Desk" className="space-y-6">
      {/* Top Toolbar — Pill Switcher + Quiet Live Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          value={view}
          onChange={setView}
          options={[
            { value: "corridors", label: "Live Corridors", count: orderedCampaigns.length },
            { value: "campaigns", label: "Partner Campaigns", count: initialCampaigns.length },
          ]}
        />

        <div className="flex items-center gap-3">
          {liveData?.asOf && (
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              Quotes {new Date(liveData.asOf).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          )}
          <button
            type="button"
            onClick={() => refetch()}
            className="vire-pressable inline-flex items-center gap-1.5 rounded-lg border border-black/[0.08] bg-card px-2.5 py-1.5 font-mono text-[11px] font-medium text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-black/[0.18] hover:text-foreground"
          >
            <ArrowClockwise className={cn("h-3 w-3", isFetching && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Main Two-Column Asymmetric Clearing Desk */}
      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        {/* Left Column: Sculptural Corridor Cards OR Campaign Ledger */}
        <div className="min-w-0 space-y-4 lg:col-span-7">
          {view === "corridors" ? (
            orderedCampaigns.map((camp) => {
              const live = liveMap.get(camp.corridor);
              const isLive = live?.status === "live";
              const isSelectedCard = camp.corridor === activeCampaign?.corridor;
              const depth = parseNumeric(live?.maxSellUsdtFormatted);

              return (
                <div
                  key={camp.id}
                  onClick={() => {
                    if (camp.corridor !== selectedCorridor) {
                      setSelectedCorridor(camp.corridor);
                      setSelectedStageIndex(1);
                    }
                  }}
                  className={cn(
                    "surface-card vire-interactive-card min-w-0 cursor-pointer overflow-hidden rounded-2xl p-4 sm:p-6",
                    isSelectedCard && "border-black/[0.22]"
                  )}
                >
                  {/* Card Top Row: Currency Glyph + Title Left, Live Spot Rate Right */}
                  <div className="flex items-start justify-between gap-2.5 sm:gap-4">
                    <div className="flex min-w-0 items-center gap-3 sm:gap-3.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-[#F4F4F5] font-mono text-[11px] font-semibold text-foreground sm:h-10 sm:w-10 sm:text-xs">
                        {CURRENCY_GLYPHS[camp.corridor] ?? camp.corridor}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <h3 className="font-mono text-sm font-semibold tracking-[-0.02em] text-foreground sm:text-[15px]">
                            USD₮ / {camp.corridor}
                          </h3>
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground sm:text-[10.5px]">
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                isLive ? "bg-foreground" : "border border-muted-foreground/60"
                              )}
                            />
                            {isLoading ? "…" : isLive ? "ACTIVE" : "NO MAKERS"}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground sm:text-xs">
                          {live?.countryName ?? camp.partnerLocation} · Textile FX ·{" "}
                          <span className="font-mono">{camp.localTokenDecimals}dp</span>
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      {isLoading ? (
                        <div className="space-y-1.5">
                          <Skeleton className="ml-auto h-6 w-20 sm:w-24" />
                          <Skeleton className="ml-auto h-3 w-14 sm:w-16" />
                        </div>
                      ) : (
                        <>
                          <div className="font-mono text-base font-semibold tracking-[-0.025em] text-foreground tabular-nums sm:text-xl">
                            {live?.impliedRateLocalPerUsdt !== null && live?.impliedRateLocalPerUsdt !== undefined
                              ? live.impliedRateLocalPerUsdt.toLocaleString(undefined, {
                                  maximumFractionDigits: live.impliedRateLocalPerUsdt < 50 ? 3 : 2,
                                })
                              : "—"}
                            <span className="ml-1 text-[11px] font-normal text-muted-foreground sm:text-xs">
                              {live?.fiatCode ?? ""}
                            </span>
                          </div>
                          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground tabular-nums sm:text-[11px]">
                            {depth > 0 ? `${formatCompactUsd(depth)} depth` : "$0 depth"}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* 3-Tier Selectable Stage Payout Tiles (Reckon-style recessed -> carbon-ink active) */}
                  <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    {camp.stages.map((st) => {
                      const activeTile =
                        isSelectedCard && st.stageIndex === activeStage?.stageIndex;
                      return (
                        <button
                          key={st.stageIndex}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCorridor(camp.corridor);
                            setSelectedStageIndex(st.stageIndex);
                          }}
                          className={cn(
                            "vire-pressable rounded-xl px-3.5 py-3 text-left",
                            activeTile
                              ? "bg-foreground text-primary-foreground shadow-[0_2px_8px_rgba(0,0,0,0.14)]"
                              : "surface-well text-foreground hover:bg-black/[0.06]"
                          )}
                        >
                          <div
                            className={cn(
                              "text-[11px] font-medium",
                              activeTile ? "text-white/70" : "text-muted-foreground"
                            )}
                          >
                            Stage {st.stageIndex} ·{" "}
                            {st.cooldownHours === 0 ? "Immediate" : `${st.cooldownHours}h`}
                          </div>
                          <div className="mt-1 font-mono text-[13px] font-semibold tabular-nums">
                            {st.rewardLocalFormatted} {camp.corridor}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="surface-card overflow-hidden rounded-2xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-black/[0.06] bg-[#FAFAFB] font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 font-medium">Campaign</th>
                      <th className="px-4 py-3 font-medium">Corridor</th>
                      <th className="px-4 py-3 font-medium">Budget</th>
                      <th className="px-5 py-3 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06]">
                    {orderedCampaigns.map((camp) => {
                      const activeRow = camp.corridor === activeCampaign?.corridor;
                      return (
                        <tr
                          key={camp.id}
                          onClick={() => {
                            setSelectedCorridor(camp.corridor);
                            setSelectedStageIndex(1);
                          }}
                          className={cn(
                            "cursor-pointer transition-colors hover:bg-[#FAFAFB]",
                            activeRow && "bg-[#FAFAFB] shadow-[inset_2px_0_0_#111111]"
                          )}
                        >
                          <td className="px-5 py-3.5">
                            <div className="font-medium text-foreground">{camp.title}</div>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              {camp.partnerName} · {camp.partnerLocation}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 font-mono font-medium text-foreground">
                            {camp.corridor}
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              {camp.localTokenDecimals}dp
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 font-mono text-foreground tabular-nums">
                            ${camp.remainingUsdtFormatted}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3.5 text-right">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium",
                                activeRow
                                  ? "bg-foreground text-primary-foreground"
                                  : "border border-black/[0.09] bg-card text-muted-foreground"
                              )}
                            >
                              {activeRow ? "Selected" : "Inspect"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Sticky Elevated Exact-Output Clearing Ticket */}
        {activeCampaign && activeStage && (
          <div className="min-w-0 lg:sticky lg:top-20 lg:col-span-5">
            <div className="surface-elevated overflow-hidden rounded-2xl p-5 sm:p-6">
              {/* Ticket Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-[#F4F4F5] font-mono text-xs font-semibold text-foreground">
                    {CURRENCY_GLYPHS[activeCampaign.corridor] ?? activeCampaign.corridor}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-foreground">
                        USD₮ → {activeCampaign.corridor}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        Stage {activeStage.stageIndex}
                      </span>
                    </div>
                    <p className="text-[11.5px] text-muted-foreground">
                      {activeCampaign.partnerName}
                    </p>
                  </div>
                </div>

                <Badge tone={isSelectedLive ? "outline" : "neutral"}>
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      isSelectedLive ? "bg-foreground" : "border border-muted-foreground/60"
                    )}
                  />
                  {isSelectedLive ? "ACTIVE" : "NO MAKERS"}
                </Badge>
              </div>

              {/* Recessed Clearing Quote Well */}
              <div className="surface-well mt-5 rounded-xl p-5">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-medium text-muted-foreground">Exact local payout</span>
                  <span className="font-mono text-muted-foreground tabular-nums">
                    {activeLive?.impliedRateLocalPerUsdt
                      ? `1 USD₮ = ${activeLive.impliedRateLocalPerUsdt.toLocaleString(undefined, {
                          maximumFractionDigits: activeLive.impliedRateLocalPerUsdt < 50 ? 3 : 2,
                        })} ${activeLive.fiatCode}`
                      : "Quote unavailable"}
                  </span>
                </div>

                <div className="mt-2 flex items-baseline justify-between gap-3">
                  <div className="font-mono text-3xl font-semibold tracking-[-0.03em] text-foreground tabular-nums">
                    {activeStage.rewardLocalFormatted}
                    <span className="ml-1.5 text-sm font-medium text-muted-foreground">
                      {activeCampaign.corridor}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {impliedUsdtEstimate !== null ? `≈ $${impliedUsdtEstimate.toFixed(2)} USD₮` : "—"}
                  </span>
                </div>

                {/* Micro Liquidity Bar */}
                <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-black/[0.08]">
                  <div
                    className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
                    style={{ width: `${isSelectedLive ? Math.max(12, 100 - depthCoveragePct) : 0}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-muted-foreground tabular-nums">
                  <span>{activeCampaign.localTokenDecimals}dp verified precision</span>
                  <span>
                    {depthNum > 0 ? `${formatCompactUsd(depthNum)} live maker depth` : "Makers offline"}
                  </span>
                </div>

                {/* Quick Stage Chips */}
                <div className="mt-4 grid grid-cols-3 gap-1.5">
                  {activeCampaign.stages.map((st) => {
                    const selected = st.stageIndex === activeStage.stageIndex;
                    return (
                      <button
                        key={st.stageIndex}
                        type="button"
                        onClick={() => setSelectedStageIndex(st.stageIndex)}
                        className={cn(
                          "vire-pressable rounded-lg py-1.5 font-mono text-[11px] font-medium",
                          selected
                            ? "bg-foreground text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.16)]"
                            : "bg-card text-muted-foreground shadow-[0_1px_1px_rgba(0,0,0,0.04)] hover:text-foreground"
                        )}
                      >
                        Stage {st.stageIndex}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Deliverable Brief */}
              <div className="mt-4 rounded-xl border border-black/[0.06] bg-[#FAFAFB] px-4 py-3">
                <div className="text-xs font-medium text-foreground">
                  {activeStage.title.replace(/^Stage \d+\s*[—-]\s*/i, "")}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {activeStage.instructions}
                </p>
              </div>

              {/* Institutional Spec Table */}
              <dl className="mt-4 divide-y divide-black/[0.06] text-xs">
                {[
                  ["Clearing rail", "Textile FX v2 · exact buyAmount"],
                  ["Vault caps", `≤ $${activeCampaign.maxPerPayoutUsdtFormatted}/tx · $${activeCampaign.dailyLimitUsdtFormatted}/24h`],
                  ["Spread & score", `≤ ${activeCampaign.maxSpreadBps} bps · ≥ ${activeCampaign.minPassScore}/100`],
                  ["Off-ramp rail", activeCampaign.offrampRail],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-mono text-[11.5px] font-medium text-foreground tabular-nums">
                      {val}
                    </dd>
                  </div>
                ))}
              </dl>

              {/* Actions */}
              <div className="mt-5 space-y-2.5">
                <Link
                  href={`/claim?campaign=${encodeURIComponent(activeCampaign.slug)}&stage=${activeStage.stageIndex}`}
                  className={buttonVariants({ variant: "primary", size: "lg", className: "w-full" })}
                >
                  Submit Stage {activeStage.stageIndex} deliverable
                  <ArrowRight weight="bold" className="h-4 w-4" />
                </Link>

                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={handleCopyX402Probe}
                  className="w-full font-mono text-xs"
                >
                  {copiedProbe ? (
                    <>
                      <Check weight="bold" className="h-3.5 w-3.5" />
                      Copied x402 probe
                    </>
                  ) : (
                    <>
                      <Copy weight="regular" className="h-3.5 w-3.5" />
                      Copy x402 API probe ({activeCampaign.corridor})
                    </>
                  )}
                </Button>
              </div>

              <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Unused USD₮ dust auto-refunds to VireVault.</span>
                <Link
                  href={`/campaigns?corridor=${encodeURIComponent(activeCampaign.corridor)}`}
                  className="inline-flex items-center gap-0.5 font-medium text-foreground hover:underline"
                >
                  Details
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
