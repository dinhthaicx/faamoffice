// Observes an OpenAI-compatible SSE stream (without modifying it) to capture
// the final `usage` object and count generated characters for estimation.

import { readUsage, type TokenUsage } from "./billing";

export class SseUsageTracker {
  usage: TokenUsage | null = null;
  outputChars = 0;
  chunks = 0;
  private decoder = new TextDecoder();
  private line = "";
  private data: string[] = [];

  push(chunk: Uint8Array): void {
    this.chunks += 1;
    this.feed(this.decoder.decode(chunk, { stream: true }));
  }

  end(): void {
    this.feed(this.decoder.decode());
    if (this.line) this.handleLine(this.line);
    this.line = "";
    this.dispatch();
  }

  private feed(text: string): void {
    if (!text) return;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") {
        const piece = this.line + text.slice(start, i);
        this.line = "";
        this.handleLine(piece.endsWith("\r") ? piece.slice(0, -1) : piece);
        start = i + 1;
      }
    }
    this.line += text.slice(start);
    // Guard against a pathological stream without newlines.
    if (this.line.length > 4 * 1024 * 1024) this.line = "";
  }

  private handleLine(line: string): void {
    if (line === "") {
      this.dispatch();
      return;
    }
    if (line.startsWith(":")) return; // comment / keep-alive
    if (line.startsWith("data:")) {
      this.data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
    }
  }

  private dispatch(): void {
    if (this.data.length === 0) return;
    const payload = this.data.join("\n").trim();
    this.data = [];
    if (!payload || payload === "[DONE]") return;
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    this.observe(event);
  }

  private observe(event: unknown): void {
    if (!event || typeof event !== "object") return;
    const e = event as Record<string, unknown>;
    const usage = readUsage(e.usage);
    if (usage) this.usage = usage;
    if (!Array.isArray(e.choices)) return;
    for (const choice of e.choices) {
      const delta = (choice as { delta?: Record<string, unknown> })?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string") this.outputChars += delta.content.length;
      if (typeof delta.reasoning_content === "string") this.outputChars += delta.reasoning_content.length;
      if (typeof delta.reasoning === "string") this.outputChars += delta.reasoning.length;
      if (Array.isArray(delta.tool_calls)) {
        for (const call of delta.tool_calls) {
          const fn = (call as { function?: { name?: unknown; arguments?: unknown } })?.function;
          if (typeof fn?.name === "string") this.outputChars += fn.name.length;
          if (typeof fn?.arguments === "string") this.outputChars += fn.arguments.length;
        }
      }
    }
  }
}
