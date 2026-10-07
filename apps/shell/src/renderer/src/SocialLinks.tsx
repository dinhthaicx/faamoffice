import { useEffect, useState } from 'react'
import type { SocialLinkView } from '../../shared/home-api'
import { useI18n } from './locale'
import type { TFunc } from './locale'
import { SOCIAL_PLATFORM_NAMES, SocialIcon } from './social-icons'

/** "Follow on YouTube", or "Visit the website" for the website link */
function socialAction(link: SocialLinkView, t: TFunc): string {
  return link.platform === 'website'
    ? t('socialOpenWebsite')
    : t('socialFollowOn', { platform: SOCIAL_PLATFORM_NAMES[link.platform] })
}

/** the accessible name: the action plus the admin's caption when set */
export function socialLinkTitle(link: SocialLinkView, t: TFunc): string {
  const action = socialAction(link, t)
  return link.label ? `${action} — ${link.label}` : action
}

/**
 * Follow buttons for the project's channels, right above Settings in the Home
 * sidebar. The list comes from the account server's admin settings through
 * the main process (cached there, so it shows at once and offline); a click
 * asks the main process to open the channel by id. Nothing renders while the
 * list is empty.
 */
export function SocialLinks() {
  const { t } = useI18n()
  const [links, setLinks] = useState<SocialLinkView[]>([])

  useEffect(() => {
    let alive = true
    const api = window.aiOffice
    // an older preload without the channel simply shows no buttons
    void api.socialLinks?.().then(
      (list) => {
        if (alive) setLinks(list)
      },
      () => undefined,
    )
    const off = api.onSocialLinksChanged?.((list) => {
      if (alive) setLinks(list)
    })
    return () => {
      alive = false
      off?.()
    }
  }, [])

  if (links.length === 0) return null
  return (
    <div className="social-follow" role="group" aria-label={t('socialFollowGroup')}>
      {links.map((link) => (
        <button
          key={link.id}
          type="button"
          className="social-btn"
          data-platform={link.platform}
          aria-label={socialLinkTitle(link, t)}
          data-tip={socialAction(link, t)}
          {...(link.label ? { 'data-tip-detail': link.label } : {})}
          onClick={() => void window.aiOffice.openSocialLink?.(link.id).catch(() => undefined)}
        >
          <SocialIcon platform={link.platform} />
        </button>
      ))}
    </div>
  )
}
