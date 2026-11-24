import { describe, expect, it } from 'vitest';
import { decodePng } from '../../e2e/lib/png';
import { encodeIco, encodePng, faviconSvg, LOGO_FILES, logoFiles, type RgbaImage } from './files';

// The logo's files (dev/logo/files.ts), in Node: each PNG reads back to the
// bytes the page made, the ICO's directory points at its PNGs, the SVG
// holds its two in their order, and each file gets its own image.

function rgba(w: number, h: number, seed: number): RgbaImage {
  const bytes = new Uint8Array(w * h * 4);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + seed * 101 + ((i * i) >> 3)) & 255;
  return { w, h, rgba: bytes };
}

/** A PNG's chunk types, in order. */
function chunks(png: Buffer): string[] {
  const out: string[] = [];
  for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) out.push(png.toString('latin1', at + 4, at + 8));
  return out;
}

describe("the logo's files", () => {
  it('writes 8-bit RGBA PNGs that read back to the same bytes, with no other chunk', () => {
    for (const [w, h] of [[1, 1], [7, 5], [48, 48]] as const) {
      const im = rgba(w, h, w);
      const png = encodePng(im);
      expect(chunks(png)).toEqual(['IHDR', 'IDAT', 'IEND']);
      expect([png[24], png[25]], 'bit depth and colour type').toEqual([8, 6]);
      const back = decodePng(png);
      expect([back.width, back.height]).toEqual([w, h]);
      expect(Buffer.from(back.rgba).equals(Buffer.from(im.rgba))).toBe(true);
    }
    expect(() => encodePng({ w: 2, h: 2, rgba: new Uint8Array(15) })).toThrow(/aren't 2 × 2 RGBA/);
  });

  it('writes an ICO whose directory points at each PNG, with its size', () => {
    const icons = [16, 32, 48].map((n) => ({ w: n, h: n, png: encodePng(rgba(n, n, n)) }));
    const ico = encodeIco(icons);
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3]);
    for (const [i, icon] of icons.entries()) {
      const e = 6 + 16 * i;
      expect([ico[e], ico[e + 1], ico.readUInt16LE(e + 4), ico.readUInt16LE(e + 6)]).toEqual([icon.w, icon.h, 1, 32]);
      const at = ico.readUInt32LE(e + 12);
      expect(ico.subarray(at, at + ico.readUInt32LE(e + 8)).equals(icon.png)).toBe(true);
    }
  });

  it("writes an SVG that shows the light tab's PNG, and the dark tab's under prefers-color-scheme: dark", () => {
    const [light, dark] = [encodePng(rgba(32, 32, 1)), encodePng(rgba(32, 32, 2))];
    const svg = faviconSvg(light!, dark!, 32);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 32 32" width="32" height="32">/);
    expect(svg).toContain('<style>.d{display:none}@media (prefers-color-scheme:dark){.l{display:none}.d{display:inline}}</style>');
    const images = [...svg.matchAll(/<image class="(\w)" width="32" height="32" href="data:image\/png;base64,([^"]+)"\/>/g)];
    expect(images.map((m) => [m[1], Buffer.from(m[2]!, 'base64')])).toEqual([['l', light], ['d', dark]]);
  });

  it("gives each file its own image, in LOGO_FILES' order, and refuses a missing one", () => {
    const sizes = { fav16: [16, 16], fav32: [32, 32], fav32Dark: [32, 32], fav48: [48, 48], apple: [180, 180], card: [40, 21], logo: [64, 64], lockupLight: [40, 15], lockupDark: [40, 15] };
    const images = Object.fromEntries(Object.entries(sizes).map(([name, [w, h]], k) => [name, rgba(w!, h!, k)]));
    const files = logoFiles(images);
    expect(files.map(([path]) => path)).toEqual([...LOGO_FILES]);
    const file = (path: string): Buffer => files.find(([p]) => p === path)![1];
    expect(file('public/apple-touch-icon.png').equals(encodePng(images['apple']!))).toBe(true);
    expect(file('public/og.png').equals(encodePng(images['card']!))).toBe(true);
    expect(file('docs/brand/lockup-dark.png').equals(encodePng(images['lockupDark']!))).toBe(true);
    expect(file('public/favicon.svg').toString()).toBe(faviconSvg(encodePng(images['fav32']!), encodePng(images['fav32Dark']!), 32));
    expect(file('public/favicon.ico').readUInt16LE(4)).toBe(3);
    const missing = Object.fromEntries(Object.entries(images).filter(([name]) => name !== 'logo'));
    expect(() => logoFiles(missing)).toThrow('the page drew no logo');
  });
});
