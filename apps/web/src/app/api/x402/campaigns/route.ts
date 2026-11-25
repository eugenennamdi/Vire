import {
  CELO_TOKENS,
  parseTokenAmount,
  X402CreateCampaignRequestSchema,
  type CampaignStage,
} from "@vire/shared";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { keccak256, stringToHex } from "viem";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { executeX402ProtectedRoute } from "@/lib/x402";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CAMPAIGN_PRICE_USDT_ATOMIC = process.env.X402_CAMPAIGN_PRICE_USDT_ATOMIC?.trim() || "250000"; // $0.25 USD₮

export async function POST(req: NextRequest) {
  let createdCampaignId: string | null = null;

  return executeX402ProtectedRoute({
    req,
    routePath: "/api/x402/campaigns",
    usdtAtomicAmount: CAMPAIGN_PRICE_USDT_ATOMIC,
    description:
      "Permissionless campaign creation fee on Vire allowing any external business or developer to launch a verified Celo FX payout mission.",
    onSettled: async (txHash) => {
      if (createdCampaignId) {
        const db = getDb();
        await db
          .update(schema.campaigns)
          .set({ createdViaX402TxHash: txHash })
          .where(eq(schema.campaigns.id, createdCampaignId));
      }
    },
    handler: async (paidReq: NextRequest) => {
      await ensureDatabaseReady();

      const body = await paidReq.json().catch(() => null);
      const parsed = X402CreateCampaignRequestSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid campaign payload", details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const d = parsed.data;
      const token = CELO_TOKENS[d.corridor];
      const baseSlug = d.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);
      const slug = `${baseSlug}-${Date.now().toString(36)}`;
      const idBytes32 = keccak256(stringToHex(`vire:campaign:${slug}`));
      createdCampaignId = idBytes32;

      const rewardAtomic = parseTokenAmount(d.rewardLocalHuman, d.corridor).toString();
      const budgetAtomic = parseTokenAmount(d.budgetUsdtHuman, "USDT").toString();

      const stages: CampaignStage[] = [
        {
          stageIndex: 1,
          title: "Stage 1 — Initial Verified Deliverable",
          instructions: d.description,
          rewardLocalAtomic: rewardAtomic,
          cooldownHours: 0,
        },
        {
          stageIndex: 2,
          title: "Stage 2 — Follow-Up / Repeat Deliverable",
          instructions: `Follow-up verified ${d.deliverableType} submission for ${d.partnerName}.`,
          rewardLocalAtomic: rewardAtomic,
          cooldownHours: 12,
        },
      ];

      const db = getDb();
      await db.insert(schema.campaigns).values({
        id: idBytes32,
        slug,
        partnerName: d.partnerName,
        partnerLocation: "External x402 Client",
        isLaunchPartner: false,
        title: d.title,
        description: d.description,
        criteria: d.description,
        deliverableType: d.deliverableType,
        corridor: d.corridor,
        localTokenAddress: token.address,
        localTokenDecimals: token.decimals,
        rewardLocalAtomic: rewardAtomic,
        stagesJson: JSON.stringify(stages),
        budgetUsdtAtomic: budgetAtomic,
        remainingUsdtAtomic: "0",
        maxPerPayoutUsdtAtomic: parseTokenAmount(d.maxPerPayoutUsdtHuman, "USDT").toString(),
        dailyLimitUsdtAtomic: parseTokenAmount(d.dailyLimitUsdtHuman, "USDT").toString(),
        maxPayoutsPerRecipient: d.maxPayoutsPerRecipient,
        cooldownHours: 12,
        maxSpreadBps: d.maxSpreadBps,
        minPassScore: d.minPassScore,
        active: false,
        createdViaX402TxHash: null,
        createdAt: Date.now(),
      });

      return NextResponse.json(
        {
          created: true,
          campaignId: idBytes32,
          slug,
          corridor: d.corridor,
          localTokenAddress: token.address,
          localTokenDecimals: token.decimals,
          nextStep:
            "Fund this campaignId on VireVault via createCampaign() from the Merchant Console to activate onchain USD₮ settlements.",
        },
        { status: 201 }
      );
    },
  });
}
