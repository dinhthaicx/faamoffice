// POST /api/admin/announcements/images — upload an announcement image
// (ADMIN, same-origin, multipart/form-data with a "file" field, at most 2 MB;
// larger → 413 image_too_large). The type is detected from the file's magic
// bytes; the client's Content-Type is ignored.

import { MAX_IMAGE_BYTES } from "@/lib/announcement-shared";
import { ADMIN_IMAGE_SELECT, cleanupOrphanImages } from "@/lib/announcements";
import { requireApiAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError, json, rateLimited, readBodyBytes, route } from "@/lib/http";
import { sniffImage } from "@/lib/image-sniff";
import { limiters } from "@/lib/rate-limit";

/** Room for the multipart boundaries and part headers around the file. */
const MULTIPART_OVERHEAD = 64 * 1024;

const imageTooLarge = () => new HttpError(413, "image_too_large", `Images must be at most ${MAX_IMAGE_BYTES} bytes.`);

export const POST = route(async (req) => {
  const session = await requireApiAdmin(req);
  const limit = limiters().announcementUpload.check(`upload|${session.userId}`);
  if (!limit.ok) throw rateLimited(limit.retryAfter);

  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new HttpError(415, "unsupported_media_type", "Send the image as multipart/form-data.");
  }
  const raw = await readBodyBytes(req, MAX_IMAGE_BYTES + MULTIPART_OVERHEAD).catch((err: unknown) => {
    // An oversized body can only be an oversized image: say so instead of payload_too_large.
    throw err instanceof HttpError && err.status === 413 ? imageTooLarge() : err;
  });
  let form: FormData;
  try {
    form = await new Response(raw, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new HttpError(400, "invalid_request", "Malformed multipart body.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") throw new HttpError(400, "invalid_request", "Missing \"file\" field.", { field: "file" });
  if (file.size > MAX_IMAGE_BYTES) throw imageTooLarge();
  if (file.size === 0) throw new HttpError(415, "unsupported_image", "Only PNG, JPEG, WebP and GIF images are accepted.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = sniffImage(bytes);
  if (!info) throw new HttpError(415, "unsupported_image", "Only PNG, JPEG, WebP and GIF images are accepted.");

  await cleanupOrphanImages();
  const image = await prisma.announcementImage.create({
    data: { mime: info.mime, bytes, width: info.width, height: info.height, size: bytes.byteLength },
    select: ADMIN_IMAGE_SELECT,
  });
  return json({ ok: true, ...image, url: `/api/admin/announcements/images/${image.id}` }, { status: 201 });
});
