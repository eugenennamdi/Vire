import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import {
  celoscanAddressUrl,
  celoscanTxUrl,
  CORRIDORS,
  DEFAULT_ATTRIBUTION_CODE,
  formatTokenAmount,
  type CampaignStage,
  type CorridorSymbol,
} from "@vire/shared";
import { desc } from "drizzle-orm";
import Link from "next/link";
import { ClearingInspector, type InspectorCampaign } from "@/components/clearing-inspector";
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

  const db = getDb();
  const attributionCode = process.env.VIRE_ATTRIBUTION_CODE || DEFAULT_ATTRIBUTION_CODE;

  const [vault, rep, campaignRows, settlements, buyRows, x402Rows, rejectedRows] =
    await Promise.all([
      getVaultSnapshot(),
      getLiveReputationSnapshot(),
      db
        .select()
        .from(schema.campaigns)
        .orderBy(desc(schema.campaigns.isLaunchPartner), desc(schema.campaigns.createdAt)),
      db.select().from(schema.settlements).orderBy(desc(schema.settlements.settledAt)),
      db.select().from(schema.buyPayments),
      db.select().from(schema.x402Inflows),
      db.select({ status: schema.submissions.status }).from(schema.submissions),
    ]);

  const rejectedCount = rejectedRows.filter((r) => r.status === "REJECTED").length;
  const paidBuyCount = buyRows.filter((b) => !b.dryRun && b.paymentTxHash).length;

  const inspectorCampaigns: InspectorCampaign[] = campaignRows.map((row) => {
    const corridor = row.corridor as CorridorSymbol;
    const stages = JSON.parse(row.stagesJson) as CampaignStage[];
    const stage1 = stages[0];
    const meta = CORRIDORS[corridor];
    return {
      id: row.id,
      slug: row.slug,
      partnerName: row.partnerName,
      partnerLocation: row.partnerLocation,
      title: row.title,
      deliverableType: row.deliverableType,
      corridor: row.corridor,
      localTokenDecimals: row.localTokenDecimals,
      stage1Title: stage1?.title ?? "Stage 1",
      stage1Instructions: stage1?.instructions ?? row.description,
      stage1RewardFormatted: stage1
        ? formatTokenAmount(stage1.rewardLocalAtomic, corridor, 2)
        : "0",
      budgetUsdtFormatted: formatTokenAmount(row.budgetUsdtAtomic, "USDT", 2),
      remainingUsdtFormatted: formatTokenAmount(row.remainingUsdtAtomic, "USDT", 2),
      maxPerPayoutUsdtFormatted: formatTokenAmount(row.maxPerPayoutUsdtAtomic, "USDT", 2),
      dailyLimitUsdtFormatted: formatTokenAmount(row.dailyLimitUsdtAtomic, "USDT", 2),
      maxSpreadBps: row.maxSpreadBps,
      minPassScore: row.minPassScore,
      offrampRail:
        meta?.offrampProvider === "cngn_venues"
          ? "Busha / Quidax / Yellow Card"
          : meta?.offrampProvider === "idrx_guide"
            ? "IDRX Bank Redeem (IDR)"
            : "Ripio Portal (CBU / PIX / CLABE)",
    };
  });

  const recentSettlements = settlements.slice(0, 4);

  return (
    <div className="space-y-14">
      {/* BAND 1: Editorial Clearinghouse Masthead + Live VireVault Custody Sheet */}
      <section className="vire-enter grid gap-8 border-b border-[#E4E2DC] pb-12 pt-2 lg:grid-cols-12 lg:items-end">
        <div className="min-w-0 space-y-5 lg:col-span-7">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.06em] text-[#68665F]">
            <span>Celo Mainnet · 42220</span>
            <span>/</span>
            <span>{rep.registered && rep.agentId ? `ERC-8004 #${rep.agentId}` : "ERC-8004"}</span>
            <span>/</span>
            <span>{attributionCode}</span>
          </div>

          <h1 className="max-w-[16ch] font-serif text-[40px] font-normal tracking-[-0.03em] text-[#121210] leading-[1.04] sm:text-[52px]">
            Verify off-chain work. Clear{" "}
            <em className="italic">exact</em> local FX.
          </h1>

          <p className="max-w-[56ch] text-[15px] leading-[1.65] text-[#4F4E4A]">
            Vire is an autonomous clearing agent for merchants and remote contributors. It audits
            deliverables over paid{" "}
            <code className="font-mono text-[13px] text-[#121210]">x402</code>, enforces onchain{" "}
            <code className="font-mono text-[13px] text-[#121210]">VireVault</code> spending caps,
            and converts USDT into exact local stablecoins on Textile FX.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link href="/claim" className={buttonVariants({ variant: "primary", size: "lg" })}>
              Submit deliverable
              <ArrowRight weight="bold" className="h-4 w-4" />
            </Link>
            <Link href="/campaigns" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              Browse campaigns
            </Link>
            <Link href="/ledger" className={buttonVariants({ variant: "ghost", size: "lg" })}>
              Audit ledger
            </Link>
          </div>
        </div>

        {/* Right: Architectural VireVault Custody Sheet */}
        <div className="vire-sheet min-w-0 overflow-hidden rounded-[6px] lg:col-span-5">
          <div className="flex items-center justify-between border-b border-[#E4E2DC] bg-[#F3F1EC]/70 px-5 py-3">
            <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-[#68665F]">
              VireVault Custody Account
            </span>
            <Badge tone={vault.deployed && !vault.paused ? "ink" : "neutral"}>
              {vault.deployed ? (vault.paused ? "PAUSED" : "ACTIVE") : "UNCONFIGURED"}
            </Badge>
          </div>

          <div className="p-5">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="font-mono text-[11px] text-[#68665F]">Onchain USDT balance</div>
                <div className="mt-1 font-mono text-3xl font-semibold tracking-[-0.03em] text-[#121210] tabular-nums">
                  {vault.usdtBalanceAtomic !== null
                    ? `$${formatTokenAmount(vault.usdtBalanceAtomic, "USDT")}`
                    : "—"}
                  <span className="ml-1.5 text-xs font-normal text-[#68665F]">USDT</span>
                </div>
              </div>

              {vault.address && (
                <a
                  href={celoscanAddressUrl(vault.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs text-[#4F4E4A] underline underline-offset-4 hover:text-[#121210]"
                >
                  {truncateMiddle(vault.address, 6, 4)}
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 divide-x divide-[#E4E2DC] border-t border-[#E4E2DC] bg-[#FAF9F6] font-mono text-[11px] tabular-nums">
            <div className="px-4 py-3">
              <div className="text-[#68665F]">Settled</div>
              <div className="mt-0.5 text-sm font-semibold text-[#121210]">{settlements.length}</div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[#68665F]">Rejected</div>
              <div className="mt-0.5 text-sm font-semibold text-[#121210]">{rejectedCount}</div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[#68665F]">x402 calls</div>
              <div className="mt-0.5 text-sm font-semibold text-[#121210]">
                {x402Rows.length + paidBuyCount}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BAND 2 & 3: Interactive 4-Stage Agent Clearing Inspector + Live Bank FX Rate Board */}
      <ClearingInspector campaigns={inspectorCampaigns} />

      {/* BAND 4: Live Ledger Snapshot + Machine-Readable Agent Surfaces */}
      <section className="grid gap-8 border-t border-[#E4E2DC] pt-12 lg:grid-cols-12">
        {/* Left: Live Mainnet Settlement Feed */}
        <div className="min-w-0 space-y-4 lg:col-span-7">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#68665F]">
                Live Proof of Execution
              </p>
              <h2 className="mt-1 font-serif text-2xl font-normal tracking-[-0.02em] text-[#121210]">
                Recent onchain settlements
              </h2>
            </div>
            <Link
              href="/ledger"
              className="inline-flex items-center gap-1 font-mono text-xs text-[#4F4E4A] hover:text-[#121210]"
            >
              Full ledger <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="vire-sheet overflow-hidden rounded-[6px]">
            {recentSettlements.length > 0 ? (
              <div className="divide-y divide-[#E4E2DC]">
                {recentSettlements.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-[#121210] tabular-nums">
                        {formatTokenAmount(s.localAmountAtomic, s.corridor as CorridorSymbol, 2)}{" "}
                        {s.corridor}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-[#68665F]">
                        {truncateMiddle(s.recipientWallet, 8, 6)} ·{" "}
                        {new Date(s.settledAt).toLocaleDateString()}
                      </div>
                    </div>
                    <a
                      href={celoscanTxUrl(s.textileSwapTxHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-[#121210] underline underline-offset-4"
                    >
                      Textile tx <ArrowUpRight className="h-3 w-3" />
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6">
                <p className="text-sm font-medium text-[#121210]">
                  Zero synthetic entries — awaiting live mainnet payouts.
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-[#68665F]">
                  Every verified settlement posts 4 immutable Celo Mainnet proofs (VireVault
                  release, ERC-8021 tagged Textile FX swap, direct local payout, and audit receipt)
                  directly to the public ledger.
                </p>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  <Link href="/claim" className={buttonVariants({ variant: "primary", size: "sm" })}>
                    Run first claim
                  </Link>
                  <Link href="/console" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                    Test x402 HTTP 402
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Autonomous Agent & x402 Specification Table */}
        <div className="min-w-0 space-y-4 lg:col-span-5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#68665F]">
              Programmatic Access
            </p>
            <h2 className="mt-1 font-serif text-2xl font-normal tracking-[-0.02em] text-[#121210]">
              Agent &amp; x402 endpoints
            </h2>
          </div>

          <div className="vire-sheet overflow-hidden rounded-[6px]">
            <dl className="divide-y divide-[#E4E2DC] font-mono text-xs">
              {[
                {
                  method: "GET",
                  path: "/api/agent-card.json",
                  desc: "ERC-8004 manifest",
                  href: "/api/agent-card.json",
                },
                {
                  method: "POST",
                  path: "/api/x402/verify",
                  desc: "Paid x402 audit",
                  href: "/console",
                },
                {
                  method: "POST",
                  path: "/api/x402/campaigns",
                  desc: "Create campaign",
                  href: "/console",
                },
                {
                  method: "GET",
                  path: "/api/corridors/live",
                  desc: "Textile FX feed",
                  href: "/api/corridors/live",
                },
                {
                  method: "GET",
                  path: "/api/ledger",
                  desc: "Public audit feed",
                  href: "/api/ledger",
                },
              ].map((ep) => (
                <Link
                  key={ep.path}
                  href={ep.href}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[#FAF9F6]"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="w-9 shrink-0 text-[10px] font-semibold text-[#68665F]">
                      {ep.method}
                    </span>
                    <span className="truncate text-[#121210]">{ep.path}</span>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-[#68665F]">
                    {ep.desc}
                    <ArrowUpRight className="h-3 w-3" />
                  </span>
                </Link>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </div>
  );
}
