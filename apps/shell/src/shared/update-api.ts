// Contract between the update window renderer (update.html) and the shell
// main process. Update-dialog IPC surface:
// get-state / download / install / later + a state-changed push event.

export const UPDATE_CHANNELS = {
  getState: 'update:get-state',
  download: 'update:download',
  install: 'update:install',
  later: 'update:later',
  openDownload: 'update:open-download',
  changed: 'update:changed',
  /** pushed to the shell window so Settings → About can offer the update */
  stateChanged: 'update:state-changed',
  /** Settings → About "update to vX": re-open the (minimized) dialog and act */
  openForUpdate: 'update:open-for-update',
  /** the shell window reports whether onboarding or an announcement is on
   * screen: the automatic update card waits until both are gone */
  promptBlocked: 'update:prompt-blocked',
} as const

/** 'manual' = automatic updating is not working for this version (repeated
 * failures, e.g. a signing-identity change the installed app refuses) — the
 * dialog guides the user to download the installer from the releases page.
 * 'ready' = notify flow only: the macOS installer was downloaded, verified and
 * opened; the user quits the app and drags it into Applications. */
export type UpdatePhase = 'available' | 'downloading' | 'downloaded' | 'ready' | 'error' | 'manual'

/** 'install' = electron-updater downloads and installs the update (Windows
 * NSIS, Linux AppImage); 'notify' = the app only fetches or points at the new
 * installer and the user installs it (ad-hoc signed macOS builds, which
 * Squirrel.Mac refuses to update, and Linux deb/rpm packages) */
export type UpdateFlow = 'install' | 'notify'

/** window copy is localized in the main process (owner of UI language) */
export interface UpdateUiStrings {
  title: string
  headline: string
  desc: string
  download: string
  later: string
  install: string
  downloading: string
  failed: string
  retry: string
  manualDesc: string
  openDownload: string
  /** 'ready' phase: how to finish the update by hand */
  ready: string
  /** 'ready' phase action: quit so the app can be replaced */
  quit: string
}

export interface UpdateUiState {
  phase: UpdatePhase
  flow: UpdateFlow
  version: string
  currentVersion: string
  /** 0-100, meaningful while downloading */
  percent: number
  /** BCP-47 tag for documentElement.lang (drives CJK font selection) */
  lang: string
  strings: UpdateUiStrings
}

/** Settings → About reads the update state and re-opens the dialog on demand */
export interface UpdateSettingsApi {
  getUpdateState(): Promise<UpdateUiState | null>
  onUpdateStateChanged(handler: (state: UpdateUiState) => void): () => void
  /** re-open the update dialog; a download that has not started also starts */
  openUpdateDialog(): Promise<boolean>
}

export interface UpdateWindowApi {
  getState(): Promise<UpdateUiState | null>
  download(): void
  install(): void
  later(): void
  openDownload(): void
  onState(handler: (state: UpdateUiState) => void): () => void
}

/** user-selectable update channel; both map to the latest.yml feed today (no
 * beta feed is published — see CHANNEL_FEED in main/updater.ts) */
export type UpdateChannel = 'stable' | 'beta'

export function isUpdateChannel(v: unknown): v is UpdateChannel {
  return v === 'stable' || v === 'beta'
}
