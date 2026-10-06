import { useEffect, useRef, useState } from 'react'
import type { DefaultAppPromptAction, DefaultAppStatus } from '../../shared/home-api'
import { formatList, useI18n, type StringKey } from './locale'
import './star-prompt.css'
import './default-app-prompt.css'

/**
 * "Open Office files with FaamOffice?" — offered over the home screen when
 * the main process sees another app owning the Office types (see
 * main/default-app-prompt.ts). Non-modal: a small bottom-right card that
 * never blocks work; shares the star invitation's card styling.
 */

/** success line stays this long before the card closes itself */
export const SUCCESS_CLOSE_MS = 1500
/** Windows follow-up stays a little longer: the user is switching to Settings */
export const WINDOWS_CLOSE_MS = 4000

type Phase =
  /** asking (initial) */
  | 'ask'
  /** set() in flight */
  | 'busy'
  /** claimed (mac/linux) — closes after SUCCESS_CLOSE_MS */
  | 'done'
  /** Windows Default apps page opened — closes after WINDOWS_CLOSE_MS */
  | 'windows'
  /** the claim did not stick; retry / later stay available */
  | 'failed'

interface DefaultAppPromptCardProps {
  /** live ownership from the main process's prompt decision */
  status: DefaultAppStatus
  /** called once the card is done, whatever the reaction — unmounts it */
  onClose: () => void
}

function DocumentIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 14.5l2 2 4-4" />
    </svg>
  )
}

export function DefaultAppPromptCard({ status, onClose }: DefaultAppPromptCardProps) {
  const { t, dateLocale } = useI18n()
  const [phase, setPhase] = useState<Phase>('ask')
  const manualOnly = status.manualOnly

  // read through a ref so the parent's inline callback never restarts the close timer
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  // the phase as of the last render, for the unmount cleanup
  const phaseRef = useRef<Phase>(phase)
  phaseRef.current = phase
  const closedRef = useRef(false)
  /** report the card as done exactly once, whichever path gets there first */
  const finish = () => {
    if (closedRef.current) return
    closedRef.current = true
    onCloseRef.current()
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  const cardRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  /** keyboard focus was in the card when "set" was pressed */
  const focusInCardRef = useRef(false)

  useEffect(() => {
    if (phase !== 'done' && phase !== 'windows') return
    const timer = window.setTimeout(
      () => finishRef.current(),
      phase === 'done' ? SUCCESS_CLOSE_MS : WINDOWS_CLOSE_MS,
    )
    return () => {
      window.clearTimeout(timer)
      // unmounted early (user left the Home tab): the prompt is settled anyway,
      // so it must not come back in the ask state
      finishRef.current()
    }
  }, [phase])

  // Unmounted (user left the Home tab) after "set" was sent: main has already
  // acted and dropped its grant, so a remount must not ask again with the stale
  // owner line — treat the prompt as settled. StrictMode's mount/cleanup cycle
  // runs in 'ask' and is unaffected.
  useEffect(
    () => () => {
      if (phaseRef.current === 'busy' || phaseRef.current === 'failed') finishRef.current()
    },
    [],
  )

  // The focused primary button is disabled while busy and removed once settled;
  // keep keyboard focus in the card instead of letting it fall to <body>.
  useEffect(() => {
    if (phase === 'ask' || phase === 'busy' || !focusInCardRef.current) return
    focusInCardRef.current = false
    const active = document.activeElement
    const lost = !active || active === document.body || !!cardRef.current?.contains(active)
    if (!lost) return
    ;(phase === 'failed' ? primaryRef : closeButtonRef).current?.focus()
  }, [phase])

  const send = (action: DefaultAppPromptAction) => window.aiOffice.defaultAppPromptAction(action)

  const dismiss = (action: 'later' | 'never') => {
    void send(action).catch(() => {})
    finish()
  }

  const close = () => {
    // a settled prompt (claimed / Settings opened) has nothing left to snooze
    if (phase === 'done' || phase === 'windows') finish()
    else dismiss('later')
  }

  const claim = () => {
    const active = document.activeElement
    focusInCardRef.current = !!active && !!cardRef.current?.contains(active)
    setPhase('busy')
    send('set').then(
      (next) => {
        if (next.state === 'default') setPhase('done')
        else if (manualOnly || next.manualOnly) setPhase('windows')
        else setPhase('failed')
      },
      () => setPhase('failed'),
    )
  }

  const title = t('defaultAppPromptTitle')
  const settled = phase === 'done' || phase === 'windows'
  const okKey: StringKey | null =
    phase === 'done'
      ? 'defaultAppPromptDone'
      : phase === 'windows'
        ? 'defaultAppPromptWinFollowUp'
        : null

  return (
    <div className="star-prompt default-app-prompt" role="dialog" aria-label={title} ref={cardRef}>
      <button
        className="star-prompt-close"
        aria-label={t('defaultAppPromptClose')}
        onClick={close}
        ref={closeButtonRef}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2 2l8 8M10 2L2 10"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div className="star-prompt-head">
        <span className="star-prompt-icon">
          <DocumentIcon />
        </span>
        <h3 className="star-prompt-title">{title}</h3>
      </div>
      <p className="star-prompt-body">{t('defaultAppPromptBody')}</p>
      {/* Windows reports ProgId descriptions ("Microsoft Word Document"), not
       * app names, so the owner line is only shown where names are real */}
      {status.others.length > 0 && !manualOnly && !settled && (
        <p className="default-app-prompt-meta">
          {t('defaultAppPromptCurrent', { apps: formatList(dateLocale, status.others) })}
        </p>
      )}
      {manualOnly && !settled && (
        <p className="default-app-prompt-meta">{t('defaultAppPromptWinNote')}</p>
      )}
      {/* live regions stay mounted so screen readers announce the text that
       * arrives in them (a region inserted with its content is often skipped) */}
      <p className="default-app-prompt-status is-ok" role="status">
        {okKey ? t(okKey) : ''}
      </p>
      <p className="default-app-prompt-status is-error" role="alert">
        {phase === 'failed' ? t('defaultAppPromptFailed') : ''}
      </p>
      {!settled && (
        <div className="star-prompt-actions default-app-prompt-actions">
          <button
            className="star-prompt-go"
            disabled={phase === 'busy'}
            aria-busy={phase === 'busy'}
            onClick={claim}
            ref={primaryRef}
          >
            {manualOnly ? t('defaultAppPromptOpenSettings') : t('defaultAppPromptSet')}
          </button>
          <button className="star-prompt-done" onClick={() => dismiss('later')}>
            {t('defaultAppPromptLater')}
          </button>
          <button className="default-app-prompt-never" onClick={() => dismiss('never')}>
            {t('defaultAppPromptNever')}
          </button>
        </div>
      )}
    </div>
  )
}
