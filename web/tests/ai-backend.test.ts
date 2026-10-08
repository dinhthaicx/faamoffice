import { afterEach, describe, expect, it, vi } from "vitest";
import { aiBackendSchema, normalizeLanAiUrl } from "@/lib/ai-backend-shared";
import { checkAiBackend, resolveAiBackend } from "@/lib/ai-backend";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const config = { baseUrl: "http://192.168.1.50:11434/v1", models: [
  { id: "faam-fast", upstream: "fast:ctx65536", reasoningEffort: "none" as const },
  { id: "faam-pro", upstream: "pro:ctx65536" },
] };

describe("LAN AI routing", () => {
  it("normalizes private addresses and rejects public hosts, credentials, query strings and unrelated paths", () => {
    for (const url of ["http://localhost:11434", "http://127.0.0.1:11434/v1/"]) {
      expect(normalizeLanAiUrl(url)).toBe("http://127.0.0.1:11434/v1");
    }
    for (const url of [config.baseUrl, "https://10.0.0.5/v1", "http://172.31.1.5/v1", "http://[::1]:11434/v1", "http://[fd12::1]:11434/v1"]) {
      expect(normalizeLanAiUrl(url)).toBe(url);
    }
    for (const url of ["https://example.com/v1", "http://8.8.8.8/v1", "http://169.254.169.254/v1", "http://172.32.0.1/v1",
      "http://192.168.1.50/admin", "http://secret@192.168.1.50/v1", "http://192.168.1.50/v1?key=secret", "http://192.168.1.50/v1#x",
      "file:///v1", "http://localhost.evil.test/v1", "http://[::ffff:8.8.8.8]/v1", "http://192.168.1.50\\@evil.test/v1"]) {
      expect(normalizeLanAiUrl(url), url).toBeNull();
    }
    expect(aiBackendSchema.safeParse({ ...config, models: [config.models[0], config.models[0]] }).success).toBe(false);
  });

  it("preserves public ids, prices and caps while keeping environment credentials off the new LAN host", () => {
    const ai = { upstreamBaseUrl: "https://provider.test/v1", upstreamApiKey: "private-key", modelsJson: undefined, requestTimeoutMs: 600000 };
    const fallback = resolveAiBackend(null, ai);
    expect(fallback).toMatchObject({ baseUrl: ai.upstreamBaseUrl, apiKey: ai.upstreamApiKey });
    const backend = resolveAiBackend(config, ai);
    expect(backend).toMatchObject({ baseUrl: config.baseUrl, apiKey: null });
    expect(backend.models[0]).toEqual({ ...fallback.models[0], upstream: "fast:ctx65536", reasoningEffort: "none" });
    expect(() => resolveAiBackend({ ...config, models: [config.models[0]] }, ai)).toThrow(/incomplete/);
  });

  it("checks the actual model list, tools and configured context without generating content", async () => {
    vi.stubEnv("FAAM_AI_MODELS", "");
    const fetch = vi.fn(async (url: URL, init: RequestInit) => {
      expect(init.redirect).toBe("error");
      expect(init.headers).not.toHaveProperty("Authorization");
      if (url.pathname === "/v1/models") return Response.json({ data: config.models.map((m) => ({ id: m.upstream })) });
      expect(url.pathname).toBe("/api/show");
      expect(JSON.parse(String(init.body))).toEqual({ model: expect.stringMatching(/:ctx65536$/) });
      return Response.json({ capabilities: ["completion", "tools"], parameters: "num_ctx 65536\n" });
    });
    vi.stubGlobal("fetch", fetch);
    expect(await checkAiBackend(config)).toEqual({ models: config.models.map(({ id, upstream }) => ({ id, upstream, contextTokens: 65536 })) });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["ai_model_missing", { data: [{ id: "other-model" }] }, {}],
    ["ai_tools_required", { data: config.models.map((m) => ({ id: m.upstream })) }, { capabilities: ["completion"], parameters: "num_ctx 65536" }],
    ["ai_context_required", { data: config.models.map((m) => ({ id: m.upstream })) }, { capabilities: ["tools"], parameters: "num_ctx 4096" }],
  ])("rejects unsuitable backends with %s", async (code, list, meta) => {
    vi.stubEnv("FAAM_AI_MODELS", "");
    vi.stubGlobal("fetch", async (url: URL) => Response.json(url.pathname === "/v1/models" ? list : meta));
    await expect(checkAiBackend(config)).rejects.toMatchObject({ code });
  });
});
