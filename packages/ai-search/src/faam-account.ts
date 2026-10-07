/**
 * FaamOffice account (optional): device-code sign-in against the FaamOffice
 * account server (web/ in this repository), the bearer token it issues, and
 * the account calls the desktop app makes with it. The token unlocks Faam AI
 * Cloud, an OpenAI-compatible endpoint at `<server>/api/v1/ai`. The server
 * operator decides how it is metered: Faam credits, or (credits turned off) an
 * optional number of requests per day.
 *
 * State lives in ~/.faamoffice/account.json (mode 0600, like other CLI
 * credentials) so both the app and the faamoffice command line can read it.
 * FAAMOFFICE_ACCOUNT_DIR overrides the directory (tests), FAAMOFFICE_ACCOUNT_URL
 * the server.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const FAAM_CLIENT_ID = 'faamoffice-desktop'
/** the public FaamOffice account server, used unless the environment, the build or the user picks another */
export const FAAM_DEFAULT_SERVER = 'https://faamoffice.net'

export interface FaamAccountUser {
  id: string
  email: string
  name: string
}

interface StoredAccount {
  server?: string | undefined
  token?: string | undefined
  user?: FaamAccountUser | undefined
}

/** today's Faam AI requests while the server runs without credits (daily limit > 0) */
export interface FaamAiQuota {
  limit: number
  used: number
  /** ISO time of the next reset */
  resetsAt: string
}

export interface FaamAccountStatus {
  signedIn: boolean
  server: string
  user?:
    | (FaamAccountUser & {
        /** live balance; only sent while the server has Faam credits turned on */
        credits?: number
        /** false when the server runs without credits (older servers omit it: credits on) */
        creditsEnabled?: boolean
        quota?: FaamAiQuota
        emailVerified?: boolean
      })
    | undefined
  /** the server could not be reached; `user` is the last known identity */
  offline?: boolean
}

export type FaamLoginEvent =
  | { phase: 'code'; userCode: string; url: string; expiresInSec: number }
  | { phase: 'success'; user: FaamAccountUser }
  | { phase: 'error'; error: 'network' | 'expired' | 'denied' | 'failed'; message?: string }

export function faamAccountPath(): string {
  return join(process.env.FAAMOFFICE_ACCOUNT_DIR || join(homedir(), '.faamoffice'), 'account.json')
}

function readStored(): StoredAccount {
  try {
    const raw = JSON.parse(readFileSync(faamAccountPath(), 'utf-8')) as unknown
    return raw && typeof raw === 'object' ? (raw as StoredAccount) : {}
  } catch {
    return {}
  }
}

function writeStored(next: StoredAccount): void {
  const path = faamAccountPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2), { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best effort on filesystems without POSIX modes */
  }
}

/** an http(s) origin + optional path prefix, without a trailing slash; '' when invalid */
export function normalizeServerUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return ''
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    if (url.username || url.password) return ''
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return ''
  }
}

let buildDefaultServer = ''

/** the server baked into a release build (shell startup); the user's choice still wins */
export function setFaamBuildDefaultServer(url: string): void {
  buildDefaultServer = normalizeServerUrl(url)
}

/** the account server: env override, then the user's choice, then the build default */
export function faamAccountServer(buildDefault = ''): string {
  return (
    normalizeServerUrl(process.env.FAAMOFFICE_ACCOUNT_URL) ||
    normalizeServerUrl(readStored().server) ||
    normalizeServerUrl(buildDefault) ||
    buildDefaultServer ||
    FAAM_DEFAULT_SERVER
  )
}

/** remember a server chosen in Settings; switching servers signs out */
export function setFaamAccountServer(raw: string): string {
  const server = normalizeServerUrl(raw)
  const stored = readStored()
  if (server === normalizeServerUrl(stored.server)) return server
  writeStored(server ? { server } : {})
  return server
}

/** bearer token of the signed-in account; '' when signed out */
export function faamAccountToken(): string {
  const token = readStored().token
  return typeof token === 'string' ? token : ''
}

/** OpenAI-compatible base URL of Faam AI Cloud on the current server */
export function faamAiBaseUrl(buildDefault = ''): string {
  return `${faamAccountServer(buildDefault)}/api/v1/ai`
}

/**
 * A chat config for the main-process AI handlers: Faam AI Cloud takes its key
 * and base URL from the signed-in account (an empty key = signed out); every
 * other provider is returned untouched.
 */
export function withFaamAccount<T extends { apiKey: string; baseUrl?: string | undefined }>(
  provider: string,
  config: T | undefined,
): T | undefined {
  if (provider !== 'faamcloud' || !config) return config
  const token = faamAccountToken()
  return { ...config, apiKey: token, baseUrl: token ? faamAiBaseUrl() : undefined }
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** the /me `aiQuota` object, or undefined when it is missing or malformed */
export function parseFaamQuota(raw: unknown): FaamAiQuota | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { limit, used, resetsAt } = raw as Record<string, unknown>
  if (!isCount(limit) || limit === 0 || !isCount(used)) return undefined
  if (typeof resetsAt !== 'string' || Number.isNaN(Date.parse(resetsAt))) return undefined
  return { limit, used, resetsAt }
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' }
}

/**
 * Who is signed in, with the live credit balance (credits on) or today's
 * request quota (credits off, daily limit set) when the server answers. Older
 * servers only send `credits`. An invalid token (revoked on the website,
 * account disabled) signs the app out.
 */
export async function faamAccountStatus(buildDefault = ''): Promise<FaamAccountStatus> {
  const server = faamAccountServer(buildDefault)
  const stored = readStored()
  if (!stored.token) return { signedIn: false, server }
  try {
    const res = await fetch(`${server}/api/v1/me`, {
      headers: authHeaders(stored.token),
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 401) {
      writeStored({ server: stored.server })
      return { signedIn: false, server }
    }
    if (!res.ok) return { signedIn: true, server, user: stored.user, offline: true }
    const me = (await res.json()) as Partial<FaamAccountUser> & {
      credits?: unknown
      creditsEnabled?: unknown
      aiQuota?: unknown
      emailVerified?: unknown
    }
    const user: FaamAccountUser = {
      id: String(me.id ?? stored.user?.id ?? ''),
      email: String(me.email ?? stored.user?.email ?? ''),
      name: String(me.name ?? stored.user?.name ?? ''),
    }
    if (JSON.stringify(user) !== JSON.stringify(stored.user)) writeStored({ ...stored, user })
    const creditsEnabled = me.creditsEnabled !== false
    const quota = creditsEnabled ? undefined : parseFaamQuota(me.aiQuota)
    return {
      signedIn: true,
      server,
      user: {
        ...user,
        ...(typeof me.creditsEnabled === 'boolean' ? { creditsEnabled: me.creditsEnabled } : {}),
        // a balance means nothing while credits are off, even if a server sends one
        ...(creditsEnabled && typeof me.credits === 'number' && Number.isFinite(me.credits)
          ? { credits: me.credits }
          : {}),
        ...(quota ? { quota } : {}),
        ...(typeof me.emailVerified === 'boolean' ? { emailVerified: me.emailVerified } : {}),
      },
    }
  } catch {
    return { signedIn: true, server, user: stored.user, offline: true }
  }
}

/** the model ids Faam AI Cloud serves; [] when signed out or unreachable */
export async function faamCloudModels(buildDefault = ''): Promise<string[]> {
  const token = faamAccountToken()
  if (!token) return []
  try {
    const res = await fetch(`${faamAiBaseUrl(buildDefault)}/models`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const body = (await res.json()) as { data?: { id?: unknown }[] }
    return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

let activeLogin: AbortController | null = null

export function faamLoginInFlight(): boolean {
  return activeLogin !== null
}

export function cancelFaamLogin(): void {
  activeLogin?.abort()
  activeLogin = null
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      },
      { once: true },
    )
  })

/**
 * Device-code sign-in (RFC 8628): ask the server for a code, hand the
 * verification URL to `onProgress` (the caller opens the browser), then poll
 * until the user approves, denies or the code expires. A second call cancels
 * the first. Resolves when the flow ends; every outcome is also reported
 * through `onProgress`.
 */
export async function startFaamLogin(
  deviceName: string,
  onProgress: (event: FaamLoginEvent) => void,
  options: { buildDefault?: string; pollScale?: number } = {},
): Promise<void> {
  cancelFaamLogin()
  const controller = new AbortController()
  activeLogin = controller
  const { signal } = controller
  const server = faamAccountServer(options.buildDefault)
  const scale = options.pollScale ?? 1000
  const post = (path: string, body: unknown) =>
    fetch(`${server}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  try {
    let codeRes: Response
    try {
      codeRes = await post('/api/auth/device/code', {
        client_id: FAAM_CLIENT_ID,
        device_name: deviceName.slice(0, 80),
      })
    } catch {
      if (!signal.aborted) onProgress({ phase: 'error', error: 'network' })
      return
    }
    if (!codeRes.ok) {
      onProgress({ phase: 'error', error: 'failed', message: `HTTP ${codeRes.status}` })
      return
    }
    const code = (await codeRes.json()) as {
      device_code: string
      user_code: string
      verification_uri: string
      verification_uri_complete?: string
      expires_in: number
      interval?: number
    }
    onProgress({
      phase: 'code',
      userCode: code.user_code,
      url: code.verification_uri_complete || code.verification_uri,
      expiresInSec: code.expires_in,
    })
    let interval = Math.max(1, code.interval ?? 5)
    const deadline = Date.now() + code.expires_in * scale
    while (Date.now() < deadline) {
      await sleep(interval * scale, signal)
      let res: Response
      try {
        res = await post('/api/auth/device/token', {
          client_id: FAAM_CLIENT_ID,
          device_code: code.device_code,
        })
      } catch {
        if (signal.aborted) return
        continue // a network blip mid-poll: keep waiting until the code expires
      }
      if (res.ok) {
        const granted = (await res.json()) as { access_token: string; user: FaamAccountUser }
        writeStored({
          server: readStored().server,
          token: granted.access_token,
          user: granted.user,
        })
        onProgress({ phase: 'success', user: granted.user })
        return
      }
      const error = ((await res.json().catch(() => ({}))) as { error?: string }).error
      if (error === 'authorization_pending') continue
      if (error === 'slow_down') {
        interval += 5
        continue
      }
      onProgress({
        phase: 'error',
        error:
          error === 'access_denied' ? 'denied' : error === 'expired_token' ? 'expired' : 'failed',
        ...(error ? { message: error } : {}),
      })
      return
    }
    onProgress({ phase: 'error', error: 'expired' })
  } catch {
    /* aborted by a newer login or cancelFaamLogin */
  } finally {
    if (activeLogin === controller) activeLogin = null
  }
}

/** revoke the token on the server (best effort) and forget it locally */
export async function faamLogout(buildDefault = ''): Promise<void> {
  cancelFaamLogin()
  const stored = readStored()
  if (stored.token) {
    try {
      await fetch(`${faamAccountServer(buildDefault)}/api/v1/logout`, {
        method: 'POST',
        headers: authHeaders(stored.token),
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      /* offline: the local token is still dropped */
    }
  }
  if (stored.server) writeStored({ server: stored.server })
  else if (existsSync(faamAccountPath())) unlinkSync(faamAccountPath())
}
