import { describe, expect, it, vi } from "vitest";
import { CELO_CONTRACTS, CELO_TOKENS, DEFAULT_ATTRIBUTION_CODE } from "@vire/shared";
import { encodeFunctionData, erc20Abi } from "viem";
import { ConcurrencyLimiter, TextileClient, TextileQuoteExpiredError } from "../src/index.js";

describe("packages/textile RFQ v2 engine", () => {
  it("enforces client timeout >= 75s and max 4 concurrent open RFQs", async () => {
    expect(() => new TextileClient({ firmRequestTimeoutMs: 30_000 })).toThrow(/75000ms/);

    const limiter = new ConcurrencyLimiter(4);
    let current = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 10 }, () =>
        limiter.run(async () => {
          current += 1;
          peak = Math.max(peak, current);
          await new Promise((r) => setTimeout(r, 15));
          current -= 1;
        })
      )
    );
    expect(peak).toBe(4);
    expect(limiter.active).toBe(0);
    expect(limiter.queued).toBe(0);
  });

  it("sends exact-output buyAmount + includeAttribution + builderCodes in Partner Key mode and persists claimToken", async () => {
    const capturedBodies: Array<Record<string, unknown>> = [];
    const capturedHeaders: Array<Record<string, string>> = [];

    const mockFetch: typeof fetch = vi.fn(async (_url, init) => {
      capturedBodies.push(JSON.parse(String(init?.body ?? "{}")));
      capturedHeaders.push((init?.headers as Record<string, string>) ?? {});
      return new Response(
        JSON.stringify({
          data: {
            rfqId: "rfq_01TEST",
            claimToken: "rfqc_secret_once",
            status: "quoted",
            attributionSuffix: "0x1234",
            quote: {
              sellAmount: "10000000",
              buyAmount: "15000000000",
              feeAmount: "2000",
              takerPays: "10002000",
              rateRay: "1500000000000000000000000000000",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              orderDeadline: new Date(Date.now() + 90_000).toISOString(),
              latestOrderDeadline: new Date(Date.now() + 90_000).toISOString(),
              reactor: CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR,
              spender: CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR,
              taker: "0x1111111111111111111111111111111111111111",
            },
            transactions: {
              approval: {
                to: CELO_TOKENS.USDT.address,
                data: "0x095ea7b3",
                value: "0",
                chainId: 42220,
              },
              swap: {
                to: CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR,
                data: "0xabcdef",
                value: "0",
                chainId: 42220,
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const client = new TextileClient({
      apiKey: "tx_live_dummy_test",
      builderCodes: [DEFAULT_ATTRIBUTION_CODE],
      fetchImpl: mockFetch,
    });

    let savedClaim = "";
    const outcome = await client.requestFirmExactOutput({
      buyToken: CELO_TOKENS.cNGN.address,
      buyAmountAtomic: "15000000000",
      taker: "0x1111111111111111111111111111111111111111",
      onClaimToken: (o) => {
        savedClaim = o.claimToken ?? "";
      },
    });

    expect(savedClaim).toBe("rfqc_secret_once");
    expect(outcome.rfqId).toBe("rfq_01TEST");
    expect(capturedHeaders[0]?.Authorization).toBe("Bearer tx_live_dummy_test");
    expect(capturedBodies[0]).toMatchObject({
      chainId: 42220,
      sellToken: CELO_TOKENS.USDT.address,
      buyToken: CELO_TOKENS.cNGN.address,
      buyAmount: "15000000000",
      includeAttribution: true,
      builderCodes: [DEFAULT_ATTRIBUTION_CODE],
    });
    expect(capturedBodies[0]?.sellAmount).toBeUndefined();
    expect(capturedBodies[0]?.takerProof).toBeUndefined();
  });

  it("blocks double-tagging wallet clients and non-allowlisted spenders, and cancels on expiry before broadcast", async () => {
    const cancelCalls: string[] = [];
    const mockFetch: typeof fetch = vi.fn(async (url) => {
      cancelCalls.push(String(url));
      return new Response(JSON.stringify({ data: { rfqId: "rfq_exp", status: "released" } }), {
        status: 200,
      });
    });

    const client = new TextileClient({ fetchImpl: mockFetch });
    const fakePublicClient = {
      readContract: vi.fn(async () => 100_000_000n),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    } as never;

    const taggedWallet = {
      __vireAttributedCode: DEFAULT_ATTRIBUTION_CODE,
      account: { address: "0x1111111111111111111111111111111111111111" },
      chain: { id: 42220 },
      sendTransaction: vi.fn(),
    } as never;

    const expiredOutcome = {
      rfqId: "rfq_exp",
      claimToken: "rfqc_exp",
      status: "quoted" as const,
      quote: {
        sellAmount: "10000000",
        buyAmount: "15000000000",
        feeAmount: "2000",
        takerPays: "10002000",
        rateRay: "1",
        expiresAt: new Date(Date.now() - 10_000).toISOString(),
        orderDeadline: new Date(Date.now() + 10_000).toISOString(),
        latestOrderDeadline: new Date(Date.now() + 10_000).toISOString(),
        reactor: CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR,
        spender: CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR,
        taker: "0x1111111111111111111111111111111111111111" as const,
      },
      transactions: {
        approval: {
          to: CELO_TOKENS.USDT.address,
          data: "0x095ea7b3" as const,
          value: "0",
          chainId: 42220,
        },
        swap: {
          to: CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR,
          data: "0xabcdef" as const,
          value: "0",
          chainId: 42220,
        },
      },
    };

    // 1. Must block attribution-wrapped wallet client
    await expect(
      client.executeFirmSwap({
        outcome: expiredOutcome,
        untaggedWalletClient: taggedWallet,
        publicClient: fakePublicClient,
      })
    ).rejects.toThrow(/double-tag/i);

    // 2. Must block malicious/non-allowlisted spender
    const untaggedWallet = {
      account: { address: "0x1111111111111111111111111111111111111111" },
      chain: { id: 42220 },
      sendTransaction: vi.fn(),
    } as never;

    await expect(
      client.executeFirmSwap({
        outcome: {
          ...expiredOutcome,
          quote: {
            ...expiredOutcome.quote,
            spender: "0x000000000000000000000000000000000000dead",
          },
        },
        untaggedWalletClient: untaggedWallet,
        publicClient: fakePublicClient,
      })
    ).rejects.toThrow(/non-allowlisted/i);

    // 3. Must NOT broadcast swap when quote expired; must call /cancel cleanly
    await expect(
      client.executeFirmSwap({
        outcome: expiredOutcome,
        untaggedWalletClient: untaggedWallet,
        publicClient: fakePublicClient,
      })
    ).rejects.toBeInstanceOf(TextileQuoteExpiredError);
    expect(cancelCalls.some((u) => u.endsWith("/rfq/rfq_exp/cancel"))).toBe(true);

    // 4. Must construct exact local ERC-20 approve(spender, takerPays) calldata with value=0n (ignoring poisoned external approvalTx.data/value)
    const sentTxs: Array<{ to: string; data: string; value: bigint }> = [];
    const lowAllowancePublic = {
      readContract: vi.fn(async () => 0n),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    } as never;
    const recordingWallet = {
      account: { address: "0x1111111111111111111111111111111111111111" },
      chain: { id: 42220 },
      sendTransaction: vi.fn(async (tx: { to: string; data: string; value: bigint }) => {
        sentTxs.push(tx);
        return "0x" + "1".repeat(64);
      }),
    } as never;
    const fillMockFetch: typeof fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            rfqId: "rfq_safe_approve",
            status: "filled",
            chainId: 42220,
            sellToken: CELO_TOKENS.USDT.address,
            buyToken: CELO_TOKENS.cNGN.address,
            sellAmount: "10002000",
            buyAmount: "15000000000",
            feeAmount: "2000",
            taker: "0x1111111111111111111111111111111111111111",
          },
        }),
        { status: 200 }
      )
    );
    const approveClient = new TextileClient({ fetchImpl: fillMockFetch });
    await approveClient.executeFirmSwap({
      outcome: {
        ...expiredOutcome,
        rfqId: "rfq_safe_approve",
        quote: {
          ...expiredOutcome.quote,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        transactions: {
          approval: {
            to: CELO_TOKENS.USDT.address,
            // Maliciously crafted transfer() calldata & non-zero value — MUST be ignored!
            data: "0xa9059cbb000000000000000000000000deaddeaddeaddeaddeaddeaddeaddeaddeaddead" as const,
            value: "999999999999999999",
            chainId: 42220,
          },
          swap: expiredOutcome.transactions.swap,
        },
      },
      untaggedWalletClient: recordingWallet,
      publicClient: lowAllowancePublic,
    });
    const expectedApproveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR, 10002000n],
    });
    expect(sentTxs[0]?.to.toLowerCase()).toBe(CELO_TOKENS.USDT.address.toLowerCase());
    expect(sentTxs[0]?.data).toBe(expectedApproveData);
    expect(sentTxs[0]?.value).toBe(0n);
  });

  it("sends exact-input sellAmount (never buyAmount) for local-token to USDT previews and firm quotes", async () => {
    const capturedBodies: Array<Record<string, unknown>> = [];
    const mockFetch: typeof fetch = vi.fn(async (_url, init) => {
      capturedBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({
          data: {
            rfqId: "rfq_EXACT_IN",
            claimToken: "rfqc_in_once",
            status: "quoted",
            quote: {
              sellAmount: "2500000000",
              buyAmount: "1741086",
              feeAmount: "499900",
              takerPays: "2500000000",
              rateRay: "696573686874427410505004",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              orderDeadline: new Date(Date.now() + 90_000).toISOString(),
              latestOrderDeadline: new Date(Date.now() + 90_000).toISOString(),
              reactor: CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR,
              spender: CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR,
              taker: "0x1111111111111111111111111111111111111111",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const client = new TextileClient({
      apiKey: "tx_live_dummy_test",
      builderCodes: [DEFAULT_ATTRIBUTION_CODE],
      fetchImpl: mockFetch,
    });

    await client.previewExactInput({
      sellToken: CELO_TOKENS.cNGN.address,
      sellAmountAtomic: "2500000000",
    });

    await client.requestFirmExactInput({
      sellToken: CELO_TOKENS.cNGN.address,
      sellAmountAtomic: "2500000000",
      taker: "0x1111111111111111111111111111111111111111",
    });

    expect(capturedBodies[0]).toMatchObject({
      chainId: 42220,
      sellToken: CELO_TOKENS.cNGN.address,
      buyToken: CELO_TOKENS.USDT.address,
      sellAmount: "2500000000",
    });
    expect(capturedBodies[0]?.buyAmount).toBeUndefined();

    expect(capturedBodies[1]).toMatchObject({
      chainId: 42220,
      sellToken: CELO_TOKENS.cNGN.address,
      buyToken: CELO_TOKENS.USDT.address,
      sellAmount: "2500000000",
      includeAttribution: true,
      builderCodes: [DEFAULT_ATTRIBUTION_CODE],
    });
    expect(capturedBodies[1]?.buyAmount).toBeUndefined();
  });

  it("retries firm RFQ when Textile reports transient insufficient balance right after an onchain transfer", async () => {
    let attempts = 0;
    const mockFetch: typeof fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: "INSUFFICIENT_FUNDS",
              message: "Your wallet does not hold enough of the sell token to settle this trade",
              details: { reason: "insufficient_funds" },
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            rfqId: "rfq_RETRY_OK",
            claimToken: "rfqc_retry_ok",
            status: "quoted",
            quote: {
              sellAmount: "6933526",
              buyAmount: "10000000000",
              feeAmount: "1386",
              takerPays: "6933526",
              rateRay: "693214000000000000000000",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              orderDeadline: new Date(Date.now() + 90_000).toISOString(),
              latestOrderDeadline: new Date(Date.now() + 90_000).toISOString(),
              reactor: CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR,
              spender: CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR,
              taker: "0x8ba43426D57E55C51c4fe7C4F8a68Df3bf008089",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const client = new TextileClient({
      apiKey: "tx_live_dummy_test",
      builderCodes: [DEFAULT_ATTRIBUTION_CODE],
      insufficientFundsRetryDelaysMs: [0, 0],
      fetchImpl: mockFetch,
    });

    const outcome = await client.requestFirmExactOutput({
      buyToken: CELO_TOKENS.cNGN.address,
      buyAmountAtomic: "10000000000",
      taker: "0x8ba43426D57E55C51c4fe7C4F8a68Df3bf008089",
    });

    expect(attempts).toBe(2);
    expect(outcome.rfqId).toBe("rfq_RETRY_OK");
    expect(outcome.status).toBe("quoted");
  });
});
