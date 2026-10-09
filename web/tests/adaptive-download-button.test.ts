// Exercise the rendered component after browser OS detection. The separate
// download-targets test retains real React and checks the pre-hydration fallback.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdaptiveDownloadButton } from "@/components/adaptive-download-button";
import { getDownloadTargets } from "@/lib/download-targets";
import type { DownloadBrowserInfo } from "@/lib/download-platform";
import type { ReleaseInfo } from "@/lib/releases";
import type { Locale } from "@/i18n/config";
import { vi as vietnamese } from "@/i18n/dictionaries/vi";
import { en as english } from "@/i18n/dictionaries/en";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useSyncExternalStore: (subscribe: unknown, getSnapshot: () => unknown) => {
    void subscribe;
    return getSnapshot();
  },
}));

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

afterEach(() => { vi.unstubAllGlobals(); });

function render(browser: DownloadBrowserInfo, locale: Locale = "vi", available = release) {
  vi.stubGlobal("navigator", browser);
  const dictionary = locale === "vi" ? vietnamese : english;
  return renderToStaticMarkup(createElement(AdaptiveDownloadButton, {
    fallbackHref: `/${locale}/download`,
    fallbackLabel: dictionary.home.hero.ctaDownload,
    buttonLabel: dictionary.download.downloadFor,
    platformNames: {
      windows: dictionary.download.platforms.windows.name,
      mac: dictionary.download.platforms.mac.name,
      linux: dictionary.download.platforms.linux.name,
    },
    targets: getDownloadTargets(available, locale),
  }));
}

describe("adaptive download button after browser detection", () => {
  it.each<Locale>(["vi", "en"])("renders a tracked Windows EXE link with the %s OS label", (locale) => {
    const html = render({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, locale);
    const dictionary = locale === "vi" ? vietnamese : english;
    expect(html).toContain(`href="${release.assets.winExe!.url}"`);
    expect(html).toContain(`download="${release.assets.winExe!.name}"`);
    expect(html).toContain(dictionary.download.downloadFor.replace("{os}", "Windows"));
    expect(html).toContain('data-download-asset="winExe"');
    expect(html).not.toContain(`href="/${locale}/download"`);
  });

  it("offers macOS architecture choices rather than downloading a guessed DMG", () => {
    const html = render({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 });
    expect(html).toContain('href="/vi/download#mac"');
    expect(html).toContain(vietnamese.download.downloadFor.replace("{os}", "macOS"));
    expect(html).not.toMatch(/\sdownload=/);
    expect(html).not.toContain("data-download-asset=");
    expect(html).not.toContain(release.assets.macArm!.url);
    expect(html).not.toContain(release.assets.macIntel!.url);
  });

  it("renders a tracked AppImage link for Linux x86-64", () => {
    const html = render({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }, "en");
    expect(html).toContain(`href="${release.assets.appImage!.url}"`);
    expect(html).toContain(`download="${release.assets.appImage!.name}"`);
    expect(html).toContain(english.download.downloadFor.replace("{os}", "Linux"));
    expect(html).toContain('data-download-asset="appImage"');
  });

  it("sends Linux aarch64 visitors to the requirements and package choices without counting a download", () => {
    const html = render({ platform: "Linux aarch64", userAgent: "Mozilla/5.0 (X11; Linux aarch64)" });
    expect(html).toContain('href="/vi/download#linux"');
    expect(html).toContain(vietnamese.download.downloadFor.replace("{os}", "Linux"));
    expect(html).not.toContain(release.assets.appImage!.url);
    expect(html).not.toMatch(/\sdownload=/);
    expect(html).not.toContain("data-download-asset=");
  });

  it.each([
    ["Android", { platform: "Linux armv8l", userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)" }],
    ["iPhone", { platform: "iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }],
  ] satisfies [string, DownloadBrowserInfo][])("keeps %s on the generic download page", (_name, browser) => {
    const html = render(browser);
    expect(html).toContain('href="/vi/download"');
    expect(html).toContain(vietnamese.home.hero.ctaDownload);
    expect(html).not.toMatch(/\sdownload=/);
    expect(html).not.toContain("data-download-asset=");
    expect(html).not.toContain(release.assets.winExe!.url);
    expect(html).not.toContain(release.assets.appImage!.url);
  });

  it("falls back to the localized download page when the Windows installer is absent", () => {
    const macOnly: ReleaseInfo = { ...release, assets: { macArm: release.assets.macArm, macIntel: release.assets.macIntel } };
    const html = render({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, "en", macOnly);
    expect(html).toContain('href="/en/download"');
    expect(html).toContain(english.home.hero.ctaDownload);
    expect(html).not.toMatch(/\sdownload=/);
    expect(html).not.toContain("data-download-asset=");
    expect(html).not.toContain(release.assets.macArm!.url);
    expect(html).not.toContain(release.assets.macIntel!.url);
  });
});
