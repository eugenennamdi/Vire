export function buildIdentityBindMessage(params: {
  walletAddress: string;
  provider: "github" | "x" | "signed_proof";
  handle: string;
  nonce: string;
}): string {
  return [
    "Vire Contributor Identity Binding (Celo Mainnet 42220)",
    `Wallet: ${params.walletAddress.toLowerCase()}`,
    `Provider: ${params.provider}`,
    `Handle: ${params.handle.trim()}`,
    `Nonce: ${params.nonce}`,
    "Purpose: Bind external identity for non-team proof-of-work settlement on Vire.",
  ].join("\n");
}

export function buildWalletAuthMessage(walletAddress: string, nonce: string): string {
  return [
    "Vire Wallet Session Authentication (Celo Mainnet 42220)",
    `Wallet: ${walletAddress.toLowerCase()}`,
    `Nonce: ${nonce}`,
    "Purpose: Verify wallet ownership to launch or manage Vire campaigns and view submissions.",
  ].join("\n");
}

/** Fetch a short-lived server-issued challenge nonce (stored in an HttpOnly cookie) before signing EIP-191 auth. */
export async function requestAuthNonce(walletAddress: string): Promise<string> {
  const res = await fetch(
    `/api/auth/wallet?challenge=1&wallet=${encodeURIComponent(walletAddress)}`,
    { cache: "no-store" }
  );
  const json = (await res.json().catch(() => ({}))) as { nonce?: string; error?: string };
  if (!res.ok || !json.nonce) {
    throw new Error(json.error || "Failed to initialize wallet sign-in challenge.");
  }
  return json.nonce;
}
