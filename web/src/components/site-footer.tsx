import Link from "next/link";
import { Logo } from "./logo";
import { SocialIcon } from "./social-icons";
import { Container } from "./ui";
import { socialPlatformName, type PublicSocialLink } from "@/lib/site-settings-shared";
import { GITHUB_URL, RELEASES_URL } from "@/lib/site";
import type { Locale } from "@/i18n/config";
import { format, type Dictionary } from "@/i18n";

/** "Follow FaamOffice" icon row (admin Settings → social links); renders nothing when empty. */
export function SocialLinks({ socials, dict }: { socials: readonly PublicSocialLink[]; dict: Dictionary }) {
  const f = dict.footer;
  if (!socials.length) return null;
  return (
    <section aria-labelledby="footer-follow" className="mt-6">
      <h2 id="footer-follow" className="text-sm font-semibold">
        {f.follow}
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {socials.map((s) => {
          // A website is visited, not followed (same wording as the desktop app's row).
          const name =
            s.platform === "website" ? f.visitWebsite : format(f.followOn, { platform: socialPlatformName(s.platform, f.website) });
          const label = s.label ? `${name}: ${s.label}` : name;
          return (
            <li key={s.id}>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer me"
                aria-label={label}
                title={label}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted transition-colors hover:bg-bg-muted hover:text-fg"
              >
                <SocialIcon platform={s.platform} className="h-[18px] w-[18px]" />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SiteFooter({
  locale,
  dict,
  socials = [],
}: {
  locale: Locale;
  dict: Dictionary;
  socials?: readonly PublicSocialLink[];
}) {
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
        { href: `/${locale}/code-signing`, label: f.codeSigning, internal: true },
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
          <SocialLinks socials={socials} dict={dict} />
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
