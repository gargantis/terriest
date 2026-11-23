import { describe, expect, it } from 'vitest';
import type { PortraitFeatures, PremultipliedImage } from '../../src/render/portrait';
import { applyPost, badge, downTo, halve, hint, outline, toBytes } from './post';

// The logo page's resampler and post ops (dev/logo/post.ts), in Node: the
// picture each makes, on images small enough to read pixel by pixel.

function image(w: number, h: number, pixel: (x: number, y: number) => readonly [number, number, number, number]): PremultipliedImage {
  const d = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(pixel(x, y), (y * w + x) * 4);
  return { w, h, d };
}

const at = (a: PremultipliedImage, x: number, y: number): number[] => Array.from(a.d.subarray((y * a.w + x) * 4, (y * a.w + x) * 4 + 4));
const FACE: PortraitFeatures = { eyes: [[0.3, 0.4], [0.7, 0.4]], nose: [0.5, 0.6], feet: null, box: [0.1, 0.1, 0.9, 0.9] };

describe("the logo page's resampler and post ops", () => {
  it('halves by averaging each 2 × 2 block', () => {
    const a = image(4, 2, (x) => [x / 8, 0, 0, x < 2 ? 1 : 0.5]);
    const h = halve(a);
    expect([h.w, h.h]).toEqual([2, 1]);
    expect(at(h, 0, 0)[0]).toBeCloseTo(1 / 16, 6);
    expect(at(h, 1, 0)[3]).toBeCloseTo(0.5, 6);
  });

  it('keeps a flat colour flat at every size, and keeps a symmetric picture symmetric', () => {
    for (const size of [16, 32, 48, 180]) {
      const flat = downTo(image(512, 512, () => [0.2, 0.3, 0.1, 0.5]), size);
      expect([flat.w, flat.h]).toEqual([size, size]);
      for (const v of [at(flat, 0, 0), at(flat, size >> 1, size - 1)]) for (const [k, want] of [0.2, 0.3, 0.1, 0.5].entries()) expect(v[k]).toBeCloseTo(want, 5);
    }
    const disc = downTo(image(256, 256, (x, y) => (Math.hypot(x + 0.5 - 128, y + 0.5 - 128) < 80 ? [1, 1, 1, 1] : [0, 0, 0, 0])), 48);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 24; x++) expect(at(disc, 47 - x, y)[3]).toBeCloseTo(at(disc, x, y)[3]!, 5);
  });

  it('outlines a mark under it, its edge smoothed, at the opacity asked', () => {
    const dot = image(9, 9, (x, y) => (x === 4 && y === 4 ? [1, 1, 1, 1] : [0, 0, 0, 0]));
    const o = outline(dot, 1.25, 0x000000, 0.5);
    expect(at(o, 4, 4)).toEqual([1, 1, 1, 1]);
    expect(at(o, 5, 4)).toEqual([0, 0, 0, 0.5 * 0.75]);
    expect(at(o, 5, 5)[3]).toBeCloseTo(0.5 * (1.75 - Math.SQRT2), 6);
    expect(at(o, 7, 4)).toEqual([0, 0, 0, 0]);
  });

  it('puts the mark on a disc or a full-bleed square, centred, its features mapped with it', () => {
    const mark = image(64, 64, () => [0, 0, 0, 0]);
    const disc = badge(mark, 0x5c9e46, 0.5, false);
    expect(at(disc.img, 0, 0)[3]).toBe(0);
    expect(at(disc.img, 32, 32)[3]).toBe(1);
    const square = badge(mark, 0x5c9e46, 0.5, true, { blur: 0.025, dy: 0.02, opacity: 0.35, colour: 0x1d2b1f });
    expect(at(square.img, 0, 0)).toEqual([0x5c / 255, 0x9e / 255, 0x46 / 255, 1].map((v) => Math.fround(v)));
    expect(square.map([0.5, 0.5])).toEqual([0.5, 0.5]);
    expect(square.map([0, 0])).toEqual([0.25, 0.25]);
  });

  it('paints the eyes and the nose as blocks of ink on their centres, a symmetric face kept symmetric', () => {
    const h = hint(image(16, 16, () => [0, 0, 0, 0]), FACE, [1, 2], [2, 2], 0x1b1714);
    const inked = (x: number, y: number): boolean => at(h, x, y)[3] === 1;
    const ink: string[] = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (inked(x, y)) ink.push(`${x},${y}`);
    // Mirrored about the middle of 16 px: 4 and 11, 7 and 8.
    expect(ink).toEqual(['4,5', '11,5', '4,6', '11,6', '7,9', '8,9', '7,10', '8,10']);
  });

  it('applies the hand-tuned pixels last, at the final size, so they stay pure ink', () => {
    const face = image(512, 512, (x, y) => (Math.hypot(x - 256, y - 256) < 200 ? [0.9, 0.85, 0.7, 1] : [0, 0, 0, 0]));
    const r = applyPost(face, 16, [{ op: 'outline', px: 1, colour: 0x1b1714, opacity: 0.92 }, { op: 'hint', eye: [1, 2], nose: [2, 2], colour: 0x1b1714 }], FACE);
    const bytes = toBytes(r.img);
    expect([r.img.w, r.img.h, bytes.length]).toEqual([16, 16, 16 * 16 * 4]);
    expect(Array.from(bytes.subarray((5 * 16 + 4) * 4, (5 * 16 + 4) * 4 + 4))).toEqual([0x1b, 0x17, 0x14, 255]);
    // The outline reaches past the disc's edge, which the resampler alone leaves clear.
    expect(bytes[(8 * 16 + 0) * 4 + 3]).toBeGreaterThan(0);
  });

  it('writes straight 8-bit RGBA, clear under half a level of alpha', () => {
    const a = image(3, 1, (x) => [[0.25, 0.25, 0.25, 0.5], [0, 0, 0, 0.001], [0.2, 0.4, 0.6, 1]][x] as [number, number, number, number]);
    expect(Array.from(toBytes(a))).toEqual([128, 128, 128, 128, 0, 0, 0, 0, 51, 102, 153, 255]);
  });
});
