import { formatUnits, parseUnits, type Address } from "viem";
import { CELO_MAINNET_CHAIN_ID, CELO_TOKENS, type CorridorSymbol, type TokenSymbol } from "./tokens.js";

export type OfframpProvider = "ripio" | "cngn_venues" | "idrx_guide";

export interface CorridorMeta {
  symbol: CorridorSymbol;
  fiatCode: string;
  countryName: string;
  countryCode: "NG" | "ID" | "AR" | "BR" | "MX" | "CO";
  region: "Africa" | "Southeast Asia" | "LatAm";
  tokenAddress: Address;
  decimals: number;
  offrampProvider: OfframpProvider;
  ripioTokenParam?: "WARS" | "WBRL" | "WMXN" | "WCOP";
  /** Approximate reference USD rate used only as fallback sanity check when live external rate feed is absent. */
  typicalFiatPerUsd: number;
  primaryUseCase: string;
}

export const CORRIDORS: Record<CorridorSymbol, CorridorMeta> = {
  cNGN: {
    symbol: "cNGN",
    fiatCode: "NGN",
    countryName: "Nigeria",
    countryCode: "NG",
    region: "Africa",
    tokenAddress: CELO_TOKENS.cNGN.address,
    decimals: CELO_TOKENS.cNGN.decimals,
    offrampProvider: "cngn_venues",
    typicalFiatPerUsd: 1450,
    primaryUseCase: "Retail gadget store Black Friday micro-affiliate & promo payouts",
  },
  IDRX: {
    symbol: "IDRX",
    fiatCode: "IDR",
    countryName: "Indonesia",
    countryCode: "ID",
    region: "Southeast Asia",
    tokenAddress: CELO_TOKENS.IDRX.address,
    decimals: CELO_TOKENS.IDRX.decimals, // 2 DECIMALS ONLY
    offrampProvider: "idrx_guide",
    typicalFiatPerUsd: 16200,
    primaryUseCase: "Bahasa localization & QA regression bounty settlement",
  },
  wARS: {
    symbol: "wARS",
    fiatCode: "ARS",
    countryName: "Argentina",
    countryCode: "AR",
    region: "LatAm",
    tokenAddress: CELO_TOKENS.wARS.address,
    decimals: CELO_TOKENS.wARS.decimals,
    offrampProvider: "ripio",
    ripioTokenParam: "WARS",
    typicalFiatPerUsd: 1200,
    primaryUseCase: "LatAm QA bug reports & technical Spanish localization",
  },
  wBRL: {
    symbol: "wBRL",
    fiatCode: "BRL",
    countryName: "Brazil",
    countryCode: "BR",
    region: "LatAm",
    tokenAddress: CELO_TOKENS.wBRL.address,
    decimals: CELO_TOKENS.wBRL.decimals,
    offrampProvider: "ripio",
    ripioTokenParam: "WBRL",
    typicalFiatPerUsd: 5.8,
    primaryUseCase: "PT-BR localization & developer verification bounties",
  },
  wMXN: {
    symbol: "wMXN",
    fiatCode: "MXN",
    countryName: "Mexico",
    countryCode: "MX",
    region: "LatAm",
    tokenAddress: CELO_TOKENS.wMXN.address,
    decimals: CELO_TOKENS.wMXN.decimals,
    offrampProvider: "ripio",
    ripioTokenParam: "WMXN",
    typicalFiatPerUsd: 20.0,
    primaryUseCase: "LatAm merchant referrals & QA sprints",
  },
  wCOP: {
    symbol: "wCOP",
    fiatCode: "COP",
    countryName: "Colombia",
    countryCode: "CO",
    region: "LatAm",
    tokenAddress: CELO_TOKENS.wCOP.address,
    decimals: CELO_TOKENS.wCOP.decimals,
    offrampProvider: "ripio",
    ripioTokenParam: "WCOP",
    typicalFiatPerUsd: 4300,
    primaryUseCase: "Colombia corridor FX clearing (interbank market hours)",
  },
} as const;

export const PRIMARY_CORRIDORS: readonly CorridorSymbol[] = ["cNGN", "wARS", "wBRL", "wMXN", "IDRX"];
export const ALL_CORRIDORS: readonly CorridorSymbol[] = ["cNGN", "wARS", "wBRL", "wMXN", "IDRX", "wCOP"];

/** Format an atomic integer string using the token's verified decimals (never assumes 18). */
export function formatTokenAmount(
  atomic: string | bigint,
  symbol: TokenSymbol,
  maxFractionDigits = 2
): string {
  const token = CELO_TOKENS[symbol];
  const raw = formatUnits(typeof atomic === "bigint" ? atomic : BigInt(atomic), token.decimals);
  const [intPart = "0", fracPart = ""] = raw.split(".");
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmedFrac = fracPart.slice(0, Math.min(maxFractionDigits, token.decimals)).replace(/0+$/, "");
  return trimmedFrac.length > 0 ? `${groupedInt}.${trimmedFrac}` : groupedInt;
}

/** Exact unformatted decimal string (no commas) for URLs & machine inputs. */
export function toPlainDecimalAmount(atomic: string | bigint, symbol: TokenSymbol): string {
  const token = CELO_TOKENS[symbol];
  return formatUnits(typeof atomic === "bigint" ? atomic : BigInt(atomic), token.decimals);
}

/** Parse a human-readable amount string strictly to verified atomic units. */
export function parseTokenAmount(humanAmount: string, symbol: TokenSymbol): bigint {
  const token = CELO_TOKENS[symbol];
  return parseUnits(humanAmount.trim(), token.decimals);
}

/**
 * Compute human implied local-per-USDT rate from atomic amounts using each token's verified decimals.
 * Example: 15000 cNGN (15000000000, 6dp) / 10 USDT (10000000, 6dp) = 1500.
 */
export function computeImpliedRateLocalPerUsdt(
  buyAmountAtomic: string | bigint,
  takerPaysUsdtAtomic: string | bigint,
  corridor: CorridorSymbol
): number {
  const buyFloat = Number(toPlainDecimalAmount(buyAmountAtomic, corridor));
  const usdtFloat = Number(toPlainDecimalAmount(takerPaysUsdtAtomic, "USDT"));
  if (!Number.isFinite(buyFloat) || !Number.isFinite(usdtFloat) || usdtFloat <= 0) {
    return 0;
  }
  return buyFloat / usdtFloat;
}

export interface OfframpVenueLink {
  name: string;
  url: string;
  note: string;
}

export interface OfframpPackage {
  provider: OfframpProvider;
  headline: string;
  primaryUrl: string;
  tokenAddress: Address;
  tokenDecimals: number;
  humanAmount: string;
  instructions: string[];
  venues: OfframpVenueLink[];
}

/**
 * Generate last-mile local cash-out links & instructions for a settled contributor payout.
 */
export function buildOfframpPackage(params: {
  corridor: CorridorSymbol;
  atomicAmount: string | bigint;
  recipientAddress: Address;
}): OfframpPackage {
  const meta = CORRIDORS[params.corridor];
  const humanAmount = toPlainDecimalAmount(params.atomicAmount, params.corridor);

  if (meta.offrampProvider === "ripio" && meta.ripioTokenParam) {
    const url = new URL("https://ramp.ripio.com/");
    url.searchParams.set("country", meta.countryCode);
    url.searchParams.set("chain", String(CELO_MAINNET_CHAIN_ID));
    url.searchParams.set("token", meta.ripioTokenParam);
    url.searchParams.set("amount", humanAmount);
    url.searchParams.set("address", params.recipientAddress);

    return {
      provider: "ripio",
      headline: `Zero-Fee Ripio ${meta.symbol} → ${meta.fiatCode} Off-Ramp`,
      primaryUrl: url.toString(),
      tokenAddress: meta.tokenAddress,
      tokenDecimals: meta.decimals,
      humanAmount,
      instructions: [
        `Open the prefilled Ripio Ramp link below — ${humanAmount} ${meta.symbol} on Celo (Chain 42220) and your wallet address are already loaded.`,
        `Confirm local ${meta.fiatCode} bank / PIX / CBU / CLABE payout details inside Ripio with zero off-ramp fee.`,
      ],
      venues: [
        {
          name: `Ripio Ramp (${meta.countryName})`,
          url: url.toString(),
          note: `Prefilled Celo 42220 → ${meta.fiatCode} zero-fee cash-out`,
        },
      ],
    };
  }

  if (meta.offrampProvider === "cngn_venues") {
    return {
      provider: "cngn_venues",
      headline: `Cash Out ${formatTokenAmount(params.atomicAmount, "cNGN")} cNGN → Nigerian Naira (NGN)`,
      primaryUrl: "https://www.opera.com/products/minipay",
      tokenAddress: meta.tokenAddress,
      tokenDecimals: meta.decimals,
      humanAmount,
      instructions: [
        `Your exact payout of ${formatTokenAmount(params.atomicAmount, "cNGN")} cNGN (6 decimals) is live in ${params.recipientAddress} on Celo Mainnet.`,
        "For MiniPay bank transfers (OPay, Moniepoint, GTBank — min 0.35 USDT), convert cNGN to USDT inside Vire first, then send USDT on Celo to your MiniPay address.",
        "For exchanges (Quidax, Bybit, Yellow Card, Busha), send Celo USDT — only send raw cNGN if your exchange explicitly lists Celo as a supported cNGN deposit network.",
      ],
      venues: [
        {
          name: "MiniPay (via Celo USDT)",
          url: "https://www.opera.com/products/minipay",
          note: "Convert cNGN → USDT in Vire first, then Pay to Bank Transfer (OPay / Moniepoint, min 0.35 USDT)",
        },
        {
          name: "Quidax",
          url: "https://www.quidax.com/",
          note: "Supports Celo USDT deposits & NGN bank payout (verify network before sending raw cNGN)",
        },
        {
          name: "Busha",
          url: "https://www.busha.io/",
          note: "SEC-licensed Nigerian exchange — verify supported deposit network in-app before sending",
        },
        {
          name: "Yellow Card",
          url: "https://yellowcard.io/",
          note: "Celo USDT → instant Nigerian Naira bank transfer",
        },
      ],
    };
  }

  return {
    provider: "idrx_guide",
    headline: `Cash Out ${formatTokenAmount(params.atomicAmount, "IDRX")} IDRX → Indonesian Rupiah (IDR)`,
    primaryUrl: "https://idrx.co/",
    tokenAddress: meta.tokenAddress,
    tokenDecimals: meta.decimals,
    humanAmount,
    instructions: [
      `Your exact payout of ${formatTokenAmount(params.atomicAmount, "IDRX")} IDRX is live in ${params.recipientAddress} on Celo Mainnet.`,
      `Verify contract address ${meta.tokenAddress} — note IDRX uses exactly 2 decimals onchain (100 atomic units = 1.00 IDRX).`,
      "Redeem IDRX 1:1 to Indonesian Rupiah bank accounts via IDRX official redeem portal or Celo-supported IDR venues.",
    ],
    venues: [
      { name: "IDRX Official Portal", url: "https://idrx.co/", note: "1:1 IDR bank redemption for Celo IDRX" },
      { name: "IDRX Contract Docs", url: "https://docs.idrx.co/introduction/supported-chain-and-contract-address", note: "Verified Celo Mainnet address & 2-decimal spec" },
    ],
  };
}
