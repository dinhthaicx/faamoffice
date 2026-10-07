import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * FaamOffice from the Microsoft Store: the MSIX package electron-builder.cjs
 * builds with GENOFFICE_APPX=1, detected at run time by process.windowsStore.
 * The Store installs and updates that package, so in this mode the app
 *   - never starts electron-updater; Help → Check for Updates and
 *     Settings → About point at the Store instead (updater.ts),
 *   - never writes the HKCU Run key: Electron's login item API does not work
 *     for packaged apps (login-item.ts),
 *   - opens Settings → Default apps at its own entry by AUMID: the package's
 *     file type associations get ProgIds Windows generates, not the NSIS ones
 *     (default-app.ts),
 *   - does not put the command line on the PATH: the package folder changes
 *     with every Store update (cli-link.ts, Settings → Integrations).
 *
 * The listing is read from extraMetadata.faamofficeStore in the packaged
 * package.json, which only the Store build carries.
 */

/** FaamOffice's Store ID, for a Store build whose metadata is missing */
export const STORE_PRODUCT_ID = '9P0RJ9J87ZNQ'

export interface StoreListing {
  /** Store ID of the listing (ms-windows-store://pdp/?ProductId=…) */
  productId: string
  /** PackageFamilyName!ApplicationId; null when the metadata does not carry a valid one */
  aumid: string | null
}

/** Store IDs: 12 upper-case letters and digits (9P0RJ9J87ZNQ) */
const PRODUCT_ID = /^[0-9A-Z]{12}$/
/** <identity name>_<13-char publisher hash>!<application id> */
const AUMID = /^[A-Za-z0-9.-]{3,50}_[a-z0-9]{13}![A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/

/** the listing from a parsed package.json; invalid fields fall back */
export function storeListingFrom(pkg: unknown): StoreListing {
  const raw =
    pkg && typeof pkg === 'object' ? (pkg as Record<string, unknown>).faamofficeStore : null
  const meta = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const productId =
    typeof meta.productId === 'string' && PRODUCT_ID.test(meta.productId)
      ? meta.productId
      : STORE_PRODUCT_ID
  const aumid = typeof meta.aumid === 'string' && AUMID.test(meta.aumid) ? meta.aumid : null
  return { productId, aumid }
}

/** whether this process runs from the Microsoft Store package */
export function isStoreInstall(): boolean {
  return process.platform === 'win32' && process.windowsStore === true
}

let cached: StoreListing | undefined

/** the Store listing of this install; null outside the Store package */
export function storeListing(): StoreListing | null {
  if (!isStoreInstall()) return null
  if (cached) return cached
  let pkg: unknown = null
  try {
    pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
  } catch {
    // no metadata: the fallbacks apply
  }
  cached = storeListingFrom(pkg)
  return cached
}

/** the listing in the Store app */
export function storeAppUrl(productId: string): string {
  return `ms-windows-store://pdp/?ProductId=${encodeURIComponent(productId)}`
}

/** the listing on the web, for a Windows without the Store app */
export function storeWebUrl(productId: string): string {
  return `https://apps.microsoft.com/detail/${encodeURIComponent(productId)}`
}

/** open the listing in the Store app, else in the browser; never throws */
export async function openStorePage(
  listing: StoreListing,
  openExternal: (url: string) => Promise<void>,
): Promise<void> {
  try {
    await openExternal(storeAppUrl(listing.productId))
  } catch {
    try {
      await openExternal(storeWebUrl(listing.productId))
    } catch {
      // nothing left to open
    }
  }
}
