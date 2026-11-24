import { NextResponse } from "next/server";
import { getLiveReputationSnapshot } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getLiveReputationSnapshot();
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "public, max-age=15" },
  });
}
