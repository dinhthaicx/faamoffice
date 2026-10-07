/**
 * macOS update without Squirrel.Mac (the updater's notify flow, updater.ts).
 *
 * FaamOffice's mac builds are ad-hoc signed — there is no Developer ID — and
 * Squirrel.Mac refuses to install an update that is not signed by the same
 * team, so electron-updater's download / quitAndInstall cannot work there.
 * Instead the app downloads the dmg that latest-mac.yml lists for this Mac,
 * checks it against the sha512 from the feed and opens it; the user drags
 * FaamOffice into Applications. A file written by the app itself carries no
 * com.apple.quarantine attribute (only browsers and other quarantine-aware
 * apps set it), so the replaced app opens without the Gatekeeper "Open Anyway"
 * detour a browser download would bring back.
 *
 * The bytes land through update-resume.ts (Range-resumable, digest-pinned
 * .part files); this module only picks the file and owns the directory.
 */

import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { downloadResumable, fileMatchesSha512 } from './update-resume'

/** one `files:` entry of an electron-updater feed (only what is read here) */
export interface FeedFile {
  url: string
  sha512?: string
  size?: number
}

export interface DmgChoice {
  /** basename, as published next to the feed */
  name: string
  sha512: string
  size?: number
}

/** a plain dmg file name: no path parts, nothing that needs escaping on disk */
const SAFE_DMG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.dmg$/

/** basename of a feed url (relative, or absolute once release-feed.cjs pinned it) */
export function feedFileName(url: string): string | null {
  try {
    const pathname = new URL(url, 'https://metadata.invalid/').pathname
    const name = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1))
    return name || null
  } catch {
    return null
  }
}

/**
 * The dmg for this Mac from the feed's file list. Apple silicon takes the
 * -arm64 dmg, else a universal one, else the Intel one (it runs under
 * Rosetta); an Intel Mac takes the arch-less (x64) dmg or a universal one and
 * never an arm64 build, which would not launch there. Entries without a
 * sha512 cannot be verified and are skipped.
 */
export function pickMacDmg(files: readonly FeedFile[], arch: string): DmgChoice | null {
  const dmgs = files.flatMap((file): DmgChoice[] => {
    const name = feedFileName(file.url)
    if (!name || !SAFE_DMG_NAME.test(name) || typeof file.sha512 !== 'string' || !file.sha512)
      return []
    const size = typeof file.size === 'number' && file.size > 0 ? file.size : undefined
    return [{ name, sha512: file.sha512, ...(size ? { size } : {}) }]
  })
  const arm = dmgs.find((d) => d.name.endsWith('-arm64.dmg'))
  const universal = dmgs.find((d) => d.name.endsWith('-universal.dmg'))
  const x64 = dmgs.find((d) => !/-(arm64|universal)\.dmg$/.test(d.name))
  if (arch === 'arm64') return arm ?? universal ?? x64 ?? null
  return x64 ?? universal ?? null
}

export interface DmgDownload {
  /** where to fetch it (always rebuilt from the trusted feed base by the caller) */
  url: URL
  /** the updates directory; the dmg lands in <dir>/pending, its part in <dir>/resume */
  dir: string
  choice: DmgChoice
  onProgress?: (percent: number) => void
}

/**
 * Download (or reuse an earlier, still valid download of) the chosen dmg and
 * return its path. Throws on any failure — the caller falls back to the
 * browser. Installers of other versions are removed first, so at most one
 * dmg (plus its resumable part) is kept.
 */
export async function downloadMacDmg({
  url,
  dir,
  choice,
  onProgress,
}: DmgDownload): Promise<string> {
  if (!SAFE_DMG_NAME.test(choice.name)) throw new Error(`unexpected installer name ${choice.name}`)
  const pending = path.join(dir, 'pending')
  const destination = path.join(pending, choice.name)
  await mkdir(pending, { recursive: true })
  await pruneOthers(pending, choice.name)
  if (await fileMatchesSha512(destination, choice.sha512)) {
    onProgress?.(100)
    return destination
  }
  await rm(destination, { force: true })
  await downloadResumable(url, destination, {
    sha512: choice.sha512,
    onProgress: (info) => onProgress?.(info.percent),
  })
  // a response without Content-Length reports 0 % throughout
  onProgress?.(100)
  return destination
}

async function pruneOthers(pending: string, keep: string): Promise<void> {
  try {
    const entries = await readdir(pending)
    await Promise.all(
      entries
        .filter((name) => name !== keep)
        .map((name) => rm(path.join(pending, name), { recursive: true, force: true })),
    )
  } catch {
    /* nothing to prune */
  }
}
