"use client";

import { useId, useState, type FormEvent } from "react";
import { BREVO_SMTP_HOST, brevoSettingsSchema, type BrevoSettingsForAdmin, type BrevoSettingsInput } from "@/lib/brevo-settings-shared";
import type { Dictionary } from "@/i18n";
import { buttonClass } from "./ui";
import { Status } from "./site-settings-form";

function editable(settings: BrevoSettingsForAdmin): BrevoSettingsInput {
  return {
    enabled: settings.enabled,
    senderEmail: settings.senderEmail,
    senderName: settings.senderName || "FaamOffice",
    smtpLogin: settings.smtpLogin,
    smtpPort: settings.smtpPort,
    smtpKey: "",
  };
}

export function BrevoSettingsForm({ initial, t, errors }: {
  initial: BrevoSettingsForAdmin;
  t: Dictionary["admin"]["settings"]["brevoEmail"];
  errors: Record<string, string>;
}) {
  const id = useId();
  const [saved, setSaved] = useState(initial);
  const [config, setConfig] = useState(() => editable(initial));
  const [pending, setPending] = useState<"test" | "save" | null>(null);
  const [verified, setVerified] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const parsed = brevoSettingsSchema.safeParse(config);
  const fingerprint = parsed.success ? JSON.stringify(parsed.data) : "";
  const ready = parsed.success && fingerprint === verified;

  function change(next: BrevoSettingsInput) {
    setConfig(next); setVerified(null); setError(null); setSuccess(null);
  }

  async function request(action: "test" | "save") {
    setError(null); setSuccess(null);
    if (!parsed.success) { setError(t.invalid); return; }
    if (config.enabled && !config.smtpKey?.trim() && !saved.hasSmtpKey) { setError(t.keyRequired); return; }
    if (action === "save" && config.enabled && !ready) { setError(t.testFirst); return; }
    setPending(action);
    try {
      const res = await fetch(`/api/admin/email-settings${action === "test" ? "/test" : ""}`, {
        method: action === "test" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json();
      if (!res.ok) { setError(errors[data.error] ?? errors.generic); setVerified(null); }
      else if (action === "test") { setVerified(fingerprint); setSuccess(t.tested); }
      else if (data.settings) {
        setSaved(data.settings); setConfig(editable(data.settings)); setVerified(null);
        setSuccess(config.enabled ? t.saved : t.disabled);
      } else setError(errors.generic);
    } catch { setError(errors.network); }
    finally { setPending(null); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void request("save"); }
  const inputClass = "mt-1 w-full rounded-lg border border-border-strong bg-card px-3 py-2.5 text-sm disabled:bg-bg-muted disabled:text-muted";
  return (
    <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-lg font-semibold">{t.title}</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${saved.enabled ? "bg-success-bg text-success-fg" : "bg-warn-bg text-warn-fg"}`}>
          {saved.enabled ? t.statusEnabled : t.statusDisabled}
        </span>
      </div>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{t.subtitle}</p>
      <p className="mt-2 text-sm text-muted">{saved.source === "environment" ? t.environment : t.setupHint}</p>
      <form onSubmit={submit} className="mt-4">
        <fieldset disabled={pending !== null}>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={config.enabled} onChange={(e) => change({ ...config, enabled: e.target.checked })} />
            {t.enable}
          </label>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-sender`} className="text-sm font-medium">{t.senderEmail}</label>
              <input id={`${id}-sender`} type="email" value={config.senderEmail} className={inputClass}
                required={config.enabled} maxLength={254} autoComplete="off" spellCheck={false}
                onChange={(e) => change({ ...config, senderEmail: e.target.value })} />
              <p className="mt-1 text-xs leading-relaxed text-muted">{t.senderHint}</p>
            </div>
            <div>
              <label htmlFor={`${id}-name`} className="text-sm font-medium">{t.senderName}</label>
              <input id={`${id}-name`} value={config.senderName} className={inputClass} required={config.enabled} maxLength={100}
                autoComplete="off" onChange={(e) => change({ ...config, senderName: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${id}-login`} className="text-sm font-medium">{t.smtpLogin}</label>
              <input id={`${id}-login`} value={config.smtpLogin} className={inputClass} required={config.enabled}
                maxLength={254} autoComplete="off" spellCheck={false}
                onChange={(e) => change({ ...config, smtpLogin: e.target.value })} />
              <p className="mt-1 text-xs leading-relaxed text-muted">{t.loginHint}</p>
            </div>
            <div>
              <label htmlFor={`${id}-key`} className="text-sm font-medium">{t.smtpKey}</label>
              <input id={`${id}-key`} type="password" value={config.smtpKey ?? ""} className={inputClass}
                maxLength={2048} autoComplete="new-password" spellCheck={false}
                placeholder={saved.hasSmtpKey ? t.keyStored : "xsmtpsib-…"}
                onChange={(e) => change({ ...config, smtpKey: e.target.value })} />
              <p className="mt-1 text-xs leading-relaxed text-muted">{saved.hasSmtpKey ? t.keepKey : t.keyHint}</p>
            </div>
            <div>
              <label htmlFor={`${id}-host`} className="text-sm font-medium">{t.host}</label>
              <input id={`${id}-host`} readOnly value={BREVO_SMTP_HOST} className={inputClass} />
            </div>
            <div>
              <label htmlFor={`${id}-port`} className="text-sm font-medium">{t.port}</label>
              <select id={`${id}-port`} value={config.smtpPort} className={inputClass}
                onChange={(e) => change({ ...config, smtpPort: Number(e.target.value) as 587 | 465 })}>
                <option value={587}>587 — STARTTLS</option>
                <option value={465}>465 — SSL/TLS</option>
              </select>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted">{t.testHint}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" disabled={!config.enabled} onClick={() => void request("test")} className={buttonClass.secondary}>
              {pending === "test" ? t.testing : t.test}
            </button>
            <button type="submit" disabled={config.enabled && !ready} className={buttonClass.primary}>
              {pending === "save" ? t.saving : t.save}
            </button>
          </div>
        </fieldset>
        <Status error={error} success={success} />
      </form>
      <a href="https://app.brevo.com" target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-sm font-semibold text-link hover:underline">{t.openBrevo}</a>
    </section>
  );
}
