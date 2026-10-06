import { describe, expect, it } from "vitest";
import { buildUpstreamBody, DEFAULT_MODELS, findModel, parseModels } from "@/lib/ai-models";

const model = { id: "faam-fast", upstream: "gpt-5-mini", inputPer1K: 1, outputPer1K: 4, maxOutputTokens: 32768 };

describe("model catalog", () => {
  it("falls back to defaults when FAAM_AI_MODELS is unset", () => {
    expect(parseModels(undefined)).toBe(DEFAULT_MODELS);
    expect(parseModels("  ")).toBe(DEFAULT_MODELS);
  });

  it("parses a valid catalog", () => {
    const models = parseModels(JSON.stringify([model, { id: "local", upstream: "qwen3", inputPer1K: 0, outputPer1K: 0 }]));
    expect(models).toHaveLength(2);
    expect(models[1].maxOutputTokens).toBeUndefined();
  });

  it("rejects invalid catalogs loudly", () => {
    expect(() => parseModels("not json")).toThrow(/not valid JSON/);
    expect(() => parseModels("[]")).toThrow(/invalid/);
    expect(() => parseModels(JSON.stringify([{ id: "x", upstream: "y", inputPer1K: -1, outputPer1K: 1 }]))).toThrow();
    expect(() => parseModels(JSON.stringify([model, model]))).toThrow(/duplicate/);
  });

  it("maps public ids to models and rejects unknown ones", () => {
    expect(findModel([model], "faam-fast")).toBe(model);
    expect(findModel([model], "gpt-5-mini")).toBeNull();
    expect(findModel([model], undefined)).toBeNull();
    expect(findModel([model], 42)).toBeNull();
  });
});

describe("upstream request body", () => {
  it("maps the model and passes everything else through untouched", () => {
    const body = {
      model: "faam-fast",
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }],
      tools: [{ type: "function", function: { name: "f", parameters: {} } }],
      tool_choice: "auto",
      temperature: 0.2,
      response_format: { type: "json_object" },
    };
    const out = buildUpstreamBody(body, model);
    expect(out).toEqual({ ...body, model: "gpt-5-mini" });
    expect(out).not.toHaveProperty("stream_options");
    expect(body.model).toBe("faam-fast"); // input not mutated
  });

  it("adds include_usage when streaming and keeps other stream options", () => {
    expect(buildUpstreamBody({ model: "faam-fast", stream: true }, model).stream_options).toEqual({ include_usage: true });
    expect(buildUpstreamBody({ model: "faam-fast", stream: true, stream_options: { foo: 1 } }, model).stream_options).toEqual({
      foo: 1,
      include_usage: true,
    });
    expect(buildUpstreamBody({ model: "faam-fast", stream: true, stream_options: { include_usage: false } }, model).stream_options).toEqual({
      include_usage: true,
    });
  });

  it("caps max_tokens and max_completion_tokens", () => {
    const out = buildUpstreamBody({ model: "faam-fast", max_tokens: 1_000_000, max_completion_tokens: 100 }, model);
    expect(out.max_tokens).toBe(32768);
    expect(out.max_completion_tokens).toBe(100);
    expect(buildUpstreamBody({ model: "faam-fast" }, model)).not.toHaveProperty("max_tokens");
    const uncapped = buildUpstreamBody({ model: "faam-fast", max_tokens: 1_000_000 }, { ...model, maxOutputTokens: undefined });
    expect(uncapped.max_tokens).toBe(1_000_000);
  });
});
