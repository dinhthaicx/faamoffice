// Latest desktop release from GitHub Releases, with installers classified by platform.

import { GITHUB_REPO, LATEST_RELEASE_URL } from "./site";

export type AssetKey = "macArm" | "macIntel" | "winExe" | "appImage" | "deb" | "rpm";
export type ReleaseAsset = { name: string; url: string; size: number };
export type ReleaseInfo = {
  version: string | null;
  publishedAt: string | null;
  htmlUrl: string;
  assets: Partial<Record<AssetKey, ReleaseAsset>>;
};

type GithubAsset = { name: string; browser_download_url: string; size?: number };

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
    if (!out[key] || preferred) out[key] = { name: a.name, url: a.browser_download_url, size: a.size ?? 0 };
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

/** Fetch the latest release (cached for an hour). Falls back to the releases page on any error. */
export async function getLatestRelease(): Promise<ReleaseInfo> {
  const fallback: ReleaseInfo = { version: null, publishedAt: null, htmlUrl: LATEST_RELEASE_URL, assets: {} };
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
    return {
      version: (data.tag_name ?? data.name ?? "").replace(/^v/, "") || null,
      publishedAt: data.published_at ?? null,
      htmlUrl: data.html_url ?? LATEST_RELEASE_URL,
      assets: classifyAssets(Array.isArray(data.assets) ? data.assets : []),
    };
  } catch {
    return fallback;
  }
}
