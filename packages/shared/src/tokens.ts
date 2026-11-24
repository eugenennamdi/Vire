import { getAddress, type Address } from "viem";

export const CELO_MAINNET_CHAIN_ID = 42220 as const;
export const CELO_SEPOLIA_CHAIN_ID = 11142220 as const;

export const DEFAULT_CELO_RPC_URL = "https://forno.celo.org";
export const DEFAULT_TEXTILE_API_URL = "https://api.textilecredit.com/v2";
export const DEFAULT_X402_FACILITATOR_URL = "https://api.x402.celo.org";
export const DEFAULT_BUY_GATEWAY_URL = "https://gateway.usebuy.ai";
export const CELOSCAN_BASE_URL = "https://celoscan.io";

/** Official Loops House / Celo ERC-8021 attribution code for Vire. */
export const DEFAULT_ATTRIBUTION_CODE = "celo_55a64f75ba4a";

export const ATTRIBUTION_CODE_REGEX = /^[a-z0-9_]{1,32}$/;

export function validateAttributionCode(code: string): string {
  const trimmed = code.trim();
  if (!ATTRIBUTION_CODE_REGEX.test(trimmed)) {
    throw new Error(`Invalid ERC-8021 attribution code "${code}": must match ^[a-z0-9_]{1,32}$`);
  }
  if (trimmed.startsWith("textile_") || trimmed.startsWith("tp_")) {
    throw new Error(`Reserved attribution code prefix in "${code}": cannot start with textile_ or tp_`);
  }
  return trimmed;
}

export type TokenSymbol = "USDT" | "USDC" | "cNGN" | "IDRX" | "wARS" | "wBRL" | "wMXN" | "wCOP";
export type CorridorSymbol = "cNGN" | "IDRX" | "wARS" | "wBRL" | "wMXN" | "wCOP";
export type FundingTokenSymbol = "USDT" | "USDC" | "CELO" | "cNGN" | "wARS" | "wBRL" | "wMXN" | "IDRX";

export interface FundingTokenInfo {
  symbol: FundingTokenSymbol;
  name: string;
  address: Address;
  decimals: number;
}

export interface X402AssetDomain {
  name: string;
  version: string;
  assetTransferMethod: "eip3009" | "permit2";
  eip2612GasSponsoring: boolean;
}

export interface CeloTokenInfo {
  symbol: TokenSymbol;
  displaySymbol: string;
  name: string;
  address: Address;
  decimals: number;
  feeCurrencyAdapter?: Address;
  x402?: X402AssetDomain;
  notes: string;
}

/**
 * Canonical Celo Mainnet (Chain ID 42220) token & contract registry.
 * CRITICAL: Never assume 18 decimals. IDRX has 2 decimals; USD₮, USDC, cNGN have 6; wFIAT tokens have 18.
 */
export const CELO_TOKENS: Record<TokenSymbol, CeloTokenInfo> = {
  USDT: {
    symbol: "USDT",
    displaySymbol: "USD₮",
    name: "Tether USD",
    address: getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"),
    decimals: 6,
    feeCurrencyAdapter: getAddress("0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72"),
    x402: {
      name: "Tether USD",
      version: "1",
      assetTransferMethod: "eip3009",
      eip2612GasSponsoring: false,
    },
    notes: "Treasury & Textile sell leg. Use feeCurrencyAdapter for CIP-64 gas-in-USD₮.",
  },
  USDC: {
    symbol: "USDC",
    displaySymbol: "USDC",
    name: "USD Coin",
    address: getAddress("0xcebA9300f2b948710d2653dD7B07f33A8B32118C"),
    decimals: 6,
    feeCurrencyAdapter: getAddress("0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B"),
    x402: {
      name: "USDC",
      version: "2",
      assetTransferMethod: "eip3009",
      eip2612GasSponsoring: false,
    },
    notes: "Circle native USDC on Celo Mainnet.",
  },
  cNGN: {
    symbol: "cNGN",
    displaySymbol: "cNGN",
    name: "Compliant Naira",
    address: getAddress("0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f"),
    decimals: 6,
    x402: {
      name: "cNGN",
      version: "1",
      assetTransferMethod: "permit2",
      eip2612GasSponsoring: false,
    },
    notes: "SEC-regulated Nigerian Naira stablecoin (6 decimals).",
  },
  IDRX: {
    symbol: "IDRX",
    displaySymbol: "IDRX",
    name: "Indonesian Rupiah Stablecoin",
    address: getAddress("0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22"),
    decimals: 2,
    notes: "CRITICAL: 2 DECIMALS ONLY — never scale by 1e6 or 1e18.",
  },
  wARS: {
    symbol: "wARS",
    displaySymbol: "wARS",
    name: "Ripio Wrapped Argentine Peso",
    address: getAddress("0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D"),
    decimals: 18,
    x402: {
      name: "Peso Argentino",
      version: "1",
      assetTransferMethod: "permit2",
      eip2612GasSponsoring: true,
    },
    notes: "Ripio wFIAT (18 decimals, zero-fee Ripio off-ramp).",
  },
  wBRL: {
    symbol: "wBRL",
    displaySymbol: "wBRL",
    name: "Ripio Wrapped Brazilian Real",
    address: getAddress("0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0"),
    decimals: 18,
    x402: {
      name: "Real Brasileño",
      version: "1",
      assetTransferMethod: "permit2",
      eip2612GasSponsoring: true,
    },
    notes: "Ripio wFIAT (18 decimals, zero-fee Ripio off-ramp).",
  },
  wMXN: {
    symbol: "wMXN",
    displaySymbol: "wMXN",
    name: "Ripio Wrapped Mexican Peso",
    address: getAddress("0x337E7456B420bD3481e7FA61fA9850343d610d34"),
    decimals: 18,
    x402: {
      name: "Peso Mexicano",
      version: "1",
      assetTransferMethod: "permit2",
      eip2612GasSponsoring: true,
    },
    notes: "Ripio wFIAT (18 decimals, zero-fee Ripio off-ramp).",
  },
  wCOP: {
    symbol: "wCOP",
    displaySymbol: "wCOP",
    name: "Ripio Wrapped Colombian Peso",
    address: getAddress("0x8a1D45e102e886510e891d2Ec656a708991e2D76"),
    decimals: 18,
    x402: {
      name: "Peso Colombiano",
      version: "1",
      assetTransferMethod: "permit2",
      eip2612GasSponsoring: true,
    },
    notes: "Ripio wFIAT (18 decimals, Colombia interbank FX market hours).",
  },
} as const;

export const CELO_NATIVE_ERC20_ADDRESS = getAddress("0x471EcE3750Da237f93B8E339c536989b8978a438");

/** Deep-liquidity Celo Mainnet tokens supported for campaign funding (direct USD₮ or auto-swapped via Textile FX into USD₮). */
export const FUNDING_TOKENS: Record<FundingTokenSymbol, FundingTokenInfo> = {
  USDT: { symbol: "USDT", name: "Tether USD", address: CELO_TOKENS.USDT.address, decimals: 6 },
  USDC: { symbol: "USDC", name: "USD Coin", address: CELO_TOKENS.USDC.address, decimals: 6 },
  CELO: { symbol: "CELO", name: "Celo", address: CELO_NATIVE_ERC20_ADDRESS, decimals: 18 },
  cNGN: { symbol: "cNGN", name: "Compliant Naira", address: CELO_TOKENS.cNGN.address, decimals: 6 },
  wARS: { symbol: "wARS", name: "Argentine Peso", address: CELO_TOKENS.wARS.address, decimals: 18 },
  wBRL: { symbol: "wBRL", name: "Brazilian Real", address: CELO_TOKENS.wBRL.address, decimals: 18 },
  wMXN: { symbol: "wMXN", name: "Mexican Peso", address: CELO_TOKENS.wMXN.address, decimals: 18 },
  IDRX: { symbol: "IDRX", name: "Indonesian Rupiah", address: CELO_TOKENS.IDRX.address, decimals: 2 },
};

export const FUNDING_TOKEN_LIST: readonly FundingTokenSymbol[] = [
  "USDT",
  "USDC",
  "CELO",
  "cNGN",
  "wARS",
  "wBRL",
  "wMXN",
  "IDRX",
];

export const CELO_CONTRACTS = {
  USDT_FEE_ADAPTER: getAddress("0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72"),
  USDC_FEE_ADAPTER: getAddress("0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B"),
  TEXTILE_LIMIT_ORDER_REACTOR: getAddress("0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3"),
  TEXTILE_VAULT_ORDER_EXECUTOR: getAddress("0x01b006d5c687bde182aa36F542f1f014144742e2"),
  PERMIT2: getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3"),
  ERC8004_IDENTITY_REGISTRY: getAddress("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"),
  ERC8004_REPUTATION_REGISTRY: getAddress("0x8004BAa17C55a88189AE136b182e5fdA19dE9b63"),
} as const;

/** Strict allowlist for Textile FX spender approvals and swap target verification. */
export const TEXTILE_ALLOWED_SETTLEMENT_TARGETS: ReadonlySet<string> = new Set([
  CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR.toLowerCase(),
  CELO_CONTRACTS.TEXTILE_VAULT_ORDER_EXECUTOR.toLowerCase(),
]);

export function isAllowedTextileTarget(address: string): boolean {
  return TEXTILE_ALLOWED_SETTLEMENT_TARGETS.has(address.toLowerCase());
}

export function getTokenBySymbol(symbol: TokenSymbol): CeloTokenInfo {
  return CELO_TOKENS[symbol];
}

export function getTokenByAddress(address: string): CeloTokenInfo | undefined {
  const lower = address.toLowerCase();
  return Object.values(CELO_TOKENS).find((t) => t.address.toLowerCase() === lower);
}

export function celoscanTxUrl(txHash: string): string {
  return `${CELOSCAN_BASE_URL}/tx/${txHash}`;
}

export function celoscanAddressUrl(address: string): string {
  return `${CELOSCAN_BASE_URL}/address/${address}`;
}
