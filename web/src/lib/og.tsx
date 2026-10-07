// Shared social image response and the logo used by the Apple touch icon.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function logoDataUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="180 160 700 700"><defs><linearGradient id="r" gradientUnits="userSpaceOnUse" x1="205" y1="0" x2="818" y2="0"><stop offset="0" stop-color="#3AAC71"/><stop offset="0.514" stop-color="#2B95C2"/><stop offset="1" stop-color="#1D74FA"/></linearGradient><linearGradient id="d" gradientUnits="userSpaceOnUse" x1="746" y1="0" x2="856" y2="0"><stop offset="0" stop-color="#5FAC39"/><stop offset="0.6" stop-color="#28CE87"/><stop offset="1" stop-color="#1DFACD"/></linearGradient></defs><circle cx="511.5" cy="511.5" r="284.25" fill="none" stroke="url(#r)" stroke-width="45.5"/><circle cx="800.5" cy="243.5" r="55" fill="url(#d)"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function renderOgImage() {
  const image = await readFile(join(process.cwd(), "src/assets/faamoffice-share-1200x630.png"));
  return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/png" } });
}
