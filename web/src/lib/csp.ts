// Content-Security-Policy strings (no imports: used by the proxy and tests).
//
// The site-wide policy is set in next.config.ts for every page; siteCsp() is
// its twin, kept byte-identical by a test (next.config.ts imports nothing from
// src/ so its loading never depends on module resolution).
//
// While Google AdSense is on, the proxy replaces it on the ad pages only (see
// src/lib/ads.ts) with adPagesCsp(). Google supports either a strict
// nonce-based policy (pages rendered per request, which would end static
// generation) or broad https: allowances; host allowlists break ads, consent
// messages and creatives as Google adds hosts. So the ad pages get broad
// https: sources for scripts, frames, images, styles, fonts, media and
// connections, plus 'unsafe-eval' for Google's ad scripts. Everything else is
// unchanged, and every other page (download, account, admin, auth, legal, 404,
// API) keeps the site-wide policy.

export type CspEnv = { dev: boolean; https: boolean };

/** The flags next.config.ts uses: development mode, and an https SITE_URL. */
export function cspEnv(env: Record<string, string | undefined> = process.env): CspEnv {
  return {
    dev: env.NODE_ENV === "development",
    https: (env.SITE_URL || "http://localhost:3000").startsWith("https://"),
  };
}

/** The site-wide policy: identical to `csp` in next.config.ts (tested). */
export function siteCsp({ dev, https }: CspEnv): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** The ad pages' policy while they load the AdSense script. */
export function adPagesCsp({ dev, https }: CspEnv): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    `connect-src 'self' https:${dev ? " ws: wss:" : ""}`,
    "frame-src 'self' https:",
    "media-src 'self' blob: https:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
