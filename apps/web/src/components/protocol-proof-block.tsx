"use client";

import { ArrowUpRight, BracketsCurly, FileCode } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type CodeTab = "vault" | "policy" | "erc8004";

interface CodeLine {
  segments: Array<{ text: string; tone?: "comment" | "keyword" | "type" | "string" | "default" }>;
}

const TABS: Array<{
  id: CodeTab;
  label: string;
  meta: string;
  href: string;
  linkLabel: string;
  icon: ReactNode;
  lines: CodeLine[];
}> = [
  {
    id: "vault",
    label: "VireVault.sol",
    meta: "Celo Mainnet · Verified Solidity 0.8.28",
    href: "https://celoscan.io/address/0x8969060F1605A6C351210323169Efb226667b26f",
    linkLabel: "Celoscan",
    icon: <FileCode weight="regular" className="h-3.5 w-3.5" />,
    lines: [
      { segments: [{ text: "// SPDX-License-Identifier: MIT — Celo Mainnet 42220", tone: "comment" }] },
      {
        segments: [
          { text: "function ", tone: "keyword" },
          { text: "releaseForSettlement", tone: "default" },
          { text: "(", tone: "type" },
        ],
      },
      {
        segments: [
          { text: "  bytes32 ", tone: "type" },
          { text: "campaignId, ", tone: "default" },
          { text: "bytes32 ", tone: "type" },
          { text: "deliverableHash,", tone: "default" },
        ],
      },
      {
        segments: [
          { text: "  address ", tone: "type" },
          { text: "recipient, ", tone: "default" },
          { text: "uint256 ", tone: "type" },
          { text: "exactUsdtNeeded", tone: "default" },
        ],
      },
      {
        segments: [
          { text: ") ", tone: "type" },
          { text: "external ", tone: "keyword" },
          { text: "onlySettlementAgent whenNotPaused nonReentrant {", tone: "type" },
        ],
      },
      {
        segments: [
          { text: "  if ", tone: "keyword" },
          { text: "(recipient == settlementAgent || recipient == owner() || recipient == c.creator)", tone: "default" },
        ],
      },
      {
        segments: [
          { text: "    revert ", tone: "keyword" },
          { text: "RecipientNotExternal();", tone: "default" },
        ],
      },
      {
        segments: [
          { text: "  if ", tone: "keyword" },
          { text: "(usedDeliverableHashes[deliverableHash]) ", tone: "default" },
          { text: "revert ", tone: "keyword" },
          { text: "DeliverableAlreadyUsed();", tone: "default" },
        ],
      },
      {
        segments: [
          { text: "  if ", tone: "keyword" },
          { text: "(exactUsdtNeeded > c.maxPerPayoutUsdt)", tone: "default" },
        ],
      },
      {
        segments: [
          { text: "    revert ", tone: "keyword" },
          { text: "ExceedsMaxPerPayout(exactUsdtNeeded, c.maxPerPayoutUsdt);", tone: "default" },
        ],
      },
      {
        segments: [
          { text: "  usdt.safeTransfer(settlementAgent, exactUsdtNeeded);", tone: "default" },
        ],
      },
      { segments: [{ text: "}", tone: "type" }] },
    ],
  },
  {
    id: "policy",
    label: "policy-gate.ts",
    meta: "packages/agent · Deterministic 7-rule verifier",
    href: "https://github.com/eugenennamdi/Vire/blob/main/packages/agent/src/policy-gate.ts",
    linkLabel: "GitHub",
    icon: <FileCode weight="regular" className="h-3.5 w-3.5" />,
    lines: [
      { segments: [{ text: "// Zero funds move until every deterministic check passes", tone: "comment" }] },
      {
        segments: [
          { text: "export function ", tone: "keyword" },
          { text: "evaluatePolicyGate", tone: "default" },
          { text: "(input: ", tone: "type" },
          { text: "PolicyGateInput", tone: "default" },
          { text: ") {", tone: "type" },
        ],
      },
      { segments: [{ text: "  // 01. Globally unique deliverable replay hash", tone: "comment" }] },
      { segments: [{ text: "  // 02. Verified external identity (non-owner, non-agent wallet)", tone: "comment" }] },
      { segments: [{ text: "  // 03. Active campaign + remaining budget, per-tx & 24h caps", tone: "comment" }] },
      { segments: [{ text: "  // 04. Sequential stage repeat cap & cooldown window", tone: "comment" }] },
      { segments: [{ text: "  // 05. Clears Textile FX $1.00 USDT mainnet minimum floor", tone: "comment" }] },
      { segments: [{ text: "  // 06. Live Textile preview healthy & spread <= maxSpreadBps", tone: "comment" }] },
      { segments: [{ text: "  // 07. Paid x402 AI audit score >= campaign minPassScore", tone: "comment" }] },
      {
        segments: [
          { text: "  return ", tone: "keyword" },
          { text: "{ passed: !firstFailure, failedRule, estimatedUsdtAtomic };", tone: "default" },
        ],
      },
      { segments: [{ text: "}", tone: "type" }] },
    ],
  },
  {
    id: "erc8004",
    label: "agent-card.json",
    meta: "ERC-8004 #10116 · Live onchain registration",
    href: "/api/agent-card.json",
    linkLabel: "Inspect JSON",
    icon: <BracketsCurly weight="regular" className="h-3.5 w-3.5" />,
    lines: [
      { segments: [{ text: "{", tone: "type" }] },
      { segments: [{ text: '  "name": ', tone: "type" }, { text: '"Vire",', tone: "string" }] },
      { segments: [{ text: '  "chainId": ', tone: "type" }, { text: "42220,", tone: "default" }] },
      { segments: [{ text: '  "agentId": ', tone: "type" }, { text: '"10116",', tone: "string" }] },
      {
        segments: [
          { text: '  "settlementAgent": ', tone: "type" },
          { text: '"0x8ba43426D57E55C51c4fe7C4F8a68Df3bf008089",', tone: "string" },
        ],
      },
      {
        segments: [
          { text: '  "vault": ', tone: "type" },
          { text: '"0x8969060F1605A6C351210323169Efb226667b26f",', tone: "string" },
        ],
      },
      {
        segments: [
          { text: '  "attribution": ', tone: "type" },
          { text: '"celo_55a64f75ba4a",', tone: "string" },
        ],
      },
      {
        segments: [
          { text: '  "corridors": ', tone: "type" },
          { text: '["cNGN", "wARS", "wBRL", "IDRX", "wMXN"]', tone: "string" },
        ],
      },
      { segments: [{ text: "}", tone: "type" }] },
    ],
  },
];

function toneClass(tone: CodeLine["segments"][number]["tone"]) {
  switch (tone) {
    case "comment":
      return "text-[#8E8E93]";
    case "keyword":
      return "font-medium text-[#0A0A0C]";
    case "type":
      return "text-[#52525B]";
    case "string":
      return "text-[#18181B]";
    default:
      return "text-[#0A0A0C]";
  }
}

export function ProtocolProofBlock() {
  const [active, setActive] = useState<CodeTab>("vault");
  const current = TABS.find((t) => t.id === active) ?? TABS[0]!;

  return (
    <section aria-labelledby="verifiable-heading" className="vire-enter vire-delay-3 space-y-8">
      <div className="mx-auto max-w-xl text-center">
        <h2
          id="verifiable-heading"
          className="text-[26px] font-normal tracking-[-0.035em] text-[#0A0A0C] sm:text-[32px]"
        >
          Open by default, verifiable onchain.
        </h2>
        <p className="mt-2 text-[14.5px] leading-relaxed text-[#71717A]">
          Every spending limit, safety check, and currency exchange is open and verifiable on Celo
          Mainnet.
        </p>
      </div>

      {/* Morpho-style flush folder tabs seamlessly joined to crisp code card */}
      <div className="mx-auto max-w-[780px]">
        <div
          role="tablist"
          aria-label="Protocol source tabs"
          className="flex flex-nowrap items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {TABS.map((tab) => {
            const on = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActive(tab.id)}
                className={cn(
                  "vire-pressable relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-xl px-3.5 py-2.5 font-mono text-[11.5px] font-medium leading-none sm:gap-2 sm:px-4 sm:text-[12px]",
                  on
                    ? "z-10 -mb-px border-x border-t border-black/[0.07] bg-white text-[#0A0A0C]"
                    : "text-[#71717A] hover:text-[#0A0A0C]"
                )}
              >
                <span className={on ? "text-[#0A0A0C]" : "text-[#A1A1AA]"}>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div
          className={cn(
            "relative overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(10,10,12,0.04)]",
            active === "vault" && "rounded-tl-none"
          )}
        >
          <div className="min-h-[280px] overflow-x-auto px-4 py-5 sm:min-h-[312px] sm:px-7 sm:py-6">
            <pre className="font-mono text-[11.5px] leading-[1.75] sm:text-[12.5px]">
              {current.lines.map((line, i) => (
                <div key={i} className="flex gap-4 sm:gap-6">
                  <span className="w-5 shrink-0 select-none text-right text-[#A1A1AA] tabular-nums">
                    {i + 1}
                  </span>
                  <span>
                    {line.segments.map((seg, j) => (
                      <span key={j} className={toneClass(seg.tone)}>
                        {seg.text}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </pre>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] bg-[#FAFAFB] px-4 py-3 text-[12px] text-[#71717A] sm:px-7">
            <span className="font-mono text-[11px] sm:text-[11.5px]">{current.meta}</span>
            <a
              href={current.href}
              target={current.href.startsWith("http") ? "_blank" : undefined}
              rel={current.href.startsWith("http") ? "noreferrer" : undefined}
              className="inline-flex shrink-0 items-center gap-1 py-0.5 font-medium text-[#0A0A0C] hover:underline"
            >
              {current.linkLabel}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* 3 Calm Trust Pillars — balanced 2-line copy with clean vertical dividers */}
      <div className="mx-auto grid max-w-[960px] divide-y divide-black/[0.08] pt-3 md:grid-cols-3 md:divide-x md:divide-y-0">
        {[
          {
            title: "Owner-Controlled Treasury",
            desc: "Campaign owners fund, pause, and withdraw anytime. The agent only sends capped payouts.",
          },
          {
            title: "Exact Local Payouts",
            desc: "Converts USDT into the exact local currency amount promised and returns leftover change.",
          },
          {
            title: "Public Onchain Proof",
            desc: "Every payout, exchange rate, and safety check is permanently verifiable on Celo Mainnet.",
          },
        ].map((item) => (
          <div key={item.title} className="px-4 py-5 text-center md:px-8 md:py-2">
            <h3 className="text-[14.5px] font-medium tracking-[-0.015em] text-[#0A0A0C]">
              {item.title}
            </h3>
            <p className="mx-auto mt-1.5 max-w-[32ch] text-balance text-[13px] leading-[1.6] text-[#71717A]">
              {item.desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
