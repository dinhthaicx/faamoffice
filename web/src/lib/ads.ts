// Google AdSense on the website (never in the desktop app: Google's policies do
// not allow AdSense in software applications).
//
// Ads may only run on the public marketing pages below: the home page and the
// Faam AI page. Never on the download page (AdSense "accidental clicks" risk
// next to download buttons), account, admin, auth (login, register, password,
// e-mail verification, device), legal or 404 pages. The proxy relaxes the
// Content-Security-Policy for exactly these paths, and only while the page
// actually loads the AdSense script (adsForPage), see src/lib/csp.ts.
//
// No server-only imports: used by the proxy, server components and tests.

import type { AdSlotKey, AdsSettings } from "./site-settings-shared";

export const AD_PAGES = {
  /** /vi, /en — a unit above the footer. */
  home: { path: "", slot: "homeBottom" },
  /** /vi/faam-ai, /en/faam-ai — a unit inside the page content. */
  faamAi: { path: "/faam-ai", slot: "contentInline" },
} as const satisfies Record<string, { path: string; slot: AdSlotKey }>;

export type AdPage = keyof typeof AD_PAGES;

export const ADSENSE_SCRIPT_URL = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
/** Google's certification authority id in ads.txt (the TAG id of google.com). */
export const GOOGLE_ADS_TXT_CERT_ID = "f08c47fec0942fa0";

/** The ad page a pathname is ("/vi" → home, "/en/faam-ai" → faamAi), or null. */
export function adPageForPath(pathname: string): AdPage | null {
  const match = /^\/(?:vi|en)(\/.*)?$/.exec(pathname.replace(/(.)\/+$/, "$1"));
  if (!match) return null;
  const rest = match[1] ?? "";
  for (const [page, { path }] of Object.entries(AD_PAGES) as [AdPage, (typeof AD_PAGES)[AdPage]][]) {
    if (rest === path) return page;
  }
  return null;
}

/** Ads are on: switched on and a publisher id is saved (the schema requires both together). */
export function adsActive(ads: AdsSettings): ads is AdsSettings & { publisherId: string } {
  return ads.enabled && Boolean(ads.publisherId);
}

export type PageAds = {
  /** data-ad-client / ?client= value ("ca-pub-…"). */
  client: string;
  /** The manual unit of this page, when one is configured. */
  slot: string | null;
};

/**
 * What a page loads: null (nothing, the default) or the AdSense client with the
 * page's unit. The script is loaded when ads are on and the page either has a
 * unit or Auto ads is on.
 */
export function adsForPage(ads: AdsSettings, page: AdPage): PageAds | null {
  if (!adsActive(ads)) return null;
  const slot = ads.slots[AD_PAGES[page].slot] ?? null;
  if (!slot && !ads.autoAds) return null;
  return { client: ads.publisherId, slot };
}

export function adsenseScriptSrc(client: string): string {
  return `${ADSENSE_SCRIPT_URL}?client=${encodeURIComponent(client)}`;
}

/**
 * Body of /ads.txt: Google's record for the publisher id, then the extra
 * records (duplicates dropped), or null when nothing is configured. Served as
 * soon as a publisher id is saved, even with ads off (site verification).
 */
export function adsTxtBody(ads: AdsSettings): string | null {
  const lines: string[] = [];
  if (ads.publisherId) lines.push(`google.com, ${ads.publisherId.replace(/^ca-/, "")}, DIRECT, ${GOOGLE_ADS_TXT_CERT_ID}`);
  for (const line of ads.adsTxtExtra.split("\n")) {
    const text = line.trim();
    if (text) lines.push(text);
  }
  const seen = new Set<string>();
  const unique = lines.filter((line) => {
    // Domains and relationships were normalized on save; account IDs may be case-sensitive.
    const key = line;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length ? `${unique.join("\n")}\n` : null;
}

/**
 * Whether a click entering or leaving an ad page needs a full page load: the
 * AdSense script (and Auto ads such as anchor ads) would otherwise stay in the
 * document after a client-side navigation to, e.g., the download page, which
 * must never show ads. Same-page links (#anchors), new tabs, downloads,
 * modified clicks and other origins keep their normal behavior. Changing
 * locale on an ad page also reloads so the new document gets its own ads.
 */
export function needsFullPageLoad(
  link: { href: string; target?: string | null; download?: boolean; hreflang?: string | null },
  location: { href: string },
  click: {
    button: number;
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    defaultPrevented?: boolean;
  },
): boolean {
  if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
  if ((link.target && link.target !== "_self") || link.download) return false;
  let url: URL;
  let here: URL;
  try {
    here = new URL(location.href);
    url = new URL(link.href, here);
  } catch {
    return false;
  }
  if (url.origin !== here.origin) return false;
  if (!adPageForPath(here.pathname) && !adPageForPath(url.pathname)) return false;
  return url.pathname !== here.pathname || url.search !== here.search;
}
