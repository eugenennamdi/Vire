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
import { TokenIcon, TokenStack } from "@/components/ui/token-icon";
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

  const activeCorridorKeys = CORRIDOR_KEYS.filter(
    (key) => key === "ALL" || key === corridorFilter || allCampaigns.some((c) => c.corridor === key)
  );

  const tabOptions = activeCorridorKeys.map((key) => ({
    value: key,
    label: key === "ALL" ? "All" : key,
    icon: key === "ALL" ? undefined : <TokenIcon symbol={key} size={16} />,
    count:
      key === "ALL"
        ? allCampaigns.length
        : allCampaigns.filter((c) => c.corridor === key).length,
  }));

  return (
    <div className="space-y-8">
      <div className="vire-enter flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-[28px] font-medium tracking-[-0.03em] text-[#0A0A0C]">
            Campaigns
          </h1>
          <p className="mt-1 max-w-[58ch] text-[14px] leading-relaxed text-[#71717A]">
            Complete verified tasks and get paid the exact promised amount in your local currency.
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
                <Skeleton className="h-9 w-36 rounded-full" />
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
          <p className="text-[14px] font-medium text-[#0A0A0C]">
            No active campaigns for {corridorFilter} yet.
          </p>
          <p className="mt-1 text-[13px] text-[#71717A]">
            Launch a new local-currency campaign anytime from the developer console.
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
              Developer console
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
                    <div className="flex min-w-0 flex-1 items-start gap-4">
                      <TokenIcon symbol={camp.corridor} size={36} showChainBadge className="mt-0.5" />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#71717A]">
                          {camp.isLaunchPartner && <Badge tone="ink">Launch Partner</Badge>}
                          <span className="font-mono font-medium text-[#0A0A0C]">
                            {camp.corridor}
                          </span>
                          <span>·</span>
                          <span>{camp.partnerName}</span>
                          <span className="hidden sm:inline">({camp.partnerLocation})</span>
                        </div>

                        <h2 className="mt-2 text-[18px] font-medium tracking-[-0.02em] text-[#0A0A0C]">
                          {camp.title}
                        </h2>
                        <p className="mt-1.5 max-w-[66ch] text-[13.5px] leading-[1.6] text-[#52525B]">
                          {camp.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center lg:w-64 lg:flex-col lg:items-stretch">
                      <div className="vire-well space-y-2 rounded-xl px-4 py-3">
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="inline-flex items-center gap-1.5 text-[#71717A]">
                            <TokenIcon symbol="USDT" size={14} />
                            Budget
                          </span>
                          <span className="font-mono font-medium text-[#0A0A0C] tabular-nums">
                            ${camp.remainingUsdtFormatted}
                            <span className="font-normal text-[#71717A]">
                              {" "}
                              / ${camp.budgetUsdtFormatted}
                            </span>
                          </span>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-black/[0.08]">
                          <div
                            className="h-full rounded-full bg-[#0A0A0C]"
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
                        Submit work
                        <ArrowRight weight="bold" className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>

                {/* Hairline multi-stage divider row */}
                <div
                  className={cn(
                    "grid grid-cols-1 divide-y divide-black/[0.06] border-t border-black/[0.06] md:divide-x md:divide-y-0",
                    camp.stages.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3"
                  )}
                >
                  {camp.stages.map((st) => (
                    <Link
                      key={st.stageIndex}
                      href={`/claim?campaign=${encodeURIComponent(camp.slug)}&stage=${st.stageIndex}`}
                      className="group flex flex-col justify-between p-5 transition-colors hover:bg-[#FAFAFB]"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 font-mono text-[11.5px]">
                          <span className="text-[#A1A1AA]">STAGE 0{st.stageIndex}</span>
                          <span className="inline-flex items-center gap-1.5 font-medium text-[#0A0A0C] tabular-nums">
                            <TokenIcon symbol={camp.corridor} size={15} />
                            {st.rewardLocalFormatted} {camp.corridor}
                          </span>
                        </div>
                        <h3 className="mt-2 text-[14px] font-medium text-[#0A0A0C] group-hover:underline">
                          {st.title.replace(/^Stage \d+\s*[—-]\s*/i, "")}
                        </h3>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-[#71717A]">
                          {st.instructions}
                        </p>
                      </div>
                      <div className="mt-3 font-mono text-[11px] text-[#A1A1AA]">
                        {st.cooldownHours === 0
                          ? "Immediate entry"
                          : `${st.cooldownHours}h cooldown after Stage ${st.stageIndex - 1}`}
                      </div>
                    </Link>
                  ))}
                </div>

                {/* Plain-English limits strip */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-black/[0.06] bg-[#FAFAFB] px-6 py-2.5 font-mono text-[11.5px] text-[#71717A] tabular-nums">
                  <span className="font-medium text-[#0A0A0C]">Limits</span>
                  <span>Up to ${camp.maxPerPayoutUsdtFormatted}/payout</span>
                  <span>${camp.dailyLimitUsdtFormatted}/day max</span>
                  <span>Max {camp.maxPayoutsPerRecipient} payouts/person</span>
                  <span>Min score {camp.minPassScore}/100</span>
                  <span>{(camp.maxSpreadBps / 100).toFixed(1).replace(/\.0$/, "")}% max spread</span>
                </div>
              </Card>
            );
          })}

          {/* Multi-currency campaign launch strip */}
          <Card className="flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <TokenStack symbols={["wBRL", "IDRX", "wMXN"]} size={20} />
                <h2 className="text-[14.5px] font-medium text-[#0A0A0C]">
                  Launch a campaign in any supported currency
                </h2>
              </div>
              <p className="max-w-[56ch] text-[13px] text-[#71717A]">
                Brands and teams can fund automated local-currency payout campaigns in{" "}
                <span className="font-mono text-[#0A0A0C]">cNGN, wARS, wBRL, IDRX, or wMXN</span>.
              </p>
            </div>
            <Link href="/console" className={buttonVariants({ variant: "secondary", size: "md" })}>
              Developer console
              <ArrowRight weight="bold" className="h-3.5 w-3.5" />
            </Link>
          </Card>
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
