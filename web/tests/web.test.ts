// Locale negotiation, dictionaries, request guards and release asset mapping.

import { describe, expect, it } from "vitest";
import { classifyAssets } from "@/lib/releases";
import { assertSameOrigin, safeNextPath } from "@/lib/request-guards";
import { languageAlternates } from "@/lib/seo";
import { negotiateLocale } from "@/i18n/config";
import { en } from "@/i18n/dictionaries/en";
import { vi } from "@/i18n/dictionaries/vi";

describe("locale negotiation", () => {
  it("defaults to Vietnamese", () => {
    expect(negotiateLocale(null)).toBe("vi");
    expect(negotiateLocale("")).toBe("vi");
    expect(negotiateLocale("fr-FR,de;q=0.8")).toBe("vi");
  });

  it("respects q-values and order", () => {
    expect(negotiateLocale("en-US,en;q=0.9")).toBe("en");
    expect(negotiateLocale("vi-VN,vi;q=0.9,en;q=0.8")).toBe("vi");
    expect(negotiateLocale("fr;q=1,en;q=0.5,vi;q=0.4")).toBe("en");
    expect(negotiateLocale("en;q=0.2,vi;q=0.9")).toBe("vi");
    expect(negotiateLocale("en;q=0")).toBe("vi");
  });

  it("builds hreflang alternates with x-default", () => {
    expect(languageAlternates("/download")).toEqual({ vi: "/vi/download", en: "/en/download", "x-default": "/download" });
    expect(languageAlternates("")).toEqual({ vi: "/vi", en: "/en", "x-default": "/" });
  });
});

describe("dictionaries", () => {
  function shape(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(shape);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
    }
    return typeof value;
  }

  it("English has exactly the same keys and list lengths as Vietnamese", () => {
    expect(shape(en)).toEqual(shape(vi));
  });

  it("has no empty strings", () => {
    const walk = (v: unknown, path: string) => {
      if (typeof v === "string") expect(v.trim(), path).not.toBe("");
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(vi, "vi");
    walk(en, "en");
  });
});

describe("request guards", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/x", { method: "POST", headers });

  it("accepts same-origin requests", () => {
    process.env.SITE_URL = "https://faamoffice.example";
    expect(() => assertSameOrigin(req({ origin: "https://faamoffice.example" }))).not.toThrow();
    expect(() => assertSameOrigin(req({ origin: "http://localhost:3100", host: "localhost:3100" }))).not.toThrow();
  });

  it("rejects missing or foreign origins", () => {
    process.env.SITE_URL = "https://faamoffice.example";
    expect(() => assertSameOrigin(req({}))).toThrow(/Origin/);
    expect(() => assertSameOrigin(req({ origin: "https://evil.example", host: "faamoffice.example" }))).toThrow();
    expect(() => assertSameOrigin(req({ origin: "null", host: "faamoffice.example" }))).toThrow();
  });

  it("only allows local post-login redirects", () => {
    expect(safeNextPath("/vi/device?code=BCDF-GHJK", "/x")).toBe("/vi/device?code=BCDF-GHJK");
    expect(safeNextPath("https://evil.example", "/x")).toBe("/x");
    expect(safeNextPath("//evil.example", "/x")).toBe("/x");
    expect(safeNextPath("/\\evil.example", "/x")).toBe("/x");
    expect(safeNextPath(undefined, "/x")).toBe("/x");
  });
});

describe("release assets", () => {
  const asset = (name: string) => ({ name, browser_download_url: `https://example.com/${name}`, size: 1 });

  it("maps FaamOffice electron-builder artifacts to download slots", () => {
    const out = classifyAssets(
      [
        "FaamOffice-0.11.0-arm64.dmg",
        "FaamOffice-0.11.0-arm64.dmg.blockmap",
        "FaamOffice-0.11.0.dmg",
        "FaamOffice-0.11.0-arm64-mac.zip",
        "FaamOffice.Setup.0.11.0.exe",
        "FaamOffice.Setup.0.11.0.exe.blockmap",
        "FaamOffice-0.11.0.AppImage",
        "faamoffice_0.11.0_amd64.deb",
        "faamoffice-0.11.0.x86_64.rpm",
        "latest-mac.yml",
      ].map(asset),
    );
    expect(out.macArm?.name).toBe("FaamOffice-0.11.0-arm64.dmg");
    expect(out.macIntel?.name).toBe("FaamOffice-0.11.0.dmg");
    expect(out.winExe?.name).toBe("FaamOffice.Setup.0.11.0.exe");
    expect(out.appImage?.name).toBe("FaamOffice-0.11.0.AppImage");
    expect(out.deb?.name).toBe("faamoffice_0.11.0_amd64.deb");
    expect(out.rpm?.name).toBe("faamoffice-0.11.0.x86_64.rpm");
  });

  it("handles universal builds and missing platforms", () => {
    const out = classifyAssets([asset("FaamOffice-1.0.0-universal.dmg")]);
    expect(out.macArm?.name).toBe("FaamOffice-1.0.0-universal.dmg");
    expect(out.macIntel?.name).toBe("FaamOffice-1.0.0-universal.dmg");
    expect(out.winExe).toBeUndefined();
  });
});
