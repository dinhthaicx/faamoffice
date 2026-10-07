import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatForProvider } from '../src/chat'
import {
  AiDailyLimitError,
  accountLimitError,
  formatAiRetryTime,
  localizeChatFailure,
  retryAtFrom,
} from '../src/account-limit'
import { isAiOverloadedError } from '../src/overload-error'
import { AiCreditsError, streamForProvider } from '../src/stream'

afterEach(() => {
  vi.unstubAllGlobals()
})

const NOW = Date.parse('2026-10-07T10:00:00.000Z')
const RESET = '2026-10-07T17:00:00.000Z'

/** the Faam AI Cloud error bodies (web/src/lib/ai-proxy.ts) */
function faamError(status: number, code: string, message: string, retryAfter?: number): Response {
  return new Response(JSON.stringify({ error: { message, type: code, code } }), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(retryAfter !== undefined ? { 'retry-after': String(retryAfter) } : {}),
    },
  })
}

const dailyLimit = (retryAfter?: number) =>
  faamError(
    429,
    'daily_limit_reached',
    `You have used all 300 Faam AI requests for today. The quota resets at ${RESET} (midnight, UTC+7).`,
    retryAfter,
  )

const FAAM = { apiKey: 'fo_token', model: 'faam-fast', baseUrl: 'https://faam.test/api/v1/ai' }

function stream(): Promise<void> {
  return streamForProvider('faamcloud', FAAM, 'sys', [{ role: 'user', text: 'hi' }], [], 1000, {
    signal: new AbortController().signal,
    onDelta: () => undefined,
    onToolCall: () => undefined,
  })
}

describe('accountLimitError', () => {
  it('types insufficient_credits as a credits error', () => {
    const err = accountLimitError(
      JSON.stringify({
        error: { message: 'Your Faam AI credits are insufficient.', code: 'insufficient_credits' },
      }),
      null,
    )
    expect(err).toBeInstanceOf(AiCreditsError)
    expect(err?.message).toBe('Your Faam AI credits are insufficient.')
  })

  it('types daily_limit_reached with the reset time from Retry-After', () => {
    const err = accountLimitError(
      JSON.stringify({ error: { message: 'used up', type: 'daily_limit_reached' } }),
      '25200',
      NOW,
    )
    expect(err).toBeInstanceOf(AiDailyLimitError)
    expect((err as AiDailyLimitError).retryAt).toBe(RESET)
  })

  it('leaves rate limits, other gateways and non-JSON bodies to the generic error', () => {
    const rateLimited = JSON.stringify({ error: { message: 'slow down', code: 'rate_limited' } })
    expect(accountLimitError(rateLimited, '30')).toBeNull()
    expect(
      accountLimitError(JSON.stringify({ error: { code: 402, message: 'x' } }), null),
    ).toBeNull()
    expect(accountLimitError(JSON.stringify({ error: 'insufficient_credits' }), null)).toBeNull()
    expect(accountLimitError('<html>busy</html>', null)).toBeNull()
  })
})

describe('retryAtFrom', () => {
  it('reads seconds, an HTTP date, then an ISO time in the message', () => {
    expect(retryAtFrom('60', '', NOW)).toBe('2026-10-07T10:01:00.000Z')
    expect(retryAtFrom('Wed, 07 Oct 2026 17:00:00 GMT', '', NOW)).toBe(RESET)
    expect(retryAtFrom(null, `resets at ${RESET} (midnight)`, NOW)).toBe(RESET)
    expect(retryAtFrom('soon', 'no time here', NOW)).toBeUndefined()
  })
})

describe('formatAiRetryTime', () => {
  it('shows the time alone on the same day and adds the date otherwise', () => {
    const local = new Date(2026, 9, 7, 9, 0).getTime()
    const sameDay = new Date(2026, 9, 7, 17, 5).toISOString()
    const nextDay = new Date(2026, 9, 8, 0, 0).toISOString()
    expect(formatAiRetryTime(sameDay, 'en', local)).toMatch(/05/)
    expect(formatAiRetryTime(sameDay, 'en', local)).not.toMatch(/10\//)
    expect(formatAiRetryTime(nextDay, 'vi', local)).toMatch(/8/)
    expect(formatAiRetryTime(nextDay, 'vi', local)).toMatch(/00/)
  })

  it('survives an unknown locale tag and an unparseable time', () => {
    expect(formatAiRetryTime(RESET, 'not a locale!!', NOW)).not.toBe('')
    expect(formatAiRetryTime('later', 'en', NOW)).toBe('later')
  })
})

describe('Faam AI Cloud refusals on the wire', () => {
  it('streams: daily limit → AiDailyLimitError (never "busy")', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dailyLimit(3600)))
    const err = await stream().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiDailyLimitError)
    expect((err as AiDailyLimitError).retryAt).toBeDefined()
    expect(isAiOverloadedError(err)).toBe(false)
  })

  it('streams: insufficient credits → AiCreditsError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          faamError(402, 'insufficient_credits', 'Your Faam AI credits are insufficient.'),
        ),
    )
    await expect(stream()).rejects.toBeInstanceOf(AiCreditsError)
  })

  it('streams: a plain 429 rate limit stays the generic "busy" HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(faamError(429, 'rate_limited', 'Too many Faam AI requests.', 30)),
    )
    const err = await stream().catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(AiDailyLimitError)
    expect(String((err as Error).message)).toMatch(/^HTTP 429/)
    expect(isAiOverloadedError(err)).toBe(true)
  })

  it('one-shot chat reports the refusal kind and the reset time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dailyLimit()))
    const limited = await chatForProvider('faamcloud', FAAM, 'sys', 'hi')
    expect(limited).toMatchObject({ ok: false, errorCode: 'daily-limit', retryAt: RESET })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(faamError(402, 'insufficient_credits', 'No credits left.')),
    )
    expect(await chatForProvider('faamcloud', FAAM, 'sys', 'hi')).toEqual({
      ok: false,
      error: 'No credits left.',
      errorCode: 'credits',
    })
  })
})

describe('localizeChatFailure (the one-shot ai:chat path)', () => {
  const texts = {
    dailyLimit: vi.fn((err: { message: string; retryAt?: string | undefined }) =>
      err.retryAt ? `Hết lượt, thử lại sau ${err.retryAt}` : err.message,
    ),
    credits: () => 'Bạn đã dùng hết credit Faam AI',
    busy: () => 'Dịch vụ AI đang bận',
  }

  it('replaces the server text of an insufficient_credits refusal (402)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          faamError(
            402,
            'insufficient_credits',
            'Your Faam AI credits are insufficient. Ask an administrator to add credits.',
          ),
        ),
    )
    const result = await chatForProvider('faamcloud', FAAM, 'sys', 'hi')
    expect(localizeChatFailure(result, texts)).toEqual({
      ok: false,
      error: 'Bạn đã dùng hết credit Faam AI',
      errorCode: 'credits',
    })
  })

  it('formats a daily_limit_reached refusal with its reset time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dailyLimit(7 * 3600)))
    const result = await chatForProvider('faamcloud', FAAM, 'sys', 'hi')
    const localized = localizeChatFailure(result, texts)
    expect(localized).toMatchObject({ ok: false, errorCode: 'daily-limit' })
    expect(localized.error).toMatch(/^Hết lượt, thử lại sau \d{4}-/)
    expect(texts.dailyLimit).toHaveBeenLastCalledWith({
      message: result.error,
      retryAt: result.retryAt,
    })
  })

  it('reports a plain 429 rate limit as busy, never as a credits refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(faamError(429, 'rate_limited', 'Too many Faam AI requests.', 30)),
    )
    const result = await chatForProvider('faamcloud', FAAM, 'sys', 'hi')
    expect(localizeChatFailure(result, texts)).toEqual({ ok: false, error: 'Dịch vụ AI đang bận' })
  })

  it('passes successes and other failures through unchanged', () => {
    const ok = { ok: true, content: 'pong' }
    expect(localizeChatFailure(ok, texts)).toBe(ok)
    const other = { ok: false, error: 'HTTP 401: invalid key' }
    expect(localizeChatFailure(other, texts)).toBe(other)
  })
})
