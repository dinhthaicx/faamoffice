/**
 * Generates every FaamOffice brand asset from the logo defined below:
 *
 *   apps/shell/build/icon.png, icon-mac.png, icon.icns, icon.ico, icons/<n>x<n>.png
 *   apps/docs/build/icon.png, icon-mac.png, icon.icns, icon.ico
 *   apps/{shell,docs,sheets,slides}/.../assets/app-icon.png
 *   apps/shell/src/renderer/src/assets/faamoffice-logo.svg (home lockup; dark
 *     themes invert it with a 180° hue turn so the colours survive)
 *   apps/shell/build/faamoffice-logo-mark.svg (the bare logo, for reuse)
 *
 * The logo is a vector rebuild of the supplied 1024px artwork: a ring with a
 * horizontal green → teal → blue gradient and a green → mint dot breaking out
 * at the top right. Coordinates and gradient stops are measured from that
 * artwork, so the 1024 tile reproduces it.
 *
 * Small raster sizes (<= 32 px) zoom the logo and thicken the ring so it stays
 * legible; everything else keeps the supplied proportions. The lockup wordmark
 * is set in Carlito Bold (SIL OFL 1.1, bundled in packages/ui) and converted
 * to outlines. Rasterized with the system Chrome via Playwright, like
 * tools/gen-file-association-icons.mjs.
 *
 *   node tools/gen-app-icons.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const at = (rel) => join(root, rel)

// ---- the logo, in the supplied artwork's 1024 coordinate space ----
const RING = { cx: 511.5, cy: 511.5, r: 284.25, width: 45.5, x0: 205, x1: 818 }
const DOT = { cx: 800.5, cy: 243.5, r: 55, x0: 746, x1: 856 }
const RING_STOPS = [
  [0, '#3AAC71'],
  [0.24, '#349C8B'],
  [0.318, '#32A6A5'],
  [0.514, '#2B95C2'],
  [0.71, '#2485DF'],
  [1, '#1D74FA'],
]
const DOT_STOPS = [
  [0, '#5FAC39'],
  [0.236, '#349A34'],
  [0.6, '#28CE87'],
  [1, '#1DFACD'],
]
// bounding box of ring + dot
const CONTENT = { x0: 205, y0: 188.5, x1: 856, y1: 818.75 }

const stops = (list) => list.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')

/**
 * The logo as SVG markup in 1024 space. `zoom` scales it about the ring's
 * centre (1 = the supplied composition); `ringWidth` overrides the stroke.
 */
function logo({ zoom = 1, ringWidth = RING.width, id = 'l' } = {}) {
  const t = `translate(${RING.cx} ${RING.cy}) scale(${zoom}) translate(${-RING.cx} ${-RING.cy})`
  const inner = RING.r - RING.width / 2
  const r = inner + ringWidth / 2
  return (
    `<defs>` +
    `<linearGradient id="${id}r" gradientUnits="userSpaceOnUse" x1="${RING.x0}" y1="0" x2="${RING.x1}" y2="0">${stops(RING_STOPS)}</linearGradient>` +
    `<linearGradient id="${id}d" gradientUnits="userSpaceOnUse" x1="${DOT.x0}" y1="0" x2="${DOT.x1}" y2="0">${stops(DOT_STOPS)}</linearGradient>` +
    `</defs><g transform="${t}">` +
    `<circle cx="${RING.cx}" cy="${RING.cy}" r="${r}" fill="none" stroke="url(#${id}r)" stroke-width="${ringWidth}"/>` +
    `<circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}" fill="url(#${id}d)"/>` +
    `</g>`
  )
}

const svg = (body, size = 1024) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${body}</svg>`

/** white tile behind the logo: 'square' (full bleed), 'rounded' (Windows/Linux), 'mac' (squircle on the Big Sur grid) */
function tile(kind) {
  if (kind === 'square') return `<rect width="1024" height="1024" fill="#fff"/>`
  if (kind === 'rounded') return `<rect width="1024" height="1024" rx="229" fill="#fff"/>`
  // 824 px squircle centred in 1024, radius ~22.5%, soft shadow as macOS draws for app icons
  return (
    `<defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.22"/></filter></defs>` +
    `<rect x="100" y="100" width="824" height="824" rx="185" fill="#fff" filter="url(#s)"/>`
  )
}

/** a raster-ready SVG for one icon size */
function iconSvg(kind, pixels) {
  const small = pixels <= 32
  const body = small ? logo({ zoom: 1.32, ringWidth: 70 }) : logo()
  if (kind === 'mac') {
    // the logo is laid out on the 824 squircle exactly as on the 1024 artwork
    return svg(`${tile('mac')}<g transform="translate(100 100) scale(${824 / 1024})">${body}</g>`)
  }
  return svg(`${tile(kind)}${body}`)
}

/** the bare logo cropped to its own bounding box, for the lockup */
function croppedLogo(height, id) {
  const w = CONTENT.x1 - CONTENT.x0
  const h = CONTENT.y1 - CONTENT.y0
  const s = height / Math.max(w, h)
  const dy = (height - h * s) / 2
  return {
    width: w * s,
    markup: `<g transform="translate(0 ${dy}) scale(${s}) translate(${-CONTENT.x0} ${-CONTENT.y0})">${logo({ id })}</g>`,
  }
}

function lockupSvg() {
  const font = opentype.parse(readFileSync(at('packages/ui/src/fonts/Carlito-Bold.ttf')).buffer)
  const height = 240
  const capHeight = 130
  const fontSize = (capHeight * font.unitsPerEm) / font.tables.os2.sCapHeight
  const mark = croppedLogo(height, 'k')
  const baseline = (height + capHeight) / 2 + 6
  const textX = mark.width + 44
  const path = font.getPath('FaamOffice', textX, baseline, fontSize)
  const width = Math.ceil(path.getBoundingBox().x2 + 4)
  return (
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">\n` +
    `${mark.markup}\n<path d="${path.toPathData(2)}" fill="black"/>\n</svg>\n`
  )
}

const ICONSET_ENTRIES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]
const WIN_SIZES = [16, 24, 32, 48, 64, 128, 256]
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]

/** ICO container with PNG-compressed entries (supported since Vista). */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length
  entries.forEach(({ size, png }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

async function renderPng(page, markup, size) {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')}`
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<body style="margin:0"><img src="${dataUrl}" style="display:block;width:${size}px;height:${size}px"></body>`,
  )
  // a screenshot taken right after a viewport resize can capture a stale,
  // half-relaid frame: wait for the decode and two frames before capturing
  await page.evaluate(async () => {
    await globalThis.document.images[0].decode()
    await new Promise((resolve) =>
      globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
    )
  })
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ deviceScaleFactor: 1 })
const tmp = mkdtempSync(join(tmpdir(), 'faamoffice-app-icons-'))

try {
  const square = await renderPng(page, iconSvg('square', 1024), 1024)
  const mac = await renderPng(page, iconSvg('mac', 1024), 1024)

  const iconset = join(tmp, 'icon.iconset')
  mkdirSync(iconset)
  for (const [name, size] of ICONSET_ENTRIES) {
    writeFileSync(join(iconset, name), await renderPng(page, iconSvg('mac', size), size))
  }
  const icns = join(tmp, 'icon.icns')
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns])
  const winEntries = []
  for (const size of WIN_SIZES) {
    winEntries.push({ size, png: await renderPng(page, iconSvg('rounded', size), size) })
  }
  const ico = buildIco(winEntries)

  for (const dir of ['apps/shell/build', 'apps/docs/build']) {
    writeFileSync(at(`${dir}/icon.png`), await renderPng(page, iconSvg('rounded', 1024), 1024))
    writeFileSync(at(`${dir}/icon-mac.png`), mac)
    writeFileSync(at(`${dir}/icon.icns`), readFileSync(icns))
    writeFileSync(at(`${dir}/icon.ico`), ico)
  }
  for (const size of LINUX_SIZES) {
    const png = await renderPng(page, iconSvg('rounded', size), size)
    writeFileSync(at(`apps/shell/build/icons/${size}x${size}.png`), png)
  }
  // in-app copies: the UI rounds the corners itself
  for (const rel of [
    'apps/shell/src/renderer/src/assets/app-icon.png',
    'apps/docs/src/renderer/assets/app-icon.png',
    'apps/sheets/src/renderer/assets/app-icon.png',
    'apps/slides/src/renderer/assets/app-icon.png',
  ]) {
    writeFileSync(at(rel), square)
  }
  writeFileSync(at('apps/shell/src/renderer/src/assets/faamoffice-logo.svg'), lockupSvg())
  writeFileSync(at('apps/shell/build/faamoffice-logo-mark.svg'), `${svg(logo())}\n`)
  console.log('generated FaamOffice app icons and logo lockup')
} finally {
  rmSync(tmp, { recursive: true, force: true })
  await browser.close()
}
