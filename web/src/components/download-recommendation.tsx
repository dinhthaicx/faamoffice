"use client";

// Client-side OS detection: highlights the installer that fits the visitor's
// computer. Renders nothing on the server and on unsupported platforms, so the
// full list below stays the source of truth (and works without JavaScript).

import { useSyncExternalStore } from "react";
import { DownloadLink } from "./download-link";
import { buttonClass, DownloadIcon } from "./ui";
import type { DownloadClick } from "@/lib/downloads-shared";

type Os = "mac" | "windows" | "linux";
type Option = { label: string; url: string | null; fileName?: string; tracking?: DownloadClick };

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
  if (!option.primary.url) return null;
  const downloadButton = { mac: buttonClass.download, windows: buttonClass.downloadCool, linux: buttonClass.downloadAi }[os];
  return (
    <div className="card-elevation mt-10 rounded-2xl border border-download-border/50 bg-download-soft p-6 sm:p-8">
      <p className="text-sm font-semibold text-download-text">{title}</p>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xl font-bold">
            {option.name} — {option.primary.label}
          </p>
          {option.primary.fileName ? <p className="mt-1 font-mono text-xs text-muted">{option.primary.fileName}</p> : null}
        </div>
        <DownloadLink
          href={option.primary.url}
          fileName={option.primary.fileName}
          tracking={option.primary.tracking}
          className={`${downloadButton} ${buttonClass.large} shrink-0`}
        >
          <DownloadIcon />
          {buttonLabel.replace("{os}", option.name)}
        </DownloadLink>
      </div>
      {option.secondary?.length ? (
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {option.secondary.filter((s) => s.url).map((s) => (
            <DownloadLink key={s.url + s.label} href={s.url!} fileName={s.fileName} tracking={s.tracking} className="text-link underline-offset-4 hover:underline">
              {s.label}
            </DownloadLink>
          ))}
        </p>
      ) : null}
    </div>
  );
}
