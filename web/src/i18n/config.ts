// Locale configuration shared by the proxy, pages and API routes.

export const locales = ["vi", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "vi";
export const LOCALE_COOKIE = "fo_locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function toLocale(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale;
}

/** BCP 47 tags used for <html lang>, hreflang and Open Graph. */
export const localeMeta: Record<Locale, { htmlLang: string; ogLocale: string; label: string }> = {
  vi: { htmlLang: "vi", ogLocale: "vi_VN", label: "Tiếng Việt" },
  en: { htmlLang: "en", ogLocale: "en_US", label: "English" },
};

/**
 * Pick a locale from an Accept-Language header (q-values respected).
 * Unknown or missing → default locale (Vietnamese).
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return defaultLocale;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      let q = 1;
      for (const p of params) {
        const [k, v] = p.trim().split("=");
        if (k === "q") {
          const n = Number.parseFloat(v);
          q = Number.isFinite(n) ? n : 0;
        }
      }
      return { lang: tag.trim().toLowerCase().split("-")[0], q, index };
    })
    .filter((x) => x.lang && x.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { lang } of ranked) {
    if (isLocale(lang)) return lang;
  }
  return defaultLocale;
}
