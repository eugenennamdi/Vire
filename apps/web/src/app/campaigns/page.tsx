"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Shield, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

interface CampaignStageView {
  stageIndex: number;
  title: string;
  instructions: string;
  rewardLocalAtomic: string;
  rewardLocalFormatted: string;
  cooldownHours: number;
}

interface CampaignView {
  id: string;
  slug: string;
  partnerName: string;
  partnerLocation: string;
  isLaunchPartner: boolean;
  title: string;
  description: string;
  deliverableType: string;
  corridor: string;
  localTokenDecimals: number;
  stages: CampaignStageView[];
  budgetUsdtFormatted: string;
  remainingUsdtFormatted: string;
  maxPerPayoutUsdtFormatted: string;
  dailyLimitUsdtFormatted: string;
  maxPayoutsPerRecipient: number;
  maxSpreadBps: number;
  minPassScore: number;
  active: boolean;
}

const FILTER_TABS = ["ALL", "cNGN", "wARS", "wBRL", "IDRX", "wMXN"];

export default function CampaignsPage() {
  const [corridorFilter, setCorridorFilter] = useState("ALL");

  const { data, isLoading } = useQuery({
    queryKey: ["campaigns-list"],
    queryFn: async () => {
      const res = await fetch("/api/campaigns");
      if (!res.ok) throw new Error("Failed to load campaigns");
      return (await res.json()) as { campaigns: CampaignView[] };
    },
  });

  const campaigns = (data?.campaigns ?? []).filter(
    (c) => corridorFilter === "ALL" || c.corridor === corridorFilter
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Multi-Stage Proof-of-Work Missions
          </span>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">
            Active Clearing Campaigns
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Every mission guarantees exact local-currency output via Textile FX{" "}
            <code className="font-mono text-xs">buyAmount</code> quoting and enforces onchain{" "}
            <code className="font-mono text-xs">VireVault</code> spending caps.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setCorridorFilter(tab)}
              className={`rounded-md px-3 py-1.5 font-mono text-xs font-medium transition-colors ${
                corridorFilter === tab
                  ? "bg-zinc-950 text-white"
                  : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-2xl border border-zinc-200 bg-white p-6" />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {campaigns.map((camp) => (
            <article
              key={camp.id}
              className={`rounded-2xl border bg-white p-6 ${
                camp.isLaunchPartner ? "border-emerald-300 ring-1 ring-emerald-100" : "border-zinc-200/90"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    {camp.isLaunchPartner && (
                      <span className="rounded bg-zinc-950 px-2 py-0.5 font-mono text-[10px] font-semibold text-white">
                        NAMED LAUNCH PARTNER
                      </span>
                    )}
                    <span className="rounded bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-800">
                      {camp.corridor} · {camp.localTokenDecimals}dp
                    </span>
                    <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-700">
                      {camp.deliverableType}
                    </span>
                    <span className="font-mono text-xs text-zinc-500">
                      {camp.partnerName} · {camp.partnerLocation}
                    </span>
                  </div>

                  <h2 className="mt-2.5 text-lg font-semibold text-zinc-950">{camp.title}</h2>
                  <p className="mt-1 max-w-3xl text-sm text-zinc-600">{camp.description}</p>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="text-right">
                    <div className="font-mono text-[11px] uppercase text-zinc-500">Vault Remaining</div>
                    <div className="font-mono text-lg font-semibold text-zinc-950 tabular-nums">
                      ${camp.remainingUsdtFormatted}{" "}
                      <span className="text-xs font-normal text-zinc-400">
                        / ${camp.budgetUsdtFormatted} USD₮
                      </span>
                    </div>
                  </div>
                  <Link
                    href={`/claim?campaign=${encodeURIComponent(camp.slug)}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-950 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800"
                  >
                    Submit Deliverable
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>

              {/* Multi-Stage Progression Grid */}
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {camp.stages.map((st) => (
                  <div
                    key={st.stageIndex}
                    className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-semibold text-zinc-500">
                        STAGE {st.stageIndex}
                      </span>
                      <span className="font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                        {st.rewardLocalFormatted} {camp.corridor}
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-semibold text-zinc-900">{st.title}</div>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-600">{st.instructions}</p>
                    <div className="mt-2 font-mono text-[10px] text-zinc-400">
                      Cooldown: {st.cooldownHours === 0 ? "Immediate" : `${st.cooldownHours}h after prior stage`}
                    </div>
                  </div>
                ))}
              </div>

              {/* Policy Gate Guardrails Bar */}
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-zinc-100 pt-3.5 font-mono text-[11px] text-zinc-600">
                <span className="inline-flex items-center gap-1 font-semibold text-zinc-800">
                  <Shield className="h-3.5 w-3.5 text-emerald-700" />
                  Policy Guardrails:
                </span>
                <span>maxSpread: {camp.maxSpreadBps} bps</span>
                <span>maxPerPayout: ${camp.maxPerPayoutUsdtFormatted}</span>
                <span>dailyLimit: ${camp.dailyLimitUsdtFormatted}/24h</span>
                <span>maxStages/Wallet: {camp.maxPayoutsPerRecipient}</span>
                <span className="inline-flex items-center gap-1">
                  <SlidersHorizontal className="h-3 w-3" />
                  minPassScore: {camp.minPassScore}/100
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
