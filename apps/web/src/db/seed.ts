import {
  CELO_TOKENS,
  getLaunchPartnerConfig,
  parseTokenAmount,
  type CampaignStage,
  type CorridorSymbol,
  type DeliverableType,
} from "@vire/shared";
import { keccak256, stringToHex } from "viem";
import { ensureDatabaseReady, getDb, schema } from "./index";

export interface CampaignSeedBlueprint {
  slug: string;
  partnerName: string;
  partnerLocation: string;
  isLaunchPartner: boolean;
  title: string;
  description: string;
  criteria: string;
  deliverableType: DeliverableType;
  corridor: CorridorSymbol;
  stages: CampaignStage[];
  budgetUsdtHuman: string;
  maxPerPayoutUsdtHuman: string;
  dailyLimitUsdtHuman: string;
  maxPayoutsPerRecipient: number;
  cooldownHours: number;
  maxSpreadBps: number;
  minPassScore: number;
}

export function buildDefaultCampaignBlueprints(): CampaignSeedBlueprint[] {
  const partner = getLaunchPartnerConfig();

  return [
    {
      slug: "launch-partner-blackfriday-cngn",
      partnerName: partner.name,
      partnerLocation: partner.location,
      isLaunchPartner: true,
      title: "Black Friday & December Gadget Micro-Affiliate Sprint",
      description: `Multi-stage promo & verified buyer referral clearing for ${partner.name}. Promoters post product showcases, track referral conversions, and earn exact cNGN settled directly on Celo Mainnet.`,
      criteria: `Public X/Instagram/TikTok/blog post or referral receipt mentioning ${partner.name} (${partner.handle}), Black Friday / December gadget deals, and a valid referral handle or product showcase URL.`,
      deliverableType: "promo_post",
      corridor: "cNGN",
      stages: [
        {
          stageIndex: 1,
          title: "Stage 1 — Launch Promo Post",
          instructions: `Publish a public Black Friday promo post tagging ${partner.handle} with product pricing and store link.`,
          rewardLocalAtomic: parseTokenAmount("3000", "cNGN").toString(), // ~$2.05 clears $1 Textile floor comfortably
          cooldownHours: 0,
        },
        {
          stageIndex: 2,
          title: "Stage 2 — Comparison Thread / Reel",
          instructions: "Follow up on Day 2+ with a gadget spec comparison or unboxing clip linking the store deal.",
          rewardLocalAtomic: parseTokenAmount("5000", "cNGN").toString(),
          cooldownHours: 12,
        },
        {
          stageIndex: 3,
          title: "Stage 3 — Verified Buyer Referral",
          instructions: "Submit proof of a completed customer order referencing your affiliate handle for commission payout.",
          rewardLocalAtomic: parseTokenAmount("8000", "cNGN").toString(),
          cooldownHours: 24,
        },
      ],
      budgetUsdtHuman: partner.campaignBudgetUsdt,
      maxPerPayoutUsdtHuman: "15",
      dailyLimitUsdtHuman: "100",
      maxPayoutsPerRecipient: 3,
      cooldownHours: 12,
      maxSpreadBps: 250,
      minPassScore: 75,
    },
    {
      slug: "latam-qa-regression-wars",
      partnerName: "Vire Cross-Border Engineering",
      partnerLocation: "Buenos Aires, Argentina",
      isLaunchPartner: false,
      title: "Argentina QA Bug Bounty & MiniPay Flow Audit",
      description:
        "Reproducible QA bug reports and Spanish UX reviews for mobile wallet checkout flows, settled in exact wARS with zero-fee Ripio CBU off-ramp.",
      criteria:
        "GitHub issue or PR containing clear reproduction steps, environment details, expected vs actual behavior, and actionable fix notes.",
      deliverableType: "qa_bug",
      corridor: "wARS",
      stages: [
        {
          stageIndex: 1,
          title: "Stage 1 — Reproducible Bug Report",
          instructions: "File a verified GitHub issue with steps to reproduce and screenshot/log evidence.",
          rewardLocalAtomic: parseTokenAmount("2500", "wARS").toString(),
          cooldownHours: 0,
        },
        {
          stageIndex: 2,
          title: "Stage 2 — Regression Verification",
          instructions: "Verify a deployed fix on Celo Mainnet and attach test notes on a subsequent day.",
          rewardLocalAtomic: parseTokenAmount("4000", "wARS").toString(),
          cooldownHours: 12,
        },
        {
          stageIndex: 3,
          title: "Stage 3 — End-to-End Patch PR",
          instructions: "Open a clean GitHub PR resolving a logged UX or edge-case bug with unit test coverage.",
          rewardLocalAtomic: parseTokenAmount("6500", "wARS").toString(),
          cooldownHours: 24,
        },
      ],
      budgetUsdtHuman: "120",
      maxPerPayoutUsdtHuman: "15",
      dailyLimitUsdtHuman: "40",
      maxPayoutsPerRecipient: 3,
      cooldownHours: 12,
      maxSpreadBps: 300,
      minPassScore: 75,
    },
    {
      slug: "brazil-ptbr-localization-wbrl",
      partnerName: "Vire Cross-Border Engineering",
      partnerLocation: "São Paulo, Brazil",
      isLaunchPartner: false,
      title: "PT-BR Docs & Checkout Localization Sprint",
      description:
        "Native Brazilian Portuguese localization of merchant onboarding guides and payout receipts, settled in exact wBRL with prefilled Ripio PIX ramp.",
      criteria:
        "GitHub PR or public gist containing idiomatic PT-BR translations preserving all technical placeholders and token decimal warnings.",
      deliverableType: "localization",
      corridor: "wBRL",
      stages: [
        {
          stageIndex: 1,
          title: "Stage 1 — UI Copy Translation",
          instructions: "Translate core contributor claim & off-ramp strings into natural PT-BR.",
          rewardLocalAtomic: parseTokenAmount("12", "wBRL").toString(),
          cooldownHours: 0,
        },
        {
          stageIndex: 2,
          title: "Stage 2 — Merchant Guide Review",
          instructions: "Review and refine PT-BR merchant treasury documentation via PR comments.",
          rewardLocalAtomic: parseTokenAmount("18", "wBRL").toString(),
          cooldownHours: 12,
        },
        {
          stageIndex: 3,
          title: "Stage 3 — Full Walkthrough Localization",
          instructions: "Complete end-to-end PT-BR README quickstart and FAQ translation PR.",
          rewardLocalAtomic: parseTokenAmount("30", "wBRL").toString(),
          cooldownHours: 24,
        },
      ],
      budgetUsdtHuman: "120",
      maxPerPayoutUsdtHuman: "15",
      dailyLimitUsdtHuman: "40",
      maxPayoutsPerRecipient: 3,
      cooldownHours: 12,
      maxSpreadBps: 250,
      minPassScore: 75,
    },
    {
      slug: "indonesia-bahasa-qa-idrx",
      partnerName: "Vire APAC Localization Guild",
      partnerLocation: "Jakarta, Indonesia",
      isLaunchPartner: false,
      title: "Indonesia Bahasa Localization & 2-Decimal IDRX QA",
      description:
        "Bahasa Indonesia localization and mobile wallet precision testing, settled in exact 2-decimal IDRX directly on Celo Mainnet.",
      criteria:
        "GitHub PR/issue with Bahasa Indonesia localization diff or documented IDRX wallet display/redemption verification.",
      deliverableType: "localization",
      corridor: "IDRX",
      stages: [
        {
          stageIndex: 1,
          title: "Stage 1 — Bahasa Copy & Wallet QA",
          instructions: "Submit Bahasa Indonesia copy PR or verified 2-decimal IDRX QA report.",
          rewardLocalAtomic: parseTokenAmount("35000", "IDRX").toString(), // 3,500,000 atomic (2 decimals!)
          cooldownHours: 0,
        },
        {
          stageIndex: 2,
          title: "Stage 2 — Redemption Guide Audit",
          instructions: "Audit Indonesian cash-out walkthrough accuracy and submit improvements.",
          rewardLocalAtomic: parseTokenAmount("55000", "IDRX").toString(),
          cooldownHours: 12,
        },
        {
          stageIndex: 3,
          title: "Stage 3 — Full Release QA Sign-off",
          instructions: "Complete final cross-device Bahasa regression checklist on GitHub.",
          rewardLocalAtomic: parseTokenAmount("85000", "IDRX").toString(),
          cooldownHours: 24,
        },
      ],
      budgetUsdtHuman: "100",
      maxPerPayoutUsdtHuman: "15",
      dailyLimitUsdtHuman: "35",
      maxPayoutsPerRecipient: 3,
      cooldownHours: 12,
      maxSpreadBps: 250,
      minPassScore: 75,
    },
    {
      slug: "mexico-merchant-referrals-wmxn",
      partnerName: "Vire LatAm Merchant Desk",
      partnerLocation: "Mexico City, Mexico",
      isLaunchPartner: false,
      title: "Mexico E-Commerce Referral & ES-MX QA Campaign",
      description:
        "Verified Mexican retail onboarding referrals and ES-MX product QA settled in exact wMXN with Ripio CLABE off-ramp (automatically guarded by live Textile corridor liquidity).",
      criteria:
        "Verified referral submission or GitHub QA report tailored for Mexican merchants and Ripio wMXN settlement.",
      deliverableType: "referral",
      corridor: "wMXN",
      stages: [
        {
          stageIndex: 1,
          title: "Stage 1 — Merchant Discovery Proof",
          instructions: "Submit documented ES-MX merchant lead or QA report.",
          rewardLocalAtomic: parseTokenAmount("40", "wMXN").toString(),
          cooldownHours: 0,
        },
        {
          stageIndex: 2,
          title: "Stage 2 — Demo Feedback Summary",
          instructions: "Log structured merchant feedback from a live checkout walkthrough.",
          rewardLocalAtomic: parseTokenAmount("65", "wMXN").toString(),
          cooldownHours: 12,
        },
        {
          stageIndex: 3,
          title: "Stage 3 — Verified Pilot Onboarding",
          instructions: "Confirm pilot merchant activation for full referral bonus.",
          rewardLocalAtomic: parseTokenAmount("100", "wMXN").toString(),
          cooldownHours: 24,
        },
      ],
      budgetUsdtHuman: "80",
      maxPerPayoutUsdtHuman: "12",
      dailyLimitUsdtHuman: "30",
      maxPayoutsPerRecipient: 3,
      cooldownHours: 12,
      maxSpreadBps: 300,
      minPassScore: 75,
    },
  ];
}

/**
 * Idempotently seed campaign definitions (config only — NEVER seeds fake settlements or fake tx hashes).
 */
export async function ensureDefaultCampaignsSeeded(): Promise<number> {
  await ensureDatabaseReady();
  const db = getDb();
  const blueprints = buildDefaultCampaignBlueprints();
  let inserted = 0;

  for (const bp of blueprints) {
    const idBytes32 = keccak256(stringToHex(`vire:campaign:${bp.slug}`));
    const token = CELO_TOKENS[bp.corridor];
    const firstStage = bp.stages[0]!;
    const budgetAtomic = parseTokenAmount(bp.budgetUsdtHuman, "USDT").toString();

    const res = await db
      .insert(schema.campaigns)
      .values({
        id: idBytes32,
        slug: bp.slug,
        partnerName: bp.partnerName,
        partnerLocation: bp.partnerLocation,
        isLaunchPartner: bp.isLaunchPartner,
        title: bp.title,
        description: bp.description,
        criteria: bp.criteria,
        deliverableType: bp.deliverableType,
        corridor: bp.corridor,
        localTokenAddress: token.address,
        localTokenDecimals: token.decimals,
        rewardLocalAtomic: firstStage.rewardLocalAtomic,
        stagesJson: JSON.stringify(bp.stages),
        budgetUsdtAtomic: budgetAtomic,
        remainingUsdtAtomic: budgetAtomic,
        maxPerPayoutUsdtAtomic: parseTokenAmount(bp.maxPerPayoutUsdtHuman, "USDT").toString(),
        dailyLimitUsdtAtomic: parseTokenAmount(bp.dailyLimitUsdtHuman, "USDT").toString(),
        maxPayoutsPerRecipient: bp.maxPayoutsPerRecipient,
        cooldownHours: bp.cooldownHours,
        maxSpreadBps: bp.maxSpreadBps,
        minPassScore: bp.minPassScore,
        active: true,
        createdAt: Date.now(),
      })
      .onConflictDoNothing();

    if (res.rowsAffected > 0) {
      inserted += 1;
    }
  }
  return inserted;
}
