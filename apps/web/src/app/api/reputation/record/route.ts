import { CELO_CONTRACTS } from "@vire/shared";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import type { Hash } from "viem";
import { z } from "zod";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { getPublicClient } from "@/lib/runtime";
import { verifyWalletSessionCookie, WALLET_SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

const RecordRatingSchema = z.object({
  submissionId: z.string().min(4).max(128),
  feedbackTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export async function POST(req: NextRequest) {
  await ensureDatabaseReady();

  const session = verifyWalletSessionCookie(req.cookies.get(WALLET_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Wallet authentication required." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = RecordRatingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid rating record" }, { status: 400 });
  }

  const db = getDb();
  const rows = await db
    .select({
      id: schema.settlements.id,
      recipientWallet: schema.settlements.recipientWallet,
      erc8004Rated: schema.settlements.erc8004Rated,
    })
    .from(schema.settlements)
    .where(eq(schema.settlements.submissionId, parsed.data.submissionId))
    .limit(1);

  const settlement = rows[0];
  if (!settlement) {
    return NextResponse.json({ error: "Settlement record not found." }, { status: 404 });
  }
  if (settlement.recipientWallet.toLowerCase() !== session.wallet.toLowerCase()) {
    return NextResponse.json(
      { error: "Only the settlement recipient can record ERC-8004 feedback." },
      { status: 403 }
    );
  }
  if (settlement.erc8004Rated) {
    return NextResponse.json({ error: "Feedback already recorded for this settlement." }, { status: 409 });
  }

  // Verify the feedback transaction on Celo Mainnet before recording it in the public ledger
  try {
    const publicClient = getPublicClient();
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: parsed.data.feedbackTxHash as Hash,
      timeout: 25_000,
    });
    if (
      receipt.status !== "success" ||
      receipt.from.toLowerCase() !== settlement.recipientWallet.toLowerCase() ||
      receipt.to?.toLowerCase() !== CELO_CONTRACTS.ERC8004_REPUTATION_REGISTRY.toLowerCase()
    ) {
      return NextResponse.json(
        { error: "Transaction does not match a valid ERC-8004 feedback call from your wallet." },
        { status: 422 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Unable to confirm ERC-8004 feedback transaction on Celo Mainnet." },
      { status: 422 }
    );
  }

  await db
    .update(schema.settlements)
    .set({
      erc8004Rated: true,
      erc8004FeedbackTxHash: parsed.data.feedbackTxHash,
    })
    .where(eq(schema.settlements.submissionId, parsed.data.submissionId));

  return NextResponse.json({ recorded: true });
}
