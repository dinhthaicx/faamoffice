// Locale routing (Next.js 16 "proxy", formerly middleware).
//  - Paths without a locale prefix ("/", "/download", "/device?code=…") are
//    redirected to /vi/… or /en/… based on the fo_locale cookie, then
//    Accept-Language, defaulting to Vietnamese.
//  - Locale-prefixed paths pass through untouched (no Set-Cookie, so static
//    pages stay cacheable); the language switcher stores the fo_locale cookie.
//  - Ad pages (/vi, /en, /vi/faam-ai, /en/faam-ai) get the AdSense-compatible
//    Content-Security-Policy while they load the AdSense script (admin
//    Settings → Google ads). The response header set here replaces the
//    site-wide one from next.config.ts (Next.js applies the config headers
//    first, then the proxy's). With ads off nothing is added, so every page
//    keeps exactly the next.config.ts policy. The settings come from the
//    per-process cache (~10 s; cleared when an admin saves), and a failed read
//    means "ads off", i.e. the strict policy.
// API routes, the announcement frame (/announcement-frame/{id}, served to the
// desktop app outside the locale routing), Next internals and static files
// (including /ads.txt, /robots.txt and /sitemap.xml) are excluded by the matcher.

import { NextResponse, type NextRequest } from "next/server";
import { adPageForPath, adsForPage } from "@/lib/ads";
import { adPagesCsp, cspEnv } from "@/lib/csp";
import { readSiteSettings } from "@/lib/site-settings-read";
import { isLocale, LOCALE_COOKIE, negotiateLocale } from "@/i18n/config";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split("/")[1];

  if (isLocale(first)) {
    const page = adPageForPath(pathname);
    if (page) {
      const { settings } = await readSiteSettings();
      if (adsForPage(settings.ads, page)) {
        const res = NextResponse.next();
        res.headers.set("Content-Security-Policy", adPagesCsp(cspEnv()));
        return res;
      }
    }
    return NextResponse.next();
  }

  const fromCookie = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(fromCookie) ? fromCookie : negotiateLocale(request.headers.get("accept-language"));
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  const res = NextResponse.redirect(url, 307);
  res.headers.set("Vary", "Accept-Language, Cookie");
  return res;
}

export const config = {
  matcher: [
    // Everything except API routes, the announcement frame, Next internals, metadata files and any path with a file extension.
    "/((?!api/|announcement-frame/|_next/|favicon\\.ico|icon|apple-icon|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|.*\\.[A-Za-z0-9]+$).*)",
  ],
};
