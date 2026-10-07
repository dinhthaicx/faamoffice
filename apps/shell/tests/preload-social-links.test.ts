import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, SocialLinkView } from '../src/shared/home-api'
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
const loose = homeApi as unknown as { openSocialLink(id: unknown): Promise<void> }

beforeEach(() => {
  electronMocks.invoke.mockReset()
  electronMocks.on.mockReset()
  electronMocks.removeListener.mockReset()
})

const MIXED = [
  { id: 'fb1', platform: 'facebook', url: 'https://facebook.com/x' },
  { id: 'yt1', platform: 'youtube', label: '  FaamOffice TV  ' },
  { id: 'bad id', platform: 'youtube' },
  { id: 'ms1', platform: 'myspace' },
  'nope',
  null,
]

const CLEAN: SocialLinkView[] = [
  { id: 'fb1', platform: 'facebook' },
  { id: 'yt1', platform: 'youtube', label: 'FaamOffice TV' },
]

describe('follow-button preload API', () => {
  it('re-checks the list: ids, known platforms and labels only (never a URL)', async () => {
    electronMocks.invoke.mockResolvedValue(MIXED)
    expect(await homeApi.socialLinks()).toEqual(CLEAN)
    expect(electronMocks.invoke).toHaveBeenCalledWith(HOME_CHANNELS.socialLinks)
    electronMocks.invoke.mockResolvedValue('garbage')
    expect(await homeApi.socialLinks()).toEqual([])
  })

  it('normalizes pushed changes and unsubscribes', () => {
    const handler = vi.fn()
    const off = homeApi.onSocialLinksChanged(handler)
    const call = electronMocks.on.mock.calls.find(
      ([name]) => name === HOME_CHANNELS.socialLinksChanged,
    )
    expect(call).toBeDefined()
    ;(call![1] as (event: unknown, links: unknown) => void)({}, MIXED)
    expect(handler).toHaveBeenCalledWith(CLEAN)
    off()
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      HOME_CHANNELS.socialLinksChanged,
      call![1],
    )
  })

  it('opens by id only, rejecting anything that is not an id', async () => {
    electronMocks.invoke.mockResolvedValue(undefined)
    await homeApi.openSocialLink('fb1')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(HOME_CHANNELS.openSocialLink, 'fb1')
    electronMocks.invoke.mockClear()
    await expect(loose.openSocialLink('https://evil.example/')).rejects.toThrow(
      'Invalid social link id',
    )
    await expect(loose.openSocialLink(7)).rejects.toThrow('Invalid social link id')
    expect(electronMocks.invoke).not.toHaveBeenCalled()
  })
})
