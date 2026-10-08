import { z } from "zod";

/** IP literals avoid DNS rebinding. localhost is normalized to IPv4 loopback. */
export function normalizeLanAiUrl(raw: string): string | null {
  if (/[\u0000-\u0020\u007f\\]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    if (!/^\/(?:v1\/*)?$/.test(url.pathname)) return null;
    const host = url.hostname;
    const parts = host.split(".").map(Number);
    const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host) && parts.every((n) => n >= 0 && n <= 255);
    const privateV4 = ipv4 && (parts[0] === 127 || parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
    const privateV6 = host === "[::1]" || /^\[f[cd][0-9a-f]{2}:/i.test(host);
    if (host !== "localhost" && !privateV4 && !privateV6) return null;
    if (host === "localhost") url.hostname = "127.0.0.1";
    return `${url.origin}/v1`;
  } catch {
    return null;
  }
}

export const aiBackendSchema = z.strictObject({
  baseUrl: z.string().trim().max(500).refine((v) => normalizeLanAiUrl(v) !== null, { error: "lan_url" })
    .transform((v) => normalizeLanAiUrl(v)!),
  models: z.array(z.strictObject({
    id: z.string().regex(/^[A-Za-z0-9._:\-/]{1,100}$/),
    upstream: z.string().trim().min(1).max(200).refine((v) => !/[\u0000-\u001f\u007f]/.test(v)),
    reasoningEffort: z.enum(["none", "low", "medium", "high"]).optional(),
  })).min(1).max(12).refine((models) => new Set(models.map((m) => m.id)).size === models.length, { error: "duplicate" }),
});

export type AiBackendSettings = z.infer<typeof aiBackendSchema>;
export type AiBackendCheck = { models: { id: string; upstream: string; contextTokens: number }[] };
