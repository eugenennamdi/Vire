"use client";

import { SignOut, Wallet, Warning } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { celo } from "wagmi/chains";
import { VireLogo } from "@/components/brand/vire-mark";
import { Button } from "@/components/ui/button";
import { cn, truncateMiddle } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Overview" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/claim", label: "Claim" },
  { href: "/ledger", label: "Ledger" },
  { href: "/console", label: "Console" },
] as const;

export function Navbar() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  const activeHref = pendingHref ?? pathname;

  const { data: rep } = useQuery({
    queryKey: ["reputation-header"],
    queryFn: async () => {
      const r = await fetch("/api/reputation");
      if (!r.ok) return null;
      return (await r.json()) as {
        registered: boolean;
        agentId: string | null;
      };
    },
  });

  const wrongChain = isConnected && chainId !== celo.id;

  return (
    <header className="sticky top-0 z-40 border-b border-[#E4E2DC] bg-[#FAF9F6]/92 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Left: Brand Lockup + Hairline Divider + Flush-Underline Ledger Nav */}
        <div className="flex h-full items-center gap-5">
          <Link
            href="/"
            aria-label="Vire — Overview"
            className="vire-pressable inline-flex shrink-0 items-center rounded-[4px] py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#121210]/20"
          >
            <VireLogo size={24} />
          </Link>

          <span className="hidden h-4 w-px bg-[#D5D2C9] md:block" aria-hidden="true" />

          <nav aria-label="Primary" className="hidden h-full items-stretch gap-1 md:flex">
            {NAV_LINKS.map((item) => {
              const active = activeHref === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    if (item.href !== pathname) setPendingHref(item.href);
                  }}
                  className={cn(
                    "relative inline-flex items-center whitespace-nowrap px-2.5 text-[13px] font-medium transition-colors duration-150",
                    active
                      ? "text-[#121210]"
                      : "text-[#68665F] hover:text-[#121210]"
                  )}
                >
                  <span>{item.label}</span>
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-1.5 bottom-0 h-[2px] bg-[#121210]"
                    />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: Quiet Celo Chain Stamp + Rectangular Wallet Control */}
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/api/agent-card.json"
            className="hidden items-center gap-2 border-r border-[#E4E2DC] pr-3 font-mono text-[11px] text-[#68665F] transition-colors hover:text-[#121210] lg:inline-flex"
            title="Inspect ERC-8004 agent registration manifest"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#121210]" />
            <span>CELO 42220</span>
            {rep?.registered && rep.agentId && (
              <span className="text-[#121210]">#{rep.agentId}</span>
            )}
          </Link>

          {!mounted ? (
            <div className="h-8 w-28 animate-pulse rounded-[6px] bg-[#ECEAE4]" />
          ) : wrongChain ? (
            <Button
              size="sm"
              variant="outlineStrong"
              onClick={() => switchChain({ chainId: celo.id })}
            >
              <Warning weight="regular" className="h-3.5 w-3.5" />
              Switch to Celo
            </Button>
          ) : isConnected && address ? (
            <div className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[#D5D2C9] bg-white pl-2.5 pr-1 font-mono text-xs text-[#121210]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#121210]" />
              <span className="tabular-nums">{truncateMiddle(address, 6, 4)}</span>
              <button
                type="button"
                onClick={() => disconnect()}
                aria-label="Disconnect wallet"
                title="Disconnect wallet"
                className="vire-pressable ml-0.5 flex h-6 w-6 items-center justify-center rounded-[4px] text-[#68665F] hover:bg-[#F3F1EC] hover:text-[#121210]"
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
              {isPending ? "Connecting…" : "Connect wallet"}
            </Button>
          )}
        </div>
      </div>

      {/* Mobile navigation strip — crisp underline tabs fitting 390px cleanly */}
      <nav
        aria-label="Mobile navigation"
        className="flex items-stretch justify-between border-t border-[#E4E2DC] bg-[#FAF9F6] px-3 md:hidden"
      >
        {NAV_LINKS.map((item) => {
          const active = activeHref === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                if (item.href !== pathname) setPendingHref(item.href);
              }}
              className={cn(
                "relative whitespace-nowrap px-2 py-2.5 text-xs font-medium",
                active ? "text-[#121210]" : "text-[#68665F]"
              )}
            >
              {item.label}
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-1 bottom-0 h-[2px] bg-[#121210]"
                />
              )}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
