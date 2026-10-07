import { describe, expect, it, vi } from 'vitest'
import type { LoginItemSettings } from 'electron'
import {
  LINUX_AUTOSTART_FILE,
  createLoginItemService,
  linuxAutostartDir,
  linuxAutostartEntry,
  loginItemsSettingsUrl,
  parseDesktopEntry,
  parseDesktopExecProgram,
  quoteDesktopExec,
  runningAppImage,
} from '../src/main/login-item'
import type { LoginItemDeps } from '../src/main/login-item'

function enoent(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
    code: 'ENOENT',
  })
}

/** in-memory fs that records every path it touches */
function memoryFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial))
  const dirs = new Set<string>()
  const fs = {
    readFile: vi.fn((path: string) => {
      const text = files.get(path)
      if (text === undefined) throw enoent(path)
      return text
    }),
    writeFile: vi.fn((path: string, data: string) => {
      files.set(path, data)
    }),
    unlink: vi.fn((path: string) => {
      if (!files.delete(path)) throw enoent(path)
    }),
    mkdir: vi.fn((path: string) => {
      dirs.add(path)
    }),
    exists: vi.fn((path: string) => files.has(path) || dirs.has(path)),
  }
  return { fs, files, dirs }
}

function deps(overrides: Partial<LoginItemDeps>): LoginItemDeps {
  return {
    platform: 'darwin',
    packaged: true,
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings: () => undefined,
    execPath: '/Applications/FaamOffice.app/Contents/MacOS/FaamOffice',
    env: { HOME: '/Users/me' },
    fs: memoryFs().fs,
    ...overrides,
  }
}

/** fake Electron login item store for macOS (SMAppService status) */
function macLoginItems(initial: LoginItemSettings['status'] = 'not-registered') {
  let status = initial
  return {
    get status() {
      return status
    },
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: status === 'enabled', status })),
    setLoginItemSettings: vi.fn((settings: { openAtLogin?: boolean }) => {
      status = settings.openAtLogin ? 'enabled' : 'not-registered'
    }),
    requireApproval() {
      status = 'requires-approval'
    },
  }
}

describe('dev / unsupported builds', () => {
  it.each(['darwin', 'win32', 'linux'] as const)(
    'never registers an unpackaged %s build',
    (platform) => {
      const set = vi.fn()
      const { fs } = memoryFs()
      const svc = createLoginItemService(
        deps({ platform, packaged: false, setLoginItemSettings: set, fs }),
      )
      expect(svc.status()).toEqual({ supported: false, enabled: false })
      expect(svc.set(true)).toEqual({ supported: false, enabled: false })
      expect(set).not.toHaveBeenCalled()
      expect(fs.writeFile).not.toHaveBeenCalled()
      expect(fs.mkdir).not.toHaveBeenCalled()
    },
  )

  it('is unsupported on other platforms', () => {
    const svc = createLoginItemService(deps({ platform: 'freebsd' }))
    expect(svc.status()).toEqual({ supported: false, enabled: false })
  })

  it('never reads or writes Electron login items for a Microsoft Store install', () => {
    const get = vi.fn(() => ({ openAtLogin: true }))
    const set = vi.fn()
    const svc = createLoginItemService(
      deps({
        platform: 'win32',
        windowsStore: true,
        getLoginItemSettings: get,
        setLoginItemSettings: set,
      }),
    )
    expect(svc.status()).toEqual({ supported: false, enabled: false })
    expect(svc.set(true)).toEqual({ supported: false, enabled: false })
    expect(svc.set(false)).toEqual({ supported: false, enabled: false })
    expect(get).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it('is unsupported on Linux without a usable config/home directory', () => {
    const svc = createLoginItemService(deps({ platform: 'linux', env: {} }))
    expect(svc.status().supported).toBe(false)
  })
})

describe('macOS', () => {
  it('registers through setLoginItemSettings and reads the status back', () => {
    const items = macLoginItems()
    const svc = createLoginItemService(deps(items))
    expect(svc.status()).toEqual({ supported: true, enabled: false })

    expect(svc.set(true)).toEqual({ supported: true, enabled: true })
    expect(items.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true })

    expect(svc.set(false)).toEqual({ supported: true, enabled: false })
    expect(items.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false })
  })

  it('maps SMAppService "requires-approval" to enabled + needsApproval', () => {
    const items = macLoginItems()
    items.setLoginItemSettings.mockImplementation(() => items.requireApproval())
    const svc = createLoginItemService(deps(items))
    expect(svc.set(true)).toEqual({ supported: true, enabled: true, needsApproval: true })
  })

  // whichever openAtLogin Electron reports while approval is pending, the item
  // is registered and waits for the user
  it.each([
    { openAtLogin: false, status: 'requires-approval' as const },
    { openAtLogin: true, status: 'requires-approval' as const },
  ])('reads %o as enabled + needsApproval', (reply) => {
    const svc = createLoginItemService(deps({ getLoginItemSettings: () => reply }))
    expect(svc.status()).toEqual({ supported: true, enabled: true, needsApproval: true })
  })

  it('falls back to openAtLogin where no SMAppService status exists (macOS 12)', () => {
    const svc = createLoginItemService(
      deps({ getLoginItemSettings: () => ({ openAtLogin: true }) }),
    )
    expect(svc.status()).toEqual({ supported: true, enabled: true })
  })

  it('treats "not-found" as off', () => {
    const svc = createLoginItemService(deps(macLoginItems('not-found')))
    expect(svc.status()).toEqual({ supported: true, enabled: false })
  })
})

describe('Windows', () => {
  const exe = 'C:\\Users\\me\\AppData\\Local\\Programs\\FaamOffice\\FaamOffice.exe'

  it('writes the Run entry for process.execPath and reads it back with the same quoted path', () => {
    let registered = false
    const get = vi.fn(() => ({
      openAtLogin: registered,
      executableWillLaunchAtLogin: registered,
    }))
    const set = vi.fn((settings: { openAtLogin?: boolean }) => {
      registered = settings.openAtLogin === true
    })
    const svc = createLoginItemService(
      deps({
        platform: 'win32',
        execPath: exe,
        getLoginItemSettings: get,
        setLoginItemSettings: set,
      }),
    )
    expect(svc.status()).toEqual({ supported: true, enabled: false })
    expect(svc.set(true)).toEqual({ supported: true, enabled: true })
    // Electron strips these quotes before re-quoting the Run value itself
    expect(set).toHaveBeenLastCalledWith({
      openAtLogin: true,
      path: `"${exe}"`,
      args: [],
      name: 'FaamOffice',
    })
    expect(get).toHaveBeenLastCalledWith({ path: `"${exe}"`, args: [] })

    expect(svc.set(false)).toEqual({ supported: true, enabled: false })
    expect(set).toHaveBeenLastCalledWith({
      openAtLogin: false,
      path: `"${exe}"`,
      args: [],
      name: 'FaamOffice',
    })
  })

  it('looks up an install path with spaces as one quoted program', () => {
    // unquoted, Electron's executableWillLaunchAtLogin lookup would parse the
    // program as "C:\Program" and report a working entry as disabled
    const programFiles = 'C:\\Program Files\\FaamOffice\\FaamOffice.exe'
    const get = vi.fn((options?: { path?: string }) => {
      const quoted = options?.path === `"${programFiles}"`
      return { openAtLogin: true, executableWillLaunchAtLogin: quoted }
    })
    const svc = createLoginItemService(
      deps({ platform: 'win32', execPath: programFiles, getLoginItemSettings: get }),
    )
    expect(svc.status()).toEqual({ supported: true, enabled: true })
    expect(get).toHaveBeenLastCalledWith({
      path: '"C:\\Program Files\\FaamOffice\\FaamOffice.exe"',
      args: [],
    })
  })

  it('reports an entry disabled in Task Manager as off + needsApproval', () => {
    const svc = createLoginItemService(
      deps({
        platform: 'win32',
        execPath: exe,
        getLoginItemSettings: () => ({ openAtLogin: true, executableWillLaunchAtLogin: false }),
      }),
    )
    expect(svc.status()).toEqual({ supported: true, enabled: false, needsApproval: true })
  })
})

describe('Linux autostart entry', () => {
  const home = '/home/me'
  const autostart = '/home/me/.config/autostart'
  const file = `${autostart}/${LINUX_AUTOSTART_FILE}`
  const exe = '/opt/FaamOffice/faamoffice'

  function linux(env: LoginItemDeps['env'], initial: Record<string, string> = {}) {
    const mem = memoryFs(initial)
    const svc = createLoginItemService(deps({ platform: 'linux', execPath: exe, env, fs: mem.fs }))
    return { svc, ...mem }
  }

  it('writes ~/.config/autostart/faamoffice.desktop pointing at the executable', () => {
    const { svc, files, dirs, fs } = linux({ HOME: home })
    expect(svc.status()).toEqual({ supported: true, enabled: false })

    expect(svc.set(true)).toEqual({ supported: true, enabled: true })
    expect(dirs).toEqual(new Set([autostart]))
    expect(files.get(file)).toBe(
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=FaamOffice',
        'Exec="/opt/FaamOffice/faamoffice"',
        'Icon=faamoffice',
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        '',
      ].join('\n'),
    )
    // nothing but our own entry is ever written
    expect(fs.writeFile.mock.calls.map(([path]) => path)).toEqual([file])
  })

  it('honors an absolute XDG_CONFIG_HOME and ignores a relative one', () => {
    expect(linuxAutostartDir({ XDG_CONFIG_HOME: '/xdg', HOME: home })).toBe('/xdg/autostart')
    expect(linuxAutostartDir({ XDG_CONFIG_HOME: 'rel/cfg', HOME: home })).toBe(autostart)
    expect(linuxAutostartDir({ XDG_CONFIG_HOME: '', HOME: home })).toBe(autostart)

    const { svc, files } = linux({ XDG_CONFIG_HOME: '/xdg', HOME: home })
    svc.set(true)
    expect([...files.keys()]).toEqual(['/xdg/autostart/faamoffice.desktop'])
  })

  it('points an AppImage build at the .AppImage file, not the temporary mount', () => {
    const appImage = '/home/me/Apps/FaamOffice 0.11.0.AppImage'
    const mem = memoryFs()
    const svc = createLoginItemService(
      deps({
        platform: 'linux',
        execPath: '/tmp/.mount_FaamOfXYZ/faamoffice',
        env: { HOME: home, APPIMAGE: appImage, APPDIR: '/tmp/.mount_FaamOfXYZ' },
        fs: mem.fs,
      }),
    )
    expect(svc.set(true).enabled).toBe(true)
    expect(mem.files.get(file)).toContain('Exec="/home/me/Apps/FaamOffice 0.11.0.AppImage"\n')
  })

  it.each([
    ['APPDIR unset', undefined],
    ['APPDIR of another AppImage', '/tmp/.mount_EditorAB'],
  ])('ignores an APPIMAGE inherited from another AppImage (%s)', (_name, appDir) => {
    // a deb/rpm install started from an AppImage editor's terminal
    const mem = memoryFs()
    const svc = createLoginItemService(
      deps({
        platform: 'linux',
        execPath: exe,
        env: { HOME: home, APPIMAGE: '/home/me/Apps/Editor.AppImage', APPDIR: appDir },
        fs: mem.fs,
      }),
    )
    expect(svc.set(true).enabled).toBe(true)
    expect(mem.files.get(file)).toBe(linuxAutostartEntry(exe))
  })

  it('trusts APPIMAGE only for an executable inside APPDIR', () => {
    const image = '/home/me/FaamOffice.AppImage'
    expect(
      runningAppImage('/tmp/.mount_a/faamoffice', { APPIMAGE: image, APPDIR: '/tmp/.mount_a/' }),
    ).toBe(image)
    expect(
      runningAppImage('/tmp/.mount_ab/faamoffice', { APPIMAGE: image, APPDIR: '/tmp/.mount_a' }),
    ).toBeNull()
    expect(
      runningAppImage('/tmp/.mount_a/faamoffice', {
        APPIMAGE: 'rel.AppImage',
        APPDIR: '/tmp/.mount_a',
      }),
    ).toBeNull()
    expect(runningAppImage('/opt/x/faamoffice', { APPIMAGE: image, APPDIR: '/' })).toBeNull()
    expect(runningAppImage('/tmp/.mount_a/faamoffice', { APPDIR: '/tmp/.mount_a' })).toBeNull()
  })

  it('treats an entry for an old AppImage path as off and rewrites it on enable', () => {
    const stale = linuxAutostartEntry('/home/me/Downloads/FaamOffice-0.9.0.AppImage')
    const appImage = '/home/me/Apps/FaamOffice-0.11.0.AppImage'
    const mem = memoryFs({ [file]: stale })
    const svc = createLoginItemService(
      deps({
        platform: 'linux',
        execPath: '/tmp/.mount_x/faamoffice',
        env: { HOME: home, APPIMAGE: appImage, APPDIR: '/tmp/.mount_x' },
        fs: mem.fs,
      }),
    )
    expect(svc.status()).toEqual({ supported: true, enabled: false })
    expect(svc.set(true)).toEqual({ supported: true, enabled: true })
    expect(mem.files.get(file)).toBe(linuxAutostartEntry(appImage))
  })

  it('treats an entry the desktop disabled (Hidden / X-GNOME-Autostart-enabled) as off', () => {
    const entry = linuxAutostartEntry(exe)
    expect(
      linux({ HOME: home }, { [file]: entry.replace('enabled=true', 'enabled=false') }).svc.status()
        .enabled,
    ).toBe(false)
    expect(linux({ HOME: home }, { [file]: `${entry}Hidden=true\n` }).svc.status().enabled).toBe(
      false,
    )
    expect(linux({ HOME: home }, { [file]: entry }).svc.status().enabled).toBe(true)
  })

  it('removes only its own file on disable and tolerates it being gone', () => {
    const { svc, files, fs } = linux({ HOME: home }, { [file]: linuxAutostartEntry(exe) })
    expect(svc.status().enabled).toBe(true)
    expect(svc.set(false)).toEqual({ supported: true, enabled: false })
    expect(files.has(file)).toBe(false)
    expect(svc.set(false)).toEqual({ supported: true, enabled: false })
    expect(fs.unlink.mock.calls.map(([path]) => path)).toEqual([file, file])
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('accepts an unquoted Exec written by hand', () => {
    const { svc } = linux(
      { HOME: home },
      { [file]: `[Desktop Entry]\nType=Application\nExec=${exe} --flag\n` },
    )
    expect(svc.status().enabled).toBe(true)
  })
})

describe('Linux AppImage moved by an update', () => {
  const home = '/home/me'
  const file = `/home/me/.config/autostart/${LINUX_AUTOSTART_FILE}`
  const oldImage = '/home/me/Apps/FaamOffice-0.11.0.AppImage'
  const newImage = '/home/me/Apps/FaamOffice-0.12.0.AppImage'

  function appImageRun(appImage: string, initial: Record<string, string> = {}) {
    const mem = memoryFs(initial)
    const svc = createLoginItemService(
      deps({
        platform: 'linux',
        execPath: '/tmp/.mount_FaamOfXYZ/faamoffice',
        env: { HOME: home, APPIMAGE: appImage, APPDIR: '/tmp/.mount_FaamOfXYZ' },
        fs: mem.fs,
      }),
    )
    return { svc, ...mem }
  }

  it('retarget moves an enabled entry to the new AppImage file', () => {
    const { svc, files } = appImageRun(oldImage, { [file]: linuxAutostartEntry(oldImage) })
    svc.retarget(newImage)
    expect(files.get(file)).toBe(linuxAutostartEntry(newImage))
    // the running AppImage now lives at the new path
    expect(svc.status()).toEqual({ supported: true, enabled: true })
  })

  it('retarget leaves a missing or desktop-disabled entry alone', () => {
    const none = appImageRun(oldImage)
    none.svc.retarget(newImage)
    expect(none.fs.writeFile).not.toHaveBeenCalled()

    const hidden = `${linuxAutostartEntry(oldImage)}Hidden=true\n`
    const off = appImageRun(oldImage, { [file]: hidden })
    off.svc.retarget(newImage)
    expect(off.files.get(file)).toBe(hidden)
  })

  it('retarget leaves an entry for a different program alone', () => {
    const other = linuxAutostartEntry('/opt/FaamOffice/faamoffice')
    const { svc, files, fs } = appImageRun(oldImage, { [file]: other })
    svc.retarget(newImage)
    expect(files.get(file)).toBe(other)
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('retarget is a no-op outside an AppImage run and never throws', () => {
    const mem = memoryFs({ [file]: linuxAutostartEntry('/opt/FaamOffice/faamoffice') })
    const svc = createLoginItemService(
      deps({
        platform: 'linux',
        execPath: '/opt/FaamOffice/faamoffice',
        env: { HOME: home },
        fs: mem.fs,
      }),
    )
    svc.retarget(newImage)
    expect(mem.fs.writeFile).not.toHaveBeenCalled()

    const run = appImageRun(oldImage, { [file]: linuxAutostartEntry(oldImage) })
    run.fs.writeFile.mockImplementation(() => {
      throw Object.assign(new Error('EROFS'), { code: 'EROFS' })
    })
    expect(() => run.svc.retarget(newImage)).not.toThrow()
    expect(run.svc.status().enabled).toBe(false)
  })

  it('repairs at startup an enabled entry whose AppImage an update replaced', () => {
    // the previous build moved the file without updating the entry
    const { svc, files } = appImageRun(newImage, { [file]: linuxAutostartEntry(oldImage) })
    expect(svc.status().enabled).toBe(false)
    svc.repairMovedAppImage()
    expect(files.get(file)).toBe(linuxAutostartEntry(newImage))
    expect(svc.status().enabled).toBe(true)
  })

  it.each([
    ['the old AppImage still exists', { [oldImage]: '' }, linuxAutostartEntry(oldImage)],
    [
      'it lived in another folder',
      {},
      linuxAutostartEntry('/home/me/Downloads/FaamOffice-0.11.0.AppImage'),
    ],
    ['it is not an AppImage', {}, linuxAutostartEntry('/home/me/Apps/faamoffice')],
    [
      'the desktop disabled it',
      {},
      linuxAutostartEntry(oldImage).replace('enabled=true', 'enabled=false'),
    ],
  ])('does not repair when %s', (_name, extra, entry) => {
    const { svc, files, fs } = appImageRun(newImage, { [file]: entry, ...extra })
    svc.repairMovedAppImage()
    expect(files.get(file)).toBe(entry)
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('repair leaves a missing entry and non-AppImage runs alone', () => {
    const none = appImageRun(newImage)
    none.svc.repairMovedAppImage()
    expect(none.fs.writeFile).not.toHaveBeenCalled()

    const entry = linuxAutostartEntry(oldImage)
    const mem = memoryFs({ [file]: entry })
    createLoginItemService(
      deps({
        platform: 'linux',
        execPath: '/opt/FaamOffice/faamoffice',
        env: { HOME: home },
        fs: mem.fs,
      }),
    ).repairMovedAppImage()
    expect(mem.files.get(file)).toBe(entry)
  })
})

describe('desktop entry Exec quoting', () => {
  it.each([
    ['/opt/FaamOffice/faamoffice', '"/opt/FaamOffice/faamoffice"'],
    ['/home/me/My Apps/FaamOffice.AppImage', '"/home/me/My Apps/FaamOffice.AppImage"'],
    ['/home/me/a"b', '"/home/me/a\\\\"b"'],
    ['/home/me/$HOME`x`', '"/home/me/\\\\$HOME\\\\`x\\\\`"'],
    ['/home/me/back\\slash', '"/home/me/back\\\\\\\\slash"'],
    ['/home/me/100%/app', '"/home/me/100%%/app"'],
  ])('quotes %s', (path, expected) => {
    expect(quoteDesktopExec(path)).toBe(expected)
    expect(parseDesktopExecProgram(quoteDesktopExec(path))).toBe(path)
  })

  it('round-trips a newline through the string escape rule', () => {
    const path = '/home/me/odd\nname'
    expect(quoteDesktopExec(path)).not.toContain('\n')
    expect(parseDesktopExecProgram(quoteDesktopExec(path))).toBe(path)
  })

  it('rejects an unterminated quote', () => {
    expect(parseDesktopExecProgram('"/opt/FaamOffice/faamoffice')).toBeNull()
    expect(parseDesktopExecProgram('')).toBeNull()
  })

  it('reads only the [Desktop Entry] group and skips localized keys', () => {
    const entry = parseDesktopEntry(
      '# c\n[Desktop Entry]\nName[de]=X\nName = FaamOffice\n[Desktop Action new]\nExec=/other\n',
    )
    expect(entry.get('Name')).toBe('FaamOffice')
    expect(entry.has('Exec')).toBe(false)
  })
})

describe('error handling', () => {
  it('keeps the last known macOS state when reading throws', () => {
    let fail = false
    const svc = createLoginItemService(
      deps({
        getLoginItemSettings: () => {
          if (fail) throw new Error('boom')
          return { openAtLogin: true, status: 'enabled' }
        },
      }),
    )
    expect(svc.status()).toEqual({ supported: true, enabled: true })
    fail = true
    expect(svc.status()).toEqual({ supported: true, enabled: true })
  })

  it('reports the applied state when only the read-back fails', () => {
    const items = macLoginItems()
    const svc = createLoginItemService(
      deps({
        ...items,
        getLoginItemSettings: () => {
          if (items.setLoginItemSettings.mock.calls.length > 0) throw new Error('boom')
          return items.getLoginItemSettings()
        },
      }),
    )
    expect(svc.status()).toEqual({ supported: true, enabled: false })
    expect(svc.set(true)).toEqual({ supported: true, enabled: true })
    expect(items.status).toBe('enabled')
  })

  it('reports the current state when applying fails', () => {
    const svc = createLoginItemService(
      deps({
        platform: 'win32',
        getLoginItemSettings: () => ({ openAtLogin: false, executableWillLaunchAtLogin: false }),
        setLoginItemSettings: () => {
          throw new Error('registry denied')
        },
      }),
    )
    expect(svc.set(true)).toEqual({ supported: true, enabled: false })
  })

  it('reports off when the very first read fails', () => {
    const svc = createLoginItemService(
      deps({
        getLoginItemSettings: () => {
          throw new Error('boom')
        },
      }),
    )
    expect(svc.status()).toEqual({ supported: true, enabled: false })
  })

  it('survives an unwritable autostart directory on Linux', () => {
    const mem = memoryFs()
    mem.fs.mkdir.mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    })
    const svc = createLoginItemService(
      deps({
        platform: 'linux',
        execPath: '/opt/FaamOffice/faamoffice',
        env: { HOME: '/home/me' },
        fs: mem.fs,
      }),
    )
    expect(svc.set(true)).toEqual({ supported: true, enabled: false })
    expect(mem.files.size).toBe(0)
  })

  it('keeps the last known Linux state when the entry cannot be read', () => {
    const file = '/home/me/.config/autostart/faamoffice.desktop'
    const mem = memoryFs({ [file]: linuxAutostartEntry('/opt/FaamOffice/faamoffice') })
    const svc = createLoginItemService(
      deps({
        platform: 'linux',
        execPath: '/opt/FaamOffice/faamoffice',
        env: { HOME: '/home/me' },
        fs: mem.fs,
      }),
    )
    expect(svc.status().enabled).toBe(true)
    mem.fs.readFile.mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    })
    expect(svc.status()).toEqual({ supported: true, enabled: true })
  })

  it('reports the entry still present when it cannot be removed', () => {
    const file = '/home/me/.config/autostart/faamoffice.desktop'
    const mem = memoryFs({ [file]: linuxAutostartEntry('/opt/FaamOffice/faamoffice') })
    mem.fs.unlink.mockImplementation(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    })
    const svc = createLoginItemService(
      deps({
        platform: 'linux',
        execPath: '/opt/FaamOffice/faamoffice',
        env: { HOME: '/home/me' },
        fs: mem.fs,
      }),
    )
    expect(svc.set(false)).toEqual({ supported: true, enabled: true })
  })
})

describe('loginItemsSettingsUrl', () => {
  it('opens Login Items on macOS, Startup apps on Windows, nothing on Linux', () => {
    expect(loginItemsSettingsUrl('darwin')).toBe(
      'x-apple.systempreferences:com.apple.LoginItems-Settings.extension',
    )
    expect(loginItemsSettingsUrl('win32')).toBe('ms-settings:startupapps')
    expect(loginItemsSettingsUrl('linux')).toBeNull()
  })
})
