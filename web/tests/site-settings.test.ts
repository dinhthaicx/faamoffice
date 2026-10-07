// Site settings without a database: the zod schemas (strict booleans, daily
// limit parsing, social link hosts and limits), the public link shape, the
// UTC+7 quota day, and the website footer's "Follow FaamOffice" row.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreditsSettings, SocialLinksSettings, validateSocialRows } from "@/components/site-settings-form";
import { SiteFooter } from "@/components/site-footer";
import { quotaDayStart, quotaResetsAt, secondsUntilReset } from "@/lib/ai-quota";
import {
  defaultSiteSettings,
  MAX_SOCIAL_LINKS,
  parseStoredSocialLinks,
  publicSocialLinks,
  settingsFieldErrors,
  settingsPatchSchema,
  settingsPutSchema,
  settingValueSchemas,
  SOCIAL_URL_MAX,
  socialLinksSchema,
  socialUrlAllowed,
  type PublicSocialLink,
  type SocialPlatform,
} from "@/lib/site-settings-shared";
import { en } from "@/i18n/dictionaries/en";
import { vi } from "@/i18n/dictionaries/vi";

const link = (platform: SocialPlatform, url: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${platform}`,
  platform,
  url,
  enabled: true,
  ...extra,
});

function patchErrors(body: unknown) {
  const result = settingsPatchSchema.safeParse(body);
  return result.success ? {} : settingsFieldErrors(result.error.issues);
}

describe("settings schema", () => {
  it("has the documented defaults", () => {
    expect(defaultSiteSettings()).toEqual({
      creditsEnabled: true, aiDailyRequestLimit: 300, socialLinks: [],
      ads: { enabled: false, publisherId: null, autoAds: true, slots: {}, adsTxtExtra: "" },
      msStore: { enabled: false, productId: "9P0RJ9J87ZNQ" },
    });
    // Fresh copies: mutating one never leaks into the next.
    defaultSiteSettings().socialLinks.push({ id: "x", platform: "x", url: "https://x.com/a", label: null, enabled: true });
    expect(defaultSiteSettings().socialLinks).toEqual([]);
    const mutated = defaultSiteSettings();
    mutated.ads.slots.homeBottom = "1234567890";
    mutated.msStore.enabled = true;
    expect(defaultSiteSettings().ads.slots).toEqual({});
    expect(defaultSiteSettings().msStore.enabled).toBe(false);
  });

  it("only accepts real booleans for creditsEnabled (z.coerce.boolean('false') would be true)", () => {
    expect(settingsPatchSchema.parse({ creditsEnabled: false })).toEqual({ creditsEnabled: false });
    for (const value of ["false", "true", 0, 1, null]) {
      expect(patchErrors({ creditsEnabled: value })).toEqual({ creditsEnabled: "invalid" });
    }
  });

  it("parses the daily limit from numbers and numeric strings, never from an empty string", () => {
    expect(settingsPatchSchema.parse({ aiDailyRequestLimit: 0 })).toEqual({ aiDailyRequestLimit: 0 });
    expect(settingsPatchSchema.parse({ aiDailyRequestLimit: " 250 " })).toEqual({ aiDailyRequestLimit: 250 });
    expect(patchErrors({ aiDailyRequestLimit: "" })).toEqual({ aiDailyRequestLimit: "invalid" });
    expect(patchErrors({ aiDailyRequestLimit: 1.5 })).toEqual({ aiDailyRequestLimit: "invalid" });
    expect(patchErrors({ aiDailyRequestLimit: -1 })).toEqual({ aiDailyRequestLimit: "out_of_range" });
    expect(patchErrors({ aiDailyRequestLimit: "-1" })).toEqual({ aiDailyRequestLimit: "out_of_range" });
    expect(patchErrors({ aiDailyRequestLimit: 1_000_001 })).toEqual({ aiDailyRequestLimit: "out_of_range" });
  });

  it("accepts partial PATCH bodies, rejects unknown keys, and requires every key for PUT", () => {
    expect(settingsPatchSchema.parse({})).toEqual({});
    expect(settingsPatchSchema.safeParse({ creditsEnabled: true, extra: 1 }).success).toBe(false);
    expect(settingsPutSchema.safeParse({ creditsEnabled: true }).success).toBe(false);
    expect(settingsPutSchema.parse({ ...defaultSiteSettings(), creditsEnabled: false, aiDailyRequestLimit: 10 })).toEqual({
      ...defaultSiteSettings(),
      creditsEnabled: false,
      aiDailyRequestLimit: 10,
      socialLinks: [],
    });
  });
});

describe("social links", () => {
  it("requires https URLs on the platform's own domains (subdomains included)", () => {
    const ok: [SocialPlatform, string][] = [
      ["facebook", "https://www.facebook.com/faamoffice"],
      ["facebook", "https://m.facebook.com/faamoffice"],
      ["facebook", "https://fb.me/faamoffice"],
      ["facebook", "https://fb.com/faamoffice"],
      ["youtube", "https://www.youtube.com/@faamoffice"],
      ["youtube", "https://youtu.be/abc"],
      ["tiktok", "https://www.tiktok.com/@faamoffice"],
      ["tiktok", "https://vt.tiktok.com/ZS123/"],
      ["zalo", "https://zalo.me/123456789"],
      ["x", "https://x.com/faamoffice"],
      ["x", "https://twitter.com/faamoffice"],
      ["instagram", "https://instagram.com/faamoffice"],
      ["threads", "https://www.threads.net/@faamoffice"],
      ["threads", "https://www.threads.com/@faamoffice"],
      ["telegram", "https://t.me/faamoffice"],
      ["telegram", "https://telegram.me/faamoffice"],
      ["discord", "https://discord.gg/abc"],
      ["discord", "https://discord.com/invite/abc"],
      ["github", "https://github.com/dinhthaicx/faamoffice"],
      ["linkedin", "https://www.linkedin.com/company/faamoffice"],
      ["website", "https://faamoffice.net/vi"],
      ["website", "https://blog.example.org/"],
    ];
    for (const [platform, url] of ok) expect(socialUrlAllowed(platform, url), `${platform} ${url}`).toBe(true);

    const bad: [SocialPlatform, string][] = [
      ["facebook", "http://facebook.com/faamoffice"],
      ["facebook", "https://www.youtube.com/@faamoffice"],
      ["facebook", "https://evilfacebook.com/x"],
      ["facebook", "https://facebook.com.evil.example/x"],
      ["youtube", "https://youtube.co/x"],
      ["x", "https://x.co/x"],
      ["github", "https://user:pass@github.com/x"],
      ["website", "http://faamoffice.net"],
      ["website", "javascript:alert(1)"],
    ];
    for (const [platform, url] of bad) expect(socialUrlAllowed(platform, url), `${platform} ${url}`).toBe(false);
  });

  it("reports https_only, wrong_host, too_long and required per link, keyed by path", () => {
    expect(
      patchErrors({
        socialLinks: [
          link("facebook", "http://facebook.com/a"),
          link("youtube", "https://facebook.com/a"),
          link("tiktok", ""),
          link("website", "https://example.com", { label: "x".repeat(41) }),
          link("zalo", "https://zalo.me/1", { platform: "myspace" }),
        ],
      }),
    ).toEqual({
      "socialLinks.0.url": "https_only",
      "socialLinks.1.url": "wrong_host",
      "socialLinks.2.url": "required",
      "socialLinks.3.label": "too_long",
      "socialLinks.4.platform": "invalid",
    });
  });

  it("limits the stored (canonical) URL, so whatever is saved reads back", () => {
    // Each "Trường-Đại-Học-" is 15 characters typed but 49 once percent-encoded.
    const path = "Trường-Đại-Học-".repeat(9);
    const base = `https://www.facebook.com/${path}`;
    const atLimit = base + "a".repeat(SOCIAL_URL_MAX - new URL(base).href.length);
    expect(atLimit.length).toBeLessThan(200);
    expect(new URL(atLimit).href).toHaveLength(SOCIAL_URL_MAX);

    const body = { socialLinks: [link("facebook", atLimit), link("youtube", "https://www.youtube.com/@faamoffice")] };
    const saved = settingsPatchSchema.parse(body).socialLinks!;
    // Round trip as updateSiteSettings stores it and loadSiteSettings reads it.
    const reread = settingValueSchemas.socialLinks.safeParse(JSON.parse(JSON.stringify(saved)));
    expect(reread.success).toBe(true);
    expect(reread.data).toEqual(saved);
    expect(parseStoredSocialLinks(JSON.parse(JSON.stringify(saved)))).toEqual({ links: saved, dropped: [] });

    // One character more once encoded: refused on save, with the same field error as a long typed URL.
    expect(patchErrors({ socialLinks: [link("facebook", `${atLimit}b`)] })).toEqual({ "socialLinks.0.url": "too_long" });
    expect(patchErrors({ socialLinks: [link("facebook", `${base}${"Đ".repeat(20)}`)] })).toEqual({ "socialLinks.0.url": "too_long" });
  });

  it("reads a stored list link by link: an invalid entry is dropped on its own", () => {
    const stored = [
      { id: "fb", platform: "facebook", url: "https://www.facebook.com/faamoffice", label: null, enabled: true },
      { id: "bad", platform: "facebook", url: "https://www.youtube.com/@faam", label: null, enabled: true },
      { id: "long", platform: "website", url: `https://faamoffice.net/${"x".repeat(SOCIAL_URL_MAX)}`, label: null, enabled: true },
      { id: "fb", platform: "x", url: "https://x.com/faam", label: null, enabled: true },
      "not a link",
      { id: "yt", platform: "youtube", url: "https://www.youtube.com/@faamoffice", label: "Kênh", enabled: false },
    ];
    expect(socialLinksSchema.safeParse(stored).success).toBe(false);
    expect(parseStoredSocialLinks(stored)).toEqual({
      links: [
        { id: "fb", platform: "facebook", url: "https://www.facebook.com/faamoffice", label: null, enabled: true },
        { id: "yt", platform: "youtube", url: "https://www.youtube.com/@faamoffice", label: "Kênh", enabled: false },
      ],
      dropped: [1, 2, 3, 4],
    });
    // Never more than the maximum, even from a hand-edited row.
    const many = Array.from({ length: MAX_SOCIAL_LINKS + 2 }, (_, i) => link("website", `https://example.com/${i}`, { id: `l${i}` }));
    const read = parseStoredSocialLinks(many)!;
    expect(read.links).toHaveLength(MAX_SOCIAL_LINKS);
    expect(read.dropped).toEqual([MAX_SOCIAL_LINKS, MAX_SOCIAL_LINKS + 1]);
    // Not a list at all: the caller falls back to the default.
    expect(parseStoredSocialLinks({ socials: [] })).toBeNull();
  });

  it(`allows at most ${MAX_SOCIAL_LINKS} links and unique ids`, () => {
    const many = Array.from({ length: MAX_SOCIAL_LINKS + 1 }, (_, i) => link("website", `https://example.com/${i}`, { id: `l${i}` }));
    expect(patchErrors({ socialLinks: many })).toEqual({ socialLinks: "too_many" });
    expect(socialLinksSchema.safeParse(many.slice(0, MAX_SOCIAL_LINKS)).success).toBe(true);
    const dup = [link("x", "https://x.com/a", { id: "same" }), link("github", "https://github.com/a", { id: "same" })];
    expect(patchErrors({ socialLinks: dup })).toEqual({ "socialLinks.1.id": "duplicate" });
  });

  it("normalizes links: trims, generates missing ids, empty labels become null", () => {
    const [a, b] = socialLinksSchema.parse([
      { platform: "facebook", url: "  https://FACEBOOK.com/faam  ", label: "   ", enabled: true },
      { id: "keep-me", platform: "website", url: "https://example.com", label: " Blog ", enabled: false },
    ]);
    expect(a).toMatchObject({ platform: "facebook", url: "https://facebook.com/faam", label: null, enabled: true });
    expect(a.id).toMatch(/^[a-z0-9]{6,10}$/);
    expect(b).toEqual({ id: "keep-me", platform: "website", url: "https://example.com/", label: "Blog", enabled: false });
  });

  it("exposes enabled links only, in order, without empty labels", () => {
    const links = socialLinksSchema.parse([
      link("youtube", "https://youtube.com/@a", { id: "b", label: "Kênh chính" }),
      link("facebook", "https://facebook.com/a", { id: "a", enabled: false }),
      link("zalo", "https://zalo.me/1", { id: "c" }),
    ]);
    expect(publicSocialLinks(links)).toEqual([
      { id: "b", platform: "youtube", url: "https://youtube.com/@a", label: "Kênh chính" },
      { id: "c", platform: "zalo", url: "https://zalo.me/1" },
    ]);
  });

  it("the admin editor validates rows with the server's keys", () => {
    const rows = [
      { id: "a", platform: "facebook" as const, url: "https://facebook.com/a", label: "", enabled: true },
      { id: "b", platform: "youtube" as const, url: "https://tiktok.com/@a", label: "", enabled: true },
    ];
    expect(validateSocialRows(rows)).toEqual({ "socialLinks.1.url": "wrong_host" });
    expect(validateSocialRows(rows.slice(0, 1))).toEqual({});
  });
});

describe("daily quota day (Asia/Ho_Chi_Minh, UTC+7)", () => {
  it("starts at local midnight = 17:00 UTC the day before", () => {
    // 23:59:59 local on Oct 7 → day started Oct 7 00:00 local = Oct 6 17:00 UTC.
    expect(quotaDayStart(new Date("2026-10-07T16:59:59.999Z")).toISOString()).toBe("2026-10-06T17:00:00.000Z");
    // 00:00 local on Oct 8 → a new day.
    expect(quotaDayStart(new Date("2026-10-07T17:00:00.000Z")).toISOString()).toBe("2026-10-07T17:00:00.000Z");
    // 06:59 UTC is still the same local day (13:59 local).
    expect(quotaDayStart(new Date("2026-10-07T06:59:00.000Z")).toISOString()).toBe("2026-10-06T17:00:00.000Z");
  });

  it("resets at the next local midnight; Retry-After counts whole seconds, at least 1", () => {
    const now = new Date("2026-10-07T16:00:00.000Z"); // 23:00 local
    expect(quotaResetsAt(now).toISOString()).toBe("2026-10-07T17:00:00.000Z");
    expect(secondsUntilReset(now)).toBe(3600);
    expect(secondsUntilReset(new Date("2026-10-07T16:59:59.999Z"))).toBe(1);
    expect(secondsUntilReset(new Date("2026-10-07T17:00:00.000Z"))).toBe(86_400);
  });
});

describe("website footer", () => {
  const socials: PublicSocialLink[] = [
    { id: "yt", platform: "youtube", url: "https://www.youtube.com/@faamoffice" },
    { id: "fb", platform: "facebook", url: "https://www.facebook.com/faamoffice", label: "Fanpage" },
    { id: "web", platform: "website", url: "https://blog.faamoffice.net/" },
  ];
  const render = (locale: "vi" | "en", list: PublicSocialLink[]) =>
    renderToStaticMarkup(createElement(SiteFooter, { locale, dict: locale === "vi" ? vi : en, socials: list }));

  it("shows a Follow row with one accessible, new-tab icon link per channel, in order", () => {
    const html = render("vi", socials);
    expect(html).toContain(">Theo dõi FaamOffice</h2>");
    const anchors = [...html.matchAll(/<a [^>]*target="_blank"[^>]*>/g)].map((m) => m[0]);
    expect(anchors).toHaveLength(3);
    expect(anchors[0]).toContain('href="https://www.youtube.com/@faamoffice"');
    expect(anchors[0]).toContain('aria-label="Theo dõi FaamOffice trên YouTube"');
    expect(anchors[1]).toContain('aria-label="Theo dõi FaamOffice trên Facebook: Fanpage"');
    // A website is visited, not followed (the desktop row says the same).
    expect(anchors[2]).toContain('aria-label="Truy cập trang web FaamOffice"');
    expect(anchors[2]).toContain('title="Truy cập trang web FaamOffice"');
    for (const a of anchors) expect(a).toContain('rel="noopener noreferrer me"');
    // Icons are decorative inline SVG painted with currentColor; nothing is loaded from elsewhere.
    expect(html).toMatch(/<svg[^>]*fill="currentColor"[^>]*aria-hidden="true"/);
    expect(html).not.toMatch(/<img|<script|https:\/\/cdn/);
  });

  it("is translated and disappears when there are no channels", () => {
    const english = render("en", socials);
    expect(english).toContain(">Follow FaamOffice</h2>");
    expect(english).toContain('aria-label="Follow FaamOffice on YouTube"');
    expect(english).toContain('aria-label="Visit the FaamOffice website"');
    expect(english).not.toContain("on Website");
    const empty = render("vi", []);
    expect(empty).not.toContain("Theo dõi FaamOffice");
    expect(empty).not.toContain('target="_blank"');
    expect(empty).toContain("Chính sách quyền riêng tư");
  });
});

describe("admin settings editor (server-rendered markup)", () => {
  const t = vi.admin.settings;

  it("shows the credits state, an accessible switch and the daily limit field", () => {
    const off = renderToStaticMarkup(
      createElement(CreditsSettings, { initial: { creditsEnabled: false, aiDailyRequestLimit: 300 }, t, errors: vi.errors }),
    );
    expect(off).toContain(">Đang tắt</span>");
    expect(off).toContain(t.credits.explainOff);
    expect(off).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(off).toContain(">Số lượt Faam AI mỗi người mỗi ngày khi tắt credit (0 = không giới hạn)</label>");
    expect(off).toMatch(/name="aiDailyRequestLimit"[^>]*value="300"/);
    // Admins are told that 0.11.1 and older show the limit as "busy".
    expect(off).toContain("FaamOffice 0.11.1 trở về trước");
    expect(off).toContain("“Đến phiên bản” 0.11.1");

    const on = renderToStaticMarkup(
      createElement(CreditsSettings, { initial: { creditsEnabled: true, aiDailyRequestLimit: 0 }, t: en.admin.settings, errors: en.errors }),
    );
    expect(on).toContain(">On</span>");
    expect(on).toMatch(/role="switch"[^>]*aria-checked="true"/);
  });

  it("lists the links with labelled fields, host hints and reorder buttons", () => {
    const html = renderToStaticMarkup(
      createElement(SocialLinksSettings, {
        initial: [
          { id: "a", platform: "facebook", url: "https://facebook.com/faam", label: "Fanpage", enabled: true },
          { id: "b", platform: "website", url: "https://faamoffice.net/", label: null, enabled: false },
        ],
        t,
        errors: vi.errors,
        websiteName: vi.footer.website,
      }),
    );
    expect(html).toContain("2/12 kênh");
    expect(html).toContain("Tên miền hợp lệ: facebook.com, fb.com, fb.me.");
    expect(html).toContain("Bất kỳ địa chỉ https nào.");
    expect(html).toMatch(/value="https:\/\/facebook.com\/faam"/);
    expect(html).toContain('aria-label="Đưa lên: Kênh 2"');
    expect(html).toContain('aria-label="Xóa: Kênh 1"');
    // Every input and select has a <label for>.
    const ids = [...html.matchAll(/<(?:input|select)[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    for (const id of ids) expect(html).toContain(`for="${id}"`);
    expect(ids.length).toBeGreaterThanOrEqual(6);

    const empty = renderToStaticMarkup(
      createElement(SocialLinksSettings, { initial: [], t, errors: vi.errors, websiteName: vi.footer.website }),
    );
    expect(empty).toContain(t.socials.empty);
  });
});
