// The logo page's own resampler and post ops (dev/logo.html), on the
// portrait's premultiplied floats (src/render/portrait.ts): every size is
// made here from the big render, never by the browser scaling a picture.
// Exact 2 × 2 box halvings while the image is at least four times the
// target, then one separable Lanczos-3 step, its support widened by the
// scale. An outline is drawn at eight times the target, so the last steps
// smooth its edge; a badge puts the mark on a disc, or on a full-bleed
// square; and the hand-tuned pixels paint each eye and the nose as a block
// of ink at the final size, on their projected centres. Pure: Node runs its
// test.

import type { PortraitFeatures, PremultipliedImage } from '../../src/render/portrait';

type Img = PremultipliedImage;
type Point = readonly [number, number];

/** A soft contact shadow under a badge's mark: the mark's alpha blurred by `blur` and moved down by `dy`, shares of
 *  the side, darkening the ground towards `colour` by up to `opacity`. */
export interface BadgeShadow { readonly blur: number; readonly dy: number; readonly opacity: number; readonly colour: number }

/** The post ops, in the order applyPost takes them whatever their order in a list: a badge at the render's size; then
 *  the outline, at eight times the target; then the hand-tuned pixels, at the target. */
export type PostOp =
  | { readonly op: 'outline'; readonly px: number; readonly colour: number; readonly opacity: number }
  | { readonly op: 'badge'; readonly colour: number; readonly scale: number; readonly square: boolean; readonly shadow?: BadgeShadow }
  | { readonly op: 'hint'; readonly eye: Point; readonly nose: Point; readonly colour: number };

export function halve(a: Img): Img {
  const w = a.w >> 1;
  const h = a.h >> 1;
  const s = a.d;
  const W = a.w;
  const d = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i0 = (2 * y * W + 2 * x) * 4;
      const i2 = i0 + W * 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) d[o + c] = 0.25 * (s[i0 + c]! + s[i0 + 4 + c]! + s[i2 + c]! + s[i2 + 4 + c]!);
    }
  }
  return { w, h, d };
}

function lanczos3(x: number): number {
  if (x === 0) return 1;
  if (x <= -3 || x >= 3) return 0;
  const p = Math.PI * x;
  return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p);
}

/** Each target pixel's source pixels and weights along one axis, the weights summing to 1. */
function weights(sn: number, dn: number): { idx: Int32Array[]; wts: Float32Array[] } {
  const scale = sn / dn;
  const f = Math.max(scale, 1);
  const support = 3 * f;
  const idx: Int32Array[] = [];
  const wts: Float32Array[] = [];
  for (let i = 0; i < dn; i++) {
    const centre = (i + 0.5) * scale - 0.5;
    const j0 = Math.floor(centre - support) + 1;
    const j1 = Math.floor(centre + support);
    const n = j1 - j0 + 1;
    const ix = new Int32Array(n);
    const wt = new Float32Array(n);
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const j = j0 + k;
      const w = lanczos3((j - centre) / f);
      ix[k] = Math.min(sn - 1, Math.max(0, j));
      wt[k] = w;
      sum += w;
    }
    for (let k = 0; k < n; k++) wt[k]! /= sum;
    idx.push(ix);
    wts.push(wt);
  }
  return { idx, wts };
}

/** A separable Lanczos-3 resample to tw × th, each pixel clamped to a valid premultiplied colour. */
export function resample(a: Img, tw: number, th: number): Img {
  const hx = weights(a.w, tw);
  const hy = weights(a.h, th);
  const tmp = new Float32Array(tw * a.h * 4);
  for (let y = 0; y < a.h; y++) {
    const row = y * a.w * 4;
    for (let x = 0; x < tw; x++) {
      const ix = hx.idx[x]!;
      const wt = hx.wts[x]!;
      let r = 0;
      let g = 0;
      let b = 0;
      let al = 0;
      for (let k = 0; k < ix.length; k++) {
        const i = row + ix[k]! * 4;
        const w = wt[k]!;
        r += a.d[i]! * w;
        g += a.d[i + 1]! * w;
        b += a.d[i + 2]! * w;
        al += a.d[i + 3]! * w;
      }
      const o = (y * tw + x) * 4;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
      tmp[o + 3] = al;
    }
  }
  const d = new Float32Array(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const iy = hy.idx[y]!;
    const wt = hy.wts[y]!;
    for (let x = 0; x < tw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let al = 0;
      for (let k = 0; k < iy.length; k++) {
        const i = (iy[k]! * tw + x) * 4;
        const w = wt[k]!;
        r += tmp[i]! * w;
        g += tmp[i + 1]! * w;
        b += tmp[i + 2]! * w;
        al += tmp[i + 3]! * w;
      }
      const o = (y * tw + x) * 4;
      const A = Math.min(1, Math.max(0, al));
      d[o] = Math.min(A, Math.max(0, r));
      d[o + 1] = Math.min(A, Math.max(0, g));
      d[o + 2] = Math.min(A, Math.max(0, b));
      d[o + 3] = A;
    }
  }
  return { w: tw, h: th, d };
}

/** Halvings while at least four times the target, then a Lanczos-3 step to it. */
export function downTo(a: Img, size: number): Img {
  let cur = a;
  while (cur.w / 2 >= 2 * size) cur = halve(cur);
  return cur.w === size ? cur : resample(cur, size, size);
}

/** Halvings while at least `k` times the target. */
function downNear(a: Img, size: number, k: number): Img {
  let cur = a;
  while (cur.w / 2 >= k * size) cur = halve(cur);
  return cur;
}

function downOrUp(a: Img, size: number): Img {
  return size < a.w ? downTo(a, size) : resample(a, size, size);
}

function rgbOf(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** The alpha dilated by `radius` px, its edge smoothed, filled with `colour` at `opacity` under the image. */
export function outline(a: Img, radius: number, colour: number, opacity: number): Img {
  const [cr, cg, cb] = rgbOf(colour);
  const w = a.w;
  const h = a.h;
  const R = Math.ceil(radius + 1);
  const offsets: [number, number, number][] = [];
  for (let v = -R; v <= R; v++) {
    for (let u = -R; u <= R; u++) {
      const cover = Math.min(1, Math.max(0, radius + 0.5 - Math.hypot(u, v)));
      if (cover > 0) offsets.push([u, v, cover]);
    }
  }
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = a.d[i * 4 + 3]!;
  const d = new Float32Array(a.d);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (const [u, v, cover] of offsets) {
        const xx = x + u;
        const yy = y + v;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = alpha[yy * w + xx]! * cover;
        if (q > m) m = q;
        if (m >= 1) break;
      }
      m *= opacity;
      const o = (y * w + x) * 4;
      const k = 1 - d[o + 3]!;
      d[o]! += cr * m * k;
      d[o + 1]! += cg * m * k;
      d[o + 2]! += cb * m * k;
      d[o + 3]! += m * k;
    }
  }
  return { w, h, d };
}

/** A separable box blur of one channel, three passes each way: close to a Gaussian of sigma about r. */
function blurChannel(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src;
  let a = Float32Array.from(src);
  let b = new Float32Array(w * h);
  const pass = (from: Float32Array, to: Float32Array, horizontal: boolean): void => {
    const n = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const span = 2 * r + 1;
    for (let l = 0; l < lines; l++) {
      const at = (k: number): number => {
        const kk = Math.min(n - 1, Math.max(0, k));
        return horizontal ? from[l * w + kk]! : from[kk * w + l]!;
      };
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += at(k);
      for (let k = 0; k < n; k++) {
        const v = sum / span;
        if (horizontal) to[l * w + k] = v;
        else to[k * w + l] = v;
        sum += at(k + r + 1) - at(k - r);
      }
    }
  };
  for (let i = 0; i < 3; i++) {
    pass(a, b, true);
    [a, b] = [b, a];
    pass(a, b, false);
    [a, b] = [b, a];
  }
  return a;
}

/** The mark on a disc filling the square, or on the whole square: the mark resampled to `scale` of the side and
 *  centred, over the ground in `colour`, with a contact shadow if asked. Returns the image and the map of the mark's
 *  unit square into the badge's. */
export function badge(a: Img, colour: number, scale: number, square: boolean, shadow?: BadgeShadow): { img: Img; map: (p: Point) => [number, number] } {
  const N = a.w;
  const d = new Float32Array(N * N * 4);
  const [r, g, b] = rgbOf(colour);
  const R = N / 2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const cover = square ? 1 : Math.min(1, Math.max(0, R - Math.hypot(x + 0.5 - R, y + 0.5 - R) + 0.5));
      const o = (y * N + x) * 4;
      d[o] = r * cover;
      d[o + 1] = g * cover;
      d[o + 2] = b * cover;
      d[o + 3] = cover;
    }
  }
  const M = Math.round(N * scale);
  const mark = M === N ? a : downOrUp(a, M);
  const ox = Math.round((N - M) / 2);
  const oy = Math.round((N - M) / 2);
  if (shadow && shadow.opacity > 0) {
    const A = new Float32Array(N * N);
    const dy = Math.round(shadow.dy * N);
    for (let y = 0; y < M; y++) {
      const yy = y + oy + dy;
      if (yy < 0 || yy >= N) continue;
      for (let x = 0; x < M; x++) {
        const xx = x + ox;
        if (xx < 0 || xx >= N) continue;
        A[yy * N + xx] = mark.d[(y * M + x) * 4 + 3]!;
      }
    }
    const S = blurChannel(A, N, N, Math.max(1, Math.round((shadow.blur * N) / 1.7)));
    const [sr, sg, sb] = rgbOf(shadow.colour);
    for (let i = 0; i < N * N; i++) {
      const k = shadow.opacity * Math.min(1, S[i]!);
      if (k <= 0) continue;
      const o = i * 4;
      const cover = d[o + 3]!;
      d[o] = d[o]! * (1 - k) + sr * k * cover;
      d[o + 1] = d[o + 1]! * (1 - k) + sg * k * cover;
      d[o + 2] = d[o + 2]! * (1 - k) + sb * k * cover;
    }
  }
  for (let y = 0; y < M; y++) {
    const yy = y + oy;
    if (yy < 0 || yy >= N) continue;
    for (let x = 0; x < M; x++) {
      const xx = x + ox;
      if (xx < 0 || xx >= N) continue;
      const i = (y * M + x) * 4;
      const o = (yy * N + xx) * 4;
      const k = 1 - mark.d[i + 3]!;
      for (let c = 0; c < 4; c++) d[o + c] = mark.d[i + c]! + d[o + c]! * k;
    }
  }
  return { img: { w: N, h: N, d }, map: (p) => [(ox + p[0] * M) / N, (oy + p[1] * M) / N] };
}

/** Each eye and the nose as a block of pure ink at the final size, `eye` and `nose` px wide and tall, on the projected
 *  centres, rounded so a symmetric face stays symmetric. */
export function hint(a: Img, f: PortraitFeatures, eye: Point, nose: Point, colour: number): Img {
  const d = new Float32Array(a.d);
  const [r, g, b] = rgbOf(colour);
  const paint = (cx: number, cy: number, w: number, h: number): void => {
    const x0 = Math.round(cx * a.w - w / 2);
    const y0 = Math.round(cy * a.h - h / 2);
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x < 0 || y < 0 || x >= a.w || y >= a.h) continue;
        const i = (y * a.w + x) * 4;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 1;
      }
    }
  };
  for (const e of f.eyes) paint(e[0], e[1], eye[0], eye[1]);
  paint(f.nose[0], f.nose[1], nose[0], nose[1]);
  return { w: a.w, h: a.h, d };
}

function mapFeatures(f: PortraitFeatures, map: (p: Point) => [number, number]): PortraitFeatures {
  const [bx0, by0] = map([f.box[0], f.box[1]]);
  const [bx1, by1] = map([f.box[2], f.box[3]]);
  return { eyes: f.eyes.map(map), nose: map(f.nose), feet: f.feet === null ? null : map([0.5, f.feet])[1], box: [bx0, by0, bx1, by1] };
}

/** One output of a portrait: its post ops on the render, at `size` px. */
export function applyPost(a: Img, size: number, post: readonly PostOp[], features: PortraitFeatures): { img: Img; features: PortraitFeatures } {
  let cur = a;
  let f = features;
  for (const p of post) {
    if (p.op !== 'badge') continue;
    const r = badge(cur, p.colour, p.scale, p.square, p.shadow);
    cur = r.img;
    f = mapFeatures(f, r.map);
  }
  const lined = post.find((p) => p.op === 'outline');
  if (lined) {
    cur = downNear(cur, size, 8);
    cur = outline(cur, lined.px * (cur.w / size), lined.colour, lined.opacity);
  }
  cur = downTo(cur, size);
  for (const p of post) if (p.op === 'hint') cur = hint(cur, f, p.eye, p.nose, p.colour);
  return { img: cur, features: f };
}

/** Straight 8-bit RGBA, as a PNG holds it: a pixel under half a level of alpha is clear. */
export function toBytes(a: Img): Uint8Array {
  const out = new Uint8Array(a.w * a.h * 4);
  for (let i = 0; i < out.length; i += 4) {
    const al = a.d[i + 3]!;
    if (al <= 0.5 / 255) continue;
    out[i] = Math.round(255 * Math.min(1, a.d[i]! / al));
    out[i + 1] = Math.round(255 * Math.min(1, a.d[i + 1]! / al));
    out[i + 2] = Math.round(255 * Math.min(1, a.d[i + 2]! / al));
    out[i + 3] = Math.round(255 * al);
  }
  return out;
}
