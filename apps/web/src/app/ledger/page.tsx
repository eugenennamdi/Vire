"use client";

import {
  ArrowClockwise,
  ArrowUpRight,
  ShieldCheck,
  ShieldWarning,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Select } from "@/components/ui/field";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, truncateMiddle } from "@/lib/utils";

interface LedgerData {
  metrics: {
    totalCompletedSettlements: number;
    totalExternalRecipients: number;
    repeatContributorsCount: number;
    corridorsClearedCount: number;
    corridorsCleared: string[];
    totalUsdtSettledFormatted: string;
    totalRejectedClaims: number;
    totalPaidBuyCalls: number;
    totalBuyCallsRecorded: number;
    totalX402Inflows: number;
  };
  completedSettlements: Array<{
    id: string;
    campaignTitle: string;
    partnerName: string;
    recipientWallet: string;
    corridor: string;
    localAmountFormatted: string;
    usdtSpentFormatted: string;
    usdtRefundedFormatted: string;
    vaultReleaseTxHash: string;
    vaultReleaseUrl: string;
    textileSwapTxHash: string;
    textileSwapUrl: string;
    payoutTxHash: string;
    payoutUrl: string;
    receiptTxHash: string;
    receiptUrl: string;
    buyPaymentTxHash: string | null;
    buyPaymentUrl: string | null;
    erc8004Rated: boolean;
    settledAt: number;
  }>;
  rejectedClaims: Array<{
    id: string;
    campaignTitle: string;
    corridor: string;
    contributorWallet: string;
    deliverableUrl: string;
    failedPolicyRule: string | null;
    aiVerdict: string | null;
    aiScore: number | null;
    aiReason: string | null;
    createdAt: number;
  }>;
  buyPayments: Array<{
    id: string;
    capabilityId: string;
    paymentToken: string;
    paymentAmountFormatted: string;
    paymentTxHash: string | null;
    txUrl: string | null;
    dryRun: boolean;
    createdAt: number;
  }>;
  x402Inflows: Array<{
    id: string;
    endpoint: string;
    payerWallet: string;
    payToWallet: string;
    assetSymbol: string;
    amountAtomic: string;
    settlementTxHash: string;
    txUrl: string;
    blockNumber: number | null;
    createdAt: number;
  }>;
}

type TabKey = "settled" | "rejected" | "buy" | "x402";

export default function LedgerPage() {
  const [tab, setTab] = useState<TabKey>("settled");
  const [corridor, setCorridor] = useState("");

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["public-ledger", corridor],
    queryFn: async () => {
      const q = corridor ? `?corridor=${encodeURIComponent(corridor)}` : "";
      const r = await fetch(`/api/ledger${q}`);
      if (!r.ok) throw new Error("Failed to load audit ledger");
      return (await r.json()) as LedgerData;
    },
    refetchInterval: 15_000,
  });

  const m = data?.metrics;

  return (
    <div className="space-y-8">
      <div className="vire-enter flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-[#F4F5F6]">
            Public settlement &amp; audit ledger
          </h1>
          <p className="mt-1.5 max-w-[66ch] text-sm text-[#8A8F98]">
            Every Textile FX swap, VireVault release, local payout, Policy Gate rejection, Celo{" "}
            <code className="font-mono text-xs text-[#D5D8DE]">buy</code> call, and x402 PayTo
            inflow is indexed with direct Celoscan links. Zero synthetic entries.
          </p>
        </div>

        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          <ArrowClockwise className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          Refresh ledger
        </Button>
      </div>

      {/* Unified Hairline 6-KPI Analytics Band (Morpho / Vercel Analytics style) */}
      <Card className="vire-enter vire-delay-1 overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-y divide-white/[0.06] sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
          {[
            { label: "External recipients", value: m?.totalExternalRecipients ?? 0, sub: "non-team wallets" },
            { label: "Repeat contributors", value: m?.repeatContributorsCount ?? 0, sub: "2+ stages cleared" },
            {
              label: "Tagged Textile swaps",
              value: m?.totalCompletedSettlements ?? 0,
              sub: `$${m?.totalUsdtSettledFormatted ?? "0"} USD₮`,
            },
            {
              label: "Corridors cleared",
              value: m?.corridorsClearedCount ?? 0,
              sub: m?.corridorsCleared.join(", ") || "ready",
            },
            {
              label: "Paid Celo buy",
              value: m?.totalPaidBuyCalls ?? 0,
              sub: `${m?.totalBuyCallsRecorded ?? 0} total logged`,
            },
            {
              label: "x402 inflows",
              value: m?.totalX402Inflows ?? 0,
              sub: "settled via x402",
              highlight: true,
            },
          ].map((kpi) => (
            <div key={kpi.label} className="p-4 sm:p-5">
              <div className="text-[11px] font-medium text-[#8A8F98]">{kpi.label}</div>
              <div
                className={cn(
                  "mt-2 font-mono text-2xl font-semibold tracking-[-0.03em] tabular-nums",
                  kpi.highlight ? "text-emerald-400" : "text-[#F4F5F6]"
                )}
              >
                {kpi.value}
              </div>
              <div className="mt-1 truncate font-mono text-[10px] text-[#5C626D]">{kpi.sub}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Tabs + Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          options={[
            { value: "settled", label: "Completed settlements", count: data?.completedSettlements.length ?? 0 },
            { value: "rejected", label: "Rejected claims", count: data?.rejectedClaims.length ?? 0 },
            { value: "buy", label: "Paid buy receipts", count: data?.buyPayments.length ?? 0 },
            { value: "x402", label: "x402 inflows", count: data?.x402Inflows.length ?? 0 },
          ]}
        />

        {(tab === "settled" || tab === "rejected") && (
          <div className="w-48">
            <Select
              aria-label="Filter by corridor"
              value={corridor}
              onChange={(e) => setCorridor(e.target.value)}
              className="font-mono text-xs"
            >
              <option value="">All corridors</option>
              <option value="cNGN">cNGN · Nigeria</option>
              <option value="wARS">wARS · Argentina</option>
              <option value="wBRL">wBRL · Brazil</option>
              <option value="wMXN">wMXN · Mexico</option>
              <option value="IDRX">IDRX · Indonesia</option>
            </Select>
          </div>
        )}
      </div>

      {/* Data Table Surface */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : tab === "settled" ? (
            data?.completedSettlements.length ? (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.07] bg-[#0B0D10] font-mono text-[11px] text-[#6B7280]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Timestamp</th>
                    <th className="px-5 py-3 font-medium">Campaign / Recipient</th>
                    <th className="px-5 py-3 font-medium">Local Output</th>
                    <th className="px-5 py-3 font-medium">USD₮ Spent</th>
                    <th className="px-5 py-3 font-medium">Onchain Proofs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {data.completedSettlements.map((s) => (
                    <tr
                      key={s.id}
                      className="transition-colors duration-150 hover:bg-white/[0.02]"
                    >
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[11px] text-[#8A8F98] tabular-nums">
                        {new Date(s.settledAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-[#F4F5F6]">{s.campaignTitle}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-[#6B7280]">
                          <span>{truncateMiddle(s.recipientWallet, 8, 6)}</span>
                          <CopyButton value={s.recipientWallet} toastMessage="Recipient copied" />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono font-semibold text-emerald-400 tabular-nums">
                        {s.localAmountFormatted} {s.corridor}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[#D5D8DE] tabular-nums">
                        ${s.usdtSpentFormatted}
                        {s.usdtRefundedFormatted !== "0" && (
                          <span className="block text-[10px] text-[#6B7280]">
                            +${s.usdtRefundedFormatted} refunded
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                          <a
                            href={s.vaultReleaseUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[#D5D8DE] hover:border-white/[0.16] hover:text-white"
                          >
                            Vault <ArrowUpRight className="h-3 w-3" />
                          </a>
                          <a
                            href={s.textileSwapUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-emerald-300 hover:bg-emerald-500/20"
                          >
                            Textile Swap <ArrowUpRight className="h-3 w-3" />
                          </a>
                          <a
                            href={s.payoutUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[#D5D8DE] hover:border-white/[0.16] hover:text-white"
                          >
                            Payout <ArrowUpRight className="h-3 w-3" />
                          </a>
                          {s.buyPaymentUrl && (
                            <a
                              href={s.buyPaymentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-amber-300 hover:bg-amber-500/20"
                            >
                              buy <ArrowUpRight className="h-3 w-3" />
                            </a>
                          )}
                          {s.erc8004Rated && (
                            <Badge tone="emerald">
                              <ShieldCheck weight="fill" className="h-3 w-3" /> Rated
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-6 py-14 text-center">
                <p className="text-sm font-medium text-[#E5E7EB]">No settled mainnet payouts yet</p>
                <p className="mx-auto mt-1.5 max-w-md text-xs text-[#8A8F98]">
                  Live Celo Mainnet settlements appear here with 4 Celoscan proofs once a verified
                  deliverable clears <code className="font-mono">VireVault</code> and Textile FX v2.
                </p>
                <div className="mt-5 flex justify-center gap-2">
                  <Link href="/claim" className={buttonVariants({ variant: "primary", size: "sm" })}>
                    Submit deliverable
                  </Link>
                  <Link href="/console" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                    Inspect VireVault
                  </Link>
                </div>
              </div>
            )
          ) : tab === "rejected" ? (
            data?.rejectedClaims.length ? (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.07] bg-[#0B0D10] font-mono text-[11px] text-[#6B7280]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Timestamp</th>
                    <th className="px-5 py-3 font-medium">Claim / Wallet</th>
                    <th className="px-5 py-3 font-medium">Triggered Policy Rule</th>
                    <th className="px-5 py-3 font-medium">AI Verdict &amp; Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {data.rejectedClaims.map((r) => (
                    <tr key={r.id} className="hover:bg-white/[0.02]">
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[11px] text-[#8A8F98] tabular-nums">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-[#F4F5F6]">{r.campaignTitle}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-[#6B7280]">
                          {truncateMiddle(r.contributorWallet, 8, 6)} · {r.corridor}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge tone="rose">
                          <ShieldWarning weight="fill" className="h-3.5 w-3.5" />
                          {r.failedPolicyRule ?? "POLICY_REJECTED"}
                        </Badge>
                      </td>
                      <td className="max-w-md px-5 py-3.5 text-[#9DA3AE]">
                        <span className="font-mono font-medium text-[#F4F5F6]">
                          {r.aiScore ?? 0}/100 ({r.aiVerdict ?? "n/a"})
                        </span>{" "}
                        — {r.aiReason ?? "Blocked by deterministic guardrail before vault release."}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-6 py-14 text-center">
                <p className="text-sm font-medium text-[#E5E7EB]">No rejected claims logged yet</p>
                <p className="mx-auto mt-1.5 max-w-md text-xs text-[#8A8F98]">
                  Every submission blocked by any of the 7 Policy Gate rules is persisted publicly
                  here as verifiable proof of autonomous guardrail enforcement.
                </p>
              </div>
            )
          ) : tab === "buy" ? (
            data?.buyPayments.length ? (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.07] bg-[#0B0D10] font-mono text-[11px] text-[#6B7280]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Timestamp</th>
                    <th className="px-5 py-3 font-medium">Capability</th>
                    <th className="px-5 py-3 font-medium">Spend</th>
                    <th className="px-5 py-3 font-medium">Payment Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {data.buyPayments.map((b) => (
                    <tr key={b.id} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-3.5 font-mono text-[11px] text-[#8A8F98] tabular-nums">
                        {new Date(b.createdAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[#F4F5F6]">{b.capabilityId}</td>
                      <td className="px-5 py-3.5 font-mono text-[#D5D8DE] tabular-nums">
                        {b.paymentAmountFormatted} {b.paymentToken}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[11px]">
                        {b.txUrl && b.paymentTxHash ? (
                          <a
                            href={b.txUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                          >
                            {truncateMiddle(b.paymentTxHash, 10, 6)}
                            <ArrowUpRight className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-[#6B7280]">{b.dryRun ? "dry-run" : "recorded"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-6 py-14 text-center">
                <p className="text-sm font-medium text-[#E5E7EB]">No Celo buy receipts yet</p>
                <p className="mx-auto mt-1.5 max-w-md text-xs text-[#8A8F98]">
                  Paid per-call receipts to Cencori LLM and Chainstack RPC on{" "}
                  <code className="font-mono">gateway.usebuy.ai</code> appear here automatically.
                </p>
              </div>
            )
          ) : data?.x402Inflows.length ? (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/[0.07] bg-[#0B0D10] font-mono text-[11px] text-[#6B7280]">
                <tr>
                  <th className="px-5 py-3 font-medium">Timestamp</th>
                  <th className="px-5 py-3 font-medium">Endpoint</th>
                  <th className="px-5 py-3 font-medium">Payer → PayTo</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Settlement Tx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {data.x402Inflows.map((x) => (
                  <tr key={x.id} className="hover:bg-white/[0.02]">
                    <td className="px-5 py-3.5 font-mono text-[11px] text-[#8A8F98] tabular-nums">
                      {new Date(x.createdAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[#F4F5F6]">{x.endpoint}</td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-[#8A8F98]">
                      {truncateMiddle(x.payerWallet, 6, 4)} → {truncateMiddle(x.payToWallet, 6, 4)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[#D5D8DE] tabular-nums">
                      {x.amountAtomic} {x.assetSymbol}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[11px]">
                      <a
                        href={x.txUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                      >
                        {truncateMiddle(x.settlementTxHash, 10, 6)}
                        <ArrowUpRight className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-[#E5E7EB]">No x402 API inflows settled yet</p>
              <p className="mx-auto mt-1.5 max-w-md text-xs text-[#8A8F98]">
                External agents and merchants paying <code className="font-mono">/api/x402/verify</code>{" "}
                or <code className="font-mono">/api/x402/campaigns</code> appear here in real time.
              </p>
              <div className="mt-5">
                <Link href="/console" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  Open x402 Playground
                </Link>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
