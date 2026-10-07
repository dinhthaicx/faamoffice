// Public site constants (safe for client bundles: only NEXT_PUBLIC_* values).

const DEFAULT_REPO = "dinhthaicx/faamoffice";

function repo(): string {
  const value = (process.env.NEXT_PUBLIC_GITHUB_REPO || DEFAULT_REPO).trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) ? value : DEFAULT_REPO;
}

export const GITHUB_REPO = repo();
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
export const RELEASES_URL = `${GITHUB_URL}/releases`;
export const LATEST_RELEASE_URL = `${GITHUB_URL}/releases/latest`;
export const SOURCE_BUILD_URL = `${GITHUB_URL}#readme`;
export const LICENSE_URL = "https://www.apache.org/licenses/LICENSE-2.0";

export const AI_PROVIDERS = [
  "OpenAI",
  "Anthropic Claude",
  "Google Gemini",
  "DeepSeek",
  "xAI Grok",
  "Mistral",
  "Groq",
  "OpenRouter",
  "Qwen",
  "Kimi",
  "GLM",
  "MiniMax",
] as const;

export const LOCAL_AI = ["Ollama", "LM Studio", "llama.cpp"] as const;

/** Public marketing pages (path after the locale prefix), used by the sitemap. */
export const PUBLIC_PAGES = ["", "/download", "/faam-ai", "/privacy", "/terms"] as const;

/** Microsoft Store listing; launch=true&mode=full opens the Store app on Windows (Microsoft's badge link format). */
export function msStoreUrl(productId: string): string {
  return `https://apps.microsoft.com/detail/${encodeURIComponent(productId)}?launch=true&mode=full`;
}
