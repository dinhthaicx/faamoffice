"use client";

import { useId, useState, type FormEvent } from "react";
import { saveSettings, Status } from "./site-settings-form";
import { buttonClass, cx } from "./ui";
import { msStoreUrl } from "@/lib/site";
import {
  AD_SLOT_KEYS,
  ADS_TXT_TEXT_MAX,
  settingsFieldErrors,
  settingValueSchemas,
  type AdsSettings as AdsConfig,
  type MsStoreSettings as StoreConfig,
  type SettingsErrorCode,
} from "@/lib/site-settings-shared";
import type { Dictionary } from "@/i18n";

type SettingsDict = Dictionary["admin"]["settings"];
type Message = { error: string | null; success: string | null };
const emptyMessage: Message = { error: null, success: null };
const inputClass = "block w-full rounded-lg border bg-bg px-3 py-2.5 text-base text-fg focus:border-accent sm:text-sm";

function SettingsToggle({
  enabled,
  pending,
  label,
  title,
  onClick,
}: {
  enabled: boolean;
  pending: boolean;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-busy={pending}
      disabled={pending}
      onClick={onClick}
      title={title}
      className="mt-5 inline-flex items-center gap-3 text-sm font-medium disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className={cx(
          "inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors",
          enabled ? "border-accent bg-accent" : "border-border-strong bg-bg-muted",
        )}
      >
        <span className={cx("h-5 w-5 rounded-full bg-card shadow transition-transform", enabled ? "translate-x-6" : "translate-x-1")} />
      </span>
      {label}
    </button>
  );
}

function SettingsHeading({ id, title, enabled, on, off }: { id: string; title: string; enabled: boolean; on: string; off: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-semibold", enabled ? "bg-success-bg text-success-fg" : "bg-warn-bg text-warn-fg")}>
        {enabled ? on : off}
      </span>
    </div>
  );
}

export function AdsSettings({ initial, t, errors }: { initial: AdsConfig; t: SettingsDict; errors: Record<string, string> }) {
  const a = t.ads;
  const ids = useId();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, SettingsErrorCode>>({});
  const [msg, setMsg] = useState<Message>(emptyMessage);
  // The toggle only saves the persisted configuration; edits wait for Save.
  const dirty = JSON.stringify({ ...draft, enabled: saved.enabled }) !== JSON.stringify(saved);

  function edit(patch: Partial<AdsConfig>) {
    setDraft({ ...draft, ...patch });
    setFieldErrors({});
    setMsg(emptyMessage);
  }

  async function toggle() {
    if (pending) return;
    const enabled = !saved.enabled;
    if (enabled && !saved.publisherId) {
      setMsg({ error: a.needPublisher, success: null });
      return;
    }
    if (!window.confirm(enabled ? a.confirmOn : a.confirmOff)) return;
    setPending(true);
    setMsg(emptyMessage);
    const result = await saveSettings({ ads: { ...saved, enabled } }, errors);
    setPending(false);
    if (!result.ok) {
      setMsg({ error: result.message, success: null });
      return;
    }
    setSaved(result.settings.ads);
    setMsg({ error: null, success: result.settings.ads.enabled ? a.turnedOn : a.turnedOff });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = settingValueSchemas.ads.safeParse({ ...draft, enabled: saved.enabled });
    if (!parsed.success) {
      setFieldErrors(settingsFieldErrors(parsed.error.issues.map((issue) => ({ ...issue, path: ["ads", ...issue.path] }))));
      setMsg({ error: a.fixErrors, success: null });
      return;
    }
    setPending(true);
    setFieldErrors({});
    setMsg(emptyMessage);
    const result = await saveSettings({ ads: parsed.data }, errors);
    setPending(false);
    if (!result.ok) {
      setFieldErrors(result.fields ?? {});
      setMsg({ error: result.fields ? a.fixErrors : result.message, success: null });
      return;
    }
    setSaved(result.settings.ads);
    setDraft(result.settings.ads);
    setMsg({ error: null, success: a.saved });
  }

  const adsTxtErrors = Object.entries(fieldErrors).filter(([field]) => field.startsWith("ads.adsTxtExtra"));
  function errorText(field: string) {
    const error = fieldErrors[field];
    return error ? t.errors[error] : null;
  }
  function fieldProps(field: string) {
    const id = `${ids}-${field}`;
    const invalid = Boolean(fieldErrors[field]);
    return {
      id,
      name: field,
      "aria-invalid": invalid || undefined,
      "aria-describedby": `${id}-hint${invalid ? ` ${id}-error` : ""}`,
      className: cx(inputClass, invalid ? "border-danger" : "border-border-strong"),
    };
  }

  return (
    <section aria-labelledby={`${ids}-title`} className="rounded-2xl border border-border bg-card p-6">
      <SettingsHeading id={`${ids}-title`} title={a.title} enabled={saved.enabled} on={a.on} off={a.off} />
      <p className="mt-3 text-sm leading-relaxed text-muted">{saved.enabled ? a.explainOn : a.explainOff}</p>
      <SettingsToggle enabled={saved.enabled} pending={pending} label={a.switchLabel} title={saved.enabled ? a.turnOff : a.turnOn} onClick={toggle} />
      <form onSubmit={save} noValidate className="mt-6 border-t border-border pt-5">
        <fieldset disabled={pending} className="space-y-5 disabled:opacity-60">
          <div>
            <label htmlFor={`${ids}-ads.publisherId`} className="block text-sm font-medium">
              {a.publisherId}
            </label>
            <input
              {...fieldProps("ads.publisherId")}
              type="text"
              value={draft.publisherId ?? ""}
              placeholder="ca-pub-1234567890123456"
              onChange={(e) => edit({ publisherId: e.target.value })}
            />
            {errorText("ads.publisherId") ? (
              <p id={`${ids}-ads.publisherId-error`} className="mt-1 text-xs text-danger-fg">
                {errorText("ads.publisherId")}
              </p>
            ) : null}
            <p id={`${ids}-ads.publisherId-hint`} className="mt-1.5 text-xs leading-relaxed text-muted">
              {a.publisherHint}
            </p>
          </div>
          <div>
            <label className="inline-flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={draft.autoAds} onChange={(e) => edit({ autoAds: e.target.checked })} className="h-4 w-4 accent-accent" />
              {a.autoAds}
            </label>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{a.autoAdsHint}</p>
          </div>
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-semibold">{a.slotsTitle}</legend>
            {AD_SLOT_KEYS.map((key) => {
              const field = `ads.slots.${key}`;
              return (
                <div key={key}>
                  <label htmlFor={`${ids}-${field}`} className="block text-sm font-medium">
                    {a[key]}
                  </label>
                  <input
                    {...fieldProps(field)}
                    type="text"
                    inputMode="numeric"
                    value={draft.slots[key] ?? ""}
                    onChange={(e) => edit({ slots: { ...draft.slots, [key]: e.target.value } })}
                  />
                  {errorText(field) ? (
                    <p id={`${ids}-${field}-error`} className="mt-1 text-xs text-danger-fg">
                      {errorText(field)}
                    </p>
                  ) : null}
                  <p id={`${ids}-${field}-hint`} className="mt-1.5 text-xs leading-relaxed text-muted">
                    {a.slotHint}
                  </p>
                </div>
              );
            })}
          </fieldset>
          <div>
            <label htmlFor={`${ids}-adsTxtExtra`} className="block text-sm font-medium">
              {a.adsTxt}
            </label>
            <textarea
              id={`${ids}-adsTxtExtra`}
              name="ads.adsTxtExtra"
              rows={5}
              maxLength={ADS_TXT_TEXT_MAX}
              value={draft.adsTxtExtra}
              onChange={(e) => edit({ adsTxtExtra: e.target.value })}
              aria-invalid={adsTxtErrors.length ? true : undefined}
              aria-describedby={`${ids}-adsTxtExtra-hint${adsTxtErrors.length ? ` ${ids}-adsTxtExtra-errors` : ""}`}
              className={cx(inputClass, "font-mono", adsTxtErrors.length ? "border-danger" : "border-border-strong")}
            />
            {adsTxtErrors.length ? (
              <div id={`${ids}-adsTxtExtra-errors`} className="mt-1 text-xs text-danger-fg">
                {adsTxtErrors.map(([field, code]) => (
                  <p key={field}>{t.errors[code].replace("{line}", String(Number(field.split(".")[2]) + 1))}</p>
                ))}
              </div>
            ) : null}
            <p id={`${ids}-adsTxtExtra-hint`} className="mt-1.5 text-xs leading-relaxed text-muted">
              {a.adsTxtHint}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={buttonClass.primary}>
              {pending ? t.saving : a.save}
            </button>
            <a href="/ads.txt" target="_blank" rel="noopener" className="text-sm text-link underline">
              {a.viewAdsTxt}
            </a>
            {dirty ? <span className="text-xs text-muted">{a.unsaved}</span> : null}
          </div>
        </fieldset>
      </form>
      <Status {...msg} />
      <details className="mt-5 border-t border-border pt-4 text-sm text-muted">
        <summary className="cursor-pointer font-medium">{a.checklistTitle}</summary>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-relaxed">
          {a.checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function MsStoreSettings({ initial, t, errors }: { initial: StoreConfig; t: SettingsDict; errors: Record<string, string> }) {
  const s = t.msStore;
  const ids = useId();
  const [saved, setSaved] = useState(initial);
  const [productId, setProductId] = useState(initial.productId);
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<SettingsErrorCode | null>(null);
  const [msg, setMsg] = useState<Message>(emptyMessage);

  async function persist(next: StoreConfig, toggle: boolean) {
    setPending(true);
    setFieldError(null);
    setMsg(emptyMessage);
    const result = await saveSettings({ msStore: next }, errors);
    setPending(false);
    if (!result.ok) {
      setFieldError(result.fields?.["msStore.productId"] ?? null);
      setMsg({ error: result.message, success: null });
      return;
    }
    setSaved(result.settings.msStore);
    if (!toggle) setProductId(result.settings.msStore.productId);
    setMsg({
      error: null,
      success: toggle ? (result.settings.msStore.enabled ? s.turnedOn : s.turnedOff) : s.saved,
    });
  }

  async function toggle() {
    if (pending) return;
    const enabled = !saved.enabled;
    if (!window.confirm(enabled ? s.confirmOn : s.confirmOff)) return;
    await persist({ ...saved, enabled }, true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = settingValueSchemas.msStore.safeParse({ enabled: saved.enabled, productId });
    if (!parsed.success) {
      setFieldError(settingsFieldErrors(parsed.error.issues).productId ?? "invalid");
      setMsg(emptyMessage);
      return;
    }
    await persist(parsed.data, false);
  }

  return (
    <section aria-labelledby={`${ids}-title`} className="rounded-2xl border border-border bg-card p-6">
      <SettingsHeading id={`${ids}-title`} title={s.title} enabled={saved.enabled} on={s.on} off={s.off} />
      <p className="mt-3 text-sm leading-relaxed text-muted">{saved.enabled ? s.explainOn : s.explainOff}</p>
      <SettingsToggle enabled={saved.enabled} pending={pending} label={s.switchLabel} title={saved.enabled ? s.turnOff : s.turnOn} onClick={toggle} />
      <form onSubmit={save} noValidate className="mt-6 border-t border-border pt-5">
        <label htmlFor={`${ids}-productId`} className="block text-sm font-medium">
          {s.productId}
        </label>
        <input
          id={`${ids}-productId`}
          name="msStore.productId"
          type="text"
          required
          disabled={pending}
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            setFieldError(null);
            setMsg(emptyMessage);
          }}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={`${ids}-hint${fieldError ? ` ${ids}-error` : ""}`}
          className={cx(inputClass, fieldError ? "border-danger" : "border-border-strong")}
        />
        {fieldError ? (
          <p id={`${ids}-error`} className="mt-1 text-xs text-danger-fg">
            {t.errors[fieldError]}
          </p>
        ) : null}
        <p id={`${ids}-hint`} className="mt-1.5 text-xs leading-relaxed text-muted">
          {s.productIdHint}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={buttonClass.secondary}>
            {pending ? t.saving : s.save}
          </button>
          <a href={msStoreUrl(saved.productId)} target="_blank" rel="noopener" className="text-sm text-link underline">
            {s.openStore}
          </a>
        </div>
      </form>
      <Status {...msg} />
    </section>
  );
}
