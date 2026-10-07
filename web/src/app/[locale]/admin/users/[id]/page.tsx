import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiForm } from "@/components/api-form";
import { LocalTime } from "@/components/local-time";
import { Card, Container, cx, Field } from "@/components/ui";
import { quotaDayStart } from "@/lib/ai-quota";
import { requirePageAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { privateMetadata } from "@/lib/seo";
import { getSiteSettings } from "@/lib/site-settings";
import { toLocale } from "@/i18n/config";
import { format, getDictionary } from "@/i18n";

const DAY = 86_400_000;

// The locale layout restricts params to known locales; user ids are dynamic.
export const dynamicParams = true;

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/users/[id]">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  return privateMetadata(getDictionary(locale).admin.metaTitle);
}

export default async function AdminUserPage({ params }: PageProps<"/[locale]/admin/users/[id]">) {
  const { locale: rawLocale, id } = await params;
  const locale = toLocale(rawLocale);
  const admin = await requirePageAdmin(locale, `/${locale}/admin/users/${id}`);
  const dict = getDictionary(locale);
  const t = dict.admin.detail;
  const nf = new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US");

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) notFound();

  const now = new Date();
  const [ledger, tokens, usage, settings, requestsToday, usage30] = await Promise.all([
    prisma.creditTransaction.findMany({
      where: { userId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      include: { actor: { select: { email: true } } },
    }),
    prisma.apiToken.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.usageRecord.findMany({ where: { userId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 }),
    getSiteSettings(),
    prisma.usageRecord.count({ where: { userId: id, createdAt: { gte: quotaDayStart(now) } } }),
    prisma.usageRecord.aggregate({
      _count: true,
      _sum: { promptTokens: true, completionTokens: true },
      where: { userId: id, createdAt: { gte: new Date(now.getTime() - 30 * DAY) } },
    }),
  ]);
  const isSelf = admin.id === user.id;
  const creditsOn = settings.creditsEnabled;
  const tokens30 = (usage30._sum.promptTokens ?? 0) + (usage30._sum.completionTokens ?? 0);
  const limit = settings.aiDailyRequestLimit;

  const ledgerTable = ledger.length ? (
    <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-bg-soft text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">{t.time}</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">{t.change}</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">{t.balanceAfter}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t.reasonCol}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t.note}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t.by}</th>
          </tr>
        </thead>
        <tbody>
          {ledger.map((e) => (
            <tr key={e.id} className="border-t border-border">
              <td className="whitespace-nowrap px-4 py-2.5">
                <LocalTime iso={e.createdAt.toISOString()} locale={locale} />
              </td>
              <td className={cx("px-4 py-2.5 text-right tabular-nums", e.delta > 0 && "text-success-fg")}>
                {e.delta > 0 ? "+" : ""}
                {nf.format(e.delta)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{nf.format(e.balanceAfter)}</td>
              <td className="px-4 py-2.5">{dict.account.credits.reasons[e.reason]}</td>
              <td className="max-w-xs truncate px-4 py-2.5 text-muted" title={e.note ?? undefined}>
                {e.note}
              </td>
              <td className="px-4 py-2.5 text-muted">{e.actor?.email ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="mt-3 text-sm text-muted">{t.none}</p>
  );

  return (
    <Container className="py-10">
      <Link href={`/${locale}/admin`} className="text-sm text-link hover:underline">
        {t.back}
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="break-all text-2xl font-bold tracking-tight">{user.email}</h1>
        <span
          className={cx(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            user.disabledAt ? "bg-danger-bg text-danger-fg" : "bg-success-bg text-success-fg",
          )}
        >
          {user.disabledAt ? dict.admin.users.disabled : dict.admin.users.active}
        </span>
      </div>
      <p className="mt-1 text-muted">{user.name}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">ID</dt>
            <dd className="break-all font-mono text-xs">{user.id}</dd>
            <dt className="text-muted">{t.role}</dt>
            <dd>{user.role}</dd>
            <dt className="text-muted">{t.verified}</dt>
            <dd>{user.emailVerifiedAt ? dict.account.profile.verified : dict.account.profile.unverified}</dd>
            <dt className="text-muted">{t.created}</dt>
            <dd>
              <LocalTime iso={user.createdAt.toISOString()} locale={locale} />
            </dd>
            {creditsOn ? (
              <>
                <dt className="text-muted">{t.balance}</dt>
                <dd className={cx("text-lg font-bold tabular-nums", user.credits < 0 && "text-danger")}>{nf.format(user.credits)}</dd>
              </>
            ) : (
              <>
                <dt className="text-muted">{t.requestsToday}</dt>
                <dd className="text-lg font-bold tabular-nums">
                  {nf.format(requestsToday)}
                  {limit > 0 ? <span className="text-sm font-medium text-muted"> / {nf.format(limit)}</span> : null}
                </dd>
                <dt className="text-muted">{t.requests30}</dt>
                <dd className="tabular-nums">{nf.format(usage30._count)}</dd>
                <dt className="text-muted">{t.tokens30}</dt>
                <dd className="tabular-nums">{nf.format(tokens30)}</dd>
              </>
            )}
          </dl>
        </Card>

        <Card>
          <h2 className="font-semibold">{t.adjustTitle}</h2>
          {!creditsOn ? (
            <p className="mt-2 rounded-lg bg-bg-soft px-3 py-2 text-xs leading-relaxed text-muted">
              {format(t.creditsOffNote, { balance: nf.format(user.credits) })}
            </p>
          ) : null}
          <ApiForm
            action={`/api/admin/users/${user.id}/credits`}
            submitLabel={t.adjustSubmit}
            successMessage={t.adjustDone}
            errors={dict.errors}
            after="refresh"
            resetOnSuccess
            className="mt-4"
          >
            <div className="space-y-4">
              <Field label={t.amount} name="delta" type="number" required inputMode="numeric" placeholder="100" />
              <Field label={t.reason} name="note" required minLength={3} maxLength={300} hint={t.reasonHint} />
            </div>
          </ApiForm>
        </Card>

        <Card>
          <h2 className="font-semibold">{t.statusTitle}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t.statusText}</p>
          {isSelf ? (
            <p className="mt-4 text-sm text-muted">{t.self}</p>
          ) : user.disabledAt ? (
            <ApiForm
              action={`/api/admin/users/${user.id}/status`}
              submitLabel={t.enable}
              errors={dict.errors}
              extra={{ disabled: false }}
              after="refresh"
              className="mt-4"
            />
          ) : (
            <ApiForm
              action={`/api/admin/users/${user.id}/status`}
              submitLabel={t.disable}
              errors={dict.errors}
              extra={{ disabled: true }}
              confirmText={t.confirmDisable}
              after="refresh"
              variant="danger"
              className="mt-4"
            />
          )}
        </Card>
      </div>

      {creditsOn ? (
        <section aria-labelledby="ledger-title" className="mt-10">
          <h2 id="ledger-title" className="text-lg font-semibold">
            {t.ledgerTitle}
          </h2>
          {ledgerTable}
        </section>
      ) : (
        // Credits off: the (preserved) ledger stays reachable but collapsed.
        <details className="mt-10">
          <summary className="cursor-pointer text-lg font-semibold">{t.ledgerTitle}</summary>
          {ledgerTable}
        </details>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="tokens-title">
          <h2 id="tokens-title" className="text-lg font-semibold">
            {t.tokensTitle}
          </h2>
          {tokens.length ? (
            <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card text-sm">
              {tokens.map((tok) => (
                <li key={tok.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className={cx("font-medium", tok.revokedAt && "text-muted line-through")}>{tok.name}</span>
                  <span className="text-xs text-muted">
                    {tok.revokedAt ? (
                      t.revoked
                    ) : tok.lastUsedAt ? (
                      <LocalTime iso={tok.lastUsedAt.toISOString()} locale={locale} />
                    ) : (
                      dict.account.devices.never
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">{t.none}</p>
          )}
        </section>
        <section aria-labelledby="usage-title">
          <h2 id="usage-title" className="text-lg font-semibold">
            {t.usageTitle}
          </h2>
          {usage.length ? (
            <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card text-sm">
              {usage.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span>
                    <span className="font-mono text-xs">{u.model}</span>
                    <span className="ml-2 text-xs text-muted">
                      {nf.format(u.promptTokens)} / {nf.format(u.completionTokens)}
                      {u.estimated ? ` (${dict.account.usage.estimated})` : ""}
                    </span>
                  </span>
                  {creditsOn ? <span className="tabular-nums">−{nf.format(u.credits)}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">{t.none}</p>
          )}
        </section>
      </div>
    </Container>
  );
}
