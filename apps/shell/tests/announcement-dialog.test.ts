/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnnouncementView, HomeApi } from '../src/shared/home-api'
import type { TabSummary } from '../src/shared/tabs-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import {
  ANNOUNCEMENT_FRAME_SANDBOX,
  AnnouncementDialog,
  HTML_LOAD_TIMEOUT_MS,
} from '../src/renderer/src/AnnouncementDialog'

// AppFrame's heavy children are irrelevant to the dialog / prompt precedence
vi.mock('../src/renderer/src/Home', () => ({ Home: () => null }))
vi.mock('../src/renderer/src/TabBar', () => ({ TabBar: () => null }))

import { AppFrame } from '../src/renderer/src/AppFrame'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const PNG_DATA = 'data:image/png;base64,iVBORw0KGgo='

const RICH: AnnouncementView = {
  id: 'r1',
  kind: 'rich',
  level: 'critical',
  displayMode: 'once',
  title: 'Scheduled maintenance',
  body: 'Saturday 10:00–12:00.\n<b>Sync</b> pauses.',
  image: PNG_DATA,
}

const HTML: AnnouncementView = {
  id: 'h1',
  kind: 'html',
  level: 'info',
  displayMode: 'every_launch',
  title: 'Release notes',
  htmlUrl: 'https://faamoffice.net/announcement-frame/h1?locale=en',
}

const STICKY: AnnouncementView = {
  id: 's1',
  kind: 'rich',
  level: 'warning',
  displayMode: 'until_dismissed',
  title: 'Update required',
  body: 'Please update.',
  link: { label: '' },
}

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

function mockApi(extra: Partial<HomeApi> = {}) {
  const announcementAction = vi.fn(async () => {})
  const openAnnouncementLink = vi.fn(async () => {})
  // what the main process pushes: Escape inside the html page, a failed page
  const escapeHandlers = new Set<() => void>()
  const failedHandlers = new Set<(id: string) => void>()
  const onAnnouncementEscape = vi.fn((handler: () => void) => {
    escapeHandlers.add(handler)
    return () => escapeHandlers.delete(handler)
  })
  const onAnnouncementFrameFailed = vi.fn((handler: (id: string) => void) => {
    failedHandlers.add(handler)
    return () => failedHandlers.delete(handler)
  })
  window.aiOffice = {
    announcementAction,
    openAnnouncementLink,
    onAnnouncementEscape,
    onAnnouncementFrameFailed,
    ...extra,
  } as unknown as HomeApi
  return {
    announcementAction,
    openAnnouncementLink,
    escapeHandlers,
    pushEscape: () =>
      act(() => {
        for (const handler of [...escapeHandlers]) handler()
      }),
    pushFrameFailed: (id: string) =>
      act(() => {
        for (const handler of [...failedHandlers]) handler(id)
      }),
  }
}

function render(node: ReturnType<typeof createElement>, lang: 'en' | 'vi' = 'en'): void {
  act(() => {
    root.render(createElement(LocaleProvider, { initial: lang }, node))
  })
}

/** the parent's role: drop each announcement once it closes */
function Queue({
  initial,
  onClose,
}: {
  initial: AnnouncementView[]
  onClose?: (id: string) => void
}) {
  const [list, setList] = useState(initial)
  return createElement(AnnouncementDialog, {
    announcements: list,
    total: initial.length,
    onClose: (id: string) => {
      onClose?.(id)
      setList((current) => current.filter((a) => a.id !== id))
    },
  })
}

const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')
const closeButton = () => host.querySelector<HTMLButtonElement>('.announcement-close')!
const footerButtons = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.announcement-footer button'))
const media = () => host.querySelector<HTMLElement>('.announcement-media')
const counter = () => host.querySelector('.announcement-counter')

/** the image decoded at this natural size (jsdom never decodes images) */
async function loadImage(width: number, height: number): Promise<void> {
  const image = host.querySelector<HTMLImageElement>('.announcement-media-image')!
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width })
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: height })
  await act(async () => {
    image.dispatchEvent(new Event('load'))
    await Promise.resolve()
  })
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.click()
    await Promise.resolve()
  })
}

async function key(name: string, shiftKey = false): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key: name, shiftKey, cancelable: true })
  await act(async () => {
    window.dispatchEvent(event)
    await Promise.resolve()
  })
  return event
}

describe('AnnouncementDialog', () => {
  it('renders a rich announcement as a labelled modal with image, badge and plain-text body', () => {
    const { announcementAction } = mockApi()
    render(createElement(AnnouncementDialog, { announcements: [RICH], total: 1, onClose: vi.fn() }))
    const box = dialog()!
    expect(box.getAttribute('aria-modal')).toBe('true')
    const title = host.querySelector('h2')!
    expect(title.textContent).toBe('Scheduled maintenance')
    expect(box.dataset.level).toBe('critical')
    const badge = host.querySelector('.announcement-badge')!
    expect(badge.textContent).toBe('Important')
    // the level is part of the accessible name: "Important Scheduled maintenance"
    expect(box.getAttribute('aria-labelledby')).toBe(`${badge.id} ${title.id}`)
    expect(badge.id).not.toBe('')
    expect(host.querySelector('img')!.getAttribute('src')).toBe(PNG_DATA)
    // the × sits in the header row with the badge, never over the image
    expect(closeButton().closest('.announcement-header')).toBe(badge.parentElement)
    expect(media()!.contains(closeButton())).toBe(false)
    // a single announcement shows no "1 / 1" counter
    expect(counter()).toBeNull()
    const body = host.querySelector('.announcement-body')!
    expect(box.getAttribute('aria-describedby')).toBe(body.id)
    // line breaks kept, markup shown as text
    expect(body.textContent).toBe('Saturday 10:00–12:00.\n<b>Sync</b> pauses.')
    expect(body.querySelector('b')).toBeNull()
    expect(host.querySelector('iframe')).toBeNull()
    expect(host.querySelector('input[type="checkbox"]')).toBeNull()
    // without a link the footer holds a single "Got it"
    expect(footerButtons().map((button) => button.textContent)).toEqual(['Got it'])
    // focus starts inside the dialog
    expect(document.activeElement).toBe(box)
    expect(announcementAction).toHaveBeenCalledWith('r1', 'shown')
  })

  it('names the levels in the UI language', () => {
    mockApi()
    render(
      createElement(AnnouncementDialog, {
        announcements: [{ ...RICH, level: 'info' }],
        total: 1,
        onClose: vi.fn(),
      }),
      'vi',
    )
    expect(host.querySelector('.announcement-badge')!.textContent).toBe('Thông báo')
    expect(closeButton().getAttribute('aria-label')).toBe('Đóng')
    expect(footerButtons().map((button) => button.textContent)).toEqual(['Đã hiểu'])
    act(() => root.unmount())
    root = createRoot(host)
    render(
      createElement(AnnouncementDialog, { announcements: [STICKY], total: 1, onClose: vi.fn() }),
      'vi',
    )
    expect(host.querySelector('.announcement-badge')!.textContent).toBe('Lưu ý')
    expect(footerButtons().map((button) => button.textContent)).toEqual(['Đóng', 'Xem chi tiết'])
    act(() => root.unmount())
    root = createRoot(host)
    render(
      createElement(AnnouncementDialog, { announcements: [RICH], total: 1, onClose: vi.fn() }),
      'vi',
    )
    expect(host.querySelector('.announcement-badge')!.textContent).toBe('Quan trọng')
  })

  it('embeds an html announcement in a script-less sandboxed iframe', async () => {
    vi.useFakeTimers()
    mockApi()
    render(createElement(AnnouncementDialog, { announcements: [HTML], total: 1, onClose: vi.fn() }))
    const frame = host.querySelector('iframe')!
    expect(frame.getAttribute('src')).toBe(HTML.htmlUrl)
    expect(frame.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox')
    expect(ANNOUNCEMENT_FRAME_SANDBOX).not.toMatch(/allow-scripts|allow-same-origin/)
    expect(frame.getAttribute('title')).toBe('Release notes')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(host.querySelector('[role="status"]')!.textContent).toBe('Loading…')
    expect(host.querySelector('.announcement-body')).toBeNull()

    await act(async () => {
      frame.dispatchEvent(new Event('load'))
      await Promise.resolve()
    })
    expect(host.querySelector('.announcement-frame')!.getAttribute('data-state')).toBe('ready')
    expect(host.querySelector('[role="status"]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(HTML_LOAD_TIMEOUT_MS)
    })
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows the failed state when the page never loads', () => {
    vi.useFakeTimers()
    mockApi()
    render(createElement(AnnouncementDialog, { announcements: [HTML], total: 1, onClose: vi.fn() }))
    act(() => {
      vi.advanceTimersByTime(HTML_LOAD_TIMEOUT_MS)
    })
    expect(host.querySelector('[role="alert"]')!.textContent).toBe(
      "Couldn't load this announcement.",
    )
    expect(host.querySelector('.announcement-frame')!.getAttribute('data-state')).toBe('failed')
  })

  it('opens the link by announcement id, with a fallback label', async () => {
    const { openAnnouncementLink, announcementAction } = mockApi()
    const onClose = vi.fn()
    render(createElement(AnnouncementDialog, { announcements: [STICKY], total: 1, onClose }))
    const link = host.querySelector<HTMLButtonElement>('.announcement-link')!
    expect(link.textContent).toBe('Learn more')
    await click(link)
    expect(openAnnouncementLink).toHaveBeenCalledWith('s1')
    expect(onClose).not.toHaveBeenCalled()
    expect(announcementAction).not.toHaveBeenCalledWith('s1', 'close')

    act(() => root.unmount())
    root = createRoot(host)
    render(
      createElement(AnnouncementDialog, {
        announcements: [{ ...STICKY, link: { label: 'Download' } }],
        total: 1,
        onClose,
      }),
    )
    expect(host.querySelector('.announcement-link')!.textContent).toBe('Download')
  })

  it('"Don\'t show this again" turns closing into a dismissal', async () => {
    const { announcementAction } = mockApi()
    const onClose = vi.fn()
    render(createElement(AnnouncementDialog, { announcements: [STICKY], total: 1, onClose }))
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.closest('label')!.textContent).toBe("Don't show this again")
    expect(checkbox.checked).toBe(false)
    await click(checkbox)
    expect(checkbox.checked).toBe(true)
    await click(closeButton())
    expect(announcementAction).toHaveBeenLastCalledWith('s1', 'dismiss')
    expect(onClose).toHaveBeenCalledWith('s1')
  })

  it('closing without the checkbox keeps an until_dismissed announcement', async () => {
    const { announcementAction } = mockApi()
    render(
      createElement(AnnouncementDialog, { announcements: [STICKY], total: 1, onClose: vi.fn() }),
    )
    await click(closeButton())
    expect(announcementAction).toHaveBeenLastCalledWith('s1', 'close')
  })

  it('shows several announcements one after another', async () => {
    const { announcementAction } = mockApi()
    const onClose = vi.fn()
    render(createElement(Queue, { initial: [RICH, HTML, STICKY], onClose }))
    expect(host.querySelector('h2')!.textContent).toBe('Scheduled maintenance')
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1)

    await click(closeButton())
    expect(onClose).toHaveBeenLastCalledWith('r1')
    expect(host.querySelector('h2')!.textContent).toBe('Release notes')
    expect(announcementAction).toHaveBeenCalledWith('h1', 'shown')
    expect(document.activeElement).toBe(dialog())

    await key('Escape')
    expect(host.querySelector('h2')!.textContent).toBe('Update required')
    // fresh per-announcement state
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)

    await click(closeButton())
    expect(dialog()).toBeNull()
    expect(onClose.mock.calls.map(([id]) => id)).toEqual(['r1', 'h1', 's1'])
    expect(announcementAction.mock.calls.filter(([, action]) => action !== 'shown')).toEqual([
      ['r1', 'close'],
      ['h1', 'close'],
      ['s1', 'close'],
    ])
  })

  it('Escape closes it once', async () => {
    const { announcementAction } = mockApi()
    const onClose = vi.fn()
    render(createElement(AnnouncementDialog, { announcements: [RICH], total: 1, onClose }))
    const event = await key('Escape')
    expect(event.defaultPrevented).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(announcementAction).toHaveBeenLastCalledWith('r1', 'close')
  })

  it('traps Tab inside the dialog', async () => {
    mockApi()
    render(
      createElement(AnnouncementDialog, { announcements: [STICKY], total: 1, onClose: vi.fn() }),
    )
    const close = closeButton()
    const link = host.querySelector<HTMLButtonElement>('.announcement-link')!
    // from the dialog container, Tab lands on the first control
    let event = await key('Tab')
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
    link.focus()
    event = await key('Tab')
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
    event = await key('Tab', true)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(link)
  })

  it('keeps Tab inside an html announcement', async () => {
    mockApi()
    render(createElement(AnnouncementDialog, { announcements: [HTML], total: 1, onClose: vi.fn() }))
    const close = closeButton()
    const [gotIt] = footerButtons()
    expect(gotIt.textContent).toBe('Got it')
    const frame = host.querySelector('iframe')!
    const [leading, trailing] = Array.from(
      host.querySelectorAll<HTMLElement>('.announcement-focus-guard'),
    )
    expect(leading.getAttribute('tabindex')).toBe('0')
    expect(leading.getAttribute('aria-hidden')).toBe('true')
    // guards wrap around the dialog's content
    expect(dialog()!.firstElementChild).toBe(leading)
    expect(dialog()!.lastElementChild).toBe(trailing)

    // loading: the hidden page is no tab stop, × and "Got it" are the only ones
    await key('Tab')
    expect(document.activeElement).toBe(close)
    let event = await key('Tab', true)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(gotIt)
    event = await key('Tab')
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)

    // loaded: Tab goes on into the page natively…
    await act(async () => {
      frame.dispatchEvent(new Event('load'))
      await Promise.resolve()
    })
    event = await key('Tab')
    expect(event.defaultPrevented).toBe(false)
    // …and a Tab unseen by the shell that leaves either end lands on a guard that wraps back
    act(() => trailing.focus())
    expect(document.activeElement).toBe(close)
    act(() => leading.focus())
    expect(document.activeElement).toBe(gotIt)
    // the page sits between the × and the footer in tab order
    act(() => frame.focus())
    event = await key('Tab')
    expect(event.defaultPrevented).toBe(false)
  })

  it('lets Tab move natively from a stop the trap does not list (an overflowing middle)', async () => {
    mockApi()
    render(
      createElement(AnnouncementDialog, { announcements: [STICKY], total: 1, onClose: vi.fn() }),
    )
    // Chromium makes an overflowing scroll region a tab stop of its own
    const scroll = host.querySelector<HTMLElement>('.announcement-scroll')!
    scroll.tabIndex = 0
    act(() => scroll.focus())
    const event = await key('Tab')
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(scroll)
  })

  it('keeps Escape and Tab from the UI behind the modal', async () => {
    const { announcementAction } = mockApi()
    const behind = vi.fn()
    // e.g. the Settings modal's or Home's window-level key handlers
    window.addEventListener('keydown', behind)
    try {
      const onClose = vi.fn()
      render(createElement(AnnouncementDialog, { announcements: [STICKY], total: 1, onClose }))
      const press = async (name: string) => {
        const target = document.activeElement ?? document.body
        const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
        await act(async () => {
          target.dispatchEvent(event)
          await Promise.resolve()
        })
      }
      await press('Tab')
      expect(document.activeElement).toBe(closeButton())
      await press('Escape')
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(announcementAction).toHaveBeenLastCalledWith('s1', 'close')
      expect(behind).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', behind)
    }
  })

  it('closes on Escape pressed inside the html page (reported by the main process)', async () => {
    const api = mockApi()
    const onClose = vi.fn()
    render(createElement(AnnouncementDialog, { announcements: [HTML], total: 1, onClose }))
    expect(api.escapeHandlers.size).toBe(1)
    // focus in the shell document: the window listener owns Escape
    api.pushEscape()
    expect(onClose).not.toHaveBeenCalled()
    const frame = host.querySelector('iframe')!
    act(() => frame.focus())
    expect(document.activeElement).toBe(frame)
    api.pushEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(api.announcementAction).toHaveBeenLastCalledWith('h1', 'close')
    api.pushEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not subscribe to page reports for a rich announcement', () => {
    const api = mockApi()
    render(createElement(AnnouncementDialog, { announcements: [RICH], total: 1, onClose: vi.fn() }))
    expect(api.escapeHandlers.size).toBe(0)
    expect(window.aiOffice.onAnnouncementFrameFailed).not.toHaveBeenCalled()
  })

  it('shows the failed state for a page the main process reports as failed, even once loaded', async () => {
    const api = mockApi()
    render(createElement(AnnouncementDialog, { announcements: [HTML], total: 1, onClose: vi.fn() }))
    const frame = host.querySelector('iframe')!
    const state = () => host.querySelector('.announcement-frame')!.getAttribute('data-state')
    // a 404 / blocked page still fires the load event
    await act(async () => {
      frame.dispatchEvent(new Event('load'))
      await Promise.resolve()
    })
    expect(state()).toBe('ready')
    api.pushFrameFailed('other')
    expect(state()).toBe('ready')
    api.pushFrameFailed('h1')
    expect(state()).toBe('failed')
    expect(host.querySelector('[role="alert"]')!.textContent).toBe(
      "Couldn't load this announcement.",
    )
    // a load event arriving after the report never reveals the error page
    await act(async () => {
      frame.dispatchEvent(new Event('load'))
      await Promise.resolve()
    })
    expect(state()).toBe('failed')
  })

  it('works with a preload that cannot report page events', () => {
    mockApi({
      onAnnouncementEscape: undefined,
      onAnnouncementFrameFailed: undefined,
    } as unknown as Partial<HomeApi>)
    render(createElement(AnnouncementDialog, { announcements: [HTML], total: 1, onClose: vi.fn() }))
    expect(host.querySelector('iframe')).not.toBeNull()
  })

  it('hands focus back once the last of several announcements closes', async () => {
    mockApi()
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    render(createElement(Queue, { initial: [RICH, STICKY] }))
    expect(document.activeElement).toBe(dialog())
    await click(closeButton())
    expect(host.querySelector('h2')!.textContent).toBe('Update required')
    expect(document.activeElement).toBe(dialog())
    await click(closeButton())
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('"Got it" closes like the ×, and dismisses with "Don\'t show this again" ticked', async () => {
    const { announcementAction } = mockApi()
    const onClose = vi.fn()
    const noLink: AnnouncementView = { ...STICKY, id: 's2', link: undefined }
    render(createElement(Queue, { initial: [RICH, noLink], onClose }))
    await click(footerButtons()[0])
    expect(announcementAction).toHaveBeenCalledWith('r1', 'close')
    expect(onClose).toHaveBeenLastCalledWith('r1')

    const [gotIt] = footerButtons()
    expect(gotIt.textContent).toBe('Got it')
    await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!)
    await click(gotIt)
    expect(announcementAction).toHaveBeenLastCalledWith('s2', 'dismiss')
    expect(onClose).toHaveBeenLastCalledWith('s2')
    expect(dialog()).toBeNull()
  })

  it('offers Close next to the link button; Close closes, the link does not', async () => {
    const { announcementAction, openAnnouncementLink } = mockApi()
    const onClose = vi.fn()
    render(createElement(AnnouncementDialog, { announcements: [STICKY], total: 1, onClose }))
    const [secondary, link] = footerButtons()
    expect(secondary.textContent).toBe('Close')
    expect(secondary.classList.contains('is-secondary')).toBe(true)
    expect(link.classList.contains('announcement-link')).toBe(true)
    expect(link.classList.contains('is-primary')).toBe(true)
    await click(link)
    expect(openAnnouncementLink).toHaveBeenCalledWith('s1')
    expect(onClose).not.toHaveBeenCalled()
    await click(secondary)
    expect(announcementAction).toHaveBeenLastCalledWith('s1', 'close')
    expect(onClose).toHaveBeenCalledWith('s1')
  })

  it('counts the announcements shown this session', async () => {
    mockApi()
    render(createElement(Queue, { initial: [RICH, HTML, STICKY] }))
    expect(counter()!.textContent).toBe('1 / 3')
    expect(counter()!.getAttribute('aria-hidden')).toBe('true')
    await click(closeButton())
    expect(counter()!.textContent).toBe('2 / 3')
    await key('Escape')
    expect(counter()!.textContent).toBe('3 / 3')
  })

  it('places the open announcement within the session total the parent keeps', () => {
    mockApi()
    // the first of three already closed (e.g. before the dialog was last unmounted)
    render(
      createElement(AnnouncementDialog, {
        announcements: [HTML, STICKY],
        total: 3,
        onClose: vi.fn(),
      }),
    )
    expect(counter()!.textContent).toBe('2 / 3')
    render(
      createElement(AnnouncementDialog, { announcements: [STICKY], total: 3, onClose: vi.fn() }),
    )
    expect(counter()!.textContent).toBe('3 / 3')
    // a total short of the remaining list still counts from 1
    render(
      createElement(AnnouncementDialog, {
        announcements: [RICH, STICKY],
        total: 1,
        onClose: vi.fn(),
      }),
    )
    expect(counter()!.textContent).toBe('1 / 2')
  })

  it('frames the image after measuring it: hidden at 16:9 until then', async () => {
    mockApi()
    render(createElement(AnnouncementDialog, { announcements: [RICH], total: 1, onClose: vi.fn() }))
    const frame = media()!
    expect(frame.dataset.fit).toBe('pending')
    expect(frame.style.getPropertyValue('--announcement-media-ratio')).toBe('')
    expect(host.querySelector('.announcement-media-backdrop')).toBeNull()

    // a banner close to the frame's shape fills it
    await loadImage(1600, 900)
    expect(frame.dataset.fit).toBe('cover')
    expect(Number(frame.style.getPropertyValue('--announcement-media-ratio'))).toBeCloseTo(16 / 9)
    expect(host.querySelector('.announcement-media-backdrop')).toBeNull()
  })

  it('shows a square image whole over a blurred, hidden copy of itself', async () => {
    mockApi()
    render(createElement(AnnouncementDialog, { announcements: [RICH], total: 1, onClose: vi.fn() }))
    await loadImage(1024, 1024)
    const frame = media()!
    expect(frame.dataset.fit).toBe('contain')
    expect(Number(frame.style.getPropertyValue('--announcement-media-ratio'))).toBeCloseTo(1.6)
    const backdrop = host.querySelector('.announcement-media-backdrop')!
    expect(backdrop.getAttribute('src')).toBe(PNG_DATA)
    expect(backdrop.getAttribute('alt')).toBe('')
    expect(backdrop.getAttribute('aria-hidden')).toBe('true')
    // the backdrop sits behind the image
    expect(backdrop.nextElementSibling).toBe(host.querySelector('.announcement-media-image'))
  })

  it('measures an image that decoded before its load listener was attached', () => {
    mockApi()
    // a cached data: URL may be complete by mount: no load event ever reaches onLoad
    const proto = HTMLImageElement.prototype
    const spies = [
      vi.spyOn(proto, 'complete', 'get').mockReturnValue(true),
      vi.spyOn(proto, 'naturalWidth', 'get').mockReturnValue(1600),
      vi.spyOn(proto, 'naturalHeight', 'get').mockReturnValue(900),
    ]
    try {
      render(
        createElement(AnnouncementDialog, { announcements: [RICH], total: 1, onClose: vi.fn() }),
      )
      const frame = media()!
      expect(frame.dataset.fit).toBe('cover')
      expect(Number(frame.style.getPropertyValue('--announcement-media-ratio'))).toBeCloseTo(16 / 9)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('drops the image frame when the image cannot load', async () => {
    mockApi()
    render(createElement(AnnouncementDialog, { announcements: [RICH], total: 1, onClose: vi.fn() }))
    await act(async () => {
      host.querySelector('.announcement-media-image')!.dispatchEvent(new Event('error'))
      await Promise.resolve()
    })
    expect(media()).toBeNull()
    expect(host.querySelector('h2')!.textContent).toBe('Scheduled maintenance')
  })

  it('hands focus back when it closes', async () => {
    mockApi()
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    render(createElement(AnnouncementDialog, { announcements: [RICH], total: 1, onClose: vi.fn() }))
    expect(document.activeElement).toBe(dialog())
    act(() => root.unmount())
    expect(document.activeElement).toBe(outside)
    outside.remove()
    root = createRoot(host)
  })
})

/** a rule's declarations in announcement-dialog.css, in source order, comments
 * dropped (jsdom does no layout, so the stylesheet is checked as text) */
function cssDeclarations(selector: string): string[] {
  const css = readFileSync(join(__dirname, '../src/renderer/src/announcement-dialog.css'), 'utf8')
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`))
  if (!rule) throw new Error(`no rule for ${selector}`)
  return rule[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((declaration) => declaration.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
}

describe('announcement-dialog.css', () => {
  it('centers the image frame, keeping a 20px gutter when its height cap narrows it', () => {
    // max-height carries through aspect-ratio to the width: fixed side margins
    // would leave a narrowed frame flush left on a short window
    const media = cssDeclarations('.announcement-media')
    expect(media).toContain('margin: 14px auto 0')
    expect(media).toContain('max-width: calc(100% - 40px)')
    expect(media).toContain('max-height: min(280px, 34vh)')
  })

  it("gives the footer buttons the dialog's font, not the form-control default", () => {
    const button = cssDeclarations('.announcement-button')
    const at = (property: string) =>
      button.findIndex((declaration) => declaration.startsWith(`${property}:`))
    expect(button).toContain('font: inherit')
    // the shorthand comes first, or it would reset the size, weight and line height
    for (const property of ['font-size', 'font-weight', 'line-height']) {
      expect(at(property)).toBeGreaterThan(at('font'))
    }
  })
})

describe('AppFrame announcements', () => {
  function mockFrame(options: { pending: () => Promise<AnnouncementView[]>; tabs?: TabSummary[] }) {
    const api = mockApi({
      announcementsPending: vi.fn(options.pending),
      defaultAppPromptShouldShow: vi.fn(async () => ({
        show: true,
        status: { state: 'other' as const, others: ['Microsoft Word'], manualOnly: false },
      })),
      starPromptShouldShow: vi.fn(async () => ({ show: false, docOpens: 0 })),
      defaultAppPromptAction: vi.fn(async () => ({
        state: 'other' as const,
        others: [],
        manualOnly: false,
      })),
      setOnboardingSeen: vi.fn(async () => true),
    })
    let notifyTabs: (tabs: TabSummary[]) => void = () => {}
    window.aiOfficeTabs = {
      list: vi.fn(async () => options.tabs ?? []),
      onChanged: (handler: (tabs: TabSummary[]) => void) => {
        notifyTabs = handler
        return () => {}
      },
    } as unknown as typeof window.aiOfficeTabs
    return { ...api, setTabs: (tabs: TabSummary[]) => notifyTabs(tabs) }
  }

  async function renderFrame(onboardingSeen = true): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(AppFrame, { initialOnboardingSeen: onboardingSeen }),
        ),
      )
      await Promise.resolve()
    })
    // let the queries settle
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const promptCard = () => host.querySelector('.default-app-prompt')
  const announcement = () => host.querySelector('.announcement-dialog')

  it('shows announcements first and the prompt card only after they close', async () => {
    mockFrame({ pending: async () => [RICH, STICKY] })
    await renderFrame()
    expect(announcement()).not.toBeNull()
    expect(promptCard()).toBeNull()
    await click(closeButton())
    expect(host.querySelector('h2')!.textContent).toBe('Update required')
    expect(promptCard()).toBeNull()
    await click(closeButton())
    expect(announcement()).toBeNull()
    expect(promptCard()).not.toBeNull()
  })

  it('shows the prompt card when there is no announcement', async () => {
    mockFrame({ pending: async () => [] })
    await renderFrame()
    expect(announcement()).toBeNull()
    expect(promptCard()).not.toBeNull()
  })

  it('holds the prompt card while the announcement query is in flight, and after it fails', async () => {
    let resolve: (list: AnnouncementView[]) => void = () => {}
    mockFrame({ pending: () => new Promise((r) => (resolve = r)) })
    await renderFrame()
    expect(promptCard()).toBeNull()
    await act(async () => {
      resolve([])
      await Promise.resolve()
    })
    expect(promptCard()).not.toBeNull()

    act(() => root.unmount())
    root = createRoot(host)
    mockFrame({
      pending: async () => {
        throw new Error('stale main')
      },
    })
    await renderFrame()
    expect(announcement()).toBeNull()
    expect(promptCard()).not.toBeNull()
  })

  it('renders only while Home is the active tab and resumes when it returns', async () => {
    const editor: TabSummary = {
      id: 't1',
      kind: 'docs',
      title: 'a.docx',
      closable: true,
      active: true,
    }
    const home: TabSummary = {
      id: 'home',
      kind: 'home',
      title: 'Home',
      closable: false,
      active: true,
    }
    const frame = mockFrame({ pending: async () => [RICH], tabs: [editor] })
    await renderFrame()
    expect(announcement()).toBeNull()
    expect(promptCard()).toBeNull()
    act(() => frame.setTabs([home, { ...editor, active: false }]))
    expect(announcement()).not.toBeNull()
    act(() => frame.setTabs([{ ...home, active: false }, editor]))
    expect(announcement()).toBeNull()
    act(() => frame.setTabs([home]))
    expect(host.querySelector('h2')!.textContent).toBe('Scheduled maintenance')
    // leaving Home never reported the announcement as closed
    expect(frame.announcementAction).not.toHaveBeenCalledWith('r1', 'close')
  })

  it('keeps the session count when the dialog unmounts mid-queue', async () => {
    const home: TabSummary = {
      id: 'home',
      kind: 'home',
      title: 'Home',
      closable: false,
      active: true,
    }
    const editor: TabSummary = {
      id: 't1',
      kind: 'docs',
      title: 'a.docx',
      closable: true,
      active: true,
    }
    const frame = mockFrame({ pending: async () => [RICH, HTML, STICKY], tabs: [home] })
    await renderFrame()
    expect(counter()!.textContent).toBe('1 / 3')
    await click(closeButton())
    expect(counter()!.textContent).toBe('2 / 3')
    // a document opens from the native menu or the OS, then the user comes back to Home
    act(() => frame.setTabs([{ ...home, active: false }, editor]))
    expect(announcement()).toBeNull()
    act(() => frame.setTabs([home, { ...editor, active: false }]))
    expect(host.querySelector('h2')!.textContent).toBe('Release notes')
    expect(counter()!.textContent).toBe('2 / 3')
    await click(closeButton())
    // the last one keeps its counter after another round trip
    act(() => frame.setTabs([{ ...home, active: false }, editor]))
    act(() => frame.setTabs([home, { ...editor, active: false }]))
    expect(host.querySelector('h2')!.textContent).toBe('Update required')
    expect(counter()!.textContent).toBe('3 / 3')
  })

  it('asks for the prompt only once no announcement is open', async () => {
    const frame = mockFrame({ pending: async () => [RICH] })
    await renderFrame()
    // main counts a granted prompt as shown: never ask while it cannot display
    expect(window.aiOffice.defaultAppPromptShouldShow).not.toHaveBeenCalled()
    expect(frame.announcementAction).toHaveBeenCalledWith('r1', 'shown')
    await click(closeButton())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(window.aiOffice.defaultAppPromptShouldShow).toHaveBeenCalledTimes(1)
    expect(promptCard()).not.toBeNull()
  })

  it('does not ask for the prompt while the announcement query is in flight', async () => {
    let resolve: (list: AnnouncementView[]) => void = () => {}
    mockFrame({ pending: () => new Promise((r) => (resolve = r)) })
    await renderFrame()
    expect(window.aiOffice.defaultAppPromptShouldShow).not.toHaveBeenCalled()
    await act(async () => {
      resolve([])
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(window.aiOffice.defaultAppPromptShouldShow).toHaveBeenCalledTimes(1)
    expect(promptCard()).not.toBeNull()
  })

  it('does not ask for the prompt while Home is not in front, and asks once', async () => {
    const editor: TabSummary = {
      id: 't1',
      kind: 'docs',
      title: 'a.docx',
      closable: true,
      active: true,
    }
    const home: TabSummary = {
      id: 'home',
      kind: 'home',
      title: 'Home',
      closable: false,
      active: true,
    }
    const frame = mockFrame({ pending: async () => [], tabs: [editor] })
    await renderFrame()
    expect(window.aiOffice.defaultAppPromptShouldShow).not.toHaveBeenCalled()
    await act(async () => {
      frame.setTabs([home, { ...editor, active: false }])
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(window.aiOffice.defaultAppPromptShouldShow).toHaveBeenCalledTimes(1)
    expect(promptCard()).not.toBeNull()
    // leaving and coming back keeps the answer instead of asking again
    await act(async () => {
      frame.setTabs([{ ...home, active: false }, editor])
      await new Promise((r) => setTimeout(r, 0))
    })
    await act(async () => {
      frame.setTabs([home])
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(window.aiOffice.defaultAppPromptShouldShow).toHaveBeenCalledTimes(1)
    expect(promptCard()).not.toBeNull()
  })

  it('makes the tab strip and Home inert under an open announcement', async () => {
    mockFrame({ pending: async () => [RICH] })
    await renderFrame()
    const content = host.querySelector('.app-frame-content')!
    const tabs = host.querySelector('.app-frame-tabs')!
    expect(content.hasAttribute('inert')).toBe(true)
    expect(tabs.hasAttribute('inert')).toBe(true)
    expect(announcement()!.contains(content)).toBe(false)
    await click(closeButton())
    expect(content.hasAttribute('inert')).toBe(false)
    expect(tabs.hasAttribute('inert')).toBe(false)
  })

  it('waits for onboarding to finish before asking', async () => {
    const frame = mockFrame({ pending: async () => [RICH] })
    window.aiOffice.openGenTeam = vi.fn(async () => {})
    window.aiOffice.openGitHubRepo = vi.fn(async () => {})
    await renderFrame(false)
    expect(frame.announcementAction).not.toHaveBeenCalled()
    expect(window.aiOffice.announcementsPending).not.toHaveBeenCalled()
    expect(announcement()).toBeNull()
  })
})
