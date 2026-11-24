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
