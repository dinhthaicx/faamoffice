/**
 * Account-level refusals of metered OpenAI-compatible gateways, Faam AI Cloud
 * first: a non-OK reply whose JSON body carries `error.code`.
 *
 * - insufficient_credits (402, Faam credits on, balance used up) becomes an
 *   AiCreditsError, so the apps show their localized "credits used up" text
 *   (errorCode 'credits').
 * - daily_limit_reached (429, Faam credits off, the day's requests used up)
 *   becomes an AiDailyLimitError carrying the reset time, so the main process
 *   can say "try again after {time}" in the UI language.
 *
 * Anything else, a plain 429 rate_limited included, keeps the generic
 * "HTTP <status>: …" error, which the apps report as "busy, retry shortly".
 */

import { isAiOverloadedError } from './overload-error'
import { AiCreditsError } from './protocols/shared'
import type { AiChatResponse } from './types'

/** the account's requests for today are used up; `retryAt` (ISO) is when they reset, if known */
export class AiDailyLimitError extends Error {
  readonly retryAt: string | undefined

  constructor(message: string, retryAt?: string) {
    super(message)
    this.name = 'AiDailyLimitError'
    this.retryAt = retryAt
  }
}

const ISO_TIME = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/

/** Retry-After (seconds or an HTTP date), else an ISO time in the message, as ISO; undefined when neither parses */
export function retryAtFrom(
  retryAfter: string | null | undefined,
  message: string,
  now = Date.now(),
): string | undefined {
  const header = retryAfter?.trim() ?? ''
  let at = NaN
  if (/^\d+$/.test(header)) at = now + Number(header) * 1000
  else if (header) at = Date.parse(header)
  if (Number.isNaN(at)) {
    const stamp = ISO_TIME.exec(message)?.[0]
    if (stamp) at = Date.parse(stamp)
  }
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined
}

/**
 * The typed error for an account refusal (see the header), or null when the
 * body is not one: callers then report the generic HTTP error.
 */
export function accountLimitError(
  bodyText: string,
  retryAfter: string | null | undefined,
  now = Date.now(),
): AiCreditsError | AiDailyLimitError | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return null
  }
  const error =
    parsed && typeof parsed === 'object' ? (parsed as { error?: unknown }).error : undefined
  if (!error || typeof error !== 'object') return null
  const { code, type, message } = error as { code?: unknown; type?: unknown; message?: unknown }
  const kind = typeof code === 'string' ? code : typeof type === 'string' ? type : ''
  const text = typeof message === 'string' ? message.slice(0, 500) : ''
  if (kind === 'insufficient_credits') {
    return new AiCreditsError(text || 'Your credits are used up')
  }
  if (kind === 'daily_limit_reached') {
    return new AiDailyLimitError(
      text || 'The daily request limit has been reached',
      retryAtFrom(retryAfter, text, now),
    )
  }
  return null
}

/**
 * `retryAt` as a short local time for the error message: the time alone when
 * it falls on the same local day as `now`, else day, month and time.
 */
export function formatAiRetryTime(retryAt: string, locale: string, now = Date.now()): string {
  const at = new Date(retryAt)
  if (Number.isNaN(at.getTime())) return retryAt
  const sameDay = at.toDateString() === new Date(now).toDateString()
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }
  try {
    return new Intl.DateTimeFormat(locale, options).format(at)
  } catch {
    // an unknown locale tag: the runtime default still formats the time
    return new Intl.DateTimeFormat(undefined, options).format(at)
  }
}

/** an app's localized texts for {@link localizeChatFailure} */
export interface ChatFailureTexts {
  /** today's requests are used up; `retryAt` (ISO) is when they reset, if known */
  dailyLimit(err: { message: string; retryAt?: string | undefined }): string
  /** the account's credit balance is used up */
  credits(): string
  /** a capacity / rate-limit reply */
  busy(): string
}

/**
 * A one-shot (`ai:chat`) result in the UI language. That path reports HTTP
 * failures as ok:false with the server's own (English) text, so account
 * refusals become the app's localized messages (errorCode kept) and
 * capacity/rate-limit dumps its "busy" message. Successes and any other
 * failure pass through unchanged.
 */
export function localizeChatFailure(
  result: AiChatResponse,
  texts: ChatFailureTexts,
): AiChatResponse {
  if (result.ok) return result
  if (result.errorCode === 'daily-limit') {
    return {
      ...result,
      error: texts.dailyLimit({ message: result.error ?? '', retryAt: result.retryAt }),
    }
  }
  if (result.errorCode === 'credits') return { ...result, error: texts.credits() }
  if (isAiOverloadedError(result.error)) return { ok: false, error: texts.busy() }
  return result
}
