"use client";

import { useQuery } from "@tanstack/react-query";
import type { CorridorLiveStatus } from "@vire/shared";
import { RefreshCw } from "lucide-react";

const DISPLAY_ORDER = ["cNGN", "wARS", "wBRL", "wMXN", "IDRX"];

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

  return (
    <section className="rounded-xl border border-zinc-200/90 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-900">
            Live Textile FX v2 Corridors (Celo 42220 · Exact-Output Preview)
          </span>
        </div>
        <div className="flex items-center gap-3">
          {data?.asOf && (
            <span className="font-mono text-[11px] text-zinc-500">
              Updated {new Date(data.asOf).toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 divide-y divide-zinc-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
        {isLoading
          ? DISPLAY_ORDER.map((sym) => (
              <div key={sym} className="p-4 animate-pulse">
                <div className="h-4 w-20 rounded bg-zinc-200" />
                <div className="mt-2 h-6 w-28 rounded bg-zinc-100" />
                <div className="mt-2 h-3 w-24 rounded bg-zinc-100" />
              </div>
            ))
          : ordered.map((c) => {
              const isLive = c.status === "live";
              return (
                <div key={c.corridor} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-zinc-900">
                      USD₮ → {c.corridor}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${
                        isLive
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-800"
                      }`}
                    >
                      {isLive ? "LIVE" : c.status.replace(/_/g, " ").toUpperCase()}
                    </span>
                  </div>

                  <div className="mt-2 font-mono text-lg font-semibold tracking-tight text-zinc-950 tabular-nums">
                    {c.impliedRateLocalPerUsdt !== null
                      ? `${c.impliedRateLocalPerUsdt.toLocaleString(undefined, {
                          maximumFractionDigits: c.impliedRateLocalPerUsdt < 50 ? 3 : 2,
                        })}`
                      : "—"}
                    <span className="ml-1 text-xs font-normal text-zinc-500">{c.fiatCode}/USD₮</span>
                  </div>

                  <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-zinc-500">
                    <span>
                      {c.countryName} · {c.decimals}dp
                    </span>
                    <span>
                      {c.maxSellUsdtFormatted ? `Depth $${c.maxSellUsdtFormatted}` : `${c.levelsCount} lvls`}
                    </span>
                  </div>
                </div>
              );
            })}
      </div>
    </section>
  );
}
