/**
 * How the announcement dialog frames its image, whatever its size or shape:
 * the frame takes the image's own aspect ratio within 16:10…3:1; an image
 * that (nearly) matches fills the frame, any other one is shown whole over a
 * blurred copy of itself and never upscaled.
 *
 * Keep in sync with web/src/lib/announcement-shared.ts (the admin editor's
 * preview of the dialog): both sides must frame an image the same way.
 */

/** the tallest frame (16:10): a square or portrait image is shown whole */
export const MIN_FRAME_RATIO = 1.6
/** the widest frame (3:1, a common banner shape): a wider panorama is shown whole */
export const MAX_FRAME_RATIO = 3
/** an image whose ratio differs from the frame's by at most this factor fills
 * it, losing at most ~11% of one dimension */
export const COVER_TOLERANCE = 1.12
/** CSS px; a narrower image would visibly upscale when filling the frame */
export const SMALL_IMAGE_WIDTH = 280
/** the frame before the image is measured, and for an unmeasurable one */
export const DEFAULT_FRAME_RATIO = 16 / 9

export type MediaFitMode = 'cover' | 'contain'

export interface MediaFit {
  /** width / height of the frame */
  frameRatio: number
  /** cover: the image fills the frame; contain: shown whole over a blurred backdrop */
  mode: MediaFitMode
}

export function computeMediaFit(width: number, height: number): MediaFit {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { frameRatio: DEFAULT_FRAME_RATIO, mode: 'contain' }
  }
  const ratio = width / height
  const frameRatio = Math.min(MAX_FRAME_RATIO, Math.max(MIN_FRAME_RATIO, ratio))
  const mismatch = Math.max(ratio / frameRatio, frameRatio / ratio)
  const mode = mismatch <= COVER_TOLERANCE && width >= SMALL_IMAGE_WIDTH ? 'cover' : 'contain'
  return { frameRatio, mode }
}
