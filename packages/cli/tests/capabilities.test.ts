import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { run, tempDir } from './helpers'

// a real settings file always carries the chat provider block; without it every section resets to defaults
function settingsFile(dir: string, settings: Record<string, unknown>): string {
  const path = join(dir, 'ai-settings.json')
  writeFileSync(path, JSON.stringify({ provider: 'anthropic', providers: {}, ...settings }))
  return path
}

describe('faamoffice capabilities', () => {
  it('reports nothing configured with default settings', async () => {
    const dir = tempDir()
    const r = await run(['capabilities', '--json'], {
      env: {
        ...process.env,
        GENOFFICE_AI_SETTINGS: join(dir, 'missing.json'),
        GENOFFICE_APP_BIN: '',
      },
    })
    expect(r.code).toBe(0)
    const d = r.json().detail
    expect(d.search.available).toBe(false)
    expect(d.image_search.available).toBe(false)
    expect(d.image_generation.available).toBe(false)
    expect(d.media_analysis.available).toBe(false)
  })

  it('counts a Serper key as search + image search and a BYOK image model as generation', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'bin'))
    const settings = settingsFile(dir, {
      search: {
        provider: 'serper',
        providers: { serper: { apiKey: 'k' }, tavily: { apiKey: '' } },
      },
      media: {
        imageProvider: 'openai',
        providers: { openai: { apiKey: 'sk', imageModel: 'gpt-image-1' } },
      },
    })
    const r = await run(['capabilities', '--json'], {
      env: {
        ...process.env,
        GENOFFICE_AI_SETTINGS: settings,
        GENOFFICE_APP_BIN: join(dir, 'bin', 'app'),
      },
    })
    expect(r.code).toBe(0)
    const d = r.json().detail
    expect(d.search).toEqual({ available: true, via: 'serper' })
    expect(d.image_search).toEqual({ available: true, via: 'serper' })
    expect(d.image_generation).toEqual({ available: true, via: 'openai' })
    // OpenAI is also the default analysis choice, so the same key covers image analysis
    expect(d.media_analysis).toEqual({ available: true, via: 'openai' })
    expect(d.app.available).toBe(true)
    expect(r.json().summary).toContain('image_generation')
  })

  it('counts a Serply key as search + image search', async () => {
    const settings = settingsFile(tempDir(), {
      search: { provider: 'serply', providers: { serply: { apiKey: 'k' } } },
    })
    const r = await run(['capabilities', '--json'], {
      env: { ...process.env, GENOFFICE_AI_SETTINGS: settings },
    })
    const d = r.json().detail
    expect(d.search).toEqual({ available: true, via: 'serply' })
    expect(d.image_search).toEqual({ available: true, via: 'serply' })
  })

  it.each(['tavily', 'parallel'])('%s gives web search but no image search', async (provider) => {
    const dir = tempDir()
    const settings = settingsFile(dir, {
      search: {
        provider,
        providers: { [provider]: { apiKey: 'test-key' } },
      },
    })
    const r = await run(['capabilities', '--json'], {
      env: { ...process.env, GENOFFICE_AI_SETTINGS: settings },
    })
    const d = r.json().detail
    expect(d.search).toEqual({ available: true, via: provider })
    expect(d.image_search.available).toBe(false)
  })

  it('reports selected keyless Parallel as web search without requiring a login', async () => {
    const settings = settingsFile(tempDir(), {
      search: { provider: 'parallel', providers: { parallel: { apiKey: '' } } },
    })
    const r = await run(['capabilities', '--json'], {
      env: { ...process.env, GENOFFICE_AI_SETTINGS: settings },
    })
    expect(r.json().detail.search).toEqual({ available: true, via: 'parallel' })
    expect(r.json().detail.image_search).toEqual({ available: false, via: null })
  })

  it('does not count the free search chain as configured search', async () => {
    const settings = settingsFile(tempDir(), { search: { provider: 'auto', providers: {} } })
    const r = await run(['capabilities', '--json'], {
      env: { ...process.env, GENOFFICE_AI_SETTINGS: settings },
    })
    const d = r.json().detail
    expect(d.search).toEqual({ available: false, via: null })
    expect(d.image_search).toEqual({ available: false, via: null })
  })

  it('reports nothing for a settings file left on the removed Genspark choices', async () => {
    const settings = settingsFile(tempDir(), {
      provider: 'genspark',
      providers: { genspark: { apiKey: '', model: 'claude-opus-4-7' } },
      gskToolsEnabled: true,
      search: { provider: 'genspark', providers: {} },
      media: { imageProvider: 'genspark', analysisProvider: 'genspark', providers: {} },
    })
    const r = await run(['capabilities', '--json'], {
      env: { ...process.env, GENOFFICE_AI_SETTINGS: settings },
    })
    expect(r.code).toBe(0)
    const d = r.json().detail
    expect(d.search).toEqual({ available: false, via: null })
    expect(d.image_generation).toEqual({ available: false, via: null })
    expect(d.media_analysis).toEqual({ available: false, via: null })
  })

  it('names the video provider when only video analysis is set up', async () => {
    const settings = settingsFile(tempDir(), {
      media: {
        imageProvider: 'openai',
        analysisProvider: 'openai',
        videoAnalysisProvider: 'gemini',
        providers: { gemini: { apiKey: 'g' } },
      },
    })
    const r = await run(['capabilities', '--json'], {
      env: { ...process.env, GENOFFICE_AI_SETTINGS: settings },
    })
    const d = r.json().detail
    expect(d.image_generation).toEqual({ available: false, via: null })
    expect(d.media_analysis).toEqual({ available: true, via: 'gemini' })
  })
})
