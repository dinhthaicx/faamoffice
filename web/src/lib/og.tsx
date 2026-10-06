// Shared Open Graph image renderer (1200×630), generated at build time per locale.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

const FONT_DIR = join(process.cwd(), "src/assets/fonts");

async function loadFonts() {
  const files: { weight: 400 | 700 | 800; subset: string }[] = [];
  for (const weight of [400, 700, 800] as const) {
    for (const subset of ["latin", "latin-ext", "vietnamese"]) files.push({ weight, subset });
  }
  return Promise.all(
    files.map(async (f) => ({
      name: "Inter",
      data: await readFile(join(FONT_DIR, `inter-${f.subset}-${f.weight}-normal.woff`)),
      weight: f.weight,
      style: "normal" as const,
    })),
  );
}

export function logoDataUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="180 160 700 700"><defs><linearGradient id="r" gradientUnits="userSpaceOnUse" x1="205" y1="0" x2="818" y2="0"><stop offset="0" stop-color="#3AAC71"/><stop offset="0.514" stop-color="#2B95C2"/><stop offset="1" stop-color="#1D74FA"/></linearGradient><linearGradient id="d" gradientUnits="userSpaceOnUse" x1="746" y1="0" x2="856" y2="0"><stop offset="0" stop-color="#5FAC39"/><stop offset="0.6" stop-color="#28CE87"/><stop offset="1" stop-color="#1DFACD"/></linearGradient></defs><circle cx="511.5" cy="511.5" r="284.25" fill="none" stroke="url(#r)" stroke-width="45.5"/><circle cx="800.5" cy="243.5" r="55" fill="url(#d)"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function renderOgImage({ tagline, sub }: { tagline: string; sub: string }) {
  const fonts = await loadFonts();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #f3fbf7 0%, #ffffff 45%, #eef4ff 100%)",
          fontFamily: "Inter",
          padding: "72px 80px 0 80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoDataUri()} width={120} height={120} alt="" />
          <div style={{ fontSize: 76, fontWeight: 800, color: "#0b1220", letterSpacing: -2 }}>FaamOffice</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 54, fontWeight: 700, color: "#0b1220", lineHeight: 1.15, maxWidth: 1000 }}>{tagline}</div>
          <div style={{ fontSize: 28, fontWeight: 400, color: "#475467" }}>{sub}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <div style={{ display: "flex", fontSize: 24, color: "#1765d8", fontWeight: 700, marginBottom: 36 }}>
            Apache-2.0 · Faam AI
          </div>
          <div
            style={{
              display: "flex",
              height: 14,
              margin: "0 -80px",
              background: "linear-gradient(90deg, #3AAC71 0%, #2B95C2 50%, #1D74FA 100%)",
            }}
          />
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts },
  );
}
