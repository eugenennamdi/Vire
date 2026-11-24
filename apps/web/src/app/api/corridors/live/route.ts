import { NextRequest, NextResponse } from "next/server";
import { getLiveCorridors } from "@/lib/corridors-live";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const force = req.nextUrl.searchParams.get("refresh") === "1";
    const data = await getLiveCorridors(force);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=5" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch live Textile FX corridors" },
      { status: 502 }
    );
  }
}
