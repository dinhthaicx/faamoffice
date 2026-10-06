import { describe, expect, it } from "vitest";
import {
  completionChars,
  computeCredits,
  ESTIMATED_TOKENS_PER_IMAGE,
  estimatePromptTokens,
  estimateTokensFromChars,
  readUsage,
} from "@/lib/billing";

const fast = { inputPer1K: 1, outputPer1K: 4 };

describe("credit math", () => {
  it("prices prompt and completion tokens per 1K and rounds up", () => {
    // 1200 * 1/1000 + 800 * 4/1000 = 1.2 + 3.2 = 4.4 → 5
    expect(computeCredits(fast, { promptTokens: 1200, completionTokens: 800 })).toBe(5);
    expect(computeCredits(fast, { promptTokens: 1000, completionTokens: 1000 })).toBe(5);
    expect(computeCredits(fast, { promptTokens: 1, completionTokens: 0 })).toBe(1);
  });

  it("does not round up float noise", () => {
    // 0.1 + 0.2 style artifacts must not add a credit.
    expect(computeCredits({ inputPer1K: 0.1, outputPer1K: 0.2 }, { promptTokens: 10_000, completionTokens: 5_000 })).toBe(2);
    expect(computeCredits({ inputPer1K: 0.3, outputPer1K: 0 }, { promptTokens: 10_000, completionTokens: 0 })).toBe(3);
  });

  it("supports fractional prices", () => {
    expect(computeCredits({ inputPer1K: 0.25, outputPer1K: 0.5 }, { promptTokens: 4000, completionTokens: 2000 })).toBe(2);
  });

  it("charges nothing for free models or empty usage, and ignores bad numbers", () => {
    expect(computeCredits({ inputPer1K: 0, outputPer1K: 0 }, { promptTokens: 5000, completionTokens: 5000 })).toBe(0);
    expect(computeCredits(fast, { promptTokens: 0, completionTokens: 0 })).toBe(0);
    expect(computeCredits(fast, { promptTokens: -100, completionTokens: Number.NaN })).toBe(0);
  });

  it("estimates tokens as characters ÷ 4", () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(1)).toBe(1);
    expect(estimateTokensFromChars(400)).toBe(100);
    expect(estimateTokensFromChars(401)).toBe(101);
  });

  it("estimates prompt tokens without billing image bytes", () => {
    const hugeImage = `data:image/png;base64,${"A".repeat(5_000_000)}`;
    const tokens = estimatePromptTokens({
      messages: [
        { role: "system", content: "x".repeat(396) },
        { role: "user", content: [{ type: "text", text: "y".repeat(396) }, { type: "image_url", image_url: { url: hugeImage } }] },
      ],
    });
    expect(tokens).toBe(200 + ESTIMATED_TOKENS_PER_IMAGE);
  });

  it("counts tool definitions and tool calls", () => {
    const withTools = estimatePromptTokens({ messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "a".repeat(100) } }] });
    const without = estimatePromptTokens({ messages: [{ role: "user", content: "hi" }] });
    expect(withTools).toBeGreaterThan(without + 20);
  });

  it("reads usage objects and output length", () => {
    expect(readUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })).toEqual({ promptTokens: 10, completionTokens: 5 });
    expect(readUsage({ prompt_tokens: 10 })).toEqual({ promptTokens: 10, completionTokens: 0 });
    expect(readUsage(null)).toBeNull();
    expect(readUsage({})).toBeNull();
    expect(completionChars({ choices: [{ message: { content: "hello" } }] })).toBe(5);
    expect(completionChars({})).toBe(0);
  });
});
