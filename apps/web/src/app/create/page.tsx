"use client";

import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle,
  CircleNotch,
  Globe,
  LinkSimple,
  LockSimple,
  Sparkle,
  UserCheck,
  Warning,
} from "@phosphor-icons/react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import {
  CELO_TOKENS,
  celoscanTxUrl,
  CORRIDORS,
  FUNDING_TOKEN_LIST,
  FUNDING_TOKENS,
  isAllowedTextileTarget,
  parseTokenAmount,
  PRIMARY_CORRIDORS,
  VIRE_VAULT_ABI,
  type AutoPlatform,
  type CampaignVisibility,
  type CorridorLiveStatus,
  type CorridorSymbol,
  type DeliverableType,
  type FundingTokenSymbol,
  type VerificationMode,
} from "@vire/shared";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  erc20Abi,
  formatUnits,
  keccak256,
  parseUnits,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  usePublicClient,
  useReadContracts,
  useSendTransaction,
  useSignMessage,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { celo } from "wagmi/chains";
import { useIsMiniPay } from "@/components/providers";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { TokenIcon } from "@/components/ui/token-icon";
import { buildWalletAuthMessage, requestAuthNonce } from "@/lib/session-client";
import { cn, truncateMiddle } from "@/lib/utils";

const PRIVY_ENABLED = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim());
const MIN_BUDGET_USDT = 10;
const DRAFT_STORAGE_KEY = "vire_pending_campaign_draft_v2";

interface PendingDraft {
  campaignId: Hex;
  txHash?: Hex;
  slug: string;
  partnerName: string;
  partnerLocation: string;
  title: string;
  description: string;
  criteria: string;
  deliverableType: DeliverableType;
  corridor: CorridorSymbol;
  rewardLocalHuman: string;
  visibility: CampaignVisibility;
  verificationMode: VerificationMode;
  autoRules: {
    platform: AutoPlatform;
    requiredTokens: string[];
    minAuthorFollowers: number;
    minAccountAgeDays: number;
  } | null;
  inviteCode?: string;
  endsAt: number | null;
  maxPayoutsPerRecipient: number;
  creatorWallet: string;
}

function slugifyTitle(title: string, visibility: CampaignVisibility): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 44) || "campaign";
  const randBytes = new Uint8Array(visibility === "unlisted" ? 6 : 3);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(randBytes);
  }
  const suffix = Array.from(randBytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, visibility === "unlisted" ? 10 : 5);
  return `${base}-${suffix}`;
}

function defaultRewardForCorridor(corridor: CorridorSymbol, rate: number): string {
  // Clean round local currency amount comfortably clearing ~$1.75–$2.00 USDT
  const target = rate * 1.75;
  if (corridor === "IDRX") return String(Math.max(25000, Math.round(target / 5000) * 5000));
  if (corridor === "cNGN" || corridor === "wARS") return String(Math.max(2500, Math.round(target / 500) * 500));
  if (corridor === "wMXN") return String(Math.max(35, Math.round(target / 5) * 5));
  if (corridor === "wBRL") return String(Math.max(10, Math.round(target)));
  return String(Math.max(10, Math.round(target)));
}

function SignInTriggerButton({ label }: { label: string }) {
  const isMiniPay = useIsMiniPay();
  if (PRIVY_ENABLED && !isMiniPay) {
    return <PrivySignInButton label={label} />;
  }
  return <FallbackSignInButton label={label} />;
}

function PrivySignInButton({ label }: { label: string }) {
  const { login } = usePrivy();
  return (
    <Button type="button" size="lg" variant="primary" className="w-full" onClick={() => login()}>
      {label}
    </Button>
  );
}

function FallbackSignInButton({ label }: { label: string }) {
  const { connect, connectors, isPending } = useConnect();
  return (
    <Button
      type="button"
      size="lg"
      variant="primary"
      className="w-full"
      disabled={isPending}
      onClick={() => {
        const c = connectors[0];
        if (c) connect({ connector: c });
      }}
    >
      {isPending ? "Connecting…" : label}
    </Button>
  );
}

export default function CreateCampaignPage() {
  const { address: connectedWallet, isConnected } = useAccount();
  const chainId = useChainId();
  const isMiniPay = useIsMiniPay();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: celo.id });
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();

  // Form state
  const [partnerName, setPartnerName] = useState("");
  const [partnerLocation, setPartnerLocation] = useState("Global");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState("");

  const [verificationMode, setVerificationMode] = useState<VerificationMode>("auto");
  const [autoPlatform, setAutoPlatform] = useState<AutoPlatform>("x");
  const [requiredTokensInput, setRequiredTokensInput] = useState("");
  const [minFollowers, setMinFollowers] = useState(10);
  const [minAccountAgeDays, setMinAccountAgeDays] = useState(30);

  const [corridor, setCorridor] = useState<CorridorSymbol>("cNGN");
  const [fundingToken, setFundingToken] = useState<FundingTokenSymbol>("USDT");
  const [rewardLocalHuman, setRewardLocalHuman] = useState("2500");
  const [spotsCount, setSpotsCount] = useState(10);
  const [maxPayoutsPerRecipient, setMaxPayoutsPerRecipient] = useState(1);

  const [visibility, setVisibility] = useState<CampaignVisibility>("public");
  const [inviteCode, setInviteCode] = useState("");
  const [hasDeadline, setHasDeadline] = useState(false);
  const [deadlineLocal, setDeadlineLocal] = useState("");

  // Execution state
  const [stepStatus, setStepStatus] = useState<
    "idle" | "signing" | "swapping" | "approving" | "funding" | "publishing"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [publishedResult, setPublishedResult] = useState<{
    slug: string;
    shortUrl: string;
    txHash?: string;
    visibility: CampaignVisibility;
    inviteCode?: string;
  } | null>(null);
  const [recoverableDraft, setRecoverableDraft] = useState<PendingDraft | null>(null);

  const { data: vaultData } = useQuery({
    queryKey: ["vault-address-create"],
    queryFn: async () => {
      const r = await fetch("/api/vault");
      return (await r.json()) as { deployed: boolean; address: Address | null; paused: boolean | null };
    },
  });

  const { data: corridorsData } = useQuery({
    queryKey: ["corridors-live-create"],
    queryFn: async () => {
      const r = await fetch("/api/corridors/live");
      return (await r.json()) as { corridors: CorridorLiveStatus[] };
    },
    staleTime: 30_000,
  });

  const { data: authData, refetch: refetchAuth } = useQuery({
    queryKey: ["wallet-auth-session", connectedWallet],
    queryFn: async () => {
      const r = await fetch("/api/auth/wallet");
      return (await r.json()) as { authenticated: boolean; wallet: string | null };
    },
  });

  const vaultAddress =
    vaultData?.address ??
    ((process.env.NEXT_PUBLIC_VIRE_VAULT_ADDRESS?.trim() as Address | undefined) || null);

  const fundingTokenMeta = FUNDING_TOKENS[fundingToken];

  const { data: walletReads, refetch: refetchWalletReads } = useReadContracts({
    contracts:
      connectedWallet && vaultAddress
        ? [
            {
              address: CELO_TOKENS.USDT.address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [connectedWallet],
              chainId: celo.id,
            },
            {
              address: CELO_TOKENS.USDT.address,
              abi: erc20Abi,
              functionName: "allowance",
              args: [connectedWallet, vaultAddress],
              chainId: celo.id,
            },
            {
              address: fundingTokenMeta.address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [connectedWallet],
              chainId: celo.id,
            },
          ]
        : [],
    query: { enabled: Boolean(connectedWallet && vaultAddress), staleTime: 8_000 },
  });

  const { data: celoBalance } = useBalance({
    address: connectedWallet,
    chainId: celo.id,
    query: { enabled: Boolean(connectedWallet), staleTime: 8_000 },
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as PendingDraft;
      if (
        draft?.campaignId &&
        draft.txHash &&
        (!connectedWallet || draft.creatorWallet.toLowerCase() === connectedWallet.toLowerCase())
      ) {
        setRecoverableDraft(draft);
      }
    } catch {
      // ignore invalid storage
    }
  }, [connectedWallet]);

  const liveRate = useMemo(() => {
    const live = corridorsData?.corridors?.find((c) => c.corridor === corridor);
    return live?.impliedRateLocalPerUsdt ?? CORRIDORS[corridor].typicalFiatPerUsd;
  }, [corridorsData, corridor]);

  const rewardNum = Number(rewardLocalHuman);
  const estUsdtPerPayout =
    Number.isFinite(rewardNum) && rewardNum > 0 && liveRate > 0 ? rewardNum / liveRate : 0;
  const minLocalForFloor = Math.ceil(liveRate * 1.12);
  const clearsFloor = estUsdtPerPayout >= 1.05;

  // 3% FX cushion on deposited budget so normal FX moves never clip the last spot; unused dust returns to pool
  const rawDepositUsdt = estUsdtPerPayout * Math.max(1, spotsCount) * 1.03;
  const depositUsdt = Math.max(MIN_BUDGET_USDT, Math.ceil(rawDepositUsdt * 100) / 100);
  const depositAtomic = parseUnits(depositUsdt.toFixed(6), 6);

  // Auto-computed onchain safety caps: 15% FX headroom per payout, 24h UTC circuit breaker capped at 50% of budget (min 3x per-payout)
  const maxPerPayoutUsdt = Math.max(2, Math.ceil(estUsdtPerPayout * 1.15 * 100) / 100);
  const maxPerPayoutAtomic = parseUnits(maxPerPayoutUsdt.toFixed(6), 6);
  const dailyLimitUsdt = Math.max(
    maxPerPayoutUsdt,
    Math.min(depositUsdt, Math.max(maxPerPayoutUsdt * 3, Math.ceil(depositUsdt * 0.5 * 100) / 100))
  );
  const dailyLimitAtomic = parseUnits(dailyLimitUsdt.toFixed(6), 6);

  const usdtBalanceRaw = walletReads?.[0]?.result as bigint | undefined;
  const usdtAllowanceRaw = walletReads?.[1]?.result as bigint | undefined;
  const altBalanceRaw =
    fundingToken === "USDT" ? usdtBalanceRaw : (walletReads?.[2]?.result as bigint | undefined);
  const usdtBalanceNum = usdtBalanceRaw !== undefined ? Number(formatUnits(usdtBalanceRaw, 6)) : null;
  const needsApproval = usdtAllowanceRaw !== undefined ? usdtAllowanceRaw < depositAtomic : true;
  const celoNum = celoBalance ? Number(formatUnits(celoBalance.value, 18)) : null;

  // Live Textile FX indicative conversion quote when funding with a non-USDT token
  const { data: fundingPreview, isFetching: isFetchingFundingQuote } = useQuery({
    queryKey: ["funding-fx-preview", fundingToken, depositAtomic.toString()],
    enabled: fundingToken !== "USDT",
    staleTime: 15_000,
    queryFn: async () => {
      const r = await fetch(
        `/api/funding?sellToken=${encodeURIComponent(fundingToken)}&buyUsdtAtomic=${encodeURIComponent(depositAtomic.toString())}`
      );
      return (await r.json()) as {
        status: string;
        takerPaysAtomic?: string | null;
        takerPaysFormatted?: string | null;
        reason?: string | null;
      };
    },
  });

  const isSwapFunding = fundingToken !== "USDT";
  const swapQuoteReady = !isSwapFunding || fundingPreview?.status === "preview";
  const requiredSellAtomic = isSwapFunding
    ? fundingPreview?.takerPaysAtomic
      ? (BigInt(fundingPreview.takerPaysAtomic) * 101n) / 100n // 1% safety check vs live preview drift
      : null
    : depositAtomic;
  const selectedBalanceNum =
    altBalanceRaw !== undefined ? Number(formatUnits(altBalanceRaw, fundingTokenMeta.decimals)) : null;
  const hasEnoughFundingBalance =
    altBalanceRaw === undefined
      ? true
      : requiredSellAtomic !== null
        ? altBalanceRaw >= requiredSellAtomic
        : true;

  const isSessionMatched = Boolean(
    authData?.authenticated &&
      connectedWallet &&
      authData.wallet?.toLowerCase() === connectedWallet.toLowerCase()
  );
  const wrongChain = Boolean(!isMiniPay && isConnected && connectedWallet && chainId !== celo.id);

  const parsedRequiredTokens = useMemo(
    () =>
      requiredTokensInput
        .split(/[,\n]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [requiredTokensInput]
  );

  function handleSelectCorridor(next: CorridorSymbol) {
    setCorridor(next);
    const nextRate =
      corridorsData?.corridors?.find((c) => c.corridor === next)?.impliedRateLocalPerUsdt ??
      CORRIDORS[next].typicalFiatPerUsd;
    setRewardLocalHuman(defaultRewardForCorridor(next, nextRate));
  }

  async function ensureWalletSession(): Promise<boolean> {
    if (!connectedWallet) return false;
    if (isSessionMatched) return true;
    setStepStatus("signing");
    try {
      const nonce = await requestAuthNonce(connectedWallet);
      const message = buildWalletAuthMessage(connectedWallet, nonce);
      const signature = await signMessageAsync({ message });
      const res = await fetch("/api/auth/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: connectedWallet, signature }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Wallet sign-in failed");
      await refetchAuth();
      return true;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Wallet signature cancelled");
      setStepStatus("idle");
      return false;
    }
  }

  async function publishDraftToServer(draft: PendingDraft) {
    setStepStatus("publishing");
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId: draft.campaignId,
        txHash: draft.txHash,
        slug: draft.slug,
        partnerName: draft.partnerName,
        partnerLocation: draft.partnerLocation,
        title: draft.title,
        description: draft.description,
        criteria: draft.criteria,
        deliverableType: draft.deliverableType,
        corridor: draft.corridor,
        rewardLocalHuman: draft.rewardLocalHuman,
        visibility: draft.visibility,
        verificationMode: draft.verificationMode,
        autoRules: draft.autoRules,
        inviteCode: draft.inviteCode,
        endsAt: draft.endsAt,
        maxPayoutsPerRecipient: draft.maxPayoutsPerRecipient,
      }),
    });
    const json = (await res.json()) as {
      slug?: string;
      shortUrl?: string;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(json.error || "Failed to publish campaign metadata");
    }
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
    setRecoverableDraft(null);
    setPublishedResult({
      slug: json.slug ?? draft.slug,
      shortUrl: json.shortUrl ?? `/c/${draft.slug}`,
      txHash: draft.txHash,
      visibility: draft.visibility,
      inviteCode: draft.inviteCode,
    });
    toast.success("Campaign funded and live on Celo Mainnet");
  }

  async function handleRecoverDraft() {
    if (!recoverableDraft) return;
    setErrorMsg(null);
    const authed = await ensureWalletSession();
    if (!authed) return;
    try {
      await publishDraftToServer(recoverableDraft);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Recovery failed");
    } finally {
      setStepStatus("idle");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!connectedWallet || !vaultAddress) {
      setErrorMsg("Connect your Celo wallet first.");
      return;
    }
    if (partnerName.trim().length < 2 || title.trim().length < 4) {
      setErrorMsg("Enter your brand/organization name and a clear campaign title.");
      return;
    }
    if (description.trim().length < 10 || criteria.trim().length < 10) {
      setErrorMsg("Provide a clear summary and task instructions (at least 10 characters each).");
      return;
    }
    if (!clearsFloor) {
      setErrorMsg(
        `Reward per person must be at least ${minLocalForFloor.toLocaleString("en-US")} ${corridor} (~$1.12 USDT) to clear Textile FX's $1.00 mainnet floor.`
      );
      return;
    }
    if (verificationMode === "auto" && parsedRequiredTokens.length === 0) {
      setErrorMsg(
        "Automatic verification requires at least 1 required @mention, #hashtag, link, or keyword."
      );
      return;
    }
    if (isSwapFunding && !swapQuoteReady) {
      setErrorMsg(
        `Textile FX liquidity for ${fundingToken} → USDT is currently unavailable. Choose USDT, USDC, or another supported currency.`
      );
      return;
    }
    if (!hasEnoughFundingBalance) {
      setErrorMsg(
        isSwapFunding
          ? `Your wallet needs ~${fundingPreview?.takerPaysFormatted ?? "more"} ${fundingToken} on Celo Mainnet to fund $${depositUsdt.toFixed(2)} USDT.`
          : `Your wallet needs at least $${depositUsdt.toFixed(2)} USDT on Celo Mainnet (currently $${(usdtBalanceNum ?? 0).toFixed(2)} USDT).`
      );
      return;
    }

    let endsAtMs: number | null = null;
    if (hasDeadline && deadlineLocal) {
      const parsedDate = Date.parse(deadlineLocal);
      if (!Number.isFinite(parsedDate) || parsedDate <= Date.now() + 5 * 60 * 1000) {
        setErrorMsg("End date must be in the future.");
        return;
      }
      endsAtMs = parsedDate;
    }

    // Validate reward atomic parsing before any onchain call
    try {
      const atomic = parseTokenAmount(rewardLocalHuman.trim(), corridor);
      if (atomic <= 0n) throw new Error();
    } catch {
      setErrorMsg("Enter a valid numeric local currency reward amount.");
      return;
    }

    // 1. Ensure signed wallet session cookie
    const authed = await ensureWalletSession();
    if (!authed) return;

    // 1b. If funding with USDC / CELO / local currency, execute firm Textile FX exact-output swap into USDT first
    let activeRfqId: string | null = null;
    try {
      if (isSwapFunding) {
        setStepStatus("swapping");
        const quoteRes = await fetch("/api/funding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "request",
            sellToken: fundingToken,
            buyUsdtAtomic: depositAtomic.toString(),
          }),
        });
        const quoteJson = (await quoteRes.json()) as {
          rfqId?: string;
          takerPaysAtomic?: string;
          takerPaysFormatted?: string;
          buyAmountAtomic?: string;
          expiresAt?: string;
          spender?: Address;
          transactions?: {
            approval: { to: Address; data: Hex; value: string; chainId: number };
            swap: { to: Address; data: Hex; value: string; chainId: number };
          };
          error?: string;
        };
        if (!quoteRes.ok || !quoteJson.rfqId || !quoteJson.transactions?.swap || !quoteJson.spender) {
          throw new Error(quoteJson.error || `Failed to lock ${fundingToken} → USDT Textile FX quote.`);
        }
        if (
          !isAllowedTextileTarget(quoteJson.spender) ||
          !isAllowedTextileTarget(quoteJson.transactions.swap.to) ||
          quoteJson.transactions.approval.to.toLowerCase() !== fundingTokenMeta.address.toLowerCase() ||
          quoteJson.transactions.approval.value !== "0" ||
          quoteJson.transactions.swap.value !== "0" ||
          BigInt(quoteJson.buyAmountAtomic ?? "0") !== depositAtomic
        ) {
          throw new Error("Blocked unexpected swap contract target or output amount on funding quote.");
        }
        activeRfqId = quoteJson.rfqId;

        // Check existing ERC-20 allowance for Textile spender before sending approval
        const sellAllowance = publicClient
          ? await publicClient.readContract({
              address: fundingTokenMeta.address,
              abi: erc20Abi,
              functionName: "allowance",
              args: [connectedWallet, quoteJson.spender],
            })
          : 0n;

        if (sellAllowance < BigInt(quoteJson.takerPaysAtomic ?? "0")) {
          toast.message(`Approve ${quoteJson.takerPaysFormatted ?? ""} ${fundingToken} for Textile FX swap…`);
          const swapApproveHash = await sendTransactionAsync({
            to: quoteJson.transactions.approval.to,
            data: quoteJson.transactions.approval.data,
            value: BigInt(quoteJson.transactions.approval.value || "0"),
            chainId: celo.id,
          });
          if (publicClient) {
            const appReceipt = await publicClient.waitForTransactionReceipt({ hash: swapApproveHash });
            if (appReceipt.status !== "success") {
              throw new Error(`${fundingToken} approval reverted on Celo.`);
            }
          }
        }

        if (quoteJson.expiresAt && Date.now() >= Date.parse(quoteJson.expiresAt) - 3000) {
          throw new Error("Textile FX quote expired during approval. Click Launch again for a fresh quote.");
        }

        toast.message(`Swapping ${quoteJson.takerPaysFormatted ?? ""} ${fundingToken} → $${depositUsdt.toFixed(2)} USDT via Textile FX…`);
        const swapTxHash = await sendTransactionAsync({
          to: quoteJson.transactions.swap.to,
          data: quoteJson.transactions.swap.data,
          value: BigInt(quoteJson.transactions.swap.value || "0"),
          chainId: celo.id,
        });

        // Report txHash immediately while confirming onchain
        const submitPromise = fetch("/api/funding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "submit", rfqId: quoteJson.rfqId, txHash: swapTxHash }),
        }).catch(() => {});

        if (publicClient) {
          const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapTxHash });
          if (swapReceipt.status !== "success") {
            throw new Error(`Textile FX ${fundingToken} → USDT swap reverted on Celo.`);
          }
        }
        await submitPromise;
        activeRfqId = null;
        toast.success(`Converted ${fundingToken} → $${depositUsdt.toFixed(2)} USDT on Celo`);
        await refetchWalletReads();
      }

      // 2. Approve USDT to VireVault v2 if needed
      if (needsApproval) {
        setStepStatus("approving");
        const approveHash = await writeContractAsync({
          address: CELO_TOKENS.USDT.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [vaultAddress, depositAtomic],
          chainId: celo.id,
        });
        toast.message("Confirming USDT approval on Celo…");
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        await refetchWalletReads();
      }

      // 3. Build deterministic non-frontrunnable campaignId bound to creator wallet + slug
      const slug = slugifyTitle(title.trim(), visibility);
      const campaignId = keccak256(
        stringToHex(`vire:campaign:${connectedWallet.toLowerCase()}:${slug}`)
      );
      const deliverableType: DeliverableType =
        verificationMode === "auto"
          ? autoPlatform === "github"
            ? "qa_bug"
            : autoPlatform === "x"
              ? "promo_post"
              : "referral"
          : "promo_post";

      const draft: PendingDraft = {
        campaignId,
        slug,
        partnerName: partnerName.trim(),
        partnerLocation: partnerLocation.trim() || "Global",
        title: title.trim(),
        description: description.trim(),
        criteria: criteria.trim(),
        deliverableType,
        corridor,
        rewardLocalHuman: rewardLocalHuman.trim(),
        visibility,
        verificationMode,
        autoRules:
          verificationMode === "auto"
            ? {
                platform: autoPlatform,
                requiredTokens: parsedRequiredTokens,
                minAuthorFollowers: autoPlatform === "x" ? minFollowers : 0,
                minAccountAgeDays: autoPlatform === "x" ? minAccountAgeDays : 0,
              }
            : null,
        inviteCode: visibility === "unlisted" && inviteCode.trim() ? inviteCode.trim() : undefined,
        endsAt: endsAtMs,
        maxPayoutsPerRecipient,
        creatorWallet: connectedWallet.toLowerCase(),
      };

      // Persist draft BEFORE onchain tx so a dropped connection can never orphan funds
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      } catch {
        // ignore storage quota errors
      }

      // 4. Fund campaign directly on VireVault v2 (creator = msg.sender)
      setStepStatus("funding");
      const createHash = await writeContractAsync({
        address: vaultAddress,
        abi: VIRE_VAULT_ABI,
        functionName: "createCampaign",
        args: [
          campaignId,
          depositAtomic,
          maxPerPayoutAtomic,
          dailyLimitAtomic,
          maxPayoutsPerRecipient,
          true,
        ],
        chainId: celo.id,
      });

      draft.txHash = createHash;
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      } catch {
        // ignore
      }

      toast.message("Confirming campaign deposit on Celo Mainnet…");
      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
        if (receipt.status !== "success") {
          throw new Error("Campaign deposit transaction reverted on Celo.");
        }
      }

      // 5. Publish metadata to Vire DB (server verifies onchain creator + balance)
      await publishDraftToServer(draft);
    } catch (err) {
      if (activeRfqId) {
        void fetch("/api/funding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel", rfqId: activeRfqId }),
        }).catch(() => {});
      }
      const msg = err instanceof Error ? err.message : "Transaction cancelled or failed.";
      setErrorMsg(msg.slice(0, 240));
      toast.error("Campaign launch interrupted");
    } finally {
      setStepStatus("idle");
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "https://usevire.xyz";

  if (publishedResult) {
    const fullShareUrl = `${origin}${publishedResult.shortUrl}`;
    return (
      <div className="mx-auto max-w-2xl space-y-6 py-4">
        <Card className="vire-enter overflow-hidden">
          <div className="border-b border-black/[0.06] bg-[#FAFAFB] px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#DCFCE7] text-[#15803D]">
                <CheckCircle weight="fill" className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-[20px] font-medium tracking-[-0.02em] text-[#0A0A0C]">
                  Campaign funded &amp; live
                </h1>
                <p className="text-[13px] text-[#71717A]">
                  {publishedResult.visibility === "unlisted"
                    ? "Link-only campaign — hidden from the public directory."
                    : "Listed live on Vire Campaigns and ready for verified claims."}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-5 p-6">
            <div className="vire-well space-y-2 rounded-xl p-4">
              <div className="flex items-center justify-between text-[11.5px] font-medium text-[#71717A]">
                <span>Shareable claim link</span>
                <CopyButton value={fullShareUrl} label="Copy link" toastMessage="Claim link copied" />
              </div>
              <p className="break-all font-mono text-[13px] font-medium text-[#0A0A0C]">
                {fullShareUrl}
              </p>
              {publishedResult.inviteCode && (
                <p className="pt-1 font-mono text-[11.5px] text-[#52525B]">
                  Invite code required: <span className="font-semibold text-[#0A0A0C]">{publishedResult.inviteCode}</span>
                </p>
              )}
            </div>

            {publishedResult.txHash && (
              <div className="flex items-center justify-between text-[12.5px] text-[#71717A]">
                <span>Onchain vault deposit</span>
                <a
                  href={celoscanTxUrl(publishedResult.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[#0A0A0C] underline underline-offset-2"
                >
                  {truncateMiddle(publishedResult.txHash, 10, 6)}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <Link href={publishedResult.shortUrl} className={buttonVariants({ variant: "primary", size: "md" })}>
                Preview claim page
                <ArrowRight weight="bold" className="h-3.5 w-3.5" />
              </Link>
              <Link href="/manage" className={buttonVariants({ variant: "secondary", size: "md" })}>
                Open Owner Workspace
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="vire-enter flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-[28px] font-medium tracking-[-0.03em] text-[#0A0A0C]">
            Launch a campaign
          </h1>
          <p className="mt-1 max-w-[60ch] text-[14px] leading-relaxed text-[#71717A]">
            Deposit USDT into your own non-custodial vault pool, set automatic or manual review,
            and pay contributors in exact local currency on Celo.
          </p>
        </div>
        <Link href="/manage" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          My campaigns
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {recoverableDraft && (
        <Card className="flex flex-col items-start justify-between gap-4 border-[#0A0A0C]/15 bg-white p-5 sm:flex-row sm:items-center">
          <div>
            <p className="text-[13.5px] font-medium text-[#0A0A0C]">
              Unfinished funded campaign detected: &ldquo;{recoverableDraft.title}&rdquo;
            </p>
            <p className="mt-0.5 text-[12.5px] text-[#71717A]">
              Your onchain deposit already succeeded. Click below to finish publishing it to Vire.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={stepStatus !== "idle"}
            onClick={handleRecoverDraft}
          >
            Finish publishing
          </Button>
        </Card>
      )}

      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-12 lg:items-start">
        {/* Left: Campaign Studio Configuration */}
        <div className="space-y-6 lg:col-span-7">
          {/* Section 1: Campaign Details */}
          <Card className="vire-enter overflow-hidden">
            <div className="border-b border-black/[0.06] bg-[#FAFAFB] px-4 py-3.5 sm:px-6">
              <h2 className="text-[13.5px] font-medium text-[#0A0A0C]">1. Campaign details</h2>
            </div>
            <div className="space-y-4 p-4 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium text-[#3F3F46]">Brand or organization</span>
                  <input
                    type="text"
                    required
                    value={partnerName}
                    onChange={(e) => setPartnerName(e.target.value)}
                    placeholder="e.g. Acme Studio"
                    className="h-11 w-full rounded-xl bg-white px-3.5 text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.1] placeholder:text-[#A1A1AA] focus:outline-none focus:ring-2 focus:ring-[#0A0A0C]/25 sm:h-10 sm:text-[13.5px]"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium text-[#3F3F46]">Location (optional)</span>
                  <input
                    type="text"
                    value={partnerLocation}
                    onChange={(e) => setPartnerLocation(e.target.value)}
                    placeholder="e.g. Lagos, Nigeria · Global"
                    className="h-11 w-full rounded-xl bg-white px-3.5 text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.1] placeholder:text-[#A1A1AA] focus:outline-none focus:ring-2 focus:ring-[#0A0A0C]/25 sm:h-10 sm:text-[13.5px]"
                  />
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium text-[#3F3F46]">Campaign title</span>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Launch Week Product Review Sprint"
                  className="h-11 w-full rounded-xl bg-white px-3.5 text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.1] placeholder:text-[#A1A1AA] focus:outline-none focus:ring-2 focus:ring-[#0A0A0C]/25 sm:h-10 sm:text-[13.5px]"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium text-[#3F3F46]">Short summary</span>
                <textarea
                  rows={2}
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="One or two sentences explaining the campaign shown on the listing card."
                  className="w-full rounded-xl bg-white px-3.5 py-2.5 text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.1] placeholder:text-[#A1A1AA] focus:outline-none focus:ring-2 focus:ring-[#0A0A0C]/25 sm:text-[13.5px]"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium text-[#3F3F46]">
                  Exact work instructions (locked once published)
                </span>
                <textarea
                  rows={3}
                  required
                  value={criteria}
                  onChange={(e) => setCriteria(e.target.value)}
                  placeholder="Spell out exactly what a contributor must submit to earn the payout (links, tags, format, or proof)."
                  className="w-full rounded-xl bg-white px-3.5 py-2.5 text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.1] placeholder:text-[#A1A1AA] focus:outline-none focus:ring-2 focus:ring-[#0A0A0C]/25 sm:text-[13.5px]"
                />
              </label>
            </div>
          </Card>

          {/* Section 2: Verification Mode */}
          <Card className="vire-enter vire-delay-1 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] bg-[#FAFAFB] px-4 py-3.5 sm:px-6">
              <h2 className="text-[13.5px] font-medium text-[#0A0A0C]">2. Verification mode</h2>
              <SegmentedTabs
                value={verificationMode}
                onChange={setVerificationMode}
                options={[
                  { value: "auto", label: "Automatic", icon: <Sparkle className="h-3.5 w-3.5" /> },
                  { value: "manual", label: "Manual review", icon: <UserCheck className="h-3.5 w-3.5" /> },
                ]}
              />
            </div>

            <div className="space-y-4 p-4 sm:p-6">
              {verificationMode === "auto" ? (
                <>
                  <p className="text-[13px] leading-relaxed text-[#52525B]">
                    Vire automatically fetches the live link, checks authorship &amp; anti-bot rules,
                    and pays contributors instantly in local currency — zero manual review.
                  </p>

                  <div className="space-y-1.5">
                    <span className="text-[12px] font-medium text-[#3F3F46]">Platform</span>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: "x", label: "X post" },
                          { id: "github", label: "GitHub PR" },
                          { id: "web", label: "Web URL" },
                        ] as const
                      ).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setAutoPlatform(p.id)}
                          className={cn(
                            "h-10 rounded-xl px-2.5 text-center text-[12.5px] font-medium transition-all sm:px-3",
                            autoPlatform === p.id
                              ? "bg-[#0A0A0C] text-white"
                              : "bg-[#FAFAFB] text-[#3F3F46] ring-1 ring-black/[0.08] hover:bg-white"
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="text-[12px] font-medium text-[#3F3F46]">
                      Required mentions, links, hashtags, or keywords (comma-separated)
                    </span>
                    <input
                      type="text"
                      required
                      value={requiredTokensInput}
                      onChange={(e) => setRequiredTokensInput(e.target.value)}
                      placeholder={
                        autoPlatform === "x"
                          ? "@handle, site.com, #Tag"
                          : autoPlatform === "github"
                            ? "org/repo, bug"
                            : "yoursite.com, review"
                      }
                      className="h-11 w-full rounded-xl bg-white px-3.5 font-mono text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.1] placeholder:text-[#A1A1AA] focus:outline-none focus:ring-2 focus:ring-[#0A0A0C]/25 sm:h-10 sm:text-[12.5px]"
                    />
                    {parsedRequiredTokens.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {parsedRequiredTokens.map((tok) => (
                          <Badge key={tok} tone="outline" className="font-mono text-[11px]">
                            Must include: {tok}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </label>

                  {autoPlatform === "x" && (
                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                      <label className="block space-y-1.5">
                        <span className="text-[12px] font-medium text-[#3F3F46]">
                          Min followers
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={100000}
                          value={minFollowers}
                          onChange={(e) => setMinFollowers(Math.max(0, Number(e.target.value) || 0))}
                          className="h-11 w-full rounded-xl bg-white px-3.5 font-mono text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.1] sm:h-10 sm:text-[13px]"
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className="text-[12px] font-medium text-[#3F3F46]">
                          Min age (days)
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={3650}
                          value={minAccountAgeDays}
                          onChange={(e) =>
                            setMinAccountAgeDays(Math.max(0, Number(e.target.value) || 0))
                          }
                          className="h-11 w-full rounded-xl bg-white px-3.5 font-mono text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.1] sm:h-10 sm:text-[13px]"
                        />
                      </label>
                    </div>
                  )}
                </>
              ) : (
                <div className="vire-well space-y-2 rounded-xl p-4">
                  <p className="text-[13px] font-medium text-[#0A0A0C]">
                    Works for any digital work — videos, designs, articles, translations, or QA
                  </p>
                  <p className="text-[12.5px] leading-relaxed text-[#52525B]">
                    Contributors submit links on your FCFS claim page (protected by wallet sign-in,
                    duplicate-link blocking, and 1-claim-per-person locks). Submissions appear in
                    your <span className="font-medium text-[#0A0A0C]">My campaigns</span> queue —
                    click <span className="font-medium text-[#0A0A0C]">Approve &amp; Pay</span> and
                    Vire automatically swaps USDT and pays exact local currency on Celo.
                  </p>
                </div>
              )}
            </div>
          </Card>

          {/* Section 3: Currency, Reward & Pool */}
          <Card className="vire-enter vire-delay-2 overflow-hidden">
            <div className="border-b border-black/[0.06] bg-[#FAFAFB] px-4 py-3.5 sm:px-6">
              <h2 className="text-[13.5px] font-medium text-[#0A0A0C]">3. Payout currency &amp; budget</h2>
            </div>
            <div className="space-y-5 p-4 sm:p-6">
              <div className="space-y-2">
                <span className="text-[12px] font-medium text-[#3F3F46]">Local payout currency</span>
                <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                  {PRIMARY_CORRIDORS.map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => handleSelectCorridor(sym)}
                      className={cn(
                        "inline-flex h-10 items-center justify-center gap-2 rounded-full px-3 text-[13px] font-medium transition-all sm:h-9 sm:px-3.5",
                        corridor === sym
                          ? "bg-[#0A0A0C] text-white"
                          : "bg-white text-[#3F3F46] ring-1 ring-black/[0.1] hover:bg-[#FAFAFB]"
                      )}
                    >
                      <TokenIcon symbol={sym} size={18} />
                      <span>{sym}</span>
                    </button>
                  ))}
                </div>
                <p className="font-mono text-[11.5px] text-[#71717A] tabular-nums">
                  Live Textile FX rate: 1 USDT ≈ {liveRate.toLocaleString("en-US", { maximumFractionDigits: 2 })} {corridor} ({CORRIDORS[corridor].countryName})
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium text-[#3F3F46]">
                    Payout per person ({corridor})
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={rewardLocalHuman}
                    onChange={(e) => setRewardLocalHuman(e.target.value)}
                    className="h-11 w-full rounded-xl bg-white px-3.5 font-mono text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.1] sm:h-10 sm:text-[13.5px]"
                  />
                  <span
                    className={cn(
                      "block font-mono text-[11px] tabular-nums",
                      clearsFloor ? "text-[#71717A]" : "text-[#DC2626]"
                    )}
                  >
                    ≈ ${estUsdtPerPayout.toFixed(2)} USDT {clearsFloor ? "" : `(min ${minLocalForFloor.toLocaleString("en-US")} ${corridor})`}
                  </span>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium text-[#3F3F46]">Number of spots</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    required
                    value={spotsCount}
                    onChange={(e) => setSpotsCount(Math.max(1, Number(e.target.value) || 1))}
                    className="h-11 w-full rounded-xl bg-white px-3.5 font-mono text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.1] sm:h-10 sm:text-[13.5px]"
                  />
                  <span className="block font-mono text-[11px] text-[#71717A]">
                    Min ${MIN_BUDGET_USDT} USDT pool
                  </span>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium text-[#3F3F46]">Claims per person</span>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    required
                    value={maxPayoutsPerRecipient}
                    onChange={(e) =>
                      setMaxPayoutsPerRecipient(Math.min(5, Math.max(1, Number(e.target.value) || 1)))
                    }
                    className="h-11 w-full rounded-xl bg-white px-3.5 font-mono text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.1] sm:h-10 sm:text-[13.5px]"
                  />
                  <span className="block font-mono text-[11px] text-[#71717A]">
                    {maxPayoutsPerRecipient === 1 ? "Strict FCFS (recommended)" : `Up to ${maxPayoutsPerRecipient}× repeat`}
                  </span>
                </label>
              </div>
            </div>
          </Card>

          {/* Section 4: Access & Schedule */}
          <Card className="vire-enter vire-delay-3 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] bg-[#FAFAFB] px-4 py-3.5 sm:px-6">
              <h2 className="text-[13.5px] font-medium text-[#0A0A0C]">4. Visibility &amp; deadline</h2>
              <SegmentedTabs
                value={visibility}
                onChange={setVisibility}
                options={[
                  { value: "public", label: "Public", icon: <Globe className="h-3.5 w-3.5" /> },
                  { value: "unlisted", label: "Link-only", icon: <LinkSimple className="h-3.5 w-3.5" /> },
                ]}
              />
            </div>

            <div className="space-y-4 p-4 sm:p-6">
              <p className="text-[12.5px] text-[#52525B]">
                {visibility === "public"
                  ? "Listed publicly on usevire.xyz/campaigns so any eligible contributor can discover and claim."
                  : "Hidden from the public directory. Only people you send the direct unguessable link to can open and submit work."}
              </p>

              {visibility === "unlisted" && (
                <label className="block space-y-1.5">
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#3F3F46]">
                    <LockSimple className="h-3.5 w-3.5 text-[#71717A]" />
                    Optional invite passcode
                  </span>
                  <input
                    type="text"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="Optional passcode, e.g. TEAM-LAGOS"
                    className="h-11 w-full rounded-xl bg-white px-3.5 font-mono text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.1] placeholder:text-[#A1A1AA] sm:h-10 sm:text-[13px]"
                  />
                </label>
              )}

              <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-[#3F3F46]">
                  <input
                    type="checkbox"
                    checked={hasDeadline}
                    onChange={(e) => setHasDeadline(e.target.checked)}
                    className="h-4 w-4 rounded border-black/20 accent-[#0A0A0C]"
                  />
                  <span>Set an end date (optional)</span>
                </label>

                {hasDeadline && (
                  <input
                    type="datetime-local"
                    required
                    value={deadlineLocal}
                    onChange={(e) => setDeadlineLocal(e.target.value)}
                    className="h-10 w-full rounded-xl bg-white px-3 font-mono text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.1] sm:h-9 sm:w-auto sm:text-[12.5px]"
                  />
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Right: Sticky Non-Custodial Funding Summary */}
        <div className="space-y-4 lg:sticky lg:top-24 lg:col-span-5">
          <Card className="vire-enter overflow-hidden">
            <div className="flex items-center justify-between border-b border-black/[0.06] bg-[#FAFAFB] px-4 py-4 sm:px-6">
              <div className="flex items-center gap-2">
                <TokenIcon symbol="USDT" size={20} showChainBadge />
                <span className="text-[13.5px] font-medium text-[#0A0A0C]">Funding summary</span>
              </div>
              <Badge tone="outline">0% Vire fee</Badge>
            </div>

            <div className="space-y-5 p-4 sm:p-6">
              {/* Fund with selector (USDT direct OR any Textile FX deep-liquidity Celo token) */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-1 text-[11.5px]">
                  <span className="font-medium text-[#52525B]">Fund with</span>
                  <span className="font-mono text-[11px] text-[#71717A]">
                    {isSwapFunding ? "Auto-swapped → USDT via Textile FX" : "Direct USDT vault deposit"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-1.5">
                  {FUNDING_TOKEN_LIST.map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => setFundingToken(sym)}
                      className={cn(
                        "inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-2 text-[12.5px] font-medium transition-all sm:h-9 sm:text-[12px]",
                        fundingToken === sym
                          ? "bg-[#0A0A0C] text-white"
                          : "bg-[#FAFAFB] text-[#3F3F46] ring-1 ring-black/[0.08] hover:bg-white"
                      )}
                    >
                      <TokenIcon symbol={sym} size={15} />
                      <span>{sym}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Big deposit figure */}
              <div className="vire-well space-y-2.5 rounded-xl px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="block text-[11.5px] text-[#71717A]">Vault pool (USDT)</span>
                    <span className="font-mono text-[22px] font-medium tracking-[-0.03em] text-[#0A0A0C] tabular-nums sm:text-[24px]">
                      ${depositUsdt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="block text-[11.5px] text-[#71717A]">Exact payout</span>
                    <span className="inline-flex items-center gap-1.5 font-mono text-[14px] font-medium text-[#0A0A0C] tabular-nums">
                      <TokenIcon symbol={corridor} size={16} />
                      {Number.isFinite(rewardNum) ? rewardNum.toLocaleString("en-US") : "0"} {corridor}
                    </span>
                  </div>
                </div>

                {isSwapFunding && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] pt-2.5 font-mono text-[11.5px]">
                    <span className="text-[#71717A]">Est. you pay ({fundingToken})</span>
                    {isFetchingFundingQuote ? (
                      <span className="text-[#71717A]">Quoting…</span>
                    ) : swapQuoteReady && fundingPreview?.takerPaysFormatted ? (
                      <span className="font-medium text-[#0A0A0C] tabular-nums">
                        ≈ {fundingPreview.takerPaysFormatted} {fundingToken}
                      </span>
                    ) : (
                      <span className="text-[#DC2626]">No live quote</span>
                    )}
                  </div>
                )}
              </div>

              {isSwapFunding && fundingToken === corridor && (
                <p className="text-[11.5px] leading-relaxed text-[#71717A]">
                  <span className="font-medium text-[#0A0A0C]">Note:</span> Funding with {fundingToken} converts{" "}
                  {fundingToken} → USDT in the vault and USDT → {corridor} on payout. Funding with USDT or USDC avoids converting twice.
                </p>
              )}

              <dl className="divide-y divide-black/[0.055] font-mono text-[12px]">
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="shrink-0 text-[#71717A]">Estimated spots</dt>
                  <dd className="text-right font-medium text-[#0A0A0C] tabular-nums">
                    ~{estUsdtPerPayout > 0 ? Math.floor(depositUsdt / (estUsdtPerPayout * 1.03)) : 0} payouts
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="shrink-0 text-[#71717A]">Per-payout cap</dt>
                  <dd className="text-right text-[#0A0A0C] tabular-nums">
                    ${maxPerPayoutUsdt.toFixed(2)} USDT (+15%)
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="shrink-0 text-[#71717A]">24h daily cap</dt>
                  <dd className="text-right text-[#0A0A0C] tabular-nums">
                    ${dailyLimitUsdt.toFixed(2)} USDT
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="shrink-0 text-[#71717A]">Verification</dt>
                  <dd className="text-right text-[#0A0A0C]">
                    {verificationMode === "auto" ? `Auto (${autoPlatform.toUpperCase()})` : "Manual review"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="shrink-0 text-[#71717A]">Visibility</dt>
                  <dd className="text-right text-[#0A0A0C]">
                    {visibility === "public"
                      ? "Public directory"
                      : inviteCode.trim()
                        ? "Link-only + passcode"
                        : "Link-only"}
                  </dd>
                </div>
              </dl>

              {/* Live Wallet Balance Pre-Check */}
              {connectedWallet && (
                <div className="space-y-2 rounded-xl bg-[#FAFAFB] p-3.5 ring-1 ring-black/[0.06]">
                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="font-medium text-[#52525B]">Your Celo wallet</span>
                    <CopyButton
                      value={connectedWallet}
                      label={truncateMiddle(connectedWallet, 6, 4)}
                      toastMessage="Celo deposit address copied"
                    />
                  </div>
                  <div className="flex items-center justify-between font-mono text-[12px] tabular-nums">
                    <span className="text-[#71717A]">{fundingToken} balance</span>
                    <span className={cn("font-medium", hasEnoughFundingBalance ? "text-[#0A0A0C]" : "text-[#DC2626]")}>
                      {selectedBalanceNum !== null
                        ? `${selectedBalanceNum.toLocaleString("en-US", { maximumFractionDigits: fundingToken === "IDRX" ? 2 : 4 })} ${fundingToken}`
                        : "Checking…"}
                    </span>
                  </div>
                  {fundingToken !== "CELO" && (
                    <div className="flex items-center justify-between font-mono text-[12px] tabular-nums">
                      <span className="text-[#71717A]">CELO gas</span>
                      <span className="text-[#3F3F46]">
                        {celoNum !== null ? `${celoNum.toFixed(4)} CELO` : "Checking…"}
                      </span>
                    </div>
                  )}
                  {isSwapFunding && !isFetchingFundingQuote && !swapQuoteReady && (
                    <p className="pt-1 text-[11.5px] leading-snug text-[#DC2626]">
                      Textile FX liquidity for {fundingToken} → USDT is currently offline. Pick USDT, USDC, or another active token.
                    </p>
                  )}
                  {!hasEnoughFundingBalance && (
                    <p className="pt-1 text-[11.5px] leading-snug text-[#DC2626]">
                      {isSwapFunding
                        ? `Your wallet needs ~${fundingPreview?.takerPaysFormatted ?? "more"} ${fundingToken} on Celo network to fund this pool.`
                        : `Deposit at least $${(depositUsdt - (usdtBalanceNum ?? 0)).toFixed(2)} more USDT on Celo network to your address above.`}
                    </p>
                  )}
                  {!isMiniPay && celoNum !== null && celoNum < 0.003 && (
                    <p className="pt-0.5 text-[11.5px] leading-snug text-[#71717A]">
                      Tip: keep ~0.01 CELO for transaction gas (MiniPay pays gas in USDT natively).
                    </p>
                  )}
                </div>
              )}

              {errorMsg && (
                <div className="flex items-start gap-2 rounded-xl bg-[#FEF2F2] p-3 text-[12.5px] text-[#B91C1C] ring-1 ring-[#DC2626]/20">
                  <Warning weight="fill" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Primary Action CTA */}
              {!connectedWallet ? (
                <SignInTriggerButton label="Sign in to launch campaign" />
              ) : wrongChain ? (
                <Button
                  type="button"
                  size="lg"
                  variant="outlineStrong"
                  className="w-full"
                  onClick={() => switchChain({ chainId: celo.id })}
                >
                  Switch network to Celo Mainnet
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="lg"
                  variant="primary"
                  className="w-full"
                  disabled={
                    stepStatus !== "idle" ||
                    !hasEnoughFundingBalance ||
                    !swapQuoteReady ||
                    !clearsFloor ||
                    Boolean(vaultData?.paused)
                  }
                >
                  {stepStatus !== "idle" ? (
                    <>
                      <CircleNotch className="h-4 w-4 animate-spin" />
                      {stepStatus === "signing"
                        ? "Confirm wallet sign-in…"
                        : stepStatus === "swapping"
                          ? `Swapping ${fundingToken} → USDT via Textile FX…`
                          : stepStatus === "approving"
                            ? "Approving USDT on Celo…"
                            : stepStatus === "funding"
                              ? "Depositing into VireVault…"
                              : "Publishing campaign…"}
                    </>
                  ) : isSwapFunding ? (
                    <>
                      Swap {fundingToken} &amp; Fund (${depositUsdt.toFixed(2)} USDT)
                      <ArrowRight weight="bold" className="h-4 w-4" />
                    </>
                  ) : needsApproval ? (
                    <>
                      Approve &amp; Fund ${depositUsdt.toFixed(2)} USDT
                      <ArrowRight weight="bold" className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      Fund &amp; Publish (${depositUsdt.toFixed(2)} USDT)
                      <ArrowRight weight="bold" className="h-4 w-4" />
                    </>
                  )}
                </Button>
              )}

              <p className="text-[11.5px] leading-relaxed text-[#71717A]">
                <span className="font-medium text-[#0A0A0C]">Note:</span> Only your wallet can
                pause, top up, or withdraw unspent USDT at any time. Includes a 3% FX cushion;
                unused dust refunds back to your pool on every payout.
              </p>
            </div>
          </Card>
        </div>
      </form>
    </div>
  );
}
