// Credit math for Faam AI Cloud requests.

import type { ModelConfig } from "./ai-models";

export type TokenUsage = { promptTokens: number; completionTokens: number };

function toCount(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Credits charged for a request: prompt and completion tokens priced per 1K,
 * summed, then rounded up to a whole credit. A request with zero cost (free
 * model or no tokens) costs 0.
 */
export function computeCredits(model: Pick<ModelConfig, "inputPer1K" | "outputPer1K">, usage: TokenUsage): number {
  const prompt = toCount(usage.promptTokens);
  const completion = toCount(usage.completionTokens);
  const raw = (prompt * model.inputPer1K + completion * model.outputPer1K) / 1000;
  if (raw <= 0) return 0;
  // Subtract a tiny epsilon so float noise (e.g. 2.0000000000000004) does not round up.
  return Math.max(1, Math.ceil(raw - 1e-9));
}

/** Rough token estimate used when the upstream reports no usage: characters ÷ 4. */
export function estimateTokensFromChars(chars: number): number {
  return chars > 0 ? Math.ceil(chars / 4) : 0;
}

/** Token estimate for one image part (independent of the data URL size). */
export const ESTIMATED_TOKENS_PER_IMAGE = 765;

function textLength(value: unknown): { chars: number; images: number } {
  if (typeof value === "string") return { chars: value.length, images: 0 };
  if (Array.isArray(value)) {
    let chars = 0;
    let images = 0;
    for (const part of value) {
      if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (p.type === "image_url" || p.type === "input_image" || p.type === "image") {
          images += 1;
        } else if (typeof p.text === "string") {
          chars += p.text.length;
        } else if (typeof p.content === "string") {
          chars += p.content.length;
        }
      } else if (typeof part === "string") {
        chars += part.length;
      }
    }
    return { chars, images };
  }
  return { chars: 0, images: 0 };
}

/**
 * Estimate prompt tokens of an OpenAI chat request: message text, tool calls
 * and tool definitions count by characters; images count a fixed amount (so a
 * multi-megabyte data URL is not billed as millions of tokens).
 */
export function estimatePromptTokens(body: Record<string, unknown>): number {
  let chars = 0;
  let images = 0;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    const t = textLength(m.content);
    chars += t.chars + 4; // role/formatting overhead
    images += t.images;
    if (Array.isArray(m.tool_calls)) chars += JSON.stringify(m.tool_calls).length;
  }
  if (Array.isArray(body.tools)) chars += JSON.stringify(body.tools).length;
  return estimateTokensFromChars(chars) + images * ESTIMATED_TOKENS_PER_IMAGE;
}

/** Characters of generated output in a non-streaming chat completion response. */
export function completionChars(response: unknown): number {
  if (!response || typeof response !== "object") return 0;
  const choices = (response as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return 0;
  let chars = 0;
  for (const choice of choices) {
    const message = (choice as { message?: Record<string, unknown> })?.message;
    if (!message) continue;
    if (typeof message.content === "string") chars += message.content.length;
    if (typeof message.reasoning_content === "string") chars += message.reasoning_content.length;
    if (Array.isArray(message.tool_calls)) chars += JSON.stringify(message.tool_calls).length;
  }
  return chars;
}

/** Extract OpenAI-style usage, or null when absent/invalid. */
export function readUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const u = value as Record<string, unknown>;
  if (typeof u.prompt_tokens !== "number" && typeof u.completion_tokens !== "number") return null;
  return { promptTokens: toCount(u.prompt_tokens), completionTokens: toCount(u.completion_tokens) };
}
