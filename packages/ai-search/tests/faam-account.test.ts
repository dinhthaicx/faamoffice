import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FAAM_DEFAULT_SERVER,
  faamAccountPath,
  faamAccountServer,
  faamAccountStatus,
  faamAccountToken,
  faamAiBaseUrl,
  faamLogout,
  normalizeServerUrl,
  setFaamAccountServer,
  startFaamLogin,
  type FaamLoginEvent,
} from '../src/faam-account'

let dir: string
const SERVER = 'http://acct.test'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'faam-account-'))
  process.env.FAAMOFFICE_ACCOUNT_DIR = dir
  delete process.env.FAAMOFFICE_ACCOUNT_URL
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
  delete process.env.FAAMOFFICE_ACCOUNT_DIR
})

const CODE = {
  device_code: 'dev-1',
  user_code: 'ABCD-EFGH',
  verification_uri: `${SERVER}/device`,
  verification_uri_complete: `${SERVER}/device?code=ABCD-EFGH`,
  expires_in: 600,
  interval: 1,
}

describe('server address', () => {
  it('normalizes http(s) addresses and refuses anything else', () => {
    expect(normalizeServerUrl(' https://faam.example.com/ ')).toBe('https://faam.example.com')
    expect(normalizeServerUrl('https://x.test/base//')).toBe('https://x.test/base')
    expect(normalizeServerUrl('ftp://x.test')).toBe('')
    expect(normalizeServerUrl('https://u:p@x.test')).toBe('')
    expect(normalizeServerUrl(42)).toBe('')
  })

  it('prefers the env override, then the stored choice, then the build default', () => {
    expect(faamAccountServer()).toBe(FAAM_DEFAULT_SERVER)
    expect(faamAccountServer('https://build.test')).toBe('https://build.test')
    setFaamAccountServer(SERVER)
    expect(faamAccountServer('https://build.test')).toBe(SERVER)
    process.env.FAAMOFFICE_ACCOUNT_URL = 'https://env.test'
    expect(faamAccountServer()).toBe('https://env.test')
    expect(faamAiBaseUrl()).toBe('https://env.test/api/v1/ai')
  })
})

describe('device-code sign-in', () => {
  it('waits through pending and slow_down, then stores the token privately', async () => {
    setFaamAccountServer(SERVER)
    const replies = [
      json(200, CODE),
      json(400, { error: 'authorization_pending' }),
      json(400, { error: 'slow_down' }),
      json(200, {
        access_token: 'fo_secret',
        token_type: 'Bearer',
        user: { id: 'u1', email: 'a@b.c', name: 'A' },
      }),
    ]
    const fetchMock = vi.fn(async () => replies.shift()!)
    vi.stubGlobal('fetch', fetchMock)
    const events: FaamLoginEvent[] = []
    await startFaamLogin('Thai MacBook', (e) => events.push(e), { pollScale: 1 })

    expect(events[0]).toEqual({
      phase: 'code',
      userCode: 'ABCD-EFGH',
      url: `${SERVER}/device?code=ABCD-EFGH`,
      expiresInSec: 600,
    })
    expect(events.at(-1)).toEqual({
      phase: 'success',
      user: { id: 'u1', email: 'a@b.c', name: 'A' },
    })
    const first = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(first[0]).toBe(`${SERVER}/api/auth/device/code`)
    expect(JSON.parse(String(first[1].body))).toEqual({
      client_id: 'faamoffice-desktop',
      device_name: 'Thai MacBook',
    })
    expect(faamAccountToken()).toBe('fo_secret')
    // the stored server survives sign-in
    expect(faamAccountServer()).toBe(SERVER)
    expect(statSync(faamAccountPath()).mode & 0o777).toBe(0o600)
  })

  it.each([
    ['access_denied', 'denied'],
    ['expired_token', 'expired'],
    ['invalid_grant', 'failed'],
  ])('ends on %s without storing a token', async (serverError, phaseError) => {
    const replies = [json(200, CODE), json(400, { error: serverError })]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => replies.shift()!),
    )
    const events: FaamLoginEvent[] = []
    await startFaamLogin('pc', (e) => events.push(e), { pollScale: 1 })
    expect(events.at(-1)).toMatchObject({ phase: 'error', error: phaseError })
    expect(faamAccountToken()).toBe('')
  })

  it('reports an unreachable server as a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    const events: FaamLoginEvent[] = []
    await startFaamLogin('pc', (e) => events.push(e), { pollScale: 1 })
    expect(events).toEqual([{ phase: 'error', error: 'network' }])
  })
})

describe('account status and sign-out', () => {
  async function signIn(): Promise<void> {
    const replies = [
      json(200, CODE),
      json(200, { access_token: 'fo_t', user: { id: 'u1', email: 'a@b.c', name: 'A' } }),
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => replies.shift()!),
    )
    await startFaamLogin('pc', () => undefined, { pollScale: 1 })
  }

  it('reads the live credit balance with the bearer token', async () => {
    setFaamAccountServer(SERVER)
    await signIn()
    const fetchMock = vi.fn(async () =>
      json(200, { id: 'u1', email: 'a@b.c', name: 'Anh', credits: 42, emailVerified: true }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const status = await faamAccountStatus()
    expect(status).toEqual({
      signedIn: true,
      server: SERVER,
      user: { id: 'u1', email: 'a@b.c', name: 'Anh', credits: 42, emailVerified: true },
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${SERVER}/api/v1/me`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fo_t')
  })

  it('signs out locally when the server rejects the token', async () => {
    await signIn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(401, { error: 'invalid_token' })),
    )
    expect((await faamAccountStatus()).signedIn).toBe(false)
    expect(faamAccountToken()).toBe('')
  })

  it('keeps the last identity while the server is unreachable', async () => {
    await signIn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline')
      }),
    )
    const status = await faamAccountStatus()
    expect(status).toMatchObject({ signedIn: true, offline: true, user: { email: 'a@b.c' } })
  })

  it('revokes the token on the server and forgets it, keeping the chosen server', async () => {
    setFaamAccountServer(SERVER)
    await signIn()
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await faamLogout()
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(`${SERVER}/api/v1/logout`)
    expect(faamAccountToken()).toBe('')
    expect(JSON.parse(readFileSync(faamAccountPath(), 'utf-8'))).toEqual({ server: SERVER })
  })
})
