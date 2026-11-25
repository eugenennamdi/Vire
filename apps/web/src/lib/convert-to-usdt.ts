import {
  CELO_TOKENS,
  isAllowedTextileTarget,
  type CorridorSymbol,
} from "@vire/shared";
import { erc20Abi, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { celo } from "wagmi/chains";
import { buildWalletAuthMessage, requestAuthNonce } from "./session-client";

export const CONVERTIBLE_LOCAL_TOKENS = ["cNGN", "wARS", "wBRL", "wMXN", "IDRX"] as const;
export type ConvertibleLocalToken = (typeof CONVERTIBLE_LOCAL_TOKENS)[number];

export function isConvertibleLocalToken(symbol: string): symbol is ConvertibleLocalToken {
  return (CONVERTIBLE_LOCAL_TOKENS as readonly string[]).includes(symbol);
}

export interface ConvertToUsdtPreview {
  status: "preview" | "no_quote" | "error";
  buyUsdtAtomic: string | null;
  buyUsdtFormatted: string | null;
  takerPaysFormatted: string | null;
  reason: string | null;
}

export async function fetchConvertToUsdtPreview(params: {
  sellToken: ConvertibleLocalToken;
  sellAmountAtomic: string;
}): Promise<ConvertToUsdtPreview> {
  const res = await fetch(
    `/api/funding?sellToken=${encodeURIComponent(params.sellToken)}&sellAmountAtomic=${encodeURIComponent(params.sellAmountAtomic)}`,
    { cache: "no-store" }
  );
  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    buyUsdtAtomic?: string | null;
    buyUsdtFormatted?: string | null;
    takerPaysFormatted?: string | null;
    reason?: string | null;
    error?: string;
  };
  if (!res.ok) {
    return {
      status: "error",
      buyUsdtAtomic: null,
      buyUsdtFormatted: null,
      takerPaysFormatted: null,
      reason: json.error || json.reason || "Unable to fetch Textile FX preview.",
    };
  }
  return {
    status: json.status === "preview" ? "preview" : "no_quote",
    buyUsdtAtomic: json.buyUsdtAtomic ?? null,
    buyUsdtFormatted: json.buyUsdtFormatted ?? null,
    takerPaysFormatted: json.takerPaysFormatted ?? null,
    reason: json.reason ?? null,
  };
}

export interface ExecuteConvertToUsdtResult {
  swapTxHash: Hash;
  buyUsdtAtomic: string;
  buyUsdtFormatted: string;
  takerPaysFormatted: string;
}

export async function executeConvertToUsdt(params: {
  wallet: Address;
  sellToken: ConvertibleLocalToken;
  sellAmountAtomic: string;
  publicClient?: PublicClient;
  sendTransactionAsync: (args: {
    to: Address;
    data: Hex;
    value: bigint;
    chainId: number;
  }) => Promise<Hash>;
  signMessage: (message: string) => Promise<string>;
  onStatus?: (message: string) => void;
}): Promise<ExecuteConvertToUsdtResult> {
  const { wallet, sellToken, sellAmountAtomic, publicClient, sendTransactionAsync, signMessage, onStatus } =
    params;

  const tokenMeta = CELO_TOKENS[sellToken as CorridorSymbol];
  const sellAtomicBigInt = BigInt(sellAmountAtomic);

  // 1. Ensure signed wallet session cookie for this wallet (no popup if already authenticated)
  const sessionRes = await fetch("/api/auth/wallet", { cache: "no-store" });
  const sessionJson = (await sessionRes.json().catch(() => ({}))) as {
    authenticated?: boolean;
    wallet?: string | null;
  };
  if (
    !sessionJson.authenticated ||
    sessionJson.wallet?.toLowerCase() !== wallet.toLowerCase()
  ) {
    onStatus?.("Confirm wallet ownership (gas-free)…");
    const nonce = await requestAuthNonce(wallet);
    const message = buildWalletAuthMessage(wallet, nonce);
    const signature = await signMessage(message);
    const authRes = await fetch("/api/auth/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: wallet, signature }),
    });
    if (!authRes.ok) {
      const errJson = (await authRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(errJson.error || "Wallet sign-in failed.");
    }
  }

  let activeRfqId: string | null = null;
  try {
    // 2. Request firm exact-input Textile FX quote (Local Token -> Celo USDT)
    onStatus?.(`Locking live ${sellToken} → USDT Textile FX quote…`);
    const quoteRes = await fetch("/api/funding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "request",
        sellToken,
        sellAmountAtomic,
      }),
    });
    const quoteJson = (await quoteRes.json().catch(() => ({}))) as {
      rfqId?: string;
      takerPaysAtomic?: string;
      takerPaysFormatted?: string;
      buyAmountAtomic?: string;
      buyUsdtFormatted?: string;
      expiresAt?: string;
      spender?: Address;
      transactions?: {
        approval: { to: Address; data: Hex; value: string; chainId: number };
        swap: { to: Address; data: Hex; value: string; chainId: number };
      };
      error?: string;
    };

    if (!quoteRes.ok || !quoteJson.rfqId || !quoteJson.transactions?.swap || !quoteJson.spender) {
      throw new Error(quoteJson.error || `No live ${sellToken} → USDT quote right now.`);
    }

    // Client-side defense-in-depth verification before prompting the wallet
    if (
      !isAllowedTextileTarget(quoteJson.spender) ||
      !isAllowedTextileTarget(quoteJson.transactions.swap.to) ||
      quoteJson.transactions.approval.to.toLowerCase() !== tokenMeta.address.toLowerCase() ||
      quoteJson.transactions.approval.value !== "0" ||
      quoteJson.transactions.swap.value !== "0" ||
      BigInt(quoteJson.takerPaysAtomic ?? "0") !== sellAtomicBigInt ||
      BigInt(quoteJson.buyAmountAtomic ?? "0") <= 0n
    ) {
      throw new Error("Blocked unexpected Textile FX contract target or swap amount.");
    }

    activeRfqId = quoteJson.rfqId;

    // 3. Approve sellToken to Textile spender if existing allowance is insufficient
    const existingAllowance = publicClient
      ? await publicClient.readContract({
          address: tokenMeta.address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [wallet, quoteJson.spender],
        })
      : 0n;

    if (existingAllowance < sellAtomicBigInt) {
      onStatus?.(`Approve ${quoteJson.takerPaysFormatted ?? ""} ${sellToken} for swap…`);
      const approveHash = await sendTransactionAsync({
        to: quoteJson.transactions.approval.to,
        data: quoteJson.transactions.approval.data,
        value: 0n,
        chainId: celo.id,
      });
      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
        if (receipt.status !== "success") {
          throw new Error(`${sellToken} approval reverted on Celo.`);
        }
      }
    }

    if (quoteJson.expiresAt && Date.now() >= Date.parse(quoteJson.expiresAt) - 3_000) {
      throw new Error("Quote expired during approval. Click Convert again for a fresh rate.");
    }

    // 4. Broadcast firm swap on Celo Mainnet
    onStatus?.(
      `Swapping ${quoteJson.takerPaysFormatted ?? ""} ${sellToken} → ${quoteJson.buyUsdtFormatted ?? ""} USDT…`
    );
    const swapTxHash = await sendTransactionAsync({
      to: quoteJson.transactions.swap.to,
      data: quoteJson.transactions.swap.data,
      value: 0n,
      chainId: celo.id,
    });

    // Report tx hash immediately while confirming onchain
    const submitPromise = fetch("/api/funding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit", rfqId: quoteJson.rfqId, txHash: swapTxHash }),
    }).catch(() => {});

    if (publicClient) {
      const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapTxHash });
      if (swapReceipt.status !== "success") {
        throw new Error(`${sellToken} → USDT swap reverted on Celo.`);
      }
    }

    await submitPromise;
    activeRfqId = null;

    return {
      swapTxHash,
      buyUsdtAtomic: quoteJson.buyAmountAtomic!,
      buyUsdtFormatted: quoteJson.buyUsdtFormatted ?? "0",
      takerPaysFormatted: quoteJson.takerPaysFormatted ?? "",
    };
  } catch (err) {
    if (activeRfqId) {
      void fetch("/api/funding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", rfqId: activeRfqId }),
      }).catch(() => {});
    }
    throw err;
  }
}
