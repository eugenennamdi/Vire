"use client";

import { ArrowUpRight, PaperPlaneTilt, Pause, Play } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { CELO_TOKENS, VIRE_VAULT_ABI } from "@vire/shared";
import { useState } from "react";
import { toast } from "sonner";
import type { Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { TokenIcon } from "@/components/ui/token-icon";
import { truncateMiddle } from "@/lib/utils";

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
  const [x402LatencyMs, setX402LatencyMs] = useState<number | null>(null);
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
      toast.success(vault.paused ? "VireVault resumed" : "VireVault paused");
      await refetchVault();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Vault transaction cancelled");
    }
  }

  async function handleProbeX402() {
    setIsTestingX402(true);
    setX402Status(null);
    setX402LatencyMs(null);
    setX402DecodedHeader(null);
    setX402Body(null);

    const start = performance.now();
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
      setX402LatencyMs(Math.round(performance.now() - start));
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
      if (res.status === 402) {
        toast.success("HTTP 402 challenge received");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Probe request failed";
      setX402Body(msg);
      toast.error(msg);
    } finally {
      setIsTestingX402(false);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "https://usevire.xyz";
  const sdkSnippet = `import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client();
client.setSpendControls({ maxAmountPerPayment: "$1" });
client.register(
  "eip155:*",
  new ExactEvmScheme(privateKeyToAccount(process.env.BUYER_KEY))
);

const payFetch = wrapFetchWithPayment(fetch, client);
const res = await payFetch("${origin}/api/x402/verify", {
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
console.log(await res.json());`;

  return (
    <div className="space-y-8">
      <div className="vire-enter">
        <h1 className="text-[28px] font-medium tracking-[-0.03em] text-[#0A0A0C]">
          Developer console
        </h1>
        <p className="mt-1 max-w-[60ch] text-[14px] leading-relaxed text-[#71717A]">
          Live treasury status, supported Celo Mainnet token contracts, and interactive API payment
          testing.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        {/* Left: VireVault + Official Token Registry */}
        <div className="min-w-0 space-y-6 lg:col-span-5">
          <Card className="vire-enter vire-delay-1 overflow-hidden">
            <div className="flex items-center justify-between border-b border-black/[0.06] bg-[#FAFAFB] px-5 py-3.5">
              <div className="flex items-center gap-2">
                <TokenIcon symbol="USDT" size={20} showChainBadge />
                <h2 className="text-[13.5px] font-medium text-[#0A0A0C]">
                  Treasury vault
                </h2>
              </div>
              <Badge tone={vault?.deployed && !vault.paused ? "positive" : "neutral"}>
                {vault?.deployed ? (vault.paused ? "Paused" : "Active") : "Unconfigured"}
              </Badge>
            </div>

            <dl className="divide-y divide-black/[0.055] px-5 font-mono text-[12px]">
              {[
                { label: "Vault", value: vault?.address, copy: true },
                { label: "Owner", value: vault?.owner, copy: true },
                { label: "Agent", value: vault?.settlementAgent, copy: true },
                {
                  label: "USDT balance",
                  value: vault?.usdtBalanceFormatted ? `$${vault.usdtBalanceFormatted} USDT` : "—",
                  copy: false,
                },
                {
                  label: "Committed",
                  value: vault?.totalCommittedBudgetFormatted
                    ? `$${vault.totalCommittedBudgetFormatted} USDT`
                    : "—",
                  copy: false,
                },
                {
                  label: "ERC-8021",
                  value: vault?.attributionCode ?? "celo_55a64f75ba4a",
                  copy: true,
                },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 py-3">
                  <dt className="text-[#71717A]">{row.label}</dt>
                  <dd className="flex min-w-0 items-center gap-1.5 text-[#0A0A0C] tabular-nums">
                    <span className="truncate">
                      {row.value && row.value.startsWith("0x")
                        ? truncateMiddle(row.value, 8, 6)
                        : row.value ?? "—"}
                    </span>
                    {row.copy && row.value && (
                      <CopyButton value={row.value} toastMessage={`${row.label} copied`} />
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            {vault?.deployed && vault.address && (
              <div className="flex items-center justify-between gap-2 border-t border-black/[0.06] bg-[#FAFAFB] px-5 py-3">
                <a
                  href={`https://celoscan.io/address/${vault.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[12px] text-[#0A0A0C] underline underline-offset-2"
                >
                  Celoscan <ArrowUpRight className="h-3.5 w-3.5" />
                </a>

                <Button
                  size="sm"
                  variant="outlineStrong"
                  disabled={!isVaultOwner || isVaultActionPending}
                  onClick={handleTogglePause}
                  title={
                    isVaultOwner
                      ? "Owner emergency control"
                      : "Connect the VireVault owner wallet to pause/unpause"
                  }
                >
                  {vault.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  {vault.paused ? "Resume vault" : "Pause vault"}
                </Button>
              </div>
            )}
          </Card>

          <Card className="vire-enter vire-delay-2 overflow-hidden">
            <div className="flex items-center justify-between border-b border-black/[0.06] bg-[#FAFAFB] px-5 py-3.5">
              <h3 className="text-[13.5px] font-medium text-[#0A0A0C]">
                Supported tokens
              </h3>
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#71717A]">
                <TokenIcon symbol="CELO" size={14} />
                Celo Mainnet
              </span>
            </div>
            <div className="divide-y divide-black/[0.055] font-mono text-[12px]">
              {Object.values(CELO_TOKENS).map((t) => (
                <div key={t.symbol} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="inline-flex items-center gap-2 font-medium text-[#0A0A0C]">
                    <TokenIcon symbol={t.symbol} size={20} />
                    {t.symbol}
                  </span>
                  <span className="text-[#71717A]">{truncateMiddle(t.address, 8, 5)}</span>
                  <span className="text-[#3F3F46] tabular-nums">{t.decimals} decimals</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right: x402 Playground */}
        <Card className="vire-enter vire-delay-1 min-w-0 overflow-hidden lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] bg-[#FAFAFB] px-5 py-3.5">
            <h2 className="font-mono text-[12.5px] font-medium text-[#0A0A0C]">
              POST /api/x402/verify
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              <SegmentedTabs
                value={x402AssetMode}
                onChange={setX402AssetMode}
                options={[
                  { value: "default", label: "USDT / wFIAT" },
                  { value: "cngn", label: "cNGN", icon: <TokenIcon symbol="cNGN" size={15} /> },
                ]}
              />
              <Button
                size="sm"
                variant="primary"
                disabled={isTestingX402}
                onClick={handleProbeX402}
              >
                <PaperPlaneTilt weight="fill" className="h-3.5 w-3.5" />
                {isTestingX402 ? "Probing…" : "Send probe"}
              </Button>
            </div>
          </div>

          <div className="space-y-5 p-6">
            {x402Status !== null ? (
              <div className="space-y-4">
                <div className="vire-well flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 font-mono text-xs">
                  <div className="flex items-center gap-2.5">
                    <Badge tone={x402Status === 402 ? "ink" : "outline"}>HTTP {x402Status}</Badge>
                    <span className="text-[#3F3F46]">
                      {x402Status === 402 ? "x402 v2 Payment Required" : "Response received"}
                    </span>
                  </div>
                  {x402LatencyMs !== null && (
                    <span className="text-[11px] text-[#71717A] tabular-nums">
                      {x402LatencyMs}ms
                    </span>
                  )}
                </div>

                {x402DecodedHeader && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="font-mono text-[11.5px] text-[#71717A]">
                        Decoded payment-required header
                      </span>
                      <CopyButton
                        value={x402DecodedHeader}
                        label="Copy JSON"
                        toastMessage="Challenge copied"
                      />
                    </div>
                    <pre className="vire-well max-h-80 overflow-auto rounded-xl p-4 font-mono text-[11.5px] leading-relaxed text-[#0A0A0C]">
                      {x402DecodedHeader}
                    </pre>
                  </div>
                )}

                {x402Body && (
                  <div>
                    <div className="mb-1.5 font-mono text-[11.5px] text-[#71717A]">
                      Response body
                    </div>
                    <pre className="vire-well max-h-32 overflow-auto rounded-xl p-3 font-mono text-[11.5px] text-[#52525B]">
                      {x402Body}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="vire-well rounded-xl px-5 py-8 text-center">
                <p className="text-[13px] font-medium text-[#0A0A0C]">
                  Send an unpaid POST request to inspect the live HTTP 402 challenge.
                </p>
                <p className="mt-1 text-[12.5px] text-[#71717A]">
                  Decodes EIP-3009 and Permit2 payment requirements from{" "}
                  <code className="font-mono text-[#0A0A0C]">POST /api/x402/verify</code>.
                </p>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[11.5px] text-[#71717A]">
                  @x402/fetch client example
                </span>
                <CopyButton
                  value={sdkSnippet}
                  label="Copy"
                  toastMessage="Snippet copied"
                />
              </div>
              <pre className="vire-well overflow-x-auto rounded-xl p-4 font-mono text-[11.5px] leading-relaxed text-[#0A0A0C]">
                {sdkSnippet}
              </pre>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
