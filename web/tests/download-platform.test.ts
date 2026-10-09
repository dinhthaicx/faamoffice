import { describe, expect, it } from "vitest";
import { detectDesktopOs, needsLinuxArchitectureChoice, type DownloadBrowserInfo } from "@/lib/download-platform";

const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/142.0";

describe("desktop download platform", () => {
  it.each([
    ["Windows", { platform: "Win32", userAgent: WINDOWS_UA }, "windows"],
    ["macOS", { platform: "MacIntel", userAgent: MAC_UA, maxTouchPoints: 0 }, "mac"],
    ["Linux", { platform: "Linux x86_64", userAgent: LINUX_UA }, "linux"],
    ["Chromium platform", { userAgentData: { platform: "Windows" } }, "windows"],
  ] satisfies [string, DownloadBrowserInfo, string][])("recognizes %s", (_name, browser, expected) => {
    expect(detectDesktopOs(browser)).toBe(expected);
  });

  it("prefers the modern platform over both legacy hints", () => {
    expect(detectDesktopOs({ userAgentData: { platform: " Windows " }, platform: "MacIntel", userAgent: MAC_UA })).toBe("windows");
    expect(detectDesktopOs({ userAgentData: { platform: "macOS" }, platform: "Win32", userAgent: WINDOWS_UA })).toBe("mac");
  });

  it("uses legacy platform before a conflicting user agent", () => {
    expect(detectDesktopOs({ platform: "Win32", userAgent: MAC_UA })).toBe("windows");
    expect(detectDesktopOs({ platform: "MacIntel", userAgent: WINDOWS_UA })).toBe("mac");
  });

  it("uses user-agent fallback when platform is absent or unrecognized", () => {
    expect(detectDesktopOs({ userAgent: WINDOWS_UA })).toBe("windows");
    expect(detectDesktopOs({ platform: "", userAgent: MAC_UA })).toBe("mac");
    expect(detectDesktopOs({ userAgentData: { platform: "   " }, platform: "unknown", userAgent: LINUX_UA })).toBe("linux");
  });

  it.each([
    ["Android", { platform: "Linux armv8l", userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)" }],
    ["Android platform", { userAgentData: { platform: "Android" }, userAgent: LINUX_UA }],
    ["iPhone", { platform: "iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }],
    ["iPod", { platform: "iPod", userAgent: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)" }],
    ["iPad", { platform: "iPad", userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" }],
    ["iPad desktop UA", { platform: "MacIntel", userAgent: MAC_UA, maxTouchPoints: 5 }],
    ["iPad without UA", { platform: "MacIntel", maxTouchPoints: 2 }],
    ["ChromeOS", { platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; CrOS x86_64 16002.51.0)" }],
    ["ChromeOS platform", { userAgentData: { platform: "Chrome OS" }, userAgent: LINUX_UA }],
    ["Windows Phone", { platform: "Win32", userAgent: "Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1)" }],
  ] satisfies [string, DownloadBrowserInfo][])("leaves %s on the full download page", (_name, browser) => {
    expect(detectDesktopOs(browser)).toBeNull();
  });

  it("keeps Windows touchscreens eligible for the Windows installer", () => {
    expect(detectDesktopOs({ platform: "Win32", userAgent: WINDOWS_UA, maxTouchPoints: 10 })).toBe("windows");
  });

  it("does not guess an OS from generic X11, Darwin or unknown hints", () => {
    for (const browser of [{}, { platform: "Darwin" }, { platform: "FreeBSD", userAgent: "Mozilla/5.0 (X11; FreeBSD amd64)" }, { userAgent: "Mozilla/5.0 (X11)" }]) {
      expect(detectDesktopOs(browser)).toBeNull();
    }
  });
});

describe("Linux installer architecture choice", () => {
  it.each(["aarch64", "arm64", "armv7l", "armhf", "i386", "i686", "ppc64le", "riscv64", "s390x", "mips64el", "loongarch64"])(
    "keeps Linux %s on the architecture requirements instead of downloading x64",
    (architecture) => {
      const browser = { platform: `Linux ${architecture}`, userAgent: `Mozilla/5.0 (X11; Linux ${architecture})` };
      expect(detectDesktopOs(browser)).toBe("linux");
      expect(needsLinuxArchitectureChoice(browser)).toBe(true);
    },
  );

  it("uses an explicit ARM user-agent hint when platform only says Linux", () => {
    expect(needsLinuxArchitectureChoice({ platform: "Linux", userAgent: "Mozilla/5.0 (X11; Linux aarch64)" })).toBe(true);
  });

  it.each(["x86_64", "x86-64", "amd64", "x64"])("keeps normal Linux %s eligible for x64", (architecture) => {
    expect(needsLinuxArchitectureChoice({ platform: `Linux ${architecture}`, userAgent: `Mozilla/5.0 (X11; Linux ${architecture})` })).toBe(false);
  });

  it("does not guess a missing Linux architecture", () => {
    expect(needsLinuxArchitectureChoice({ platform: "Linux" })).toBe(false);
    expect(needsLinuxArchitectureChoice({ userAgent: "Mozilla/5.0 (X11; Linux)" })).toBe(false);
  });

  it("does not apply Linux architecture handling to Android, ChromeOS or another desktop OS", () => {
    for (const browser of [
      { platform: "Linux armv8l", userAgent: "Mozilla/5.0 (Linux; Android 15)" },
      { platform: "Linux aarch64", userAgent: "Mozilla/5.0 (X11; CrOS aarch64 16002.51.0)" },
      { platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; ARM Mac OS X)" },
      { platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; ARM64)" },
    ]) {
      expect(needsLinuxArchitectureChoice(browser)).toBe(false);
    }
  });
});
