import type { Metadata } from "next";
import Link from "next/link";
import { ApiForm } from "@/components/api-form";
import { AuthShell } from "@/components/auth-shell";
import { Field } from "@/components/ui";
import { privateMetadata } from "@/lib/seo";
import { toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[locale]/forgot-password">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  return privateMetadata(getDictionary(locale).auth.forgot.metaTitle);
}

export default async function ForgotPasswordPage({ params }: PageProps<"/[locale]/forgot-password">) {
  const locale = toLocale((await params).locale);
  const dict = getDictionary(locale);
  const t = dict.auth.forgot;
  return (
    <AuthShell title={t.title} subtitle={t.subtitle}>
      <ApiForm
        action="/api/auth/forgot-password"
        submitLabel={t.submit}
        pendingLabel={t.pending}
        successMessage={t.done}
        errors={dict.errors}
        extra={{ locale }}
        after="none"
        replaceOnSuccess
        fullWidth
      >
        <Field label={t.email} name="email" type="email" autoComplete="email" required maxLength={254} autoFocus />
      </ApiForm>
      <p className="mt-6 text-center text-sm">
        <Link href={`/${locale}/login`} className="text-link hover:underline">
          {t.back}
        </Link>
      </p>
    </AuthShell>
  );
}
