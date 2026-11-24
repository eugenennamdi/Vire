"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleNotch,
  GithubLogo,
  PaperPlaneTilt,
  Signature,
  WarningCircle,
} from "@phosphor-icons/react";
import { usePrivy, useSignMessage as usePrivySignMessage } from "@privy-io/react-auth";
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
import { erc20Abi, getAddress, isAddress, parseUnits, zeroHash, type Address } from "viem";
import { useAccount, useConnect, useSignMessage, useWriteContract } from "wagmi";
import { celo } from "wagmi/chains";
import { useIsMiniPay } from "@/components/providers";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfettiBurst } from "@/components/ui/confetti-burst";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { TokenIcon } from "@/components/ui/token-icon";
import { buildIdentityBindMessage } from "@/lib/session-client";
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
  onSignIn?: () => void;
  privyWalletAddress?: Address;
  privyTwitterHandle?: string | null;
  privyGithubHandle?: string | null;
  privySignMessage?: (message: string) => Promise<string>;
}

function ClaimFlowInner({
  onSignIn,
  privyWalletAddress,
  privyTwitterHandle,
  privyGithubHandle,
  privySignMessage,
}: PrivyBridgeProps) {
  const searchParams = useSearchParams();
  const initialSlug = searchParams.get("campaign") || "";
  const initialStageParam = Number(searchParams.get("stage") || "1");
  const validInitialStage =
    Number.isInteger(initialStageParam) && initialStageParam >= 1 && initialStageParam <= 3
      ? initialStageParam
      : 1;

  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync, isPending: isRatingTxPending } = useWriteContract();

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
  const [deliverableNotes, setDeliverableNotes] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [bindError, setBindError] = useState<string | null>(null);
  const [isBinding, setIsBinding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<SubmissionResponse | null>(null);
  const [confettiKey, setConfettiKey] = useState<string | null>(null);
  const [cashOutOpen, setCashOutOpen] = useState(false);
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

  const { data: identityData, refetch: refetchIdentity } = useQuery({
    queryKey: ["identity-status", address],
    queryFn: async () => {
      const q = address ? `?wallet=${encodeURIComponent(address)}` : "";
      const r = await fetch(`/api/identity/status${q}`);
      return (await r.json()) as {
        githubSession: { login: string; profileUrl: string } | null;
        githubOAuthConfigured: boolean;
        contributor: {
          identityProvider: string;
          identityHandle: string;
          identityProfileUrl: string;
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
    const list = campData?.campaigns;
    if (!list?.length) return;
    if (!selectedSlug || !list.some((c) => c.slug === selectedSlug)) {
      setSelectedSlug(list[0]!.slug);
    }
  }, [campData, selectedSlug]);

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

  const activeCampaign = campData?.campaigns.find((c) => c.slug === selectedSlug);
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
    // Only auto-select when the campaign or contributor's completed stage count changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlug, expectedNextStage, hasExplicitStageParam, Boolean(activeCampaign)]);

  const profileLinked = Boolean(identityData?.contributor);
  const stageMismatchNote =
    activeCampaign && expectedNextStage <= activeCampaign.stages.length && stageIndex !== expectedNextStage
      ? `Complete Stage ${expectedNextStage} first before submitting Stage ${stageIndex}.`
      : null;

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
      const message = buildIdentityBindMessage({
        walletAddress: address,
        provider,
        handle: cleanHandle,
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
        }),
      });
      const json = (await res.json()) as { verified?: boolean; error?: string; handle?: string };
      if (!res.ok) {
        const msg = json.error ?? "Identity verification failed.";
        setBindError(msg);
        toast.error(msg);
      } else {
        toast.success(`Identity @${json.handle} bound to ${truncateMiddle(address, 6, 4)}`);
        await refetchIdentity();
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
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignSlug: selectedSlug,
          stageIndex,
          contributorWallet: address,
          deliverableUrl: deliverableUrl.trim(),
          deliverableNotes: deliverableNotes.trim(),
          referralCode: referralCode.trim() || undefined,
        }),
      });
      const json = (await res.json()) as SubmissionResponse;
      setResult(json);
      setCashOutOpen(false);
      setTransferOpen(false);
      setTransferError(null);
      setTransferTxHash(null);
      if (json.status === "COMPLETED") {
        const paidLabel = activeStage && activeCampaign
          ? `${activeStage.rewardLocalFormatted} ${activeCampaign.corridor}`
          : activeCampaign?.corridor ?? "your payout";
        setConfettiKey(json.txHashes?.localPayout ?? String(Date.now()));
        if (json.offramp?.humanAmount) {
          setTransferAmount(json.offramp.humanAmount);
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
        void refetchIdentity();
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
      const msg = err instanceof Error ? err.message : "Transfer cancelled.";
      setTransferError(msg.slice(0, 140));
    } finally {
      setIsTransferring(false);
    }
  }

  function friendlyFailureMessage(res: SubmissionResponse): string {
    const rule = res.policyDecision?.failedRule;
    if (rule === "UNIQUE_DELIVERABLE_HASH") {
      return "This post link has already been claimed.";
    }
    if (rule === "VERIFIED_EXTERNAL_IDENTITY") {
      return res.policyDecision?.failedReason?.includes("team")
        ? "This wallet is restricted to team administration. Please sign in with a personal wallet or social account."
        : "Please link your profile in Step 01 before submitting.";
    }
    if (rule === "STAGE_CAP_AND_COOLDOWN") {
      return res.policyDecision?.failedReason || "This stage isn't unlocked yet.";
    }
    if (rule === "CAMPAIGN_ACTIVE_AND_FUNDED") {
      return "This campaign's active pool doesn't have enough funds left for another payout right now.";
    }
    if (rule === "VERIFICATION_SCORE_THRESHOLD") {
      return res.verdict?.reason || "Your post didn't meet all campaign requirements yet.";
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

      <div className="vire-enter">
        <h1 className="text-[28px] font-medium tracking-[-0.03em] text-[#0A0A0C]">
          Submit work
        </h1>
        <p className="mt-1 max-w-[60ch] text-[14px] leading-relaxed text-[#71717A]">
          Sign in with Google, email, or a Celo wallet, link your profile, and submit your link to
          get automatically verified and paid in local currency.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        {/* Left Action Column */}
        <div className="min-w-0 space-y-5 lg:col-span-7">
          {/* Step 1: Link Profile */}
          <Card className="vire-enter vire-delay-1 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[12px] text-[#A1A1AA]">01</span>
                <h2 className="text-[15px] font-medium text-[#0A0A0C]">Link your profile</h2>
              </div>

              {identityData?.contributor ? (
                <Badge tone="positive">
                  <Check weight="bold" className="h-3 w-3" />
                  {identityData.contributor.identityProvider}: @
                  {identityData.contributor.identityHandle}
                </Badge>
              ) : (
                <Badge tone="neutral">Not linked</Badge>
              )}
            </div>

            {!isSignedIn ? (
              <div className="vire-well mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-[13px] text-[#52525B]">
                <div className="flex items-center gap-2.5">
                  <WarningCircle weight="regular" className="h-4 w-4 shrink-0 text-[#0A0A0C]" />
                  <span>Sign in to link your profile and receive payouts.</span>
                </div>
                <Button type="button" size="sm" variant="primary" onClick={triggerSignIn}>
                  Sign in
                </Button>
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
                      className="h-10 w-full"
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
          <Card className="vire-enter vire-delay-2 p-6">
            <form onSubmit={handleSubmitDeliverable} className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-[12px] text-[#A1A1AA]">02</span>
                  <h2 className="text-[15px] font-medium text-[#0A0A0C]">Work proof</h2>
                </div>
                {activeCampaign && (
                  <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-[#52525B]">
                    <TokenIcon symbol={activeCampaign.corridor} size={18} />
                    {activeCampaign.corridor}
                  </span>
                )}
              </div>

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
                    {(campData?.campaigns ?? []).map((c) => (
                      <option key={c.slug} value={c.slug}>
                        [{c.corridor}] {c.title}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="min-w-0 space-y-1.5">
                  <FieldLabel htmlFor="claim-stage">Stage</FieldLabel>
                  <Select
                    id="claim-stage"
                    value={stageIndex}
                    onChange={(e) => setStageIndex(Number(e.target.value))}
                  >
                    {(activeCampaign?.stages ?? []).map((s) => (
                      <option key={s.stageIndex} value={s.stageIndex}>
                        Stage {s.stageIndex} — {s.rewardLocalFormatted} {activeCampaign?.corridor}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              {activeStage && activeCampaign && (
                <div className="vire-well rounded-xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <span className="font-medium text-[#0A0A0C]">{activeStage.title}</span>
                    <span className="inline-flex items-center gap-1.5 font-mono font-medium text-[#0A0A0C] tabular-nums">
                      <TokenIcon symbol={activeCampaign.corridor} size={16} />
                      {activeStage.rewardLocalFormatted} {activeCampaign.corridor}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#52525B]">
                    {activeStage.instructions}
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <FieldLabel htmlFor="deliverable-url">Proof URL</FieldLabel>
                <Input
                  id="deliverable-url"
                  type="url"
                  required
                  value={deliverableUrl}
                  onChange={(e) => setDeliverableUrl(e.target.value)}
                  placeholder="Paste X post or GitHub URL"
                  className="font-mono"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <FieldLabel htmlFor="referral-code">Referral code (optional)</FieldLabel>
                  <Input
                    id="referral-code"
                    type="text"
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value)}
                    placeholder="SWOT-BF26"
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
                  placeholder="Short summary of work completed or handle tagged."
                />
              </div>

              {stageMismatchNote && (
                <div className="rounded-xl bg-[#FEF2F2] px-3.5 py-2.5 text-[12px] text-[#B91C1C] ring-1 ring-[#DC2626]/20">
                  {stageMismatchNote}
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                variant="primary"
                disabled={!isSignedIn || !profileLinked || isSubmitting}
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <CircleNotch className="h-4 w-4 animate-spin" />
                    Verifying and paying…
                  </>
                ) : isSignedIn && !profileLinked ? (
                  <>Link your profile in Step 01 first</>
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
            <div className="flex items-center justify-between rounded-t-2xl border-b border-black/[0.06] bg-[#FAFAFB] px-6 py-3.5">
              <h2 className="text-[13px] font-medium text-[#0A0A0C]">
                {result?.status === "COMPLETED" ? "Payout receipt" : "How payout works"}
              </h2>
              {activeCampaign && (
                <div className="flex items-center gap-1.5">
                  <TokenIcon symbol="USDT" size={16} />
                  <ArrowRight className="h-3 w-3 text-[#A1A1AA]" />
                  <TokenIcon symbol={activeCampaign.corridor} size={16} />
                </div>
              )}
            </div>

            <div className="p-6">
              {!result && !isSubmitting && (
                <ol className="divide-y divide-black/[0.06]">
                  {[
                    ["01", "Automatic check", "Reviews your post against the campaign requirements"],
                    ["02", "Safety & limits", "Confirms uniqueness and available campaign budget"],
                    ["03", "Local currency swap", "Converts USDT into your exact local payout"],
                    ["04", "Direct transfer", "Sends local currency straight to your wallet"],
                    ["05", "Cash out", "Withdraw directly to your local bank or wallet"],
                  ].map(([num, title, desc]) => (
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
                    <span>Reviewing your link, checking limits, and locking exchange rate…</span>
                  </div>
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-28 w-full" />
                </div>
              )}

              {result && result.status === "COMPLETED" && (
                <div className="space-y-5">
                  {/* Celebratory Success Hero — crisp, calm, zero jargon */}
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

                  {/* Primary Cash-Out CTA Dropdown */}
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
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setCashOutOpen(false);
                              setTransferOpen(true);
                            }}
                            className="flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors hover:bg-[#F5F5F7]"
                          >
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium text-[#0A0A0C]">
                                Send to wallet or exchange
                              </div>
                              <div className="truncate text-[11.5px] text-[#71717A]">
                                Transfer {activeCampaign?.corridor} straight to MiniPay, Busha, or Quidax
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
                                <div className="truncate text-[11.5px] text-[#71717A]">
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

                  {/* Inline Direct Transfer Form (triggered from Cash Out dropdown) */}
                  {transferOpen && activeCampaign && (
                    <form
                      onSubmit={handleTransferPayout}
                      className="vire-well space-y-2.5 rounded-xl p-4"
                    >
                      <div className="flex items-center justify-between text-[12px] font-medium text-[#0A0A0C]">
                        <span>Send {activeCampaign.corridor}</span>
                        <button
                          type="button"
                          onClick={() => setTransferOpen(false)}
                          className="text-[11.5px] font-normal text-[#71717A] hover:text-[#0A0A0C]"
                        >
                          Close
                        </button>
                      </div>
                      <Input
                        type="text"
                        value={transferTo}
                        onChange={(e) => setTransferTo(e.target.value)}
                        placeholder="Paste MiniPay, Busha, or Quidax 0x… address"
                        className="h-9 bg-white font-mono text-[12px]"
                      />
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={transferAmount}
                          onChange={(e) => setTransferAmount(e.target.value)}
                          placeholder="Amount"
                          className="h-9 bg-white font-mono text-[12px]"
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

                  {/* Subtle Optional Rating */}
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

                  {/* Quiet link to Public Ledger for full technical audit trail */}
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

              {result && result.status !== "COMPLETED" && (
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
                    Fix the issue above and click <span className="font-medium text-[#0A0A0C]">Verify &amp; get paid</span> again.
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

function ClaimFlowWithPrivy() {
  const { login, user } = usePrivy();
  const { signMessage } = usePrivySignMessage();

  return (
    <ClaimFlowInner
      onSignIn={() => login()}
      privyWalletAddress={user?.wallet?.address as Address | undefined}
      privyTwitterHandle={user?.twitter?.username ?? null}
      privyGithubHandle={user?.github?.username ?? null}
      privySignMessage={async (message) => {
        const res = await signMessage({ message });
        return res.signature;
      }}
    />
  );
}

function ClaimPageRouter() {
  const isMiniPay = useIsMiniPay();
  return PRIVY_ENABLED && !isMiniPay ? <ClaimFlowWithPrivy /> : <ClaimFlowInner />;
}

export default function ClaimPage() {
  return (
    <Suspense
      fallback={
        <div className="grid gap-6 lg:grid-cols-12">
          <Skeleton className="h-96 lg:col-span-7" />
          <Skeleton className="h-96 lg:col-span-5" />
        </div>
      }
    >
      <ClaimPageRouter />
    </Suspense>
  );
}
