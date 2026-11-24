import { buildAgentCardManifest } from "@vire/celo-infra";
import { NextResponse } from "next/server";
import { getAgentIdBigInt, getAppUrl, getVaultAddress } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const manifest = buildAgentCardManifest({
    appUrl: getAppUrl(),
    vaultAddress: getVaultAddress() ?? undefined,
    agentId: getAgentIdBigInt() ?? undefined,
  });

  return NextResponse.json(manifest, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
