// Database side of the device authorization flow (desktop sign-in).

import { prisma } from "./db";
import { randomToken, sha256Hex } from "./crypto";
import { getConfig } from "./env";
import { generateApiToken, hashApiToken } from "./api-token";
import { generateUserCode, normalizeUserCode } from "./user-code";
import {
  decideDevicePoll,
  DEVICE_CODE_TTL_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  isActionable,
  type DevicePollError,
} from "./device-flow";

export async function createDeviceAuthorization(input: { clientId: string; deviceName: string }) {
  const now = new Date();
  // Housekeeping: drop requests that expired more than a day ago.
  await prisma.deviceCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } });

  const deviceCode = randomToken(32);
  for (let attempt = 0; attempt < 5; attempt++) {
    const userCode = generateUserCode();
    try {
      await prisma.deviceCode.create({
        data: {
          deviceCodeHash: sha256Hex(deviceCode),
          userCode,
          clientId: input.clientId,
          deviceName: input.deviceName,
          interval: DEVICE_POLL_INTERVAL_SECONDS,
          expiresAt: new Date(now.getTime() + DEVICE_CODE_TTL_SECONDS * 1000),
        },
      });
      const base = getConfig().siteUrl;
      return {
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: `${base}/device`,
        verification_uri_complete: `${base}/device?code=${userCode}`,
        expires_in: DEVICE_CODE_TTL_SECONDS,
        interval: DEVICE_POLL_INTERVAL_SECONDS,
      };
    } catch (err) {
      // Retry on a user_code collision (unique index); rethrow anything else.
      if ((err as { code?: string })?.code !== "P2002") throw err;
    }
  }
  throw new Error("Could not allocate a unique user code");
}

/** Look up a request by the code the user typed (any formatting). */
export async function findDeviceRequest(userCodeInput: string | null | undefined) {
  const userCode = normalizeUserCode(userCodeInput);
  if (!userCode) return null;
  return prisma.deviceCode.findUnique({ where: { userCode } });
}

export type DecisionResult = "approved" | "denied" | "not_found" | "expired" | "already_used";

/** Approve or deny a pending request on behalf of the signed-in user. */
export async function decideDeviceRequest(userId: string, userCodeInput: string, approve: boolean): Promise<DecisionResult> {
  const row = await findDeviceRequest(userCodeInput);
  if (!row) return "not_found";
  const now = new Date();
  if (!isActionable(row, now)) {
    return row.status === "pending" ? "expired" : "already_used";
  }
  const res = await prisma.deviceCode.updateMany({
    where: { id: row.id, status: "pending", expiresAt: { gt: now } },
    data: approve ? { status: "approved", userId, approvedAt: now } : { status: "denied", userId },
  });
  if (res.count !== 1) return "already_used";
  return approve ? "approved" : "denied";
}

export type PollResult =
  | { ok: false; error: DevicePollError | "invalid_client"; interval?: number }
  | { ok: true; accessToken: string; user: { id: string; email: string; name: string } };

/** Token endpoint logic: returns an error code or issues the access token exactly once. */
export async function pollDeviceToken(clientId: string, deviceCode: string): Promise<PollResult> {
  const row = await prisma.deviceCode.findUnique({ where: { deviceCodeHash: sha256Hex(deviceCode) } });
  if (!row) return { ok: false, error: "invalid_grant" };
  if (row.clientId !== clientId) return { ok: false, error: "invalid_client" };

  const now = new Date();
  const decision = decideDevicePoll(row, now);
  await prisma.deviceCode.update({
    where: { id: row.id },
    data: { lastPolledAt: now, interval: decision.interval },
  });
  if (decision.kind === "error") {
    return { ok: false, error: decision.error, interval: decision.interval };
  }

  const user = row.userId ? await prisma.user.findUnique({ where: { id: row.userId } }) : null;
  if (!user || user.disabledAt) {
    await prisma.deviceCode.update({ where: { id: row.id }, data: { status: "denied" } });
    return { ok: false, error: "access_denied" };
  }

  const accessToken = generateApiToken();
  const issued = await prisma.$transaction(async (tx) => {
    // Conditional transition approved → consumed guarantees a single issuance.
    const claimed = await tx.deviceCode.updateMany({
      where: { id: row.id, status: "approved" },
      data: { status: "consumed" },
    });
    if (claimed.count !== 1) return null;
    const token = await tx.apiToken.create({
      data: { userId: user.id, name: row.deviceName, tokenHash: hashApiToken(accessToken) },
    });
    await tx.deviceCode.update({ where: { id: row.id }, data: { tokenId: token.id } });
    return token;
  });
  if (!issued) return { ok: false, error: "invalid_grant" };
  return { ok: true, accessToken, user: { id: user.id, email: user.email, name: user.name } };
}
