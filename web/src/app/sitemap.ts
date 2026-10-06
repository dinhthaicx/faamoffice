import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";
import { PUBLIC_PAGES } from "@/lib/site";
import { locales } from "@/i18n/config";

const priority: Record<string, number> = { "": 1, "/download": 0.9, "/faam-ai": 0.8, "/privacy": 0.3, "/terms": 0.3 };

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_PAGES.flatMap((path) => {
    const languages: Record<string, string> = Object.fromEntries(locales.map((l) => [l, absoluteUrl(`/${l}${path}`)]));
    languages["x-default"] = absoluteUrl(path || "/");
    return locales.map((locale) => ({
      url: absoluteUrl(`/${locale}${path}`),
      lastModified,
      changeFrequency: path === "/download" ? ("weekly" as const) : ("monthly" as const),
      priority: priority[path] ?? 0.5,
      alternates: { languages },
    }));
  });
}
