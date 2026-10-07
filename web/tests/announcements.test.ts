// Announcements without a database: version/platform/locale matching, admin
// input validation, image magic bytes and framing, the sandboxed frame document and the
// routing/header configuration that keeps the frame isolated.

import { buildCustomRoute } from "next/dist/lib/build-custom-route";
import { describe, expect, it } from "vitest";
import {
  announcementInputSchema,
  buildFrameDocument,
  compareVersions,
  computeMediaFit,
  contentLocale,
  fieldErrorsFromIssues,
  FRAME_CSP,
  FRAME_META_CSP,
  FRAME_RESPONSE_HEADERS,
  localizeAnnouncement,
  parsePlatform,
  parseStoredPlatforms,
  parseVersion,
  platformMatches,
  serializePlatforms,
  toAnnouncementFormValues,
  versionInRange,
} from "@/lib/announcement-shared";
import { sniffImage } from "@/lib/image-sniff";
import { en } from "@/i18n/dictionaries/en";
import { vi } from "@/i18n/dictionaries/vi";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { config as proxyConfig } from "@/proxy";
import nextConfig from "../next.config";

const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const PNG_1X1 = b64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
const GIF_1X1 = b64("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");

function jpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

function riff(chunk: string, payload: number[]): Uint8Array {
  const enc = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const body = [...enc("WEBP"), ...enc(chunk), payload.length, 0, 0, 0, ...payload];
  return new Uint8Array([...enc("RIFF"), body.length, 0, 0, 0, ...body]);
}

function webpVp8x(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return riff("VP8X", [0, 0, 0, 0, w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff]);
}

function webpVp8l(width: number, height: number): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14);
  return riff("VP8L", [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]);
}

describe("versions", () => {
  it("parses x.y.z, ignoring a leading v and pre-release/build suffixes", () => {
    expect(parseVersion("0.11.1")).toEqual([0, 11, 1]);
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("0.12.0-beta.2")).toEqual([0, 12, 0]);
    expect(parseVersion("1.0.0+build.7")).toEqual([1, 0, 0]);
    for (const bad of [null, undefined, "", "1.2", "1.2.3.4", "abc", "1.x.3", " "]) expect(parseVersion(bad)).toBeNull();
  });

  it("reads build metadata whose unencoded \"+\" a query string decoded as a space", () => {
    const fromQuery = new URLSearchParams("version=1.0.0+build.7").get("version");
    expect(fromQuery).toBe("1.0.0 build.7");
    expect(parseVersion(fromQuery)).toEqual([1, 0, 0]);
    expect(parseVersion(new URLSearchParams("version=1.0.0%2Bbuild.7").get("version"))).toEqual([1, 0, 0]);
    expect(parseVersion("1.0.0\tx")).toEqual([1, 0, 0]);
    expect(parseVersion("1.0.0build")).toBeNull();
  });

  it("compares numerically, not lexically", () => {
    expect(compareVersions([0, 10, 0], [0, 9, 9])).toBe(1);
    expect(compareVersions([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(compareVersions([0, 2, 10], [0, 11, 0])).toBe(-1);
  });

  it("applies inclusive bounds and skips filtering for unknown versions", () => {
    expect(versionInRange([0, 11, 1], "0.11.1", "0.11.1")).toBe(true);
    expect(versionInRange([0, 11, 0], "0.11.1", null)).toBe(false);
    expect(versionInRange([0, 12, 0], null, "0.11.9")).toBe(false);
    expect(versionInRange([0, 10, 0], null, null)).toBe(true);
    expect(versionInRange(null, "9.9.9", "9.9.9")).toBe(true);
  });
});

describe("platforms and locales", () => {
  it("parses platforms with Node aliases", () => {
    expect(parsePlatform("mac")).toBe("mac");
    expect(parsePlatform("darwin")).toBe("mac");
    expect(parsePlatform("WIN32")).toBe("win");
    expect(parsePlatform("linux")).toBe("linux");
    expect(parsePlatform("beos")).toBeNull();
  });

  it("stores platforms canonically and treats empty as every platform", () => {
    expect(serializePlatforms(["linux", "mac"])).toBe("mac,linux");
    expect(parseStoredPlatforms("linux,bogus,mac")).toEqual(["mac", "linux"]);
    expect(platformMatches("", "win")).toBe(true);
    expect(platformMatches("mac,linux", "win")).toBe(false);
    expect(platformMatches("mac,linux", "linux")).toBe(true);
    expect(platformMatches("mac", null)).toBe(true);
  });

  it("maps vi* to Vietnamese and anything else to English", () => {
    expect(contentLocale("vi")).toBe("vi");
    expect(contentLocale("vi-VN")).toBe("vi");
    expect(contentLocale(null)).toBe("vi");
    expect(contentLocale("en-US")).toBe("en");
    expect(contentLocale("fr")).toBe("en");
  });

  it("falls back from English to Vietnamese field by field", () => {
    const base = { titleVi: "Xin chào", titleEn: null, bodyVi: "Nội dung", bodyEn: "Body", htmlVi: null, htmlEn: null, linkLabelVi: null, linkLabelEn: null };
    expect(localizeAnnouncement(base, "en")).toMatchObject({ title: "Xin chào", body: "Body", linkLabel: "Learn more" });
    expect(localizeAnnouncement(base, "vi")).toMatchObject({ title: "Xin chào", body: "Nội dung", linkLabel: "Xem chi tiết" });
    expect(localizeAnnouncement({ ...base, titleEn: "Hello", linkLabelVi: "Tải về" }, "en")).toMatchObject({ title: "Hello", linkLabel: "Tải về" });
  });
});

describe("admin input schema", () => {
  const valid = { titleVi: "Bản cập nhật 0.12", kind: "rich", bodyVi: "Dòng 1\r\nDòng 2" };

  it("normalizes a minimal payload", () => {
    const out = announcementInputSchema.parse(valid);
    expect(out).toMatchObject({
      status: "draft",
      kind: "rich",
      level: "info",
      displayMode: "once",
      titleEn: null,
      bodyVi: "Dòng 1\nDòng 2",
      platforms: [],
      startsAt: null,
      endsAt: null,
      priority: 0,
    });
  });

  it("reports field codes for invalid values", () => {
    const result = announcementInputSchema.safeParse({
      titleVi: "  ",
      linkUrl: "http://example.com",
      imageUrl: "javascript:alert(1)",
      minVersion: "1.2",
      priority: 5000,
      level: "loud",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFromIssues(result.error.issues)).toEqual({
      titleVi: "required",
      linkUrl: "https_only",
      imageUrl: "https_only",
      minVersion: "version_format",
      priority: "out_of_range",
      level: "invalid",
    });
  });

  it("checks cross-field rules", () => {
    const result = announcementInputSchema.safeParse({
      titleVi: "x",
      kind: "html",
      minVersion: "0.12.0",
      maxVersion: "0.11.0",
      startsAt: "2026-01-02T00:00:00Z",
      endsAt: "2026-01-01T00:00:00Z",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFromIssues(result.error.issues)).toEqual({
      htmlVi: "required",
      maxVersion: "version_range",
      endsAt: "ends_before_start",
    });
    const both = announcementInputSchema.safeParse({ ...valid, imageId: "abc123", imageUrl: "https://cdn.example/a.png" });
    expect(both.error && fieldErrorsFromIssues(both.error.issues)).toEqual({ imageUrl: "image_conflict" });
  });

  it("checks image fields only for rich announcements", () => {
    // Left over from before switching to "HTML page": the editor hides these fields, so they must not block saving.
    const leftovers = { imageId: "../etc", imageUrl: "http://example.com/a.png" };
    const html = announcementInputSchema.safeParse({ ...valid, kind: "html", htmlVi: "<p>x</p>", ...leftovers });
    expect(html.success).toBe(true);
    expect(html.data).toMatchObject({ imageId: null, imageUrl: null, bodyVi: null });

    const rich = announcementInputSchema.safeParse({ ...valid, ...leftovers });
    expect(rich.error && fieldErrorsFromIssues(rich.error.issues)).toEqual({ imageId: "invalid", imageUrl: "https_only" });
    const long = announcementInputSchema.safeParse({ ...valid, imageUrl: `https://cdn.example/${"a".repeat(2_000)}` });
    expect(long.error && fieldErrorsFromIssues(long.error.issues)).toEqual({ imageUrl: "too_long" });
    expect(announcementInputSchema.parse({ ...valid, imageId: "cmabc_123-x" }).imageId).toBe("cmabc_123-x");
    // Still reported alongside an invalid choice elsewhere, which skips the other cross-field checks.
    const both = announcementInputSchema.safeParse({ ...valid, level: "loud", imageUrl: "ftp://x.example/a.png" });
    expect(both.error && fieldErrorsFromIssues(both.error.issues)).toEqual({ level: "invalid", imageUrl: "https_only" });
    // A payload that is not an object fails cleanly instead of reaching the image check.
    for (const bad of [null, 5, "x", [valid]]) expect(announcementInputSchema.safeParse(bad).success).toBe(false);
  });

  it("turns a stored announcement into editor values", () => {
    const startsAt = new Date("2026-10-07T01:02:03.000Z");
    const values = toAnnouncementFormValues({
      status: "published",
      kind: "html",
      level: "warning",
      displayMode: "until_dismissed",
      titleVi: "Tin",
      titleEn: null,
      bodyVi: null,
      bodyEn: null,
      htmlVi: "<p>x</p>",
      htmlEn: null,
      imageId: null,
      imageUrl: null,
      linkUrl: "https://faamoffice.net",
      linkLabelVi: "Mở",
      linkLabelEn: null,
      platforms: "linux,mac",
      minVersion: "0.11.0",
      maxVersion: null,
      startsAt,
      endsAt: null,
      priority: -3,
    });
    expect(values).toEqual({
      status: "published",
      kind: "html",
      level: "warning",
      displayMode: "until_dismissed",
      titleVi: "Tin",
      titleEn: "",
      bodyVi: "",
      bodyEn: "",
      htmlVi: "<p>x</p>",
      htmlEn: "",
      imageId: null,
      imageUrl: "",
      linkUrl: "https://faamoffice.net",
      linkLabelVi: "Mở",
      linkLabelEn: "",
      platforms: ["mac", "linux"],
      minVersion: "0.11.0",
      maxVersion: "",
      startsAt: "2026-10-07T01:02:03.000Z",
      endsAt: "",
      priority: "-3",
    });
    // The editor's values validate back to the same announcement.
    expect(announcementInputSchema.parse(values)).toMatchObject({ kind: "html", platforms: ["mac", "linux"], startsAt, priority: -3 });
  });

  it("drops content that does not belong to the kind", () => {
    const html = announcementInputSchema.parse({ ...valid, kind: "html", htmlVi: "<p>x</p>", imageUrl: "https://cdn.example/a.png" });
    expect(html).toMatchObject({ bodyVi: null, imageUrl: null, htmlVi: "<p>x</p>" });
    const rich = announcementInputSchema.parse({ ...valid, htmlVi: "<p>x</p>", linkLabelVi: "Mở" });
    expect(rich).toMatchObject({ htmlVi: null, linkLabelVi: null });
    const platforms = announcementInputSchema.parse({ ...valid, platforms: ["linux", "mac", "mac"] });
    expect(platforms.platforms).toEqual(["mac", "linux"]);
  });
});

describe("image magic bytes", () => {
  it("detects PNG, GIF, JPEG and WebP with dimensions", () => {
    expect(sniffImage(PNG_1X1)).toEqual({ mime: "image/png", width: 1, height: 1 });
    expect(sniffImage(GIF_1X1)).toEqual({ mime: "image/gif", width: 1, height: 1 });
    expect(sniffImage(jpeg(640, 360))).toEqual({ mime: "image/jpeg", width: 640, height: 360 });
    expect(sniffImage(webpVp8x(1200, 630))).toEqual({ mime: "image/webp", width: 1200, height: 630 });
    expect(sniffImage(webpVp8l(300, 200))).toEqual({ mime: "image/webp", width: 300, height: 200 });
  });

  it("rejects everything else, whatever the file is called", () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(text("<!doctype html><p>hi</p>"))).toBeNull();
    expect(sniffImage(text("%PDF-1.7"))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
    expect(sniffImage(PNG_1X1.subarray(0, 7))).toBeNull();
  });
});

describe("image fit", () => {
  const fit = (w: number, h: number) => {
    const { frameRatio, mode } = computeMediaFit(w, h);
    return [Math.round(frameRatio * 1000) / 1000, mode];
  };

  it("fills the frame with images close to its shape", () => {
    expect(fit(1600, 900)).toEqual([1.778, "cover"]);
    expect(fit(1200, 600)).toEqual([2, "cover"]);
    // 3:2 gets the tallest frame (16:10), cropping 6.7% of its width.
    expect(fit(1500, 1000)).toEqual([1.6, "cover"]);
    expect(fit(2600, 1000)).toEqual([2.6, "cover"]);
    expect(fit(3000, 1000)).toEqual([3, "cover"]);
    // A little past 3:1: the widest frame, cropping under 10% of its width.
    expect(fit(3300, 1000)).toEqual([3, "cover"]);
  });

  it("shows square, portrait, very wide and small images whole", () => {
    expect(fit(1024, 1024)).toEqual([1.6, "contain"]);
    expect(fit(800, 1200)).toEqual([1.6, "contain"]);
    // 4:1 would lose 25% of its width in the widest frame.
    expect(fit(4000, 1000)).toEqual([3, "contain"]);
    // The right shape, but filling 280+ px would upscale it.
    expect(fit(200, 112)).toEqual([1.786, "contain"]);
    expect(fit(280, 158)).toEqual([1.772, "cover"]);
  });

  it("uses a 16:9 frame for sizes it cannot use", () => {
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [-5, 10],
      [Number.NaN, 10],
      [10, Number.POSITIVE_INFINITY],
    ]) {
      expect(computeMediaFit(w, h)).toEqual({ frameRatio: 16 / 9, mode: "contain" });
    }
  });
});

describe("sandboxed frame", () => {
  it("uses a sandbox without scripts or same-origin and no script-src", () => {
    expect(FRAME_CSP).toContain("sandbox allow-popups allow-popups-to-escape-sandbox;");
    expect(FRAME_CSP).toContain("default-src 'none'");
    // embeddable from the packaged app's file:// window, which "frame-ancestors *" would refuse
    expect(FRAME_CSP).not.toContain("frame-ancestors");
    expect(FRAME_CSP).not.toMatch(/script-src|allow-scripts|allow-same-origin/);
    expect(FRAME_META_CSP).not.toMatch(/sandbox|frame-ancestors/);
    expect(FRAME_RESPONSE_HEADERS).not.toHaveProperty("X-Frame-Options");
  });

  it("wraps admin HTML in a complete document with links opening outside", () => {
    const doc = buildFrameDocument({ html: "<h1>Hi</h1>", title: 'A "quoted" <title>', lang: "en" });
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain('<html lang="en">');
    expect(doc).toContain('<base target="_blank">');
    expect(doc).toContain("<title>A &quot;quoted&quot; &lt;title&gt;</title>");
    expect(doc).toContain("prefers-color-scheme:dark");
    expect(doc).toContain("<body>\n<h1>Hi</h1>\n</body>");
    expect(doc).not.toContain("Content-Security-Policy");
    expect(buildFrameDocument({ html: "", title: "", lang: "vi", metaCsp: FRAME_META_CSP })).toContain('http-equiv="Content-Security-Policy"');
  });
});

describe("routing and headers for the frame", () => {
  const matches = (source: string, path: string) =>
    new RegExp(buildCustomRoute("header", { source, headers: [] }).regex).test(path);

  async function headersFor(path: string): Promise<Record<string, string>> {
    const rules = (await nextConfig.headers?.()) ?? [];
    const out: Record<string, string> = {};
    for (const rule of rules) {
      if (!matches(rule.source, path)) continue;
      for (const h of rule.headers) out[h.key] = h.value; // later rules override earlier ones
    }
    return out;
  }

  it("keeps X-Frame-Options and the site CSP away from the frame", async () => {
    const frame = await headersFor("/announcement-frame/abc123");
    expect(frame["X-Frame-Options"]).toBeUndefined();
    expect(frame["Content-Security-Policy"]).toBe(FRAME_CSP);
    expect(frame["Referrer-Policy"]).toBe("no-referrer");
    expect(frame["X-Content-Type-Options"]).toBe("nosniff");

    const page = await headersFor("/vi/download");
    expect(page["X-Frame-Options"]).toBe("DENY");
    expect(page["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });

  it("widens media sources only for the announcement editor", async () => {
    const editor = await headersFor("/vi/admin/announcements/new");
    expect(editor["X-Frame-Options"]).toBe("DENY");
    expect(editor["Content-Security-Policy"]).toContain("img-src 'self' data: blob: https:");
    expect(editor["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect((await headersFor("/en/admin/announcements"))["Content-Security-Policy"]).toContain("https:");
    expect((await headersFor("/vi/admin"))["Content-Security-Policy"]).not.toContain("https:");
  });

  it("is outside the locale proxy, robots-disallowed and not in the sitemap", () => {
    const matcher = proxyConfig.matcher[0];
    expect(matches(matcher, "/announcement-frame/abc123")).toBe(false);
    expect(matches(matcher, "/download")).toBe(true);
    const rules = robots().rules;
    const disallow = (Array.isArray(rules) ? rules : [rules]).flatMap((r) => r.disallow ?? []);
    expect(disallow).toContain("/announcement-frame/");
    expect(sitemap().some((entry) => entry.url.includes("announcement-frame"))).toBe(false);
  });
});

describe("editor copy", () => {
  const vt = vi.admin.announcements;
  const et = en.admin.announcements;

  it("names who dismisses an until_dismissed announcement", () => {
    expect(vt.displayMode.until_dismissed).toContain("người dùng");
    expect(vt.displayMode.until_dismissed).not.toBe("Đến khi tắt");
    expect(vt.state.scheduled).toBe("Đã lên lịch");
  });

  it("says the default button label needs both labels empty", () => {
    expect(vt.form.linkLabelHint).toContain("cả hai");
    expect(et.form.linkLabelHint).toContain("both");
  });

  it("states the 2 MB limit when an image is too large", () => {
    expect(vi.errors.image_too_large).toContain("2 MB");
    expect(en.errors.image_too_large).toContain("2 MB");
  });
});
