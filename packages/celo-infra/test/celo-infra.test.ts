import { describe, expect, it, vi } from "vitest";
import { CELO_CONTRACTS, CELO_TOKENS, DEFAULT_ATTRIBUTION_CODE } from "@vire/shared";
import {
  appendAttributionSuffixSafe,
  buildAgentCardManifest,
  buildGiveFeedbackCall,
  CeloBuyClient,
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

  it("selects configured USDT (not default USDC) when usebuy.ai offers [USDC, USDT]", async () => {
    const paymentRequiredV2 = {
      x402Version: 2,
      error: "payment_required",
      resource: {
        url: "https://gateway.usebuy.ai/cencori/v1/chat/completions",
        description: "Chat completion, maximo-atlas-1.3",
        mimeType: "application/json",
      },
      accepts: [
        {
          scheme: "exact",
          network: "eip155:42220",
          amount: "10000",
          asset: CELO_TOKENS.USDC.address,
          payTo: "0x20faAca5F980E29639A0FCC6dcA6988E18ed333B",
          maxTimeoutSeconds: 60,
          extra: { name: "USDC", version: "2" },
        },
        {
          scheme: "exact",
          network: "eip155:42220",
          amount: "10000",
          asset: CELO_TOKENS.USDT.address,
          payTo: "0x20faAca5F980E29639A0FCC6dcA6988E18ed333B",
          maxTimeoutSeconds: 60,
          extra: { name: "Tether USD", version: "1" },
        },
      ],
    };

    let selectedAsset: string | null = null;
    let callCount = 0;
    const mockFetch: typeof fetch = vi.fn(async (input) => {
      callCount += 1;
      const req = input instanceof Request ? input : new Request(String(input));
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: "payment_required" }), {
          status: 402,
          headers: {
            "Content-Type": "application/json",
            "payment-required": Buffer.from(JSON.stringify(paymentRequiredV2), "utf8").toString("base64"),
          },
        });
      }
      const sigHeader = req.headers.get("payment-signature") ?? req.headers.get("PAYMENT-SIGNATURE");
      expect(sigHeader).toBeTruthy();
      const decoded = JSON.parse(Buffer.from(sigHeader!, "base64").toString("utf8")) as {
        accepted?: { asset?: string };
      };
      selectedAsset = decoded.accepted?.asset ?? null;
      return new Response(
        JSON.stringify({
          model: "maximo-atlas-1.3",
          choices: [{ message: { content: '{"verdict":"pass","score":92,"confidence":0.95,"reason":"ok","evidenceSummary":"ok"}' } }],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "payment-response": Buffer.from(
              JSON.stringify({ transaction: "0x9999", network: "eip155:42220" }),
              "utf8"
            ).toString("base64"),
          },
        }
      );
    });

    const buyClient = new CeloBuyClient({
      agentPrivateKey: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      paymentToken: "USDT",
      maxAmountUsd: "0.05",
      fetchImpl: mockFetch,
    });

    const res = await buyClient.callCencoriInference({
      messages: [{ role: "user", content: "verify test" }],
      maxTokens: 256,
    });

    expect(callCount).toBe(2);
    expect(selectedAsset?.toLowerCase()).toBe(CELO_TOKENS.USDT.address.toLowerCase());
    expect(res.receipt.paymentTxHash).toBe("0x9999");
  });
});
