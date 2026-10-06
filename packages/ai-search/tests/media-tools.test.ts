import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@genoffice/ai-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider')>()),
  generateImageWithProvider: vi.fn(),
  analyzeMediaWithProvider: vi.fn(),
}))

import { analyzeMediaWithProvider, generateImageWithProvider } from '@genoffice/ai-provider'
import {
  ANALYSIS_PROVIDER_MISSING_ERROR,
  IMAGE_PROVIDER_MISSING_ERROR,
  analyzeMediaTool,
  generateImageTool,
} from '../src/media-tools'

const generate = vi.mocked(generateImageWithProvider)
const analyze = vi.mocked(analyzeMediaWithProvider)
// nonexistent settings file → defaults: no media provider has a key yet
const NO_SETTINGS = '/nonexistent/ai-settings.json'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

function writeSettings(settings: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'genoffice-media-tools-'))
  const path = join(dir, 'ai-settings.json')
  writeFileSync(path, JSON.stringify({ provider: 'openai', providers: {}, ...settings }))
  return path
}

/** OpenAI for image generation and image analysis; video stays on the keyless Gemini default. */
function openaiSettings(): string {
  return writeSettings({
    media: {
      imageProvider: 'openai',
      analysisProvider: 'openai',
      providers: { openai: { apiKey: 'sk', imageModel: 'gpt-image-2' } },
    },
  })
}

function dataUrl(mime: string): string {
  return `data:${mime};base64,${Buffer.from(PNG).toString('base64')}`
}

beforeEach(() => {
  generate.mockReset()
  analyze.mockReset()
})

describe('media tools without a configured provider', () => {
  it('generate_image tells the model no image provider is set up', async () => {
    expect(await generateImageTool(NO_SETTINGS, { prompt: 'red podcast icon' })).toEqual({
      error: IMAGE_PROVIDER_MISSING_ERROR,
    })
    expect(generate).not.toHaveBeenCalled()
  })

  it('analyze_media tells the model no analysis provider is set up', async () => {
    const r = await analyzeMediaTool(NO_SETTINGS, {
      mediaUrls: ['https://cdn.example.com/a.png'],
      requirements: 'describe',
    })
    expect(r).toEqual({ error: ANALYSIS_PROVIDER_MISSING_ERROR })
    expect(analyze).not.toHaveBeenCalled()
  })

  it('treats a settings file left on the removed Genspark choices as unconfigured', async () => {
    const legacy = writeSettings({
      media: { imageProvider: 'genspark', analysisProvider: 'genspark', providers: {} },
    })
    expect(await generateImageTool(legacy, { prompt: 'a logo' })).toEqual({
      error: IMAGE_PROVIDER_MISSING_ERROR,
    })
    expect(
      await analyzeMediaTool(legacy, { mediaUrls: [dataUrl('image/png')], requirements: 'x' }),
    ).toEqual({ error: ANALYSIS_PROVIDER_MISSING_ERROR })
  })

  it('still validates the arguments first', async () => {
    expect(await generateImageTool(NO_SETTINGS, { prompt: '  ' })).toEqual({
      error: 'prompt must not be empty',
    })
    expect(await analyzeMediaTool(NO_SETTINGS, { mediaUrls: [], requirements: 'x' })).toEqual({
      error: 'mediaUrls must not be empty',
    })
  })
})

describe('generateImageTool with a configured provider', () => {
  it('passes transparentBackground through and stores the bytes as a file:// URL', async () => {
    generate.mockResolvedValueOnce({ bytes: PNG, mime: 'image/png' })
    const r = await generateImageTool(openaiSettings(), {
      prompt: 'red podcast icon',
      aspectRatio: '1:1',
      transparentBackground: true,
    })
    expect(r.error).toBeUndefined()
    expect(r.url).toMatch(/^file:\/\/.*\.png$/)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0]![0]).toBe('openai')
    expect(generate.mock.calls[0]![2]).toMatchObject({
      prompt: 'red podcast icon',
      aspectRatio: '1:1',
      transparent: true,
      references: [],
    })
  })

  it('surfaces a provider failure as an error', async () => {
    generate.mockRejectedValueOnce(new Error('quota exceeded'))
    expect(await generateImageTool(openaiSettings(), { prompt: 'red podcast icon' })).toEqual({
      error: 'quota exceeded',
    })
  })
})

describe('analyzeMediaTool routing', () => {
  it('sends images to the image-analysis provider', async () => {
    analyze.mockResolvedValueOnce('a red square')
    const r = await analyzeMediaTool(openaiSettings(), {
      mediaUrls: [dataUrl('image/png')],
      requirements: 'describe',
    })
    expect(r).toEqual({ text: 'a red square' })
    expect(analyze.mock.calls[0]![0]).toBe('openai')
  })

  it('reports a missing video provider instead of sending video to an image-only one', async () => {
    const r = await analyzeMediaTool(openaiSettings(), {
      mediaUrls: [dataUrl('video/mp4')],
      requirements: 'summarize',
    })
    expect(r).toEqual({ error: ANALYSIS_PROVIDER_MISSING_ERROR })
    expect(analyze).not.toHaveBeenCalled()
  })
})
