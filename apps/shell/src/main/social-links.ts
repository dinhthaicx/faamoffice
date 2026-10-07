/**
 * Follow buttons for the project's channels (Facebook, YouTube, TikTok…),
 * managed by the super admin on the FaamOffice account server (web/ in this
 * repository, Admin → Settings) and shown above Settings in the Home sidebar.
 *
 * Once per app session, together with the announcement query (start(), which
 * the shell runs from that query's handler: the renderer makes it only once
 * first-run onboarding is done), the main process reads the server's public
 * GET /api/v1/app/config: no account token, no identifier. The answer
 * is re-validated here (https only, known platforms, each platform on its own
 * domains, at most MAX_LINKS) and the last good list is cached in
 * userData/app-settings.json under `socialLinks`, keyed by the server it came
 * from, so the buttons show at once on the next launch and while offline.
 * Link URLs never reach the renderer: it receives ids, platforms and labels,
 * and opens a channel by id.
 *
 * FAAMOFFICE_ANNOUNCEMENTS=0 (the switch for every startup request to the
 * account server) turns the request off; a list cached earlier still shows.
 * Nothing here throws to the caller: a failed request or a malformed answer
 * keeps the cached list.
 */

import { HOME_CHANNELS, isSocialPlatform } from '../shared/home-api'
import type { SocialLinkView, SocialPlatform } from '../shared/home-api'
import { ANNOUNCEMENTS_ENV, parseHttpUrl, readCapped } from './announcements'

/** app-settings key holding the cached list */
export const SOCIAL_LINKS_KEY = 'socialLinks'
/** budget for the config request */
export const FETCH_TIMEOUT_MS = 8000
/** the config answer is a few KB; anything far larger is not ours */
export const MAX_CONFIG_BYTES = 256 * 1024
/** the server stores at most 12 links */
export const MAX_LINKS = 12
export const MAX_LABEL = 40
const MAX_URL = 2048
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g

/**
 * Domains each platform's links must live on (the domain itself or a
 * subdomain, e.g. m.facebook.com); null = any https host. Mirrors
 * SOCIAL_PLATFORM_HOSTS in web/src/lib/site-settings-shared.ts.
 */
export const SOCIAL_PLATFORM_HOSTS: Record<SocialPlatform, readonly string[] | null> = {
  facebook: ['facebook.com', 'fb.com', 'fb.me'],
  youtube: ['youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com'],
  zalo: ['zalo.me'],
  x: ['x.com', 'twitter.com'],
  instagram: ['instagram.com'],
  threads: ['threads.net', 'threads.com'],
  telegram: ['t.me', 'telegram.me'],
  discord: ['discord.gg', 'discord.com'],
  github: ['github.com'],
  linkedin: ['linkedin.com'],
  website: null,
}

/** a validated link; `url` stays in the main process */
export interface SocialLink {
  id: string
  platform: SocialPlatform
  url: string
  label?: string
}

/** what app-settings.json holds under SOCIAL_LINKS_KEY */
export interface SocialLinksCache {
  /** the account server the list came from; another server's list is never shown */
  server: string
  links: SocialLink[]
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface SocialLinksDeps {
  fetch: FetchLike
  /** the account server (faamAccountServer()), read per request so a Settings change applies */
  serverUrl(): string
  readState(): unknown
  writeState(state: SocialLinksCache): void
  /** the list changed after a refresh; the shell broadcasts it to its windows */
  onChange(links: SocialLinkView[]): void
  /** defaults to process.env */
  env?: Record<string, string | undefined>
  /** defaults to FETCH_TIMEOUT_MS */
  timeoutMs?: number
}

export interface SocialLinksService {
  /** the current list (the cached one until this session's refresh lands); never requests */
  list(): SocialLinkView[]
  /** start this session's refresh; later calls do nothing */
  start(): void
  /** fetch and apply the server's list; resolves once done (never rejects) */
  refresh(): Promise<void>
  /** the account server changed in Settings: show its cached list and refresh it */
  serverChanged(): void
  /** the URL of a listed link, or null */
  linkUrl(id: unknown): string | null
}

// ---- validation ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isSocialLinkId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value)
}

/** whether `url` may be used for `platform`: https, no credentials, the platform's own domains */
export function socialUrlAllowed(platform: SocialPlatform, raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > MAX_URL) return null
  const url = parseHttpUrl(raw)
  if (!url || url.protocol !== 'https:') return null
  const hosts = SOCIAL_PLATFORM_HOSTS[platform]
  if (!hosts) return url
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  return hosts.some((domain) => host === domain || host.endsWith(`.${domain}`)) ? url : null
}

function cleanLabel(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL).trim()
}

/** one entry, or null when it is malformed or points somewhere it may not */
export function validateSocialLink(raw: unknown): SocialLink | null {
  if (!isRecord(raw)) return null
  const { id, platform } = raw
  if (!isSocialLinkId(id) || !isSocialPlatform(platform)) return null
  const url = socialUrlAllowed(platform, raw.url)
  if (!url) return null
  const label = cleanLabel(raw.label)
  return { id, platform, url: url.href, ...(label ? { label } : {}) }
}

/** valid entries in server order (duplicate ids keep the first), at most MAX_LINKS */
export function parseSocialLinks(list: unknown): SocialLink[] {
  if (!Array.isArray(list)) return []
  const out: SocialLink[] = []
  const ids = new Set<string>()
  for (const raw of list) {
    const link = validateSocialLink(raw)
    if (!link || ids.has(link.id)) continue
    ids.add(link.id)
    out.push(link)
    if (out.length >= MAX_LINKS) break
  }
  return out
}

/** the `socials` list of a config answer, or null when the answer is not one */
export function parseAppConfig(payload: unknown): SocialLink[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.socials)) return null
  return parseSocialLinks(payload.socials)
}

/** the cached list for `server`; another server's (or a corrupt) cache reads as empty */
export function cachedLinksFor(state: unknown, server: string): SocialLink[] {
  if (!isRecord(state) || typeof state.server !== 'string' || state.server !== server) return []
  return parseSocialLinks(state.links)
}

export function toSocialViews(links: readonly SocialLink[]): SocialLinkView[] {
  return links.map(({ id, platform, label }) => ({ id, platform, ...(label ? { label } : {}) }))
}

function sameLinks(a: readonly SocialLink[], b: readonly SocialLink[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ---- service ----

export function createSocialLinksService(deps: SocialLinksDeps): SocialLinksService {
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS
  const env = deps.env ?? process.env
  const enabled = () => env[ANNOUNCEMENTS_ENV]?.trim() !== '0'

  /** the normalized server address, or '' when it is unusable */
  const serverKey = (): string => {
    try {
      const url = parseHttpUrl(deps.serverUrl())
      return url ? url.href.replace(/\/+$/, '') : ''
    } catch {
      return ''
    }
  }

  const readCache = (server: string): SocialLink[] => {
    if (!server) return []
    try {
      return cachedLinksFor(deps.readState(), server)
    } catch {
      return []
    }
  }

  let current: SocialLink[] | null = null
  let started = false
  /** bumps on a server change, so an older request never overwrites the newer list */
  let generation = 0

  const ensureCurrent = (): SocialLink[] => (current ??= readCache(serverKey()))

  /** the server's validated list, or null on any failure; resolves by the deadline at the latest */
  async function request(server: string): Promise<SocialLink[] | null> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve(null)
      }, timeoutMs)
    })
    const work = async (): Promise<SocialLink[] | null> => {
      // a public request: no account token, no identifier
      const response = await deps.fetch(`${server}/api/v1/app/config`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => undefined)
        return null
      }
      const bytes = await readCapped(response, MAX_CONFIG_BYTES)
      if (!bytes) return null
      return parseAppConfig(JSON.parse(new TextDecoder().decode(bytes)))
    }
    try {
      return await Promise.race([work().catch(() => null), deadline])
    } finally {
      clearTimeout(timer)
    }
  }

  async function refresh(): Promise<void> {
    try {
      if (!enabled()) return
      const server = serverKey()
      if (!server) return
      const mine = generation
      const links = await request(server)
      if (!links || mine !== generation) return
      if (sameLinks(links, ensureCurrent())) return
      current = links
      try {
        deps.writeState({ server, links })
      } catch {
        // unwritable settings: the list still shows this session
      }
      deps.onChange(toSocialViews(links))
    } catch {
      // never surfaces: the cached list stays
    }
  }

  return {
    list() {
      return toSocialViews(ensureCurrent())
    },

    start() {
      if (started) return
      started = true
      void refresh()
    },

    refresh,

    serverChanged() {
      generation++
      const before = current ?? []
      current = readCache(serverKey())
      if (!sameLinks(before, current)) deps.onChange(toSocialViews(current))
      started = true
      void refresh()
    },

    linkUrl(id) {
      if (!isSocialLinkId(id)) return null
      return ensureCurrent().find((link) => link.id === id)?.url ?? null
    },
  }
}

// ---- Electron wiring (kept here so it can be tested without Electron) ----

interface IpcLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

/** list + open-by-id; the id is re-validated main-side and only a listed URL is ever opened */
export function registerSocialLinksIpc(
  ipc: IpcLike,
  service: SocialLinksService,
  openExternal: (url: string) => Promise<void>,
): void {
  ipc.handle(HOME_CHANNELS.socialLinks, () => service.list())
  ipc.handle(HOME_CHANNELS.openSocialLink, (_event, id) => {
    const url = service.linkUrl(id)
    if (url) void openExternal(url).catch(() => undefined)
  })
}
