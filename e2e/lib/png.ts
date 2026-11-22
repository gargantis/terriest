// Reads a Playwright screenshot, so a spec can check what the page drew
// (PLAN §16): 8-bit RGB or RGBA PNGs, not interlaced, as the engines'
// screenshots are. Node's zlib inflates; the five row filters are undone
// here. And reads its pixels: a square's mean colour, a pixel's, a box's
// every pixel, and a median, so a spec can say what a part of the picture
// shows whatever a few pixels in it show.

import { inflateSync } from 'node:zlib';

export interface Image {
  width: number;
  height: number;
  /** RGBA, row by row from the top. */
  rgba: Uint8Array;
}

export function decodePng(png: Buffer): Image {
  let width = 0;
  let height = 0;
  let type = -1;
  const data: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const kind = png.toString('latin1', at + 4, at + 8);
    const chunk = png.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      if (chunk[8] !== 8 || chunk[12] !== 0 || (chunk[9] !== 2 && chunk[9] !== 6)) {
        throw new Error(`a PNG this reader can't read: depth ${chunk[8]}, colour type ${chunk[9]}, interlace ${chunk[12]}`);
      }
      type = chunk[9]!;
    } else if (kind === 'IDAT') {
      data.push(chunk);
    } else if (kind === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  const channels = type === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = (line[i]! + predicted) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) rgba[(y * width + x) * 4 + k] = row[x * channels + k]!;
      rgba[(y * width + x) * 4 + 3] = channels === 4 ? row[x * channels + 3]! : 255;
    }
    previous = row;
  }
  return { width, height, rgba };
}

/** The mean colour, [r, g, b], of the square of side 2·radius + 1 centred on (x, y). */
export function meanColour(image: Image, x: number, y: number, radius: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let j = Math.round(y) - radius; j <= Math.round(y) + radius; j++) {
    for (let i = Math.round(x) - radius; i <= Math.round(x) + radius; i++) {
      if (i < 0 || j < 0 || i >= image.width || j >= image.height) continue;
      const at = (j * image.width + i) * 4;
      r += image.rgba[at]!;
      g += image.rgba[at + 1]!;
      b += image.rgba[at + 2]!;
      n++;
    }
  }
  return [r / n, g / n, b / n];
}

/** A colour, [r, g, b], each 0 to 255. */
export type Rgb = [number, number, number];

/** The colour of the pixel nearest (x, y), clamped to the image. */
export function colourAt(image: Image, x: number, y: number): Rgb {
  const i = Math.min(image.width - 1, Math.max(0, Math.round(x)));
  const j = Math.min(image.height - 1, Math.max(0, Math.round(y)));
  const at = (j * image.width + i) * 4;
  return [image.rgba[at]!, image.rgba[at + 1]!, image.rgba[at + 2]!];
}

/** The colours of every pixel in the box from (x0, y0) to (x1, y1), its edges included and rounded, clipped to the
 *  image, row by row. */
export function coloursIn(image: Image, x0: number, y0: number, x1: number, y1: number): Rgb[] {
  const out: Rgb[] = [];
  for (let j = Math.max(0, Math.round(y0)); j <= Math.min(image.height - 1, Math.round(y1)); j++) {
    for (let i = Math.max(0, Math.round(x0)); i <= Math.min(image.width - 1, Math.round(x1)); i++) out.push(colourAt(image, i, j));
  }
  return out;
}

/** The middle of some numbers, the upper of the middle two for an even count; NaN for none. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? NaN : sorted[sorted.length >> 1]!;
}
