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
import { ProtocolProofBlock } from "@/components/protocol-proof-block";
import { buttonVariants } from "@/components/ui/button";
import { TokenIcon, TokenStack } from "@/components/ui/token-icon";
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

  const [vault, rep, campaignRows, settlements] = await Promise.all([
    getVaultSnapshot(),
    getLiveReputationSnapshot(),
    db
      .select()
      .from(schema.campaigns)
      .orderBy(desc(schema.campaigns.isLaunchPartner), desc(schema.campaigns.createdAt)),
    db.select().from(schema.settlements).orderBy(desc(schema.settlements.settledAt)),
  ]);

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
          ? "Busha · Quidax · Yellow Card"
          : meta?.offrampProvider === "idrx_guide"
            ? "IDRX Bank Redeem (IDR)"
            : "Ripio Portal (CBU / PIX / CLABE)",
    };
  });

  const recentSettlements = settlements.slice(0, 4);
  const vaultFormatted =
    vault.usdtBalanceAtomic !== null
      ? Number(formatTokenAmount(vault.usdtBalanceAtomic, "USDT", 2)).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : null;

  return (
    <div className="space-y-16">
      {/* BAND 1: Morpho-Inspired Architectural Monochrome Hero Frame */}
      <section className="vire-enter vire-card vire-blueprint relative overflow-hidden rounded-2xl p-6 sm:p-10 lg:p-12">
        {/* Corner Registration Ticks (Morpho Blueprint Precision) */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-3 h-2.5 w-2.5 border-l border-t border-black/20"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-3 h-2.5 w-2.5 border-r border-t border-black/20"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-3 left-3 h-2.5 w-2.5 border-b border-l border-black/20"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-3 right-3 h-2.5 w-2.5 border-b border-r border-black/20"
        />

        <div className="relative grid gap-10 lg:grid-cols-12 lg:items-end">
          {/* Left: Calm Institutional Display Copy */}
          <div className="min-w-0 space-y-5 lg:col-span-7">
            <div className="vire-pill-surface inline-flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1 text-[12px] font-medium text-[#3F3F46]">
              <TokenIcon symbol="CELO" size={16} />
              <span>Autonomous FX clearing on Celo</span>
            </div>

            <h1 className="max-w-[16ch] text-[36px] font-normal leading-[1.06] tracking-[-0.04em] text-[#0A0A0C] sm:text-[48px] lg:text-[52px]">
              Pay verified work in exact local currency.
            </h1>

            <p className="max-w-[48ch] text-[15px] leading-[1.6] text-[#52525B] sm:text-[16px]">
              Vire audits off-chain deliverables via paid x402, enforces onchain vault caps, and
              settles exact local stablecoins over Textile FX.
            </p>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <Link href="/claim" className={buttonVariants({ variant: "primary", size: "lg" })}>
                Submit deliverable
                <ArrowRight weight="bold" className="h-4 w-4" />
              </Link>
              <Link href="/campaigns" className={buttonVariants({ variant: "secondary", size: "lg" })}>
                Explore campaigns
              </Link>
            </div>
          </div>

          {/* Right: Calm Right-Aligned Protocol Telemetry (Morpho Scale + Official Token Icons) */}
          <div className="flex flex-col gap-6 border-t border-black/[0.06] pt-6 lg:col-span-5 lg:items-end lg:border-t-0 lg:pt-0 lg:text-right">
            <div>
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[#71717A] lg:justify-end">
                <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A] ring-4 ring-[#16A34A]/15" />
                <span>VireVault Custody</span>
                {vault.address && (
                  <a
                    href={celoscanAddressUrl(vault.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-[#0A0A0C] hover:underline"
                  >
                    {truncateMiddle(vault.address, 6, 4)}
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                )}
              </div>
              <div className="mt-2 inline-flex items-center gap-2.5 lg:justify-end">
                <TokenIcon symbol="USDT" size={28} showChainBadge />
                <span className="text-[32px] font-normal leading-none tracking-[-0.035em] text-[#0A0A0C] tabular-nums sm:text-[36px]">
                  {vaultFormatted !== null ? `$${vaultFormatted}` : "—"}
                </span>
                <span className="font-mono text-[12px] text-[#71717A]">USDT</span>
              </div>
            </div>

            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#71717A]">
                Supported Local Rails
              </div>
              <div className="mt-2 inline-flex items-center gap-3 lg:justify-end">
                <TokenStack
                  symbols={["cNGN", "wARS", "wBRL", "IDRX", "wMXN"]}
                  size={24}
                />
                <span className="text-[14px] font-medium text-[#0A0A0C] tabular-nums">
                  5 corridors
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-[#71717A] lg:justify-end">
              <Link href="/api/agent-card.json" className="hover:text-[#0A0A0C]">
                {rep.registered && rep.agentId ? `ERC-8004 #${rep.agentId}` : "ERC-8004"}
              </Link>
              <span>·</span>
              <span>{attributionCode}</span>
              <span>·</span>
              <Link href="/ledger" className="inline-flex items-center gap-0.5 text-[#0A0A0C] hover:underline">
                Audit ledger <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* BAND 2 & 3: Interactive Clearing Flow + Aave Pro Live Corridors Table */}
      <ClearingInspector campaigns={inspectorCampaigns} attributionCode={attributionCode} />

      {/* BAND 4: Morpho-Inspired Verifiable Code & Trust Architecture */}
      <ProtocolProofBlock />

      {/* BAND 5: Recent Onchain Settlements (Shown cleanly once live settlements exist) */}
      {recentSettlements.length > 0 && (
        <section aria-labelledby="recent-settlements-heading" className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2
                id="recent-settlements-heading"
                className="text-[22px] font-medium tracking-[-0.03em] text-[#0A0A0C]"
              >
                Recent settlements
              </h2>
              <p className="mt-0.5 text-[13.5px] text-[#71717A]">
                Latest verified payouts cleared on Celo Mainnet.
              </p>
            </div>
            <Link href="/ledger" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Full audit ledger
            </Link>
          </div>

          <div className="vire-card overflow-hidden rounded-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-black/[0.06] bg-[#FAFAFB] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#71717A]">
                  <tr>
                    <th className="px-5 py-3">Timestamp</th>
                    <th className="px-5 py-3">Corridor</th>
                    <th className="px-5 py-3">Recipient</th>
                    <th className="px-5 py-3 text-right">Exact Output</th>
                    <th className="px-5 py-3 text-right">Proof</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.055]">
                  {recentSettlements.map((s) => (
                    <tr key={s.id} className="hover:bg-[#FAFAFB]">
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[12px] text-[#71717A] tabular-nums">
                        {new Date(s.settledAt).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <span className="inline-flex items-center gap-2 font-medium text-[#0A0A0C]">
                          <TokenIcon symbol={s.corridor} size={20} />
                          {s.corridor}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[12px] text-[#52525B]">
                        {truncateMiddle(s.recipientWallet, 8, 6)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right font-mono font-medium text-[#0A0A0C] tabular-nums">
                        {formatTokenAmount(s.localAmountAtomic, s.corridor as CorridorSymbol, 2)}{" "}
                        {s.corridor}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right">
                        <a
                          href={celoscanTxUrl(s.textileSwapTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[12px] text-[#0A0A0C] hover:underline"
                        >
                          Celoscan <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
