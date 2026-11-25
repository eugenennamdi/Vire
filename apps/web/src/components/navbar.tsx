"use client";

import {
  ArrowUpRight,
  ArrowsLeftRight,
  CircleNotch,
  Key,
  PaperPlaneTilt,
  SignOut,
  Warning,
} from "@phosphor-icons/react";
import { usePrivy, useSignMessage as usePrivySignMessage } from "@privy-io/react-auth";
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
  usePublicClient,
  useReadContracts,
  useSendTransaction,
  useSignMessage,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { celo } from "wagmi/chains";
import { VireLogo } from "@/components/brand/vire-mark";
import { useIsMiniPay } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { TokenIcon } from "@/components/ui/token-icon";
import {
  CONVERTIBLE_LOCAL_TOKENS,
  executeConvertToUsdt,
  fetchConvertToUsdtPreview,
  formatWalletTxError,
  type ConvertibleLocalToken,
  type ConvertToUsdtPreview,
} from "@/lib/convert-to-usdt";
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
  privySignMessage?: (message: string) => Promise<string>;
}

type WalletSendSymbol = "USDT" | ConvertibleLocalToken;

function AccountPopover({
  walletAddress,
  identityLabel,
  shortPillLabel,
  isMiniPay = false,
  hasEmbeddedWallet = false,
  onExportWallet,
  onSignOut,
  privySignMessage,
}: AccountPopoverProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<"none" | "convert" | "send">("none");
  const [convertToken, setConvertToken] = useState<ConvertibleLocalToken>("cNGN");
  const [convertAmount, setConvertAmount] = useState("");
  const [convertPreview, setConvertPreview] = useState<ConvertToUsdtPreview | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [convertStatus, setConvertStatus] = useState<string | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [lastConvertTx, setLastConvertTx] = useState<{ hash: string; usdt: string } | null>(null);

  const [sendToken, setSendToken] = useState<WalletSendSymbol>("USDT");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [lastWithdrawTx, setLastWithdrawTx] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const { isConnected: wagmiConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync, isPending: isSending } = useWriteContract();
  const publicClient = usePublicClient({ chainId: celo.id });

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
          {
            address: CELO_TOKENS.wBRL.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [walletAddress],
            chainId: celo.id,
          },
          {
            address: CELO_TOKENS.wMXN.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [walletAddress],
            chainId: celo.id,
          },
          {
            address: CELO_TOKENS.IDRX.address,
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

  const { data: celoNative, refetch: refetchCelo } = useBalance({
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
  const wbrlRaw = balances?.[3]?.result as bigint | undefined;
  const wmxnRaw = balances?.[4]?.result as bigint | undefined;
  const idrxRaw = balances?.[5]?.result as bigint | undefined;

  const balanceByToken: Record<WalletSendSymbol, bigint | undefined> = {
    USDT: usdtRaw,
    cNGN: cngnRaw,
    wARS: warsRaw,
    wBRL: wbrlRaw,
    wMXN: wmxnRaw,
    IDRX: idrxRaw,
  };

  const heldLocalTokens = CONVERTIBLE_LOCAL_TOKENS.filter((sym) => {
    const bal = balanceByToken[sym];
    return bal !== undefined && bal > 0n;
  });
  const hasAnyLocalBalance = heldLocalTokens.length > 0;
  const convertRaw = balanceByToken[convertToken];
  const sendRaw = balanceByToken[sendToken];

  // Auto-select first held local token when Convert opens and current selection is empty
  useEffect(() => {
    if (activePanel !== "convert") return;
    if ((!convertRaw || convertRaw === 0n) && heldLocalTokens.length > 0) {
      const next = heldLocalTokens[0]!;
      setConvertToken(next);
      const bal = balanceByToken[next];
      if (bal && bal > 0n) {
        setConvertAmount(formatUnits(bal, CELO_TOKENS[next].decimals));
      }
    } else if (!convertAmount && convertRaw && convertRaw > 0n) {
      setConvertAmount(formatUnits(convertRaw, CELO_TOKENS[convertToken].decimals));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanel, heldLocalTokens.join(",")]);

  // Live indicative Textile FX preview inside the navbar Convert panel
  useEffect(() => {
    if (activePanel !== "convert") return;
    const tokenMeta = CELO_TOKENS[convertToken];
    let atomic: bigint;
    try {
      atomic = parseUnits(convertAmount.trim(), tokenMeta.decimals);
      if (atomic <= 0n) {
        setConvertPreview(null);
        return;
      }
    } catch {
      setConvertPreview(null);
      return;
    }

    let cancelled = false;
    setIsPreviewLoading(true);
    const timer = setTimeout(() => {
      void fetchConvertToUsdtPreview({
        sellToken: convertToken,
        sellAmountAtomic: atomic.toString(),
      }).then((preview) => {
        if (!cancelled) {
          setConvertPreview(preview);
          setIsPreviewLoading(false);
        }
      });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activePanel, convertToken, convertAmount]);

  async function handleConvertLocalToUsdt(e: React.FormEvent) {
    e.preventDefault();
    if (!walletAddress) return;
    setConvertError(null);
    setLastConvertTx(null);

    const tokenMeta = CELO_TOKENS[convertToken];
    let atomic: bigint;
    try {
      atomic = parseUnits(convertAmount.trim(), tokenMeta.decimals);
      if (atomic <= 0n) throw new Error("zero");
    } catch {
      setConvertError(`Enter a valid ${convertToken} amount.`);
      return;
    }

    if (convertRaw !== undefined && atomic > convertRaw) {
      setConvertError(`Amount exceeds your available ${convertToken} balance.`);
      return;
    }

    setIsConverting(true);
    setConvertStatus("Preparing swap…");
    try {
      const res = await executeConvertToUsdt({
        wallet: walletAddress,
        sellToken: convertToken,
        sellAmountAtomic: atomic.toString(),
        publicClient,
        sendTransactionAsync: (args) => sendTransactionAsync(args),
        signMessage: (msg) =>
          wagmiConnected
            ? signMessageAsync({ message: msg })
            : privySignMessage
              ? privySignMessage(msg)
              : signMessageAsync({ message: msg }),
        onStatus: setConvertStatus,
      });
      setLastConvertTx({ hash: res.swapTxHash, usdt: res.buyUsdtFormatted });
      setConvertAmount("");
      toast.success(`Converted ${res.takerPaysFormatted} ${convertToken} → ${res.buyUsdtFormatted} USDT`);
      void Promise.all([refetchBalances(), refetchCelo()]);
    } catch (err) {
      setConvertError(formatWalletTxError(err, "Conversion cancelled or failed."));
      toast.error("Conversion failed");
    } finally {
      setIsConverting(false);
      setConvertStatus(null);
    }
  }

  async function handleSendToken(e: React.FormEvent) {
    e.preventDefault();
    setWithdrawError(null);
    setLastWithdrawTx(null);

    const toTrimmed = withdrawTo.trim();
    if (!isAddress(toTrimmed)) {
      setWithdrawError("Enter a valid Celo 0x recipient address.");
      return;
    }

    const tokenMeta = CELO_TOKENS[sendToken];
    let atomic: bigint;
    try {
      atomic = parseUnits(withdrawAmount.trim(), tokenMeta.decimals);
      if (atomic <= 0n) throw new Error("Amount must be greater than 0");
    } catch {
      setWithdrawError(`Enter a valid ${sendToken} amount.`);
      return;
    }

    if (sendRaw !== undefined && atomic > sendRaw) {
      setWithdrawError(`Amount exceeds your available ${sendToken} balance.`);
      return;
    }

    try {
      const hash = await writeContractAsync({
        address: tokenMeta.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [getAddress(toTrimmed), atomic],
        chainId: celo.id,
      });
      setLastWithdrawTx(hash);
      setWithdrawAmount("");
      setWithdrawTo("");
      toast.success(`Sent ${withdrawAmount.trim()} ${sendToken} on Celo Mainnet`);
      void Promise.all([refetchBalances(), refetchCelo()]);
    } catch (err) {
      setWithdrawError(formatWalletTxError(err, "Transfer cancelled or failed."));
      toast.error(`${sendToken} transfer failed`);
    }
  }

  const sendTokenChoices: WalletSendSymbol[] = [
    "USDT",
    "cNGN",
    ...heldLocalTokens.filter((t) => t !== "cNGN"),
  ];

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
          className="absolute right-0 z-50 mt-2 max-h-[calc(100dvh-5rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl bg-white shadow-[0_0_0_1px_rgba(10,10,12,0.08),0_16px_36px_-10px_rgba(10,10,12,0.16)]"
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
                    <TokenIcon symbol="USDT" size={18} />
                    USDT
                  </span>
                  <span className="font-mono font-medium text-[#0A0A0C] tabular-nums">
                    {formatCompactBalance(usdtRaw, CELO_TOKENS.USDT.decimals)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-[#3F3F46]">
                    <TokenIcon symbol="cNGN" size={18} />
                    cNGN
                  </span>
                  <span className="font-mono font-medium text-[#0A0A0C] tabular-nums">
                    {formatCompactBalance(cngnRaw, CELO_TOKENS.cNGN.decimals)}
                  </span>
                </div>
                {(["wARS", "wBRL", "wMXN", "IDRX"] as const).map((sym) => {
                  const raw = balanceByToken[sym];
                  if (!raw || raw === 0n) return null;
                  return (
                    <div key={sym} className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-2 text-[#3F3F46]">
                        <TokenIcon symbol={sym} size={18} />
                        {sym}
                      </span>
                      <span className="font-mono font-medium text-[#0A0A0C] tabular-nums">
                        {formatCompactBalance(raw, CELO_TOKENS[sym].decimals)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Convert local payout -> Celo USDT via Textile FX (for MiniPay & Exchanges) */}
              {activePanel === "convert" && (
                <form
                  onSubmit={handleConvertLocalToUsdt}
                  className="mt-3 space-y-2 rounded-xl bg-[#FAFAFB] p-3 ring-1 ring-black/[0.06]"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-[#52525B]">
                    <span>Convert to USDT (Celo)</span>
                    {convertRaw !== undefined && convertRaw > 0n && (
                      <button
                        type="button"
                        onClick={() =>
                          setConvertAmount(formatUnits(convertRaw, CELO_TOKENS[convertToken].decimals))
                        }
                        className="font-mono text-[10.5px] text-[#0A0A0C] underline underline-offset-2"
                      >
                        Max
                      </button>
                    )}
                  </div>

                  {heldLocalTokens.length > 1 && (
                    <div className="flex flex-wrap gap-1">
                      {heldLocalTokens.map((sym) => (
                        <button
                          key={sym}
                          type="button"
                          onClick={() => {
                            setConvertToken(sym);
                            const bal = balanceByToken[sym];
                            setConvertAmount(bal ? formatUnits(bal, CELO_TOKENS[sym].decimals) : "");
                            setConvertError(null);
                          }}
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                            convertToken === sym
                              ? "bg-[#0A0A0C] text-white"
                              : "bg-white text-[#52525B] ring-1 ring-black/[0.08] hover:text-[#0A0A0C]"
                          )}
                        >
                          {sym}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={convertAmount}
                      onChange={(e) => setConvertAmount(e.target.value)}
                      placeholder={`Amount (${convertToken})`}
                      className="h-9 min-w-0 flex-1 rounded-lg bg-white px-2.5 font-mono text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.09] placeholder:text-[#A1A1AA] focus:outline-none focus:ring-[#0A0A0C]/40 sm:h-8 sm:text-[11.5px]"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="primary"
                      disabled={isConverting || !convertRaw || convertRaw === 0n}
                      className="h-9 shrink-0 px-3 text-[11.5px] sm:h-8"
                    >
                      {isConverting ? <CircleNotch className="h-3.5 w-3.5 animate-spin" /> : "Convert"}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[#71717A]">
                    <span>Textile FX quote</span>
                    {isPreviewLoading ? (
                      <span className="font-mono text-[#52525B]">Quoting…</span>
                    ) : convertPreview?.status === "preview" && convertPreview.buyUsdtFormatted ? (
                      <span className="font-mono font-medium text-[#0A0A0C] tabular-nums">
                        ≈ {convertPreview.buyUsdtFormatted} USDT
                      </span>
                    ) : convertPreview?.status === "no_quote" ? (
                      <span className="text-[#B45309]">Min ~$1.00 USDT</span>
                    ) : (
                      <span>—</span>
                    )}
                  </div>

                  <p className="text-[10.5px] leading-snug text-[#71717A]">
                    <strong className="font-medium text-[#0A0A0C]">Launch perk:</strong> Network gas
                    covered by Vire during launch.{" "}
                    {isMiniPay
                      ? "Swaps straight into your MiniPay USDT balance (OPay / Moniepoint, min 0.35 USDT)."
                      : "Convert local payouts to Celo USDT before sending to MiniPay or exchanges."}
                  </p>

                  {convertStatus && (
                    <p className="text-[11px] text-[#52525B]">{convertStatus}</p>
                  )}
                  {convertError && (
                    <p className="text-[11px] leading-snug text-[#DC2626]">{convertError}</p>
                  )}
                  {lastConvertTx && (
                    <a
                      href={celoscanTxUrl(lastConvertTx.hash)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-[#16A34A] underline underline-offset-2"
                    >
                      Swapped → {lastConvertTx.usdt} USDT · View tx
                      <ArrowUpRight className="h-3 w-3" />
                    </a>
                  )}
                </form>
              )}

              {/* Send Celo USDT (MiniPay / Exchanges) or raw local stablecoin */}
              {activePanel === "send" && (
                <form
                  onSubmit={handleSendToken}
                  className="mt-3 space-y-2 rounded-xl bg-[#FAFAFB] p-3 ring-1 ring-black/[0.06]"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-[#52525B]">
                    <span>Send {sendToken} (Celo)</span>
                    {sendRaw !== undefined && sendRaw > 0n && (
                      <button
                        type="button"
                        onClick={() =>
                          setWithdrawAmount(formatUnits(sendRaw, CELO_TOKENS[sendToken].decimals))
                        }
                        className="font-mono text-[10.5px] text-[#0A0A0C] underline underline-offset-2"
                      >
                        Max
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {sendTokenChoices.map((sym) => (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => {
                          setSendToken(sym);
                          setWithdrawAmount("");
                          setWithdrawError(null);
                        }}
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                          sendToken === sym
                            ? "bg-[#0A0A0C] text-white"
                            : "bg-white text-[#52525B] ring-1 ring-black/[0.08] hover:text-[#0A0A0C]"
                        )}
                      >
                        {sym}
                      </button>
                    ))}
                  </div>

                  <input
                    type="text"
                    value={withdrawTo}
                    onChange={(e) => setWithdrawTo(e.target.value)}
                    placeholder={
                      sendToken === "USDT"
                        ? "MiniPay, Quidax, or Bybit 0x…"
                        : "Celo self-custody 0x… address"
                    }
                    className="h-9 w-full rounded-lg bg-white px-2.5 font-mono text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.09] placeholder:text-[#A1A1AA] focus:outline-none focus:ring-[#0A0A0C]/40 sm:h-8 sm:text-[11.5px]"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder={sendToken === "USDT" ? "Amount (e.g. 1.74)" : `Amount (${sendToken})`}
                      className="h-9 min-w-0 flex-1 rounded-lg bg-white px-2.5 font-mono text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.09] placeholder:text-[#A1A1AA] focus:outline-none focus:ring-[#0A0A0C]/40 sm:h-8 sm:text-[11.5px]"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="primary"
                      disabled={isSending || !sendRaw || sendRaw === 0n}
                      className="h-9 shrink-0 px-3 text-[11.5px] sm:h-8"
                    >
                      {isSending ? <CircleNotch className="h-3.5 w-3.5 animate-spin" /> : "Send"}
                    </Button>
                  </div>

                  {sendToken !== "USDT" && (
                    <p className="text-[10.5px] leading-snug text-[#71717A]">
                      Note: MiniPay only shows USDT, USDC, and USAT. Convert {sendToken} to USDT first for MiniPay or exchange cash-outs.
                    </p>
                  )}

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
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActivePanel((prev) => (prev === "convert" ? "none" : "convert"));
                    setConvertError(null);
                  }}
                  className="flex w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-medium text-[#3F3F46] transition-colors hover:bg-[#F5F5F7] hover:text-[#0A0A0C]"
                >
                  <span className="inline-flex items-center gap-2.5">
                    <ArrowsLeftRight weight="regular" className="h-3.5 w-3.5 text-[#71717A]" />
                    <span>{activePanel === "convert" ? "Hide convert" : "Convert to USDT"}</span>
                  </span>
                  {hasAnyLocalBalance && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" />
                  )}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActivePanel((prev) => (prev === "send" ? "none" : "send"));
                    setWithdrawError(null);
                  }}
                  className="flex w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-medium text-[#3F3F46] transition-colors hover:bg-[#F5F5F7] hover:text-[#0A0A0C]"
                >
                  <span className="inline-flex items-center gap-2.5">
                    <PaperPlaneTilt weight="regular" className="h-3.5 w-3.5 text-[#71717A]" />
                    <span>{activePanel === "send" ? "Hide send" : "Send to MiniPay / Wallet"}</span>
                  </span>
                  {usdtRaw !== undefined && usdtRaw > 0n && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" />
                  )}
                </button>
              </>
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
  const { signMessage: privySignMessage } = usePrivySignMessage();
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
      privySignMessage={async (message) => {
        const res = await privySignMessage({ message });
        return res.signature;
      }}
      onSignOut={async () => {
        await fetch("/api/auth/wallet", { method: "DELETE" }).catch(() => {});
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
        onSignOut={async () => {
          await fetch("/api/auth/wallet", { method: "DELETE" }).catch(() => {});
          disconnect();
        }}
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
      <div className="mx-auto flex h-14 max-w-[1220px] items-center justify-between gap-4 px-4 sm:h-16 sm:px-6 md:grid md:grid-cols-[1fr_auto_1fr] lg:px-8">
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

      {/* Mobile navigation strip — spacious touch pills with smooth horizontal glide & subtle right edge fade */}
      <div className="relative border-t border-black/[0.05] bg-[#F5F5F7]/95 md:hidden">
        <nav
          aria-label="Mobile navigation"
          className="flex items-center gap-1 overflow-x-auto px-3 py-1.5 pr-9 [scrollbar-width:none] sm:justify-center sm:pr-3 [&::-webkit-scrollbar]:hidden"
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
                  "vire-pressable inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[12.5px] font-medium transition-colors",
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
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[#F5F5F7] via-[#F5F5F7]/80 to-transparent sm:hidden"
        />
      </div>
    </header>
  );
}
