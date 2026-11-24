import {
  CELO_CONTRACTS,
  celoscanAddressUrl,
  formatTokenAmount,
  getLaunchPartnerConfig,
} from "@vire/shared";
import { ArrowRight, CheckCircle2, Globe2, Lock, ShieldCheck, Zap } from "lucide-react";
import Link from "next/link";
import { CorridorStrip } from "@/components/corridor-strip";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";
import { getLiveReputationSnapshot, getVaultSnapshot } from "@/lib/runtime";

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
    <div className="space-y-8">
      {/* Institutional Hero / 2-Sentence Thesis */}
      <section className="rounded-2xl border border-zinc-200/90 bg-white p-6 sm:p-8 lg:p-10">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-mono font-medium text-emerald-800">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
            CELO MAINNET (42220) · TEXTILE FX V2
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 font-mono text-zinc-700">
            <ShieldCheck className="h-3.5 w-3.5 text-zinc-900" />
            {rep.registered && rep.agentId
              ? `ERC-8004 Agent #${rep.agentId}${rep.summary?.averageScore ? ` · ${rep.summary.averageScore}/100` : ""}`
              : "ERC-8004 Identity & Reputation Ready"}
          </span>
        </div>

        <div className="mt-5 grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">
              Autonomous Proof-of-Work &amp; Multi-Corridor FX Settlement on Celo.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-zinc-600">
              Vire is an autonomous proof-of-work and commission settlement agent built for{" "}
              <strong className="font-semibold text-zinc-900">{partner.name}</strong> and cross-border
              remote teams that verifies off-chain deliverables (promo posts, verified referrals, QA bug
              reports, and localization tasks), converts exact-output USD₮ into local stablecoins (cNGN,
              wARS, wBRL, wMXN, IDRX) on Textile FX, and settles directly to contributors on Celo
              mainnet. It replaces hours of manual deliverable checking, spreadsheets, and 4–8% multi-hop
              FX/bank fees with a single auditable onchain settlement loop funded from one USD₮ treasury.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href="/claim"
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Submit Deliverable &amp; Claim Local FX
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/ledger"
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                Inspect Public Live Audit Ledger
              </Link>
              <Link
                href="/console"
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
              >
                x402 API Playground
              </Link>
            </div>
          </div>

          {/* Manual vs Vire Economics Comparison */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 lg:col-span-4">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Clearing Cost &amp; Speed Delta
            </div>
            <dl className="mt-3 space-y-2.5 text-xs">
              <div className="flex items-center justify-between border-b border-zinc-200/70 pb-2">
                <dt className="text-zinc-600">FX &amp; Cross-Border Fee</dt>
                <dd className="font-mono font-semibold text-zinc-950 tabular-nums">
                  <span className="mr-1.5 text-zinc-400 line-through">4–8%</span>
                  <span className="text-emerald-700">0.02% (2 bps)</span>
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-zinc-200/70 pb-2">
                <dt className="text-zinc-600">Verification &amp; Clearing</dt>
                <dd className="font-mono font-semibold text-zinc-950 tabular-nums">
                  <span className="mr-1.5 text-zinc-400 line-through">2–5 hrs</span>
                  <span className="text-emerald-700">&lt; 60 sec</span>
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-zinc-200/70 pb-2">
                <dt className="text-zinc-600">Local Amount Certainty</dt>
                <dd className="font-mono font-semibold text-emerald-700">Exact-Output buyAmount</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-600">Custody Guardrail</dt>
                <dd className="font-mono font-semibold text-zinc-950">VireVault Onchain Caps</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* Live Textile FX v2 Corridor Ticker */}
      <CorridorStrip />

      {/* Named Launch Partner Spotlight + Live Onchain Clearing Stats */}
      <section className="grid gap-6 lg:grid-cols-12">
        <div className="rounded-2xl border border-zinc-200/90 bg-white p-6 lg:col-span-7">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-md bg-zinc-950 px-2.5 py-1 font-mono text-[11px] font-medium text-white">
              PILOT CLIENT #1 · NAMED LAUNCH PARTNER
            </span>
            <span className="font-mono text-xs text-zinc-500">{partner.location}</span>
          </div>

          <h2 className="mt-4 text-xl font-semibold tracking-tight text-zinc-950">
            {partner.name}
          </h2>
          <p className="mt-1 text-sm font-medium text-emerald-800">{partner.tagline}</p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600">
            Running a live 3-stage Black Friday &amp; December smartphone micro-affiliate and promo
            verification campaign funded in USD₮ on <code className="font-mono text-xs">VireVault</code>{" "}
            and cleared directly into SEC-regulated Nigerian Naira (<strong className="text-zinc-900">cNGN</strong>)
            via Textile FX. Promoters return across Stage 1 (Launch Post), Stage 2 (Spec Reel), and Stage 3
            (Verified Buyer Referral) without spreadsheets or bank transfer bottlenecks.
          </p>

          <div className="mt-5 grid grid-cols-3 gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3.5">
            <div>
              <div className="font-mono text-[11px] uppercase text-zinc-500">Treasury Budget</div>
              <div className="mt-0.5 font-mono text-base font-semibold text-zinc-950 tabular-nums">
                ${partner.campaignBudgetUsdt} USD₮
              </div>
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase text-zinc-500">Payout Asset</div>
              <div className="mt-0.5 font-mono text-base font-semibold text-emerald-700">
                cNGN (6dp)
              </div>
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase text-zinc-500">Repeat Stages</div>
              <div className="mt-0.5 font-mono text-base font-semibold text-zinc-950">
                3 Stages / Promoter
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href="/campaigns"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-800"
            >
              View Multi-Stage Missions
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/claim?campaign=launch-partner-blackfriday-cngn"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3.5 py-2 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Claim cNGN Payout
            </Link>
          </div>
        </div>

        {/* Live Telemetry & Onchain Custody Status */}
        <div className="flex flex-col justify-between rounded-2xl border border-zinc-200/90 bg-white p-6 lg:col-span-5">
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Live Mainnet Telemetry
              </span>
              <Link href="/ledger" className="font-mono text-xs text-emerald-700 hover:underline">
                Full Ledger →
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3.5">
                <div className="text-xs text-zinc-500">Settled Payouts</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-zinc-950 tabular-nums">
                  {settlements.length}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                  {uniqueRecipients} external wallets
                </div>
              </div>
              <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3.5">
                <div className="text-xs text-zinc-500">Rejected Claims</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-rose-700 tabular-nums">
                  {rejectedCount}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                  7-rule Policy Gate
                </div>
              </div>
              <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3.5">
                <div className="text-xs text-zinc-500">Paid Celo buy Calls</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-zinc-950 tabular-nums">
                  {paidBuyCount}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                  Cencori + Chainstack
                </div>
              </div>
              <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3.5">
                <div className="text-xs text-zinc-500">x402 PayTo Inflows</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
                  {x402Rows.length}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                  api.x402.celo.org
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900">VireVault Onchain Custody</span>
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${
                  vault.deployed
                    ? vault.paused
                      ? "bg-amber-100 text-amber-900"
                      : "bg-emerald-100 text-emerald-800"
                    : "bg-zinc-200 text-zinc-700"
                }`}
              >
                {vault.deployed ? (vault.paused ? "PAUSED" : "ACTIVE ON 42220") : "AWAITING DEPLOY"}
              </span>
            </div>
            <div className="mt-2 space-y-1 font-mono text-[11px] text-zinc-600">
              <div className="flex justify-between">
                <span>Vault Balance:</span>
                <span className="font-semibold text-zinc-950">
                  {vault.usdtBalanceAtomic
                    ? `${formatTokenAmount(vault.usdtBalanceAtomic, "USDT", 2)} USD₮`
                    : "Configure VIRE_VAULT_ADDRESS"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Textile Reactor:</span>
                <a
                  href={celoscanAddressUrl(CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-700 underline"
                >
                  0xa9AA…35b3
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4-Step Autonomous Clearing Architecture Strip */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: Zap,
            step: "01",
            title: "Paid Celo buy Verification",
            body: "Fetches GitHub PRs or promo URLs safely and pays $0.01 per verification call to Cencori LLM & Chainstack RPC via Celo buy over x402.",
          },
          {
            icon: Lock,
            step: "02",
            title: "7-Rule Policy Gate + VireVault",
            body: "Deterministic anti-duplicate, external-identity, non-team wallet, spread, $1 floor, daily limit, and per-payout cap enforcement onchain.",
          },
          {
            icon: Globe2,
            step: "03",
            title: "Exact-Output Textile FX v2",
            body: "Requests firm buyAmount quotes with native ERC-8021 builderCodes, broadcasts executeBatch verbatim, and refunds unused USD₮ dust.",
          },
          {
            icon: CheckCircle2,
            step: "04",
            title: "Local Payout + Off-Ramp + ERC-8004",
            body: "Delivers exact cNGN, wARS, wBRL, wMXN, or 2-decimal IDRX with prefilled Ripio/Naira ramp links and 1-click ERC-8004 rating.",
          },
        ].map((card) => (
          <div key={card.step} className="rounded-xl border border-zinc-200/90 bg-white p-5">
            <div className="flex items-center justify-between">
              <card.icon className="h-4 w-4 text-emerald-700" />
              <span className="font-mono text-xs font-semibold text-zinc-400">{card.step}</span>
            </div>
            <h3 className="mt-3 text-sm font-semibold text-zinc-950">{card.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">{card.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
