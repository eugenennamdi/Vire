"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface CampaignStageView {
  stageIndex: number;
  title: string;
  instructions: string;
  rewardLocalAtomic: string;
  rewardLocalFormatted: string;
  cooldownHours: number;
}

interface CampaignView {
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
  stages: CampaignStageView[];
  budgetUsdtAtomic: string;
  remainingUsdtAtomic: string;
  budgetUsdtFormatted: string;
  remainingUsdtFormatted: string;
  maxPerPayoutUsdtFormatted: string;
  dailyLimitUsdtFormatted: string;
  maxPayoutsPerRecipient: number;
  maxSpreadBps: number;
  minPassScore: number;
  active: boolean;
}

const CORRIDOR_KEYS = ["ALL", "cNGN", "wARS", "wBRL", "IDRX", "wMXN"] as const;
type CorridorFilter = (typeof CORRIDOR_KEYS)[number];

function CampaignsInner() {
  const searchParams = useSearchParams();
  const initialCorridor = searchParams.get("corridor");
  const [corridorFilter, setCorridorFilter] = useState<CorridorFilter>(
    CORRIDOR_KEYS.includes(initialCorridor as CorridorFilter)
      ? (initialCorridor as CorridorFilter)
      : "ALL"
  );

  useEffect(() => {
    if (initialCorridor && CORRIDOR_KEYS.includes(initialCorridor as CorridorFilter)) {
      setCorridorFilter(initialCorridor as CorridorFilter);
    }
  }, [initialCorridor]);

  const { data, isLoading } = useQuery({
    queryKey: ["campaigns-list"],
    queryFn: async () => {
      const res = await fetch("/api/campaigns");
      if (!res.ok) throw new Error("Failed to load campaigns");
      return (await res.json()) as { campaigns: CampaignView[] };
    },
  });

  const allCampaigns = data?.campaigns ?? [];
  const filtered = allCampaigns.filter(
    (c) => corridorFilter === "ALL" || c.corridor === corridorFilter
  );

  const tabOptions = CORRIDOR_KEYS.map((key) => ({
    value: key,
    label: key === "ALL" ? "All" : key,
    count:
      key === "ALL"
        ? allCampaigns.length
        : allCampaigns.filter((c) => c.corridor === key).length,
  }));

  return (
    <div className="space-y-8">
      <div className="vire-enter flex flex-col justify-between gap-4 border-b border-[#E4E2DC] pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#68665F]">
            Active Missions · Celo 42220
          </p>
          <h1 className="mt-1.5 font-serif text-3xl font-normal tracking-[-0.025em] text-[#121210] sm:text-[36px]">
            Clearing campaigns
          </h1>
          <p className="mt-1.5 max-w-[58ch] text-sm leading-relaxed text-[#4F4E4A]">
            Multi-stage work mandates settled with exact local output via Textile FX and bounded onchain by{" "}
            <code className="font-mono text-xs text-[#121210]">VireVault</code>.
          </p>
        </div>

        <SegmentedTabs
          options={tabOptions}
          value={corridorFilter}
          onChange={setCorridorFilter}
        />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="space-y-4 p-6">
              <div className="flex justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-6 w-80" />
                </div>
                <Skeleton className="h-9 w-36" />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-sm font-medium text-[#121210]">
            No campaigns configured for {corridorFilter}.
          </p>
          <p className="mt-1 text-xs text-[#68665F]">
            Create one permissionlessly via{" "}
            <code className="font-mono text-[#121210]">POST /api/x402/campaigns</code>.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => setCorridorFilter("ALL")}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Show all
            </button>
            <Link href="/console" className={buttonVariants({ variant: "primary", size: "sm" })}>
              Open Console
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-5">
          {filtered.map((camp, idx) => {
            const totalBig = BigInt(camp.budgetUsdtAtomic || "1");
            const remBig = BigInt(camp.remainingUsdtAtomic || "0");
            const remainingPct =
              totalBig > 0n ? Math.min(100, Math.max(0, Number((remBig * 100n) / totalBig))) : 0;

            return (
              <Card
                key={camp.id}
                interactive
                className={cn(
                  "vire-enter overflow-hidden",
                  idx === 1 && "vire-delay-1",
                  idx === 2 && "vire-delay-2",
                  idx >= 3 && "vire-delay-3"
                )}
              >
                <div className="p-6">
                  <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-[#68665F]">
                        {camp.isLaunchPartner && <Badge tone="ink">Launch Partner</Badge>}
                        <span className="font-semibold text-[#121210]">
                          {camp.corridor} · {camp.localTokenDecimals}dp
                        </span>
                        <span>/</span>
                        <span>{camp.deliverableType.replace("_", " ")}</span>
                        <span>/</span>
                        <span>
                          {camp.partnerName} ({camp.partnerLocation})
                        </span>
                      </div>

                      <h2 className="mt-2.5 font-serif text-xl font-normal tracking-[-0.015em] text-[#121210]">
                        {camp.title}
                      </h2>
                      <p className="mt-1.5 max-w-[66ch] text-[13.5px] leading-[1.6] text-[#4F4E4A]">
                        {camp.description}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center lg:w-64 lg:flex-col lg:items-stretch">
                      <div className="vire-band space-y-1.5 rounded-[4px] px-3.5 py-2.5">
                        <div className="flex items-baseline justify-between font-mono text-xs tabular-nums">
                          <span className="text-[#68665F]">Remaining USDT</span>
                          <span className="font-semibold text-[#121210]">
                            ${camp.remainingUsdtFormatted}
                            <span className="font-normal text-[#68665F]">
                              {" "}
                              / ${camp.budgetUsdtFormatted}
                            </span>
                          </span>
                        </div>
                        <div className="h-[2px] w-full bg-[#DEDBD3]">
                          <div
                            className="h-full bg-[#121210]"
                            style={{ width: `${remainingPct}%` }}
                          />
                        </div>
                      </div>

                      <Link
                        href={`/claim?campaign=${encodeURIComponent(camp.slug)}`}
                        className={buttonVariants({
                          variant: camp.isLaunchPartner ? "primary" : "secondary",
                          size: "md",
                          className: "w-full",
                        })}
                      >
                        Submit deliverable
                        <ArrowRight weight="bold" className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>

                {/* Hairline 3-column stage divider row */}
                <div className="grid grid-cols-1 divide-y divide-[#E4E2DC] border-t border-[#E4E2DC] md:grid-cols-3 md:divide-x md:divide-y-0">
                  {camp.stages.map((st) => (
                    <Link
                      key={st.stageIndex}
                      href={`/claim?campaign=${encodeURIComponent(camp.slug)}&stage=${st.stageIndex}`}
                      className="group flex flex-col justify-between p-5 transition-colors hover:bg-[#FAF9F6]"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                          <span className="text-[#68665F]">STAGE 0{st.stageIndex}</span>
                          <span className="font-semibold text-[#121210] tabular-nums">
                            {st.rewardLocalFormatted} {camp.corridor}
                          </span>
                        </div>
                        <h3 className="mt-2 text-[13.5px] font-medium text-[#121210] group-hover:underline">
                          {st.title.replace(/^Stage \d+\s*[—-]\s*/i, "")}
                        </h3>
                        <p className="mt-1 text-xs leading-relaxed text-[#68665F]">
                          {st.instructions}
                        </p>
                      </div>
                      <div className="mt-3 font-mono text-[10.5px] text-[#787670]">
                        {st.cooldownHours === 0
                          ? "Immediate entry"
                          : `${st.cooldownHours}h cooldown after Stage ${st.stageIndex - 1}`}
                      </div>
                    </Link>
                  ))}
                </div>

                {/* Guardrails strip */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[#E4E2DC] bg-[#F3F1EC]/70 px-6 py-2.5 font-mono text-[11px] text-[#68665F] tabular-nums">
                  <span className="font-medium text-[#121210]">Policy Guardrails</span>
                  <span>maxSpread {camp.maxSpreadBps} bps</span>
                  <span>maxPerPayout ${camp.maxPerPayoutUsdtFormatted}</span>
                  <span>dailyCap ${camp.dailyLimitUsdtFormatted}/24h</span>
                  <span>repeatCap {camp.maxPayoutsPerRecipient}x</span>
                  <span>minScore {camp.minPassScore}/100</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CampaignsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-56 w-full" />
        </div>
      }
    >
      <CampaignsInner />
    </Suspense>
  );
}
