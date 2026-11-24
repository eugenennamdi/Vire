"use client";

import { ArrowClockwise, ArrowUpRight } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import type { CorridorLiveStatus } from "@vire/shared";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const DISPLAY_ORDER = ["cNGN", "wARS", "wBRL", "wMXN", "IDRX"];

function parseDepthUsd(formatted: string | null): number {
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

export function CorridorStrip() {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["live-corridors"],
    queryFn: async () => {
      const res = await fetch("/api/corridors/live");
      if (!res.ok) throw new Error("Unable to load Textile FX corridors");
      return (await res.json()) as { asOf: string; corridors: CorridorLiveStatus[] };
    },
    refetchInterval: 20_000,
  });

  const ordered = (data?.corridors ?? []).filter((c) => DISPLAY_ORDER.includes(c.corridor));
  const maxDepthLog = Math.max(
    1,
    ...ordered.map((c) => Math.log10(Math.max(10, parseDepthUsd(c.maxSellUsdtFormatted))))
  );

  return (
    <section
      aria-label="Textile FX Corridors"
      className="vire-surface vire-enter vire-delay-1 overflow-hidden rounded-lg"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E5E5] bg-[#FAFAFA] px-4 py-2.5 sm:px-5">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xs font-medium text-[#111111]">Textile FX Corridors</h2>
          <span className="hidden font-mono text-[11px] text-[#737373] sm:inline">
            Exact-output buyAmount preview
          </span>
        </div>

        <div className="flex items-center gap-3">
          {data?.asOf && (
            <span className="font-mono text-[11px] text-[#737373] tabular-nums">
              {new Date(data.asOf).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          )}
          <button
            type="button"
            onClick={() => refetch()}
            aria-label="Refresh FX rates"
            className="vire-pressable inline-flex items-center gap-1.5 rounded border border-[#E5E5E5] bg-white px-2 py-1 font-mono text-[11px] text-[#525252] hover:border-[#A3A3A3] hover:text-[#111111]"
          >
            <ArrowClockwise
              weight="regular"
              className={cn("h-3 w-3", isFetching && "animate-spin")}
            />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 divide-y divide-[#E5E5E5] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
        {isLoading
          ? DISPLAY_ORDER.map((sym) => (
              <div key={sym} className="space-y-3 p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3.5 w-10" />
                </div>
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-0.5 w-full" />
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-14" />
                </div>
              </div>
            ))
          : ordered.map((c) => {
              const isLive = c.status === "live";
              const depthNum = parseDepthUsd(c.maxSellUsdtFormatted);
              const depthPct =
                isLive && depthNum > 0
                  ? Math.max(
                      12,
                      Math.min(100, Math.round((Math.log10(Math.max(10, depthNum)) / maxDepthLog) * 100))
                    )
                  : 0;

              return (
                <Link
                  key={c.corridor}
                  href={`/campaigns?corridor=${encodeURIComponent(c.corridor)}`}
                  className="group block p-4 transition-colors duration-150 hover:bg-[#FAFAFA] sm:p-5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-xs font-medium text-[#111111]">
                      USD₮ / {c.corridor}
                    </div>
                    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-[#737373]">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isLive ? "bg-[#111111]" : "border border-[#A3A3A3] bg-transparent"
                        )}
                      />
                      {isLive ? "Active" : "No makers"}
                    </span>
                  </div>

                  <div className="mt-3 flex items-baseline gap-1.5 font-mono text-xl font-semibold tracking-[-0.02em] text-[#111111] tabular-nums">
                    {c.impliedRateLocalPerUsdt !== null
                      ? c.impliedRateLocalPerUsdt.toLocaleString(undefined, {
                          maximumFractionDigits: c.impliedRateLocalPerUsdt < 50 ? 3 : 2,
                        })
                      : "—"}
                    <span className="text-[11px] font-normal text-[#737373]">{c.fiatCode}</span>
                  </div>

                  <div className="mt-3 h-[2px] w-full bg-[#EAEAEA]">
                    <div
                      className="h-full bg-[#111111] transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
                      style={{ width: `${depthPct}%` }}
                    />
                  </div>

                  <div className="mt-2.5 flex items-center justify-between gap-2 font-mono text-[11px] text-[#737373] tabular-nums">
                    <span className="truncate whitespace-nowrap">
                      {c.countryName} · {c.decimals}dp
                    </span>
                    <span
                      title={c.maxSellUsdtFormatted ? `$${c.maxSellUsdtFormatted} USD₮ depth` : "$0 depth"}
                      className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[#525252] group-hover:text-[#111111]"
                    >
                      {formatCompactUsd(depthNum)}
                      <ArrowUpRight className="h-3 w-3 opacity-60 transition-transform duration-150 group-hover:-translate-y-[1px] group-hover:translate-x-[1px] group-hover:opacity-100" />
                    </span>
                  </div>
                </Link>
              );
            })}
      </div>
    </section>
  );
}
