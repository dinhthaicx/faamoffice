import Link from "next/link";
import { Logo } from "./logo";
import { Container } from "./ui";
import { GITHUB_URL, RELEASES_URL } from "@/lib/site";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";

export function SiteFooter({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const f = dict.footer;
  const columns = [
    {
      title: f.product,
      links: [
        { href: `/${locale}/download`, label: f.download, internal: true },
        { href: `/${locale}/faam-ai`, label: f.faamAi, internal: true },
        { href: `/${locale}/account`, label: f.account, internal: true },
      ],
    },
    {
      title: f.resources,
      links: [
        { href: GITHUB_URL, label: f.github, internal: false },
        { href: RELEASES_URL, label: f.releases, internal: false },
      ],
    },
    {
      title: f.legal,
      links: [
        { href: `/${locale}/privacy`, label: f.privacy, internal: true },
        { href: `/${locale}/terms`, label: f.terms, internal: true },
      ],
    },
  ];
  return (
    <footer className="mt-24 border-t border-border bg-bg-soft">
      <Container className="grid gap-10 py-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Logo idPrefix="ftr" />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">{f.tagline}</p>
        </div>
        {columns.map((col) => (
          <div key={col.title}>
            <h2 className="text-sm font-semibold">{col.title}</h2>
            <ul className="mt-3 space-y-2">
              {col.links.map((link) => (
                <li key={link.href}>
                  {link.internal ? (
                    <Link href={link.href} className="text-sm text-muted hover:text-fg" prefetch={false}>
                      {link.label}
                    </Link>
                  ) : (
                    <a href={link.href} className="text-sm text-muted hover:text-fg" rel="noopener">
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Container>
      <Container className="border-t border-border py-6 text-xs leading-relaxed text-muted">
        <p>
          © {new Date().getFullYear()} FaamOffice. {f.license}
        </p>
        <p className="mt-1">{f.basedOn}</p>
      </Container>
    </footer>
  );
}
