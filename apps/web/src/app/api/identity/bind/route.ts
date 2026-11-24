import { EthAddressSchema } from "@vire/shared";
import { NextRequest, NextResponse } from "next/server";
import { getAddress, verifyMessage, type Hex } from "viem";
import { z } from "zod";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import {
  buildIdentityBindMessage,
  GITHUB_SESSION_COOKIE,
  signWalletSession,
  verifyPrivyOAuthOwnership,
  verifySessionCookie,
  WALLET_SESSION_COOKIE,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const BindBodySchema = z.object({
  walletAddress: EthAddressSchema,
  provider: z.enum(["github", "x", "signed_proof"]),
  handle: z.string().min(2).max(64).regex(/^@?[a-zA-Z0-9._-]+$/, "Invalid handle format"),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "Invalid EIP-191 signature"),
  privyIdentityToken: z.string().max(8192).optional().nullable(),
});

export async function POST(req: NextRequest) {
  await ensureDatabaseReady();

  const rawBody = await req.json().catch(() => null);
  const parsed = BindBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid identity binding request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { provider, signature } = parsed.data;
  const wallet = getAddress(parsed.data.walletAddress);
  let cleanHandle = parsed.data.handle.trim().replace(/^@/, "");
  let profileUrl =
    provider === "github"
      ? `https://github.com/${cleanHandle}`
      : provider === "x"
        ? `https://x.com/${cleanHandle}`
        : `https://celoscan.io/address/${wallet}`;

  // If GitHub OAuth session cookie exists, enforce matching GitHub login
  let oauthVerified = false;
  const ghSession = verifySessionCookie(req.cookies.get(GITHUB_SESSION_COOKIE)?.value);
  if (provider === "github" && ghSession) {
    cleanHandle = ghSession.login;
    profileUrl = ghSession.profileUrl;
    oauthVerified = true;
  }

  // Cryptographically verify Privy ES256 Identity Token for X or GitHub OAuth ownership when provided
  if (
    !oauthVerified &&
    (provider === "x" || provider === "github") &&
    parsed.data.privyIdentityToken
  ) {
    oauthVerified = await verifyPrivyOAuthOwnership({
      identityToken: parsed.data.privyIdentityToken,
      walletAddress: wallet,
      provider,
      handle: cleanHandle,
    });
  }

  // Cryptographically verify EIP-191 signature from the contributor's wallet
  const expectedMessage = buildIdentityBindMessage({
    walletAddress: wallet,
    provider,
    handle: parsed.data.handle.trim(),
  });

  const valid = await verifyMessage({
    address: wallet,
    message: expectedMessage,
    signature: signature as Hex,
  }).catch(() => false);

  if (!valid) {
    return NextResponse.json(
      { error: "EIP-191 wallet signature verification failed for identity binding." },
      { status: 401 }
    );
  }

  const db = getDb();
  const now = Date.now();
  await db
    .insert(schema.contributors)
    .values({
      walletAddress: wallet.toLowerCase(),
      identityProvider: provider,
      identityHandle: cleanHandle,
      identityProfileUrl: profileUrl,
      eip191Signature: signature,
      oauthVerified,
      verifiedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.contributors.walletAddress,
      set: {
        identityProvider: provider,
        identityHandle: cleanHandle,
        identityProfileUrl: profileUrl,
        eip191Signature: signature,
        oauthVerified,
        verifiedAt: now,
      },
    });

  const sessionCookie = signWalletSession({
    wallet: wallet.toLowerCase(),
    handle: cleanHandle,
    provider,
    iat: now,
  });

  const res = NextResponse.json({
    verified: true,
    oauthVerified,
    walletAddress: wallet,
    provider,
    handle: cleanHandle,
    profileUrl,
    verifiedAt: now,
  });

  res.cookies.set(WALLET_SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });

  return res;
}
