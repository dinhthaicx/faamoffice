import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { OFFICE_TYPES, WINDOWS_REGISTERED_APP_NAME } from '../src/main/default-app'

/**
 * Static checks of the Default Programs registration in build/installer.nsh
 * (FaamOffice on Windows' Default apps page). makensis is not available in
 * CI, so the macros are expanded here the way makensis would and the
 * resulting registry operations are compared with electron-builder.cjs.
 */

const require = createRequire(import.meta.url)
const shellDir = resolve(import.meta.dirname, '..')

// Inspect packaging metadata without downloading Electron or compiling OCR helpers.
const configModule = { exports: {} as ReturnType<typeof require> }
runInNewContext(readFileSync(resolve(shellDir, 'electron-builder.cjs'), 'utf8'), {
  module: configModule,
  __dirname: shellDir,
  process: { platform: 'linux', arch: 'x64', env: {} },
  require: (id: string) =>
    id === 'node:fs' ? { ...require(id), existsSync: () => true } : require(id),
})
const config = configModule.exports as {
  productName: string
  fileAssociations: Array<{ ext: string | string[]; name?: string }>
}

const nsh = readFileSync(resolve(shellDir, 'build/installer.nsh'), 'utf8')

interface Macro {
  params: string[]
  body: string[]
}

interface NsisFunction {
  body: string[]
  /** the enclosing !ifdef / !ifndef lines, outermost first */
  conditions: string[]
}

const macros = new Map<string, Macro>()
const functions = new Map<string, NsisFunction>()
const fileDefines = new Map<string, string>()
{
  let open: { name: string; macro: Macro } | null = null
  let openFunction: { name: string; fn: NsisFunction } | null = null
  const conditions: string[] = []
  for (const raw of nsh.split(/\r?\n/)) {
    const line = raw.trim()
    if (open) {
      if (line === '!macroend') {
        macros.set(open.name, open.macro)
        open = null
      } else open.macro.body.push(line)
      continue
    }
    if (/^!if(n?def)\s/.test(line)) conditions.push(line)
    else if (line === '!endif') conditions.pop()
    if (openFunction) {
      if (line === 'FunctionEnd') {
        functions.set(openFunction.name, openFunction.fn)
        openFunction = null
      } else openFunction.fn.body.push(line)
      continue
    }
    const fn = /^Function\s+(\S+)$/.exec(line)
    if (fn) {
      openFunction = { name: fn[1], fn: { body: [], conditions: [...conditions] } }
      continue
    }
    const macro = /^!macro\s+(\S+)(.*)$/.exec(line)
    if (macro) {
      open = {
        name: macro[1],
        macro: { params: macro[2].trim().split(/\s+/).filter(Boolean), body: [] },
      }
      continue
    }
    const define = /^!define\s+(\S+)\s+"(.*)"$/.exec(line)
    if (define) fileDefines.set(define[1], define[2])
  }
}

/** electron-builder's command-line defines that the registration relies on (NsisTarget.js) */
const builderDefines = new Map([['PRODUCT_NAME', config.productName]])

/** NSIS words: "quoted strings" (quotes dropped) or bare tokens */
function words(line: string): string[] {
  return Array.from(line.matchAll(/"([^"]*)"|(\S+)/g), (m) => m[1] ?? m[2])
}

function substitute(line: string, params: Record<string, string>): string {
  let out = line
  // defines may themselves reference defines (GENOFFICE_CAPABILITIES_KEY → PRODUCT_NAME)
  for (let pass = 0; pass < 5; pass++) {
    const next = out.replace(
      /\$\{(\w+)\}/g,
      (whole, name: string) =>
        params[name] ?? fileDefines.get(name) ?? builderDefines.get(name) ?? whole,
    )
    if (next === out) break
    out = next
  }
  return out
}

/** the instructions a macro inserts, with installer.nsh's own macros expanded; comments dropped */
function expand(name: string, params: Record<string, string> = {}): string[] {
  const macro = macros.get(name)
  if (!macro) throw new Error(`installer.nsh has no macro ${name}`)
  return expandBody(macro.body, params)
}

/** a function's instructions, expanded like a macro's */
function expandFunction(name: string): string[] {
  const fn = functions.get(name)
  if (!fn) throw new Error(`installer.nsh has no function ${name}`)
  return expandBody(fn.body, {})
}

function expandBody(body: string[], params: Record<string, string>): string[] {
  const out: string[] = []
  for (const line of body) {
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const sub = substitute(line, params)
    const insert = /^!insertmacro\s+(\S+)(.*)$/.exec(sub)
    const inner = insert && macros.get(insert[1])
    if (insert && inner) {
      const args = words(insert[2])
      out.push(...expand(insert[1], Object.fromEntries(inner.params.map((p, i) => [p, args[i]]))))
    } else out.push(sub)
  }
  return out
}

const install = expand('customInstall')
const uninstall = expand('customUnInstall')
/** where the Default Programs registration is removed: only after a successful uninstall */
const UNINSTALL_SUCCESS = 'un.onUninstSuccess'
const unregister = expandFunction(UNINSTALL_SUCCESS)
const CAPABILITIES = `Software\\${config.productName}\\Capabilities`
const REGISTERED_APPS = 'Software\\RegisteredApplications'

function indexOfOp(lines: string[], ...expected: string[]): number {
  return lines.findIndex((line) => {
    const w = words(line)
    return expected.every((value, i) => w[i] === value)
  })
}

/** ProgId per extension as electron-builder writes it: APP_ASSOCIATE "<ext>" "<name || ext>" */
function builderProgIds(): Map<string, string> {
  const map = new Map<string, string>()
  for (const association of config.fileAssociations) {
    for (const ext of Array.isArray(association.ext) ? association.ext : [association.ext]) {
      const bare = ext.startsWith('.') ? ext.slice(1) : ext
      map.set(`.${bare}`, association.name || bare)
    }
  }
  return map
}

function capabilityProgIds(): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of install) {
    const [op, root, key, ext, progId] = words(line)
    if (op === 'WriteRegStr' && key === `${CAPABILITIES}\\FileAssociations`) {
      expect(root).toBe('SHELL_CONTEXT')
      expect(map.has(ext), `${ext} registered twice`).toBe(false)
      map.set(ext, progId)
    }
  }
  return map
}

describe('installer Default Programs registration', () => {
  it('lists every electron-builder file association with the ProgId it writes', () => {
    const expected = builderProgIds()
    expect(expected.size).toBeGreaterThan(0)
    expect(capabilityProgIds()).toEqual(expected)
  })

  it('covers every Office type the default-app prompt asks for', () => {
    const registered = capabilityProgIds()
    for (const type of OFFICE_TYPES) {
      expect(registered.get(`.${type.ext}`), type.ext).toBe(type.progId)
    }
  })

  it('describes the app and registers it under the name the app deep-links to', () => {
    expect(WINDOWS_REGISTERED_APP_NAME).toBe(config.productName)
    expect(
      indexOfOp(
        install,
        'WriteRegStr',
        'SHELL_CONTEXT',
        CAPABILITIES,
        'ApplicationName',
        config.productName,
      ),
    ).toBeGreaterThanOrEqual(0)
    const description = install
      .map(words)
      .find((w) => w[2] === CAPABILITIES && w[3] === 'ApplicationDescription')
    expect(description?.[0]).toBe('WriteRegStr')
    expect(description?.[4]?.trim()).toBeTruthy()
    expect(
      indexOfOp(
        install,
        'WriteRegStr',
        'SHELL_CONTEXT',
        CAPABILITIES,
        'ApplicationIcon',
        '$INSTDIR\\${APP_EXECUTABLE_FILENAME},0',
      ),
    ).toBeGreaterThanOrEqual(0)
    expect(
      indexOfOp(
        install,
        'WriteRegStr',
        'SHELL_CONTEXT',
        REGISTERED_APPS,
        WINDOWS_REGISTERED_APP_NAME,
        CAPABILITIES,
      ),
    ).toBeGreaterThanOrEqual(0)
  })

  it('writes only to the install hive', () => {
    const touched = [...install, ...uninstall, ...unregister]
      .map(words)
      .filter((w) => /^(Write|Read|Delete)Reg/.test(w[0]))
      .filter((w) => w.some((word) => word.startsWith(CAPABILITIES) || word === REGISTERED_APPS))
    expect(touched.length).toBeGreaterThan(0)
    for (const w of touched) {
      // ReadRegStr carries its output variable first
      expect(w[0] === 'ReadRegStr' ? w[2] : w[1], w.join(' ')).toBe('SHELL_CONTEXT')
    }
  })

  it('registers everything before the one shell notification', () => {
    const notify = install.filter((line) => line === '!insertmacro UPDATEFILEASSOC')
    expect(notify).toHaveLength(1)
    const notifyAt = install.indexOf(notify[0])
    expect(notifyAt).toBe(install.length - 1)
    const registerAt = indexOfOp(install, 'WriteRegStr', 'SHELL_CONTEXT', REGISTERED_APPS)
    expect(registerAt).toBeGreaterThanOrEqual(0)
    // the app is listed only once its capabilities exist
    const capabilityWrites = install
      .map((line, i) => [words(line), i] as const)
      .filter(([w]) => w[0] === 'WriteRegStr' && w[2]?.startsWith(CAPABILITIES))
      .map(([, i]) => i)
    expect(Math.max(...capabilityWrites)).toBeLessThan(registerAt)
    expect(registerAt).toBeLessThan(notifyAt)
  })

  it('uninstall removes our RegisteredApplications value and the Capabilities key', () => {
    const readAt = indexOfOp(
      unregister,
      'ReadRegStr',
      '$0',
      'SHELL_CONTEXT',
      REGISTERED_APPS,
      config.productName,
    )
    expect(readAt).toBeGreaterThanOrEqual(0)
    // only while the value still points at our key: a mismatch jumps over
    // exactly the one DeleteRegValue that follows
    expect(words(unregister[readAt + 1])).toEqual(['StrCmp', '$0', CAPABILITIES, '0', '+2'])
    const deleteValueAt = indexOfOp(
      unregister,
      'DeleteRegValue',
      'SHELL_CONTEXT',
      REGISTERED_APPS,
      config.productName,
    )
    expect(deleteValueAt).toBe(readAt + 2)

    const deleteKeyAt = indexOfOp(unregister, 'DeleteRegKey', 'SHELL_CONTEXT', CAPABILITIES)
    expect(deleteKeyAt).toBeGreaterThan(deleteValueAt)
    // the parent key only goes when nothing else lives in it
    expect(
      indexOfOp(
        unregister,
        'DeleteRegKey',
        '/ifempty',
        'SHELL_CONTEXT',
        `Software\\${config.productName}`,
      ),
    ).toBeGreaterThan(deleteKeyAt)
    // no unconditional removal of anything shared
    expect(indexOfOp(unregister, 'DeleteRegKey', 'SHELL_CONTEXT', REGISTERED_APPS)).toBe(-1)

    // $0 is preserved around the macro
    expect(unregister.indexOf('Push $0')).toBeLessThan(readAt)
    expect(unregister.indexOf('Pop $0')).toBeGreaterThan(Math.max(deleteValueAt, deleteKeyAt))
  })

  it('unregisters only once the uninstall has succeeded', () => {
    // customUnInstall runs before electron-builder's template removes the
    // files; when that removal fails during an update the template restores
    // the files and Aborts, the old app stays installed and the new installer
    // quits, so nothing may be unregistered there. NSIS skips
    // un.onUninstSuccess when a section aborts.
    const early = uninstall
      .map(words)
      .filter((w) => /^(Write|Delete)Reg/.test(w[0]))
      .filter((w) => w.some((word) => word.startsWith(CAPABILITIES) || word === REGISTERED_APPS))
    expect(early).toEqual([])
    // customUnInstall still notifies the shell once, last (ShellNew)
    expect(uninstall.indexOf('!insertmacro UPDATEFILEASSOC')).toBe(uninstall.length - 1)

    // compiled into the uninstaller pass only: the installer pass has no
    // WriteUninstaller, so un. code there is makensis warning 6020 (an error)
    expect(functions.get(UNINSTALL_SUCCESS)?.conditions).toEqual(['!ifdef BUILD_UNINSTALLER'])
    // electron-builder's templates must not define the callback themselves
    const templates = resolve(
      dirname(require.resolve('app-builder-lib/package.json', { paths: [shellDir] })),
      'templates/nsis',
    )
    const templateFiles = readdirSync(templates, { recursive: true, encoding: 'utf8' }).filter(
      (f) => f.endsWith('.nsh') || f.endsWith('.nsi'),
    )
    expect(templateFiles.length).toBeGreaterThan(0)
    for (const file of templateFiles) {
      expect(readFileSync(resolve(templates, file), 'utf8'), file).not.toMatch(
        /Function\s+un\.onUninstSuccess\b/,
      )
    }
  })

  it('notifies the shell after unregistering, with the values UPDATEFILEASSOC uses', () => {
    // A function body is compiled where installer.nsh is included, before
    // FileAssociation.nsh (UPDATEFILEASSOC, SHCNE_*) and electron-builder's
    // other defines; every ${...} must resolve to installer.nsh's own defines
    // or the command-line ones.
    for (const line of unregister) {
      expect(line, line).not.toMatch(/\$\{\w+\}/)
    }
    const fileAssociation = readFileSync(
      require.resolve('app-builder-lib/templates/nsis/include/FileAssociation.nsh', {
        paths: [shellDir],
      }),
      'utf8',
    )
    const define = (name: string) =>
      new RegExp(`^!define\\s+${name}\\s+(\\S+)`, 'm').exec(fileAssociation)?.[1]
    const assocChanged = define('SHCNE_ASSOCCHANGED')
    const flush = define('SHCNF_FLUSH')
    expect(assocChanged).toBeTruthy()
    expect(flush).toBeTruthy()
    expect(unregister.at(-1)).toBe(
      `System::Call "shell32::SHChangeNotify(i,i,i,i) (${assocChanged}, ${flush}, 0, 0)"`,
    )
    const lastDelete = Math.max(...unregister.map((line, i) => (/^Delete/.test(line) ? i : -1)))
    expect(lastDelete).toBeLessThan(unregister.length - 1)
  })

  it('scopes the ShellNew templates to the ProgIds electron-builder writes', () => {
    // Explorer looks for a New-menu template under .<ext>\<ProgId>\ShellNew,
    // with the ProgId APP_ASSOCIATE sets as .<ext>'s default value.
    const progIds = builderProgIds()
    const classKey = /^Software\\Classes\\\.([^\\]+)\\([^\\]+)(\\ShellNew)?$/
    const keys = (lines: string[]) =>
      lines.flatMap((line) => {
        const w = words(line)
        return w
          .map((word) => classKey.exec(word))
          .filter((m): m is RegExpExecArray => m !== null)
          .map(([key, ext, progId, shellNew]) => ({ op: w[0], key, ext, progId, shellNew }))
      })
    const installed = keys(install)
    const uninstalled = keys(uninstall)
    const written = installed.filter((k) => k.op === 'WriteRegStr' && k.shellNew)
    const removed = uninstalled.filter((k) => k.op === 'DeleteRegKey' && k.shellNew)
    expect(written.length).toBeGreaterThan(0)
    expect(removed.length).toBeGreaterThan(0)
    // every key touched (including the guard's ReadRegStr and the /ifempty
    // parent) names the ProgId of its extension
    for (const { key, ext, progId } of [...installed, ...uninstalled]) {
      expect(progIds.get(`.${ext}`), key).toBe(progId)
    }
    // uninstall removes exactly what install writes
    expect(removed.map((k) => k.key).sort()).toEqual(written.map((k) => k.key).sort())
  })

  it('relies on electron-builder still naming ProgIds after fileAssociations[].name', () => {
    // Pinned against the installed electron-builder: an upgrade that changes how
    // ProgIds or PRODUCT_NAME are derived must be re-checked against installer.nsh.
    const nsisTarget = readFileSync(
      require.resolve('app-builder-lib/out/targets/nsis/NsisTarget.js', { paths: [shellDir] }),
      'utf8',
    )
    expect(nsisTarget).toMatch(/insertMacro\("APP_ASSOCIATE",[^\n]*item\.name \|\| ext/)
    expect(nsisTarget).toContain('PRODUCT_NAME: appInfo.productName')
  })
})
