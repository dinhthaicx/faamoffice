// Faam AI Cloud model catalog (FAAM_AI_MODELS) and request rewriting.

import { z } from "zod";

export const modelConfigSchema = z.object({
  /** Public id the desktop app sends, e.g. "faam-fast". */
  id: z.string().regex(/^[A-Za-z0-9._:\-/]{1,100}$/),
  /** Model id sent to the upstream OpenAI-compatible server. */
  upstream: z.string().min(1).max(200),
  /** Credits per 1,000 prompt tokens (may be fractional). */
  inputPer1K: z.number().min(0).max(1_000_000),
  /** Credits per 1,000 completion tokens (may be fractional). */
  outputPer1K: z.number().min(0).max(1_000_000),
  /** Upper bound applied to max_tokens / max_completion_tokens. */
  maxOutputTokens: z.number().int().positive().max(10_000_000).optional(),
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;

export const DEFAULT_MODELS: ModelConfig[] = [
  { id: "faam-fast", upstream: "gpt-5-mini", inputPer1K: 1, outputPer1K: 4, maxOutputTokens: 32768 },
  { id: "faam-pro", upstream: "gpt-5", inputPer1K: 5, outputPer1K: 20, maxOutputTokens: 32768 },
];

/**
 * Parse FAAM_AI_MODELS. Unset/empty → DEFAULT_MODELS. Invalid JSON or schema →
 * throws, so a misconfiguration is loud instead of silently billing wrong prices.
 */
export function parseModels(json: string | undefined): ModelConfig[] {
  if (json === undefined || json.trim() === "") return DEFAULT_MODELS;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("FAAM_AI_MODELS is not valid JSON");
  }
  const parsed = z.array(modelConfigSchema).min(1).safeParse(data);
  if (!parsed.success) {
    throw new Error(`FAAM_AI_MODELS is invalid: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  }
  const ids = new Set<string>();
  for (const m of parsed.data) {
    if (ids.has(m.id)) throw new Error(`FAAM_AI_MODELS has a duplicate id: ${m.id}`);
    ids.add(m.id);
  }
  return parsed.data;
}

export function findModel(models: ModelConfig[], id: unknown): ModelConfig | null {
  if (typeof id !== "string") return null;
  return models.find((m) => m.id === id) ?? null;
}

function cap(value: unknown, max: number | undefined): unknown {
  if (max === undefined || typeof value !== "number" || !Number.isFinite(value)) return value;
  return Math.min(value, max);
}

/**
 * Build the body forwarded upstream. Everything (messages, tools, tool_choice,
 * images, response_format, …) passes through untouched except:
 *  - `model` is mapped to the upstream id,
 *  - streaming requests get `stream_options.include_usage = true`,
 *  - max_tokens / max_completion_tokens are capped by `maxOutputTokens`.
 */
export function buildUpstreamBody(body: Record<string, unknown>, model: ModelConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body, model: model.upstream };
  if (body.stream === true) {
    const existing =
      body.stream_options && typeof body.stream_options === "object" && !Array.isArray(body.stream_options)
        ? (body.stream_options as Record<string, unknown>)
        : {};
    out.stream_options = { ...existing, include_usage: true };
  }
  if ("max_tokens" in body) out.max_tokens = cap(body.max_tokens, model.maxOutputTokens);
  if ("max_completion_tokens" in body) {
    out.max_completion_tokens = cap(body.max_completion_tokens, model.maxOutputTokens);
  }
  return out;
}
