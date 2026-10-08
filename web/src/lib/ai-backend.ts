// Server-only runtime routing; LAN addresses are never sent to the desktop app.
import { aiBackendSchema, type AiBackendSettings, type AiBackendCheck } from "./ai-backend-shared";
import { parseModels, type ModelConfig } from "./ai-models";
import { getConfig, type ServerConfig } from "./env";
import { HttpError } from "./http";

export function resolveAiBackend(override: AiBackendSettings | null, ai: ServerConfig["ai"] = getConfig().ai): {
  baseUrl: string | null; apiKey: string | null; models: ModelConfig[];
} {
  const catalog = parseModels(ai.modelsJson);
  if (!override) return { baseUrl: ai.upstreamBaseUrl, apiKey: ai.upstreamApiKey, models: catalog };
  const models = catalog.map((model) => {
    const route = override.models.find((m) => m.id === model.id);
    if (!route) throw new Error("AI backend model mapping is incomplete");
    // Preserve public ids, pricing and output caps; thinking belongs to the selected backend model.
    return { ...model, upstream: route.upstream, reasoningEffort: route.reasoningEffort };
  });
  // Never forward an environment provider's credentials to a different LAN host.
  return { baseUrl: override.baseUrl, apiKey: null, models };
}

export function environmentAiBackend(): AiBackendSettings {
  const { ai } = getConfig();
  return {
    baseUrl: ai.upstreamBaseUrl ?? "http://127.0.0.1:11434/v1",
    models: parseModels(ai.modelsJson).map(({ id, upstream, reasoningEffort }) => ({ id, upstream, reasoningEffort })),
  };
}

export function parseAiBackend(data: unknown): AiBackendSettings {
  const parsed = aiBackendSchema.safeParse(data);
  if (!parsed.success) throw new HttpError(400, "invalid_request", "Invalid LAN AI settings.");
  return parsed.data;
}

/** Metadata only: no prompts, documents, generation, or remote model changes. */
export async function checkAiBackend(config: AiBackendSettings, signal?: AbortSignal): Promise<AiBackendCheck> {
  const expected = parseModels(getConfig().ai.modelsJson).map((m) => m.id).sort();
  if (JSON.stringify(config.models.map((m) => m.id).sort()) !== JSON.stringify(expected)) {
    throw new HttpError(400, "ai_model_mapping", "Map every configured Faam AI model.");
  }
  const timeout = AbortSignal.timeout(10_000);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const read = async (path: string, body?: unknown): Promise<Record<string, unknown>> => {
    let response: Response;
    try {
      response = await fetch(new URL(path, config.baseUrl), {
        method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store", signal: abort,
        headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new HttpError(502, "ai_connection_failed", "Could not reach the LAN Ollama server within 10 seconds.");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new HttpError(502, "ai_connection_failed", "The LAN Ollama API did not return a successful response.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new HttpError(502, "ai_connection_failed", "Empty Ollama response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) throw new Error("Response too large");
        chunks.push(value);
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid response");
      return value as Record<string, unknown>;
    } catch {
      await reader.cancel().catch(() => {});
      throw new HttpError(502, "ai_connection_failed", "Invalid Ollama response.");
    } finally {
      reader.releaseLock();
    }
  };
  const list = await read("/v1/models");
  if (!Array.isArray(list.data)) throw new HttpError(502, "ai_connection_failed", "Invalid model list.");
  const names = new Set(list.data.flatMap((m) => m && typeof m === "object" && typeof m.id === "string" ? [m.id] : []));
  const checked = new Map<string, number>();
  const models: AiBackendCheck["models"] = [];
  for (const model of config.models) {
    if (!names.has(model.upstream)) throw new HttpError(400, "ai_model_missing", "A selected model is not installed on that Ollama server.");
    let context = checked.get(model.upstream);
    if (context === undefined) {
      const meta = await read("/api/show", { model: model.upstream });
      if (!Array.isArray(meta.capabilities) || !meta.capabilities.includes("tools")) {
        throw new HttpError(400, "ai_tools_required", "The model must support tool calling to edit documents.");
      }
      context = Number(/^num_ctx\s+(\d+)\s*$/m.exec(typeof meta.parameters === "string" ? meta.parameters : "")?.[1] ?? 0);
      if (context < 65536) throw new HttpError(400, "ai_context_required", "Configure an Ollama alias with num_ctx 65536 before switching the document AI backend.");
      checked.set(model.upstream, context);
    }
    models.push({ id: model.id, upstream: model.upstream, contextTokens: context });
  }
  return { models };
}
