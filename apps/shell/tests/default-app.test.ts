import { describe, expect, it, vi } from 'vitest'
import {
  OFFICE_TYPES,
  createDefaultAppService,
  macAppBundlePath,
  parseMacStatus,
  parseRegValue,
} from '../src/main/default-app'
import type { RunCommand } from '../src/main/default-app'

const ME = 'com.faamoffice.app'
const WPS = 'com.kingsoft.wpsoffice.mac'

describe('Microsoft Store default apps', () => {
  const aumid = 'FaamOffice.FaamOffice_hangrx54z3vxj!FaamOffice'
  const registry = (value: string) => `    Value    REG_SZ    ${value}\r\n`
  const base = {
    platform: 'win32' as const,
    packaged: true,
    exePath: 'C:\\Store\\FaamOffice.exe',
    windowsStore: { aumid },
  }

  it('recognizes generated AppX ProgIds by AUMID instead of NSIS association names', async () => {
    const run = vi.fn<RunCommand>(async (_cmd, args) => {
      if (args.includes('ProgId')) return registry('AppXfaam')
      if (args.includes('AppUserModelID')) return registry(aumid.toUpperCase())
      throw new Error('unexpected query')
    })
    const svc = createDefaultAppService({ ...base, run, openExternal: vi.fn(async () => {}) })
    expect(await svc.status()).toEqual({ state: 'default', others: [], manualOnly: true })
    expect(run.mock.calls.filter(([, args]) => args.includes('AppUserModelID'))).toHaveLength(1)
  })

  it('does not mistake another Store package for FaamOffice', async () => {
    const run = vi.fn<RunCommand>(async (_cmd, args) => {
      if (args.includes('ProgId')) return registry('AppXother')
      if (args.includes('AppUserModelID')) return registry('Other.App_8wekyb3d8bbwe!App')
      return registry('Another editor')
    })
    const svc = createDefaultAppService({ ...base, run, openExternal: vi.fn(async () => {}) })
    expect(await svc.status()).toEqual({
      state: 'other',
      others: ['Another editor'],
      manualOnly: true,
    })
  })

  it('opens its own Default apps page and falls back if Windows rejects the deep link', async () => {
    const openExternal = vi.fn(async (url: string) => {
      if (url.includes('?')) throw new Error('unsupported deep link')
    })
    const svc = createDefaultAppService({ ...base, run: vi.fn(async () => ''), openExternal })
    await svc.set()
    expect(openExternal.mock.calls.map(([url]) => url)).toEqual([
      `ms-settings:defaultapps?registeredAUMID=${encodeURIComponent(aumid)}`,
      'ms-settings:defaultapps',
    ])
  })

  it('reports an unknown status without an AUMID and opens the generic Settings page', async () => {
    const run = vi.fn<RunCommand>()
    const openExternal = vi.fn(async () => {})
    const svc = createDefaultAppService({
      ...base,
      windowsStore: { aumid: null },
      run,
      openExternal,
    })
    expect(await svc.set()).toEqual({ state: 'unknown', others: [], manualOnly: true })
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('ms-settings:defaultapps')
    expect(run).not.toHaveBeenCalled()
  })
})

function macStatusJson(
  owner: (uti: string) => string | null,
  name: string | null = 'WPS Office',
): string {
  return JSON.stringify({
    me: ME,
    types: OFFICE_TYPES.map((t) => {
      const id = owner(t.uti)
      return { uti: t.uti, id, name: id === ME ? 'FaamOffice' : id ? name : null }
    }),
  })
}

describe('macAppBundlePath', () => {
  it('walks up from the executable to the .app bundle', () => {
    expect(macAppBundlePath('/Applications/FaamOffice.app/Contents/MacOS/FaamOffice')).toBe(
      '/Applications/FaamOffice.app',
    )
    expect(macAppBundlePath('/usr/local/bin/electron')).toBeNull()
  })
})

describe('parseMacStatus', () => {
  it('is default when every type resolves to our bundle id', () => {
    expect(parseMacStatus(macStatusJson(() => ME))).toEqual({
      state: 'default',
      others: [],
      manualOnly: false,
    })
  })

  it('names the other app once even when it owns several types', () => {
    expect(parseMacStatus(macStatusJson(() => WPS))).toEqual({
      state: 'other',
      others: ['WPS Office'],
      manualOnly: false,
    })
  })

  it('is "other" when a single type belongs to someone else', () => {
    const json = macStatusJson((uti) => (uti.includes('presentationml') ? WPS : ME))
    expect(parseMacStatus(json).state).toBe('other')
  })

  it('falls back to the bundle id when the owner has no display name', () => {
    expect(parseMacStatus(macStatusJson(() => 'com.example.x', null)).others).toEqual([
      'com.example.x',
    ])
  })

  it('treats a type with no handler as not yet claimed', () => {
    const json = macStatusJson((uti) => (uti.includes('macroenabled') ? null : ME))
    expect(parseMacStatus(json)).toEqual({ state: 'other', others: [], manualOnly: false })
  })

  it('is unknown when LaunchServices has no handler at all', () => {
    expect(parseMacStatus(macStatusJson(() => null)).state).toBe('unknown')
  })
})

describe('parseRegValue', () => {
  it('reads the data column of a reg query line', () => {
    const out = [
      '',
      'HKEY_CURRENT_USER\\Software\\...\\.docx\\UserChoice',
      '    ProgId    REG_SZ    Word.Document.12',
      '',
    ].join('\r\n')
    expect(parseRegValue(out)).toBe('Word.Document.12')
    expect(parseRegValue('    (Default)    REG_SZ    Word Document\r\n')).toBe('Word Document')
    expect(
      parseRegValue('ERROR: The system was unable to find the specified registry key'),
    ).toBeNull()
  })
})

describe('createDefaultAppService', () => {
  const base = {
    packaged: true,
    exePath: '/Applications/FaamOffice.app/Contents/MacOS/FaamOffice',
    openExternal: vi.fn(async () => {}),
  }

  it('is unsupported in dev builds and never runs a command', async () => {
    const run = vi.fn<RunCommand>()
    const svc = createDefaultAppService({ ...base, platform: 'darwin', packaged: false, run })
    expect((await svc.status()).state).toBe('unsupported')
    expect((await svc.set()).state).toBe('unsupported')
    expect(run).not.toHaveBeenCalled()
  })

  it('mac: claims every UTI through osascript and re-reads the status', async () => {
    let owner = WPS
    const run = vi.fn<RunCommand>(async (cmd, args) => {
      expect(cmd).toBe('osascript')
      expect(args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e'])
      expect(args[4]).toBe('/Applications/FaamOffice.app')
      expect(args.slice(5)).toEqual(OFFICE_TYPES.map((t) => t.uti))
      if (args[3].includes('LSSetDefaultRoleHandlerForContentType')) {
        owner = ME
        return JSON.stringify({ me: ME, failed: [] })
      }
      return macStatusJson(() => owner)
    })
    const svc = createDefaultAppService({ ...base, platform: 'darwin', run })
    expect(await svc.status()).toMatchObject({ state: 'other', others: ['WPS Office'] })
    expect(await svc.set()).toMatchObject({ state: 'default', others: [] })
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('linux: compares xdg-mime answers with our desktop id', async () => {
    const calls: string[][] = []
    const run = vi.fn<RunCommand>(async (cmd, args) => {
      calls.push([cmd, ...args])
      if (args[0] === 'query')
        return args[2].includes('spreadsheetml')
          ? 'wps-office-et.desktop\n'
          : 'faamoffice.desktop\n'
      return ''
    })
    const svc = createDefaultAppService({
      ...base,
      platform: 'linux',
      run,
      readFile: (p) => {
        if (p.endsWith('/usr/share/applications/faamoffice.desktop'))
          return '[Desktop Entry]\nName=FaamOffice\n'
        if (p.endsWith('/usr/share/applications/wps-office-et.desktop'))
          return '[Desktop Entry]\nName=WPS Spreadsheets\n'
        throw new Error('ENOENT')
      },
    })
    expect(await svc.status()).toEqual({
      state: 'other',
      others: ['WPS Spreadsheets'],
      manualOnly: false,
    })
    await svc.set()
    expect(calls.find((c) => c[1] === 'default')).toEqual([
      'xdg-mime',
      'default',
      'faamoffice.desktop',
      ...OFFICE_TYPES.map((t) => t.mime),
    ])
  })

  it('linux: unsupported without an installed faamoffice.desktop (AppImage)', async () => {
    const run = vi.fn<RunCommand>(async () => 'wps-office-wps.desktop\n')
    const readFile = vi.fn((_p: string): string => {
      throw new Error('ENOENT')
    })
    const svc = createDefaultAppService({ ...base, platform: 'linux', run, readFile })
    const unsupported = { state: 'unsupported', others: [], manualOnly: false }
    expect(await svc.status()).toEqual(unsupported)
    expect(await svc.set()).toEqual(unsupported)
    // never asked xdg-mime, never wrote a dangling association
    expect(run).not.toHaveBeenCalled()
    const probed = readFile.mock.calls.map(([p]) => p)
    expect(probed).toContain('/usr/share/applications/faamoffice.desktop')
    expect(probed).toContain('/usr/local/share/applications/faamoffice.desktop')
    expect(probed.some((p) => p.endsWith('.local/share/applications/faamoffice.desktop'))).toBe(
      true,
    )
  })

  it('windows: reads UserChoice ProgIds, names them, and only opens the settings page', async () => {
    const run = vi.fn<RunCommand>(async (_cmd, args) => {
      const key = args[1]
      if (key.includes('UserChoice')) {
        if (key.includes('.pptx')) throw new Error('no user choice')
        return key.includes('.docx')
          ? '    ProgId    REG_SZ    Word.Document.12\r\n'
          : '    ProgId    REG_SZ    Excel Workbook\r\n'
      }
      if (key === 'HKCR\\.pptx') return '    (Default)    REG_SZ    PowerPoint Presentation\r\n'
      if (key === 'HKCR\\Word.Document.12')
        return '    (Default)    REG_SZ    Microsoft Word Document\r\n'
      throw new Error('missing')
    })
    const openExternal = vi.fn(async () => {})
    const svc = createDefaultAppService({ ...base, platform: 'win32', run, openExternal })
    expect(await svc.status()).toEqual({
      state: 'other',
      others: ['Microsoft Word Document'],
      manualOnly: true,
    })
    await svc.set()
    expect(openExternal).toHaveBeenCalledWith('ms-settings:defaultapps')
  })

  describe('windows: Default apps deep link', () => {
    const HKCU_APPS = 'HKCU\\Software\\RegisteredApplications'
    const HKLM_APPS = 'HKLM\\Software\\RegisteredApplications'
    const registered = (hive: string) =>
      [
        '',
        `${hive}\\Software\\RegisteredApplications`,
        '    FaamOffice    REG_SZ    Software\\FaamOffice\\Capabilities',
        '',
      ].join('\r\n')
    const notFound = () =>
      Promise.reject(
        new Error('ERROR: The system was unable to find the specified registry key or value.'),
      )

    /** registry: answer for a RegisteredApplications query; every other key is absent */
    function winSet(registry: (key: string) => Promise<string>) {
      const queries: string[][] = []
      const run = vi.fn<RunCommand>((cmd, args) => {
        if (!args[1].endsWith('\\RegisteredApplications')) return notFound()
        expect(cmd).toBe('reg')
        queries.push(args)
        return registry(args[1])
      })
      const openExternal = vi.fn(async (_url: string) => {})
      const svc = createDefaultAppService({ ...base, platform: 'win32', run, openExternal })
      return { svc, openExternal, queries }
    }

    it('opens our own page for a per-user registration', async () => {
      const { svc, openExternal, queries } = winSet(async (key) => registered(key.slice(0, 4)))
      expect((await svc.set()).manualOnly).toBe(true)
      expect(openExternal).toHaveBeenCalledExactlyOnceWith(
        'ms-settings:defaultapps?registeredAppUser=FaamOffice',
      )
      // HKCU wins; the machine hive is not consulted
      expect(queries).toEqual([['query', HKCU_APPS, '/v', 'FaamOffice']])
    })

    it('opens our own page for a per-machine registration', async () => {
      const { svc, openExternal, queries } = winSet((key) =>
        key === HKLM_APPS ? Promise.resolve(registered('HKLM')) : notFound(),
      )
      await svc.set()
      expect(openExternal).toHaveBeenCalledExactlyOnceWith(
        'ms-settings:defaultapps?registeredAppMachine=FaamOffice',
      )
      expect(queries).toEqual([
        ['query', HKCU_APPS, '/v', 'FaamOffice'],
        ['query', HKLM_APPS, '/v', 'FaamOffice'],
      ])
    })

    it('opens the generic page for an install without the registration', async () => {
      const { svc, openExternal, queries } = winSet(notFound)
      expect((await svc.set()).manualOnly).toBe(true)
      expect(openExternal).toHaveBeenCalledExactlyOnceWith('ms-settings:defaultapps')
      expect(queries).toHaveLength(2)
    })

    it('treats unreadable registry answers as unregistered and never throws', async () => {
      const { svc, openExternal } = winSet((key) => {
        // reg itself missing / blocked: the runner throws before returning a promise
        if (key === HKLM_APPS) throw new Error('spawn reg ENOENT')
        // a value-less answer is no registration
        return Promise.resolve(`\r\n${HKCU_APPS}\r\n\r\n`)
      })
      await expect(svc.set()).resolves.toMatchObject({ manualOnly: true })
      expect(openExternal).toHaveBeenCalledExactlyOnceWith('ms-settings:defaultapps')
    })

    it('still resolves with the status when Settings cannot be opened', async () => {
      const { svc, openExternal } = winSet(async () => registered('HKCU'))
      openExternal.mockRejectedValueOnce(new Error('no handler for ms-settings'))
      await expect(svc.set()).resolves.toEqual({ state: 'unknown', others: [], manualOnly: true })
      expect(openExternal).toHaveBeenCalledTimes(1)
    })
  })

  it('reports unknown instead of throwing when the probe fails', async () => {
    const run = vi.fn<RunCommand>(async () => {
      throw new Error('osascript missing')
    })
    const svc = createDefaultAppService({ ...base, platform: 'darwin', run })
    expect((await svc.status()).state).toBe('unknown')
  })
})
