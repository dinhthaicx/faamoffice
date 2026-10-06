import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultAppPromptController,
  createHomePromptSlot,
  type HomePromptSlot,
} from '../src/main/default-app-prompt'
import { pickHomePrompt } from '../src/renderer/src/home-prompt'
import type { DefaultAppStatus } from '../src/shared/home-api'
import {
  MAX_SHOWS,
  MIN_AGE_MS,
  MIN_DOC_OPENS,
  RESHOW_AFTER_MS,
  asStarPromptState,
  createStarPromptController,
  isStarPromptAction,
  isUpgradeLaunch,
  shouldShowStarPrompt,
  shouldShowUpgradeStarPrompt,
  withDocOpen,
  withFirstRun,
  withResolved,
  withShown,
  type StarPromptState,
} from '../src/main/star-prompt'

const NOW = 1_700_000_000_000

/** a state that satisfies every display condition */
const eligible = () => ({
  firstRunAt: NOW - MIN_AGE_MS,
  docOpens: MIN_DOC_OPENS,
  shownCount: 0,
})

describe('asStarPromptState', () => {
  it('returns empty state for missing or corrupt values', () => {
    expect(asStarPromptState(undefined)).toEqual({})
    expect(asStarPromptState('garbage')).toEqual({})
    expect(asStarPromptState([1, 2])).toEqual({})
    expect(asStarPromptState(null)).toEqual({})
  })

  it('drops non-numeric and negative fields', () => {
    const state = asStarPromptState({
      firstRunAt: 'soon',
      docOpens: -3,
      shownCount: 1,
      lastShownAt: Number.NaN,
      resolved: 'yes',
    })
    expect(state).toEqual({
      firstRunAt: undefined,
      docOpens: undefined,
      shownCount: 1,
      lastShownAt: undefined,
      resolved: false,
    })
  })
})

describe('shouldShowStarPrompt', () => {
  it('shows once every condition is met', () => {
    expect(shouldShowStarPrompt(eligible(), NOW)).toBe(true)
  })

  it('never shows before the install-age threshold', () => {
    expect(shouldShowStarPrompt({ ...eligible(), firstRunAt: NOW - MIN_AGE_MS + 1 }, NOW)).toBe(
      false,
    )
  })

  it('never shows without the first-run stamp', () => {
    expect(shouldShowStarPrompt({ ...eligible(), firstRunAt: undefined }, NOW)).toBe(false)
  })

  it('never shows below the doc-open threshold', () => {
    expect(shouldShowStarPrompt({ ...eligible(), docOpens: MIN_DOC_OPENS - 1 }, NOW)).toBe(false)
  })

  it('never shows once resolved', () => {
    expect(shouldShowStarPrompt({ ...eligible(), resolved: true }, NOW)).toBe(false)
  })

  it('respects the snooze window after a dismissal', () => {
    const dismissed = withShown(eligible(), NOW - RESHOW_AFTER_MS + 1)
    expect(shouldShowStarPrompt(dismissed, NOW)).toBe(false)
    const longAgo = withShown(eligible(), NOW - RESHOW_AFTER_MS)
    expect(shouldShowStarPrompt(longAgo, NOW)).toBe(true)
  })

  it('caps at the lifetime maximum', () => {
    let state = eligible()
    for (let i = 0; i < MAX_SHOWS; i++) {
      state = withShown(state, NOW - (MAX_SHOWS - i) * RESHOW_AFTER_MS)
    }
    expect(state.shownCount).toBe(MAX_SHOWS)
    expect(shouldShowStarPrompt(state, NOW)).toBe(false)
  })
})

describe('isUpgradeLaunch', () => {
  it('detects a version change', () => {
    expect(isUpgradeLaunch('1.2.0', '1.3.0', true)).toBe(true)
    expect(isUpgradeLaunch('1.3.0', '1.3.0', true)).toBe(false)
  })

  it('treats a pre-tracking install that finished onboarding as an upgrade', () => {
    expect(isUpgradeLaunch(null, '1.3.0', true)).toBe(true)
  })

  it('does not treat a fresh install as an upgrade', () => {
    expect(isUpgradeLaunch(null, '1.3.0', false)).toBe(false)
  })
})

describe('shouldShowUpgradeStarPrompt', () => {
  it('shows for a never-prompted, unresolved user regardless of value gates', () => {
    expect(shouldShowUpgradeStarPrompt({})).toBe(true)
    expect(shouldShowUpgradeStarPrompt({ firstRunAt: NOW, docOpens: 0 })).toBe(true)
  })

  it('never shows once prompted or resolved', () => {
    expect(shouldShowUpgradeStarPrompt(withShown({}, NOW))).toBe(false)
    expect(shouldShowUpgradeStarPrompt(withResolved({}))).toBe(false)
  })
})

describe('transitions', () => {
  it('withFirstRun stamps only once', () => {
    const stamped = withFirstRun({}, NOW)
    expect(stamped.firstRunAt).toBe(NOW)
    expect(withFirstRun(stamped, NOW + 1)).toBe(stamped)
  })

  it('withDocOpen keeps counting past the threshold (personalized copy)', () => {
    let state: ReturnType<typeof asStarPromptState> = {}
    for (let i = 1; i <= MIN_DOC_OPENS + 3; i++) {
      state = withDocOpen(state)
      expect(state.docOpens).toBe(i)
    }
  })

  it('withDocOpen stops once no prompt can ever show again', () => {
    const resolved = { resolved: true }
    expect(withDocOpen(resolved)).toBe(resolved)
    const shownOut = { shownCount: MAX_SHOWS }
    expect(withDocOpen(shownOut)).toBe(shownOut)
  })

  it('withResolved silences the prompt for good', () => {
    const state = withResolved(eligible())
    expect(shouldShowStarPrompt(state, NOW + 365 * 24 * 60 * 60 * 1000)).toBe(false)
  })
})

function starHarness(
  opts: {
    state?: StarPromptState
    slot?: HomePromptSlot
    upgrade?: boolean
    forcePreview?: boolean
  } = {},
) {
  let stored: StarPromptState = opts.state ?? eligible()
  const writes: StarPromptState[] = []
  let upgrade = opts.upgrade ?? false
  const takeUpgradeLaunch = vi.fn(() => {
    const pending = upgrade
    upgrade = false
    return pending
  })
  const slot = opts.slot ?? createHomePromptSlot()
  const controller = createStarPromptController({
    readState: () => stored,
    writeState: (next) => {
      writes.push(next)
      stored = next
    },
    slot,
    now: () => NOW,
    takeUpgradeLaunch,
    forcePreview: opts.forcePreview,
  })
  return { controller, slot, writes, takeUpgradeLaunch, stored: () => stored }
}

describe('star prompt controller (IPC logic)', () => {
  it('grants once per session, counts the display and claims the home-prompt slot', () => {
    const h = starHarness()
    expect(h.controller.shouldShow()).toEqual({ show: true, docOpens: MIN_DOC_OPENS })
    expect(h.stored().shownCount).toBe(1)
    expect(h.stored().lastShownAt).toBe(NOW)
    expect(h.slot.available('star')).toBe(true)
    expect(h.slot.available('defaultApp')).toBe(false)
    // repeated queries (StrictMode / remount) reuse the grant without counting again
    expect(h.controller.shouldShow().show).toBe(true)
    expect(h.writes).toHaveLength(1)
  })

  it('stays out of a session whose slot the default-app prompt claimed', () => {
    const slot = createHomePromptSlot()
    slot.claim('defaultApp')
    // even an upgrade launch (which skips the value gates) must wait
    const h = starHarness({ slot, upgrade: true })
    expect(h.controller.shouldShow()).toEqual({ show: false, docOpens: MIN_DOC_OPENS })
    expect(h.writes).toHaveLength(0)
  })

  it('an upgrade launch skips the value gates once for a never-prompted user', () => {
    const h = starHarness({ state: { firstRunAt: NOW }, upgrade: true })
    expect(h.controller.shouldShow().show).toBe(true)
    expect(h.takeUpgradeLaunch).toHaveBeenCalledTimes(1)
  })

  it('without the upgrade bonus the value gates apply', () => {
    const h = starHarness({ state: { firstRunAt: NOW } })
    expect(h.controller.shouldShow()).toEqual({ show: false, docOpens: 0 })
    expect(h.writes).toHaveLength(0)
    expect(h.slot.available('defaultApp')).toBe(true)
  })

  it('the dev preview shows without recording or claiming anything', () => {
    const h = starHarness({ state: {}, forcePreview: true })
    expect(h.controller.shouldShow().show).toBe(true)
    expect(h.writes).toHaveLength(0)
    expect(h.slot.available('defaultApp')).toBe(true)
  })

  it("'starred' resolves for good, 'later' only drops the session grant", () => {
    const later = starHarness()
    later.controller.shouldShow()
    later.controller.action('later')
    // snoozed by the display just counted
    expect(later.controller.shouldShow().show).toBe(false)
    expect(later.stored().resolved).toBeUndefined()

    const starred = starHarness()
    starred.controller.shouldShow()
    starred.controller.action('starred')
    expect(starred.stored().resolved).toBe(true)
  })

  it('ignores unknown actions and keeps the grant', () => {
    const h = starHarness()
    h.controller.shouldShow()
    h.controller.action('never')
    h.controller.action(undefined)
    expect(h.writes).toHaveLength(1)
    expect(h.controller.shouldShow().show).toBe(true)
    expect(isStarPromptAction('starred')).toBe(true)
    expect(isStarPromptAction('set')).toBe(false)
  })
})

describe('one home-screen prompt per session (both controllers, one slot)', () => {
  const OTHER: DefaultAppStatus = { state: 'other', others: ['Microsoft Word'], manualOnly: false }

  function session(starOpts: { upgrade?: boolean } = {}) {
    const slot = createHomePromptSlot()
    let defaultAppState = {}
    const defaultApp = createDefaultAppPromptController({
      readState: () => defaultAppState,
      writeState: (next) => {
        defaultAppState = next
      },
      status: async () => OTHER,
      set: async () => OTHER,
      slot,
      now: () => NOW,
    })
    const star = starHarness({ slot, ...starOpts })
    const api = {
      defaultAppPromptShouldShow: () => defaultApp.shouldShow(),
      starPromptShouldShow: async () => star.controller.shouldShow(),
    }
    return { defaultApp, star, api }
  }

  it('a reopened shell window after "Later" shows no star card (macOS dock reopen)', async () => {
    const s = session({ upgrade: true })
    expect(await pickHomePrompt(s.api)).toEqual({ kind: 'defaultApp', status: OTHER })
    await s.defaultApp.action('later')
    // the window is closed and reopened: AppFrame remounts and asks again; the
    // default-app prompt is snoozed now, and the star prompt must still wait
    expect(await pickHomePrompt(s.api)).toBeNull()
    expect(s.star.writes).toHaveLength(0)
  })

  it('a star card that showed first keeps the default-app prompt out', async () => {
    const s = session()
    const slotFirst = s.star.controller.shouldShow()
    expect(slotFirst.show).toBe(true)
    expect((await s.defaultApp.shouldShow()).show).toBe(false)
  })
})
