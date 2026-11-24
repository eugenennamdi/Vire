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
import { TokenIcon } from "@/components/ui/token-icon";
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
          <h1 className="text-[28px] font-medium tracking-[-0.03em] text-[#0A0A0C]">
            Audit ledger
          </h1>
          <p className="mt-1 max-w-[62ch] text-[14px] leading-relaxed text-[#71717A]">
            Public record of Celo Mainnet settlements, Policy Gate rejections, paid{" "}
            <code className="font-mono text-[13px] text-[#0A0A0C]">usebuy.ai</code> calls, and x402 inflows.
          </p>
        </div>

        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          <ArrowClockwise className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* 6-Cell Calm Statement Metrics */}
      <Card className="vire-enter vire-delay-1 overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-y divide-black/[0.06] sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
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
              <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#71717A]">
                {kpi.label}
              </div>
              <div className="mt-1.5 text-[24px] font-normal tracking-[-0.03em] text-[#0A0A0C] tabular-nums">
                {kpi.value}
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-[#A1A1AA]">
                {kpi.sub}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Capsule Tabs + Corridor Filter */}
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
              className="h-9 rounded-full font-mono text-xs"
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
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-black/[0.06] bg-[#FAFAFB] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#71717A]">
                  <tr>
                    <th className="px-5 py-3.5">Timestamp</th>
                    <th className="px-5 py-3.5">Campaign / Recipient</th>
                    <th className="px-5 py-3.5">Local output</th>
                    <th className="px-5 py-3.5">USDT spent</th>
                    <th className="px-5 py-3.5">Proofs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.055]">
                  {data.completedSettlements.map((s) => (
                    <tr
                      key={s.id}
                      className="transition-colors duration-150 hover:bg-[#FAFAFB]"
                    >
                      <td className="whitespace-nowrap px-5 py-4 font-mono text-[11.5px] text-[#71717A] tabular-nums">
                        {new Date(s.settledAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-[#0A0A0C]">{s.campaignTitle}</div>
                        <div className="mt-1 flex items-center gap-1.5 font-mono text-[11.5px] text-[#71717A]">
                          <span>{truncateMiddle(s.recipientWallet, 8, 6)}</span>
                          <CopyButton value={s.recipientWallet} toastMessage="Recipient copied" />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <span className="inline-flex items-center gap-2 font-mono font-medium text-[#0A0A0C] tabular-nums">
                          <TokenIcon symbol={s.corridor} size={22} showChainBadge />
                          {s.localAmountFormatted} {s.corridor}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 font-mono text-[#52525B] tabular-nums">
                        ${s.usdtSpentFormatted}
                        {s.usdtRefundedFormatted !== "0" && (
                          <span className="block text-[10.5px] text-[#A1A1AA]">
                            +${s.usdtRefundedFormatted} refunded
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                          <a
                            href={s.vaultReleaseUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="vire-pill-surface inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[#3F3F46] hover:text-[#0A0A0C]"
                          >
                            Vault <ArrowUpRight className="h-3 w-3" />
                          </a>
                          <a
                            href={s.textileSwapUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-full bg-[#0A0A0C] px-2.5 py-0.5 text-white hover:bg-[#232327]"
                          >
                            Swap <ArrowUpRight className="h-3 w-3" />
                          </a>
                          <a
                            href={s.payoutUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="vire-pill-surface inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[#3F3F46] hover:text-[#0A0A0C]"
                          >
                            Payout <ArrowUpRight className="h-3 w-3" />
                          </a>
                          {s.buyPaymentUrl && (
                            <a
                              href={s.buyPaymentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-full bg-[#F2F2F4] px-2.5 py-0.5 text-[#3F3F46] hover:text-[#0A0A0C]"
                            >
                              x402 <ArrowUpRight className="h-3 w-3" />
                            </a>
                          )}
                          {s.erc8004Rated && <Badge tone="positive">Rated</Badge>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-6 py-16 text-center">
                <p className="text-[14px] font-medium text-[#0A0A0C]">No settlements recorded yet</p>
                <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-[#71717A]">
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
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-black/[0.06] bg-[#FAFAFB] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#71717A]">
                  <tr>
                    <th className="px-5 py-3.5">Timestamp</th>
                    <th className="px-5 py-3.5">Claim / Wallet</th>
                    <th className="px-5 py-3.5">Rule</th>
                    <th className="px-5 py-3.5">Verdict &amp; reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.055]">
                  {data.rejectedClaims.map((r) => (
                    <tr key={r.id} className="hover:bg-[#FAFAFB]">
                      <td className="whitespace-nowrap px-5 py-4 font-mono text-[11.5px] text-[#71717A] tabular-nums">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-[#0A0A0C]">{r.campaignTitle}</div>
                        <div className="mt-1 inline-flex items-center gap-1.5 font-mono text-[11.5px] text-[#71717A]">
                          <TokenIcon symbol={r.corridor} size={14} />
                          {truncateMiddle(r.contributorWallet, 8, 6)} · {r.corridor}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <Badge tone="destructive">{r.failedPolicyRule ?? "POLICY_REJECTED"}</Badge>
                      </td>
                      <td className="max-w-md px-5 py-4 text-[#52525B]">
                        <span className="font-mono font-medium text-[#0A0A0C]">
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
                <p className="text-[14px] font-medium text-[#0A0A0C]">No rejected claims</p>
                <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-[#71717A]">
                  Submissions blocked by the 7-rule Policy Gate are logged here.
                </p>
              </div>
            )
          ) : tab === "buy" ? (
            data?.buyPayments.length ? (
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-black/[0.06] bg-[#FAFAFB] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#71717A]">
                  <tr>
                    <th className="px-5 py-3.5">Timestamp</th>
                    <th className="px-5 py-3.5">Capability</th>
                    <th className="px-5 py-3.5">Spend</th>
                    <th className="px-5 py-3.5">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.055]">
                  {data.buyPayments.map((b) => (
                    <tr key={b.id} className="hover:bg-[#FAFAFB]">
                      <td className="whitespace-nowrap px-5 py-4 font-mono text-[11.5px] text-[#71717A] tabular-nums">
                        {new Date(b.createdAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-4 font-mono text-[#0A0A0C]">{b.capabilityId}</td>
                      <td className="px-5 py-4 font-mono text-[#52525B] tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          <TokenIcon symbol={b.paymentToken} size={16} />
                          {b.paymentAmountFormatted} {b.paymentToken}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-mono text-[11.5px]">
                        {b.txUrl && b.paymentTxHash ? (
                          <a
                            href={b.txUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[#0A0A0C] underline underline-offset-2"
                          >
                            {truncateMiddle(b.paymentTxHash, 10, 6)}
                            <ArrowUpRight className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-[#71717A]">
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
                <p className="text-[14px] font-medium text-[#0A0A0C]">No x402 call receipts</p>
                <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-[#71717A]">
                  Paid verification calls to{" "}
                  <code className="font-mono text-[#0A0A0C]">gateway.usebuy.ai</code> are indexed here.
                </p>
              </div>
            )
          ) : data?.x402Inflows.length ? (
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-black/[0.06] bg-[#FAFAFB] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#71717A]">
                <tr>
                  <th className="px-5 py-3.5">Timestamp</th>
                  <th className="px-5 py-3.5">Endpoint</th>
                  <th className="px-5 py-3.5">Payer → PayTo</th>
                  <th className="px-5 py-3.5">Amount</th>
                  <th className="px-5 py-3.5">Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.055]">
                {data.x402Inflows.map((x) => (
                  <tr key={x.id} className="hover:bg-[#FAFAFB]">
                    <td className="whitespace-nowrap px-5 py-4 font-mono text-[11.5px] text-[#71717A] tabular-nums">
                      {new Date(x.createdAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-4 font-mono text-[#0A0A0C]">{x.endpoint}</td>
                    <td className="px-5 py-4 font-mono text-[11.5px] text-[#71717A]">
                      {truncateMiddle(x.payerWallet, 6, 4)} → {truncateMiddle(x.payToWallet, 6, 4)}
                    </td>
                    <td className="px-5 py-4 font-mono text-[#52525B] tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        <TokenIcon symbol={x.assetSymbol} size={16} />
                        {x.amountAtomic} {x.assetSymbol}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono text-[11.5px]">
                      <a
                        href={x.txUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[#0A0A0C] underline underline-offset-2"
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
              <p className="text-[14px] font-medium text-[#0A0A0C]">No x402 inflows yet</p>
              <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-[#71717A]">
                Paid calls to <code className="font-mono text-[#0A0A0C]">/api/x402/verify</code>{" "}
                or <code className="font-mono text-[#0A0A0C]">/api/x402/campaigns</code> appear here.
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
