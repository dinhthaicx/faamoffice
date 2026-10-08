import Link from "next/link";
import { Logo } from "./logo";
import { LanguageSwitcher } from "./language-switcher";
import { MobileMenu } from "./mobile-menu";
import { buttonClass, Container } from "./ui";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";

export function SiteHeader({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const nav = [
    { href: `/${locale}#features`, label: dict.nav.features },
    { href: `/${locale}/faam-ai`, label: dict.nav.faamAi },
    { href: `/${locale}/download`, label: dict.nav.download },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href={`/${locale}`} className="rounded-lg" aria-label={`FaamOffice — ${dict.nav.home}`}>
          <Logo idPrefix="hdr" />
        </Link>

        <nav aria-label={dict.nav.primary} className="hidden items-center gap-1 md:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-bg-muted hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-1 md:flex">
          <LanguageSwitcher locale={locale} label={dict.nav.switchTo} ariaLabel={dict.nav.language} />
          <Link
            href={`/${locale}/account`}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-bg-muted hover:text-fg"
            prefetch={false}
          >
            {dict.nav.account}
          </Link>
          <Link href={`/${locale}/download`} className={`${buttonClass.primary} ml-1`}>
            {dict.nav.download}
          </Link>
        </div>

        <MobileMenu>
          <summary className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
              <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
            </svg>
            {dict.nav.menu}
          </summary>
          <nav
            aria-label={dict.nav.primary}
            className="absolute right-0 mt-2 w-64 rounded-xl border border-border bg-card p-2 shadow-lg"
          >
            <ul className="flex flex-col">
              {[...nav, { href: `/${locale}/account`, label: dict.nav.account }].map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-bg-muted">
                    {item.label}
                  </Link>
                </li>
              ))}
              <li className="mt-1 border-t border-border pt-1">
                <LanguageSwitcher locale={locale} label={dict.nav.switchTo} ariaLabel={dict.nav.language} />
              </li>
            </ul>
          </nav>
        </MobileMenu>
      </Container>
    </header>
  );
}
