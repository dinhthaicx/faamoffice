/**
 * "Open Office files with FaamOffice?" prompt lifecycle — pure state
 * transitions over the `defaultAppPrompt` object persisted in
 * userData/app-settings.json, plus the per-session controller the IPC layer
 * delegates to.
 *
 * Design: this is a machine setting, not a value-moment ask, so there is no
 * install-age gate — the first eligible session after onboarding may ask. It
 * only asks while another app actually owns the Office types (live status
 * 'other'), at most three times in a lifetime, at least a week apart, and
 * "don't ask again" silences it for good. Only one home-screen prompt shows
 * per app session (see createHomePromptSlot): this one takes precedence over
 * the "star us" invitation, which then waits for a later session.
 */

import type {
  DefaultAppPromptAction,
  DefaultAppPromptShow,
  DefaultAppStatus,
} from '../shared/home-api'

export const DEFAULT_APP_PROMPT_KEY = 'defaultAppPrompt'

/** lifetime cap on how many times the prompt appears */
export const MAX_SHOWS = 3
/** a dismissed ("later") prompt stays quiet at least this long */
export const RESHOW_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export interface DefaultAppPromptState {
  /** times the prompt has been displayed */
  shownCount?: number
  /** ms epoch of the last display */
  lastShownAt?: number
  /** true once the user chose "don't ask again" */
  never?: boolean
}

/** tolerate missing/corrupt settings values */
export function asDefaultAppPromptState(value: unknown): DefaultAppPromptState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
  return {
    shownCount: num(raw.shownCount),
    lastShownAt: num(raw.lastShownAt),
    never: raw.never === true,
  }
}

/**
 * The gates that do not depend on the live default-app status. Checked first
 * so a silenced or capped prompt never pays for the status probe
 * (osascript / xdg-mime / reg query).
 */
export function couldShowDefaultAppPrompt(state: DefaultAppPromptState, now: number): boolean {
  if (state.never) return false
  const shown = state.shownCount ?? 0
  if (shown >= MAX_SHOWS) return false
  if (shown > 0 && now - (state.lastShownAt ?? 0) < RESHOW_AFTER_MS) return false
  return true
}

export function shouldShowDefaultAppPrompt(
  state: DefaultAppPromptState,
  status: DefaultAppStatus,
  now: number,
): boolean {
  // unsupported (dev build / unknown platform), unknown (probe failed) and
  // default (nothing to do) never prompt
  if (status.state !== 'other') return false
  return couldShowDefaultAppPrompt(state, now)
}

/** the prompt was displayed (counted whether or not the user reacts) */
export function withShown(state: DefaultAppPromptState, now: number): DefaultAppPromptState {
  return { ...state, shownCount: (state.shownCount ?? 0) + 1, lastShownAt: now }
}

/** the user chose "don't ask again" */
export function withNever(state: DefaultAppPromptState): DefaultAppPromptState {
  return { ...state, never: true }
}

export function isDefaultAppPromptAction(value: unknown): value is DefaultAppPromptAction {
  return value === 'set' || value === 'later' || value === 'never'
}

// ---- one home-screen prompt per session ----

export type HomePromptId = 'defaultApp' | 'star'

/**
 * Session-wide (main-process lifetime) arbiter between the home-screen
 * prompts: the first prompt to display claims the slot and keeps it until
 * quit, so the user never sees two asks in one session even when the shell
 * window is recreated (macOS) or a status changes mid-session.
 */
export interface HomePromptSlot {
  /** whether `id` may display: the slot is free or already belongs to it */
  available(id: HomePromptId): boolean
  /** record that `id` displayed this session */
  claim(id: HomePromptId): void
}

export function createHomePromptSlot(): HomePromptSlot {
  let owner: HomePromptId | null = null
  return {
    available: (id) => owner === null || owner === id,
    claim: (id) => {
      if (owner === null) owner = id
    },
  }
}

// ---- IPC-facing controller ----

/** returned when the status was not probed (a status-independent gate said no) */
const NOT_PROBED: DefaultAppStatus = { state: 'unknown', others: [], manualOnly: false }

export interface DefaultAppPromptDeps {
  readState(): DefaultAppPromptState
  writeState(state: DefaultAppPromptState): void
  /** the live default-app service (main/default-app.ts) */
  status(): Promise<DefaultAppStatus>
  set(): Promise<DefaultAppStatus>
  slot: HomePromptSlot
  now(): number
}

export interface DefaultAppPromptController {
  /** decided once per session; show:true is already counted as shown. Never rejects. */
  shouldShow(): Promise<DefaultAppPromptShow>
  /** the user reacted; rejects on an invalid action */
  action(action: unknown): Promise<DefaultAppStatus>
}

export function createDefaultAppPromptController(
  deps: DefaultAppPromptDeps,
): DefaultAppPromptController {
  /** a granted show, cached for the session: repeated queries (StrictMode
   * double-effects, AppFrame remounts) must get the same answer instead of
   * burning another lifetime show or flipping to a snoozed "false" */
  let grant: DefaultAppPromptShow | null = null
  /** concurrent queries share one evaluation (the status probe is async) */
  let pending: Promise<DefaultAppPromptShow> | null = null
  let lastStatus: DefaultAppStatus = NOT_PROBED

  async function evaluate(): Promise<DefaultAppPromptShow> {
    try {
      if (!deps.slot.available('defaultApp')) return { show: false, status: NOT_PROBED }
      const state = deps.readState()
      if (!couldShowDefaultAppPrompt(state, deps.now())) return { show: false, status: NOT_PROBED }
      const status = await deps.status()
      lastStatus = status
      const now = deps.now()
      // re-check the slot: another prompt may have claimed it during the probe
      if (!deps.slot.available('defaultApp') || !shouldShowDefaultAppPrompt(state, status, now)) {
        return { show: false, status }
      }
      deps.writeState(withShown(state, now))
      deps.slot.claim('defaultApp')
      grant = { show: true, status }
      return grant
    } catch {
      // settings or probe failures must never surface on the home screen
      return { show: false, status: NOT_PROBED }
    }
  }

  return {
    shouldShow() {
      if (grant) return Promise.resolve(grant)
      if (!pending) {
        pending = evaluate().finally(() => {
          pending = null
        })
      }
      return pending
    },

    async action(action) {
      if (!isDefaultAppPromptAction(action)) throw new Error('Invalid default-app prompt action.')
      // the card was reacted to — drop the session grant so a later query (new
      // shell window on macOS) re-evaluates the real rules (snooze / never);
      // the slot stays claimed, so the star prompt still waits for a later session
      grant = null
      if (action === 'set') {
        lastStatus = await deps.set()
        return lastStatus
      }
      if (action === 'never') {
        try {
          deps.writeState(withNever(deps.readState()))
        } catch {
          // unwritable settings: the snooze stamp from the display still applies
        }
      }
      // 'later' needs no write: the display was already counted by the query
      return lastStatus
    },
  }
}
