import { EthAddressSchema } from "@vire/shared";
import { NextRequest, NextResponse } from "next/server";
import { getAddress, verifyMessage, type Hex } from "viem";
import { z } from "zod";
import {
  buildWalletAuthMessage,
  signWalletSession,
  verifyWalletSessionCookie,
  WALLET_SESSION_COOKIE,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const AuthWalletBodySchema = z.object({
  walletAddress: EthAddressSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "Invalid EIP-191 signature"),
});

export async function GET(req: NextRequest) {
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
  const expectedMessage = buildWalletAuthMessage(wallet);
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
  const walletLower = wallet.toLowerCase();
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
  res.cookies.set(WALLET_SESSION_COOKIE, cookieVal, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}
