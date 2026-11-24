"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Transparent Onchain Explorer · Judge Dashboard
          </span>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">
            Public Live Settlement &amp; Audit Ledger
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Every Textile FX swap, VireVault release, local stablecoin payout, Policy Gate rejection,
            paid Celo <code className="font-mono text-xs">buy</code> receipt, and x402 PayTo inflow is
            indexed with direct Celoscan links. Zero synthetic entries.
          </p>
        </div>

        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh Ledger
        </button>
      </div>

      {/* 6-KPI Judge Metrics Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "External Recipients", value: m?.totalExternalRecipients ?? 0, sub: "non-team wallets" },
          { label: "Repeat Contributors", value: m?.repeatContributorsCount ?? 0, sub: "2+ stages cleared" },
          {
            label: "Tagged Textile Swaps",
            value: m?.totalCompletedSettlements ?? 0,
            sub: `$${m?.totalUsdtSettledFormatted ?? "0"} USD₮`,
          },
          {
            label: "Corridors Cleared",
            value: m?.corridorsClearedCount ?? 0,
            sub: m?.corridorsCleared.join(", ") || "ready",
          },
          {
            label: "Paid buy Calls",
            value: m?.totalPaidBuyCalls ?? 0,
            sub: `${m?.totalBuyCallsRecorded ?? 0} total logged`,
          },
          { label: "x402 PayTo Inflows", value: m?.totalX402Inflows ?? 0, sub: "settled via x402" },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-zinc-200/90 bg-white p-4">
            <div className="text-[11px] font-medium text-zinc-500">{kpi.label}</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-zinc-950 tabular-nums">
              {kpi.value}
            </div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-400">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs + Corridor Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["settled", `Completed Settlements (${data?.completedSettlements.length ?? 0})`],
              ["rejected", `Rejected Claims (${data?.rejectedClaims.length ?? 0})`],
              ["buy", `Paid Celo buy Receipts (${data?.buyPayments.length ?? 0})`],
              ["x402", `x402 PayTo Inflows (${data?.x402Inflows.length ?? 0})`],
            ] as Array<[TabKey, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === key
                  ? "bg-zinc-950 text-white"
                  : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {(tab === "settled" || tab === "rejected") && (
          <select
            value={corridor}
            onChange={(e) => setCorridor(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-900"
          >
            <option value="">All Corridors</option>
            <option value="cNGN">cNGN (Nigeria)</option>
            <option value="wARS">wARS (Argentina)</option>
            <option value="wBRL">wBRL (Brazil)</option>
            <option value="wMXN">wMXN (Mexico)</option>
            <option value="IDRX">IDRX (Indonesia)</option>
          </select>
        )}
      </div>

      {/* Table Panels */}
      <div className="overflow-x-auto rounded-2xl border border-zinc-200/90 bg-white">
        {isLoading ? (
          <div className="p-8 font-mono text-xs text-zinc-500">Loading live audit records…</div>
        ) : tab === "settled" ? (
          data?.completedSettlements.length ? (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200 bg-zinc-50 font-mono text-[11px] uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Campaign / Recipient</th>
                  <th className="px-4 py-3">Local Output</th>
                  <th className="px-4 py-3">USD₮ Spent</th>
                  <th className="px-4 py-3">Onchain Proof (Celoscan)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.completedSettlements.map((s) => (
                  <tr key={s.id} className="hover:bg-zinc-50/70">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-zinc-500">
                      {new Date(s.settledAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-950">{s.campaignTitle}</div>
                      <div className="font-mono text-[11px] text-zinc-500">
                        {s.recipientWallet.slice(0, 8)}…{s.recipientWallet.slice(-6)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-emerald-700 tabular-nums">
                      {s.localAmountFormatted} {s.corridor}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-zinc-700 tabular-nums">
                      ${s.usdtSpentFormatted}
                      {s.usdtRefundedFormatted !== "0" && (
                        <span className="block text-[10px] text-zinc-400">
                          +${s.usdtRefundedFormatted} refunded
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                        <a href={s.vaultReleaseUrl} target="_blank" rel="noreferrer" className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-800 hover:bg-zinc-200">
                          Vault <ExternalLink className="inline h-2.5 w-2.5" />
                        </a>
                        <a href={s.textileSwapUrl} target="_blank" rel="noreferrer" className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-800 hover:bg-emerald-100">
                          Textile Swap <ExternalLink className="inline h-2.5 w-2.5" />
                        </a>
                        <a href={s.payoutUrl} target="_blank" rel="noreferrer" className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-800 hover:bg-zinc-200">
                          Payout <ExternalLink className="inline h-2.5 w-2.5" />
                        </a>
                        {s.buyPaymentUrl && (
                          <a href={s.buyPaymentUrl} target="_blank" rel="noreferrer" className="rounded bg-amber-50 px-2 py-0.5 text-amber-900 hover:bg-amber-100">
                            buy <ExternalLink className="inline h-2.5 w-2.5" />
                          </a>
                        )}
                        {s.erc8004Rated && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-2 py-0.5 text-emerald-900">
                            <ShieldCheck className="h-3 w-3" /> Rated
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-xs text-zinc-500">
              No completed Celo Mainnet settlements recorded yet. Submit a verified claim on{" "}
              <code className="font-mono">/claim</code> once <code className="font-mono">VireVault</code>{" "}
              is deployed and funded.
            </div>
          )
        ) : tab === "rejected" ? (
          data?.rejectedClaims.length ? (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200 bg-zinc-50 font-mono text-[11px] uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Claim / Wallet</th>
                  <th className="px-4 py-3">Triggered Policy Rule</th>
                  <th className="px-4 py-3">AI Verdict &amp; Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.rejectedClaims.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-zinc-500">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-900">{r.campaignTitle}</div>
                      <div className="font-mono text-[11px] text-zinc-500">
                        {r.contributorWallet.slice(0, 8)}… · {r.corridor}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-rose-800">
                        <ShieldAlert className="h-3 w-3" />
                        {r.failedPolicyRule ?? "POLICY_REJECTED"}
                      </span>
                    </td>
                    <td className="max-w-md px-4 py-3 text-zinc-600">
                      <span className="font-mono font-semibold text-zinc-900">
                        {r.aiScore ?? 0}/100 ({r.aiVerdict ?? "n/a"})
                      </span>{" "}
                      — {r.aiReason ?? "Blocked by deterministic guardrail before vault release."}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-xs text-zinc-500">
              No rejected claims recorded yet. Every claim rejected by any of the 7 Policy Gate rules is
              logged publicly here to prove real agentic enforcement.
            </div>
          )
        ) : tab === "buy" ? (
          data?.buyPayments.length ? (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200 bg-zinc-50 font-mono text-[11px] uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Capability</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Payment Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.buyPayments.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">
                      {new Date(b.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-zinc-900">{b.capabilityId}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-zinc-800">
                      {b.paymentAmountFormatted} {b.paymentToken}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px]">
                      {b.txUrl && b.paymentTxHash ? (
                        <a href={b.txUrl} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
                          {b.paymentTxHash.slice(0, 14)}… <ExternalLink className="inline h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-zinc-500">{b.dryRun ? "dry-run (offline)" : "recorded"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-xs text-zinc-500">
              No Celo <code className="font-mono">buy</code> gateway calls logged yet.
            </div>
          )
        ) : data?.x402Inflows.length ? (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-200 bg-zinc-50 font-mono text-[11px] uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Endpoint</th>
                <th className="px-4 py-3">Payer → PayTo</th>
                <th className="px-4 py-3">Asset / Atomic</th>
                <th className="px-4 py-3">Settlement Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {data.x402Inflows.map((x) => (
                <tr key={x.id}>
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">
                    {new Date(x.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono font-medium text-zinc-900">{x.endpoint}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-600">
                    {x.payerWallet.slice(0, 8)}… → {x.payToWallet.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 font-mono text-zinc-800">
                    {x.amountAtomic} {x.assetSymbol}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px]">
                    <a href={x.txUrl} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
                      {x.settlementTxHash.slice(0, 14)}… <ExternalLink className="inline h-3 w-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-8 text-center text-xs text-zinc-500">
            No x402 API inflows settled yet. Test <code className="font-mono">POST /api/x402/verify</code>{" "}
            from <code className="font-mono">/console</code>.
          </div>
        )}
      </div>
    </div>
  );
}
