import { fromDataSuffix, toDataSuffix, verifyTx } from "@celo/attribution-tags";
import {
  CELO_CONTRACTS,
  CELO_TOKENS,
  DEFAULT_ATTRIBUTION_CODE,
  validateAttributionCode,
} from "@vire/shared";
import {
  concatHex,
  erc20Abi,
  encodeFunctionData,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";

export interface SendTaggedTxParams {
  walletClient: WalletClient<Transport, Chain, Account>;
  publicClient: PublicClient<Transport, Chain>;
  to: Address;
  data?: Hex;
  value?: bigint;
  attributionCode?: string;
  /** When true, pays Celo gas fees in USD₮ via the verified CIP-64 FeeCurrency Adapter. */
  useUsdtFeeAbstraction?: boolean;
  /** Optional explicit CIP-64 feeCurrency adapter address (never a 6-decimal token address). */
  feeCurrencyAdapter?: Address;
}

export interface TaggedTxResult {
  hash: Hash;
  attributionCode: string;
  feeCurrencyUsed: Address | null;
}

/**
 * Guardrail preventing passing a raw 6-decimal token address as Celo CIP-64 feeCurrency.
 * Celo gas math requires the 18-decimal FeeCurrency Adapter contract.
 */
export function resolveSafeFeeCurrency(options: {
  useUsdtFeeAbstraction?: boolean;
  feeCurrencyAdapter?: Address;
}): Address | undefined {
  if (options.feeCurrencyAdapter) {
    const lower = options.feeCurrencyAdapter.toLowerCase();
    if (
      lower === CELO_TOKENS.USDT.address.toLowerCase() ||
      lower === CELO_TOKENS.USDC.address.toLowerCase()
    ) {
      throw new Error(
        `Unsafe CIP-64 feeCurrency "${options.feeCurrencyAdapter}": pass the 18-decimal FeeCurrency Adapter (${CELO_CONTRACTS.USDT_FEE_ADAPTER}), never the 6-decimal ERC-20 token address.`
      );
    }
    return options.feeCurrencyAdapter;
  }
  if (options.useUsdtFeeAbstraction) {
    return CELO_CONTRACTS.USDT_FEE_ADAPTER;
  }
  return undefined;
}

/**
 * Append a single ERC-8021 attribution suffix cleanly (throws if data already ends with an ERC-8021 tag
 * so we never accidentally double-tag calldata).
 */
export function appendAttributionSuffixSafe(data: Hex | undefined, code: string): Hex {
  const validCode = validateAttributionCode(code);
  const baseData: Hex = data ?? "0x";
  if (baseData.length > 2) {
    const existing = fromDataSuffix(baseData);
    if (existing && existing.codes.length > 0) {
      throw new Error(
        `Refusing to double-tag calldata that already carries ERC-8021 codes [${existing.codes.join(", ")}]`
      );
    }
  }
  const suffix = toDataSuffix(validCode);
  return baseData === "0x" ? suffix : concatHex([baseData, suffix]);
}

/**
 * Send any non-Textile Celo transaction with ERC-8021 attribution and optional CIP-64 USD₮ gas abstraction.
 * Waits for mined receipt confirmation and verifies status === "success".
 */
export async function sendTaggedTx(params: SendTaggedTxParams): Promise<TaggedTxResult> {
  const code = validateAttributionCode(params.attributionCode ?? DEFAULT_ATTRIBUTION_CODE);
  const feeCurrency = resolveSafeFeeCurrency({
    useUsdtFeeAbstraction: params.useUsdtFeeAbstraction,
    feeCurrencyAdapter: params.feeCurrencyAdapter,
  });

  // If the caller passed an untagged walletClient, append suffix explicitly;
  // if caller passed a walletClient already extended with withAttribution(), avoid double-tagging.
  const data = params.data ?? "0x";
  const alreadyTagged = data.length > 2 ? fromDataSuffix(data) : null;
  if (alreadyTagged && alreadyTagged.codes.length > 0) {
    throw new Error(
      `sendTaggedTx received pre-tagged calldata [${alreadyTagged.codes.join(", ")}]. Use verbatim untagged broadcast for Textile swaps.`
    );
  }

  // If walletClient was already extended by createTaggedWalletClient (withAttribution),
  // avoid appending the suffix twice; otherwise append once explicitly.
  const clientTag = (params.walletClient as { __vireAttributedCode?: string }).__vireAttributedCode;
  const finalData = clientTag ? data : appendAttributionSuffixSafe(data, code);

  // Use raw sendTransaction with feeCurrency when CIP-64 abstraction is enabled.
  const txRequest = {
    account: params.walletClient.account,
    chain: params.walletClient.chain,
    to: params.to,
    data: finalData,
    value: params.value ?? 0n,
    ...(feeCurrency ? { feeCurrency } : {}),
  };

  const hash = await params.walletClient.sendTransaction(txRequest as Parameters<typeof params.walletClient.sendTransaction>[0]);
  const receipt = await params.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Tagged transaction ${hash} reverted onchain`);
  }

  return {
    hash,
    attributionCode: code,
    feeCurrencyUsed: feeCurrency ?? null,
  };
}

/**
 * Send a tagged ERC-20 transfer (e.g., local stablecoin payout to contributor).
 */
export async function sendTaggedErc20Transfer(params: {
  walletClient: WalletClient<Transport, Chain, Account>;
  publicClient: PublicClient<Transport, Chain>;
  tokenAddress: Address;
  recipient: Address;
  amountAtomic: bigint;
  attributionCode?: string;
  useUsdtFeeAbstraction?: boolean;
}): Promise<TaggedTxResult> {
  const transferCalldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [params.recipient, params.amountAtomic],
  });

  return sendTaggedTx({
    walletClient: params.walletClient,
    publicClient: params.publicClient,
    to: params.tokenAddress,
    data: transferCalldata,
    attributionCode: params.attributionCode,
    useUsdtFeeAbstraction: params.useUsdtFeeAbstraction,
  });
}

/**
 * Programmatically verify ERC-8021 attribution tags on any mined Celo transaction hash.
 */
export async function verifyAttributionTx(params: {
  publicClient: PublicClient<Transport, Chain>;
  hash: Hash;
}): Promise<{
  tagged: boolean;
  codes: string[];
  schemaId: number | null;
}> {
  const result = await verifyTx({
    client: params.publicClient as Parameters<typeof verifyTx>[0]["client"],
    hash: params.hash,
  });
  if (!result) {
    return { tagged: false, codes: [], schemaId: null };
  }
  return {
    tagged: result.codes.length > 0,
    codes: [...result.codes],
    schemaId: result.schemaId,
  };
}

export function decodeAttributionSuffix(calldata: Hex) {
  return fromDataSuffix(calldata);
}
