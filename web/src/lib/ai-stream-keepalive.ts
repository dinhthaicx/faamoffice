// Local models can take longer than the desktop's 60-second connect timeout
// to evaluate a document prompt. Send SSE comments while waiting for headers.
// Stop comments before relaying bytes: an upstream chunk can end mid-SSE-line.

export const AI_STREAM_HEADERS_WAIT_MS = 1_000;
export const AI_STREAM_HEARTBEAT_MS = 15_000;
const encoder = new TextEncoder();
const heartbeat = encoder.encode(": faam-ai keepalive\n\n");

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** An upstream may ignore stream:true. Convert its final JSON after headers were sent. */
function jsonEvent(value: unknown, ok: boolean): Record<string, unknown> {
  const body = object(value);
  if (body.error) return { error: body.error };
  if (!ok || !Array.isArray(body.choices)) {
    return { error: { message: "The Faam AI upstream response was interrupted or invalid.", type: "upstream_error" } };
  }
  const choices = body.choices.map((value, index) => {
    const choice = object(value);
    const message = object(choice.message);
    const delta = { ...message };
    if (Array.isArray(message.tool_calls)) {
      delta.tool_calls = message.tool_calls.map((call, index) => ({ ...object(call), index }));
    }
    return {
      index: choice.index ?? index,
      delta,
      finish_reason: choice.finish_reason ?? (Array.isArray(message.tool_calls) && message.tool_calls.length ? "tool_calls" : "stop"),
    };
  });
  return { ...body, choices };
}

export async function streamWhileConnecting(response: Promise<Response>, abort: () => void): Promise<Response> {
  const waiting = Symbol("waiting");
  let headerTimer: ReturnType<typeof setTimeout> | undefined;
  const first = await Promise.race([
    response,
    new Promise<typeof waiting>((resolve) => { headerTimer = setTimeout(() => resolve(waiting), AI_STREAM_HEADERS_WAIT_MS); }),
  ]).finally(() => clearTimeout(headerTimer));
  // Preserve HTTP errors and JSON fallback responses when the upstream is ready quickly.
  if (first !== waiting) return first;

  let keepalive: ReturnType<typeof setInterval> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancelled = false;
  const stopHeartbeat = () => clearInterval(keepalive);
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(heartbeat);
      keepalive = setInterval(() => {
        if (!cancelled && (ctrl.desiredSize ?? 0) > 0) ctrl.enqueue(heartbeat);
      }, AI_STREAM_HEARTBEAT_MS);
    },
    async pull(ctrl) {
      try {
        if (!reader) {
          const source = await response;
          stopHeartbeat();
          if (cancelled) { await source.body?.cancel().catch(() => {}); return; }
          if (source.ok && source.headers.get("content-type")?.includes("text/event-stream") && source.body) {
            reader = source.body.getReader();
          } else {
            let body: unknown = null;
            try { body = await source.json(); } catch { /* report a generic error without echoing the body */ }
            if (cancelled) return;
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(jsonEvent(body, source.ok))}\n\ndata: [DONE]\n\n`));
            ctrl.close();
            return;
          }
        }
        const chunk = await reader.read();
        if (cancelled) return;
        if (chunk.done) ctrl.close();
        else ctrl.enqueue(chunk.value);
      } catch (error) {
        stopHeartbeat();
        abort();
        if (!cancelled) ctrl.error(error);
      }
    },
    async cancel() {
      cancelled = true;
      stopHeartbeat();
      abort();
      if (reader) await reader.cancel().catch(() => {});
      else void response.then((source) => source.body?.cancel().catch(() => {})).catch(() => {});
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
