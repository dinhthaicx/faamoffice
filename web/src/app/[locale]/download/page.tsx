import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CodeBlock } from "@/components/code-block";
import { DownloadRecommendation } from "@/components/download-recommendation";
import { DownloadLink } from "@/components/download-link";
import { JsonLd } from "@/components/json-ld";
import { Alert, buttonClass, Card, Container, DownloadIcon } from "@/components/ui";
import { getLatestRelease, type AssetKey, type ReleaseInfo } from "@/lib/releases";
import { pageMetadata, softwareApplicationLd } from "@/lib/seo";
import { getSiteSettings } from "@/lib/site-settings";
import { msStoreUrl, RELEASES_URL, SOURCE_BUILD_URL } from "@/lib/site";
import { toLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

// Static page, refreshed hourly with the latest GitHub release (and whenever an
// admin saves the site settings: the Microsoft Store badge). Never shows ads.
export const revalidate = 3600;

export async function generateMetadata({ params }: PageProps<"/[locale]/download">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const d = getDictionary(locale).download;
  return pageMetadata({ locale, path: "/download", title: d.metaTitle, description: d.metaDescription });
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function formatDate(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso));
}

/** Microsoft's "Get it from Microsoft" badge (self-hosted SVGs; the light one on dark backgrounds). */
function StoreBadge({ url, locale, alt }: { url: string; locale: Locale; alt: string }) {
  return (
    <a href={url} rel="noopener" className="inline-flex rounded-lg">
      <picture>
        <source srcSet={`/badges/microsoft-store-${locale}-light.svg`} media="(prefers-color-scheme: dark)" />
        <img src={`/badges/microsoft-store-${locale}-dark.svg`} alt={alt} width={161} height={44} className="h-12 w-auto" />
      </picture>
    </a>
  );
}

function assetLink(release: ReleaseInfo, key: AssetKey) {
  const asset = release.assets[key];
  return { url: asset?.url ?? null, fileName: asset?.name, size: asset ? formatSize(asset.size) : "" };
}

export default async function DownloadPage({ params }: PageProps<"/[locale]/download">) {
  const locale = toLocale((await params).locale);
  const dict = getDictionary(locale);
  const d = dict.download;
  const release = await getLatestRelease();
  const { msStore } = await getSiteSettings();
  // Shown only once the admin turned it on (the listing has to be live first).
  const storeUrl = msStore.enabled ? msStoreUrl(msStore.productId) : null;
  const hasAssets = Object.keys(release.assets).length > 0;
  const released = formatDate(release.publishedAt, locale);

  const platforms: { id: "mac" | "windows" | "linux"; name: string; requirement: string; assets: { key: AssetKey; label: string }[] }[] = [
    {
      id: "mac",
      name: d.platforms.mac.name,
      requirement: d.platforms.mac.requirement,
      assets: [
        { key: "macArm", label: d.platforms.mac.assets.macArm },
        { key: "macIntel", label: d.platforms.mac.assets.macIntel },
      ],
    },
    {
      id: "windows",
      name: d.platforms.windows.name,
      requirement: d.platforms.windows.requirement,
      assets: [{ key: "winExe", label: d.platforms.windows.assets.winExe }],
    },
    {
      id: "linux",
      name: d.platforms.linux.name,
      requirement: d.platforms.linux.requirement,
      assets: [
        { key: "appImage", label: d.platforms.linux.assets.appImage },
        { key: "deb", label: d.platforms.linux.assets.deb },
        { key: "rpm", label: d.platforms.linux.assets.rpm },
      ],
    },
  ];

  const option = (key: AssetKey, label: string) => {
    const a = assetLink(release, key);
    return { label, url: a.url, fileName: a.fileName,
      tracking: release.version ? { asset: key, version: release.version, locale, source: "recommended" as const } : undefined };
  };

  return (
    <>
      <JsonLd data={softwareApplicationLd(locale, dict)} />
      <section className="hero-glow pb-8 pt-10">
        <Container>
          <Breadcrumbs
            label={dict.common.breadcrumb}
            items={[
              { name: dict.common.breadcrumbHome, path: `/${locale}` },
              { name: d.title, path: `/${locale}/download` },
            ]}
          />
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-5xl">{d.title}</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted">{d.subtitle}</p>
          <p className="mt-3 text-sm text-muted">
            {release.version ? (
              <>
                {d.version} <strong className="text-fg">{release.version}</strong>
                {released ? (
                  <>
                    {" · "}
                    {d.released} {released}
                  </>
                ) : null}
              </>
            ) : (
              d.latest
            )}
          </p>

          <DownloadRecommendation
            title={d.recommended}
            buttonLabel={d.downloadFor}
            options={{
              mac: {
                name: d.platforms.mac.name,
                primary: option("macArm", d.platforms.mac.assets.macArm),
                secondary: [option("macIntel", `${d.platforms.mac.name} — ${d.platforms.mac.assets.macIntel}`)],
              },
              windows: storeUrl
                ? {
                    name: d.platforms.windows.name,
                    primary: { label: d.store.recommendedOption, url: storeUrl },
                    secondary: [option("winExe", `${d.platforms.windows.name} — ${d.platforms.windows.assets.winExe}`)],
                  }
                : { name: d.platforms.windows.name, primary: option("winExe", d.platforms.windows.assets.winExe) },
              linux: {
                name: d.platforms.linux.name,
                primary: option("appImage", d.platforms.linux.assets.appImage),
                secondary: [option("deb", d.platforms.linux.assets.deb), option("rpm", d.platforms.linux.assets.rpm)],
              },
            }}
          />
          {!hasAssets ? <Alert className="mt-6">{d.fallbackNote}</Alert> : null}
          <div className="mt-6 flex flex-wrap gap-6 text-sm font-semibold text-link">
            <Link href={`/${locale}/code-signing`} className="hover:underline">{dict.footer.codeSigning}</Link>
            <Link href={`/${locale}/privacy`} className="hover:underline">{dict.footer.privacy}</Link>
          </div>
        </Container>
      </section>

      <section className="py-10" aria-label={d.title}>
        <Container>
          <ul className="grid gap-5 lg:grid-cols-3">
            {platforms.map((p) => (
              <li key={p.id} id={p.id} className="scroll-mt-24">
                <Card className="h-full">
                  <h2 className="text-xl font-bold">{p.name}</h2>
                  <p className="mt-1 text-sm text-muted">{p.requirement}</p>
                  {p.id === "windows" && storeUrl ? (
                    <div className="mt-5">
                      <p className="inline-flex rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-semibold text-success-fg">{d.store.recommended}</p>
                      <div className="mt-3">
                        <StoreBadge url={storeUrl} locale={locale} alt={d.store.badgeAlt} />
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted">{d.store.note}</p>
                      <p className="mt-5 text-sm font-medium">{d.store.orInstaller}</p>
                    </div>
                  ) : null}
                  <ul className={p.id === "windows" && storeUrl ? "mt-3 space-y-3" : "mt-5 space-y-3"}>
                    {p.assets.map((a) => {
                      const link = assetLink(release, a.key);
                      return (
                        <li key={a.key}>
                          {link.url ? <DownloadLink href={link.url} fileName={link.fileName}
                            tracking={release.version ? { asset: a.key, version: release.version, locale, source: "platform" } : undefined}
                            className={`${buttonClass.secondary} w-full justify-between`}>
                            <span className="flex items-center gap-2">
                              <DownloadIcon />
                              {a.label}
                            </span>
                            {link.size ? <span className="text-xs font-normal text-muted">{link.size}</span> : null}
                          </DownloadLink> : <span aria-disabled="true" className={`${buttonClass.secondary} w-full justify-between opacity-50`}>
                            {a.label}<span className="text-xs">{d.unavailable}</span>
                          </span>}
                          {link.fileName ? <p className="mt-1 truncate font-mono text-xs text-muted">{link.fileName}</p> : null}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section className="py-10" aria-labelledby="first-launch">
        <Container className="max-w-4xl">
          <h2 id="first-launch" className="text-2xl font-bold tracking-tight">
            {d.firstLaunch.title}
          </h2>
          <p className="mt-3 text-muted">{d.firstLaunch.intro}</p>
          <div className="mt-8 space-y-8">
            <div>
              <h3 className="text-lg font-semibold">{d.platforms.mac.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{d.firstLaunch.mac}</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold">{d.platforms.windows.name}</h3>
              {storeUrl ? <p className="mt-2 text-sm leading-relaxed text-muted">{d.firstLaunch.windowsStore}</p> : null}
              <p className="mt-2 text-sm leading-relaxed text-muted">{d.firstLaunch.windows}</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold">{d.platforms.linux.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{d.firstLaunch.linux}</p>
              <div className="mt-3">
                <CodeBlock
                  code={[
                    "chmod +x FaamOffice-*.AppImage && ./FaamOffice-*.AppImage",
                    "sudo apt install ./faamoffice_*_amd64.deb",
                    "sudo dnf install ./faamoffice-*.x86_64.rpm",
                  ].join("\n")}
                  copyLabel={dict.common.copy}
                  copiedLabel={dict.common.copied}
                />
              </div>
            </div>
          </div>

          <div className="mt-12 rounded-2xl border border-border bg-bg-soft p-6">
            <h2 className="text-lg font-semibold">{d.more.title}</h2>
            <p className="mt-2 text-sm text-muted">{d.more.checksum}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a href={RELEASES_URL} className={buttonClass.secondary} rel="noopener">
                {d.more.allReleases}
              </a>
              <a href={SOURCE_BUILD_URL} className={buttonClass.ghost} rel="noopener">
                {d.more.source}
              </a>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
