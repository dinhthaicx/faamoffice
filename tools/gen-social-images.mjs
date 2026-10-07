/**
 * Renders the FaamOffice social share images into marketing/social/:
 *
 *   faamoffice-share-1200x630.png   link preview / Open Graph (Facebook, Zalo)
 *   faamoffice-post-1080x1080.png   square feed post
 *   faamoffice-post-1080x1350.png   4:5 portrait feed post (Facebook, Instagram)
 *   faamoffice-story-1080x1920.png  Story / Reels / TikTok; key content stays
 *                                   inside the safe area (250 px clear at the
 *                                   top, 340 px at the bottom)
 *
 * Every image comes from one HTML template, tools/social/template.html, which
 * lays itself out for the canvas named in its URL hash (#square, #portrait,
 * #story, #landscape). The FaamOffice mark is injected from
 * tools/brand-logo.mjs; text is set in Be Vietnam Pro (SIL OFL 1.1, bundled in
 * tools/social/fonts). Rasterized with the system Chrome via Playwright, like
 * tools/gen-app-icons.mjs. When the website's sharp is installed
 * (web/node_modules) the PNGs are recompressed with it, and any image still
 * over 1.5 MB is quantized to a dithered 256-colour palette; without sharp,
 * Chrome's output is kept as is. The run fails if a font does not load, and exits
 * non-zero (after writing the images) if a checked element leaves its
 * canvas's safe area or a text block collides with another block.
 *
 *   node tools/gen-social-images.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { CONTENT, logo } from './brand-logo.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const template = pathToFileURL(join(root, 'tools/social/template.html')).href
const outDir = join(root, 'marketing/social')

/** upload budget per image (social networks recompress anything larger) */
const MAX_BYTES = 1.5 * 1024 * 1024

/** canvases; `safe` is the margin (top, right, bottom, left) key content must keep */
const FORMATS = [
  {
    name: 'landscape',
    file: 'faamoffice-share-1200x630.png',
    width: 1200,
    height: 630,
    safe: [40, 48, 40, 48],
  },
  {
    name: 'square',
    file: 'faamoffice-post-1080x1080.png',
    width: 1080,
    height: 1080,
    safe: [40, 48, 40, 48],
  },
  {
    name: 'portrait',
    file: 'faamoffice-post-1080x1350.png',
    width: 1080,
    height: 1350,
    safe: [40, 48, 40, 48],
  },
  {
    name: 'story',
    file: 'faamoffice-story-1080x1920.png',
    width: 1080,
    height: 1920,
    safe: [250, 48, 340, 48],
  },
]

/** the mark (ring + dot) cropped to its bounding box, so CSS sizes the visible logo */
function markSvg(id, className) {
  const pad = 6
  const viewBox = [
    CONTENT.x0 - pad,
    CONTENT.y0 - pad,
    CONTENT.x1 - CONTENT.x0 + pad * 2,
    CONTENT.y1 - CONTENT.y0 + pad * 2,
  ].join(' ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" class="${className}" aria-hidden="true">${logo({ id })}</svg>`
}

/** sharp from the website's dependencies, when installed */
function loadSharp() {
  try {
    return createRequire(join(root, 'web/package.json'))('sharp')
  } catch {
    return null
  }
}

async function render(browser, format) {
  const page = await browser.newPage({
    viewport: { width: format.width, height: format.height },
    deviceScaleFactor: 1,
  })
  await page.goto(`${template}#${format.name}`, { waitUntil: 'load' })
  const slots = await page.$$eval('[data-logo]', (els) =>
    els.map((el) => ({ id: el.dataset.logo, className: el.className })),
  )
  const markup = Object.fromEntries(slots.map((s) => [s.id, markSvg(`m-${s.id}`, s.className)]))
  await page.evaluate(async (markup) => {
    const doc = globalThis.document
    for (const el of doc.querySelectorAll('[data-logo]')) el.outerHTML = markup[el.dataset.logo]
    await doc.fonts.ready
    await Promise.all(
      [...doc.images].map((img) =>
        img.complete ? null : new Promise((done) => (img.onload = img.onerror = done)),
      ),
    )
  }, markup)

  // faces a canvas does not use stay 'unloaded'; a missing or broken file is 'error'
  const fonts = await page.evaluate(() =>
    [...globalThis.document.fonts].map((f) => ({
      face: `${f.family} ${f.weight}`,
      status: f.status,
    })),
  )
  const failed = fonts.filter((f) => f.status === 'error')
  if (failed.length)
    throw new Error(`${format.name}: fonts failed to load: ${failed.map((f) => f.face)}`)

  const boxes = await page.evaluate(() =>
    [...globalThis.document.querySelectorAll('[data-check]')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const r = el.getBoundingClientRect()
        const art = el.hasAttribute('data-art')
        return {
          name: el.dataset.check,
          art,
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
        }
      }),
  )
  const box = (b) =>
    `${b.name} [${Math.round(b.left)}, ${Math.round(b.top)} - ${Math.round(b.right)}, ${Math.round(b.bottom)}]`
  // text blocks must not touch each other or the artwork; artwork pieces
  // (cards, the hero sticker) may overlap one another
  const clashes = []
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      if (a.art && b.art) continue
      const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
      if (!apart) clashes.push(`${box(a)} x ${box(b)}`)
    }
  }
  if (clashes.length) {
    console.error(`${format.name}: overlapping blocks: ${clashes.join('; ')}`)
    process.exitCode = 1
  }
  const [top, right, bottom, left] = format.safe
  const outside = boxes.filter(
    (b) =>
      b.left < left ||
      b.top < top ||
      b.right > format.width - right ||
      b.bottom > format.height - bottom,
  )
  if (outside.length) {
    console.error(`${format.name}: outside the safe area: ${outside.map(box).join('; ')}`)
    process.exitCode = 1
  }

  const png = await page.screenshot({
    clip: { x: 0, y: 0, width: format.width, height: format.height },
  })
  await page.close()
  return png
}

const sharp = loadSharp()
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
try {
  for (const format of FORMATS) {
    let png = await render(browser, format)
    if (sharp) {
      png = await sharp(png).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
      // the grain makes truecolour PNGs heavy; past the budget, a dithered
      // 256-colour palette keeps the gradients smooth at a third of the size
      if (png.length > MAX_BYTES) {
        png = await sharp(png)
          .png({ palette: true, quality: 100, dither: 1, effort: 10 })
          .toBuffer()
      }
    }
    writeFileSync(join(outDir, format.file), png)
    console.log(`${format.file}  ${(png.length / 1024).toFixed(0)} KB`)
  }
} finally {
  await browser.close()
}
