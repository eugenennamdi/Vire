"use client";

import { ArrowUpRight } from "@phosphor-icons/react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type CodeTab = "vault" | "policy" | "erc8004";

const TABS: Array<{
  id: CodeTab;
  label: string;
  href: string;
  linkLabel: string;
  lines: string[];
}> = [
  {
    id: "vault",
    label: "VireVault.sol",
    href: "https://celo.blockscout.com/address/0x86140c2aFd04c9dEC2AB71EA74953Bce70C5a9BF?tab=contract",
    linkLabel: "Blockscout",
    lines: [
      "// SPDX-License-Identifier: MIT — Celo Mainnet 42220",
      "function releaseForSettlement(",
      "    bytes32 campaignId, bytes32 deliverableHash,",
      "    address recipient, uint256 exactUsdtNeeded",
      ") external onlySettlementAgent whenNotPaused nonReentrant {",
      "    if (recipient == settlementAgent || recipient == owner())",
      "        revert RecipientNotExternal();",
      "    if (usedDeliverableHashes[deliverableHash])",
      "        revert DeliverableAlreadyUsed();",
      "    if (exactUsdtNeeded > c.maxPerPayoutUsdt)",
      "        revert ExceedsMaxPerPayout(exactUsdtNeeded, c.maxPerPayoutUsdt);",
      "    usdt.safeTransfer(settlementAgent, exactUsdtNeeded);",
      "}",
    ],
  },
  {
    id: "policy",
    label: "policy-gate.ts",
    href: "https://github.com/eugenennamdi/Vire/blob/main/packages/agent/src/policy-gate.ts",
    linkLabel: "GitHub",
    lines: [
      "// 7-Rule Deterministic Gate — zero funds move before all pass",
      "export function evaluatePolicyGate(input: PolicyGateInput) {",
      "  // 1. Unique deliverable hash (anti-replay)",
      "  // 2. External identity + non-team / non-owner / non-agent wallet",
      "  // 3. Active campaign + remaining budget, per-tx & 24h caps",
      "  // 4. Sequential stage repeat cap & cooldown window",
      "  // 5. Clears Textile FX $1.00 USDT mainnet minimum notional floor",
      "  // 6. Live Textile preview healthy & spread <= maxSpreadBps",
      "  // 7. Paid x402 AI audit score >= campaign minPassScore",
      "}",
    ],
  },
  {
    id: "erc8004",
    label: "agent-card.json",
    href: "/api/agent-card.json",
    linkLabel: "Inspect live JSON",
    lines: [
      "{",
      '  "name": "Vire",',
      '  "chainId": 42220,',
      '  "agentId": "10116",',
      '  "settlementAgent": "0x8ba43426D57E55C51c4fe7C4F8a68Df3bf008089",',
      '  "vault": "0x86140c2aFd04c9dEC2AB71EA74953Bce70C5a9BF",',
      '  "attribution": "celo_55a64f75ba4a",',
      '  "corridors": ["cNGN", "wARS", "wBRL", "IDRX", "wMXN"]',
      "}",
    ],
  },
];

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
          Every custody limit, policy check, and FX fill is auditable on Celo Mainnet.
        </p>
      </div>

      {/* Morpho-style clean monochrome folder tabs + crisp code card */}
      <div className="mx-auto max-w-[780px]">
        <div className="flex flex-wrap items-center gap-1.5 pl-2">
          {TABS.map((tab) => {
            const on = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(tab.id)}
                className={cn(
                  "vire-pressable rounded-t-xl px-4 py-2 font-mono text-[12px] font-medium transition-colors",
                  on
                    ? "bg-white text-[#0A0A0C] shadow-[0_-1px_0_rgba(10,10,12,0.06),1px_0_0_rgba(10,10,12,0.06),-1px_0_0_rgba(10,10,12,0.06)]"
                    : "text-[#71717A] hover:text-[#0A0A0C]"
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="vire-card overflow-hidden rounded-2xl rounded-tl-none">
          <div className="overflow-x-auto px-5 py-5 sm:px-6">
            <pre className="font-mono text-[12.5px] leading-[1.7] text-[#18181B]">
              {current.lines.map((line, i) => (
                <div key={i} className="flex gap-5">
                  <span className="w-5 shrink-0 select-none text-right text-[#A1A1AA] tabular-nums">
                    {i + 1}
                  </span>
                  <span
                    className={
                      line.trim().startsWith("//")
                        ? "text-[#71717A]"
                        : "text-[#0A0A0C]"
                    }
                  >
                    {line}
                  </span>
                </div>
              ))}
            </pre>
          </div>

          <div className="flex items-center justify-between border-t border-black/[0.06] bg-[#FAFAFB] px-5 py-3 text-[12px] text-[#71717A] sm:px-6">
            <span className="font-mono text-[11.5px]">Celo Mainnet · Verified source</span>
            <a
              href={current.href}
              target={current.href.startsWith("http") ? "_blank" : undefined}
              rel={current.href.startsWith("http") ? "noreferrer" : undefined}
              className="inline-flex items-center gap-1 font-medium text-[#0A0A0C] hover:underline"
            >
              {current.linkLabel}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* 3 Calm Trust Pillars separated by delicate hairlines */}
      <div className="grid divide-y divide-black/[0.07] pt-2 md:grid-cols-3 md:divide-x md:divide-y-0">
        {[
          {
            title: "Non-Custodial Separation",
            desc: "Human owner funds, pauses, and withdraws VireVault. The agent only executes bounded external payouts.",
          },
          {
            title: "Exact-Output Precision",
            desc: "Handles 2-decimal IDRX, 6-decimal cNGN, and 18-decimal wFIAT cleanly and refunds unused USDT dust.",
          },
          {
            title: "ERC-8021 Native Attribution",
            desc: "Every vault release, swap, and payout carries verifiable onchain builder attribution on Celo Mainnet.",
          },
        ].map((item) => (
          <div key={item.title} className="px-2 py-5 text-center md:px-8 md:py-2">
            <h3 className="text-[15px] font-medium text-[#0A0A0C]">{item.title}</h3>
            <p className="mx-auto mt-1.5 max-w-[30ch] text-[13px] leading-relaxed text-[#71717A]">
              {item.desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
