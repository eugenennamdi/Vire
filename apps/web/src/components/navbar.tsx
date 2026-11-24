"use client";

import { SignOut, Wallet, Warning } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { celo } from "wagmi/chains";
import { Button } from "@/components/ui/button";
import { cn, truncateMiddle } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Overview" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/claim", label: "Claim" },
  { href: "/ledger", label: "Ledger" },
  { href: "/console", label: "Console" },
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
    <header className="sticky top-0 z-40 border-b border-[#E5E5E5] bg-white/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1160px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="vire-pressable flex items-center gap-2 rounded-md py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]/25"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded bg-[#111111]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4.5 6.5L12 19L19.5 6.5"
                  stroke="#FFFFFF"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M9 6.5L12 11.5L15 6.5"
                  stroke="#A3A3A3"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-[#111111]">
              Vire
            </span>
          </Link>

          <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
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
                      ? "bg-[#F4F4F5] text-[#111111]"
                      : "text-[#737373] hover:text-[#111111]"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/api/agent-card.json"
            className="hidden items-center gap-2 rounded-md border border-[#E5E5E5] bg-[#FAFAFA] px-2.5 py-1.5 font-mono text-[11px] text-[#525252] transition-colors hover:border-[#A3A3A3] hover:text-[#111111] lg:inline-flex"
            title="Inspect ERC-8004 agent registration manifest"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#111111]" />
            <span>42220</span>
            {rep?.registered && rep.agentId && (
              <span className="border-l border-[#E5E5E5] pl-2 text-[#111111]">
                #{rep.agentId}
              </span>
            )}
          </Link>

          {wrongChain ? (
            <Button
              size="sm"
              variant="outlineStrong"
              onClick={() => switchChain({ chainId: celo.id })}
            >
              <Warning weight="regular" className="h-3.5 w-3.5" />
              Switch to Celo
            </Button>
          ) : isConnected && address ? (
            <div className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E5E5E5] bg-[#FAFAFA] pl-2.5 pr-1 font-mono text-xs text-[#111111]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#111111]" />
              <span className="tabular-nums">{truncateMiddle(address, 6, 4)}</span>
              <button
                type="button"
                onClick={() => disconnect()}
                aria-label="Disconnect wallet"
                title="Disconnect wallet"
                className="vire-pressable ml-0.5 flex h-6 w-6 items-center justify-center rounded text-[#737373] hover:bg-[#EAEAEA] hover:text-[#111111]"
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

      {/* Mobile navigation strip — all 5 concise links fit inside 390px without clipping */}
      <nav
        aria-label="Mobile navigation"
        className="flex items-center justify-between border-t border-[#E5E5E5] px-3 py-1.5 md:hidden"
      >
        {NAV_LINKS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "vire-pressable whitespace-nowrap rounded px-2 py-1 text-xs font-medium",
                active ? "bg-[#F4F4F5] text-[#111111]" : "text-[#737373]"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
