import type {
  AiSearchProviderId,
  AiSearchProviderMeta,
  AiSearchSettings,
  AiSettings,
} from './types'

export const AI_SEARCH_PROVIDERS: AiSearchProviderMeta[] = [
  // free chain: Parallel's keyless Search MCP, then DuckDuckGo (image search via DuckDuckGo)
  { id: 'auto', label: 'Free (no key)', keyPlaceholder: 'Not required', imageSearch: true },
  { id: 'serper', label: 'Serper', keyPlaceholder: 'Serper API key', imageSearch: true },
  { id: 'serply', label: 'Serply', keyPlaceholder: 'Serply API key', imageSearch: true },
  { id: 'tavily', label: 'Tavily', keyPlaceholder: 'tvly-...', imageSearch: false },
  { id: 'parallel', label: 'Parallel', keyPlaceholder: 'Parallel API key', imageSearch: false },
  // exa/firecrawl: AI-search APIs without an image endpoint (like Tavily/Parallel)
  { id: 'exa', label: 'Exa', keyPlaceholder: 'Exa API key', imageSearch: false },
  { id: 'firecrawl', label: 'Firecrawl', keyPlaceholder: 'fc-...', imageSearch: false },
]

export function defaultAiSearchSettings(): AiSearchSettings {
  return {
    provider: 'auto',
    providers: {
      serper: { apiKey: '' },
      serply: { apiKey: '' },
      tavily: { apiKey: '' },
      parallel: { apiKey: '' },
      exa: { apiKey: '' },
      firecrawl: { apiKey: '' },
    },
  }
}

export function resolveAiSearchSettings(
  stored: Partial<AiSearchSettings> | undefined,
): AiSearchSettings {
  const defaults = defaultAiSearchSettings()
  if (!stored) return defaults
  const providers = { ...defaults.providers }
  for (const id of ['serper', 'serply', 'tavily', 'parallel', 'exa', 'firecrawl'] as const) {
    const key = stored.providers?.[id]?.apiKey
    if (typeof key === 'string') providers[id] = { apiKey: key.trim() }
  }
  // a backend no longer offered (or a hand-edited id) becomes the free chain
  const provider = AI_SEARCH_PROVIDERS.some((m) => m.id === stored.provider)
    ? stored.provider!
    : defaults.provider
  return { provider, providers }
}

/** Parallel can run keylessly; other keyed providers without a key fall back to the free chain. */
export function activeSearchProvider(settings: Pick<AiSettings, 'search'>): AiSearchProviderId {
  const search = settings.search
  if (!search || search.provider === 'auto') return 'auto'
  if (!AI_SEARCH_PROVIDERS.some((m) => m.id === search.provider)) return 'auto'
  if (search.provider === 'parallel') return 'parallel'
  // Trim-aware: a whitespace-only key from in-memory settings falls back
  // instead of sending `Bearer    ` to the search backend.
  return search.providers?.[search.provider]?.apiKey?.trim() ? search.provider : 'auto'
}
