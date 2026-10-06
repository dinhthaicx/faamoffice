// Pure decision logic for the RFC 8628 device-authorization token endpoint.
// Database access lives in device-service.ts; this module is unit-tested on its own.

export const DEVICE_CLIENT_ID = "faamoffice-desktop";
export const DEVICE_CODE_TTL_SECONDS = 600;
export const DEVICE_POLL_INTERVAL_SECONDS = 5;
/** Added to the interval after every slow_down (RFC 8628 §3.5). */
export const SLOW_DOWN_INCREMENT_SECONDS = 5;
export const MAX_POLL_INTERVAL_SECONDS = 60;
/** Network jitter allowance: polls up to this much early are not "too fast". */
export const POLL_TOLERANCE_MS = 1000;

export type DeviceStatus = "pending" | "approved" | "denied" | "consumed";

export type DevicePollState = {
  status: DeviceStatus;
  expiresAt: Date;
  lastPolledAt: Date | null;
  interval: number;
};

export type DevicePollError =
  | "authorization_pending"
  | "slow_down"
  | "expired_token"
  | "access_denied"
  | "invalid_grant";

export type DevicePollDecision =
  | { kind: "error"; error: DevicePollError; interval: number }
  | { kind: "issue"; interval: number };

/**
 * Decide the outcome of one poll. Every poll (including slow_down) should
 * record `lastPolledAt = now` and persist the returned interval.
 */
export function decideDevicePoll(state: DevicePollState, now: Date): DevicePollDecision {
  const interval = state.interval;
  if (state.status === "consumed") return { kind: "error", error: "invalid_grant", interval };
  if (now.getTime() >= state.expiresAt.getTime()) {
    return { kind: "error", error: "expired_token", interval };
  }
  if (state.status === "denied") return { kind: "error", error: "access_denied", interval };
  if (state.status === "approved") return { kind: "issue", interval };

  // pending
  if (state.lastPolledAt) {
    const elapsed = now.getTime() - state.lastPolledAt.getTime();
    if (elapsed < interval * 1000 - POLL_TOLERANCE_MS) {
      return {
        kind: "error",
        error: "slow_down",
        interval: Math.min(interval + SLOW_DOWN_INCREMENT_SECONDS, MAX_POLL_INTERVAL_SECONDS),
      };
    }
  }
  return { kind: "error", error: "authorization_pending", interval };
}

/** Whether a user can still approve or deny this request on the /device page. */
export function isActionable(state: Pick<DevicePollState, "status" | "expiresAt">, now: Date): boolean {
  return state.status === "pending" && now.getTime() < state.expiresAt.getTime();
}

const POLL_MESSAGES: Record<DevicePollError, string> = {
  authorization_pending: "The user has not approved this device yet.",
  slow_down: "Polling too fast. Increase the interval by 5 seconds.",
  expired_token: "The device code has expired. Start sign-in again.",
  access_denied: "The user denied this sign-in request.",
  invalid_grant: "The device code is invalid or has already been used.",
};

export function devicePollMessage(error: DevicePollError): string {
  return POLL_MESSAGES[error];
}
