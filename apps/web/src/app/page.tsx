import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import {
  celoscanAddressUrl,
  CORRIDORS,
  formatTokenAmount,
  type CampaignStage,
  type CorridorSymbol,
} from "@vire/shared";
import { desc } from "drizzle-orm";
import Link from "next/link";
import { ClearingTerminal, type TerminalCampaign } from "@/components/clearing-terminal";
import { Badge } from "@/components/ui/badge";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { ensureDefaultCampaignsSeeded } from "@/db/seed";
import { getLiveReputationSnapshot, getVaultSnapshot } from "@/lib/runtime";
import { truncateMiddle } from "@/lib/utils";

export const dynamic = "force-dynamic";

const AGENT_ENDPOINTS = [
  { href: "/api/agent-card.json", label: "agent-card.json" },
  { href: "/api/corridors/live", label: "Corridors API" },
  { href: "/api/ledger", label: "Ledger API" },
  { href: "/console", label: "x402 Playground" },
] as const;

export default async function HomePage() {
  await ensureDatabaseReady();
  await ensureDefaultCampaignsSeeded();

  const db = getDb();

  const [vault, rep, campaignRows, settlements, buyRows, x402Rows, rejectedRows] =
    await Promise.all([
      getVaultSnapshot(),
      getLiveReputationSnapshot(),
      db
        .select()
        .from(schema.campaigns)
        .orderBy(desc(schema.campaigns.isLaunchPartner), desc(schema.campaigns.createdAt)),
      db.select().from(schema.settlements),
      db.select().from(schema.buyPayments),
      db.select().from(schema.x402Inflows),
      db.select({ status: schema.submissions.status }).from(schema.submissions),
    ]);

  const uniqueRecipients = new Set(settlements.map((s) => s.recipientWallet.toLowerCase())).size;
  const rejectedCount = rejectedRows.filter((r) => r.status === "REJECTED").length;
  const paidBuyCount = buyRows.filter((b) => !b.dryRun && b.paymentTxHash).length;

  const initialCampaigns: TerminalCampaign[] = campaignRows.map((row) => {
    const corridor = row.corridor as CorridorSymbol;
    const stages = JSON.parse(row.stagesJson) as CampaignStage[];
    const meta = CORRIDORS[corridor];
    return {
      id: row.id,
      slug: row.slug,
      partnerName: row.partnerName,
      partnerLocation: row.partnerLocation,
      isLaunchPartner: row.isLaunchPartner,
      title: row.title,
      description: row.description,
      deliverableType: row.deliverableType,
      corridor: row.corridor,
      localTokenDecimals: row.localTokenDecimals,
      stages: stages.map((st) => ({
        ...st,
        rewardLocalFormatted: formatTokenAmount(st.rewardLocalAtomic, corridor, 2),
      })),
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

  return (
    <div className="space-y-12">
      {/* Asymmetric Editorial Hero + Live Sculptural Vault Card */}
      <section className="vire-enter grid gap-8 pt-2 lg:grid-cols-12 lg:items-center">
        <div className="min-w-0 space-y-4 lg:col-span-7">
          <h1 className="max-w-[16ch] text-4xl font-semibold tracking-[-0.04em] text-foreground leading-[1.05] sm:text-[46px]">
            Verify work. Settle exact local FX.
          </h1>
          <p className="max-w-[54ch] text-[15px] leading-[1.6] text-muted-foreground">
            Audit off-chain deliverables via{" "}
            <code className="font-mono text-[13px] font-medium text-foreground">x402</code>, enforce
            onchain{" "}
            <code className="font-mono text-[13px] font-medium text-foreground">VireVault</code>{" "}
            caps, and pay exact{" "}
            <code className="font-mono text-[13px] font-medium text-foreground">cNGN</code>,{" "}
            <code className="font-mono text-[13px] font-medium text-foreground">wARS</code>,{" "}
            <code className="font-mono text-[13px] font-medium text-foreground">wBRL</code>,{" "}
            <code className="font-mono text-[13px] font-medium text-foreground">IDRX</code>, and{" "}
            <code className="font-mono text-[13px] font-medium text-foreground">wMXN</code> on Celo
            Mainnet.
          </p>
        </div>

        {/* Right: Sculptural Live VireVault Instrument */}
        <div className="surface-card min-w-0 rounded-2xl p-5 sm:p-6 lg:col-span-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Onchain Treasury · Celo 42220
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-foreground">VireVault</span>
                <Badge tone="neutral">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      vault.deployed && !vault.paused
                        ? "bg-foreground"
                        : "border border-muted-foreground/60"
                    }`}
                  />
                  {vault.deployed ? (vault.paused ? "PAUSED" : "ACTIVE") : "UNCONFIGURED"}
                </Badge>
              </div>
            </div>

            <div className="text-right">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Balance
              </div>
              <div className="mt-1 font-mono text-2xl font-semibold tracking-[-0.03em] text-foreground tabular-nums">
                {vault.usdtBalanceAtomic !== null
                  ? `$${formatTokenAmount(vault.usdtBalanceAtomic, "USDT")}`
                  : "—"}
                <span className="ml-1 text-xs font-normal text-muted-foreground">USD₮</span>
              </div>
            </div>
          </div>

          <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-black/[0.06]">
            <div
              className="h-full rounded-full bg-foreground"
              style={{
                width:
                  vault.usdtBalanceAtomic && BigInt(vault.usdtBalanceAtomic) > 0n ? "100%" : "8%",
              }}
            />
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2 border-t border-black/[0.06] pt-3.5 font-mono text-[11px] tabular-nums">
            <div>
              <div className="text-muted-foreground">Settled</div>
              <div className="mt-0.5 font-semibold text-foreground">{settlements.length}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Guarded</div>
              <div className="mt-0.5 font-semibold text-foreground">{rejectedCount}</div>
            </div>
            <div>
              <div className="text-muted-foreground">x402</div>
              <div className="mt-0.5 font-semibold text-foreground">
                {x402Rows.length + paidBuyCount}
              </div>
            </div>
            <div className="text-right">
              <div className="text-muted-foreground">Contract</div>
              <div className="mt-0.5 font-medium text-foreground">
                {vault.address ? (
                  <a
                    href={celoscanAddressUrl(vault.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 hover:underline"
                  >
                    {truncateMiddle(vault.address, 4, 3)}
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                ) : (
                  "—"
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Hairline Divider into Live Interactive Clearing Terminal */}
      <div className="border-t border-black/[0.06] pt-10">
        <ClearingTerminal initialCampaigns={initialCampaigns} />
      </div>

      {/* Unified Architectural 5-Cell Bento Protocol Overview */}
      <section
        aria-labelledby="how-vire-works"
        className="space-y-6 border-t border-black/[0.06] pt-12"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">How clearing works</p>
            <h2
              id="how-vire-works"
              className="text-2xl font-semibold tracking-[-0.03em] leading-[1.15] text-foreground sm:text-[28px]"
            >
              Three steps from proof to exact local currency.
            </h2>
          </div>

          <Link
            href="/ledger"
            className="group inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <span>Inspect public ledger</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="surface-card overflow-hidden rounded-2xl">
          {/* Top Row: 3 Equal Steps */}
          <div className="grid divide-y divide-black/[0.06] md:grid-cols-3 md:divide-x md:divide-y-0">
            <article className="p-7 sm:p-8">
              <div className="font-mono text-xs font-medium text-muted-foreground/75">01</div>
              <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.015em] text-foreground">
                Verify off-chain proof
              </h3>
              <p className="mt-2 text-[13.5px] leading-[1.6] text-muted-foreground">
                Contributors bind an external Celo wallet via EIP-191 or GitHub OAuth and submit a
                deliverable URL. Vire fetches the artifact safely and scores it via paid{" "}
                <code className="font-mono text-xs text-foreground">usebuy.ai</code> calls.
              </p>
            </article>

            <article className="p-7 sm:p-8">
              <div className="font-mono text-xs font-medium text-muted-foreground/75">02</div>
              <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.015em] text-foreground">
                Enforce vault guardrails
              </h3>
              <p className="mt-2 text-[13.5px] leading-[1.6] text-muted-foreground">
                A deterministic 7-rule Policy Gate and{" "}
                <code className="font-mono text-xs text-foreground">VireVault</code> verify replay
                hashes, non-team wallets, live spread bps, and 24-hour USD₮ spending caps before any
                funds leave custody.
              </p>
            </article>

            <article className="p-7 sm:p-8">
              <div className="font-mono text-xs font-medium text-muted-foreground/75">03</div>
              <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.015em] text-foreground">
                Clear exact local FX
              </h3>
              <p className="mt-2 text-[13.5px] leading-[1.6] text-muted-foreground">
                Vire executes a firm Textile FX v2{" "}
                <code className="font-mono text-xs text-foreground">buyAmount</code> RFQ with
                ERC-8021 attribution, pays the contributor directly, refunds unused USD₮ dust, and
                enables 1-click ERC-8004 reputation feedback.
              </p>
            </article>
          </div>

          {/* Bottom Row: 2-Column Hairline Split */}
          <div className="grid divide-y divide-black/[0.06] border-t border-black/[0.06] bg-[#FAFAFB] md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="p-7 sm:p-8">
              <h3 className="text-[14px] font-semibold tracking-[-0.015em] text-foreground">
                Custody separated from judgment.
              </h3>
              <p className="mt-2 max-w-[48ch] text-[13.5px] leading-[1.6] text-muted-foreground">
                AI verifiers can misjudge edge cases, so treasury limits live onchain in{" "}
                <code className="font-mono text-xs text-foreground">VireVault</code> rather than in
                prompts. Every settlement, rejection, and refund is publicly verifiable across{" "}
                {uniqueRecipients} external recipient{uniqueRecipients === 1 ? "" : "s"}.
              </p>
            </div>

            <div className="flex flex-col justify-between gap-4 p-7 sm:p-8">
              <div>
                <h3 className="text-[14px] font-semibold tracking-[-0.015em] text-foreground">
                  Built for autonomous agents{rep.registered && rep.agentId ? ` · ERC-8004 #${rep.agentId}` : ""}.
                </h3>
                <p className="mt-2 max-w-[48ch] text-[13.5px] leading-[1.6] text-muted-foreground">
                  External agents can discover capabilities via ERC-8004, inspect live Textile FX
                  quotes, and pay per request over HTTP 402 through{" "}
                  <code className="font-mono text-xs text-foreground">api.x402.celo.org</code>.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {AGENT_ENDPOINTS.map((ep) => (
                  <Link
                    key={ep.href}
                    href={ep.href}
                    className="vire-pressable inline-flex items-center gap-1 rounded-lg border border-black/[0.08] bg-card px-2.5 py-1 font-mono text-[11px] font-medium text-foreground/85 shadow-[0_1px_1px_rgba(0,0,0,0.02)] hover:border-black/20 hover:text-foreground"
                  >
                    <span>{ep.label}</span>
                    <ArrowUpRight className="h-2.5 w-2.5 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
