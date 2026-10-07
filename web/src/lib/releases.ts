// Latest desktop release from GitHub Releases, with installers classified by platform.

import { GITHUB_REPO, LATEST_RELEASE_URL } from "./site";
import snapshot from "./release-snapshot.json";

export type AssetKey = "macArm" | "macIntel" | "winExe" | "appImage" | "deb" | "rpm";
export type ReleaseAsset = { name: string; url: string; size: number; downloadCount?: number };
export type ReleaseInfo = {
  version: string | null;
  publishedAt: string | null;
  htmlUrl: string;
  assets: Partial<Record<AssetKey, ReleaseAsset>>;
};

type GithubAsset = { name: string; browser_download_url: string; size?: number; download_count?: number };

const ARM = /(arm64|aarch64)/i;

/**
 * Map release assets to download slots. Matches the electron-builder names
 * used by FaamOffice (FaamOffice-<v>-arm64.dmg, FaamOffice-<v>.dmg,
 * FaamOffice-Setup-<v>.exe — releases up to 0.11.x carry it as
 * FaamOffice.Setup.<v>.exe, GitHub's rendering of the old spaced name —,
 * FaamOffice-<v>.AppImage, faamoffice_<v>_amd64.deb, faamoffice-<v>.x86_64.rpm)
 * and is lenient with other naming schemes. Update-feed files (latest*.yml,
 * *.blockmap) are never offered as downloads.
 */
export function classifyAssets(assets: GithubAsset[]): Partial<Record<AssetKey, ReleaseAsset>> {
  const out: Partial<Record<AssetKey, ReleaseAsset>> = {};
  const set = (key: AssetKey, a: GithubAsset, preferred: boolean) => {
    if (!out[key] || preferred) out[key] = {
      name: a.name, url: a.browser_download_url, size: a.size ?? 0,
      ...(typeof a.download_count === "number" && a.download_count >= 0 ? { downloadCount: a.download_count } : {}),
    };
  };
  for (const a of assets) {
    const name = a.name;
    if (!name || !a.browser_download_url || /\.(blockmap|yml|yaml|sig|sha256|txt)$/i.test(name)) continue;
    if (/\.dmg$/i.test(name)) {
      if (/universal/i.test(name)) {
        set("macArm", a, false);
        set("macIntel", a, false);
      } else if (ARM.test(name)) {
        set("macArm", a, true);
      } else {
        set("macIntel", a, /(x64|x86_64|intel)/i.test(name));
      }
    } else if (/\.exe$/i.test(name) && !/uninstall/i.test(name)) {
      if (!ARM.test(name)) set("winExe", a, /setup/i.test(name));
    } else if (/\.appimage$/i.test(name)) {
      if (!ARM.test(name)) set("appImage", a, false);
    } else if (/\.deb$/i.test(name)) {
      if (!ARM.test(name)) set("deb", a, /amd64/i.test(name));
    } else if (/\.rpm$/i.test(name)) {
      if (!ARM.test(name)) set("rpm", a, /x86_64/i.test(name));
    }
  }
  return out;
}

const releaseState = globalThis as unknown as { __faamLastRelease?: { repo: string; release: ReleaseInfo } };

/** Last verified direct installer links remain usable during a GitHub API outage. */
export function fallbackRelease(): ReleaseInfo {
  if (releaseState.__faamLastRelease?.repo === GITHUB_REPO) {
    const previous = releaseState.__faamLastRelease.release;
    // A cached download count must not be presented as a fresh GitHub count.
    return { ...previous, assets: Object.fromEntries(Object.entries(previous.assets).map(([key, asset]) =>
      [key, { name: asset!.name, url: asset!.url, size: asset!.size }])) };
  }
  return snapshot.repository === GITHUB_REPO
    ? { version: snapshot.version, publishedAt: snapshot.publishedAt, htmlUrl: snapshot.htmlUrl, assets: snapshot.assets }
    : { version: null, publishedAt: null, htmlUrl: LATEST_RELEASE_URL, assets: {} };
}

/** Fetch the latest release (cached for an hour), retaining verified direct links on failure. */
export async function getLatestRelease(): Promise<ReleaseInfo> {
  const fallback = fallbackRelease();
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "faamoffice-web",
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers,
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as {
      tag_name?: string;
      name?: string;
      published_at?: string;
      html_url?: string;
      assets?: GithubAsset[];
    };
    const assets = classifyAssets((Array.isArray(data.assets) ? data.assets : []).filter((asset) => {
      try {
        const url = new URL(asset.browser_download_url);
        return url.protocol === "https:" && url.hostname === "github.com" && url.pathname.startsWith(`/${GITHUB_REPO}/releases/download/`);
      } catch { return false; }
    }));
    if (!Object.keys(assets).length) return fallback;
    const release: ReleaseInfo = {
      version: (data.tag_name ?? data.name ?? "").replace(/^v/, "") || null,
      publishedAt: data.published_at ?? null,
      htmlUrl: data.html_url ?? LATEST_RELEASE_URL,
      assets,
    };
    releaseState.__faamLastRelease = { repo: GITHUB_REPO, release };
    return release;
  } catch {
    return fallback;
  }
}
