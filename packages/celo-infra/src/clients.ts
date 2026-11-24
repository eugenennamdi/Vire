import { withAttribution } from "@celo/attribution-tags";
import {
  CELO_MAINNET_CHAIN_ID,
  DEFAULT_ATTRIBUTION_CODE,
  DEFAULT_CELO_RPC_URL,
  validateAttributionCode,
} from "@vire/shared";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoSepolia } from "viem/chains";

export function resolveCeloChain(chainId: number = CELO_MAINNET_CHAIN_ID): Chain {
  if (chainId === 42220) return celo;
  if (chainId === 11142220) return celoSepolia;
  throw new Error(
    `Unsupported Celo chainId ${chainId}. Use Celo Mainnet (42220) or Celo Sepolia (11142220).`
  );
}

export function createCeloPublicClient(options?: {
  rpcUrl?: string;
  chainId?: number;
}): PublicClient<Transport, Chain> {
  const chain = resolveCeloChain(options?.chainId ?? CELO_MAINNET_CHAIN_ID);
  const rpcUrl = options?.rpcUrl?.trim() || DEFAULT_CELO_RPC_URL;
  return createPublicClient({
    chain,
    transport: http(rpcUrl, {
      timeout: 30_000,
      retryCount: 2,
    }),
  });
}

/**
 * Wallet client extended with @celo/attribution-tags (ERC-8021) for ALL non-Textile transactions
 * (VireVault calls, local stablecoin payouts, ERC-8004 identity/reputation transactions).
 */
export function createTaggedWalletClient(options: {
  privateKey: Hex;
  attributionCode?: string;
  rpcUrl?: string;
  chainId?: number;
}): WalletClient<Transport, Chain, Account> & { __vireAttributedCode: string } {
  const chain = resolveCeloChain(options.chainId ?? CELO_MAINNET_CHAIN_ID);
  const rpcUrl = options.rpcUrl?.trim() || DEFAULT_CELO_RPC_URL;
  const code = validateAttributionCode(options.attributionCode ?? DEFAULT_ATTRIBUTION_CODE);
  const account: Account = privateKeyToAccount(options.privateKey);

  const client = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl, { timeout: 30_000 }),
  }).extend(withAttribution(code));

  return Object.assign(client, { __vireAttributedCode: code }) as unknown as WalletClient<
    Transport,
    Chain,
    Account
  > & { __vireAttributedCode: string };
}

/**
 * Strictly UNTAGGED wallet client dedicated ONLY to broadcasting verbatim Textile FX swap calldata.
 * CRITICAL: Textile FX v2 already appends a single merged ERC-8021 suffix carrying `textile_api`
 * and Vire's `builderCodes`. Broadcasting via an untagged client guarantees ZERO double-tagging.
 */
export function createUntaggedTextileWalletClient(options: {
  privateKey: Hex;
  rpcUrl?: string;
  chainId?: number;
}): WalletClient<Transport, Chain, Account> {
  const chain = resolveCeloChain(options.chainId ?? CELO_MAINNET_CHAIN_ID);
  const rpcUrl = options.rpcUrl?.trim() || DEFAULT_CELO_RPC_URL;
  const account = privateKeyToAccount(options.privateKey);

  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrl, { timeout: 30_000 }),
  });
}
