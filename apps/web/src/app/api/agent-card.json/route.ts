import { buildAgentCardManifest } from "@vire/celo-infra";
import { NextResponse } from "next/server";
import { getAgentIdBigInt, getAppUrl, getVaultAddress } from "@/lib/runtime";

export const revalidate = 300;

const PUBLIC_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

export async function GET() {
  const manifest = buildAgentCardManifest({
    appUrl: getAppUrl(),
    vaultAddress: getVaultAddress() ?? undefined,
    agentId: getAgentIdBigInt() ?? undefined,
  });

  return NextResponse.json(manifest, { headers: PUBLIC_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_HEADERS });
}
