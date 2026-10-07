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
import { CONTENT, iconSvg, logo, svg } from './brand-logo.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const at = (rel) => join(root, rel)

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
