import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ApiForm } from "@/components/api-form";
import { AuthShell } from "@/components/auth-shell";
import { Field } from "@/components/ui";
import { safeNextPath } from "@/lib/auth";
import { getConfig } from "@/lib/env";
import { privateMetadata } from "@/lib/seo";
import { getSession } from "@/lib/session";
import { getSiteSettings } from "@/lib/site-settings";
import { PASSWORD_MIN_LENGTH } from "@/lib/password";
import { toLocale } from "@/i18n/config";
import { format, getDictionary } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[locale]/register">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  return privateMetadata(getDictionary(locale).auth.register.metaTitle);
}

export default async function RegisterPage({ params, searchParams }: PageProps<"/[locale]/register">) {
  const locale = toLocale((await params).locale);
  const sp = await searchParams;
  const dict = getDictionary(locale);
  const t = dict.auth.register;
  const next = typeof sp.next === "string" ? safeNextPath(sp.next, "") : "";

  if (await getSession()) redirect(next || `/${locale}/account`);

  // The sign-up bonus is only advertised while Faam credits are on (it is still granted silently when off).
  const bonus = (await getSiteSettings()).creditsEnabled ? getConfig().signupBonusCredits : 0;
  const [beforeTerms, rest] = t.agree.split("{terms}");
  const [between, afterPrivacy] = (rest ?? "").split("{privacy}");

  return (
    <AuthShell title={t.title} subtitle={bonus > 0 ? format(t.subtitle, { credits: bonus }) : t.subtitleNoBonus}>
      <ApiForm
        action="/api/auth/register"
        submitLabel={t.submit}
        pendingLabel={t.pending}
        errors={dict.errors}
        extra={next ? { locale, next } : { locale }}
        fullWidth
      >
        <div className="space-y-4">
          <Field label={t.name} name="name" autoComplete="name" required maxLength={80} autoFocus />
          <Field label={t.email} name="email" type="email" autoComplete="email" required maxLength={254} />
          <Field
            label={t.password}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={200}
            hint={t.passwordHint}
          />
          <p className="text-xs leading-relaxed text-muted">
            {beforeTerms}
            <Link href={`/${locale}/terms`} className="text-link hover:underline">
              {dict.footer.terms}
            </Link>
            {between}
            <Link href={`/${locale}/privacy`} className="text-link hover:underline">
              {dict.footer.privacy}
            </Link>
            {afterPrivacy}
          </p>
        </div>
      </ApiForm>
      <p className="mt-6 text-center text-sm text-muted">
        {t.haveAccount}{" "}
        <Link
          href={next ? `/${locale}/login?next=${encodeURIComponent(next)}` : `/${locale}/login`}
          className="font-semibold text-link hover:underline"
        >
          {t.login}
        </Link>
      </p>
    </AuthShell>
  );
}
