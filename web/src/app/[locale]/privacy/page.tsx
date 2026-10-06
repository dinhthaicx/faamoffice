import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { pageMetadata } from "@/lib/seo";
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
  return <LegalPage locale={locale} dict={dict} path="/privacy" content={dict.privacy} />;
}
