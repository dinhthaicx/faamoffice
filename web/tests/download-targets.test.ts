import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdaptiveDownloadButton } from "@/components/adaptive-download-button";
import { getDownloadTargets } from "@/lib/download-targets";
import type { ReleaseInfo } from "@/lib/releases";
import { vi as dictionary } from "@/i18n/dictionaries/vi";

const release: ReleaseInfo = {
  version: "0.11.4",
  publishedAt: null,
  htmlUrl: "https://github.com/dinhthaicx/faamoffice/releases/tag/v0.11.4",
  assets: {
    winExe: { name: "FaamOffice-Setup-0.11.4.exe", url: "https://github.com/dinhthaicx/faamoffice/releases/download/v0.11.4/FaamOffice-Setup-0.11.4.exe", size: 100 },
    macArm: { name: "FaamOffice-0.11.4-arm64.dmg", url: "https://github.com/dinhthaicx/faamoffice/releases/download/v0.11.4/FaamOffice-0.11.4-arm64.dmg", size: 100 },
    macIntel: { name: "FaamOffice-0.11.4.dmg", url: "https://github.com/dinhthaicx/faamoffice/releases/download/v0.11.4/FaamOffice-0.11.4.dmg", size: 100 },
    appImage: { name: "FaamOffice-0.11.4.AppImage", url: "https://github.com/dinhthaicx/faamoffice/releases/download/v0.11.4/FaamOffice-0.11.4.AppImage", size: 100 },
  },
};

describe("adaptive download destinations", () => {
  it("downloads the Windows EXE directly and preserves installer tracking", () => {
    expect(getDownloadTargets(release, "vi").windows).toEqual({
      href: release.assets.winExe!.url,
      fileName: release.assets.winExe!.name,
      tracking: { asset: "winExe", version: "0.11.4", locale: "vi", source: "recommended" },
    });
  });

  it("uses AppImage on Linux with the selected locale in tracking", () => {
    const target = getDownloadTargets(release, "en").linux;
    expect(target?.href).toBe(release.assets.appImage!.url);
    expect(target?.tracking).toMatchObject({ asset: "appImage", locale: "en" });
  });

  it("offers the macOS architecture choices without guessing a DMG or counting a download", () => {
    expect(getDownloadTargets(release, "en").mac).toEqual({ href: "/en/download#mac" });
  });

  it("keeps Linux package choices usable when AppImage is absent", () => {
    const packages: ReleaseInfo = { ...release, assets: { rpm: { name: "faamoffice.rpm", url: "https://github.com/dinhthaicx/faamoffice/releases/download/v0.11.4/faamoffice.rpm", size: 100 } } };
    expect(getDownloadTargets(packages, "vi").linux).toEqual({ href: "/vi/download#linux" });
  });

  it("does not substitute a different operating system when installers are missing", () => {
    const macOnly = getDownloadTargets({ ...release, assets: { macArm: release.assets.macArm } }, "vi");
    expect(macOnly.windows).toBeUndefined();
    expect(macOnly.linux).toBeUndefined();
    expect(macOnly.mac?.href).toBe("/vi/download#mac");
  });

  it("does not send an incomplete tracking payload when a release version is unknown", () => {
    const target = getDownloadTargets({ ...release, version: null }, "vi").windows;
    expect(target?.href).toBe(release.assets.winExe!.url);
    expect(target?.tracking).toBeUndefined();
  });

  it("renders a usable download-page link before browser detection and hydration", () => {
    const html = renderToStaticMarkup(createElement(AdaptiveDownloadButton, {
      fallbackHref: "/vi/download",
      fallbackLabel: dictionary.home.hero.ctaDownload,
      buttonLabel: dictionary.download.downloadFor,
      platformNames: { windows: "Windows", mac: "macOS", linux: "Linux" },
      targets: getDownloadTargets(release, "vi"),
    }));
    expect(html).toContain('href="/vi/download"');
    expect(html).toContain(dictionary.home.hero.ctaDownload);
    expect(html).not.toContain("download=");
    expect(html).not.toContain(release.assets.winExe!.url);
  });
});
