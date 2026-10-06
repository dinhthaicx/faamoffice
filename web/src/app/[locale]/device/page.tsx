// Device verification page (RFC 8628 verification_uri). The desktop app opens
// /device?code=ABCD-EFGH; the proxy adds the locale prefix.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { ApiForm } from "@/components/api-form";
import { AuthShell } from "@/components/auth-shell";
import { LocalTime } from "@/components/local-time";
import { Alert, buttonClass } from "@/components/ui";
import { isActionable } from "@/lib/device-flow";
import { findDeviceRequest } from "@/lib/device-service";
import { privateMetadata } from "@/lib/seo";
import { getSession } from "@/lib/session";
import { normalizeUserCode } from "@/lib/user-code";
import { toLocale } from "@/i18n/config";
import { format, getDictionary } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[locale]/device">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  return privateMetadata(getDictionary(locale).device.metaTitle);
}

export default async function DevicePage({ params, searchParams }: PageProps<"/[locale]/device">) {
  const locale = toLocale((await params).locale);
  const sp = await searchParams;
  const dict = getDictionary(locale);
  const t = dict.device;
  const rawCode = typeof sp.code === "string" ? sp.code.slice(0, 32) : "";
  const code = normalizeUserCode(rawCode);

  const session = await getSession();
  if (!session) {
    const back = `/${locale}/device${code ? `?code=${encodeURIComponent(code)}` : ""}`;
    redirect(`/${locale}/login?next=${encodeURIComponent(back)}`);
  }
  const user = session.user;
  const row = code ? await findDeviceRequest(code) : null;
  const now = new Date();

  const enterForm = (
    <form method="get" action={`/${locale}/device`} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="code" className="block text-sm font-medium">
          {t.codeLabel}
        </label>
        <input
          id="code"
          name="code"
          defaultValue={rawCode}
          required
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          placeholder="ABCD-EFGH"
          className="block w-full rounded-lg border border-border-strong bg-bg px-3 py-3 text-center font-mono text-2xl uppercase tracking-[0.2em] text-fg"
        />
      </div>
      <button type="submit" className={`${buttonClass.primary} w-full`}>
        {t.continue}
      </button>
    </form>
  );

  let body: ReactNode;
  if (!rawCode) {
    body = (
      <>
        <p className="mb-4 text-sm text-muted">{t.enterText}</p>
        {enterForm}
      </>
    );
  } else if (!row) {
    body = (
      <>
        <Alert tone="danger" className="mb-5">
          {t.notFound}
        </Alert>
        {enterForm}
      </>
    );
  } else if (isActionable(row, now)) {
    body = (
      <>
        <h2 className="text-lg font-semibold">{t.confirmTitle}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{format(t.confirmText, { email: user.email })}</p>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border border-border bg-bg-soft p-4 text-sm">
          <dt className="text-muted">{t.codeShown}</dt>
          <dd className="font-mono text-lg font-semibold tracking-widest">{row.userCode}</dd>
          <dt className="text-muted">{t.deviceLabel}</dt>
          <dd className="break-words font-medium">{row.deviceName}</dd>
          <dt className="text-muted">{t.requestedAt}</dt>
          <dd>
            <LocalTime iso={row.createdAt.toISOString()} locale={locale} />
          </dd>
          <dt className="text-muted">{t.expiresAt}</dt>
          <dd>
            <LocalTime iso={row.expiresAt.toISOString()} locale={locale} />
          </dd>
        </dl>
        <p className="mt-4 text-xs text-muted">{t.warning}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <ApiForm
            action="/api/auth/device/approve"
            submitLabel={t.deny}
            errors={dict.errors}
            extra={{ user_code: row.userCode, action: "deny" }}
            after="refresh"
            variant="secondary"
            fullWidth
          />
          <ApiForm
            action="/api/auth/device/approve"
            submitLabel={t.approve}
            errors={dict.errors}
            extra={{ user_code: row.userCode, action: "approve" }}
            after="refresh"
            fullWidth
          />
        </div>
      </>
    );
  } else if (row.userId === user.id && (row.status === "approved" || row.status === "consumed")) {
    body = <Alert tone="success">{t.approved}</Alert>;
  } else if (row.userId === user.id && row.status === "denied") {
    body = <Alert>{t.denied}</Alert>;
  } else if (row.status === "pending") {
    body = (
      <>
        <Alert tone="danger" className="mb-5">
          {t.expired}
        </Alert>
        {enterForm}
      </>
    );
  } else {
    body = (
      <>
        <Alert tone="danger" className="mb-5">
          {t.used}
        </Alert>
        {enterForm}
      </>
    );
  }

  return (
    <AuthShell title={t.title} wide>
      {body}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs text-muted">
        <span>{format(t.signedInAs, { email: user.email })}</span>
        <ApiForm
          action="/api/auth/logout"
          submitLabel={t.notYou}
          errors={dict.errors}
          extra={{
            locale,
            next: `/${locale}/login?next=${encodeURIComponent(`/${locale}/device${code ? `?code=${code}` : ""}`)}`,
          }}
          variant="secondary"
        />
      </div>
    </AuthShell>
  );
}
