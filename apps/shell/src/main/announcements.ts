/**
 * Startup announcements published by the super admin on the FaamOffice
 * account server (web/ in this repository).
 *
 * The server already filters what it returns (published, active, platform,
 * version, localized; sorted; at most 5). This module re-validates that
 * payload defensively, applies the local display rules over the
 * `announcements` object persisted in userData/app-settings.json, downloads
 * images in the main process (the renderer only ever receives data: URLs) and
 * keeps link URLs main-side, so the renderer can never make the app open an
 * arbitrary address.
 *
 * Display rules (keyed by the announcement's updatedAt, so an admin edit
 * shows it again):
 * - once: shown until it has been displayed at this updatedAt
 * - every_launch: shown on every app start while the server returns it
 * - until_dismissed: shown until "Don't show this again" at this updatedAt
 *
 * Nothing here ever throws to the caller: a failed fetch, a malformed payload
 * or an unwritable settings file just means fewer (or no) announcements.
 * FAAMOFFICE_ANNOUNCEMENTS=0 turns the feature off entirely.
 */

import type {
  AnnouncementAction,
  AnnouncementDisplayMode,
  AnnouncementKind,
  AnnouncementLevel,
  AnnouncementView,
} from '../shared/home-api'
import { HOME_CHANNELS } from '../shared/home-api'

/** app-settings key holding the persisted display state */
export const ANNOUNCEMENTS_KEY = 'announcements'
/** environment switch: '0' disables the feature */
export const ANNOUNCEMENTS_ENV = 'FAAMOFFICE_ANNOUNCEMENTS'
/** budget for the list request and for each image download */
export const FETCH_TIMEOUT_MS = 8000
/** announcements displayed per app session */
export const MAX_PER_SESSION = 3
/** images larger than this are skipped */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
/** the list response is a few KB; anything far larger is not ours */
export const MAX_LIST_BYTES = 1024 * 1024
/** persisted ids whose updatedAt is older than this are forgotten (once the server stops returning them) */
export const PRUNE_AFTER_MS = 180 * 24 * 60 * 60 * 1000
/** hard cap on remembered ids per map, newest kept */
export const MAX_REMEMBERED = 200
/** redirects an image download may follow (each hop is checked before it is requested) */
export const MAX_IMAGE_REDIRECTS = 3

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

const MAX_TITLE = 300
const MAX_BODY = 10_000
const MAX_LABEL = 100
const MAX_URL = 2048
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/

const KINDS: readonly AnnouncementKind[] = ['rich', 'html']
const LEVELS: readonly AnnouncementLevel[] = ['info', 'warning', 'critical']
const MODES: readonly AnnouncementDisplayMode[] = ['once', 'every_launch', 'until_dismissed']
const ACTIONS: readonly AnnouncementAction[] = ['shown', 'dismiss', 'close']

/** persisted display state: announcement id → the updatedAt it was seen / dismissed at */
export interface AnnouncementsState {
  seen: Record<string, string>
  dismissed: Record<string, string>
}

/** a validated server entry; `linkUrl` and `imageUrl` never reach the renderer */
export interface ValidAnnouncement {
  id: string
  kind: AnnouncementKind
  level: AnnouncementLevel
  displayMode: AnnouncementDisplayMode
  title: string
  body?: string
  imageUrl?: string
  htmlUrl?: string
  link?: { url: string; label: string }
  updatedAt: string
}

/** ready for the dialog: the image is a data: URL, the link URL stays here */
export interface PreparedAnnouncement extends AnnouncementView {
  updatedAt: string
  linkUrl?: string
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface AnnouncementsDeps {
  fetch: FetchLike
  /** the account server (faamAccountServer()), read per fetch so a Settings change applies */
  serverUrl(): string
  appVersion: string
  platform: string
  uiLanguage(): string
  readState(): unknown
  writeState(state: AnnouncementsState): void
  now(): number
  /** defaults to process.env */
  env?: Record<string, string | undefined>
  /** defaults to FETCH_TIMEOUT_MS */
  timeoutMs?: number
}

export interface AnnouncementsService {
  /** fetch, validate and filter; one network round trip (plus images) per call */
  fetchPending(): Promise<PreparedAnnouncement[]>
  /** the session's announcements not yet closed (a `once` one: not yet displayed), fetched
   * once per app session */
  pending(): Promise<AnnouncementView[]>
  /** persist a renderer reaction; unknown ids / actions are ignored */
  action(id: unknown, action: unknown): void
  /** the link URL of a session announcement, or null */
  linkUrl(id: unknown): string | null
  /** whether a sub-frame of the shell window may show `url` (an html announcement's origin) */
  allowsFrameUrl(url: string): boolean
  /** whether this session displays an html announcement (its links may open in the browser) */
  hasHtml(): boolean
  /** the session html announcement whose page is `url` (same origin and path), or null */
  htmlAnnouncementAt(url: string): string | null
}

// ---- validation helpers ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

export function isAnnouncementId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value)
}

export function isAnnouncementAction(value: unknown): value is AnnouncementAction {
  return oneOf(ACTIONS, value)
}

/** an absolute http(s) URL without embedded credentials, or null */
export function parseHttpUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_URL) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

/** https anywhere, or http(s) on the account server's own origin (local dev servers) */
export function isAllowedRemote(url: URL, server: URL): boolean {
  return url.protocol === 'https:' || url.origin === server.origin
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n?/g, '\n').trim().slice(0, max)
}

function timeOf(value: unknown): number {
  return typeof value === 'string' ? Date.parse(value) : NaN
}

/**
 * One server entry, or null when it is malformed. Optional fields that fail
 * their checks are dropped (an unsafe link or image never drops the whole
 * announcement); an html announcement without a same-origin page does.
 */
export function validateAnnouncement(raw: unknown, server: URL): ValidAnnouncement | null {
  if (!isRecord(raw)) return null
  const { id, kind, level, displayMode } = raw
  if (!isAnnouncementId(id)) return null
  if (!oneOf(KINDS, kind) || !oneOf(LEVELS, level) || !oneOf(MODES, displayMode)) return null
  const title = cleanText(raw.title, MAX_TITLE)
  if (!title) return null
  if (typeof raw.updatedAt !== 'string' || Number.isNaN(timeOf(raw.updatedAt))) return null

  const entry: ValidAnnouncement = { id, kind, level, displayMode, title, updatedAt: raw.updatedAt }

  if (kind === 'html') {
    const page = parseHttpUrl(raw.htmlUrl)
    if (!page || page.origin !== server.origin) return null
    entry.htmlUrl = page.href
  } else {
    const body = cleanText(raw.body, MAX_BODY)
    if (body) entry.body = body
    const image = parseHttpUrl(raw.imageUrl)
    if (image && isAllowedRemote(image, server)) entry.imageUrl = image.href
  }

  if (isRecord(raw.link)) {
    const target = parseHttpUrl(raw.link.url)
    if (target && isAllowedRemote(target, server)) {
      entry.link = { url: target.href, label: cleanText(raw.link.label, MAX_LABEL) }
    }
  }
  return entry
}

/** the payload's valid entries in server order (duplicate ids keep the first) */
export function parseAnnouncementList(payload: unknown, server: URL): ValidAnnouncement[] {
  if (!isRecord(payload) || !Array.isArray(payload.announcements)) return []
  const out: ValidAnnouncement[] = []
  const ids = new Set<string>()
  for (const raw of payload.announcements) {
    const entry = validateAnnouncement(raw, server)
    if (!entry || ids.has(entry.id)) continue
    ids.add(entry.id)
    out.push(entry)
  }
  return out
}

// ---- persisted state ----

function asStampMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (pair): pair is [string, string] =>
        isAnnouncementId(pair[0]) && typeof pair[1] === 'string' && !Number.isNaN(timeOf(pair[1])),
    ),
  )
}

/** tolerate missing / corrupt settings values */
export function asAnnouncementsState(value: unknown): AnnouncementsState {
  const raw = isRecord(value) ? value : {}
  return { seen: asStampMap(raw.seen), dismissed: asStampMap(raw.dismissed) }
}

function stampOf(map: Record<string, string>, id: string): number {
  return Object.hasOwn(map, id) ? timeOf(map[id]) : NaN
}

/** recorded at (or after) this revision of the announcement */
function recordedAt(
  map: Record<string, string>,
  entry: { id: string; updatedAt: string },
): boolean {
  const stamp = stampOf(map, entry.id)
  return !Number.isNaN(stamp) && stamp >= timeOf(entry.updatedAt)
}

/** whether the local rules still let this announcement show */
export function shouldDisplay(entry: ValidAnnouncement, state: AnnouncementsState): boolean {
  switch (entry.displayMode) {
    case 'once':
      return !recordedAt(state.seen, entry)
    case 'until_dismissed':
      return !recordedAt(state.dismissed, entry)
    default:
      return true
  }
}

function pruneMap(
  map: Record<string, string>,
  now: number,
  activeIds: ReadonlySet<string>,
): Record<string, string> {
  const kept = Object.entries(map).filter(
    ([id, stamp]) => activeIds.has(id) || now - timeOf(stamp) <= PRUNE_AFTER_MS,
  )
  kept.sort((a, b) => timeOf(b[1]) - timeOf(a[1]))
  return Object.fromEntries(kept.slice(0, MAX_REMEMBERED))
}

/**
 * Forget ids whose updatedAt is older than PRUNE_AFTER_MS. Ids the server is
 * still returning are kept whatever their age: forgetting them would show a
 * long-running `once` announcement again.
 */
export function pruneAnnouncementsState(
  state: AnnouncementsState,
  now: number,
  activeIds: ReadonlySet<string> = new Set(),
): AnnouncementsState {
  return {
    seen: pruneMap(state.seen, now, activeIds),
    dismissed: pruneMap(state.dismissed, now, activeIds),
  }
}

function sameState(a: AnnouncementsState, b: AnnouncementsState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ---- network ----

/** resolves null on timeout; `work` gets a signal that aborts at the deadline */
async function withDeadline<T>(
  ms: number,
  work: (signal: AbortSignal) => Promise<T | null>,
): Promise<T | null> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, ms)
  })
  try {
    return await Promise.race([work(controller.signal).catch(() => null), deadline])
  } finally {
    clearTimeout(timer)
  }
}

/** the body, or null when it exceeds `maxBytes` (declared or actual) */
export async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => undefined)
    return null
  }
  if (!response.body) {
    const whole = new Uint8Array(await response.arrayBuffer())
    return whole.byteLength <= maxBytes ? whole : null
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      void reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
type ImageType = (typeof IMAGE_TYPES)[number]

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, i) => bytes[offset + i] === byte)
}

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0))

/** whether the bytes really are the declared image type */
export function matchesImageType(bytes: Uint8Array, type: ImageType): boolean {
  switch (type) {
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff])
    case 'image/gif':
      return startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))
    case 'image/webp':
      return startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)
  }
}

/** a redirect's Location header resolved against the URL that answered it, or null */
function resolveLocation(location: string | null, base: URL): URL | null {
  if (!location) return null
  try {
    return parseHttpUrl(new URL(location, base).href)
  } catch {
    return null
  }
}

function platformParam(platform: string): string | null {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'win'
  if (platform === 'linux') return 'linux'
  return null
}

// ---- service ----

export function createAnnouncementsService(deps: AnnouncementsDeps): AnnouncementsService {
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS
  const env = deps.env ?? process.env

  /** the session's list, fetched once */
  let session: Promise<PreparedAnnouncement[]> | null = null
  /** resolved copy of `session`, for the synchronous lookups */
  let sessionList: PreparedAnnouncement[] = []
  /** closed / dismissed this session: no longer offered to a remounted Home */
  const handled = new Set<string>()
  /** `once` announcements displayed this session: a recreated window (macOS) never re-offers them */
  const shownOnce = new Set<string>()
  /** every valid id of the last server answer, not just the displayed ones:
   * pruning must keep the stamps of announcements the server still returns */
  let activeIds: ReadonlySet<string> = new Set()

  const enabled = () => env[ANNOUNCEMENTS_ENV]?.trim() !== '0'

  const readState = (): AnnouncementsState => {
    try {
      return asAnnouncementsState(deps.readState())
    } catch {
      return asAnnouncementsState(undefined)
    }
  }

  const writeState = (state: AnnouncementsState): void => {
    try {
      deps.writeState(state)
    } catch {
      // unwritable settings: the announcement may show again next launch
    }
  }

  async function fetchList(base: string, server: URL): Promise<ValidAnnouncement[] | null> {
    const url = new URL(`${base.replace(/\/+$/, '')}/api/v1/announcements`)
    const platform = platformParam(deps.platform)
    if (platform) url.searchParams.set('platform', platform)
    if (deps.appVersion) url.searchParams.set('version', deps.appVersion)
    const locale = deps.uiLanguage()
    if (locale) url.searchParams.set('locale', locale)
    return withDeadline(timeoutMs, async (signal) => {
      const response = await deps.fetch(url.href, {
        headers: { Accept: 'application/json' },
        signal,
      })
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => undefined)
        return null
      }
      const bytes = await readCapped(response, MAX_LIST_BYTES)
      if (!bytes) return null
      const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
      return parseAnnouncementList(payload, server)
    })
  }

  /**
   * GET an image, following at most MAX_IMAGE_REDIRECTS redirects by hand:
   * every hop is checked against the image rules *before* it is requested, so
   * an image host can never bounce the main process onto a loopback / LAN
   * http address.
   */
  async function requestImage(
    url: URL,
    server: URL,
    signal: AbortSignal,
  ): Promise<Response | null> {
    let target = url
    for (let hop = 0; ; hop++) {
      const response = await deps.fetch(target.href, {
        headers: { Accept: 'image/*' },
        redirect: 'manual',
        signal,
      })
      if (!REDIRECT_STATUSES.has(response.status)) return response
      void response.body?.cancel().catch(() => undefined)
      if (hop >= MAX_IMAGE_REDIRECTS) return null
      const next = resolveLocation(response.headers.get('location'), target)
      if (!next || !isAllowedRemote(next, server)) return null
      target = next
    }
  }

  async function fetchImage(raw: string, server: URL): Promise<string | null> {
    const url = parseHttpUrl(raw)
    if (!url || !isAllowedRemote(url, server)) return null
    return withDeadline(timeoutMs, async (signal) => {
      const response = await requestImage(url, server, signal)
      if (!response) return null
      // belt and braces for a fetch that followed a redirect on its own
      const final = response.url ? parseHttpUrl(response.url) : url
      if (response.status !== 200 || !final || !isAllowedRemote(final, server)) {
        void response.body?.cancel().catch(() => undefined)
        return null
      }
      const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (!oneOf(IMAGE_TYPES, type)) {
        void response.body?.cancel().catch(() => undefined)
        return null
      }
      const bytes = await readCapped(response, MAX_IMAGE_BYTES)
      if (!bytes || bytes.byteLength === 0 || !matchesImageType(bytes, type)) return null
      return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
    })
  }

  async function prepare(entry: ValidAnnouncement, server: URL): Promise<PreparedAnnouncement> {
    const prepared: PreparedAnnouncement = {
      id: entry.id,
      kind: entry.kind,
      level: entry.level,
      displayMode: entry.displayMode,
      title: entry.title,
      updatedAt: entry.updatedAt,
    }
    if (entry.body) prepared.body = entry.body
    if (entry.htmlUrl) prepared.htmlUrl = entry.htmlUrl
    if (entry.link) {
      prepared.link = { label: entry.link.label }
      prepared.linkUrl = entry.link.url
    }
    if (entry.imageUrl) {
      const image = await fetchImage(entry.imageUrl, server).catch(() => null)
      if (image) prepared.image = image
    }
    return prepared
  }

  async function fetchPending(): Promise<PreparedAnnouncement[]> {
    try {
      if (!enabled()) return []
      const base = deps.serverUrl()
      const server = parseHttpUrl(base)
      if (!server) return []
      const list = await fetchList(base, server)
      if (!list) return []
      activeIds = new Set(list.map((a) => a.id))

      const state = readState()
      const pruned = pruneAnnouncementsState(state, deps.now(), activeIds)
      if (!sameState(state, pruned)) writeState(pruned)

      const chosen = list.filter((entry) => shouldDisplay(entry, pruned)).slice(0, MAX_PER_SESSION)
      return await Promise.all(chosen.map((entry) => prepare(entry, server)))
    } catch {
      return []
    }
  }

  const find = (id: unknown): PreparedAnnouncement | undefined =>
    isAnnouncementId(id) ? sessionList.find((a) => a.id === id) : undefined

  const toView = (entry: PreparedAnnouncement): AnnouncementView => {
    const view: AnnouncementView = {
      id: entry.id,
      kind: entry.kind,
      level: entry.level,
      displayMode: entry.displayMode,
      title: entry.title,
    }
    if (entry.body) view.body = entry.body
    if (entry.image) view.image = entry.image
    if (entry.htmlUrl) view.htmlUrl = entry.htmlUrl
    if (entry.link) view.link = { label: entry.link.label }
    return view
  }

  const record = (key: keyof AnnouncementsState, entry: PreparedAnnouncement): void => {
    const state = readState()
    if (recordedAt(state[key], entry)) return
    const next = { ...state, [key]: { ...state[key], [entry.id]: entry.updatedAt } }
    writeState(pruneAnnouncementsState(next, deps.now(), activeIds))
  }

  return {
    fetchPending,

    async pending() {
      session ??= fetchPending().then((list) => {
        sessionList = list
        return list
      })
      const list = await session
      return list.filter((a) => !handled.has(a.id) && !shownOnce.has(a.id)).map(toView)
    },

    action(id, action) {
      const entry = find(id)
      if (!entry || !isAnnouncementAction(action)) return
      if (action === 'shown') {
        if (entry.displayMode === 'once') {
          shownOnce.add(entry.id)
          record('seen', entry)
        }
        return
      }
      handled.add(entry.id)
      // a closed `once` counts as seen even if the 'shown' report never arrived
      if (entry.displayMode === 'once') record('seen', entry)
      if (action === 'dismiss' && entry.displayMode === 'until_dismissed') {
        record('dismissed', entry)
      }
    },

    linkUrl(id) {
      return find(id)?.linkUrl ?? null
    },

    allowsFrameUrl(url) {
      if (url === 'about:blank' || url === 'about:srcdoc') return true
      const target = parseHttpUrl(url)
      if (!target) return false
      return sessionList.some((a) => {
        const page = a.htmlUrl ? parseHttpUrl(a.htmlUrl) : null
        return !!page && page.origin === target.origin
      })
    },

    hasHtml() {
      return sessionList.some((a) => a.kind === 'html')
    },

    htmlAnnouncementAt(url) {
      const target = parseHttpUrl(url)
      if (!target) return null
      const match = sessionList.find((a) => {
        const page = a.htmlUrl ? parseHttpUrl(a.htmlUrl) : null
        return !!page && page.origin === target.origin && page.pathname === target.pathname
      })
      return match?.id ?? null
    },
  }
}

// ---- Electron wiring (kept here so it can be tested without Electron) ----

interface IpcLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

/** the three announcement channels; every argument is re-validated main-side */
export function registerAnnouncementsIpc(
  ipc: IpcLike,
  service: AnnouncementsService,
  openExternal: (url: string) => Promise<void>,
): void {
  ipc.handle(HOME_CHANNELS.announcementsPending, () => service.pending())
  ipc.handle(HOME_CHANNELS.announcementAction, (_event, id, action) => {
    service.action(id, action)
  })
  ipc.handle(HOME_CHANNELS.openAnnouncementLink, (_event, id) => {
    const url = service.linkUrl(id)
    if (url) void openExternal(url).catch(() => undefined)
  })
}

interface FrameNavigateEvent {
  url: string
  isMainFrame: boolean
  preventDefault(): void
}

interface KeyInput {
  type: string
  key: string
}

interface GuardedContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  on(event: 'will-frame-navigate', listener: (event: FrameNavigateEvent) => void): unknown
  on(event: 'will-redirect', listener: (event: FrameNavigateEvent) => void): unknown
  on(event: 'before-input-event', listener: (event: unknown, input: KeyInput) => void): unknown
  on(
    event: 'did-fail-load',
    listener: (
      event: unknown,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean,
    ) => void,
  ): unknown
  on(
    event: 'did-frame-navigate',
    listener: (
      event: unknown,
      url: string,
      httpResponseCode: number,
      httpStatusText: string,
      isMainFrame: boolean,
    ) => void,
  ): unknown
  send(channel: string, ...args: unknown[]): void
}

/**
 * The shell window hosts the html announcement in a sandboxed iframe. Its
 * links (`target=_blank`, via the page's <base>) arrive at the window-open
 * handler: they open in the system browser — http(s) only, and only while an
 * html announcement is part of this session — and never create an Electron
 * window. Sub-frames may not navigate away from the announcement's origin,
 * neither when a navigation starts nor through a server-side redirect.
 *
 * The frame is cross-origin and runs no scripts, so the dialog cannot see
 * into it; this side reports what it cannot:
 * - Escape pressed while focus is inside the page (its key events never reach
 *   the shell document)
 * - a page that failed to load (network error, blocked frame, HTTP error) —
 *   the iframe's load event fires for those too
 */
export function guardAnnouncementFrames(
  contents: GuardedContents,
  service: AnnouncementsService,
  openExternal: (url: string) => Promise<void>,
): void {
  const notify = (channel: string, ...args: unknown[]) => {
    try {
      contents.send(channel, ...args)
    } catch {
      // the window is going away
    }
  }
  const reportFailure = (url: string) => {
    const id = service.htmlAnnouncementAt(url)
    if (id) notify(HOME_CHANNELS.announcementFrameFailed, id)
  }

  contents.setWindowOpenHandler(({ url }) => {
    const target = parseHttpUrl(url)
    if (target && service.hasHtml()) void openExternal(target.href).catch(() => undefined)
    return { action: 'deny' }
  })
  contents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return
    if (!service.allowsFrameUrl(event.url)) event.preventDefault()
  })
  // a 3xx during a sub-frame navigation never reaches will-frame-navigate
  contents.on('will-redirect', (event) => {
    if (event.isMainFrame) return
    if (!service.allowsFrameUrl(event.url)) event.preventDefault()
  })
  // fires for key events in every frame, the announcement's out-of-process one included
  contents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && service.hasHtml()) {
      notify(HOME_CHANNELS.announcementEscape)
    }
  })
  contents.on('did-fail-load', (_event, _code, _description, url, isMainFrame) => {
    if (!isMainFrame) reportFailure(url)
  })
  contents.on('did-frame-navigate', (_event, url, httpResponseCode, _statusText, isMainFrame) => {
    if (!isMainFrame && httpResponseCode >= 400) reportFailure(url)
  })
}
