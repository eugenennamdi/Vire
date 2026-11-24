import { formatTokenAmount } from "@vire/shared";
import { NextResponse } from "next/server";
import { getAttributionCode, getVaultSnapshot } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const snap = await getVaultSnapshot();
  return NextResponse.json({
    ...snap,
    attributionCode: getAttributionCode(),
    usdtBalanceFormatted: snap.usdtBalanceAtomic
      ? formatTokenAmount(snap.usdtBalanceAtomic, "USDT", 2)
      : null,
    totalCommittedBudgetFormatted: snap.totalCommittedBudgetAtomic
      ? formatTokenAmount(snap.totalCommittedBudgetAtomic, "USDT", 2)
      : null,
  });
}
