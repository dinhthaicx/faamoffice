// GET /api/v1/me — the signed-in desktop user (Bearer token).

import { authenticateBearer } from "@/lib/api-token";
import { json, route } from "@/lib/http";
import { publicUser } from "@/lib/users";

export const GET = route(async (req) => {
  const { user } = await authenticateBearer(req);
  return json(publicUser(user));
});
