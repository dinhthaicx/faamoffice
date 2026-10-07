// Image type detection from magic bytes (never trust the client's Content-Type),
// plus best-effort dimensions read from the file header.

export type ImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
export type SniffedImage = { mime: ImageMime; width: number | null; height: number | null };

const ascii = (b: Uint8Array, start: number, length: number) => String.fromCharCode(...b.subarray(start, start + length));
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Size of the first JPEG frame (SOFn segment), scanning markers up to the image data. */
function jpegSize(b: Uint8Array): { width: number | null; height: number | null } {
  let i = 2;
  while (i + 8 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // standalone markers (TEM, RSTn, SOI)
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    const length = u16be(b, i + 2);
    if (length < 2) break;
    i += 2 + length;
  }
  return { width: null, height: null };
}

function webpSize(b: Uint8Array): { width: number | null; height: number | null } {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X" && b.length >= 30) {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  if (chunk === "VP8 " && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
    return {
      width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
      height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
    };
  }
  return { width: null, height: null };
}

/** PNG, JPEG, WebP or GIF by signature; null for anything else (SVG, HTML, …). */
export function sniffImage(b: Uint8Array): SniffedImage | null {
  if (b.length >= 8 && PNG_SIGNATURE.every((byte, i) => b[i] === byte)) {
    const hasHeader = b.length >= 24 && ascii(b, 12, 4) === "IHDR";
    return { mime: "image/png", width: hasHeader ? u32be(b, 16) : null, height: hasHeader ? u32be(b, 20) : null };
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mime: "image/jpeg", ...jpegSize(b) };
  }
  if (b.length >= 10 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) {
    return { mime: "image/gif", width: u16le(b, 6), height: u16le(b, 8) };
  }
  if (b.length >= 16 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    return { mime: "image/webp", ...webpSize(b) };
  }
  return null;
}
