// The announcement editor rendered on the server (no DOM needed): accessibility
// of the image upload and the preview's mock controls, hints, the saved notice
// after creating, and the helpers that place field errors.

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
