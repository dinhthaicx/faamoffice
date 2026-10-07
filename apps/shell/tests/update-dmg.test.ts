import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadMacDmg, feedFileName, pickMacDmg } from '../src/main/update-dmg'

/**
 * The macOS notify-flow download (src/main/update-dmg.ts): which dmg of
 * latest-mac.yml a Mac takes, and the verified download into a temp dir with
 * fetch mocked at the boundary (the resume mechanics themselves are
 * update-resume.test.ts's subject).
 */

const sha512 = (data: Buffer | string): string => createHash('sha512').update(data).digest('base64')

describe('pickMacDmg', () => {
  const files = [
    { url: 'FaamOffice-1.2.0-arm64-mac.zip', sha512: 'zip' },
    { url: 'FaamOffice-1.2.0-arm64.dmg', sha512: 'arm', size: 5 },
    { url: 'FaamOffice-1.2.0.dmg', sha512: 'x64' },
  ]

  it('takes the arm64 dmg on Apple silicon and the arch-less one on Intel', () => {
    expect(pickMacDmg(files, 'arm64')).toEqual({
      name: 'FaamOffice-1.2.0-arm64.dmg',
      sha512: 'arm',
      size: 5,
    })
    expect(pickMacDmg(files, 'x64')).toEqual({ name: 'FaamOffice-1.2.0.dmg', sha512: 'x64' })
  })

  it('lets Apple silicon fall back to a universal, then an Intel dmg (Rosetta)', () => {
    expect(
      pickMacDmg([files[2]!, { url: 'FaamOffice-1.2.0-universal.dmg', sha512: 'u' }], 'arm64'),
    ).toMatchObject({ name: 'FaamOffice-1.2.0-universal.dmg' })
    expect(pickMacDmg([files[2]!], 'arm64')).toMatchObject({ name: 'FaamOffice-1.2.0.dmg' })
  })

  it('never gives an Intel Mac an arm64-only dmg', () => {
    expect(pickMacDmg([files[1]!], 'x64')).toBeNull()
  })

  it('skips entries it cannot verify or that are not plain file names', () => {
    expect(pickMacDmg([{ url: 'FaamOffice-1.2.0-arm64.dmg' }], 'arm64')).toBeNull()
    expect(pickMacDmg([{ url: 'evil%2F..%2Fx-arm64.dmg', sha512: 'a' }], 'arm64')).toBeNull()
    expect(pickMacDmg([{ url: '.hidden-arm64.dmg', sha512: 'a' }], 'arm64')).toBeNull()
  })

  it('reads basenames out of absolute (tag-pinned) feed URLs', () => {
    expect(
      feedFileName('https://github.com/o/r/releases/download/v1.2.0/FaamOffice-1.2.0-arm64.dmg'),
    ).toBe('FaamOffice-1.2.0-arm64.dmg')
    expect(feedFileName('FaamOffice%201.2.0.dmg')).toBe('FaamOffice 1.2.0.dmg')
  })
})

describe('downloadMacDmg', () => {
  const realFetch = globalThis.fetch
  const DMG = Buffer.from('pretend this is a disk image')
  const url = new URL('https://github.com/o/r/releases/download/v1.2.0/FaamOffice-1.2.0-arm64.dmg')
  const choice = { name: 'FaamOffice-1.2.0-arm64.dmg', sha512: sha512(DMG) }
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'faamoffice-dmg-'))
  })
  afterEach(async () => {
    globalThis.fetch = realFetch
    await rm(dir, { recursive: true, force: true })
  })

  const serve = (status: number, body: Buffer) =>
    vi.fn(async () => new Response(new Uint8Array(body), { status }))

  it('downloads into <dir>/pending, verified against the feed sha512', async () => {
    globalThis.fetch = serve(200, DMG) as unknown as typeof fetch
    const progress: number[] = []
    const file = await downloadMacDmg({ url, dir, choice, onProgress: (p) => progress.push(p) })
    expect(file).toBe(join(dir, 'pending', choice.name))
    expect(await readFile(file)).toEqual(DMG)
    expect(progress.at(-1)).toBe(100)
  })

  it('reuses an earlier download that still matches, without fetching', async () => {
    await mkdir(join(dir, 'pending'), { recursive: true })
    await writeFile(join(dir, 'pending', choice.name), DMG)
    const fetchMock = serve(200, DMG)
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const file = await downloadMacDmg({ url, dir, choice })
    expect(file).toBe(join(dir, 'pending', choice.name))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects bytes that do not match the sha512 and keeps nothing', async () => {
    globalThis.fetch = serve(200, Buffer.from('tampered')) as unknown as typeof fetch
    await expect(downloadMacDmg({ url, dir, choice })).rejects.toThrow(/sha512/)
    expect(await readdir(join(dir, 'pending'))).toEqual([])
  })

  it('fails (for the browser fallback) when the server refuses', async () => {
    globalThis.fetch = serve(404, Buffer.from('not found')) as unknown as typeof fetch
    await expect(downloadMacDmg({ url, dir, choice })).rejects.toThrow()
  })

  it('removes installers of other versions first', async () => {
    await mkdir(join(dir, 'pending'), { recursive: true })
    await writeFile(join(dir, 'pending', 'FaamOffice-1.1.0-arm64.dmg'), 'old')
    globalThis.fetch = serve(200, DMG) as unknown as typeof fetch
    await downloadMacDmg({ url, dir, choice })
    expect(await readdir(join(dir, 'pending'))).toEqual([choice.name])
  })

  it('refuses a name that is not a plain dmg file name', async () => {
    await expect(
      downloadMacDmg({ url, dir, choice: { name: '../escape.dmg', sha512: choice.sha512 } }),
    ).rejects.toThrow(/unexpected installer name/)
  })
})
