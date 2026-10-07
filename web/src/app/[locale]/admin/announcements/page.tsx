import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav } from "@/components/admin-nav";
import { ApiForm } from "@/components/api-form";
import { LocalTime } from "@/components/local-time";
import { buttonClass, Container, cx } from "@/components/ui";
import { parseStoredPlatforms } from "@/lib/announcement-shared";
import { requirePageAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { privateMetadata } from "@/lib/seo";
import type { AnnouncementLevel } from "@/generated/prisma/client";
import { toLocale } from "@/i18n/config";
import { format, getDictionary } from "@/i18n";

const PAGE_SIZE = 25;

const LEVEL_BADGE: Record<AnnouncementLevel, string> = {
  info: "bg-bg-muted text-fg",
  warning: "bg-warn-bg text-warn-fg",
  critical: "bg-danger-bg text-danger-fg",
};

type WindowState = "live" | "scheduled" | "expired";

function windowState(a: { startsAt: Date; endsAt: Date | null }, now: number): WindowState {
  if (a.startsAt.getTime() > now) return "scheduled";
  if (a.endsAt && a.endsAt.getTime() <= now) return "expired";
  return "live";
}

const STATE_BADGE: Record<WindowState, string> = {
  live: "bg-success-bg text-success-fg",
  scheduled: "bg-bg-muted text-fg",
  expired: "bg-bg-muted text-muted",
};

async function loadPage(page: number) {
  const [total, rows] = await Promise.all([
    prisma.announcement.count(),
    prisma.announcement.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        status: true,
        kind: true,
        level: true,
        displayMode: true,
        titleVi: true,
        titleEn: true,
        platforms: true,
        minVersion: true,
        maxVersion: true,
        startsAt: true,
        endsAt: true,
        priority: true,
      },
    }),
  ]);
  return { total, rows, now: Date.now() };
}

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/announcements">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  return privateMetadata(getDictionary(locale).admin.announcements.metaTitle);
}

export default async function AdminAnnouncementsPage({ params, searchParams }: PageProps<"/[locale]/admin/announcements">) {
  const locale = toLocale((await params).locale);
  const sp = await searchParams;
  await requirePageAdmin(locale, `/${locale}/admin/announcements`);
  const dict = getDictionary(locale);
  const t = dict.admin.announcements;
  const nf = new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US");
  const page = Math.max(1, Math.min(10_000, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1));
  const { total, rows, now } = await loadPage(page);
  const pageHref = (p: number) => `/${locale}/admin/announcements?page=${p}`;

  const versions = (min: string | null, max: string | null) =>
    min && max ? `${min} – ${max}` : min ? `≥ ${min}` : max ? `≤ ${max}` : t.anyVersion;

  return (
    <Container className="py-10">
      <h1 className="text-3xl font-bold tracking-tight">{dict.admin.title}</h1>
      <AdminNav locale={locale} dict={dict} current="announcements" />

      <section aria-labelledby="announcements-title" className="mt-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <h2 id="announcements-title" className="text-xl font-semibold">
              {t.title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">{t.subtitle}</p>
            <p className="mt-1 text-sm text-muted">{format(t.total, { count: nf.format(total) })}</p>
          </div>
          <Link href={`/${locale}/admin/announcements/new`} className={cx(buttonClass.primary, "shrink-0")}>
            {t.new}
          </Link>
        </div>

        {rows.length ? (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-bg-soft text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">{t.columns.title}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t.columns.status}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t.columns.kind}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t.columns.level}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t.columns.displayMode}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t.columns.window}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t.columns.platforms}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t.columns.versions}</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">{t.columns.priority}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t.columns.actions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const title = (locale === "en" ? a.titleEn || a.titleVi : a.titleVi) || t.untitled;
                  const platforms = parseStoredPlatforms(a.platforms);
                  const state = windowState(a, now);
                  const published = a.status === "published";
                  return (
                    <tr key={a.id} className="border-t border-border align-top">
                      <td className="max-w-xs px-4 py-3">
                        <Link href={`/${locale}/admin/announcements/${a.id}`} className="font-medium text-link hover:underline">
                          {title}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={cx(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            published ? "bg-success-bg text-success-fg" : "bg-bg-muted text-muted",
                          )}
                        >
                          {t.status[a.status]}
                        </span>
                        {published ? (
                          <span className={cx("ml-1 rounded-full px-2 py-0.5 text-xs", STATE_BADGE[state])}>{t.state[state]}</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{t.kind[a.kind]}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", LEVEL_BADGE[a.level])}>{t.level[a.level]}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{t.displayMode[a.displayMode]}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">
                        <LocalTime iso={a.startsAt.toISOString()} locale={locale} />
                        <br />
                        <span className="text-muted">→ </span>
                        {a.endsAt ? <LocalTime iso={a.endsAt.toISOString()} locale={locale} /> : <span className="text-muted">{t.noEnd}</span>}
                      </td>
                      <td className="px-4 py-3">
                        {platforms.length ? platforms.map((p) => t.platform[p]).join(", ") : <span className="text-muted">{t.allPlatforms}</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{versions(a.minVersion, a.maxVersion)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{nf.format(a.priority)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-start gap-2">
                          <ApiForm
                            action={`/api/admin/announcements/${a.id}/status`}
                            submitLabel={published ? t.unpublish : t.publish}
                            errors={dict.errors}
                            extra={{ status: published ? "draft" : "published" }}
                            confirmText={published ? undefined : t.confirmPublish}
                            after="refresh"
                            variant={published ? "secondary" : "primary"}
                          />
                          <Link href={`/${locale}/admin/announcements/${a.id}`} className={buttonClass.secondary}>
                            {t.edit}
                          </Link>
                          <ApiForm
                            action={`/api/admin/announcements/${a.id}/delete`}
                            submitLabel={t.delete}
                            errors={dict.errors}
                            confirmText={t.confirmDelete}
                            after="refresh"
                            variant="danger"
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed border-border p-6 text-sm text-muted">{t.empty}</p>
        )}

        <nav aria-label={t.title} className="mt-3 flex justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="text-link hover:underline">
              ← {dict.admin.users.prev}
            </Link>
          ) : (
            <span />
          )}
          {page * PAGE_SIZE < total ? (
            <Link href={pageHref(page + 1)} className="text-link hover:underline">
              {dict.admin.users.next} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </section>
    </Container>
  );
}
