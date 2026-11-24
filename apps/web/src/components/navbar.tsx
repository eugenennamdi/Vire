"use client";

import { ArrowUpRight, CircleNotch, Key, PaperPlaneTilt, SignOut, Warning } from "@phosphor-icons/react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { CELO_TOKENS, celoscanAddressUrl, celoscanTxUrl } from "@vire/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { erc20Abi, formatUnits, getAddress, isAddress, parseUnits, type Address } from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useDisconnect,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { celo } from "wagmi/chains";
import { VireLogo } from "@/components/brand/vire-mark";
import { useIsMiniPay } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { TokenIcon } from "@/components/ui/token-icon";
import { cn, truncateMiddle } from "@/lib/utils";

const PRIVY_ENABLED = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim());

const NAV_LINKS = [
  { href: "/", label: "Overview" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/create", label: "Launch" },
  { href: "/manage", label: "Workspace" },
  { href: "/ledger", label: "Ledger" },
  { href: "/console", label: "Console" },
] as const;

function formatCompactBalance(raw: bigint | undefined, decimals: number): string {
  if (raw === undefined) return "—";
  const num = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(num) || num === 0) return "0";
  return num >= 100
    ? num.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : num.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

interface AccountPopoverProps {
  walletAddress?: Address;
  identityLabel: string;
  shortPillLabel: string;
  isMiniPay?: boolean;
  hasEmbeddedWallet?: boolean;
  onExportWallet?: () => void;
  onSignOut?: () => Promise<void> | void;
}

function AccountPopover({
  walletAddress,
  identityLabel,
  shortPillLabel,
  isMiniPay = false,
  hasEmbeddedWallet = false,
  onExportWallet,
  onSignOut,
}: AccountPopoverProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [lastWithdrawTx, setLastWithdrawTx] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const { writeContractAsync, isPending: isSending } = useWriteContract();

  const { data: balances, refetch: refetchBalances } = useReadContracts({
    contracts: walletAddress
      ? [
          {
            address: CELO_TOKENS.cNGN.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [walletAddress],
            chainId: celo.id,
          },
          {
            address: CELO_TOKENS.USDT.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [walletAddress],
            chainId: celo.id,
          },
          {
            address: CELO_TOKENS.wARS.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [walletAddress],
            chainId: celo.id,
          },
        ]
      : [],
    query: {
      enabled: Boolean(walletAddress && menuOpen),
      staleTime: 10_000,
    },
  });

  const { data: celoNative } = useBalance({
    address: walletAddress,
    chainId: celo.id,
    query: {
      enabled: Boolean(walletAddress && menuOpen),
      staleTime: 10_000,
    },
  });

  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const cngnRaw = balances?.[0]?.result as bigint | undefined;
  const usdtRaw = balances?.[1]?.result as bigint | undefined;
  const warsRaw = balances?.[2]?.result as bigint | undefined;
  const hasCngn = Boolean(cngnRaw && cngnRaw > 0n);

  async function handleWithdrawCngn(e: React.FormEvent) {
    e.preventDefault();
    setWithdrawError(null);
    setLastWithdrawTx(null);

    const toTrimmed = withdrawTo.trim();
    if (!isAddress(toTrimmed)) {
      setWithdrawError("Enter a valid Celo 0x recipient address.");
      return;
    }

    let atomic: bigint;
    try {
      atomic = parseUnits(withdrawAmount.trim(), CELO_TOKENS.cNGN.decimals);
      if (atomic <= 0n) throw new Error("Amount must be greater than 0");
    } catch {
      setWithdrawError("Enter a valid cNGN amount.");
      return;
    }

    if (cngnRaw !== undefined && atomic > cngnRaw) {
      setWithdrawError("Amount exceeds your available cNGN balance.");
      return;
    }

    try {
      const hash = await writeContractAsync({
        address: CELO_TOKENS.cNGN.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [getAddress(toTrimmed), atomic],
        chainId: celo.id,
      });
      setLastWithdrawTx(hash);
      setWithdrawAmount("");
      setWithdrawTo("");
      toast.success(`Sent ${withdrawAmount.trim()} cNGN on Celo Mainnet`);
      void refetchBalances();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transfer cancelled or failed.";
      setWithdrawError(msg.slice(0, 140));
      toast.error("cNGN transfer failed");
    }
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={() => setMenuOpen((prev) => !prev)}
        className="vire-pressable vire-pill-surface inline-flex h-8 max-w-[176px] items-center gap-2 rounded-full pl-2.5 pr-2.5 text-[12.5px] font-medium text-[#0A0A0C]"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#16A34A] ring-4 ring-[#16A34A]/15" />
        <span className="truncate tabular-nums">{shortPillLabel}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className={cn(
            "h-3 w-3 shrink-0 text-[#71717A] transition-transform duration-150 ease-[var(--ease-out)]",
            menuOpen && "rotate-180 text-[#0A0A0C]"
          )}
        >
          <path
            d="M4 6.25L8 10.25L12 6.25"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-white shadow-[0_0_0_1px_rgba(10,10,12,0.08),0_16px_36px_-10px_rgba(10,10,12,0.16)]"
        >
          {/* Identity & Wallet Address */}
          <div className="border-b border-black/[0.06] px-4 py-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-[13px] font-medium text-[#0A0A0C]">{identityLabel}</div>
              {isMiniPay && (
                <span className="rounded-full bg-[#F4F4F5] px-2 py-0.5 font-mono text-[10px] font-medium text-[#3F3F46]">
                  MiniPay
                </span>
              )}
            </div>
            {walletAddress ? (
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <a
                  href={celoscanAddressUrl(walletAddress)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[11.5px] text-[#71717A] hover:text-[#0A0A0C]"
                >
                  {truncateMiddle(walletAddress, 8, 6)}
                  <ArrowUpRight className="h-3 w-3" />
                </a>
                <CopyButton
                  value={walletAddress}
                  label="Copy"
                  toastMessage="Wallet address copied"
                />
              </div>
            ) : (
              <div className="mt-1 text-[11.5px] text-[#71717A]">Creating Celo wallet…</div>
            )}
          </div>

          {/* Live Celo Mainnet Balances */}
          {walletAddress && (
            <div className="border-b border-black/[0.06] px-4 py-3">
              <div className="mb-2 flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#A1A1AA]">
                <span>Celo Balance</span>
                {celoNative && (
                  <span className="font-mono font-normal normal-case tracking-normal text-[#71717A] tabular-nums">
                    Gas: {formatCompactBalance(celoNative.value, 18)} CELO
                  </span>
                )}
              </div>
              <div className="space-y-2 text-[12.5px]">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-[#3F3F46]">
                    <TokenIcon symbol="cNGN" size={18} />
                    cNGN
                  </span>
                  <span className="font-mono font-medium text-[#0A0A0C] tabular-nums">
                    {formatCompactBalance(cngnRaw, CELO_TOKENS.cNGN.decimals)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-[#3F3F46]">
                    <TokenIcon symbol="USDT" size={18} />
                    USDT
                  </span>
                  <span className="font-mono font-medium text-[#0A0A0C] tabular-nums">
                    {formatCompactBalance(usdtRaw, CELO_TOKENS.USDT.decimals)}
                  </span>
                </div>
                {warsRaw !== undefined && warsRaw > 0n && (
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-[#3F3F46]">
                      <TokenIcon symbol="wARS" size={18} />
                      wARS
                    </span>
                    <span className="font-mono font-medium text-[#0A0A0C] tabular-nums">
                      {formatCompactBalance(warsRaw, CELO_TOKENS.wARS.decimals)}
                    </span>
                  </div>
                )}
              </div>

              {/* 1-Click Send / Withdraw cNGN to Busha, Quidax, Roqqu, or MiniPay */}
              {withdrawOpen && (
                <form
                  onSubmit={handleWithdrawCngn}
                  className="mt-3 space-y-2 rounded-xl bg-[#FAFAFB] p-3 ring-1 ring-black/[0.06]"
                >
                  <div className="flex items-center justify-between text-[11px] font-medium text-[#52525B]">
                    <span>Send cNGN (Celo network)</span>
                    {hasCngn && cngnRaw !== undefined && (
                      <button
                        type="button"
                        onClick={() =>
                          setWithdrawAmount(formatUnits(cngnRaw, CELO_TOKENS.cNGN.decimals))
                        }
                        className="font-mono text-[10.5px] text-[#0A0A0C] underline underline-offset-2"
                      >
                        Max
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={withdrawTo}
                    onChange={(e) => setWithdrawTo(e.target.value)}
                    placeholder="Busha, Quidax, or MiniPay 0x…"
                    className="h-8 w-full rounded-lg bg-white px-2.5 font-mono text-[11.5px] text-[#0A0A0C] ring-1 ring-black/[0.09] placeholder:text-[#A1A1AA] focus:outline-none focus:ring-[#0A0A0C]/40"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="Amount (e.g. 2500)"
                      className="h-8 min-w-0 flex-1 rounded-lg bg-white px-2.5 font-mono text-[11.5px] text-[#0A0A0C] ring-1 ring-black/[0.09] placeholder:text-[#A1A1AA] focus:outline-none focus:ring-[#0A0A0C]/40"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="primary"
                      disabled={isSending || !hasCngn}
                      className="h-8 shrink-0 px-3 text-[11.5px]"
                    >
                      {isSending ? <CircleNotch className="h-3.5 w-3.5 animate-spin" /> : "Send"}
                    </Button>
                  </div>
                  {withdrawError && (
                    <p className="text-[11px] leading-snug text-[#DC2626]">{withdrawError}</p>
                  )}
                  {lastWithdrawTx && (
                    <a
                      href={celoscanTxUrl(lastWithdrawTx)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-[#16A34A] underline underline-offset-2"
                    >
                      Sent: {truncateMiddle(lastWithdrawTx, 8, 6)}
                      <ArrowUpRight className="h-3 w-3" />
                    </a>
                  )}
                </form>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="p-1.5">
            {walletAddress && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setWithdrawOpen((prev) => !prev);
                  setWithdrawError(null);
                }}
                className="flex w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-medium text-[#3F3F46] transition-colors hover:bg-[#F5F5F7] hover:text-[#0A0A0C]"
              >
                <span className="inline-flex items-center gap-2.5">
                  <PaperPlaneTilt weight="regular" className="h-3.5 w-3.5 text-[#71717A]" />
                  <span>{withdrawOpen ? "Hide withdraw" : "Withdraw cNGN"}</span>
                </span>
                {hasCngn && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" />
                )}
              </button>
            )}
            {hasEmbeddedWallet && onExportWallet && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onExportWallet();
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-medium text-[#3F3F46] transition-colors hover:bg-[#F5F5F7] hover:text-[#0A0A0C]"
              >
                <Key weight="regular" className="h-3.5 w-3.5 text-[#71717A]" />
                <span>Export wallet key</span>
              </button>
            )}
            {!isMiniPay && onSignOut && (
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  setMenuOpen(false);
                  await onSignOut();
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-medium text-[#52525B] transition-colors hover:bg-[#FEF2F2] hover:text-[#B91C1C]"
              >
                <SignOut weight="regular" className="h-3.5 w-3.5" />
                <span>Sign out</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PrivyAccountControl() {
  const { ready, authenticated, user, login, logout, exportWallet } = usePrivy();
  const { address: wagmiAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const walletAddress = (wagmiAddress ?? user?.wallet?.address) as Address | undefined;
  const isSignedIn = authenticated || Boolean(isConnected && wagmiAddress);
  const wrongChain = Boolean(isConnected && wagmiAddress && chainId !== celo.id);

  const hasEmbeddedWallet = Boolean(
    user?.linkedAccounts?.some(
      (acc) => acc.type === "wallet" && acc.walletClientType === "privy"
    )
  );

  if (!ready) {
    return <div className="h-8 w-24 animate-pulse rounded-full bg-black/[0.06]" />;
  }

  if (wrongChain) {
    return (
      <Button
        size="sm"
        variant="outlineStrong"
        onClick={() => switchChain({ chainId: celo.id })}
      >
        <Warning weight="regular" className="h-3.5 w-3.5" />
        Switch to Celo
      </Button>
    );
  }

  if (!isSignedIn) {
    return (
      <Button size="sm" variant="primary" onClick={() => login()} className="px-4">
        Sign in
      </Button>
    );
  }

  const identityLabel = user?.twitter?.username
    ? `@${user.twitter.username}`
    : user?.google?.email ?? user?.email?.address ?? (walletAddress ? truncateMiddle(walletAddress, 6, 4) : "Account");

  const shortPillLabel: string =
    (user?.twitter?.username
      ? `@${user.twitter.username}`
      : user?.google?.email
        ? user.google.email.split("@")[0]
        : user?.email?.address
          ? user.email.address.split("@")[0]
          : walletAddress
            ? truncateMiddle(walletAddress, 6, 4)
            : "Account") || "Account";

  return (
    <AccountPopover
      walletAddress={walletAddress}
      identityLabel={identityLabel}
      shortPillLabel={shortPillLabel}
      hasEmbeddedWallet={hasEmbeddedWallet}
      onExportWallet={() => {
        void exportWallet();
      }}
      onSignOut={async () => {
        if (authenticated) await logout();
        disconnect();
      }}
    />
  );
}

function FallbackWalletControl({ isMiniPay = false }: { isMiniPay?: boolean }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  // MiniPay runs natively on Celo Mainnet — never show a chain-switch prompt inside MiniPay.
  if (!isMiniPay && isConnected && chainId !== celo.id) {
    return (
      <Button size="sm" variant="outlineStrong" onClick={() => switchChain({ chainId: celo.id })}>
        <Warning weight="regular" className="h-3.5 w-3.5" />
        Switch to Celo
      </Button>
    );
  }

  if (isConnected && address) {
    return (
      <AccountPopover
        walletAddress={address}
        identityLabel={isMiniPay ? "MiniPay Wallet" : truncateMiddle(address, 6, 4)}
        shortPillLabel={truncateMiddle(address, 6, 4)}
        isMiniPay={isMiniPay}
        onSignOut={() => disconnect()}
      />
    );
  }

  return (
    <Button
      size="sm"
      variant="primary"
      disabled={isPending}
      className="px-4"
      onClick={() => {
        const connector = connectors[0];
        if (connector) connect({ connector });
      }}
    >
      {isPending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const isMiniPay = useIsMiniPay();
  const [mounted, setMounted] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

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

        {/* Right: Official Celo Network Pill + Privy Sign In / Account Menu */}
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
            <div className="h-8 w-24 animate-pulse rounded-full bg-black/[0.06]" />
          ) : PRIVY_ENABLED && !isMiniPay ? (
            <PrivyAccountControl />
          ) : (
            <FallbackWalletControl isMiniPay={isMiniPay} />
          )}
        </div>
      </div>

      {/* Mobile navigation strip — clean horizontal strip fitting 390px cleanly */}
      <nav
        aria-label="Mobile navigation"
        className="flex items-center justify-between gap-1 overflow-x-auto border-t border-black/[0.05] bg-[#F5F5F7]/95 px-3 py-2 md:hidden"
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
