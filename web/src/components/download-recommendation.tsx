"use client";

// Client-side OS detection: highlights the installer that fits the visitor's
// computer. Renders nothing on the server and on unsupported platforms, so the
// full list below stays the source of truth (and works without JavaScript).

import { useSyncExternalStore } from "react";

type Os = "mac" | "windows" | "linux";
type Option = { label: string; url: string; fileName?: string };

export type RecommendationProps = {
  title: string;
  /** Button label with an {os} placeholder. */
  buttonLabel: string;
  options: Record<Os, { name: string; primary: Option; secondary?: Option[] }>;
};

function detectOs(): Os | null {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = (nav.userAgentData?.platform || navigator.platform || "").toLowerCase();
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod|android/.test(ua)) return null;
  if (platform.includes("mac") || ua.includes("mac os x")) return "mac";
  if (platform.includes("win") || ua.includes("windows")) return "windows";
  if (platform.includes("linux") || ua.includes("linux") || ua.includes("x11")) return "linux";
  return null;
}

const subscribe = () => () => {};

export function DownloadRecommendation({ title, buttonLabel, options }: RecommendationProps) {
  const os = useSyncExternalStore(subscribe, detectOs, () => null);
  if (!os) return null;
  const option = options[os];
  return (
    <div className="mt-10 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold text-link">{title}</p>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xl font-bold">
            {option.name} — {option.primary.label}
          </p>
          {option.primary.fileName ? <p className="mt-1 font-mono text-xs text-muted">{option.primary.fileName}</p> : null}
        </div>
        <a
          href={option.primary.url}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-base font-semibold text-accent-fg hover:bg-accent-hover"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
            <path d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {buttonLabel.replace("{os}", option.name)}
        </a>
      </div>
      {option.secondary?.length ? (
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {option.secondary.map((s) => (
            <a key={s.url + s.label} href={s.url} className="text-link underline-offset-4 hover:underline">
              {s.label}
            </a>
          ))}
        </p>
      ) : null}
    </div>
  );
}
