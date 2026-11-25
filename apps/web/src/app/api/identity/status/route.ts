import { desc, eq, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import {
  GITHUB_SESSION_COOKIE,
  verifySessionCookie,
  verifyWalletSessionCookie,
  WALLET_SESSION_COOKIE,
} from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureDatabaseReady();
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim();
  const ghSession = verifySessionCookie(req.cookies.get(GITHUB_SESSION_COOKIE)?.value);
  const walletSession = verifyWalletSessionCookie(req.cookies.get(WALLET_SESSION_COOKIE)?.value);

  let contributor = null;
  const completedBySlug: Record<string, { count: number; lastPayoutAtMs: number | null }> = {};
  let hasWalletSession = false;

  if (wallet && isAddress(wallet)) {
    const db = getDb();
    const walletLower = wallet.toLowerCase();
    hasWalletSession = walletSession?.wallet === walletLower;

    const rows = await db
      .select({
        walletAddress: schema.contributors.walletAddress,
        identityProvider: schema.contributors.identityProvider,
        identityHandle: schema.contributors.identityHandle,
        identityProfileUrl: schema.contributors.identityProfileUrl,
        oauthVerified: schema.contributors.oauthVerified,
        verifiedAt: schema.contributors.verifiedAt,
      })
      .from(schema.contributors)
      .where(eq(schema.contributors.walletAddress, walletLower))
      .limit(1);

    contributor = rows[0] ?? null;

    const cleanHandleLower = contributor?.identityHandle?.trim().replace(/^@/, "").toLowerCase();
    const payoutRows = await db
      .select({
        slug: schema.campaigns.slug,
        visibility: schema.campaigns.visibility,
        settledAt: schema.settlements.settledAt,
      })
      .from(schema.settlements)
      .innerJoin(schema.campaigns, eq(schema.settlements.campaignId, schema.campaigns.id))
      .where(
        cleanHandleLower
          ? or(
              eq(schema.settlements.recipientWallet, walletLower),
              eq(schema.settlements.identityHandle, cleanHandleLower)
            )
          : eq(schema.settlements.recipientWallet, walletLower)
      )
      .orderBy(desc(schema.settlements.settledAt));

    for (const p of payoutRows) {
      // Never leak private (unlisted) campaign slugs to unauthenticated callers querying a wallet
      if (p.visibility === "unlisted" && !hasWalletSession) continue;
      const existing = completedBySlug[p.slug];
      if (!existing) {
        completedBySlug[p.slug] = { count: 1, lastPayoutAtMs: p.settledAt };
      } else {
        existing.count += 1;
      }
    }
  }

  return NextResponse.json({
    githubSession: ghSession ? { login: ghSession.login, profileUrl: ghSession.profileUrl } : null,
    githubOAuthConfigured: Boolean(process.env.GITHUB_CLIENT_ID?.trim()),
    hasWalletSession,
    contributor,
    completedBySlug,
  });
}
