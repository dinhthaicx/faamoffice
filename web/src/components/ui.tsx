// Small presentational helpers shared by pages (server-safe, no client JS).

import type { ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export const buttonClass = {
  primary: `${base} bg-accent text-accent-fg hover:bg-accent-hover`,
  download: `${base} button-download border border-download-border bg-download text-download-fg shadow-md shadow-download/20 hover:bg-download-hover`,
  downloadCool: `${base} button-cool border border-accent-hover bg-accent text-accent-fg shadow-md shadow-accent/20 hover:bg-accent-hover`,
  downloadAi: `${base} button-ai border border-ai-hover bg-ai text-ai-fg shadow-md shadow-ai/20 hover:bg-ai-hover`,
  ai: `${base} button-ai bg-ai text-ai-fg hover:bg-ai-hover`,
  secondary: `${base} border border-border-strong bg-card text-fg hover:bg-bg-muted`,
  danger: `${base} bg-danger text-white hover:bg-danger-hover`,
  ghost: `${base} text-fg hover:bg-bg-muted`,
  large: "px-5 py-3 text-base",
};

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>{children}</div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-link">{children}</p>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("card-elevation rounded-2xl border border-border bg-card p-6", className)}>{children}</div>;
}

export function Alert({
  children,
  tone = "info",
  className,
}: {
  children: ReactNode;
  tone?: "info" | "success" | "warn" | "danger";
  className?: string;
}) {
  const tones = {
    info: "border-border bg-bg-soft text-fg",
    success: "border-transparent bg-success-bg text-success-fg",
    warn: "border-transparent bg-warn-bg text-warn-fg",
    danger: "border-transparent bg-danger-bg text-danger-fg",
  };
  return <div className={cx("rounded-xl border px-4 py-3 text-sm leading-relaxed", tones[tone], className)}>{children}</div>;
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  minLength,
  maxLength,
  defaultValue,
  hint,
  placeholder,
  autoFocus,
  inputMode,
  pattern,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  defaultValue?: string | number;
  hint?: string;
  placeholder?: string;
  autoFocus?: boolean;
  inputMode?: "text" | "numeric" | "email";
  pattern?: string;
}) {
  const id = `field-${name}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoFocus={autoFocus}
        inputMode={inputMode}
        pattern={pattern}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="block w-full rounded-lg border border-border-strong bg-bg px-3 py-2.5 text-base text-fg placeholder:text-muted focus:border-accent sm:text-sm"
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  id,
  center = false,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  id?: string;
  center?: boolean;
}) {
  return (
    <div className={cx("max-w-3xl", center && "mx-auto text-center")}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 id={id} className="text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {subtitle ? <p className="mt-4 text-lg leading-relaxed text-muted">{subtitle}</p> : null}
    </div>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={cx("h-5 w-5 shrink-0", className)} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={cx("h-4 w-4", className)} aria-hidden="true">
      <path d="M4 10h11m-4-4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={cx("h-4 w-4", className)} aria-hidden="true">
      <path d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
