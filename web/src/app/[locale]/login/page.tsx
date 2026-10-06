import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ApiForm } from "@/components/api-form";
import { AuthShell } from "@/components/auth-shell";
import { Alert, Field } from "@/components/ui";
import { safeNextPath } from "@/lib/auth";
import { privateMetadata } from "@/lib/seo";
import { getSession } from "@/lib/session";
import { toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[locale]/login">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  return privateMetadata(getDictionary(locale).auth.login.metaTitle);
}

export default async function LoginPage({ params, searchParams }: PageProps<"/[locale]/login">) {
  const locale = toLocale((await params).locale);
  const sp = await searchParams;
  const dict = getDictionary(locale);
  const t = dict.auth.login;
  const next = typeof sp.next === "string" ? safeNextPath(sp.next, "") : "";

  if (await getSession()) redirect(next || `/${locale}/account`);

  const withNext = (path: string) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

  return (
    <AuthShell title={t.title} subtitle={t.subtitle}>
      {sp.reset === "1" ? (
        <Alert tone="success" className="mb-5">
          {t.resetDone}
        </Alert>
      ) : null}
      {next.includes("/device") ? <Alert className="mb-5">{t.deviceHint}</Alert> : null}
      <ApiForm
        action="/api/auth/login"
        submitLabel={t.submit}
        pendingLabel={t.pending}
        errors={dict.errors}
        extra={next ? { locale, next } : { locale }}
        fullWidth
      >
        <div className="space-y-4">
          <Field label={t.email} name="email" type="email" autoComplete="email" required maxLength={254} autoFocus />
          <Field label={t.password} name="password" type="password" autoComplete="current-password" required maxLength={200} />
          <p className="text-right text-sm">
            <Link href={`/${locale}/forgot-password`} className="text-link hover:underline">
              {t.forgot}
            </Link>
          </p>
        </div>
      </ApiForm>
      <p className="mt-6 text-center text-sm text-muted">
        {t.noAccount}{" "}
        <Link href={withNext(`/${locale}/register`)} className="font-semibold text-link hover:underline">
          {t.register}
        </Link>
      </p>
    </AuthShell>
  );
}
