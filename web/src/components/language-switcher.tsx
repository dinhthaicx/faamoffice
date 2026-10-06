"use client";

// Links to the same page in the other locale (keeps the path after the locale prefix).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LOCALE_COOKIE, locales, type Locale } from "@/i18n/config";

export function LanguageSwitcher({ locale, label, ariaLabel }: { locale: Locale; label: string; ariaLabel: string }) {
  const pathname = usePathname() || `/${locale}`;
  const other = locales.find((l) => l !== locale) ?? "en";
  const rest = pathname.replace(/^\/(vi|en)(?=\/|$)/, "");
  return (
    <Link
      href={`/${other}${rest}`}
      hrefLang={other}
      lang={other}
      aria-label={`${ariaLabel}: ${label}`}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted hover:bg-bg-muted hover:text-fg"
      prefetch={false}
      onClick={() => {
        // Remember the explicit choice for unprefixed URLs ("/", "/device").
        document.cookie = `${LOCALE_COOKIE}=${other}; path=/; max-age=31536000; samesite=lax`;
      }}
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4" aria-hidden="true">
        <circle cx="10" cy="10" r="7.25" />
        <path d="M2.75 10h14.5M10 2.75c2 2.1 3 4.5 3 7.25s-1 5.15-3 7.25c-2-2.1-3-4.5-3-7.25s1-5.15 3-7.25Z" />
      </svg>
      {label}
    </Link>
  );
}
