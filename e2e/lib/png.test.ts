import { describe, expect, it } from 'vitest';
import { colourAt, coloursIn, type Image, meanColour, median } from './png';

// What the specs read of a capture's pixels (e2e/lib/png.ts), on a small
// image made here: a pixel's colour, rounded to the nearest and clamped to
// the image; a box's every pixel, its edges included and clipped; a square's
// mean; and a median, so a few odd pixels in a region change nothing.

/** A 4 × 3 image whose pixel at (x, y) is [10x, 10y, 10x + y]. */
function image(): Image {
  const width = 4;
  const height = 3;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgba.set([10 * x, 10 * y, 10 * x + y, 255], (y * width + x) * 4);
  }
  return { width, height, rgba };
}

describe("a capture's pixels", () => {
  it("reads a pixel's colour at the nearest pixel, clamped to the image", () => {
    const i = image();
    expect(colourAt(i, 2, 1)).toEqual([20, 10, 21]);
    expect(colourAt(i, 2.4, 0.6)).toEqual([20, 10, 21]);
    expect([colourAt(i, -5, -1), colourAt(i, 9, 9)]).toEqual([[0, 0, 0], [30, 20, 32]]);
  });

  it("reads a box's every pixel, its edges included, row by row, clipped to the image", () => {
    const i = image();
    expect(coloursIn(i, 1, 1, 2, 2)).toEqual([[10, 10, 11], [20, 10, 21], [10, 20, 12], [20, 20, 22]]);
    expect(coloursIn(i, -3, 2, 0.6, 7)).toEqual([[0, 20, 2], [10, 20, 12]]);
    expect(coloursIn(i, 5, 0, 9, 2)).toEqual([]);
    expect(meanColour(i, 1, 1, 1)).toEqual([10, 10, 11]);
  });

  it('takes the middle value, the upper of the middle two for an even count, whatever the order', () => {
    expect([median([3, 1, 2]), median([4, 1, 3, 2]), median([7]), median([-2, 9, 9, -2, 0])]).toEqual([2, 3, 7, 0]);
    expect(median([])).toBeNaN();
  });
});
