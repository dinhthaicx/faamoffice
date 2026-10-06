import Link from "next/link";
import { JsonLd } from "./json-ld";
import { breadcrumbLd } from "@/lib/seo";

/** Visible breadcrumb trail plus its BreadcrumbList structured data. */
export function Breadcrumbs({ items, label }: { items: { name: string; path: string }[]; label: string }) {
  return (
    <>
      <JsonLd data={breadcrumbLd(items)} />
      <nav aria-label={label} className="text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          {items.map((item, i) => (
            <li key={item.path} className="flex items-center gap-1.5">
              {i > 0 ? <span aria-hidden="true">/</span> : null}
              {i < items.length - 1 ? (
                <Link href={item.path} className="hover:text-fg hover:underline">
                  {item.name}
                </Link>
              ) : (
                <span aria-current="page" className="text-fg">
                  {item.name}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
