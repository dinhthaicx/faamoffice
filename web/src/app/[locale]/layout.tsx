import "@fontsource-variable/inter";
import "../globals.css";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getSiteUrl } from "@/lib/env";
import { isLocale, localeMeta, locales, toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

// Only /vi and /en exist; anything else is a 404 (the proxy redirects
// unprefixed paths to a locale first).
export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const dict = getDictionary(locale);
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
  return (
    <html lang={localeMeta[locale].htmlLang} data-scroll-behavior="smooth">
      <body className="flex min-h-screen flex-col">
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
        <SiteFooter locale={locale} dict={dict} />
      </body>
    </html>
  );
}
