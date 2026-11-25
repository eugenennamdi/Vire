import {
  CELO_TOKENS,
  getLaunchPartnerConfig,
  parseTokenAmount,
  type CampaignStage,
  type CorridorSymbol,
  type DeliverableType,
} from "@vire/shared";
import { eq, inArray } from "drizzle-orm";
import { keccak256, stringToHex } from "viem";
import { ensureDatabaseReady, getDb, schema } from "./index";

export interface CampaignSeedBlueprint {
  slug: string;
  partnerName: string;
  partnerLocation: string;
  isLaunchPartner: boolean;
  active?: boolean;
  hidden?: boolean;
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

const DEPRECATED_PLACEHOLDER_SLUGS = [
  "brazil-ptbr-localization-wbrl",
  "indonesia-bahasa-qa-idrx",
  "mexico-merchant-referrals-wmxn",
];

export function buildDefaultCampaignBlueprints(): CampaignSeedBlueprint[] {
  const partner = getLaunchPartnerConfig();
  const storeHost = partner.storeUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

  return [
    {
      slug: "launch-partner-blackfriday-cngn",
      partnerName: "Vire Protocol",
      partnerLocation: "Celo Mainnet",
      isLaunchPartner: false,
      active: false,
      hidden: true,
      title: "Vire Mainnet Testflight",
      description: `Pre-launch Celo Mainnet verification run testing end-to-end vault release, Textile FX USDT → cNGN clearing, x402 verification, and instant local payout before the ${partner.name} (${storeHost}) launch campaign.`,
      criteria: `Live pre-launch verification run on Celo Mainnet.`,
      deliverableType: "promo_post",
      corridor: "cNGN",
      stages: [
        {
          stageIndex: 1,
          title: "Mainnet Testflight Run",
          instructions: `Pre-launch Celo Mainnet settlement verification run.`,
          rewardLocalAtomic: parseTokenAmount("2500", "cNGN").toString(),
          cooldownHours: 0,
        },
      ],
      budgetUsdtHuman: partner.campaignBudgetUsdt,
      maxPerPayoutUsdtHuman: "6",
      dailyLimitUsdtHuman: "20",
      maxPayoutsPerRecipient: 1,
      cooldownHours: 0,
      maxSpreadBps: 250,
      minPassScore: 75,
    },
    {
      slug: "latam-qa-regression-wars",
      partnerName: "Vire Protocol",
      partnerLocation: "Open Source · Celo Mainnet",
      isLaunchPartner: false,
      title: "Vire Open-Source QA & Multi-Corridor Bug Bounty",
      description:
        "Reproducible QA bug reports or verified patch PRs on github.com/eugenennamdi/Vire, paid in exact Argentine Peso (wARS) on Celo Mainnet.",
      criteria:
        "Public GitHub issue or pull request on eugenennamdi/Vire with clear reproduction steps, environment details, expected vs actual behavior, or a tested code fix.",
      deliverableType: "qa_bug",
      corridor: "wARS",
      stages: [
        {
          stageIndex: 1,
          title: "Reproducible QA Issue or Patch PR",
          instructions:
            "File a reproducible GitHub issue or patch PR on github.com/eugenennamdi/Vire with clear steps, expected vs actual behavior, and verification evidence. First-come, first-served — 1 verified payout per contributor.",
          rewardLocalAtomic: parseTokenAmount("2500", "wARS").toString(), // ~$1.43 clears $1 floor
          cooldownHours: 0,
        },
      ],
      budgetUsdtHuman: "2", // Matches live onchain VireVault allocation ($2.00 USDT)
      maxPerPayoutUsdtHuman: "5",
      dailyLimitUsdtHuman: "10",
      maxPayoutsPerRecipient: 1,
      cooldownHours: 0,
      maxSpreadBps: 300,
      minPassScore: 75,
    },
  ];
}

/**
 * Idempotently seed & sync active campaign definitions (config only — NEVER seeds fake settlements or fake tx hashes).
 * Removes deprecated unfunded placeholder campaigns when they have zero submissions or settlements.
 */
export async function ensureDefaultCampaignsSeeded(): Promise<number> {
  await ensureDatabaseReady();
  const db = getDb();
  const blueprints = buildDefaultCampaignBlueprints();
  let inserted = 0;

  // Clean up deprecated placeholder campaigns that have no historical submissions
  const deprecatedRows = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(inArray(schema.campaigns.slug, DEPRECATED_PLACEHOLDER_SLUGS));

  for (const row of deprecatedRows) {
    const subs = await db
      .select({ id: schema.submissions.id })
      .from(schema.submissions)
      .where(eq(schema.submissions.campaignId, row.id))
      .limit(1);
    if (subs.length === 0) {
      await db.delete(schema.campaigns).where(eq(schema.campaigns.id, row.id));
    }
  }

  for (const bp of blueprints) {
    const idBytes32 = keccak256(stringToHex(`vire:campaign:${bp.slug}`));
    const token = CELO_TOKENS[bp.corridor];
    const firstStage = bp.stages[0]!;
    const budgetAtomic = parseTokenAmount(bp.budgetUsdtHuman, "USDT").toString();
    const maxPerAtomic = parseTokenAmount(bp.maxPerPayoutUsdtHuman, "USDT").toString();
    const dailyAtomic = parseTokenAmount(bp.dailyLimitUsdtHuman, "USDT").toString();

    const existing = await db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, idBytes32))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(schema.campaigns).values({
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
        maxPerPayoutUsdtAtomic: maxPerAtomic,
        dailyLimitUsdtAtomic: dailyAtomic,
        maxPayoutsPerRecipient: bp.maxPayoutsPerRecipient,
        cooldownHours: bp.cooldownHours,
        maxSpreadBps: bp.maxSpreadBps,
        minPassScore: bp.minPassScore,
        active: bp.active ?? true,
        hidden: bp.hidden ?? false,
        createdAt: Date.now(),
      });
      inserted += 1;
    } else {
      // Keep campaign metadata synced with partner config without clobbering spent remaining budget.
      const settled = await db
        .select({ id: schema.settlements.id })
        .from(schema.settlements)
        .where(eq(schema.settlements.campaignId, idBytes32))
        .limit(1);

      await db
        .update(schema.campaigns)
        .set({
          partnerName: bp.partnerName,
          partnerLocation: bp.partnerLocation,
          isLaunchPartner: bp.isLaunchPartner,
          title: bp.title,
          description: bp.description,
          criteria: bp.criteria,
          rewardLocalAtomic: firstStage.rewardLocalAtomic,
          stagesJson: JSON.stringify(bp.stages),
          budgetUsdtAtomic: budgetAtomic,
          ...(settled.length === 0 ? { remainingUsdtAtomic: budgetAtomic } : {}),
          maxPerPayoutUsdtAtomic: maxPerAtomic,
          dailyLimitUsdtAtomic: dailyAtomic,
          maxPayoutsPerRecipient: bp.maxPayoutsPerRecipient,
          cooldownHours: bp.cooldownHours,
          maxSpreadBps: bp.maxSpreadBps,
          minPassScore: bp.minPassScore,
          ...(bp.active !== undefined ? { active: bp.active } : {}),
          ...(bp.hidden !== undefined ? { hidden: bp.hidden } : {}),
        })
        .where(eq(schema.campaigns.id, idBytes32));
    }
  }
  return inserted;
}
