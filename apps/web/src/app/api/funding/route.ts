import {
  CELO_MAINNET_CHAIN_ID,
  CELO_TOKENS,
  FUNDING_TOKENS,
  isAllowedTextileTarget,
  type FundingTokenSymbol,
} from "@vire/shared";
import { NextRequest, NextResponse } from "next/server";
import { encodeFunctionData, erc20Abi, formatUnits, getAddress, type Hash } from "viem";
import { z } from "zod";
import { getTextileClient } from "@/lib/runtime";
import {
  FUNDING_RFQ_COOKIE,
  signFundingRfqCookie,
  verifyFundingRfqCookie,
  verifyWalletSessionCookie,
  WALLET_SESSION_COOKIE,
} from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FUNDING_SWAP_USDT_ATOMIC = 100_000_000_000n; // $100,000 USDT sanity cap
const MIN_EXACT_INPUT_USDT_OUTPUT_ATOMIC = 500_000n; // $0.50 USDT sanity floor on exact-input swaps
const MAX_SELL_ATOMIC = 10n ** 30n;
const FUNDING_RATE_WINDOW_MS = 10 * 60 * 1000;
const FUNDING_MAX_REQUESTS_PER_WINDOW = 5;
// ponytail: per-instance in-memory funding RFQ limiter (5 req / 10m per wallet); move to Redis/Turso if scaled across many hot lambdas.
const fundingRequestHistory = new Map<string, number[]>();

function checkFundingRateLimit(walletLower: string): boolean {
  const now = Date.now();
  const prev = (fundingRequestHistory.get(walletLower) ?? []).filter(
    (ts) => now - ts < FUNDING_RATE_WINDOW_MS
  );
  if (prev.length >= FUNDING_MAX_REQUESTS_PER_WINDOW) {
    fundingRequestHistory.set(walletLower, prev);
    return false;
  }
  prev.push(now);
  fundingRequestHistory.set(walletLower, prev);
  return true;
}

const FundingSymbolSchema = z.enum(["USDT", "USDC", "CELO", "cNGN", "wARS", "wBRL", "wMXN", "IDRX"]);

function formatDisplayAmount(atomic: string, decimals: number): string {
  const num = Number(formatUnits(BigInt(atomic), decimals));
  if (!Number.isFinite(num)) return "0";
  return num >= 100
    ? num.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : num.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/**
 * GET /api/funding
 * - Exact-output mode (campaign funding): `?sellToken=wARS&buyUsdtAtomic=10000000`
 * - Exact-input mode (contributor cash-out to USDT): `?sellToken=cNGN&sellAmountAtomic=2500000000`
 */
export async function GET(req: NextRequest) {
  const sellParam = req.nextUrl.searchParams.get("sellToken") || "";
  const buyUsdtParam = req.nextUrl.searchParams.get("buyUsdtAtomic") || "";
  const sellAmountParam = req.nextUrl.searchParams.get("sellAmountAtomic") || "";

  const symParsed = FundingSymbolSchema.safeParse(sellParam);
  const hasBuy = buyUsdtParam.length > 0;
  const hasSell = sellAmountParam.length > 0;
  if (!symParsed.success || hasBuy === hasSell) {
    return NextResponse.json(
      { error: "Provide valid sellToken with either buyUsdtAtomic or sellAmountAtomic." },
      { status: 400 }
    );
  }

  const sym = symParsed.data as FundingTokenSymbol;

  if (hasSell) {
    if (sym === "USDT" || !/^\d+$/.test(sellAmountParam)) {
      return NextResponse.json({ error: "Invalid sellToken or sellAmountAtomic" }, { status: 400 });
    }
    const sellAmountAtomic = BigInt(sellAmountParam);
    if (sellAmountAtomic <= 0n || sellAmountAtomic > MAX_SELL_ATOMIC) {
      return NextResponse.json({ error: "Invalid sell amount." }, { status: 400 });
    }

    const token = FUNDING_TOKENS[sym];
    const textile = getTextileClient();
    try {
      const preview = await textile.previewExactInput({
        sellToken: token.address,
        buyToken: CELO_TOKENS.USDT.address,
        sellAmountAtomic: sellAmountAtomic.toString(),
      });

      const hasValidBuy =
        preview.status === "preview" &&
        typeof preview.buyAmount === "string" &&
        /^\d+$/.test(preview.buyAmount) &&
        BigInt(preview.buyAmount) > 0n;
      const takerPays = preview.takerPays ?? sellAmountAtomic.toString();

      return NextResponse.json({
        mode: "exact-input",
        sellToken: sym,
        sellTokenAddress: token.address,
        sellDecimals: token.decimals,
        status: hasValidBuy ? "preview" : preview.status,
        reason: preview.reason ?? null,
        takerPaysAtomic: takerPays,
        takerPaysFormatted: formatDisplayAmount(takerPays, token.decimals),
        buyUsdtAtomic: hasValidBuy ? preview.buyAmount! : null,
        buyUsdtFormatted: hasValidBuy ? formatDisplayAmount(preview.buyAmount!, 6) : null,
        feedStatus: preview.feed?.status ?? null,
      });
    } catch (err) {
      return NextResponse.json(
        {
          mode: "exact-input",
          sellToken: sym,
          status: "error",
          reason: err instanceof Error ? err.message : "Failed to fetch Textile FX preview",
        },
        { status: 502 }
      );
    }
  }

  if (!/^\d+$/.test(buyUsdtParam)) {
    return NextResponse.json({ error: "Invalid sellToken or buyUsdtAtomic" }, { status: 400 });
  }

  const buyUsdtAtomic = BigInt(buyUsdtParam);
  if (buyUsdtAtomic < 1_000_000n || buyUsdtAtomic > MAX_FUNDING_SWAP_USDT_ATOMIC) {
    return NextResponse.json(
      { error: "Swap size must be between $1.00 and $100,000 USDT." },
      { status: 400 }
    );
  }

  if (sym === "USDT") {
    return NextResponse.json({
      mode: "exact-output",
      sellToken: sym,
      status: "direct",
      takerPaysAtomic: buyUsdtAtomic.toString(),
      takerPaysFormatted: formatDisplayAmount(buyUsdtAtomic.toString(), 6),
      buyUsdtAtomic: buyUsdtAtomic.toString(),
      buyUsdtFormatted: formatDisplayAmount(buyUsdtAtomic.toString(), 6),
    });
  }

  const token = FUNDING_TOKENS[sym];
  const textile = getTextileClient();

  try {
    const preview = await textile.previewExactOutput({
      sellToken: token.address,
      buyToken: CELO_TOKENS.USDT.address,
      buyAmountAtomic: buyUsdtAtomic.toString(),
    });

    const isAvailable = preview.status === "preview" && typeof preview.takerPays === "string";
    return NextResponse.json({
      mode: "exact-output",
      sellToken: sym,
      sellTokenAddress: token.address,
      sellDecimals: token.decimals,
      status: isAvailable ? "preview" : preview.status,
      reason: preview.reason ?? null,
      takerPaysAtomic: preview.takerPays ?? null,
      takerPaysFormatted:
        isAvailable && preview.takerPays ? formatDisplayAmount(preview.takerPays, token.decimals) : null,
      buyUsdtAtomic: buyUsdtAtomic.toString(),
      buyUsdtFormatted: formatDisplayAmount(buyUsdtAtomic.toString(), 6),
      feedStatus: preview.feed?.status ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        mode: "exact-output",
        sellToken: sym,
        status: "error",
        reason: err instanceof Error ? err.message : "Failed to fetch Textile FX preview",
      },
      { status: 502 }
    );
  }
}

const PostFundingSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("request"),
    sellToken: FundingSymbolSchema.refine((s) => s !== "USDT", "USDT does not need a swap"),
    buyUsdtAtomic: z.string().regex(/^\d+$/).optional(),
    sellAmountAtomic: z.string().regex(/^\d+$/).optional(),
  }),
  z.object({
    action: z.literal("submit"),
    rfqId: z.string().min(4).max(128),
    txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  }),
  z.object({
    action: z.literal("cancel"),
    rfqId: z.string().min(4).max(128),
  }),
]);

/**
 * POST /api/funding
 * Authenticated Textile FX v2 firm quote lifecycle for wallet swaps into USDT:
 * - Exact-output (`buyUsdtAtomic`): campaign funding in any supported token.
 * - Exact-input (`sellAmountAtomic`): contributor local-token cash-out into Celo USDT (for MiniPay / exchanges).
 * Keeps `claimToken` strictly server-private inside a short-lived HttpOnly signed cookie.
 */
export async function POST(req: NextRequest) {
  const session = verifyWalletSessionCookie(req.cookies.get(WALLET_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { error: "Please sign with your wallet before requesting a firm Textile FX quote." },
      { status: 401 }
    );
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = PostFundingSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid swap request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const textile = getTextileClient();
  const data = parsed.data;

  if (data.action === "request") {
    if (!textile.hasPartnerApiKey) {
      return NextResponse.json(
        { error: "Textile Partner API key is required for wallet conversion swaps." },
        { status: 503 }
      );
    }

    if (Boolean(data.buyUsdtAtomic) === Boolean(data.sellAmountAtomic)) {
      return NextResponse.json(
        { error: "Provide either buyUsdtAtomic or sellAmountAtomic." },
        { status: 400 }
      );
    }

    const isExactInput = Boolean(data.sellAmountAtomic);
    const buyAmountTarget = data.buyUsdtAtomic ? BigInt(data.buyUsdtAtomic) : null;
    const sellAmountTarget = data.sellAmountAtomic ? BigInt(data.sellAmountAtomic) : null;

    if (
      buyAmountTarget !== null &&
      (buyAmountTarget < 1_000_000n || buyAmountTarget > MAX_FUNDING_SWAP_USDT_ATOMIC)
    ) {
      return NextResponse.json(
        { error: "Swap output must be between $1.00 and $100,000 USDT." },
        { status: 400 }
      );
    }

    if (
      sellAmountTarget !== null &&
      (sellAmountTarget <= 0n || sellAmountTarget > MAX_SELL_ATOMIC)
    ) {
      return NextResponse.json({ error: "Invalid sell amount." }, { status: 400 });
    }

    const walletLower = session.wallet.toLowerCase();
    if (!checkFundingRateLimit(walletLower)) {
      return NextResponse.json(
        { error: "Too many quote requests in the last 10 minutes. Please wait a moment and try again." },
        { status: 429 }
      );
    }

    // Release any previous open RFQ from this wallet before requesting a new one (protects 4-slot cap)
    const priorCookie = verifyFundingRfqCookie(req.cookies.get(FUNDING_RFQ_COOKIE)?.value);
    if (priorCookie && priorCookie.wallet === walletLower) {
      await textile.cancelQuote(priorCookie.rfqId, priorCookie.claimToken).catch(() => {});
    }

    const token = FUNDING_TOKENS[data.sellToken as FundingTokenSymbol];
    const taker = getAddress(session.wallet);

    try {
      const outcome = isExactInput
        ? await textile.requestFirmExactInput({
            sellToken: token.address,
            buyToken: CELO_TOKENS.USDT.address,
            sellAmountAtomic: sellAmountTarget!.toString(),
            taker,
          })
        : await textile.requestFirmExactOutput({
            sellToken: token.address,
            buyToken: CELO_TOKENS.USDT.address,
            buyAmountAtomic: buyAmountTarget!.toString(),
            taker,
          });

      if (outcome.status !== "quoted" || !outcome.quote || !outcome.transactions?.swap) {
        return NextResponse.json(
          {
            error: `Textile FX has no live firm quote for ${data.sellToken} → USDT right now (${outcome.reason ?? "amount may be below the $1.00 minimum or book is temporarily empty"}).`,
            status: outcome.status,
          },
          { status: 422 }
        );
      }

      const { quote, transactions } = outcome;
      const swapTx = transactions.swap;
      if (!swapTx) {
        return NextResponse.json(
          { error: "Textile FX quote did not include swap calldata." },
          { status: 502 }
        );
      }

      // Strict security allowlist & exact-amount validation BEFORE sending unsigned tx calldata to the user's wallet
      const quoteBuy = BigInt(quote.buyAmount);
      const quoteTakerPays = BigInt(quote.takerPays);
      const amountInvariantOk = isExactInput
        ? quoteTakerPays === sellAmountTarget! &&
          quoteBuy >= MIN_EXACT_INPUT_USDT_OUTPUT_ATOMIC &&
          quoteBuy <= MAX_FUNDING_SWAP_USDT_ATOMIC
        : quoteBuy === buyAmountTarget!;

      if (
        !isAllowedTextileTarget(quote.spender) ||
        !isAllowedTextileTarget(swapTx.to) ||
        swapTx.chainId !== CELO_MAINNET_CHAIN_ID ||
        swapTx.value !== "0" ||
        !amountInvariantOk
      ) {
        if (outcome.claimToken) {
          await textile.cancelQuote(outcome.rfqId, outcome.claimToken).catch(() => {});
        }
        return NextResponse.json(
          { error: "Blocked unexpected Textile FX contract target, chainId, value, or swap amount." },
          { status: 502 }
        );
      }

      // Security: construct exact ERC-20 approve(quote.spender, takerPays) calldata locally instead of forwarding external approvalTx.data
      const safeApprovalTx = {
        to: token.address,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [quote.spender, quoteTakerPays],
        }),
        value: "0",
        chainId: CELO_MAINNET_CHAIN_ID,
      };

      const res = NextResponse.json({
        mode: isExactInput ? "exact-input" : "exact-output",
        rfqId: outcome.rfqId,
        status: outcome.status,
        sellToken: data.sellToken,
        sellTokenAddress: token.address,
        sellDecimals: token.decimals,
        takerPaysAtomic: quote.takerPays,
        takerPaysFormatted: formatDisplayAmount(quote.takerPays, token.decimals),
        buyAmountAtomic: quote.buyAmount,
        buyUsdtFormatted: formatDisplayAmount(quote.buyAmount, 6),
        expiresAt: quote.expiresAt,
        spender: quote.spender,
        transactions: {
          approval: safeApprovalTx,
          swap: swapTx,
        },
      });

      if (outcome.claimToken) {
        res.cookies.set(
          FUNDING_RFQ_COOKIE,
          signFundingRfqCookie({
            rfqId: outcome.rfqId,
            claimToken: outcome.claimToken,
            wallet: session.wallet,
            iat: Date.now(),
          }),
          {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/api/funding",
            maxAge: 300,
          }
        );
      }

      return res;
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to request Textile FX firm quote." },
        { status: 502 }
      );
    }
  }

  const rfqCookie = verifyFundingRfqCookie(req.cookies.get(FUNDING_RFQ_COOKIE)?.value);
  const claimToken =
    rfqCookie &&
    rfqCookie.rfqId === data.rfqId &&
    rfqCookie.wallet === session.wallet.toLowerCase()
      ? rfqCookie.claimToken
      : undefined;

  if (data.action === "submit") {
    try {
      const st = await textile.submitTxHash(data.rfqId, data.txHash as Hash, claimToken);
      return NextResponse.json({ submitted: true, status: st.status });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to report swap tx to Textile." },
        { status: 502 }
      );
    }
  }

  // action === "cancel"
  await textile.cancelQuote(data.rfqId, claimToken).catch(() => {});
  return NextResponse.json({ cancelled: true });
}
