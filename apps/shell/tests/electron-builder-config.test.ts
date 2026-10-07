import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * The update-feed side of the packaging config (electron-builder.cjs): the
 * feed is baked in only when GENOFFICE_UPDATE_URL is set (release.yml does so
 * for tag builds), and nothing lets electron-builder invent a publish target
 * on its own. Also the Microsoft Store pass (GENOFFICE_APPX=1).
 */

const require = createRequire(import.meta.url)
const shellRoot = resolve(import.meta.dirname, '..')
const shellPackage = JSON.parse(readFileSync(resolve(shellRoot, 'package.json'), 'utf8')) as {
  name: string
  version: string
  repository?: unknown
  scripts: Record<string, string>
}

interface BuilderConfig {
  publish?: Array<{ provider: string; url: string; channel: string }> | null
  nsis: { artifactName?: string }
  win: {
    target: Array<{ target: string; arch: string[] }>
    signExecutable?: boolean
    signtoolOptions?: unknown
  }
  deb: { packageName?: string }
  rpm: { publish?: unknown; packageName?: string }
  appx?: Record<string, unknown>
  fileAssociations: Array<{ ext: string }>
  extraMetadata?: Record<string, unknown>
  beforePack: (context: { targets: Array<{ name: string }> }) => Promise<void>
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

describe('electron-builder Microsoft Store appx (GENOFFICE_APPX=1)', () => {
  const STORE_ENV = { GENOFFICE_APPX: '1' }
  const TAG_FEED = 'https://github.com/dinhthaicx/faamoffice/releases/latest/download'

  it('is off by default: the NSIS build carries no Store identity or marker', () => {
    const config = loadConfig({ GENOFFICE_UPDATE_URL: TAG_FEED })
    expect(config.appx).toBeUndefined()
    expect(config.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
    expect(config.extraMetadata?.faamofficeStore).toBeUndefined()
  })

  it('packages the x64 appx with the identity reserved in Partner Center', () => {
    const config = loadConfig(STORE_ENV)
    expect(config.win.target).toEqual([{ target: 'appx', arch: ['x64'] }])
    expect(config.appx).toEqual({
      identityName: 'FaamOffice.FaamOffice',
      publisher: 'CN=7AA455FF-2513-4C36-8C88-729BB45AC901',
      publisherDisplayName: 'FaamOffice',
      applicationId: 'FaamOffice',
      displayName: 'FaamOffice',
      // the build/appx tiles are transparent: Start plates them white
      backgroundColor: '#FFFFFF',
      showNameOnTiles: false,
      languages: ['en-US', 'vi-VN'],
      minVersion: '10.0.17763.0',
      artifactName: 'FaamOffice-${version}-store.${ext}',
    })
  })

  it('marks the packaged app as the Store build (src/main/ms-store.ts reads it)', () => {
    expect(loadConfig(STORE_ENV).extraMetadata?.faamofficeStore).toEqual({
      productId: '9P0RJ9J87ZNQ',
      aumid: 'FaamOffice.FaamOffice_hangrx54z3vxj!FaamOffice',
    })
  })

  it('merges the marker into the other injected metadata', () => {
    const config = loadConfig({
      ...STORE_ENV,
      FAAMOFFICE_ACCOUNT_URL: 'https://faamoffice.net/',
      GENOFFICE_GA4_MEASUREMENT_ID: 'G-TEST',
      GENOFFICE_GA4_API_SECRET: 'secret',
    })
    expect(config.extraMetadata).toEqual({
      genofficeAnalytics: { measurementId: 'G-TEST', apiSecret: 'secret' },
      faamofficeAccount: { baseUrl: 'https://faamoffice.net' },
      faamofficeStore: {
        productId: '9P0RJ9J87ZNQ',
        aumid: 'FaamOffice.FaamOffice_hangrx54z3vxj!FaamOffice',
      },
    })
  })

  it('bakes no update feed, even on tag builds (the Store updates it)', () => {
    // publish: null also stops electron-builder from inferring a provider
    expect(loadConfig(STORE_ENV).publish).toBeNull()
    expect(loadConfig({ ...STORE_ENV, GENOFFICE_UPDATE_URL: TAG_FEED }).publish).toBeNull()
  })

  it('signs nothing (the Store signs the package it distributes)', () => {
    const config = loadConfig({ ...STORE_ENV, GENOFFICE_WIN_SIGN_MODE: 'production' })
    expect(config.win.signtoolOptions).toBeUndefined()
    expect(config.win.signExecutable).toBe(false)
  })

  it('refuses the ARM64 switch (the Store package is x64 only)', () => {
    expect(() => loadConfig({ ...STORE_ENV, GENOFFICE_WIN_ARM64: '1' })).toThrow(/GENOFFICE_APPX/)
  })

  it('refuses an appx target without the Store identity', async () => {
    await expect(loadConfig({}).beforePack({ targets: [{ name: 'appx' }] })).rejects.toThrow(
      /GENOFFICE_APPX=1/,
    )
  })

  it('writes a manifest with one valid file type association per extension', async () => {
    const config = loadConfig(STORE_ENV)
    const manifest = await renderAppxManifest(config)
    expect(manifest).toContain('<Identity Name="FaamOffice.FaamOffice"')
    expect(manifest).toContain("Publisher='CN=7AA455FF-2513-4C36-8C88-729BB45AC901'")
    expect(manifest).toContain('<PublisherDisplayName>FaamOffice</PublisherDisplayName>')
    expect(manifest).toContain('<Application Id="FaamOffice" Executable="app\\FaamOffice.exe"')
    expect(manifest).toContain('BackgroundColor="#FFFFFF"')
    expect(manifest).toContain('MinVersion="10.0.17763.0"')
    expect(manifest).toMatch(/<Resource Language="en-US" \/>\s*<Resource Language="vi-VN" \/>/)
    // the generated build/appx tile set, no name drawn over it
    expect(manifest).toContain('Square310x310Logo="assets\\LargeTile.png"')
    expect(manifest).toContain('Square71x71Logo="assets\\SmallTile.png"')
    expect(manifest).not.toContain('ShowNameOnTiles')

    const exts = config.fileAssociations.map((association) => association.ext)
    const declared = [...manifest.matchAll(/<uap:FileTypeAssociation Name="([^"]*)">/g)].map(
      (match) => match[1],
    )
    expect(declared).toEqual(exts)
    expect(new Set(declared).size).toBe(declared.length)
    // FileTypeAssociation@Name: lowercase letters, digits, '.', '-', '_'; 1-100 chars
    for (const name of declared) expect(name).toMatch(/^[a-z0-9_-][a-z0-9._-]{0,99}$/)
    const fileTypes = [...manifest.matchAll(/<uap:FileType>([^<]*)<\/uap:FileType>/g)].map(
      (match) => match[1],
    )
    expect(fileTypes).toEqual(exts.map((ext) => `.${ext}`))
    expect(manifest.match(/<uap:Extension Category="windows\.fileTypeAssociation">/g)).toHaveLength(
      exts.length,
    )
    expect(manifest.match(/<\/uap:Extension>/g)).toHaveLength(exts.length)
  })
})

/**
 * The AppxManifest.xml electron-builder writes for this config: its own
 * template and macro expansion (AppXTarget#writeManifest), run on a minimal
 * packager so it needs neither Windows nor a packaged app.
 */
async function renderAppxManifest(config: BuilderConfig): Promise<string> {
  const appxTarget = require('app-builder-lib/out/targets/AppxTarget.js') as {
    default: { prototype: Record<string, (...args: unknown[]) => Promise<void> | string> }
  }
  const { Arch, deepAssign } = require('builder-util') as {
    Arch: { x64: number }
    deepAssign: (...objects: unknown[]) => Record<string, unknown>
  }
  const proto = appxTarget.default.prototype
  const target = {
    options: deepAssign({}, config.win, config.appx),
    packager: {
      config,
      platformSpecificBuildOptions: config.win,
      info: { metadata: { dependencies: {} }, appDir: shellRoot },
      appInfo: {
        productFilename: 'FaamOffice',
        productName: 'FaamOffice',
        name: shellPackage.name,
        description: 'FaamOffice',
        companyName: 'FaamOffice',
        getVersionInWeirdWindowsForm: () => '1.2.3.0',
      },
      getResource: async () => null,
    },
    getCapabilities: proto.getCapabilities,
    getExtensions: proto.getExtensions,
  }
  const dir = mkdtempSync(join(tmpdir(), 'faamoffice-appx-'))
  try {
    const out = join(dir, 'AppxManifest.xml')
    const assets = readdirSync(resolve(shellRoot, 'build/appx'))
    await proto.writeManifest!.call(target, out, Arch.x64, config.appx?.publisher, assets)
    return readFileSync(out, 'utf8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('shell package metadata', () => {
  it('never publishes from the dist scripts', () => {
    for (const platform of ['mac', 'win', 'win:store', 'linux']) {
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
