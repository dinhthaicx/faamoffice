// Faam AI Cloud: OpenAI-compatible chat completions proxy.
//
// Credits on (default): each request is billed in credits and refused (402)
// once the balance is used up. Credits off (admin Settings): signing in is
// enough; requests are recorded with 0 credits and limited per day by the
// optional daily request quota. A per-user rate limit applies in both modes.

import { z } from "zod";
import { aiRequestsInFlight, countRequestsToday, quotaResetsAt, secondsUntilReset, trackAiRequest } from "./ai-quota";
import { authenticateBearer } from "./api-token";
import { buildUpstreamBody, findModel, parseModels, type ModelConfig } from "./ai-models";
import {
  completionChars,
  computeCredits,
  estimatePromptTokens,
  estimateTokensFromChars,
  readUsage,
  type TokenUsage,
} from "./billing";
import { recordAiUsage, recordUnbilledAiUsage } from "./credits";
import { getConfig } from "./env";
import { HttpError, jsonError, readJson } from "./http";
import { limiters } from "./rate-limit";
import { getSiteSettings } from "./site-settings";
import { SseUsageTracker } from "./sse-usage";

export const AI_MAX_BODY_BYTES = 20 * 1024 * 1024;
const UPSTREAM_ERROR_BODY_LIMIT = 64 * 1024;

const chatRequestSchema = z.looseObject({
  model: z.string().min(1).max(200),
  messages: z.array(z.unknown()).min(1),
  stream: z.boolean().optional(),
});

/** OpenAI-style error body: { error: { message, type, code } }. */
export function openAiError(status: number, message: string, type: string, code?: string): Response {
  return Response.json(
    { error: { message, type, ...(code ? { code } : {}) } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function notConfigured(): Response {
  return openAiError(503, "Faam AI Cloud is not configured on this server", "unavailable");
}

export function insufficientCredits(): Response {
  return openAiError(
    402,
    "Your Faam AI credits are insufficient. Ask an administrator to add credits.",
    "insufficient_credits",
    "insufficient_credits",
  );
}

/** Per-user burst limit (429 rate_limited); the app treats it as "busy, retry later". */
export function aiRateLimited(retryAfter: number): Response {
  const res = openAiError(429, "Too many Faam AI requests. Please slow down and try again shortly.", "rate_limited", "rate_limited");
  res.headers.set("Retry-After", String(Math.max(1, retryAfter)));
  return res;
}

/** Daily quota used up (credits off): 429 daily_limit_reached until the next local midnight. */
export function dailyLimitReached(limit: number, now: Date): Response {
  const res = openAiError(
    429,
    `You have used all ${limit} Faam AI requests for today. The quota resets at ${quotaResetsAt(now).toISOString()} (midnight, UTC+7).`,
    "daily_limit_reached",
    "daily_limit_reached",
  );
  res.headers.set("Retry-After", String(secondsUntilReset(now)));
  return res;
}

let modelsCache: { json: string | undefined; models: ModelConfig[] } | null = null;

/** Configured models, or null when Faam AI Cloud is not configured (or misconfigured). */
export function configuredModels(): ModelConfig[] | null {
  const { ai } = getConfig();
  if (!ai.upstreamBaseUrl) return null;
  if (modelsCache && modelsCache.json === ai.modelsJson) return modelsCache.models;
  try {
    const models = parseModels(ai.modelsJson);
    modelsCache = { json: ai.modelsJson, models };
    return models;
  } catch (err) {
    console.error("[faam-ai]", (err as Error).message);
    return null;
  }
}

async function readLimitedText(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Translate an upstream failure into a response for the desktop app. */
async function upstreamFailure(res: Response): Promise<Response> {
  const text = await readLimitedText(res, UPSTREAM_ERROR_BODY_LIMIT).catch(() => "");
  if (res.status === 401 || res.status === 403) {
    console.error(`[faam-ai] upstream rejected the server credentials (${res.status}): ${text.slice(0, 500)}`);
    return openAiError(502, "The Faam AI upstream rejected this server's credentials.", "upstream_error");
  }
  if ([400, 404, 409, 413, 422, 429].includes(res.status)) {
    // Client-side problems (bad request, context too long, rate limit): pass through.
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON
    }
    if (body && typeof body === "object") {
      const headers: Record<string, string> = { "Cache-Control": "no-store" };
      const retryAfter = res.headers.get("retry-after");
      if (retryAfter) headers["Retry-After"] = retryAfter;
      return Response.json(body, { status: res.status, headers });
    }
    return openAiError(res.status, text.slice(0, 1000) || `Upstream returned ${res.status}`, "upstream_error");
  }
  console.error(`[faam-ai] upstream error ${res.status}: ${text.slice(0, 500)}`);
  return openAiError(502, "The Faam AI upstream service failed. Please try again.", "upstream_error");
}

export async function handleChatCompletions(req: Request): Promise<Response> {
  let auth: Awaited<ReturnType<typeof authenticateBearer>>;
  try {
    auth = await authenticateBearer(req);
  } catch (err) {
    if (err instanceof HttpError) return jsonError(err.status, err.code, err.message, err.extra, err.headers);
    throw err;
  }
  const { user, token } = auth;
  const burst = limiters().aiUser.check(`ai|${user.id}`);
  if (!burst.ok) return aiRateLimited(burst.retryAfter);
  const cfg = getConfig();
  const models = configuredModels();
  if (!models || !cfg.ai.upstreamBaseUrl) return notConfigured();

  let body: z.infer<typeof chatRequestSchema>;
  try {
    const parsed = chatRequestSchema.safeParse(await readJson(req, AI_MAX_BODY_BYTES));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return jsonError(400, "invalid_request", `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`);
    }
    body = parsed.data;
  } catch (err) {
    if (err instanceof HttpError) return jsonError(err.status, err.code, err.message);
    throw err;
  }

  const model = findModel(models, body.model);
  if (!model) {
    return jsonError(400, "model_not_found", `Unknown model "${String(body.model).slice(0, 100)}". Call /api/v1/ai/models for the list.`);
  }
  const upstreamBody = buildUpstreamBody(body, model);
  const wantsStream = body.stream === true;

  // Read once: a request keeps the mode it started with, even if an admin flips it meanwhile.
  const settings = await getSiteSettings();
  const charge = settings.creditsEnabled;
  if (charge) {
    if (user.credits <= 0) return insufficientCredits();
  } else if (settings.aiDailyRequestLimit > 0) {
    const now = new Date();
    // Running requests count too: they are only recorded once they finish.
    const used = (await countRequestsToday(user.id, now)) + aiRequestsInFlight(user.id);
    if (used >= settings.aiDailyRequestLimit) return dailyLimitReached(settings.aiDailyRequestLimit, now);
  }
  // No await between the check and this, so concurrent requests see each other.
  // Every exit below releases it, after recording the usage when there is any.
  const release = trackAiRequest(user.id);

  // Abort the upstream call when the desktop app disconnects or on timeout.
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, cfg.ai.requestTimeoutMs);
  const cleanup = () => {
    clearTimeout(timer);
    req.signal.removeEventListener("abort", abort);
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: wantsStream ? "text/event-stream" : "application/json",
    "HTTP-Referer": cfg.siteUrl,
    "X-Title": "FaamOffice",
  };
  if (cfg.ai.upstreamApiKey) headers.Authorization = `Bearer ${cfg.ai.upstreamApiKey}`;

  let upstream: Response;
  try {
    upstream = await fetch(`${cfg.ai.upstreamBaseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    cleanup();
    release();
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[faam-ai] upstream request failed", (err as Error)?.message);
    return openAiError(502, "Could not reach the Faam AI upstream service.", "upstream_error");
  }
  if (!upstream.ok) {
    cleanup();
    release();
    return upstreamFailure(upstream);
  }

  let billed = false;
  const bill = async (usage: TokenUsage | null, estimate: () => TokenUsage) => {
    if (billed) return;
    billed = true;
    const final = usage ?? estimate();
    const record = {
      userId: user.id,
      tokenId: token.id,
      model: model.id,
      promptTokens: final.promptTokens,
      completionTokens: final.completionTokens,
      estimated: usage === null,
    };
    try {
      if (charge) await recordAiUsage({ ...record, credits: computeCredits(model, final) });
      else await recordUnbilledAiUsage(record);
    } catch (err) {
      console.error("[faam-ai] failed to record usage", err);
    } finally {
      release();
    }
  };

  const contentType = upstream.headers.get("content-type") ?? "";
  if (wantsStream && contentType.includes("text/event-stream") && upstream.body) {
    const tracker = new SseUsageTracker();
    const reader = upstream.body.getReader();
    const estimate = () => ({
      promptTokens: estimatePromptTokens(body),
      completionTokens: estimateTokensFromChars(tracker.outputChars),
    });
    const stream = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            tracker.end();
            ctrl.close();
            cleanup();
            await bill(tracker.usage, estimate);
            return;
          }
          tracker.push(value);
          ctrl.enqueue(value);
        } catch (err) {
          cleanup();
          // Upstream aborted (client gone / timeout) or broke mid-stream: bill what was produced.
          if (tracker.chunks > 0 || tracker.usage) await bill(tracker.usage, estimate);
          release();
          try {
            ctrl.error(err);
          } catch {
            // stream already closed
          }
        }
      },
      async cancel() {
        controller.abort();
        cleanup();
        await reader.cancel().catch(() => {});
        if (tracker.chunks > 0 || tracker.usage) await bill(tracker.usage, estimate);
        release();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // Non-streaming (or an upstream that ignored stream: true).
  let text: string;
  try {
    text = await upstream.text();
  } catch (err) {
    cleanup();
    release();
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[faam-ai] failed to read upstream response", (err as Error)?.message);
    return openAiError(502, "The Faam AI upstream response was interrupted.", "upstream_error");
  }
  cleanup();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON success body: still bill by estimate below.
  }
  await bill(readUsage((parsed as { usage?: unknown } | null)?.usage), () => ({
    promptTokens: estimatePromptTokens(body),
    completionTokens: estimateTokensFromChars(parsed ? completionChars(parsed) : text.length),
  }));
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": contentType || "application/json", "Cache-Control": "no-store" },
  });
}
