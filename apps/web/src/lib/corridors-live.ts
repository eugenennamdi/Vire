import {
  ALL_CORRIDORS,
  CELO_TOKENS,
  computeImpliedRateLocalPerUsdt,
  CORRIDORS,
  formatTokenAmount,
  parseTokenAmount,
  type CorridorLiveStatus,
  type CorridorSymbol,
} from "@vire/shared";
import { getTextileClient } from "./runtime";

const SAMPLE_BUY_HUMAN: Record<CorridorSymbol, string> = {
  cNGN: "3000",
  wARS: "2500",
  wBRL: "12",
  wMXN: "40",
  IDRX: "35000",
  wCOP: "9000",
};

interface CachedCorridors {
  asOf: string;
  corridors: CorridorLiveStatus[];
  expiresAtMs: number;
}

let _cache: CachedCorridors | null = null;

/**
 * Fetch live Textile FX v2 corridor quotes & liquidity ladders across Celo Mainnet (42220).
 * Uses zero-slot free endpoints (GET /v2/rfq/levels + POST /v2/rfq/preview); cached 10s.
 * NEVER fabricates rates when a corridor has no active makers.
 */
export async function getLiveCorridors(forceRefresh = false): Promise<{
  asOf: string;
  corridors: CorridorLiveStatus[];
}> {
  if (!forceRefresh && _cache && Date.now() < _cache.expiresAtMs) {
    return { asOf: _cache.asOf, corridors: _cache.corridors };
  }

  const textile = getTextileClient();
  const nowIso = new Date().toISOString();

  const [levelsData, previews] = await Promise.all([
    textile.getLevels().catch(() => null),
    Promise.all(
      ALL_CORRIDORS.map(async (symbol) => {
        const meta = CORRIDORS[symbol];
        const sampleAtomic = parseTokenAmount(SAMPLE_BUY_HUMAN[symbol], symbol).toString();
        try {
          const preview = await textile.previewExactOutput({
            buyToken: meta.tokenAddress,
            buyAmountAtomic: sampleAtomic,
          });
          return { symbol, sampleAtomic, preview, error: null as string | null };
        } catch (err) {
          return {
            symbol,
            sampleAtomic,
            preview: null,
            error: err instanceof Error ? err.message : "preview_failed",
          };
        }
      })
    ),
  ]);

  const levelMap = new Map<string, { maxSellAmount: string; levelsCount: number }>();
  for (const pair of levelsData?.pairs ?? []) {
    if (pair.sellToken.toLowerCase() === CELO_TOKENS.USDT.address.toLowerCase()) {
      levelMap.set(pair.buyToken.toLowerCase(), {
        maxSellAmount: pair.maxSellAmount,
        levelsCount: pair.levels.length,
      });
    }
  }

  const corridors: CorridorLiveStatus[] = previews.map(({ symbol, sampleAtomic, preview, error }) => {
    const meta = CORRIDORS[symbol];
    const level = levelMap.get(meta.tokenAddress.toLowerCase());
    const maxSellUsdtFormatted =
      level && BigInt(level.maxSellAmount) > 0n
        ? formatTokenAmount(level.maxSellAmount, "USDT", 2)
        : null;

    if (error || !preview) {
      return {
        corridor: symbol,
        fiatCode: meta.fiatCode,
        countryName: meta.countryName,
        tokenAddress: meta.tokenAddress,
        decimals: meta.decimals,
        status: "error",
        sampleBuyAmountAtomic: sampleAtomic,
        sampleBuyAmountFormatted: formatTokenAmount(sampleAtomic, symbol, 2),
        sampleTakerPaysUsdtAtomic: null,
        sampleTakerPaysUsdtFormatted: null,
        impliedRateLocalPerUsdt: null,
        maxSellUsdtFormatted,
        levelsCount: level?.levelsCount ?? 0,
        feedStatus: null,
        updatedAt: nowIso,
      };
    }

    if (preview.status === "preview" && preview.takerPays) {
      const rate = computeImpliedRateLocalPerUsdt(sampleAtomic, preview.takerPays, symbol);
      return {
        corridor: symbol,
        fiatCode: meta.fiatCode,
        countryName: meta.countryName,
        tokenAddress: meta.tokenAddress,
        decimals: meta.decimals,
        status: preview.feed?.status === "degraded" ? "degraded" : "live",
        sampleBuyAmountAtomic: sampleAtomic,
        sampleBuyAmountFormatted: formatTokenAmount(sampleAtomic, symbol, 2),
        sampleTakerPaysUsdtAtomic: preview.takerPays,
        sampleTakerPaysUsdtFormatted: formatTokenAmount(preview.takerPays, "USDT", 4),
        impliedRateLocalPerUsdt: rate > 0 ? rate : null,
        maxSellUsdtFormatted,
        levelsCount: level?.levelsCount ?? 0,
        feedStatus: preview.feed?.status ?? null,
        updatedAt: nowIso,
      };
    }

    const derivedStatus =
      preview.feed?.status === "market_closed"
        ? "market_closed"
        : preview.feed?.status === "degraded" || preview.feed?.status === "stale"
          ? "degraded"
          : "no_makers_online";

    return {
      corridor: symbol,
      fiatCode: meta.fiatCode,
      countryName: meta.countryName,
      tokenAddress: meta.tokenAddress,
      decimals: meta.decimals,
      status: derivedStatus,
      sampleBuyAmountAtomic: sampleAtomic,
      sampleBuyAmountFormatted: formatTokenAmount(sampleAtomic, symbol, 2),
      sampleTakerPaysUsdtAtomic: null,
      sampleTakerPaysUsdtFormatted: null,
      impliedRateLocalPerUsdt: null,
      maxSellUsdtFormatted,
      levelsCount: level?.levelsCount ?? 0,
      feedStatus: preview.feed?.status ?? preview.reason ?? null,
      updatedAt: nowIso,
    };
  });

  const asOf = levelsData?.asOf ?? nowIso;
  _cache = { asOf, corridors, expiresAtMs: Date.now() + 10_000 };
  return { asOf, corridors };
}
