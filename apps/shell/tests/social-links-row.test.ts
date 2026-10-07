/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, SocialLinkView } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SocialLinks } from '../src/renderer/src/SocialLinks'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function installApi(initial: SocialLinkView[]) {
  let push: ((links: SocialLinkView[]) => void) | null = null
  const open = vi.fn(async () => undefined)
  const off = vi.fn()
  window.aiOffice = {
    socialLinks: vi.fn(async () => initial),
    onSocialLinksChanged: (handler: (links: SocialLinkView[]) => void) => {
      push = handler
      return off
    },
    openSocialLink: open,
  } as unknown as HomeApi
  return { open, off, push: (links: SocialLinkView[]) => push?.(links) }
}

async function render(lang: 'en' | 'vi' = 'en'): Promise<void> {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: lang }, createElement(SocialLinks)))
    await Promise.resolve()
  })
}

const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.social-btn'))

describe('follow buttons above Settings', () => {
  it('renders nothing while the list is empty', async () => {
    installApi([])
    await render()
    expect(host.querySelector('.social-follow')).toBeNull()
  })

  it('shows one labelled icon button per channel and opens it by id', async () => {
    const api = installApi([
      { id: 'fb1', platform: 'facebook' },
      { id: 'yt1', platform: 'youtube', label: 'FaamOffice TV' },
      { id: 'web', platform: 'website' },
    ])
    await render()
    const group = host.querySelector('.social-follow')
    expect(group?.getAttribute('role')).toBe('group')
    expect(group?.getAttribute('aria-label')).toBe('Follow FaamOffice')
    expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Follow on Facebook',
      'Follow on YouTube — FaamOffice TV',
      'Visit the website',
    ])
    expect(buttons()[1]!.getAttribute('data-tip-detail')).toBe('FaamOffice TV')
    expect(buttons().every((b) => b.type === 'button' && b.querySelector('svg'))).toBe(true)
    await act(async () => {
      buttons()[1]!.click()
      await Promise.resolve()
    })
    expect(api.open).toHaveBeenCalledWith('yt1')
  })

  it('keeps brand names untranslated and follows pushed changes', async () => {
    const api = installApi([{ id: 'tt', platform: 'tiktok' }])
    await render('vi')
    expect(buttons()[0]!.getAttribute('aria-label')).toBe('Theo dõi trên TikTok')
    await act(async () => {
      api.push([])
      await Promise.resolve()
    })
    expect(host.querySelector('.social-follow')).toBeNull()
    act(() => root.unmount())
    expect(api.off).toHaveBeenCalled()
    root = createRoot(host)
  })
})
