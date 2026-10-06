import { describe, expect, it } from "vitest";
import {
  decideDevicePoll,
  isActionable,
  MAX_POLL_INTERVAL_SECONDS,
  type DevicePollState,
} from "@/lib/device-flow";

const t0 = new Date("2026-10-06T10:00:00Z");
const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

function state(overrides: Partial<DevicePollState> = {}): DevicePollState {
  return { status: "pending", expiresAt: at(600), lastPolledAt: null, interval: 5, ...overrides };
}

describe("device flow state machine", () => {
  it("pending → authorization_pending on the first poll", () => {
    expect(decideDevicePoll(state(), at(1))).toEqual({ kind: "error", error: "authorization_pending", interval: 5 });
  });

  it("polls respecting the interval stay pending", () => {
    expect(decideDevicePoll(state({ lastPolledAt: at(0) }), at(5))).toMatchObject({ error: "authorization_pending" });
    // Within the 1 s jitter tolerance.
    expect(decideDevicePoll(state({ lastPolledAt: at(0) }), at(4.2))).toMatchObject({ error: "authorization_pending" });
  });

  it("polling faster than the interval → slow_down and +5 s interval", () => {
    const d = decideDevicePoll(state({ lastPolledAt: at(0) }), at(1));
    expect(d).toEqual({ kind: "error", error: "slow_down", interval: 10 });
    // The new interval is enforced on the next poll.
    expect(decideDevicePoll(state({ lastPolledAt: at(1), interval: 10 }), at(6))).toMatchObject({ error: "slow_down", interval: 15 });
    expect(decideDevicePoll(state({ lastPolledAt: at(1), interval: 10 }), at(11))).toMatchObject({ error: "authorization_pending" });
  });

  it("caps the interval", () => {
    const d = decideDevicePoll(state({ lastPolledAt: at(0), interval: MAX_POLL_INTERVAL_SECONDS }), at(1));
    expect(d.interval).toBe(MAX_POLL_INTERVAL_SECONDS);
  });

  it("approved → issue the token (even when polled quickly)", () => {
    expect(decideDevicePoll(state({ status: "approved", lastPolledAt: at(0) }), at(1))).toEqual({ kind: "issue", interval: 5 });
  });

  it("consumed → invalid_grant (token is only issued once)", () => {
    expect(decideDevicePoll(state({ status: "consumed" }), at(10))).toMatchObject({ error: "invalid_grant" });
  });

  it("denied → access_denied", () => {
    expect(decideDevicePoll(state({ status: "denied" }), at(10))).toMatchObject({ error: "access_denied" });
  });

  it("expired → expired_token, for pending and approved requests alike", () => {
    expect(decideDevicePoll(state(), at(600))).toMatchObject({ error: "expired_token" });
    expect(decideDevicePoll(state({ status: "approved" }), at(601))).toMatchObject({ error: "expired_token" });
  });

  it("full lifecycle: pending → approved → issued once → consumed", () => {
    let s = state();
    expect(decideDevicePoll(s, at(0)).kind).toBe("error");
    s = { ...s, lastPolledAt: at(0), status: "approved" };
    expect(decideDevicePoll(s, at(5)).kind).toBe("issue");
    s = { ...s, lastPolledAt: at(5), status: "consumed" };
    expect(decideDevicePoll(s, at(10))).toMatchObject({ error: "invalid_grant" });
  });

  it("only pending, unexpired requests can be approved or denied", () => {
    expect(isActionable(state(), at(1))).toBe(true);
    expect(isActionable(state(), at(600))).toBe(false);
    expect(isActionable(state({ status: "approved" }), at(1))).toBe(false);
    expect(isActionable(state({ status: "denied" }), at(1))).toBe(false);
  });
});
