// POST /api/auth/device/approve — the signed-in user approves or denies a
// desktop sign-in request from the /device page (cookie auth + Origin check).

import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { decideDeviceRequest } from "@/lib/device-service";
import { HttpError, json, parseJson, rateLimited, route } from "@/lib/http";
import { limiters } from "@/lib/rate-limit";

const schema = z.object({
  user_code: z.string().min(1).max(32),
  action: z.enum(["approve", "deny"]),
});

const FAILURES = {
  not_found: [404, "Code not found. Check the code shown in FaamOffice."],
  expired: [410, "This code has expired. Start sign-in again in FaamOffice."],
  already_used: [409, "This code has already been used."],
} as const;

export const POST = route(async (req) => {
  const session = await requireApiSession(req);
  const limit = limiters().deviceApprove.check(session.userId);
  if (!limit.ok) throw rateLimited(limit.retryAfter);

  const input = await parseJson(req, schema);
  const result = await decideDeviceRequest(session.userId, input.user_code, input.action === "approve");
  if (result === "approved" || result === "denied") return json({ ok: true, status: result });
  const [status, message] = FAILURES[result];
  throw new HttpError(status, `code_${result}`, message);
});
