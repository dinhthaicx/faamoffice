import { useEffect, useState } from 'react'
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

  useEffect(() => {
    const applyTabs = (tabs: Awaited<ReturnType<typeof window.aiOfficeTabs.list>>) => {
      const active = tabs.find((tab) => tab.active)
      setHomeActive(!active || active.kind === 'home')
    }
    void window.aiOfficeTabs.list().then(applyTabs)
    return window.aiOfficeTabs.onChanged(applyTabs)
  }, [])

  // Home-screen prompts (default app, "star us") are decided (and counted as
  // shown) by the main process; ask once per session, never while onboarding
  // is up, and show at most one — the default-app prompt takes precedence.
  useEffect(() => {
    if (showOnboarding) return
    let alive = true
    void pickHomePrompt(window.aiOffice).then((next) => {
      if (alive && next) setPrompt(next)
    })
    return () => {
      alive = false
    }
  }, [showOnboarding])

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
  const promptVisible = prompt !== null && !showOnboarding && homeActive

  return (
    <div className="app-frame">
      <TabBar />
      {/* docs/sheets tabs render as WebContentsView children of this window, positioned
       * by the main process to cover this area — only Home paints its own content here. */}
      <div className="app-frame-content" style={{ visibility: homeActive ? 'visible' : 'hidden' }}>
        <Home />
      </div>
      {/* editor WebContentsViews paint above ALL shell DOM, so the overlay only
       * renders while the home tab is active — it comes back when home does */}
      {showOnboarding && homeActive && <Onboarding onDone={finishOnboarding} />}
      {promptVisible && prompt.kind === 'defaultApp' && (
        <DefaultAppPromptCard status={prompt.status} onClose={closePrompt} />
      )}
      {promptVisible && prompt.kind === 'star' && (
        <StarPromptCard docOpens={prompt.docOpens} onClose={closePrompt} />
      )}
    </div>
  )
}
