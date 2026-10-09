import Link from "next/link";
import { Logo } from "./logo";
import { LanguageSwitcher } from "./language-switcher";
import { MobileMenu } from "./mobile-menu";
import { AdaptiveDownloadButton } from "./adaptive-download-button";
import { buttonClass, Container } from "./ui";
import { getLatestRelease } from "@/lib/releases";
import { getDownloadTargets } from "@/lib/download-targets";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";

export async function SiteHeader({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const release = await getLatestRelease();
  const downloadProps = {
    fallbackHref: `/${locale}/download`,
    fallbackLabel: dict.home.hero.ctaDownload,
    buttonLabel: dict.download.downloadFor,
    platformNames: {
      windows: dict.download.platforms.windows.name,
      mac: dict.download.platforms.mac.name,
      linux: dict.download.platforms.linux.name,
    },
    targets: getDownloadTargets(release, locale),
  };
  const nav = [
    { href: `/${locale}#features`, label: dict.nav.features },
    { href: `/${locale}/faam-ai`, label: dict.nav.faamAi },
    { href: `/${locale}/download`, label: dict.nav.download },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href={`/${locale}`} className="rounded-md" aria-label={`FaamOffice — ${dict.nav.home}`}>
          <Logo idPrefix="hdr" />
        </Link>

        <nav aria-label={dict.nav.primary} className="hidden items-center gap-1 lg:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted hover:bg-bg-muted hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-1 lg:flex">
          <LanguageSwitcher locale={locale} label={dict.nav.switchTo} ariaLabel={dict.nav.language} />
          <Link
            href={`/${locale}/account`}
            className="rounded-md px-3 py-2 text-sm font-medium text-muted hover:bg-bg-muted hover:text-fg"
            prefetch={false}
          >
            {dict.nav.account}
          </Link>
          <AdaptiveDownloadButton {...downloadProps} className={`${buttonClass.download} ml-2 min-h-11 whitespace-nowrap shadow-lg shadow-download/25`} />
        </div>

        <MobileMenu>
          <summary className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
              <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
            </svg>
            {dict.nav.menu}
          </summary>
          <nav
            aria-label={dict.nav.primary}
            className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-card p-2 shadow-lg"
          >
            <ul className="flex flex-col">
              {[...nav, { href: `/${locale}/account`, label: dict.nav.account }].map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="block rounded-md px-3 py-2.5 text-sm font-medium hover:bg-bg-muted">
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
      <Container className="pb-3 lg:hidden">
        <AdaptiveDownloadButton {...downloadProps} className={`${buttonClass.download} min-h-11 w-full shadow-lg shadow-download/25`} />
      </Container>
    </header>
  );
}
