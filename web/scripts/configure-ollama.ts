// Configure dedicated Ollama aliases for Faam AI Cloud. The OpenAI-compatible
// API ignores num_ctx in requests: context must be baked into the model.
import { chmodSync, copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseModels } from "../src/lib/ai-models";

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const file = join(root, ".env");
  process.loadEnvFile(file);
  const upstream = new URL(process.env.FAAM_AI_UPSTREAM_BASE_URL || "http://localhost:11434/v1");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(upstream.hostname) || !["http:", "https:"].includes(upstream.protocol)
      || upstream.username || upstream.password || !/^\/v1\/?$/.test(upstream.pathname)) {
    throw new Error("This setup command only configures a local Ollama /v1 endpoint.");
  }
  const contextArg = process.argv.find((arg) => arg.startsWith("--context="));
  const context = contextArg ? Number(contextArg.split("=")[1]) : 65536;
  if (!Number.isInteger(context) || context < 16384 || context > 262144) throw new Error("Use --context=16384 through --context=262144; default 65536.");
  if (!process.env.FAAM_AI_MODELS?.trim()) throw new Error("Set FAAM_AI_MODELS to your installed local models first.");
  const models = parseModels(process.env.FAAM_AI_MODELS);
  const targets = ["faam-fast", "faam-pro"];
  if (targets.some((id) => !models.some((model) => model.id === id))) throw new Error("The catalog must contain faam-fast and faam-pro.");
  const source = readFileSync(file, "utf8");
  const assignment = /^(?:export\s+)?FAAM_AI_MODELS\s*=.*$/m;
  if (!assignment.test(source)) throw new Error("Expected a single-line FAAM_AI_MODELS assignment in web/.env.");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.FAAM_AI_UPSTREAM_API_KEY) headers.Authorization = `Bearer ${process.env.FAAM_AI_UPSTREAM_API_KEY}`;
  const post = async (path: string, body: unknown) => {
    const response = await fetch(new URL(path, upstream.origin), {
      method: "POST", headers, redirect: "error", body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Ollama ${path} returned HTTP ${response.status}; the website configuration has not changed.`);
    return response.json();
  };
  const next = models.map((model) => ({ ...model }));
  for (const model of next.filter((model) => targets.includes(model.id))) {
    const alias = `faamoffice-${model.id.slice(5)}:ctx${context}`;
    if (model.upstream !== alias) {
      await post("/api/create", { model: alias, from: model.upstream, parameters: { num_ctx: context }, stream: false });
    }
    const metadata = await post("/api/show", { model: alias });
    const configured = /^num_ctx\s+(\d+)\s*$/m.exec(metadata.parameters ?? "");
    if (Number(configured?.[1]) !== context) throw new Error(`Ollama did not confirm ${context} context tokens for ${alias}; web/.env is unchanged.`);
    model.upstream = alias;
    console.log(JSON.stringify({ id: model.id, upstream: alias, contextTokens: context }));
  }
  if (!process.argv.includes("--apply")) {
    console.log("Aliases are ready. Run again with --apply to update web/.env, then restart the website process.");
    return;
  }
  const serialized = JSON.stringify(next);
  if (serialized.includes("'")) throw new Error("The catalog contains a single quote; edit FAAM_AI_MODELS manually. web/.env is unchanged.");
  const updated = source.replace(assignment, () => `FAAM_AI_MODELS='${serialized}'`);
  if (source !== updated) {
    const backups = join(root, "data", "backups");
    mkdirSync(backups, { recursive: true });
    const backup = join(backups, `ollama-env-${Date.now()}.backup`);
    copyFileSync(file, backup);
    chmodSync(backup, 0o600);
    const temporary = `${file}.ollama-${process.pid}`;
    writeFileSync(temporary, updated, { mode: 0o600 });
    renameSync(temporary, file);
    console.log("Updated FAAM_AI_MODELS only; a private environment backup is in web/data/backups. Restart the website to activate it.");
  } else {
    console.log("The model catalog already uses these aliases. Restart the website if it has not reloaded the configuration yet.");
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
