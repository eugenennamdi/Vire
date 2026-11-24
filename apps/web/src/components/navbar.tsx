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

/** Deterministic Swiss monochrome 3x3 geometric avatar derived from EVM address bytes. */
function AddressAvatar({ address, size = 20 }: { address: string; size?: number }) {
  const hex = address.replace(/^0x/i, "").padEnd(16, "0");
  const cells: number[] = [];
  for (let i = 0; i < 6; i++) {
    cells.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  }
  const c = (idx: number) => (cells[idx] ?? 0) % 3;
  const grid = [
    c(0), c(1), c(0),
    c(2), c(3), c(2),
    c(4), c(5), c(4),
  ];
  const fills = ["#111111", "#71717A", "#E4E4E7"];

  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded bg-[#F4F4F5] ring-1 ring-black/[0.08]"
    >
      <svg width={size * 0.68} height={size * 0.68} viewBox="0 0 18 18" fill="none">
        {grid.map((tone, idx) => {
          const x = (idx % 3) * 6;
          const y = Math.floor(idx / 3) * 6;
          return (
            <rect
              key={idx}
              x={x + 0.6}
              y={y + 0.6}
              width={4.8}
              height={4.8}
              rx={1.1}
              fill={fills[tone]}
            />
          );
        })}
      </svg>
    </span>
  );
}

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
    <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-background/85 backdrop-blur-md">
      <div className="mx-auto grid h-16 max-w-[1240px] grid-cols-[1fr_auto] items-center gap-3 px-4 sm:gap-4 sm:px-6 md:grid-cols-[1fr_auto_1fr] lg:px-8">
        {/* Left: Brand Lockup */}
        <div className="flex min-w-0 items-center">
          <Link
            href="/"
            aria-label="Vire — Overview"
            className="vire-pressable inline-flex shrink-0 items-center rounded-lg py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
          >
            <VireLogo size={28} />
          </Link>
        </div>

        {/* Center: Floating Segmented Pill Navigation */}
        <nav
          aria-label="Primary"
          className="hidden items-center gap-0.5 rounded-full bg-black/[0.045] p-1 md:inline-flex"
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
                  "vire-pressable whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-medium",
                  active
                    ? "bg-card text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right: Quiet Protocol Link + Wallet Control */}
        <div className="flex min-w-0 items-center justify-end gap-2.5 sm:gap-3">
          <Link
            href="/api/agent-card.json"
            className="hidden items-center gap-1.5 font-mono text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground lg:inline-flex"
            title="Inspect ERC-8004 agent registration manifest"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
            <span>{rep?.registered && rep.agentId ? `Agent #${rep.agentId}` : "Celo 42220"}</span>
          </Link>

          {!mounted ? (
            <div className="h-8 w-28 animate-pulse rounded-lg bg-black/[0.06]" />
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
            <div className="inline-flex h-8 items-center gap-2 rounded-lg border border-black/[0.09] bg-card pl-1.5 pr-1 font-mono text-xs text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <AddressAvatar address={address} size={20} />
              <span className="tabular-nums">{truncateMiddle(address, 6, 4)}</span>
              <button
                type="button"
                onClick={() => disconnect()}
                aria-label="Disconnect wallet"
                title="Disconnect wallet"
                className="vire-pressable flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/[0.05] hover:text-foreground"
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

      {/* Mobile navigation strip — fits all 5 concise links cleanly inside 390px */}
      <nav
        aria-label="Mobile navigation"
        className="flex items-center justify-between border-t border-black/[0.06] bg-background/95 px-3 py-1.5 md:hidden"
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
                "vire-pressable whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
                active
                  ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.07)]"
                  : "text-muted-foreground"
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
