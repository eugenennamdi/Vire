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
 * Configurable Named Launch Partner workspace (Pilot Client #1: Nigerian Gadget Retail Store).
 * Override any field via NEXT_PUBLIC_PARTNER_* environment variables with zero code changes.
 */
export function getLaunchPartnerConfig(env: Record<string, string | undefined> = process.env): LaunchPartnerConfig {
  return {
    name: env.NEXT_PUBLIC_PARTNER_NAME?.trim() || "Kano & Lagos Tech Hub (Pilot Partner)",
    tagline:
      env.NEXT_PUBLIC_PARTNER_TAGLINE?.trim() ||
      "Verified Black Friday & December Smartphone Micro-Affiliate Clearing",
    logoUrl: env.NEXT_PUBLIC_PARTNER_LOGO_URL?.trim() || "",
    handle: env.NEXT_PUBLIC_PARTNER_HANDLE?.trim() || "@techhubng",
    location: env.NEXT_PUBLIC_PARTNER_LOCATION?.trim() || "Lagos, Nigeria",
    campaignBudgetUsdt: env.NEXT_PUBLIC_PARTNER_CAMPAIGN_BUDGET_USDT?.trim() || "500",
    storeUrl: env.NEXT_PUBLIC_PARTNER_STORE_URL?.trim() || "https://example.com",
  };
}
