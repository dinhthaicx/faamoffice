import type { Metadata } from "next";
import Link from "next/link";
import { ApiForm } from "@/components/api-form";
import { AuthShell } from "@/components/auth-shell";
import { Alert, buttonClass, Field } from "@/components/ui";
import { PASSWORD_MIN_LENGTH } from "@/lib/password";
import { privateMetadata } from "@/lib/seo";
import { toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[locale]/reset-password">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  return { ...privateMetadata(getDictionary(locale).auth.reset.metaTitle), referrer: "no-referrer" };
}

export default async function ResetPasswordPage({ params, searchParams }: PageProps<"/[locale]/reset-password">) {
  const locale = toLocale((await params).locale);
  const sp = await searchParams;
  const dict = getDictionary(locale);
  const t = dict.auth.reset;
  const token = typeof sp.token === "string" && sp.token.length <= 128 ? sp.token : "";

  return (
    <AuthShell title={t.title} subtitle={token ? t.subtitle : undefined}>
      {token ? (
        <>
          <ApiForm
            action="/api/auth/reset-password"
            submitLabel={t.submit}
            pendingLabel={t.pending}
            errors={dict.errors}
            extra={{ locale, token }}
            fullWidth
          >
            <Field
              label={t.password}
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={200}
              hint={dict.auth.register.passwordHint}
              autoFocus
            />
          </ApiForm>
          <Link href={`/${locale}/forgot-password`} className={`${buttonClass.ghost} mt-4 w-full`}>
            {t.requestNew}
          </Link>
        </>
      ) : (
        <>
          <Alert tone="danger">{t.missing}</Alert>
          <Link href={`/${locale}/forgot-password`} className={`${buttonClass.primary} mt-5 w-full`}>
            {t.requestNew}
          </Link>
        </>
      )}
    </AuthShell>
  );
}
