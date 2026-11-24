import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { celoscanAddressUrl, formatTokenAmount, getLaunchPartnerConfig } from "@vire/shared";
import Link from "next/link";
import { CorridorStrip } from "@/components/corridor-strip";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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
    <div className="space-y-12">
      {/* Header — Direct, zero-slop Swiss typography */}
      <section className="vire-enter max-w-2xl space-y-5 pt-2">
        <p className="font-mono text-xs text-[#737373]">
          Celo Mainnet (42220)
          {rep.registered && rep.agentId ? ` · ERC-8004 Agent #${rep.agentId}` : ""}
        </p>

        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-[#111111] leading-[1.06] sm:text-[44px]">
          Verify work. Settle exact local FX.
        </h1>

        <p className="max-w-[58ch] text-[15px] leading-relaxed text-[#525252]">
          Vire audits off-chain deliverables, enforces onchain{" "}
          <code className="font-mono text-[13px] text-[#111111]">VireVault</code> caps, and
          routes exact-output payouts across cNGN, wARS, wBRL, wMXN, and IDRX via Textile FX.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link href="/claim" className={buttonVariants({ variant: "primary", size: "lg" })}>
            Submit deliverable
            <ArrowRight weight="bold" className="h-4 w-4" />
          </Link>
          <Link href="/campaigns" className={buttonVariants({ variant: "secondary", size: "lg" })}>
            Campaigns
          </Link>
          <Link href="/ledger" className={buttonVariants({ variant: "ghost", size: "lg" })}>
            Audit ledger
          </Link>
        </div>
      </section>

      {/* Unified Monochrome Protocol Strip */}
      <section
        aria-label="Live Protocol State"
        className="vire-surface vire-enter vire-delay-1 overflow-hidden rounded-lg"
      >
        <div className="grid grid-cols-2 divide-x divide-y divide-[#E5E5E5] lg:grid-cols-4 lg:divide-y-0">
          <div className="p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[#737373]">VireVault balance</span>
              <span className="font-mono text-[10px] text-[#525252]">
                {vault.deployed ? (vault.paused ? "Paused" : "Active") : "Unconfigured"}
              </span>
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold tracking-[-0.03em] text-[#111111] tabular-nums">
              {vault.usdtBalanceAtomic !== null
                ? `$${formatTokenAmount(vault.usdtBalanceAtomic, "USDT")}`
                : "—"}
              <span className="ml-1 text-xs font-normal text-[#737373]">USD₮</span>
            </div>
            <div className="mt-1.5 font-mono text-[11px] text-[#737373]">
              {vault.address ? (
                <a
                  href={celoscanAddressUrl(vault.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-[#111111]"
                >
                  {truncateMiddle(vault.address, 6, 4)}
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              ) : (
                "Not configured"
              )}
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs text-[#737373]">Settled payouts</div>
            <div className="mt-2 font-mono text-2xl font-semibold tracking-[-0.03em] text-[#111111] tabular-nums">
              {settlements.length}
            </div>
            <div className="mt-1.5 font-mono text-[11px] text-[#737373]">
              {uniqueRecipients} external wallets
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs text-[#737373]">Policy rejections</div>
            <div className="mt-2 font-mono text-2xl font-semibold tracking-[-0.03em] text-[#111111] tabular-nums">
              {rejectedCount}
            </div>
            <div className="mt-1.5 font-mono text-[11px] text-[#737373]">
              7-rule deterministic gate
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs text-[#737373]">x402 activity</div>
            <div className="mt-2 font-mono text-2xl font-semibold tracking-[-0.03em] text-[#111111] tabular-nums">
              {x402Rows.length + paidBuyCount}
            </div>
            <div className="mt-1.5 font-mono text-[11px] text-[#737373]">
              {x402Rows.length} inflows · {paidBuyCount} paid calls
            </div>
          </div>
        </div>
      </section>

      {/* Live Textile FX Corridors */}
      <CorridorStrip />

      {/* Two-Column Split: Featured Partner + Clearing Spec */}
      <section className="vire-enter vire-delay-2 grid gap-10 border-t border-[#E5E5E5] pt-10 lg:grid-cols-12">
        {/* Left: Launch Partner */}
        <div className="space-y-5 lg:col-span-7">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="outline">Featured campaign</Badge>
            <span className="font-mono text-xs text-[#737373]">
              {partner.name} · {partner.location} · cNGN (6dp)
            </span>
          </div>

          <div>
            <h2 className="text-xl font-semibold tracking-[-0.025em] text-[#111111]">
              {partner.name}
            </h2>
            <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-[#525252]">
              {partner.tagline}. Budget cap: ${partner.campaignBudgetUsdt} USD₮ ({partner.handle}).
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border border-[#E5E5E5]">
            <div className="grid grid-cols-1 divide-y divide-[#E5E5E5] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {[
                { stage: "Stage 1", title: "Launch Promo Post", reward: "3,000 cNGN", sub: "Immediate" },
                { stage: "Stage 2", title: "Comparison Thread", reward: "5,000 cNGN", sub: "12h cooldown" },
                { stage: "Stage 3", title: "Verified Referral", reward: "8,000 cNGN", sub: "24h cooldown" },
              ].map((item) => (
                <div key={item.stage} className="bg-white p-4">
                  <div className="font-mono text-[11px] text-[#737373]">{item.stage}</div>
                  <div className="mt-1 text-sm font-medium text-[#111111]">{item.title}</div>
                  <div className="mt-2 font-mono text-sm font-semibold text-[#111111] tabular-nums">
                    {item.reward}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-[#737373]">{item.sub}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="font-mono text-xs text-[#737373]">
              maxSpread 250bps · maxPerPayout $15 · dailyCap $100
            </span>
            <Link
              href="/claim?campaign=black-friday-gadget-micro-affiliate"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Submit proof
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Right: Clearing Architecture (Plain Typographic List) */}
        <div className="space-y-4 lg:col-span-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-[-0.015em] text-[#111111]">
              Clearing flow
            </h2>
            <Link
              href="/console"
              className="inline-flex items-center gap-1 font-mono text-xs text-[#525252] transition-colors hover:text-[#111111]"
            >
              x402 console
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <ol className="divide-y divide-[#E5E5E5] border-y border-[#E5E5E5]">
            {[
              {
                step: "01",
                title: "Deliverable verification",
                body: "SSRF-guarded fetch scored via paid x402 usebuy.ai calls (Cencori LLM & Chainstack RPC).",
              },
              {
                step: "02",
                title: "Deterministic Policy Gate",
                body: "7 pure rules plus onchain VireVault checks block replays, team wallets, and excess spreads.",
              },
              {
                step: "03",
                title: "Exact-output Textile FX",
                body: "Firm buyAmount quote with ERC-8021 builderCodes; unused USD₮ dust refunds to the vault.",
              },
              {
                step: "04",
                title: "Direct payout & ERC-8004",
                body: "Local stablecoin transfer to contributor wallet with off-ramp guidance and onchain feedback.",
              },
            ].map((item) => (
              <li key={item.step} className="flex gap-4 py-3.5">
                <span className="font-mono text-xs text-[#737373] tabular-nums">{item.step}</span>
                <div>
                  <div className="text-sm font-medium text-[#111111]">{item.title}</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-[#525252]">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
