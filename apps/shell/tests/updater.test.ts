import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateUiState } from '../src/shared/update-api'

/**
 * Main-process update flow (src/main/updater.ts): the GitHub Releases feed,
 * the per-platform flows (install on Windows / AppImage, notify on macOS and
 * Linux deb/rpm), the once-a-day nag record and the onboarding/announcement
 * gate. The card's Download / Install / Later actions come back through
 * update-window.ts callbacks.
 */

const appState = { isPackaged: true }

const openExternal = vi.hoisted(() => vi.fn())
const openPath = vi.hoisted(() => vi.fn<(file: string) => Promise<string>>())
const quitApp = vi.hoisted(() => vi.fn())
const showMessageBox = vi.hoisted(() =>
  vi.fn<(opts: unknown) => Promise<{ response: number }>>(() => Promise.resolve({ response: 0 })),
)
const readFileSyncMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => string>())
const realpathSyncMock = vi.hoisted(() => vi.fn<(file: string) => string>())
const downloadMacDmg = vi.hoisted(() => vi.fn<(opts: unknown) => Promise<string>>())

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged
    },
    getVersion: () => '0.1.0',
    getPath: (name: string) => `/fake/${name}`,
    // resources/app.asar: its package.json is read like the other resources
    getAppPath: () => '/res/app.asar',
    quit: () => quitApp(),
  },
  shell: {
    openExternal: (url: string) => openExternal(url),
    openPath: (file: string) => openPath(file),
  },
  dialog: {
    showMessageBox: (opts: unknown) => showMessageBox(opts),
  },
}))

vi.mock('node:fs', () => ({
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
  realpathSync: (file: string) => realpathSyncMock(file),
}))

// the dmg download itself is update-dmg.test.ts's subject; picking the file
// (pickMacDmg / feedFileName) stays real
vi.mock('../src/main/update-dmg', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/update-dmg')>()),
  downloadMacDmg: (opts: unknown) => downloadMacDmg(opts),
}))

type Listener = (...args: unknown[]) => unknown

const updaterState = {
  listeners: new Map<string, Listener>(),
  autoDownload: true,
  autoInstallOnAppQuit: false,
  disableDifferentialDownload: false,
  channel: null as string | null,
  allowDowngrade: false,
}
const checkForUpdates = vi.fn(() => Promise.resolve(null))
const downloadUpdate = vi.fn<() => Promise<unknown>>(() => Promise.resolve([]))
const quitAndInstall = vi.fn()

vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: (event: string, listener: Listener) => {
      updaterState.listeners.set(event, listener)
    },
    checkForUpdates: () => checkForUpdates(),
    downloadUpdate: () => downloadUpdate(),
    quitAndInstall: (...args: unknown[]) => quitAndInstall(...(args as [boolean, boolean])),
    set autoDownload(v: boolean) {
      updaterState.autoDownload = v
    },
    set autoInstallOnAppQuit(v: boolean) {
      updaterState.autoInstallOnAppQuit = v
    },
    set disableDifferentialDownload(v: boolean) {
      updaterState.disableDifferentialDownload = v
    },
    set channel(v: string | null) {
      updaterState.channel = v
      // mirrors electron-updater's real setter side effect: assigning
      // `channel` unconditionally flips allowDowngrade to true
      updaterState.allowDowngrade = true
    },
    get channel() {
      return updaterState.channel
    },
    set allowDowngrade(v: boolean) {
      updaterState.allowDowngrade = v
    },
    get allowDowngrade() {
      return updaterState.allowDowngrade
    },
  },
}))

interface UpdateActions {
  onDownload: () => void
  onInstall: () => void
  onLater: () => void
  onOpenDownload: () => void
}

const showUpdateWindow =
  vi.fn<(parent: unknown, state: UpdateUiState, actions: UpdateActions) => void>()
const rememberUpdate =
  vi.fn<(parent: unknown, state: UpdateUiState, actions: UpdateActions) => void>()
const pushUpdateState = vi.fn<(patch: Partial<UpdateUiState>) => void>()
const closeUpdateWindow = vi.fn()
/** the shell window's onboarding / announcement report */
const gate = { blocked: false, waiting: null as (() => void) | null }

vi.mock('../src/main/update-window', () => ({
  showUpdateWindow: (...args: [unknown, UpdateUiState, UpdateActions]) => showUpdateWindow(...args),
  rememberUpdate: (...args: [unknown, UpdateUiState, UpdateActions]) => rememberUpdate(...args),
  pushUpdateState: (patch: Partial<UpdateUiState>) => pushUpdateState(patch),
  closeUpdateWindow: () => closeUpdateWindow(),
  isUpdateWindowOpen: () => false,
  whenUpdatePromptAllowed: (show: () => void) => {
    if (gate.blocked) gate.waiting = show
    else show()
  },
}))

const FIRST_CHECK_DELAY_MS = 15_000
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const GITHUB_FEED = 'https://github.com/dinhthaicx/faamoffice/releases/latest/download'
const TAG_BASE = 'https://github.com/dinhthaicx/faamoffice/releases/download/v0.2.0'

/** resources/ files the updater reads: app-update.yml and package-type */
const resources = new Map<string, string>()
/** files outside resources/, by absolute path (dpkg's package file lists) */
const systemFiles = new Map<string, string>()
/** symlinks realpathSync resolves (anything else does not exist) */
const symlinks = new Map<string, string>()

const DPKG_LIST = '/var/lib/dpkg/info/faamoffice.list'
const DEB_EXE = '/opt/FaamOffice/faamoffice'

function setFeed(url: string | null): void {
  if (url === null) resources.delete('app-update.yml')
  else resources.set('app-update.yml', `provider: generic\nurl: ${url}\nchannel: latest\n`)
}

const restorers: Array<() => void> = []

function setProcessValue(key: 'platform' | 'arch' | 'execPath', value: string): void {
  const original = Object.getOwnPropertyDescriptor(process, key)!
  Object.defineProperty(process, key, { value })
  restorers.push(() => Object.defineProperty(process, key, original))
}

async function loadUpdater() {
  return import('../src/main/updater')
}

async function flushAsync(): Promise<void> {
  // drain promise chains queued by download callbacks
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function lastShownState(): UpdateUiState {
  return showUpdateWindow.mock.calls.at(-1)![1]
}

function lastShownActions(): UpdateActions {
  return showUpdateWindow.mock.calls.at(-1)![2]
}

function available(info: Record<string, unknown>): void {
  updaterState.listeners.get('update-available')!(info)
}

beforeEach(async () => {
  vi.resetModules()
  // the UI language is process-wide state; every test starts from the default
  ;(await import('@genoffice/i18n')).setUiLang('zh')
  vi.useFakeTimers()
  appState.isPackaged = true
  delete process.env.GENOFFICE_FAKE_UPDATE
  delete process.env.FAAMOFFICE_UPDATES
  delete process.env.APPIMAGE
  updaterState.listeners.clear()
  updaterState.autoDownload = true
  updaterState.autoInstallOnAppQuit = false
  updaterState.disableDifferentialDownload = false
  updaterState.channel = null
  updaterState.allowDowngrade = false
  checkForUpdates.mockReset()
  checkForUpdates.mockImplementation(() => Promise.resolve(null))
  downloadUpdate.mockReset()
  downloadUpdate.mockImplementation(() => Promise.resolve([]))
  quitAndInstall.mockClear()
  quitApp.mockClear()
  showUpdateWindow.mockClear()
  rememberUpdate.mockClear()
  pushUpdateState.mockClear()
  closeUpdateWindow.mockClear()
  openExternal.mockClear()
  openPath.mockReset()
  openPath.mockImplementation(() => Promise.resolve(''))
  downloadMacDmg.mockReset()
  downloadMacDmg.mockImplementation(() => Promise.resolve('/fake/temp/faamoffice-updates/x.dmg'))
  showMessageBox.mockReset()
  showMessageBox.mockImplementation(() => Promise.resolve({ response: 0 }))
  gate.blocked = false
  gate.waiting = null
  Object.defineProperty(process, 'resourcesPath', { value: '/res', configurable: true })
  resources.clear()
  systemFiles.clear()
  symlinks.clear()
  setFeed(GITHUB_FEED)
  readFileSyncMock.mockReset()
  readFileSyncMock.mockImplementation((file) => {
    const system = systemFiles.get(String(file))
    if (system !== undefined) return system
    if (!String(file).startsWith('/res')) throw new Error(`ENOENT ${String(file)}`)
    const name = String(file).split(/[\\/]/).pop()!
    const content = resources.get(name)
    if (content === undefined) throw new Error(`ENOENT ${String(file)}`)
    return content
  })
  realpathSyncMock.mockReset()
  realpathSyncMock.mockImplementation((file) => {
    const target = symlinks.get(file)
    if (target === undefined) throw new Error(`ENOENT ${file}`)
    return target
  })
  // the default subject: Windows x64, the install flow
  setProcessValue('platform', 'win32')
  setProcessValue('arch', 'x64')
})

afterEach(() => {
  vi.useRealTimers()
  while (restorers.length) restorers.pop()!()
  delete process.env.GENOFFICE_FAKE_UPDATE
  delete process.env.FAAMOFFICE_UPDATES
  delete process.env.APPIMAGE
})

describe('initAutoUpdater: when it checks at all', () => {
  it('does nothing in unpacked (dev) runs without the fake-update env', async () => {
    appState.isPackaged = false
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(updaterState.listeners.size).toBe(0)
    expect(checkForUpdates).not.toHaveBeenCalled()
    expect(showUpdateWindow).not.toHaveBeenCalled()
  })

  it('does nothing in builds without a baked feed (no app-update.yml)', async () => {
    setFeed(null)
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(updaterState.listeners.size).toBe(0)
    expect(checkForUpdates).not.toHaveBeenCalled()
  })

  it('treats a plain-http feed off loopback as no feed', async () => {
    setFeed('http://cdn.example.com/updates')
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(checkForUpdates).not.toHaveBeenCalled()
  })

  it('accepts a plain-http feed on loopback (local update tests)', async () => {
    setFeed('http://127.0.0.1:8765')
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('turns every check off with FAAMOFFICE_UPDATES=0', async () => {
    process.env.FAAMOFFICE_UPDATES = '0'
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(RECHECK_INTERVAL_MS)
    expect(updaterState.listeners.size).toBe(0)
    expect(checkForUpdates).not.toHaveBeenCalled()
  })

  it('does nothing on Linux installs that are neither AppImage nor deb/rpm', async () => {
    setProcessValue('platform', 'linux')
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(updaterState.listeners.size).toBe(0)
    expect(checkForUpdates).not.toHaveBeenCalled()
  })

  it('is idempotent across repeated init calls', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('checks after the initial delay and then on the periodic interval', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    expect(checkForUpdates).not.toHaveBeenCalled()
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(RECHECK_INTERVAL_MS)
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('swallows background check failures', async () => {
    checkForUpdates.mockImplementation(() => Promise.reject(new Error('offline')))
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    await flushAsync()
    expect(showUpdateWindow).not.toHaveBeenCalled()
  })
})

describe('channels', () => {
  it('reads the stable (latest) feed and never allows a downgrade', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    expect(updaterState.channel).toBe('latest')
    // must never allow a downgrade, despite electron-updater's channel setter
    // side effect
    expect(updaterState.allowDowngrade).toBe(false)
  })

  it('maps the beta channel to the latest feed (no beta feed is published)', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null, 'beta')
    expect(updaterState.channel).toBe('latest')
    expect(updaterState.allowDowngrade).toBe(false)
  })

  it('applyUpdateChannel re-checks immediately and stays on latest', async () => {
    const { initAutoUpdater, applyUpdateChannel } = await loadUpdater()
    initAutoUpdater(() => null)
    expect(checkForUpdates).not.toHaveBeenCalled()
    applyUpdateChannel('beta')
    expect(updaterState.channel).toBe('latest')
    expect(updaterState.allowDowngrade).toBe(false)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    applyUpdateChannel('stable')
    expect(updaterState.channel).toBe('latest')
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('applyUpdateChannel is a no-op before the real updater is active', async () => {
    appState.isPackaged = false
    const { initAutoUpdater, applyUpdateChannel } = await loadUpdater()
    initAutoUpdater(() => null)
    applyUpdateChannel('beta')
    expect(updaterState.channel).toBeNull()
    expect(checkForUpdates).not.toHaveBeenCalled()
  })
})

describe('install flow (Windows NSIS)', () => {
  it('configures a manual full-package download that installs on quit', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    expect(updaterState.autoDownload).toBe(false)
    expect(updaterState.autoInstallOnAppQuit).toBe(true)
    expect(updaterState.disableDifferentialDownload).toBe(true)
  })

  it('opens the update window with the available state when an update is found', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    const state = lastShownState()
    expect(state.phase).toBe('available')
    expect(state.flow).toBe('install')
    expect(state.version).toBe('0.2.0')
    expect(state.currentVersion).toBe('0.1.0')
    expect(state.percent).toBe(0)
    // strings are localized main-side and pushed into the window state
    expect(state.strings.title.length).toBeGreaterThan(0)
    expect(state.strings.install.length).toBeGreaterThan(0)
    // Settings → About learns about it too
    expect(rememberUpdate).toHaveBeenCalledTimes(1)
  })

  it('starts the download and pushes progress when the user clicks download', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0' })
    lastShownActions().onDownload()
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'downloading', percent: 0 })
    expect(downloadUpdate).toHaveBeenCalledTimes(1)

    updaterState.listeners.get('download-progress')!({ percent: 42 })
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'downloading', percent: 42 })

    updaterState.listeners.get('update-downloaded')!({ version: '0.2.0' })
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'downloaded', percent: 100 })
  })

  it('surfaces a failed download as the error phase', async () => {
    downloadUpdate.mockImplementation(() => Promise.reject(new Error('offline')))
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0' })
    lastShownActions().onDownload()
    await flushAsync()
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'error' })
  })

  it('closes the window and installs on restart when the user confirms', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0' })
    lastShownActions().onInstall()
    expect(closeUpdateWindow).toHaveBeenCalledTimes(1)
    // quitAndInstall is deferred so the window can finish closing first
    expect(quitAndInstall).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(quitAndInstall).toHaveBeenCalledWith(true, true)
    expect(quitApp).not.toHaveBeenCalled()
  })
})

describe('the once-a-day nag record', () => {
  /** an app-settings stand-in that survives a module reload ("restart") */
  function settingsStore() {
    let value: unknown
    return {
      readPromptState: () => value,
      writePromptState: vi.fn((state: unknown) => {
        value = state
      }),
    }
  }

  it('stamps the record when the card shows on its own', async () => {
    const store = settingsStore()
    const { initAutoUpdater, UPDATE_PROMPT_KEY } = await loadUpdater()
    expect(UPDATE_PROMPT_KEY).toBe('updatePrompt')
    initAutoUpdater(() => null, 'stable', store)
    available({ version: '0.2.0' })
    expect(store.writePromptState).toHaveBeenCalledWith({
      version: '0.2.0',
      dismissedAt: Date.now(),
    })
  })

  it('stays quiet for a version put away less than a day ago, then reminds again', async () => {
    const store = settingsStore()
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null, 'stable', store)
    available({ version: '0.2.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    lastShownActions().onLater()
    expect(closeUpdateWindow).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(RECHECK_INTERVAL_MS)
    available({ version: '0.2.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    // …but Settings → About still offers it
    expect(rememberUpdate).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(DAY_MS)
    available({ version: '0.2.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(2)
  })

  it('prompts again right away for a newer version', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0' })
    lastShownActions().onLater()
    available({ version: '0.3.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(2)
    expect(lastShownState().version).toBe('0.3.0')
  })

  it('keeps the record across restarts', async () => {
    const store = settingsStore()
    let updater = await loadUpdater()
    updater.initAutoUpdater(() => null, 'stable', store)
    available({ version: '0.2.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)

    // relaunch an hour later: same version, no card
    vi.advanceTimersByTime(60 * 60 * 1000)
    vi.resetModules()
    updaterState.listeners.clear()
    updater = await loadUpdater()
    updater.initAutoUpdater(() => null, 'stable', store)
    available({ version: '0.2.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)

    // relaunch the next day: the card is back
    vi.advanceTimersByTime(DAY_MS)
    vi.resetModules()
    updaterState.listeners.clear()
    updater = await loadUpdater()
    updater.initAutoUpdater(() => null, 'stable', store)
    available({ version: '0.2.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(2)
  })

  it('still holds for the session when the settings file is unwritable', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null, 'stable', {
      readPromptState: () => {
        throw new Error('EACCES')
      },
      writePromptState: () => {
        throw new Error('EACCES')
      },
    })
    available({ version: '0.2.0' })
    lastShownActions().onLater()
    available({ version: '0.2.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
  })

  it('validates the persisted record', async () => {
    const { asUpdatePromptState, isNagQuiet, NAG_INTERVAL_MS } = await loadUpdater()
    expect(asUpdatePromptState({ version: '0.2.0', dismissedAt: 5 })).toEqual({
      version: '0.2.0',
      dismissedAt: 5,
    })
    for (const bad of [null, 'x', [], {}, { version: '', dismissedAt: 1 }, { version: '1' }]) {
      expect(asUpdatePromptState(bad)).toBeNull()
    }
    const state = { version: '0.2.0', dismissedAt: 1000 }
    expect(isNagQuiet(state, '0.2.0', 1000 + NAG_INTERVAL_MS - 1)).toBe(true)
    expect(isNagQuiet(state, '0.2.0', 1000 + NAG_INTERVAL_MS)).toBe(false)
    expect(isNagQuiet(state, '0.3.0', 1001)).toBe(false)
    // a stamp from the future (clock set back) does not silence it forever
    expect(isNagQuiet(state, '0.2.0', 999)).toBe(false)
  })
})

describe('onboarding / announcement gate', () => {
  it('holds the automatic card until the shell window is clear', async () => {
    gate.blocked = true
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0' })
    expect(showUpdateWindow).not.toHaveBeenCalled()
    expect(rememberUpdate).toHaveBeenCalledTimes(1)
    gate.blocked = false
    gate.waiting!()
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    expect(lastShownState().version).toBe('0.2.0')
  })

  it('drops a held card that a newer version replaced meanwhile', async () => {
    gate.blocked = true
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0' })
    const stale = gate.waiting!
    available({ version: '0.3.0' })
    stale()
    expect(showUpdateWindow).not.toHaveBeenCalled()
    gate.waiting!()
    expect(lastShownState().version).toBe('0.3.0')
  })

  it('lets a manual check through at once', async () => {
    gate.blocked = true
    const { initAutoUpdater, checkForUpdatesNow } = await loadUpdater()
    initAutoUpdater(() => null)
    checkForUpdates.mockImplementation(() => {
      available({ version: '0.2.0' })
      return Promise.resolve({ isUpdateAvailable: true } as never)
    })
    await checkForUpdatesNow()
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
  })
})

describe('notify flow (macOS, ad-hoc signed)', () => {
  const macFiles = [
    { url: 'FaamOffice-0.2.0-arm64-mac.zip', sha512: 'zip-arm' },
    { url: 'FaamOffice-0.2.0-mac.zip', sha512: 'zip-x64' },
    { url: 'FaamOffice-0.2.0-arm64.dmg', sha512: 'dmg-arm', size: 10 },
    { url: 'FaamOffice-0.2.0.dmg', sha512: 'dmg-x64', size: 11 },
  ]

  beforeEach(() => {
    setProcessValue('platform', 'darwin')
    setProcessValue('arch', 'arm64')
  })

  it('never lets electron-updater download or install (Squirrel.Mac refuses ad-hoc apps)', async () => {
    ;(await import('@genoffice/i18n')).setUiLang('en')
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    expect(updaterState.autoDownload).toBe(false)
    expect(updaterState.autoInstallOnAppQuit).toBe(false)
    available({ version: '0.2.0', files: macFiles })
    const state = lastShownState()
    expect(state.flow).toBe('notify')
    // the card explains the drag-to-Applications step instead of a restart
    expect(state.strings.desc).toContain('Applications folder')
    expect(state.strings.ready).toContain('Applications folder')
    expect(state.strings.quit).toBe('Quit FaamOffice')
    lastShownActions().onDownload()
    await flushAsync()
    expect(downloadUpdate).not.toHaveBeenCalled()
    lastShownActions().onInstall()
    vi.advanceTimersByTime(0)
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(quitApp).toHaveBeenCalledTimes(1)
  })

  it('downloads the arch-matching dmg from its tag, verifies it and opens it', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0', files: macFiles })
    lastShownActions().onDownload()
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'downloading', percent: 0 })
    await flushAsync()
    expect(downloadMacDmg).toHaveBeenCalledTimes(1)
    const call = downloadMacDmg.mock.calls[0]![0] as {
      url: URL
      dir: string
      choice: { name: string; sha512: string }
      onProgress: (p: number) => void
    }
    expect(call.url.href).toBe(`${TAG_BASE}/FaamOffice-0.2.0-arm64.dmg`)
    expect(call.choice).toEqual({ name: 'FaamOffice-0.2.0-arm64.dmg', sha512: 'dmg-arm', size: 10 })
    expect(call.dir).toBe('/fake/temp/faamoffice-updates')
    call.onProgress(55)
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'downloading', percent: 55 })
    expect(openPath).toHaveBeenCalledWith('/fake/temp/faamoffice-updates/x.dmg')
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'ready', percent: 100 })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('takes the Intel dmg on an Intel Mac', async () => {
    setProcessValue('arch', 'x64')
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0', files: macFiles })
    lastShownActions().onDownload()
    await flushAsync()
    const call = downloadMacDmg.mock.calls[0]![0] as { url: URL }
    expect(call.url.href).toBe(`${TAG_BASE}/FaamOffice-0.2.0.dmg`)
  })

  it('falls back to the tag-pinned dmg in the browser when verification fails', async () => {
    downloadMacDmg.mockImplementation(() => Promise.reject(new Error('sha512 checksum mismatch')))
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0', files: macFiles })
    lastShownActions().onDownload()
    await flushAsync()
    expect(openPath).not.toHaveBeenCalled()
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'manual' })
    expect(openExternal).toHaveBeenCalledWith(`${TAG_BASE}/FaamOffice-0.2.0-arm64.dmg`)
    // the card's button opens it again
    lastShownActions().onOpenDownload()
    expect(openExternal).toHaveBeenCalledTimes(2)
  })

  it('falls back to the browser when the dmg cannot be opened', async () => {
    openPath.mockImplementation(() => Promise.resolve('Failed to open'))
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0', files: macFiles })
    lastShownActions().onDownload()
    await flushAsync()
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'manual' })
    expect(openExternal).toHaveBeenCalledWith(`${TAG_BASE}/FaamOffice-0.2.0-arm64.dmg`)
  })

  it('opens the download page when the feed lists no verifiable dmg', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0', files: [{ url: 'FaamOffice-0.2.0-arm64-mac.zip', sha512: 'z' }] })
    lastShownActions().onDownload()
    await flushAsync()
    expect(downloadMacDmg).not.toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledWith('https://faamoffice.net/en/download')
  })

  it('opens the Vietnamese download page for Vietnamese users', async () => {
    const i18n = await import('@genoffice/i18n')
    i18n.setUiLang('vi')
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0', files: [] })
    lastShownActions().onDownload()
    await flushAsync()
    expect(openExternal).toHaveBeenCalledWith('https://faamoffice.net/vi/download')
  })

  it('never offers an arm64-only dmg to an Intel Mac', async () => {
    setProcessValue('arch', 'x64')
    downloadMacDmg.mockImplementation(() => Promise.reject(new Error('unused')))
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0', files: [{ url: 'FaamOffice-0.2.0-arm64.dmg', sha512: 'a' }] })
    lastShownActions().onDownload()
    await flushAsync()
    expect(downloadMacDmg).not.toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledWith('https://faamoffice.net/en/download')
  })

  it('serves a local test feed from the feed directory itself', async () => {
    setFeed('http://127.0.0.1:8765')
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0', files: macFiles })
    lastShownActions().onDownload()
    await flushAsync()
    const call = downloadMacDmg.mock.calls[0]![0] as { url: URL }
    expect(call.url.href).toBe('http://127.0.0.1:8765/FaamOffice-0.2.0-arm64.dmg')
  })

  it('rebuilds absolute metadata URLs against the trusted feed', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({
      version: '0.2.0',
      files: [{ url: 'https://attacker.example/FaamOffice-0.2.0-arm64.dmg', sha512: 'a' }],
    })
    lastShownActions().onDownload()
    await flushAsync()
    const call = downloadMacDmg.mock.calls[0]![0] as { url: URL }
    expect(call.url.href).toBe(`${TAG_BASE}/FaamOffice-0.2.0-arm64.dmg`)
  })

  it('keeps an opened installer in front of a newer release found later', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0', files: macFiles })
    lastShownActions().onDownload()
    await flushAsync()
    available({ version: '0.3.0', files: [] })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
  })
})

describe('notify flow (Linux deb/rpm)', () => {
  const linuxFiles = [{ url: 'FaamOffice-0.2.0.AppImage' }, { url: 'faamoffice_0.2.0_amd64.deb' }]

  beforeEach(() => {
    setProcessValue('platform', 'linux')
    setProcessValue('execPath', DEB_EXE)
  })

  /** the package the card's action opens for this install */
  async function openedPackage(): Promise<string> {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0', files: linuxFiles })
    lastShownActions().onDownload()
    return openExternal.mock.calls.at(-1)![0] as string
  }

  it('opens the release deb in the browser and never downloads in-app', async () => {
    resources.set('package-type', 'deb\n')
    systemFiles.set(DPKG_LIST, `/.\n/opt\n/opt/FaamOffice\n${DEB_EXE}\n`)
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updaterState.autoInstallOnAppQuit).toBe(false)
    available({ version: '0.2.0', files: linuxFiles })
    expect(lastShownState().flow).toBe('notify')
    lastShownActions().onDownload()
    expect(openExternal).toHaveBeenCalledWith(`${TAG_BASE}/faamoffice_0.2.0_amd64.deb`)
    expect(downloadUpdate).not.toHaveBeenCalled()
  })

  it('derives the rpm name, which latest-linux.yml does not list', async () => {
    resources.set('package-type', 'rpm')
    expect(await openedPackage()).toBe(`${TAG_BASE}/faamoffice-0.2.0.x86_64.rpm`)
  })

  // deb and rpm are packed from one linux-unpacked dir, so both carry the
  // package-type value written last: it must not pick the format
  it('treats a deb install as deb whatever package-type says', async () => {
    resources.set('package-type', 'rpm')
    systemFiles.set(DPKG_LIST, `/opt/FaamOffice\n${DEB_EXE}\n`)
    expect(await openedPackage()).toBe(`${TAG_BASE}/faamoffice_0.2.0_amd64.deb`)
  })

  it('treats an install dpkg does not know as rpm whatever package-type says', async () => {
    resources.set('package-type', 'deb')
    expect(await openedPackage()).toBe(`${TAG_BASE}/faamoffice-0.2.0.x86_64.rpm`)
  })

  it('reads the Multi-Arch list name too', async () => {
    resources.set('package-type', 'rpm')
    systemFiles.set('/var/lib/dpkg/info/faamoffice:amd64.list', `${DEB_EXE}\n`)
    expect(await openedPackage()).toBe(`${TAG_BASE}/faamoffice_0.2.0_amd64.deb`)
  })

  it('matches an entry that reaches the executable through a symlinked directory', async () => {
    // /opt -> /data/opt: the list names /opt/…, execPath is the resolved path
    setProcessValue('execPath', `/data${DEB_EXE}`)
    symlinks.set(DEB_EXE, `/data${DEB_EXE}`)
    resources.set('package-type', 'rpm')
    systemFiles.set(DPKG_LIST, `${DEB_EXE}\n`)
    expect(await openedPackage()).toBe(`${TAG_BASE}/faamoffice_0.2.0_amd64.deb`)
  })

  it('ignores a dpkg list that does not ship this executable', async () => {
    // e.g. what an earlier deb left behind, or another copy of the app
    resources.set('package-type', 'deb')
    systemFiles.set(DPKG_LIST, '/usr/share/doc/faamoffice\n/opt/Other/faamoffice\n')
    expect(await openedPackage()).toBe(`${TAG_BASE}/faamoffice-0.2.0.x86_64.rpm`)
  })

  it('does not check from a Linux install that is neither an AppImage nor a package', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(checkForUpdates).not.toHaveBeenCalled()
  })
})

describe('AppImage moved by an update', () => {
  beforeEach(() => {
    setProcessValue('platform', 'linux')
  })

  it('reports the new AppImage path to the hook (Linux AppImage runs)', async () => {
    process.env.APPIMAGE = '/home/me/Apps/FaamOffice-0.1.0.AppImage'
    const onAppImageMoved = vi.fn()
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null, 'stable', { onAppImageMoved })
    expect(updaterState.autoInstallOnAppQuit).toBe(true)
    const listener = updaterState.listeners.get('appimage-filename-updated')
    expect(listener).toBeDefined()
    listener!('/home/me/Apps/FaamOffice-0.2.0.AppImage')
    expect(onAppImageMoved).toHaveBeenCalledWith('/home/me/Apps/FaamOffice-0.2.0.AppImage')
  })

  it('keeps installing when the hook throws', async () => {
    process.env.APPIMAGE = '/home/me/Apps/FaamOffice-0.1.0.AppImage'
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null, 'stable', {
      onAppImageMoved: () => {
        throw new Error('EROFS')
      },
    })
    expect(() =>
      updaterState.listeners.get('appimage-filename-updated')!('/home/me/Apps/x.AppImage'),
    ).not.toThrow()
  })

  it('does not listen outside Linux AppImage runs', async () => {
    resources.set('package-type', 'deb')
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null, 'stable', { onAppImageMoved: vi.fn() })
    expect(updaterState.listeners.has('appimage-filename-updated')).toBe(false)
  })
})

describe('manual download fallback (install flow)', () => {
  async function failTwiceIntoManual(files: { url: string }[]): Promise<UpdateActions> {
    downloadUpdate.mockImplementation(() => Promise.reject(new Error('signature changed')))
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0', files })
    const actions = lastShownActions()
    actions.onDownload()
    await flushAsync()
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'error' })
    actions.onDownload()
    await flushAsync()
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'manual' })
    return actions
  }

  const winFiles = [
    { url: 'FaamOffice-Setup-0.2.0.exe' },
    { url: 'FaamOffice-Setup-0.2.0-arm64.exe' },
  ]

  it('opens the tag-pinned installer of the GitHub feed', async () => {
    const actions = await failTwiceIntoManual(winFiles)
    actions.onOpenDownload()
    expect(openExternal).toHaveBeenCalledWith(`${TAG_BASE}/FaamOffice-Setup-0.2.0.exe`)
  })

  it('picks the arm64 installer on Windows arm64', async () => {
    setFeed('https://cdn.example.com/win')
    setProcessValue('arch', 'arm64')
    const actions = await failTwiceIntoManual(winFiles)
    actions.onOpenDownload()
    expect(openExternal).toHaveBeenCalledWith(
      'https://cdn.example.com/win/FaamOffice-Setup-0.2.0-arm64.exe',
    )
  })

  it('picks the arch-less installer on Windows x64 even when arm64 is listed', async () => {
    setFeed('https://cdn.example.com/win')
    const actions = await failTwiceIntoManual([...winFiles].reverse())
    actions.onOpenDownload()
    expect(openExternal).toHaveBeenCalledWith(
      'https://cdn.example.com/win/FaamOffice-Setup-0.2.0.exe',
    )
  })

  it('falls back to the x64 installer on Windows arm64 when the feed predates arm64', async () => {
    setFeed('https://cdn.example.com/win')
    setProcessValue('arch', 'arm64')
    const actions = await failTwiceIntoManual([{ url: 'FaamOffice-Setup-0.2.0.exe' }])
    actions.onOpenDownload()
    expect(openExternal).toHaveBeenCalledWith(
      'https://cdn.example.com/win/FaamOffice-Setup-0.2.0.exe',
    )
  })

  it('rebuilds absolute metadata URLs against the trusted feed base', async () => {
    const actions = await failTwiceIntoManual([
      { url: 'https://attacker.example/FaamOffice-Setup-0.2.0.exe' },
    ])
    actions.onOpenDownload()
    expect(openExternal).toHaveBeenCalledWith(`${TAG_BASE}/FaamOffice-Setup-0.2.0.exe`)
  })

  it('falls back to the website download page when no installer is listed', async () => {
    const actions = await failTwiceIntoManual([])
    actions.onOpenDownload()
    expect(openExternal).toHaveBeenCalledWith('https://faamoffice.net/en/download')
  })

  it('does not pin a version that is not a release version', async () => {
    downloadUpdate.mockImplementation(() => Promise.reject(new Error('x')))
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0/../../evil', files: winFiles })
    const actions = lastShownActions()
    actions.onDownload()
    await flushAsync()
    actions.onDownload()
    await flushAsync()
    actions.onOpenDownload()
    expect(openExternal).toHaveBeenCalledWith('https://faamoffice.net/en/download')
  })
})

describe('initAutoUpdater (fake update preview)', () => {
  it('runs a simulated download to completion in unpacked runs', async () => {
    appState.isPackaged = false
    process.env.GENOFFICE_FAKE_UPDATE = '9.9.9'
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)

    // the fake flow never touches the real updater
    expect(updaterState.listeners.size).toBe(0)

    vi.advanceTimersByTime(1500)
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    expect(lastShownState().version).toBe('9.9.9')

    lastShownActions().onDownload()
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'downloading', percent: 0 })
    vi.advanceTimersByTime(3000)
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'downloaded', percent: 100 })
    expect(checkForUpdates).not.toHaveBeenCalled()
    expect(downloadUpdate).not.toHaveBeenCalled()
  })

  it('closes the window on later and install without touching electron-updater', async () => {
    appState.isPackaged = false
    process.env.GENOFFICE_FAKE_UPDATE = '9.9.9'
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(1500)

    lastShownActions().onLater()
    expect(closeUpdateWindow).toHaveBeenCalledTimes(1)
    lastShownActions().onInstall()
    expect(closeUpdateWindow).toHaveBeenCalledTimes(2)
    expect(quitAndInstall).not.toHaveBeenCalled()
  })
})

describe('checkForUpdatesNow (r148 manual check)', () => {
  function lastDialogOpts(): { type: string; message: string; buttons: string[] } {
    return showMessageBox.mock.calls.at(-1)![0] as never
  }

  it('says a build without a feed does not check, and offers the download page', async () => {
    setFeed(null)
    const { initAutoUpdater, checkForUpdatesNow } = await loadUpdater()
    initAutoUpdater(() => null)
    showMessageBox.mockImplementation(() => Promise.resolve({ response: 1 }))

    await checkForUpdatesNow()

    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(lastDialogOpts().type).toBe('info')
    expect(lastDialogOpts().buttons.length).toBe(2)
    // not the "automatic update failed" text of a broken update
    const en = await import('@genoffice/i18n')
    en.setUiLang('en')
    await checkForUpdatesNow()
    expect(lastDialogOpts().message).toBe(
      "This build doesn't check for updates automatically. Get the latest version from the download page.",
    )
    expect(openExternal).toHaveBeenCalledWith('https://faamoffice.net/en/download')
    expect(checkForUpdates).not.toHaveBeenCalled()
  })

  it('gives the same answer in dev runs and with FAAMOFFICE_UPDATES=0', async () => {
    process.env.FAAMOFFICE_UPDATES = '0'
    const { initAutoUpdater, checkForUpdatesNow } = await loadUpdater()
    initAutoUpdater(() => null)
    await checkForUpdatesNow()
    expect(lastDialogOpts().buttons.length).toBe(2)
    expect(checkForUpdates).not.toHaveBeenCalled()
  })

  it("shows you're-up-to-date (with the current version) when nothing newer exists", async () => {
    const { initAutoUpdater, checkForUpdatesNow } = await loadUpdater()
    initAutoUpdater(() => null)
    checkForUpdates.mockImplementation(() => Promise.resolve({ isUpdateAvailable: false } as never))

    await checkForUpdatesNow()

    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(lastDialogOpts().type).toBe('info')
    expect(lastDialogOpts().message).toContain('0.1.0')
    expect(showUpdateWindow).not.toHaveBeenCalled()
  })

  it('does not report up-to-date when the updater skips the check', async () => {
    const { initAutoUpdater, checkForUpdatesNow } = await loadUpdater()
    initAutoUpdater(() => null)
    checkForUpdates.mockImplementation(() => Promise.resolve(null))
    await checkForUpdatesNow()
    expect(lastDialogOpts().type).toBe('warning')
    expect(showUpdateWindow).not.toHaveBeenCalled()
    expect(downloadUpdate).not.toHaveBeenCalled()
  })

  it('ignores duplicate clicks while checking and allows a retry afterwards', async () => {
    const { initAutoUpdater, checkForUpdatesNow } = await loadUpdater()
    initAutoUpdater(() => null)
    let resolveCheck!: (value: null) => void
    checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve
        }),
    )
    const pending = checkForUpdatesNow()
    await checkForUpdatesNow()
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    expect(showMessageBox).not.toHaveBeenCalled()
    resolveCheck(null)
    await pending
    await checkForUpdatesNow()
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
    expect(downloadUpdate).not.toHaveBeenCalled()
  })

  it('re-offers a version the user put away earlier today', async () => {
    const { initAutoUpdater, checkForUpdatesNow } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    lastShownActions().onLater()
    // background recheck stays quiet for the dismissed version…
    available({ version: '0.2.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    // …but an explicit user check offers it again, with no extra dialog
    checkForUpdates.mockImplementation(() => {
      available({ version: '0.2.0' })
      return Promise.resolve({ isUpdateAvailable: true } as never)
    })

    await checkForUpdatesNow()

    expect(showUpdateWindow).toHaveBeenCalledTimes(2)
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('resumes a downloaded update at Restart & Install instead of re-offering the download', async () => {
    const { initAutoUpdater, checkForUpdatesNow } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0' })
    lastShownActions().onDownload()
    updaterState.listeners.get('update-downloaded')!({ version: '0.2.0' })
    lastShownActions().onLater()
    checkForUpdates.mockImplementation(() => {
      available({ version: '0.2.0' })
      return Promise.resolve({ isUpdateAvailable: true } as never)
    })

    await checkForUpdatesNow()

    expect(showUpdateWindow).toHaveBeenCalledTimes(2)
    expect(lastShownState().phase).toBe('downloaded')
    expect(lastShownState().percent).toBe(100)
    lastShownActions().onDownload()
    expect(downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('resumes an in-flight download with its progress and does not start a second one', async () => {
    downloadUpdate.mockImplementation(() => new Promise(() => {}))
    const { initAutoUpdater, checkForUpdatesNow } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0' })
    lastShownActions().onDownload()
    updaterState.listeners.get('download-progress')!({ percent: 37 })
    lastShownActions().onLater()
    checkForUpdates.mockImplementation(() => {
      available({ version: '0.2.0' })
      return Promise.resolve({ isUpdateAvailable: true } as never)
    })

    await checkForUpdatesNow()

    expect(lastShownState().phase).toBe('downloading')
    expect(lastShownState().percent).toBe(37)
    lastShownActions().onDownload()
    expect(downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('leaves a newer version alone while the previous one is downloading or downloaded', async () => {
    downloadUpdate.mockImplementation(() => new Promise(() => {}))
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0' })
    lastShownActions().onDownload()
    available({ version: '0.3.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    updaterState.listeners.get('update-downloaded')!({ version: '0.2.0' })
    available({ version: '0.3.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    lastShownActions().onDownload()
    expect(downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('brings back the in-progress flow when a manual check finds a newer version mid-download', async () => {
    downloadUpdate.mockImplementation(() => new Promise(() => {}))
    const { initAutoUpdater, checkForUpdatesNow } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0' })
    lastShownActions().onDownload()
    updaterState.listeners.get('download-progress')!({ percent: 58 })
    lastShownActions().onLater()
    // background recheck with a newer version stays quiet…
    available({ version: '0.3.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    // …an explicit check re-opens the download that is already running
    checkForUpdates.mockImplementation(() => {
      available({ version: '0.3.0' })
      return Promise.resolve({ isUpdateAvailable: true } as never)
    })

    await checkForUpdatesNow()

    expect(showUpdateWindow).toHaveBeenCalledTimes(2)
    expect(lastShownState().version).toBe('0.2.0')
    expect(lastShownState().phase).toBe('downloading')
    expect(lastShownState().percent).toBe(58)
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('offers a newer version from scratch after the previous download failed', async () => {
    downloadUpdate.mockImplementation(() => Promise.reject(new Error('offline')))
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    available({ version: '0.2.0' })
    lastShownActions().onDownload()
    await flushAsync()
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'error' })
    available({ version: '0.3.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(2)
    expect(lastShownState().version).toBe('0.3.0')
    expect(lastShownState().phase).toBe('available')
    expect(lastShownState().percent).toBe(0)
  })

  it('shows the failure dialog when the check itself fails', async () => {
    const { initAutoUpdater, checkForUpdatesNow } = await loadUpdater()
    initAutoUpdater(() => null)
    checkForUpdates.mockImplementation(() => Promise.reject(new Error('offline')))

    await checkForUpdatesNow()

    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(lastDialogOpts().type).toBe('warning')
    expect(showUpdateWindow).not.toHaveBeenCalled()
  })

  it('re-shows the simulated update window in GENOFFICE_FAKE_UPDATE runs', async () => {
    appState.isPackaged = false
    process.env.GENOFFICE_FAKE_UPDATE = '9.9.9'
    const { initAutoUpdater, checkForUpdatesNow } = await loadUpdater()
    initAutoUpdater(() => null)

    await checkForUpdatesNow()

    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    expect(lastShownState().version).toBe('9.9.9')
    expect(showMessageBox).not.toHaveBeenCalled()
  })
})

describe('Microsoft Store install (process.windowsStore)', () => {
  const STORE_APP_URL = 'ms-windows-store://pdp/?ProductId=9P0RJ9J87ZNQ'
  const STORE_WEB_URL = 'https://apps.microsoft.com/detail/9P0RJ9J87ZNQ'

  function lastDialogOpts(): { type: string; message: string; buttons: string[] } {
    return showMessageBox.mock.calls.at(-1)![0] as never
  }

  beforeEach(() => {
    Object.defineProperty(process, 'windowsStore', { value: true, configurable: true })
    restorers.push(() => {
      delete (process as { windowsStore?: boolean }).windowsStore
    })
    resources.set(
      'package.json',
      JSON.stringify({
        faamofficeStore: {
          productId: '9P0RJ9J87ZNQ',
          aumid: 'FaamOffice.FaamOffice_hangrx54z3vxj!FaamOffice',
        },
      }),
    )
  })

  it('never starts electron-updater, even with a feed baked in', async () => {
    const { initAutoUpdater, applyUpdateChannel } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS + RECHECK_INTERVAL_MS)
    applyUpdateChannel('beta')
    expect(updaterState.listeners.size).toBe(0)
    expect(updaterState.channel).toBeNull()
    expect(updaterState.autoDownload).toBe(true)
    expect(checkForUpdates).not.toHaveBeenCalled()
    expect(rememberUpdate).not.toHaveBeenCalled()
  })

  it('answers Check for Updates with the Store and opens the listing', async () => {
    ;(await import('@genoffice/i18n')).setUiLang('en')
    showMessageBox.mockImplementation(() => Promise.resolve({ response: 1 }))
    const { initAutoUpdater, checkForUpdatesNow } = await loadUpdater()
    initAutoUpdater(() => null)
    await checkForUpdatesNow()
    expect(lastDialogOpts()).toMatchObject({
      type: 'info',
      message: 'FaamOffice from Microsoft Store is updated automatically by the Store.',
      buttons: ['OK', 'Open Microsoft Store'],
    })
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(STORE_APP_URL)
    expect(checkForUpdates).not.toHaveBeenCalled()
    expect(showUpdateWindow).not.toHaveBeenCalled()
  })

  it('opens the web listing when the Store app cannot be opened', async () => {
    showMessageBox.mockImplementation(() => Promise.resolve({ response: 1 }))
    openExternal.mockImplementationOnce(() => Promise.reject(new Error('no handler')))
    const { checkForUpdatesNow } = await loadUpdater()
    await checkForUpdatesNow()
    expect(openExternal.mock.calls.map(([url]) => url)).toEqual([STORE_APP_URL, STORE_WEB_URL])
  })

  it('opens nothing when the dialog is just closed', async () => {
    const { checkForUpdatesNow } = await loadUpdater()
    await checkForUpdatesNow()
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('speaks Vietnamese to Vietnamese users', async () => {
    ;(await import('@genoffice/i18n')).setUiLang('vi')
    const { checkForUpdatesNow } = await loadUpdater()
    await checkForUpdatesNow()
    expect(lastDialogOpts().message).toBe(
      'FaamOffice cài từ Microsoft Store được Microsoft Store tự động cập nhật.',
    )
    expect(lastDialogOpts().buttons).toEqual(['OK', 'Mở Microsoft Store'])
  })
})
