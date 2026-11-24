// The logo's files, as e2e/logo.run.ts writes them from what dev/logo.html
// draws, at the paths the repo holds them (the owner's pick of 2026-11-22,
// PLAN's status): the tab icon's ICO and SVG, the phone's icon and the
// link-preview card, which ship from public/, and the logo and its two
// lock-ups in docs/brand/, which don't. In Node.
// - Each PNG is 8-bit RGBA exactly as the page made it, each row filtered by
//   the filter whose bytes sum smallest, deflated at level 9, with no other
//   chunk.
// - The ICO holds its 16, 32 and 48 px PNGs, as every current browser reads.
// - The SVG shows the light tab's 32 px, or the dark tab's under
//   prefers-color-scheme: dark. An SVG shown as an image matched no
//   resolution query at twice the pixels in Chromium, Firefox or WebKit, so
//   it can't pick the hand-tuned 16 px on a 1x screen: an engine that takes
//   it shrinks the 32 there, and one that doesn't takes the ICO.

import { crc32, deflateSync } from 'node:zlib';

/** Straight 8-bit RGBA, rows from the top. */
export interface RgbaImage { readonly w: number; readonly h: number; readonly rgba: Uint8Array }

/** The files, repo-relative, in the order logoFiles makes them. */
export const LOGO_FILES = [
  'public/favicon.ico', 'public/favicon.svg', 'public/apple-touch-icon.png', 'public/og.png', 'docs/brand/logo.png', 'docs/brand/lockup-light.png',
  'docs/brand/lockup-dark.png',
] as const;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function encodePng(im: RgbaImage): Buffer {
  const { w, h, rgba } = im;
  if (rgba.length !== w * h * 4) throw new Error(`${rgba.length} bytes aren't ${w} × ${h} RGBA`);
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  const candidates = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = candidates[f]!;
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = row[i]!;
        const a = i >= 4 ? row[i - 4]! : 0;
        const b = prev ? prev[i]! : 0;
        const c = prev && i >= 4 ? prev[i - 4]! : 0;
        let v: number;
        if (f === 0) v = x;
        else if (f === 1) v = x - a;
        else if (f === 2) v = x - b;
        else if (f === 3) v = x - ((a + b) >> 1);
        else v = x - paeth(a, b, c);
        v &= 255;
        out[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    candidates[best]!.copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  // 8 bits a channel, RGBA, deflate, adaptive filters, no interlace.
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** An ICO of PNGs, each `w` × `h` px. */
export function encodeIco(images: readonly { readonly w: number; readonly h: number; readonly png: Buffer }[]): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const im of images) {
    const e = Buffer.alloc(16);
    e[0] = im.w >= 256 ? 0 : im.w;
    e[1] = im.h >= 256 ? 0 : im.h;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(im.png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += im.png.length;
    entries.push(e);
  }
  return Buffer.concat([head, ...entries, ...images.map((im) => im.png)]);
}

/** The SVG favicon: the light tab's PNG, or the dark tab's under prefers-color-scheme: dark, each `size` px. */
export function faviconSvg(light: Buffer, dark: Buffer, size: number): string {
  const uri = (png: Buffer): string => `data:image/png;base64,${png.toString('base64')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`
    + '<style>.d{display:none}@media (prefers-color-scheme:dark){.l{display:none}.d{display:inline}}</style>'
    + `<image class="l" width="${size}" height="${size}" href="${uri(light)}"/>`
    + `<image class="d" width="${size}" height="${size}" href="${uri(dark)}"/>`
    + '</svg>\n';
}

/** Each file, repo-relative, and its bytes, from the page's images (dev/logo/picks.ts' outputs and lock-ups). */
export function logoFiles(images: Readonly<Record<string, RgbaImage>>): [(typeof LOGO_FILES)[number], Buffer][] {
  const image = (name: string): RgbaImage => {
    const im = images[name];
    if (!im) throw new Error(`the page drew no ${name}`);
    return im;
  };
  const png = (name: string): Buffer => encodePng(image(name));
  const icon = (name: string): { w: number; h: number; png: Buffer } => ({ w: image(name).w, h: image(name).h, png: png(name) });
  return [
    ['public/favicon.ico', encodeIco([icon('fav16'), icon('fav32'), icon('fav48')])],
    ['public/favicon.svg', Buffer.from(faviconSvg(png('fav32'), png('fav32Dark'), 32))],
    ['public/apple-touch-icon.png', png('apple')],
    ['public/og.png', png('card')],
    ['docs/brand/logo.png', png('logo')],
    ['docs/brand/lockup-light.png', png('lockupLight')],
    ['docs/brand/lockup-dark.png', png('lockupDark')],
  ];
}
