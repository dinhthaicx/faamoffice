import { describe, expect, it } from 'vitest'
import {
  COVER_TOLERANCE,
  DEFAULT_FRAME_RATIO,
  MAX_FRAME_RATIO,
  MIN_FRAME_RATIO,
  SMALL_IMAGE_WIDTH,
  computeMediaFit,
} from '../src/renderer/src/announcement-media'

/**
 * How the announcement dialog frames its image (src/renderer/src/announcement-media.ts);
 * the admin editor's preview (web/src/lib/announcement-shared.ts) must agree.
 */
describe('computeMediaFit', () => {
  it.each([
    // width, height, frame ratio, mode
    [1600, 900, 16 / 9, 'cover'],
    [1200, 600, 2, 'cover'],
    // 1.5 is a little taller than 16:10: the frame stops there, cropping ~6.7%
    [1500, 1000, 1.6, 'cover'],
    // square and portrait: the tallest frame, the image shown whole
    [1024, 1024, 1.6, 'contain'],
    [800, 1200, 1.6, 'contain'],
    // a 3:1 banner fills the widest frame exactly
    [3000, 1000, 3, 'cover'],
    [2600, 1000, 2.6, 'cover'],
    // a panorama past 3:1 by more than the tolerance is shown whole…
    [4000, 1000, 3, 'contain'],
    // …within it, it fills the widest frame
    [3300, 1000, 3, 'cover'],
    // a small image is never stretched to fill, even at a matching ratio
    [200, 112, 200 / 112, 'contain'],
  ] as const)('%i×%i → frame %f, %s', (width, height, frameRatio, mode) => {
    const fit = computeMediaFit(width, height)
    expect(fit.frameRatio).toBeCloseTo(frameRatio, 6)
    expect(fit.mode).toBe(mode)
  })

  it('keeps the frame within 16:10…3:1', () => {
    for (const [width, height] of [
      [10, 1000],
      [1000, 10],
      [640, 480],
      [1920, 1080],
    ]) {
      const { frameRatio } = computeMediaFit(width, height)
      expect(frameRatio).toBeGreaterThanOrEqual(MIN_FRAME_RATIO)
      expect(frameRatio).toBeLessThanOrEqual(MAX_FRAME_RATIO)
    }
  })

  it('fills the frame only within the crop tolerance', () => {
    const height = 1000
    // just inside / just outside the tolerance below 16:10
    const inside = Math.ceil((MIN_FRAME_RATIO / COVER_TOLERANCE) * height) + 1
    const outside = Math.floor((MIN_FRAME_RATIO / COVER_TOLERANCE) * height) - 1
    expect(computeMediaFit(inside, height).mode).toBe('cover')
    expect(computeMediaFit(outside, height).mode).toBe('contain')
  })

  it('needs an image at least the small-image width to fill', () => {
    expect(computeMediaFit(SMALL_IMAGE_WIDTH, SMALL_IMAGE_WIDTH / 2).mode).toBe('cover')
    expect(computeMediaFit(SMALL_IMAGE_WIDTH - 1, (SMALL_IMAGE_WIDTH - 1) / 2).mode).toBe('contain')
  })

  it.each([
    [0, 100],
    [100, 0],
    [-5, 100],
    [Number.NaN, 100],
    [100, Number.POSITIVE_INFINITY],
  ])('falls back to a 16:9 contain frame for %f×%f', (width, height) => {
    expect(computeMediaFit(width, height)).toEqual({
      frameRatio: DEFAULT_FRAME_RATIO,
      mode: 'contain',
    })
  })
})
