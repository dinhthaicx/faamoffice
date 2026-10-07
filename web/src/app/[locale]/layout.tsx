import "@fontsource-variable/inter";
import "../globals.css";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { FullPageNavigation } from "@/components/ads-client";
import { adsActive } from "@/lib/ads";
import { getSiteUrl } from "@/lib/env";
import { getSiteSettings, publicSocialLinks } from "@/lib/site-settings";
import { isLocale, localeMeta, locales, toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

// LocaleLayout rejects unsupported locales below. Allow a blocking fallback so
// Next can regenerate a page after settings invalidate its prerendered entry;
// dynamicParams=false causes NoFallbackError when that cache entry is absent.
export const dynamicParams = true;

// Public pages are prerendered with the site settings read at build time (the
// defaults when the database is not reachable then, e.g. in a Docker build).
// Saving the settings revalidates this layout (src/lib/site-settings.ts); the
// time-based revalidation below only catches up after such a build.
export const revalidate = 3600;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const dict = getDictionary(locale);
  const { ads } = await getSiteSettings();
  return {
    metadataBase: new URL(getSiteUrl()),
    title: { default: dict.meta.defaultTitle, template: "%s · FaamOffice" },
    description: dict.meta.defaultDescription,
    applicationName: "FaamOffice",
    authors: [{ name: "FaamOffice" }],
    creator: "FaamOffice",
    publisher: "FaamOffice",
    formatDetection: { telephone: false, email: false, address: false },
    openGraph: { siteName: "FaamOffice", type: "website", locale: localeMeta[locale].ogLocale },
    twitter: { card: "summary_large_image" },
    // AdSense verification is available while ads are off; it loads no script.
    ...(ads.publisherId ? { other: { "google-adsense-account": ads.publisherId } } : {}),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0e15" },
  ],
};

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const { socialLinks, ads } = await getSiteSettings();
  return (
    <html lang={localeMeta[locale].htmlLang} data-scroll-behavior="smooth">
      <body className="flex min-h-screen flex-col">
        {adsActive(ads) ? <FullPageNavigation /> : null}
        <a
          href="#main"
          className="sr-only z-50 rounded-lg bg-accent px-4 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          {dict.nav.skipToContent}
        </a>
        <SiteHeader locale={locale} dict={dict} />
        <main id="main" className="flex-1" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter locale={locale} dict={dict} socials={publicSocialLinks(socialLinks)} />
      </body>
    </html>
  );
}
