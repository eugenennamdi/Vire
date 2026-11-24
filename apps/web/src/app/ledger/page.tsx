"use client";

import { ArrowClockwise, ArrowUpRight } from "@phosphor-icons/react";
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
      <div className="vire-enter flex flex-wrap items-end justify-between gap-4 border-b border-[#E4E2DC] pb-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#68665F]">
            Public Verification · Celo 42220
          </p>
          <h1 className="mt-1.5 font-serif text-3xl font-normal tracking-[-0.025em] text-[#121210] sm:text-[36px]">
            Audit ledger
          </h1>
          <p className="mt-1.5 max-w-[62ch] text-sm leading-relaxed text-[#4F4E4A]">
            Onchain settlements, Policy Gate rejections, paid{" "}
            <code className="font-mono text-xs text-[#121210]">usebuy.ai</code> calls, and x402
            inflows with direct Celoscan proofs.
          </p>
        </div>

        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          <ArrowClockwise className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* 6-Cell Ledger Statement Metrics */}
      <Card className="vire-enter vire-delay-1 overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-y divide-[#E4E2DC] sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
          {[
            { label: "Recipients", value: m?.totalExternalRecipients ?? 0, sub: "external wallets" },
            { label: "Repeat", value: m?.repeatContributorsCount ?? 0, sub: "2+ stages" },
            {
              label: "Textile swaps",
              value: m?.totalCompletedSettlements ?? 0,
              sub: `$${m?.totalUsdtSettledFormatted ?? "0"} USDT`,
            },
            {
              label: "Corridors",
              value: m?.corridorsClearedCount ?? 0,
              sub: m?.corridorsCleared.join(", ") || "ready",
            },
            {
              label: "x402 calls",
              value: m?.totalPaidBuyCalls ?? 0,
              sub: `${m?.totalBuyCallsRecorded ?? 0} logged`,
            },
            {
              label: "x402 inflows",
              value: m?.totalX402Inflows ?? 0,
              sub: "api.x402.celo.org",
            },
          ].map((kpi) => (
            <div key={kpi.label} className="p-5">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-[#68665F]">
                {kpi.label}
              </div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tracking-[-0.03em] text-[#121210] tabular-nums">
                {kpi.value}
              </div>
              <div className="mt-1 truncate font-mono text-[10.5px] text-[#787670]">
                {kpi.sub}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Square Tabs + Corridor Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          options={[
            { value: "settled", label: "Settlements", count: data?.completedSettlements.length ?? 0 },
            { value: "rejected", label: "Rejected", count: data?.rejectedClaims.length ?? 0 },
            { value: "buy", label: "x402 Calls", count: data?.buyPayments.length ?? 0 },
            { value: "x402", label: "x402 Inflows", count: data?.x402Inflows.length ?? 0 },
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

      {/* Ledger Table */}
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
                <thead className="border-b border-[#E4E2DC] bg-[#F3F1EC]/70 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[#68665F]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Timestamp</th>
                    <th className="px-5 py-3 font-medium">Campaign / Recipient</th>
                    <th className="px-5 py-3 font-medium">Local output</th>
                    <th className="px-5 py-3 font-medium">USDT spent</th>
                    <th className="px-5 py-3 font-medium">Proofs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E2DC]">
                  {data.completedSettlements.map((s) => (
                    <tr
                      key={s.id}
                      className="transition-colors duration-150 hover:bg-[#FAF9F6]"
                    >
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[11px] text-[#68665F] tabular-nums">
                        {new Date(s.settledAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-[#121210]">{s.campaignTitle}</div>
                        <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-[#68665F]">
                          <span>{truncateMiddle(s.recipientWallet, 8, 6)}</span>
                          <CopyButton value={s.recipientWallet} toastMessage="Recipient copied" />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono font-semibold text-[#121210] tabular-nums">
                        {s.localAmountFormatted} {s.corridor}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[#4F4E4A] tabular-nums">
                        ${s.usdtSpentFormatted}
                        {s.usdtRefundedFormatted !== "0" && (
                          <span className="block text-[10px] text-[#787670]">
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
                            className="inline-flex items-center gap-1 rounded-[4px] border border-[#D5D2C9] bg-white px-2 py-0.5 text-[#4F4E4A] hover:border-[#121210] hover:text-[#121210]"
                          >
                            Vault <ArrowUpRight className="h-3 w-3" />
                          </a>
                          <a
                            href={s.textileSwapUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-[4px] bg-[#121210] px-2 py-0.5 text-[#FAF9F6] hover:bg-[#292824]"
                          >
                            Swap <ArrowUpRight className="h-3 w-3" />
                          </a>
                          <a
                            href={s.payoutUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-[4px] border border-[#D5D2C9] bg-white px-2 py-0.5 text-[#4F4E4A] hover:border-[#121210] hover:text-[#121210]"
                          >
                            Payout <ArrowUpRight className="h-3 w-3" />
                          </a>
                          {s.buyPaymentUrl && (
                            <a
                              href={s.buyPaymentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-[4px] border border-[#D5D2C9] bg-[#F3F1EC] px-2 py-0.5 text-[#4F4E4A] hover:border-[#121210] hover:text-[#121210]"
                            >
                              x402 <ArrowUpRight className="h-3 w-3" />
                            </a>
                          )}
                          {s.erc8004Rated && <Badge tone="outline">Rated</Badge>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-6 py-16 text-center">
                <p className="text-sm font-medium text-[#121210]">No settlements recorded yet</p>
                <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-[#68665F]">
                  Verified payouts appear here with Celoscan links once cleared through VireVault
                  and Textile FX.
                </p>
                <div className="mt-5 flex justify-center gap-2">
                  <Link href="/claim" className={buttonVariants({ variant: "primary", size: "sm" })}>
                    Submit deliverable
                  </Link>
                  <Link href="/console" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                    Inspect vault
                  </Link>
                </div>
              </div>
            )
          ) : tab === "rejected" ? (
            data?.rejectedClaims.length ? (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#E4E2DC] bg-[#F3F1EC]/70 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[#68665F]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Timestamp</th>
                    <th className="px-5 py-3 font-medium">Claim / Wallet</th>
                    <th className="px-5 py-3 font-medium">Rule</th>
                    <th className="px-5 py-3 font-medium">Verdict &amp; reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E2DC]">
                  {data.rejectedClaims.map((r) => (
                    <tr key={r.id} className="hover:bg-[#FAF9F6]">
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[11px] text-[#68665F] tabular-nums">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-[#121210]">{r.campaignTitle}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-[#68665F]">
                          {truncateMiddle(r.contributorWallet, 8, 6)} · {r.corridor}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge tone="destructive">{r.failedPolicyRule ?? "POLICY_REJECTED"}</Badge>
                      </td>
                      <td className="max-w-md px-5 py-3.5 text-[#4F4E4A]">
                        <span className="font-mono font-medium text-[#121210]">
                          {r.aiScore ?? 0}/100 ({r.aiVerdict ?? "n/a"})
                        </span>{" "}
                        — {r.aiReason ?? "Blocked before vault release."}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-6 py-16 text-center">
                <p className="text-sm font-medium text-[#121210]">No rejected claims</p>
                <p className="mx-auto mt-1.5 max-w-sm text-xs text-[#68665F]">
                  Submissions blocked by the 7-rule Policy Gate are logged here.
                </p>
              </div>
            )
          ) : tab === "buy" ? (
            data?.buyPayments.length ? (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#E4E2DC] bg-[#F3F1EC]/70 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[#68665F]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Timestamp</th>
                    <th className="px-5 py-3 font-medium">Capability</th>
                    <th className="px-5 py-3 font-medium">Spend</th>
                    <th className="px-5 py-3 font-medium">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E2DC]">
                  {data.buyPayments.map((b) => (
                    <tr key={b.id} className="hover:bg-[#FAF9F6]">
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[11px] text-[#68665F] tabular-nums">
                        {new Date(b.createdAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[#121210]">{b.capabilityId}</td>
                      <td className="px-5 py-3.5 font-mono text-[#4F4E4A] tabular-nums">
                        {b.paymentAmountFormatted} {b.paymentToken}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[11px]">
                        {b.txUrl && b.paymentTxHash ? (
                          <a
                            href={b.txUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[#121210] underline underline-offset-2"
                          >
                            {truncateMiddle(b.paymentTxHash, 10, 6)}
                            <ArrowUpRight className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-[#68665F]">
                            {b.dryRun ? "dry-run" : "recorded"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-6 py-16 text-center">
                <p className="text-sm font-medium text-[#121210]">No x402 call receipts</p>
                <p className="mx-auto mt-1.5 max-w-sm text-xs text-[#68665F]">
                  Paid verification calls to{" "}
                  <code className="font-mono text-[#121210]">gateway.usebuy.ai</code> are indexed
                  here.
                </p>
              </div>
            )
          ) : data?.x402Inflows.length ? (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E4E2DC] bg-[#F3F1EC]/70 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[#68665F]">
                <tr>
                  <th className="px-5 py-3 font-medium">Timestamp</th>
                  <th className="px-5 py-3 font-medium">Endpoint</th>
                  <th className="px-5 py-3 font-medium">Payer → PayTo</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E2DC]">
                {data.x402Inflows.map((x) => (
                  <tr key={x.id} className="hover:bg-[#FAF9F6]">
                    <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[11px] text-[#68665F] tabular-nums">
                      {new Date(x.createdAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[#121210]">{x.endpoint}</td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-[#68665F]">
                      {truncateMiddle(x.payerWallet, 6, 4)} → {truncateMiddle(x.payToWallet, 6, 4)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[#4F4E4A] tabular-nums">
                      {x.amountAtomic} {x.assetSymbol}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[11px]">
                      <a
                        href={x.txUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[#121210] underline underline-offset-2"
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
            <div className="px-6 py-16 text-center">
              <p className="text-sm font-medium text-[#121210]">No x402 inflows yet</p>
              <p className="mx-auto mt-1.5 max-w-sm text-xs text-[#68665F]">
                Paid calls to <code className="font-mono text-[#121210]">/api/x402/verify</code>{" "}
                or <code className="font-mono text-[#121210]">/api/x402/campaigns</code> appear
                here.
              </p>
              <div className="mt-5">
                <Link href="/console" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  Test in Console
                </Link>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
