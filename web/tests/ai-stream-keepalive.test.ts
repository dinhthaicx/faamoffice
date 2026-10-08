import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_STREAM_HEADERS_WAIT_MS, AI_STREAM_HEARTBEAT_MS, streamWhileConnecting } from "@/lib/ai-stream-keepalive";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
async function waitingStream(abort = vi.fn()) {
  const pending = pendingResponse();
  const connecting = streamWhileConnecting(pending.promise, abort);
  await vi.advanceTimersByTimeAsync(AI_STREAM_HEADERS_WAIT_MS);
  const response = await connecting;
  const reader = response.body!.getReader();
  expect(decoder.decode((await reader.read()).value)).toMatch(/^: faam-ai keepalive\n\n$/);
  return { pending, response, reader, abort };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Faam AI slow upstream connection", () => {
  it("sends heartbeats even when upstream headers are immediate but its first token is delayed", async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const upstream = new Response(new ReadableStream<Uint8Array>({ start(ctrl) { source = ctrl; } }), { headers: { "Content-Type": "text/event-stream" } });
    const response = await streamWhileConnecting(Promise.resolve(upstream), vi.fn());
    const reader = response.body!.getReader();
    expect(decoder.decode((await reader.read()).value)).toMatch(/^: faam-ai keepalive/);
    const next = reader.read();
    await vi.advanceTimersByTimeAsync(AI_STREAM_HEARTBEAT_MS);
    expect(decoder.decode((await next).value)).toMatch(/^:/);
    source.enqueue(encoder.encode("data: [DONE]\n\n"));
    source.close();
    expect(decoder.decode((await reader.read()).value)).toBe("data: [DONE]\n\n");
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the connection alive before headers and relays native tools and usage unchanged", async () => {
    const { pending, reader } = await waitingStream();
    const waiting = reader.read();
    await vi.advanceTimersByTimeAsync(AI_STREAM_HEARTBEAT_MS);
    expect(decoder.decode((await waiting).value)).toMatch(/^:/);
    const payload = `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_test", function: { name: "insert_content", arguments: '{"html":"<p>Xin chào</p>"}' } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 35000, completion_tokens: 50 } })}\n\ndata: [DONE]\n\n`;
    pending.resolve(new Response(payload, { headers: { "Content-Type": "text/event-stream" } }));
    expect(decoder.decode((await reader.read()).value)).toBe(payload);
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never inserts a heartbeat inside an upstream SSE event split across chunks", async () => {
    const { pending, reader } = await waitingStream();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(ctrl) { source = ctrl; } });
    const first = 'data: {"choices":[{"delta":{"content":"Xin';
    const second = ' chào"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    source.enqueue(encoder.encode(first));
    pending.resolve(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));
    expect(decoder.decode((await reader.read()).value)).toBe(first);
    let readFinished = false;
    const next = reader.read().then((chunk) => { readFinished = true; return chunk; });
    await vi.advanceTimersByTimeAsync(AI_STREAM_HEARTBEAT_MS * 2);
    expect(readFinished).toBe(false);
    source.enqueue(encoder.encode(second));
    source.close();
    expect(decoder.decode((await next).value)).toBe(second);
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts pending work and cancels the eventual body when the app disconnects", async () => {
    const { pending, reader, abort } = await waitingStream();
    await reader.cancel();
    expect(abort).toHaveBeenCalledOnce();
    const cancel = vi.fn();
    pending.resolve(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("delivers delayed upstream failures as an OpenAI SSE error and closes", async () => {
    const { pending, reader } = await waitingStream();
    pending.resolve(Response.json({ error: { message: "Upstream unavailable", type: "upstream_error" } }, { status: 502 }));
    const result = decoder.decode((await reader.read()).value);
    expect(result).toContain('"error":{"message":"Upstream unavailable"');
    expect(result).toContain("data: [DONE]");
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("converts delayed JSON completions into streamed native tools with indexes", async () => {
    const { pending, reader } = await waitingStream();
    pending.resolve(Response.json({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_json", type: "function", function: { name: "insert_content", arguments: '{"html":"<p>Test</p>"}' } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1234, completion_tokens: 42 } }));
    const event = decoder.decode((await reader.read()).value).split("\n\n")[0].slice(6);
    const body = JSON.parse(event);
    expect(body.choices[0].delta.tool_calls[0]).toMatchObject({ id: "call_json", index: 0, function: { name: "insert_content" } });
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(body.usage).toEqual({ prompt_tokens: 1234, completion_tokens: 42 });
    expect((await reader.read()).done).toBe(true);
  });

  it("preserves immediate HTTP failures and JSON completions", async () => {
    for (const source of [Response.json({ error: "busy" }, { status: 429 }), Response.json({ choices: [] })]) {
      expect(await streamWhileConnecting(Promise.resolve(source), vi.fn())).toBe(source);
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});
