/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DefaultAppPromptAction, DefaultAppStatus, HomeApi } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import {
  DefaultAppPromptCard,
  SUCCESS_CLOSE_MS,
  WINDOWS_CLOSE_MS,
} from '../src/renderer/src/DefaultAppPromptCard'
import { pickHomePrompt } from '../src/renderer/src/home-prompt'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const MAC_OTHER: DefaultAppStatus = {
  state: 'other',
  others: ['Microsoft Word'],
  manualOnly: false,
}
// realistic Windows data: HKCR\<ProgId> defaults are file-type descriptions
const WIN_OTHER: DefaultAppStatus = {
  state: 'other',
  others: ['Microsoft Word Document', 'Microsoft Excel Worksheet'],
  manualOnly: true,
}
const CLAIMED: DefaultAppStatus = { state: 'default', others: [], manualOnly: false }

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
  vi.useRealTimers()
})

function mockAction(result: () => Promise<DefaultAppStatus>) {
  const action = vi.fn(async (_action: DefaultAppPromptAction) => result())
  window.aiOffice = { defaultAppPromptAction: action } as unknown as HomeApi
  return action
}

function render(status: DefaultAppStatus, onClose: () => void, lang: 'en' | 'vi' = 'en'): void {
  act(() => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(DefaultAppPromptCard, { status, onClose }),
      ),
    )
  })
}

/** a button by its visible text (the icon-only × is reached via closeButton()) */
function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent === label,
  )
  expect(found, `button "${label}"`).toBeDefined()
  return found!
}

function closeButton(): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>('.star-prompt-close')!
}

function statusText(): string {
  return host.querySelector('[role="status"]')?.textContent ?? ''
}

function alertText(): string {
  return host.querySelector('[role="alert"]')?.textContent ?? ''
}

/** resolves the pending set() call with `status` */
function pendingSet() {
  let resolveSet: (status: DefaultAppStatus) => void = () => {}
  const action = mockAction(
    () =>
      new Promise<DefaultAppStatus>((resolve) => {
        resolveSet = resolve
      }),
  )
  const settle = async (status: DefaultAppStatus) => {
    await act(async () => {
      resolveSet(status)
      await Promise.resolve()
    })
  }
  return { action, settle }
}

async function click(target: HTMLButtonElement): Promise<void> {
  await act(async () => {
    target.click()
    await Promise.resolve()
  })
}

function card(): HTMLElement | null {
  return host.querySelector<HTMLElement>('[role="dialog"]')
}

describe('DefaultAppPromptCard', () => {
  it('names the file types and the current owner as a labelled dialog', () => {
    mockAction(async () => CLAIMED)
    render(MAC_OTHER, vi.fn())
    const dialog = card()!
    expect(dialog.getAttribute('aria-label')).toBe('Open Office files with FaamOffice?')
    expect(dialog.textContent).toContain('Word (.docx), Excel (.xlsx, .xls, .xlsm)')
    expect(dialog.textContent).toContain('PowerPoint (.pptx)')
    expect(dialog.textContent).toContain('Currently opened by: Microsoft Word')
    expect(dialog.textContent).not.toContain('Default apps page')
    expect(button('Set as default')).toBeTruthy()
  })

  it('omits the owner line when no app holds the types', () => {
    mockAction(async () => CLAIMED)
    render({ ...MAC_OTHER, others: [] }, vi.fn())
    expect(card()!.textContent).not.toContain('Currently opened by')
  })

  it("lists several owners in the UI language's list style", () => {
    mockAction(async () => CLAIMED)
    const owners = { ...MAC_OTHER, others: ['Microsoft Word', 'Microsoft Excel'] }
    render(owners, vi.fn())
    expect(card()!.textContent).toContain('Currently opened by: Microsoft Word and Microsoft Excel')
    act(() => root.unmount())
    root = createRoot(host)
    render(owners, vi.fn(), 'vi')
    expect(card()!.textContent).toContain('Hiện đang mở bằng: Microsoft Word và Microsoft Excel')
  })

  it('live regions are mounted (empty) before any message arrives', () => {
    mockAction(async () => CLAIMED)
    render(MAC_OTHER, vi.fn())
    expect(host.querySelector('[role="status"]')).not.toBeNull()
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    expect(statusText()).toBe('')
    expect(alertText()).toBe('')
  })

  it('mac: set → busy → success line → closes on its own', async () => {
    vi.useFakeTimers()
    const { action, settle } = pendingSet()
    const onClose = vi.fn()
    render(MAC_OTHER, onClose)

    const primary = button('Set as default')
    primary.focus()
    await click(primary)
    expect(action).toHaveBeenCalledWith('set')
    expect(primary.disabled).toBe(true)
    expect(primary.getAttribute('aria-busy')).toBe('true')

    await settle(CLAIMED)
    expect(statusText()).toBe('FaamOffice is now your default app.')
    // the focused button is gone: focus stays in the card instead of <body>
    expect(document.activeElement).toBe(closeButton())
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(SUCCESS_CLOSE_MS)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('Windows: system-page label, explanatory note, follow-up, then closes', async () => {
    vi.useFakeTimers()
    const action = mockAction(async () => WIN_OTHER)
    const onClose = vi.fn()
    render(WIN_OTHER, onClose)

    // Windows "owners" are file-type descriptions, not apps: no owner line
    expect(card()!.textContent).not.toContain('Currently opened by')
    expect(card()!.textContent).not.toContain('Microsoft Word Document')
    expect(card()!.textContent).toContain(
      'Windows will open the Default apps page. Choose FaamOffice for .docx, .xlsx, .xls, .xlsm and .pptx.',
    )
    expect(
      Array.from(host.querySelectorAll('button')).some((b) => b.textContent === 'Set as default'),
    ).toBe(false)

    await click(button('Open Default apps'))
    expect(action).toHaveBeenCalledWith('set')
    expect(statusText()).toBe(
      'On the Default apps page, choose FaamOffice for .docx, .xlsx, .xls, .xlsm and .pptx.',
    )
    expect(card()!.textContent).not.toContain("Couldn't set it")

    // the Windows follow-up outlives the mac success line
    act(() => {
      vi.advanceTimersByTime(SUCCESS_CLOSE_MS)
    })
    expect(onClose).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(WINDOWS_CLOSE_MS - SUCCESS_CLOSE_MS)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('mac failure: explains where to retry and keeps Later available', async () => {
    const action = mockAction(async () => MAC_OTHER)
    const onClose = vi.fn()
    render(MAC_OTHER, onClose)

    await click(button('Set as default'))
    expect(alertText()).toBe("Couldn't set it. You can try again in Settings → General.")
    expect(statusText()).toBe('')
    expect(onClose).not.toHaveBeenCalled()
    const primary = button('Set as default')
    expect(primary.disabled).toBe(false)

    await click(button('Later'))
    expect(action).toHaveBeenLastCalledWith('later')
    expect(onClose).toHaveBeenCalledTimes(1)
    // the parent unmounts the closed card: no second close report
    act(() => root.unmount())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a rejected set call is reported as a failure', async () => {
    mockAction(async () => {
      throw new Error('ipc down')
    })
    const onClose = vi.fn()
    render(MAC_OTHER, onClose)
    await click(button('Set as default'))
    expect(alertText()).toContain("Couldn't set it")
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaving Home while set() runs settles the prompt instead of asking again', async () => {
    const { action, settle } = pendingSet()
    const onClose = vi.fn()
    render(MAC_OTHER, onClose)
    await click(button('Set as default'))
    expect(onClose).not.toHaveBeenCalled()

    // an editor tab became active: AppFrame unmounts the card mid-call
    act(() => root.unmount())
    expect(onClose).toHaveBeenCalledTimes(1)
    await settle(CLAIMED)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('leaving Home on the failure line also settles the prompt', async () => {
    mockAction(async () => MAC_OTHER)
    const onClose = vi.fn()
    render(MAC_OTHER, onClose)
    await click(button('Set as default'))
    expect(alertText()).not.toBe('')
    act(() => root.unmount())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaving Home during the success line closes it once', async () => {
    vi.useFakeTimers()
    const { settle } = pendingSet()
    const onClose = vi.fn()
    render(MAC_OTHER, onClose)
    await click(button('Set as default'))
    await settle(CLAIMED)
    expect(onClose).not.toHaveBeenCalled()
    act(() => root.unmount())
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(WINDOWS_CLOSE_MS)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaving Home before any reaction keeps the prompt for the return', () => {
    mockAction(async () => MAC_OTHER)
    const onClose = vi.fn()
    render(MAC_OTHER, onClose)
    act(() => root.unmount())
    expect(onClose).not.toHaveBeenCalled()
  })

  it("Later and Don't ask again send their actions and close", async () => {
    const action = mockAction(async () => MAC_OTHER)
    const onClose = vi.fn()
    render(MAC_OTHER, onClose)
    const later = button('Later')
    // the visible text button, not the icon-only ×
    expect(later.classList.contains('star-prompt-done')).toBe(true)
    await click(later)
    expect(action).toHaveBeenCalledWith('later')
    expect(action).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    root = createRoot(host)
    const action2 = mockAction(async () => MAC_OTHER)
    const onClose2 = vi.fn()
    render(MAC_OTHER, onClose2)
    await click(button("Don't ask again"))
    expect(action2).toHaveBeenCalledWith('never')
    expect(onClose2).toHaveBeenCalledTimes(1)
  })

  it('the close (×) button means later', async () => {
    const action = mockAction(async () => MAC_OTHER)
    const onClose = vi.fn()
    render(MAC_OTHER, onClose)
    const close = closeButton()
    // its own accessible name: no two buttons are called "Later"
    expect(close.getAttribute('aria-label')).toBe('Close')
    const named = Array.from(host.querySelectorAll('button')).filter(
      (b) => (b.getAttribute('aria-label') ?? b.textContent) === 'Later',
    )
    expect(named).toHaveLength(1)
    await click(close)
    expect(action).toHaveBeenCalledWith('later')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the close (×) button on a settled card only closes it', async () => {
    vi.useFakeTimers()
    const { action, settle } = pendingSet()
    const onClose = vi.fn()
    render(MAC_OTHER, onClose)
    await click(button('Set as default'))
    await settle(CLAIMED)
    await click(closeButton())
    expect(onClose).toHaveBeenCalledTimes(1)
    // no stray 'later' after the claim
    expect(action).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledWith('set')
    act(() => {
      vi.advanceTimersByTime(SUCCESS_CLOSE_MS)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders the Vietnamese copy', () => {
    mockAction(async () => CLAIMED)
    render(MAC_OTHER, vi.fn(), 'vi')
    expect(card()!.getAttribute('aria-label')).toBe('Mở tài liệu Office bằng FaamOffice?')
    expect(card()!.textContent).toContain('Hiện đang mở bằng: Microsoft Word')
    expect(button('Đặt làm mặc định')).toBeTruthy()
    expect(button('Không hỏi lại')).toBeTruthy()
  })
})

describe('pickHomePrompt (one home-screen prompt per session)', () => {
  it('shows the default-app prompt and never queries the star prompt', async () => {
    const starPromptShouldShow = vi.fn(async () => ({ show: true, docOpens: 9 }))
    const picked = await pickHomePrompt({
      defaultAppPromptShouldShow: async () => ({ show: true, status: MAC_OTHER }),
      starPromptShouldShow,
    })
    expect(picked).toEqual({ kind: 'defaultApp', status: MAC_OTHER })
    // querying the star prompt would already count it as shown
    expect(starPromptShouldShow).not.toHaveBeenCalled()
  })

  it('falls back to the star prompt when the default-app prompt declines', async () => {
    const picked = await pickHomePrompt({
      defaultAppPromptShouldShow: async () => ({ show: false, status: CLAIMED }),
      starPromptShouldShow: async () => ({ show: true, docOpens: 7 }),
    })
    expect(picked).toEqual({ kind: 'star', docOpens: 7 })
  })

  it('falls back to the star prompt on a failed or missing default-app query', async () => {
    const star = async () => ({ show: true, docOpens: 5 })
    expect(
      await pickHomePrompt({
        defaultAppPromptShouldShow: async () => {
          throw new Error('stale main')
        },
        starPromptShouldShow: star,
      }),
    ).toEqual({ kind: 'star', docOpens: 5 })
    expect(await pickHomePrompt({ starPromptShouldShow: star })).toEqual({
      kind: 'star',
      docOpens: 5,
    })
  })

  it('returns null when neither prompt applies', async () => {
    expect(
      await pickHomePrompt({
        defaultAppPromptShouldShow: async () => ({ show: false, status: CLAIMED }),
        starPromptShouldShow: async () => ({ show: false, docOpens: 0 }),
      }),
    ).toBeNull()
    expect(await pickHomePrompt({})).toBeNull()
  })
})
