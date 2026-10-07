// Server-side clean-up of uploaded announcement images (Node only: sharp).
// Applies the EXIF orientation, trims fully transparent margins (so a logo
// exported with lopsided padding is centered by the app's dialog), caps the
// size at 1600×1600 and re-encodes in the same format (lossless WebP stays
// lossless), which also strips EXIF/GPS and other metadata. Animated WebP is
// resized and stripped frame by frame but never rotated or trimmed. Anything
// sharp cannot handle keeps the original (already validated) bytes; GIFs and
// animated PNGs (libvips cannot write APNG) always do.

import sharp from "sharp";
import { MAX_IMAGE_BYTES } from "./announcement-shared";
import { isAnimatedPng, isLosslessWebp, type ImageMime, type SniffedImage } from "./image-sniff";

export type NormalizedImage = { bytes: Uint8Array<ArrayBuffer>; mime: ImageMime; width: number | null; height: number | null };

/** Larger images fit inside this box (never enlarged). */
export const MAX_IMAGE_DIMENSION = 1600;
/** Decoding refuses anything larger (a small file can hold a huge flat image). */
const MAX_INPUT_PIXELS = 40_000_000;
/** A trimmed image is never smaller than this (or the original, if smaller). */
const MIN_TRIMMED_SIZE = 32;
/** Margins thinner than this share of a side (and 2 px) are not worth a crop. */
const MIN_TRIM_SHARE = 0.02;

type Box = { left: number; top: number; width: number; height: number };

/** Bounding box of the pixels that are not fully transparent (alpha = last channel); null when none is. */
export function visibleBounds(data: Uint8Array, width: number, height: number, channels: number): Box | null {
  const alpha = (x: number, y: number) => data[(y * width + x) * channels + channels - 1];
  const rowVisible = (y: number) => {
    for (let x = 0; x < width; x++) if (alpha(x, y) !== 0) return true;
    return false;
  };
  let top = 0;
  while (top < height && !rowVisible(top)) top++;
  if (top === height) return null;
  let bottom = height - 1;
  while (bottom > top && !rowVisible(bottom)) bottom--;
  let left = width;
  let right = -1;
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < left; x++) {
      if (alpha(x, y) !== 0) {
        left = x;
        break;
      }
    }
    for (let x = width - 1; x > right; x--) {
      if (alpha(x, y) !== 0) {
        right = x;
        break;
      }
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** Grow [start, start + size) to at least `min` (capped at `total`), centered and kept inside. */
function grow(start: number, size: number, min: number, total: number): [number, number] {
  const target = Math.min(Math.max(size, min), total);
  const from = Math.min(Math.max(0, start - Math.floor((target - size) / 2)), total - target);
  return [from, target];
}

/** The crop that removes the transparent margin, or null when there is none worth removing. */
export function trimBox(bounds: Box | null, width: number, height: number): Box | null {
  if (!bounds) return null; // fully transparent: leave it alone
  const worth = (removed: number, total: number) => removed >= Math.max(2, total * MIN_TRIM_SHARE);
  if (!worth(width - bounds.width, width) && !worth(height - bounds.height, height)) return null;
  const [left, w] = grow(bounds.left, bounds.width, MIN_TRIMMED_SIZE, width);
  const [top, h] = grow(bounds.top, bounds.height, MIN_TRIMMED_SIZE, height);
  return { left, top, width: w, height: h };
}

/**
 * The image to store for validated upload bytes. One header read, then one
 * decode/encode (still images with alpha decode to raw pixels once to find
 * the transparent margin). An untouched image without metadata keeps its own
 * bytes when re-encoding would not make it smaller (no generation loss, no
 * palette PNG bloated into truecolor).
 */
export async function normalizeImage(
  bytes: Uint8Array<ArrayBuffer>,
  sniffed: SniffedImage,
  maxBytes = MAX_IMAGE_BYTES,
): Promise<NormalizedImage> {
  const original: NormalizedImage = { bytes, ...sniffed };
  if (sniffed.mime === "image/gif" || (sniffed.mime === "image/png" && isAnimatedPng(bytes))) return original;
  const options = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" } as const;
  try {
    const meta = await sharp(bytes, options).metadata();
    const animated = (meta.pages ?? 1) > 1; // WebP: GIF and APNG never get here
    // libvips cannot rotate an animation; stripping the tag would show it the wrong way up.
    if (animated && (meta.orientation ?? 1) > 1) return original;
    let pipeline = animated ? sharp(bytes, { ...options, animated }) : sharp(bytes, options).rotate();
    let trimmed = false;
    if (meta.hasAlpha && !animated) {
      const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
      const box = trimBox(visibleBounds(data, info.width, info.height, info.channels), info.width, info.height);
      pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
      if (box) pipeline = pipeline.extract(box);
      trimmed = box !== null;
    }
    pipeline = pipeline.resize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, fit: "inside", withoutEnlargement: true });
    pipeline =
      sniffed.mime === "image/jpeg"
        ? pipeline.jpeg({ quality: 85, mozjpeg: true })
        : sniffed.mime === "image/png"
          ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: meta.isPalette })
          : pipeline.webp(isLosslessWebp(bytes) ? { lossless: true } : { quality: 88 }); // no ringing on lossless screenshots
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    if (data.byteLength > maxBytes) return original;

    const height = info.pageHeight ?? info.height; // an animation's frames are stacked in `height`
    const reshaped = trimmed || (meta.orientation ?? 1) > 1 || info.width !== meta.width || height !== meta.height;
    const hasMetadata = Boolean(meta.exif || meta.xmp || meta.iptc || meta.comments?.length);
    if (!reshaped && !hasMetadata && bytes.byteLength <= data.byteLength) return original;
    return { bytes: new Uint8Array(data), mime: sniffed.mime, width: info.width, height };
  } catch {
    // Corrupt beyond the header, too many pixels, unsupported variant: the sniffed bytes still serve.
    return original;
  }
}
