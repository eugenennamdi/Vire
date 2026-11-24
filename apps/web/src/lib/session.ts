import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GITHUB_SESSION_COOKIE = "vire_gh_identity";

export interface GitHubSessionPayload {
  login: string;
  profileUrl: string;
  avatarUrl?: string;
  iat: number;
}

// ponytail: ephemeral fallback key per process when SESSION_SECRET is unset in local dev; set SESSION_SECRET in prod.
const FALLBACK_SECRET = randomBytes(32).toString("hex");

function getSigningSecret(): string {
  return process.env.SESSION_SECRET?.trim() || FALLBACK_SECRET;
}

export function signSessionPayload(payload: GitHubSessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", getSigningSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifySessionCookie(raw: string | undefined): GitHubSessionPayload | null {
  if (!raw || !raw.includes(".")) return null;
  const [encoded, sig] = raw.split(".");
  if (!encoded || !sig) return null;
  const expected = createHmac("sha256", getSigningSecret()).update(encoded).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GitHubSessionPayload;
    if (!parsed.login || typeof parsed.iat !== "number") return null;
    // Expire sessions after 7 days
    if (Date.now() - parsed.iat > 7 * 24 * 60 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Deterministic EIP-191 message contributors sign to bind their external handle to their Celo wallet. */
export function buildIdentityBindMessage(params: {
  walletAddress: string;
  provider: "github" | "x" | "signed_proof";
  handle: string;
}): string {
  return [
    "Vire Contributor Identity Binding (Celo Mainnet 42220)",
    `Wallet: ${params.walletAddress.toLowerCase()}`,
    `Provider: ${params.provider}`,
    `Handle: ${params.handle.trim()}`,
    "Purpose: Bind external identity for non-team proof-of-work settlement on Vire.",
  ].join("\n");
}
