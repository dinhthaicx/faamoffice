// POST /api/auth/device/code — start desktop sign-in (RFC 8628 device authorization).
// Called by the desktop app's main process: no cookies, no Origin check.

import { z } from "zod";
import { DEVICE_CLIENT_ID } from "@/lib/device-flow";
import { createDeviceAuthorization } from "@/lib/device-service";
import { clientIp, HttpError, json, rateLimited, route } from "@/lib/http";
import { cleanDeviceName, readOAuthBody } from "@/lib/oauth-body";
import { limiters } from "@/lib/rate-limit";

const schema = z.object({
  client_id: z.string().max(100),
  device_name: z.string().max(500).optional(),
});

export const POST = route(async (req) => {
  const limit = limiters().deviceCode.check(clientIp(req));
  if (!limit.ok) throw rateLimited(limit.retryAfter);

  const parsed = schema.safeParse(await readOAuthBody(req));
  if (!parsed.success) throw new HttpError(400, "invalid_request", "client_id and device_name are required.");
  if (parsed.data.client_id !== DEVICE_CLIENT_ID) {
    throw new HttpError(400, "invalid_client", "Unknown client_id.");
  }
  const result = await createDeviceAuthorization({
    clientId: parsed.data.client_id,
    deviceName: cleanDeviceName(parsed.data.device_name),
  });
  return json(result);
});
