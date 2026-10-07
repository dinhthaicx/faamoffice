/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, LoginItemStatus } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SettingsModal } from '../src/renderer/src/SettingsModal'
import { strings } from '../src/renderer/src/strings'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const LABEL = 'Open FaamOffice when you sign in to this computer'
const FAILED = 'Could not change this. Please try again or check your system settings.'

let host: HTMLDivElement
let root: Root
const realPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform')

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  if (realPlatform) Object.defineProperty(navigator, 'platform', realPlatform)
  else delete (navigator as unknown as Record<string, unknown>).platform
})

function setPlatform(platform: string): void {
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true })
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

async function openGeneral(api: Partial<HomeApi>, lang: 'en' | 'vi' = 'en'): Promise<void> {
  window.aiOffice = {
    getTheme: async () => 'system',
    getDefaultSaveDir: async () => '',
    getAnalyticsEnabled: async () => true,
    setAnalyticsEnabled: async () => true,
    getAiPanelPrefs: async () => ({ fontSize: 'default', spellcheck: true }),
    setAiPanelPrefs: async (patch) => ({ fontSize: 'default', spellcheck: true, ...patch }),
    getUpdateChannel: async () => 'stable',
    getAppVersion: async () => '1.0.0',
    githubStars: async () => null,
    ...api,
  } as unknown as HomeApi

  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(SettingsModal, { onClose: vi.fn() }),
      ),
    )
    await Promise.resolve()
  })
  const general = Array.from(host.querySelectorAll<HTMLButtonElement>('.set-nav-item')).find(
    (button) => button.textContent === strings[lang].setSecGeneral,
  )
  await click(general!)
  await flush()
}

function toggle(label = LABEL): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(`.set-switch[aria-label="${label}"]`)
}

function row(): HTMLElement {
  return toggle()!.closest<HTMLElement>('.set-field')!
}

function alertText(): string | null {
  return row().querySelector('[role="alert"]')?.textContent ?? null
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const OFF: LoginItemStatus = { supported: true, enabled: false }
const ON: LoginItemStatus = { supported: true, enabled: true }

describe('Settings open-at-login switch', () => {
  it('is hidden when the build or platform cannot register a login item', async () => {
    await openGeneral({ getOpenAtLogin: async () => ({ supported: false, enabled: false }) })
    expect(toggle()).toBeNull()
    expect(host.textContent).not.toContain(LABEL)
    // the rest of General still renders
    expect(
      host.querySelector('.set-switch[aria-label="Send anonymous usage statistics"]'),
    ).not.toBeNull()
  })

  it('is hidden when the preload does not expose it', async () => {
    await openGeneral({})
    expect(toggle()).toBeNull()
  })

  it('starts off and shows the description', async () => {
    await openGeneral({ getOpenAtLogin: async () => OFF })
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
    expect(row().textContent).toContain(
      'FaamOffice will open automatically each time you sign in to your computer.',
    )
  })

  it('flips optimistically and keeps the state the main process confirms', async () => {
    const pending = deferred<LoginItemStatus>()
    const set = vi.fn(() => pending.promise)
    await openGeneral({ getOpenAtLogin: async () => OFF, setOpenAtLogin: set })

    await click(toggle()!)
    expect(set).toHaveBeenCalledWith(true)
    expect(toggle()?.getAttribute('aria-checked')).toBe('true')
    expect(toggle()?.disabled).toBe(true)

    await act(async () => {
      pending.resolve(ON)
      await pending.promise
    })
    expect(toggle()?.getAttribute('aria-checked')).toBe('true')
    expect(toggle()?.disabled).toBe(false)
    expect(alertText()).toBeNull()
  })

  it('rolls back and explains when the main process reports a different state', async () => {
    const set = vi.fn<(enabled: boolean) => Promise<LoginItemStatus>>(async () => OFF)
    await openGeneral({ getOpenAtLogin: async () => OFF, setOpenAtLogin: set })
    await click(toggle()!)
    await flush()
    expect(set).toHaveBeenCalledWith(true)
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
    expect(alertText()).toBe(FAILED)

    // the next attempt clears the message; this one goes through
    set.mockResolvedValue(ON)
    await click(toggle()!)
    await flush()
    expect(toggle()?.getAttribute('aria-checked')).toBe('true')
    expect(alertText()).toBeNull()
  })

  it('rolls back and explains when the call fails', async () => {
    const set = vi.fn(async () => {
      throw new Error('ipc failed')
    })
    await openGeneral({ getOpenAtLogin: async () => ON, setOpenAtLogin: set })
    await click(toggle()!)
    await flush()
    expect(set).toHaveBeenCalledWith(false)
    expect(toggle()?.getAttribute('aria-checked')).toBe('true')
    expect(alertText()).toBe(FAILED)
  })

  it('asks for approval in macOS Login Items and opens that page', async () => {
    setPlatform('MacIntel')
    const open = vi.fn(async () => undefined)
    const set = vi.fn(async () => ({ supported: true, enabled: true, needsApproval: true }))
    await openGeneral({
      getOpenAtLogin: async () => OFF,
      setOpenAtLogin: set,
      openLoginItemsSettings: open,
    })
    expect(row().querySelector('.set-login-approval')).toBeNull()

    expect(toggle()?.hasAttribute('aria-describedby')).toBe(false)

    await click(toggle()!)
    await flush()
    expect(toggle()?.getAttribute('aria-checked')).toBe('true')
    // a pending approval is not a failure
    expect(alertText()).toBeNull()
    // the switch says "on"; its description and a live region say what is left to do
    const noteId = toggle()!.getAttribute('aria-describedby')
    expect(noteId).toBeTruthy()
    const note = document.getElementById(noteId!)
    expect(note?.getAttribute('role')).toBe('status')
    expect(note?.textContent).toBe(
      'To finish, allow FaamOffice in System Settings → General → Login Items.',
    )
    const button = row().querySelector<HTMLButtonElement>('.set-login-approval button')!
    expect(button.textContent).toBe('Open system settings')
    await click(button)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('explains a Windows entry disabled in Startup apps and re-reads on focus', async () => {
    setPlatform('Win32')
    const get = vi
      .fn<() => Promise<LoginItemStatus>>()
      .mockResolvedValueOnce({ supported: true, enabled: false, needsApproval: true })
      .mockResolvedValue(ON)
    await openGeneral({ getOpenAtLogin: get, openLoginItemsSettings: async () => undefined })
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
    expect(row().textContent).toContain(
      'Turn this switch on to allow it again, or change it in Settings → Apps → Startup.',
    )
    expect(row().textContent).not.toContain('Login Items')

    // the user re-enabled it in Windows Settings and came back
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })
    await flush()
    expect(get).toHaveBeenCalledTimes(2)
    expect(toggle()?.getAttribute('aria-checked')).toBe('true')
    expect(row().querySelector('.set-login-approval')).toBeNull()
  })

  it('uses the Vietnamese copy', async () => {
    await openGeneral({ getOpenAtLogin: async () => OFF }, 'vi')
    const sw = toggle('Mở FaamOffice khi đăng nhập máy tính')
    expect(sw).not.toBeNull()
    expect(sw!.closest('.set-field')?.textContent).toContain(
      'FaamOffice sẽ tự mở mỗi khi bạn đăng nhập vào máy tính.',
    )
  })
})
