import { describe, expect, it, vi } from 'vitest'
import {
  ANNOUNCEMENTS_ENV,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_REDIRECTS,
  PRUNE_AFTER_MS,
  asAnnouncementsState,
  createAnnouncementsService,
  guardAnnouncementFrames,
  matchesImageType,
  registerAnnouncementsIpc,
  type AnnouncementsDeps,
  type AnnouncementsState,
} from '../src/main/announcements'
import { HOME_CHANNELS } from '../src/shared/home-api'

const SERVER = 'https://faamoffice.net'
const NOW = Date.parse('2026-10-07T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const T1 = '2026-10-01T08:00:00.000Z'
const T2 = '2026-10-05T09:30:00.000Z'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46])
const GIF = new TextEncoder().encode('GIF89a\u0001\u0000')
const WEBP = new TextEncoder().encode('RIFF\u0010\u0000\u0000\u0000WEBPVP8 ')

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a1',
    kind: 'rich',
    level: 'info',
    displayMode: 'once',
    title: 'Hello',
    body: 'Line 1\nLine 2',
    startsAt: '2026-10-01T00:00:00.000Z',
    updatedAt: T1,
    ...overrides,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function image(bytes: Uint8Array, type: string, extra: Record<string, string> = {}): Response {
  return new Response(bytes, { status: 200, headers: { 'Content-Type': type, ...extra } })
}

interface Setup {
  /** the list endpoint's answer (a payload is wrapped as JSON 200) */
  list?: unknown | (() => Promise<Response>)
  /** image URL → response factory */
  images?: Record<string, () => Response>
  state?: unknown
  env?: Record<string, string | undefined>
  server?: string
  timeoutMs?: number
  platform?: string
  writeThrows?: boolean
}

function setup(options: Setup = {}) {
  let stored: unknown = options.state
  const writes: AnnouncementsState[] = []
  const fetch = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input)
    if (url.pathname.endsWith('/api/v1/announcements')) {
      const list = options.list ?? { announcements: [] }
      return typeof list === 'function' ? (list as () => Promise<Response>)() : json(list)
    }
    const make = options.images?.[input]
    const response = make ? make() : new Response('missing', { status: 404 })
    // like the real fetch: follow redirects unless told not to
    const location = response.headers.get('location')
    if (
      init?.redirect !== 'manual' &&
      location &&
      response.status >= 300 &&
      response.status < 400
    ) {
      const next = new URL(location, input).href
      const followed = await fetch(next, init)
      Object.defineProperty(followed, 'url', { value: next })
      return followed
    }
    return response
  })
  const deps: AnnouncementsDeps = {
    fetch,
    serverUrl: () => options.server ?? SERVER,
    appVersion: '0.11.0',
    platform: options.platform ?? 'darwin',
    uiLanguage: () => 'vi',
    readState: () => stored,
    writeState: (state) => {
      if (options.writeThrows) throw new Error('EACCES')
      stored = JSON.parse(JSON.stringify(state))
      writes.push(stored as AnnouncementsState)
    },
    now: () => NOW,
    env: options.env ?? {},
    timeoutMs: options.timeoutMs,
  }
  const service = createAnnouncementsService(deps)
  return { service, fetch, writes, state: () => asAnnouncementsState(stored), stored: () => stored }
}

const ids = (list: Array<{ id: string }>) => list.map((a) => a.id)

describe('announcements request', () => {
  it('asks the account server with platform, version and UI language', async () => {
    const { service, fetch } = setup()
    await service.fetchPending()
    expect(fetch).toHaveBeenCalledTimes(1)
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe(`${SERVER}/api/v1/announcements`)
    expect(url.searchParams.get('platform')).toBe('mac')
    expect(url.searchParams.get('version')).toBe('0.11.0')
    expect(url.searchParams.get('locale')).toBe('vi')
  })

  it('maps Windows and Linux, keeps a server path prefix and omits unknown platforms', async () => {
    for (const [platform, expected] of [
      ['win32', 'win'],
      ['linux', 'linux'],
      ['freebsd', null],
    ] as const) {
      const { service, fetch } = setup({ platform, server: 'https://example.org/faam' })
      await service.fetchPending()
      const url = new URL(fetch.mock.calls[0][0])
      expect(url.pathname).toBe('/faam/api/v1/announcements')
      expect(url.searchParams.get('platform')).toBe(expected)
    }
  })

  it(`is disabled entirely by ${ANNOUNCEMENTS_ENV}=0`, async () => {
    const { service, fetch } = setup({
      list: { announcements: [raw()] },
      env: { [ANNOUNCEMENTS_ENV]: '0' },
    })
    expect(await service.fetchPending()).toEqual([])
    expect(await service.pending()).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
    // any other value keeps it on
    const on = setup({ list: { announcements: [raw()] }, env: { [ANNOUNCEMENTS_ENV]: '1' } })
    expect(ids(await on.service.fetchPending())).toEqual(['a1'])
  })

  it('does nothing without a usable server address', async () => {
    const { service, fetch } = setup({ server: 'not a url' })
    expect(await service.fetchPending()).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('ignores non-200 answers', async () => {
    for (const status of [204, 304, 404, 429, 500]) {
      const { service } = setup({
        list: async () =>
          new Response(status === 204 || status === 304 ? null : '{"announcements":[]}', {
            status,
          }),
      })
      expect(await service.fetchPending()).toEqual([])
    }
    const created = setup({ list: async () => json({ announcements: [raw()] }, 201) })
    expect(await created.service.fetchPending()).toEqual([])
  })

  it('survives a network error or a body that is not JSON', async () => {
    const offline = setup({
      list: async () => {
        throw new TypeError('fetch failed')
      },
    })
    expect(await offline.service.fetchPending()).toEqual([])
    const html = setup({ list: async () => new Response('<html>', { status: 200 }) })
    expect(await html.service.fetchPending()).toEqual([])
  })

  it('gives up after the timeout, whether or not fetch honors the abort signal', async () => {
    const honoring = setup({
      timeoutMs: 20,
      list: () => new Promise<Response>(() => {}),
    })
    honoring.fetch.mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const started = Date.now()
    expect(await honoring.service.fetchPending()).toEqual([])
    const signal = honoring.fetch.mock.calls[0][1]?.signal
    expect(signal?.aborted).toBe(true)

    const ignoring = setup({ timeoutMs: 20, list: () => new Promise<Response>(() => {}) })
    expect(await ignoring.service.fetchPending()).toEqual([])
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('rejects an oversized list response', async () => {
    const huge = JSON.stringify({ announcements: [raw({ body: 'x'.repeat(1024 * 1024) })] })
    const { service } = setup({ list: async () => new Response(huge, { status: 200 }) })
    expect(await service.fetchPending()).toEqual([])
  })
})

describe('payload validation', () => {
  it('drops malformed entries and keeps the valid ones in server order', async () => {
    const { service } = setup({
      list: {
        announcements: [
          null,
          'text',
          [],
          raw({ id: 'ok-1' }),
          raw({ id: '' }),
          raw({ id: 'bad id!' }),
          raw({ id: 42 }),
          raw({ id: 'x'.repeat(129) }),
          raw({ id: 'k', kind: 'video' }),
          raw({ id: 'l', level: 'urgent' }),
          raw({ id: 'm', displayMode: 'always' }),
          raw({ id: 't', title: '   ' }),
          raw({ id: 't2', title: 7 }),
          raw({ id: 'u', updatedAt: undefined }),
          raw({ id: 'u2', updatedAt: 'yesterday' }),
          raw({ id: 'ok-2', level: 'critical', displayMode: 'every_launch' }),
          raw({ id: 'ok-1', title: 'duplicate' }),
        ],
      },
    })
    const list = await service.fetchPending()
    expect(ids(list)).toEqual(['ok-1', 'ok-2'])
    expect(list[0].title).toBe('Hello')
  })

  it('treats a payload without an announcements array as empty', async () => {
    for (const payload of [null, [], {}, { announcements: 'x' }, { announcements: {} }]) {
      const { service } = setup({ list: payload })
      expect(await service.fetchPending()).toEqual([])
    }
  })

  it('drops wrongly typed optional fields but keeps the announcement', async () => {
    const { service } = setup({
      list: { announcements: [raw({ body: 12, link: 'https://x.example', imageUrl: 5 })] },
    })
    const [only] = await service.fetchPending()
    expect(only).toEqual({
      id: 'a1',
      kind: 'rich',
      level: 'info',
      displayMode: 'once',
      title: 'Hello',
      updatedAt: T1,
    })
  })

  it('keeps an html announcement only when its page is on the server origin', async () => {
    const { service } = setup({
      list: {
        announcements: [
          raw({ id: 'h1', kind: 'html', htmlUrl: `${SERVER}/announcement-frame/h1?locale=vi` }),
          raw({ id: 'h2', kind: 'html', htmlUrl: 'https://evil.example/frame' }),
          raw({ id: 'h3', kind: 'html', htmlUrl: 'http://faamoffice.net/announcement-frame/h3' }),
          raw({ id: 'h4', kind: 'html' }),
          raw({ id: 'h5', kind: 'html', htmlUrl: 'javascript:alert(1)' }),
          raw({ id: 'h6', kind: 'html', htmlUrl: 'https://user:pw@faamoffice.net/frame' }),
        ],
      },
    })
    const list = await service.fetchPending()
    expect(ids(list)).toEqual(['h1'])
    expect(list[0].htmlUrl).toBe(`${SERVER}/announcement-frame/h1?locale=vi`)
    // html announcements carry no plain-text body
    expect(list[0].body).toBeUndefined()
  })

  it('accepts an http page on an http (local dev) server', async () => {
    const dev = 'http://localhost:3000'
    const { service } = setup({
      server: dev,
      list: {
        announcements: [
          raw({ id: 'h1', kind: 'html', htmlUrl: `${dev}/announcement-frame/h1` }),
          raw({ id: 'h2', kind: 'html', htmlUrl: 'http://localhost:4000/announcement-frame/h2' }),
        ],
      },
    })
    expect(ids(await service.fetchPending())).toEqual(['h1'])
  })

  it('keeps https links anywhere and http links only on the server origin', async () => {
    const dev = 'http://localhost:3000'
    const { service } = setup({
      server: dev,
      list: {
        announcements: [
          raw({ id: 'l1', link: { url: 'https://docs.example/x', label: 'Read' } }),
          raw({ id: 'l2', link: { url: `${dev}/pricing`, label: 'Pricing' } }),
          raw({ id: 'l3', link: { url: 'http://evil.example/', label: 'Bad' } }),
          raw({ id: 'l4', link: { url: 'javascript:alert(1)', label: 'Bad' } }),
          raw({ id: 'l5', link: { url: 'file:///etc/passwd', label: 'Bad' } }),
        ],
      },
    })
    const list = await service.fetchPending()
    expect(ids(list)).toEqual(['l1', 'l2', 'l3'])
    expect(list.map((a) => a.linkUrl)).toEqual([
      'https://docs.example/x',
      `${dev}/pricing`,
      undefined,
    ])
    expect(list[2].link).toBeUndefined()
  })

  it('never hands the link URL to the renderer', async () => {
    const { service } = setup({
      list: { announcements: [raw({ link: { url: 'https://docs.example/x', label: '' } })] },
    })
    const [view] = await service.pending()
    expect(view.link).toEqual({ label: '' })
    expect(JSON.stringify(view)).not.toContain('docs.example')
    expect(service.linkUrl('a1')).toBe('https://docs.example/x')
    expect(service.linkUrl('nope')).toBeNull()
    expect(service.linkUrl({ id: 'a1' })).toBeNull()
  })
})

describe('display rules', () => {
  it('once: shows until displayed at this updatedAt, again after an admin edit', async () => {
    const first = setup({ list: { announcements: [raw()] } })
    expect(ids(await first.service.pending())).toEqual(['a1'])
    first.service.action('a1', 'shown')
    expect(first.state().seen).toEqual({ a1: T1 })

    const next = setup({ list: { announcements: [raw()] }, state: first.stored() })
    expect(await next.service.pending()).toEqual([])

    const edited = setup({
      list: { announcements: [raw({ updatedAt: T2 })] },
      state: first.stored(),
    })
    expect(ids(await edited.service.pending())).toEqual(['a1'])
    edited.service.action('a1', 'shown')
    expect(edited.state().seen).toEqual({ a1: T2 })
  })

  it('once: closing counts as seen even without a shown report', async () => {
    const { service, state } = setup({ list: { announcements: [raw()] } })
    await service.pending()
    service.action('a1', 'close')
    expect(state().seen).toEqual({ a1: T1 })
  })

  it('every_launch: shows on every start and records nothing', async () => {
    const list = { announcements: [raw({ displayMode: 'every_launch' })] }
    const first = setup({ list })
    expect(ids(await first.service.pending())).toEqual(['a1'])
    first.service.action('a1', 'shown')
    first.service.action('a1', 'dismiss')
    expect(first.writes).toEqual([])

    const next = setup({ list, state: { seen: { a1: T2 }, dismissed: { a1: T2 } } })
    expect(ids(await next.service.pending())).toEqual(['a1'])
  })

  it('until_dismissed: closing keeps it, dismissing hides it until an admin edit', async () => {
    const list = { announcements: [raw({ displayMode: 'until_dismissed' })] }
    const closed = setup({ list })
    await closed.service.pending()
    closed.service.action('a1', 'shown')
    closed.service.action('a1', 'close')
    expect(closed.writes).toEqual([])
    const again = setup({ list, state: closed.stored() })
    expect(ids(await again.service.pending())).toEqual(['a1'])

    again.service.action('a1', 'dismiss')
    expect(again.state().dismissed).toEqual({ a1: T1 })
    const hidden = setup({ list, state: again.stored() })
    expect(await hidden.service.pending()).toEqual([])

    const edited = setup({
      list: { announcements: [raw({ displayMode: 'until_dismissed', updatedAt: T2 })] },
      state: again.stored(),
    })
    expect(ids(await edited.service.pending())).toEqual(['a1'])
  })

  it('shows at most 3 per session, in server order, after the local rules', async () => {
    const list = {
      announcements: ['a', 'b', 'c', 'd', 'e'].map((id) => raw({ id })),
    }
    const fresh = setup({ list })
    expect(ids(await fresh.service.pending())).toEqual(['a', 'b', 'c'])
    const seenA = setup({ list, state: { seen: { a: T1 }, dismissed: {} } })
    expect(ids(await seenA.service.pending())).toEqual(['b', 'c', 'd'])
  })

  it('fetches once per session and stops offering closed announcements', async () => {
    const { service, fetch } = setup({
      list: {
        announcements: [
          raw({ id: 'a' }),
          raw({ id: 'b', displayMode: 'every_launch' }),
          raw({ id: 'c', displayMode: 'until_dismissed' }),
        ],
      },
    })
    const [first, second] = await Promise.all([service.pending(), service.pending()])
    expect(ids(first)).toEqual(['a', 'b', 'c'])
    expect(second).toEqual(first)
    // displayed but not closed: only `once` is done with
    service.action('a', 'shown')
    service.action('b', 'shown')
    service.action('c', 'shown')
    expect(ids(await service.pending())).toEqual(['b', 'c'])
    service.action('b', 'close')
    expect(ids(await service.pending())).toEqual(['c'])
    service.action('c', 'close')
    expect(await service.pending()).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('once: a window recreated in the same session (macOS) does not show it again', async () => {
    const { service, state } = setup({
      list: {
        announcements: [
          raw({ id: 'A', displayMode: 'until_dismissed' }),
          raw({ id: 'B', displayMode: 'once' }),
        ],
      },
    })
    // window 1 displays B and is closed with the dialog still up
    expect(ids(await service.pending())).toEqual(['A', 'B'])
    service.action('B', 'shown')
    expect(state().seen).toEqual({ B: T1 })
    // window 2: same app session
    expect(ids(await service.pending())).toEqual(['A'])
  })

  it('ignores unknown ids and actions', async () => {
    const { service, writes } = setup({ list: { announcements: [raw()] } })
    await service.pending()
    service.action('other', 'shown')
    service.action('a1', 'seen')
    service.action(undefined, 'shown')
    service.action({ id: 'a1' }, 'close')
    expect(writes).toEqual([])
    expect(ids(await service.pending())).toEqual(['a1'])
  })

  it('tolerates corrupt persisted state and an unwritable settings file', async () => {
    const corrupt = setup({ list: { announcements: [raw()] }, state: 'garbage' })
    expect(ids(await corrupt.service.pending())).toEqual(['a1'])
    const partial = setup({
      list: { announcements: [raw()] },
      state: { seen: { a1: 42, ok: T1, 'bad id': T1, x: 'nope' }, dismissed: [] },
    })
    expect(ids(await partial.service.pending())).toEqual(['a1'])

    const readOnly = setup({ list: { announcements: [raw()] }, writeThrows: true })
    await readOnly.service.pending()
    expect(() => readOnly.service.action('a1', 'shown')).not.toThrow()
  })

  it('stores prototype-like ids as plain data', async () => {
    const list = { announcements: [raw({ id: '__proto__' }), raw({ id: 'constructor' })] }
    const first = setup({ list })
    expect(ids(await first.service.pending())).toEqual(['__proto__', 'constructor'])
    first.service.action('__proto__', 'shown')
    first.service.action('constructor', 'shown')
    const next = setup({ list, state: first.stored() })
    expect(await next.service.pending()).toEqual([])
    expect(Object.getPrototypeOf(next.state().seen)).toBe(Object.prototype)
  })
})

describe('pruning', () => {
  const old = new Date(NOW - PRUNE_AFTER_MS - DAY).toISOString()
  const recent = new Date(NOW - 10 * DAY).toISOString()

  it('forgets ids older than 180 days that the server no longer returns', async () => {
    const { service, state, writes } = setup({
      list: { announcements: [raw({ id: 'live', updatedAt: old })] },
      state: {
        seen: { gone: old, live: old, fresh: recent },
        dismissed: { gone2: old, fresh2: recent },
      },
    })
    // still served: kept, so a long-running `once` never shows twice
    expect(await service.fetchPending()).toEqual([])
    expect(state()).toEqual({ seen: { live: old, fresh: recent }, dismissed: { fresh2: recent } })
    expect(writes).toHaveLength(1)
  })

  it('writes nothing when there is nothing to prune', async () => {
    const { service, writes } = setup({
      list: { announcements: [] },
      state: { seen: { fresh: recent }, dismissed: {} },
    })
    await service.fetchPending()
    expect(writes).toEqual([])
  })

  it('keeps stale stamps of announcements still served when another one is acted on', async () => {
    const stale = new Date(NOW - 250 * DAY).toISOString()
    const fresh = new Date(NOW - DAY).toISOString()
    const list = {
      announcements: [
        raw({ id: 'A', displayMode: 'until_dismissed', updatedAt: stale }),
        raw({ id: 'L', displayMode: 'once', updatedAt: stale }),
        raw({ id: 'B', displayMode: 'once', updatedAt: fresh }),
      ],
    }
    const launch1 = setup({
      list,
      state: { seen: { L: stale, gone: old }, dismissed: { A: stale } },
    })
    expect(ids(await launch1.service.pending())).toEqual(['B'])
    launch1.service.action('B', 'shown')
    launch1.service.action('B', 'close')
    // "Don't show this again" and the long-running `once` survive; only the unserved id goes
    expect(launch1.state()).toEqual({ seen: { L: stale, B: fresh }, dismissed: { A: stale } })

    const launch2 = setup({ list, state: launch1.stored() })
    expect(await launch2.service.pending()).toEqual([])
  })

  it('does not prune when the fetch fails', async () => {
    const { service, writes } = setup({
      list: async () => new Response('', { status: 500 }),
      state: { seen: { gone: old }, dismissed: {} },
    })
    await service.fetchPending()
    expect(writes).toEqual([])
  })
})

describe('images', () => {
  const IMG = `${SERVER}/api/v1/announcements/a1/image?v=1`
  const withImage = (url = IMG) => ({ announcements: [raw({ imageUrl: url })] })

  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/gif', GIF],
    ['image/webp', WEBP],
  ] as const)('hands %s to the renderer as a data: URL', async (type, bytes) => {
    const { service } = setup({ list: withImage(), images: { [IMG]: () => image(bytes, type) } })
    const [view] = await service.pending()
    expect(view.image).toBe(`data:${type};base64,${Buffer.from(bytes).toString('base64')}`)
    expect(JSON.stringify(view)).not.toContain('/image?v=1')
  })

  it('accepts a Content-Type with parameters', async () => {
    const { service } = setup({
      list: withImage(),
      images: { [IMG]: () => image(PNG, 'Image/PNG; charset=binary') },
    })
    expect((await service.pending())[0].image).toMatch(/^data:image\/png;base64,/)
  })

  it('omits an image whose bytes do not match its declared type', async () => {
    const { service } = setup({
      list: withImage(),
      images: { [IMG]: () => image(new TextEncoder().encode('<svg onload=x>'), 'image/png') },
    })
    const [view] = await service.pending()
    expect(view.id).toBe('a1')
    expect(view.image).toBeUndefined()
    const swapped = setup({ list: withImage(), images: { [IMG]: () => image(PNG, 'image/jpeg') } })
    expect((await swapped.service.pending())[0].image).toBeUndefined()
  })

  it('omits unsupported types, failed downloads and empty bodies', async () => {
    for (const make of [
      () => image(new TextEncoder().encode('<svg/>'), 'image/svg+xml'),
      () => image(PNG, 'text/html'),
      () => new Response(PNG, { status: 200 }),
      () => new Response('nope', { status: 403, headers: { 'Content-Type': 'image/png' } }),
      () => image(new Uint8Array(0), 'image/png'),
    ]) {
      const { service } = setup({ list: withImage(), images: { [IMG]: make } })
      const [view] = await service.pending()
      expect(view.image).toBeUndefined()
    }
  })

  it('caps images at 2 MB, declared or streamed', async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1)
    big.set(PNG)
    const declared = setup({
      list: withImage(),
      images: { [IMG]: () => image(PNG, 'image/png', { 'Content-Length': String(big.length) }) },
    })
    expect((await declared.service.pending())[0].image).toBeUndefined()

    const streamed = setup({
      list: withImage(),
      images: {
        [IMG]: () => {
          const half = big.length / 2
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(big.subarray(0, half))
              controller.enqueue(big.subarray(half))
              controller.close()
            },
          })
          return new Response(body, { status: 200, headers: { 'Content-Type': 'image/png' } })
        },
      },
    })
    expect((await streamed.service.pending())[0].image).toBeUndefined()

    const exact = new Uint8Array(MAX_IMAGE_BYTES)
    exact.set(PNG)
    const fits = setup({ list: withImage(), images: { [IMG]: () => image(exact, 'image/png') } })
    expect((await fits.service.pending())[0].image).toMatch(/^data:image\/png;base64,/)
  })

  it('downloads https images from anywhere but http only from the server origin', async () => {
    const cdn = 'https://cdn.example/banner.png'
    const insecure = 'http://cdn.example/banner.png'
    const https = setup({ list: withImage(cdn), images: { [cdn]: () => image(PNG, 'image/png') } })
    expect((await https.service.pending())[0].image).toBeDefined()

    const http = setup({
      list: withImage(insecure),
      images: { [insecure]: () => image(PNG, 'image/png') },
    })
    expect((await http.service.pending())[0].image).toBeUndefined()
    expect(http.fetch).toHaveBeenCalledTimes(1)

    const dev = 'http://localhost:3000'
    const local = `${dev}/api/v1/announcements/a1/image`
    const devServer = setup({
      server: dev,
      list: withImage(local),
      images: { [local]: () => image(PNG, 'image/png') },
    })
    expect((await devServer.service.pending())[0].image).toBeDefined()
  })

  it('rejects an image redirected to a disallowed origin', async () => {
    const { service } = setup({
      list: withImage(),
      images: {
        [IMG]: () => {
          const response = image(PNG, 'image/png')
          Object.defineProperty(response, 'url', { value: 'http://evil.example/x.png' })
          return response
        },
      },
    })
    expect((await service.pending())[0].image).toBeUndefined()
  })

  it('checks every redirect hop before requesting it', async () => {
    for (const target of [
      'http://127.0.0.1:8080/admin/reboot',
      'http://192.168.1.1/x.png',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://user:pw@cdn.example/x.png',
    ]) {
      const { service, fetch } = setup({
        list: withImage(),
        images: {
          [IMG]: () => new Response(null, { status: 302, headers: { Location: target } }),
          [target]: () => image(PNG, 'image/png'),
        },
      })
      expect((await service.pending())[0].image).toBeUndefined()
      const requested = fetch.mock.calls.map(([input]) => input)
      expect(requested).toHaveLength(2)
      expect(requested).not.toContain(target)
    }
  })

  it('follows allowed redirects by hand, resolving relative locations', async () => {
    const cdn = 'https://cdn.example/banner.png'
    const { service, fetch } = setup({
      list: withImage(),
      images: {
        [IMG]: () => new Response(null, { status: 301, headers: { Location: '/img/moved.png' } }),
        [`${SERVER}/img/moved.png`]: () =>
          new Response('', { status: 307, headers: { Location: cdn } }),
        [cdn]: () => image(PNG, 'image/png'),
      },
    })
    expect((await service.pending())[0].image).toMatch(/^data:image\/png;base64,/)
    const imageCalls = fetch.mock.calls.slice(1)
    expect(imageCalls.map(([input]) => input)).toEqual([IMG, `${SERVER}/img/moved.png`, cdn])
    // the fetch itself never follows a redirect
    for (const [, init] of imageCalls) expect(init?.redirect).toBe('manual')
  })

  it(`gives up after ${MAX_IMAGE_REDIRECTS} redirects or a redirect without a location`, async () => {
    const hop = (n: number) => `${SERVER}/hop/${n}`
    const images: Record<string, () => Response> = {
      [IMG]: () => new Response(null, { status: 302, headers: { Location: hop(1) } }),
    }
    for (let n = 1; n <= MAX_IMAGE_REDIRECTS + 1; n++) {
      images[hop(n)] = () => new Response(null, { status: 302, headers: { Location: hop(n + 1) } })
    }
    const looping = setup({ list: withImage(), images })
    expect((await looping.service.pending())[0].image).toBeUndefined()
    // the original request plus MAX_IMAGE_REDIRECTS hops, after the list
    expect(looping.fetch).toHaveBeenCalledTimes(1 + 1 + MAX_IMAGE_REDIRECTS)

    const bare = setup({
      list: withImage(),
      images: { [IMG]: () => new Response(null, { status: 303 }) },
    })
    expect((await bare.service.pending())[0].image).toBeUndefined()
  })

  it('times out a stalled image download and still shows the announcement', async () => {
    const stalled = setup({ timeoutMs: 30, list: withImage() })
    stalled.fetch.mockImplementation(async (input: string) => {
      if (input.includes('/image')) return new Promise<Response>(() => {})
      return json(withImage())
    })
    const [late] = await stalled.service.pending()
    expect(late.id).toBe('a1')
    expect(late.image).toBeUndefined()
  })

  it('does not download images of html announcements', async () => {
    const { service, fetch } = setup({
      list: {
        announcements: [
          raw({ kind: 'html', htmlUrl: `${SERVER}/announcement-frame/a1`, imageUrl: IMG }),
        ],
      },
      images: { [IMG]: () => image(PNG, 'image/png') },
    })
    const [view] = await service.pending()
    expect(view.image).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('checks magic bytes per type', () => {
    expect(matchesImageType(PNG, 'image/png')).toBe(true)
    expect(matchesImageType(PNG.subarray(0, 4), 'image/png')).toBe(false)
    expect(matchesImageType(JPEG, 'image/jpeg')).toBe(true)
    expect(matchesImageType(GIF, 'image/gif')).toBe(true)
    expect(matchesImageType(new TextEncoder().encode('GIF88a'), 'image/gif')).toBe(false)
    expect(matchesImageType(WEBP, 'image/webp')).toBe(true)
    expect(matchesImageType(new TextEncoder().encode('RIFF\0\0\0\0WAVE'), 'image/webp')).toBe(false)
  })
})

describe('IPC handlers', () => {
  function registered() {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const env = setup({
      list: {
        announcements: [raw({ link: { url: 'https://docs.example/x', label: 'Read' } })],
      },
    })
    const openExternal = vi.fn(async (_url: string) => {})
    registerAnnouncementsIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      env.service,
      openExternal,
    )
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args)
    return { ...env, handlers, openExternal, call }
  }

  it('registers the three channels', () => {
    const { handlers } = registered()
    expect([...handlers.keys()].sort()).toEqual(
      [
        HOME_CHANNELS.announcementsPending,
        HOME_CHANNELS.announcementAction,
        HOME_CHANNELS.openAnnouncementLink,
      ].sort(),
    )
  })

  it('serves the session list and persists valid actions only', async () => {
    const { call, writes, state } = registered()
    const list = (await call(HOME_CHANNELS.announcementsPending)) as Array<{ id: string }>
    expect(ids(list)).toEqual(['a1'])
    call(HOME_CHANNELS.announcementAction, 'a1', 'explode')
    call(HOME_CHANNELS.announcementAction, ['a1'], 'shown')
    call(HOME_CHANNELS.announcementAction)
    expect(writes).toEqual([])
    call(HOME_CHANNELS.announcementAction, 'a1', 'shown')
    expect(state().seen).toEqual({ a1: T1 })
  })

  it('opens only the link of a known announcement, never a renderer-supplied URL', async () => {
    const { call, openExternal } = registered()
    await call(HOME_CHANNELS.announcementsPending)
    call(HOME_CHANNELS.openAnnouncementLink, 'https://evil.example/')
    call(HOME_CHANNELS.openAnnouncementLink, 'missing')
    call(HOME_CHANNELS.openAnnouncementLink, { id: 'a1' })
    expect(openExternal).not.toHaveBeenCalled()
    call(HOME_CHANNELS.openAnnouncementLink, 'a1')
    expect(openExternal).toHaveBeenCalledWith('https://docs.example/x')
  })

  it('opens nothing before the session list exists', () => {
    const { call, openExternal } = registered()
    call(HOME_CHANNELS.openAnnouncementLink, 'a1')
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('shell window frame guards', () => {
  type Listener = (...args: unknown[]) => void

  function guarded(list: unknown, options: { sendThrows?: boolean } = {}) {
    const env = setup({ list })
    let openHandler: ((details: { url: string }) => { action: 'deny' }) | null = null
    const listeners = new Map<string, Listener>()
    const send = vi.fn((_channel: string, ..._args: unknown[]) => {
      if (options.sendThrows) throw new Error('Object has been destroyed')
    })
    const openExternal = vi.fn(async (_url: string) => {})
    guardAnnouncementFrames(
      {
        setWindowOpenHandler: (handler) => {
          openHandler = handler
        },
        on: (event: string, listener: Listener) => {
          listeners.set(event, listener)
        },
        send,
      },
      env.service,
      openExternal,
    )
    const emit = (event: string, ...args: unknown[]) => listeners.get(event)!(...args)
    /** whether the guard cancelled the navigation */
    const navigation = (event: string, url: string, isMainFrame = false) => {
      const details = { url, isMainFrame, preventDefault: vi.fn() }
      emit(event, details)
      return details.preventDefault.mock.calls.length > 0
    }
    return {
      ...env,
      listeners,
      emit,
      send,
      open: (url: string) => openHandler!({ url }),
      openExternal,
      frameNavigation: (url: string, isMainFrame = false) =>
        navigation('will-frame-navigate', url, isMainFrame),
      frameRedirect: (url: string, isMainFrame = false) =>
        navigation('will-redirect', url, isMainFrame),
    }
  }

  const PAGE = `${SERVER}/announcement-frame/a1`
  const htmlList = { announcements: [raw({ kind: 'html', htmlUrl: PAGE })] }

  it('opens http(s) popups from the announcement in the browser and never a window', async () => {
    const { service, open, openExternal } = guarded(htmlList)
    await service.pending()
    expect(open('https://example.com/page')).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenLastCalledWith('https://example.com/page')
    expect(open('http://example.com/')).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledTimes(2)
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'x']) {
      expect(open(url)).toEqual({ action: 'deny' })
    }
    expect(openExternal).toHaveBeenCalledTimes(2)
  })

  it('opens nothing when the session has no html announcement', async () => {
    const { service, open, openExternal } = guarded({ announcements: [raw()] })
    await service.pending()
    expect(open('https://example.com/')).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('keeps sub-frames on the announcement origin', async () => {
    const { service, frameNavigation } = guarded(htmlList)
    expect(frameNavigation(PAGE)).toBe(true)
    await service.pending()
    expect(frameNavigation(`${PAGE}?locale=vi`)).toBe(false)
    expect(frameNavigation('about:blank')).toBe(false)
    expect(frameNavigation('https://evil.example/')).toBe(true)
    expect(frameNavigation('http://faamoffice.net/announcement-frame/a1')).toBe(true)
    // the shell's own main-frame navigation is left to the app-wide guard
    expect(frameNavigation('https://evil.example/', true)).toBe(false)
  })

  it('keeps sub-frames on the announcement origin through server-side redirects', async () => {
    const { service, frameRedirect } = guarded(htmlList)
    await service.pending()
    expect(frameRedirect('https://evil.example/')).toBe(true)
    expect(frameRedirect('http://faamoffice.net/announcement-frame/a1')).toBe(true)
    expect(frameRedirect(`${SERVER}/announcement-frame/a1?locale=en`)).toBe(false)
    expect(frameRedirect(`${SERVER}/vi/announcement-frame/a1`)).toBe(false)
    expect(frameRedirect('https://evil.example/', true)).toBe(false)
  })

  it('forwards Escape to the renderer while an html announcement is part of the session', async () => {
    const { service, emit, send } = guarded(htmlList)
    emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' })
    // no session list yet
    expect(send).not.toHaveBeenCalled()
    await service.pending()
    emit('before-input-event', {}, { type: 'keyUp', key: 'Escape' })
    emit('before-input-event', {}, { type: 'keyDown', key: 'Enter' })
    expect(send).not.toHaveBeenCalled()
    emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenLastCalledWith(HOME_CHANNELS.announcementEscape)

    const rich = guarded({ announcements: [raw()] })
    await rich.service.pending()
    rich.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' })
    expect(rich.send).not.toHaveBeenCalled()
  })

  it('reports a failed announcement page by id', async () => {
    const { service, emit, send } = guarded(htmlList)
    await service.pending()
    // net error / blocked frame in the announcement's page (any query string)
    emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', `${PAGE}?locale=vi`, false)
    expect(send).toHaveBeenLastCalledWith(HOME_CHANNELS.announcementFrameFailed, 'a1')
    // HTTP error pages load "successfully"
    emit('did-frame-navigate', {}, PAGE, 404, 'Not Found', false)
    emit('did-frame-navigate', {}, PAGE, 500, 'Internal Server Error', false)
    expect(send).toHaveBeenCalledTimes(3)
    // not the announcement's page, a fine page, or the shell's own main frame
    emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', `${SERVER}/other`, false)
    emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://evil.example/', false)
    emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', PAGE, true)
    emit('did-frame-navigate', {}, PAGE, 200, 'OK', false)
    emit('did-frame-navigate', {}, PAGE, 404, 'Not Found', true)
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('maps a page URL to its session html announcement', async () => {
    const { service } = guarded({
      announcements: [raw({ kind: 'html', htmlUrl: `${PAGE}?locale=vi` }), raw({ id: 'r1' })],
    })
    expect(service.htmlAnnouncementAt(PAGE)).toBeNull()
    await service.pending()
    expect(service.htmlAnnouncementAt(PAGE)).toBe('a1')
    expect(service.htmlAnnouncementAt(`${PAGE}#top`)).toBe('a1')
    expect(service.htmlAnnouncementAt(`${PAGE}/x`)).toBeNull()
    expect(service.htmlAnnouncementAt('http://faamoffice.net/announcement-frame/a1')).toBeNull()
    expect(service.htmlAnnouncementAt('not a url')).toBeNull()
  })

  it('survives a window that is already gone', async () => {
    const { service, emit } = guarded(htmlList, { sendThrows: true })
    await service.pending()
    expect(() => emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' })).not.toThrow()
    expect(() => emit('did-frame-navigate', {}, PAGE, 404, 'Not Found', false)).not.toThrow()
  })
})
