import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestRelease, type ReleaseInfo } from "@/lib/releases";
import { GITHUB_REPO } from "@/lib/site";

const state = globalThis as { __faamLastRelease?: { repo: string; release: ReleaseInfo } };
beforeEach(() => { delete state.__faamLastRelease; });
afterEach(() => { delete state.__faamLastRelease; vi.unstubAllGlobals(); });

const asset = (name: string, count = 12) => ({ name, browser_download_url: `https://github.com/${GITHUB_REPO}/releases/download/v0.12.0/${name}`, size: 1234, download_count: count });

describe("verified direct installer links", () => {
  it.each([403, 500])("retains all six direct installer links if GitHub responds %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    const release = await getLatestRelease();
    expect(Object.values(release.assets)).toHaveLength(6);
    for (const item of Object.values(release.assets)) {
      expect(item.url).toContain(`/dinhthaicx/faamoffice/releases/download/v0.11.2/`);
      expect(item.downloadCount).toBeUndefined();
    }
  });

  it("uses the verified snapshot if the API request times out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect((await getLatestRelease()).assets.winExe?.url).toMatch(/\/releases\/download\/v0\.11\.2\/FaamOffice-Setup-0\.11\.2\.exe$/);
  });

  it("keeps the newer verified release during subsequent failures without stale counts", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ tag_name: "v0.12.0", assets: [asset("FaamOffice-Setup-0.12.0.exe", 42)] }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const current = await getLatestRelease();
    expect(current.version).toBe("0.12.0");
    expect(current.assets.winExe?.downloadCount).toBe(42);
    const fallback = await getLatestRelease();
    expect(fallback.version).toBe("0.12.0");
    expect(fallback.assets.winExe?.url).toBe(current.assets.winExe?.url);
    expect(fallback.assets.winExe?.downloadCount).toBeUndefined();
  });

  it("rejects URLs outside this repository's GitHub release assets", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ tag_name: "v0.12.0", assets: [
      { ...asset("bad.exe"), browser_download_url: "https://evil.test/bad.exe" },
      { ...asset("wrong.exe"), browser_download_url: "https://github.com/other/repo/releases/download/v0.12.0/wrong.exe" },
      { ...asset("page.exe"), browser_download_url: `https://github.com/${GITHUB_REPO}/releases/tag/v0.12.0` },
    ] })));
    expect((await getLatestRelease()).version).toBe("0.11.2");
  });
});
