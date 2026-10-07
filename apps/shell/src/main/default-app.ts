import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DefaultAppStatus } from '../shared/home-api'

// macOS writes the LaunchServices user choice via osascript (no helper binary to
// ship), Linux via xdg-mime; Windows apps cannot set defaults, only open the page.
// The Microsoft Store package (ms-store.ts) owns its types through ProgIds
// Windows generates (AppX…), so there it is recognised by its AUMID and the
// page opens at its own entry by AUMID; the NSIS names never apply.

interface OfficeType {
  ext: string
  uti: string
  mime: string
  /** Windows ProgId written by the NSIS installer = fileAssociations[].name in electron-builder.cjs */
  progId: string
}

export const OFFICE_TYPES: readonly OfficeType[] = [
  {
    ext: 'docx',
    uti: 'org.openxmlformats.wordprocessingml.document',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    progId: 'Word Document',
  },
  {
    ext: 'xlsx',
    uti: 'org.openxmlformats.spreadsheetml.sheet',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    progId: 'Excel Workbook',
  },
  {
    ext: 'xlsm',
    uti: 'org.openxmlformats.spreadsheetml.sheet.macroenabled',
    mime: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    progId: 'Excel Macro-Enabled Workbook',
  },
  {
    ext: 'xls',
    uti: 'com.microsoft.excel.xls',
    mime: 'application/vnd.ms-excel',
    progId: 'Excel 97-2003 Workbook',
  },
  {
    ext: 'pptx',
    uti: 'org.openxmlformats.presentationml.presentation',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    progId: 'PowerPoint Presentation',
  },
]

const LINUX_DESKTOP_ID = 'faamoffice.desktop'
const WINDOWS_DEFAULT_APPS_URL = 'ms-settings:defaultapps'
/**
 * Our value name under Software\RegisteredApplications, written by
 * build/installer.nsh as electron-builder's PRODUCT_NAME (= productName in
 * electron-builder.cjs; tests/installer-capabilities.test.ts keeps them equal).
 */
export const WINDOWS_REGISTERED_APP_NAME = 'FaamOffice'
/** where the installer registered us (its own hive) → the Default apps deep-link parameter */
const WINDOWS_REGISTRATIONS = [
  { hive: 'HKCU', param: 'registeredAppUser' },
  { hive: 'HKLM', param: 'registeredAppMachine' },
] as const

export type RunCommand = (cmd: string, args: string[]) => Promise<string>

export interface DefaultAppDeps {
  platform: NodeJS.Platform
  /** packaged app only: dev builds run inside Electron.app and must never claim the types */
  packaged: boolean
  /** Windows, the Microsoft Store package: its AUMID (null when unknown); null/absent otherwise */
  windowsStore?: { aumid: string | null } | null
  exePath: string
  run: RunCommand
  openExternal: (url: string) => Promise<void>
  readFile?: (path: string) => string
}

export interface DefaultAppService {
  status(): Promise<DefaultAppStatus>
  /** apply (mac/linux) or open the system page (win); resolves to the status afterwards */
  set(): Promise<DefaultAppStatus>
}

const UNSUPPORTED: DefaultAppStatus = { state: 'unsupported', others: [], manualOnly: false }

export function execFileRunner(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15_000, windowsHide: true }, (err, stdout) => {
      if (err) reject(err)
      else resolve(String(stdout))
    })
  })
}

/** /Applications/FaamOffice.app/Contents/MacOS/FaamOffice → /Applications/FaamOffice.app */
export function macAppBundlePath(exePath: string): string | null {
  let dir = exePath
  for (let i = 0; i < 6; i++) {
    dir = dirname(dir)
    if (dir.endsWith('.app')) return dir
    if (dir === dirname(dir)) break
  }
  return null
}

// JXA: argv[0] = our .app path, argv[1..] = UTIs → JSON [{uti, id, name}] of the
// current handler per type (id === own bundle id when we are the default).
const MAC_STATUS_SCRIPT = `function run(argv) {
  ObjC.import('CoreServices'); ObjC.import('AppKit')
  var ws = $.NSWorkspace.sharedWorkspace
  var me = $.NSBundle.bundleWithPath(argv[0]).bundleIdentifier.js
  var out = { me: me, types: [] }
  for (var i = 1; i < argv.length; i++) {
    var ref = $.LSCopyDefaultRoleHandlerForContentType($(argv[i]), 0xFFFFFFFF)
    var obj = ObjC.castRefToObject(ref)
    var id = obj.isNil() ? null : obj.js
    var name = null
    if (id) {
      var url = ws.URLForApplicationWithBundleIdentifier(id)
      if (!url.isNil()) {
        var b = $.NSBundle.bundleWithURL(url)
        name = ObjC.unwrap(b.objectForInfoDictionaryKey('CFBundleDisplayName')) ||
          ObjC.unwrap(b.objectForInfoDictionaryKey('CFBundleName')) || null
      }
    }
    out.types.push({ uti: argv[i], id: id, name: name })
  }
  return JSON.stringify(out)
}`

const MAC_SET_SCRIPT = `function run(argv) {
  ObjC.import('CoreServices')
  var me = $.NSBundle.bundleWithPath(argv[0]).bundleIdentifier.js
  var failed = []
  for (var i = 1; i < argv.length; i++) {
    if ($.LSSetDefaultRoleHandlerForContentType($(argv[i]), 0xFFFFFFFF, $(me)) !== 0) failed.push(argv[i])
  }
  return JSON.stringify({ me: me, failed: failed })
}`

function summarize(owners: Array<string | null>, ours: (id: string) => boolean): DefaultAppStatus {
  const others: string[] = []
  let allOurs = true
  let known = false
  for (const owner of owners) {
    if (owner === null) {
      allOurs = false
      continue
    }
    known = true
    if (ours(owner)) continue
    allOurs = false
    if (!others.includes(owner)) others.push(owner)
  }
  if (!known) return { state: 'unknown', others: [], manualOnly: false }
  return { state: allOurs ? 'default' : 'other', others, manualOnly: false }
}

export function parseMacStatus(json: string): DefaultAppStatus {
  const data = JSON.parse(json) as {
    me: string
    types: Array<{ id: string | null; name: string | null }>
  }
  const owners = data.types.map((t) =>
    t.id === null ? null : t.id === data.me ? data.me : (t.name ?? t.id),
  )
  return summarize(owners, (id) => id === data.me)
}

export function parseLinuxStatus(outputs: string[]): DefaultAppStatus {
  const owners = outputs.map((o) => o.trim() || null)
  return summarize(owners, (id) => id === LINUX_DESKTOP_ID)
}

/** value of a `reg query` line: `    ProgId    REG_SZ    Word.Document.12` */
export function parseRegValue(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*\S.*?\s+REG_\w+\s+(.+?)\s*$/.exec(line)
    if (m) return m[1]
  }
  return null
}

/** where installed launchers (.desktop entries) live */
function linuxApplicationDirs(): string[] {
  return [
    join(homedir(), '.local/share/applications'),
    '/usr/local/share/applications',
    '/usr/share/applications',
  ]
}

/**
 * Whether our launcher is installed. Only the deb/rpm packages ship
 * faamoffice.desktop; an AppImage installs none, so xdg-mime cannot point the
 * Office types at it (desktops that resolve installed IDs ignore the
 * association, others report it while double-click still fails).
 */
function linuxDesktopInstalled(readFile: (p: string) => string): boolean {
  for (const dir of linuxApplicationDirs()) {
    try {
      readFile(join(dir, LINUX_DESKTOP_ID))
      return true
    } catch {
      // not installed there
    }
  }
  return false
}

function linuxDesktopName(id: string, readFile: (p: string) => string): string {
  for (const dir of linuxApplicationDirs()) {
    try {
      const m = /^Name=(.+)$/m.exec(readFile(join(dir, id)))
      if (m) return m[1].trim()
    } catch {
      // not installed there
    }
  }
  return id.replace(/\.desktop$/, '')
}

export function createDefaultAppService(deps: DefaultAppDeps): DefaultAppService {
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, 'utf8'))
  const utis = OFFICE_TYPES.map((t) => t.uti)
  const mimes = OFFICE_TYPES.map((t) => t.mime)

  const macBundle = deps.platform === 'darwin' ? macAppBundlePath(deps.exePath) : null
  const store = deps.platform === 'win32' ? (deps.windowsStore ?? null) : null

  async function status(): Promise<DefaultAppStatus> {
    if (!deps.packaged) return UNSUPPORTED
    try {
      if (deps.platform === 'darwin') {
        if (!macBundle) return UNSUPPORTED
        const out = await deps.run('osascript', [
          '-l',
          'JavaScript',
          '-e',
          MAC_STATUS_SCRIPT,
          macBundle,
          ...utis,
        ])
        return parseMacStatus(out)
      }
      if (deps.platform === 'linux') {
        if (!linuxDesktopInstalled(readFile)) return UNSUPPORTED
        const outs = await Promise.all(
          mimes.map((m) => deps.run('xdg-mime', ['query', 'default', m])),
        )
        const st = parseLinuxStatus(outs)
        return { ...st, others: st.others.map((id) => linuxDesktopName(id, readFile)) }
      }
      if (deps.platform === 'win32') {
        // without its AUMID a Store install cannot tell its own ProgIds apart
        if (store && store.aumid === null) return { state: 'unknown', others: [], manualOnly: true }
        const owners = await Promise.all(OFFICE_TYPES.map((t) => windowsOwner(t)))
        const ours = store?.aumid
          ? await storeProgIds(owners, store.aumid)
          : new Set(OFFICE_TYPES.map((t) => t.progId))
        const st = summarize(owners, (id) => ours.has(id))
        const names = await Promise.all(st.others.map((id) => windowsProgIdName(id)))
        return { ...st, others: [...new Set(names)], manualOnly: true }
      }
    } catch {
      return { state: 'unknown', others: [], manualOnly: deps.platform === 'win32' }
    }
    return UNSUPPORTED
  }

  async function windowsOwner(t: OfficeType): Promise<string | null> {
    const userChoice = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${t.ext}\\UserChoice`
    try {
      const v = parseRegValue(await deps.run('reg', ['query', userChoice, '/v', 'ProgId']))
      if (v) return v
    } catch {
      // no explicit user choice: fall through to the class default
    }
    try {
      return parseRegValue(await deps.run('reg', ['query', `HKCR\\.${t.ext}`, '/ve']))
    } catch {
      return null
    }
  }

  /**
   * The owners that are this Store package: a packaged app's ProgId carries
   * its AUMID under HKCR\<ProgId>\Application. Unreadable keys are not ours.
   */
  async function storeProgIds(owners: Array<string | null>, aumid: string): Promise<Set<string>> {
    const candidates = [...new Set(owners.filter((owner): owner is string => owner !== null))]
    const matches = await Promise.all(
      candidates.map(async (progId) => {
        try {
          const out = await deps.run('reg', [
            'query',
            `HKCR\\${progId}\\Application`,
            '/v',
            'AppUserModelID',
          ])
          return parseRegValue(out)?.toLowerCase() === aumid.toLowerCase()
        } catch {
          return false
        }
      }),
    )
    return new Set(candidates.filter((_, i) => matches[i]))
  }

  async function windowsProgIdName(progId: string): Promise<string> {
    try {
      return parseRegValue(await deps.run('reg', ['query', `HKCR\\${progId}`, '/ve'])) ?? progId
    } catch {
      return progId
    }
  }

  /**
   * Our own page under Default apps when the installer registered us with
   * Default Programs, else the generic page (installs that predate the
   * registration). Windows builds without this deep link (it arrived in a 2023
   * Windows 11 update) ignore the parameter and show the generic page. Never
   * throws.
   */
  async function windowsDefaultAppsUrl(): Promise<string> {
    for (const { hive, param } of WINDOWS_REGISTRATIONS) {
      try {
        const out = await deps.run('reg', [
          'query',
          `${hive}\\Software\\RegisteredApplications`,
          '/v',
          WINDOWS_REGISTERED_APP_NAME,
        ])
        if (parseRegValue(out)) {
          return `${WINDOWS_DEFAULT_APPS_URL}?${param}=${encodeURIComponent(WINDOWS_REGISTERED_APP_NAME)}`
        }
      } catch {
        // not registered in this hive (reg exits 1 for a missing value)
      }
    }
    return WINDOWS_DEFAULT_APPS_URL
  }

  /**
   * The Store package's own page under Default apps (Windows 11 deep link by
   * AUMID; older builds ignore the parameter), else the generic page.
   */
  async function openStoreDefaultApps(aumid: string | null): Promise<void> {
    if (aumid) {
      try {
        await deps.openExternal(
          `${WINDOWS_DEFAULT_APPS_URL}?registeredAUMID=${encodeURIComponent(aumid)}`,
        )
        return
      } catch {
        // the generic page below
      }
    }
    await deps.openExternal(WINDOWS_DEFAULT_APPS_URL)
  }

  async function set(): Promise<DefaultAppStatus> {
    if (!deps.packaged) return UNSUPPORTED
    try {
      if (deps.platform === 'darwin' && macBundle) {
        await deps.run('osascript', ['-l', 'JavaScript', '-e', MAC_SET_SCRIPT, macBundle, ...utis])
      } else if (deps.platform === 'linux') {
        if (!linuxDesktopInstalled(readFile)) return UNSUPPORTED
        await deps.run('xdg-mime', ['default', LINUX_DESKTOP_ID, ...mimes])
      } else if (deps.platform === 'win32') {
        if (store) await openStoreDefaultApps(store.aumid)
        else await deps.openExternal(await windowsDefaultAppsUrl())
      }
    } catch {
      // status() below reports whatever actually stuck
    }
    return status()
  }

  return { status, set }
}
