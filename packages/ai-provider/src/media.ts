import type {
  AiMediaProviderConfig,
  AiMediaProviderId,
  AiMediaProviderMeta,
  AiMediaSettings,
  AiSettings,
} from './types'

export const OPENAI_IMAGES_BASE_URL = 'https://api.openai.com/v1'
export const GEMINI_MEDIA_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
export const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
export const XAI_BASE_URL = 'https://api.x.ai/v1'
/** DashScope root: images ride /api/v1/services/aigc/..., understanding rides /compatible-mode/v1 */
export const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com'
export const MINIMAX_BASE_URL = 'https://api.minimax.io/v1'
/** DeepSeek's OpenAI-compatible root; the Vision + Files API live at https://api.deepseek.com */
export const DEEPSEEK_MEDIA_BASE_URL = 'https://api.deepseek.com/v1'

// Model ids verified against vendor docs 2026-09; keep chat-capable analysis
// models in step with the chat catalog in providers.ts.
export const AI_MEDIA_PROVIDERS: AiMediaProviderMeta[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT Image for generation and editing; GPT chat models for image analysis',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: OPENAI_IMAGES_BASE_URL,
    imageProtocol: 'openai-images',
    // GPT Image 2.5 (sunburst = quality, flare = fast) per the OpenAI models page
    // 2026-09-24, same token rates as GPT Image 2, both on generations and edits.
    // GPT-6 reads images over Chat Completions; the tool-call caveat that keeps
    // it off the chat provider does not apply to analysis.
    imageModels: [
      'gpt-image-2.5-sunburst',
      'gpt-image-2.5-flare',
      'gpt-image-2',
      'gpt-image-1.5',
      'gpt-image-1',
      'gpt-image-1-mini',
    ],
    defaultImageModel: 'gpt-image-2',
    analysisProtocol: 'openai-chat',
    analysisModels: [
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4-mini',
    ],
    defaultAnalysisModel: 'gpt-5.6-luna',
    videoAnalysis: false,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    description:
      'Gemini native image output (Nano Banana) and Imagen; Gemini reads images, video and audio',
    keyPlaceholder: 'AIza...',
    defaultBaseUrl: GEMINI_MEDIA_BASE_URL,
    imageProtocol: 'gemini',
    imageModels: [
      'gemini-3.1-flash-image',
      'gemini-3-pro-image',
      'gemini-3.1-flash-lite-image',
      'gemini-2.5-flash-image',
    ],
    defaultImageModel: 'gemini-3.1-flash-image',
    analysisProtocol: 'gemini',
    analysisModels: [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.1-pro-preview',
      'gemini-3.6-flash',
    ],
    defaultAnalysisModel: 'gemini-3.8-flash',
    videoAnalysis: true,
  },
  {
    id: 'doubao',
    label: 'Doubao (Volcengine Ark)',
    description: 'Seedream image generation and editing; Doubao Seed reads images and video',
    keyPlaceholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    defaultBaseUrl: ARK_BASE_URL,
    imageProtocol: 'openai-images',
    imageModels: [
      'doubao-seedream-5-0-260128',
      'doubao-seedream-4-5-251128',
      'doubao-seedream-4-0-250828',
    ],
    defaultImageModel: 'doubao-seedream-5-0-260128',
    analysisProtocol: 'openai-chat',
    analysisModels: ['doubao-seed-2-1-pro-260628', 'doubao-seed-2-1-turbo-260628'],
    defaultAnalysisModel: 'doubao-seed-2-1-pro-260628',
    videoAnalysis: true,
  },
  {
    id: 'glm',
    label: 'GLM (Zhipu)',
    description: 'CogView image generation; GLM-V reads images and video',
    keyPlaceholder: 'xxxxxxxx.xxxxxxxx',
    defaultBaseUrl: ZHIPU_BASE_URL,
    imageProtocol: 'openai-images',
    imageModels: ['cogview-4-250304', 'cogview-3-flash'],
    defaultImageModel: 'cogview-4-250304',
    analysisProtocol: 'openai-chat',
    analysisModels: ['glm-4.6v', 'glm-4.6v-flash'],
    defaultAnalysisModel: 'glm-4.6v',
    videoAnalysis: true,
  },
  {
    id: 'xai',
    label: 'Grok (xAI)',
    description: 'Grok Imagine image generation; Grok reads images',
    keyPlaceholder: 'xai-...',
    defaultBaseUrl: XAI_BASE_URL,
    imageProtocol: 'openai-images',
    imageModels: ['grok-imagine-image-2.0', 'grok-2-image-1212'],
    defaultImageModel: 'grok-imagine-image-2.0',
    analysisProtocol: 'openai-chat',
    analysisModels: ['grok-4.6', 'grok-4.5'],
    defaultAnalysisModel: 'grok-4.6',
    videoAnalysis: false,
  },
  {
    id: 'qwen',
    label: 'Qwen (Alibaba Cloud)',
    description: 'Qwen-Image generation; Qwen-VL reads images and video (DashScope)',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: DASHSCOPE_BASE_URL,
    imageProtocol: 'dashscope',
    imageModels: ['qwen-image-plus', 'qwen-image'],
    defaultImageModel: 'qwen-image-plus',
    analysisProtocol: 'openai-chat',
    analysisModels: ['qwen3-vl-plus', 'qwen3-vl-flash', 'qwen3.8-max', 'qwen3.7-plus'],
    defaultAnalysisModel: 'qwen3-vl-plus',
    videoAnalysis: true,
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    description:
      'Image generation; MiniMax-M3 reads images and video (use api.minimaxi.com/v1 for CN)',
    keyPlaceholder: 'eyJ...',
    defaultBaseUrl: MINIMAX_BASE_URL,
    imageProtocol: 'minimax',
    imageModels: ['image-01'],
    defaultImageModel: 'image-01',
    analysisProtocol: 'openai-chat',
    analysisModels: ['MiniMax-M3'],
    defaultAnalysisModel: 'MiniMax-M3',
    videoAnalysis: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    // native multimodal (V4.1 Flash = wire id deepseek-flash): reads JPEG/PNG/GIF/WebP,
    // no image generation and no video/audio, so it only appears for image analysis
    description: 'DeepSeek V4.1 Flash reads images (native multimodal); no image generation',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: DEEPSEEK_MEDIA_BASE_URL,
    imageModels: [],
    defaultImageModel: '',
    analysisProtocol: 'openai-chat',
    analysisModels: ['deepseek-flash'],
    defaultAnalysisModel: 'deepseek-flash',
    videoAnalysis: false,
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Any OpenAI-compatible endpoint: /images/generations and /chat/completions',
    keyPlaceholder: 'API Key',
    needsBaseUrl: true,
    defaultBaseUrl: '',
    imageProtocol: 'openai-images',
    imageModels: [],
    defaultImageModel: '',
    analysisProtocol: 'openai-chat',
    analysisModels: [],
    defaultAnalysisModel: '',
    videoAnalysis: false,
  },
]

export type MediaCapability = 'image' | 'analysis' | 'video'

export function getMediaProviderMeta(id: AiMediaProviderId): AiMediaProviderMeta | undefined {
  return AI_MEDIA_PROVIDERS.find((m) => m.id === id)
}

export function providerHasCapability(
  meta: AiMediaProviderMeta,
  capability: MediaCapability,
): boolean {
  if (capability === 'image') return !!meta.imageProtocol
  if (capability === 'video') return !!meta.analysisProtocol && meta.videoAnalysis
  return !!meta.analysisProtocol
}

export function defaultAiMediaSettings(): AiMediaSettings {
  const providers = {} as AiMediaSettings['providers']
  for (const meta of AI_MEDIA_PROVIDERS) {
    providers[meta.id] = {
      apiKey: '',
      imageModel: meta.defaultImageModel,
      analysisModel: meta.defaultAnalysisModel,
      baseUrl: meta.needsBaseUrl ? '' : undefined,
    }
  }
  return {
    // nothing is active until the chosen vendor has a key (mediaConfigUsable)
    imageProvider: 'openai',
    analysisProvider: 'openai',
    videoAnalysisProvider: 'gemini',
    providers,
  }
}

/**
 * Merge a stored media block over defaults, trimming pasted whitespace. The
 * pre-catalog `provider` field (one choice for both tools) seeds both
 * per-capability choices. Provider ids no longer in the catalog are dropped.
 */
export function resolveAiMediaSettings(
  stored: Partial<AiMediaSettings> | undefined,
): AiMediaSettings {
  const defaults = defaultAiMediaSettings()
  if (!stored) return defaults
  const providers = { ...defaults.providers }
  for (const [id, config] of Object.entries(stored.providers ?? {})) {
    if (!config || typeof config !== 'object') continue
    // Hand-edited settings files can carry non-string values: trim only
    // strings (like the search-settings guard) instead of crashing.
    const str = (v: unknown, fallback: string): string =>
      typeof v === 'string' ? v.trim() : fallback
    const base = providers[id as AiMediaProviderId]
    providers[id as AiMediaProviderId] = {
      apiKey: str(config.apiKey, base?.apiKey ?? ''),
      imageModel: str(config.imageModel, base?.imageModel ?? ''),
      analysisModel: str(config.analysisModel, base?.analysisModel ?? ''),
      ...(config.baseUrl !== undefined
        ? { baseUrl: str(config.baseUrl, base?.baseUrl ?? '') }
        : base?.baseUrl !== undefined
          ? { baseUrl: base.baseUrl }
          : {}),
    }
  }
  // a provider no longer in the catalog or a
  // hand-edited id falls back to the default choice for that capability
  for (const id of Object.keys(providers)) {
    if (!getMediaProviderMeta(id as AiMediaProviderId)) delete providers[id as AiMediaProviderId]
  }
  const pick = (id: AiMediaProviderId | undefined): AiMediaProviderId | undefined =>
    id && getMediaProviderMeta(id) ? id : undefined
  const legacy = pick(stored.provider)
  const analysisProvider = pick(stored.analysisProvider) ?? legacy ?? defaults.analysisProvider
  return {
    imageProvider: pick(stored.imageProvider) ?? legacy ?? defaults.imageProvider,
    analysisProvider,
    // a pre-split file (no video field) used one vendor for all media analysis;
    // a video choice that is no longer offered gets the video-capable default
    videoAnalysisProvider:
      pick(stored.videoAnalysisProvider) ??
      (stored.videoAnalysisProvider === undefined
        ? analysisProvider
        : defaults.videoAnalysisProvider),
    providers,
  }
}

/** Key (or base URL for custom) present — the minimum for a BYOK media provider to be honored */
export function mediaConfigUsable(
  meta: AiMediaProviderMeta,
  config: AiMediaProviderConfig | undefined,
): boolean {
  if (!config) return false
  // Trim-aware like activeProvider: whitespace-only survivors of in-memory
  // settings are not usable configs.
  if (meta.needsBaseUrl) return !!config.baseUrl?.trim()
  return !!config.apiKey?.trim()
}

/**
 * The stored provider for one capability, honored only when it exists, has
 * that capability and is usable (key, or base URL for custom); null means the
 * capability is not set up and its tool stays unavailable.
 */
export function activeMediaProvider(
  settings: Pick<AiSettings, 'media'>,
  capability: MediaCapability,
): AiMediaProviderId | null {
  const media = settings.media
  if (!media) return null
  const id =
    capability === 'image'
      ? media.imageProvider
      : capability === 'video'
        ? media.videoAnalysisProvider
        : media.analysisProvider
  if (!id) return null
  const meta = getMediaProviderMeta(id)
  if (!meta || !providerHasCapability(meta, capability)) return null
  if (!mediaConfigUsable(meta, media.providers?.[id])) return null
  return id
}

/** the active config for one capability, or null when none is set up */
export function activeMediaConfig(
  settings: Pick<AiSettings, 'media'>,
  capability: MediaCapability,
): { provider: AiMediaProviderId; config: AiMediaProviderConfig } | null {
  const provider = activeMediaProvider(settings, capability)
  if (!provider) return null
  return { provider, config: settings.media!.providers[provider] }
}

function byokModel(
  settings: Pick<AiSettings, 'media'>,
  capability: MediaCapability,
): string | null {
  const active = activeMediaConfig(settings, capability)
  if (!active) return null
  const meta = getMediaProviderMeta(active.provider)!
  return capability === 'image'
    ? active.config.imageModel || meta.defaultImageModel
    : active.config.analysisModel || meta.defaultAnalysisModel
}

function capabilityAvailable(
  settings: Pick<AiSettings, 'media'> | null | undefined,
  capability: MediaCapability,
): boolean {
  if (!settings) return false
  const model = byokModel(settings, capability)
  return model !== null && model !== ''
}

/** live predicate for the generate_image tool: an image provider with a key and a model */
export function imageGenerationAvailable(
  settings: Pick<AiSettings, 'media'> | null | undefined,
): boolean {
  return capabilityAvailable(settings, 'image')
}

/** live predicate for the analyze_media tool: image analysis or video analysis reachable */
export function mediaAnalysisAvailable(
  settings: Pick<AiSettings, 'media'> | null | undefined,
): boolean {
  return capabilityAvailable(settings, 'analysis') || capabilityAvailable(settings, 'video')
}

export function videoAnalysisAvailable(
  settings: Pick<AiSettings, 'media'> | null | undefined,
): boolean {
  return capabilityAvailable(settings, 'video')
}
