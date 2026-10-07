import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdSlot, AdsenseScript } from "@/components/ads";
import { privacyWithAds } from "@/components/legal-page";
import { AdsSettings, MsStoreSettings } from "@/components/site-settings-marketing-form";
import { adPageForPath, adsForPage, adsTxtBody, needsFullPageLoad } from "@/lib/ads";
import { adPagesCsp, cspEnv, siteCsp } from "@/lib/csp";
import { readSiteSettings } from "@/lib/site-settings-read";
import { defaultSiteSettings, settingsFieldErrors, settingsPatchSchema } from "@/lib/site-settings-shared";
import { msStoreUrl } from "@/lib/site";
import { proxy } from "@/proxy";
import nextConfig from "../next.config";
import { en } from "@/i18n/dictionaries/en";
import { vi as vietnamese } from "@/i18n/dictionaries/vi";

vi.mock("@/lib/site-settings-read", () => ({ readSiteSettings: vi.fn() }));
const client = "ca-pub-1234567890123456";
const configured = () => ({ ...defaultSiteSettings().ads, publisherId: client });
const active = () => ({ ...configured(), enabled: true });
const patchErrors = (body: unknown) => {
  const parsed = settingsPatchSchema.safeParse(body);
  return parsed.success ? {} : settingsFieldErrors(parsed.error.issues);
};

describe("advertising and Store validation", () => {
  it("normalizes publisher, ad units, extra records and Store IDs before saving", () => {
    const parsed = settingsPatchSchema.parse({
      ads: {
        ...active(),
        publisherId: " PUB-1234567890123456 ",
        slots: { homeBottom: " 1234567890 ", contentInline: "" },
        adsTxtExtra: "\n Example.COM, account-1, reseller, abc123\r\n",
      },
      msStore: { enabled: true, productId: " 9p0rj9j87znq " },
    });
    expect(parsed.ads).toEqual({
      ...active(),
      slots: { homeBottom: "1234567890" },
      adsTxtExtra: "example.com, account-1, RESELLER, abc123",
    });
    expect(parsed.msStore).toEqual({ enabled: true, productId: "9P0RJ9J87ZNQ" });
  });

  it("rejects enabled ads without a publisher and reports individual input errors", () => {
    expect(patchErrors({ ads: { ...active(), publisherId: null } })).toEqual({
      "ads.publisherId": "required",
    });
    expect(
      patchErrors({
        ads: {
          ...active(),
          publisherId: "<script>",
          slots: { homeBottom: "abc" },
          adsTxtExtra: "\ninvalid",
        },
        msStore: { enabled: true, productId: "../listing" },
      }),
    ).toEqual({
      "ads.publisherId": "publisher_id",
      "ads.slots.homeBottom": "slot_id",
      "ads.adsTxtExtra.1": "ads_txt_line",
      "msStore.productId": "store_id",
    });
    expect(patchErrors({ ads: { ...active(), enabled: "false" } })).toEqual({
      "ads.enabled": "invalid",
    });
    expect(patchErrors({ msStore: { enabled: "false", productId: "9P0RJ9J87ZNQ" } })).toEqual({
      "msStore.enabled": "invalid",
    });
  });

  it("limits extra ads.txt records and rejects multiline injected fields", () => {
    expect(
      patchErrors({
        ads: { ...configured(), adsTxtExtra: Array(51).fill("example.com, 1, DIRECT").join("\n") },
      }),
    ).toEqual({ "ads.adsTxtExtra": "ads_txt_lines" });
    expect(
      patchErrors({
        ads: { ...configured(), adsTxtExtra: "example.com, 1, DIRECT, invalid cert" },
      }),
    ).toEqual({ "ads.adsTxtExtra.0": "ads_txt_line" });
  });
});

describe("ad pages and document navigation", () => {
  it("only serves ads on localized home and Faam AI pages", () => {
    expect(adPageForPath("/vi/")).toBe("home");
    expect(adPageForPath("/en/faam-ai/")).toBe("faamAi");
    for (const path of ["/vi/download", "/en/account", "/vi/admin", "/vi/login", "/en/privacy", "/en/not-a-page", "/ads.txt", "/faam-ai", "/de"]) {
      expect(adPageForPath(path), path).toBeNull();
    }
    expect(adsForPage(configured(), "home")).toBeNull();
    expect(adsForPage(active(), "home")).toEqual({ client, slot: null });
    const manual = { ...active(), autoAds: false, slots: { contentInline: "1234567890" } };
    expect(adsForPage(manual, "home")).toBeNull();
    expect(adsForPage(manual, "faamAi")).toEqual({ client, slot: "1234567890" });
  });

  it("reloads documents when entering, leaving or changing locale on an ad page", () => {
    for (const [from, to] of [
      ["/vi", "/vi/download"],
      ["/vi/download", "/vi"],
      ["/en/account", "/en/faam-ai"],
      ["/vi", "/en"],
    ]) {
      expect(needsFullPageLoad({ href: to, hreflang: "en" }, { href: `https://faam.test${from}` }, { button: 0 })).toBe(true);
    }
    for (const href of ["#features", "https://another.test/vi", "/vi"]) {
      expect(needsFullPageLoad({ href }, { href: "https://faam.test/vi" }, { button: 0 })).toBe(false);
    }
    expect(needsFullPageLoad({ href: "/en/privacy" }, { href: "https://faam.test/en/download" }, { button: 0 })).toBe(false);
    for (const click of [{ button: 1 }, { button: 0, ctrlKey: true }, { button: 0, defaultPrevented: true }]) {
      expect(needsFullPageLoad({ href: "/vi/download" }, { href: "https://faam.test/vi" }, click)).toBe(false);
    }
    expect(needsFullPageLoad({ href: "/vi/download", download: true }, { href: "https://faam.test/vi" }, { button: 0 })).toBe(false);
  });
});

describe("verification and public output", () => {
  it("serves verification records even while ads are off, and removes duplicates", () => {
    expect(adsTxtBody(defaultSiteSettings().ads)).toBeNull();
    expect(
      adsTxtBody({
        ...configured(),
        adsTxtExtra: "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\nexample.com, 1, RESELLER",
      }),
    ).toBe("google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\nexample.com, 1, RESELLER\n");
  });

  it("keeps distinct case-sensitive seller account IDs", () => {
    expect(adsTxtBody({ ...configured(), adsTxtExtra: "example.com, Account, DIRECT\nexample.com, account, DIRECT" }))
      .toContain("example.com, Account, DIRECT\nexample.com, account, DIRECT\n");
  });

  it("renders no script or ad unit by default, and labels configured units", () => {
    expect(renderToStaticMarkup(createElement(AdsenseScript, { ads: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(AdSlot, { ads: { client, slot: null }, label: "Advertisement" }))).toBe("");
    const ads = { client, slot: "1234567890" };
    expect(renderToStaticMarkup(createElement(AdsenseScript, { ads }))).toContain(`adsbygoogle.js?client=${client}`);
    const html = renderToStaticMarkup(createElement(AdSlot, { ads, label: "Advertisement" }));
    expect(html).toContain('aria-label="Advertisement"');
    expect(html).toContain('data-ad-slot="1234567890"');
  });

  it.each([vietnamese, en])("adds advertising disclosures without mutating the original policy", (dict) => {
    const before = JSON.stringify(dict.privacy);
    const content = privacyWithAds(dict.privacy);
    const cookie = content.sections.findIndex((section) => section.id === "cookies");
    expect(content.sections[cookie].after).toBe(dict.privacy.ads.cookiesAfter);
    expect(content.sections[cookie + 1].heading).toBe(`${cookie + 2}. ${dict.privacy.ads.section.heading}`);
    expect(content.sections.map((section) => Number.parseInt(section.heading))).toEqual(
      Array.from({ length: dict.privacy.sections.length + 1 }, (_, i) => i + 1),
    );
    expect(JSON.stringify(dict.privacy)).toBe(before);
  });

  it.each([vietnamese, en])("provides localized controls with ads and the Store badge off by default", (dict) => {
    const defaults = defaultSiteSettings();
    const ads = renderToStaticMarkup(
      createElement(AdsSettings, {
        initial: defaults.ads,
        t: dict.admin.settings,
        errors: dict.errors,
      }),
    );
    expect(ads).toContain('role="switch" aria-checked="false"');
    expect(ads).toContain('name="ads.publisherId"');
    expect(ads).toContain('name="ads.slots.homeBottom"');
    expect(ads).toContain('href="/ads.txt"');
    const store = renderToStaticMarkup(
      createElement(MsStoreSettings, {
        initial: defaults.msStore,
        t: dict.admin.settings,
        errors: dict.errors,
      }),
    );
    expect(store).toContain('role="switch" aria-checked="false"');
    expect(store).toContain('name="msStore.productId"');
    expect(msStoreUrl(defaults.msStore.productId)).toBe("https://apps.microsoft.com/detail/9P0RJ9J87ZNQ?launch=true&mode=full");
  });
});

describe("ad page Content-Security-Policy", () => {
  beforeEach(() => {
    vi.mocked(readSiteSettings).mockResolvedValue({
      settings: defaultSiteSettings(),
      degraded: [],
      queryFailed: false,
    });
  });

  it("keeps the strict policy identical to Next's site-wide header", async () => {
    const headers = await nextConfig.headers!();
    expect(headers[0].headers.find((header) => header.key === "Content-Security-Policy")?.value).toBe(siteCsp(cspEnv()));
  });

  it("only relaxes the response header on a page actually loading ads", async () => {
    const settings = {
      ...defaultSiteSettings(),
      ads: { ...active(), autoAds: false, slots: { homeBottom: "1234567890" } },
    };
    vi.mocked(readSiteSettings).mockResolvedValue({ settings, degraded: [], queryFailed: false });
    expect((await proxy(new NextRequest("https://faam.test/vi"))).headers.get("content-security-policy")).toBe(adPagesCsp(cspEnv()));
    for (const path of ["/en/faam-ai", "/vi/download", "/en/privacy", "/vi/account", "/vi/admin", "/vi/unknown"]) {
      expect((await proxy(new NextRequest(`https://faam.test${path}`))).headers.has("content-security-policy"), path).toBe(false);
    }
  });

  it("keeps the site-wide policy when ads are disabled or the database failed", async () => {
    expect((await proxy(new NextRequest("https://faam.test/vi"))).headers.has("content-security-policy")).toBe(false);
    vi.mocked(readSiteSettings).mockResolvedValue({
      settings: defaultSiteSettings(),
      degraded: ["ads"],
      queryFailed: true,
    });
    expect((await proxy(new NextRequest("https://faam.test/en/faam-ai"))).headers.has("content-security-policy")).toBe(false);
  });
});
