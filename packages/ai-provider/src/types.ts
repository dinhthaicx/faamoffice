import type { AgentMessage, AgentToolCall, AgentToolDef } from '@genoffice/agent-core'

export type AiProviderId =
  | 'faamcloud'
  | 'codex'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'openai'
  | 'kimi'
  | 'glm'
  | 'qwen'
  | 'doubao'
  | 'mimo'
  | 'hunyuan'
  | 'ling'
  | 'spark'
  | 'longcat'
  | 'minimax'
  | 'xai'
  | 'mistral'
  | 'openrouter'
  | 'requesty'
  | 'opper'
  | 'cheaperinference'
  | 'opencode-zen'
  | 'opencode-go'
  | 'groq'
  | 'ollama'
  | 'lmstudio'
  | 'llamacpp'
  | 'custom'

export interface AiProviderConfig {
  apiKey: string
  model: string
  /** required for custom; for other direct providers it overrides the default endpoint (regional mirrors) */
  baseUrl?: string | undefined
  /** optional Codex CLI override; empty means auto-detect the current authenticated install */
  cliPath?: string | undefined
}

/** Live picker data returned by Codex app-server's model/list method. */
export interface CodexModelCatalog {
  models: string[]
  defaultModel: string
}

export interface AiProviderMeta {
  id: AiProviderId
  label: string
  models: string[]
  defaultModel: string
  keyPlaceholder: string
  needsBaseUrl?: boolean
  needsCliPath?: boolean
  /**
   * A server on this machine or the LAN (Ollama, LM Studio, llama.cpp): the
   * key is optional, the base URL defaults to the usual local port, and the
   * model list is read live from the server's GET /models.
   */
  local?: boolean
  /** the model list is read live from GET /models instead of the static `models` */
  liveModels?: boolean
  /**
   * Faam AI Cloud: the key and base URL come from the signed-in FaamOffice
   * account (the main process injects them per request), never from Settings
   */
  account?: boolean
}

/** Image generation / media analysis backends (separate from the chat provider) */
export type AiMediaProviderId =
  'openai' | 'gemini' | 'doubao' | 'glm' | 'xai' | 'qwen' | 'minimax' | 'deepseek' | 'custom'

/** wire shape of the image endpoint */
export type AiImageProtocol = 'openai-images' | 'gemini' | 'dashscope' | 'minimax'
/** wire shape of the understanding endpoint */
export type AiAnalysisProtocol = 'openai-chat' | 'gemini'

export interface AiMediaProviderConfig {
  apiKey: string
  /** required for custom; for the others it overrides the official endpoint (regional mirrors) */
  baseUrl?: string | undefined
  /** image generation model (empty = the provider default) */
  imageModel: string
  /** image/video understanding model (empty = the provider default) */
  analysisModel: string
}

export interface AiMediaProviderMeta {
  id: AiMediaProviderId
  label: string
  /** one-line English blurb shown on the provider card */
  description: string
  keyPlaceholder: string
  needsBaseUrl?: boolean
  /** '' for custom (user-supplied) */
  defaultBaseUrl: string
  /** absent = the provider does not generate images */
  imageProtocol?: AiImageProtocol
  imageModels: string[]
  defaultImageModel: string
  /** absent = the provider does not analyze media */
  analysisProtocol?: AiAnalysisProtocol
  analysisModels: string[]
  defaultAnalysisModel: string
  /** the analysis model accepts video input (Gemini natively; OpenAI-compatible vendors via a video_url part) */
  videoAnalysis: boolean
}

export interface AiMediaSettings {
  /** provider behind generate_image */
  imageProvider: AiMediaProviderId
  /** provider behind analyze_media for images */
  analysisProvider: AiMediaProviderId
  /** provider behind analyze_media when the input has video/audio (only video-capable vendors qualify) */
  videoAnalysisProvider: AiMediaProviderId
  providers: Record<AiMediaProviderId, AiMediaProviderConfig>
  /** pre-catalog shape (one provider for both); migrated by resolveAiMediaSettings */
  provider?: AiMediaProviderId | undefined
}

/**
 * web/image search backends; 'auto' is the free chain (Parallel's keyless
 * Search MCP, then DuckDuckGo) and needs no key; Parallel also takes a user key
 */
export type AiSearchProviderId =
  'auto' | 'serper' | 'serply' | 'tavily' | 'parallel' | 'exa' | 'firecrawl'

export interface AiSearchProviderMeta {
  id: AiSearchProviderId
  label: string
  keyPlaceholder: string
  /** the backend also serves image search (otherwise image search falls back to free sources) */
  imageSearch: boolean
}

export interface AiSearchSettings {
  provider: AiSearchProviderId
  providers: Record<Exclude<AiSearchProviderId, 'auto'>, { apiKey: string }>
}

export interface AiSettings {
  provider: AiProviderId
  providers: Record<AiProviderId, AiProviderConfig>
  /**
   * Provider for generate_image / analyze_media. Absent (pre-media settings
   * files) means no media provider: the media tools stay unavailable.
   */
  media?: AiMediaSettings | undefined
  /** web/image search backend; absent means 'auto' (the free chain) */
  search?: AiSearchSettings | undefined
  /**
   * Output-token cap for ONE model turn of agent runs (default
   * DEFAULT_MAX_OUTPUT_TOKENS). Reasoning models bill their thinking against
   * this same budget, so a heavy edit turn can consume all of it and close with
   * finish_reason=length and no prose at all — raising it is the user's lever
   * (absent = the default, so pre-existing settings files keep working).
   */
  maxOutputTokens?: number | undefined
}

/** pre-provider settings shape (single OpenAI-compatible endpoint); migrated into "custom" */
export interface LegacyAiSettings {
  baseUrl?: string
  apiKey?: string
  model?: string
}

export interface AiChatRequest {
  settings: AiSettings
  system: string
  user: string
}

export interface AiChatResponse {
  ok: boolean
  content?: string
  error?: string
  /** account refusal behind `error` (Faam AI Cloud): 'credits' = balance used up,
   * 'daily-limit' = today's requests used up (until `retryAt`) */
  errorCode?: 'credits' | 'daily-limit'
  /** ISO time the daily limit resets, when the server said */
  retryAt?: string
}

export interface AiStreamRequest {
  requestId: string
  /** Stable renderer transport id used to retain native provider sessions. */
  sessionId?: string
  settings: AiSettings
  system: string
  messages: AgentMessage[]
  tools?: AgentToolDef[]
  maxTokens?: number
}

export interface AiStreamChunk {
  requestId: string
  /** 'ping' = wire-level keepalive so the renderer can tell a live stream from a dead one;
   * 'reasoning' = model thinking delta (text carries it), stored for interleaved-thinking echo */
  type: 'delta' | 'reasoning' | 'tool-call' | 'done' | 'error' | 'ping'
  text?: string
  /** complete parsed tool call (emitted once its arguments finish streaming) */
  toolCall?: AgentToolCall
  error?: string
  /** machine-readable error cause ('timeout', exhausted 'credits', 'network' connectivity failure, 'overloaded' capacity/rate limit); lets the renderer localize the message */
  errorCode?: 'timeout' | 'credits' | 'network' | 'overloaded'
  /** normalized stop reason carried on 'done' ('max_tokens' = output cut off by the token limit) */
  stopReason?: string
}
