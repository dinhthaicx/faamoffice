// Upload clean-up with sharp on in-memory fixtures: orientation, size cap,
// transparent-margin trim, metadata stripping, animated and lossless WebP, and
// the cases that must keep the original bytes (GIF, APNG, undecodable files,
// no gain).

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeImage, trimBox, visibleBounds } from "@/lib/image-normalize";
import { isAnimatedPng, isLosslessWebp, sniffImage } from "@/lib/image-sniff";

type Color = { r: number; g: number; b: number; alpha: number };
const RED: Color = { r: 220, g: 40, b: 40, alpha: 1 };
const CLEAR: Color = { r: 0, g: 0, b: 0, alpha: 0 };

const canvas = (width: number, height: number, background: Color | string, channels: 3 | 4 = 4) =>
  sharp({ create: { width, height, channels, background } });

const bytesOf = async (image: ReturnType<typeof sharp>) => new Uint8Array(await image.toBuffer());

/** A red rectangle on a transparent canvas. */
const logo = (width: number, height: number, rect: { left: number; top: number; width: number; height: number }) =>
  canvas(width, height, CLEAR)
    .composite([{ input: { create: { width: rect.width, height: rect.height, channels: 4, background: RED } }, left: rect.left, top: rect.top }])
    .png();

/** Hard-edged 3×3 px colour blocks (a stand-in for text and UI screenshots), opaque RGB. */
const blocks = (width: number, height: number) => {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = (Math.floor(x / 3) + Math.floor(y / 3)) % 2 === 0;
      data.set(on ? [20, 20, 24] : [250, 220, 40], (y * width + x) * 3);
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } });
};

/** RGBA samples (an encoder may drop an all-opaque alpha channel). */
const pixels = async (image: ReturnType<typeof sharp>) => image.ensureAlpha().raw().toBuffer();

async function normalize(bytes: Uint8Array<ArrayBuffer>) {
  const sniffed = sniffImage(bytes);
  if (!sniffed) throw new Error("fixture is not an image");
  return normalizeImage(bytes, sniffed);
}

describe("normalizeImage", () => {
  it("applies the EXIF orientation and drops the EXIF block", async () => {
    // Stored 40×20 with orientation 6 (rotate 90° clockwise): shows as 20×40.
    const input = await bytesOf(canvas(40, 20, RED, 3).jpeg().withMetadata({ orientation: 6 }));
    expect((await sharp(input).metadata()).orientation).toBe(6);
    const out = await normalize(input);
    expect(out).toMatchObject({ mime: "image/jpeg", width: 20, height: 40 });
    const meta = await sharp(out.bytes).metadata();
    expect([meta.width, meta.height, meta.orientation, meta.exif]).toEqual([20, 40, undefined, undefined]);
  });

  it("strips EXIF (camera, GPS) and XMP from an image that needs no other change", async () => {
    const input = await bytesOf(
      canvas(64, 48, RED, 3)
        .jpeg({ quality: 95 })
        .withExif({ IFD0: { Make: "Camera", Model: "X" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "10/1 46/1 0/1" } })
        .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>'),
    );
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(before.xmp).toBeDefined();
    const out = await normalize(input);
    expect(out).toMatchObject({ mime: "image/jpeg", width: 64, height: 48 });
    const after = await sharp(out.bytes).metadata();
    expect([after.exif, after.xmp, after.iptc]).toEqual([undefined, undefined, undefined]);
    expect(Buffer.from(out.bytes).includes("Camera")).toBe(false);
  });

  it("scales a large image down to fit 1600×1600, keeping its format", async () => {
    const out = await normalize(await bytesOf(canvas(3000, 1000, RED, 3).png()));
    expect(out).toMatchObject({ mime: "image/png", width: 1600, height: 533 });
    expect(sniffImage(out.bytes)).toEqual({ mime: "image/png", width: 1600, height: 533 });

    const webp = await normalize(await bytesOf(canvas(1000, 2400, { ...RED, alpha: 0.5 }).webp()));
    expect(webp).toMatchObject({ mime: "image/webp", width: 667, height: 1600 });
    expect((await sharp(webp.bytes).metadata()).hasAlpha).toBe(true);
  });

  it("never enlarges a small image", async () => {
    const out = await normalize(await bytesOf(canvas(120, 80, RED, 3).jpeg()));
    expect(out).toMatchObject({ width: 120, height: 80 });
  });

  it("trims fully transparent margins, so lopsided padding no longer offsets a logo", async () => {
    const out = await normalize(await bytesOf(logo(400, 300, { left: 30, top: 10, width: 120, height: 90 })));
    expect(out).toMatchObject({ mime: "image/png", width: 120, height: 90 });
    const { data, info } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });

  it("keeps a trimmed image at least 32×32, centered on the content", async () => {
    const out = await normalize(await bytesOf(logo(200, 200, { left: 100, top: 0, width: 10, height: 6 })));
    expect(out).toMatchObject({ width: 32, height: 32 });
    expect(trimBox({ left: 100, top: 0, width: 10, height: 6 }, 200, 200)).toEqual({ left: 89, top: 0, width: 32, height: 32 });
    // Never past the image's own edges.
    expect(trimBox({ left: 195, top: 195, width: 5, height: 5 }, 200, 200)).toEqual({ left: 168, top: 168, width: 32, height: 32 });
    expect(trimBox({ left: 0, top: 2, width: 20, height: 10 }, 20, 20)).toEqual({ left: 0, top: 0, width: 20, height: 20 });
  });

  it("never trims opaque content, nor a margin too thin to matter", async () => {
    // An opaque white frame around red: same size, alpha channel or not.
    const framed = (channels: 3 | 4) =>
      canvas(200, 100, "#ffffff", channels)
        .composite([{ input: { create: { width: 100, height: 50, channels: 3, background: RED } }, left: 50, top: 25 }])
        .png();
    expect(await normalize(await bytesOf(framed(3)))).toMatchObject({ width: 200, height: 100 });
    expect(await normalize(await bytesOf(framed(4)))).toMatchObject({ width: 200, height: 100 });
    // A 1 px transparent edge on a 400 px image (0.25%).
    expect(await normalize(await bytesOf(logo(400, 400, { left: 1, top: 1, width: 398, height: 398 })))).toMatchObject({ width: 400, height: 400 });
    // Fully transparent: nothing to trim to.
    expect(await normalize(await bytesOf(canvas(100, 60, CLEAR).png()))).toMatchObject({ width: 100, height: 60 });
  });

  it("finds the bounds of visible pixels", () => {
    // 4×3 RGBA: one visible pixel at (2, 1) and a faint one at (1, 2).
    const data = new Uint8Array(4 * 3 * 4);
    data[(1 * 4 + 2) * 4 + 3] = 255;
    expect(visibleBounds(data, 4, 3, 4)).toEqual({ left: 2, top: 1, width: 1, height: 1 });
    data[(2 * 4 + 1) * 4 + 3] = 1;
    expect(visibleBounds(data, 4, 3, 4)).toEqual({ left: 1, top: 1, width: 2, height: 2 });
    expect(visibleBounds(new Uint8Array(4 * 3 * 4), 4, 3, 4)).toBeNull();
  });

  it("passes GIFs and APNG through untouched", async () => {
    const frames = [await canvas(3000, 20, RED).png().toBuffer(), await canvas(3000, 20, CLEAR).png().toBuffer()];
    const gif = await bytesOf(sharp(frames, { join: { animated: true } }).gif());
    const out = await normalize(gif);
    expect(out.bytes).toBe(gif);
    expect(out.width).toBe(3000);
    // A still GIF is left alone too (decoding it would lose nothing, but it may be animated).
    const still = await bytesOf(canvas(2000, 10, RED, 3).gif());
    expect((await normalize(still)).bytes).toBe(still);

    // APNG: an acTL chunk before IDAT (libvips cannot write it back).
    const png = await bytesOf(canvas(1800, 10, RED, 3).png());
    const acTL = new Uint8Array([0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
    const apng = new Uint8Array([...png.subarray(0, 33), ...acTL, ...png.subarray(33)]);
    expect(isAnimatedPng(apng)).toBe(true);
    expect(isAnimatedPng(png)).toBe(false);
    expect((await normalize(apng)).bytes).toBe(apng);
  });

  it("scales an animated WebP frame by frame and strips its metadata, keeping every frame and the timing", async () => {
    const frames = [await canvas(3000, 200, RED).png().toBuffer(), await canvas(3000, 200, CLEAR).png().toBuffer()];
    const input = await bytesOf(
      sharp(frames, { join: { animated: true } })
        .webp({ delay: [100, 250], loop: 3 })
        .withExif({ IFD0: { Make: "Camera" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "10/1 46/1 0/1" } }),
    );
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await normalize(input);
    // The per-frame size, not the frames stacked.
    expect(out).toMatchObject({ mime: "image/webp", width: 1600, height: 107 });
    expect(sniffImage(out.bytes)).toEqual({ mime: "image/webp", width: 1600, height: 107 });
    const meta = await sharp(out.bytes).metadata();
    expect([meta.pages, meta.width, meta.height, meta.delay, meta.loop]).toEqual([2, 1600, 107, [100, 250], 3]);
    expect([meta.exif, meta.xmp]).toEqual([undefined, undefined]);
    expect(Buffer.from(out.bytes).includes("Camera")).toBe(false);
    // Transparent frames are never trimmed: the first one is still full width.
    const { info } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(1600);
  });

  it("keeps an animated WebP with an orientation tag as uploaded (an animation cannot be rotated)", async () => {
    const frames = [await canvas(400, 20, RED).png().toBuffer(), await canvas(400, 20, CLEAR).png().toBuffer()];
    const input = await bytesOf(sharp(frames, { join: { animated: true } }).webp().withMetadata({ orientation: 6 }));
    expect((await sharp(input).metadata()).orientation).toBe(6);
    expect((await normalize(input)).bytes).toBe(input);
  });

  it("tells lossless WebP (VP8L) from lossy, still or animated", async () => {
    const opaque = canvas(40, 30, RED, 3);
    const translucent = () => canvas(40, 30, { ...RED, alpha: 0.5 });
    expect(isLosslessWebp(await bytesOf(opaque.clone().webp({ lossless: true })))).toBe(true);
    expect(isLosslessWebp(await bytesOf(translucent().webp({ lossless: true })))).toBe(true);
    // VP8X container (metadata) around a VP8L image.
    expect(isLosslessWebp(await bytesOf(opaque.clone().webp({ lossless: true }).withExif({ IFD0: { Make: "C" } })))).toBe(true);
    expect(isLosslessWebp(await bytesOf(opaque.clone().webp()))).toBe(false);
    // VP8X + ALPH + "VP8 ": lossy colour with a losslessly compressed alpha plane.
    expect(isLosslessWebp(await bytesOf(translucent().webp()))).toBe(false);
    const frames = [await canvas(40, 30, RED).png().toBuffer(), await canvas(40, 30, CLEAR).png().toBuffer()];
    expect(isLosslessWebp(await bytesOf(sharp(frames, { join: { animated: true } }).webp({ lossless: true })))).toBe(true);
    expect(isLosslessWebp(await bytesOf(sharp(frames, { join: { animated: true } }).webp()))).toBe(false);
    // Truncated or chunkless files are not lossless.
    expect(isLosslessWebp(new TextEncoder().encode("RIFF\0\0\0\0WEBP"))).toBe(false);
  });

  it("keeps lossless WebP lossless when it is resized or trimmed (no ringing around text)", async () => {
    const source = blocks(2400, 1200);
    const input = await bytesOf(source.clone().webp({ lossless: true }));
    const out = await normalize(input);
    expect(out).toMatchObject({ mime: "image/webp", width: 1600, height: 800 });
    expect(isLosslessWebp(out.bytes)).toBe(true);
    // Exactly the resized pixels (same decode and kernel): nothing added by the encoder.
    const resized = await pixels(sharp(input).resize({ width: 1600, height: 1600, fit: "inside" }));
    expect((await pixels(sharp(out.bytes))).equals(resized)).toBe(true);

    // A screenshot on a transparent margin: trimmed, still lossless and pixel-exact.
    const content = await blocks(300, 200).ensureAlpha().png().toBuffer();
    const padded = await bytesOf(canvas(500, 400, CLEAR).composite([{ input: content, left: 40, top: 150 }]).webp({ lossless: true }));
    const trimmed = await normalize(padded);
    expect(trimmed).toMatchObject({ mime: "image/webp", width: 300, height: 200 });
    expect(isLosslessWebp(trimmed.bytes)).toBe(true);
    expect((await pixels(sharp(trimmed.bytes))).equals(await pixels(sharp(content)))).toBe(true);
  });

  it("keeps lossy WebP lossy", async () => {
    const out = await normalize(await bytesOf(blocks(2400, 1200).webp({ quality: 90 })));
    expect(out).toMatchObject({ mime: "image/webp", width: 1600, height: 800 });
    expect(isLosslessWebp(out.bytes)).toBe(false);
  });

  it("falls back to the original bytes when the file cannot be decoded or would grow too large", async () => {
    const png = await bytesOf(canvas(2000, 1000, RED, 3).png());
    // Valid signature and header, garbage after.
    const corrupt = new Uint8Array([...png.subarray(0, 33), ...new Uint8Array(64).fill(7)]);
    expect(await normalize(corrupt)).toEqual({ bytes: corrupt, mime: "image/png", width: 2000, height: 1000 });

    const sniffed = sniffImage(png)!;
    const tooBig = await normalizeImage(png, sniffed, 16);
    expect(tooBig.bytes).toBe(png);
    expect(tooBig).toMatchObject({ width: 2000, height: 1000 });
  });

  it("keeps an untouched image's own bytes when re-encoding would not shrink it", async () => {
    // Already-compressed palette PNG without metadata: re-encoding cannot do better.
    const input = await bytesOf(canvas(64, 64, RED, 3).png({ palette: true, compressionLevel: 9 }));
    const out = await normalize(input);
    expect(out.bytes).toBe(input);
    expect(out).toMatchObject({ mime: "image/png", width: 64, height: 64 });
  });
});
