import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { GITHUB_SESSION_COOKIE, verifySessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureDatabaseReady();
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim();
  const ghSession = verifySessionCookie(req.cookies.get(GITHUB_SESSION_COOKIE)?.value);

  let contributor = null;
  const completedBySlug: Record<string, { count: number; lastPayoutAtMs: number | null }> = {};

  if (wallet && isAddress(wallet)) {
    const db = getDb();
    const walletLower = wallet.toLowerCase();
    const [rows, payoutRows] = await Promise.all([
      db
        .select({
          walletAddress: schema.contributors.walletAddress,
          identityProvider: schema.contributors.identityProvider,
          identityHandle: schema.contributors.identityHandle,
          identityProfileUrl: schema.contributors.identityProfileUrl,
          verifiedAt: schema.contributors.verifiedAt,
        })
        .from(schema.contributors)
        .where(eq(schema.contributors.walletAddress, walletLower))
        .limit(1),
      db
        .select({
          slug: schema.campaigns.slug,
          settledAt: schema.settlements.settledAt,
        })
        .from(schema.settlements)
        .innerJoin(schema.campaigns, eq(schema.settlements.campaignId, schema.campaigns.id))
        .where(eq(schema.settlements.recipientWallet, walletLower))
        .orderBy(desc(schema.settlements.settledAt)),
    ]);

    contributor = rows[0] ?? null;

    for (const p of payoutRows) {
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
    contributor,
    completedBySlug,
  });
}
