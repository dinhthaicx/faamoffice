import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Alert, buttonClass } from "@/components/ui";
import { privateMetadata } from "@/lib/seo";
import { verifyEmailToken } from "@/lib/users";
import { toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[locale]/verify-email">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  return { ...privateMetadata(getDictionary(locale).auth.verify.metaTitle), referrer: "no-referrer" };
}

export default async function VerifyEmailPage({ params, searchParams }: PageProps<"/[locale]/verify-email">) {
  const locale = toLocale((await params).locale);
  const sp = await searchParams;
  const t = getDictionary(locale).auth.verify;
  const token = typeof sp.token === "string" ? sp.token : "";
  const ok = token ? await verifyEmailToken(token) : false;

  return (
    <AuthShell title={ok ? t.successTitle : t.failTitle}>
      <Alert tone={ok ? "success" : "danger"}>{ok ? t.successText : t.failText}</Alert>
      <Link href={`/${locale}/account`} className={`${buttonClass.primary} mt-5 w-full`} prefetch={false}>
        {t.goAccount}
      </Link>
    </AuthShell>
  );
}
