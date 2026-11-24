import { eq } from "drizzle-orm";
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
  if (wallet && isAddress(wallet)) {
    const db = getDb();
    const rows = await db
      .select({
        walletAddress: schema.contributors.walletAddress,
        identityProvider: schema.contributors.identityProvider,
        identityHandle: schema.contributors.identityHandle,
        identityProfileUrl: schema.contributors.identityProfileUrl,
        verifiedAt: schema.contributors.verifiedAt,
      })
      .from(schema.contributors)
      .where(eq(schema.contributors.walletAddress, wallet.toLowerCase()))
      .limit(1);
    contributor = rows[0] ?? null;
  }

  return NextResponse.json({
    githubSession: ghSession ? { login: ghSession.login, profileUrl: ghSession.profileUrl } : null,
    githubOAuthConfigured: Boolean(process.env.GITHUB_CLIENT_ID?.trim()),
    contributor,
  });
}
