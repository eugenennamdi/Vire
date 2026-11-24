import { verifyDeliverableWithBuy } from "@vire/agent";
import {
  computeImpliedRateLocalPerUsdt,
  CORRIDORS,
  formatTokenAmount,
  parseTokenAmount,
  X402VerifyRequestSchema,
} from "@vire/shared";
import { NextRequest, NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { getBuyClient, getTextileClient } from "@/lib/runtime";
import { executeX402ProtectedRoute } from "@/lib/x402";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERIFY_PRICE_USDT_ATOMIC = process.env.X402_VERIFY_PRICE_USDT_ATOMIC?.trim() || "50000"; // $0.05 USD₮

export async function POST(req: NextRequest) {
  return executeX402ProtectedRoute({
    req,
    routePath: "/api/x402/verify",
    usdtAtomicAmount: VERIFY_PRICE_USDT_ATOMIC,
    description:
      "Vire deliverable verification + live Textile FX Celo corridor quote oracle returning a signed attestation.",
    handler: async (paidReq: NextRequest) => {
      const body = await paidReq.json().catch(() => null);
      const parsed = X402VerifyRequestSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid x402 verification request", details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const { deliverableUrl, deliverableType, criteria, corridor, rewardLocalHuman } = parsed.data;
      const corridorMeta = CORRIDORS[corridor];
      const rewardAtomic = parseTokenAmount(rewardLocalHuman, corridor);

      const [verification, preview] = await Promise.all([
        verifyDeliverableWithBuy(getBuyClient(), {
          deliverableUrl,
          deliverableType,
          campaignTitle: "External x402 Verification Oracle Request",
          criteria,
          githubApiToken: process.env.GITHUB_API_TOKEN?.trim() || undefined,
          useChainstackRpc: process.env.BUY_USE_CHAINSTACK_RPC === "true",
        }),
        getTextileClient()
          .previewExactOutput({
            buyToken: corridorMeta.tokenAddress,
            buyAmountAtomic: rewardAtomic.toString(),
          })
          .catch(() => null),
      ]);

      const impliedRate =
        preview?.status === "preview" && preview.takerPays
          ? computeImpliedRateLocalPerUsdt(rewardAtomic, preview.takerPays, corridor)
          : null;

      const attestationPayload = {
        service: "vire-x402-verify-oracle",
        chainId: 42220,
        issuedAt: new Date().toISOString(),
        deliverableUrl: verification.artifact.normalizedUrl,
        deliverableType,
        verdict: verification.verdict,
        corridorQuote: {
          corridor,
          tokenAddress: corridorMeta.tokenAddress,
          tokenDecimals: corridorMeta.decimals,
          requestedLocalAtomic: rewardAtomic.toString(),
          requestedLocalFormatted: formatTokenAmount(rewardAtomic, corridor, 2),
          previewStatus: preview?.status ?? "unavailable",
          estimatedUsdtAtomic: preview?.takerPays ?? null,
          estimatedUsdtFormatted: preview?.takerPays
            ? formatTokenAmount(preview.takerPays, "USDT", 4)
            : null,
          impliedRateLocalPerUsdt: impliedRate,
        },
        buyReceipts: verification.buyReceipts,
      };

      // Cryptographically sign attestation using Vire's agent key when configured
      let signature: string | null = null;
      let signerAddress: string | null = null;
      const pk = process.env.VIRE_AGENT_PRIVATE_KEY?.trim();
      if (pk && /^0x[0-9a-fA-F]{64}$/.test(pk)) {
        const account = privateKeyToAccount(pk as Hex);
        signerAddress = account.address;
        signature = await account.signMessage({
          message: JSON.stringify(attestationPayload),
        });
      }

      return NextResponse.json({
        attestation: attestationPayload,
        signerAddress,
        signature,
      });
    },
  });
}
