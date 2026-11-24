"use client";

import { SignOut, ShieldCheck, Wallet, Warning } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { celo } from "wagmi/chains";
import { Button } from "@/components/ui/button";
import { cn, truncateMiddle } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Overview", shortLabel: "Overview" },
  { href: "/campaigns", label: "Campaigns", shortLabel: "Campaigns" },
  { href: "/claim", label: "Claim", shortLabel: "Claim" },
  { href: "/ledger", label: "Audit Ledger", shortLabel: "Ledger" },
  { href: "/console", label: "Console", shortLabel: "Console" },
];

export function Navbar() {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const { data: rep } = useQuery({
    queryKey: ["reputation-header"],
    queryFn: async () => {
      const r = await fetch("/api/reputation");
      if (!r.ok) return null;
      return (await r.json()) as {
        registered: boolean;
        agentId: string | null;
        summary: { feedbackCount: number; averageScore: string | null } | null;
      };
    },
  });

  const wrongChain = isConnected && chainId !== celo.id;

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#08090A]/82 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Left: Brand Mark + Desktop Navigation */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="vire-pressable flex items-center gap-2.5 rounded-lg py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.12] bg-[#14171C] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4.5 6.5L12 19L19.5 6.5"
                  stroke="#10B981"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M9 6.5L12 11.5L15 6.5"
                  stroke="#F4F5F6"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-[#F4F5F6]">
              Vire
            </span>
          </Link>

          <nav aria-label="Main navigation" className="hidden items-center gap-0.5 md:flex">
            {NAV_LINKS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "vire-pressable rounded-md px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap",
                    active
                      ? "bg-white/[0.08] text-[#F4F5F6] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                      : "text-[#8A8F98] hover:bg-white/[0.04] hover:text-[#E5E7EB]"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: Network / ERC-8004 Telemetry + Wallet Control */}
        <div className="flex items-center gap-2">
          <Link
            href="/api/agent-card.json"
            className="hidden items-center gap-2 rounded-md border border-white/[0.08] bg-[#0F1114] px-2.5 py-1.5 font-mono text-[11px] text-[#B4BAC5] transition-colors hover:border-white/[0.15] hover:text-[#F4F5F6] lg:inline-flex"
            title="Inspect live ERC-8004 agent registration manifest"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span>Celo 42220</span>
            {rep?.registered && rep.agentId && (
              <span className="inline-flex items-center gap-1 border-l border-white/[0.1] pl-2 text-emerald-300">
                <ShieldCheck weight="fill" className="h-3.5 w-3.5" />
                #{rep.agentId}
                {rep.summary?.averageScore ? ` · ${rep.summary.averageScore}` : ""}
              </span>
            )}
          </Link>

          {wrongChain ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => switchChain({ chainId: celo.id })}
              className="border-amber-500/30 bg-amber-500/12 text-amber-300 hover:bg-amber-500/20"
            >
              <Warning weight="regular" className="h-3.5 w-3.5" />
              Switch to Celo
            </Button>
          ) : isConnected && address ? (
            <div className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#12151A] pl-2.5 pr-1 font-mono text-xs text-[#F4F5F6]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="tabular-nums">{truncateMiddle(address, 6, 4)}</span>
              <button
                type="button"
                onClick={() => disconnect()}
                aria-label="Disconnect wallet"
                title="Disconnect wallet"
                className="vire-pressable ml-0.5 flex h-6 w-6 items-center justify-center rounded-md text-[#8A8F98] hover:bg-white/[0.08] hover:text-[#F4F5F6]"
              >
                <SignOut weight="regular" className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={isPending}
              onClick={() => {
                const connector = connectors[0];
                if (connector) connect({ connector });
              }}
            >
              <Wallet weight="regular" className="h-3.5 w-3.5" />
              {isPending ? "Connecting…" : "Connect Wallet"}
            </Button>
          )}
        </div>
      </div>

      {/* Mobile navigation strip */}
      <div className="flex items-center justify-between gap-1 border-t border-white/[0.06] px-3 py-1.5 md:hidden">
        {NAV_LINKS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "vire-pressable whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium",
                active ? "bg-white/[0.1] text-[#F4F5F6]" : "text-[#8A8F98]"
              )}
            >
              {item.shortLabel}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
