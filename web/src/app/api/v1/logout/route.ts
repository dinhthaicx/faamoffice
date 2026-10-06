// POST /api/v1/logout — revoke the calling token (desktop sign-out).

import { authenticateBearer } from "@/lib/api-token";
import { prisma } from "@/lib/db";
import { route } from "@/lib/http";

export const POST = route(async (req) => {
  const { token } = await authenticateBearer(req);
  await prisma.apiToken.updateMany({ where: { id: token.id, revokedAt: null }, data: { revokedAt: new Date() } });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
