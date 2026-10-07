import { z } from "zod";

export const DOWNLOAD_ASSETS = ["macArm", "macIntel", "winExe", "appImage", "deb", "rpm"] as const;
export const DOWNLOAD_TIME_ZONE = "Asia/Ho_Chi_Minh";
export const downloadClickSchema = z.strictObject({
  asset: z.enum(DOWNLOAD_ASSETS),
  version: z.string().max(80).regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/),
  locale: z.enum(["vi", "en"]),
  source: z.enum(["recommended", "platform"]),
});
export type DownloadClick = z.infer<typeof downloadClickSchema>;

export function downloadDay(now = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function shiftDownloadDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function downloadRange(value: unknown): 7 | 30 | 90 {
  return value === "7" || value === 7 ? 7 : value === "90" || value === 90 ? 90 : 30;
}
