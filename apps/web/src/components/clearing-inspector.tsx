"use client";

import {
  ArrowClockwise,
  ArrowRight,
  Check,
  X,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import type { CorridorLiveStatus } from "@vire/shared";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { TokenIcon } from "@/components/ui/token-icon";
import { cn } from "@/lib/utils";

export interface InspectorCampaign {
  id: string;
  slug: string;
  partnerName: string;
  partnerLocation: string;
  title: string;
  deliverableType: string;
  corridor: string;
  localTokenDecimals: number;
  stage1Title: string;
  stage1Instructions: string;
  stage1RewardFormatted: string;
  budgetUsdtFormatted: string;
  remainingUsdtFormatted: string;
  maxPerPayoutUsdtFormatted: string;
  dailyLimitUsdtFormatted: string;
  maxSpreadBps: number;
  minPassScore: number;
  offrampRail: string;
}

interface ScenarioConfig {
  id: "cNGN" | "wARS" | "wBRL" | "IDRX";
  slug: string;
  corridor: "cNGN" | "wARS" | "wBRL" | "IDRX";
  tokenName: string;
  useCaseLabel: string;
  deliverableLabel: string;
  deliverableUrl: string;
  reviewCostLabel: string;
  localAmount: string;
  fallbackUsdt: string;
  offrampRail: string;
}

const SCENARIOS: ScenarioConfig[] = [
  {
    id: "cNGN",
    slug: "launch-partner-blackfriday-cngn",
    corridor: "cNGN",
    tokenName: "Compliant Naira",
    useCaseLabel: "Creator promo payout",
    deliverableLabel: "Original product review post on X with live store link and campaign tag",
    deliverableUrl: "https://x.com/creator_ng/status/189241038492014",
    reviewCostLabel: "Automated check ($0.005)",
    localAmount: "2,500",
    fallbackUsdt: "1.73",
    offrampRail: "MiniPay · Busha · Quidax",
  },
  {
    id: "wARS",
    slug: "latam-qa-regression-wars",
    corridor: "wARS",
    tokenName: "Argentine Peso",
    useCaseLabel: "Open-source QA bounty",
    deliverableLabel: "Reproducible GitHub bug report with logs and verified fix notes",
    deliverableUrl: "https://github.com/acme-org/checkout/issues/12",
    reviewCostLabel: "Automated check ($0.01)",
    localAmount: "2,500",
    fallbackUsdt: "1.43",
    offrampRail: "Ripio Portal (CBU)",
  },
  {
    id: "wBRL",
    slug: "brazil-ptbr-localization-wbrl",
    corridor: "wBRL",
    tokenName: "Brazilian Real",
    useCaseLabel: "Product localization",
    deliverableLabel: "Portuguese UI translation pull request verified on GitHub",
    deliverableUrl: "https://github.com/acme-org/app/pull/18",
    reviewCostLabel: "Automated check ($0.01)",
    localAmount: "12",
    fallbackUsdt: "2.04",
    offrampRail: "Ripio Portal (PIX)",
  },
  {
    id: "IDRX",
    slug: "indonesia-bahasa-qa-idrx",
    corridor: "IDRX",
    tokenName: "Indonesian Rupiah",
    useCaseLabel: "Community QA sprint",
    deliverableLabel: "Bahasa Indonesia checkout QA report verified on GitHub",
    deliverableUrl: "https://github.com/acme-org/app/pull/21",
    reviewCostLabel: "Automated check ($0.01)",
    localAmount: "35,000",
    fallbackUsdt: "1.91",
    offrampRail: "IDRX Bank Redeem (IDR)",
  },
];

const ALL_CORRIDOR_META: Record<
  string,
  { name: string; country: string; rail: string; decimals: number; fiat: string }
> = {
  cNGN: {
    name: "Compliant Naira",
    country: "Nigeria",
    rail: "Busha · Quidax · Yellow Card",
    decimals: 6,
    fiat: "NGN",
  },
  wARS: {
    name: "Argentine Peso",
    country: "Argentina",
    rail: "Ripio Portal (CBU)",
    decimals: 18,
    fiat: "ARS",
  },
  wBRL: {
    name: "Brazilian Real",
    country: "Brazil",
    rail: "Ripio Portal (PIX)",
    decimals: 18,
    fiat: "BRL",
  },
  IDRX: {
    name: "Indonesian Rupiah",
    country: "Indonesia",
    rail: "IDRX Bank Redeem",
    decimals: 2,
    fiat: "IDR",
  },
  wMXN: {
    name: "Mexican Peso",
    country: "Mexico",
    rail: "Ripio Portal (CLABE)",
    decimals: 18,
    fiat: "MXN",
  },
};

const DISPLAY_CORRIDORS = ["cNGN", "wARS", "wBRL", "IDRX", "wMXN"] as const;

function formatCompactUsd(raw: string | null | undefined): string {
  if (!raw) return "—";
  const num = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(num) || num <= 0) return "$0";
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function formatRate(rate: number | null | undefined): string {
  if (!rate || !Number.isFinite(rate)) return "—";
  return rate >= 100
    ? rate.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : rate.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function ClearingInspector({
  campaigns,
}: {
  campaigns: InspectorCampaign[];
  attributionCode?: string;
}) {
  const [selectedId, setSelectedId] = useState<ScenarioConfig["id"]>("cNGN");
  const [mode, setMode] = useState<"valid" | "blocked">("valid");
  const [corridorFilter, setCorridorFilter] = useState<"all" | "active">("all");

  const { data: liveData, isFetching, refetch } = useQuery({
    queryKey: ["corridors-live-inspector"],
    queryFn: async () => {
      const res = await fetch("/api/corridors/live");
      if (!res.ok) throw new Error("Failed to load Textile FX quotes");
      return (await res.json()) as { asOf: string; corridors: CorridorLiveStatus[] };
    },
    refetchInterval: 30_000,
  });

  const liveBySymbol = useMemo(() => {
    const map = new Map<string, CorridorLiveStatus>();
    for (const c of liveData?.corridors ?? []) {
      map.set(c.corridor, c);
    }
    return map;
  }, [liveData]);

  const totalDepthUsd = useMemo(() => {
    let sum = 0;
    for (const sym of DISPLAY_CORRIDORS) {
      const raw = liveBySymbol.get(sym)?.maxSellUsdtFormatted;
      if (raw) {
        const n = Number(raw.replace(/,/g, ""));
        if (Number.isFinite(n)) sum += n;
      }
    }
    return sum;
  }, [liveBySymbol]);

  const maxDepthUsd = useMemo(() => {
    let best = 1;
    for (const sym of DISPLAY_CORRIDORS) {
      const raw = liveBySymbol.get(sym)?.maxSellUsdtFormatted;
      if (raw) {
        const n = Number(raw.replace(/,/g, ""));
        if (Number.isFinite(n) && n > best) best = n;
      }
    }
    return best;
  }, [liveBySymbol]);

  const scenario = SCENARIOS.find((s) => s.id === selectedId) ?? SCENARIOS[0]!;
  const matchedCampaign =
    campaigns.find((c) => c.slug === scenario.slug) ??
    campaigns.find((c) => c.corridor === scenario.corridor);
  const liveQuote = liveBySymbol.get(scenario.corridor);

  const isBlocked = mode === "blocked";
  const localAmountDisplay = matchedCampaign?.stage1RewardFormatted ?? scenario.localAmount;
  const usdtCostDisplay = liveQuote?.sampleTakerPaysUsdtFormatted
    ? Number(liveQuote.sampleTakerPaysUsdtFormatted).toFixed(2)
    : scenario.fallbackUsdt;
  const impliedRate = liveQuote?.impliedRateLocalPerUsdt ?? null;
  const makerDepth = liveQuote?.maxSellUsdtFormatted ?? null;

  const maxSpreadPct = ((matchedCampaign?.maxSpreadBps ?? 250) / 100)
    .toFixed(1)
    .replace(/\.0$/, "");
  const scenarioMeta = ALL_CORRIDOR_META[scenario.corridor];

  const policyChecks = isBlocked
    ? [
        { label: "Unique submission", passed: false },
        { label: "External recipient wallet", passed: false },
        { label: "Meets campaign rules", passed: false },
        { label: `Exchange spread ≤ ${maxSpreadPct}%`, passed: true },
        { label: `Per-payout limit ≤ $${matchedCampaign?.maxPerPayoutUsdtFormatted ?? "6"}`, passed: true },
        { label: `Daily limit ≤ $${matchedCampaign?.dailyLimitUsdtFormatted ?? "20"}`, passed: true },
      ]
    : [
        { label: "Unique submission", passed: true },
        { label: "External recipient wallet", passed: true },
        { label: "Meets campaign rules", passed: true },
        { label: `Exchange spread ≤ ${maxSpreadPct}%`, passed: true },
        { label: `Per-payout limit ≤ $${matchedCampaign?.maxPerPayoutUsdtFormatted ?? "6"}`, passed: true },
        { label: `Daily limit ≤ $${matchedCampaign?.dailyLimitUsdtFormatted ?? "20"}`, passed: true },
      ];

  const probeCurl = `curl -i -X POST https://usevire.xyz/api/x402/verify \\
  -H "Content-Type: application/json" \\
  -d '{"deliverableUrl":"${scenario.deliverableUrl}","deliverableType":"${matchedCampaign?.deliverableType ?? "promo_post"}","corridor":"${scenario.corridor}","rewardLocalHuman":"${localAmountDisplay.replace(/,/g, "")}"}'`;

  const visibleCorridors = DISPLAY_CORRIDORS.filter((sym) => {
    if (corridorFilter === "all") return true;
    const st = liveBySymbol.get(sym)?.status;
    return st === "live" || st === "degraded";
  });

  return (
    <div className="space-y-16">
      {/* SECTION 1: Interactive Payout Flow */}
      <section aria-labelledby="clearing-flow-heading" className="vire-enter vire-delay-1 space-y-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2
              id="clearing-flow-heading"
              className="text-[24px] font-medium tracking-[-0.03em] text-[#0A0A0C] sm:text-[26px]"
            >
              How a payout works
            </h2>
            <p className="mt-1 text-[14px] text-[#71717A]">
              Pick a currency or test a blocked claim to see how each payout is verified and sent.
            </p>
          </div>

          {/* Valid vs Blocked Mode Capsule */}
          <div className="vire-well inline-flex shrink-0 items-center gap-0.5 self-start rounded-full p-1 sm:self-auto">
            <button
              type="button"
              onClick={() => setMode("valid")}
              className={cn(
                "vire-pressable inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px] font-medium",
                !isBlocked
                  ? "bg-white text-[#0A0A0C] shadow-[0_0_0_1px_rgba(10,10,12,0.07),0_1px_2px_rgba(10,10,12,0.06)]"
                  : "text-[#71717A] hover:text-[#0A0A0C]"
              )}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#16A34A]" />
              Valid payout
            </button>
            <button
              type="button"
              onClick={() => setMode("blocked")}
              className={cn(
                "vire-pressable inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px] font-medium",
                isBlocked
                  ? "bg-white text-[#B91C1C] shadow-[0_0_0_1px_rgba(220,38,38,0.18),0_1px_2px_rgba(10,10,12,0.05)]"
                  : "text-[#71717A] hover:text-[#0A0A0C]"
              )}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#DC2626]" />
              Blocked claim
            </button>
          </div>
        </div>

        {/* Currency Selector Pills with Official Colored Token Icons */}
        <div
          role="tablist"
          aria-label="Currency scenarios"
          className="flex flex-wrap items-center gap-2"
        >
          {SCENARIOS.map((s) => {
            const active = s.id === scenario.id;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedId(s.id)}
                className={cn(
                  "vire-pressable inline-flex items-center gap-2 rounded-full pl-2 pr-3.5 py-1.5 text-[13px] font-medium",
                  active
                    ? "bg-[#0A0A0C] text-white shadow-[0_1px_3px_rgba(10,10,12,0.18)]"
                    : "vire-pill-surface text-[#3F3F46] hover:text-[#0A0A0C]"
                )}
              >
                <TokenIcon symbol={s.corridor} size={20} />
                <span>{s.corridor}</span>
              </button>
            );
          })}
        </div>

        {/* Unified Payout Flow Workspace */}
        <div className="vire-card overflow-hidden rounded-2xl">
          <div className="grid divide-y divide-black/[0.06] lg:grid-cols-12 lg:divide-x lg:divide-y-0">
            {/* LEFT (7 cols): 4-Step Verification & Payout Pipeline */}
            <div className="divide-y divide-black/[0.06] lg:col-span-7">
              {/* Stage 01 */}
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[11.5px] text-[#A1A1AA]">01</span>
                    <h3 className="text-[14px] font-medium text-[#0A0A0C]">
                      Automatic work check
                    </h3>
                  </div>
                  <Badge tone={isBlocked ? "destructive" : "positive"}>
                    {isBlocked ? "Rejected" : "Verified"}
                  </Badge>
                </div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-[#52525B]">
                  {isBlocked
                    ? "Duplicate link or unverified wallet detected — stopped before any funds moved."
                    : scenario.deliverableLabel}
                </p>
                <div className="mt-2.5 flex flex-col gap-1 font-mono text-[11.5px] text-[#71717A] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2.5">
                  <span className="min-w-0 truncate">{scenario.deliverableUrl}</span>
                  <span className="hidden sm:inline" aria-hidden="true">·</span>
                  <span className="shrink-0">{scenario.reviewCostLabel}</span>
                </div>
              </div>

              {/* Stage 02 */}
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[11.5px] text-[#A1A1AA]">02</span>
                    <h3 className="text-[14px] font-medium text-[#0A0A0C]">
                      Safety &amp; budget checks
                    </h3>
                  </div>
                  <Badge tone={isBlocked ? "destructive" : "neutral"}>
                    {isBlocked ? "3 Checks Failed" : "All Checks Passed"}
                  </Badge>
                </div>

                <div className="mt-3.5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {policyChecks.map((chk) => (
                    <div
                      key={chk.label}
                      className="flex items-center gap-2 text-[12.5px]"
                    >
                      {chk.passed ? (
                        <Check weight="bold" className="h-3.5 w-3.5 shrink-0 text-[#16A34A]" />
                      ) : (
                        <X weight="bold" className="h-3.5 w-3.5 shrink-0 text-[#DC2626]" />
                      )}
                      <span className={chk.passed ? "text-[#3F3F46]" : "font-medium text-[#B91C1C]"}>
                        {chk.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stage 03 */}
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[11.5px] text-[#A1A1AA]">03</span>
                    <h3 className="text-[14px] font-medium text-[#0A0A0C]">
                      Exact local currency swap
                    </h3>
                  </div>
                  <Badge tone={isBlocked ? "neutral" : "outline"}>
                    {isBlocked ? "Skipped" : "Exact amount"}
                  </Badge>
                </div>

                {isBlocked ? (
                  <p className="mt-2 text-[13px] text-[#71717A]">
                    No currency swap requested and no funds pulled from the treasury.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[12px] text-[#52525B] tabular-nums">
                    <span>
                      Rate:{" "}
                      <strong className="font-medium text-[#0A0A0C]">
                        {impliedRate ? `1 USDT = ${formatRate(impliedRate)} ${scenario.corridor}` : "Live quote"}
                      </strong>
                    </span>
                    <span>
                      Max spread:{" "}
                      <strong className="font-medium text-[#0A0A0C]">{maxSpreadPct}%</strong>
                    </span>
                    <span>
                      Leftover change:{" "}
                      <strong className="font-medium text-[#0A0A0C]">Auto-returned</strong>
                    </span>
                  </div>
                )}
              </div>

              {/* Stage 04 */}
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[11.5px] text-[#A1A1AA]">04</span>
                    <h3 className="text-[14px] font-medium text-[#0A0A0C]">
                      Instant payout &amp; receipt
                    </h3>
                  </div>
                  <span className="font-mono text-[11px] text-[#71717A]">
                    Celo Mainnet · Public receipt
                  </span>
                </div>
                <p className="mt-2 text-[13px] text-[#71717A]">
                  {isBlocked
                    ? "The rejection reason is saved to the public ledger so campaign owners can review it."
                    : `Sends exact ${localAmountDisplay} ${scenario.corridor} directly to the contributor's wallet with a permanent onchain receipt.`}
                </p>
              </div>
            </div>

            {/* RIGHT (5 cols): Visual Token-to-Token Payout Ticket */}
            <div className="flex flex-col justify-between bg-[#FAFAFB] p-5 sm:p-6 lg:col-span-5">
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-medium text-[#52525B]">
                    Payout preview
                  </span>
                  <Badge tone={isBlocked ? "destructive" : "positive"}>
                    {isBlocked ? "Blocked · $0 sent" : "Ready to pay"}
                  </Badge>
                </div>

                {/* Official Token Transfer Visual */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-2.5">
                  <div className="vire-card min-w-0 rounded-xl p-3 sm:p-3.5">
                    <div className="flex items-center gap-2">
                      <TokenIcon symbol="USDT" size={24} showChainBadge />
                      <div className="min-w-0">
                        <div className="truncate text-[10.5px] text-[#71717A] sm:text-[11px]">Treasury cost</div>
                        <div className="text-[12px] font-medium text-[#0A0A0C] sm:text-[12.5px]">USDT</div>
                      </div>
                    </div>
                    <div className="mt-2.5 truncate font-mono text-[17px] font-medium tracking-[-0.03em] text-[#0A0A0C] tabular-nums sm:mt-3 sm:text-[19px]">
                      {isBlocked ? "$0.00" : `$${usdtCostDisplay}`}
                    </div>
                  </div>

                  <div
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-medium shadow-[0_0_0_1px_rgba(10,10,12,0.08)] sm:h-8 sm:w-8",
                      isBlocked ? "text-[#DC2626]" : "text-[#0A0A0C]"
                    )}
                    aria-hidden="true"
                  >
                    {isBlocked ? <X weight="bold" className="h-3.5 w-3.5" /> : <ArrowRight weight="bold" className="h-3.5 w-3.5" />}
                  </div>

                  <div
                    className={cn(
                      "min-w-0 rounded-xl p-3 sm:p-3.5",
                      isBlocked
                        ? "bg-[#FEF2F2] shadow-[0_0_0_1px_rgba(220,38,38,0.18)]"
                        : "vire-card"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <TokenIcon symbol={scenario.corridor} size={24} showChainBadge />
                      <div className="min-w-0">
                        <div className="truncate text-[10.5px] text-[#71717A] sm:text-[11px]">Exact payout</div>
                        <div className="text-[12px] font-medium text-[#0A0A0C] sm:text-[12.5px]">
                          {scenario.corridor}
                        </div>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "mt-2.5 truncate font-mono text-[17px] font-medium tracking-[-0.03em] tabular-nums sm:mt-3 sm:text-[19px]",
                        isBlocked ? "text-[#B91C1C]" : "text-[#0A0A0C]"
                      )}
                    >
                      {isBlocked ? "0" : localAmountDisplay}
                    </div>
                  </div>
                </div>

                {/* Clean Key-Value Spec Rows */}
                <dl className="divide-y divide-black/[0.06] text-[12.5px]">
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="shrink-0 text-[#71717A]">Use case</dt>
                    <dd className="min-w-0 truncate text-right font-medium text-[#0A0A0C]">
                      {scenario.useCaseLabel}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="shrink-0 text-[#71717A]">Local currency</dt>
                    <dd className="min-w-0 truncate text-right text-[#0A0A0C]">
                      {scenarioMeta?.name ?? scenario.tokenName} ({scenarioMeta?.country ?? "Global"})
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="shrink-0 text-[#71717A]">Available liquidity</dt>
                    <dd className="shrink-0 font-mono text-[#0A0A0C] tabular-nums">
                      {makerDepth ? formatCompactUsd(makerDepth) : "Checking…"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="shrink-0 text-[#71717A]">Spending limits</dt>
                    <dd className="min-w-0 truncate text-right font-mono text-[#0A0A0C] tabular-nums">
                      Up to ${matchedCampaign?.maxPerPayoutUsdtFormatted ?? "6"} · {maxSpreadPct}% max spread
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="shrink-0 text-[#71717A]">Cash-out options</dt>
                    <dd className="min-w-0 truncate text-right text-[#0A0A0C]">{scenario.offrampRail}</dd>
                  </div>
                </dl>
              </div>

              <div className="mt-6 space-y-2.5">
                {isBlocked ? (
                  <Link
                    href="/ledger"
                    className={buttonVariants({ variant: "primary", size: "lg", className: "w-full" })}
                  >
                    View blocked claims
                    <ArrowRight weight="bold" className="h-4 w-4" />
                  </Link>
                ) : matchedCampaign ? (
                  <Link
                    href={`/claim?campaign=${encodeURIComponent(matchedCampaign.slug)}`}
                    className={buttonVariants({ variant: "primary", size: "lg", className: "w-full" })}
                  >
                    Claim in {scenario.corridor}
                    <ArrowRight weight="bold" className="h-4 w-4" />
                  </Link>
                ) : (
                  <Link
                    href="/console"
                    className={buttonVariants({ variant: "primary", size: "lg", className: "w-full" })}
                  >
                    Create {scenario.corridor} campaign
                    <ArrowRight weight="bold" className="h-4 w-4" />
                  </Link>
                )}

                <CopyButton
                  value={probeCurl}
                  label="Copy API check command"
                  toastMessage="API command copied"
                  className="h-9 w-full justify-center text-[12px]"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: Live Exchange Rates Table */}
      <section aria-labelledby="live-rates-heading" className="vire-enter vire-delay-2 space-y-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2
              id="live-rates-heading"
              className="text-[24px] font-medium tracking-[-0.03em] text-[#0A0A0C] sm:text-[26px]"
            >
              Live exchange rates
            </h2>
            <p className="mt-1 text-[14px] text-[#71717A]">
              Real-time local currency rates on Celo Mainnet
              {totalDepthUsd > 0 ? ` · ${formatCompactUsd(String(totalDepthUsd))} available liquidity` : ""}.
            </p>
          </div>

          <div className="flex shrink-0 flex-nowrap items-center gap-2">
            <div className="vire-well inline-flex shrink-0 items-center gap-0.5 rounded-full p-1">
              <button
                type="button"
                onClick={() => setCorridorFilter("all")}
                className={cn(
                  "vire-pressable whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium",
                  corridorFilter === "all"
                    ? "bg-white text-[#0A0A0C] shadow-[0_0_0_1px_rgba(10,10,12,0.07)]"
                    : "text-[#71717A] hover:text-[#0A0A0C]"
                )}
              >
                All ({DISPLAY_CORRIDORS.length})
              </button>
              <button
                type="button"
                onClick={() => setCorridorFilter("active")}
                className={cn(
                  "vire-pressable whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium",
                  corridorFilter === "active"
                    ? "bg-white text-[#0A0A0C] shadow-[0_0_0_1px_rgba(10,10,12,0.07)]"
                    : "text-[#71717A] hover:text-[#0A0A0C]"
                )}
              >
                Active
              </button>
            </div>

            <Button size="sm" variant="secondary" className="shrink-0" onClick={() => refetch()}>
              <ArrowClockwise className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="vire-card overflow-hidden rounded-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-black/[0.06] bg-[#FAFAFB] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#71717A]">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3.5 sm:px-4 lg:px-6">Currency</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-right sm:px-3 lg:px-4">
                    <span className="hidden lg:inline">Live </span>Rate (1 USDT)
                  </th>
                  <th className="hidden whitespace-nowrap px-3 py-3.5 text-right sm:table-cell lg:px-4">
                    Liquidity
                  </th>
                  <th className="hidden whitespace-nowrap px-4 py-3.5 lg:table-cell">
                    Cash-Out Options
                  </th>
                  <th className="hidden whitespace-nowrap px-3 py-3.5 sm:table-cell lg:px-4">Status</th>
                  <th className="hidden whitespace-nowrap px-4 py-3.5 text-right sm:table-cell lg:px-6">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.055]">
                {!liveData
                  ? DISPLAY_CORRIDORS.map((sym) => (
                      <tr key={sym}>
                        <td className="px-4 py-4 sm:px-5 lg:px-6">
                          <div className="flex items-center gap-3">
                            <div className="vire-skeleton h-8 w-8 rounded-full" />
                            <div className="space-y-1.5">
                              <div className="vire-skeleton h-3.5 w-28 rounded" />
                              <div className="vire-skeleton h-3 w-16 rounded" />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="vire-skeleton ml-auto h-4 w-24 rounded" />
                        </td>
                        <td className="hidden px-4 py-4 sm:table-cell">
                          <div className="vire-skeleton ml-auto h-4 w-20 rounded" />
                        </td>
                        <td className="hidden px-4 py-4 lg:table-cell">
                          <div className="vire-skeleton h-4 w-32 rounded" />
                        </td>
                        <td className="hidden px-4 py-4 sm:table-cell">
                          <div className="vire-skeleton h-4 w-16 rounded-full" />
                        </td>
                        <td className="hidden px-5 py-4 sm:table-cell lg:px-6">
                          <div className="vire-skeleton ml-auto h-7 w-20 rounded-full" />
                        </td>
                      </tr>
                    ))
                  : visibleCorridors.map((sym) => {
                      const c = liveBySymbol.get(sym);
                      const meta = ALL_CORRIDOR_META[sym];
                      const isLive = c?.status === "live" || c?.status === "degraded";
                      const depthRaw = c?.maxSellUsdtFormatted;
                      const depthNum = depthRaw ? Number(depthRaw.replace(/,/g, "")) : 0;
                      const depthPct =
                        depthNum > 0
                          ? Math.max(8, Math.min(100, Math.round((Math.log10(depthNum + 1) / Math.log10(maxDepthUsd + 1)) * 100)))
                          : 0;

                      return (
                        <tr
                          key={sym}
                          className="transition-colors duration-150 hover:bg-[#FAFAFB]"
                        >
                          <td className="whitespace-nowrap px-4 py-4 sm:px-4 lg:px-6">
                            <Link
                              href={`/campaigns?corridor=${encodeURIComponent(sym)}`}
                              className="group flex items-center gap-3"
                            >
                              <TokenIcon symbol={sym} size={32} showChainBadge />
                              <div className="min-w-0">
                                <div className="text-[13.5px] font-medium text-[#0A0A0C] group-hover:underline">
                                  {meta?.name ?? sym}
                                </div>
                                <div className="flex items-center gap-1.5 font-mono text-[11.5px] text-[#71717A] tabular-nums">
                                  <span
                                    className={cn(
                                      "h-1.5 w-1.5 rounded-full sm:hidden",
                                      isLive ? "bg-[#16A34A]" : "bg-[#D4D4D8]"
                                    )}
                                  />
                                  <span>
                                    {sym} · {meta?.country ?? ""}
                                  </span>
                                  {depthRaw && (
                                    <span className="text-[#A1A1AA] sm:hidden">
                                      · {formatCompactUsd(depthRaw)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </Link>
                          </td>

                          <td className="whitespace-nowrap px-4 py-4 text-right font-mono text-[13.5px] font-medium text-[#0A0A0C] tabular-nums sm:px-3 lg:px-4">
                            {isLive && c?.impliedRateLocalPerUsdt ? (
                              <>
                                {formatRate(c.impliedRateLocalPerUsdt)}{" "}
                                <span className="font-normal text-[#71717A]">
                                  {c.fiatCode}
                                </span>
                              </>
                            ) : (
                              <span className="font-normal text-[#A1A1AA]">—</span>
                            )}
                          </td>

                          <td
                            title={depthRaw ? `$${depthRaw} USDT available` : "Currently unavailable"}
                            className="hidden whitespace-nowrap px-3 py-4 text-right sm:table-cell lg:px-4"
                          >
                            <div className="inline-flex items-center gap-2.5 font-mono text-[13px] text-[#3F3F46] tabular-nums">
                              <span>{formatCompactUsd(depthRaw)}</span>
                              <span
                                aria-hidden="true"
                                className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-black/[0.06] lg:block"
                              >
                                <span
                                  className="block h-full rounded-full bg-[#0A0A0C]/65"
                                  style={{ width: `${depthPct}%` }}
                                />
                              </span>
                            </div>
                          </td>

                          <td className="hidden whitespace-nowrap px-4 py-4 text-[13px] text-[#52525B] lg:table-cell">
                            {meta?.rail ?? "—"}
                          </td>

                          <td className="hidden whitespace-nowrap px-3 py-4 sm:table-cell lg:px-4">
                            <span className="inline-flex items-center gap-2 text-[12.5px] font-medium text-[#3F3F46]">
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  isLive
                                    ? "bg-[#16A34A] ring-4 ring-[#16A34A]/15"
                                    : "bg-[#D4D4D8]"
                                )}
                              />
                              <span className={isLive ? "text-[#0A0A0C]" : "text-[#71717A]"}>
                                {isLive ? "Active" : "Unavailable"}
                              </span>
                            </span>
                          </td>

                          <td className="hidden whitespace-nowrap px-4 py-4 text-right sm:table-cell lg:px-6">
                            <Link
                              href={`/campaigns?corridor=${encodeURIComponent(sym)}`}
                              className={buttonVariants({ variant: "secondary", size: "sm" })}
                            >
                              Campaigns
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
