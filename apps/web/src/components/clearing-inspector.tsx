"use client";

import { ArrowClockwise, ArrowRight, ArrowUpRight, Check, Copy, X } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import type { CorridorLiveStatus } from "@vire/shared";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  id: string;
  code: string;
  label: string;
  corridor: string;
  rejected: boolean;
  sampleDeliverable: string;
  score: number;
  verdictSummary: string;
  failedRule?: string;
  failedDetail?: string;
}

const SCENARIOS: ScenarioConfig[] = [
  {
    id: "cngn",
    code: "01",
    label: "Lagos Promo · cNGN",
    corridor: "cNGN",
    rejected: false,
    sampleDeliverable: "https://x.com/promoter/status/black-friday-deal-thread",
    score: 92,
    verdictSummary: "Public promo post verified with store tag, pricing, and referral link.",
  },
  {
    id: "wars",
    code: "02",
    label: "LatAm QA · wARS",
    corridor: "wARS",
    rejected: false,
    sampleDeliverable: "https://github.com/org/app/issues/142",
    score: 88,
    verdictSummary: "Reproducible bug report with environment trace and patch notes verified.",
  },
  {
    id: "idrx",
    code: "03",
    label: "Indonesia · IDRX (2dp)",
    corridor: "IDRX",
    rejected: false,
    sampleDeliverable: "https://github.com/org/docs/pull/89",
    score: 94,
    verdictSummary: "Bahasa localization PR verified; exact 2-decimal IDRX scaling enforced.",
  },
  {
    id: "rejected",
    code: "04",
    label: "Blocked Claim · Policy Gate",
    corridor: "cNGN",
    rejected: true,
    sampleDeliverable: "https://x.com/anon/status/replayed-link-001",
    score: 41,
    verdictSummary: "Low-evidence post + duplicate deliverable hash detected before vault release.",
    failedRule: "REPLAY_AND_MIN_SCORE",
    failedDetail: "Score 41/100 below minScore 75 and deliverable hash already claimed.",
  },
];

const CORRIDOR_ORDER = ["cNGN", "wARS", "wBRL", "IDRX", "wMXN"] as const;

const OFFRAMP_BY_CORRIDOR: Record<string, string> = {
  cNGN: "Busha · Quidax · Yellow Card",
  wARS: "Ripio Portal (CBU / CVU)",
  wBRL: "Ripio Portal (PIX)",
  IDRX: "IDRX Direct Bank Redeem",
  wMXN: "Ripio Portal (CLABE)",
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

export function ClearingInspector({
  campaigns,
}: {
  campaigns: InspectorCampaign[];
}) {
  const [scenarioId, setScenarioId] = useState<string>("cngn");
  const [copiedCurl, setCopiedCurl] = useState(false);

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

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0]!;
  const campaign =
    campaigns.find((c) => c.corridor === scenario.corridor) ?? campaigns[0];
  const liveCorridor = liveMap.get(scenario.corridor);

  const localAmountNum = parseNumeric(campaign?.stage1RewardFormatted);
  const liveRate = liveCorridor?.impliedRateLocalPerUsdt ?? null;
  const impliedUsdt =
    liveRate && liveRate > 0 && localAmountNum > 0 ? localAmountNum / liveRate : null;
  const depthNum = parseNumeric(liveCorridor?.maxSellUsdtFormatted);
  const isCorridorLive = liveCorridor?.status === "live";

  const policyRules = [
    { name: "Deliverable replay hash", passed: !scenario.rejected },
    { name: "Non-team external wallet", passed: true },
    { name: `Score >= ${campaign?.minPassScore ?? 75}/100`, passed: !scenario.rejected },
    { name: `Spread <= ${campaign?.maxSpreadBps ?? 250} bps`, passed: true },
    { name: `Per-payout <= $${campaign?.maxPerPayoutUsdtFormatted ?? "15"}`, passed: true },
    { name: `24h vault cap <= $${campaign?.dailyLimitUsdtFormatted ?? "100"}`, passed: true },
    { name: "Textile maker depth", passed: isCorridorLive || isLoading },
  ];

  async function handleCopyProbe() {
    if (!campaign) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "https://usevire.xyz";
    const cmd = `curl -i -X POST ${origin}/api/x402/verify \\
  -H "Content-Type: application/json" \\
  -d '{"deliverableUrl":"${scenario.sampleDeliverable}","deliverableType":"${campaign.deliverableType}","criteria":"${campaign.stage1Title}","corridor":"${campaign.corridor}","rewardLocalHuman":"${campaign.stage1RewardFormatted.replace(/,/g, "")}"}'`;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCurl(true);
      toast.success(`Copied x402 verification probe (${campaign.corridor})`);
      setTimeout(() => setCopiedCurl(false), 1600);
    } catch {
      toast.error("Unable to access clipboard");
    }
  }

  return (
    <div className="space-y-12">
      {/* BAND A: Interactive 4-Stage Agent Clearing Inspector */}
      <section aria-labelledby="agent-clearing-heading" className="space-y-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#68665F]">
              Autonomous Clearing Loop
            </p>
            <h2
              id="agent-clearing-heading"
              className="mt-1 font-serif text-2xl font-normal tracking-[-0.02em] text-[#121210] sm:text-[30px]"
            >
              How Vire&apos;s agent verifies work and clears exact local FX.
            </h2>
          </div>

          <span className="font-mono text-[11px] text-[#68665F]">
            Select a scenario to inspect live guardrails &amp; quotes
          </span>
        </div>

        <div className="vire-sheet overflow-hidden rounded-[6px]">
          {/* Scenario Selector Strip */}
          <div
            role="tablist"
            aria-label="Clearing scenarios"
            className="grid grid-cols-1 divide-y divide-[#E4E2DC] border-b border-[#E4E2DC] bg-[#FAF9F6] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x"
          >
            {SCENARIOS.map((item) => {
              const active = item.id === scenario.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setScenarioId(item.id)}
                  className={cn(
                    "vire-pressable relative flex items-center justify-between gap-2 px-4 py-3 text-left transition-colors",
                    active
                      ? "bg-white text-[#121210]"
                      : "text-[#68665F] hover:bg-[#F3F1EC] hover:text-[#121210]"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-[11px] text-[#8D8A82]">{item.code}</span>
                    <span className="truncate text-xs font-medium">{item.label}</span>
                  </span>
                  {item.rejected && (
                    <span className="font-mono text-[10px] font-medium uppercase text-[#B42318]">
                      Deny
                    </span>
                  )}
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-0 h-[2px] bg-[#121210]"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* 2-Column Split: 4-Stage Agent Pipeline Left + Clearing Statement Receipt Right */}
          <div className="grid divide-y divide-[#E4E2DC] lg:grid-cols-12 lg:divide-x lg:divide-y-0">
            {/* Left (7 cols): 4-Stage Agent Trace */}
            <div className="min-w-0 divide-y divide-[#E4E2DC] lg:col-span-7">
              {/* Stage 01 */}
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[11px] font-medium text-[#787670]">01</span>
                    <h3 className="text-[13px] font-semibold text-[#121210]">
                      Deliverable audit via paid x402
                    </h3>
                  </div>
                  <Badge tone={scenario.rejected ? "destructive" : "outline"}>
                    SCORE {scenario.score}/100
                  </Badge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#4F4E4A]">
                  {scenario.verdictSummary}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-[#787670]">
                  <span className="truncate">{scenario.sampleDeliverable}</span>
                  <span>·</span>
                  <span>usebuy.ai (Cencori LLM + Chainstack · $0.01)</span>
                </div>
              </div>

              {/* Stage 02 */}
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[11px] font-medium text-[#787670]">02</span>
                    <h3 className="text-[13px] font-semibold text-[#121210]">
                      7-rule deterministic Policy Gate
                    </h3>
                  </div>
                  <Badge tone={scenario.rejected ? "destructive" : "ink"}>
                    {scenario.rejected ? "BLOCKED" : "7/7 PASSED"}
                  </Badge>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  {policyRules.map((rule) => (
                    <div
                      key={rule.name}
                      className="flex items-center gap-2 font-mono text-[11px]"
                    >
                      {rule.passed ? (
                        <Check weight="bold" className="h-3 w-3 shrink-0 text-[#121210]" />
                      ) : (
                        <X weight="bold" className="h-3 w-3 shrink-0 text-[#B42318]" />
                      )}
                      <span
                        className={
                          rule.passed ? "text-[#4F4E4A]" : "font-medium text-[#B42318]"
                        }
                      >
                        {rule.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stage 03 */}
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[11px] font-medium text-[#787670]">03</span>
                    <h3 className="text-[13px] font-semibold text-[#121210]">
                      Exact-output Textile FX v2 conversion
                    </h3>
                  </div>
                  <span className="font-mono text-[11px] text-[#68665F] tabular-nums">
                    {scenario.rejected
                      ? "SKIPPED · VAULT UNTOUCHED"
                      : liveRate
                        ? `1 USDT = ${liveRate.toLocaleString(undefined, {
                            maximumFractionDigits: liveRate < 50 ? 3 : 2,
                          })} ${liveCorridor?.fiatCode ?? ""}`
                        : "Fetching live rate…"}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#4F4E4A]">
                  {scenario.rejected
                    ? "Execution halts at Policy Gate. Zero USDT leaves VireVault, and the rejection reason is recorded publicly in the Audit Ledger."
                    : `Quotes firm buyAmount (${campaign?.stage1RewardFormatted} ${scenario.corridor}) with ERC-8021 builderCodes. Contributor receives the exact local amount; unused USDT dust auto-refunds to VireVault.`}
                </p>
              </div>

              {/* Stage 04 */}
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[11px] font-medium text-[#787670]">04</span>
                    <h3 className="text-[13px] font-semibold text-[#121210]">
                      Direct local payout &amp; ERC-8004 reputation
                    </h3>
                  </div>
                  <span className="font-mono text-[11px] text-[#68665F]">
                    {scenario.rejected ? "LOGGED ON /LEDGER" : OFFRAMP_BY_CORRIDOR[scenario.corridor]}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#4F4E4A]">
                  {scenario.rejected
                    ? "Every failed claim stays publicly auditable so merchants and judges can verify autonomous enforcement."
                    : "Transfers local stablecoin directly to the contributor's Celo wallet, surfaces prefilled local off-ramp rails, and unlocks 1-click ERC-8004 giveFeedback()."}
                </p>
              </div>
            </div>

            {/* Right (5 cols): Swiss Bank Clearing Statement Preview */}
            <div className="flex min-w-0 flex-col justify-between bg-[#F3F1EC]/70 p-5 sm:p-6 lg:col-span-5">
              <div className="space-y-5">
                <div className="flex items-center justify-between border-b border-[#DEDBD3] pb-3">
                  <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-[#68665F]">
                    Clearing Statement · Preview
                  </span>
                  <Badge tone={scenario.rejected ? "destructive" : "ink"}>
                    {scenario.rejected ? "DENIED" : "APPROVED"}
                  </Badge>
                </div>

                {/* Statement Primary Figure */}
                <div>
                  <div className="font-mono text-[11px] text-[#68665F]">
                    {scenario.rejected ? "Treasury release" : "Exact recipient payout"}
                  </div>
                  <div
                    className={cn(
                      "mt-1 font-mono text-3xl font-semibold tracking-[-0.03em] tabular-nums",
                      scenario.rejected ? "text-[#B42318]" : "text-[#121210]"
                    )}
                  >
                    {scenario.rejected
                      ? "$0.00 USDT"
                      : `${campaign?.stage1RewardFormatted ?? "—"} ${scenario.corridor}`}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-[#68665F] tabular-nums">
                    {scenario.rejected
                      ? `Blocked rule: ${scenario.failedRule}`
                      : impliedUsdt !== null
                        ? `Est. vault draw: ~$${impliedUsdt.toFixed(2)} USDT · unused dust refunded`
                        : "Live Textile FX quote loading…"}
                  </p>
                </div>

                {/* Structured Clearing Spec Lines */}
                <dl className="divide-y divide-[#DEDBD3] border-y border-[#DEDBD3] text-xs">
                  {[
                    ["Partner", campaign?.partnerName ?? "—"],
                    ["Campaign", campaign?.stage1Title.replace(/^Stage \d+\s*[—-]\s*/i, "") ?? "—"],
                    [
                      "Token precision",
                      `${campaign?.localTokenDecimals ?? 6} decimals (${scenario.corridor})`,
                    ],
                    [
                      "Live maker depth",
                      isLoading
                        ? "Loading…"
                        : depthNum > 0
                          ? `${formatCompactUsd(depthNum)} USDT available`
                          : "No makers online",
                    ],
                    [
                      "Onchain guardrails",
                      `<= $${campaign?.maxPerPayoutUsdtFormatted ?? "15"}/tx · <= ${campaign?.maxSpreadBps ?? 250} bps`,
                    ],
                    ["Off-ramp rail", OFFRAMP_BY_CORRIDOR[scenario.corridor] ?? "Local off-ramp"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3 py-2.5">
                      <dt className="shrink-0 text-[#68665F]">{k}</dt>
                      <dd className="truncate text-right font-mono text-[11.5px] font-medium text-[#121210] tabular-nums">
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="mt-6 space-y-2.5">
                {scenario.rejected ? (
                  <Link
                    href="/ledger"
                    className={buttonVariants({ variant: "primary", size: "lg", className: "w-full" })}
                  >
                    Inspect Policy Gate log
                    <ArrowRight weight="bold" className="h-4 w-4" />
                  </Link>
                ) : (
                  <Link
                    href={`/claim?campaign=${encodeURIComponent(campaign?.slug ?? "")}&stage=1`}
                    className={buttonVariants({ variant: "primary", size: "lg", className: "w-full" })}
                  >
                    Submit {scenario.corridor} claim live
                    <ArrowRight weight="bold" className="h-4 w-4" />
                  </Link>
                )}

                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={handleCopyProbe}
                  className="w-full font-mono text-xs"
                >
                  {copiedCurl ? (
                    <>
                      <Check weight="bold" className="h-3.5 w-3.5" />
                      Copied x402 probe
                    </>
                  ) : (
                    <>
                      <Copy weight="regular" className="h-3.5 w-3.5" />
                      Copy x402 verification probe
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BAND B: Live Bank-Style Textile FX Corridor Rate Board */}
      <section aria-labelledby="fx-rate-board-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#68665F]">
              Live Textile FX v2 Liquidity
            </p>
            <h2
              id="fx-rate-board-heading"
              className="mt-1 font-serif text-2xl font-normal tracking-[-0.02em] text-[#121210] sm:text-[28px]"
            >
              Active local-currency corridors on Celo Mainnet.
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {liveData?.asOf && (
              <span className="font-mono text-[11px] text-[#68665F] tabular-nums">
                As of{" "}
                {new Date(liveData.asOf).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            )}
            <button
              type="button"
              onClick={() => refetch()}
              className="vire-pressable inline-flex items-center gap-1.5 rounded-[4px] border border-[#D5D2C9] bg-white px-2.5 py-1 font-mono text-[11px] text-[#4F4E4A] hover:border-[#121210] hover:text-[#121210]"
            >
              <ArrowClockwise className={cn("h-3 w-3", isFetching && "animate-spin")} />
              Refresh rates
            </button>
          </div>
        </div>

        <div className="vire-sheet overflow-hidden rounded-[6px]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E4E2DC] bg-[#F3F1EC]/70 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[#68665F]">
                <tr>
                  <th className="px-4 py-3 font-medium sm:px-5">Pair</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">Market</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">Precision</th>
                  <th className="px-4 py-3 text-right font-medium">Live Rate (1 USDT)</th>
                  <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">Maker Depth</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Off-Ramp Rail</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="hidden px-5 py-3 text-right font-medium sm:table-cell">Missions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E2DC]">
                {isLoading
                  ? CORRIDOR_ORDER.map((sym) => (
                      <tr key={sym}>
                        <td className="px-5 py-3.5 font-mono font-medium">USDT / {sym}</td>
                        <td colSpan={7} className="px-4 py-3.5">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      </tr>
                    ))
                  : CORRIDOR_ORDER.map((sym) => {
                      const c = liveMap.get(sym);
                      const isLive = c?.status === "live";
                      const depth = parseNumeric(c?.maxSellUsdtFormatted);

                      return (
                        <tr
                          key={sym}
                          className="transition-colors hover:bg-[#FAF9F6]"
                        >
                          <td className="whitespace-nowrap px-4 py-3.5 font-mono font-semibold text-[#121210] sm:px-5">
                            <Link
                              href={`/campaigns?corridor=${encodeURIComponent(sym)}`}
                              className="hover:underline"
                            >
                              USDT / {sym}
                            </Link>
                          </td>
                          <td className="hidden whitespace-nowrap px-4 py-3.5 text-[#4F4E4A] sm:table-cell">
                            {c?.countryName ?? sym}
                          </td>
                          <td className="hidden whitespace-nowrap px-4 py-3.5 font-mono text-[#68665F] tabular-nums sm:table-cell">
                            {c?.decimals ?? "—"}dp
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono font-semibold text-[#121210] tabular-nums">
                            {c?.impliedRateLocalPerUsdt !== null &&
                            c?.impliedRateLocalPerUsdt !== undefined
                              ? `${c.impliedRateLocalPerUsdt.toLocaleString(undefined, {
                                  maximumFractionDigits: c.impliedRateLocalPerUsdt < 50 ? 3 : 2,
                                })} ${c.fiatCode}`
                              : "—"}
                          </td>
                          <td
                            title={
                              c?.maxSellUsdtFormatted
                                ? `$${c.maxSellUsdtFormatted} USDT maker depth`
                                : "$0 depth"
                            }
                            className="hidden whitespace-nowrap px-4 py-3.5 text-right font-mono text-[#4F4E4A] tabular-nums sm:table-cell"
                          >
                            {formatCompactUsd(depth)}
                          </td>
                          <td className="hidden whitespace-nowrap px-4 py-3.5 text-[#68665F] md:table-cell">
                            {OFFRAMP_BY_CORRIDOR[sym]}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 font-mono text-[11px]">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1.5",
                                isLive ? "text-[#121210]" : "text-[#8D8A82]"
                              )}
                            >
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  isLive ? "bg-[#121210]" : "border border-[#A8A49A]"
                                )}
                              />
                              {isLive ? "Active" : "No makers"}
                            </span>
                          </td>
                          <td className="hidden whitespace-nowrap px-5 py-3.5 text-right sm:table-cell">
                            <Link
                              href={`/campaigns?corridor=${encodeURIComponent(sym)}`}
                              className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-[#121210] hover:underline"
                            >
                              View
                              <ArrowUpRight className="h-3 w-3" />
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
