// Daily Faam AI request quota, enforced while Faam credits are turned off.
//
// A "day" is a calendar day in Asia/Ho_Chi_Minh, a fixed UTC+7 offset (Vietnam
// has no daylight saving time). The count is the number of the user's
// UsageRecord rows since local midnight (every completed request of the day,
// including ones made earlier while credits were still on) plus the user's
// requests still running in this process. Requests are only recorded once they
// finish, which can take minutes for a long stream: without the running ones a
// burst of slow requests would all pass before the first is counted. What is
// left is a soft limit: a request finishing at the very moment another is
// checked can let one extra through, each server process counts its own
// running requests, and a request that produced no output (upstream error,
// client gone before the first token) is not recorded at all.

import { prisma } from "./db";
import type { SiteSettings } from "./site-settings-shared";

const DAY_MS = 86_400_000;
/** Asia/Ho_Chi_Minh is UTC+7 all year. */
export const QUOTA_UTC_OFFSET_MS = 7 * 3_600_000;

/** Start of the current quota day (local midnight, as a UTC instant). */
export function quotaDayStart(now: Date): Date {
  const local = now.getTime() + QUOTA_UTC_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - QUOTA_UTC_OFFSET_MS);
}

/** Next local midnight, when the quota resets. */
export function quotaResetsAt(now: Date): Date {
  return new Date(quotaDayStart(now).getTime() + DAY_MS);
}

/** Whole seconds until the reset (at least 1), for Retry-After. */
export function secondsUntilReset(now: Date): number {
  return Math.max(1, Math.ceil((quotaResetsAt(now).getTime() - now.getTime()) / 1000));
}

export function countRequestsToday(userId: string, now: Date): Promise<number> {
  return prisma.usageRecord.count({ where: { userId, createdAt: { gte: quotaDayStart(now) } } });
}

// Accepted requests not recorded yet, per user. On globalThis like the rate
// limiters, so dev-mode reloads and route bundles share one count.
const globalForQuota = globalThis as unknown as { __faamAiInFlight?: Map<string, number> };
const inFlight = () => (globalForQuota.__faamAiInFlight ??= new Map<string, number>());

/** The user's Faam AI requests currently running in this process. */
export function aiRequestsInFlight(userId: string): number {
  return inFlight().get(userId) ?? 0;
}

/**
 * Count one of the user's requests as running until the returned function is
 * called (idempotent). Call it after the usage record is written, so the
 * request is always counted by one or the other.
 */
export function trackAiRequest(userId: string): () => void {
  const map = inFlight();
  map.set(userId, (map.get(userId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (map.get(userId) ?? 1) - 1;
    if (left > 0) map.set(userId, left);
    else map.delete(userId);
  };
}

export type AiQuota = { limit: number; used: number; resetsAt: string };

/** Today's quota, or null when it does not apply (credits on, or no limit). */
export async function getAiQuota(userId: string, settings: SiteSettings, now = new Date()): Promise<AiQuota | null> {
  if (settings.creditsEnabled || settings.aiDailyRequestLimit <= 0) return null;
  const used = await countRequestsToday(userId, now);
  return { limit: settings.aiDailyRequestLimit, used, resetsAt: quotaResetsAt(now).toISOString() };
}
