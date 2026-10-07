import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// a dependency-free CommonJS script run by the release workflow; load via
// createRequire since this test file is ESM
const require = createRequire(import.meta.url)
const SCRIPT = resolve(import.meta.dirname, '../../../scripts/release-feed.cjs')
const { prepare, rewriteFeed, shouldMarkLatest, tagVersion, listFiles } = require(SCRIPT) as {
  prepare: (opts: {
    dir: string
    out: string
    tag: string
    repo: string
    assetNames: string[]
  }) => string[]
  rewriteFeed: (
    text: string,
    opts: { feed: string; tag: string; repo: string; assets: Set<string>; dir?: string },
  ) => { text: string; files: string[] }
  shouldMarkLatest: (tag: string, current?: string) => boolean
  tagVersion: (tag: string) => string
  listFiles: (text: string) => Array<{ name: string; sha512?: string; size?: string }>
}

/**
 * The release workflow's feed step (scripts/release-feed.cjs): the three
 * electron-updater feeds must match the tag and the uploaded assets, every
 * file URL gets pinned to the tag, and Latest only ever moves forward.
 */

const REPO = 'dinhthaicx/faamoffice'
const PINNED = 'https://github.com/dinhthaicx/faamoffice/releases/download/v0.12.0'
const sha512 = (data: string): string => createHash('sha512').update(data).digest('base64')

const EXE = 'installer bytes'
const DMG_ARM = 'arm dmg bytes'
const ZIP_ARM = 'arm zip bytes'
const APPIMAGE = 'appimage bytes'
const DEB = 'deb bytes'

/** feed files as electron-builder (js-yaml) writes them */
function feeds(version = '0.12.0'): Record<string, string> {
  return {
    'latest.yml': [
      `version: ${version}`,
      'files:',
      `  - url: FaamOffice-Setup-${version}.exe`,
      `    sha512: ${sha512(EXE)}`,
      `    size: ${EXE.length}`,
      `path: FaamOffice-Setup-${version}.exe`,
      `sha512: ${sha512(EXE)}`,
      "releaseDate: '2026-10-07T01:02:03.000Z'",
      '',
    ].join('\n'),
    'latest-mac.yml': [
      `version: ${version}`,
      'files:',
      `  - url: FaamOffice-${version}-arm64-mac.zip`,
      `    sha512: ${sha512(ZIP_ARM)}`,
      `    size: ${ZIP_ARM.length}`,
      `  - url: FaamOffice-${version}-arm64.dmg`,
      `    sha512: ${sha512(DMG_ARM)}`,
      `    size: ${DMG_ARM.length}`,
      `path: FaamOffice-${version}-arm64-mac.zip`,
      `sha512: ${sha512(ZIP_ARM)}`,
      "releaseDate: '2026-10-07T01:02:03.000Z'",
      '',
    ].join('\n'),
    'latest-linux.yml': [
      `version: ${version}`,
      'files:',
      `  - url: FaamOffice-${version}.AppImage`,
      `    sha512: ${sha512(APPIMAGE)}`,
      `    size: ${APPIMAGE.length}`,
      '    blockMapSize: 1234',
      `  - url: faamoffice_${version}_amd64.deb`,
      `    sha512: ${sha512(DEB)}`,
      `    size: ${DEB.length}`,
      `path: FaamOffice-${version}.AppImage`,
      `sha512: ${sha512(APPIMAGE)}`,
      "releaseDate: '2026-10-07T01:02:03.000Z'",
      '',
    ].join('\n'),
  }
}

const ASSETS = [
  'FaamOffice-Setup-0.12.0.exe',
  'FaamOffice-Setup-0.12.0.exe.blockmap',
  'FaamOffice-0.12.0-arm64-mac.zip',
  'FaamOffice-0.12.0-arm64.dmg',
  'FaamOffice-0.12.0.AppImage',
  'faamoffice_0.12.0_amd64.deb',
  'faamoffice-0.12.0.x86_64.rpm',
]

describe('release-feed: rewriteFeed', () => {
  const opts = { feed: 'latest.yml', tag: 'v0.12.0', repo: REPO, assets: new Set(ASSETS) }

  it('pins every url and path to the tag and keeps every other line', () => {
    const { text, files } = rewriteFeed(feeds()['latest.yml']!, opts)
    expect(files).toEqual(['FaamOffice-Setup-0.12.0.exe'])
    expect(text).toContain(`  - url: ${PINNED}/FaamOffice-Setup-0.12.0.exe\n`)
    expect(text).toContain(`\npath: ${PINNED}/FaamOffice-Setup-0.12.0.exe\n`)
    expect(text).toContain(`    sha512: ${sha512(EXE)}\n`)
    expect(text).toContain("releaseDate: '2026-10-07T01:02:03.000Z'")
    expect(text.split('\n')).toHaveLength(feeds()['latest.yml']!.split('\n').length)
  })

  it('re-pins feeds whose URLs are already absolute and unquotes YAML strings', () => {
    const quoted = feeds()['latest.yml']!.replace(
      '  - url: FaamOffice-Setup-0.12.0.exe',
      "  - url: 'https://example.com/old/FaamOffice-Setup-0.12.0.exe'",
    )
    const { text } = rewriteFeed(quoted, opts)
    expect(text).toContain(`  - url: ${PINNED}/FaamOffice-Setup-0.12.0.exe\n`)
    expect(text).not.toContain('example.com')
  })

  it('rejects a feed whose version is not the tag', () => {
    expect(() => rewriteFeed(feeds('0.11.9')['latest.yml']!, opts)).toThrow(/does not match tag/)
  })

  it('rejects a feed that references a file the release does not have', () => {
    expect(() =>
      rewriteFeed(feeds()['latest.yml']!, { ...opts, assets: new Set(['other.exe']) }),
    ).toThrow(/FaamOffice-Setup-0.12.0.exe is not an asset/)
  })

  it('reads the file entries with their digests', () => {
    expect(listFiles(feeds()['latest-linux.yml']!)).toEqual([
      {
        name: 'FaamOffice-0.12.0.AppImage',
        sha512: sha512(APPIMAGE),
        size: String(APPIMAGE.length),
      },
      { name: 'faamoffice_0.12.0_amd64.deb', sha512: sha512(DEB), size: String(DEB.length) },
    ])
  })
})

describe('release-feed: prepare', () => {
  let dir: string
  let out: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'faamoffice-feed-'))
    out = join(dir, 'feed')
    for (const [name, text] of Object.entries(feeds())) await writeFile(join(dir, name), text)
    await writeFile(join(dir, 'FaamOffice-Setup-0.12.0.exe'), EXE)
    await writeFile(join(dir, 'FaamOffice-0.12.0-arm64.dmg'), DMG_ARM)
    await writeFile(join(dir, 'FaamOffice-0.12.0-arm64-mac.zip'), ZIP_ARM)
    await writeFile(join(dir, 'FaamOffice-0.12.0.AppImage'), APPIMAGE)
    await writeFile(join(dir, 'faamoffice_0.12.0_amd64.deb'), DEB)
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const run = (overrides: Partial<Parameters<typeof prepare>[0]> = {}) =>
    prepare({ dir, out, tag: 'v0.12.0', repo: REPO, assetNames: ASSETS, ...overrides })

  it('writes all three pinned feeds', async () => {
    const written = run()
    expect(written.map((file) => file.slice(out.length + 1))).toEqual([
      'latest.yml',
      'latest-mac.yml',
      'latest-linux.yml',
    ])
    const mac = await readFile(join(out, 'latest-mac.yml'), 'utf8')
    expect(mac).toContain(`  - url: ${PINNED}/FaamOffice-0.12.0-arm64.dmg\n`)
    expect(mac).toContain(`path: ${PINNED}/FaamOffice-0.12.0-arm64-mac.zip\n`)
    const linux = await readFile(join(out, 'latest-linux.yml'), 'utf8')
    expect(linux).toContain(`  - url: ${PINNED}/faamoffice_0.12.0_amd64.deb\n`)
    expect(linux).toContain('    blockMapSize: 1234\n')
    // the inputs stay untouched
    expect(await readFile(join(dir, 'latest.yml'), 'utf8')).toBe(feeds()['latest.yml'])
  })

  it('requires every platform feed', async () => {
    await rm(join(dir, 'latest-linux.yml'))
    expect(() => run()).toThrow(/latest-linux.yml is missing/)
  })

  it('refuses a local artifact that no longer matches its feed entry', async () => {
    // e.g. a dmg stapled after electron-builder hashed it
    await writeFile(join(dir, 'FaamOffice-0.12.0-arm64.dmg'), 'changed after hashing!')
    expect(() => run()).toThrow(/FaamOffice-0.12.0-arm64.dmg is .* bytes|does not match the sha512/)
  })

  it('refuses a bad tag or repository', () => {
    expect(() => run({ tag: '0.12.0' })).toThrow(/is not v/)
    expect(() => run({ repo: 'not a repo' })).toThrow(/owner\/name/)
  })

  it('runs as the workflow calls it', async () => {
    const assets = join(dir, 'assets.txt')
    await writeFile(assets, `${ASSETS.join('\n')}\n`)
    const ok = spawnSync(
      process.execPath,
      [
        SCRIPT,
        'prepare',
        '--dir',
        dir,
        '--out',
        out,
        '--tag',
        'v0.12.0',
        '--repo',
        REPO,
        '--assets',
        assets,
      ],
      { encoding: 'utf8' },
    )
    expect(ok.status).toBe(0)
    expect(ok.stdout).toContain('latest-mac.yml')
    await writeFile(assets, 'nothing-uploaded.exe\n')
    const failed = spawnSync(
      process.execPath,
      [
        SCRIPT,
        'prepare',
        '--dir',
        dir,
        '--out',
        out,
        '--tag',
        'v0.12.0',
        '--repo',
        REPO,
        '--assets',
        assets,
      ],
      { encoding: 'utf8' },
    )
    expect(failed.status).toBe(1)
    expect(failed.stderr).toMatch(/release-feed: .* is not an asset/)
  })
})

describe('release-feed: Latest only moves forward', () => {
  it('marks a newer final release as Latest', () => {
    expect(shouldMarkLatest('v0.12.0', 'v0.11.1')).toBe(true)
    expect(shouldMarkLatest('v0.12.0', '')).toBe(true)
    expect(shouldMarkLatest('v0.12.0', undefined)).toBe(true)
  })

  it('keeps a re-run of the current Latest as Latest', () => {
    expect(shouldMarkLatest('v0.12.0', 'v0.12.0')).toBe(true)
  })

  it('never lets a backport or a slow older run take the feed back', () => {
    expect(shouldMarkLatest('v0.11.2', 'v0.12.0')).toBe(false)
    expect(shouldMarkLatest('v0.12.0', 'v0.12.1')).toBe(false)
  })

  it('never marks a prerelease as Latest', () => {
    expect(shouldMarkLatest('v0.13.0-beta.1', 'v0.12.0')).toBe(false)
    expect(shouldMarkLatest('v0.13.0-beta.1', '')).toBe(false)
  })

  it('does not freeze the feed behind an unrecognisable Latest tag', () => {
    expect(shouldMarkLatest('v0.12.0', 'linux-v0.5.149')).toBe(true)
  })

  it('prints the decision for the workflow', () => {
    const run = (args: string[]) =>
      spawnSync(process.execPath, [SCRIPT, 'latest', ...args], { encoding: 'utf8' }).stdout.trim()
    expect(run(['--tag', 'v0.12.0', '--current', 'v0.11.1'])).toBe('true')
    expect(run(['--tag', 'v0.11.2', '--current', 'v0.12.0'])).toBe('false')
    expect(run(['--tag', 'v0.12.0', '--current'])).toBe('true')
  })

  it('parses release tags', () => {
    expect(tagVersion('v0.12.0')).toBe('0.12.0')
    expect(tagVersion('v0.12.0-beta.1')).toBe('0.12.0-beta.1')
    expect(() => tagVersion('v0.12')).toThrow()
    expect(() => tagVersion('release-0.12.0')).toThrow()
  })
})
