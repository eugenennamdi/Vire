"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleNotch,
  GithubLogo,
  Signature,
  WarningCircle,
  X,
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
  const initialStageParam = Number(searchParams.get("stage") || "1");
  const validInitialStage =
    Number.isInteger(initialStageParam) && initialStageParam >= 1 && initialStageParam <= 3
      ? initialStageParam
      : 1;

  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync, isPending: isRatingTxPending } = useWriteContract();

  const [selectedSlug, setSelectedSlug] = useState(initialSlug);
  const [stageIndex, setStageIndex] = useState(validInitialStage);
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
    const list = campData?.campaigns;
    if (!list?.length) return;
    if (!selectedSlug || !list.some((c) => c.slug === selectedSlug)) {
      setSelectedSlug(list[0]!.slug);
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
        toast.error(`Rejected: ${json.policyDecision?.failedRule ?? "Policy Gate"}`);
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
      <div className="vire-enter">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Clearing Execution
        </p>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-[-0.035em] text-foreground">
          Submit deliverable
        </h1>
        <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
          Connect an external Celo wallet, bind your handle, and submit proof for exact-output
          settlement.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        {/* Left Action Column */}
        <div className="space-y-5 lg:col-span-7">
          {/* Step 1: Identity Binding */}
          <Card className="vire-enter vire-delay-1 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-xs text-muted-foreground">01</span>
                <h2 className="text-sm font-semibold tracking-[-0.015em] text-foreground">
                  Identity binding
                </h2>
              </div>

              {identityData?.contributor ? (
                <Badge tone="ink">
                  <Check weight="bold" className="h-3 w-3" />
                  {identityData.contributor.identityProvider}: @
                  {identityData.contributor.identityHandle}
                </Badge>
              ) : (
                <Badge tone="neutral">Unlinked</Badge>
              )}
            </div>

            {!isConnected ? (
              <div className="surface-well mt-4 flex items-center gap-2.5 rounded-xl px-4 py-3 text-xs text-muted-foreground">
                <WarningCircle weight="regular" className="h-4 w-4 shrink-0 text-foreground" />
                <span>Connect a Celo Mainnet wallet in the header to bind your identity.</span>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="min-w-0 sm:col-span-4">
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
                      className="w-full"
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
                      Sign in with GitHub OAuth
                    </a>
                  </div>
                )}

                {bindError && (
                  <p className="font-mono text-xs text-destructive" role="alert">
                    {bindError}
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* Step 2: Deliverable Form */}
          <Card className="vire-enter vire-delay-2 p-6">
            <form onSubmit={handleSubmitDeliverable} className="space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-xs text-muted-foreground">02</span>
                <h2 className="text-sm font-semibold tracking-[-0.015em] text-foreground">
                  Deliverable proof
                </h2>
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

              {activeStage && (
                <div className="surface-well rounded-xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-foreground">{activeStage.title}</span>
                    <span className="font-mono font-semibold text-foreground tabular-nums">
                      {activeStage.rewardLocalFormatted} {activeCampaign?.corridor}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
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
                  placeholder="https://github.com/org/repo/pull/42 or https://x.com/handle/status/..."
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
                    placeholder="TECHHUB-BF26"
                    className="font-mono"
                  />
                </div>

                <div className="min-w-0 space-y-1.5">
                  <FieldLabel htmlFor="recipient-wallet">Recipient wallet</FieldLabel>
                  <Input
                    id="recipient-wallet"
                    type="text"
                    readOnly
                    value={address ?? "Connect wallet above"}
                    className="font-mono text-muted-foreground"
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
                    Verifying and settling…
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

        {/* Right Sticky Elevated Execution Trace */}
        <div className="lg:sticky lg:top-20 lg:col-span-5">
          <Card elevated className="vire-enter vire-delay-2 overflow-hidden">
            <div className="border-b border-black/[0.06] bg-[#FAFAFB] px-6 py-3.5">
              <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Execution trace
              </h2>
            </div>

            <div className="p-6">
              {!result && !isSubmitting && (
                <ol className="divide-y divide-black/[0.06]">
                  {[
                    ["01", "x402 verification", "usebuy.ai · Cencori LLM & Chainstack ($0.01)"],
                    ["02", "Policy Gate", "7 deterministic rules + VireVault limits"],
                    ["03", "Textile FX swap", "Exact buyAmount RFQ + ERC-8021 builderCodes"],
                    ["04", "Local payout", "Direct transfer in cNGN / wFIAT / IDRX"],
                    ["05", "Off-ramp & ERC-8004", "Local ramp links + onchain giveFeedback()"],
                  ].map(([num, title, desc]) => (
                    <li key={num} className="flex items-start gap-3.5 py-3.5 first:pt-0 last:pb-0">
                      <span className="mt-0.5 font-mono text-[11px] text-muted-foreground">{num}</span>
                      <div>
                        <div className="text-[13px] font-medium text-foreground">{title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {isSubmitting && (
                <div className="space-y-3">
                  <div className="surface-well flex items-center gap-2.5 rounded-xl p-3.5 text-xs text-foreground">
                    <CircleNotch className="h-4 w-4 animate-spin" />
                    <span>Running x402 verification, Textile quote, and Policy Gate…</span>
                  </div>
                  <Skeleton className="h-20 w-full rounded-xl" />
                  <Skeleton className="h-28 w-full rounded-xl" />
                </div>
              )}

              {result && (
                <div className="space-y-4">
                  <div
                    className={cn(
                      "rounded-xl border p-4 text-xs",
                      result.status === "COMPLETED"
                        ? "border-foreground bg-foreground text-primary-foreground"
                        : "border-destructive/25 bg-destructive/[0.05] text-foreground"
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

                  {result.buyReceipts && result.buyReceipts.length > 0 && (
                    <div className="border-t border-black/[0.06] pt-3.5 text-xs">
                      <div className="font-mono text-[11px] text-muted-foreground">
                        01 · x402 usebuy.ai receipts
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {result.buyReceipts.map((r, i) => (
                          <div key={i} className="flex items-center justify-between font-mono text-[11px]">
                            <span className="text-foreground">{r.capabilityId}</span>
                            {r.paymentTxHash ? (
                              <a
                                href={celoscanTxUrl(r.paymentTxHash)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-foreground underline underline-offset-2"
                              >
                                {truncateMiddle(r.paymentTxHash, 8, 6)}
                                <ArrowUpRight className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-muted-foreground">
                                {r.dryRun ? "dry-run" : "settled"}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {result.policyDecision && (
                    <div className="border-t border-black/[0.06] pt-3.5 text-xs">
                      <div className="font-mono text-[11px] text-muted-foreground">
                        02 · Policy Gate checks
                      </div>
                      <ul className="mt-2 space-y-2">
                        {result.policyDecision.checks.map((chk) => (
                          <li key={chk.rule} className="flex items-start gap-2 text-[11px]">
                            {chk.passed ? (
                              <Check
                                weight="bold"
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground"
                              />
                            ) : (
                              <X
                                weight="bold"
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
                              />
                            )}
                            <div className="min-w-0">
                              <span className="font-mono font-medium text-foreground">
                                {chk.rule}
                              </span>
                              <p className="text-muted-foreground">{chk.detail}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {result.txHashes && (
                    <div className="border-t border-black/[0.06] pt-3.5 text-xs">
                      <div className="font-mono text-[11px] text-muted-foreground">
                        03 &amp; 04 · Onchain settlement proofs
                      </div>
                      <div className="mt-2.5 space-y-2 font-mono text-[11px]">
                        {[
                          ["Vault Release", result.txHashes.vaultRelease],
                          ["Textile Swap", result.txHashes.textileSwap],
                          ["Local Payout", result.txHashes.localPayout],
                          ["Audit Receipt", result.txHashes.vaultReceipt],
                        ].map(([label, hash]) => (
                          <div key={label} className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">{label}</span>
                            <div className="flex items-center gap-1.5">
                              <a
                                href={celoscanTxUrl(hash!)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-2"
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

                  {result.offramp && (
                    <div className="border-t border-black/[0.06] pt-3.5 text-xs">
                      <div className="font-mono text-[11px] text-muted-foreground">
                        05 · Off-ramp &amp; ERC-8004 rating
                      </div>
                      <h3 className="mt-1 text-sm font-medium text-foreground">
                        {result.offramp.headline}
                      </h3>
                      <ul className="mt-2 space-y-1 text-muted-foreground">
                        {result.offramp.instructions.map((line, idx) => (
                          <li key={idx}>· {line}</li>
                        ))}
                      </ul>

                      <div className="surface-well mt-3 flex items-center justify-between gap-2 rounded-lg px-3 py-2 font-mono text-[11px]">
                        <span className="truncate text-muted-foreground">
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
                            className={buttonVariants({ variant: "secondary", size: "sm" })}
                          >
                            {v.name}
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </a>
                        ))}
                      </div>

                      <div className="mt-4 border-t border-black/[0.06] pt-3.5">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">
                            Rate onchain (ERC-8004)
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            tag: settlement
                          </span>
                        </div>

                        {ratingTxHash ? (
                          <a
                            href={celoscanTxUrl(ratingTxHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 font-mono text-xs text-foreground underline underline-offset-2"
                          >
                            Confirmed: {truncateMiddle(ratingTxHash, 10, 6)}
                            <ArrowUpRight className="h-3 w-3" />
                          </a>
                        ) : repData?.registered && repData.agentId ? (
                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            <div className="inline-flex items-center gap-0.5 rounded-full bg-black/[0.045] p-0.5">
                              {[80, 90, 95, 100].map((val) => (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => setRatingScore(val)}
                                  className={cn(
                                    "vire-pressable rounded-full px-2.5 py-1 font-mono text-[11px]",
                                    ratingScore === val
                                      ? "bg-foreground text-primary-foreground"
                                      : "text-muted-foreground hover:text-foreground"
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
                              {isRatingTxPending ? "Confirm in wallet…" : "Submit giveFeedback()"}
                            </Button>
                          </div>
                        ) : (
                          <p className="mt-1.5 text-[11px] text-muted-foreground">
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
          <Skeleton className="h-96 rounded-2xl lg:col-span-7" />
          <Skeleton className="h-96 rounded-2xl lg:col-span-5" />
        </div>
      }
    >
      <ClaimFlowInner />
    </Suspense>
  );
}
