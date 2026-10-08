// Tabs between admin sections. Plain <a> links on purpose: a full page load
// applies each section's own response headers (the announcement editor has a
// wider CSP for its preview, which a client-side navigation would not pick up).

import { cx } from "./ui";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";

export type AdminSection = "users" | "downloads" | "announcements" | "settings";

export function AdminNav({ locale, dict, current }: { locale: Locale; dict: Dictionary; current: AdminSection }) {
  const t = dict.admin.nav;
  const items: { id: AdminSection; href: string; label: string }[] = [
    { id: "users", href: `/${locale}/admin`, label: t.users },
    { id: "downloads", href: `/${locale}/admin/downloads`, label: t.downloads },
    { id: "announcements", href: `/${locale}/admin/announcements`, label: t.announcements },
    { id: "settings", href: `/${locale}/admin/settings`, label: t.settings },
  ];
  return (
    <nav aria-label={t.label} className="mt-4 flex flex-wrap gap-2 text-sm">
      {items.map((item) => (
        <a
          key={item.id}
          href={item.href}
          aria-current={item.id === current ? "page" : undefined}
          className={cx(
            "rounded-md border px-3 py-1.5 font-medium",
            item.id === current ? "border-accent bg-accent text-accent-fg" : "border-border bg-card hover:bg-bg-muted",
          )}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
