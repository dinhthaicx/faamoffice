import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav } from "@/components/admin-nav";
import { LocalTime } from "@/components/local-time";
import { buttonClass, Card, Container, cx } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { privateMetadata } from "@/lib/seo";
import type { Prisma } from "@/generated/prisma/client";
import { toLocale } from "@/i18n/config";
import { format, getDictionary } from "@/i18n";

const PAGE_SIZE = 25;
const DAY = 86_400_000;

/** Dashboard counters: users, signed-in devices and Faam AI usage over 7/30 days. */
async function loadStats() {
  const now = Date.now();
  const since7 = new Date(now - 7 * DAY);
  const since30 = new Date(now - 30 * DAY);
  const [userCount, newUsers, activeTokens, used7, used30, requests30] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: since7 } } }),
    prisma.apiToken.count({ where: { revokedAt: null, user: { disabledAt: null } } }),
    prisma.usageRecord.aggregate({ _sum: { credits: true }, where: { createdAt: { gte: since7 } } }),
    prisma.usageRecord.aggregate({ _sum: { credits: true }, where: { createdAt: { gte: since30 } } }),
    prisma.usageRecord.count({ where: { createdAt: { gte: since30 } } }),
  ]);
  return {
    userCount,
    newUsers,
    activeTokens,
    credits7: used7._sum.credits ?? 0,
    credits30: used30._sum.credits ?? 0,
    requests30,
  };
}

export async function generateMetadata({ params }: PageProps<"/[locale]/admin">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  return privateMetadata(getDictionary(locale).admin.metaTitle);
}

export default async function AdminPage({ params, searchParams }: PageProps<"/[locale]/admin">) {
  const locale = toLocale((await params).locale);
  const sp = await searchParams;
  await requirePageAdmin(locale, `/${locale}/admin`);
  const dict = getDictionary(locale);
  const t = dict.admin;
  const nf = new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US");

  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const page = Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1);
  // SQLite LIKE is case-insensitive for ASCII; emails are stored lowercase.
  const where: Prisma.UserWhereInput = q
    ? { OR: [{ email: { contains: q.toLowerCase() } }, { name: { contains: q } }, { id: q }] }
    : {};

  const [s, total, users] = await Promise.all([
    loadStats(),
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const stats = [
    { label: t.stats.users, value: s.userCount },
    { label: t.stats.newUsers, value: s.newUsers },
    { label: t.stats.activeTokens, value: s.activeTokens },
    { label: t.stats.credits7, value: s.credits7 },
    { label: t.stats.credits30, value: s.credits30 },
    { label: t.stats.requests30, value: s.requests30 },
  ];
  const pageHref = (p: number) => `/${locale}/admin?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <Container className="py-10">
      <h1 className="text-3xl font-bold tracking-tight">{t.title}</h1>
      <AdminNav locale={locale} dict={dict} current="users" />

      <section aria-label={t.title} className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs text-muted">{s.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{nf.format(s.value)}</p>
          </Card>
        ))}
      </section>

      <section aria-labelledby="users-title" className="mt-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="users-title" className="text-xl font-semibold">
              {t.users.title}
            </h2>
            <p className="text-sm text-muted">{format(t.users.total, { count: nf.format(total) })}</p>
          </div>
          <form method="get" action={`/${locale}/admin`} role="search" className="flex gap-2">
            <label htmlFor="q" className="sr-only">
              {t.users.search}
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder={t.users.search}
              maxLength={100}
              className="w-64 rounded-lg border border-border-strong bg-bg px-3 py-2 text-sm"
            />
            <button type="submit" className={buttonClass.secondary}>
              {t.users.searchButton}
            </button>
          </form>
        </div>

        {users.length ? (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-bg-soft text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">{t.users.email}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t.users.name}</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">{t.users.credits}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t.users.created}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t.users.status}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-4 py-2.5">
                      <Link href={`/${locale}/admin/users/${u.id}`} className="font-medium text-link hover:underline">
                        {u.email}
                      </Link>
                      {u.role === "ADMIN" ? (
                        <span className="ml-2 rounded-full bg-bg-muted px-2 py-0.5 text-xs">{t.users.adminBadge}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">{u.name}</td>
                    <td className={cx("px-4 py-2.5 text-right tabular-nums", u.credits < 0 && "text-danger")}>{nf.format(u.credits)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <LocalTime iso={u.createdAt.toISOString()} locale={locale} dateOnly />
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cx(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          u.disabledAt ? "bg-danger-bg text-danger-fg" : "bg-success-bg text-success-fg",
                        )}
                      >
                        {u.disabledAt ? t.users.disabled : t.users.active}
                      </span>
                      {!u.emailVerifiedAt ? <span className="ml-2 text-xs text-muted">{t.users.unverified}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed border-border p-6 text-sm text-muted">{t.users.empty}</p>
        )}

        <nav aria-label={t.users.title} className="mt-3 flex justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="text-link hover:underline">
              ← {t.users.prev}
            </Link>
          ) : (
            <span />
          )}
          {page * PAGE_SIZE < total ? (
            <Link href={pageHref(page + 1)} className="text-link hover:underline">
              {t.users.next} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </section>
    </Container>
  );
}
