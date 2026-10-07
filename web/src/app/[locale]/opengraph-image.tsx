import { renderOgImage } from "@/lib/og";
import { locales } from "@/i18n/config";

export const alt = "FaamOffice — free office suite with AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default function OpengraphImage() {
  return renderOgImage();
}
