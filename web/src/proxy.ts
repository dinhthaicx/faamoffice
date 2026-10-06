// Locale routing (Next.js 16 "proxy", formerly middleware).
//  - Paths without a locale prefix ("/", "/download", "/device?code=…") are
//    redirected to /vi/… or /en/… based on the fo_locale cookie, then
//    Accept-Language, defaulting to Vietnamese.
//  - Locale-prefixed paths pass through untouched (no Set-Cookie, so static
//    pages stay cacheable); the language switcher stores the fo_locale cookie.
// API routes, Next internals and static files are excluded by the matcher.

import { NextResponse, type NextRequest } from "next/server";
import { isLocale, LOCALE_COOKIE, negotiateLocale } from "@/i18n/config";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split("/")[1];

  if (isLocale(first)) return NextResponse.next();

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
    // Everything except API routes, Next internals, metadata files and any path with a file extension.
    "/((?!api/|_next/|favicon\\.ico|icon|apple-icon|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|.*\\.[A-Za-z0-9]+$).*)",
  ],
};
