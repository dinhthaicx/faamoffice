import { renderOgImage } from "@/lib/og";
import { locales, toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

export const alt = "FaamOffice";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function TwitterImage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = toLocale((await params).locale);
  const meta = getDictionary(locale).meta;
  return renderOgImage({ tagline: meta.ogTagline, sub: meta.ogSub });
}
