import { describe, expect, it } from "vitest";
import { CELO_CONTRACTS, CELO_TOKENS, DEFAULT_ATTRIBUTION_CODE } from "@vire/shared";
import {
  appendAttributionSuffixSafe,
  buildAgentCardManifest,
  buildGiveFeedbackCall,
  decodeAttributionSuffix,
  parseX402PaymentResponseHeader,
  resolveSafeFeeCurrency,
} from "../src/index.js";

describe("packages/celo-infra security & protocol guards", () => {
  it("appends ERC-8021 suffix cleanly and blocks double-tagging", () => {
    const baseCalldata = "0xa9059cbb0000000000000000000000001111111111111111111111111111111111111111" as const;
    const tagged = appendAttributionSuffixSafe(baseCalldata, DEFAULT_ATTRIBUTION_CODE);
    const decoded = decodeAttributionSuffix(tagged);

    expect(decoded).not.toBeNull();
    expect(decoded?.codes).toEqual([DEFAULT_ATTRIBUTION_CODE]);
    expect(decoded?.schemaId).toBe(0);

    // Must throw if called a second time on already-tagged calldata
    expect(() => appendAttributionSuffixSafe(tagged, DEFAULT_ATTRIBUTION_CODE)).toThrow(/double-tag/i);
  });

  it("enforces CIP-64 USD₮ FeeCurrency Adapter and rejects raw 6-decimal token addresses", () => {
    expect(resolveSafeFeeCurrency({ useUsdtFeeAbstraction: true })).toBe(CELO_CONTRACTS.USDT_FEE_ADAPTER);
    expect(resolveSafeFeeCurrency({ useUsdtFeeAbstraction: false })).toBeUndefined();
    expect(() =>
      resolveSafeFeeCurrency({ feeCurrencyAdapter: CELO_TOKENS.USDT.address })
    ).toThrow(/FeeCurrency Adapter/i);
    expect(() =>
      resolveSafeFeeCurrency({ feeCurrencyAdapter: CELO_TOKENS.USDC.address })
    ).toThrow(/FeeCurrency Adapter/i);
  });

  it("builds valid ERC-8004 registration manifest and giveFeedback calldata", () => {
    const card = buildAgentCardManifest({
      appUrl: "https://vire.example.com/",
      vaultAddress: "0x2222222222222222222222222222222222222222",
      agentId: 42n,
    });
    expect(card.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(card.x402Support).toBe(true);
    expect(card.registrations?.[0]?.agentId).toBe(42);
    expect(card.registrations?.[0]?.agentRegistry).toBe(
      `eip155:42220:${CELO_CONTRACTS.ERC8004_IDENTITY_REGISTRY}`
    );

    const fb = buildGiveFeedbackCall({
      agentId: 42n,
      score: 95,
      endpoint: "https://vire.example.com",
      corridorTag: "cNGN",
    });
    expect(fb.to).toBe(CELO_CONTRACTS.ERC8004_REPUTATION_REGISTRY);
    expect(fb.args[3]).toBe("settlement");
    expect(fb.data.startsWith("0x")).toBe(true);
  });

  it("parses x402 base64 payment-response header cleanly", () => {
    const encoded = Buffer.from(
      JSON.stringify({ transaction: "0xabc123", network: "eip155:42220", payer: "0x1111" }),
      "utf8"
    ).toString("base64");
    const parsed = parseX402PaymentResponseHeader(encoded);
    expect(parsed.txHash).toBe("0xabc123");
    expect(parsed.network).toBe("eip155:42220");
  });
});
