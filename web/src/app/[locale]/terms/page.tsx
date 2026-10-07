import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { pageMetadata } from "@/lib/seo";
import { toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[locale]/terms">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const t = getDictionary(locale).terms;
  return pageMetadata({ locale, path: "/terms", title: t.metaTitle, description: t.metaDescription });
}

export default async function TermsPage({ params }: PageProps<"/[locale]/terms">) {
  const locale = toLocale((await params).locale);
  const dict = getDictionary(locale);
  return <LegalPage locale={locale} dict={dict} path="/terms" content={dict.terms} reviewPending />;
}
