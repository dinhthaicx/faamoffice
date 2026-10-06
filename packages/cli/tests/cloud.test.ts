import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { aiSettingsPath, proxyUrlFromEnv } from '../src/cloud'
import { resultCount } from '../src/commands/search'
import { run } from './helpers'

describe('cloud command plumbing', () => {
  it('locates the shell ai-settings.json without Electron and honours the override', () => {
    expect(aiSettingsPath({ GENOFFICE_AI_SETTINGS: '/x/ai.json' })).toBe('/x/ai.json')
    const p = aiSettingsPath({})
    expect(p.endsWith(join('FaamOffice', 'ai-settings.json'))).toBe(true)
    if (process.platform === 'darwin') expect(p).toContain('Library/Application Support')
    expect(aiSettingsPath({ GENOFFICE_USER_DATA: '/ud' })).toBe(join('/ud', 'ai-settings.json'))
  })

  it('picks the first http(s) proxy variable and ignores socks', () => {
    expect(proxyUrlFromEnv({})).toBeNull()
    expect(proxyUrlFromEnv({ ALL_PROXY: 'socks5://h:1', HTTP_PROXY: 'http://h:8080' })).toBe(
      'http://h:8080',
    )
    expect(proxyUrlFromEnv({ https_proxy: 'http://a:1', HTTP_PROXY: 'http://b:2' })).toBe(
      'http://a:1',
    )
  })

  it('keeps the per-mode default when --max is absent and clamps it otherwise', async () => {
    expect(resultCount(undefined)).toBeUndefined()
    expect(resultCount('3')).toBe(3)
    expect(resultCount('0')).toBe(1)
    expect(resultCount('99')).toBe(20)
    expect(() => resultCount('lots')).toThrow()
    expect((await run(['search', 'x', '--max', 'lots', '--json'])).code).toBe(1)
  })

  it('refuses an existing --out before generating', async () => {
    const { writeFileSync } = await import('node:fs')
    const { tempDir } = await import('./helpers')
    const out = join(tempDir(), 'hero.png')
    writeFileSync(out, 'x')
    const r = await run(['image', 'a cat', '--out', out, '--json'])
    expect(r.code).toBe(2)
    expect(r.json().message).toContain('output exists')
  })

  it('applies GENOFFICE_ALLOWED_ROOTS to --out and local --ref before any network call', async () => {
    const { writeFileSync } = await import('node:fs')
    const { tempDir } = await import('./helpers')
    const inside = tempDir()
    const outside = tempDir()
    const env = { ...process.env, GENOFFICE_AUDIT_LOG: 'off', GENOFFICE_ALLOWED_ROOTS: inside }
    const out = await run(['image', 'a cat', '--out', join(outside, 'x.png'), '--json'], { env })
    expect(out.code).toBe(2)
    expect(out.json().message).toContain('refusing to write')
    writeFileSync(join(outside, 'ref.png'), 'x')
    const ref = await run(
      [
        'image',
        'a cat',
        '--ref',
        join(outside, 'ref.png'),
        '--out',
        join(inside, 'x.png'),
        '--json',
      ],
      { env },
    )
    expect(ref.code).toBe(2)
    expect(ref.json().message).toContain('refusing to read')
    const fileRef = await run(
      [
        'image',
        'a cat',
        '--ref',
        'file://' + join(outside, 'ref.png'),
        '--out',
        join(inside, 'x.png'),
        '--json',
      ],
      { env },
    )
    expect(fileRef.code).toBe(2)
    expect(fileRef.json().message).toContain('refusing to read')
    // the default output name is policy-checked before generation too
    const noOut = await run(['image', 'a cat', '--json'], { env, cwd: outside })
    expect(noOut.code).toBe(2)
    expect(noOut.json().message).toContain('refusing to write')
  })

  it('rejects missing arguments before touching the network', async () => {
    expect((await run(['search', '--json'])).code).toBe(1)
    expect((await run(['image', '--json'])).code).toBe(1)
    expect((await run(['media', '--json'])).code).toBe(1)
    const missing = await run(['media', '/nonexistent/photo.jpg', '--json'])
    expect(missing.code).toBe(2)
    const missingUrl = await run(['media', 'file:///nonexistent/photo.jpg', '--json'])
    expect(missingUrl.code).toBe(2)
    expect(missingUrl.json().message).toContain('/nonexistent/photo.jpg')
  })

  it('lists the cloud commands in help', async () => {
    const r = await run(['help'])
    expect(r.stdout).toMatch(/\bsearch\b/)
    expect(r.stdout).toMatch(/\bimage\b/)
    expect(r.stdout).toMatch(/\bmedia\b/)
  })
})

describe('cloud guard rails', () => {
  it('refuses when a sibling the provider might pick already exists, before generating', async () => {
    const { writeFileSync } = await import('node:fs')
    const { tempDir } = await import('./helpers')
    const dir = tempDir()
    writeFileSync(join(dir, 'hero.jpg'), 'x')
    const r = await run(['image', 'a cat', '--out', join(dir, 'hero.png'), '--json'])
    expect(r.code).toBe(2)
    expect(r.json().message).toContain('hero.jpg')
  })

  it('does not treat .jpg as a sibling of .jpeg (same format, same file kept)', async () => {
    const { siblingExtensions } = await import('../src/commands/image')
    expect(siblingExtensions('jpeg')).toEqual(['png', 'webp', 'gif'])
    expect(siblingExtensions('png')).toEqual(['jpg', 'webp', 'gif'])
    expect(siblingExtensions('bmp')).toEqual(['png', 'jpg', 'webp', 'gif'])
  })

  it('reports a missing image or analysis provider without contacting any service', async () => {
    const { writeFileSync } = await import('node:fs')
    const { tempDir } = await import('./helpers')
    const dir = tempDir()
    const env = {
      ...process.env,
      GENOFFICE_AUDIT_LOG: 'off',
      GENOFFICE_AI_SETTINGS: join(dir, 'missing.json'),
    }
    const image = await run(['image', 'a cat', '--out', join(dir, 'x.png'), '--json'], { env })
    expect(image.code).toBe(4)
    expect(image.json().message).toContain('No image generation provider')
    writeFileSync(join(dir, 'photo.png'), 'x')
    const media = await run(['media', join(dir, 'photo.png'), '--json'], { env })
    expect(media.code).toBe(4)
    expect(media.json().message).toContain('No media analysis provider')
  })

  it('validates --aspect and rejects the removed --size / --model flags before any network call', async () => {
    expect((await run(['image', 'a cat', '--aspect', '5:7', '--json'])).code).toBe(1)
    expect((await run(['image', 'a cat', '--size', '1k', '--json'])).code).toBe(1)
    expect((await run(['image', 'a cat', '--model', 'x', '--json'])).code).toBe(1)
  })
})
