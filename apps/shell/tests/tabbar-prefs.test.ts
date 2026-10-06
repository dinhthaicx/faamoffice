/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LanguageButton, ThemeButton } from '../src/renderer/src/TabBar'
import { LocaleProvider } from '../src/renderer/src/locale'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let themeListeners: ((theme: string) => void)[]
let systemDark: boolean

function installApi(theme: string) {
  themeListeners = []
  const api = {
    getTheme: vi.fn(async () => theme),
    setTheme: vi.fn(async () => undefined),
    onThemeChanged: vi.fn((handler: (t: string) => void) => {
      themeListeners.push(handler)
      return () => undefined
    }),
    setLanguage: vi.fn(async () => undefined),
  }
  const tabs = { showLanguageMenu: vi.fn(async () => null as string | null) }
  Object.assign(window, { aiOffice: api, aiOfficeTabs: tabs })
  return { api, tabs }
}

beforeEach(() => {
  systemDark = false
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: systemDark,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(element: ReturnType<typeof createElement>): Promise<void> {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, element))
    await Promise.resolve()
  })
}

function button(selector: string): HTMLButtonElement {
  const el = host.querySelector<HTMLButtonElement>(selector)
  expect(el).not.toBeNull()
  return el!
}

async function click(selector: string): Promise<void> {
  await act(async () => {
    button(selector).click()
    await Promise.resolve()
  })
}

describe('tab bar theme button', () => {
  it('switches a light UI to dark and back', async () => {
    const { api } = installApi('light')
    await render(createElement(ThemeButton))
    expect(button('.tab-theme-btn').getAttribute('aria-label')).toBe('Switch to dark mode')

    await click('.tab-theme-btn')
    expect(api.setTheme).toHaveBeenLastCalledWith('dark')
    expect(button('.tab-theme-btn').getAttribute('aria-label')).toBe('Switch to light mode')

    await click('.tab-theme-btn')
    expect(api.setTheme).toHaveBeenLastCalledWith('light')
  })

  it('resolves the system theme so one click always changes what is shown', async () => {
    systemDark = true
    const { api } = installApi('system')
    await render(createElement(ThemeButton))
    expect(button('.tab-theme-btn').getAttribute('aria-label')).toBe('Switch to light mode')
    await click('.tab-theme-btn')
    expect(api.setTheme).toHaveBeenLastCalledWith('light')
  })

  it('follows a theme changed elsewhere (Settings, another window)', async () => {
    installApi('light')
    await render(createElement(ThemeButton))
    await act(async () => {
      for (const listener of themeListeners) listener('dark')
      await Promise.resolve()
    })
    expect(button('.tab-theme-btn').getAttribute('aria-label')).toBe('Switch to light mode')
  })
})

describe('tab bar language button', () => {
  it('opens the native menu under the button and applies the pick', async () => {
    const { api, tabs } = installApi('light')
    tabs.showLanguageMenu.mockResolvedValueOnce('vi')
    await render(createElement(LanguageButton))
    await click('.tab-lang-btn')
    await act(async () => {
      await Promise.resolve()
    })
    expect(tabs.showLanguageMenu).toHaveBeenCalledTimes(1)
    expect(api.setLanguage).toHaveBeenCalledWith('vi')
  })

  it('changes nothing when the menu is dismissed or answers garbage', async () => {
    const { api, tabs } = installApi('light')
    tabs.showLanguageMenu.mockResolvedValueOnce(null).mockResolvedValueOnce('xx')
    await render(createElement(LanguageButton))
    await click('.tab-lang-btn')
    await click('.tab-lang-btn')
    await act(async () => {
      await Promise.resolve()
    })
    expect(api.setLanguage).not.toHaveBeenCalled()
  })
})
