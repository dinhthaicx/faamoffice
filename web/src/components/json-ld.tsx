import { serializeJsonLd } from "@/lib/seo";

/** Structured data block (rendered as a non-executed application/ld+json script). */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
