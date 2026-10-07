import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Microsoft Store mode (src/main/ms-store.ts): the listing the Store build
 * carries in its package.json, the Store-page links, and the command line
 * staying off the PATH (cli-link.ts) in that build.
 */

const electron = vi.hoisted(() => ({ appPath: '' }))
const installCliLink = vi.hoisted(() => vi.fn(() => ({ status: 'linked' })))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '1.2.3',
    getAppPath: () => electron.appPath,
  },
}))

vi.mock('@genoffice/cli/install', () => ({ installCliLink }))

const AUMID = 'FaamOffice.FaamOffice_hangrx54z3vxj!FaamOffice'
const LISTING = { productId: '9P0RJ9J87ZNQ', aumid: AUMID }

let dir: string
const restorers: Array<() => void> = []

function setPlatform(platform: NodeJS.Platform): void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: platform })
  restorers.push(() => Object.defineProperty(process, 'platform', original))
}

/** Electron sets process.windowsStore in an appx; Node has no such property */
function setWindowsStore(value: boolean): void {
  Object.defineProperty(process, 'windowsStore', { value, configurable: true })
  restorers.push(() => {
    delete (process as { windowsStore?: boolean }).windowsStore
  })
}

function writePackageJson(pkg: unknown): void {
  writeFileSync(join(electron.appPath, 'package.json'), JSON.stringify(pkg))
}

beforeEach(() => {
  vi.resetModules()
  installCliLink.mockClear()
  dir = mkdtempSync(join(tmpdir(), 'faamoffice-store-'))
  electron.appPath = dir
})

afterEach(() => {
  while (restorers.length) restorers.pop()!()
  rmSync(dir, { recursive: true, force: true })
})

describe('storeListingFrom', () => {
  it('reads the listing the Store build injects', async () => {
    const { storeListingFrom } = await import('../src/main/ms-store')
    expect(storeListingFrom({ faamofficeStore: LISTING })).toEqual(LISTING)
  })

  it('falls back to FaamOffice’s Store ID and no AUMID for missing or bad metadata', async () => {
    const { storeListingFrom } = await import('../src/main/ms-store')
    const fallback = { productId: '9P0RJ9J87ZNQ', aumid: null }
    expect(storeListingFrom(null)).toEqual(fallback)
    expect(storeListingFrom({})).toEqual(fallback)
    expect(storeListingFrom({ faamofficeStore: 'yes' })).toEqual(fallback)
    expect(
      storeListingFrom({
        faamofficeStore: { productId: 'pdp/../evil', aumid: 'FaamOffice!x"; rm -rf' },
      }),
    ).toEqual(fallback)
    // a well-formed listing of another publisher is kept as it is
    expect(
      storeListingFrom({
        faamofficeStore: { productId: '9NBLGGH4NNS1', aumid: 'Contoso.App_8wekyb3d8bbwe!App' },
      }),
    ).toEqual({ productId: '9NBLGGH4NNS1', aumid: 'Contoso.App_8wekyb3d8bbwe!App' })
  })
})

describe('storeListing', () => {
  it('is null outside the Store package (NSIS, macOS, Linux, dev)', async () => {
    writePackageJson({ faamofficeStore: LISTING })
    setPlatform('win32')
    const { isStoreInstall, storeListing } = await import('../src/main/ms-store')
    expect(isStoreInstall()).toBe(false)
    expect(storeListing()).toBeNull()
  })

  it('ignores a stray windowsStore flag off Windows', async () => {
    setPlatform('darwin')
    setWindowsStore(true)
    const { isStoreInstall } = await import('../src/main/ms-store')
    expect(isStoreInstall()).toBe(false)
  })

  it('reads the packaged package.json once in the Store package', async () => {
    writePackageJson({ name: '@genoffice/shell', faamofficeStore: LISTING })
    setPlatform('win32')
    setWindowsStore(true)
    const { isStoreInstall, storeListing } = await import('../src/main/ms-store')
    expect(isStoreInstall()).toBe(true)
    expect(storeListing()).toEqual(LISTING)
    rmSync(join(dir, 'package.json'))
    expect(storeListing()).toEqual(LISTING)
  })

  it('still knows the Store ID when the package.json cannot be read', async () => {
    setPlatform('win32')
    setWindowsStore(true)
    const { storeListing } = await import('../src/main/ms-store')
    expect(storeListing()).toEqual({ productId: '9P0RJ9J87ZNQ', aumid: null })
  })
})

describe('openStorePage', () => {
  it('opens the listing in the Store app', async () => {
    const { openStorePage } = await import('../src/main/ms-store')
    const openExternal = vi.fn(async (_url: string) => {})
    await openStorePage(LISTING, openExternal)
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(
      'ms-windows-store://pdp/?ProductId=9P0RJ9J87ZNQ',
    )
  })

  it('falls back to the web listing and never throws', async () => {
    const { openStorePage } = await import('../src/main/ms-store')
    const openExternal = vi.fn(async (_url: string) => {
      throw new Error('no handler')
    })
    await expect(openStorePage(LISTING, openExternal)).resolves.toBeUndefined()
    expect(openExternal.mock.calls.map(([url]) => url)).toEqual([
      'ms-windows-store://pdp/?ProductId=9P0RJ9J87ZNQ',
      'https://apps.microsoft.com/detail/9P0RJ9J87ZNQ',
    ])
  })
})

describe('command line in the Store package', () => {
  const realAuthDir = process.env.GENOFFICE_AUTH_DIR

  afterEach(() => {
    if (realAuthDir === undefined) delete process.env.GENOFFICE_AUTH_DIR
    else process.env.GENOFFICE_AUTH_DIR = realAuthDir
  })

  it('neither links it onto the PATH nor writes the launcher file', async () => {
    process.env.GENOFFICE_AUTH_DIR = join(dir, 'auth')
    setPlatform('win32')
    setWindowsStore(true)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { installCliLinkBestEffort } = await import('../src/main/cli-link')
    const settings = join(dir, 'app-settings.json')
    installCliLinkBestEffort(settings)
    expect(installCliLink).not.toHaveBeenCalled()
    expect(existsSync(join(dir, 'auth', 'launcher'))).toBe(false)
    expect(existsSync(settings)).toBe(false)
    expect(log).toHaveBeenCalledWith('[faamoffice] cli link skipped: Microsoft Store install')
    log.mockRestore()
  })
})
