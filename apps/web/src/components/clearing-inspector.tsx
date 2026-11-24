"use client";

import {
  ArrowClockwise,
  ArrowRight,
  Check,
  X,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
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

interface LiveCorridorItem {
  symbol: string;
  name: string;
  countryName: string;
  fiatCode: string;
  decimals: number;
  maxSellUsdtFormatted: string | null;
  sampleBuyHuman: string;
  sampleTakerPaysUsdtFormatted: string | null;
  impliedRateLocalPerUsdt: number | null;
  previewStatus: string;
  feedStatus: string | null;
}

interface ScenarioConfig {
  id: "cNGN" | "wARS" | "wBRL" | "IDRX";
  slug: string;
  corridor: "cNGN" | "wARS" | "wBRL" | "IDRX";
  tokenName: string;
  deliverableLabel: string;
  deliverableUrl: string;
  aiScore: number;
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
    deliverableLabel: "Promo post with verified store tag, pricing, and referral link",
    deliverableUrl: "https://x.com/promoter/status/launch-deal-thread",
    aiScore: 92,
    localAmount: "3,000",
    fallbackUsdt: "2.07",
    offrampRail: "Busha · Quidax · Yellow Card",
  },
  {
    id: "wARS",
    slug: "latam-qa-regression-wars",
    corridor: "wARS",
    tokenName: "Argentine Peso",
    deliverableLabel: "Reproducible MiniPay checkout QA issue with logs and fix notes",
    deliverableUrl: "https://github.com/org/checkout/issues/148",
    aiScore: 89,
    localAmount: "2,500",
    fallbackUsdt: "1.43",
    offrampRail: "Ripio Portal (CBU)",
  },
  {
    id: "wBRL",
    slug: "brazil-ptbr-localization-wbrl",
    corridor: "wBRL",
    tokenName: "Brazilian Real",
    deliverableLabel: "Native PT-BR checkout localization PR preserving decimal notices",
    deliverableUrl: "https://github.com/org/docs/pull/91",
    aiScore: 94,
    localAmount: "12",
    fallbackUsdt: "2.04",
    offrampRail: "Ripio Portal (PIX)",
  },
  {
    id: "IDRX",
    slug: "indonesia-bahasa-qa-idrx",
    corridor: "IDRX",
    tokenName: "Indonesian Rupiah",
    deliverableLabel: "Bahasa localization diff & 2-decimal IDRX rounding verification",
    deliverableUrl: "https://github.com/org/docs/pull/64",
    aiScore: 91,
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
  attributionCode,
}: {
  campaigns: InspectorCampaign[];
  attributionCode: string;
}) {
  const [selectedId, setSelectedId] = useState<ScenarioConfig["id"]>("cNGN");
  const [mode, setMode] = useState<"valid" | "blocked">("valid");
  const [corridorFilter, setCorridorFilter] = useState<"all" | "active">("all");

  const { data: liveData, isFetching, refetch } = useQuery({
    queryKey: ["corridors-live-inspector"],
    queryFn: async () => {
      const res = await fetch("/api/corridors/live");
      if (!res.ok) throw new Error("Failed to load Textile FX quotes");
      return (await res.json()) as { fetchedAt: string; corridors: LiveCorridorItem[] };
    },
    refetchInterval: 30_000,
  });

  const liveBySymbol = useMemo(() => {
    const map = new Map<string, LiveCorridorItem>();
    for (const c of liveData?.corridors ?? []) {
      map.set(c.symbol, c);
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
    campaigns.find((c) => c.corridor === scenario.corridor) ??
    campaigns[0];
  const liveQuote = liveBySymbol.get(scenario.corridor);

  const isBlocked = mode === "blocked";
  const localAmountDisplay = matchedCampaign?.stage1RewardFormatted ?? scenario.localAmount;
  const usdtCostDisplay = liveQuote?.sampleTakerPaysUsdtFormatted
    ? Number(liveQuote.sampleTakerPaysUsdtFormatted).toFixed(2)
    : scenario.fallbackUsdt;
  const impliedRate = liveQuote?.impliedRateLocalPerUsdt ?? null;
  const makerDepth = liveQuote?.maxSellUsdtFormatted ?? null;
  const tokenDecimals =
    liveQuote?.decimals ??
    matchedCampaign?.localTokenDecimals ??
    ALL_CORRIDOR_META[scenario.corridor]?.decimals ??
    6;

  const policyChecks = isBlocked
    ? [
        { label: "Deliverable replay hash", passed: false },
        { label: "External wallet guard", passed: false },
        { label: `Score >= ${matchedCampaign?.minPassScore ?? 75}/100`, passed: false },
        { label: `Spread <= ${matchedCampaign?.maxSpreadBps ?? 250} bps`, passed: true },
        { label: `Per-payout <= $${matchedCampaign?.maxPerPayoutUsdtFormatted ?? "15"}`, passed: true },
        { label: `24h cap <= $${matchedCampaign?.dailyLimitUsdtFormatted ?? "100"}`, passed: true },
      ]
    : [
        { label: "Deliverable replay hash", passed: true },
        { label: "External wallet guard", passed: true },
        { label: `Score >= ${matchedCampaign?.minPassScore ?? 75}/100`, passed: true },
        { label: `Spread <= ${matchedCampaign?.maxSpreadBps ?? 250} bps`, passed: true },
        { label: `Per-payout <= $${matchedCampaign?.maxPerPayoutUsdtFormatted ?? "15"}`, passed: true },
        { label: `24h cap <= $${matchedCampaign?.dailyLimitUsdtFormatted ?? "100"}`, passed: true },
      ];

  const probeCurl = `curl -i -X POST https://usevire.xyz/api/x402/verify \\
  -H "Content-Type: application/json" \\
  -d '{"deliverableUrl":"${scenario.deliverableUrl}","deliverableType":"${matchedCampaign?.deliverableType ?? "promo_post"}","corridor":"${scenario.corridor}","rewardLocalHuman":"${localAmountDisplay.replace(/,/g, "")}"}'`;

  const visibleCorridors = DISPLAY_CORRIDORS.filter((sym) => {
    if (corridorFilter === "all") return true;
    return liveBySymbol.get(sym)?.previewStatus === "preview";
  });

  return (
    <div className="space-y-16">
      {/* SECTION 1: Interactive Autonomous Clearing Flow (Aave Pro × Morpho Precision) */}
      <section aria-labelledby="clearing-flow-heading" className="vire-enter vire-delay-1 space-y-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2
              id="clearing-flow-heading"
              className="text-[24px] font-medium tracking-[-0.03em] text-[#0A0A0C] sm:text-[26px]"
            >
              How Vire clears a payout
            </h2>
            <p className="mt-1 text-[14px] text-[#71717A]">
              Select a corridor or simulate a Policy Gate block to inspect live execution guardrails.
            </p>
          </div>

          {/* Valid vs Blocked Mode Capsule */}
          <div className="vire-well inline-flex items-center gap-0.5 self-start rounded-full p-1 sm:self-auto">
            <button
              type="button"
              onClick={() => setMode("valid")}
              className={cn(
                "vire-pressable inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium",
                !isBlocked
                  ? "bg-white text-[#0A0A0C] shadow-[0_0_0_1px_rgba(10,10,12,0.07),0_1px_2px_rgba(10,10,12,0.06)]"
                  : "text-[#71717A] hover:text-[#0A0A0C]"
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" />
              Valid payout
            </button>
            <button
              type="button"
              onClick={() => setMode("blocked")}
              className={cn(
                "vire-pressable inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium",
                isBlocked
                  ? "bg-white text-[#B91C1C] shadow-[0_0_0_1px_rgba(220,38,38,0.18),0_1px_2px_rgba(10,10,12,0.05)]"
                  : "text-[#71717A] hover:text-[#0A0A0C]"
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#DC2626]" />
              Policy blocked
            </button>
          </div>
        </div>

        {/* Corridor Selector Pills with Official Colored Token Icons */}
        <div
          role="tablist"
          aria-label="Corridor scenarios"
          className="flex flex-wrap items-center gap-2"
        >
          {SCENARIOS.map((s) => {
            const active = s.id === scenario.id;
            const meta = ALL_CORRIDOR_META[s.corridor];
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
                <span
                  className={cn(
                    "font-mono text-[11px] tabular-nums",
                    active ? "text-white/65" : "text-[#A1A1AA]"
                  )}
                >
                  {meta?.decimals}dp
                </span>
              </button>
            );
          })}
        </div>

        {/* Unified Institutional Clearing Workspace */}
        <div className="vire-card overflow-hidden rounded-2xl">
          <div className="grid divide-y divide-black/[0.06] lg:grid-cols-12 lg:divide-x lg:divide-y-0">
            {/* LEFT (7 cols): 4-Stage Autonomous Clearing Pipeline */}
            <div className="divide-y divide-black/[0.06] lg:col-span-7">
              {/* Stage 01 */}
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[11.5px] text-[#A1A1AA]">01</span>
                    <h3 className="text-[14px] font-medium text-[#0A0A0C]">
                      Deliverable audit via paid x402
                    </h3>
                  </div>
                  <Badge tone={isBlocked ? "destructive" : "positive"}>
                    {isBlocked ? "Score 38/100" : `Score ${scenario.aiScore}/100`}
                  </Badge>
                </div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-[#52525B]">
                  {isBlocked
                    ? "Duplicate claim hash detected on an unlinked internal wallet; halted before any vault release."
                    : scenario.deliverableLabel}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-[#71717A]">
                  <span className="truncate">{scenario.deliverableUrl}</span>
                  <span>·</span>
                  <span>usebuy.ai ($0.01 USDT)</span>
                </div>
              </div>

              {/* Stage 02 */}
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[11.5px] text-[#A1A1AA]">02</span>
                    <h3 className="text-[14px] font-medium text-[#0A0A0C]">
                      Deterministic Policy Gate
                    </h3>
                  </div>
                  <Badge tone={isBlocked ? "destructive" : "neutral"}>
                    {isBlocked ? "3 Rules Failed" : "7/7 Passed"}
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
                      Exact-output Textile FX v2 swap
                    </h3>
                  </div>
                  <Badge tone={isBlocked ? "neutral" : "outline"}>
                    {isBlocked ? "Skipped" : `Exact · ${tokenDecimals}dp`}
                  </Badge>
                </div>

                {isBlocked ? (
                  <p className="mt-2 text-[13px] text-[#71717A]">
                    No firm RFQ requested and no USDT pulled from VireVault. Zero onchain movement.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[12px] text-[#52525B] tabular-nums">
                    <span>
                      Rate:{" "}
                      <strong className="font-medium text-[#0A0A0C]">
                        {impliedRate ? `1 USDT = ${formatRate(impliedRate)} ${scenario.corridor}` : "Live RFQ"}
                      </strong>
                    </span>
                    <span>
                      Max spread:{" "}
                      <strong className="font-medium text-[#0A0A0C]">
                        {matchedCampaign?.maxSpreadBps ?? 250} bps
                      </strong>
                    </span>
                    <span>
                      Dust refund:{" "}
                      <strong className="font-medium text-[#0A0A0C]">Auto</strong>
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
                      Tagged settlement &amp; audit receipt
                    </h3>
                  </div>
                  <span className="font-mono text-[11px] text-[#71717A]">
                    ERC-8021 · {attributionCode}
                  </span>
                </div>
                <p className="mt-2 text-[13px] text-[#71717A]">
                  {isBlocked
                    ? "Rejection reason is logged immutably to the public audit ledger for merchant review."
                    : `Transfers exact ${localAmountDisplay} ${scenario.corridor} to the external contributor and records an immutable VireVault receipt.`}
                </p>
              </div>
            </div>

            {/* RIGHT (5 cols): Visual Token-to-Token Clearing Ticket */}
            <div className="flex flex-col justify-between bg-[#FAFAFB] p-5 sm:p-6 lg:col-span-5">
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-medium text-[#52525B]">
                    Clearing preview
                  </span>
                  <Badge tone={isBlocked ? "destructive" : "positive"}>
                    {isBlocked ? "Blocked · $0 moved" : "Ready to clear"}
                  </Badge>
                </div>

                {/* Official Token Transfer Visual */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                  <div className="vire-card rounded-xl p-3.5">
                    <div className="flex items-center gap-2">
                      <TokenIcon symbol="USDT" size={26} showChainBadge />
                      <div className="min-w-0">
                        <div className="text-[11px] text-[#71717A]">Vault debit</div>
                        <div className="text-[12.5px] font-medium text-[#0A0A0C]">USDT</div>
                      </div>
                    </div>
                    <div className="mt-3 font-mono text-[19px] font-medium tracking-[-0.03em] text-[#0A0A0C] tabular-nums">
                      {isBlocked ? "$0.00" : `$${usdtCostDisplay}`}
                    </div>
                  </div>

                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-medium shadow-[0_0_0_1px_rgba(10,10,12,0.08)]",
                      isBlocked ? "text-[#DC2626]" : "text-[#0A0A0C]"
                    )}
                    aria-hidden="true"
                  >
                    {isBlocked ? <X weight="bold" className="h-3.5 w-3.5" /> : <ArrowRight weight="bold" className="h-3.5 w-3.5" />}
                  </div>

                  <div
                    className={cn(
                      "rounded-xl p-3.5",
                      isBlocked
                        ? "bg-[#FEF2F2] shadow-[0_0_0_1px_rgba(220,38,38,0.18)]"
                        : "vire-card"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <TokenIcon symbol={scenario.corridor} size={26} showChainBadge />
                      <div className="min-w-0">
                        <div className="text-[11px] text-[#71717A]">Exact payout</div>
                        <div className="text-[12.5px] font-medium text-[#0A0A0C]">
                          {scenario.corridor}
                        </div>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "mt-3 font-mono text-[19px] font-medium tracking-[-0.03em] tabular-nums",
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
                    <dt className="text-[#71717A]">Partner</dt>
                    <dd className="truncate font-medium text-[#0A0A0C]">
                      {matchedCampaign?.partnerName ?? "Launch Partner"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-[#71717A]">Token precision</dt>
                    <dd className="font-mono text-[#0A0A0C] tabular-nums">
                      {tokenDecimals} decimals ({scenario.corridor})
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-[#71717A]">Live maker depth</dt>
                    <dd className="font-mono text-[#0A0A0C] tabular-nums">
                      {makerDepth ? `${formatCompactUsd(makerDepth)} USDT` : "Checking…"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-[#71717A]">Vault limits</dt>
                    <dd className="font-mono text-[#0A0A0C] tabular-nums">
                      &le; ${matchedCampaign?.maxPerPayoutUsdtFormatted ?? "15"}/tx · &le;{" "}
                      {matchedCampaign?.maxSpreadBps ?? 250} bps
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-[#71717A]">Off-ramp rail</dt>
                    <dd className="truncate text-[#0A0A0C]">{scenario.offrampRail}</dd>
                  </div>
                </dl>
              </div>

              <div className="mt-6 space-y-2.5">
                {isBlocked ? (
                  <Link
                    href="/ledger"
                    className={buttonVariants({ variant: "primary", size: "lg", className: "w-full" })}
                  >
                    Inspect rejected ledger
                    <ArrowRight weight="bold" className="h-4 w-4" />
                  </Link>
                ) : (
                  <Link
                    href={`/claim?campaign=${encodeURIComponent(matchedCampaign?.slug ?? scenario.slug)}`}
                    className={buttonVariants({ variant: "primary", size: "lg", className: "w-full" })}
                  >
                    Submit {scenario.corridor} claim
                    <ArrowRight weight="bold" className="h-4 w-4" />
                  </Link>
                )}

                <CopyButton
                  value={probeCurl}
                  label="Copy x402 verification probe"
                  toastMessage="x402 cURL copied"
                  className="h-9 w-full justify-center text-[12px]"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: Aave Pro-Style Live FX Corridors Market Table */}
      <section aria-labelledby="live-rates-heading" className="vire-enter vire-delay-2 space-y-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2
              id="live-rates-heading"
              className="text-[24px] font-medium tracking-[-0.03em] text-[#0A0A0C] sm:text-[26px]"
            >
              Live FX corridors
            </h2>
            <p className="mt-1 text-[14px] text-[#71717A]">
              Real-time Textile FX v2 orderbooks on Celo Mainnet
              {totalDepthUsd > 0 ? ` · ${formatCompactUsd(String(totalDepthUsd))} aggregate maker depth` : ""}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="vire-well inline-flex items-center gap-0.5 rounded-full p-1">
              <button
                type="button"
                onClick={() => setCorridorFilter("all")}
                className={cn(
                  "vire-pressable rounded-full px-3 py-1 text-[12px] font-medium",
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
                  "vire-pressable rounded-full px-3 py-1 text-[12px] font-medium",
                  corridorFilter === "active"
                    ? "bg-white text-[#0A0A0C] shadow-[0_0_0_1px_rgba(10,10,12,0.07)]"
                    : "text-[#71717A] hover:text-[#0A0A0C]"
                )}
              >
                Active
              </button>
            </div>

            <Button size="sm" variant="secondary" onClick={() => refetch()}>
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
                  <th className="px-4 py-3.5 sm:px-6">Asset</th>
                  <th className="px-4 py-3.5 text-right">Live Rate (1 USDT)</th>
                  <th className="hidden px-4 py-3.5 text-right sm:table-cell">Maker Depth</th>
                  <th className="hidden px-4 py-3.5 md:table-cell">Off-Ramp Rail</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="hidden px-6 py-3.5 text-right sm:table-cell">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.055]">
                {!liveData
                  ? DISPLAY_CORRIDORS.map((sym) => (
                      <tr key={sym}>
                        <td className="px-4 py-4 sm:px-6">
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
                        <td className="hidden px-4 py-4 md:table-cell">
                          <div className="vire-skeleton h-4 w-32 rounded" />
                        </td>
                        <td className="px-4 py-4">
                          <div className="vire-skeleton h-4 w-16 rounded-full" />
                        </td>
                        <td className="hidden px-6 py-4 sm:table-cell">
                          <div className="vire-skeleton ml-auto h-7 w-20 rounded-full" />
                        </td>
                      </tr>
                    ))
                  : visibleCorridors.map((sym) => {
                      const c = liveBySymbol.get(sym);
                      const meta = ALL_CORRIDOR_META[sym];
                      const isLive = c?.previewStatus === "preview";
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
                          <td className="whitespace-nowrap px-4 py-4 sm:px-6">
                            <Link
                              href={`/campaigns?corridor=${encodeURIComponent(sym)}`}
                              className="group flex items-center gap-3"
                            >
                              <TokenIcon symbol={sym} size={32} showChainBadge />
                              <div className="min-w-0">
                                <div className="text-[13.5px] font-medium text-[#0A0A0C] group-hover:underline">
                                  {meta?.name ?? c?.name ?? sym}
                                </div>
                                <div className="font-mono text-[11.5px] text-[#71717A] tabular-nums">
                                  {sym} · {c?.decimals ?? meta?.decimals ?? "—"}dp
                                </div>
                              </div>
                            </Link>
                          </td>

                          <td className="whitespace-nowrap px-4 py-4 text-right font-mono text-[13.5px] font-medium text-[#0A0A0C] tabular-nums">
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
                            title={depthRaw ? `$${depthRaw} USDT available` : "No active depth"}
                            className="hidden whitespace-nowrap px-4 py-4 text-right sm:table-cell"
                          >
                            <div className="inline-flex items-center gap-2.5 font-mono text-[13px] text-[#3F3F46] tabular-nums">
                              <span>{formatCompactUsd(depthRaw)}</span>
                              <span
                                aria-hidden="true"
                                className="h-1.5 w-12 overflow-hidden rounded-full bg-black/[0.06]"
                              >
                                <span
                                  className="block h-full rounded-full bg-[#0A0A0C]/65"
                                  style={{ width: `${depthPct}%` }}
                                />
                              </span>
                            </div>
                          </td>

                          <td className="hidden whitespace-nowrap px-4 py-4 text-[13px] text-[#52525B] md:table-cell">
                            {meta?.rail ?? "—"}
                          </td>

                          <td className="whitespace-nowrap px-4 py-4">
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
                                {isLive ? "Active" : "No makers"}
                              </span>
                            </span>
                          </td>

                          <td className="hidden whitespace-nowrap px-6 py-4 text-right sm:table-cell">
                            <Link
                              href={`/campaigns?corridor=${encodeURIComponent(sym)}`}
                              className={buttonVariants({ variant: "secondary", size: "sm" })}
                            >
                              Missions
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
