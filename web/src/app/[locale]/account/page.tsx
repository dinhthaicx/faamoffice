import type { Metadata } from "next";
import Link from "next/link";
import { ApiForm } from "@/components/api-form";
import { LocalTime } from "@/components/local-time";
import { Alert, buttonClass, Card, Container, cx, Field } from "@/components/ui";
import { configuredModels } from "@/lib/ai-proxy";
import { getAiQuota } from "@/lib/ai-quota";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PASSWORD_MIN_LENGTH } from "@/lib/password";
import { privateMetadata } from "@/lib/seo";
import { getSiteSettings } from "@/lib/site-settings";
import { toLocale } from "@/i18n/config";
import { format, getDictionary } from "@/i18n";

const USAGE_PAGE_SIZE = 20;

export async function generateMetadata({ params }: PageProps<"/[locale]/account">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  return privateMetadata(getDictionary(locale).account.metaTitle);
}

export default async function AccountPage({ params, searchParams }: PageProps<"/[locale]/account">) {
  const locale = toLocale((await params).locale);
  const sp = await searchParams;
  const user = await requirePageUser(locale, `/${locale}/account`);
  const dict = getDictionary(locale);
  const t = dict.account;
  const nf = new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US");
  const page = Math.max(1, Math.min(10_000, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1));

  const settings = await getSiteSettings();
  const creditsOn = settings.creditsEnabled;
  const [usageRows, tokens, ledger, quota] = await Promise.all([
    prisma.usageRecord.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * USAGE_PAGE_SIZE,
      take: USAGE_PAGE_SIZE + 1,
    }),
    prisma.apiToken.findMany({ where: { userId: user.id, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    creditsOn
      ? prisma.creditTransaction.findMany({ where: { userId: user.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 8 })
      : [],
    getAiQuota(user.id, settings),
  ]);
  const hasMoreUsage = usageRows.length > USAGE_PAGE_SIZE;
  const usage = usageRows.slice(0, USAGE_PAGE_SIZE);
  const models = configuredModels();

  const sectionLinks = [
    { href: "#overview", label: t.sections.overview },
    { href: "#usage", label: t.sections.usage },
    { href: "#devices", label: t.sections.devices },
    { href: "#security", label: t.sections.security },
  ];

  return (
    <Container className="py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t.title}</h1>
          <p className="mt-1 text-muted">{format(t.hello, { name: user.name })}</p>
        </div>
        <div className="flex items-center gap-2">
          {user.role === "ADMIN" ? (
            <Link href={`/${locale}/admin`} className={buttonClass.secondary}>
              {t.admin}
            </Link>
          ) : null}
          <ApiForm action="/api/auth/logout" submitLabel={t.signOut} errors={dict.errors} extra={{ locale }} variant="secondary" />
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {sp.welcome === "1" ? <Alert tone="success">{format(t.welcome, { email: user.email })}</Alert> : null}
        {!user.emailVerifiedAt ? (
          <Alert tone="warn" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{t.verifyBanner}</span>
            <ApiForm
              action="/api/account/resend-verification"
              submitLabel={t.resend}
              successMessage={t.resent}
              errors={dict.errors}
              extra={{ locale }}
              after="none"
              replaceOnSuccess
              variant="secondary"
            />
          </Alert>
        ) : null}
      </div>

      <nav aria-label={t.title} className="mt-6 flex flex-wrap gap-2 text-sm">
        {sectionLinks.map((s) => (
          <a key={s.href} href={s.href} className="rounded-full border border-border bg-card px-3 py-1.5 hover:bg-bg-muted">
            {s.label}
          </a>
        ))}
      </nav>

      {/* Overview */}
      <section id="overview" aria-labelledby="credits-title" className="mt-6 grid scroll-mt-24 gap-6 lg:grid-cols-5">
        {creditsOn ? (
          <Card className="lg:col-span-2">
            <h2 id="credits-title" className="text-lg font-semibold">
              {t.credits.title}
            </h2>
            <p className="mt-4 text-sm text-muted">{t.credits.balance}</p>
            <p className={cx("text-4xl font-extrabold tracking-tight", user.credits < 0 && "text-danger")}>
              {nf.format(user.credits)} <span className="text-base font-medium text-muted">{dict.common.credits}</span>
            </p>
            {user.credits < 0 ? (
              <Alert tone="warn" className="mt-4">
                {t.credits.negative}
              </Alert>
            ) : null}
            <p className="mt-4 text-sm leading-relaxed text-muted">{t.credits.explain}</p>

            <h3 className="mt-6 text-sm font-semibold">{t.credits.pricingTitle}</h3>
            {models ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-muted">
                    <tr>
                      <th scope="col" className="py-1.5 pr-3 font-medium">
                        {t.credits.pricingModel}
                      </th>
                      <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                        {t.credits.pricingInput}
                      </th>
                      <th scope="col" className="py-1.5 text-right font-medium">
                        {t.credits.pricingOutput}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((m) => (
                      <tr key={m.id} className="border-t border-border">
                        <td className="py-1.5 pr-3 font-mono text-xs">{m.id}</td>
                        <td className="py-1.5 pr-3 text-right">{nf.format(m.inputPer1K)}</td>
                        <td className="py-1.5 text-right">{nf.format(m.outputPer1K)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">{t.credits.notConfigured}</p>
            )}
          </Card>
        ) : (
          // Credits off: no balance or top-up text, only today's quota (when an admin set one).
          <Card className="lg:col-span-2">
            <h2 id="credits-title" className="text-lg font-semibold">
              {t.ai.title}
            </h2>
            {quota ? (
              <>
                <p className="mt-4 text-sm text-muted">{t.ai.today}</p>
                <p className="text-4xl font-extrabold tracking-tight">
                  {format(t.ai.quota, { used: nf.format(quota.used), limit: nf.format(quota.limit) })}
                </p>
                {quota.used >= quota.limit ? (
                  <Alert tone="warn" className="mt-4">
                    {t.ai.quotaReached}
                  </Alert>
                ) : null}
                <p className="mt-2 text-xs text-muted">{t.ai.quotaResets}</p>
              </>
            ) : (
              <p className="mt-4 text-sm text-muted">{t.ai.unlimited}</p>
            )}
            <p className="mt-4 text-sm leading-relaxed text-muted">{t.ai.explain}</p>
            <h3 className="mt-6 text-sm font-semibold">{t.ai.modelsTitle}</h3>
            {models ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {models.map((m) => (
                  <li key={m.id} className="rounded-full border border-border bg-bg-soft px-2.5 py-1 font-mono text-xs">
                    {m.id}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">{t.credits.notConfigured}</p>
            )}
          </Card>
        )}

        <div className="space-y-6 lg:col-span-3">
          <Card>
            <h2 className="text-lg font-semibold">{t.profile.title}</h2>
            <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted">{t.profile.email}</dt>
              <dd className="flex flex-wrap items-center gap-2 break-all">
                {user.email}
                <span
                  className={cx(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    user.emailVerifiedAt ? "bg-success-bg text-success-fg" : "bg-warn-bg text-warn-fg",
                  )}
                >
                  {user.emailVerifiedAt ? t.profile.verified : t.profile.unverified}
                </span>
              </dd>
              <dt className="text-muted">{t.profile.memberSince}</dt>
              <dd>
                <LocalTime iso={user.createdAt.toISOString()} locale={locale} dateOnly />
              </dd>
            </dl>
            <ApiForm
              action="/api/account/profile"
              submitLabel={t.profile.save}
              successMessage={t.profile.saved}
              errors={dict.errors}
              after="refresh"
              variant="secondary"
              className="mt-5"
            >
              <Field label={t.profile.name} name="name" defaultValue={user.name} required maxLength={80} autoComplete="name" />
            </ApiForm>
          </Card>

          {creditsOn ? (
            <Card>
              <h2 className="text-lg font-semibold">{t.credits.ledgerTitle}</h2>
              {ledger.length ? (
                <ul className="mt-3 divide-y divide-border text-sm">
                  {ledger.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-4 py-2">
                      <div className="min-w-0">
                        <p className="font-medium">{t.credits.reasons[entry.reason]}</p>
                        <p className="truncate text-xs text-muted">
                          <LocalTime iso={entry.createdAt.toISOString()} locale={locale} />
                          {entry.reason === "admin_adjust" && entry.note ? ` · ${entry.note}` : ""}
                        </p>
                      </div>
                      <span className={cx("shrink-0 font-semibold tabular-nums", entry.delta < 0 ? "text-muted" : "text-success-fg")}>
                        {entry.delta > 0 ? "+" : ""}
                        {nf.format(entry.delta)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted">{t.credits.ledgerEmpty}</p>
              )}
            </Card>
          ) : null}
        </div>
      </section>

      {/* Usage */}
      <section id="usage" aria-labelledby="usage-title" className="mt-10 scroll-mt-24">
        <h2 id="usage-title" className="text-xl font-semibold">
          {t.usage.title}
        </h2>
        {usage.length ? (
          <>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-bg-soft text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">{t.usage.time}</th>
                    <th scope="col" className="px-4 py-3 font-medium">{t.usage.model}</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">{t.usage.input}</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">{t.usage.output}</th>
                    {creditsOn ? <th scope="col" className="px-4 py-3 text-right font-medium">{t.usage.credits}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {usage.map((u) => (
                    <tr key={u.id} className="border-t border-border">
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <LocalTime iso={u.createdAt.toISOString()} locale={locale} />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">{u.model}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{nf.format(u.promptTokens)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{nf.format(u.completionTokens)}</td>
                      {creditsOn ? (
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {nf.format(u.credits)}
                          {u.estimated ? <span className="ml-1 text-xs text-muted">({t.usage.estimated})</span> : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav aria-label={t.usage.title} className="mt-3 flex items-center justify-between text-sm">
              {page > 1 ? (
                <Link href={`/${locale}/account?page=${page - 1}#usage`} className="text-link hover:underline">
                  ← {t.usage.prev}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted">{format(t.usage.page, { page })}</span>
              {hasMoreUsage ? (
                <Link href={`/${locale}/account?page=${page + 1}#usage`} className="text-link hover:underline">
                  {t.usage.next} →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          </>
        ) : (
          <p className="mt-3 rounded-2xl border border-dashed border-border p-6 text-sm text-muted">{t.usage.empty}</p>
        )}
      </section>

      {/* Devices */}
      <section id="devices" aria-labelledby="devices-title" className="mt-10 scroll-mt-24">
        <h2 id="devices-title" className="text-xl font-semibold">
          {t.devices.title}
        </h2>
        <p className="mt-1 text-sm text-muted">{t.devices.subtitle}</p>
        {tokens.length ? (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-bg-soft text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">{t.devices.name}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t.devices.created}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t.devices.lastUsed}</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">{t.devices.revoke}</span></th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((tok) => (
                  <tr key={tok.id} className="border-t border-border">
                    <td className="px-4 py-2.5 font-medium">{tok.name}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <LocalTime iso={tok.createdAt.toISOString()} locale={locale} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {tok.lastUsedAt ? <LocalTime iso={tok.lastUsedAt.toISOString()} locale={locale} /> : t.devices.never}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <ApiForm
                        action="/api/account/tokens/revoke"
                        submitLabel={t.devices.revoke}
                        errors={dict.errors}
                        extra={{ id: tok.id }}
                        confirmText={t.devices.revokeConfirm}
                        after="refresh"
                        variant="secondary"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 rounded-2xl border border-dashed border-border p-6 text-sm text-muted">{t.devices.empty}</p>
        )}
      </section>

      {/* Security */}
      <section id="security" aria-labelledby="security-title" className="mt-10 grid scroll-mt-24 gap-6 lg:grid-cols-2">
        <Card>
          <h2 id="security-title" className="text-lg font-semibold">
            {t.security.title}
          </h2>
          <ApiForm
            action="/api/account/password"
            submitLabel={t.security.submit}
            successMessage={t.security.done}
            errors={dict.errors}
            after="none"
            resetOnSuccess
            className="mt-4"
          >
            <div className="space-y-4">
              <Field label={t.security.current} name="currentPassword" type="password" autoComplete="current-password" required maxLength={200} />
              <Field
                label={t.security.next}
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={200}
                hint={t.security.hint}
              />
            </div>
          </ApiForm>
        </Card>
        <Card className="border-danger/40">
          <h2 className="text-lg font-semibold text-danger-fg">{t.danger.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t.danger.text}</p>
          <ApiForm
            action="/api/account/delete"
            submitLabel={t.danger.submit}
            errors={dict.errors}
            extra={{ locale }}
            confirmText={t.danger.confirm}
            variant="danger"
            className="mt-4"
          >
            <Field label={t.danger.password} name="password" type="password" autoComplete="current-password" required maxLength={200} />
          </ApiForm>
        </Card>
      </section>
    </Container>
  );
}
