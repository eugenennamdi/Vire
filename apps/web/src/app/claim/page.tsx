"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CELO_CONTRACTS,
  celoscanTxUrl,
  type BuyPaymentReceipt,
  type OfframpPackage,
  type PolicyGateDecision,
  type VerificationVerdict,
} from "@vire/shared";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Github,
  Loader2,
  ShieldCheck,
  Star,
  XCircle,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { zeroHash } from "viem";
import { useAccount, useSignMessage, useWriteContract } from "wagmi";
import { buildIdentityBindMessage } from "@/lib/session-client";

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
  const [bindStatus, setBindStatus] = useState<string | null>(null);
  const [isBinding, setIsBinding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<SubmissionResponse | null>(null);
  const [ratingTxHash, setRatingTxHash] = useState<string | null>(null);
  const [ratingScore, setRatingScore] = useState(95);
  const [copiedAddr, setCopiedAddr] = useState(false);

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
      setBindStatus("Enter your GitHub or X handle before signing.");
      return;
    }
    setIsBinding(true);
    setBindStatus(null);
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
        setBindStatus(json.error ?? "Identity verification failed.");
      } else {
        setBindStatus(`Verified @${json.handle} bound to ${address.slice(0, 8)}…`);
        await refetchIdentity();
      }
    } catch (err) {
      setBindStatus(err instanceof Error ? err.message : "Signature cancelled");
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
    } catch (err) {
      setResult({
        status: "FAILED",
        error: err instanceof Error ? err.message : "Network error submitting deliverable",
      });
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
      if (result?.submissionId) {
        await fetch("/api/reputation/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submissionId: result.submissionId, feedbackTxHash: hash }),
        });
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "ERC-8004 giveFeedback cancelled or reverted");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Left Column: Contributor Form */}
      <div className="space-y-5 lg:col-span-7">
        <div>
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Autonomous Contributor Settlement
          </span>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">
            Submit Deliverable &amp; Claim Local FX
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Connect an external Celo wallet (MetaMask, Rabby, or MiniPay), bind your identity, and submit
            your proof of work for instant exact-output local stablecoin clearing.
          </p>
        </div>

        {/* Step 1: Identity Binding */}
        <section className="rounded-2xl border border-zinc-200/90 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-950">
              1. External Identity Binding (Anti-Sybil)
            </h2>
            {identityData?.contributor ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 font-mono text-xs font-medium text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {identityData.contributor.identityProvider}: @{identityData.contributor.identityHandle}
              </span>
            ) : (
              <span className="font-mono text-xs text-amber-700">Not linked yet</span>
            )}
          </div>

          {!isConnected ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Connect your Celo Mainnet wallet from the top-right navigation bar first.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {identityData?.githubOAuthConfigured && (
                  <a
                    href="/api/auth/github"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-100"
                  >
                    <Github className="h-3.5 w-3.5" />
                    Sign in with GitHub OAuth
                  </a>
                )}
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as "github" | "x" | "signed_proof")}
                  className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-900"
                >
                  <option value="github">GitHub Handle</option>
                  <option value="x">X (Twitter) Handle</option>
                  <option value="signed_proof">Wallet Handle Proof</option>
                </select>
                <input
                  type="text"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="@yourhandle"
                  className="min-w-[160px] flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 font-mono text-xs text-zinc-950 focus:border-zinc-900 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isBinding}
                  onClick={handleBindIdentity}
                  className="rounded-lg bg-zinc-950 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {isBinding ? "Signing…" : "Sign EIP-191 Proof"}
                </button>
              </div>
              {bindStatus && <p className="font-mono text-xs text-zinc-600">{bindStatus}</p>}
            </div>
          )}
        </section>

        {/* Step 2: Deliverable Submission */}
        <form
          onSubmit={handleSubmitDeliverable}
          className="space-y-4 rounded-2xl border border-zinc-200/90 bg-white p-5"
        >
          <h2 className="text-sm font-semibold text-zinc-950">2. Deliverable Proof &amp; Corridor</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-zinc-700">Campaign</label>
              <select
                value={selectedSlug}
                onChange={(e) => {
                  setSelectedSlug(e.target.value);
                  setStageIndex(1);
                }}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-950"
              >
                {(campData?.campaigns ?? []).map((c) => (
                  <option key={c.slug} value={c.slug}>
                    [{c.corridor}] {c.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700">Mission Stage</label>
              <select
                value={stageIndex}
                onChange={(e) => setStageIndex(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-950"
              >
                {(activeCampaign?.stages ?? []).map((s) => (
                  <option key={s.stageIndex} value={s.stageIndex}>
                    Stage {s.stageIndex} — {s.rewardLocalFormatted} {activeCampaign?.corridor}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {activeStage && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
              <div className="flex items-center justify-between font-medium text-zinc-950">
                <span>{activeStage.title}</span>
                <span className="font-mono text-emerald-700">
                  Exact Payout: {activeStage.rewardLocalFormatted} {activeCampaign?.corridor}
                </span>
              </div>
              <p className="mt-1 text-zinc-600">{activeStage.instructions}</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-700">
              Deliverable Proof URL (Public Promo Post, GitHub PR/Issue, or Referral Proof)
            </label>
            <input
              type="url"
              required
              value={deliverableUrl}
              onChange={(e) => setDeliverableUrl(e.target.value)}
              placeholder="https://github.com/org/repo/pull/42 or https://x.com/handle/status/..."
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs text-zinc-950 focus:border-zinc-900 focus:outline-none"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-zinc-700">
                Referral / Affiliate Code (Optional)
              </label>
              <input
                type="text"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value)}
                placeholder="e.g. TECHHUB-BF26"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs text-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700">
                Recipient Wallet (Celo Mainnet)
              </label>
              <input
                type="text"
                readOnly
                value={address ?? "Connect wallet above"}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700">
              Evidence Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={deliverableNotes}
              onChange={(e) => setDeliverableNotes(e.target.value)}
              placeholder="Brief summary of the deliverable or reproduction steps..."
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-xs text-zinc-950"
            />
          </div>

          <button
            type="submit"
            disabled={!isConnected || isSubmitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running Paid Celo buy Verification &amp; FX Clearing…
              </>
            ) : (
              "Verify & Settle Exact Local FX"
            )}
          </button>
        </form>
      </div>

      {/* Right Column: Real-Time 5-Step Pipeline & Off-Ramp Receipt */}
      <div className="space-y-5 lg:col-span-5">
        <section className="rounded-2xl border border-zinc-200/90 bg-white p-5">
          <h2 className="text-sm font-semibold text-zinc-950">Autonomous Settlement Pipeline</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Live status across Celo <code className="font-mono">buy</code>, the 7-rule Policy Gate,
            Textile FX v2 exact-output RFQ, and Celo Mainnet clearing.
          </p>

          {!result && !isSubmitting && (
            <div className="mt-4 rounded-xl border border-dashed border-zinc-200 p-6 text-center text-xs text-zinc-500">
              Submit a deliverable on the left to watch real-time verification, Policy Gate rule checks,
              and onchain settlement receipts appear here.
            </div>
          )}

          {isSubmitting && (
            <div className="mt-4 space-y-2.5 text-xs text-zinc-700">
              <div className="flex items-center gap-2 rounded-lg bg-zinc-50 p-3">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-700" />
                <span>Executing paid Celo buy inference + live Textile FX preview + Policy Gate…</span>
              </div>
            </div>
          )}

          {result && (
            <div className="mt-4 space-y-4">
              {/* Top Outcome Banner */}
              <div
                className={`rounded-xl border p-3.5 text-xs ${
                  result.status === "COMPLETED"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                    : result.status === "REJECTED"
                      ? "border-rose-200 bg-rose-50 text-rose-950"
                      : "border-amber-200 bg-amber-50 text-amber-950"
                }`}
              >
                <div className="flex items-center justify-between font-mono font-semibold">
                  <span>STATUS: {result.status}</span>
                  {result.verdict && <span>AI SCORE: {result.verdict.score}/100</span>}
                </div>
                {result.error && <p className="mt-1.5 leading-relaxed">{result.error}</p>}
                {result.policyDecision?.failedReason && (
                  <p className="mt-1.5 font-medium">
                    Rule Triggered ({result.policyDecision.failedRule}):{" "}
                    {result.policyDecision.failedReason}
                  </p>
                )}
              </div>

              {/* Paid buy Receipts */}
              {result.buyReceipts && result.buyReceipts.length > 0 && (
                <div className="rounded-xl border border-zinc-200 p-3.5 text-xs">
                  <div className="font-mono text-[11px] font-semibold uppercase text-zinc-500">
                    Step 1 · Paid Celo buy Receipts
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {result.buyReceipts.map((r, i) => (
                      <div key={i} className="flex items-center justify-between font-mono text-[11px]">
                        <span className="text-zinc-800">{r.capabilityId}</span>
                        {r.paymentTxHash ? (
                          <a
                            href={celoscanTxUrl(r.paymentTxHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-700 underline"
                          >
                            {r.paymentTxHash.slice(0, 10)}…
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-zinc-500">{r.dryRun ? "dry-run" : "settled"}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 7-Rule Deterministic Policy Gate Breakdown */}
              {result.policyDecision && (
                <div className="rounded-xl border border-zinc-200 p-3.5 text-xs">
                  <div className="font-mono text-[11px] font-semibold uppercase text-zinc-500">
                    Step 2 · Deterministic 7-Rule Policy Gate
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {result.policyDecision.checks.map((chk) => (
                      <li key={chk.rule} className="flex items-start gap-2 text-[11px]">
                        {chk.passed ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        ) : (
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />
                        )}
                        <div>
                          <span className="font-mono font-semibold text-zinc-900">{chk.rule}</span>
                          <p className="text-zinc-600">{chk.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Onchain Settlement Transaction Links */}
              {result.txHashes && (
                <div className="rounded-xl border border-emerald-200 bg-white p-3.5 text-xs">
                  <div className="font-mono text-[11px] font-semibold uppercase text-emerald-800">
                    Steps 3 &amp; 4 · Mainnet Settlement Hashes
                  </div>
                  <div className="mt-2 space-y-1.5 font-mono text-[11px]">
                    {[
                      ["VireVault Release (ERC-8021)", result.txHashes.vaultRelease],
                      ["Textile FX Swap (Native Tag)", result.txHashes.textileSwap],
                      ["Local Token Payout (ERC-8021)", result.txHashes.localPayout],
                      ["Onchain Audit Receipt (ERC-8021)", result.txHashes.vaultReceipt],
                    ].map(([label, hash]) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-zinc-600">{label}</span>
                        <a
                          href={celoscanTxUrl(hash!)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-700 underline"
                        >
                          {hash!.slice(0, 10)}…
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 5: Last-Mile Off-Ramp Card + 1-Click ERC-8004 Onchain Rating */}
              {result.offramp && (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs">
                  <div className="font-mono text-[11px] font-semibold uppercase text-zinc-500">
                    Step 5 · Local Cash-Out Off-Ramp
                  </div>
                  <h3 className="mt-1 text-sm font-semibold text-zinc-950">
                    {result.offramp.headline}
                  </h3>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-zinc-600">
                    {result.offramp.instructions.map((line, idx) => (
                      <li key={idx}>{line}</li>
                    ))}
                  </ul>

                  <div className="mt-3 flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-[11px]">
                    <span className="truncate text-zinc-700">
                      Token ({result.offramp.tokenDecimals}dp): {result.offramp.tokenAddress}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(result.offramp!.tokenAddress);
                        setCopiedAddr(true);
                        setTimeout(() => setCopiedAddr(false), 1500);
                      }}
                      className="ml-2 inline-flex items-center gap-1 text-zinc-900 hover:text-emerald-700"
                    >
                      <Copy className="h-3 w-3" />
                      {copiedAddr ? "Copied" : "Copy"}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {result.offramp.venues.map((v) => (
                      <a
                        key={v.name}
                        href={v.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
                      >
                        {v.name}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ))}
                  </div>

                  {/* 1-Click ERC-8004 Reputation Feedback */}
                  <div className="mt-4 border-t border-zinc-200 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 font-semibold text-zinc-900">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
                        Rate Vire Onchain (ERC-8004)
                      </span>
                      <span className="font-mono text-[11px] text-zinc-500">tag: settlement</span>
                    </div>

                    {ratingTxHash ? (
                      <a
                        href={celoscanTxUrl(ratingTxHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 font-mono text-xs text-emerald-700 underline"
                      >
                        Onchain ERC-8004 feedback mined: {ratingTxHash.slice(0, 12)}…
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : repData?.registered && repData.agentId ? (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={ratingScore}
                          onChange={(e) => setRatingScore(Number(e.target.value))}
                          className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs"
                        />
                        <button
                          type="button"
                          disabled={isRatingTxPending}
                          onClick={handleRateOnchain}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                        >
                          <Star className="h-3.5 w-3.5 text-amber-400" />
                          {isRatingTxPending ? "Confirm in Wallet…" : "Submit giveFeedback()"}
                        </button>
                      </div>
                    ) : (
                      <p className="mt-1.5 flex items-center gap-1 text-[11px] text-zinc-500">
                        <AlertTriangle className="h-3 w-3" />
                        Set VIRE_AGENT_ID after running scripts/register-agent.ts to enable onchain
                        rating.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function ClaimPage() {
  return (
    <Suspense fallback={<div className="p-8 font-mono text-xs text-zinc-500">Loading claim flow…</div>}>
      <ClaimFlowInner />
    </Suspense>
  );
}
