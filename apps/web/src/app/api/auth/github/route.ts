import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.json(
      {
        error:
          "GITHUB_CLIENT_ID is not configured on the server. Contributors can still verify using EIP-191 signed wallet proof on /claim.",
      },
      { status: 503 }
    );
  }

  const state = randomBytes(16).toString("hex");
  const redirectUri = `${getAppUrl()}/api/auth/github/callback`;
  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "read:user");
  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set("vire_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}
