"use client";

// Admin Settings page: the Faam credits switch with the daily request limit,
// and the editor of the social links (add / edit / remove / reorder / show).
// Inputs are validated with the same zod schemas as PATCH /api/admin/settings;
// server-side field errors ("socialLinks.2.url": "wrong_host") land on the same
// inputs.

import { useId, useState, type FormEvent } from "react";
import { SocialIcon } from "./social-icons";
import { buttonClass, cx } from "./ui";
import {
  MAX_DAILY_REQUEST_LIMIT,
  MAX_SOCIAL_LINKS,
  newSocialId,
  SOCIAL_LABEL_MAX,
  SOCIAL_PLATFORM_HOSTS,
  SOCIAL_PLATFORMS,
  SOCIAL_URL_MAX,
  settingsFieldErrors,
  settingValueSchemas,
  socialLinksSchema,
  socialPlatformName,
  type SettingsErrorCode,
  type SiteSettings,
  type SocialPlatform,
} from "@/lib/site-settings-shared";
import type { Dictionary } from "@/i18n";

type SettingsDict = Dictionary["admin"]["settings"];
type FieldErrors = Record<string, SettingsErrorCode>;

type SaveResult =
  | { ok: true; settings: SiteSettings }
  | { ok: false; message: string; fields?: FieldErrors };

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/** PATCH /api/admin/settings with a partial body; maps API errors to localized text. */
async function saveSettings(body: Record<string, unknown>, errors: Record<string, string>): Promise<SaveResult> {
  try {
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      settings?: SiteSettings;
      error?: string;
      fields?: FieldErrors;
    };
    if (res.ok && data.settings) return { ok: true, settings: data.settings };
    return { ok: false, message: (data.error && errors[data.error]) || errors.generic, fields: data.fields };
  } catch {
    return { ok: false, message: errors.network ?? errors.generic };
  }
}

function Status({ error, success }: { error: string | null; success: string | null }) {
  return (
    <div aria-live="polite" className="empty:hidden">
      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="mt-3 rounded-lg bg-success-bg px-3 py-2 text-sm text-success-fg">
          {success}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- credits

export function CreditsSettings({
  initial,
  t,
  errors,
}: {
  initial: Pick<SiteSettings, "creditsEnabled" | "aiDailyRequestLimit">;
  t: SettingsDict;
  errors: Record<string, string>;
}) {
  const c = t.credits;
  const ids = useId();
  const [enabled, setEnabled] = useState(initial.creditsEnabled);
  const [limit, setLimit] = useState(String(initial.aiDailyRequestLimit));
  const [pending, setPending] = useState<"toggle" | "limit" | null>(null);
  const [toggleMsg, setToggleMsg] = useState<{ error: string | null; success: string | null }>({ error: null, success: null });
  const [limitMsg, setLimitMsg] = useState<{ error: string | null; success: string | null }>({ error: null, success: null });
  const [limitError, setLimitError] = useState<SettingsErrorCode | null>(null);

  async function toggle() {
    if (pending) return;
    const next = !enabled;
    if (!window.confirm(next ? c.confirmOn : c.confirmOff)) return;
    setPending("toggle");
    setToggleMsg({ error: null, success: null });
    const result = await saveSettings({ creditsEnabled: next }, errors);
    setPending(null);
    if (!result.ok) {
      setToggleMsg({ error: result.message, success: null });
      return;
    }
    setEnabled(result.settings.creditsEnabled);
    setToggleMsg({ error: null, success: result.settings.creditsEnabled ? c.turnedOn : c.turnedOff });
  }

  async function saveLimit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = settingValueSchemas.aiDailyRequestLimit.safeParse(limit);
    if (!parsed.success) {
      setLimitError(settingsFieldErrors(parsed.error.issues).form ?? "invalid");
      setLimitMsg({ error: null, success: null });
      return;
    }
    setLimitError(null);
    setPending("limit");
    setLimitMsg({ error: null, success: null });
    const result = await saveSettings({ aiDailyRequestLimit: parsed.data }, errors);
    setPending(null);
    if (!result.ok) {
      setLimitError(result.fields?.aiDailyRequestLimit ?? null);
      setLimitMsg({ error: result.fields?.aiDailyRequestLimit ? null : result.message, success: null });
      return;
    }
    setLimit(String(result.settings.aiDailyRequestLimit));
    setLimitMsg({ error: null, success: c.limitSaved });
  }

  const switchId = `${ids}-switch`;
  const limitId = `${ids}-limit`;
  return (
    <section aria-labelledby={`${ids}-title`} className="rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={`${ids}-title`} className="text-lg font-semibold">
          {c.title}
        </h2>
        <span
          className={cx(
            "rounded-full px-2.5 py-0.5 text-xs font-semibold",
            enabled ? "bg-success-bg text-success-fg" : "bg-warn-bg text-warn-fg",
          )}
        >
          {enabled ? c.on : c.off}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">{enabled ? c.explainOn : c.explainOff}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{c.keep}</p>

      <div className="mt-5 flex items-center gap-3">
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-busy={pending === "toggle"}
          disabled={pending !== null}
          onClick={toggle}
          title={enabled ? c.turnOff : c.turnOn}
          className={cx(
            "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            enabled ? "border-accent bg-accent" : "border-border-strong bg-bg-muted",
          )}
        >
          <span
            aria-hidden="true"
            className={cx(
              "inline-block h-5 w-5 rounded-full bg-card shadow transition-transform",
              enabled ? "translate-x-6" : "translate-x-1",
            )}
          />
        </button>
        <label htmlFor={switchId} className="text-sm font-medium">
          {c.switchLabel}
        </label>
      </div>
      <Status {...toggleMsg} />

      <form onSubmit={saveLimit} className="mt-6 border-t border-border pt-5" noValidate>
        <label htmlFor={limitId} className="block text-sm font-medium">
          {c.limitLabel}
        </label>
        <div className="mt-1.5 flex flex-wrap items-start gap-2">
          <input
            id={limitId}
            name="aiDailyRequestLimit"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_DAILY_REQUEST_LIMIT}
            step={1}
            required
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            aria-invalid={limitError ? true : undefined}
            aria-describedby={`${limitId}-hint${limitError ? ` ${limitId}-error` : ""}`}
            className={cx(
              "block w-40 rounded-lg border bg-bg px-3 py-2.5 text-base text-fg focus:border-accent sm:text-sm",
              limitError ? "border-danger" : "border-border-strong",
            )}
          />
          <button type="submit" disabled={pending !== null} className={buttonClass.secondary}>
            {pending === "limit" ? t.saving : c.limitSave}
          </button>
        </div>
        {limitError ? (
          <p id={`${limitId}-error`} className="mt-1.5 text-xs font-medium text-danger-fg">
            {t.errors[limitError]}
          </p>
        ) : null}
        <p id={`${limitId}-hint`} className="mt-1.5 text-xs leading-relaxed text-muted">
          {c.limitHint}
        </p>
        <Status {...limitMsg} />
      </form>
      <p className="mt-4 text-xs text-muted">{c.rateNote}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted">{c.oldAppsNote}</p>
    </section>
  );
}

// ---------------------------------------------------------------- social links

type Row = { id: string; platform: SocialPlatform; url: string; label: string; enabled: boolean };

function toRows(links: SiteSettings["socialLinks"]): Row[] {
  return links.map((l) => ({ id: l.id, platform: l.platform, url: l.url, label: l.label ?? "", enabled: l.enabled }));
}

function toPayload(rows: Row[]) {
  return rows.map((r) => ({ id: r.id, platform: r.platform, url: r.url.trim(), label: r.label.trim() || null, enabled: r.enabled }));
}

/** Client-side validation with the server's schema; keys match the API's `fields`. */
export function validateSocialRows(rows: Row[]): FieldErrors {
  const result = socialLinksSchema.safeParse(toPayload(rows));
  if (result.success) return {};
  return settingsFieldErrors(result.error.issues.map((i) => ({ ...i, path: ["socialLinks", ...i.path] })));
}

export function SocialLinksSettings({
  initial,
  t,
  errors,
  websiteName,
}: {
  initial: SiteSettings["socialLinks"];
  t: SettingsDict;
  errors: Record<string, string>;
  websiteName: string;
}) {
  const s = t.socials;
  const ids = useId();
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ error: string | null; success: string | null }>({ error: null, success: null });

  function update(next: Row[], structural = false) {
    setRows(next);
    setDirty(true);
    setMsg({ error: null, success: null });
    // Errors are keyed by position: recompute them (or drop them) after any change.
    if (showErrors) setFieldErrors(validateSocialRows(next));
    else if (structural) setFieldErrors({});
  }

  const edit = (index: number, patch: Partial<Row>) => update(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = rows.slice();
    [next[index], next[target]] = [next[target], next[index]];
    update(next, true);
  };
  const remove = (index: number) => update(rows.filter((_, i) => i !== index), true);
  const add = () => {
    if (rows.length >= MAX_SOCIAL_LINKS) return;
    update([...rows, { id: newSocialId(), platform: "facebook", url: "", label: "", enabled: true }], true);
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const found = validateSocialRows(rows);
    setShowErrors(true);
    setFieldErrors(found);
    if (Object.keys(found).length) {
      setMsg({ error: s.fixErrors, success: null });
      return;
    }
    setPending(true);
    setMsg({ error: null, success: null });
    const result = await saveSettings({ socialLinks: toPayload(rows) }, errors);
    setPending(false);
    if (!result.ok) {
      setFieldErrors(result.fields ?? {});
      setMsg({ error: result.fields ? s.fixErrors : result.message, success: null });
      return;
    }
    setRows(toRows(result.settings.socialLinks));
    setFieldErrors({});
    setShowErrors(false);
    setDirty(false);
    setMsg({ error: null, success: s.saved });
  }

  const listError = fieldErrors.socialLinks;
  return (
    <section aria-labelledby={`${ids}-title`} className="rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${ids}-title`} className="text-lg font-semibold">
          {s.title}
        </h2>
        <p className="text-xs text-muted">{fill(s.count, { count: rows.length, max: MAX_SOCIAL_LINKS })}</p>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">{s.subtitle}</p>

      <form onSubmit={save} noValidate className="mt-5">
        {rows.length ? (
          <ol className="space-y-4">
            {rows.map((row, i) => {
              const base = `${ids}-${row.id}`;
              const err = (field: string) => fieldErrors[`socialLinks.${i}.${field}`];
              const urlError = err("url") ?? err("platform");
              const labelError = err("label");
              const idError = err("id");
              const hosts = SOCIAL_PLATFORM_HOSTS[row.platform];
              const n = i + 1;
              const itemName = fill(s.item, { n });
              return (
                <li key={row.id}>
                  <fieldset className={cx("rounded-xl border p-4", row.enabled ? "border-border" : "border-dashed border-border")}>
                    <legend className="flex items-center gap-2 px-1 text-sm font-semibold">
                      <SocialIcon platform={row.platform} className="h-4 w-4" />
                      {itemName}
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
                      <div className="space-y-1.5">
                        <label htmlFor={`${base}-platform`} className="block text-sm font-medium">
                          {s.platform}
                        </label>
                        <select
                          id={`${base}-platform`}
                          value={row.platform}
                          onChange={(e) => edit(i, { platform: e.target.value as SocialPlatform })}
                          className="block w-full rounded-lg border border-border-strong bg-bg px-3 py-2.5 text-base text-fg focus:border-accent sm:text-sm"
                        >
                          {SOCIAL_PLATFORMS.map((p) => (
                            <option key={p} value={p}>
                              {socialPlatformName(p, websiteName)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor={`${base}-url`} className="block text-sm font-medium">
                          {s.url}
                        </label>
                        <input
                          id={`${base}-url`}
                          type="url"
                          inputMode="url"
                          required
                          maxLength={SOCIAL_URL_MAX}
                          placeholder="https://"
                          value={row.url}
                          onChange={(e) => edit(i, { url: e.target.value })}
                          aria-invalid={urlError ? true : undefined}
                          aria-describedby={`${base}-url-hint${urlError ? ` ${base}-url-error` : ""}`}
                          className={cx(
                            "block w-full rounded-lg border bg-bg px-3 py-2.5 text-base text-fg placeholder:text-muted focus:border-accent sm:text-sm",
                            urlError ? "border-danger" : "border-border-strong",
                          )}
                        />
                        {urlError ? (
                          <p id={`${base}-url-error`} className="text-xs font-medium text-danger-fg">
                            {t.errors[urlError]}
                          </p>
                        ) : null}
                        <p id={`${base}-url-hint`} className="text-xs text-muted">
                          {hosts ? fill(s.hosts, { hosts: hosts.join(", ") }) : s.anyHost}
                        </p>
                      </div>
                      <div className="space-y-1.5 sm:col-start-2">
                        <label htmlFor={`${base}-label`} className="block text-sm font-medium">
                          {s.label}
                        </label>
                        <input
                          id={`${base}-label`}
                          type="text"
                          maxLength={SOCIAL_LABEL_MAX}
                          value={row.label}
                          onChange={(e) => edit(i, { label: e.target.value })}
                          aria-invalid={labelError ? true : undefined}
                          aria-describedby={`${base}-label-hint${labelError ? ` ${base}-label-error` : ""}`}
                          className={cx(
                            "block w-full rounded-lg border bg-bg px-3 py-2.5 text-base text-fg focus:border-accent sm:text-sm",
                            labelError ? "border-danger" : "border-border-strong",
                          )}
                        />
                        {labelError ? (
                          <p id={`${base}-label-error`} className="text-xs font-medium text-danger-fg">
                            {t.errors[labelError]}
                          </p>
                        ) : null}
                        <p id={`${base}-label-hint`} className="text-xs text-muted">
                          {s.labelHint}
                        </p>
                      </div>
                    </div>
                    {idError ? <p className="mt-2 text-xs font-medium text-danger-fg">{t.errors[idError]}</p> : null}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <label className="mr-auto inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          onChange={(e) => edit(i, { enabled: e.target.checked })}
                          className="h-4 w-4 accent-accent"
                        />
                        {s.enabled}
                      </label>
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        aria-label={`${s.moveUp}: ${itemName}`}
                        className={cx(buttonClass.ghost, "px-3 py-1.5")}
                      >
                        ↑ <span className="sr-only sm:not-sr-only">{s.moveUp}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === rows.length - 1}
                        aria-label={`${s.moveDown}: ${itemName}`}
                        className={cx(buttonClass.ghost, "px-3 py-1.5")}
                      >
                        ↓ <span className="sr-only sm:not-sr-only">{s.moveDown}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        aria-label={`${s.remove}: ${itemName}`}
                        className={cx(buttonClass.ghost, "px-3 py-1.5 text-danger-fg")}
                      >
                        {s.remove}
                      </button>
                    </div>
                  </fieldset>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted">{s.empty}</p>
        )}
        {listError ? <p className="mt-3 text-sm font-medium text-danger-fg">{t.errors[listError]}</p> : null}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={add} disabled={rows.length >= MAX_SOCIAL_LINKS} className={buttonClass.secondary}>
            + {s.add}
          </button>
          <button type="submit" disabled={pending} className={buttonClass.primary}>
            {pending ? t.saving : s.save}
          </button>
          {dirty ? <span className="text-xs text-muted">{s.unsaved}</span> : null}
        </div>
        <Status {...msg} />
      </form>
    </section>
  );
}
