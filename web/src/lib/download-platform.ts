// Browser-only OS hints, with a guard against known incompatible Linux builds.
// Pure input keeps the same detection usable by both download CTAs and tests.

export type DesktopOs = "windows" | "mac" | "linux";

export type DownloadBrowserInfo = {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
  maxTouchPoints?: number;
};

export function detectDesktopOs(browserInfo: DownloadBrowserInfo): DesktopOs | null {
  const legacyPlatform = (browserInfo.platform ?? "").trim().toLowerCase();
  const platform = (browserInfo.userAgentData?.platform?.trim() || legacyPlatform).toLowerCase();
  const ua = (browserInfo.userAgent ?? "").toLowerCase();
  const hints = `${platform} ${legacyPlatform} ${ua}`;

  // Android can report a Linux platform; iOS can request a desktop user agent.
  if (/android|iphone|ipad|ipod|windows phone|iemobile/.test(hints)) return null;
  if (/chrome\s*os|\bcros\b/.test(hints)) return null;
  const looksLikeMac = platform.startsWith("mac") || /macintosh|mac os x|\bmacos\b/.test(ua);
  if (looksLikeMac && (browserInfo.maxTouchPoints ?? 0) > 1) return null;

  // Recognized platform hints take priority over legacy user-agent strings.
  if (platform.startsWith("win")) return "windows";
  if (platform.startsWith("mac")) return "mac";
  if (platform.startsWith("linux")) return "linux";

  if (/\bwindows\b/.test(ua)) return "windows";
  if (/macintosh|mac os x|\bmacos\b/.test(ua)) return "mac";
  if (/\blinux\b/.test(ua)) return "linux";
  return null;
}

/** Known non-x64 Linux hints keep the visitor on the installer requirements. */
export function needsLinuxArchitectureChoice(browserInfo: DownloadBrowserInfo): boolean {
  if (detectDesktopOs(browserInfo) !== "linux") return false;
  const hints = `${browserInfo.platform ?? ""} ${browserInfo.userAgentData?.platform ?? ""} ${browserInfo.userAgent ?? ""}`;
  // Missing architecture information is not evidence of a non-x64 computer.
  // The x86 guard avoids interpreting x86_64 / x86-64 as 32-bit x86.
  return /\b(?:aarch(?:32|64)?|arm(?:32|64|v\d+[a-z0-9]*|hf|el|eb)?|i[3-6]86|x86(?:[_-]?32)?(?![_ -]?64)|ppc(?:64(?:le|el)?)?|powerpc(?:64(?:le|el)?)?|riscv(?:32|64)?|s390x?|mips(?:64)?(?:el|eb)?|sparc(?:64|v9)?|loongarch(?:32|64)?)\b/i.test(hints);
}
