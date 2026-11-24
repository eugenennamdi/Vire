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
import { TokenIcon } from "@/components/ui/token-icon";
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
    <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-[#F5F5F7]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1220px] items-center justify-between gap-4 px-4 sm:px-6 md:grid md:grid-cols-[1fr_auto_1fr] lg:px-8">
        {/* Left: Brand Anchor */}
        <div className="flex items-center justify-self-start">
          <Link
            href="/"
            aria-label="Vire — Overview"
            className="vire-pressable inline-flex shrink-0 items-center rounded-lg py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0C]/20"
          >
            <VireLogo size={26} />
          </Link>
        </div>

        {/* Center: Optically Centered Primary Navigation */}
        <nav
          aria-label="Primary"
          className="hidden items-center justify-center gap-1 justify-self-center md:flex"
        >
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
                  "vire-pressable inline-flex h-8 items-center whitespace-nowrap rounded-full px-3.5 text-[13.5px] font-medium leading-none",
                  active
                    ? "vire-pill-surface text-[#0A0A0C]"
                    : "text-[#71717A] hover:bg-black/[0.04] hover:text-[#0A0A0C]"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right: Official Celo Network Pill + Full-Capsule Wallet Control */}
        <div className="flex min-w-0 items-center justify-end gap-2.5 justify-self-end">
          <Link
            href="/api/agent-card.json"
            className="vire-pressable vire-pill-surface hidden h-8 items-center gap-2 rounded-full pl-1.5 pr-3 text-[12px] font-medium text-[#3F3F46] hover:text-[#0A0A0C] lg:inline-flex"
            title="Inspect ERC-8004 agent registration manifest on Celo Mainnet"
          >
            <TokenIcon symbol="CELO" size={18} />
            <span>Celo</span>
            {rep?.registered && rep.agentId && (
              <span className="font-mono text-[11px] text-[#71717A] tabular-nums">
                #{rep.agentId}
              </span>
            )}
          </Link>

          {!mounted ? (
            <div className="h-8 w-32 animate-pulse rounded-full bg-black/[0.06]" />
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
            <div className="vire-pill-surface inline-flex h-8 items-center gap-1.5 rounded-full pl-2.5 pr-1 font-mono text-[12px] text-[#0A0A0C]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A] ring-4 ring-[#16A34A]/15" />
              <span className="tabular-nums">{truncateMiddle(address, 6, 4)}</span>
              <button
                type="button"
                onClick={() => disconnect()}
                aria-label="Disconnect wallet"
                title="Disconnect wallet"
                className="vire-pressable ml-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[#71717A] hover:bg-black/[0.05] hover:text-[#0A0A0C]"
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

      {/* Mobile navigation strip — crisp pills fitting 390px cleanly */}
      <nav
        aria-label="Mobile navigation"
        className="flex items-center justify-between gap-1 border-t border-black/[0.05] bg-[#F5F5F7]/95 px-3 py-2 md:hidden"
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
                "whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
                active
                  ? "vire-pill-surface text-[#0A0A0C]"
                  : "text-[#71717A] hover:text-[#0A0A0C]"
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
