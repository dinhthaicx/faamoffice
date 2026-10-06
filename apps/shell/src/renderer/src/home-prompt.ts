import type { DefaultAppStatus, HomeApi } from '../../shared/home-api'

/** the single home-screen prompt shown this session, if any */
export type HomePrompt =
  { kind: 'defaultApp'; status: DefaultAppStatus } | { kind: 'star'; docOpens: number }

type PromptApi = Partial<Pick<HomeApi, 'defaultAppPromptShouldShow' | 'starPromptShouldShow'>>

/**
 * Asks the main process which prompt to show, in precedence order. The
 * default-app prompt goes first; the star invitation is only queried when it
 * declines — querying it would already count it as shown. The main process
 * enforces the same one-prompt-per-session rule (createHomePromptSlot).
 * Missing methods (stale preload) and failed queries count as "no".
 */
export async function pickHomePrompt(api: PromptApi): Promise<HomePrompt | null> {
  try {
    const result = await api.defaultAppPromptShouldShow?.()
    if (result?.show) return { kind: 'defaultApp', status: result.status }
  } catch {
    // fall through to the star invitation
  }
  try {
    const result = await api.starPromptShouldShow?.()
    if (result?.show) return { kind: 'star', docOpens: result.docOpens }
  } catch {
    // no prompt this session
  }
  return null
}
