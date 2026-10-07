/**
 * The FaamOffice logo as SVG markup, shared by the brand asset generators
 * (tools/gen-app-icons.mjs, tools/gen-appx-assets.mjs). It is a vector rebuild
 * of the supplied 1024px artwork: a ring with a horizontal green → teal → blue
 * gradient and a green → mint dot breaking out at the top right.
 */

// ---- the logo, in the supplied artwork's 1024 coordinate space ----
export const RING = { cx: 511.5, cy: 511.5, r: 284.25, width: 45.5, x0: 205, x1: 818 }
export const DOT = { cx: 800.5, cy: 243.5, r: 55, x0: 746, x1: 856 }
export const RING_STOPS = [
  [0, '#3AAC71'],
  [0.24, '#349C8B'],
  [0.318, '#32A6A5'],
  [0.514, '#2B95C2'],
  [0.71, '#2485DF'],
  [1, '#1D74FA'],
]
export const DOT_STOPS = [
  [0, '#5FAC39'],
  [0.236, '#349A34'],
  [0.6, '#28CE87'],
  [1, '#1DFACD'],
]
// bounding box of ring + dot
export const CONTENT = { x0: 205, y0: 188.5, x1: 856, y1: 818.75 }

const stops = (list) => list.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')

/**
 * The logo as SVG markup in 1024 space. `zoom` scales it about the ring's
 * centre (1 = the supplied composition); `ringWidth` overrides the stroke.
 */
export function logo({ zoom = 1, ringWidth = RING.width, id = 'l' } = {}) {
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

export const svg = (body, size = 1024) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${body}</svg>`

/** white tile behind the logo: 'square' (full bleed), 'rounded' (Windows/Linux), 'mac' (squircle on the Big Sur grid) */
export function tile(kind) {
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
export function iconSvg(kind, pixels) {
  const small = pixels <= 32
  const body = small ? logo({ zoom: 1.32, ringWidth: 70 }) : logo()
  if (kind === 'mac') {
    // the logo is laid out on the 824 squircle exactly as on the 1024 artwork
    return svg(`${tile('mac')}<g transform="translate(100 100) scale(${824 / 1024})">${body}</g>`)
  }
  return svg(`${tile(kind)}${body}`)
}
