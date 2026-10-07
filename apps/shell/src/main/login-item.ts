import { posix } from 'node:path'
import type { LoginItemSettings, LoginItemSettingsOptions, Settings } from 'electron'
import type { LoginItemStatus } from '../shared/home-api'

/** HKCU\\...\\Run value name of the Windows login item; build/installer.nsh removes it on uninstall */
export const WINDOWS_RUN_VALUE_NAME = 'FaamOffice'

// "Open FaamOffice when you sign in" (Settings → General). macOS and Windows go
// through Electron's login item API (SMAppService mainAppService on macOS 13+,
// the HKCU Run key on Windows); Linux has no such API, so we manage one XDG
// autostart entry ourselves. Every dependency is injected so the platform rules
// are unit-testable without Electron.
//
// Microsoft Store (MSIX) installs have no switch: Electron's login item API
// does not work for packaged apps (a packaged app starts at sign-in only
// through a StartupTask its manifest declares, which this package does not),
// and the Run key must not point into the versioned package folder.

/** file name of our XDG autostart entry (the only file this module ever writes or removes) */
export const LINUX_AUTOSTART_FILE = 'faamoffice.desktop'

const MAC_LOGIN_ITEMS_URL = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'
const WINDOWS_STARTUP_APPS_URL = 'ms-settings:startupapps'

export interface LoginItemFs {
  /** throws when the file is missing (ENOENT) or unreadable */
  readFile(path: string): string
  writeFile(path: string, data: string): void
  /** throws ENOENT when the file is missing */
  unlink(path: string): void
  /** recursive; succeeds when the directory already exists */
  mkdir(path: string): void
  /** true when something exists at the path */
  exists(path: string): boolean
}

export interface LoginItemDeps {
  platform: NodeJS.Platform
  /** packaged app only: a dev build would register Electron.app / electron.exe at login */
  packaged: boolean
  /** process.windowsStore: the Microsoft Store package, where the switch is not offered */
  windowsStore?: boolean
  getLoginItemSettings: (options?: LoginItemSettingsOptions) => Partial<LoginItemSettings>
  setLoginItemSettings: (settings: Settings) => void
  execPath: string
  env: { APPIMAGE?: string; APPDIR?: string; XDG_CONFIG_HOME?: string; HOME?: string }
  fs: LoginItemFs
}

export interface LoginItemService {
  /** never throws; falls back to the last state read successfully */
  status(): LoginItemStatus
  /** apply the choice and return the state read back afterwards; never throws */
  set(enabled: boolean): LoginItemStatus
  /**
   * Linux AppImage: the running AppImage now lives at `program` (an in-app
   * update moved it to a new, versioned file name). An enabled autostart entry
   * follows it; a disabled or missing one is left alone. Never throws.
   */
  retarget(program: string): void
  /**
   * Linux AppImage, at startup: an enabled entry whose .AppImage is gone and sat
   * in the same folder as the running one (replaced by an update this build
   * did not see, or renamed by hand) is pointed at the running AppImage.
   * Never throws.
   */
  repairMovedAppImage(): void
}

const UNSUPPORTED: LoginItemStatus = { supported: false, enabled: false }

/**
 * The .AppImage file this process runs from, or null. The AppImage runtime
 * exports APPIMAGE / APPDIR to every child process, so a deb/rpm install
 * started from another AppImage (its integrated terminal, an xdg-open) inherits
 * a foreign APPIMAGE: trust it only when this executable sits inside APPDIR
 * (the mount or extraction directory).
 */
export function runningAppImage(execPath: string, env: LoginItemDeps['env']): string | null {
  const image = env.APPIMAGE
  const dir = env.APPDIR?.replace(/\/+$/, '')
  if (!image || !image.startsWith('/') || !dir || !dir.startsWith('/')) return null
  return execPath.startsWith(`${dir}/`) ? image : null
}

/** system page where the user approves (macOS) or re-enables (Windows) startup apps; null = none */
export function loginItemsSettingsUrl(platform: NodeJS.Platform): string | null {
  if (platform === 'darwin') return MAC_LOGIN_ITEMS_URL
  if (platform === 'win32') return WINDOWS_STARTUP_APPS_URL
  return null
}

/** $XDG_CONFIG_HOME/autostart, falling back to ~/.config/autostart; null without a usable home */
export function linuxAutostartDir(env: LoginItemDeps['env']): string | null {
  // the XDG spec ignores relative values
  const xdg = env.XDG_CONFIG_HOME
  if (xdg && xdg.startsWith('/')) return posix.join(xdg, 'autostart')
  const home = env.HOME
  if (home && home.startsWith('/')) return posix.join(home, '.config', 'autostart')
  return null
}

/**
 * Quote a program path for a desktop entry Exec key. Inside double quotes the
 * spec reserves `"`, `` ` ``, `$` and `\` (escaped with a backslash); the
 * string-value escape rule is applied on top, so every backslash is doubled
 * again. `%` would start a field code and is written as `%%`.
 */
export function quoteDesktopExec(path: string): string {
  const quoted = `"${path.replace(/["`$\\]/g, (c) => `\\${c}`)}"`
  return quoted
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '%%')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
}

const STRING_ESCAPES: Record<string, string> = { s: ' ', n: '\n', t: '\t', r: '\r', '\\': '\\' }

/** the program (first argument) of a desktop entry Exec value; null when it cannot be parsed */
export function parseDesktopExecProgram(value: string): string | null {
  // string-value unescape first: \s \n \t \r \\ (anything else is left for the quoting rule)
  let unescaped = ''
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c !== '\\' || i + 1 >= value.length) {
      unescaped += c
      continue
    }
    const next = value[++i]
    unescaped += STRING_ESCAPES[next] ?? `\\${next}`
  }
  const s = unescaped.replace(/^[ \t]+/, '')
  let program = ''
  if (s.startsWith('"')) {
    let closed = false
    for (let i = 1; i < s.length; i++) {
      const c = s[i]
      if (c === '\\' && i + 1 < s.length) {
        program += s[++i]
      } else if (c === '"') {
        closed = true
        break
      } else {
        program += c
      }
    }
    if (!closed) return null
  } else {
    program = s.split(/[ \t]/, 1)[0] ?? ''
  }
  program = program.replace(/%%/g, '%')
  return program || null
}

/** key → value of the [Desktop Entry] group (localized keys and comments skipped) */
export function parseDesktopEntry(text: string): Map<string, string> {
  const entries = new Map<string, string>()
  let inGroup = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      inGroup = line === '[Desktop Entry]'
      continue
    }
    if (!inGroup) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (key.includes('[') || entries.has(key)) continue
    entries.set(key, line.slice(eq + 1).trim())
  }
  return entries
}

export function linuxAutostartEntry(program: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=FaamOffice',
    `Exec=${quoteDesktopExec(program)}`,
    'Icon=faamoffice',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n')
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

export function createLoginItemService(deps: LoginItemDeps): LoginItemService {
  const { platform, fs, env } = deps
  const linuxDir = platform === 'linux' ? linuxAutostartDir(env) : null
  const supported =
    deps.packaged &&
    (platform === 'darwin' ||
      (platform === 'win32' && deps.windowsStore !== true) ||
      (platform === 'linux' && linuxDir !== null))
  if (!supported) {
    return {
      status: () => ({ ...UNSUPPORTED }),
      set: () => ({ ...UNSUPPORTED }),
      retarget: () => undefined,
      repairMovedAppImage: () => undefined,
    }
  }

  // an AppImage runs from a fresh /tmp/.mount_* directory each launch: autostart
  // must point at the .AppImage file itself
  const appImage = platform === 'linux' ? runningAppImage(deps.execPath, env) : null
  // reassigned when an update moves the running AppImage (retarget)
  let linuxProgram = appImage ?? deps.execPath
  const linuxFile = linuxDir ? posix.join(linuxDir, LINUX_AUTOSTART_FILE) : ''
  // Electron writes the Run value quoted ("C:\Program Files\…\FaamOffice.exe")
  // but finds it for executableWillLaunchAtLogin by parsing options.path as a
  // command line, which ends an unquoted program at the first space ("C:\Program").
  // It strips surrounding quotes before re-quoting, so the quoted form matches
  // the written value on both calls.
  const windowsExe = `"${deps.execPath}"`

  let lastKnown: LoginItemStatus = { supported: true, enabled: false }

  const readMac = (): LoginItemStatus => {
    const s = deps.getLoginItemSettings()
    // macOS 13+: SMAppService reports 'requires-approval' when the item is
    // registered but the user has not allowed it under Login Items yet
    const needsApproval = s.status === 'requires-approval'
    const enabled = s.openAtLogin === true || s.status === 'enabled' || needsApproval
    return needsApproval
      ? { supported: true, enabled, needsApproval }
      : { supported: true, enabled }
  }

  const readWindows = (): LoginItemStatus => {
    // openAtLogin = our Run value holds exactly this command;
    // executableWillLaunchAtLogin is false when the user disabled the entry in
    // Task Manager / Settings → Apps → Startup (StartupApproved key)
    const s = deps.getLoginItemSettings({ path: windowsExe, args: [] })
    const registered = s.openAtLogin === true
    if (registered && s.executableWillLaunchAtLogin === false) {
      return { supported: true, enabled: false, needsApproval: true }
    }
    return { supported: true, enabled: registered }
  }

  /** our autostart entry's program and whether the desktop disabled it; null when there is none */
  const readLinuxEntry = (): { program: string | null; disabled: boolean } | null => {
    let text: string
    try {
      text = fs.readFile(linuxFile)
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
    const entry = parseDesktopEntry(text)
    const exec = entry.get('Exec')
    return {
      program: exec === undefined ? null : parseDesktopExecProgram(exec),
      disabled:
        entry.get('Hidden') === 'true' || entry.get('X-GNOME-Autostart-enabled') === 'false',
    }
  }

  const readLinux = (): LoginItemStatus => {
    const entry = readLinuxEntry()
    // a stale entry (an AppImage moved or replaced by another version) does not count
    const enabled = entry !== null && entry.program === linuxProgram && !entry.disabled
    return { supported: true, enabled }
  }

  const status = (): LoginItemStatus => {
    try {
      lastKnown =
        platform === 'darwin' ? readMac() : platform === 'win32' ? readWindows() : readLinux()
    } catch {
      // keep the last state read successfully
    }
    return { ...lastKnown }
  }

  const apply = (enabled: boolean): void => {
    if (platform === 'darwin') {
      deps.setLoginItemSettings({ openAtLogin: enabled })
    } else if (platform === 'win32') {
      // `enabled` defaults to true: turning it on from here also clears a
      // Task Manager "disabled" mark, since the user just asked for it
      // a fixed Run value name (not Electron's AppUserModelId default) so the
      // uninstaller can remove exactly this entry (build/installer.nsh)
      deps.setLoginItemSettings({
        openAtLogin: enabled,
        path: windowsExe,
        args: [],
        name: WINDOWS_RUN_VALUE_NAME,
      })
    } else if (enabled) {
      fs.mkdir(linuxDir!)
      fs.writeFile(linuxFile, linuxAutostartEntry(linuxProgram))
    } else {
      try {
        fs.unlink(linuxFile)
      } catch (err) {
        if (!isMissing(err)) throw err
      }
    }
  }

  return {
    status,
    set(enabled) {
      try {
        apply(enabled)
        // the change took effect: a read-back that fails must not report the
        // state from before it
        lastKnown = { supported: true, enabled }
      } catch {
        // report whatever is actually in place
      }
      return status()
    },
    retarget(program) {
      if (appImage === null || !program.startsWith('/') || program === linuxProgram) return
      try {
        const entry = readLinuxEntry()
        if (entry !== null && entry.program === linuxProgram && !entry.disabled) {
          fs.writeFile(linuxFile, linuxAutostartEntry(program))
        }
      } catch {
        // the entry keeps its old path and reads as off from now on
      }
      linuxProgram = program
    },
    repairMovedAppImage() {
      if (appImage === null) return
      try {
        const entry = readLinuxEntry()
        if (entry === null || entry.disabled || entry.program === null) return
        const old = entry.program
        if (old === linuxProgram || !/\.appimage$/i.test(old)) return
        // only a replaced copy of this AppImage: same folder, file gone
        if (posix.dirname(old) !== posix.dirname(linuxProgram) || fs.exists(old)) return
        fs.writeFile(linuxFile, linuxAutostartEntry(linuxProgram))
      } catch {
        // leave the entry as it is; the switch reads it as off
      }
    },
  }
}
