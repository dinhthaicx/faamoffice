import { describe, expect, it, vi } from 'vitest'
import {
  MAX_SHOWS,
  RESHOW_AFTER_MS,
  asDefaultAppPromptState,
  couldShowDefaultAppPrompt,
  createDefaultAppPromptController,
  createHomePromptSlot,
  isDefaultAppPromptAction,
  shouldShowDefaultAppPrompt,
  withNever,
  withShown,
  type DefaultAppPromptState,
  type HomePromptSlot,
} from '../src/main/default-app-prompt'
import type { DefaultAppStatus } from '../src/shared/home-api'

const NOW = 1_700_000_000_000

const OTHER: DefaultAppStatus = { state: 'other', others: ['Microsoft Word'], manualOnly: false }
const DEFAULT: DefaultAppStatus = { state: 'default', others: [], manualOnly: false }
const UNKNOWN: DefaultAppStatus = { state: 'unknown', others: [], manualOnly: false }
const UNSUPPORTED: DefaultAppStatus = { state: 'unsupported', others: [], manualOnly: false }

describe('asDefaultAppPromptState', () => {
  it('returns empty state for missing or corrupt values', () => {
    expect(asDefaultAppPromptState(undefined)).toEqual({})
    expect(asDefaultAppPromptState(null)).toEqual({})
    expect(asDefaultAppPromptState('garbage')).toEqual({})
    expect(asDefaultAppPromptState(42)).toEqual({})
    expect(asDefaultAppPromptState([1, 2])).toEqual({})
  })

  it('drops non-numeric / negative fields and accepts only a literal true for never', () => {
    expect(
      asDefaultAppPromptState({
        shownCount: -1,
        lastShownAt: Number.POSITIVE_INFINITY,
        never: 'yes',
      }),
    ).toEqual({ shownCount: undefined, lastShownAt: undefined, never: false })
    expect(asDefaultAppPromptState({ shownCount: 2, lastShownAt: NOW, never: true })).toEqual({
      shownCount: 2,
      lastShownAt: NOW,
      never: true,
    })
  })

  it('a corrupt state behaves like a fresh one', () => {
    expect(shouldShowDefaultAppPrompt(asDefaultAppPromptState('???'), OTHER, NOW)).toBe(true)
  })
})

describe('shouldShowDefaultAppPrompt', () => {
  it('shows on a fresh state when another app owns the types (no install-age gate)', () => {
    expect(shouldShowDefaultAppPrompt({}, OTHER, NOW)).toBe(true)
  })

  it.each([
    ['default', DEFAULT],
    ['unknown', UNKNOWN],
    ['unsupported', UNSUPPORTED],
  ])('never shows when the status is %s', (_name, status) => {
    expect(shouldShowDefaultAppPrompt({}, status, NOW)).toBe(false)
  })

  it('shows for Windows (manual-only) when another app owns the types', () => {
    expect(shouldShowDefaultAppPrompt({}, { ...OTHER, manualOnly: true }, NOW)).toBe(true)
  })

  it('never shows after "don\'t ask again"', () => {
    expect(shouldShowDefaultAppPrompt(withNever({}), OTHER, NOW)).toBe(false)
  })

  it('respects the snooze window after a display, inclusive at the boundary', () => {
    const justInside = withShown({}, NOW - RESHOW_AFTER_MS + 1)
    expect(shouldShowDefaultAppPrompt(justInside, OTHER, NOW)).toBe(false)
    const atBoundary = withShown({}, NOW - RESHOW_AFTER_MS)
    expect(shouldShowDefaultAppPrompt(atBoundary, OTHER, NOW)).toBe(true)
    const shownNow = withShown({}, NOW)
    expect(shouldShowDefaultAppPrompt(shownNow, OTHER, NOW)).toBe(false)
  })

  it('stays quiet while the clock is behind the last display', () => {
    expect(shouldShowDefaultAppPrompt(withShown({}, NOW + 1000), OTHER, NOW)).toBe(false)
  })

  it('caps at the lifetime maximum', () => {
    let state: DefaultAppPromptState = {}
    for (let i = 0; i < MAX_SHOWS; i++) {
      expect(
        shouldShowDefaultAppPrompt(state, OTHER, NOW - (MAX_SHOWS - i) * RESHOW_AFTER_MS),
      ).toBe(true)
      state = withShown(state, NOW - (MAX_SHOWS - i) * RESHOW_AFTER_MS)
    }
    expect(state.shownCount).toBe(MAX_SHOWS)
    expect(shouldShowDefaultAppPrompt(state, OTHER, NOW + 365 * RESHOW_AFTER_MS)).toBe(false)
  })

  it('MAX_SHOWS is 3 and the snooze is 7 days', () => {
    expect(MAX_SHOWS).toBe(3)
    expect(RESHOW_AFTER_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('couldShowDefaultAppPrompt mirrors the status-independent gates', () => {
    expect(couldShowDefaultAppPrompt({}, NOW)).toBe(true)
    expect(couldShowDefaultAppPrompt({ never: true }, NOW)).toBe(false)
    expect(couldShowDefaultAppPrompt({ shownCount: MAX_SHOWS, lastShownAt: 0 }, NOW)).toBe(false)
    expect(couldShowDefaultAppPrompt({ shownCount: 1, lastShownAt: NOW - 1 }, NOW)).toBe(false)
  })
})

describe('transitions', () => {
  it('withShown counts and stamps', () => {
    const once = withShown({}, NOW)
    expect(once).toEqual({ shownCount: 1, lastShownAt: NOW })
    expect(withShown(once, NOW + 5)).toEqual({ shownCount: 2, lastShownAt: NOW + 5 })
  })

  it('withNever keeps the counters', () => {
    expect(withNever({ shownCount: 2, lastShownAt: NOW })).toEqual({
      shownCount: 2,
      lastShownAt: NOW,
      never: true,
    })
  })

  it('isDefaultAppPromptAction accepts only the three actions', () => {
    expect(['set', 'later', 'never'].every(isDefaultAppPromptAction)).toBe(true)
    for (const bad of ['SET', 'starred', '', null, undefined, 1, {}]) {
      expect(isDefaultAppPromptAction(bad)).toBe(false)
    }
  })
})

describe('createHomePromptSlot', () => {
  it('the first prompt to claim keeps the slot for the session', () => {
    const slot = createHomePromptSlot()
    expect(slot.available('defaultApp')).toBe(true)
    expect(slot.available('star')).toBe(true)
    slot.claim('defaultApp')
    expect(slot.available('defaultApp')).toBe(true)
    expect(slot.available('star')).toBe(false)
    slot.claim('star')
    expect(slot.available('star')).toBe(false)
  })
})

function harness(
  opts: {
    state?: DefaultAppPromptState
    status?: () => Promise<DefaultAppStatus>
    set?: () => Promise<DefaultAppStatus>
    slot?: HomePromptSlot
    writeThrows?: boolean
  } = {},
) {
  let stored: DefaultAppPromptState = opts.state ?? {}
  const writes: DefaultAppPromptState[] = []
  const status = vi.fn(opts.status ?? (async () => OTHER))
  const set = vi.fn(opts.set ?? (async () => DEFAULT))
  const slot = opts.slot ?? createHomePromptSlot()
  const controller = createDefaultAppPromptController({
    readState: () => stored,
    writeState: (next) => {
      if (opts.writeThrows) throw new Error('EACCES')
      writes.push(next)
      stored = next
    },
    status,
    set,
    slot,
    now: () => NOW,
  })
  return { controller, status, set, slot, writes, stored: () => stored }
}

describe('default-app prompt controller (IPC logic)', () => {
  it('grants once per session and counts the display', async () => {
    const h = harness()
    const first = await h.controller.shouldShow()
    expect(first).toEqual({ show: true, status: OTHER })
    expect(h.stored()).toEqual({ shownCount: 1, lastShownAt: NOW })
    // repeated queries (StrictMode / remount) reuse the grant without counting again
    expect(await h.controller.shouldShow()).toEqual(first)
    expect(h.writes).toHaveLength(1)
    expect(h.status).toHaveBeenCalledTimes(1)
  })

  it('concurrent queries share one evaluation', async () => {
    const h = harness()
    const [a, b] = await Promise.all([h.controller.shouldShow(), h.controller.shouldShow()])
    expect(a.show).toBe(true)
    expect(b.show).toBe(true)
    expect(h.writes).toHaveLength(1)
  })

  it('does not show (or count) when FaamOffice is already the default', async () => {
    const h = harness({ status: async () => DEFAULT })
    expect(await h.controller.shouldShow()).toEqual({ show: false, status: DEFAULT })
    expect(h.writes).toHaveLength(0)
    expect(h.slot.available('star')).toBe(true)
  })

  it('skips the status probe when a status-independent gate already says no', async () => {
    const h = harness({ state: { never: true } })
    expect((await h.controller.shouldShow()).show).toBe(false)
    expect(h.status).not.toHaveBeenCalled()
  })

  it('never throws: probe failures and unwritable settings mean show:false', async () => {
    const probeFails = harness({
      status: async () => {
        throw new Error('osascript failed')
      },
    })
    expect((await probeFails.controller.shouldShow()).show).toBe(false)

    const unwritable = harness({ writeThrows: true })
    expect((await unwritable.controller.shouldShow()).show).toBe(false)
    expect(unwritable.slot.available('star')).toBe(true)
  })

  it('a shown default-app prompt keeps the star prompt out of this session', async () => {
    const h = harness()
    await h.controller.shouldShow()
    expect(h.slot.available('star')).toBe(false)
    // reacting to the card does not free the slot
    await h.controller.action('later')
    expect(h.slot.available('star')).toBe(false)
  })

  it('yields to a star prompt that already showed this session', async () => {
    const slot = createHomePromptSlot()
    slot.claim('star')
    const h = harness({ slot })
    expect((await h.controller.shouldShow()).show).toBe(false)
    expect(h.status).not.toHaveBeenCalled()
    expect(h.writes).toHaveLength(0)
  })

  it("'set' claims the types and returns the resulting status", async () => {
    const h = harness()
    await h.controller.shouldShow()
    expect(await h.controller.action('set')).toEqual(DEFAULT)
    expect(h.set).toHaveBeenCalledTimes(1)
  })

  it("'never' persists, 'later' only keeps the snooze stamp", async () => {
    const later = harness()
    await later.controller.shouldShow()
    await later.controller.action('later')
    expect(later.stored()).toEqual({ shownCount: 1, lastShownAt: NOW })

    const never = harness()
    await never.controller.shouldShow()
    await never.controller.action('never')
    expect(never.stored()).toEqual({ shownCount: 1, lastShownAt: NOW, never: true })
  })

  it('any action clears the session grant so the real rules apply again', async () => {
    const h = harness()
    await h.controller.shouldShow()
    await h.controller.action('later')
    // snoozed by the display just counted
    expect((await h.controller.shouldShow()).show).toBe(false)
    expect(h.writes).toHaveLength(1)
  })

  it('rejects invalid actions without touching state', async () => {
    const h = harness()
    await h.controller.shouldShow()
    await expect(h.controller.action('starred')).rejects.toThrow(/Invalid/)
    await expect(h.controller.action(undefined)).rejects.toThrow(/Invalid/)
    expect(h.set).not.toHaveBeenCalled()
    // the grant survives an invalid action
    expect((await h.controller.shouldShow()).show).toBe(true)
  })
})
