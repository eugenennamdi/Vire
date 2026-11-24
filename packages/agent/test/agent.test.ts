import { describe, expect, it, vi } from "vitest";
import { CeloBuyClient } from "@vire/celo-infra";
import { CELO_CONTRACTS, CELO_TOKENS, parseTokenAmount } from "@vire/shared";
import { TextileClient } from "@vire/textile";
import {
  assertSafePublicUrl,
  computeDeliverableHash,
  evaluatePolicyGate,
  fetchDeliverableArtifact,
  isPrivateOrReservedIp,
  normalizeDeliverableUrl,
  parseVerificationVerdict,
  SettlementOrchestrator,
  verifyDeliverableWithBuy,
  type OrchestratorCampaignRecord,
  type OrchestratorPersistenceAdapter,
  type PolicyGateInput,
} from "../src/index.js";

function basePolicyInput(): PolicyGateInput {
  return {
    deliverableHashAlreadyUsed: false,
    contributorWallet: "0x3333333333333333333333333333333333333333",
    identityVerified: true,
    identityHandle: "ada_dev",
    teamBlocklist: new Set(["0x9999999999999999999999999999999999999999"]),
    vaultOwnerAddress: "0x1111111111111111111111111111111111111111",
    settlementAgentAddress: "0x2222222222222222222222222222222222222222",
    campaignActive: true,
    campaignRemainingBudgetUsdtAtomic: 500_000_000n,
    campaignMaxPerPayoutUsdtAtomic: 25_000_000n,
    campaignRemainingDailyLimitUsdtAtomic: 100_000_000n,
    contributorPayoutCountInCampaign: 0,
    maxPayoutsPerRecipient: 3,
    requestedStageIndex: 1,
    lastPayoutAtMs: null,
    stageCooldownHours: 12,
    corridor: "cNGN",
    requestedBuyAmountAtomic: parseTokenAmount("15000", "cNGN"), // 15,000 cNGN (~$10.34)
    textilePreview: {
      status: "preview",
      buyAmount: parseTokenAmount("15000", "cNGN").toString(),
      takerPays: "10400000", // $10.40 -> ~1442.3 cNGN/USDT
      feeAmount: "2080",
    },
    referenceRateLocalPerUsdt: 1450,
    maxSpreadBps: 200, // 2%
    verificationVerdict: {
      verdict: "pass",
      score: 91,
      confidence: 0.94,
      reason: "Verified authentic promo post with store tag and referral link.",
      evidenceSummary: "Public post matched campaign criteria.",
    },
    minPassScore: 75,
  };
}

describe("Deterministic 7-Rule Policy Gate", () => {
  it("passes when all 7 rules hold", () => {
    const res = evaluatePolicyGate(basePolicyInput());
    expect(res.passed).toBe(true);
    expect(res.failedRule).toBeNull();
    expect(res.checks).toHaveLength(7);
    expect(res.checks.every((c) => c.passed)).toBe(true);
    // 10_400_000 * 1.015 = 10_556_000
    expect(res.estimatedUsdtAtomic).toBe("10556000");
  });

  it("rejects each of the 7 rules independently with exact failure code", () => {
    // 1. Duplicate deliverable hash
    expect(
      evaluatePolicyGate({ ...basePolicyInput(), deliverableHashAlreadyUsed: true }).failedRule
    ).toBe("UNIQUE_DELIVERABLE_HASH");

    // 2. Team wallet blocked (external recipients only)
    expect(
      evaluatePolicyGate({
        ...basePolicyInput(),
        contributorWallet: "0x9999999999999999999999999999999999999999",
      }).failedRule
    ).toBe("VERIFIED_EXTERNAL_IDENTITY");

    // 3. Insufficient budget
    expect(
      evaluatePolicyGate({
        ...basePolicyInput(),
        campaignRemainingBudgetUsdtAtomic: 5_000_000n,
      }).failedRule
    ).toBe("CAMPAIGN_ACTIVE_AND_FUNDED");

    // 4. Cooldown / stage cap violated
    expect(
      evaluatePolicyGate({
        ...basePolicyInput(),
        contributorPayoutCountInCampaign: 1,
        requestedStageIndex: 2,
        lastPayoutAtMs: Date.now() - 60_000, // only 1m elapsed, needs 12h
      }).failedRule
    ).toBe("STAGE_CAP_AND_COOLDOWN");

    // 5. Below $1.00 Textile floor
    expect(
      evaluatePolicyGate({
        ...basePolicyInput(),
        requestedBuyAmountAtomic: parseTokenAmount("1000", "cNGN"),
        textilePreview: {
          status: "preview",
          buyAmount: parseTokenAmount("1000", "cNGN").toString(),
          takerPays: "690000", // $0.69 < $1.00
        },
      }).failedRule
    ).toBe("TEXTILE_MIN_NOTIONAL_FLOOR");

    // 6. Spread exceeds campaign maxSpreadBps guardrail
    expect(
      evaluatePolicyGate({
        ...basePolicyInput(),
        textilePreview: {
          status: "preview",
          buyAmount: parseTokenAmount("15000", "cNGN").toString(),
          takerPays: "12000000", // 1250 cNGN/USDT vs 1450 ref = ~1379 bps > 200 bps
        },
      }).failedRule
    ).toBe("CORRIDOR_LIQUIDITY_AND_SPREAD");

    // 7. AI verification score below threshold
    expect(
      evaluatePolicyGate({
        ...basePolicyInput(),
        verificationVerdict: {
          verdict: "reject",
          score: 35,
          confidence: 0.9,
          reason: "Deliverable unrelated to campaign.",
          evidenceSummary: "No store mention found.",
        },
      }).failedRule
    ).toBe("VERIFICATION_SCORE_THRESHOLD");
  });
});

describe("SSRF & prompt-injection fail-closed guards", () => {
  it("blocks localhost, private RFC1918, cloud metadata IPs, and non-HTTP schemes", async () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("10.0.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);

    await expect(assertSafePublicUrl("http://127.0.0.1:3000/secret")).rejects.toThrow();
    await expect(assertSafePublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(assertSafePublicUrl("file:///etc/passwd")).rejects.toThrow();
  });

  it("fails closed to reject when verification model emits malformed output", () => {
    const v = parseVerificationVerdict("I cannot comply with JSON");
    expect(v.verdict).toBe("reject");
    expect(v.score).toBe(0);
  });

  it("canonicalizes twitter.com, x.com, mobile.x.com, and /i/status/ URLs identically and blocks all spam/Sybil/hijack vectors", async () => {
    expect(normalizeDeliverableUrl("https://twitter.com/PromoUser/status/123456789?s=20&t=abc")).toBe(
      "https://x.com/i/status/123456789"
    );
    expect(normalizeDeliverableUrl("https://x.com/promouser/status/123456789/")).toBe(
      "https://x.com/i/status/123456789"
    );
    expect(normalizeDeliverableUrl("https://mobile.x.com/any_spoofed_handle/status/123456789")).toBe(
      "https://x.com/i/status/123456789"
    );

    const makeTweetFetch = (overrides: Record<string, unknown> = {}): typeof fetch =>
      vi.fn(async (url) => {
        if (String(url).startsWith("https://api.fxtwitter.com/")) {
          const baseTweet = {
            text: "Huge Black Friday iPhone 15 and MacBook deals live right now at @swotgadgets check https://swotgadgets.com/product/iphone-15 #SWOTBlackFriday",
            created_timestamp: Math.floor(Date.now() / 1000),
            replying_to: null,
            reposted_by: null,
            author: {
              id: "1765636339448328192",
              screen_name: "promouser",
              followers: 42,
              joined: "Thu Mar 07 07:11:46 +0000 2024",
            },
            likes: 14,
            views: 620,
            raw_text: {
              facets: [{ type: "url", replacement: "https://swotgadgets.com/product/iphone-15" }],
            },
            ...overrides,
          };
          return new Response(JSON.stringify({ code: 200, tweet: baseTweet }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });

    const mockFetch = makeTweetFetch();
    const artifact = await fetchDeliverableArtifact({
      deliverableUrl: "https://x.com/promouser/status/123456789",
      fetchImpl: mockFetch,
    });
    expect(artifact.sourceKind).toBe("x_post");
    expect(artifact.reachable).toBe(true);
    expect(artifact.authorHandle).toBe("promouser");
    expect(artifact.authorId).toBe("x:1765636339448328192");
    expect(artifact.authorFollowers).toBe(42);
    expect(artifact.excerpt).toContain("swotgadgets.com/product/iphone-15");
    expect(artifact.excerpt).toContain("#SWOTBlackFriday");

    // 1. Same tweet via /i/status/ or different handle path MUST produce identical replay hash
    const campaignId = "0x1111111111111111111111111111111111111111111111111111111111111111";
    expect(
      computeDeliverableHash({
        campaignIdBytes32: campaignId,
        deliverableUrl: "https://x.com/promouser/status/123456789",
        contributorHandle: "promouser",
      })
    ).toBe(
      computeDeliverableHash({
        campaignIdBytes32: campaignId,
        deliverableUrl: "https://x.com/i/status/123456789?s=20",
        contributorHandle: "other_person",
      })
    );

    const buyClient = new CeloBuyClient({ dryRun: true });
    const tweetSpy = vi.spyOn(buyClient, "fetchTweetDetail");
    const criteria = "Post promoting swotgadgets.com tagging @swotgadgets with #SWOTBlackFriday";

    // 2. Author handle spoofing MUST reject BEFORE spending on `buy`
    const spoofed = await verifyDeliverableWithBuy(buyClient, {
      campaignIdBytes32: campaignId,
      deliverableUrl: "https://x.com/promouser/status/123456789",
      deliverableType: "promo_post",
      campaignTitle: "SWOT Gadgets Black Friday Promo Sprint",
      criteria,
      contributorHandle: "other_person",
      identityOAuthVerified: true,
      fetchImpl: mockFetch,
    });
    expect(spoofed.verdict.verdict).toBe("reject");
    expect(spoofed.verdict.reason).toContain("Author mismatch");
    expect(tweetSpy).not.toHaveBeenCalled();

    // 3. Immutable authorId handle-rename Sybil attack MUST reject BEFORE spending on `buy`
    const renamed = await verifyDeliverableWithBuy(buyClient, {
      campaignIdBytes32: campaignId,
      deliverableUrl: "https://x.com/promouser/status/123456789",
      deliverableType: "promo_post",
      campaignTitle: "SWOT Gadgets Black Friday Promo Sprint",
      criteria,
      contributorHandle: "promouser",
      identityOAuthVerified: true,
      isAuthorAlreadyClaimed: async (id) => id === "x:1765636339448328192",
      fetchImpl: mockFetch,
    });
    expect(renamed.verdict.verdict).toBe("reject");
    expect(renamed.verdict.reason).toContain("already claimed");
    expect(tweetSpy).not.toHaveBeenCalled();

    // 4. Low-follower bot account (< 10 followers) MUST reject BEFORE spending on `buy`
    const botFollowers = await verifyDeliverableWithBuy(buyClient, {
      campaignIdBytes32: campaignId,
      deliverableUrl: "https://x.com/promouser/status/123456789",
      deliverableType: "promo_post",
      campaignTitle: "SWOT Gadgets Black Friday Promo Sprint",
      criteria,
      contributorHandle: "promouser",
      identityOAuthVerified: true,
      minAuthorFollowers: 10,
      fetchImpl: makeTweetFetch({
        author: { id: "x_bot_1", screen_name: "promouser", followers: 2, joined: "Thu Mar 07 07:11:46 +0000 2024" },
      }),
    });
    expect(botFollowers.verdict.verdict).toBe("reject");
    expect(botFollowers.verdict.reason).toContain("at least 10 followers");
    expect(tweetSpy).not.toHaveBeenCalled();

    // 5. Fresh burner account (< 30 days old) MUST reject BEFORE spending on `buy`
    const freshBurner = await verifyDeliverableWithBuy(buyClient, {
      campaignIdBytes32: campaignId,
      deliverableUrl: "https://x.com/promouser/status/123456789",
      deliverableType: "promo_post",
      campaignTitle: "SWOT Gadgets Black Friday Promo Sprint",
      criteria,
      contributorHandle: "promouser",
      identityOAuthVerified: true,
      minAccountAgeDays: 30,
      fetchImpl: makeTweetFetch({
        author: {
          id: "x_bot_2",
          screen_name: "promouser",
          followers: 50,
          joined: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toUTCString(),
        },
      }),
    });
    expect(freshBurner.verdict.verdict).toBe("reject");
    expect(freshBurner.verdict.reason).toContain("at least 30 days old");
    expect(tweetSpy).not.toHaveBeenCalled();

    // 6. Reply spam MUST reject BEFORE spending on `buy`
    const replySpam = await verifyDeliverableWithBuy(buyClient, {
      campaignIdBytes32: campaignId,
      deliverableUrl: "https://x.com/promouser/status/123456789",
      deliverableType: "promo_post",
      campaignTitle: "SWOT Gadgets Black Friday Promo Sprint",
      criteria,
      contributorHandle: "promouser",
      identityOAuthVerified: true,
      fetchImpl: makeTweetFetch({ replying_to: "swotgadgets" }),
    });
    expect(replySpam.verdict.verdict).toBe("reject");
    expect(replySpam.verdict.reason).toContain("Replies are not eligible");
    expect(tweetSpy).not.toHaveBeenCalled();

    // 7. Non-OAuth tweet hijacking (missing VIRE-AB9A wallet claim code) MUST reject BEFORE spending on `buy`
    const hijacked = await verifyDeliverableWithBuy(buyClient, {
      campaignIdBytes32: campaignId,
      deliverableUrl: "https://x.com/promouser/status/123456789",
      deliverableType: "promo_post",
      campaignTitle: "SWOT Gadgets Black Friday Promo Sprint",
      criteria,
      contributorWallet: "0x915eb78f22D71F0f3E6076E29F4402C610e6AB9a",
      contributorHandle: "promouser",
      identityOAuthVerified: false,
      fetchImpl: mockFetch,
    });
    expect(hijacked.verdict.verdict).toBe("reject");
    expect(hijacked.verdict.reason).toContain("VIRE-AB9A");
    expect(tweetSpy).not.toHaveBeenCalled();

    // 8. Copy-paste duplicate tweet text across accounts MUST reject BEFORE spending on `buy`
    const copyPaste = await verifyDeliverableWithBuy(buyClient, {
      campaignIdBytes32: campaignId,
      deliverableUrl: "https://x.com/promouser/status/123456789",
      deliverableType: "promo_post",
      campaignTitle: "SWOT Gadgets Black Friday Promo Sprint",
      criteria,
      contributorHandle: "promouser",
      identityOAuthVerified: true,
      isContentHashAlreadyUsed: async () => true,
      fetchImpl: mockFetch,
    });
    expect(copyPaste.verdict.verdict).toBe("reject");
    expect(copyPaste.verdict.reason).toContain("already submitted by another account");
    expect(tweetSpy).not.toHaveBeenCalled();

    // 9. Legitimate OAuth-verified author submitting valid original SWOT Gadgets tweet MUST pass & pay Celo `buy`
    const valid = await verifyDeliverableWithBuy(buyClient, {
      campaignIdBytes32: campaignId,
      deliverableUrl: "https://x.com/promouser/status/123456789",
      deliverableType: "promo_post",
      campaignTitle: "SWOT Gadgets Black Friday Promo Sprint",
      criteria,
      contributorWallet: "0x915eb78f22D71F0f3E6076E29F4402C610e6AB9a",
      contributorHandle: "promouser",
      identityOAuthVerified: true,
      fetchImpl: mockFetch,
    });
    expect(valid.verdict.verdict).toBe("pass");
    expect(valid.verdict.score).toBeGreaterThanOrEqual(88);
    expect(valid.buyReceipts.length).toBeGreaterThanOrEqual(1);
    expect(tweetSpy).toHaveBeenCalledWith("123456789");

    // 10. Non-OAuth wallet (Google/MiniPay) WITH matching VIRE-AB9A code in post MUST ALSO pass
    const validWithCode = await verifyDeliverableWithBuy(buyClient, {
      campaignIdBytes32: campaignId,
      deliverableUrl: "https://x.com/promouser/status/123456789",
      deliverableType: "promo_post",
      campaignTitle: "SWOT Gadgets Black Friday Promo Sprint",
      criteria,
      contributorWallet: "0x915eb78f22D71F0f3E6076E29F4402C610e6AB9a",
      contributorHandle: "promouser",
      identityOAuthVerified: false,
      fetchImpl: makeTweetFetch({
        text: "Huge Black Friday iPhone 15 deals live right now at @swotgadgets check https://swotgadgets.com/product/iphone-15 #SWOTBlackFriday VIRE-AB9A",
      }),
    });
    expect(validWithCode.verdict.verdict).toBe("pass");
  });
});

describe("SettlementOrchestrator atomic flow & quote-expiry refund recovery", () => {
  const sampleCampaign: OrchestratorCampaignRecord = {
    idBytes32: "0x1111111111111111111111111111111111111111111111111111111111111111",
    slug: "pilot-cngn-promo",
    title: "Pilot Partner Black Friday Promo",
    deliverableType: "promo_post",
    criteria: "Publish promo post with store tag.",
    corridor: "cNGN",
    rewardLocalAtomic: parseTokenAmount("15000", "cNGN").toString(),
    active: true,
    remainingBudgetUsdtAtomic: "500000000",
    maxPerPayoutUsdtAtomic: "25000000",
    remainingDailyLimitUsdtAtomic: "100000000",
    maxPayoutsPerRecipient: 3,
    stageCooldownHours: 0,
    maxSpreadBps: 300,
    minPassScore: 75,
  };

  it("completes atomic settlement, persists claimToken before swap, and refunds unused USD₮ dust", async () => {
    const statusLog: string[] = [];
    const savedClaims: string[] = [];
    let completedRecord: Record<string, unknown> | null = null;
    let txCounter = 0;

    const persistence: OrchestratorPersistenceAdapter = {
      isDeliverableHashUsed: async () => false,
      getContributorPayoutStats: async () => ({ count: 0, lastPayoutAtMs: null }),
      updateSubmissionStatus: async (_id, patch) => {
        statusLog.push(patch.status);
      },
      recordBuyPayment: async () => {},
      saveRfqQuote: async (_id, outcome) => {
        savedClaims.push(outcome.claimToken ?? "");
      },
      updateRfqQuoteStatus: async () => {},
      recordCompletedSettlement: async (rec) => {
        completedRecord = rec as unknown as Record<string, unknown>;
      },
    };

    const nextHash = () => `0x${String(++txCounter).padStart(64, "a")}` as `0x${string}`;

    const mockTextileFetch: typeof fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.endsWith("/rfq/preview")) {
        return new Response(
          JSON.stringify({
            data: {
              status: "preview",
              buyAmount: sampleCampaign.rewardLocalAtomic,
              takerPays: "10400000",
              feeAmount: "2080",
            },
          }),
          { status: 200 }
        );
      }
      if (u.endsWith("/rfq/request")) {
        return new Response(
          JSON.stringify({
            data: {
              rfqId: "rfq_happy_1",
              claimToken: "rfqc_happy_once",
              status: "quoted",
              attributionSuffix: "0xdeadbeef",
              quote: {
                sellAmount: "10380000",
                buyAmount: sampleCampaign.rewardLocalAtomic,
                feeAmount: "2000",
                takerPays: "10382000", // less than buffered 10556000 -> unused refund = 174000!
                rateRay: "1",
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                orderDeadline: new Date(Date.now() + 90_000).toISOString(),
                latestOrderDeadline: new Date(Date.now() + 90_000).toISOString(),
                reactor: CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR,
                spender: CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR,
                taker: "0x2222222222222222222222222222222222222222",
              },
              transactions: {
                approval: { to: CELO_TOKENS.USDT.address, data: "0x095ea7b3", value: "0", chainId: 42220 },
                swap: { to: CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR, data: "0xabcdef", value: "0", chainId: 42220 },
              },
            },
          }),
          { status: 200 }
        );
      }
      if (u.includes("/submit")) {
        return new Response(
          JSON.stringify({
            data: {
              rfqId: "rfq_happy_1",
              status: "filled",
              chainId: 42220,
              sellToken: CELO_TOKENS.USDT.address,
              buyToken: CELO_TOKENS.cNGN.address,
              sellAmount: "10382000",
              buyAmount: sampleCampaign.rewardLocalAtomic,
              feeAmount: "2000",
              taker: "0x2222222222222222222222222222222222222222",
            },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ data: { chainId: 42220, asOf: new Date().toISOString(), pairs: [] } }), {
        status: 200,
      });
    });

    const publicClient = {
      readContract: vi.fn(async () => 1_000_000_000n),
      getBalance: vi.fn(async ({ address }: { address: string }) =>
        address.toLowerCase() === "0x3333333333333333333333333333333333333333"
          ? 0n
          : 5_000_000_000_000_000_000n
      ),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    } as never;

    const taggedWalletClient = {
      account: { address: "0x2222222222222222222222222222222222222222" },
      chain: { id: 42220 },
      sendTransaction: vi.fn(async () => nextHash()),
    } as never;

    const untaggedWalletClient = {
      account: { address: "0x2222222222222222222222222222222222222222" },
      chain: { id: 42220 },
      sendTransaction: vi.fn(async () => nextHash()),
    } as never;

    const orchestrator = new SettlementOrchestrator({
      publicClient,
      taggedWalletClient,
      untaggedTextileWalletClient: untaggedWalletClient,
      textileClient: new TextileClient({ apiKey: "tx_live_test", fetchImpl: mockTextileFetch }),
      buyClient: new CeloBuyClient({ dryRun: true }),
      persistence,
      vaultAddress: "0x4444444444444444444444444444444444444444",
      vaultOwnerAddress: "0x1111111111111111111111111111111111111111",
      teamBlocklist: new Set(),
      getReferenceRate: async () => 1450,
    });

    // Use a real public resolvable domain (example.com) or mock? Let's test via verifiable https://example.com
    const result = await orchestrator.processSubmission({
      submissionId: "sub_1",
      campaign: sampleCampaign,
      stageIndex: 1,
      contributorWallet: "0x3333333333333333333333333333333333333333",
      identityVerified: true,
      identityHandle: "ada_dev",
      deliverableUrl: "https://example.com/?promo=1",
    });

    expect(result.status).toBe("COMPLETED");
    expect(savedClaims).toEqual(["rfqc_happy_once"]);
    expect(statusLog).toEqual(["VERIFYING", "AUTHORIZED", "SWAPPING", "PAYING", "COMPLETED"]);
    expect(completedRecord?.usdtSpentAtomic).toBe("10382000");
    // 10556000 released - 10382000 spent = 174000 refunded back to VireVault
    expect(completedRecord?.usdtRefundedAtomic).toBe("174000");
    expect(result.txHashes?.gasDrip).toBeDefined();
    expect(result.offramp?.provider).toBe("cngn_venues");
  });

  it("refunds 100% of released USD₮ back to VireVault when Textile returns no_quote", async () => {
    const statusLog: string[] = [];
    let txCount = 0;

    const persistence: OrchestratorPersistenceAdapter = {
      isDeliverableHashUsed: async () => false,
      getContributorPayoutStats: async () => ({ count: 0, lastPayoutAtMs: null }),
      updateSubmissionStatus: async (_id, patch) => {
        statusLog.push(patch.status);
      },
      recordBuyPayment: async () => {},
      saveRfqQuote: async () => {},
      updateRfqQuoteStatus: async () => {},
      recordCompletedSettlement: async () => {
        throw new Error("Should not complete on no_quote");
      },
    };

    const mockFetch: typeof fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.endsWith("/rfq/preview")) {
        return new Response(
          JSON.stringify({
            data: { status: "preview", buyAmount: sampleCampaign.rewardLocalAtomic, takerPays: "10400000" },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ data: { rfqId: "rfq_noq", status: "no_quote", reason: "no_makers_online" } }),
        { status: 200 }
      );
    });

    const sendTransaction = vi.fn(async () => `0x${String(++txCount).padStart(64, "b")}` as `0x${string}`);
    const orchestrator = new SettlementOrchestrator({
      publicClient: {
        readContract: vi.fn(async () => 1_000_000_000n),
        waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
      } as never,
      taggedWalletClient: {
        account: { address: "0x2222222222222222222222222222222222222222" },
        chain: { id: 42220 },
        sendTransaction,
      } as never,
      untaggedTextileWalletClient: {
        account: { address: "0x2222222222222222222222222222222222222222" },
        chain: { id: 42220 },
        sendTransaction,
      } as never,
      textileClient: new TextileClient({ apiKey: "tx_live_test", fetchImpl: mockFetch }),
      buyClient: new CeloBuyClient({ dryRun: true }),
      persistence,
      vaultAddress: "0x4444444444444444444444444444444444444444",
      vaultOwnerAddress: "0x1111111111111111111111111111111111111111",
      teamBlocklist: new Set(),
      getReferenceRate: async () => 1450,
    });

    const result = await orchestrator.processSubmission({
      submissionId: "sub_refund",
      campaign: sampleCampaign,
      stageIndex: 1,
      contributorWallet: "0x3333333333333333333333333333333333333333",
      identityVerified: true,
      identityHandle: "ada_dev",
      deliverableUrl: "https://example.com/?promo=2",
    });

    expect(result.status).toBe("REFUNDED");
    expect(result.refundTxHash).toBeDefined();
    expect(statusLog).toEqual(["VERIFYING", "AUTHORIZED", "REFUNDED"]);
  });
});
