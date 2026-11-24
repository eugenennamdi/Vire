import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle,
  GlobeHemisphereWest,
  Lightning,
  LockKey,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";
import {
  CELO_CONTRACTS,
  celoscanAddressUrl,
  formatTokenAmount,
  getLaunchPartnerConfig,
} from "@vire/shared";
import Link from "next/link";
import { CorridorStrip } from "@/components/corridor-strip";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";
import { getLiveReputationSnapshot, getVaultSnapshot } from "@/lib/runtime";
import { truncateMiddle } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await ensureDatabaseReady();
  await ensureDefaultCampaignsSeeded();

  const partner = getLaunchPartnerConfig();
  const db = getDb();

  const [vault, rep, settlements, buyRows, x402Rows, rejectedRows] = await Promise.all([
    getVaultSnapshot(),
    getLiveReputationSnapshot(),
    db.select().from(schema.settlements),
    db.select().from(schema.buyPayments),
    db.select().from(schema.x402Inflows),
    db.select({ status: schema.submissions.status }).from(schema.submissions),
  ]);

  const uniqueRecipients = new Set(settlements.map((s) => s.recipientWallet.toLowerCase())).size;
  const rejectedCount = rejectedRows.filter((r) => r.status === "REJECTED").length;
  const paidBuyCount = buyRows.filter((b) => !b.dryRun && b.paymentTxHash).length;

  return (
    <div className="space-y-10">
      {/* Asymmetric Split Hero — Morpho / Linear / Vercel Precision */}
      <section className="vire-enter relative grid gap-8 pt-2 lg:grid-cols-12 lg:items-center lg:gap-10">
        <div className="space-y-6 lg:col-span-7">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="emerald">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Celo Mainnet · 42220
            </Badge>
            {rep.registered && rep.agentId ? (
              <Badge tone="neutral">
                <ShieldCheck weight="fill" className="h-3.5 w-3.5 text-emerald-400" />
                ERC-8004 Agent #{rep.agentId}
              </Badge>
            ) : (
              <Badge tone="neutral">ERC-8004 Identity Ready</Badge>
            )}
          </div>

          <h1 className="max-w-[18ch] text-4xl font-semibold tracking-[-0.04em] text-[#F4F5F6] leading-[1.04] text-balance sm:text-5xl lg:text-[52px]">
            Autonomous proof-of-work clearing across local stablecoins.
          </h1>

          <p className="max-w-[60ch] text-[15px] leading-relaxed text-[#9DA3AE] text-pretty">
            Vire verifies off-chain deliverables for{" "}
            <span className="font-medium text-[#E5E7EB]">{partner.name}</span> and remote teams via
            paid Celo <code className="font-mono text-[13px] text-[#E5E7EB]">buy</code> calls,
            converts exact-output USD₮ into local stablecoins (cNGN, wARS, wBRL, wMXN, IDRX) on
            Textile FX, and settles directly to contributors on Celo mainnet. It replaces manual
            checking and 4–8% FX fees with one auditable USD₮ vault.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link href="/claim" className={buttonVariants({ variant: "primary", size: "lg" })}>
              Submit &amp; claim payout
              <ArrowRight weight="bold" className="h-4 w-4" />
            </Link>
            <Link href="/ledger" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              Inspect live ledger
            </Link>
          </div>
        </div>

        {/* Live Clearing Engine Vault Snapshot (Real Onchain State, Zero Mock Data) */}
        <Card elevated className="relative overflow-hidden lg:col-span-5">
          <div className="vire-dot-grid border-b border-white/[0.07] px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <LockKey weight="regular" className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-medium text-[#E5E7EB]">VireVault Treasury</span>
              </div>
              <Badge tone={vault.deployed ? (vault.paused ? "amber" : "emerald") : "neutral"}>
                {vault.deployed ? (vault.paused ? "PAUSED" : "ACTIVE ONCHAIN") : "AWAITING DEPLOY"}
              </Badge>
            </div>

            <div className="mt-4 flex items-baseline justify-between gap-4">
              <div>
                <div className="text-[11px] text-[#8A8F98]">Vault USD₮ Liquidity</div>
                <div className="mt-1 font-mono text-2xl font-semibold tracking-[-0.02em] text-[#F4F5F6] tabular-nums">
                  {vault.usdtBalanceAtomic
                    ? `$${formatTokenAmount(vault.usdtBalanceAtomic, "USDT", 2)}`
                    : "$0.00"}
                  <span className="ml-1.5 text-xs font-normal text-[#6B7280]">USD₮</span>
                </div>
              </div>
              {vault.address && (
                <a
                  href={celoscanAddressUrl(vault.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-[#0B0D10]/80 px-2.5 py-1 font-mono text-[11px] text-[#B4BAC5] transition-colors hover:border-white/[0.16] hover:text-[#F4F5F6]"
                >
                  {truncateMiddle(vault.address, 6, 4)}
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>

          <dl className="divide-y divide-white/[0.06] px-5 text-xs">
            <div className="flex items-center justify-between py-3">
              <dt className="text-[#8A8F98]">FX execution cost</dt>
              <dd className="font-mono tabular-nums">
                <span className="mr-2 text-[#5C626D] line-through">4–8%</span>
                <span className="font-semibold text-emerald-400">0.02% (2 bps)</span>
              </dd>
            </div>
            <div className="flex items-center justify-between py-3">
              <dt className="text-[#8A8F98]">Clearing turnaround</dt>
              <dd className="font-mono tabular-nums">
                <span className="mr-2 text-[#5C626D] line-through">2–5 hrs</span>
                <span className="font-semibold text-[#F4F5F6]">&lt; 60 sec</span>
              </dd>
            </div>
            <div className="flex items-center justify-between py-3">
              <dt className="text-[#8A8F98]">Output guarantee</dt>
              <dd className="font-mono text-[#E5E7EB]">Exact buyAmount</dd>
            </div>
            <div className="flex items-center justify-between py-3">
              <dt className="text-[#8A8F98]">Settlement reactor</dt>
              <dd className="font-mono">
                <a
                  href={celoscanAddressUrl(CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[#B4BAC5] transition-colors hover:text-[#F4F5F6]"
                >
                  {truncateMiddle(CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR, 6, 4)}
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              </dd>
            </div>
          </dl>
        </Card>
      </section>

      {/* Live Textile FX Corridor Matrix */}
      <CorridorStrip />

      {/* Named Launch Partner Vault + Live Onchain Protocol Telemetry (7 / 5 Split) */}
      <section className="vire-enter vire-delay-2 grid gap-6 lg:grid-cols-12">
        <Card className="flex flex-col justify-between p-6 lg:col-span-7">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge tone="solid">Pilot Launch Partner</Badge>
              <span className="font-mono text-xs text-[#8A8F98]">{partner.location}</span>
            </div>

            <h2 className="mt-4 text-xl font-semibold tracking-[-0.025em] text-[#F4F5F6]">
              {partner.name}
            </h2>
            <p className="mt-1 text-sm text-emerald-400">{partner.tagline}</p>
            <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-[#9DA3AE]">
              Live 3-stage Black Friday &amp; December smartphone micro-affiliate campaign funded in
              USD₮ and cleared directly into SEC-regulated Nigerian Naira (cNGN) on Textile FX.
              Promoters progress across repeatable stages without spreadsheets or bank delays.
            </p>

            {/* 3-Stage Repeat Progression Strip */}
            <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {[
                { stage: "Stage 1", label: "Launch Promo Post", reward: "3,000 cNGN" },
                { stage: "Stage 2", label: "Spec Comparison Reel", reward: "5,000 cNGN" },
                { stage: "Stage 3", label: "Verified Buyer Referral", reward: "8,000 cNGN" },
              ].map((s) => (
                <div
                  key={s.stage}
                  className="rounded-lg border border-white/[0.07] bg-[#0B0D10] p-3"
                >
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-[#6B7280]">{s.stage}</span>
                    <span className="font-semibold text-emerald-400 tabular-nums">{s.reward}</span>
                  </div>
                  <div className="mt-1.5 text-xs font-medium text-[#E5E7EB]">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-5">
            <div className="flex items-center gap-5 font-mono text-xs tabular-nums">
              <div>
                <span className="text-[#6B7280]">Budget </span>
                <span className="font-semibold text-[#F4F5F6]">
                  ${partner.campaignBudgetUsdt} USD₮
                </span>
              </div>
              <div>
                <span className="text-[#6B7280]">Corridor </span>
                <span className="font-semibold text-emerald-400">cNGN (6dp)</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link href="/campaigns" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                All missions
              </Link>
              <Link
                href="/claim?campaign=launch-partner-blackfriday-cngn"
                className={buttonVariants({ variant: "emerald", size: "sm" })}
              >
                Claim cNGN
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </Card>

        {/* Clean Morpho-Style Hairline Telemetry Matrix */}
        <Card className="flex flex-col justify-between overflow-hidden lg:col-span-5">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
            <h2 className="text-xs font-medium text-[#E5E7EB]">Mainnet Protocol Telemetry</h2>
            <Link
              href="/ledger"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-400 transition-colors hover:text-emerald-300"
            >
              Open ledger
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="grid flex-1 grid-cols-2 divide-x divide-y divide-white/[0.06]">
            <div className="p-5">
              <div className="text-xs text-[#8A8F98]">Settled payouts</div>
              <div className="mt-2 font-mono text-3xl font-semibold tracking-[-0.03em] text-[#F4F5F6] tabular-nums">
                {settlements.length}
              </div>
              <div className="mt-1 font-mono text-[11px] text-[#6B7280]">
                {uniqueRecipients} external wallets
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs text-[#8A8F98]">Rejected claims</div>
              <div className="mt-2 font-mono text-3xl font-semibold tracking-[-0.03em] text-rose-400 tabular-nums">
                {rejectedCount}
              </div>
              <div className="mt-1 font-mono text-[11px] text-[#6B7280]">7-rule Policy Gate</div>
            </div>

            <div className="p-5">
              <div className="text-xs text-[#8A8F98]">Paid Celo buy</div>
              <div className="mt-2 font-mono text-3xl font-semibold tracking-[-0.03em] text-[#F4F5F6] tabular-nums">
                {paidBuyCount}
              </div>
              <div className="mt-1 font-mono text-[11px] text-[#6B7280]">Cencori + Chainstack</div>
            </div>

            <div className="p-5">
              <div className="text-xs text-[#8A8F98]">x402 inflows</div>
              <div className="mt-2 font-mono text-3xl font-semibold tracking-[-0.03em] text-emerald-400 tabular-nums">
                {x402Rows.length}
              </div>
              <div className="mt-1 font-mono text-[11px] text-[#6B7280]">api.x402.celo.org</div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/[0.07] bg-[#0B0D10] px-5 py-3 text-xs">
            <span className="text-[#8A8F98]">Test paid oracle endpoints</span>
            <Link
              href="/console"
              className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-[#F4F5F6] transition-colors hover:text-emerald-300"
            >
              x402 Playground
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </Card>
      </section>

      {/* Architectural Settlement Pipeline — Clean 4-Column Connected Rail (Zero Generic White Cards) */}
      <section className="vire-enter vire-delay-3 border-t border-white/[0.08] pt-8">
        <div className="max-w-xl">
          <h2 className="text-lg font-semibold tracking-[-0.025em] text-[#F4F5F6]">
            End-to-end clearing pipeline
          </h2>
          <p className="mt-1 text-sm text-[#8A8F98]">
            Verification judgment is isolated from onchain financial custody at every step.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 divide-y divide-white/[0.07] rounded-xl border border-white/[0.08] bg-[#0C0E11] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          {[
            {
              icon: Lightning,
              step: "01",
              title: "Paid Celo buy audit",
              body: "SSRF-guarded artifact fetch scored via Cencori LLM & Chainstack RPC paid over x402 ($0.01/call).",
            },
            {
              icon: LockKey,
              step: "02",
              title: "Deterministic Policy Gate",
              body: "7 pure rules + VireVault enforce replay hashes, non-team wallets, spread bps, and 24h limits.",
            },
            {
              icon: GlobeHemisphereWest,
              step: "03",
              title: "Exact-output Textile FX",
              body: "Firm buyAmount RFQ with native ERC-8021 builderCodes; unused USD₮ dust auto-refunds to vault.",
            },
            {
              icon: CheckCircle,
              step: "04",
              title: "Local off-ramp & ERC-8004",
              body: "Direct cNGN/wFIAT/IDRX delivery with prefilled Ripio/Naira ramps and 1-click giveFeedback().",
            },
          ].map((item) => (
            <div key={item.step} className="p-5">
              <div className="flex items-center justify-between">
                <item.icon weight="regular" className="h-4 w-4 text-emerald-400" />
                <span className="font-mono text-[11px] text-[#5C626D]">{item.step}</span>
              </div>
              <h3 className="mt-3.5 text-sm font-medium text-[#F4F5F6]">{item.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-[#8A8F98]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
