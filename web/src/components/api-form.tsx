"use client";

// A form that posts its fields as JSON to one of our API routes (same-origin,
// cookie session) and shows localized errors. Server-rendered children supply
// the fields; this component only handles submission state.

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border border-border-strong bg-card text-fg hover:bg-bg-muted",
  danger: "bg-danger text-white hover:bg-danger-hover",
};

export type ApiFormProps = {
  action: string;
  submitLabel: string;
  pendingLabel?: string;
  successMessage?: string;
  /** Localized messages keyed by API error code; must include "generic" and "network". */
  errors: Record<string, string>;
  /** Extra JSON fields merged into the body (e.g. locale, ids, booleans). */
  extra?: Record<string, string | number | boolean>;
  /** Ask for confirmation before submitting. */
  confirmText?: string;
  /** After success: follow `redirect` from the response, refresh server data, or do nothing. */
  after?: "redirect" | "refresh" | "none";
  resetOnSuccess?: boolean;
  /** Replace the form by the success message once submitted. */
  replaceOnSuccess?: boolean;
  variant?: Variant;
  fullWidth?: boolean;
  className?: string;
  children?: ReactNode;
};

export function ApiForm({
  action,
  submitLabel,
  pendingLabel,
  successMessage,
  errors,
  extra,
  confirmText,
  after = "redirect",
  resetOnSuccess = false,
  replaceOnSuccess = false,
  variant = "primary",
  fullWidth = false,
  className,
  children,
}: ApiFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (confirmText && !window.confirm(confirmText)) return;
    const form = event.currentTarget;
    const body: Record<string, unknown> = {};
    new FormData(form).forEach((value, key) => {
      if (typeof value === "string") body[key] = value;
    });
    Object.assign(body, extra);

    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(action, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; redirect?: string };
      if (!res.ok) {
        setError((data.error && errors[data.error]) || errors.generic);
        setPending(false);
        return;
      }
      if (after === "redirect" && typeof data.redirect === "string" && data.redirect.startsWith("/")) {
        // Full navigation so every server component sees the new session state.
        window.location.assign(data.redirect);
        return;
      }
      setSuccess(true);
      setPending(false);
      if (resetOnSuccess) form.reset();
      if (after !== "none") router.refresh();
    } catch {
      setError(errors.network ?? errors.generic);
      setPending(false);
    }
  }

  if (replaceOnSuccess && success && successMessage) {
    return (
      <p role="status" className="rounded-xl bg-success-bg px-4 py-3 text-sm text-success-fg">
        {successMessage}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className={className} noValidate={false} aria-busy={pending}>
      {children}
      <div className={children ? "mt-5" : undefined}>
        <button
          type="submit"
          disabled={pending}
          className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${fullWidth ? "w-full" : ""}`}
        >
          {pending ? (pendingLabel ?? submitLabel) : submitLabel}
        </button>
      </div>
      <div aria-live="polite" className="empty:hidden">
        {error ? (
          <p role="alert" className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
            {error}
          </p>
        ) : null}
        {success && successMessage ? (
          <p role="status" className="mt-3 rounded-lg bg-success-bg px-3 py-2 text-sm text-success-fg">
            {successMessage}
          </p>
        ) : null}
      </div>
    </form>
  );
}
