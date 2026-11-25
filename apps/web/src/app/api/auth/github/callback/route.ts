import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/runtime";
import { GITHUB_SESSION_COOKIE, signSessionPayload } from "@/lib/session";

export const dynamic = "force-dynamic";

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const storedState = req.cookies.get("vire_oauth_state")?.value;

  const appUrl = getAppUrl();
  if (!code || !state || !storedState || !constantTimeEquals(state, storedState)) {
    return NextResponse.redirect(`${appUrl}/claim?oauth=invalid_state`);
  }

  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${appUrl}/claim?oauth=unconfigured`);
  }

  let tokenData: { access_token?: string };
  let userData: { login?: string; html_url?: string; avatar_url?: string };
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${appUrl}/api/auth/github/callback`,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      return NextResponse.redirect(`${appUrl}/claim?oauth=token_failed`);
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Vire-Settlement-Agent/1.0",
      },
      signal: AbortSignal.timeout(10_000),
    });
    userData = (await userRes.json()) as {
      login?: string;
      html_url?: string;
      avatar_url?: string;
    };
  } catch {
    return NextResponse.redirect(`${appUrl}/claim?oauth=network_error`);
  }

  if (!userData.login) {
    return NextResponse.redirect(`${appUrl}/claim?oauth=profile_failed`);
  }

  const signedCookie = signSessionPayload({
    login: userData.login,
    profileUrl: userData.html_url || `https://github.com/${userData.login}`,
    avatarUrl: userData.avatar_url,
    iat: Date.now(),
  });

  const res = NextResponse.redirect(`${appUrl}/claim?oauth=connected&gh=${encodeURIComponent(userData.login)}`);
  res.cookies.delete("vire_oauth_state");
  res.cookies.set(GITHUB_SESSION_COOKIE, signedCookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });
  return res;
}
