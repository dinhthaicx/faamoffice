import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import {
  AI_MEDIA_PROVIDERS,
  AI_PROVIDERS,
  AI_SEARCH_PROVIDERS,
  getProviderAdapter,
} from '@genoffice/ai-provider/browser'
import type { AiSettings, CodexModelCatalog } from '@genoffice/ai-provider/browser'
import { installDropOpenBridge } from '@genoffice/electron-utils/drop-open'
import type { UpdateUiState } from '../shared/update-api'
import { normalizeAiPanelPrefs } from '@genoffice/ui/ai-panel-prefs'
import type {
  AnnouncementView,
  UserProfile,
  FaamAccountEvent,
  FaamAccountInfo,
  DefaultAppStatus,
  LoginItemStatus,
  FolderListing,
  FolderRoot,
  MoveResult,
  HomeApi,
  SocialLinkView,
  RecentEntry,
  RecentPage,
  RenameResult,
  UiLanguage,
  FileSearchPage,
  FileSearchRerank,
  FileSearchSettings,
} from '../shared/home-api'
import { HOME_CHANNELS, isSocialPlatform } from '../shared/home-api'
import { INTEGRATIONS_CHANNELS } from '../shared/integrations-api'
import type {
  IntegrationsApi,
  IntegrationsStatus,
  SkillInstallState,
} from '../shared/integrations-api'
import type { TabsApi, TabSummary } from '../shared/tabs-api'
import { TABS_CHANNELS } from '../shared/tabs-api'

const UI_LANGUAGES: readonly UiLanguage[] = [
  'zh',
  'en',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'th',
  'id',
  'ru',
  'ar',
  'pt',
  'it',
  'pl',
  'cs',
  'nl',
  'ms',
  'he',
  'hi',
  'zh-TW',
  'vi',
]

function isUiLanguage(value: unknown): value is UiLanguage {
  return UI_LANGUAGES.includes(value as UiLanguage)
}

const EMPTY_PAGE: RecentPage = { entries: [], total: 0, totalAll: 0 }

function asRecentPage(result: unknown): RecentPage {
  if (result && typeof result === 'object' && Array.isArray((result as RecentPage).entries)) {
    return result as RecentPage
  }
  return EMPTY_PAGE
}

const EMPTY_SEARCH: FileSearchPage = {
  hits: [],
  total: 0,
  index: { indexed: 0, pending: 0, scanning: false },
}

function asSearchPage(result: unknown): FileSearchPage {
  if (result && typeof result === 'object' && Array.isArray((result as FileSearchPage).hits)) {
    return result as FileSearchPage
  }
  return EMPTY_SEARCH
}

function normalizeDefaultAppStatus(result: unknown): DefaultAppStatus {
  const r = (result ?? {}) as Partial<DefaultAppStatus>
  const state = r.state
  return {
    state: state === 'default' || state === 'other' || state === 'unknown' ? state : 'unsupported',
    others: Array.isArray(r.others) ? r.others.filter((x) => typeof x === 'string') : [],
    manualOnly: r.manualOnly === true,
  }
}

function normalizeLoginItemStatus(result: unknown): LoginItemStatus {
  const r = (result ?? {}) as Partial<LoginItemStatus>
  if (r.supported !== true) return { supported: false, enabled: false }
  return r.needsApproval === true
    ? { supported: true, enabled: r.enabled === true, needsApproval: true }
    : { supported: true, enabled: r.enabled === true }
}

/** mirrors the main-side id check (announcements.ts); validated inline, see setUpdateChannel */
function isAnnouncementId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/

/** re-check the prepared list: anything off-shape is dropped, never rendered */
function normalizeAnnouncements(result: unknown): AnnouncementView[] {
  if (!Array.isArray(result)) return []
  const out: AnnouncementView[] = []
  for (const item of result as unknown[]) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const kind = r.kind
    const level = r.level
    const displayMode = r.displayMode
    if (!isAnnouncementId(r.id) || typeof r.title !== 'string' || !r.title) continue
    if (kind !== 'rich' && kind !== 'html') continue
    if (level !== 'info' && level !== 'warning' && level !== 'critical') continue
    if (
      displayMode !== 'once' &&
      displayMode !== 'every_launch' &&
      displayMode !== 'until_dismissed'
    )
      continue
    const view: AnnouncementView = { id: r.id, kind, level, displayMode, title: r.title }
    if (kind === 'html') {
      if (!isHttpUrl(r.htmlUrl)) continue
      view.htmlUrl = r.htmlUrl
    } else {
      if (typeof r.body === 'string' && r.body) view.body = r.body
      if (typeof r.image === 'string' && IMAGE_DATA_URL.test(r.image)) view.image = r.image
    }
    const link = r.link as { label?: unknown } | null | undefined
    if (link && typeof link === 'object') {
      view.link = { label: typeof link.label === 'string' ? link.label : '' }
    }
    out.push(view)
  }
  return out
}

/** mirrors the main-side id check (social-links.ts) */
function isSocialLinkId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

/** re-check the follow-button list: ids, known platforms and short labels only */
function normalizeSocialLinks(result: unknown): SocialLinkView[] {
  if (!Array.isArray(result)) return []
  const out: SocialLinkView[] = []
  for (const item of result as unknown[]) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (!isSocialLinkId(r.id) || !isSocialPlatform(r.platform)) continue
    const view: SocialLinkView = { id: r.id, platform: r.platform }
    if (typeof r.label === 'string' && r.label.trim()) view.label = r.label.trim().slice(0, 40)
    out.push(view)
  }
  return out
}

const homeApi: HomeApi = {
  async recents(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.recents, query))
  },
  async searchFiles(query) {
    return asSearchPage(await ipcRenderer.invoke(HOME_CHANNELS.searchFiles, query))
  },
  async rerankSearch(query) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.rerankSearch, query)
    return result && typeof result === 'object' && Array.isArray((result as FileSearchRerank).order)
      ? (result as FileSearchRerank)
      : null
  },
  async getFileSearchSettings() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.getFileSearchSettings)) as FileSearchSettings
  },
  async setFileSearchSettings(patch) {
    return (await ipcRenderer.invoke(
      HOME_CHANNELS.setFileSearchSettings,
      patch,
    )) as FileSearchSettings
  },
  async testFileSearchRerank(input) {
    const raw = ((await ipcRenderer.invoke(HOME_CHANNELS.testFileSearchRerank, input)) ?? {}) as {
      ok?: unknown
      error?: unknown
    }
    return raw.ok === true
      ? { ok: true }
      : { ok: false, error: typeof raw.error === 'string' ? raw.error : 'Connection failed' }
  },
  async starred(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.starred, query))
  },
  async statPaths(paths) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.statPaths, paths)
    return Array.isArray(result) ? (result as RecentEntry[]) : []
  },
  async toggleStar(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.toggleStar, path)
  },
  async openPath(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.openPath, path)
  },
  async browse() {
    await ipcRenderer.invoke(HOME_CHANNELS.browse)
  },
  async newDoc(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newDoc, opts)
  },
  async newSheet(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newSheet, opts)
  },
  async newSlide(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newSlide, opts)
  },
  async newMarkdown(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newMarkdown, opts)
  },
  async newHtml(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newHtml, opts)
  },
  async newPdf(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newPdf, opts)
  },
  async removeRecent(paths) {
    await ipcRenderer.invoke(HOME_CHANNELS.removeRecent, paths)
  },
  async revealPath(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.revealPath, path)
  },
  async renameFile(path, newName) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.renameFile, path, newName)
    return (result ?? { ok: false, error: 'Rename failed' }) as RenameResult
  },
  async duplicateFile(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.duplicateFile, path)
  },
  async deleteFiles(paths) {
    await ipcRenderer.invoke(HOME_CHANNELS.deleteFiles, paths)
  },
  async folderRoots() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.folderRoots)) as FolderRoot[]
  },
  async addFolderRoot() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.addFolderRoot)) as FolderRoot | null
  },
  async dropFolderRoots(paths) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.dropFolderRoots, paths)) as FolderRoot[]
  },
  async removeFolderRoot(path) {
    await ipcRenderer.invoke(HOME_CHANNELS.removeFolderRoot, path)
  },
  pathForFile(file) {
    return webUtils.getPathForFile(file)
  },
  async listFolder(dir) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.listFolder, dir)) as FolderListing
  },
  async createFolder(parent, name) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.createFolder, parent, name)) as RenameResult
  },
  async renameFolder(dir, newName) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.renameFolder, dir, newName)) as RenameResult
  },
  async movePaths(paths, targetDir, onConflict) {
    return (await ipcRenderer.invoke(
      HOME_CHANNELS.movePaths,
      paths,
      targetDir,
      onConflict,
    )) as MoveResult
  },
  async deleteFolder(dir) {
    await ipcRenderer.invoke(HOME_CHANNELS.deleteFolder, dir)
  },
  onFolderChanged(handler) {
    const listener = (_event: IpcRendererEvent, dirs: unknown) => {
      if (Array.isArray(dirs)) handler(dirs.filter((d): d is string => typeof d === 'string'))
    }
    ipcRenderer.on(HOME_CHANNELS.folderChanged, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.folderChanged, listener)
  },
  async openTrash() {
    await ipcRenderer.invoke(HOME_CHANNELS.openTrash)
  },
  async getLanguage() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getLanguage)
    return isUiLanguage(result) ? result : 'zh'
  },
  async setLanguage(lang) {
    if (!isUiLanguage(lang)) throw new Error('Invalid language.')
    await ipcRenderer.invoke(HOME_CHANNELS.setLanguage, lang)
  },
  async getUpdateChannel() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getUpdateChannel)
    return result === 'beta' ? 'beta' : 'stable'
  },
  async setUpdateChannel(channel) {
    // validated inline: a runtime import from ../shared/update-api would be
    // shared with the update.ts preload entry and get split into a chunk,
    // which sandboxed preload scripts cannot load (window.aiOffice would
    // silently disappear). Preload entries must stay single-file bundles.
    if (channel !== 'stable' && channel !== 'beta') throw new Error('Invalid update channel.')
    await ipcRenderer.invoke(HOME_CHANNELS.setUpdateChannel, channel)
  },
  async getProfile() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getProfile)
    const name = result && typeof result === 'object' ? (result as UserProfile).name : ''
    return { name: typeof name === 'string' ? name : '' }
  },
  async setProfile(profile) {
    await ipcRenderer.invoke(HOME_CHANNELS.setProfile, { name: String(profile?.name ?? '') })
  },
  onProfileChanged(handler) {
    const listener = (_event: IpcRendererEvent, profile: UserProfile) => handler(profile)
    ipcRenderer.on(HOME_CHANNELS.profileChanged, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.profileChanged, listener)
  },
  async faamAccountStatus() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.faamAccountStatus)) as FaamAccountInfo
  },
  async faamAccountLogin() {
    await ipcRenderer.invoke(HOME_CHANNELS.faamAccountLogin)
  },
  onFaamAccountEvent(handler) {
    const listener = (_event: IpcRendererEvent, ev: FaamAccountEvent) => handler(ev)
    ipcRenderer.on(HOME_CHANNELS.faamAccountEvent, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.faamAccountEvent, listener)
  },
  async faamAccountCancelLogin() {
    await ipcRenderer.invoke(HOME_CHANNELS.faamAccountCancelLogin)
  },
  async faamAccountLogout() {
    await ipcRenderer.invoke(HOME_CHANNELS.faamAccountLogout)
  },
  async faamAccountSetServer(url) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.faamAccountSetServer, String(url))) as string
  },
  async faamAccountOpenWeb(page) {
    await ipcRenderer.invoke(HOME_CHANNELS.faamAccountOpenWeb, page)
  },
  async faamCloudModels() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.faamCloudModels)
    return Array.isArray(result) ? result.filter((m): m is string => typeof m === 'string') : []
  },
  async getAppVersion() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAppVersion)
    return typeof result === 'string' ? result : ''
  },
  async getUpdateState() {
    const result: unknown = await ipcRenderer.invoke('update:get-state')
    return (result as UpdateUiState | null) ?? null
  },
  async openUpdateDialog() {
    const result: unknown = await ipcRenderer.invoke('update:open-for-update')
    return result === true
  },
  async isStoreInstall() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.isStoreInstall)
    return result === true
  },
  async openStorePage() {
    await ipcRenderer.invoke(HOME_CHANNELS.openStorePage)
  },
  onUpdateStateChanged(handler: (state: UpdateUiState) => void) {
    const listener = (_e: IpcRendererEvent, state: UpdateUiState) => handler(state)
    ipcRenderer.on('update:state-changed', listener)
    return () => ipcRenderer.removeListener('update:state-changed', listener)
  },
  async setUpdatePromptBlocked(blocked) {
    await ipcRenderer.invoke('update:prompt-blocked', blocked === true)
  },
  async onboardingSeen() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.onboardingSeen)
    return result === true
  },
  async setOnboardingSeen() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.setOnboardingSeen)
    return result === true
  },
  async getTheme() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getTheme)
    return result === 'dark' || result === 'light' ? result : 'system'
  },
  async setTheme(theme) {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system')
      throw new Error('Invalid theme.')
    await ipcRenderer.invoke(HOME_CHANNELS.setTheme, theme)
  },
  async getDocumentTheme() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getDocumentTheme)
    return result === 'dark' || result === 'light' ? result : 'follow'
  },
  async setDocumentTheme(theme) {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'follow')
      throw new Error('Invalid document theme.')
    await ipcRenderer.invoke(HOME_CHANNELS.setDocumentTheme, theme)
  },
  async getAutoSaveDefault() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAutoSaveDefault)
    const r = result as { on?: unknown; updatedAt?: unknown } | null
    return {
      on: r?.on === true,
      updatedAt: typeof r?.updatedAt === 'number' ? r.updatedAt : 0,
    }
  },
  async setAutoSaveDefault(on) {
    if (typeof on !== 'boolean') throw new Error('Invalid AutoSave default.')
    await ipcRenderer.invoke(HOME_CHANNELS.setAutoSaveDefault, on)
  },
  async getMcpStatus() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getMcpStatus)
    const r = result as {
      running?: unknown
      enabled?: unknown
      port?: unknown
      background?: unknown
      logging?: unknown
      url?: unknown
      capabilities?: unknown
      error?: unknown
    } | null
    return {
      running: r?.running === true,
      enabled: r?.enabled === true,
      port: typeof r?.port === 'number' ? r.port : 3093,
      background: r?.background === true,
      logging: r?.logging === true,
      url: typeof r?.url === 'string' ? r.url : null,
      capabilities: Array.isArray(r?.capabilities)
        ? r.capabilities.filter((c): c is string => typeof c === 'string')
        : ['docs'],
      ...(typeof r?.error === 'string' ? { error: r.error } : {}),
    }
  },
  async setMcpSettings(patch: {
    enabled?: boolean
    port?: number
    background?: boolean
    logging?: boolean
  }) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.setMcpSettings, patch)
    const r = result as {
      running?: unknown
      enabled?: unknown
      port?: unknown
      background?: unknown
      logging?: unknown
      url?: unknown
      capabilities?: unknown
      error?: unknown
    } | null
    return {
      running: r?.running === true,
      enabled: r?.enabled === true,
      port: typeof r?.port === 'number' ? r.port : 3093,
      background: r?.background === true,
      logging: r?.logging === true,
      url: typeof r?.url === 'string' ? r.url : null,
      capabilities: Array.isArray(r?.capabilities)
        ? r.capabilities.filter((c): c is string => typeof c === 'string')
        : ['docs'],
      ...(typeof r?.error === 'string' ? { error: r.error } : {}),
    }
  },
  async getMcpLogs() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getMcpLogs)
    return Array.isArray(result) ? result.filter((l): l is string => typeof l === 'string') : []
  },
  async clearMcpLogs() {
    await ipcRenderer.invoke(HOME_CHANNELS.clearMcpLogs)
  },
  async openMcpLogFile() {
    await ipcRenderer.invoke(HOME_CHANNELS.openMcpLogFile)
  },
  async getAnalyticsEnabled() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAnalyticsEnabled)
    return result !== false
  },
  async setAnalyticsEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid analytics consent.')
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.setAnalyticsEnabled, enabled)
    return result === true
  },
  async getAiPanelPrefs() {
    return normalizeAiPanelPrefs(await ipcRenderer.invoke(HOME_CHANNELS.getAiPanelPrefs))
  },
  async setAiPanelPrefs(patch) {
    return normalizeAiPanelPrefs(await ipcRenderer.invoke(HOME_CHANNELS.setAiPanelPrefs, patch))
  },
  async getDefaultSaveDir() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getDefaultSaveDir)
    return typeof result === 'string' ? result : ''
  },
  async getDefaultAppStatus() {
    return normalizeDefaultAppStatus(await ipcRenderer.invoke(HOME_CHANNELS.getDefaultAppStatus))
  },
  async setDefaultApp() {
    return normalizeDefaultAppStatus(await ipcRenderer.invoke(HOME_CHANNELS.setDefaultApp))
  },
  async getOpenAtLogin() {
    return normalizeLoginItemStatus(await ipcRenderer.invoke(HOME_CHANNELS.getOpenAtLogin))
  },
  async setOpenAtLogin(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid open-at-login value.')
    return normalizeLoginItemStatus(await ipcRenderer.invoke(HOME_CHANNELS.setOpenAtLogin, enabled))
  },
  async openLoginItemsSettings() {
    await ipcRenderer.invoke(HOME_CHANNELS.openLoginItemsSettings)
  },
  async pickDefaultSaveDir() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.pickDefaultSaveDir)
    return typeof result === 'string' && result ? result : null
  },
  onThemeChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, theme: unknown) => {
      if (theme === 'light' || theme === 'dark' || theme === 'system') handler(theme)
    }
    ipcRenderer.on('app:theme-changed', listener)
    return () => ipcRenderer.removeListener('app:theme-changed', listener)
  },
  onDocumentThemeChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, theme: unknown) => {
      if (theme === 'light' || theme === 'dark' || theme === 'follow') handler(theme)
    }
    ipcRenderer.on('app:document-theme-changed', listener)
    return () => ipcRenderer.removeListener('app:document-theme-changed', listener)
  },
  async openGenTeam() {
    await ipcRenderer.invoke(HOME_CHANNELS.openGenTeam)
  },
  async openAiProviderPage(provider) {
    await ipcRenderer.invoke(HOME_CHANNELS.openAiProviderPage, String(provider))
  },
  async openGitHubRepo() {
    await ipcRenderer.invoke(HOME_CHANNELS.openGitHubRepo)
  },
  async githubStars() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.githubStars)
    return typeof result === 'number' && Number.isFinite(result) ? result : null
  },
  async starPromptShouldShow() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.starPromptShouldShow)
    const raw = (result ?? {}) as { show?: unknown; docOpens?: unknown }
    return {
      show: raw.show === true,
      docOpens:
        typeof raw.docOpens === 'number' && Number.isFinite(raw.docOpens) ? raw.docOpens : 0,
    }
  },
  async starPromptAction(action) {
    if (action !== 'starred' && action !== 'later') throw new Error('Invalid star prompt action.')
    await ipcRenderer.invoke(HOME_CHANNELS.starPromptAction, action)
  },
  async defaultAppPromptShouldShow() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.defaultAppPromptShouldShow)
    const raw = (result ?? {}) as { show?: unknown; status?: unknown }
    return { show: raw.show === true, status: normalizeDefaultAppStatus(raw.status) }
  },
  async defaultAppPromptAction(action) {
    if (action !== 'set' && action !== 'later' && action !== 'never') {
      throw new Error('Invalid default-app prompt action.')
    }
    return normalizeDefaultAppStatus(
      await ipcRenderer.invoke(HOME_CHANNELS.defaultAppPromptAction, action),
    )
  },
  async announcementsPending() {
    return normalizeAnnouncements(await ipcRenderer.invoke(HOME_CHANNELS.announcementsPending))
  },
  async announcementAction(id, action) {
    if (!isAnnouncementId(id)) throw new Error('Invalid announcement id.')
    if (action !== 'shown' && action !== 'dismiss' && action !== 'close') {
      throw new Error('Invalid announcement action.')
    }
    await ipcRenderer.invoke(HOME_CHANNELS.announcementAction, id, action)
  },
  async openAnnouncementLink(id) {
    if (!isAnnouncementId(id)) throw new Error('Invalid announcement id.')
    await ipcRenderer.invoke(HOME_CHANNELS.openAnnouncementLink, id)
  },
  async socialLinks() {
    return normalizeSocialLinks(await ipcRenderer.invoke(HOME_CHANNELS.socialLinks))
  },
  onSocialLinksChanged(handler) {
    const listener = (_event: IpcRendererEvent, links: unknown) =>
      handler(normalizeSocialLinks(links))
    ipcRenderer.on(HOME_CHANNELS.socialLinksChanged, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.socialLinksChanged, listener)
  },
  async openSocialLink(id) {
    if (!isSocialLinkId(id)) throw new Error('Invalid social link id.')
    await ipcRenderer.invoke(HOME_CHANNELS.openSocialLink, id)
  },
  onAnnouncementEscape(handler) {
    const listener = () => handler()
    ipcRenderer.on(HOME_CHANNELS.announcementEscape, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.announcementEscape, listener)
  },
  onAnnouncementFrameFailed(handler) {
    const listener = (_event: IpcRendererEvent, id: unknown) => {
      if (isAnnouncementId(id)) handler(id)
    }
    ipcRenderer.on(HOME_CHANNELS.announcementFrameFailed, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.announcementFrameFailed, listener)
  },
  // AI settings channels are registered once by the shell's aggregated docs handlers
  async getAiSettings() {
    return (await ipcRenderer.invoke('ai:get-settings')) as AiSettings
  },
  async setAiSettings(settings) {
    await ipcRenderer.invoke('ai:set-settings', settings)
  },
  getAiProviders() {
    return AI_PROVIDERS.map((meta) => {
      let defaultBaseUrl = ''
      // custom has no default address and Faam AI Cloud's comes from the account — both stay ''
      if (!meta.needsBaseUrl && !meta.needsCliPath && !meta.account) {
        defaultBaseUrl = getProviderAdapter(meta.id).resolveEndpoint({
          apiKey: '',
          model: meta.defaultModel,
        }).baseUrl
      }
      return { ...meta, defaultBaseUrl }
    })
  },
  async getCodexModels(cliPath) {
    return (await ipcRenderer.invoke('ai:codex-models', cliPath)) as CodexModelCatalog
  },
  async getCustomModels(baseUrl, apiKey) {
    return (await ipcRenderer.invoke('ai:custom-models', { baseUrl, apiKey })) as CodexModelCatalog
  },
  async testAiSettings(settings) {
    const result: unknown = await ipcRenderer.invoke('ai:chat', {
      settings,
      system: 'You are a connectivity test. Reply with the single word OK.',
      user: 'ping',
    })
    const raw = (result ?? {}) as { ok?: unknown; error?: unknown }
    return raw.ok === true
      ? { ok: true }
      : { ok: false, error: typeof raw.error === 'string' ? raw.error : 'Connection failed' }
  },
  getAiMediaProviders() {
    return AI_MEDIA_PROVIDERS
  },
  getAiSearchProviders() {
    return AI_SEARCH_PROVIDERS
  },
  async testAiSearchSettings(input) {
    const raw = ((await ipcRenderer.invoke('ai:search-test', input)) ?? {}) as {
      ok?: unknown
      error?: unknown
    }
    return raw.ok === true
      ? { ok: true }
      : { ok: false, error: typeof raw.error === 'string' ? raw.error : 'Connection failed' }
  },
  async testAiMediaSettings(input) {
    const raw = ((await ipcRenderer.invoke('ai:media-test', input)) ?? {}) as {
      ok?: unknown
      error?: unknown
    }
    return raw.ok === true
      ? { ok: true }
      : { ok: false, error: typeof raw.error === 'string' ? raw.error : 'Connection failed' }
  },
}

contextBridge.exposeInMainWorld('aiOffice', homeApi)

const integrationsApi: IntegrationsApi = {
  async status() {
    return (await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.status)) as IntegrationsStatus
  },
  async installSkill(target) {
    return (await ipcRenderer.invoke(
      INTEGRATIONS_CHANNELS.installSkill,
      target,
    )) as SkillInstallState
  },
  async uninstallSkill(agentId) {
    return (await ipcRenderer.invoke(
      INTEGRATIONS_CHANNELS.uninstallSkill,
      agentId,
    )) as SkillInstallState
  },
  async pickSkillDir(title) {
    const r: unknown = await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.pickSkillDir, title)
    return typeof r === 'string' ? r : null
  },
  async saveSkillZip(title) {
    const r: unknown = await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.saveSkillZip, title)
    return typeof r === 'string' ? r : null
  },
  async copyText(text) {
    await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.copyText, text)
  },
}
contextBridge.exposeInMainWorld('aiOfficeIntegrations', integrationsApi)

const tabsApi: TabsApi = {
  async list() {
    const result: unknown = await ipcRenderer.invoke(TABS_CHANNELS.list)
    return Array.isArray(result) ? (result as TabSummary[]) : []
  },
  async activate(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.activate, id)
  },
  async close(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.close, id)
  },
  async showMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showMenu, x, y)
  },
  async showLanguageMenu(x, y) {
    return (await ipcRenderer.invoke(TABS_CHANNELS.showLanguageMenu, x, y)) as string | null
  },
  async showNewMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showNewMenu, x, y)
  },
  async showTabMenu(id, x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showTabMenu, id, x, y)
  },
  async detach(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.detach, id)
  },
  async tearOff(id, screenX, screenY) {
    const result: unknown = await ipcRenderer.invoke(TABS_CHANNELS.tearOff, id, screenX, screenY)
    return result === true
  },
  dragTornWindow(screenX, screenY) {
    ipcRenderer.send(TABS_CHANNELS.dragTornWindow, screenX, screenY)
  },
  async dockTornWindow(index) {
    await ipcRenderer.invoke(TABS_CHANNELS.dockTornWindow, index)
  },
  async endTornDrag() {
    await ipcRenderer.invoke(TABS_CHANNELS.endTornDrag)
  },
  onDockPreview(handler) {
    const listener = (_event: IpcRendererEvent, preview: { x: number } | null) =>
      handler(preview && typeof preview.x === 'number' ? { x: preview.x } : null)
    ipcRenderer.on(TABS_CHANNELS.dockPreview, listener)
    return () => ipcRenderer.removeListener(TABS_CHANNELS.dockPreview, listener)
  },
  reportDockIndex(index) {
    ipcRenderer.send(TABS_CHANNELS.dockIndex, index)
  },
  async showAppMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showAppMenu, x, y)
  },
  async reorder(id, toIndex) {
    await ipcRenderer.invoke(TABS_CHANNELS.reorder, id, toIndex)
  },
  onChanged(handler) {
    const listener = (_event: IpcRendererEvent, tabs: TabSummary[]) => handler(tabs)
    ipcRenderer.on(TABS_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(TABS_CHANNELS.changed, listener)
  },
  notifyChromePressed() {
    ipcRenderer.send(TABS_CHANNELS.chromePressed)
  },
  onChromePressed(handler) {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
}

contextBridge.exposeInMainWorld('aiOfficeTabs', tabsApi)

// open documents dragged from the OS anywhere over Home or the tab strip
installDropOpenBridge()
