"use client";

import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle,
  CircleNotch,
  GithubLogo,
  ShieldCheck,
  Signature,
  Star,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
  CELO_CONTRACTS,
  celoscanTxUrl,
  type BuyPaymentReceipt,
  type OfframpPackage,
  type PolicyGateDecision,
  type VerificationVerdict,
} from "@vire/shared";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { zeroHash } from "viem";
import { useAccount, useSignMessage, useWriteContract } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
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
  };
  refundTxHash?: string;
  offramp?: OfframpPackage;
  error?: string;
}

function ClaimFlowInner() {
  const searchParams = useSearchParams();
  const initialSlug = searchParams.get("campaign") || "";
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync, isPending: isRatingTxPending } = useWriteContract();

  const [selectedSlug, setSelectedSlug] = useState(initialSlug);
  const [stageIndex, setStageIndex] = useState(1);
  const [provider, setProvider] = useState<"github" | "x" | "signed_proof">("github");
  const [handle, setHandle] = useState("");
  const [deliverableUrl, setDeliverableUrl] = useState("");
  const [deliverableNotes, setDeliverableNotes] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [bindError, setBindError] = useState<string | null>(null);
  const [isBinding, setIsBinding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<SubmissionResponse | null>(null);
  const [ratingTxHash, setRatingTxHash] = useState<string | null>(null);
  const [ratingScore, setRatingScore] = useState(95);

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
    if (!selectedSlug && campData?.campaigns?.[0]?.slug) {
      setSelectedSlug(campData.campaigns[0].slug);
    }
  }, [campData, selectedSlug]);

  useEffect(() => {
    if (identityData?.githubSession?.login && !handle) {
      setProvider("github");
      setHandle(identityData.githubSession.login);
    }
  }, [identityData, handle]);

  const activeCampaign = campData?.campaigns.find((c) => c.slug === selectedSlug);
  const activeStage =
    activeCampaign?.stages.find((s) => s.stageIndex === stageIndex) ?? activeCampaign?.stages[0];

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
      const signature = await signMessageAsync({ message });
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
      if (json.status === "COMPLETED") {
        toast.success(`Exact ${activeCampaign?.corridor ?? "FX"} payout settled on Celo Mainnet`);
      } else if (json.status === "REJECTED") {
        toast.error(`Claim rejected by Policy Gate: ${json.policyDecision?.failedRule ?? "rule triggered"}`);
      } else if (json.error) {
        toast.message(json.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error submitting deliverable.";
      setResult({ status: "FAILED", error: msg });
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
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
      toast.success("ERC-8004 reputation feedback recorded on Celo Mainnet");
      if (result?.submissionId) {
        await fetch("/api/reputation/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submissionId: result.submissionId, feedbackTxHash: hash }),
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ERC-8004 feedback transaction rejected");
    }
  }

  return (
    <div className="space-y-8">
      <div className="vire-enter">
        <h1 className="text-3xl font-semibold tracking-[-0.035em] text-[#F4F5F6]">
          Submit deliverable &amp; claim local FX
        </h1>
        <p className="mt-1.5 max-w-[62ch] text-sm text-[#8A8F98]">
          Connect an external Celo wallet (MetaMask, Rabby, or MiniPay), bind your social or dev
          handle, and submit proof of work for exact-output clearing.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        {/* Left Action Column */}
        <div className="space-y-5 lg:col-span-7">
          {/* Step 1: Identity Binding */}
          <Card className="vire-enter vire-delay-1 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.1] bg-[#15181D] font-mono text-xs text-[#E5E7EB]">
                  1
                </span>
                <h2 className="text-sm font-medium text-[#F4F5F6]">
                  External identity binding
                </h2>
              </div>

              {identityData?.contributor ? (
                <Badge tone="emerald">
                  <CheckCircle weight="fill" className="h-3.5 w-3.5" />
                  {identityData.contributor.identityProvider}: @
                  {identityData.contributor.identityHandle}
                </Badge>
              ) : (
                <Badge tone="amber">Unlinked</Badge>
              )}
            </div>

            {!isConnected ? (
              <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3.5 py-3 text-xs text-amber-200">
                <WarningCircle weight="regular" className="h-4 w-4 shrink-0 text-amber-400" />
                <span>Connect an external Celo Mainnet wallet in the top navigation bar first.</span>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="grid gap-2.5 sm:grid-cols-12">
                  <div className="sm:col-span-4">
                    <FieldLabel htmlFor="identity-provider" className="mb-1.5">
                      Provider
                    </FieldLabel>
                    <Select
                      id="identity-provider"
                      value={provider}
                      onChange={(e) => setProvider(e.target.value as "github" | "x" | "signed_proof")}
                    >
                      <option value="github">GitHub</option>
                      <option value="x">X (Twitter)</option>
                      <option value="signed_proof">Wallet Proof</option>
                    </Select>
                  </div>

                  <div className="sm:col-span-5">
                    <FieldLabel htmlFor="identity-handle" className="mb-1.5">
                      Public handle
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
                      className="w-full"
                    >
                      <Signature weight="regular" className="h-3.5 w-3.5" />
                      {isBinding ? "Signing…" : "Sign EIP-191"}
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
                      Authenticate with GitHub OAuth
                    </a>
                  </div>
                )}

                {bindError && (
                  <p className="text-xs text-rose-400" role="alert">
                    {bindError}
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* Step 2: Deliverable Form */}
          <Card className="vire-enter vire-delay-2 p-5">
            <form onSubmit={handleSubmitDeliverable} className="space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.1] bg-[#15181D] font-mono text-xs text-[#E5E7EB]">
                  2
                </span>
                <h2 className="text-sm font-medium text-[#F4F5F6]">
                  Deliverable proof &amp; mission stage
                </h2>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
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

                <div className="space-y-1.5">
                  <FieldLabel htmlFor="claim-stage">Mission stage</FieldLabel>
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

              {activeStage && (
                <div className="rounded-lg border border-white/[0.07] bg-[#0B0D10] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-[#F4F5F6]">{activeStage.title}</span>
                    <span className="font-mono font-semibold text-emerald-400 tabular-nums">
                      Exact output: {activeStage.rewardLocalFormatted} {activeCampaign?.corridor}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#8A8F98]">
                    {activeStage.instructions}
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <FieldLabel htmlFor="deliverable-url">
                  Deliverable proof URL (public promo post, GitHub PR/issue, or referral proof)
                </FieldLabel>
                <Input
                  id="deliverable-url"
                  type="url"
                  required
                  value={deliverableUrl}
                  onChange={(e) => setDeliverableUrl(e.target.value)}
                  placeholder="https://github.com/org/repo/pull/42 or https://x.com/handle/status/..."
                  className="font-mono"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <FieldLabel htmlFor="referral-code">Referral / affiliate code (optional)</FieldLabel>
                  <Input
                    id="referral-code"
                    type="text"
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value)}
                    placeholder="TECHHUB-BF26"
                    className="font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <FieldLabel htmlFor="recipient-wallet">Recipient wallet (Celo 42220)</FieldLabel>
                  <Input
                    id="recipient-wallet"
                    type="text"
                    readOnly
                    value={address ?? "Connect wallet above"}
                    className="font-mono text-[#8A8F98]"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <FieldLabel htmlFor="deliverable-notes">Evidence notes (optional)</FieldLabel>
                <Textarea
                  id="deliverable-notes"
                  rows={2}
                  value={deliverableNotes}
                  onChange={(e) => setDeliverableNotes(e.target.value)}
                  placeholder="Short summary of deliverable, store handle tagged, or QA reproduction notes..."
                />
              </div>

              <Button
                type="submit"
                size="lg"
                variant="primary"
                disabled={!isConnected || isSubmitting}
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <CircleNotch className="h-4 w-4 animate-spin" />
                    Verifying via x402 &amp; clearing FX…
                  </>
                ) : (
                  <>
                    Verify &amp; settle exact local FX
                    <ArrowRight weight="bold" className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </Card>
        </div>

        {/* Right Sticky Execution Inspector */}
        <div className="lg:sticky lg:top-20 lg:col-span-5">
          <Card elevated className="vire-enter vire-delay-2 overflow-hidden">
            <div className="border-b border-white/[0.07] bg-[#0C0E11] px-5 py-3.5">
              <h2 className="text-xs font-medium text-[#F4F5F6]">
                Autonomous settlement pipeline
              </h2>
              <p className="mt-0.5 text-[11px] text-[#6B7280]">
                Live execution trace across x402 usebuy.ai, Policy Gate, Textile FX v2, and Celo mainnet.
              </p>
            </div>

            <div className="p-5">
              {!result && !isSubmitting && (
                <div className="space-y-3 py-3">
                  {[
                    ["01", "Paid x402 verification", "usebuy.ai · Cencori LLM & Chainstack ($0.01)"],
                    ["02", "7-rule Policy Gate", "Replay, non-team wallet, spread, $1 floor"],
                    ["03", "Textile FX exact-output swap", "buyAmount RFQ + ERC-8021 builderCodes"],
                    ["04", "Direct local stablecoin transfer", "cNGN / wARS / wBRL / wMXN / IDRX"],
                    ["05", "Off-ramp & ERC-8004 feedback", "Ripio / Busha / IDRX + giveFeedback()"],
                  ].map(([num, title, desc]) => (
                    <div
                      key={num}
                      className="flex items-start gap-3 rounded-lg border border-white/[0.05] bg-[#0B0D10]/70 px-3.5 py-2.5"
                    >
                      <span className="mt-0.5 font-mono text-[11px] text-[#5C626D]">{num}</span>
                      <div>
                        <div className="text-xs font-medium text-[#D5D8DE]">{title}</div>
                        <div className="text-[11px] text-[#6B7280]">{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {isSubmitting && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-3.5 text-xs text-emerald-200">
                    <CircleNotch className="h-4 w-4 animate-spin text-emerald-400" />
                    <span>Running x402 verification, live Textile preview, and Policy Gate…</span>
                  </div>
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-32 w-full" />
                </div>
              )}

              {result && (
                <div className="space-y-4">
                  {/* Status Banner */}
                  <div
                    className={cn(
                      "rounded-lg border p-3.5 text-xs",
                      result.status === "COMPLETED"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                        : result.status === "REJECTED"
                          ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                    )}
                  >
                    <div className="flex items-center justify-between font-mono text-[11px] font-semibold">
                      <span>STATUS · {result.status}</span>
                      {result.verdict && <span>SCORE {result.verdict.score}/100</span>}
                    </div>
                    {result.error && <p className="mt-1.5 leading-relaxed">{result.error}</p>}
                    {result.policyDecision?.failedReason && (
                      <p className="mt-1.5 font-medium">
                        {result.policyDecision.failedRule}: {result.policyDecision.failedReason}
                      </p>
                    )}
                  </div>

                  {/* Step 1: buy Receipts */}
                  {result.buyReceipts && result.buyReceipts.length > 0 && (
                    <div className="rounded-lg border border-white/[0.07] bg-[#0B0D10] p-3.5 text-xs">
                      <div className="font-mono text-[11px] font-medium text-[#8A8F98]">
                        01 · x402 usebuy.ai receipts
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {result.buyReceipts.map((r, i) => (
                          <div key={i} className="flex items-center justify-between font-mono text-[11px]">
                            <span className="text-[#D5D8DE]">{r.capabilityId}</span>
                            {r.paymentTxHash ? (
                              <a
                                href={celoscanTxUrl(r.paymentTxHash)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                              >
                                {truncateMiddle(r.paymentTxHash, 8, 6)}
                                <ArrowUpRight className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-[#6B7280]">{r.dryRun ? "dry-run" : "settled"}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Step 2: 7-Rule Policy Gate */}
                  {result.policyDecision && (
                    <div className="rounded-lg border border-white/[0.07] bg-[#0B0D10] p-3.5 text-xs">
                      <div className="font-mono text-[11px] font-medium text-[#8A8F98]">
                        02 · 7-rule deterministic Policy Gate
                      </div>
                      <ul className="mt-2.5 space-y-2">
                        {result.policyDecision.checks.map((chk) => (
                          <li key={chk.rule} className="flex items-start gap-2 text-[11px]">
                            {chk.passed ? (
                              <CheckCircle
                                weight="fill"
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400"
                              />
                            ) : (
                              <XCircle
                                weight="fill"
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400"
                              />
                            )}
                            <div className="min-w-0">
                              <span className="font-mono font-medium text-[#E5E7EB]">{chk.rule}</span>
                              <p className="text-[#8A8F98]">{chk.detail}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Steps 3 & 4: Settlement Hashes */}
                  {result.txHashes && (
                    <div className="rounded-lg border border-emerald-500/25 bg-[#0B0D10] p-3.5 text-xs">
                      <div className="font-mono text-[11px] font-medium text-emerald-400">
                        03 &amp; 04 · Mainnet settlement proofs
                      </div>
                      <div className="mt-2.5 space-y-2 font-mono text-[11px]">
                        {[
                          ["Vault Release", result.txHashes.vaultRelease],
                          ["Textile Swap", result.txHashes.textileSwap],
                          ["Local Payout", result.txHashes.localPayout],
                          ["Audit Receipt", result.txHashes.vaultReceipt],
                        ].map(([label, hash]) => (
                          <div key={label} className="flex items-center justify-between gap-2">
                            <span className="text-[#8A8F98]">{label}</span>
                            <div className="flex items-center gap-1.5">
                              <a
                                href={celoscanTxUrl(hash!)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-0.5 text-emerald-300 hover:underline"
                              >
                                {truncateMiddle(hash!, 8, 6)}
                                <ArrowUpRight className="h-3 w-3" />
                              </a>
                              <CopyButton value={hash!} toastMessage={`${label} hash copied`} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Step 5: Off-Ramp & ERC-8004 Rating */}
                  {result.offramp && (
                    <div className="rounded-lg border border-white/[0.09] bg-[#12151A] p-4 text-xs">
                      <div className="font-mono text-[11px] text-[#8A8F98]">
                        05 · Last-mile off-ramp
                      </div>
                      <h3 className="mt-1 text-sm font-medium text-[#F4F5F6]">
                        {result.offramp.headline}
                      </h3>
                      <ul className="mt-2 space-y-1 text-[#9DA3AE]">
                        {result.offramp.instructions.map((line, idx) => (
                          <li key={idx}>• {line}</li>
                        ))}
                      </ul>

                      <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-white/[0.08] bg-[#0B0D10] px-2.5 py-1.5 font-mono text-[11px]">
                        <span className="truncate text-[#B4BAC5]">
                          {result.offramp.tokenDecimals}dp · {result.offramp.tokenAddress}
                        </span>
                        <CopyButton
                          value={result.offramp.tokenAddress}
                          label="Copy"
                          toastMessage="Token contract address copied"
                        />
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {result.offramp.venues.map((v) => (
                          <a
                            key={v.name}
                            href={v.url}
                            target="_blank"
                            rel="noreferrer"
                            className={buttonVariants({ variant: "emerald", size: "sm" })}
                          >
                            {v.name}
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </a>
                        ))}
                      </div>

                      {/* 1-Click ERC-8004 Reputation Feedback */}
                      <div className="mt-4 border-t border-white/[0.08] pt-3.5">
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5 font-medium text-[#F4F5F6]">
                            <ShieldCheck weight="fill" className="h-3.5 w-3.5 text-emerald-400" />
                            Rate Vire onchain (ERC-8004)
                          </span>
                          <span className="font-mono text-[10px] text-[#6B7280]">tag: settlement</span>
                        </div>

                        {ratingTxHash ? (
                          <a
                            href={celoscanTxUrl(ratingTxHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 font-mono text-xs text-emerald-400 hover:underline"
                          >
                            Feedback confirmed: {truncateMiddle(ratingTxHash, 10, 6)}
                            <ArrowUpRight className="h-3 w-3" />
                          </a>
                        ) : repData?.registered && repData.agentId ? (
                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            <div className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-[#0B0D10] p-0.5">
                              {[80, 90, 95, 100].map((val) => (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => setRatingScore(val)}
                                  className={cn(
                                    "vire-pressable rounded px-2 py-1 font-mono text-[11px]",
                                    ratingScore === val
                                      ? "bg-white/[0.12] text-[#F4F5F6]"
                                      : "text-[#8A8F98] hover:text-[#F4F5F6]"
                                  )}
                                >
                                  {val}
                                </button>
                              ))}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="primary"
                              disabled={isRatingTxPending}
                              onClick={handleRateOnchain}
                            >
                              <Star weight="fill" className="h-3.5 w-3.5 text-amber-500" />
                              {isRatingTxPending ? "Confirm in wallet…" : "Submit giveFeedback()"}
                            </Button>
                          </div>
                        ) : (
                          <p className="mt-1.5 text-[11px] text-[#6B7280]">
                            Agent registration ID pending configuration.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
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
      <ClaimFlowInner />
    </Suspense>
  );
}
