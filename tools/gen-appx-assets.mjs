/**
 * Generates the Microsoft Store (AppX/MSIX) visual assets from the FaamOffice
 * logo into apps/shell/build/appx/, where electron-builder's appx target picks
 * them up (any file there replaces the Electron default of the same base name;
 * scale-/targetsize- qualified names make it build a resources.pri).
 *
 *   Square44x44Logo  taskbar, Start list, Alt+Tab, and StoreLogo (Store and
 *                    installer UI): the Windows app icon itself, the logo on
 *                    its white rounded tile exactly as in icon.ico, so the
 *                    Store build looks like the NSIS one; targetsize-* (plus
 *                    _altform-unplated twins) cover the shell's pixel sizes
 *   Square150x150Logo, LargeTile (310), SmallTile (71), Wide310x150Logo
 *                    Start tiles: the bare logo at the app icon's proportions
 *                    on a transparent background, plated white by the
 *                    manifest's backgroundColor (the ring's blue would vanish
 *                    on an accent-coloured plate)
 *
 *   node tools/gen-appx-assets.mjs
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { iconSvg, logo } from './brand-logo.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'apps/shell/build/appx')

/** a tile asset: the bare 1024 logo composition, transparent around it */
const tileSvg = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${logo()}</svg>`

/** a wide asset: the square composition centred, as tall as the asset */
const wideSvg = (width, height) => {
  const viewWidth = (1024 * width) / height
  const dx = (viewWidth - 1024) / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${viewWidth} 1024">` +
    `<g transform="translate(${dx} 0)">${logo()}</g></svg>`
  )
}

const SCALES = [
  [100, 1],
  [200, 2],
  [400, 4],
]
const TARGET_SIZES = [16, 24, 32, 48, 256]

/** [file name, width, height, svg] for every asset */
function assets() {
  const list = []
  for (const [scale, factor] of SCALES) {
    const square = (base, size, markupFor) => {
      const px = Math.round(size * factor)
      list.push([`${base}.scale-${scale}.png`, px, px, markupFor(px)])
    }
    const appIcon = (px) => iconSvg('rounded', px)
    square('Square44x44Logo', 44, appIcon)
    square('StoreLogo', 50, appIcon)
    square('Square150x150Logo', 150, tileSvg)
    square('SmallTile', 71, tileSvg)
    if (scale <= 200) {
      square('LargeTile', 310, tileSvg)
      list.push([
        `Wide310x150Logo.scale-${scale}.png`,
        310 * factor,
        150 * factor,
        wideSvg(310 * factor, 150 * factor),
      ])
    }
  }
  for (const size of TARGET_SIZES) {
    const markup = iconSvg('rounded', size)
    list.push([`Square44x44Logo.targetsize-${size}.png`, size, size, markup])
    list.push([`Square44x44Logo.targetsize-${size}_altform-unplated.png`, size, size, markup])
  }
  return list
}

async function renderPng(page, markup, width, height) {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')}`
  await page.setViewportSize({ width, height })
  await page.setContent(
    `<body style="margin:0"><img src="${dataUrl}" style="display:block;width:${width}px;height:${height}px"></body>`,
  )
  // wait for the decode and two frames: a capture right after a viewport
  // resize can catch a stale frame (see tools/gen-app-icons.mjs)
  await page.evaluate(async () => {
    await globalThis.document.images[0].decode()
    await new Promise((resolve) =>
      globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
    )
  })
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width, height } })
}

mkdirSync(outDir, { recursive: true })
// regenerate from scratch so a renamed asset never lingers
for (const name of readdirSync(outDir)) {
  if (name.endsWith('.png')) rmSync(join(outDir, name))
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const list = assets()
  for (const [name, width, height, markup] of list) {
    writeFileSync(join(outDir, name), await renderPng(page, markup, width, height))
  }
  console.log(`generated ${list.length} AppX assets in apps/shell/build/appx`)
} finally {
  await browser.close()
}
