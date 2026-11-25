import { randomBytes } from "node:crypto";
import { EthAddressSchema } from "@vire/shared";
import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import { z } from "zod";
import {
  buildWalletAuthMessage,
  FUNDING_RFQ_COOKIE,
  GITHUB_SESSION_COOKIE,
  signAuthChallengeCookie,
  signWalletSession,
  verifyAuthChallengeCookie,
  verifyWalletSessionCookie,
  WALLET_CHALLENGE_COOKIE,
  WALLET_SESSION_COOKIE,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const AuthWalletBodySchema = z.object({
  walletAddress: EthAddressSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "Invalid EIP-191 signature"),
});

export async function GET(req: NextRequest) {
  // Issue a short-lived single-use challenge nonce bound to an HttpOnly cookie (prevents signature replay)
  if (req.nextUrl.searchParams.get("challenge") === "1") {
    const rawWallet = req.nextUrl.searchParams.get("wallet")?.trim() || "";
    if (!isAddress(rawWallet)) {
      return NextResponse.json({ error: "Valid wallet address required for challenge." }, { status: 400 });
    }
    const walletLower = getAddress(rawWallet).toLowerCase();
    const nonce = randomBytes(16).toString("hex");
    const cookieVal = signAuthChallengeCookie({ nonce, wallet: walletLower, iat: Date.now() });
    const res = NextResponse.json(
      { nonce, wallet: walletLower },
      { headers: { "Cache-Control": "no-store" } }
    );
    res.cookies.set(WALLET_CHALLENGE_COOKIE, cookieVal, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 300,
    });
    return res;
  }

  const session = verifyWalletSessionCookie(req.cookies.get(WALLET_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ authenticated: false, wallet: null });
  }
  return NextResponse.json({
    authenticated: true,
    wallet: session.wallet,
    handle: session.handle,
    provider: session.provider,
  });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => null);
  const parsed = AuthWalletBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid wallet authentication payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const wallet = getAddress(parsed.data.walletAddress);
  const walletLower = wallet.toLowerCase();
  const challenge = verifyAuthChallengeCookie(req.cookies.get(WALLET_CHALLENGE_COOKIE)?.value);
  if (!challenge || challenge.wallet !== walletLower) {
    return NextResponse.json(
      { error: "Wallet sign-in challenge expired or missing. Please click Sign to verify again." },
      { status: 401 }
    );
  }

  const expectedMessage = buildWalletAuthMessage(wallet, challenge.nonce);
  const valid = await verifyMessage({
    address: wallet,
    message: expectedMessage,
    signature: parsed.data.signature as Hex,
  }).catch(() => false);

  if (!valid) {
    return NextResponse.json({ error: "Wallet signature verification failed." }, { status: 401 });
  }

  // Preserve an existing handle if already authenticated with this wallet
  const existing = verifyWalletSessionCookie(req.cookies.get(WALLET_SESSION_COOKIE)?.value);
  const now = Date.now();
  const handle =
    existing && existing.wallet === walletLower ? existing.handle : `${walletLower.slice(0, 8)}`;
  const provider = existing && existing.wallet === walletLower ? existing.provider : "signed_proof";

  const cookieVal = signWalletSession({
    wallet: walletLower,
    handle,
    provider,
    iat: now,
  });

  const res = NextResponse.json({ authenticated: true, wallet: walletLower, handle, provider });
  res.cookies.delete(WALLET_CHALLENGE_COOKIE);
  res.cookies.set(WALLET_SESSION_COOKIE, cookieVal, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ signedOut: true });
  res.cookies.delete(WALLET_SESSION_COOKIE);
  res.cookies.delete(WALLET_CHALLENGE_COOKIE);
  res.cookies.delete(GITHUB_SESSION_COOKIE);
  res.cookies.delete({ name: FUNDING_RFQ_COOKIE, path: "/api/funding" });
  return res;
}
