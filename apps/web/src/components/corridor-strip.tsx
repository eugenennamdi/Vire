"use client";

import { ArrowClockwise, ArrowUpRight } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import type { CorridorLiveStatus } from "@vire/shared";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const DISPLAY_ORDER = ["cNGN", "wARS", "wBRL", "wMXN", "IDRX"];

function parseDepthUsd(formatted: string | null): number {
  if (!formatted) return 0;
  const n = Number(formatted.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function CorridorStrip() {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["live-corridors"],
    queryFn: async () => {
      const res = await fetch("/api/corridors/live");
      if (!res.ok) throw new Error("Unable to load live Textile FX corridors");
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
      aria-label="Live Textile FX Corridors"
      className="vire-surface vire-enter vire-delay-1 overflow-hidden rounded-xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] bg-[#0C0E11] px-4 py-2.5 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <h2 className="text-xs font-medium text-[#E5E7EB]">
            Live Textile FX v2 Corridors
          </h2>
          <span className="hidden font-mono text-[11px] text-[#6B7280] sm:inline">
            Exact-output buyAmount preview · Celo 42220
          </span>
        </div>

        <div className="flex items-center gap-3">
          {data?.asOf && (
            <span className="font-mono text-[11px] text-[#6B7280] tabular-nums">
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
            aria-label="Refresh live FX rates"
            className="vire-pressable inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-[#B4BAC5] hover:border-white/[0.15] hover:text-[#F4F5F6]"
          >
            <ArrowClockwise
              weight="regular"
              className={cn("h-3 w-3", isFetching && "animate-spin")}
            />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 divide-y divide-white/[0.06] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
        {isLoading
          ? DISPLAY_ORDER.map((sym) => (
              <div key={sym} className="space-y-3 p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-12" />
                </div>
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-1 w-full" />
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
                  ? Math.max(14, Math.min(100, Math.round((Math.log10(Math.max(10, depthNum)) / maxDepthLog) * 100)))
                  : 0;

              return (
                <Link
                  key={c.corridor}
                  href={`/campaigns?corridor=${encodeURIComponent(c.corridor)}`}
                  className="group block p-4 transition-colors duration-150 hover:bg-white/[0.025] sm:p-5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-mono text-xs font-medium text-[#E5E7EB]">
                      <span>USD₮</span>
                      <span className="text-[#5C626D]">/</span>
                      <span>{c.corridor}</span>
                    </div>
                    <Badge tone={isLive ? "emerald" : "amber"}>
                      {isLive ? "LIVE" : "DARK"}
                    </Badge>
                  </div>

                  <div className="mt-3 flex items-baseline gap-1.5 font-mono text-xl font-semibold tracking-[-0.02em] text-[#F4F5F6] tabular-nums">
                    {c.impliedRateLocalPerUsdt !== null
                      ? c.impliedRateLocalPerUsdt.toLocaleString(undefined, {
                          maximumFractionDigits: c.impliedRateLocalPerUsdt < 50 ? 3 : 2,
                        })
                      : "—"}
                    <span className="text-[11px] font-normal text-[#6B7280]">{c.fiatCode}</span>
                  </div>

                  {/* Subtle liquidity depth bar */}
                  <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
                        isLive ? "bg-emerald-400/80" : "bg-amber-400/40"
                      )}
                      style={{ width: `${depthPct}%` }}
                    />
                  </div>

                  <div className="mt-2.5 flex items-center justify-between font-mono text-[11px] text-[#8A8F98] tabular-nums">
                    <span className="flex items-center gap-1">
                      <span>{c.countryName}</span>
                      <span
                        className={cn(
                          "rounded px-1 text-[10px]",
                          c.decimals === 2
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-white/[0.05] text-[#8A8F98]"
                        )}
                      >
                        {c.decimals}dp
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-[#A1A7B3] group-hover:text-[#F4F5F6]">
                      {c.maxSellUsdtFormatted ? `$${c.maxSellUsdtFormatted}` : "0 depth"}
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
