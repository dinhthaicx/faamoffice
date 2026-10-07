import { useEffect, useId, useRef, useState } from 'react'
import type { AnnouncementLevel, AnnouncementView } from '../../shared/home-api'
import { useI18n, type StringKey } from './locale'
import './announcement-dialog.css'

/**
 * Announcements published by the super admin on the FaamOffice account
 * server, shown over the home screen at startup (see main/announcements.ts).
 * A centered modal; several announcements show one after another — the
 * parent passes the ones still to show and drops each one once it closes.
 *
 * Everything displayed was prepared by the main process: plain-text bodies,
 * images as verified data: URLs, html announcements as a same-origin page in
 * a sandboxed iframe (no scripts, opaque origin), and links opened by id.
 */

/** an html announcement that has not loaded by then shows the failed state */
export const HTML_LOAD_TIMEOUT_MS = 15000

/** permissions of the html announcement's iframe: links may open (in the system
 * browser, via the main process); scripts and the page's own origin never apply */
export const ANNOUNCEMENT_FRAME_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox'

const LEVEL_KEYS: Record<AnnouncementLevel, StringKey> = {
  info: 'announcementLevelInfo',
  warning: 'announcementLevelWarning',
  critical: 'announcementLevelCritical',
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], iframe'

interface AnnouncementDialogProps {
  /** announcements still to show, in display order; the first one is open */
  announcements: AnnouncementView[]
  /** the open announcement was closed (its action is already reported) */
  onClose: (id: string) => void
}

export function AnnouncementDialog({ announcements, onClose }: AnnouncementDialogProps) {
  // where focus was before the first announcement opened, read while rendering —
  // before the parent makes the background inert — and handed back when they close
  const [returnFocus] = useState(() => document.activeElement)
  const current = announcements[0]
  if (!current) return null
  // keyed: each announcement starts with fresh checkbox / frame state and focus
  return (
    <AnnouncementCard
      key={current.id}
      announcement={current}
      onClose={onClose}
      returnFocus={returnFocus}
    />
  )
}

function LevelIcon({ level }: { level: AnnouncementLevel }) {
  if (level === 'info') {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 7.2v4M8 4.8v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={
          level === 'warning'
            ? 'M8 1.8 14.8 13.8H1.2z'
            : 'M5.2 1.5h5.6l3.7 3.7v5.6l-3.7 3.7H5.2l-3.7-3.7V5.2z'
        }
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M8 5.6v3.8M8 11.4v.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

type FrameState = 'loading' | 'ready' | 'failed'

interface AnnouncementCardProps {
  announcement: AnnouncementView
  onClose: (id: string) => void
  /** focus goes back here once the dialog closes */
  returnFocus: Element | null
}

/** the card's tab stops, in order; the html page counts only once it shows
 * (while loading or failed it is hidden, and a hidden iframe takes no focus) */
function focusablesIn(card: HTMLElement | null): HTMLElement[] {
  if (!card) return []
  return Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !(el instanceof HTMLIFrameElement) ||
      el.closest('.announcement-frame')?.getAttribute('data-state') === 'ready',
  )
}

function AnnouncementCard({ announcement, onClose, returnFocus }: AnnouncementCardProps) {
  const { t } = useI18n()
  const { id, kind, level, displayMode, title, body, image, htmlUrl, link } = announcement
  const titleId = useId()
  const bodyId = useId()
  const badgeId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [dontShow, setDontShow] = useState(false)
  const [frame, setFrame] = useState<FrameState>('loading')

  // read through refs so the window key listener never goes stale
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const dontShowRef = useRef(dontShow)
  dontShowRef.current = dontShow
  const closedRef = useRef(false)

  const close = () => {
    if (closedRef.current) return
    closedRef.current = true
    const dismiss = displayMode === 'until_dismissed' && dontShowRef.current
    void window.aiOffice.announcementAction(id, dismiss ? 'dismiss' : 'close').catch(() => {})
    onCloseRef.current(id)
  }
  const closeRef = useRef(close)
  closeRef.current = close

  // displayed: a `once` announcement is now seen (repeat reports are harmless)
  useEffect(() => {
    void window.aiOffice.announcementAction(id, 'shown').catch(() => {})
  }, [id])

  // move focus into the dialog (the card itself, so no focus ring shows on
  // open) and hand it back to where it was once the dialog goes away (a no-op
  // while the background is still inert: the next announcement takes over)
  useEffect(() => {
    const card = cardRef.current
    card?.focus()
    return () => {
      const active = document.activeElement
      const inside = !active || active === document.body || !!card?.contains(active)
      if (inside && returnFocus instanceof HTMLElement && returnFocus.isConnected) {
        returnFocus.focus()
      }
    }
  }, [returnFocus])

  // Escape closes; Tab cycles inside the dialog (aria-modal). Capture phase and
  // stopPropagation: the UI behind the modal (Settings, Home's menus) never
  // sees these keys, so one Escape closes only the announcement.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      event.stopPropagation()
      const focusables = focusablesIn(cardRef.current)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      const onControl = active instanceof HTMLElement && focusables.includes(active)
      if (!onControl) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Escape inside the html page: its key events stay in the (cross-origin)
  // frame, so the main process reports it. Only acted on while focus is in this
  // dialog's frame — anywhere else the listener above already handled it.
  useEffect(() => {
    if (kind !== 'html' || typeof window.aiOffice.onAnnouncementEscape !== 'function') return
    return window.aiOffice.onAnnouncementEscape(() => {
      const frameEl = frameRef.current
      if (frameEl && document.activeElement === frameEl) closeRef.current()
    })
  }, [kind])

  // the page failed to load (network error, blocked frame, HTTP error page): the
  // iframe's load event fires for those too, so the main process reports them
  useEffect(() => {
    if (kind !== 'html' || typeof window.aiOffice.onAnnouncementFrameFailed !== 'function') return
    return window.aiOffice.onAnnouncementFrameFailed((failedId) => {
      if (failedId === id) setFrame('failed')
    })
  }, [id, kind])

  // a page that never finishes loading (offline, server down) gets the failed state
  useEffect(() => {
    if (kind !== 'html') return
    const timer = window.setTimeout(
      () => setFrame((state) => (state === 'loading' ? 'failed' : state)),
      HTML_LOAD_TIMEOUT_MS,
    )
    return () => window.clearTimeout(timer)
  }, [kind])

  const openLink = () => {
    void window.aiOffice.openAnnouncementLink(id).catch(() => {})
  }

  // focus guards: Tab out of the html page (whose key events the listener above
  // never sees) lands on one of these and wraps back into the dialog
  const wrapTo = (edge: 'first' | 'last') => {
    const focusables = focusablesIn(cardRef.current)
    const target = edge === 'first' ? focusables[0] : focusables[focusables.length - 1]
    ;(target ?? cardRef.current)?.focus()
  }

  const showFrame = kind === 'html' && !!htmlUrl
  const showFooter = !!link || displayMode === 'until_dismissed'

  return (
    <div className="announcement-overlay">
      <div
        className={`announcement-dialog${showFrame ? ' is-html' : ''}`}
        data-level={level}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${badgeId} ${titleId}`}
        aria-describedby={kind === 'rich' && body ? bodyId : undefined}
        tabIndex={-1}
        ref={cardRef}
      >
        <span
          className="announcement-focus-guard"
          tabIndex={0}
          aria-hidden="true"
          onFocus={() => wrapTo('last')}
        />
        <button className="announcement-close" aria-label={t('announcementClose')} onClick={close}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2 2l8 8M10 2L2 10"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {kind === 'rich' && image && <img className="announcement-image" src={image} alt="" />}
        <div className="announcement-content">
          <span className="announcement-badge" id={badgeId}>
            <LevelIcon level={level} />
            {t(LEVEL_KEYS[level])}
          </span>
          <h2 className="announcement-title" id={titleId}>
            {title}
          </h2>
          {kind === 'rich' && body && (
            <p className="announcement-body" id={bodyId}>
              {body}
            </p>
          )}
          {showFrame && (
            <div className="announcement-frame" data-state={frame}>
              <iframe
                ref={frameRef}
                src={htmlUrl}
                title={title}
                sandbox={ANNOUNCEMENT_FRAME_SANDBOX}
                referrerPolicy="no-referrer"
                // a failure reported by the main process may arrive before the load event
                onLoad={() => setFrame((state) => (state === 'loading' ? 'ready' : state))}
              />
              {frame === 'loading' && (
                <p className="announcement-frame-status" role="status">
                  {t('announcementLoading')}
                </p>
              )}
              {frame === 'failed' && (
                <p className="announcement-frame-status is-error" role="alert">
                  {t('announcementLoadFailed')}
                </p>
              )}
            </div>
          )}
        </div>
        {showFooter && (
          <div className="announcement-footer">
            {displayMode === 'until_dismissed' && (
              <label className="announcement-dont-show">
                <input
                  type="checkbox"
                  checked={dontShow}
                  onChange={(event) => setDontShow(event.target.checked)}
                />
                {t('announcementDontShowAgain')}
              </label>
            )}
            {link && (
              <button className="announcement-link" onClick={openLink}>
                {link.label || t('announcementLinkFallback')}
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M3.5 8.5 8.5 3.5M4.5 3.5h4v4"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        )}
        <span
          className="announcement-focus-guard"
          tabIndex={0}
          aria-hidden="true"
          onFocus={() => wrapTo('first')}
        />
      </div>
    </div>
  )
}
