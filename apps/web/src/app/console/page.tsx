"use client";

import { useQuery } from "@tanstack/react-query";
import { CELO_TOKENS, VIRE_VAULT_ABI } from "@vire/shared";
import { ExternalLink, Pause, Play, Send, Shield } from "lucide-react";
import { useState } from "react";
import type { Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";

interface VaultApiResponse {
  deployed: boolean;
  address: Address | null;
  owner: Address | null;
  settlementAgent: Address | null;
  paused: boolean | null;
  usdtBalanceFormatted: string | null;
  totalCommittedBudgetFormatted: string | null;
  attributionCode: string;
  error?: string;
}

export default function ConsolePage() {
  const { address: connectedWallet } = useAccount();
  const { writeContractAsync, isPending: isVaultActionPending } = useWriteContract();

  const [x402AssetMode, setX402AssetMode] = useState<"default" | "cngn">("default");
  const [x402Status, setX402Status] = useState<number | null>(null);
  const [x402DecodedHeader, setX402DecodedHeader] = useState<string | null>(null);
  const [x402Body, setX402Body] = useState<string | null>(null);
  const [isTestingX402, setIsTestingX402] = useState(false);

  const { data: vault, refetch: refetchVault } = useQuery({
    queryKey: ["vault-console"],
    queryFn: async () => {
      const r = await fetch("/api/vault");
      return (await r.json()) as VaultApiResponse;
    },
  });

  const isVaultOwner =
    Boolean(connectedWallet && vault?.owner) &&
    connectedWallet!.toLowerCase() === vault!.owner!.toLowerCase();

  async function handleTogglePause() {
    if (!vault?.address) return;
    try {
      await writeContractAsync({
        address: vault.address,
        abi: VIRE_VAULT_ABI,
        functionName: vault.paused ? "unpause" : "pause",
      });
      await refetchVault();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Vault transaction cancelled");
    }
  }

  async function handleProbeX402() {
    setIsTestingX402(true);
    setX402Status(null);
    setX402DecodedHeader(null);
    setX402Body(null);

    try {
      const url = x402AssetMode === "cngn" ? "/api/x402/verify?asset=cngn" : "/api/x402/verify";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliverableUrl: "https://github.com/celo-org/attribution-tags/pull/1",
          deliverableType: "qa_bug",
          criteria: "Valid technical QA submission with reproducible steps.",
          corridor: "cNGN",
          rewardLocalHuman: "3000",
        }),
      });
      setX402Status(res.status);
      const reqHeader = res.headers.get("payment-required");
      if (reqHeader) {
        try {
          const decoded = JSON.parse(atob(reqHeader));
          setX402DecodedHeader(JSON.stringify(decoded, null, 2));
        } catch {
          setX402DecodedHeader(reqHeader);
        }
      }
      const text = await res.text();
      setX402Body(text || "{}");
    } catch (err) {
      setX402Body(err instanceof Error ? err.message : "Request failed");
    } finally {
      setIsTestingX402(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-emerald-700">
          Merchant Treasury &amp; Paid API Surface
        </span>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">
          Client Console &amp; Live x402 Playground
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Inspect <code className="font-mono text-xs">VireVault</code> custody guardrails, verify token
          decimals, and probe live HTTP 402 payment challenges settled via{" "}
          <code className="font-mono text-xs">https://api.x402.celo.org</code>.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* VireVault Inspector & Controls */}
        <section className="rounded-2xl border border-zinc-200/90 bg-white p-6 lg:col-span-5">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-950">
              <Shield className="h-4 w-4 text-emerald-700" />
              VireVault Onchain Custody
            </h2>
            <span
              className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold ${
                vault?.deployed
                  ? vault.paused
                    ? "bg-amber-100 text-amber-900"
                    : "bg-emerald-100 text-emerald-800"
                  : "bg-zinc-100 text-zinc-600"
              }`}
            >
              {vault?.deployed ? (vault.paused ? "PAUSED" : "LIVE · 42220") : "NOT DEPLOYED"}
            </span>
          </div>

          <dl className="mt-4 space-y-2.5 font-mono text-xs">
            {[
              ["Vault Address", vault?.address ?? "Set VIRE_VAULT_ADDRESS in .env"],
              ["Admin Owner", vault?.owner ?? "—"],
              ["Settlement Agent", vault?.settlementAgent ?? "—"],
              ["USD₮ Balance", vault?.usdtBalanceFormatted ? `$${vault.usdtBalanceFormatted} USD₮` : "—"],
              [
                "Committed Budgets",
                vault?.totalCommittedBudgetFormatted ? `$${vault.totalCommittedBudgetFormatted} USD₮` : "—",
              ],
              ["ERC-8021 Tag", vault?.attributionCode ?? "celo_55a64f75ba4a"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2 border-b border-zinc-100 pb-2">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="truncate font-medium text-zinc-950">{v}</dd>
              </div>
            ))}
          </dl>

          {vault?.deployed && (
            <div className="mt-4 flex items-center justify-between gap-2">
              <a
                href={`https://celoscan.io/address/${vault.address}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-xs text-emerald-700 underline"
              >
                View on Celoscan <ExternalLink className="h-3 w-3" />
              </a>

              <button
                type="button"
                disabled={!isVaultOwner || isVaultActionPending}
                onClick={handleTogglePause}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-40"
              >
                {vault.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                {vault.paused ? "Unpause Vault" : "Emergency Pause"}
              </button>
            </div>
          )}

          {/* Canonical Verified Decimals Reference */}
          <div className="mt-6">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Verified Celo Mainnet Token Registry
            </h3>
            <div className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-zinc-50/60 font-mono text-[11px]">
              {Object.values(CELO_TOKENS).map((t) => (
                <div key={t.symbol} className="flex items-center justify-between px-3 py-1.5">
                  <span className="font-semibold text-zinc-900">{t.displaySymbol}</span>
                  <span className="text-zinc-500">
                    {t.address.slice(0, 8)}…{t.address.slice(-4)}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-semibold ${
                      t.decimals === 2
                        ? "bg-amber-100 text-amber-900"
                        : "bg-zinc-200/70 text-zinc-800"
                    }`}
                  >
                    {t.decimals} dec
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Interactive x402 Playground */}
        <section className="rounded-2xl border border-zinc-200/90 bg-white p-6 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-zinc-950">
                Live x402 API Playground (<code className="font-mono">POST /api/x402/verify</code>)
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Tests Vire&apos;s live x402 v2 payment gate settling into <code className="font-mono">VIRE_X402_PAY_TO</code>.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={x402AssetMode}
                onChange={(e) => setX402AssetMode(e.target.value as "default" | "cngn")}
                className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-xs"
              >
                <option value="default">USD₮ / USDC / wFIAT (Gasless)</option>
                <option value="cngn">cNGN Route (?asset=cngn)</option>
              </select>
              <button
                type="button"
                disabled={isTestingX402}
                onClick={handleProbeX402}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-950 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {isTestingX402 ? "Probing…" : "Send Unpaid Probe"}
              </button>
            </div>
          </div>

          {x402Status !== null && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 font-mono text-xs">
                <span
                  className={`rounded px-2 py-0.5 font-semibold ${
                    x402Status === 402
                      ? "bg-emerald-100 text-emerald-900"
                      : x402Status === 503
                        ? "bg-amber-100 text-amber-900"
                        : "bg-zinc-100 text-zinc-900"
                  }`}
                >
                  HTTP {x402Status}
                </span>
                <span className="text-zinc-600">
                  {x402Status === 402
                    ? "Valid x402 v2 Payment Required challenge emitted!"
                    : "Response received"}
                </span>
              </div>

              {x402DecodedHeader && (
                <div>
                  <div className="font-mono text-[11px] font-semibold text-zinc-500">
                    Decoded payment-required Header (Exact Celo Mainnet Asset Specs)
                  </div>
                  <pre className="mt-1 max-h-72 overflow-auto rounded-xl bg-zinc-950 p-3.5 font-mono text-[11px] text-emerald-300">
                    {x402DecodedHeader}
                  </pre>
                </div>
              )}

              {x402Body && (
                <div>
                  <div className="font-mono text-[11px] font-semibold text-zinc-500">Response Body</div>
                  <pre className="mt-1 max-h-40 overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] text-zinc-800">
                    {x402Body}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Copyable Buyer SDK Snippet */}
          <div className="mt-6">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Pay &amp; Call Programmatically with @x402/fetch (Celo Mainnet)
            </div>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-zinc-950 p-4 font-mono text-[11px] leading-relaxed text-zinc-200">
{`import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client();
client.setSpendControls({ maxAmountPerPayment: "$1" });
client.register("eip155:*", new ExactEvmScheme(privateKeyToAccount(process.env.BUYER_KEY)));

const payFetch = wrapFetchWithPayment(fetch, client);
const res = await payFetch("${typeof window !== "undefined" ? window.location.origin : "https://your-vire-domain"}/api/x402/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    deliverableUrl: "https://github.com/org/repo/pull/12",
    deliverableType: "qa_bug",
    criteria: "Reproducible bug report with environment details",
    corridor: "cNGN",
    rewardLocalHuman: "3000"
  })
});
console.log(await res.json());`}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
