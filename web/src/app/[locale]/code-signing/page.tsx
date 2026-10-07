import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { pageMetadata } from "@/lib/seo";
import { toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[locale]/code-signing">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const policy = getDictionary(locale).codeSigning;
  return pageMetadata({ locale, path: "/code-signing", title: policy.metaTitle, description: policy.metaDescription });
}

export default async function CodeSigningPage({ params }: PageProps<"/[locale]/code-signing">) {
  const locale = toLocale((await params).locale);
  const dict = getDictionary(locale);
  return <LegalPage locale={locale} dict={dict} path="/code-signing" content={dict.codeSigning} />;
}
