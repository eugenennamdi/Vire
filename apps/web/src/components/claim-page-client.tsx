"use client";

import {
  ArrowRight,
  ArrowUpRight,
  ArrowsLeftRight,
  Check,
  CircleNotch,
  Clock,
  GithubLogo,
  LockSimple,
  PaperPlaneTilt,
  Signature,
  SlidersHorizontal,
  Ticket,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  useIdentityToken,
  usePrivy,
  useSignMessage as usePrivySignMessage,
} from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import {
  CELO_CONTRACTS,
  CELO_TOKENS,
  celoscanTxUrl,
  type BuyPaymentReceipt,
  type CorridorSymbol,
  type OfframpPackage,
  type PolicyGateDecision,
  type VerificationVerdict,
} from "@vire/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { erc20Abi, formatUnits, getAddress, isAddress, parseUnits, zeroHash, type Address } from "viem";
import {
  useAccount,
  useConnect,
  usePublicClient,
  useSendTransaction,
  useSignMessage,
  useWriteContract,
} from "wagmi";
import { celo } from "wagmi/chains";
import { useIsMiniPay } from "@/components/providers";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfettiBurst } from "@/components/ui/confetti-burst";
import { CopyButton } from "@/components/ui/copy-button";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { TokenIcon } from "@/components/ui/token-icon";
import {
  executeConvertToUsdt,
  fetchConvertToUsdtPreview,
  formatWalletTxError,
  isConvertibleLocalToken,
  type ConvertToUsdtPreview,
} from "@/lib/convert-to-usdt";
import {
  buildIdentityBindMessage,
  buildWalletAuthMessage,
  requestAuthNonce,
} from "@/lib/session-client";
import { cn, truncateMiddle } from "@/lib/utils";

const ERC8004_GIVE_FEEDBACK_ABI = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    outputs: [],
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
  },
] as const;

interface CampaignItem {
  slug: string;
  title: string;
  corridor: string;
  partnerName: string;
  deliverableType: string;
  verificationMode?: "auto" | "manual" | "voucher";
  visibility?: "public" | "unlisted";
  requiresInviteCode?: boolean;
  verifiedGmvLocal?: number;
  vouchersClaimed?: number;
  endsAt?: number | null;
  isExpired?: boolean;
  isOwner?: boolean;
  creatorWallet?: string | null;
  approvalStats?: { approved: number; rejected: number; pending: number };
  mySubmission?: {
    id: string;
    deliverableUrl: string;
    status: string;
    reviewNote: string | null;
    aiReason: string | null;
    createdAt: number;
    updatedAt: number;
    settlement?: {
      localAmountFormatted: string;
      corridor: string;
      payoutTxHash: string;
      settledAt: number;
    } | null;
  } | null;
  maxPayoutsPerRecipient: number;
  spotsRemaining?: number;
  stages: Array<{
    stageIndex: number;
    title: string;
    instructions: string;
    rewardLocalFormatted: string;
  }>;
}

interface SubmissionResponse {
  submissionId?: string;
  deliverableHash?: string;
  status: string;
  message?: string;
  verdict?: VerificationVerdict;
  policyDecision?: PolicyGateDecision;
  buyReceipts?: BuyPaymentReceipt[];
  txHashes?: {
    vaultRelease: string;
    textileSwap: string;
    localPayout: string;
    vaultReceipt: string;
    gasDrip?: string;
  };
  refundTxHash?: string;
  offramp?: OfframpPackage;
  error?: string;
}

const PRIVY_ENABLED = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim());

interface PrivyBridgeProps {
  forcedSlug?: string;
  onSignIn?: () => void;
  privyWalletAddress?: Address;
  privyTwitterHandle?: string | null;
  privyGithubHandle?: string | null;
  privyIdentityToken?: string | null;
  privySignMessage?: (message: string) => Promise<string>;
}

function ClaimFlowInner({
  forcedSlug,
  onSignIn,
  privyWalletAddress,
  privyTwitterHandle,
  privyGithubHandle,
  privyIdentityToken,
  privySignMessage,
}: PrivyBridgeProps) {
  const searchParams = useSearchParams();
  const initialSlug = forcedSlug || searchParams.get("campaign") || "";
  const initialVoucher = searchParams.get("voucher")?.trim() || "";
  const initialStageParam = Number(searchParams.get("stage") || "1");
  const validInitialStage =
    Number.isInteger(initialStageParam) && initialStageParam >= 1 && initialStageParam <= 3
      ? initialStageParam
      : 1;

  const isMiniPay = useIsMiniPay();
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync, isPending: isRatingTxPending } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient({ chainId: celo.id });

  const address = wagmiAddress ?? privyWalletAddress;
  const isSignedIn = Boolean(address);
  const triggerSignIn =
    onSignIn ??
    (() => {
      const connector = connectors[0];
      if (connector) connect({ connector });
    });

  const [selectedSlug, setSelectedSlug] = useState(initialSlug);
  const [stageIndex, setStageIndex] = useState(validInitialStage);
  const [provider, setProvider] = useState<"github" | "x" | "signed_proof">("x");
  const [handle, setHandle] = useState("");
  const [deliverableUrl, setDeliverableUrl] = useState("");
  const [voucherCode, setVoucherCode] = useState(initialVoucher);
  const [deliverableNotes, setDeliverableNotes] = useState("");

  useEffect(() => {
    if (initialVoucher) {
      setVoucherCode(initialVoucher.toUpperCase());
    }
  }, [initialVoucher]);
  const [referralCode, setReferralCode] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [bindError, setBindError] = useState<string | null>(null);
  const [isBinding, setIsBinding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<SubmissionResponse | null>(null);
  const [confettiKey, setConfettiKey] = useState<string | null>(null);
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertAmount, setConvertAmount] = useState("");
  const [convertSendTo, setConvertSendTo] = useState("");
  const [convertPreview, setConvertPreview] = useState<ConvertToUsdtPreview | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [convertStatus, setConvertStatus] = useState<string | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertedUsdt, setConvertedUsdt] = useState<{
    swapTxHash: string;
    buyUsdtAtomic: string;
    buyUsdtFormatted: string;
    sentTxHash?: string;
    sentTo?: string;
  } | null>(null);
  const [isSendingConvertedUsdt, setIsSendingConvertedUsdt] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferTxHash, setTransferTxHash] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [ratingTxHash, setRatingTxHash] = useState<string | null>(null);
  const [ratingScore, setRatingScore] = useState(95);
  const cashOutRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!cashOutOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (cashOutRef.current && !cashOutRef.current.contains(e.target as Node)) {
        setCashOutOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCashOutOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [cashOutOpen]);

  const { data: campData } = useQuery({
    queryKey: ["campaigns-claim"],
    queryFn: async () => {
      const r = await fetch("/api/campaigns");
      return (await r.json()) as { campaigns: CampaignItem[] };
    },
  });

  // Fetch exact campaign details by slug (supports Link-only unlisted campaigns + returns mySubmission & approvalStats!)
  const { data: singleCampData, refetch: refetchSingleCampaign } = useQuery({
    queryKey: ["campaign-detail", selectedSlug, address],
    enabled: Boolean(selectedSlug),
    queryFn: async () => {
      const r = await fetch(`/api/campaigns/${encodeURIComponent(selectedSlug)}`);
      if (!r.ok) return null;
      return (await r.json()) as { campaign: CampaignItem };
    },
  });

  const { data: identityData, refetch: refetchIdentity } = useQuery({
    queryKey: ["identity-status", address],
    queryFn: async () => {
      const q = address ? `?wallet=${encodeURIComponent(address)}` : "";
      const r = await fetch(`/api/identity/status${q}`);
      return (await r.json()) as {
        githubSession: { login: string; profileUrl: string } | null;
        githubOAuthConfigured: boolean;
        hasWalletSession?: boolean;
        contributor: {
          identityProvider: string;
          identityHandle: string;
          identityProfileUrl: string;
          oauthVerified?: boolean;
        } | null;
        completedBySlug?: Record<string, { count: number; lastPayoutAtMs: number | null }>;
      };
    },
  });

  const { data: repData } = useQuery({
    queryKey: ["reputation-claim"],
    queryFn: async () => {
      const r = await fetch("/api/reputation");
      return (await r.json()) as { registered: boolean; agentId: string | null };
    },
  });

  useEffect(() => {
    if (forcedSlug) {
      setSelectedSlug(forcedSlug);
      return;
    }
    const list = campData?.campaigns;
    if (!list?.length) return;
    if (!selectedSlug) {
      setSelectedSlug(list[0]!.slug);
    }
  }, [campData, selectedSlug, forcedSlug]);

  useEffect(() => {
    if (handle) return;
    if (privyTwitterHandle) {
      setProvider("x");
      setHandle(privyTwitterHandle);
    } else if (privyGithubHandle) {
      setProvider("github");
      setHandle(privyGithubHandle);
    } else if (identityData?.githubSession?.login) {
      setProvider("github");
      setHandle(identityData.githubSession.login);
    }
  }, [identityData, handle, privyTwitterHandle, privyGithubHandle]);

  const activeCampaign =
    singleCampData?.campaign ?? campData?.campaigns.find((c) => c.slug === selectedSlug);
  const activeStage =
    activeCampaign?.stages.find((s) => s.stageIndex === stageIndex) ?? activeCampaign?.stages[0];
  const completedCountForCampaign = selectedSlug
    ? (identityData?.completedBySlug?.[selectedSlug]?.count ?? 0)
    : 0;
  const expectedNextStage = completedCountForCampaign + 1;
  const hasExplicitStageParam = Boolean(searchParams.get("stage"));

  useEffect(() => {
    if (!activeCampaign || hasExplicitStageParam) return;
    const maxStage = activeCampaign.stages.length;
    const nextStage = Math.min(maxStage, expectedNextStage);
    if (nextStage >= 1) {
      setStageIndex(nextStage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlug, expectedNextStage, hasExplicitStageParam, Boolean(activeCampaign)]);

  const isManualMode = activeCampaign?.verificationMode === "manual";
  const isVoucherMode = activeCampaign?.verificationMode === "voucher";
  const isOwnerOfCampaign = Boolean(
    activeCampaign?.isOwner ||
      (address &&
        activeCampaign?.creatorWallet &&
        address.toLowerCase() === activeCampaign.creatorWallet.toLowerCase())
  );
  const profileLinked = isVoucherMode
    ? isSignedIn
    : Boolean(identityData?.contributor && identityData?.hasWalletSession);
  const maxPayoutsForCampaign = activeCampaign?.maxPayoutsPerRecipient ?? 1;
  const alreadyClaimedCampaign = completedCountForCampaign >= maxPayoutsForCampaign;
  const hasPendingManual = activeCampaign?.mySubmission?.status === "PENDING_REVIEW";
  const isExpired = Boolean(activeCampaign?.isExpired);
  const poolFull =
    typeof activeCampaign?.spotsRemaining === "number" && activeCampaign.spotsRemaining <= 0;
  const walletClaimCode = address ? `VIRE-${address.replace(/^0x/i, "").slice(-4).toUpperCase()}` : null;
  const needsAntiHijackCode = Boolean(
    !isManualMode &&
      !isVoucherMode &&
      isSignedIn &&
      activeCampaign?.deliverableType === "promo_post" &&
      walletClaimCode &&
      !identityData?.contributor?.oauthVerified
  );
  const stageMismatchNote =
    activeCampaign &&
    activeCampaign.stages.length > 1 &&
    expectedNextStage <= activeCampaign.stages.length &&
    stageIndex !== expectedNextStage
      ? `Complete Stage ${expectedNextStage} first before submitting Stage ${stageIndex}.`
      : null;

  // Include unlisted campaign cleanly in the selector dropdown if accessed via direct link
  const selectorCampaigns = (() => {
    const base = campData?.campaigns ?? [];
    if (activeCampaign && !base.some((c) => c.slug === activeCampaign.slug)) {
      return [activeCampaign, ...base];
    }
    return base;
  })();

  async function handleBindIdentity() {
    if (!address) return;
    const cleanHandle = handle.trim();
    if (!cleanHandle) {
      setBindError("Enter your GitHub or X handle before signing.");
      return;
    }
    setIsBinding(true);
    setBindError(null);
    try {
      const nonce = await requestAuthNonce(address);
      const message = buildIdentityBindMessage({
        walletAddress: address,
        provider,
        handle: cleanHandle,
        nonce,
      });
      const signature = wagmiConnected
        ? await signMessageAsync({ message })
        : privySignMessage
          ? await privySignMessage(message)
          : await signMessageAsync({ message });
      const res = await fetch("/api/identity/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          provider,
          handle: cleanHandle,
          signature,
          privyIdentityToken: privyIdentityToken ?? undefined,
        }),
      });
      const json = (await res.json()) as { verified?: boolean; error?: string; handle?: string };
      if (!res.ok) {
        const msg = json.error ?? "Identity verification failed.";
        setBindError(msg);
        toast.error(msg);
      } else {
        toast.success(`Identity @${json.handle} bound to ${truncateMiddle(address, 6, 4)}`);
        await Promise.all([refetchIdentity(), refetchSingleCampaign()]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Wallet signature cancelled.";
      setBindError(msg);
      toast.error(msg);
    } finally {
      setIsBinding(false);
    }
  }

  async function handleSubmitDeliverable(e: React.FormEvent) {
    e.preventDefault();
    if (!address || !selectedSlug) return;
    setIsSubmitting(true);
    setResult(null);
    setRatingTxHash(null);

    try {
      // Cashback voucher buyers skip X/GitHub linking — confirm wallet ownership seamlessly on first claim
      if (isVoucherMode && !identityData?.hasWalletSession) {
        const nonce = await requestAuthNonce(address);
        const message = buildWalletAuthMessage(address, nonce);
        const signature = wagmiConnected
          ? await signMessageAsync({ message })
          : privySignMessage
            ? await privySignMessage(message)
            : await signMessageAsync({ message });
        const authRes = await fetch("/api/auth/wallet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress: address, signature }),
        });
        if (!authRes.ok) {
          const authErr = (await authRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(authErr.error || "Please approve the wallet sign-in prompt to claim.");
        }
        void refetchIdentity();
      }

      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignSlug: selectedSlug,
          stageIndex,
          contributorWallet: address,
          ...(isVoucherMode
            ? { voucherCode: voucherCode.trim() }
            : { deliverableUrl: deliverableUrl.trim() }),
          deliverableNotes: deliverableNotes.trim(),
          referralCode: referralCode.trim() || undefined,
          inviteCode: inviteCode.trim() || undefined,
        }),
      });
      const json = (await res.json()) as SubmissionResponse;
      setResult(json);
      setCashOutOpen(false);
      setConvertOpen(false);
      setConvertedUsdt(null);
      setConvertError(null);
      setConvertStatus(null);
      setTransferOpen(false);
      setTransferError(null);
      setTransferTxHash(null);
      if (json.status === "COMPLETED") {
        const paidLabel =
          activeStage && activeCampaign
            ? `${activeStage.rewardLocalFormatted} ${activeCampaign.corridor}`
            : activeCampaign?.corridor ?? "your payout";
        setConfettiKey(json.txHashes?.localPayout ?? String(Date.now()));
        if (json.offramp?.humanAmount) {
          setTransferAmount(json.offramp.humanAmount);
          setConvertAmount(json.offramp.humanAmount);
        }
        toast.success(`${paidLabel} paid to your wallet`, {
          description: "Your work was verified and settled on Celo.",
          ...(json.txHashes?.localPayout
            ? {
                action: {
                  label: "View tx",
                  onClick: () =>
                    window.open(celoscanTxUrl(json.txHashes!.localPayout), "_blank", "noopener"),
                },
              }
            : {}),
        });
        void Promise.all([refetchIdentity(), refetchSingleCampaign()]);
      } else if (json.status === "PENDING_REVIEW") {
        toast.success("Submitted for campaign owner review");
        void refetchSingleCampaign();
      } else if (json.status === "REJECTED") {
        toast.error(friendlyFailureMessage(json));
      } else if (json.error) {
        toast.error(json.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error submitting deliverable.";
      setResult({ status: "FAILED", error: msg });
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Fetch live indicative Textile FX preview when Convert to USDT panel is open
  useEffect(() => {
    if (!convertOpen || !activeCampaign || !isConvertibleLocalToken(activeCampaign.corridor)) {
      return;
    }
    const corridorSym = activeCampaign.corridor;
    const tokenMeta = CELO_TOKENS[corridorSym as CorridorSymbol];
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
        sellToken: corridorSym,
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
  }, [convertOpen, convertAmount, activeCampaign]);

  async function handleConvertToUsdt(e: React.FormEvent) {
    e.preventDefault();
    if (!address || !activeCampaign || !isConvertibleLocalToken(activeCampaign.corridor)) return;
    setConvertError(null);

    const corridorSym = activeCampaign.corridor;
    const tokenMeta = CELO_TOKENS[corridorSym as CorridorSymbol];

    let sellAtomic: bigint;
    try {
      sellAtomic = parseUnits(convertAmount.trim(), tokenMeta.decimals);
      if (sellAtomic <= 0n) throw new Error("zero");
    } catch {
      setConvertError(`Enter a valid ${corridorSym} amount.`);
      return;
    }

    const destTrimmed = isMiniPay ? "" : convertSendTo.trim();
    if (destTrimmed && !isAddress(destTrimmed)) {
      setConvertError("Enter a valid Celo 0x MiniPay or exchange deposit address (or leave blank to keep USDT here).");
      return;
    }

    setIsConverting(true);
    setConvertStatus("Preparing Textile FX conversion…");
    try {
      const swapRes = await executeConvertToUsdt({
        wallet: address,
        sellToken: corridorSym,
        sellAmountAtomic: sellAtomic.toString(),
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

      const baseState = {
        swapTxHash: swapRes.swapTxHash,
        buyUsdtAtomic: swapRes.buyUsdtAtomic,
        buyUsdtFormatted: swapRes.buyUsdtFormatted,
      };
      setConvertedUsdt(baseState);
      toast.success(`Converted ${swapRes.takerPaysFormatted} ${corridorSym} → ${swapRes.buyUsdtFormatted} USDT`);

      if (destTrimmed) {
        setConvertStatus(`Sending ${swapRes.buyUsdtFormatted} USDT (Celo) to ${truncateMiddle(destTrimmed, 6, 4)}…`);
        try {
          const usdtTx = await writeContractAsync({
            address: CELO_TOKENS.USDT.address,
            abi: erc20Abi,
            functionName: "transfer",
            args: [getAddress(destTrimmed), BigInt(swapRes.buyUsdtAtomic)],
            chainId: celo.id,
          });
          setConvertedUsdt({ ...baseState, sentTxHash: usdtTx, sentTo: destTrimmed });
          setConvertSendTo("");
          toast.success(`Sent ${swapRes.buyUsdtFormatted} USDT on Celo`);
        } catch (sendErr) {
          const msg = formatWalletTxError(sendErr, "USDT transfer cancelled.");
          setConvertError(
            `Converted to ${swapRes.buyUsdtFormatted} USDT successfully, but the USDT send was not completed (${msg}). Use the Send USDT button below to retry.`
          );
        }
      }
    } catch (err) {
      setConvertError(formatWalletTxError(err, "Conversion cancelled or failed."));
      toast.error("Conversion did not complete");
    } finally {
      setIsConverting(false);
      setConvertStatus(null);
    }
  }

  async function handleSendConvertedUsdt(e: React.FormEvent) {
    e.preventDefault();
    if (!convertedUsdt) return;
    setConvertError(null);
    const destTrimmed = convertSendTo.trim();
    if (!isAddress(destTrimmed)) {
      setConvertError("Enter a valid Celo 0x MiniPay or exchange deposit address.");
      return;
    }
    setIsSendingConvertedUsdt(true);
    try {
      const usdtTx = await writeContractAsync({
        address: CELO_TOKENS.USDT.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [getAddress(destTrimmed), BigInt(convertedUsdt.buyUsdtAtomic)],
        chainId: celo.id,
      });
      setConvertedUsdt({ ...convertedUsdt, sentTxHash: usdtTx, sentTo: destTrimmed });
      setConvertSendTo("");
      toast.success(`Sent ${convertedUsdt.buyUsdtFormatted} USDT on Celo`);
    } catch (err) {
      setConvertError(formatWalletTxError(err, "USDT transfer cancelled."));
    } finally {
      setIsSendingConvertedUsdt(false);
    }
  }

  async function handleTransferPayout(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCampaign) return;
    setTransferError(null);
    setTransferTxHash(null);

    const recipient = transferTo.trim();
    if (!isAddress(recipient)) {
      setTransferError("Enter a valid Celo 0x wallet or exchange deposit address.");
      return;
    }

    const tokenMeta = CELO_TOKENS[activeCampaign.corridor as CorridorSymbol];
    if (!tokenMeta) return;

    let atomic: bigint;
    try {
      atomic = parseUnits(transferAmount.trim(), tokenMeta.decimals);
      if (atomic <= 0n) throw new Error("zero");
    } catch {
      setTransferError(`Enter a valid ${activeCampaign.corridor} amount.`);
      return;
    }

    setIsTransferring(true);
    try {
      const hash = await writeContractAsync({
        address: tokenMeta.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [getAddress(recipient), atomic],
        chainId: celo.id,
      });
      setTransferTxHash(hash);
      setTransferTo("");
      toast.success(`Sent ${transferAmount.trim()} ${activeCampaign.corridor}`);
    } catch (err) {
      setTransferError(formatWalletTxError(err, "Transfer cancelled."));
    } finally {
      setIsTransferring(false);
    }
  }

  function friendlyFailureMessage(res: SubmissionResponse): string {
    if (isVoucherMode) {
      return res.error || res.policyDecision?.failedReason || "Unable to redeem cashback voucher right now.";
    }
    const rule = res.policyDecision?.failedRule;
    if (rule === "UNIQUE_DELIVERABLE_HASH") {
      return "This post link has already been claimed.";
    }
    if (rule === "VERIFIED_EXTERNAL_IDENTITY") {
      return res.policyDecision?.failedReason?.includes("creator") ||
        res.policyDecision?.failedReason?.includes("team")
        ? "This wallet belongs to the campaign creator or team. Please sign in with a personal contributor wallet."
        : "Please link your profile in Step 01 before submitting.";
    }
    if (rule === "STAGE_CAP_AND_COOLDOWN") {
      return res.policyDecision?.failedReason || "You have already reached the claim cap for this campaign.";
    }
    if (rule === "CAMPAIGN_ACTIVE_AND_FUNDED") {
      return res.error || "This campaign's active pool doesn't have enough funds left for another payout right now.";
    }
    if (rule === "VERIFICATION_SCORE_THRESHOLD") {
      return res.verdict?.reason || "Your work didn't meet all campaign requirements yet.";
    }
    return res.policyDecision?.failedReason || res.error || "Unable to complete payout right now.";
  }

  async function handleRateOnchain() {
    if (!repData?.agentId || !activeCampaign) return;
    try {
      const hash = await writeContractAsync({
        address: CELO_CONTRACTS.ERC8004_REPUTATION_REGISTRY,
        abi: ERC8004_GIVE_FEEDBACK_ABI,
        functionName: "giveFeedback",
        args: [
          BigInt(repData.agentId),
          BigInt(ratingScore),
          0,
          "settlement",
          activeCampaign.corridor,
          window.location.origin,
          "",
          zeroHash,
        ],
      });
      setRatingTxHash(hash);
      toast.success("ERC-8004 feedback recorded on Celo Mainnet");
      if (result?.submissionId) {
        await fetch("/api/reputation/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submissionId: result.submissionId, feedbackTxHash: hash }),
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Feedback transaction rejected");
    }
  }

  return (
    <div className="space-y-8">
      <ConfettiBurst triggerKey={confettiKey} />

      <div className="vire-enter flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-[28px] font-medium tracking-[-0.03em] text-[#0A0A0C]">
            {forcedSlug && activeCampaign ? activeCampaign.title : "Submit work"}
          </h1>
          <p className="mt-1 max-w-[60ch] text-[14px] leading-relaxed text-[#71717A]">
            {isVoucherMode
              ? "Sign in with Google, email, or MiniPay and redeem your single-use cashback voucher for an instant local currency payout on Celo."
              : isManualMode
                ? "Sign in, link your profile, and submit your link. Once approved by the campaign owner, Vire automatically sends your exact local currency payout."
                : "Sign in with Google, email, or a Celo wallet, link your profile, and submit your link to get automatically verified and paid in local currency."}
          </p>
        </div>

        {isOwnerOfCampaign && (
          <Link href="/manage" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Manage campaign
          </Link>
        )}
      </div>

      {/* Live personal submission status banner for returning contributors */}
      {!result && activeCampaign?.mySubmission && (
        <Card className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <Badge
              tone={
                activeCampaign.mySubmission.status === "COMPLETED"
                  ? "positive"
                  : activeCampaign.mySubmission.status === "PENDING_REVIEW"
                    ? "ink"
                    : "neutral"
              }
            >
              {activeCampaign.mySubmission.status === "COMPLETED"
                ? "Paid"
                : activeCampaign.mySubmission.status === "PENDING_REVIEW"
                  ? "Under review"
                  : "Not approved"}
            </Badge>
            <div className="text-[13px] text-[#3F3F46]">
              {activeCampaign.mySubmission.status === "COMPLETED" && activeCampaign.mySubmission.settlement
                ? `You were paid ${activeCampaign.mySubmission.settlement.localAmountFormatted} ${activeCampaign.mySubmission.settlement.corridor}.`
                : activeCampaign.mySubmission.status === "PENDING_REVIEW"
                  ? "Your submission is in the campaign owner's review queue."
                  : activeCampaign.mySubmission.reviewNote ||
                    activeCampaign.mySubmission.aiReason ||
                    "Your previous submission was not approved."}
            </div>
          </div>
          {activeCampaign.mySubmission.settlement ? (
            <a
              href={celoscanTxUrl(activeCampaign.mySubmission.settlement.payoutTxHash)}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              View transaction
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          ) : (
            <Link href="/manage" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Track in Workspace
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        {/* Left Action Column */}
        <div className="min-w-0 space-y-5 lg:col-span-7">
          {/* Step 1: Sign in (Voucher Mode) or Link Profile (Auto/Manual Mode) */}
          <Card className="vire-enter vire-delay-1 p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[12px] text-[#A1A1AA]">01</span>
                <h2 className="text-[15px] font-medium text-[#0A0A0C]">
                  {isVoucherMode ? "Sign in to receive cashback" : "Link your profile"}
                </h2>
              </div>

              {isVoucherMode ? (
                isSignedIn ? (
                  <Badge tone="positive">
                    <Check weight="bold" className="h-3 w-3" />
                    Wallet ready · {truncateMiddle(address ?? "", 6, 4)}
                  </Badge>
                ) : (
                  <Badge tone="neutral">Sign in required</Badge>
                )
              ) : identityData?.contributor && identityData?.hasWalletSession ? (
                <Badge tone="positive">
                  <Check weight="bold" className="h-3 w-3" />
                  {identityData.contributor.identityProvider}: @
                  {identityData.contributor.identityHandle}
                </Badge>
              ) : identityData?.contributor ? (
                <Badge tone="neutral">Re-sign to confirm session</Badge>
              ) : (
                <Badge tone="neutral">Not linked</Badge>
              )}
            </div>

            {!isSignedIn ? (
              <div className="vire-well mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-[13px] text-[#52525B]">
                <div className="flex items-center gap-2.5">
                  <WarningCircle weight="regular" className="h-4 w-4 shrink-0 text-[#0A0A0C]" />
                  <span>
                    {isVoucherMode
                      ? "Sign in with Google, email, or MiniPay to receive your instant cashback."
                      : "Sign in to link your profile and receive payouts."}
                  </span>
                </div>
                <Button type="button" size="sm" variant="primary" onClick={triggerSignIn}>
                  Sign in
                </Button>
              </div>
            ) : isVoucherMode ? (
              <div className="vire-well mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-[12.5px] text-[#52525B]">
                <span>
                  Your cashback will be sent directly to{" "}
                  <span className="font-mono font-medium text-[#0A0A0C]">
                    {truncateMiddle(address ?? "", 8, 6)}
                  </span>{" "}
                  on Celo (network gas covered by Vire during launch).
                </span>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="min-w-0 sm:col-span-4">
                    <FieldLabel htmlFor="identity-provider" className="mb-1.5">
                      Platform
                    </FieldLabel>
                    <Select
                      id="identity-provider"
                      value={provider}
                      onChange={(e) => setProvider(e.target.value as "github" | "x" | "signed_proof")}
                    >
                      <option value="github">GitHub</option>
                      <option value="x">X (Twitter)</option>
                      <option value="signed_proof">Wallet signature</option>
                    </Select>
                  </div>

                  <div className="min-w-0 sm:col-span-5">
                    <FieldLabel htmlFor="identity-handle" className="mb-1.5">
                      Handle
                    </FieldLabel>
                    <Input
                      id="identity-handle"
                      type="text"
                      value={handle}
                      onChange={(e) => setHandle(e.target.value)}
                      placeholder="@yourhandle"
                      className="font-mono"
                    />
                  </div>

                  <div className="flex items-end sm:col-span-3">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={isBinding}
                      onClick={handleBindIdentity}
                      className="h-11 w-full sm:h-10"
                    >
                      <Signature weight="regular" className="h-3.5 w-3.5" />
                      {isBinding ? "Signing…" : "Sign"}
                    </Button>
                  </div>
                </div>

                {identityData?.githubOAuthConfigured && (
                  <div>
                    <a
                      href="/api/auth/github"
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                    >
                      <GithubLogo weight="regular" className="h-3.5 w-3.5" />
                      Sign in with GitHub
                    </a>
                  </div>
                )}

                {bindError && (
                  <p className="font-mono text-xs text-[#DC2626]" role="alert">
                    {bindError}
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* Step 2: Work Proof Form */}
          <Card className="vire-enter vire-delay-2 p-4 sm:p-6">
            <form onSubmit={handleSubmitDeliverable} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-[12px] text-[#A1A1AA]">02</span>
                  <h2 className="text-[15px] font-medium text-[#0A0A0C]">
                    {isVoucherMode ? "Redeem cashback voucher" : "Work proof"}
                  </h2>
                </div>
                {activeCampaign && (
                  <div className="flex items-center gap-2">
                    <Badge tone="outline">
                      {isVoucherMode
                        ? "Instant cashback"
                        : isManualMode
                          ? "Owner-reviewed"
                          : "Instant auto-pay"}
                    </Badge>
                    <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-[#52525B]">
                      <TokenIcon symbol={activeCampaign.corridor} size={18} />
                      {activeCampaign.corridor}
                    </span>
                  </div>
                )}
              </div>

              {!forcedSlug && (
                <div className="space-y-4">
                  <div className="min-w-0 space-y-1.5">
                    <FieldLabel htmlFor="claim-campaign">Campaign</FieldLabel>
                    <Select
                      id="claim-campaign"
                      value={selectedSlug}
                      onChange={(e) => {
                        setSelectedSlug(e.target.value);
                        setStageIndex(1);
                      }}
                    >
                      {selectorCampaigns.map((c) => (
                        <option key={c.slug} value={c.slug}>
                          [{c.corridor}] {c.title}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              )}

              {activeCampaign && activeCampaign.stages.length > 1 && (
                <div className="min-w-0 space-y-1.5">
                  <FieldLabel htmlFor="claim-stage">Stage</FieldLabel>
                  <Select
                    id="claim-stage"
                    value={stageIndex}
                    onChange={(e) => setStageIndex(Number(e.target.value))}
                  >
                    {activeCampaign.stages.map((s) => (
                      <option key={s.stageIndex} value={s.stageIndex}>
                        Stage {s.stageIndex} — {s.rewardLocalFormatted} {activeCampaign.corridor}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              {activeStage && activeCampaign && (
                <div className="vire-well space-y-2.5 rounded-xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <span className="font-medium text-[#0A0A0C]">
                      {activeStage.title.replace(/^Stage \d+\s*[—-]\s*/i, "")}
                    </span>
                    <div className="flex items-center gap-2">
                      {typeof activeCampaign.spotsRemaining === "number" && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium",
                            !isExpired && activeCampaign.spotsRemaining > 0
                              ? "bg-white text-[#52525B] ring-1 ring-black/[0.07]"
                              : "bg-[#FEF2F2] text-[#B91C1C]"
                          )}
                        >
                          {isExpired
                            ? "Ended"
                            : activeCampaign.spotsRemaining > 0
                              ? `FCFS · ${activeCampaign.spotsRemaining} left`
                              : "Pool full"}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5 font-mono font-medium text-[#0A0A0C] tabular-nums">
                        <TokenIcon symbol={activeCampaign.corridor} size={16} />
                        {activeStage.rewardLocalFormatted} {activeCampaign.corridor}
                      </span>
                    </div>
                  </div>
                  <p className="text-[12.5px] leading-relaxed text-[#52525B]">
                    {activeStage.instructions}
                  </p>
                  {isManualMode &&
                    activeCampaign.approvalStats &&
                    activeCampaign.approvalStats.approved + activeCampaign.approvalStats.rejected > 0 && (
                      <p className="font-mono text-[11px] text-[#71717A]">
                        Owner history: {activeCampaign.approvalStats.approved} approved ·{" "}
                        {activeCampaign.approvalStats.rejected} rejected
                      </p>
                    )}
                  {needsAntiHijackCode && walletClaimCode && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-[12px] ring-1 ring-black/[0.07]">
                      <span className="text-[#52525B]">
                        Include your code{" "}
                        <span className="font-mono font-semibold text-[#0A0A0C]">
                          {walletClaimCode}
                        </span>{" "}
                        in your post to prevent spoofing
                      </span>
                      <CopyButton
                        value={walletClaimCode}
                        label="Copy"
                        toastMessage={`Copied ${walletClaimCode}`}
                      />
                    </div>
                  )}
                </div>
              )}

              {isVoucherMode ? (
                <div className="space-y-4">
                  {activeCampaign && (activeCampaign.verifiedGmvLocal ?? 0) > 0 && (
                    <div className="flex items-center justify-between rounded-xl bg-[#F0FDF4] px-3.5 py-2.5 font-mono text-[12px] text-[#15803D] ring-1 ring-[#16A34A]/20">
                      <span>Verified retail sales driven</span>
                      <span className="font-semibold tabular-nums">
                        {Math.round(activeCampaign.verifiedGmvLocal!).toLocaleString("en-US")}{" "}
                        {activeCampaign.corridor.replace(/^[cw]/, "")}
                      </span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="voucher-code">
                      <span className="inline-flex items-center gap-1.5">
                        <Ticket className="h-3.5 w-3.5 text-[#71717A]" />
                        Single-use voucher code
                      </span>
                    </FieldLabel>
                    <Input
                      id="voucher-code"
                      type="text"
                      required
                      value={voucherCode}
                      onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                      placeholder="e.g. SWOT-7K9P-2M4X"
                      className="font-mono uppercase tracking-[0.04em]"
                    />
                    <p className="text-[11.5px] text-[#71717A]">
                      Issued by {activeCampaign?.partnerName ?? "the merchant"} after your order is
                      confirmed. Each code works once.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="deliverable-url">Proof URL</FieldLabel>
                    <Input
                      id="deliverable-url"
                      type="url"
                      required
                      value={deliverableUrl}
                      onChange={(e) => setDeliverableUrl(e.target.value)}
                      placeholder={
                        isManualMode
                          ? "Paste your deliverable link (Figma, YouTube, TikTok, Doc, X, GitHub…)"
                          : "Paste X post or GitHub URL"
                      }
                      className="font-mono"
                    />
                  </div>

                  {activeCampaign?.requiresInviteCode && (
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor="invite-code">
                        <span className="inline-flex items-center gap-1.5">
                          <LockSimple className="h-3.5 w-3.5 text-[#71717A]" />
                          Campaign invite code (required)
                        </span>
                      </FieldLabel>
                      <Input
                        id="invite-code"
                        type="text"
                        required
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        placeholder="Enter the invite passcode shared by the campaign owner"
                        className="font-mono"
                      />
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="min-w-0 space-y-1.5">
                      <FieldLabel htmlFor="referral-code">Referral code (optional)</FieldLabel>
                      <Input
                        id="referral-code"
                        type="text"
                        value={referralCode}
                        onChange={(e) => setReferralCode(e.target.value)}
                        placeholder="Optional code"
                        className="font-mono"
                      />
                    </div>

                    <div className="min-w-0 space-y-1.5">
                      <FieldLabel htmlFor="recipient-wallet">Payout wallet</FieldLabel>
                      <Input
                        id="recipient-wallet"
                        type="text"
                        readOnly
                        value={address ?? "Sign in above"}
                        className="font-mono text-[#71717A]"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="deliverable-notes">Notes (optional)</FieldLabel>
                    <Textarea
                      id="deliverable-notes"
                      rows={2}
                      value={deliverableNotes}
                      onChange={(e) => setDeliverableNotes(e.target.value)}
                      placeholder="Short summary of the work completed."
                    />
                  </div>
                </>
              )}

              {isOwnerOfCampaign && (
                <div className="rounded-xl bg-[#FAFAFB] px-3.5 py-2.5 text-[12.5px] text-[#52525B] ring-1 ring-black/[0.08]">
                  You created this campaign. Creators cannot claim from their own pool — open{" "}
                  <Link href="/manage" className="font-medium text-[#0A0A0C] underline">
                    Workspace
                  </Link>{" "}
                  to manage or review submissions.
                </div>
              )}

              {alreadyClaimedCampaign && (
                <div className="flex items-center gap-2 rounded-xl bg-[#F0FDF4] px-3.5 py-2.5 text-[12.5px] font-medium text-[#15803D] ring-1 ring-[#16A34A]/20">
                  <Check weight="bold" className="h-4 w-4 shrink-0" />
                  <span>You&apos;ve already claimed this campaign (1 verified payout per person).</span>
                </div>
              )}

              {!alreadyClaimedCampaign && isExpired && (
                <div className="rounded-xl bg-[#FEF2F2] px-3.5 py-2.5 text-[12.5px] text-[#B91C1C] ring-1 ring-[#DC2626]/20">
                  This campaign has passed its end date and is no longer accepting submissions.
                </div>
              )}

              {!alreadyClaimedCampaign && !isExpired && poolFull && (
                <div className="rounded-xl bg-[#FEF2F2] px-3.5 py-2.5 text-[12.5px] text-[#B91C1C] ring-1 ring-[#DC2626]/20">
                  All FCFS spots in this campaign pool have been claimed. Check back when the next wave opens.
                </div>
              )}

              {stageMismatchNote && (
                <div className="rounded-xl bg-[#FEF2F2] px-3.5 py-2.5 text-[12px] text-[#B91C1C] ring-1 ring-[#DC2626]/20">
                  {stageMismatchNote}
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                variant="primary"
                disabled={
                  !isSignedIn ||
                  !profileLinked ||
                  (isVoucherMode && !voucherCode.trim()) ||
                  isOwnerOfCampaign ||
                  alreadyClaimedCampaign ||
                  hasPendingManual ||
                  isExpired ||
                  poolFull ||
                  isSubmitting
                }
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <CircleNotch className="h-4 w-4 animate-spin" />
                    {isVoucherMode
                      ? "Verifying voucher & paying…"
                      : isManualMode
                        ? "Submitting for review…"
                        : "Verifying and paying…"}
                  </>
                ) : isOwnerOfCampaign ? (
                  <>Campaign owner wallet</>
                ) : alreadyClaimedCampaign ? (
                  <>
                    <Check weight="bold" className="h-4 w-4" />
                    Already claimed
                  </>
                ) : hasPendingManual ? (
                  <>
                    <Clock className="h-4 w-4" />
                    Submission under review
                  </>
                ) : isExpired ? (
                  <>Campaign ended</>
                ) : poolFull ? (
                  <>Pool full</>
                ) : isSignedIn && !profileLinked ? (
                  <>
                    {identityData?.contributor
                      ? "Re-sign Step 01 to confirm wallet"
                      : "Link your profile in Step 01 first"}
                  </>
                ) : isVoucherMode ? (
                  <>
                    Claim {activeStage?.rewardLocalFormatted ?? ""} {activeCampaign?.corridor ?? "cashback"}
                    <ArrowRight weight="bold" className="h-4 w-4" />
                  </>
                ) : isManualMode ? (
                  <>
                    Submit for review
                    <ArrowRight weight="bold" className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    Verify &amp; get paid
                    <ArrowRight weight="bold" className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </Card>
        </div>

        {/* Right Sticky Payout Progress */}
        <div className="min-w-0 lg:sticky lg:top-20 lg:col-span-5">
          <Card className="vire-enter vire-delay-2 overflow-visible">
            <div className="flex items-center justify-between rounded-t-2xl border-b border-black/[0.06] bg-[#FAFAFB] px-4 py-3.5 sm:px-6">
              <h2 className="text-[13px] font-medium text-[#0A0A0C]">
                {result?.status === "COMPLETED"
                  ? "Payout receipt"
                  : result?.status === "PENDING_REVIEW"
                    ? "Submitted for review"
                    : "How payout works"}
              </h2>
              {activeCampaign && (
                <div className="flex items-center gap-1.5">
                  <TokenIcon symbol="USDT" size={16} />
                  <ArrowRight className="h-3 w-3 text-[#A1A1AA]" />
                  <TokenIcon symbol={activeCampaign.corridor} size={16} />
                </div>
              )}
            </div>

            <div className="p-4 sm:p-6">
              {!result && !isSubmitting && (
                <ol className="divide-y divide-black/[0.06]">
                  {(isManualMode
                    ? [
                        ["01", "Anti-spam intake", "Verifies your wallet and locks out duplicate links"],
                        ["02", "Owner review", "Campaign owner inspects your submitted link"],
                        ["03", "Automatic FX swap", "On approval, Vire converts USDT into exact local currency"],
                        ["04", "Direct transfer", "Sends local currency straight to your Celo wallet"],
                        ["05", "Cash out", "Withdraw directly to your local bank or wallet"],
                      ]
                    : [
                        ["01", "Automatic check", "Reviews your post against the campaign requirements"],
                        ["02", "Safety & limits", "Confirms uniqueness and available campaign budget"],
                        ["03", "Local currency swap", "Converts USDT into your exact local payout"],
                        ["04", "Direct transfer", "Sends local currency straight to your wallet"],
                        ["05", "Cash out", "Withdraw directly to your local bank or wallet"],
                      ]
                  ).map(([num, title, desc]) => (
                    <li key={num} className="flex items-start gap-3.5 py-3.5 first:pt-0 last:pb-0">
                      <span className="mt-0.5 font-mono text-[11.5px] text-[#A1A1AA]">{num}</span>
                      <div>
                        <div className="text-[13.5px] font-medium text-[#0A0A0C]">{title}</div>
                        <div className="mt-0.5 text-[12.5px] text-[#71717A]">{desc}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {isSubmitting && (
                <div className="space-y-3">
                  <div className="vire-well flex items-center gap-2.5 rounded-xl p-3.5 text-[13px] text-[#0A0A0C]">
                    <CircleNotch className="h-4 w-4 animate-spin" />
                    <span>
                      {isManualMode
                        ? "Checking anti-spam guards and queuing your work for review…"
                        : "Reviewing your link, checking limits, and locking exchange rate…"}
                    </span>
                  </div>
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-28 w-full" />
                </div>
              )}

              {result && result.status === "PENDING_REVIEW" && (
                <div className="space-y-4 text-center">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#0A0A0C] text-white">
                    <Clock weight="bold" className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[15px] font-medium text-[#0A0A0C]">
                      In owner review queue
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-[#71717A]">
                      {result.message ||
                        "Once approved by the campaign owner, Vire will automatically swap USDT and pay exact local currency directly to your wallet."}
                    </p>
                  </div>
                  <div className="pt-1">
                    <Link href="/manage" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                      Track status in Workspace
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              )}

              {result && result.status === "COMPLETED" && (
                <div className="space-y-5">
                  <div className="space-y-3 text-center">
                    <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#16A34A]/10 text-[#16A34A]">
                      <Check weight="bold" className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-[12px] font-medium text-[#16A34A]">Payout sent</div>
                      <div className="mt-1 inline-flex items-center justify-center gap-2 text-[28px] font-medium tracking-[-0.03em] text-[#0A0A0C] tabular-nums">
                        {activeCampaign && <TokenIcon symbol={activeCampaign.corridor} size={24} />}
                        <span>
                          {activeStage?.rewardLocalFormatted ?? result.offramp?.humanAmount}{" "}
                          {activeCampaign?.corridor}
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] text-[#71717A]">
                        Verified and sent directly to your wallet
                        {address ? ` (${truncateMiddle(address, 6, 4)})` : ""}.
                      </p>
                    </div>

                    {result.txHashes?.localPayout && (
                      <div className="pt-0.5">
                        <a
                          href={celoscanTxUrl(result.txHashes.localPayout)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full bg-[#F5F5F7] px-3 py-1 font-mono text-[11.5px] text-[#3F3F46] transition-colors hover:bg-[#ECECEF] hover:text-[#0A0A0C]"
                        >
                          View transaction
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    )}
                  </div>

                  {result.offramp && (
                    <div ref={cashOutRef} className="relative">
                      <button
                        type="button"
                        aria-expanded={cashOutOpen}
                        aria-haspopup="menu"
                        onClick={() => setCashOutOpen((prev) => !prev)}
                        className="vire-pressable flex h-11 w-full items-center justify-between rounded-full bg-[#0A0A0C] px-5 text-[13.5px] font-medium text-white shadow-[0_1px_2px_rgba(10,10,12,0.14)] hover:bg-[#1C1C21]"
                      >
                        <span>
                          {activeCampaign?.corridor === "cNGN"
                            ? "Cash out to Naira"
                            : "Cash out to local bank"}
                        </span>
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 16 16"
                          fill="none"
                          className={cn(
                            "h-4 w-4 text-white/75 transition-transform duration-150 ease-[var(--ease-out)]",
                            cashOutOpen && "rotate-180"
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

                      {cashOutOpen && (
                        <div
                          role="menu"
                          className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-2xl bg-white p-1.5 shadow-[0_0_0_1px_rgba(10,10,12,0.08),0_16px_36px_-10px_rgba(10,10,12,0.16)]"
                        >
                          {activeCampaign && isConvertibleLocalToken(activeCampaign.corridor) && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setCashOutOpen(false);
                                setTransferOpen(false);
                                setConvertOpen(true);
                              }}
                              className="flex w-full items-center justify-between gap-3 rounded-xl bg-[#F5F5F7]/75 px-3.5 py-2.5 text-left transition-colors hover:bg-[#ECECEF]"
                            >
                              <div className="min-w-0">
                                <div className="text-[13px] font-medium text-[#0A0A0C]">
                                  {isMiniPay
                                    ? `Convert ${activeCampaign.corridor} to USDT (for MiniPay)`
                                    : "Convert to USDT & send to MiniPay / Exchange"}
                                </div>
                                <div className="text-[11.5px] leading-snug text-[#71717A]">
                                  {isMiniPay
                                    ? "Swap into your MiniPay USDT balance, then Pay to Bank Transfer (min 0.35 USDT)"
                                    : `Swap ${activeCampaign.corridor} → Celo USDT via Textile FX, then send to MiniPay or exchanges`}
                                </div>
                              </div>
                              <ArrowsLeftRight className="h-4 w-4 shrink-0 text-[#0A0A0C]" />
                            </button>
                          )}

                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setCashOutOpen(false);
                              setConvertOpen(false);
                              setTransferOpen(true);
                            }}
                            className="mt-1 flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors hover:bg-[#F5F5F7]"
                          >
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium text-[#0A0A0C]">
                                Send raw {activeCampaign?.corridor} (Celo)
                              </div>
                              <div className="text-[11.5px] leading-snug text-[#71717A]">
                                Only for self-custody Celo wallets or exchanges that explicitly list Celo
                              </div>
                            </div>
                            <PaperPlaneTilt className="h-4 w-4 shrink-0 text-[#52525B]" />
                          </button>

                          <div className="my-1 border-t border-black/[0.06]" />

                          {result.offramp.venues.map((v) => (
                            <a
                              key={v.name}
                              role="menuitem"
                              href={v.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() => setCashOutOpen(false)}
                              className="flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 transition-colors hover:bg-[#F5F5F7]"
                            >
                              <div className="min-w-0">
                                <div className="text-[13px] font-medium text-[#0A0A0C]">
                                  {v.name}
                                </div>
                                <div className="text-[11.5px] leading-snug text-[#71717A]">
                                  {v.note}
                                </div>
                              </div>
                              <ArrowUpRight className="h-4 w-4 shrink-0 text-[#71717A]" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {convertOpen && activeCampaign && isConvertibleLocalToken(activeCampaign.corridor) && (
                    <div className="vire-well space-y-3 rounded-xl p-4">
                      <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-[#0A0A0C]">
                        <span>
                          {isMiniPay
                            ? `Convert ${activeCampaign.corridor} → MiniPay USDT`
                            : `Convert ${activeCampaign.corridor} → Celo USDT`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setConvertOpen(false)}
                          className="text-[11.5px] font-normal text-[#71717A] hover:text-[#0A0A0C]"
                        >
                          Close
                        </button>
                      </div>

                      {!convertedUsdt ? (
                        <form onSubmit={handleConvertToUsdt} className="space-y-2.5">
                          <div>
                            <div className="mb-1 flex items-center justify-between text-[11px] text-[#71717A]">
                              <span>Amount to convert ({activeCampaign.corridor})</span>
                              {isPreviewLoading ? (
                                <span className="inline-flex items-center gap-1 font-mono text-[#52525B]">
                                  <CircleNotch className="h-3 w-3 animate-spin" />
                                  Quoting…
                                </span>
                              ) : convertPreview?.status === "preview" && convertPreview.buyUsdtFormatted ? (
                                <span className="font-mono font-medium text-[#0A0A0C] tabular-nums">
                                  ≈ {convertPreview.buyUsdtFormatted} USDT
                                </span>
                              ) : convertPreview?.status === "no_quote" ? (
                                <span className="text-[#B45309]">Min ~$1.00 USDT for swap</span>
                              ) : null}
                            </div>
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={convertAmount}
                              onChange={(e) => setConvertAmount(e.target.value)}
                              placeholder={`Amount in ${activeCampaign.corridor}`}
                              className="h-9 bg-white font-mono text-[16px] sm:text-[12px]"
                            />
                          </div>

                          {!isMiniPay ? (
                            <div>
                              <div className="mb-1 text-[11px] text-[#71717A]">
                                MiniPay or Exchange Celo USDT address (optional)
                              </div>
                              <Input
                                type="text"
                                value={convertSendTo}
                                onChange={(e) => setConvertSendTo(e.target.value)}
                                placeholder="0x… MiniPay, Quidax, or Bybit (Celo network)"
                                className="h-9 bg-white font-mono text-[16px] sm:text-[12px]"
                              />
                            </div>
                          ) : (
                            <p className="text-[11.5px] leading-relaxed text-[#52525B]">
                              Swaps straight into your MiniPay USDT balance. Once done, tap{" "}
                              <strong className="font-medium text-[#0A0A0C]">
                                Withdraw → Pay to Bank Transfer
                              </strong>{" "}
                              inside MiniPay (OPay, Moniepoint, any bank · min 0.35 USDT).
                            </p>
                          )}

                          <Button
                            type="submit"
                            size="sm"
                            variant="primary"
                            disabled={isConverting}
                            className="h-9 w-full"
                          >
                            {isConverting ? (
                              <>
                                <CircleNotch className="h-3.5 w-3.5 animate-spin" />
                                {convertStatus ?? "Converting…"}
                              </>
                            ) : !isMiniPay && convertSendTo.trim() ? (
                              "Convert & Send USDT (Celo)"
                            ) : (
                              `Convert ${activeCampaign.corridor} → USDT`
                            )}
                          </Button>

                          <p className="text-[11px] leading-relaxed text-[#71717A]">
                            <strong className="font-medium text-[#0A0A0C]">Launch perk:</strong> Vire
                            covers your Celo network gas automatically on payouts and USDT conversions.
                            {!isMiniPay &&
                              " MiniPay supports USDT, USDC, and USAT on Celo with Nigerian bank transfers from 0.35 USDT."}
                          </p>
                        </form>
                      ) : (
                        <div className="space-y-2.5">
                          <div className="rounded-lg bg-white p-3 ring-1 ring-[#16A34A]/25">
                            <div className="text-[12.5px] font-medium text-[#16A34A]">
                              Converted to {convertedUsdt.buyUsdtFormatted} USDT on Celo
                            </div>
                            <a
                              href={celoscanTxUrl(convertedUsdt.swapTxHash)}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-[#3F3F46] underline underline-offset-2 hover:text-[#0A0A0C]"
                            >
                              View Textile FX swap tx
                              <ArrowUpRight className="h-3 w-3" />
                            </a>
                            {convertedUsdt.sentTxHash ? (
                              <div className="mt-2 border-t border-black/[0.06] pt-2">
                                <div className="text-[12px] font-medium text-[#0A0A0C]">
                                  USDT sent to {truncateMiddle(convertedUsdt.sentTo ?? "", 8, 6)}
                                </div>
                                <a
                                  href={celoscanTxUrl(convertedUsdt.sentTxHash)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-[#16A34A] underline underline-offset-2"
                                >
                                  View USDT transfer tx
                                  <ArrowUpRight className="h-3 w-3" />
                                </a>
                                <p className="mt-1.5 text-[11px] leading-relaxed text-[#52525B]">
                                  Open MiniPay →{" "}
                                  <strong className="font-medium text-[#0A0A0C]">
                                    Pay to Bank Transfer
                                  </strong>{" "}
                                  to withdraw Naira to OPay, Moniepoint, or any Nigerian bank (min 0.35 USDT).
                                </p>
                              </div>
                            ) : isMiniPay ? (
                              <p className="mt-2 border-t border-black/[0.06] pt-2 text-[11.5px] leading-relaxed text-[#52525B]">
                                Your <strong className="font-medium text-[#0A0A0C]">{convertedUsdt.buyUsdtFormatted} USDT</strong> is
                                now live on MiniPay&apos;s home screen — tap{" "}
                                <strong className="font-medium text-[#0A0A0C]">
                                  Withdraw → Pay to Bank Transfer
                                </strong>{" "}
                                to cash out to OPay or Moniepoint (min 0.35 USDT).
                              </p>
                            ) : null}
                          </div>

                          {!isMiniPay && !convertedUsdt.sentTxHash && (
                            <form onSubmit={handleSendConvertedUsdt} className="space-y-2">
                              <div className="text-[11px] font-medium text-[#52525B]">
                                Now send {convertedUsdt.buyUsdtFormatted} USDT (Celo) to MiniPay or Exchange:
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <Input
                                  type="text"
                                  value={convertSendTo}
                                  onChange={(e) => setConvertSendTo(e.target.value)}
                                  placeholder="0x… MiniPay or Exchange address"
                                  className="h-9 bg-white font-mono text-[16px] sm:text-[12px]"
                                />
                                <Button
                                  type="submit"
                                  size="sm"
                                  variant="primary"
                                  disabled={isSendingConvertedUsdt}
                                  className="h-9 shrink-0 px-4"
                                >
                                  {isSendingConvertedUsdt ? (
                                    <CircleNotch className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    `Send ${formatUnits(BigInt(convertedUsdt.buyUsdtAtomic), 6).slice(0, 6)} USDT`
                                  )}
                                </Button>
                              </div>
                            </form>
                          )}
                        </div>
                      )}

                      {convertError && (
                        <p className="text-[11.5px] leading-relaxed text-[#DC2626]">{convertError}</p>
                      )}
                    </div>
                  )}

                  {transferOpen && activeCampaign && (
                    <form
                      onSubmit={handleTransferPayout}
                      className="vire-well space-y-2.5 rounded-xl p-4"
                    >
                      <div className="flex items-center justify-between text-[12px] font-medium text-[#0A0A0C]">
                        <span>Send raw {activeCampaign.corridor} (Celo)</span>
                        <button
                          type="button"
                          onClick={() => setTransferOpen(false)}
                          className="text-[11.5px] font-normal text-[#71717A] hover:text-[#0A0A0C]"
                        >
                          Close
                        </button>
                      </div>
                      <p className="rounded-lg bg-white px-3 py-2 text-[11px] leading-relaxed text-[#52525B] ring-1 ring-black/[0.06]">
                        <strong className="font-medium text-[#0A0A0C]">Important:</strong>{" "}
                        {activeCampaign.corridor === "cNGN"
                          ? "MiniPay only displays USDT, USDC, and USAT, and most exchanges do not accept Celo cNGN deposits. For MiniPay, OPay, or Moniepoint cash-outs, convert to USDT first."
                          : `Only send raw ${activeCampaign.corridor} to a self-custody Celo wallet or ramp that explicitly supports ${activeCampaign.corridor} on Celo (Chain 42220).`}
                      </p>
                      <Input
                        type="text"
                        value={transferTo}
                        onChange={(e) => setTransferTo(e.target.value)}
                        placeholder="Paste Celo wallet 0x… address"
                        className="h-9 bg-white font-mono text-[16px] sm:text-[12px]"
                      />
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={transferAmount}
                          onChange={(e) => setTransferAmount(e.target.value)}
                          placeholder="Amount"
                          className="h-9 bg-white font-mono text-[16px] sm:text-[12px]"
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="primary"
                          disabled={isTransferring}
                          className="h-9 shrink-0 px-4"
                        >
                          {isTransferring ? (
                            <CircleNotch className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            "Send"
                          )}
                        </Button>
                      </div>
                      {transferError && (
                        <p className="text-[11.5px] text-[#DC2626]">{transferError}</p>
                      )}
                      {transferTxHash && (
                        <a
                          href={celoscanTxUrl(transferTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[11.5px] text-[#16A34A] underline underline-offset-2"
                        >
                          Transfer sent · View tx
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                      )}
                    </form>
                  )}

                  {repData?.registered && repData.agentId && (
                    <div className="border-t border-black/[0.06] pt-4">
                      <div className="text-[12.5px] font-medium text-[#0A0A0C]">
                        How was your payout?
                      </div>
                      {ratingTxHash ? (
                        <a
                          href={celoscanTxUrl(ratingTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-[#16A34A] hover:underline"
                        >
                          Thanks — rating recorded
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                          <div className="vire-well inline-flex items-center rounded-full p-0.5">
                            {[
                              { label: "Good", val: 85 },
                              { label: "Great", val: 95 },
                              { label: "Instant", val: 100 },
                            ].map((opt) => (
                              <button
                                key={opt.val}
                                type="button"
                                onClick={() => setRatingScore(opt.val)}
                                className={cn(
                                  "vire-pressable rounded-full px-3 py-1 text-[12px] font-medium",
                                  ratingScore === opt.val
                                    ? "bg-[#0A0A0C] text-white"
                                    : "text-[#71717A] hover:text-[#0A0A0C]"
                                )}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={isRatingTxPending}
                            onClick={handleRateOnchain}
                          >
                            {isRatingTxPending ? "Confirming…" : "Submit"}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="border-t border-black/[0.06] pt-3 text-center">
                    <Link
                      href="/ledger"
                      className="inline-flex items-center gap-1 text-[12px] text-[#71717A] transition-colors hover:text-[#0A0A0C]"
                    >
                      View full receipt in public ledger
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              )}

              {result && result.status !== "COMPLETED" && result.status !== "PENDING_REVIEW" && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-[#FEF2F2] p-4 ring-1 ring-[#DC2626]/20">
                    <div className="flex items-center gap-2 text-[13px] font-medium text-[#B91C1C]">
                      <WarningCircle weight="bold" className="h-4 w-4 shrink-0" />
                      <span>
                        {result.policyDecision?.failedRule === "UNIQUE_DELIVERABLE_HASH"
                          ? "Already claimed"
                          : "Could not complete payout"}
                      </span>
                    </div>
                    <p className="mt-1.5 break-words text-[12.5px] leading-relaxed text-[#52525B] [overflow-wrap:anywhere]">
                      {friendlyFailureMessage(result)}
                    </p>
                  </div>
                  <p className="text-[12px] text-[#71717A]">
                    Fix the issue above and try submitting again.
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ClaimFlowWithPrivy({ forcedSlug }: { forcedSlug?: string }) {
  const { login, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { signMessage } = usePrivySignMessage();

  return (
    <ClaimFlowInner
      forcedSlug={forcedSlug}
      onSignIn={() => login()}
      privyWalletAddress={user?.wallet?.address as Address | undefined}
      privyTwitterHandle={user?.twitter?.username ?? null}
      privyGithubHandle={user?.github?.username ?? null}
      privyIdentityToken={identityToken}
      privySignMessage={async (message) => {
        const res = await signMessage({ message });
        return res.signature;
      }}
    />
  );
}

function ClaimPageRouter({ forcedSlug }: { forcedSlug?: string }) {
  const isMiniPay = useIsMiniPay();
  return PRIVY_ENABLED && !isMiniPay ? (
    <ClaimFlowWithPrivy forcedSlug={forcedSlug} />
  ) : (
    <ClaimFlowInner forcedSlug={forcedSlug} />
  );
}

export function ClaimPageClient({ forcedSlug }: { forcedSlug?: string }) {
  return (
    <Suspense
      fallback={
        <div className="grid gap-6 lg:grid-cols-12">
          <Skeleton className="h-96 lg:col-span-7" />
          <Skeleton className="h-96 lg:col-span-5" />
        </div>
      }
    >
      <ClaimPageRouter forcedSlug={forcedSlug} />
    </Suspense>
  );
}
