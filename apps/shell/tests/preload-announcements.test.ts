import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import { HOME_CHANNELS } from '../src/shared/home-api'

const electronMocks = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => electronMocks.exposed.set(name, api),
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    send: vi.fn(),
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
  // the preload imports @genoffice/electron-utils (drop-open bridge), which
  // binds webUtils at module scope even though node env never installs it
  webUtils: { getPathForFile: () => '' },
}))

import '../src/preload/index'

const homeApi = electronMocks.exposed.get('aiOffice') as HomeApi
const loose = homeApi as unknown as {
  announcementAction(id: unknown, action: unknown): Promise<void>
  openAnnouncementLink(id: unknown): Promise<void>
}

const PNG_DATA = 'data:image/png;base64,iVBORw0KGgo='

beforeEach(() => {
  electronMocks.invoke.mockReset()
  electronMocks.on.mockReset()
  electronMocks.removeListener.mockReset()
})

/** the IPC listener the preload registered for `channel` */
function registered(channel: string): (event: unknown, ...args: unknown[]) => void {
  const call = electronMocks.on.mock.calls.find(([name]) => name === channel)
  if (!call) throw new Error(`nothing listens on ${channel}`)
  return call[1] as (event: unknown, ...args: unknown[]) => void
}

describe('announcement preload API', () => {
  it('rejects invalid ids and actions before invoking the main process', async () => {
    await expect(loose.announcementAction('', 'close')).rejects.toThrow('Invalid announcement id')
    await expect(loose.announcementAction('a b', 'close')).rejects.toThrow(
      'Invalid announcement id',
    )
    await expect(loose.announcementAction(7, 'close')).rejects.toThrow('Invalid announcement id')
    await expect(loose.announcementAction('a1', 'delete')).rejects.toThrow(
      'Invalid announcement action',
    )
    await expect(loose.announcementAction('a1', undefined)).rejects.toThrow(
      'Invalid announcement action',
    )
    await expect(loose.openAnnouncementLink('https://evil.example/')).rejects.toThrow(
      'Invalid announcement id',
    )
    await expect(loose.openAnnouncementLink(null)).rejects.toThrow('Invalid announcement id')
    expect(electronMocks.invoke).not.toHaveBeenCalled()
  })

  it('forwards valid calls over their channels', async () => {
    electronMocks.invoke.mockResolvedValue(undefined)
    for (const action of ['shown', 'dismiss', 'close'] as const) {
      await homeApi.announcementAction('a1', action)
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(
        HOME_CHANNELS.announcementAction,
        'a1',
        action,
      )
    }
    await homeApi.openAnnouncementLink('a1')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(HOME_CHANNELS.openAnnouncementLink, 'a1')
  })

  it('normalizes the pending list and drops anything off-shape', async () => {
    electronMocks.invoke.mockResolvedValue([
      {
        id: 'r1',
        kind: 'rich',
        level: 'warning',
        displayMode: 'until_dismissed',
        title: 'Rich',
        body: 'Body',
        image: PNG_DATA,
        link: { label: 'Read', url: 'https://smuggled.example/' },
        extra: 'ignored',
      },
      {
        id: 'h1',
        kind: 'html',
        level: 'info',
        displayMode: 'once',
        title: 'Html',
        htmlUrl: 'https://faamoffice.net/announcement-frame/h1',
        body: 'not for html',
      },
      {
        id: 'r2',
        kind: 'rich',
        level: 'info',
        displayMode: 'once',
        title: 'x',
        image: 'https://x/y.png',
      },
      {
        id: 'h2',
        kind: 'html',
        level: 'info',
        displayMode: 'once',
        title: 'x',
        htmlUrl: 'javascript:1',
      },
      { id: 'bad id', kind: 'rich', level: 'info', displayMode: 'once', title: 'x' },
      { id: 'k', kind: 'video', level: 'info', displayMode: 'once', title: 'x' },
      { id: 'l', kind: 'rich', level: 'loud', displayMode: 'once', title: 'x' },
      { id: 'm', kind: 'rich', level: 'info', displayMode: 'sometimes', title: 'x' },
      { id: 't', kind: 'rich', level: 'info', displayMode: 'once', title: '' },
      null,
      'text',
    ])
    const list = await homeApi.announcementsPending()
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(HOME_CHANNELS.announcementsPending)
    expect(list).toEqual([
      {
        id: 'r1',
        kind: 'rich',
        level: 'warning',
        displayMode: 'until_dismissed',
        title: 'Rich',
        body: 'Body',
        image: PNG_DATA,
        link: { label: 'Read' },
      },
      {
        id: 'h1',
        kind: 'html',
        level: 'info',
        displayMode: 'once',
        title: 'Html',
        htmlUrl: 'https://faamoffice.net/announcement-frame/h1',
      },
      // a non-data: image is dropped, the announcement stays
      { id: 'r2', kind: 'rich', level: 'info', displayMode: 'once', title: 'x' },
    ])
  })

  it('relays Escape from the main process and unsubscribes', () => {
    const handler = vi.fn()
    const off = homeApi.onAnnouncementEscape(handler)
    const listener = registered(HOME_CHANNELS.announcementEscape)
    listener({}, 'ignored', { payload: true })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith()
    off()
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      HOME_CHANNELS.announcementEscape,
      listener,
    )
  })

  it('relays frame failures with a valid announcement id only', () => {
    const handler = vi.fn()
    const off = homeApi.onAnnouncementFrameFailed(handler)
    const listener = registered(HOME_CHANNELS.announcementFrameFailed)
    for (const bad of [undefined, null, 7, '', 'a b', { id: 'h1' }, 'x'.repeat(129)]) {
      listener({}, bad)
    }
    expect(handler).not.toHaveBeenCalled()
    listener({}, 'h1')
    expect(handler).toHaveBeenCalledWith('h1')
    off()
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      HOME_CHANNELS.announcementFrameFailed,
      listener,
    )
  })

  it('reports a malformed reply as no announcements', async () => {
    for (const reply of [undefined, null, 'x', { announcements: [] }]) {
      electronMocks.invoke.mockResolvedValue(reply)
      await expect(homeApi.announcementsPending()).resolves.toEqual([])
    }
  })
})
