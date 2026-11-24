import {
  CELO_TOKENS,
  FUNDING_TOKENS,
  isAllowedTextileTarget,
  type FundingTokenSymbol,
} from "@vire/shared";
import { NextRequest, NextResponse } from "next/server";
import { formatUnits, getAddress, type Hash } from "viem";
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

const FundingSymbolSchema = z.enum(["USDT", "USDC", "CELO", "cNGN", "wARS", "wBRL", "wMXN", "IDRX"]);

function formatDisplayAmount(atomic: string, decimals: number): string {
  const num = Number(formatUnits(BigInt(atomic), decimals));
  if (!Number.isFinite(num)) return "0";
  return num >= 100
    ? num.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : num.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/**
 * GET /api/funding?sellToken=wARS&buyUsdtAtomic=10000000
 * Free indicative Textile FX exact-output preview converting a supported Celo token into exact USDT.
 */
export async function GET(req: NextRequest) {
  const sellParam = req.nextUrl.searchParams.get("sellToken") || "";
  const buyUsdtParam = req.nextUrl.searchParams.get("buyUsdtAtomic") || "";

  const symParsed = FundingSymbolSchema.safeParse(sellParam);
  if (!symParsed.success || !/^\d+$/.test(buyUsdtParam)) {
    return NextResponse.json({ error: "Invalid sellToken or buyUsdtAtomic" }, { status: 400 });
  }

  const sym = symParsed.data as FundingTokenSymbol;
  const buyUsdtAtomic = BigInt(buyUsdtParam);
  if (buyUsdtAtomic < 1_000_000n) {
    return NextResponse.json(
      { error: "Minimum swap size is $1.00 USDT (1000000 atomic)." },
      { status: 400 }
    );
  }

  if (sym === "USDT") {
    return NextResponse.json({
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
    sellToken: FundingSymbolSchema.refine((s) => s !== "USDT", "USDT deposits do not need a swap"),
    buyUsdtAtomic: z.string().regex(/^\d+$/),
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
 * Authenticated Textile FX v2 firm quote lifecycle for funding a VireVault v2 campaign with any supported token.
 * Keeps `claimToken` strictly server-private inside a short-lived HttpOnly signed cookie.
 */
export async function POST(req: NextRequest) {
  const session = verifyWalletSessionCookie(req.cookies.get(WALLET_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { error: "Please sign with your wallet before requesting a firm Textile FX funding quote." },
      { status: 401 }
    );
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = PostFundingSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid funding request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const textile = getTextileClient();
  const data = parsed.data;

  if (data.action === "request") {
    if (!textile.hasPartnerApiKey) {
      return NextResponse.json(
        { error: "Textile Partner API key is required for multi-token wallet funding swaps." },
        { status: 503 }
      );
    }

    const buyAmount = BigInt(data.buyUsdtAtomic);
    if (buyAmount < 1_000_000n) {
      return NextResponse.json({ error: "Minimum swap output is $1.00 USDT." }, { status: 400 });
    }

    const token = FUNDING_TOKENS[data.sellToken as FundingTokenSymbol];
    const taker = getAddress(session.wallet);

    try {
      const outcome = await textile.requestFirmExactOutput({
        sellToken: token.address,
        buyToken: CELO_TOKENS.USDT.address,
        buyAmountAtomic: buyAmount.toString(),
        taker,
      });

      if (outcome.status !== "quoted" || !outcome.quote || !outcome.transactions?.swap) {
        return NextResponse.json(
          {
            error: `Textile FX has no live firm quote for ${data.sellToken} → USDT right now (${outcome.reason ?? "empty book"}). Try USDT or USDC.`,
            status: outcome.status,
          },
          { status: 422 }
        );
      }

      const { quote, transactions } = outcome;
      const swapTx = transactions.swap;
      const approvalTx = transactions.approval;
      if (!swapTx) {
        return NextResponse.json(
          { error: "Textile FX quote did not include swap calldata." },
          { status: 502 }
        );
      }

      // Strict security allowlist validation BEFORE sending unsigned tx calldata to the user's wallet
      if (!isAllowedTextileTarget(quote.spender) || !isAllowedTextileTarget(swapTx.to)) {
        if (outcome.claimToken) {
          await textile.cancelQuote(outcome.rfqId, outcome.claimToken).catch(() => {});
        }
        return NextResponse.json(
          { error: "Blocked non-allowlisted Textile settlement contract." },
          { status: 502 }
        );
      }
      if (approvalTx.to.toLowerCase() !== token.address.toLowerCase() || swapTx.value !== "0") {
        if (outcome.claimToken) {
          await textile.cancelQuote(outcome.rfqId, outcome.claimToken).catch(() => {});
        }
        return NextResponse.json(
          { error: "Unexpected approval target or native value on Textile FX funding quote." },
          { status: 502 }
        );
      }

      const res = NextResponse.json({
        rfqId: outcome.rfqId,
        status: outcome.status,
        sellToken: data.sellToken,
        sellTokenAddress: token.address,
        sellDecimals: token.decimals,
        takerPaysAtomic: quote.takerPays,
        takerPaysFormatted: formatDisplayAmount(quote.takerPays, token.decimals),
        buyAmountAtomic: quote.buyAmount,
        expiresAt: quote.expiresAt,
        spender: quote.spender,
        transactions: {
          approval: approvalTx,
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
