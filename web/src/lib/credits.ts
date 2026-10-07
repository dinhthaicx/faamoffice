// Credit ledger operations. Every balance change writes a CreditTransaction in
// the same database transaction as the balance update.

import { prisma } from "./db";
import { HttpError } from "./http";

export const MAX_ADJUSTMENT = 100_000_000;

/** Admin credit adjustment (+/−) with a mandatory reason. */
export async function adjustCredits(input: { userId: string; delta: number; note: string; actorId: string }) {
  if (!Number.isInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > MAX_ADJUSTMENT) {
    throw new HttpError(400, "invalid_amount", "Amount must be a non-zero whole number.");
  }
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: input.userId },
      data: { credits: { increment: input.delta } },
      select: { credits: true },
    });
    return tx.creditTransaction.create({
      data: {
        userId: input.userId,
        delta: input.delta,
        balanceAfter: user.credits,
        reason: "admin_adjust",
        note: input.note,
        actorId: input.actorId,
      },
    });
  });
}

export type AiUsageInput = {
  userId: string;
  tokenId: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  credits: number;
  estimated: boolean;
};

/**
 * Bill one Faam AI Cloud request: usage record + ledger entry + balance
 * decrement, atomically. The balance may go slightly negative for the request
 * that crosses zero; the next request is then rejected with 402.
 */
export async function recordAiUsage(input: AiUsageInput) {
  return prisma.$transaction(async (tx) => {
    const usage = await tx.usageRecord.create({
      data: {
        userId: input.userId,
        tokenId: input.tokenId,
        model: input.model,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        credits: input.credits,
        estimated: input.estimated,
      },
    });
    const user = await tx.user.update({
      where: { id: input.userId },
      data: { credits: { decrement: input.credits } },
      select: { credits: true },
    });
    await tx.creditTransaction.create({
      data: {
        userId: input.userId,
        delta: -input.credits,
        balanceAfter: user.credits,
        reason: "ai_usage",
        note: `${input.model}: ${input.promptTokens} in / ${input.completionTokens} out${input.estimated ? " (estimated)" : ""}`,
        usageRecordId: usage.id,
      },
    });
    return { usage, balance: user.credits };
  });
}

/**
 * Record one Faam AI Cloud request while Faam credits are turned off: a usage
 * record with 0 credits (it counts toward the daily quota), no ledger entry and
 * no balance change.
 */
export async function recordUnbilledAiUsage(input: Omit<AiUsageInput, "credits">) {
  return prisma.usageRecord.create({
    data: {
      userId: input.userId,
      tokenId: input.tokenId,
      model: input.model,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      credits: 0,
      estimated: input.estimated,
    },
  });
}
