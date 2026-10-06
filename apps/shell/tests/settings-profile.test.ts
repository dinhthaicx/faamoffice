/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SettingsModal } from '../src/renderer/src/SettingsModal'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

let accountListeners: ((event: unknown) => void)[] = []

function installApi(
  name: string,
  account: Record<string, unknown> = { signedIn: false, server: 'http://acct.test' },
) {
  const setProfile = vi.fn(async () => undefined)
  accountListeners = []
  const status = vi.fn(async () => account)
  const login = vi.fn(async () => undefined)
  const logout = vi.fn(async () => undefined)
  window.aiOffice = {
    getProfile: async () => ({ name }),
    setProfile,
    faamAccountStatus: status,
    faamAccountLogin: login,
    faamAccountLogout: logout,
    faamAccountCancelLogin: vi.fn(async () => undefined),
    faamAccountSetServer: vi.fn(async (url: string) => url),
    faamAccountOpenWeb: vi.fn(async () => undefined),
    onFaamAccountEvent: (handler: (event: unknown) => void) => {
      accountListeners.push(handler)
      return () => undefined
    },
    getTheme: async () => 'system',
    getDefaultSaveDir: async () => '',
    getAnalyticsEnabled: async () => true,
    getUpdateChannel: async () => 'stable',
    getAppVersion: async () => '1.0.0',
    githubStars: async () => null,
  } as unknown as HomeApi
  return { setProfile, status, login, logout }
}

async function renderModal(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(SettingsModal, { onClose: vi.fn() }),
      ),
    )
    await Promise.resolve()
  })
}

function nameInput(): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('#set-profile-name')
  expect(input).not.toBeNull()
  return input!
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

async function blur(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.focus()
    input.blur()
    await Promise.resolve()
  })
}

describe('Settings profile', () => {
  it('opens on the profile page with the stored name and no sign-in', async () => {
    installApi('Thai')
    await renderModal()
    expect(host.querySelector('.set-pane-title')?.textContent).toBe('Profile')
    expect(nameInput().value).toBe('Thai')
    expect(host.textContent).toContain('FaamOffice has no account')
    expect(host.textContent?.toLowerCase()).not.toContain('genspark')
  })

  it('saves a trimmed name on blur, and only when it changed', async () => {
    const { setProfile } = installApi('Thai')
    await renderModal()
    await blur(nameInput())
    expect(setProfile).not.toHaveBeenCalled()

    await type(nameInput(), '  Thai Dinh  ')
    await blur(nameInput())
    expect(setProfile).toHaveBeenCalledTimes(1)
    expect(setProfile).toHaveBeenCalledWith({ name: 'Thai Dinh' })

    await blur(nameInput())
    expect(setProfile).toHaveBeenCalledTimes(1)
  })
})

describe('Settings profile — FaamOffice account', () => {
  function buttonByText(text: string): HTMLButtonElement | undefined {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('.set-account button')).find(
      (b) => b.textContent === text,
    )
  }

  it('signs in through the browser and then shows the email and credits', async () => {
    const api = installApi('Thai')
    await renderModal()
    expect(host.textContent).toContain('Optional. Sign in to use Faam AI Cloud')
    await act(async () => {
      buttonByText('Sign in')!.click()
      await Promise.resolve()
    })
    expect(api.login).toHaveBeenCalledTimes(1)

    await act(async () => {
      for (const l of accountListeners) l({ phase: 'code', userCode: 'ABCD-EFGH', url: 'x' })
      await Promise.resolve()
    })
    expect(host.textContent).toContain('ABCD-EFGH')
    expect(buttonByText('Cancel')).toBeDefined()

    api.status.mockResolvedValue({
      signedIn: true,
      server: 'http://acct.test',
      email: 'a@b.c',
      credits: 1200,
    })
    await act(async () => {
      for (const l of accountListeners) l({ phase: 'success' })
      await Promise.resolve()
    })
    expect(host.textContent).toContain('a@b.c')
    expect(host.textContent).toContain('1,200 credits')
    expect(buttonByText('Sign out')).toBeDefined()
  })

  it('explains a declined sign-in and signs out on request', async () => {
    const api = installApi('Thai', {
      signedIn: true,
      server: 'http://acct.test',
      email: 'a@b.c',
      credits: 5,
    })
    await renderModal()
    await act(async () => {
      buttonByText('Sign out')!.click()
      await Promise.resolve()
    })
    expect(api.logout).toHaveBeenCalledTimes(1)

    await act(async () => {
      for (const l of accountListeners) l({ phase: 'error', error: 'denied' })
      await Promise.resolve()
    })
    expect(host.textContent).toContain('Sign-in was declined in the browser.')
  })
})
