export interface LaunchPartnerConfig {
  name: string;
  tagline: string;
  logoUrl: string;
  handle: string;
  location: string;
  campaignBudgetUsdt: string;
  storeUrl: string;
}

/**
 * Configurable Named Launch Partner workspace (Pilot Client #1: SWOT Gadgets — swotgadgets.com).
 * Override any field via NEXT_PUBLIC_PARTNER_* environment variables with zero code changes.
 */
export function getLaunchPartnerConfig(env: Record<string, string | undefined> = process.env): LaunchPartnerConfig {
  return {
    name: env.NEXT_PUBLIC_PARTNER_NAME?.trim() || "SWOT Gadgets",
    tagline:
      env.NEXT_PUBLIC_PARTNER_TAGLINE?.trim() ||
      "Black Friday Gadget Promo Clearing on Celo Mainnet",
    logoUrl: env.NEXT_PUBLIC_PARTNER_LOGO_URL?.trim() || "",
    handle: env.NEXT_PUBLIC_PARTNER_HANDLE?.trim() || "@swotgadgets",
    location: env.NEXT_PUBLIC_PARTNER_LOCATION?.trim() || "Abeokuta, Nigeria",
    campaignBudgetUsdt: env.NEXT_PUBLIC_PARTNER_CAMPAIGN_BUDGET_USDT?.trim() || "35",
    storeUrl: env.NEXT_PUBLIC_PARTNER_STORE_URL?.trim() || "https://swotgadgets.com",
  };
}
