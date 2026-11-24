import {
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as cryptoVerify,
  type JsonWebKey as CryptoJsonWebKey,
} from "node:crypto";

export const GITHUB_SESSION_COOKIE = "vire_gh_identity";
export const WALLET_SESSION_COOKIE = "vire_wallet_session";

export interface GitHubSessionPayload {
  login: string;
  profileUrl: string;
  avatarUrl?: string;
  iat: number;
}

export interface WalletSessionPayload {
  wallet: string; // lowercase 0x...
  handle: string;
  provider: "github" | "x" | "signed_proof";
  iat: number;
}

// ponytail: ephemeral fallback key per process when SESSION_SECRET is unset in local dev; set SESSION_SECRET in prod.
const FALLBACK_SECRET = randomBytes(32).toString("hex");

function getSigningSecret(): string {
  return process.env.SESSION_SECRET?.trim() || FALLBACK_SECRET;
}

function signGeneric(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", getSigningSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function verifyGeneric<T extends { iat: number }>(raw: string | undefined, maxAgeMs: number): T | null {
  if (!raw || !raw.includes(".")) return null;
  const [encoded, sig] = raw.split(".");
  if (!encoded || !sig) return null;
  const expected = createHmac("sha256", getSigningSecret()).update(encoded).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
    if (typeof parsed.iat !== "number") return null;
    if (Date.now() - parsed.iat > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function signSessionPayload(payload: GitHubSessionPayload): string {
  return signGeneric(payload);
}

export function verifySessionCookie(raw: string | undefined): GitHubSessionPayload | null {
  const parsed = verifyGeneric<GitHubSessionPayload>(raw, 7 * 24 * 60 * 60 * 1000);
  return parsed?.login ? parsed : null;
}

export function signWalletSession(payload: WalletSessionPayload): string {
  return signGeneric({ ...payload, wallet: payload.wallet.toLowerCase() });
}

export function verifyWalletSessionCookie(raw: string | undefined): WalletSessionPayload | null {
  const parsed = verifyGeneric<WalletSessionPayload>(raw, 7 * 24 * 60 * 60 * 1000);
  return parsed?.wallet && parsed?.handle ? parsed : null;
}

interface PrivyJwk {
  kty: string;
  crv?: string;
  x?: string;
  y?: string;
  kid?: string;
}

let _cachedPrivyJwks: { fetchedAt: number; keys: PrivyJwk[] } | null = null;

async function getPrivyJwks(appId: string): Promise<PrivyJwk[]> {
  if (_cachedPrivyJwks && Date.now() - _cachedPrivyJwks.fetchedAt < 30 * 60 * 1000) {
    return _cachedPrivyJwks.keys;
  }
  const res = await fetch(`https://auth.privy.io/api/v1/apps/${encodeURIComponent(appId)}/jwks.json`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { keys?: PrivyJwk[] };
  const keys = data.keys ?? [];
  _cachedPrivyJwks = { fetchedAt: Date.now(), keys };
  return keys;
}

/**
 * Cryptographically verify a Privy ES256 Identity Token against Privy's public JWKS (zero external deps)
 * and confirm it links BOTH the expected Celo wallet and expected X/GitHub handle.
 */
export async function verifyPrivyOAuthOwnership(params: {
  identityToken: string;
  walletAddress: string;
  provider: "x" | "github";
  handle: string;
}): Promise<boolean> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  if (!appId || !params.identityToken) return false;

  const parts = params.identityToken.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  try {
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== "ES256") return false;

    const keys = await getPrivyJwks(appId);
    const matchingKeys = header.kid ? keys.filter((k) => k.kid === header.kid) : keys;
    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
    const sigBuf = Buffer.from(sigB64, "base64url");

    let sigOk = false;
    for (const jwk of matchingKeys) {
      try {
        const pubKey = createPublicKey({ key: jwk as CryptoJsonWebKey, format: "jwk" });
        if (cryptoVerify("sha256", signingInput, { key: pubKey, dsaEncoding: "ieee-p1363" }, sigBuf)) {
          sigOk = true;
          break;
        }
      } catch {
        // try next key
      }
    }
    if (!sigOk) return false;

    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      iss?: string;
      aud?: string;
      exp?: number;
      linked_accounts?: string | Array<Record<string, unknown>>;
    };
    if (payload.iss !== "privy.io" || payload.aud !== appId) return false;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return false;

    const rawLinked =
      typeof payload.linked_accounts === "string"
        ? (JSON.parse(payload.linked_accounts) as Array<Record<string, unknown>>)
        : Array.isArray(payload.linked_accounts)
          ? payload.linked_accounts
          : [];

    const wantWallet = params.walletAddress.toLowerCase();
    const wantHandle = params.handle.trim().replace(/^@/, "").toLowerCase();
    const wantType = params.provider === "x" ? "twitter_oauth" : "github_oauth";

    const hasWallet = rawLinked.some(
      (a) =>
        a.type === "wallet" &&
        typeof a.address === "string" &&
        a.address.toLowerCase() === wantWallet
    );
    const hasSocial = rawLinked.some(
      (a) =>
        a.type === wantType &&
        typeof a.username === "string" &&
        a.username.trim().replace(/^@/, "").toLowerCase() === wantHandle
    );

    return hasWallet && hasSocial;
  } catch {
    return false;
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

/** Deterministic EIP-191 message campaign owners / contributors sign to authenticate a wallet session. */
export function buildWalletAuthMessage(walletAddress: string): string {
  return [
    "Vire Wallet Session Authentication (Celo Mainnet 42220)",
    `Wallet: ${walletAddress.toLowerCase()}`,
    "Purpose: Verify wallet ownership to launch or manage Vire campaigns and view submissions.",
  ].join("\n");
}
