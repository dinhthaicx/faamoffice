"use client";

import type { ReactNode } from "react";
import type { DownloadClick } from "@/lib/downloads-shared";

/** Best effort: the actual installer href works even if tracking or JavaScript fails. */
export function sendDownloadClick(click: DownloadClick): void {
  try {
    const body = JSON.stringify(click);
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/downloads", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/downloads", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // Never prevent or delay the browser's native download.
  }
}

export function DownloadLink({ href, fileName, tracking, className, children }: {
  href: string;
  fileName?: string;
  tracking?: DownloadClick;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a href={href} download={fileName} className={className} data-download-asset={tracking?.asset}
      onClick={(event) => { if (tracking && !event.defaultPrevented && event.button === 0) sendDownloadClick(tracking); }}
      onAuxClick={(event) => { if (tracking && !event.defaultPrevented && event.button === 1) sendDownloadClick(tracking); }}>
      {children}
    </a>
  );
}
