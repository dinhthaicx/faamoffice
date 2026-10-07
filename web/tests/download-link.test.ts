import { afterEach, describe, expect, it, vi } from "vitest";
import { sendDownloadClick } from "@/components/download-link";

const click = { asset: "winExe", version: "0.11.2", locale: "vi", source: "platform" } as const;
afterEach(() => vi.unstubAllGlobals());

describe("download tracking never delays navigation", () => {
  it("queues a same-origin beacon with no second request", async () => {
    const beacon = vi.fn(() => true);
    const fetch = vi.fn();
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    vi.stubGlobal("fetch", fetch);
    expect(sendDownloadClick(click)).toBeUndefined();
    const [url, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe("/api/downloads");
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toEqual(click);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to a keepalive POST when the beacon cannot be queued", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("navigator", { sendBeacon: () => false });
    vi.stubGlobal("fetch", fetch);
    expect(sendDownloadClick(click)).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith("/api/downloads", expect.objectContaining({ method: "POST", keepalive: true, body: JSON.stringify(click) }));
  });

  it("does not propagate network or browser failures into the download action", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(() => sendDownloadClick(click)).not.toThrow();
    await Promise.resolve();
    vi.stubGlobal("navigator", { sendBeacon: () => { throw new Error("blocked"); } });
    expect(() => sendDownloadClick(click)).not.toThrow();
  });
});
