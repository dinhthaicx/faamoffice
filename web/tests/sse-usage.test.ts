import { describe, expect, it } from "vitest";
import { SseUsageTracker } from "@/lib/sse-usage";

const enc = new TextEncoder();
const event = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

describe("SSE usage tracker", () => {
  it("captures the final usage chunk and counts output characters", () => {
    const t = new SseUsageTracker();
    t.push(enc.encode(event({ choices: [{ delta: { role: "assistant", content: "" } }] })));
    t.push(enc.encode(event({ choices: [{ delta: { content: "Hello" } }] })));
    t.push(enc.encode(event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "fn", arguments: '{"a":1}' } }] } }] })));
    t.push(enc.encode(event({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } })));
    t.push(enc.encode("data: [DONE]\n\n"));
    t.end();
    expect(t.usage).toEqual({ promptTokens: 12, completionTokens: 7 });
    expect(t.outputChars).toBe(5 + 2 + 7);
  });

  it("handles events split across chunks, CRLF, comments and multi-byte characters", () => {
    const t = new SseUsageTracker();
    const text = `: keep-alive\r\n\r\n${event({ choices: [{ delta: { content: "Xin chào 👋" } }] })}${event({ usage: { prompt_tokens: 3, completion_tokens: 4 } })}`;
    const bytes = enc.encode(text.replace(/\n\n/g, "\r\n\r\n"));
    for (let i = 0; i < bytes.length; i += 3) t.push(bytes.slice(i, i + 3));
    t.end();
    expect(t.usage).toEqual({ promptTokens: 3, completionTokens: 4 });
    expect(t.outputChars).toBe("Xin chào 👋".length);
  });

  it("ignores malformed events and works without usage", () => {
    const t = new SseUsageTracker();
    t.push(enc.encode("data: {not json\n\n"));
    t.push(enc.encode(event({ choices: [{ delta: { reasoning_content: "think" } }] })));
    t.end();
    expect(t.usage).toBeNull();
    expect(t.outputChars).toBe(5);
    expect(t.chunks).toBe(2);
  });

  it("flushes a final event without a trailing blank line", () => {
    const t = new SseUsageTracker();
    t.push(enc.encode(`data: ${JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 2 } })}`));
    t.end();
    expect(t.usage).toEqual({ promptTokens: 1, completionTokens: 2 });
  });
});
