import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * The update-feed side of the packaging config (electron-builder.cjs): the
 * feed is baked in only when GENOFFICE_UPDATE_URL is set (release.yml does so
 * for tag builds), and nothing lets electron-builder invent a publish target
 * on its own.
 */

const require = createRequire(import.meta.url)
const shellRoot = resolve(import.meta.dirname, '..')
const shellPackage = JSON.parse(readFileSync(resolve(shellRoot, 'package.json'), 'utf8')) as {
  version: string
  repository?: unknown
  scripts: Record<string, string>
}

interface BuilderConfig {
  publish?: Array<{ provider: string; url: string; channel: string }>
  nsis: { artifactName?: string }
  win: { target: Array<{ target: string; arch: string[] }> }
  deb: { packageName?: string }
  rpm: { publish?: unknown; packageName?: string }
}

function loadConfig(env: Record<string, string>): BuilderConfig {
  const configModule = { exports: {} as unknown }
  runInNewContext(readFileSync(resolve(shellRoot, 'electron-builder.cjs'), 'utf8'), {
    module: configModule,
    __dirname: shellRoot,
    URL,
    process: { platform: 'linux', arch: 'x64', env, execPath: process.execPath },
    require: (id: string) => {
      if (id === './package.json') return shellPackage
      if (id === 'node:fs') return { ...require(id), existsSync: () => true }
      return require(id)
    },
  })
  return configModule.exports as BuilderConfig
}

describe('electron-builder update feed', () => {
  it('bakes no feed without GENOFFICE_UPDATE_URL', () => {
    expect(loadConfig({}).publish).toBeUndefined()
    // release.yml passes an empty string for non-tag builds
    expect(loadConfig({ GENOFFICE_UPDATE_URL: '' }).publish).toBeUndefined()
  })

  it('bakes the GitHub Releases feed of a tag build', () => {
    const config = loadConfig({
      GENOFFICE_UPDATE_URL: 'https://github.com/dinhthaicx/faamoffice/releases/latest/download/',
    })
    expect(config.publish).toEqual([
      {
        provider: 'generic',
        url: 'https://github.com/dinhthaicx/faamoffice/releases/latest/download',
        channel: 'latest',
      },
    ])
  })

  it('accepts plain http only on loopback (local update tests)', () => {
    expect(loadConfig({ GENOFFICE_UPDATE_URL: 'http://127.0.0.1:8765' }).publish?.[0]?.url).toBe(
      'http://127.0.0.1:8765',
    )
    expect(() => loadConfig({ GENOFFICE_UPDATE_URL: 'http://updates.example.com' })).toThrow(
      /GENOFFICE_UPDATE_URL/,
    )
    expect(() =>
      loadConfig({ GENOFFICE_UPDATE_URL: 'https://user:pw@updates.example.com' }),
    ).toThrow(/GENOFFICE_UPDATE_URL/)
    expect(() => loadConfig({ GENOFFICE_UPDATE_URL: 'not a url' })).toThrow(/GENOFFICE_UPDATE_URL/)
  })

  it('names the Windows installer without spaces (GitHub would turn them into dots)', () => {
    const name = loadConfig({}).nsis.artifactName
    expect(name).toBe('${productName}-Setup-${version}.${ext}')
    expect(name).not.toMatch(/\s/)
  })

  it('keeps the -arm64 suffix on the Windows ARM64 installer', () => {
    // the custom artifactName replaces the default that appended it; the
    // updater and the website pick the ARM installer only by this suffix
    const config = loadConfig({ GENOFFICE_WIN_ARM64: '1' })
    expect(config.win.target).toEqual([{ target: 'nsis', arch: ['arm64'] }])
    expect(config.nsis.artifactName).toBe('${productName}-Setup-${version}-arm64.${ext}')
    expect(loadConfig({}).win.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
  })

  it('keeps the rpm out of latest-linux.yml (the updater derives its name)', () => {
    expect(loadConfig({}).rpm.publish).toBeNull()
  })

  it('names the deb/rpm package as the updater looks it up in dpkg', () => {
    // LINUX_PACKAGE_NAME in src/main/updater.ts: a deb install is recognised
    // by /var/lib/dpkg/info/faamoffice.list (updater.test.ts)
    const config = loadConfig({})
    expect(config.deb.packageName).toBe('faamoffice')
    expect(config.rpm.packageName).toBe('faamoffice')
  })
})

describe('shell package metadata', () => {
  it('never publishes from the dist scripts', () => {
    for (const platform of ['mac', 'win', 'linux']) {
      expect(shellPackage.scripts[`dist:${platform}`]).toMatch(/electron-builder .*--publish never/)
    }
  })

  it('has no "repository" field (electron-builder would infer a GitHub publish target)', () => {
    expect(shellPackage.repository).toBeUndefined()
  })

  it('is never older than the last public release, 0.11.1', () => {
    const [major, minor, patch] = shellPackage.version.split(/[.-]/).map(Number)
    expect(major! * 1e6 + minor! * 1e3 + patch!).toBeGreaterThanOrEqual(11_001)
  })
})
