"use client";

import { ArrowRight, ShieldCheck, SlidersHorizontal } from "@phosphor-icons/react";
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
    label: key === "ALL" ? "All corridors" : key,
    count:
      key === "ALL"
        ? allCampaigns.length
        : allCampaigns.filter((c) => c.corridor === key).length,
  }));

  return (
    <div className="space-y-8">
      <div className="vire-enter flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-[#F4F5F6]">
            Active clearing campaigns
          </h1>
          <p className="mt-1.5 max-w-[60ch] text-sm text-[#8A8F98]">
            Multi-stage missions settled with exact local-currency output via Textile FX{" "}
            <code className="font-mono text-xs text-[#D5D8DE]">buyAmount</code> and bounded onchain
            by <code className="font-mono text-xs text-[#D5D8DE]">VireVault</code>.
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
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-6 w-80" />
                </div>
                <Skeleton className="h-9 w-36" />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm font-medium text-[#E5E7EB]">
            No campaigns configured for {corridorFilter}.
          </p>
          <p className="mt-1 text-xs text-[#8A8F98]">
            Launch a new corridor mission permissionlessly via{" "}
            <code className="font-mono">POST /api/x402/campaigns</code>.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => setCorridorFilter("ALL")}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Show all corridors
            </button>
            <Link href="/console" className={buttonVariants({ variant: "primary", size: "sm" })}>
              Open x402 Console
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
                  idx >= 3 && "vire-delay-3",
                  camp.isLaunchPartner && "border-emerald-500/30"
                )}
              >
                <div className="p-6">
                  <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {camp.isLaunchPartner && <Badge tone="solid">Launch Partner</Badge>}
                        <Badge tone="emerald">
                          {camp.corridor} · {camp.localTokenDecimals}dp
                        </Badge>
                        <Badge tone="neutral">{camp.deliverableType.replace("_", " ")}</Badge>
                        <span className="font-mono text-[11px] text-[#6B7280]">
                          {camp.partnerName} · {camp.partnerLocation}
                        </span>
                      </div>

                      <h2 className="mt-3 text-lg font-semibold tracking-[-0.02em] text-[#F4F5F6]">
                        {camp.title}
                      </h2>
                      <p className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-[#9DA3AE]">
                        {camp.description}
                      </p>
                    </div>

                    {/* Morpho-style Budget Column + Action */}
                    <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center lg:w-64 lg:flex-col lg:items-stretch">
                      <div className="rounded-lg border border-white/[0.07] bg-[#0B0D10] p-3">
                        <div className="flex items-center justify-between font-mono text-[11px] text-[#8A8F98]">
                          <span>Remaining USD₮</span>
                          <span className="tabular-nums">{remainingPct}%</span>
                        </div>
                        <div className="mt-1 font-mono text-base font-semibold text-[#F4F5F6] tabular-nums">
                          ${camp.remainingUsdtFormatted}
                          <span className="ml-1 text-xs font-normal text-[#5C626D]">
                            / ${camp.budgetUsdtFormatted}
                          </span>
                        </div>
                        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full bg-emerald-400/80"
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

                  {/* Multi-Stage Progression Row */}
                  <div className="mt-6 grid gap-3 md:grid-cols-3">
                    {camp.stages.map((st) => (
                      <div
                        key={st.stageIndex}
                        className="flex flex-col justify-between rounded-lg border border-white/[0.07] bg-[#0B0D10] p-4"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                            <span className="text-[#6B7280]">STAGE 0{st.stageIndex}</span>
                            <span className="font-semibold text-emerald-400 tabular-nums">
                              {st.rewardLocalFormatted} {camp.corridor}
                            </span>
                          </div>
                          <h3 className="mt-2 text-[13px] font-medium text-[#E5E7EB]">
                            {st.title.replace(/^Stage \d+\s*[—-]\s*/i, "")}
                          </h3>
                          <p className="mt-1 text-xs leading-relaxed text-[#8A8F98]">
                            {st.instructions}
                          </p>
                        </div>
                        <div className="mt-3 border-t border-white/[0.05] pt-2.5 font-mono text-[10px] text-[#5C626D]">
                          Cooldown:{" "}
                          {st.cooldownHours === 0
                            ? "Immediate entry"
                            : `${st.cooldownHours}h after Stage ${st.stageIndex - 1}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Guardrails Hairline Footer */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.07] bg-[#0B0D10] px-6 py-3 font-mono text-[11px] text-[#8A8F98] tabular-nums">
                  <span className="inline-flex items-center gap-1.5 font-medium text-[#D5D8DE]">
                    <ShieldCheck weight="fill" className="h-3.5 w-3.5 text-emerald-400" />
                    Policy Guardrails
                  </span>
                  <span>maxSpread {camp.maxSpreadBps} bps</span>
                  <span>maxPerPayout ${camp.maxPerPayoutUsdtFormatted}</span>
                  <span>dailyCap ${camp.dailyLimitUsdtFormatted}/24h</span>
                  <span>repeatCap {camp.maxPayoutsPerRecipient}x</span>
                  <span className="inline-flex items-center gap-1">
                    <SlidersHorizontal className="h-3 w-3 text-[#6B7280]" />
                    minScore {camp.minPassScore}/100
                  </span>
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
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-56 w-full" />
        </div>
      }
    >
      <CampaignsInner />
    </Suspense>
  );
}
