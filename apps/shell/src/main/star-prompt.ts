/**
 * "Star us on GitHub" prompt lifecycle — pure state transitions over the
 * `starPrompt` object persisted in userData/app-settings.json.
 *
 * Design: the prompt only appears after the user has demonstrably gotten
 * value out of the app (installed a few days, opened several documents),
 * shows at most twice in a lifetime, and any explicit reaction ("go star" /
 * "already starred") resolves it permanently. We cannot detect whether the
 * user actually starred (that would need GitHub OAuth), so opening the repo
 * page counts as resolved — never nag someone who probably already clicked.
 */

import type { StarPromptShow } from '../shared/home-api'
import type { HomePromptSlot } from './default-app-prompt'

export const STAR_PROMPT_KEY = 'starPrompt'
/** app-settings key remembering which version last ran (upgrade detection) */
export const LAST_RUN_VERSION_KEY = 'lastRunVersion'

/** installed at least this long before the first prompt */
export const MIN_AGE_MS = 3 * 24 * 60 * 60 * 1000
/** documents opened (any type) before the first prompt */
export const MIN_DOC_OPENS = 5
/** lifetime cap on how many times the prompt appears */
export const MAX_SHOWS = 2
/** a dismissed ("later") prompt stays quiet at least this long */
export const RESHOW_AFTER_MS = 14 * 24 * 60 * 60 * 1000

export interface StarPromptState {
  /** ms epoch of the first launch that carried this feature */
  firstRunAt?: number
  /** documents opened since firstRunAt (value-moment proxy) */
  docOpens?: number
  /** times the prompt has been displayed */
  shownCount?: number
  /** ms epoch of the last display */
  lastShownAt?: number
  /** true once the user reacted (went to GitHub / already starred) — never show again */
  resolved?: boolean
}

/** tolerate missing/corrupt settings values */
export function asStarPromptState(value: unknown): StarPromptState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
  return {
    firstRunAt: num(raw.firstRunAt),
    docOpens: num(raw.docOpens),
    shownCount: num(raw.shownCount),
    lastShownAt: num(raw.lastShownAt),
    resolved: raw.resolved === true,
  }
}

/** app startup: stamp the install-age clock once */
export function withFirstRun(state: StarPromptState, now: number): StarPromptState {
  if (state.firstRunAt !== undefined) return state
  return { ...state, firstRunAt: now }
}

/**
 * A document was opened — counts toward the value-moment threshold, and past
 * it: the prompt copy personalizes with the real count ("you've opened N
 * documents"). Stops once no prompt can ever show again.
 */
export function withDocOpen(state: StarPromptState): StarPromptState {
  if (state.resolved || (state.shownCount ?? 0) >= MAX_SHOWS) return state
  return { ...state, docOpens: (state.docOpens ?? 0) + 1 }
}

export function shouldShowStarPrompt(state: StarPromptState, now: number): boolean {
  if (state.resolved) return false
  const shown = state.shownCount ?? 0
  if (shown >= MAX_SHOWS) return false
  if (state.firstRunAt === undefined || now - state.firstRunAt < MIN_AGE_MS) return false
  if ((state.docOpens ?? 0) < MIN_DOC_OPENS) return false
  if (shown > 0 && now - (state.lastShownAt ?? 0) < RESHOW_AFTER_MS) return false
  return true
}

/**
 * Whether this launch is the first one after an upgrade. Installs from before
 * version tracking have no recorded version; if such an install has already
 * completed onboarding it is an existing user upgrading into this feature —
 * treat that as an upgrade too. Fresh installs (no version, no onboarding)
 * are not upgrades: they go through the regular value-moment gates.
 */
export function isUpgradeLaunch(
  prevVersion: string | null,
  currentVersion: string,
  onboardingSeen: boolean,
): boolean {
  if (prevVersion !== null) return prevVersion !== currentVersion
  return onboardingSeen
}

/**
 * An upgrade launch skips the install-age / doc-open gates: the user is a
 * proven repeat user and just received new features. Only for someone who has
 * never seen the prompt, and only once per session (caller clears its flag).
 */
export function shouldShowUpgradeStarPrompt(state: StarPromptState): boolean {
  return !state.resolved && (state.shownCount ?? 0) === 0
}

/** the prompt was displayed (counted whether or not the user reacts) */
export function withShown(state: StarPromptState, now: number): StarPromptState {
  return { ...state, shownCount: (state.shownCount ?? 0) + 1, lastShownAt: now }
}

/** the user reacted (opened the repo page or said "already starred") */
export function withResolved(state: StarPromptState): StarPromptState {
  return { ...state, resolved: true }
}

export function isStarPromptAction(value: unknown): value is 'starred' | 'later' {
  return value === 'starred' || value === 'later'
}

// ---- IPC-facing controller ----

export interface StarPromptDeps {
  readState(): StarPromptState
  writeState(state: StarPromptState): void
  /** one home-screen prompt per session, shared with the default-app prompt */
  slot: HomePromptSlot
  now(): number
  /** returns (and clears) the "first launch after an upgrade" flag */
  takeUpgradeLaunch(): boolean
  /** dev preview: show without the value gates and without recording anything */
  forcePreview?: boolean
}

export interface StarPromptController {
  /** decided once per session; show:true is already counted as shown */
  shouldShow(): StarPromptShow
  /** the user reacted; unknown actions are ignored */
  action(action: unknown): void
}

export function createStarPromptController(deps: StarPromptDeps): StarPromptController {
  /** a granted show, cached for the session: repeated queries (React StrictMode
   * double-effects, AppFrame remounts) must return the same answer instead of
   * burning another lifetime show or flipping to a snoozed "false" */
  let grant: StarPromptShow | null = null

  return {
    shouldShow() {
      if (grant) return grant
      const now = deps.now()
      const state = deps.readState()
      const docOpens = state.docOpens ?? 0
      // another home-screen prompt (the default-app prompt) displayed this
      // session: the invitation waits for a later session
      if (!deps.slot.available('star')) return { show: false, docOpens }
      if (deps.forcePreview) return { show: true, docOpens }
      const granted = (): StarPromptShow => {
        deps.writeState(withShown(state, now))
        deps.slot.claim('star')
        grant = { show: true, docOpens }
        return grant
      }
      // first launch after an upgrade: skip the value gates once for a
      // never-prompted user (they are a proven repeat user already)
      if (deps.takeUpgradeLaunch() && shouldShowUpgradeStarPrompt(state)) return granted()
      if (!shouldShowStarPrompt(state, now)) return { show: false, docOpens }
      return granted()
    },

    action(action) {
      if (!isStarPromptAction(action)) return
      // the card was reacted to — drop the session grant so a later query (new
      // shell window on macOS) re-evaluates the real rules (snooze / resolved)
      grant = null
      // 'later' needs no write: the display was already counted by the query
      if (action === 'starred') deps.writeState(withResolved(deps.readState()))
    },
  }
}
