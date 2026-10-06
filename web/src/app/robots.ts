import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/env";
import { locales } from "@/i18n/config";

const PRIVATE = ["/account", "/admin", "/device", "/reset-password", "/verify-email"];

export default function robots(): MetadataRoute.Robots {
  const site = getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", ...PRIVATE, ...locales.flatMap((l) => PRIVATE.map((p) => `/${l}${p}`))],
      },
    ],
    sitemap: `${site}/sitemap.xml`,
    host: site,
  };
}
