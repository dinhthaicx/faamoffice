import { useEffect, useRef, useState } from 'react'
import type { AnnouncementView } from '../../shared/home-api'
import { AnnouncementDialog } from './AnnouncementDialog'
import { DefaultAppPromptCard } from './DefaultAppPromptCard'
import { Home } from './Home'
import { pickHomePrompt, type HomePrompt } from './home-prompt'
import { Onboarding } from './Onboarding'
import { StarPromptCard } from './StarPromptCard'
import { TabBar } from './TabBar'

interface AppFrameProps {
  /** resolved before first paint (main.tsx) so home never flashes under the overlay */
  initialOnboardingSeen: boolean
}

export function AppFrame({ initialOnboardingSeen }: AppFrameProps) {
  const [homeActive, setHomeActive] = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(!initialOnboardingSeen)
  const [prompt, setPrompt] = useState<HomePrompt | null>(null)
  /** announcements still to show this session, in display order */
  const [announcements, setAnnouncements] = useState<AnnouncementView[]>([])
  /** how many announcements this session has, closed ones included (the
   * dialog's "2 / 3" counter; the dialog itself unmounts off Home) */
  const [announcementTotal, setAnnouncementTotal] = useState(0)
  /** the announcement query has answered (or failed): prompt cards may show */
  const [announcementsSettled, setAnnouncementsSettled] = useState(false)

  useEffect(() => {
    const applyTabs = (tabs: Awaited<ReturnType<typeof window.aiOfficeTabs.list>>) => {
      const active = tabs.find((tab) => tab.active)
      setHomeActive(!active || active.kind === 'home')
    }
    void window.aiOfficeTabs.list().then(applyTabs)
    return window.aiOfficeTabs.onChanged(applyTabs)
  }, [])

  // Announcements from the account server: fetched once per session by the
  // main process (a repeated query returns the ones not yet closed), never
  // while onboarding is up. A failed or missing query just means none.
  useEffect(() => {
    if (showOnboarding) return
    let alive = true
    const settle = (list: AnnouncementView[]) => {
      if (!alive) return
      setAnnouncements(list)
      setAnnouncementTotal(list.length)
      setAnnouncementsSettled(true)
    }
    Promise.resolve()
      .then(() => window.aiOffice.announcementsPending())
      .then(settle, () => settle([]))
    return () => {
      alive = false
    }
  }, [showOnboarding])

  const announcementVisible = announcements.length > 0 && !showOnboarding && homeActive
  // The automatic update card is its own window above this one, so it would
  // cover onboarding and the announcement dialog: it waits until both are
  // done (announcements still queued for Home count as well).
  const updatePromptBlocked = showOnboarding || !announcementsSettled || announcements.length > 0
  useEffect(() => {
    void window.aiOffice.setUpdatePromptBlocked?.(updatePromptBlocked).catch(() => undefined)
  }, [updatePromptBlocked])
  // the prompt cards wait for the announcements: never both at once
  const promptMayShow =
    !showOnboarding && homeActive && announcementsSettled && announcements.length === 0

  // Home-screen prompts (default app, "star us") are decided by the main
  // process, which counts a granted one as shown right away — so only ask once
  // the card can actually display (no onboarding, no announcement, Home in
  // front). Show at most one; the default-app prompt takes precedence. An
  // answer dropped mid-flight is asked again later (main caches its grant).
  const promptAnsweredRef = useRef(false)
  useEffect(() => {
    if (!promptMayShow || promptAnsweredRef.current) return
    let alive = true
    void pickHomePrompt(window.aiOffice).then((next) => {
      if (!alive) return
      promptAnsweredRef.current = true
      if (next) setPrompt(next)
    })
    return () => {
      alive = false
    }
  }, [promptMayShow])

  const finishOnboarding = async (): Promise<boolean> => {
    try {
      const persisted = await window.aiOffice.setOnboardingSeen()
      if (!persisted) return false
      setShowOnboarding(false)
      return true
    } catch {
      return false
    }
  }

  const closePrompt = () => setPrompt(null)
  const closeAnnouncement = (id: string) =>
    setAnnouncements((list) => list.filter((announcement) => announcement.id !== id))
  const promptVisible = prompt !== null && promptMayShow

  return (
    <div className="app-frame">
      {/* inert under the announcement (aria-modal): focus and keyboard shortcuts
       * (Home's ⌘F / ⌘P focus calls) can never land behind the overlay */}
      <div className="app-frame-tabs" inert={announcementVisible}>
        <TabBar />
      </div>
      {/* docs/sheets tabs render as WebContentsView children of this window, positioned
       * by the main process to cover this area — only Home paints its own content here. */}
      <div
        className="app-frame-content"
        style={{ visibility: homeActive ? 'visible' : 'hidden' }}
        inert={announcementVisible}
      >
        <Home />
      </div>
      {/* editor WebContentsViews paint above ALL shell DOM, so the overlay only
       * renders while the home tab is active — it comes back when home does */}
      {showOnboarding && homeActive && <Onboarding onDone={finishOnboarding} />}
      {announcementVisible && (
        <AnnouncementDialog
          announcements={announcements}
          total={announcementTotal}
          onClose={closeAnnouncement}
        />
      )}
      {promptVisible && prompt.kind === 'defaultApp' && (
        <DefaultAppPromptCard status={prompt.status} onClose={closePrompt} />
      )}
      {promptVisible && prompt.kind === 'star' && (
        <StarPromptCard docOpens={prompt.docOpens} onClose={closePrompt} />
      )}
    </div>
  )
}
