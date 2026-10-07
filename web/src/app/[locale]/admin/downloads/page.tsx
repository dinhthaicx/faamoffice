import type { Metadata } from "next";
import { AdminNav } from "@/components/admin-nav";
import { LocalTime } from "@/components/local-time";
import { Card, Container, buttonClass } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth";
import { downloadReport } from "@/lib/downloads";
import { downloadRange } from "@/lib/downloads-shared";
import { getLatestRelease } from "@/lib/releases";
import { privateMetadata } from "@/lib/seo";
import { toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/downloads">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  return privateMetadata(getDictionary(locale).admin.downloads.metaTitle);
}

export default async function AdminDownloadsPage({ params, searchParams }: PageProps<"/[locale]/admin/downloads">) {
  const locale = toLocale((await params).locale);
  const path = `/${locale}/admin/downloads`;
  await requirePageAdmin(locale, path);
  const days = downloadRange((await searchParams).days);
  const dict = getDictionary(locale);
  const t = dict.admin.downloads;
  const [report, release] = await Promise.all([downloadReport(days), getLatestRelease()]);
  const number = new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US");
  const date = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const formatDay = (day: string) => date.format(new Date(`${day}T12:00:00Z`));
  const maximum = Math.max(1, ...report.series.map((row) => row.count));
  const periodCount = report.series.reduce((sum, row) => sum + row.count, 0);
  const githubAvailable = Object.values(release.assets).some((asset) => asset.downloadCount !== undefined);
  const summaries = [
    { label: t.today, count: report.today }, { label: t.last7, count: report.last7 },
    { label: t.last30, count: report.last30 }, { label: t.total, count: report.total },
  ];
  const breakdowns = [
    { title: t.versions, rows: report.versions.map((row) => ({ label: row.version, count: row.count })) },
    { title: t.languages, rows: report.locales.map((row) => ({ label: row.locale === "vi" ? "Tiếng Việt" : "English", count: row.count })) },
    { title: t.sources, rows: report.sources.map((row) => ({ label: t.sourceLabels[row.source as keyof typeof t.sourceLabels], count: row.count })) },
  ];

  return (
    <Container className="py-10">
      <h1 className="text-3xl font-bold tracking-tight">{dict.admin.title}</h1>
      <AdminNav locale={locale} dict={dict} current="downloads" />
      <div className="mt-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t.title}</h2>
          <p className="mt-2 text-sm text-muted">{t.subtitle}</p>
        </div>
        <a href={`${path}?days=${days}`} className={buttonClass.secondary}>{t.refresh}</a>
      </div>
      <p className="mt-3 max-w-4xl text-xs leading-relaxed text-muted">{t.definition}</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaries.map((stat) => (
          <Card key={stat.label} className="py-5">
            <p className="text-sm text-muted">{stat.label}</p>
            <p className="mt-2 text-3xl font-bold tabular-nums">{number.format(stat.count)}</p>
          </Card>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap items-center gap-2" aria-label={t.period}>
          {([7, 30, 90] as const).map((range) => (
            <a key={range} href={`${path}?days=${range}`} aria-current={days === range ? "page" : undefined}
              className={days === range ? buttonClass.primary : buttonClass.secondary}>{t.ranges[range]}</a>
          ))}
        </nav>
        <p className="text-xs text-muted">{t.updated}: <LocalTime iso={report.generatedAt} locale={locale} /></p>
      </div>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">{t.daily}</h3>
          <p className="text-sm text-muted">{t.count}: <strong className="text-fg tabular-nums">{number.format(periodCount)}</strong></p>
        </div>
        <div className="mt-6 flex h-40 items-end gap-1 border-b border-border" aria-hidden="true">
          {report.series.map((row) => (
            <div key={row.day} className="min-w-0 flex-1 rounded-t bg-accent"
              title={`${formatDay(row.day)}: ${number.format(row.count)}`}
              style={{ height: `${row.count / maximum * 100}%` }} />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted">
          <time dateTime={report.series[0].day}>{formatDay(report.series[0].day)}</time>
          <time dateTime={report.series.at(-1)!.day}>{formatDay(report.series.at(-1)!.day)}</time>
        </div>
        {periodCount === 0 ? <p className="mt-4 text-sm text-muted">{t.empty}</p> : null}
        <details className="mt-5">
          <summary className="cursor-pointer text-sm font-medium text-link">{t.dailyTable}</summary>
          <div className="mt-3 max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted"><th className="py-2 font-medium">{t.day}</th><th className="py-2 text-right font-medium">{t.count}</th></tr></thead>
              <tbody>{[...report.series].reverse().map((row) => (
                <tr key={row.day} className="border-t border-border"><td className="py-2"><time dateTime={row.day}>{row.day}</time></td><td className="py-2 text-right tabular-nums">{number.format(row.count)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="text-lg font-semibold">{t.packages}</h3>
          <p className="mt-1 text-xs text-muted">{t.ranges[days]}</p>
          <table className="mt-4 w-full text-sm">
            <thead><tr className="text-left text-muted"><th className="pb-2 font-medium">{t.packages}</th><th className="pb-2 text-right font-medium">{t.count}</th></tr></thead>
            <tbody>{report.assets.map((row) => (
              <tr key={row.asset} className="border-t border-border"><td className="py-3">{t.assets[row.asset]}</td><td className="py-3 text-right font-semibold tabular-nums">{number.format(row.count)}</td></tr>
            ))}</tbody>
          </table>
        </Card>
        <Card>
          <h3 className="text-lg font-semibold">{t.githubTitle}</h3>
          <p className="mt-1 text-sm font-medium">{release.version ?? "—"}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted">{t.githubNote}</p>
          {githubAvailable ? (
            <table className="mt-4 w-full text-sm">
              <thead><tr className="text-left text-muted"><th className="pb-2 font-medium">{t.packages}</th><th className="pb-2 text-right font-medium">{t.githubCount}</th></tr></thead>
              <tbody>{report.assets.map((row) => (
                <tr key={row.asset} className="border-t border-border"><td className="py-3">{t.assets[row.asset]}</td><td className="py-3 text-right font-semibold tabular-nums">{release.assets[row.asset]?.downloadCount === undefined ? "—" : number.format(release.assets[row.asset]!.downloadCount!)}</td></tr>
              ))}</tbody>
            </table>
          ) : <p className="mt-4 text-sm text-muted">{t.githubUnavailable}</p>}
        </Card>
      </div>

      <div className="mt-6 grid items-start gap-6 md:grid-cols-3">
        {breakdowns.map((group) => (
          <Card key={group.title}>
            <h3 className="text-lg font-semibold">{group.title}</h3>
            <p className="mt-1 text-xs text-muted">{t.ranges[days]}</p>
            {group.rows.length ? <dl className="mt-4 space-y-3">{group.rows.map((row) => (
              <div key={row.label} className="flex justify-between gap-3 text-sm"><dt className="break-all">{row.label}</dt><dd className="font-semibold tabular-nums">{number.format(row.count)}</dd></div>
            ))}</dl> : <p className="mt-4 text-sm text-muted">{t.empty}</p>}
          </Card>
        ))}
      </div>
    </Container>
  );
}
