import { ensureDefaultCampaignsSeeded, buildDefaultCampaignBlueprints } from "../apps/web/src/db/seed.js";
import { parseTokenAmount } from "@vire/shared";
import { keccak256, stringToHex } from "viem";
import { loadDotEnv } from "./load-env.js";

loadDotEnv();

async function main() {
  const inserted = await ensureDefaultCampaignsSeeded();
  console.log(`Seeded campaigns cleanly (${inserted} newly inserted; existing campaigns preserved).\n`);
  console.log("Onchain VireVault Campaign IDs (bytes32) & Recommended Budgets:");
  for (const bp of buildDefaultCampaignBlueprints()) {
    const id = keccak256(stringToHex(`vire:campaign:${bp.slug}`));
    const budgetAtomic = parseTokenAmount(bp.budgetUsdtHuman, "USDT");
    const maxPerPayout = parseTokenAmount(bp.maxPerPayoutUsdtHuman, "USDT");
    const dailyLimit = parseTokenAmount(bp.dailyLimitUsdtHuman, "USDT");
    console.log(`  - ${bp.slug} [${bp.corridor}]`);
    console.log(`      campaignId:      ${id}`);
    console.log(`      budgetUsdt:      ${budgetAtomic} ($${bp.budgetUsdtHuman} USD₮)`);
    console.log(`      maxPerPayout:    ${maxPerPayout} ($${bp.maxPerPayoutUsdtHuman} USD₮)`);
    console.log(`      dailyLimitUsdt:  ${dailyLimit} ($${bp.dailyLimitUsdtHuman} USD₮)`);
    console.log(`      maxPerRecipient: ${bp.maxPayoutsPerRecipient}`);
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
