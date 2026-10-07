import type { Metadata } from "next";
import { LegalPage, privacyWithAds } from "@/components/legal-page";
import { adsActive } from "@/lib/ads";
import { pageMetadata } from "@/lib/seo";
import { getSiteSettings } from "@/lib/site-settings";
import { toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[locale]/privacy">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const p = getDictionary(locale).privacy;
  return pageMetadata({ locale, path: "/privacy", title: p.metaTitle, description: p.metaDescription });
}

export default async function PrivacyPage({ params }: PageProps<"/[locale]/privacy">) {
  const locale = toLocale((await params).locale);
  const dict = getDictionary(locale);
  // The "Advertising" section (Google's required disclosure) only while Google ads are on.
  const { ads } = await getSiteSettings();
  const content = adsActive(ads) ? privacyWithAds(dict.privacy) : dict.privacy;
  return <LegalPage locale={locale} dict={dict} path="/privacy" content={content} />;
}
