import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { registerAnnouncementsIpc, type AnnouncementsService } from '../src/main/announcements'
import {
  MAX_LINKS,
  SOCIAL_PLATFORM_HOSTS,
  cachedLinksFor,
  createSocialLinksService,
  parseAppConfig,
  registerSocialLinksIpc,
  socialUrlAllowed,
  validateSocialLink,
  type SocialLinksCache,
  type SocialLinksDeps,
} from '../src/main/social-links'
import { HOME_CHANNELS, SOCIAL_PLATFORMS } from '../src/shared/home-api'
import type { SocialLinkView } from '../src/shared/home-api'

const SERVER = 'https://faamoffice.net'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const FB = { id: 'fb1', platform: 'facebook', url: 'https://www.facebook.com/faamoffice' }
const YT = {
  id: 'yt1',
  platform: 'youtube',
  url: 'https://youtube.com/@faamoffice',
  label: 'FaamOffice TV',
}

interface Setup {
  answer?: unknown | (() => Promise<Response>)
  state?: unknown
  env?: Record<string, string | undefined>
  server?: string
  writeThrows?: boolean
}

function setup(options: Setup = {}) {
  let stored: unknown = options.state
  let server = options.server ?? SERVER
  const writes: SocialLinksCache[] = []
  const changes: SocialLinkView[][] = []
  const fetch = vi.fn(async (_input: string, _init?: RequestInit): Promise<Response> => {
    const answer = options.answer ?? { socials: [] }
    return typeof answer === 'function' ? (answer as () => Promise<Response>)() : json(answer)
  })
  const deps: SocialLinksDeps = {
    fetch,
    serverUrl: () => server,
    readState: () => stored,
    writeState: (state) => {
      if (options.writeThrows) throw new Error('read-only')
      writes.push(state)
      stored = state
    },
    onChange: (links) => changes.push(links),
    env: options.env ?? {},
    timeoutMs: 50,
  }
  const service = createSocialLinksService(deps)
  return {
    service,
    fetch,
    writes,
    changes,
    setServer: (next: string) => {
      server = next
    },
  }
}

describe('link validation', () => {
  it('keeps every platform on its own domains (and subdomains), https only', () => {
    expect(socialUrlAllowed('facebook', 'https://m.facebook.com/x')).not.toBeNull()
    expect(socialUrlAllowed('facebook', 'https://fb.me/x')).not.toBeNull()
    expect(socialUrlAllowed('youtube', 'https://youtu.be/abc')).not.toBeNull()
    expect(socialUrlAllowed('tiktok', 'https://vt.tiktok.com/x')).not.toBeNull()
    expect(socialUrlAllowed('x', 'https://twitter.com/x')).not.toBeNull()
    expect(socialUrlAllowed('website', 'https://faamoffice.net/vi')).not.toBeNull()
    // lookalikes, plain http, credentials, other schemes
    expect(socialUrlAllowed('facebook', 'https://evilfacebook.com/x')).toBeNull()
    expect(socialUrlAllowed('facebook', 'https://facebook.com.evil.example/x')).toBeNull()
    expect(socialUrlAllowed('youtube', 'http://youtube.com/x')).toBeNull()
    expect(socialUrlAllowed('website', 'http://faamoffice.net')).toBeNull()
    expect(socialUrlAllowed('github', 'https://user:pw@github.com/x')).toBeNull()
    expect(socialUrlAllowed('website', 'javascript:alert(1)')).toBeNull()
    expect(socialUrlAllowed('zalo', 42)).toBeNull()
  })

  it('knows the host rules of every platform the shared type lists', () => {
    expect(Object.keys(SOCIAL_PLATFORM_HOSTS).sort()).toEqual([...SOCIAL_PLATFORMS].sort())
  })

  it('drops malformed entries and cleans labels', () => {
    expect(validateSocialLink({ ...FB, platform: 'myspace' })).toBeNull()
    expect(validateSocialLink({ ...FB, id: 'has space' })).toBeNull()
    expect(validateSocialLink({ ...FB, url: 'https://instagram.com/x' })).toBeNull()
    expect(validateSocialLink(null)).toBeNull()
    expect(validateSocialLink({ ...FB, label: '  Fan\u0007page\n ' })).toEqual({
      id: 'fb1',
      platform: 'facebook',
      url: 'https://www.facebook.com/faamoffice',
      label: 'Fan page',
    })
    expect(validateSocialLink({ ...FB, label: 'x'.repeat(80) })?.label).toHaveLength(40)
  })

  it('keeps server order, the first of duplicate ids and at most MAX_LINKS', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...FB, id: `fb${i}` }))
    expect(parseAppConfig({ socials: many })).toHaveLength(MAX_LINKS)
    expect(parseAppConfig({ socials: [YT, { ...FB, id: 'yt1' }, FB] })?.map((l) => l.id)).toEqual([
      'yt1',
      'fb1',
    ])
    expect(parseAppConfig({ other: 1 })).toBeNull()
    expect(parseAppConfig([FB])).toBeNull()
  })

  it("reads only the current server's cache", () => {
    const cache = { server: SERVER, links: [FB] }
    expect(cachedLinksFor(cache, SERVER)).toHaveLength(1)
    expect(cachedLinksFor(cache, 'https://other.example')).toEqual([])
    expect(cachedLinksFor({ server: SERVER, links: 'x' }, SERVER)).toEqual([])
    expect(cachedLinksFor(undefined, SERVER)).toEqual([])
  })
})

describe('social links service', () => {
  it('shows the cached list at once, refreshes once per session and caches the answer', async () => {
    const { service, fetch, writes, changes } = setup({
      state: { server: SERVER, links: [FB] },
      answer: { socials: [FB, YT], futureKey: true },
    })
    expect(service.list()).toEqual([{ id: 'fb1', platform: 'facebook' }])
    service.start()
    await vi.waitFor(() => expect(changes).toHaveLength(1))
    expect(changes[0]).toEqual([
      { id: 'fb1', platform: 'facebook' },
      { id: 'yt1', platform: 'youtube', label: 'FaamOffice TV' },
    ])
    expect(writes).toEqual([
      {
        server: SERVER,
        links: [
          { id: 'fb1', platform: 'facebook', url: 'https://www.facebook.com/faamoffice' },
          {
            id: 'yt1',
            platform: 'youtube',
            url: 'https://youtube.com/@faamoffice',
            label: 'FaamOffice TV',
          },
        ],
      },
    ])
    // the request is public: no token, nothing but Accept
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${SERVER}/api/v1/app/config`)
    expect(init?.headers).toEqual({ Accept: 'application/json' })

    service.start()
    service.list()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(service.list()).toHaveLength(2)
  })

  it('makes no request for the list alone: the refresh waits for start()', async () => {
    const { service, fetch } = setup({
      state: { server: SERVER, links: [FB] },
      answer: { socials: [FB, YT] },
    })
    // Home mounts the buttons under first-run onboarding: only the cache is read
    for (let i = 0; i < 3; i++) expect(service.list()).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetch).not.toHaveBeenCalled()
    service.start()
    await vi.waitFor(() => expect(service.list()).toHaveLength(2))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('never hands the renderer a URL; opening goes through the listed id', async () => {
    const { service } = setup({ answer: { socials: [FB] } })
    service.list()
    await service.refresh()
    expect(JSON.stringify(service.list())).not.toContain('https://')
    expect(service.linkUrl('fb1')).toBe('https://www.facebook.com/faamoffice')
    expect(service.linkUrl('nope')).toBeNull()
    expect(service.linkUrl('https://evil.example')).toBeNull()
    expect(service.linkUrl(undefined)).toBeNull()
  })

  it('an empty answer clears the buttons and the cache', async () => {
    const { service, writes, changes } = setup({
      state: { server: SERVER, links: [FB] },
      answer: { socials: [] },
    })
    service.start()
    await vi.waitFor(() => expect(changes).toEqual([[]]))
    expect(writes).toEqual([{ server: SERVER, links: [] }])
  })

  it.each([
    ['an HTTP error', () => Promise.resolve(new Response('nope', { status: 503 }))],
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['a non-JSON body', () => Promise.resolve(new Response('<html>', { status: 200 }))],
    ['a payload without socials', () => Promise.resolve(json({ announcements: [] }))],
    ['a hanging server', () => new Promise<Response>(() => undefined)],
  ])('keeps the cached list on %s', async (_name, answer) => {
    const { service, writes, changes } = setup({
      state: { server: SERVER, links: [FB] },
      answer,
    })
    expect(service.list()).toHaveLength(1)
    await service.refresh()
    expect(writes).toEqual([])
    expect(changes).toEqual([])
    expect(service.list()).toHaveLength(1)
  })

  it('makes no request with FAAMOFFICE_ANNOUNCEMENTS=0, still showing the cache', async () => {
    const { service, fetch } = setup({
      state: { server: SERVER, links: [FB] },
      env: { FAAMOFFICE_ANNOUNCEMENTS: '0' },
    })
    expect(service.list()).toHaveLength(1)
    await service.refresh()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not write when nothing changed, and survives an unwritable settings file', async () => {
    const same = setup({ state: { server: SERVER, links: [FB] }, answer: { socials: [FB] } })
    same.service.list()
    await same.service.refresh()
    expect(same.writes).toEqual([])
    expect(same.changes).toEqual([])

    const readOnly = setup({ answer: { socials: [FB] }, writeThrows: true })
    readOnly.service.start()
    await vi.waitFor(() => expect(readOnly.changes).toHaveLength(1))
    expect(readOnly.service.linkUrl('fb1')).not.toBeNull()
  })

  it("switches to the new server's list when the account server changes", async () => {
    const other = 'https://acct.example'
    let answer: unknown = { socials: [FB] }
    const ctx = setup({
      state: { server: SERVER, links: [FB] },
      answer: () => Promise.resolve(json(answer)),
    })
    ctx.service.list()
    await ctx.service.refresh()
    answer = { socials: [YT] }
    ctx.setServer(other)
    ctx.service.serverChanged()
    // the old server's cache is not shown for the new one
    expect(ctx.changes[0]).toEqual([])
    await vi.waitFor(() => expect(ctx.changes).toHaveLength(2))
    expect(ctx.changes[1]).toEqual([{ id: 'yt1', platform: 'youtube', label: 'FaamOffice TV' }])
    expect(ctx.writes.at(-1)?.server).toBe(other)
    expect(String(ctx.fetch.mock.calls.at(-1)![0])).toBe(`${other}/api/v1/app/config`)
  })

  it('ignores an unusable server address', async () => {
    const { service, fetch } = setup({ server: 'not a url' })
    expect(service.list()).toEqual([])
    await service.refresh()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('social links IPC', () => {
  it('lists and opens only listed links by id', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipc = {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(channel, fn),
    }
    const { service } = setup({ answer: { socials: [FB] } })
    const openExternal = vi.fn(async () => undefined)
    registerSocialLinksIpc(ipc, service, openExternal)

    handlers.get(HOME_CHANNELS.socialLinks)!({})
    await service.refresh()
    expect(handlers.get(HOME_CHANNELS.socialLinks)!({})).toEqual([
      { id: 'fb1', platform: 'facebook' },
    ])
    handlers.get(HOME_CHANNELS.openSocialLink)!({}, 'fb1')
    handlers.get(HOME_CHANNELS.openSocialLink)!({}, 'https://evil.example/')
    handlers.get(HOME_CHANNELS.openSocialLink)!({}, 'unknown')
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith('https://www.facebook.com/faamoffice')
  })
})

describe('social links refresh timing', () => {
  /** an announcements service that answers at once with nothing */
  const announcements = {
    pending: vi.fn(async () => []),
    action: vi.fn(),
    linkUrl: vi.fn(() => null),
  } as unknown as AnnouncementsService

  it('starts with the announcement query, never before it (first-run onboarding)', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipc = {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(channel, fn),
    }
    const { service, fetch } = setup({ answer: { socials: [FB] } })
    const open = async () => undefined
    registerAnnouncementsIpc(ipc, announcements, open, () => service.start())
    registerSocialLinksIpc(ipc, service, open)

    // the sidebar asks for its buttons while onboarding is still up
    expect(handlers.get(HOME_CHANNELS.socialLinks)!({})).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetch).not.toHaveBeenCalled()

    // onboarding done: AppFrame makes the announcement query
    await handlers.get(HOME_CHANNELS.announcementsPending)!({})
    await handlers.get(HOME_CHANNELS.announcementsPending)!({})
    await vi.waitFor(() =>
      expect(handlers.get(HOME_CHANNELS.socialLinks)!({})).toEqual([
        { id: 'fb1', platform: 'facebook' },
      ]),
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('is wired that way in the shell main process', () => {
    const source = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    expect(source).toMatch(
      /registerAnnouncementsIpc\(\s*ipcMain,\s*announcements,\s*\(url\) => shell\.openExternal\(url\),\s*\(\) => socialLinks\.start\(\),\s*\)/,
    )
  })
})
