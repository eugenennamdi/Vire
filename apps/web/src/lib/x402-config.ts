import {
  CELO_MAINNET_CHAIN_ID,
  CELO_TOKENS,
  parseTokenAmount,
} from "@vire/shared";
import type { RouteConfig } from "@x402/core/server";
import type { Address } from "viem";

export const CELO_MAINNET_CAIP2 = `eip155:${CELO_MAINNET_CHAIN_ID}` as const;

/**
 * Pure Celo Mainnet x402 v2 route configuration builder.
 * CRITICAL per x402.celo.org/skill.md:
 * - Never use bare "$0.05" string prices (silently resolves to USDC).
 * - Always pass explicit { amount, asset, extra: { name, version, assetTransferMethod? } }.
 * - Include extensions.eip2612GasSponsoring for wFIAT Permit2 routes (wARS/wBRL/wMXN).
 * - Omit eip2612GasSponsoring for cNGN Permit2 route (cNGN lacks EIP-2612 permit()).
 */
export function buildCeloX402RouteConfig(params: {
  payTo: Address;
  usdtAtomicAmount: string;
  description: string;
  cngnOnly?: boolean;
}): RouteConfig {
  const usdNumeric = Number(params.usdtAtomicAmount) / 1e6;

  if (params.cngnOnly) {
    const cngnHuman = Math.max(1, Math.round(usdNumeric * 1450)).toString();
    return {
      accepts: [
        {
          scheme: "exact",
          network: CELO_MAINNET_CAIP2,
          payTo: params.payTo,
          price: {
            amount: parseTokenAmount(cngnHuman, "cNGN").toString(),
            asset: CELO_TOKENS.cNGN.address,
            extra: {
              name: CELO_TOKENS.cNGN.x402!.name,
              version: CELO_TOKENS.cNGN.x402!.version,
              assetTransferMethod: "permit2",
            },
          },
        },
      ],
      description: `${params.description} (cNGN Permit2 — approve Permit2 once onchain)`,
    };
  }

  const warsAmount = parseTokenAmount(Math.max(1, Math.round(usdNumeric * 1200)).toString(), "wARS").toString();
  const wbrlAmount = parseTokenAmount((usdNumeric * 5.8).toFixed(2), "wBRL").toString();
  const wmxnAmount = parseTokenAmount((usdNumeric * 20).toFixed(2), "wMXN").toString();

  return {
    accepts: [
      {
        scheme: "exact",
        network: CELO_MAINNET_CAIP2,
        payTo: params.payTo,
        price: {
          amount: params.usdtAtomicAmount,
          asset: CELO_TOKENS.USDT.address,
          extra: {
            name: CELO_TOKENS.USDT.x402!.name,
            version: CELO_TOKENS.USDT.x402!.version,
          },
        },
      },
      {
        scheme: "exact",
        network: CELO_MAINNET_CAIP2,
        payTo: params.payTo,
        price: {
          amount: params.usdtAtomicAmount,
          asset: CELO_TOKENS.USDC.address,
          extra: {
            name: CELO_TOKENS.USDC.x402!.name,
            version: CELO_TOKENS.USDC.x402!.version,
          },
        },
      },
      {
        scheme: "exact",
        network: CELO_MAINNET_CAIP2,
        payTo: params.payTo,
        price: {
          amount: warsAmount,
          asset: CELO_TOKENS.wARS.address,
          extra: {
            name: CELO_TOKENS.wARS.x402!.name,
            version: CELO_TOKENS.wARS.x402!.version,
            assetTransferMethod: "permit2",
          },
        },
      },
      {
        scheme: "exact",
        network: CELO_MAINNET_CAIP2,
        payTo: params.payTo,
        price: {
          amount: wbrlAmount,
          asset: CELO_TOKENS.wBRL.address,
          extra: {
            name: CELO_TOKENS.wBRL.x402!.name,
            version: CELO_TOKENS.wBRL.x402!.version,
            assetTransferMethod: "permit2",
          },
        },
      },
      {
        scheme: "exact",
        network: CELO_MAINNET_CAIP2,
        payTo: params.payTo,
        price: {
          amount: wmxnAmount,
          asset: CELO_TOKENS.wMXN.address,
          extra: {
            name: CELO_TOKENS.wMXN.x402!.name,
            version: CELO_TOKENS.wMXN.x402!.version,
            assetTransferMethod: "permit2",
          },
        },
      },
    ],
    description: params.description,
    extensions: {
      eip2612GasSponsoring: {
        info: {
          description: "The Celo x402 facilitator sponsors the EIP-2612 permit to Permit2 for Ripio wFIAT assets.",
          version: "1",
        },
      },
    },
  };
}
