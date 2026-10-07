// The announcement editor rendered on the server (no DOM needed): accessibility
// of the image upload and the preview's mock controls, the preview's image
// frame, hints, the saved notice after creating, and the helpers that place
// field errors.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AnnouncementForm,
  AnnouncementPreview,
  describedBy,
  EMPTY_ANNOUNCEMENT,
  splitFieldErrors,
  type AnnouncementFormValues,
  type ImageSize,
} from "@/components/announcement-form";
import { en } from "@/i18n/dictionaries/en";
import { vi as viDict } from "@/i18n/dictionaries/vi";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {}, replace() {} }) }));

const t = viDict.admin.announcements;

function renderForm(values: Partial<AnnouncementFormValues> = {}, justCreated?: boolean) {
  return renderToStaticMarkup(
    createElement(AnnouncementForm, {
      locale: "vi",
      mode: "edit",
      announcementId: "a1",
      initial: { ...EMPTY_ANNOUNCEMENT, titleVi: "Tin", ...values },
      initialImage: null,
      justCreated,
      t,
      errors: viDict.errors,
    }),
  );
}

/** The opening tag of the element with this id. */
const tagWithId = (html: string, id: string) => html.match(new RegExp(`<[a-z]+ [^>]*id="${id}"[^>]*>`))?.[0] ?? "";

describe("preview", () => {
  it("keeps the mock checkbox and Close out of the accessibility tree, but not the real link", () => {
    const html = renderToStaticMarkup(
      createElement(AnnouncementPreview, {
        values: { ...EMPTY_ANNOUNCEMENT, titleVi: "Tin", displayMode: "until_dismissed", linkUrl: "https://faamoffice.net" },
        previewLocale: "vi",
        imageSrc: null,
        t,
      }),
    );
    const mocks = html.match(/<div inert="" aria-hidden="true"[^>]*>.*?<\/div>/g) ?? [];
    expect(mocks).toHaveLength(2);
    expect(mocks[0]).toMatch(/<input type="checkbox" disabled=""\/> Không hiện lại/);
    expect(mocks[1]).toMatch(/<button [^>]*>Đóng<\/button>/);
    // Outside the inert wrappers only the link button is interactive.
    const rest = mocks.reduce((acc, m) => acc.replace(m, ""), html);
    expect(rest).not.toMatch(/<(button|input)\b/);
    expect(rest).toContain('<a href="https://faamoffice.net" target="_blank" rel="noopener noreferrer"');
  });
});

describe("preview layout", () => {
  const preview = (values: Partial<AnnouncementFormValues>, imageSrc: string | null = null, imageSize: ImageSize | null = null) =>
    renderToStaticMarkup(
      createElement(AnnouncementPreview, {
        values: { ...EMPTY_ANNOUNCEMENT, titleVi: "Tin", ...values },
        previewLocale: "vi",
        imageSrc,
        imageSize,
        t,
      }),
    );
  const mocksIn = (html: string) => html.match(/<div inert="" aria-hidden="true"[^>]*>.*?<\/div>/g) ?? [];
  /** The image frame: its opening tag and its images. */
  const frameOf = (html: string) => {
    const match = html.match(/(<div data-fit="[^"]*"[^>]*>)(.*?)<\/div><\/div>/);
    return { tag: match?.[1] ?? "", images: match?.[2].match(/<img [^>]*>/g) ?? [] };
  };

  it("closes with a single picture of the app's \"Got it\" button when there is no link", () => {
    const html = preview({});
    const mocks = mocksIn(html);
    expect(mocks).toHaveLength(1);
    expect(mocks[0]).toMatch(/<button [^>]*>Đã hiểu<\/button>/);
    expect(html).not.toContain("<a ");
    expect(mocksIn(preview({ displayMode: "until_dismissed" }))).toHaveLength(2);
    // The × is a picture too, never a control.
    expect(html).toMatch(/<span aria-hidden="true"[^>]*><svg [^>]*><path d="M2 2l8 8M10 2L2 10"/);
    expect(mocksIn(html).reduce((acc, m) => acc.replace(m, ""), html)).not.toMatch(/<(button|input)\b/);
  });

  it("tints the top by level instead of a color bar", () => {
    expect(preview({ level: "critical" })).toContain("color-mix(in_srgb,var(--danger)_7%,transparent)");
    expect(preview({ level: "info" })).toContain("color-mix(in_srgb,var(--accent)_7%,transparent)");
    expect(preview({})).not.toContain("h-1.5");
  });

  it("frames an image the way the app does", () => {
    // Close to the frame's shape: fills it.
    const cover = frameOf(preview({}, "/img/a", { width: 1600, height: 900 }));
    expect(cover.tag).toContain('data-fit="cover"');
    expect(cover.tag).toContain(`aspect-ratio:${1600 / 900}`);
    expect(cover.images).toHaveLength(1);
    expect(cover.images[0]).toContain("object-cover");

    // Square: the tallest frame, shown whole over a blurred, hidden copy.
    const contain = frameOf(preview({}, "/img/b", { width: 1024, height: 1024 }));
    expect(contain.tag).toContain('data-fit="contain"');
    expect(contain.tag).toContain("aspect-ratio:1.6");
    expect(contain.tag).toContain("rounded-[10px]");
    expect(contain.images).toHaveLength(2);
    expect(contain.images[0]).toMatch(/aria-hidden="true".*blur-\[28px\]/);
    expect(contain.images[1]).toContain("max-h-full max-w-full");
    expect(contain.images[1]).not.toContain("aria-hidden");

    // Not measured yet: 16:9, nothing shown.
    const html = preview({}, "https://cdn.example/a.png");
    const pending = frameOf(html);
    expect(pending.tag).toContain('data-fit="pending"');
    expect(pending.tag).toContain(`aspect-ratio:${16 / 9}`);
    expect(pending.images).toHaveLength(1);
    expect(html).toMatch(/<div class="[^"]*opacity-0"><img /);

    // An html announcement has no image frame.
    expect(frameOf(preview({ kind: "html", htmlVi: "<p>x</p>" }, "/img/a", { width: 1600, height: 900 })).tag).toBe("");
  });
});

describe("editor markup", () => {
  it("hides the file input behind the labelled upload button", () => {
    const html = renderForm();
    const file = tagWithId(html, "ann-imageFile");
    expect(file).toContain('type="file"');
    expect(file).toContain('aria-hidden="true"');
    expect(file).toContain('tabindex="-1"');
    const button = tagWithId(html, "ann-imageId");
    expect(button).toContain('aria-describedby="ann-image-hint"');
    expect(button).not.toContain("aria-invalid");
  });

  it("gives the English button label the English fallback hint", () => {
    const html = renderForm({ linkUrl: "https://faamoffice.net" });
    expect(tagWithId(html, "ann-linkLabelEn")).toContain('aria-describedby="ann-linkLabelEn-hint"');
    expect(html).toContain(`<p id="ann-linkLabelEn-hint" class="text-xs text-muted">${t.form.enHint}</p>`);
    expect(html).toContain(t.form.linkLabelHint);
  });

  it("shows the saved notice once after creating, and not otherwise", () => {
    const notice = `<p role="status" class="rounded-xl bg-success-bg px-4 py-3 text-sm text-success-fg">${t.saved}</p>`;
    expect(renderForm({}, true).split(t.saved)).toHaveLength(2);
    expect(renderForm({}, true)).toContain(notice);
    expect(renderForm({}, false)).not.toContain(t.saved);
    expect(renderForm()).not.toContain(t.saved);
  });
});

describe("field error placement", () => {
  it("links a control to its hint and, when invalid, its error", () => {
    expect(describedBy("ann-imageId", "ann-image-hint", true)).toEqual({
      "aria-invalid": true,
      "aria-describedby": "ann-image-hint ann-imageId-error",
    });
    expect(describedBy("ann-imageId", "ann-image-hint", false)).toEqual({
      "aria-invalid": undefined,
      "aria-describedby": "ann-image-hint",
    });
    expect(describedBy("ann-titleVi", null, false)).toEqual({ "aria-invalid": undefined, "aria-describedby": undefined });
    expect(describedBy("ann-titleVi", null, true)["aria-describedby"]).toBe("ann-titleVi-error");
  });

  it("lists errors of fields the current kind hides instead of losing them", () => {
    const errors = { imageUrl: "https_only", titleVi: "required", platforms: "invalid", form: "invalid" } as const;
    expect(splitFieldErrors(errors, "html")).toEqual({
      inline: ["titleVi"],
      listed: [
        ["imageUrl", "https_only"],
        ["platforms", "invalid"],
        ["form", "invalid"],
      ],
    });
    expect(splitFieldErrors(errors, "rich")).toEqual({
      inline: ["imageUrl", "titleVi"],
      listed: [
        ["platforms", "invalid"],
        ["form", "invalid"],
      ],
    });
    expect(splitFieldErrors({ htmlVi: "required", imageId: "image_missing" }, "rich")).toEqual({
      inline: ["imageId"],
      listed: [["htmlVi", "required"]],
    });
    expect(splitFieldErrors({}, "rich")).toEqual({ inline: [], listed: [] });
  });

  it("has a summary lead-in for listed errors in both languages", () => {
    expect(viDict.admin.announcements.form.fixListed).toMatch(/:$/);
    expect(en.admin.announcements.form.fixListed).toMatch(/:$/);
  });
});
