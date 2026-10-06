import type { ReactNode } from "react";
import { LogoMark } from "./logo";

/** Centered card used by sign-in, registration, password and device pages. */
export function AuthShell({ title, subtitle, children, wide = false }: { title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="hero-glow px-4 py-12 sm:py-20">
      <div className={`mx-auto w-full ${wide ? "max-w-xl" : "max-w-md"}`}>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <LogoMark className="h-10 w-10" idPrefix="auth" />
          <h1 className="mt-5 text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
