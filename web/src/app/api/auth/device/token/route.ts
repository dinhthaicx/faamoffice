// POST /api/auth/device/token — the desktop app polls here until the user
// approves; the access token is returned exactly once.

import { z } from "zod";
import { devicePollMessage, DEVICE_CLIENT_ID } from "@/lib/device-flow";
import { pollDeviceToken } from "@/lib/device-service";
import { clientIp, HttpError, json, jsonError, rateLimited, route } from "@/lib/http";
import { limiters } from "@/lib/rate-limit";
import { readOAuthBody } from "@/lib/oauth-body";

const schema = z.object({
  client_id: z.string().max(100),
  device_code: z.string().min(1).max(200),
});

export const POST = route(async (req) => {
  const limit = limiters().deviceToken.check(clientIp(req));
  if (!limit.ok) throw rateLimited(limit.retryAfter);

  const parsed = schema.safeParse(await readOAuthBody(req));
  if (!parsed.success) throw new HttpError(400, "invalid_request", "client_id and device_code are required.");
  if (parsed.data.client_id !== DEVICE_CLIENT_ID) {
    throw new HttpError(400, "invalid_client", "Unknown client_id.");
  }

  const result = await pollDeviceToken(parsed.data.client_id, parsed.data.device_code);
  if (!result.ok) {
    if (result.error === "invalid_client") return jsonError(400, "invalid_client", "Unknown client_id.");
    return jsonError(
      400,
      result.error,
      devicePollMessage(result.error),
      result.error === "slow_down" ? { interval: result.interval } : undefined,
    );
  }
  return json({ access_token: result.accessToken, token_type: "Bearer", user: result.user });
});
