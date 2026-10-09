"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { detectDesktopOs, needsLinuxArchitectureChoice, type DesktopOs } from "@/lib/download-platform";
import type { DownloadTargets } from "@/lib/download-targets";
import { DownloadLink } from "./download-link";
import { DownloadIcon } from "./ui";

const subscribe = () => () => {};
const browserOs = () => detectDesktopOs(navigator);
const serverOs = () => null;

export function AdaptiveDownloadButton({ fallbackHref, fallbackLabel, buttonLabel, platformNames, targets, className }: {
  fallbackHref: string;
  fallbackLabel: string;
  /** Localized label with an {os} placeholder. */
  buttonLabel: string;
  platformNames: Record<DesktopOs, string>;
  targets: DownloadTargets;
  className?: string;
}) {
  const os = useSyncExternalStore(subscribe, browserOs, serverOs);
  const target = os === "linux" && targets.linux && needsLinuxArchitectureChoice(navigator)
    ? { href: `${fallbackHref}#linux` }
    : os ? targets[os] : undefined;
  const label = os && target ? buttonLabel.replace("{os}", platformNames[os]) : fallbackLabel;
  const content = <><DownloadIcon />{label}</>;
  if (target?.fileName) {
    return <DownloadLink href={target.href} fileName={target.fileName} tracking={target.tracking} className={className}>{content}</DownloadLink>;
  }
  // A usable download-page link is present before hydration, on phones and when
  // release assets are unavailable. Detection never triggers a download itself.
  return <Link href={target?.href ?? fallbackHref} className={className} prefetch={false}>{content}</Link>;
}
