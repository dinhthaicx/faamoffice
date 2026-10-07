import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { refreshMacUpdateFeed } = require('../../../scripts/refresh-mac-update-feed.cjs') as {
  refreshMacUpdateFeed: (dir: string) => Promise<string[]>
}
const { load, dump } = require('js-yaml')
const sha512 = (bytes: Buffer) => createHash('sha512').update(bytes).digest('base64')
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'faamoffice-mac-feed-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('macOS update metadata after notarization', () => {
  it('hashes final stapled bytes and replaces blockmaps while keeping pinned URLs', async () => {
    const names = ['FaamOffice-0.11.2-arm64-mac.zip', 'FaamOffice-0.11.2-arm64.dmg']
    const old = Buffer.from('installer before stapling')
    const contents = [Buffer.alloc(50000, 17), Buffer.concat([old, Buffer.from('Apple ticket')])]
    const urls = names.map(
      (name) => `https://github.com/dinhthaicx/faamoffice/releases/download/v0.11.2/${name}`,
    )
    const feed = {
      version: '0.11.2',
      files: urls.map((url) => ({ url, size: old.length, sha512: sha512(old) })),
      path: urls[0],
      sha512: sha512(old),
      releaseDate: '2026-10-07T01:02:03.000Z',
    }
    names.forEach((name, i) => {
      writeFileSync(join(dir, name), contents[i]!)
      writeFileSync(join(dir, `${name}.blockmap`), 'stale blockmap')
    })
    writeFileSync(join(dir, 'latest-mac.yml'), dump(feed))

    await refreshMacUpdateFeed(dir)

    const actual = load(readFileSync(join(dir, 'latest-mac.yml'), 'utf8'))
    expect(actual.version).toBe(feed.version)
    expect(actual.releaseDate).toBe(feed.releaseDate)
    expect(actual.path).toBe(urls[0])
    expect(actual.sha512).toBe(sha512(contents[0]!))
    names.forEach((name, i) => {
      expect(actual.files[i]).toEqual({
        url: urls[i],
        size: contents[i]!.length,
        sha512: sha512(contents[i]!),
      })
      const blockmap = JSON.parse(
        gunzipSync(readFileSync(join(dir, `${name}.blockmap`))).toString(),
      )
      const size = blockmap.files[0].sizes.reduce((sum: number, value: number) => sum + value, 0)
      expect(size).toBe(contents[i]!.length)
    })
  })

  it('fails without rewriting the feed when a referenced installer is missing', async () => {
    const text = dump({
      files: [{ url: 'missing.dmg', sha512: 'old', size: 1 }],
      path: 'missing.dmg',
    })
    writeFileSync(join(dir, 'latest-mac.yml'), text)
    await expect(refreshMacUpdateFeed(dir)).rejects.toThrow('Missing macOS update artifact')
    expect(readFileSync(join(dir, 'latest-mac.yml'), 'utf8')).toBe(text)
  })

  it('leaves contributor builds without an update feed alone', async () => {
    await expect(refreshMacUpdateFeed(dir)).resolves.toEqual([])
  })
})
