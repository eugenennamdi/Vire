"use client";

import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleNotch,
  DownloadSimple,
  Globe,
  LinkSimple,
  Pause,
  Play,
  Plus,
  Ticket,
  UserSwitch,
  X,
} from "@phosphor-icons/react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { CELO_TOKENS, celoscanTxUrl, isSafeHttpUrl, VIRE_VAULT_ABI } from "@vire/shared";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { erc20Abi, getAddress, isAddress, parseUnits, type Address, type Hex } from "viem";
import {
  useAccount,
  useConnect,
  usePublicClient,
  useSignMessage,
  useWriteContract,
} from "wagmi";
import { celo } from "wagmi/chains";
import { useIsMiniPay } from "@/components/providers";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { TokenIcon } from "@/components/ui/token-icon";
import { buildWalletAuthMessage, requestAuthNonce } from "@/lib/session-client";
import { truncateMiddle } from "@/lib/utils";

const PRIVY_ENABLED = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim());

interface ManagedSubmission {
  id: string;
  contributorWallet: string;
  identityHandle: string | null;
  deliverableUrl: string;
  deliverableNotes: string;
  status: string;
  reviewNote: string | null;
  aiReason: string | null;
  createdAt: number;
  updatedAt: number;
  settlement: {
    localAmountFormatted: string;
    usdtSpentFormatted: string;
    usdtRefundedFormatted: string;
    textileSwapTxHash: string;
    payoutTxHash: string;
    settledAt: number;
  } | null;
}

interface OwnedVoucher {
  id: string;
  codeHint: string;
  orderRef: string | null;
  orderValueLocal: string | null;
  status: "ACTIVE" | "CLAIMING" | "CLAIMED" | "REVOKED";
  claimedByWallet: string | null;
  submissionId: string | null;
  createdAt: number;
  claimedAt: number | null;
}

interface NewlyIssuedVoucher {
  id: string;
  code: string;
  codeHint: string;
  claimUrl: string;
  orderRef: string | null;
  orderValueLocal: string | null;
}

interface OwnedCampaign {
  id: Hex;
  slug: string;
  shortUrl: string;
  partnerName: string;
  title: string;
  description: string;
  criteria: string;
  corridor: string;
  fiatCode?: string;
  visibility: "public" | "unlisted";
  verificationMode: "auto" | "manual" | "voucher";
  requiresInviteCode: boolean;
  endsAt: number | null;
  isExpired: boolean;
  active: boolean;
  onchainActive: boolean;
  onchainSynced: boolean;
  budgetUsdtAtomic: string;
  remainingUsdtAtomic: string;
  budgetUsdtFormatted: string;
  remainingUsdtFormatted: string;
  rewardLocalFormatted: string;
  spotsRemaining: number;
  pendingCount: number;
  completedCount: number;
  verifiedGmvLocal?: number;
  issuedGmvLocal?: number;
  vouchers?: OwnedVoucher[];
  createdAt: number;
  submissions: ManagedSubmission[];
}

interface UnregisteredOnchainCampaign {
  campaignId: Hex;
  txHash: Hex;
  budgetUsdtFormatted: string;
  remainingUsdtAtomic: string;
  remainingUsdtFormatted: string;
  active: boolean;
}

interface MySubmissionItem {
  id: string;
  campaignSlug: string;
  campaignTitle: string;
  partnerName: string;
  corridor: string;
  deliverableUrl: string;
  status: string;
  reviewNote: string | null;
  aiReason: string | null;
  createdAt: number;
  updatedAt: number;
  settlement: {
    localAmountFormatted: string;
    payoutTxHash: string;
    settledAt: number;
  } | null;
}

interface ManageApiResponse {
  authenticated: boolean;
  wallet: Address | null;
  vaultAddress: Address | null;
  ownedCampaigns: OwnedCampaign[];
  unregisteredOnchainCampaigns: UnregisteredOnchainCampaign[];
  mySubmissions: MySubmissionItem[];
}

function csvEscape(v: string | number | null | undefined): string {
  const str = String(v ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadCampaignCsv(camp: OwnedCampaign) {
  const headers = [
    "Submission ID",
    "Date (UTC)",
    "Status",
    "Contributor Handle",
    "Contributor Wallet",
    "Deliverable URL",
    "Local Payout",
    "Currency",
    "USDT Spent",
    "USDT Dust Refunded",
    "Textile Swap Tx",
    "Payout Tx",
    "Review Note",
  ];
  const rows = camp.submissions.map((s) => [
    s.id,
    new Date(s.settlement?.settledAt ?? s.createdAt).toISOString(),
    s.status,
    s.identityHandle ?? "",
    s.contributorWallet,
    s.deliverableUrl,
    s.settlement?.localAmountFormatted ?? "",
    camp.corridor,
    s.settlement?.usdtSpentFormatted ?? "",
    s.settlement?.usdtRefundedFormatted ?? "",
    s.settlement?.textileSwapTxHash ?? "",
    s.settlement?.payoutTxHash ?? "",
    s.reviewNote ?? s.aiReason ?? "",
  ]);
  const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vire-${camp.slug}-receipts.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function SignInCta() {
  const isMiniPay = useIsMiniPay();
  if (PRIVY_ENABLED && !isMiniPay) return <PrivyConnectCta />;
  return <FallbackConnectCta />;
}

function PrivyConnectCta() {
  const { login } = usePrivy();
  return (
    <Button size="md" variant="primary" onClick={() => login()}>
      Sign in to open workspace
    </Button>
  );
}

function FallbackConnectCta() {
  const { connect, connectors, isPending } = useConnect();
  return (
    <Button
      size="md"
      variant="primary"
      disabled={isPending}
      onClick={() => {
        const c = connectors[0];
        if (c) connect({ connector: c });
      }}
    >
      {isPending ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}

export default function ManagePage() {
  const { address: connectedWallet } = useAccount();
  const publicClient = usePublicClient({ chainId: celo.id });
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();

  const [tab, setTab] = useState<"campaigns" | "submissions">("campaigns");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openTool, setOpenTool] = useState<{
    campaignId: string;
    kind: "topup" | "withdraw" | "transfer";
  } | null>(null);
  const [toolInput, setToolInput] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [voucherInputs, setVoucherInputs] = useState<
    Record<string, { orderRef: string; orderValueLocal: string }>
  >({});
  const [newlyIssuedByCamp, setNewlyIssuedByCamp] = useState<
    Record<string, NewlyIssuedVoucher | null>
  >({});

  async function handleIssueVoucher(camp: OwnedCampaign, e: React.FormEvent) {
    e.preventDefault();
    const form = voucherInputs[camp.id] ?? { orderRef: "", orderValueLocal: "" };
    setBusyKey(`voucher-issue:${camp.id}`);
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(camp.slug)}/vouchers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "issue",
          orderRef: form.orderRef.trim() || undefined,
          orderValueLocal: form.orderValueLocal.trim().replace(/,/g, "") || undefined,
          count: 1,
        }),
      });
      const json = (await res.json()) as { issued?: NewlyIssuedVoucher[]; error?: string };
      if (!res.ok || !json.issued?.[0]) {
        throw new Error(json.error || "Failed to issue cashback voucher.");
      }
      setNewlyIssuedByCamp((prev) => ({ ...prev, [camp.id]: json.issued![0]! }));
      setVoucherInputs((prev) => ({ ...prev, [camp.id]: { orderRef: "", orderValueLocal: "" } }));
      toast.success(`Issued single-use voucher ${json.issued[0].code}`);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to issue voucher");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRevokeVoucher(camp: OwnedCampaign, voucherId: string) {
    setBusyKey(`voucher-revoke:${voucherId}`);
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(camp.slug)}/vouchers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", voucherId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to revoke voucher.");
      toast.success("Voucher revoked");
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke voucher");
    } finally {
      setBusyKey(null);
    }
  }

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["manage-workspace", connectedWallet],
    queryFn: async () => {
      const r = await fetch("/api/manage");
      return (await r.json()) as ManageApiResponse;
    },
  });

  const isMatchedSession = Boolean(
    data?.authenticated &&
      connectedWallet &&
      data.wallet?.toLowerCase() === connectedWallet.toLowerCase()
  );

  async function handleVerifyWallet() {
    if (!connectedWallet) return;
    setIsAuthenticating(true);
    try {
      const nonce = await requestAuthNonce(connectedWallet);
      const signature = await signMessageAsync({
        message: buildWalletAuthMessage(connectedWallet, nonce),
      });
      const res = await fetch("/api/auth/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: connectedWallet, signature }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Authentication failed");
      toast.success("Wallet verified");
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Signature cancelled");
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function handleReviewSubmission(
    subId: string,
    decision: "approve" | "reject"
  ) {
    setBusyKey(`review:${subId}`);
    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(subId)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          note: reviewNotes[subId]?.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        status?: string;
        error?: string;
        policyDecision?: { failedReason?: string | null };
      };
      if (!res.ok) {
        throw new Error(json.error || json.policyDecision?.failedReason || "Review action failed");
      }
      toast.success(
        decision === "approve"
          ? "Approved & settled in exact local currency on Celo!"
          : "Submission rejected"
      );
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to process review");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleToggleCampaignActive(camp: OwnedCampaign) {
    if (!data?.vaultAddress) return;
    setBusyKey(`pause:${camp.id}`);
    try {
      const hash = await writeContractAsync({
        address: data.vaultAddress,
        abi: VIRE_VAULT_ABI,
        functionName: "setCampaignActive",
        args: [camp.id, !camp.onchainActive],
        chainId: celo.id,
      });
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      toast.success(camp.onchainActive ? "Campaign paused onchain" : "Campaign resumed onchain");
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Transaction cancelled");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleToggleVisibility(camp: OwnedCampaign) {
    const next = camp.visibility === "public" ? "unlisted" : "public";
    setBusyKey(`vis:${camp.id}`);
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(camp.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (!res.ok) throw new Error("Failed to update visibility");
      toast.success(next === "public" ? "Campaign is now Public" : "Campaign is now Link-only");
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleOnchainToolSubmit(camp: OwnedCampaign, e: React.FormEvent) {
    e.preventDefault();
    if (!data?.vaultAddress || !connectedWallet || !openTool) return;
    const raw = toolInput.trim();
    if (!raw) return;

    setBusyKey(`tool:${camp.id}`);
    try {
      if (openTool.kind === "topup") {
        const atomic = parseUnits(raw, 6);
        if (atomic <= 0n) throw new Error("Enter a USDT amount > 0");
        const approveHash = await writeContractAsync({
          address: CELO_TOKENS.USDT.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [data.vaultAddress, atomic],
          chainId: celo.id,
        });
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: approveHash });
        const topHash = await writeContractAsync({
          address: data.vaultAddress,
          abi: VIRE_VAULT_ABI,
          functionName: "topUpCampaign",
          args: [camp.id, atomic],
          chainId: celo.id,
        });
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: topHash });
        toast.success(`Added $${raw} USDT to campaign pool`);
      } else if (openTool.kind === "withdraw") {
        const atomic = parseUnits(raw, 6);
        if (atomic <= 0n || atomic > BigInt(camp.remainingUsdtAtomic)) {
          throw new Error("Amount exceeds remaining withdrawable USDT");
        }
        const hash = await writeContractAsync({
          address: data.vaultAddress,
          abi: VIRE_VAULT_ABI,
          functionName: "withdrawUnused",
          args: [camp.id, connectedWallet, atomic],
          chainId: celo.id,
        });
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
        toast.success(`Withdrew $${raw} USDT to your wallet`);
      } else if (openTool.kind === "transfer") {
        if (!isAddress(raw)) throw new Error("Enter a valid 0x wallet or Safe multisig address");
        const hash = await writeContractAsync({
          address: data.vaultAddress,
          abi: VIRE_VAULT_ABI,
          functionName: "transferCampaignCreator",
          args: [camp.id, getAddress(raw)],
          chainId: celo.id,
        });
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
        toast.success(`Transferred campaign custody to ${truncateMiddle(raw, 6, 4)}`);
      }
      setOpenTool(null);
      setToolInput("");
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Onchain action failed");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleWithdrawOrphaned(orphan: UnregisteredOnchainCampaign) {
    if (!data?.vaultAddress || !connectedWallet) return;
    setBusyKey(`orphan:${orphan.campaignId}`);
    try {
      const hash = await writeContractAsync({
        address: data.vaultAddress,
        abi: VIRE_VAULT_ABI,
        functionName: "withdrawUnused",
        args: [orphan.campaignId, connectedWallet, BigInt(orphan.remainingUsdtAtomic)],
        chainId: celo.id,
      });
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      toast.success(`Recovered $${orphan.remainingUsdtFormatted} USDT to your wallet`);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Withdrawal cancelled");
    } finally {
      setBusyKey(null);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "https://usevire.xyz";
  const totalPending = (data?.ownedCampaigns ?? []).reduce((sum, c) => sum + c.pendingCount, 0);

  return (
    <div className="space-y-8">
      <div className="vire-enter flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-[28px] font-medium tracking-[-0.03em] text-[#0A0A0C]">Workspace</h1>
          <p className="mt-1 max-w-[58ch] text-[14px] leading-relaxed text-[#71717A]">
            Manage campaigns you funded, approve manual submissions for instant local payout, or
            track work you submitted.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isMatchedSession && (
            <SegmentedTabs
              value={tab}
              onChange={setTab}
              options={[
                {
                  value: "campaigns",
                  label: "My campaigns",
                  count: data?.ownedCampaigns.length ?? 0,
                },
                {
                  value: "submissions",
                  label: "My submissions",
                  count: data?.mySubmissions.length ?? 0,
                },
              ]}
            />
          )}
          <Link href="/create" className={buttonVariants({ variant: "primary", size: "sm" })}>
            <Plus weight="bold" className="h-3.5 w-3.5" />
            Launch campaign
          </Link>
        </div>
      </div>

      {!connectedWallet ? (
        <Card className="p-10 text-center">
          <p className="text-[15px] font-medium text-[#0A0A0C]">
            Connect your wallet to open your workspace
          </p>
          <p className="mx-auto mt-1.5 max-w-[46ch] text-[13px] text-[#71717A]">
            Any wallet that funds a campaign on Vire automatically owns its non-custodial vault
            controls and approval queue.
          </p>
          <div className="mt-5 flex justify-center">
            <SignInCta />
          </div>
        </Card>
      ) : !isMatchedSession ? (
        <Card className="p-10 text-center">
          <p className="text-[15px] font-medium text-[#0A0A0C]">
            Verify wallet ownership ({truncateMiddle(connectedWallet, 6, 4)})
          </p>
          <p className="mx-auto mt-1.5 max-w-[46ch] text-[13px] text-[#71717A]">
            Sign a gas-free message to view your private campaign links, approval queue, and
            submission statuses.
          </p>
          <div className="mt-5 flex justify-center">
            <Button
              size="md"
              variant="primary"
              disabled={isAuthenticating}
              onClick={handleVerifyWallet}
            >
              {isAuthenticating ? (
                <>
                  <CircleNotch className="h-4 w-4 animate-spin" />
                  Waiting for signature…
                </>
              ) : (
                "Sign to verify wallet"
              )}
            </Button>
          </div>
        </Card>
      ) : isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      ) : tab === "campaigns" ? (
        <div className="space-y-6">
          {/* Zero-orphaned-funds recovery alert */}
          {(data?.unregisteredOnchainCampaigns.length ?? 0) > 0 && (
            <Card className="space-y-3 border-black/15 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[14px] font-medium text-[#0A0A0C]">
                    Unpublished onchain vault deposit found
                  </h2>
                  <p className="mt-0.5 text-[12.5px] text-[#71717A]">
                    Your wallet funded a campaign on VireVault whose metadata never finished saving.
                    You retain 100% custody and can withdraw it immediately.
                  </p>
                </div>
              </div>
              <div className="divide-y divide-black/[0.06]">
                {data!.unregisteredOnchainCampaigns.map((o) => (
                  <div
                    key={o.campaignId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 font-mono text-[12px]"
                  >
                    <div>
                      <span className="text-[#0A0A0C]">{truncateMiddle(o.campaignId, 10, 6)}</span>
                      <span className="ml-3 text-[#71717A]">
                        Remaining: ${o.remainingUsdtFormatted} USDT
                      </span>
                    </div>
                    {BigInt(o.remainingUsdtAtomic) > 0n && (
                      <Button
                        size="sm"
                        variant="outlineStrong"
                        disabled={busyKey === `orphan:${o.campaignId}`}
                        onClick={() => handleWithdrawOrphaned(o)}
                      >
                        Withdraw ${o.remainingUsdtFormatted} USDT
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {totalPending > 0 && (
            <div className="flex flex-col gap-1 rounded-2xl bg-[#0A0A0C] px-4 py-3.5 text-white sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <span className="text-[13.5px] font-medium">
                {totalPending} {totalPending === 1 ? "submission awaits" : "submissions await"} your
                review
              </span>
              <span className="font-mono text-[11.5px] text-white/70 sm:text-[12px]">
                1 click Approve &amp; Pay settles instantly via Textile FX
              </span>
            </div>
          )}

          {(data?.ownedCampaigns.length ?? 0) === 0 ? (
            <Card className="p-12 text-center">
              <p className="text-[15px] font-medium text-[#0A0A0C]">No campaigns launched yet</p>
              <p className="mx-auto mt-1.5 max-w-[46ch] text-[13px] text-[#71717A]">
                Fund a local-currency payout pool in 60 seconds with automatic or manual review, and
                keep full withdrawal custody of any unspent USDT.
              </p>
              <div className="mt-5 flex justify-center">
                <Link href="/create" className={buttonVariants({ variant: "primary", size: "md" })}>
                  Launch your first campaign
                  <ArrowRight weight="bold" className="h-3.5 w-3.5" />
                </Link>
              </div>
            </Card>
          ) : (
            data!.ownedCampaigns.map((camp) => {
              const shareUrl = `${origin}${camp.shortUrl}`;
              const pendingSubs = camp.submissions.filter((s) => s.status === "PENDING_REVIEW");
              const otherSubs = camp.submissions.filter((s) => s.status !== "PENDING_REVIEW");
              const activeToolForCamp = openTool?.campaignId === camp.id ? openTool.kind : null;

              return (
                <Card key={camp.id} className="overflow-hidden">
                  {/* Top Campaign Header */}
                  <div className="p-4 sm:p-6">
                    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                      <div className="flex items-start gap-3.5">
                        <TokenIcon symbol={camp.corridor} size={34} showChainBadge className="mt-0.5" />
                        <div>
                          <div className="flex flex-wrap items-center gap-2 text-[12px]">
                            <Badge tone={camp.active ? "positive" : "neutral"}>
                              {camp.isExpired ? "Ended" : camp.active ? "Active" : "Paused"}
                            </Badge>
                            <Badge tone="outline">
                              {camp.verificationMode === "voucher"
                                ? "Cashback voucher"
                                : camp.verificationMode === "manual"
                                  ? "Manual review"
                                  : "Automatic"}
                            </Badge>
                            <Badge tone="outline">
                              {camp.visibility === "unlisted" ? "Link-only" : "Public"}
                            </Badge>
                            {camp.requiresInviteCode && <Badge tone="outline">Passcode</Badge>}
                          </div>
                          <h2 className="mt-2 text-[18px] font-medium tracking-[-0.02em] text-[#0A0A0C]">
                            {camp.title}
                          </h2>
                          <p className="mt-0.5 font-mono text-[12px] text-[#71717A] tabular-nums">
                            {camp.rewardLocalFormatted} {camp.corridor}/person · {camp.spotsRemaining} spots left · {camp.completedCount} paid
                            {camp.endsAt ? ` · Ends ${new Date(camp.endsAt).toLocaleDateString()}` : ""}
                          </p>
                        </div>
                      </div>

                      <div className="vire-well flex shrink-0 items-center gap-4 rounded-xl px-4 py-3 font-mono text-[12px]">
                        <div>
                          <span className="block text-[10.5px] uppercase tracking-wider text-[#71717A]">
                            Pool remaining
                          </span>
                          <span className="text-[16px] font-medium text-[#0A0A0C] tabular-nums">
                            ${camp.remainingUsdtFormatted}
                            <span className="text-[12px] font-normal text-[#71717A]">
                              {" "}
                              / ${camp.budgetUsdtFormatted}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-black/[0.06] pt-4">
                      <CopyButton value={shareUrl} label="Copy link" toastMessage="Short claim link copied" />

                      <Link
                        href={camp.shortUrl}
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                      >
                        Open claim page
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>

                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyKey === `vis:${camp.id}`}
                        onClick={() => handleToggleVisibility(camp)}
                      >
                        {camp.visibility === "public" ? (
                          <>
                            <LinkSimple className="h-3.5 w-3.5" /> Make link-only
                          </>
                        ) : (
                          <>
                            <Globe className="h-3.5 w-3.5" /> Make public
                          </>
                        )}
                      </Button>

                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyKey === `pause:${camp.id}`}
                        onClick={() => handleToggleCampaignActive(camp)}
                      >
                        {camp.onchainActive ? (
                          <>
                            <Pause className="h-3.5 w-3.5" /> Pause
                          </>
                        ) : (
                          <>
                            <Play className="h-3.5 w-3.5" /> Resume
                          </>
                        )}
                      </Button>

                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setToolInput("");
                          setOpenTool(
                            activeToolForCamp === "topup"
                              ? null
                              : { campaignId: camp.id, kind: "topup" }
                          );
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" /> Top up
                      </Button>

                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={BigInt(camp.remainingUsdtAtomic) === 0n}
                        onClick={() => {
                          setToolInput(camp.remainingUsdtFormatted.replace(/,/g, ""));
                          setOpenTool(
                            activeToolForCamp === "withdraw"
                              ? null
                              : { campaignId: camp.id, kind: "withdraw" }
                          );
                        }}
                      >
                        <ArrowDown className="h-3.5 w-3.5" /> Withdraw USDT
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setToolInput("");
                          setOpenTool(
                            activeToolForCamp === "transfer"
                              ? null
                              : { campaignId: camp.id, kind: "transfer" }
                          );
                        }}
                      >
                        <UserSwitch className="h-3.5 w-3.5" /> Transfer owner
                      </Button>

                      {camp.submissions.length > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="sm:ml-auto"
                          onClick={() => downloadCampaignCsv(camp)}
                        >
                          <DownloadSimple className="h-3.5 w-3.5" /> Export CSV
                        </Button>
                      )}
                    </div>

                    {/* Inline Onchain Custody Action Drawer */}
                    {activeToolForCamp && (
                      <form
                        onSubmit={(e) => handleOnchainToolSubmit(camp, e)}
                        className="mt-4 flex flex-wrap items-center gap-2.5 rounded-xl bg-[#FAFAFB] p-3.5 ring-1 ring-black/[0.08]"
                      >
                        <span className="text-[12px] font-medium text-[#0A0A0C]">
                          {activeToolForCamp === "topup"
                            ? "Add USDT:"
                            : activeToolForCamp === "withdraw"
                              ? "Withdraw USDT:"
                              : "New owner / Safe address:"}
                        </span>
                        <input
                          type="text"
                          required
                          value={toolInput}
                          onChange={(e) => setToolInput(e.target.value)}
                          placeholder={
                            activeToolForCamp === "transfer" ? "0x…" : "Amount in USDT (e.g. 20)"
                          }
                          className="h-10 min-w-0 w-full rounded-lg bg-white px-3 font-mono text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.1] sm:h-8 sm:min-w-[200px] sm:flex-1 sm:text-[12px]"
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="primary"
                          disabled={busyKey === `tool:${camp.id}`}
                        >
                          {busyKey === `tool:${camp.id}` ? (
                            <CircleNotch className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            "Confirm onchain"
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpenTool(null)}
                        >
                          Cancel
                        </Button>
                      </form>
                    )}
                  </div>

                  {/* Cashback Voucher Issuer & Tracker (Voucher Mode) */}
                  {camp.verificationMode === "voucher" && (() => {
                    const vList = camp.vouchers ?? [];
                    const activeVouchers = vList.filter((v) => v.status === "ACTIVE" || v.status === "CLAIMING").length;
                    const claimedVouchers = vList.filter((v) => v.status === "CLAIMED").length;
                    const formVal = voucherInputs[camp.id] ?? { orderRef: "", orderValueLocal: "" };
                    const freshVoucher = newlyIssuedByCamp[camp.id];
                    const fiat = camp.fiatCode ?? camp.corridor.replace(/^[cw]/, "");
                    const freshClaimUrl = freshVoucher
                      ? `${origin}/c/${camp.slug}?voucher=${encodeURIComponent(freshVoucher.code)}`
                      : "";
                    const whatsappText = freshVoucher
                      ? `Thanks for shopping with ${camp.partnerName}! Claim your ${camp.rewardLocalFormatted} ${camp.corridor} instant cashback here (single-use link): ${freshClaimUrl}`
                      : "";

                    return (
                      <div className="border-t border-black/[0.06] bg-[#FAFAFB] px-4 py-4 sm:px-6">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Ticket className="h-4 w-4 text-[#0A0A0C]" />
                            <h3 className="text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[#0A0A0C]">
                              Cashback vouchers
                            </h3>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 font-mono text-[11.5px] text-[#52525B] tabular-nums">
                            <span>{activeVouchers} active</span>
                            <span>{claimedVouchers} claimed</span>
                            {(camp.verifiedGmvLocal ?? 0) > 0 && (
                              <span className="font-medium text-[#15803D]">
                                Verified sales: {Math.round(camp.verifiedGmvLocal!).toLocaleString("en-US")} {fiat}
                              </span>
                            )}
                          </div>
                        </div>

                        <form
                          onSubmit={(e) => handleIssueVoucher(camp, e)}
                          className="flex flex-col gap-2 sm:flex-row sm:items-center"
                        >
                          <input
                            type="text"
                            value={formVal.orderRef}
                            onChange={(e) =>
                              setVoucherInputs((prev) => ({
                                ...prev,
                                [camp.id]: { ...formVal, orderRef: e.target.value },
                              }))
                            }
                            placeholder="Order ref (optional, e.g. #SWOT-1042)"
                            className="h-10 min-w-0 flex-1 rounded-xl bg-white px-3 font-mono text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.09] placeholder:text-[#A1A1AA] sm:h-9 sm:text-[12px]"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={formVal.orderValueLocal}
                            onChange={(e) =>
                              setVoucherInputs((prev) => ({
                                ...prev,
                                [camp.id]: { ...formVal, orderValueLocal: e.target.value },
                              }))
                            }
                            placeholder={`Order value (${fiat}, e.g. 185000)`}
                            className="h-10 min-w-0 sm:w-52 rounded-xl bg-white px-3 font-mono text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.09] placeholder:text-[#A1A1AA] sm:h-9 sm:text-[12px]"
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant="primary"
                            disabled={busyKey === `voucher-issue:${camp.id}`}
                            className="h-10 shrink-0 px-4 sm:h-9"
                          >
                            {busyKey === `voucher-issue:${camp.id}` ? (
                              <CircleNotch className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Plus weight="bold" className="h-3.5 w-3.5" />
                            )}
                            Issue voucher
                          </Button>
                        </form>

                        {freshVoucher && (
                          <div className="mt-3 space-y-2.5 rounded-xl bg-white p-3.5 ring-1 ring-[#16A34A]/30">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-[12px] font-medium text-[#15803D]">
                                Single-use voucher ready — copy now (stored hashed for security)
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setNewlyIssuedByCamp((prev) => ({ ...prev, [camp.id]: null }))
                                }
                                className="text-[11.5px] text-[#71717A] hover:text-[#0A0A0C]"
                              >
                                Dismiss
                              </button>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#FAFAFB] px-3 py-2 font-mono text-[13px] font-semibold text-[#0A0A0C] ring-1 ring-black/[0.06]">
                              <span>{freshVoucher.code}</span>
                              <div className="flex flex-wrap items-center gap-2">
                                <CopyButton
                                  value={freshClaimUrl}
                                  label="Copy claim link"
                                  toastMessage="Single-use claim link copied"
                                />
                                <CopyButton
                                  value={whatsappText}
                                  label="Copy WhatsApp msg"
                                  toastMessage="WhatsApp message copied"
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {vList.length > 0 && (
                          <div className="mt-3 divide-y divide-black/[0.05] overflow-hidden rounded-xl bg-white ring-1 ring-black/[0.07]">
                            {vList.slice(0, 12).map((v) => (
                              <div
                                key={v.id}
                                className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-[12px]"
                              >
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <Badge
                                    tone={
                                      v.status === "CLAIMED"
                                        ? "positive"
                                        : v.status === "REVOKED"
                                          ? "neutral"
                                          : "ink"
                                    }
                                  >
                                    {v.status === "CLAIMED"
                                      ? "Claimed"
                                      : v.status === "REVOKED"
                                        ? "Revoked"
                                        : "Active"}
                                  </Badge>
                                  <span className="font-mono font-medium text-[#0A0A0C]">
                                    {v.codeHint}
                                  </span>
                                  {v.orderRef && (
                                    <span className="font-mono text-[#52525B]">{v.orderRef}</span>
                                  )}
                                  {v.orderValueLocal && Number.isFinite(Number(v.orderValueLocal)) && (
                                    <span className="font-mono text-[#71717A] tabular-nums">
                                      {Number(v.orderValueLocal).toLocaleString("en-US")} {fiat}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 font-mono text-[11px] text-[#71717A]">
                                  {v.claimedByWallet && (
                                    <span>{truncateMiddle(v.claimedByWallet, 6, 4)}</span>
                                  )}
                                  {v.status === "ACTIVE" && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      disabled={busyKey === `voucher-revoke:${v.id}`}
                                      onClick={() => handleRevokeVoucher(camp, v.id)}
                                      className="h-7 px-2.5 text-[11px] text-[#B91C1C] hover:bg-[#FEF2F2]"
                                    >
                                      Revoke
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Pending Review Queue (Manual Mode) */}
                  {pendingSubs.length > 0 && (
                    <div className="border-t border-black/[0.06] bg-[#FAFAFB] px-4 py-4 sm:px-6">
                      <h3 className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[#52525B]">
                        Pending review ({pendingSubs.length})
                      </h3>
                      <div className="space-y-3">
                        {pendingSubs.map((sub) => {
                          const isBusy = busyKey === `review:${sub.id}`;
                          return (
                            <div
                              key={sub.id}
                              className="flex flex-col justify-between gap-3 rounded-xl bg-white p-4 ring-1 ring-black/[0.07] lg:flex-row lg:items-center"
                            >
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                                  <span className="font-mono font-medium text-[#0A0A0C]">
                                    {sub.identityHandle ? `@${sub.identityHandle}` : truncateMiddle(sub.contributorWallet, 6, 4)}
                                  </span>
                                  <span className="font-mono text-[11px] text-[#A1A1AA]">
                                    {truncateMiddle(sub.contributorWallet, 6, 4)}
                                  </span>
                                  <span className="text-[#A1A1AA]">·</span>
                                  <span className="font-mono text-[11px] text-[#71717A]">
                                    {new Date(sub.createdAt).toLocaleString()}
                                  </span>
                                </div>
                                {isSafeHttpUrl(sub.deliverableUrl) ? (
                                  <a
                                    href={sub.deliverableUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex max-w-full items-center gap-1 break-all font-mono text-[12.5px] text-[#0A0A0C] underline underline-offset-2"
                                  >
                                    {sub.deliverableUrl}
                                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                                  </a>
                                ) : (
                                  <span className="break-all font-mono text-[12px] text-[#71717A]">
                                    {sub.deliverableUrl}
                                  </span>
                                )}
                                {sub.deliverableNotes && (
                                  <p className="text-[12.5px] text-[#52525B]">{sub.deliverableNotes}</p>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="text"
                                  value={reviewNotes[sub.id] ?? ""}
                                  onChange={(e) =>
                                    setReviewNotes((prev) => ({ ...prev, [sub.id]: e.target.value }))
                                  }
                                  placeholder="Optional note…"
                                  className="h-10 w-full rounded-lg bg-[#FAFAFB] px-2.5 text-[16px] text-[#0A0A0C] ring-1 ring-black/[0.08] sm:h-8 sm:w-44 sm:text-[12px]"
                                />
                                <Button
                                  size="sm"
                                  variant="primary"
                                  disabled={isBusy}
                                  onClick={() => handleReviewSubmission(sub.id, "approve")}
                                >
                                  {isBusy ? (
                                    <CircleNotch className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Check weight="bold" className="h-3.5 w-3.5" />
                                  )}
                                  Approve &amp; Pay
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={isBusy}
                                  onClick={() => handleReviewSubmission(sub.id, "reject")}
                                >
                                  <X weight="bold" className="h-3.5 w-3.5" />
                                  Reject
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Settled / Past Activity */}
                  {otherSubs.length > 0 && (
                    <div className="border-t border-black/[0.06] px-6 py-4">
                      <h3 className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#A1A1AA]">
                        Recent activity ({otherSubs.length})
                      </h3>
                      <div className="divide-y divide-black/[0.05] text-[12.5px]">
                        {otherSubs.slice(0, 8).map((sub) => (
                          <div
                            key={sub.id}
                            className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <Badge
                                tone={
                                  sub.status === "COMPLETED"
                                    ? "positive"
                                    : sub.status === "REJECTED"
                                      ? "neutral"
                                      : "outline"
                                }
                              >
                                {sub.status === "COMPLETED"
                                  ? "Paid"
                                  : sub.status === "REJECTED"
                                    ? "Rejected"
                                    : sub.status}
                              </Badge>
                              <span className="font-mono text-[#0A0A0C]">
                                {sub.identityHandle ? `@${sub.identityHandle}` : truncateMiddle(sub.contributorWallet, 6, 4)}
                              </span>
                              {isSafeHttpUrl(sub.deliverableUrl) ? (
                                <a
                                  href={sub.deliverableUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="truncate font-mono text-[11.5px] text-[#71717A] underline underline-offset-2"
                                >
                                  {truncateMiddle(sub.deliverableUrl, 28, 12)}
                                </a>
                              ) : (
                                <span className="truncate font-mono text-[11.5px] text-[#A1A1AA]">
                                  {truncateMiddle(sub.deliverableUrl, 28, 12)}
                                </span>
                              )}
                            </div>
                            {sub.settlement ? (
                              <a
                                href={celoscanTxUrl(sub.settlement.payoutTxHash)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-[12px] font-medium text-[#0A0A0C] underline underline-offset-2 tabular-nums"
                              >
                                {sub.settlement.localAmountFormatted} {camp.corridor}
                                <ArrowUpRight className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-[11.5px] text-[#71717A]">
                                {sub.reviewNote || sub.aiReason || "—"}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      ) : (
        /* Contributor "My Submissions" Tab */
        <div className="space-y-4">
          {(data?.mySubmissions.length ?? 0) === 0 ? (
            <Card className="p-12 text-center">
              <p className="text-[15px] font-medium text-[#0A0A0C]">No submissions yet</p>
              <p className="mt-1 text-[13px] text-[#71717A]">
                Complete a verified task on any campaign to track its status and payout receipt here.
              </p>
              <div className="mt-5 flex justify-center">
                <Link href="/campaigns" className={buttonVariants({ variant: "primary", size: "md" })}>
                  Browse campaigns
                </Link>
              </div>
            </Card>
          ) : (
            data!.mySubmissions.map((sub) => (
              <Card key={sub.id} className="p-5">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          sub.status === "COMPLETED"
                            ? "positive"
                            : sub.status === "PENDING_REVIEW"
                              ? "ink"
                              : "neutral"
                        }
                      >
                        {sub.status === "COMPLETED"
                          ? "Paid"
                          : sub.status === "PENDING_REVIEW"
                            ? "Under review"
                            : sub.status === "REJECTED"
                              ? "Not approved"
                              : sub.status}
                      </Badge>
                      <span className="text-[12px] text-[#71717A]">{sub.partnerName}</span>
                    </div>
                    <Link
                      href={`/c/${encodeURIComponent(sub.campaignSlug)}`}
                      className="block text-[15px] font-medium text-[#0A0A0C] hover:underline"
                    >
                      {sub.campaignTitle}
                    </Link>
                    <p className="truncate font-mono text-[11.5px] text-[#71717A]">
                      {sub.deliverableUrl}
                    </p>
                    {(sub.reviewNote || sub.aiReason) && sub.status === "REJECTED" && (
                      <p className="text-[12px] text-[#B91C1C]">{sub.reviewNote || sub.aiReason}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {sub.settlement ? (
                      <a
                        href={celoscanTxUrl(sub.settlement.payoutTxHash)}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonVariants({ variant: "secondary", size: "sm" })}
                      >
                        <TokenIcon symbol={sub.corridor} size={15} />
                        {sub.settlement.localAmountFormatted} {sub.corridor}
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <Link
                        href={`/c/${encodeURIComponent(sub.campaignSlug)}`}
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                      >
                        View campaign
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
