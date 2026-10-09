import type { Locale } from "@/i18n/config";
import type { DesktopOs } from "./download-platform";
import type { DownloadClick } from "./downloads-shared";
import type { AssetKey, ReleaseInfo } from "./releases";

export type DownloadTarget = { href: string; fileName?: string; tracking?: DownloadClick };
export type DownloadTargets = Partial<Record<DesktopOs, DownloadTarget>>;

/** Direct installers when unambiguous; platform choices when the browser cannot select a build. */
export function getDownloadTargets(release: ReleaseInfo, locale: Locale): DownloadTargets {
  const targets: DownloadTargets = {};
  const installer = (key: AssetKey): DownloadTarget | undefined => {
    const asset = release.assets[key];
    if (!asset) return undefined;
    return {
      href: asset.url,
      fileName: asset.name,
      tracking: release.version ? { asset: key, version: release.version, locale, source: "recommended" } : undefined,
    };
  };
  targets.windows = installer("winExe");
  targets.linux = installer("appImage");
  if (!targets.linux && (release.assets.deb || release.assets.rpm)) {
    targets.linux = { href: `/${locale}/download#linux` };
  }
  // macOS user agents commonly report Intel on Apple Silicon too. Let the visitor
  // choose Apple Silicon / Intel instead of silently downloading the wrong DMG.
  if (release.assets.macArm || release.assets.macIntel) {
    targets.mac = { href: `/${locale}/download#mac` };
  }
  return targets;
}
