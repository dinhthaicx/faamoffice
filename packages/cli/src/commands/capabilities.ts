import {
  activeMediaProvider,
  activeSearchProvider,
  imageGenerationAvailable,
  mediaAnalysisAvailable,
} from '@genoffice/ai-provider'
import { readAiSettingsFile } from '@genoffice/ai-search'
import { aiSettingsPath } from '../cloud'
import type { CommandDef } from '../registry'
import { appLaunch } from '../resources'

/**
 * What the cloud commands can do on this machine, decided from FaamOffice's
 * own settings without a network call: a BYOK key, or explicitly selected free
 * Parallel search. The unkeyed 'auto' chain (free Parallel MCP, then DuckDuckGo)
 * may still answer, but it is rate-limited and does not count as configured.
 * Agents check this once before planning work that needs photos or web facts.
 */
export const capabilitiesCommand: CommandDef = {
  name: 'capabilities',
  summary:
    'Report which cloud features (search, image search, image generation, media analysis) are configured in FaamOffice, and whether the app is installed.',
  usage: 'capabilities',
  async run(_args, ctx) {
    const settings = readAiSettingsFile(aiSettingsPath(ctx.env))
    const searchProvider = activeSearchProvider(settings)
    const search = searchProvider !== 'auto'
    // Tavily, Parallel, Exa and Firecrawl answer web search only
    const imageSearch = searchProvider === 'serper' || searchProvider === 'serply'
    const imageGeneration = imageGenerationAvailable(settings)
    const mediaAnalysis = mediaAnalysisAvailable(settings)
    const detail = {
      search: { available: search, via: search ? searchProvider : null },
      image_search: { available: imageSearch, via: imageSearch ? searchProvider : null },
      image_generation: {
        available: imageGeneration,
        via: imageGeneration ? activeMediaProvider(settings, 'image') : null,
      },
      media_analysis: {
        available: mediaAnalysis,
        // a video-only setup still analyzes media; name whichever provider answers
        via: mediaAnalysis
          ? (activeMediaProvider(settings, 'analysis') ?? activeMediaProvider(settings, 'video'))
          : null,
      },
      app: { available: appLaunch(ctx.env) !== null },
      settings_path: aiSettingsPath(ctx.env),
    }
    const on = Object.entries(detail)
      .filter(([k, v]) => k !== 'settings_path' && (v as { available: boolean }).available)
      .map(([k]) => k)
    return {
      summary: on.length
        ? `configured: ${on.join(', ')}`
        : 'no cloud feature configured; the app is not installed',
      detail,
    }
  },
}
