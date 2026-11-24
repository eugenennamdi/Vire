"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, LogOut, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { celo } from "wagmi/chains";

const NAV_LINKS = [
  { href: "/", label: "Mission Control" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/claim", label: "Claim Payout" },
  { href: "/ledger", label: "Audit Ledger" },
  { href: "/console", label: "Console & x402" },
];

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

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
    <header className="sticky top-0 z-40 border-b border-zinc-200/90 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-7">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-950 text-emerald-400 font-mono text-sm font-bold">
              V
            </span>
            <div className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight text-zinc-950">Vire</span>
              <span className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                Celo FX Clearing
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="hidden items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-700 lg:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="font-mono font-medium">Celo 42220</span>
            {rep?.registered && rep.agentId ? (
              <span className="flex items-center gap-1 border-l border-zinc-300 pl-2 font-mono text-emerald-700">
                <ShieldCheck className="h-3.5 w-3.5" />
                ERC-8004 #{rep.agentId}
                {rep.summary?.averageScore ? ` · ${rep.summary.averageScore}/100` : ""}
              </span>
            ) : (
              <span className="border-l border-zinc-300 pl-2 font-mono text-zinc-500">
                ERC-8004 Ready
              </span>
            )}
          </div>

          {wrongChain ? (
            <button
              type="button"
              onClick={() => switchChain({ chainId: celo.id })}
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              Switch to Celo Mainnet
            </button>
          ) : isConnected && address ? (
            <div className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span className="font-mono font-medium text-zinc-900">{shortAddr(address)}</span>
              <button
                type="button"
                onClick={() => disconnect()}
                title="Disconnect wallet"
                className="ml-1 rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-800"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                const connector = connectors[0];
                if (connector) connect({ connector });
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-950 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              <Wallet className="h-3.5 w-3.5" />
              {isPending ? "Connecting…" : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>

      {/* Mobile navigation strip */}
      <div className="flex items-center gap-1 overflow-x-auto border-t border-zinc-100 px-4 py-1.5 md:hidden">
        {NAV_LINKS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium ${
                active ? "bg-zinc-900 text-white" : "text-zinc-600"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
