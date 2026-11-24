import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureDatabaseReady, getDb, schema } from "@/db";

export const dynamic = "force-dynamic";

const RecordRatingSchema = z.object({
  submissionId: z.string().min(4),
  feedbackTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export async function POST(req: NextRequest) {
  await ensureDatabaseReady();
  const body = await req.json().catch(() => null);
  const parsed = RecordRatingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid rating record" }, { status: 400 });
  }

  const db = getDb();
  await db
    .update(schema.settlements)
    .set({
      erc8004Rated: true,
      erc8004FeedbackTxHash: parsed.data.feedbackTxHash,
    })
    .where(eq(schema.settlements.submissionId, parsed.data.submissionId));

  return NextResponse.json({ recorded: true });
}
