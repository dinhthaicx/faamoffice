// GET /api/v1/usage?limit=20&cursor=<id> — Faam AI Cloud usage, newest first.

import { z } from "zod";
import { authenticateBearer } from "@/lib/api-token";
import { prisma } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).catch(20),
  cursor: z.string().min(1).max(64).optional(),
});

export const GET = route(async (req) => {
  const { user } = await authenticateBearer(req);
  const url = new URL(req.url);
  const { limit, cursor } = querySchema.parse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") || undefined,
  });

  if (cursor) {
    const owned = await prisma.usageRecord.findFirst({ where: { id: cursor, userId: user.id }, select: { id: true } });
    if (!owned) throw new HttpError(400, "invalid_cursor", "Unknown cursor.");
  }
  const rows = await prisma.usageRecord.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  return json({
    items: page.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      model: r.model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      credits: r.credits,
    })),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  });
});
