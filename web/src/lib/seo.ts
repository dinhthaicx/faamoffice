// Metadata and JSON-LD builders for public pages.

import type { Metadata } from "next";
import socialShareImage from "@/assets/faamoffice-share-1200x630.png";
import { getSiteUrl } from "./env";
import { GITHUB_URL, LATEST_RELEASE_URL, LICENSE_URL } from "./site";
import { localeMeta, locales, type Locale } from "@/i18n/config";
import { getDictionary, type Dictionary } from "@/i18n";

export const SOCIAL_SHARE_IMAGE = {
  url: socialShareImage.src,
  width: socialShareImage.width,
  height: socialShareImage.height,
  type: "image/png",
  alt: "FaamOffice — free office suite with AI",
};

export function absoluteUrl(path: string): string {
  return `${getSiteUrl()}${path}`;
}

/** hreflang alternates for a path ("" for home): vi, en and x-default (language-negotiating URL). */
export function languageAlternates(path: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const l of locales) languages[localeMeta[l].htmlLang] = `/${l}${path}`;
  languages["x-default"] = path || "/";
  return languages;
}

export function pageMetadata(input: {
  locale: Locale;
  path: string;
  title: string;
  description: string;
  /** Use the title as-is instead of the "%s · FaamOffice" template. */
  absoluteTitle?: boolean;
  noindex?: boolean;
}): Metadata {
  const { locale, path, title, description } = input;
  const url = `/${locale}${path}`;
  const shareImage = { ...SOCIAL_SHARE_IMAGE, alt: getDictionary(locale).meta.ogAlt };
  return {
    title: input.absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url, languages: languageAlternates(path) },
    openGraph: {
      type: "website",
      siteName: "FaamOffice",
      url,
      title,
      description,
      locale: localeMeta[locale].ogLocale,
      alternateLocale: locales.filter((l) => l !== locale).map((l) => localeMeta[l].ogLocale),
      images: [shareImage],
    },
    twitter: { card: "summary_large_image", title, description, images: [shareImage] },
    ...(input.noindex ? { robots: { index: false, follow: false } } : {}),
  };
}

/** Metadata for private pages (auth, account, admin, device): no indexing, no alternates. */
export function privateMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: false } };
}

type JsonLd = Record<string, unknown>;

/** `sameAs` lists the GitHub repository plus the enabled social links (admin Settings). */
export function organizationLd(socialUrls: readonly string[] = []): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${getSiteUrl()}/#organization`,
    name: "FaamOffice",
    url: getSiteUrl(),
    logo: absoluteUrl("/icons/icon-512.png"),
    sameAs: [GITHUB_URL, ...socialUrls.filter((url) => url !== GITHUB_URL)],
  };
}

export function websiteLd(locale: Locale, dict: Dictionary): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${getSiteUrl()}/#website`,
    name: "FaamOffice",
    url: absoluteUrl(`/${locale}`),
    description: dict.meta.defaultDescription,
    inLanguage: localeMeta[locale].htmlLang,
    publisher: { "@id": `${getSiteUrl()}/#organization` },
  };
}

export function softwareApplicationLd(locale: Locale, dict: Dictionary): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "FaamOffice",
    description: dict.meta.defaultDescription,
    url: absoluteUrl(`/${locale}`),
    downloadUrl: LATEST_RELEASE_URL,
    image: absoluteUrl("/icons/icon-512.png"),
    operatingSystem: "Windows, macOS, Linux",
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Office suite",
    license: LICENSE_URL,
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@id": `${getSiteUrl()}/#organization` },
    featureList: dict.home.apps.items.map((a) => `${a.name} (${a.formats})`).join(", "),
  };
}

export function faqLd(items: { q: string; a: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function breadcrumbLd(items: { name: string; path: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/** Serialize JSON-LD safely for a <script> tag (escapes "<" to avoid breaking out). */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
