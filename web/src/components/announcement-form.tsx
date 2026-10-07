"use client";

// Admin editor for one announcement: every field, image upload, inline
// validation (same zod schema as the server) and a live preview of the dialog
// the desktop app shows. HTML announcements are previewed in a sandboxed srcdoc
// iframe with the same sandbox flags and policy as /announcement-frame/{id}.

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { buttonClass, cx } from "./ui";
import {
  ANNOUNCEMENT_DISPLAY_MODES,
  ANNOUNCEMENT_KINDS,
  ANNOUNCEMENT_LEVELS,
  ANNOUNCEMENT_LIMITS,
  ANNOUNCEMENT_STATUSES,
  announcementInputSchema,
  buildFrameDocument,
  fieldErrorsFromIssues,
  FRAME_META_CSP,
  FRAME_SANDBOX,
  IMAGE_MIME_TYPES,
  isHttpsUrl,
  localizeAnnouncement,
  MAX_IMAGE_BYTES,
  PLATFORMS,
  type AnnouncementFormValues,
  type AnnouncementKind,
  type AnnouncementLevel,
  type AnnouncementStatus,
  type ContentLocale,
  type FieldErrorCode,
  type Platform,
} from "@/lib/announcement-shared";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";

export type { AnnouncementFormValues };

/** Free-text fields (inputs and textareas bound to a plain string). */
type TextKey =
  | "titleVi"
  | "titleEn"
  | "bodyVi"
  | "bodyEn"
  | "htmlVi"
  | "htmlEn"
  | "imageUrl"
  | "linkUrl"
  | "linkLabelVi"
  | "linkLabelEn"
  | "minVersion"
  | "maxVersion"
  | "priority";

export type UploadedImageInfo = { id: string; mime: string; width: number | null; height: number | null; size: number };

type Texts = Dictionary["admin"]["announcements"];
type FieldErrors = Partial<Record<string, FieldErrorCode>>;

/** Fields that show their error next to the control, per kind (other kinds hide them). */
const INLINE_ERROR_FIELDS: Record<AnnouncementKind, readonly (keyof AnnouncementFormValues)[]> = (() => {
  const common = ["titleVi", "titleEn", "linkUrl", "linkLabelVi", "linkLabelEn", "minVersion", "maxVersion", "startsAt", "endsAt", "priority"] as const;
  return { rich: [...common, "bodyVi", "bodyEn", "imageId", "imageUrl"], html: [...common, "htmlVi", "htmlEn"] };
})();

/** Form label of each field, for errors listed in the summary instead of inline. */
const FIELD_LABELS: Record<keyof AnnouncementFormValues, keyof Texts["form"]> = {
  status: "status",
  kind: "kind",
  level: "level",
  displayMode: "displayMode",
  titleVi: "titleVi",
  titleEn: "titleEn",
  bodyVi: "bodyVi",
  bodyEn: "bodyEn",
  htmlVi: "htmlVi",
  htmlEn: "htmlEn",
  imageId: "image",
  imageUrl: "imageUrl",
  linkUrl: "linkUrl",
  linkLabelVi: "linkLabelVi",
  linkLabelEn: "linkLabelEn",
  platforms: "platforms",
  minVersion: "minVersion",
  maxVersion: "maxVersion",
  startsAt: "startsAt",
  endsAt: "endsAt",
  priority: "priority",
};

/**
 * Split field errors into those shown next to a visible control and the rest
 * (fields hidden for this kind, controls without an error slot, form-level
 * errors), which the summary lists so that no error is ever invisible.
 */
export function splitFieldErrors(errors: FieldErrors, kind: AnnouncementKind) {
  const inline = new Set<string>(INLINE_ERROR_FIELDS[kind]);
  const entries = Object.entries(errors).filter((e): e is [string, FieldErrorCode] => Boolean(e[1]));
  return {
    inline: entries.filter(([key]) => inline.has(key)).map(([key]) => key),
    listed: entries.filter(([key]) => !inline.has(key)),
  };
}

/** aria-invalid / aria-describedby of a control with an optional hint and an error slot (`${id}-error`). */
export function describedBy(id: string, hintId: string | null, hasError: boolean) {
  return {
    "aria-invalid": hasError ? true : undefined,
    "aria-describedby": cx(hintId, hasError && `${id}-error`) || undefined,
  };
}

export const EMPTY_ANNOUNCEMENT: AnnouncementFormValues = {
  status: "draft",
  kind: "rich",
  level: "info",
  displayMode: "once",
  titleVi: "",
  titleEn: "",
  bodyVi: "",
  bodyEn: "",
  htmlVi: "",
  htmlEn: "",
  imageId: null,
  imageUrl: "",
  linkUrl: "",
  linkLabelVi: "",
  linkLabelEn: "",
  platforms: [],
  minVersion: "",
  maxVersion: "",
  startsAt: "",
  endsAt: "",
  priority: "0",
};

const inputBase =
  "block w-full rounded-lg border bg-bg px-3 py-2 text-base text-fg placeholder:text-muted focus:border-accent disabled:opacity-60 sm:text-sm";

const LEVEL_STYLES: Record<AnnouncementLevel, { bar: string; badge: string }> = {
  info: { bar: "bg-accent", badge: "bg-bg-muted text-fg" },
  warning: { bar: "bg-warn-fg", badge: "bg-warn-bg text-warn-fg" },
  critical: { bar: "bg-danger", badge: "bg-danger-bg text-danger-fg" },
};

const subscribeNoop = () => () => {};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO → value of <input type="datetime-local"> in the browser's time zone. */
function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function formatBytes(size: number, locale: Locale): string {
  const nf = new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US", { maximumFractionDigits: 1 });
  return size >= 1024 * 1024 ? `${nf.format(size / 1024 / 1024)} MB` : `${nf.format(Math.max(1, Math.round(size / 1024)))} KB`;
}

function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <legend className="px-1 text-base font-semibold">{title}</legend>
      <div className="mt-2 space-y-4">{children}</div>
    </fieldset>
  );
}

function ChoiceGroup<T extends string>({
  name,
  legend,
  options,
  value,
  labels,
  hints,
  onChange,
}: {
  name: string;
  legend: string;
  options: readonly T[];
  value: T;
  labels: Record<T, string>;
  hints?: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-labelledby={`ann-${name}-legend`} className="space-y-1.5">
      <p id={`ann-${name}-legend`} className="text-sm font-medium">
        {legend}
      </p>
      <div className={cx("grid gap-2", options.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
        {options.map((option) => (
          <label
            key={option}
            className={cx(
              "flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-sm",
              value === option ? "border-accent bg-bg-soft" : "border-border hover:bg-bg-soft",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              <span className="block font-medium">{labels[option]}</span>
              {hints ? <span className="mt-0.5 block text-xs text-muted">{hints[option]}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** The dialog as the desktop app shows it (approximation). */
export function AnnouncementPreview({
  values,
  previewLocale,
  imageSrc,
  t,
}: {
  values: AnnouncementFormValues;
  previewLocale: ContentLocale;
  imageSrc: string | null;
  t: Texts;
}) {
  const nullable = (s: string) => (s.trim() ? s.trim() : null);
  const loc = localizeAnnouncement(
    {
      titleVi: values.titleVi.trim(),
      titleEn: nullable(values.titleEn),
      bodyVi: nullable(values.bodyVi),
      bodyEn: nullable(values.bodyEn),
      htmlVi: nullable(values.htmlVi),
      htmlEn: nullable(values.htmlEn),
      linkLabelVi: nullable(values.linkLabelVi),
      linkLabelEn: nullable(values.linkLabelEn),
    },
    previewLocale,
  );
  const style = LEVEL_STYLES[values.level];
  const linkUrl = values.linkUrl.trim();
  const showLink = linkUrl !== "" && isHttpsUrl(linkUrl);
  const title = loc.title || t.untitled;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl" lang={previewLocale}>
      <div className={cx("h-1.5", style.bar)} aria-hidden="true" />
      {values.kind === "rich" && imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- admin-provided image (upload or external https URL)
        <img src={imageSrc} alt="" className="max-h-60 w-full bg-bg-muted object-contain" referrerPolicy="no-referrer" />
      ) : null}
      <div className="p-5">
        <span className={cx("inline-block rounded-full px-2 py-0.5 text-xs font-medium", style.badge)}>{t.level[values.level]}</span>
        <h3 className={cx("mt-2 text-lg font-semibold leading-snug", !loc.title && "text-muted")}>{title}</h3>
        {values.kind === "rich" ? (
          loc.body ? <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">{loc.body}</p> : null
        ) : loc.html ? (
          <iframe
            title={t.preview.frameTitle}
            sandbox={FRAME_SANDBOX}
            referrerPolicy="no-referrer"
            srcDoc={buildFrameDocument({ html: loc.html, title: loc.title, lang: previewLocale, metaCsp: FRAME_META_CSP })}
            className="mt-3 h-80 w-full rounded-lg border border-border"
          />
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">{t.preview.emptyHtml}</p>
        )}
        {/* The checkbox and Close are pictures of the app's controls: inert and hidden
            from assistive technology. The link button is real and stays usable. */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          {values.displayMode === "until_dismissed" ? (
            <div inert aria-hidden="true">
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" disabled /> {t.preview.dontShowAgain}
              </label>
            </div>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {showLink ? (
              <a href={linkUrl} target="_blank" rel="noopener noreferrer" className={buttonClass.primary}>
                {loc.linkLabel}
              </a>
            ) : null}
            <div inert aria-hidden="true" className="flex">
              <button type="button" className={buttonClass.secondary}>
                {t.preview.close}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AnnouncementForm({
  locale,
  mode,
  announcementId,
  initial,
  initialImage,
  justCreated = false,
  t,
  errors,
}: {
  locale: Locale;
  mode: "create" | "edit";
  announcementId?: string;
  initial: AnnouncementFormValues;
  initialImage: UploadedImageInfo | null;
  /** Arrived from "create" (`?saved=1`): show the saved notice once, then drop the flag from the URL. */
  justCreated?: boolean;
  t: Texts;
  errors: Dictionary["errors"];
}) {
  const router = useRouter();
  // Date inputs render in the browser's time zone: only after hydration.
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const [values, setValues] = useState<AnnouncementFormValues>(initial);
  const [image, setImage] = useState<UploadedImageInfo | null>(initialImage);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  // "created": shown above the form after the redirect from "create";
  // "updated": shown next to the save button. Any edit clears it.
  const [saved, setSaved] = useState<"created" | "updated" | null>(justCreated ? "created" : null);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewLocale, setPreviewLocale] = useState<ContentLocale>(locale);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useDeferredValue(values);
  const f = t.form;

  useEffect(() => {
    // Drop `?saved=1` so reloads and later refreshes do not repeat the notice.
    if (justCreated) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }, [justCreated]);

  function update<K extends keyof AnnouncementFormValues>(key: K, value: AnnouncementFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(null);
    setFieldErrors((errs) => {
      if (!errs[key]) return errs;
      const next = { ...errs };
      delete next[key];
      return next;
    });
  }

  const errorText = (key: keyof AnnouncementFormValues) => {
    const code = fieldErrors[key];
    return code ? t.fieldErrors[code] : undefined;
  };

  const inputProps = (key: keyof AnnouncementFormValues, hint?: boolean) => ({
    id: `ann-${key}`,
    name: key,
    ...describedBy(`ann-${key}`, hint ? `ann-${key}-hint` : null, Boolean(fieldErrors[key])),
    className: cx(inputBase, fieldErrors[key] ? "border-danger" : "border-border-strong"),
  });

  /** Show field errors and focus the first one that has a visible control. */
  function showFieldErrors(errs: FieldErrors) {
    setFieldErrors(errs);
    const first = splitFieldErrors(errs, values.kind).inline[0];
    if (first) document.getElementById(`ann-${first}`)?.focus();
  }

  const text = (key: TextKey) => ({
    value: values[key],
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(key, e.target.value),
  });

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      setUploadError(errors.image_too_large);
      return;
    }
    if (file.type && !(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
      setUploadError(errors.unsupported_image);
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/announcements/images", {
        method: "POST",
        body,
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as Partial<UploadedImageInfo> & { error?: string };
      if (res.status === 413) {
        // Also covers a proxy's own 413 page (no JSON body).
        setUploadError(errors.image_too_large);
      } else if (!res.ok || !data.id) {
        setUploadError((data.error && errors[data.error as keyof typeof errors]) || errors.generic);
      } else {
        setImage({ id: data.id, mime: data.mime ?? "", width: data.width ?? null, height: data.height ?? null, size: data.size ?? file.size });
        update("imageId", data.id);
        update("imageUrl", "");
      }
    } catch {
      setUploadError(errors.network);
    } finally {
      setUploading(false);
    }
  }

  function removeImage() {
    setImage(null);
    update("imageId", null);
  }

  function togglePlatform(platform: Platform, checked: boolean) {
    const set = new Set(values.platforms);
    if (checked) set.add(platform);
    else set.delete(platform);
    update(
      "platforms",
      PLATFORMS.filter((p) => set.has(p)),
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || uploading) return;
    setFormError(null);
    setSaved(null);
    const sent = values;

    const parsed = announcementInputSchema.safeParse(values);
    if (!parsed.success) {
      showFieldErrors(fieldErrorsFromIssues(parsed.error.issues));
      return;
    }

    setPending(true);
    try {
      const res = await fetch(mode === "create" ? "/api/admin/announcements" : `/api/admin/announcements/${announcementId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(sent),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
        fields?: Record<string, FieldErrorCode>;
        values?: AnnouncementFormValues;
        image?: UploadedImageInfo | null;
      };
      if (!res.ok) {
        if (data.fields && Object.keys(data.fields).length) {
          showFieldErrors(data.fields);
        } else {
          setFormError((data.error && errors[data.error as keyof typeof errors]) || errors.generic);
        }
        setPending(false);
        return;
      }
      if (mode === "create" && data.id) {
        router.push(`/${locale}/admin/announcements/${data.id}?saved=1`);
        return;
      }
      // Continue from what the server stored (e.g. an html announcement loses its
      // image, which the server deletes), not from the form's own copy — unless
      // something was typed while the request was in flight.
      const stored = data.values;
      if (stored) {
        setValues((current) => (current === sent ? stored : current));
        setImage(data.image ?? null);
      }
      setFieldErrors({});
      setSaved("updated");
      setPending(false);
      router.refresh();
    } catch {
      setFormError(errors.network);
      setPending(false);
    }
  }

  const errorSummary = splitFieldErrors(fieldErrors, values.kind);
  const hasFieldErrors = errorSummary.inline.length + errorSummary.listed.length > 0;
  const imageError = errorText("imageId");

  const imageSrc =
    preview.kind !== "rich"
      ? null
      : preview.imageId
        ? `/api/admin/announcements/images/${preview.imageId}`
        : isHttpsUrl(preview.imageUrl.trim())
          ? preview.imageUrl.trim()
          : null;

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={pending} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-6">
        {saved === "created" ? (
          <p role="status" className="rounded-xl bg-success-bg px-4 py-3 text-sm text-success-fg">
            {t.saved}
          </p>
        ) : null}
        <Section title={f.appearance}>
          <ChoiceGroup
            name="kind"
            legend={f.kind}
            options={ANNOUNCEMENT_KINDS}
            value={values.kind}
            labels={t.kind}
            hints={t.kindHint}
            onChange={(v) => update("kind", v)}
          />
          <ChoiceGroup
            name="displayMode"
            legend={f.displayMode}
            options={ANNOUNCEMENT_DISPLAY_MODES}
            value={values.displayMode}
            labels={t.displayMode}
            hints={t.displayModeHint}
            onChange={(v) => update("displayMode", v)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="ann-level" label={f.level}>
              <select
                {...inputProps("level")}
                value={values.level}
                onChange={(e) => update("level", e.target.value as AnnouncementLevel)}
              >
                {ANNOUNCEMENT_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t.level[level]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="ann-status" label={f.status}>
              <select
                {...inputProps("status")}
                value={values.status}
                onChange={(e) => update("status", e.target.value as AnnouncementStatus)}
              >
                {ANNOUNCEMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t.status[status]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        </Section>

        <Section title={f.content}>
          <FormField id="ann-titleVi" label={f.titleVi} error={errorText("titleVi")}>
            <input {...inputProps("titleVi")} {...text("titleVi")} required maxLength={ANNOUNCEMENT_LIMITS.title} />
          </FormField>
          <FormField id="ann-titleEn" label={f.titleEn} hint={f.enHint} error={errorText("titleEn")}>
            <input {...inputProps("titleEn", true)} {...text("titleEn")} maxLength={ANNOUNCEMENT_LIMITS.title} />
          </FormField>
          {values.kind === "rich" ? (
            <>
              <FormField id="ann-bodyVi" label={f.bodyVi} hint={f.bodyHint} error={errorText("bodyVi")}>
                <textarea {...inputProps("bodyVi", true)} {...text("bodyVi")} rows={6} maxLength={ANNOUNCEMENT_LIMITS.body} />
              </FormField>
              <FormField id="ann-bodyEn" label={f.bodyEn} hint={f.enHint} error={errorText("bodyEn")}>
                <textarea {...inputProps("bodyEn", true)} {...text("bodyEn")} rows={6} maxLength={ANNOUNCEMENT_LIMITS.body} />
              </FormField>
            </>
          ) : (
            <>
              <FormField id="ann-htmlVi" label={f.htmlVi} hint={f.htmlHint} error={errorText("htmlVi")}>
                <textarea
                  {...inputProps("htmlVi", true)}
                  {...text("htmlVi")}
                  rows={12}
                  maxLength={ANNOUNCEMENT_LIMITS.html}
                  spellCheck={false}
                  className={cx(inputProps("htmlVi").className, "font-mono text-xs sm:text-xs")}
                />
              </FormField>
              <FormField id="ann-htmlEn" label={f.htmlEn} hint={f.enHint} error={errorText("htmlEn")}>
                <textarea
                  {...inputProps("htmlEn", true)}
                  {...text("htmlEn")}
                  rows={12}
                  maxLength={ANNOUNCEMENT_LIMITS.html}
                  spellCheck={false}
                  className={cx(inputProps("htmlEn").className, "font-mono text-xs sm:text-xs")}
                />
              </FormField>
            </>
          )}
        </Section>

        {values.kind === "rich" ? (
          <Section title={f.image}>
            <div className="flex flex-wrap items-center gap-3">
              {/* Reached only through the button below, which carries the name and errors. */}
              <input
                ref={fileInput}
                id="ann-imageFile"
                type="file"
                accept={IMAGE_MIME_TYPES.join(",")}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={onFile}
              />
              <button
                type="button"
                id="ann-imageId"
                className={buttonClass.secondary}
                disabled={uploading}
                {...describedBy("ann-imageId", "ann-image-hint", Boolean(imageError))}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? f.uploading : values.imageId ? f.replace : f.upload}
              </button>
              {values.imageId ? (
                <button type="button" className={buttonClass.ghost} onClick={removeImage} disabled={uploading}>
                  {f.removeImage}
                </button>
              ) : null}
            </div>
            <p id="ann-image-hint" className="text-xs text-muted">
              {f.imageHint}
            </p>
            {values.imageId ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-bg-soft p-3 text-sm">
                {/* eslint-disable-next-line @next/next/no-img-element -- uploaded image served by the admin API */}
                <img src={`/api/admin/announcements/images/${values.imageId}`} alt="" className="h-14 w-20 rounded-md object-cover" />
                <span className="text-muted">
                  {f.uploaded}
                  {image?.width && image.height ? ` · ${image.width}×${image.height}` : ""}
                  {image ? ` · ${formatBytes(image.size, locale)}` : ""}
                </span>
              </div>
            ) : null}
            <div aria-live="polite" className="empty:hidden">
              {uploadError ? (
                <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
                  {uploadError}
                </p>
              ) : null}
              {imageError ? (
                <p id="ann-imageId-error" className="text-xs font-medium text-danger-fg">
                  {imageError}
                </p>
              ) : null}
            </div>
            <FormField id="ann-imageUrl" label={f.imageUrl} error={errorText("imageUrl")}>
              <input
                {...inputProps("imageUrl")}
                {...text("imageUrl")}
                type="url"
                inputMode="url"
                placeholder="https://"
                disabled={Boolean(values.imageId)}
                maxLength={ANNOUNCEMENT_LIMITS.url}
              />
            </FormField>
          </Section>
        ) : null}

        <Section title={f.link}>
          <FormField id="ann-linkUrl" label={f.linkUrl} error={errorText("linkUrl")}>
            <input
              {...inputProps("linkUrl")}
              {...text("linkUrl")}
              type="url"
              inputMode="url"
              placeholder="https://"
              maxLength={ANNOUNCEMENT_LIMITS.url}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="ann-linkLabelVi" label={f.linkLabelVi} hint={f.linkLabelHint} error={errorText("linkLabelVi")}>
              <input {...inputProps("linkLabelVi", true)} {...text("linkLabelVi")} maxLength={ANNOUNCEMENT_LIMITS.label} />
            </FormField>
            <FormField id="ann-linkLabelEn" label={f.linkLabelEn} hint={f.enHint} error={errorText("linkLabelEn")}>
              <input {...inputProps("linkLabelEn", true)} {...text("linkLabelEn")} maxLength={ANNOUNCEMENT_LIMITS.label} />
            </FormField>
          </div>
        </Section>

        <Section title={f.targeting}>
          <div className="space-y-1.5">
            <p className="text-sm font-medium" id="ann-platforms-legend">
              {f.platforms}
            </p>
            <div role="group" aria-labelledby="ann-platforms-legend" aria-describedby="ann-platforms-hint" className="flex flex-wrap gap-2">
              {PLATFORMS.map((platform, i) => (
                <label
                  key={platform}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-bg-soft"
                >
                  <input
                    id={i === 0 ? "ann-platforms" : undefined}
                    type="checkbox"
                    checked={values.platforms.includes(platform)}
                    onChange={(e) => togglePlatform(platform, e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  {t.platform[platform]}
                </label>
              ))}
            </div>
            <p id="ann-platforms-hint" className="text-xs text-muted">
              {f.platformsHint}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="ann-minVersion" label={f.minVersion} hint={f.versionHint} error={errorText("minVersion")}>
              <input {...inputProps("minVersion", true)} {...text("minVersion")} placeholder="0.11.0" maxLength={ANNOUNCEMENT_LIMITS.version} />
            </FormField>
            <FormField id="ann-maxVersion" label={f.maxVersion} error={errorText("maxVersion")}>
              <input {...inputProps("maxVersion")} {...text("maxVersion")} placeholder="0.12.0" maxLength={ANNOUNCEMENT_LIMITS.version} />
            </FormField>
          </div>
        </Section>

        <Section title={f.schedule}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="ann-startsAt" label={f.startsAt} hint={f.startsAtHint} error={errorText("startsAt")}>
              <input
                {...inputProps("startsAt", true)}
                type="datetime-local"
                value={hydrated ? isoToLocalInput(values.startsAt) : ""}
                disabled={!hydrated}
                onChange={(e) => update("startsAt", localInputToIso(e.target.value))}
              />
            </FormField>
            <FormField id="ann-endsAt" label={f.endsAt} hint={f.endsAtHint} error={errorText("endsAt")}>
              <input
                {...inputProps("endsAt", true)}
                type="datetime-local"
                value={hydrated ? isoToLocalInput(values.endsAt) : ""}
                disabled={!hydrated}
                onChange={(e) => update("endsAt", localInputToIso(e.target.value))}
              />
            </FormField>
          </div>
          <FormField id="ann-priority" label={f.priority} hint={f.priorityHint} error={errorText("priority")}>
            <input
              {...inputProps("priority", true)}
              {...text("priority")}
              type="number"
              inputMode="numeric"
              min={-ANNOUNCEMENT_LIMITS.priority}
              max={ANNOUNCEMENT_LIMITS.priority}
              step={1}
              className={cx(inputProps("priority").className, "sm:max-w-40")}
            />
          </FormField>
        </Section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonClass.primary} disabled={pending || uploading}>
            {pending ? f.saving : mode === "create" ? f.create : f.save}
          </button>
          <Link href={`/${locale}/admin/announcements`} className={buttonClass.ghost}>
            {f.cancel}
          </Link>
        </div>
        <div aria-live="polite" className="space-y-2 empty:hidden">
          {hasFieldErrors ? (
            <div role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
              <p>{errorSummary.inline.length ? f.fixErrors : f.fixListed}</p>
              {errorSummary.listed.length ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {errorSummary.listed.map(([key, code]) => {
                    const label = Object.hasOwn(FIELD_LABELS, key) ? f[FIELD_LABELS[key as keyof AnnouncementFormValues]] : null;
                    return (
                      <li key={key}>
                        {label ? `${label}: ` : ""}
                        {t.fieldErrors[code]}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
          {formError ? (
            <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
              {formError}
            </p>
          ) : null}
          {saved === "updated" ? (
            <p role="status" className="rounded-lg bg-success-bg px-3 py-2 text-sm text-success-fg">
              {t.saved}
            </p>
          ) : null}
        </div>
      </div>

      <aside aria-labelledby="ann-preview-title" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <div className="flex items-center justify-between gap-3">
          <h2 id="ann-preview-title" className="text-lg font-semibold">
            {t.preview.title}
          </h2>
          <div role="group" aria-label={t.preview.language} className="flex rounded-lg border border-border p-0.5 text-xs">
            {(["vi", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={previewLocale === l}
                onClick={() => setPreviewLocale(l)}
                className={cx("rounded-md px-2.5 py-1 font-semibold", previewLocale === l ? "bg-accent text-accent-fg" : "text-muted hover:text-fg")}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 rounded-2xl bg-bg-muted p-4 sm:p-6">
          <AnnouncementPreview values={preview} previewLocale={previewLocale} imageSrc={imageSrc} t={t} />
        </div>
        <p className="mt-2 text-xs text-muted">{t.preview.note}</p>
      </aside>
    </form>
  );
}
