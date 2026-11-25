import { describe, expect, it } from "vitest";
import {
  buildOfframpPackage,
  CELO_CONTRACTS,
  CELO_TOKENS,
  computeImpliedRateLocalPerUsdt,
  CreateSubmissionRequestSchema,
  DEFAULT_ATTRIBUTION_CODE,
  formatTokenAmount,
  FUNDING_TOKEN_LIST,
  FUNDING_TOKENS,
  isAllowedTextileTarget,
  parseTokenAmount,
  PublishCampaignRequestSchema,
  validateAttributionCode,
} from "../src/index.js";

describe("Canonical Celo Mainnet token registry & decimals", () => {
  it("enforces verified decimals for every stablecoin (especially IDRX=2)", () => {
    expect(CELO_TOKENS.USDT.decimals).toBe(6);
    expect(CELO_TOKENS.USDC.decimals).toBe(6);
    expect(CELO_TOKENS.cNGN.decimals).toBe(6);
    expect(CELO_TOKENS.IDRX.decimals).toBe(2);
    expect(CELO_TOKENS.wARS.decimals).toBe(18);
    expect(CELO_TOKENS.wBRL.decimals).toBe(18);
    expect(CELO_TOKENS.wMXN.decimals).toBe(18);
    expect(CELO_TOKENS.wCOP.decimals).toBe(18);
  });

  it("never confuses USD₮ token address with USD₮ FeeCurrency adapter", () => {
    expect(CELO_TOKENS.USDT.address).not.toBe(CELO_CONTRACTS.USDT_FEE_ADAPTER);
    expect(CELO_TOKENS.USDT.feeCurrencyAdapter).toBe(CELO_CONTRACTS.USDT_FEE_ADAPTER);
  });

  it("scales and formats 2-decimal IDRX, 6-decimal cNGN, and 18-decimal wARS accurately", () => {
    // 50,000 IDRX = 5,000,000 atomic units (2 decimals ONLY)
    expect(parseTokenAmount("50000", "IDRX")).toBe(5_000_000n);
    expect(formatTokenAmount("5000000", "IDRX")).toBe("50,000");
    expect(formatTokenAmount("5000075", "IDRX")).toBe("50,000.75");

    // 15,000 cNGN = 15_000_000_000 atomic units (6 decimals)
    expect(parseTokenAmount("15000", "cNGN")).toBe(15_000_000_000n);
    expect(formatTokenAmount("15000000000", "cNGN")).toBe("15,000");

    // 10,000 wARS = 10_000 * 1e18 (18 decimals)
    expect(parseTokenAmount("10000", "wARS")).toBe(10_000n * 10n ** 18n);
    expect(formatTokenAmount(10_000n * 10n ** 18n, "wARS")).toBe("10,000");

    // Implied rate for 50,000 IDRX costing 3.125 USD₮
    const rate = computeImpliedRateLocalPerUsdt(5_000_000n, 3_125_000n, "IDRX");
    expect(rate).toBeCloseTo(16000, 4);
  });

  it("builds valid prefilled Ripio zero-fee URLs and cNGN/IDRX off-ramp packages", () => {
    const recipient = "0x1111111111111111111111111111111111111111" as const;
    const arsPkg = buildOfframpPackage({
      corridor: "wARS",
      atomicAmount: parseTokenAmount("10000", "wARS"),
      recipientAddress: recipient,
    });
    expect(arsPkg.primaryUrl).toBe(
      "https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=10000&address=0x1111111111111111111111111111111111111111"
    );

    const ngnPkg = buildOfframpPackage({
      corridor: "cNGN",
      atomicAmount: parseTokenAmount("15000", "cNGN"),
      recipientAddress: recipient,
    });
    expect(ngnPkg.venues.map((v) => v.name)).toContain("Busha");
    expect(ngnPkg.tokenAddress).toBe(CELO_TOKENS.cNGN.address);

    const idrxPkg = buildOfframpPackage({
      corridor: "IDRX",
      atomicAmount: parseTokenAmount("50000", "IDRX"),
      recipientAddress: recipient,
    });
    expect(idrxPkg.tokenDecimals).toBe(2);
    expect(idrxPkg.humanAmount).toBe("50000");
  });

  it("validates ERC-8021 attribution codes and Textile target allowlist", () => {
    expect(validateAttributionCode(DEFAULT_ATTRIBUTION_CODE)).toBe("celo_55a64f75ba4a");
    expect(() => validateAttributionCode("textile_bad")).toThrow();
    expect(() => validateAttributionCode("tp_reserved")).toThrow();
    expect(() => validateAttributionCode("BAD-UPPER")).toThrow();

    expect(isAllowedTextileTarget(CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR)).toBe(true);
    expect(isAllowedTextileTarget(CELO_CONTRACTS.TEXTILE_VAULT_ORDER_EXECUTOR)).toBe(true);
    expect(isAllowedTextileTarget("0x000000000000000000000000000000000000dead")).toBe(false);
  });

  it("exposes all 8 verified Textile FX funding tokens with exact decimals", () => {
    expect(FUNDING_TOKEN_LIST).toEqual(["USDT", "USDC", "CELO", "cNGN", "wARS", "wBRL", "wMXN", "IDRX"]);
    expect(FUNDING_TOKENS.CELO.decimals).toBe(18);
    expect(FUNDING_TOKENS.IDRX.decimals).toBe(2);
    expect(FUNDING_TOKENS.USDT.decimals).toBe(6);
    expect(FUNDING_TOKENS.USDC.decimals).toBe(6);
    expect(FUNDING_TOKENS.cNGN.decimals).toBe(6);
  });

  it("validates cashback voucher campaign and single-use voucher submission payloads", () => {
    const camp = PublishCampaignRequestSchema.parse({
      campaignId: "0x" + "a".repeat(64),
      slug: "swot-ember-cashback-2026",
      partnerName: "SWOT Gadgets",
      partnerLocation: "Abeokuta, Nigeria",
      title: "SWOT Gadgets Ember Sales Cashback",
      description: "Order any gadget 150,000 NGN+ and claim 10,000 cNGN instant cashback on Vire.",
      criteria: "Single-use cashback voucher issued after confirmed 150,000 NGN+ SWOT Gadgets order.",
      deliverableType: "cashback_voucher",
      corridor: "cNGN",
      rewardLocalHuman: "10000",
      visibility: "public",
      verificationMode: "voucher",
      autoRules: null,
      maxPayoutsPerRecipient: 1,
    });
    expect(camp.verificationMode).toBe("voucher");
    expect(camp.deliverableType).toBe("cashback_voucher");

    const sub = CreateSubmissionRequestSchema.parse({
      campaignSlug: "swot-ember-cashback-2026",
      contributorWallet: "0x1111111111111111111111111111111111111111",
      voucherCode: "SWOT-7K9P-2M4X",
    });
    expect(sub.voucherCode).toBe("SWOT-7K9P-2M4X");
    expect(sub.deliverableUrl).toBeUndefined();
  });
});
