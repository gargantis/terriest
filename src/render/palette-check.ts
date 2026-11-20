// The palette's checks (PLAN §12, Q-11, C-51; L43, L44, L68; M4's design,
// research/m4/DESIGN.md, §1.12, §1.60): whether a look's colours stay
// apart for normal vision and under simulated protanopia, deuteranopia and
// tritanopia. Each coat, its fur and the marking colour its markings show,
// against both packs' colours and the grass; pack A's colour against pack
// B's; and each pack's colour against both halves' floors, each half in
// the colour and pattern of the pack that defends it (L68), every band of a
// striped one. The palette test (src/render/palette.test.ts) and the look
// book's model (phase 4) both read it, so each sample shows the verdict
// the gate would give it.
//
// roslambo's method (its src/render/palette.test.ts): OKLab (Björn
// Ottosson, 2020) and the Machado, Oliveira and Fernandes (2009) dichromacy
// matrices at full severity, applied in linear RGB and clamped, the
// distance Euclidean in OKLab. Its thresholds: OKLab's just-noticeable
// difference is about 0.02, so two colours the check keeps apart differ by
// at least 2.5 times it (APART), and the packs, the team cue, by 5 times
// (PACKS_APART), roslambo's figure for a hunter and its quarry.
//
// A half's floor is src/render/pitch.ts's: the grass mixed with its pack's
// colour by HALF_TINT in linear light, a striped half's every other band
// shaded by BAND_SHADE, each rounded to 8 bits as three's Color does. The
// palette test checks these floors against the pitch's own geometry, so
// the two can't drift apart. Three-free.

import type { Pack } from '../core/sim/state';
import type { Look } from './look';

export type Vision = 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia';
export const VISIONS: readonly Vision[] = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];

/** A colour in linear-light sRGB, each channel 0 to 1; or, from oklab(), L, a and b. */
export type Triple = readonly [number, number, number];

/** Two colours a check keeps apart differ by this much in OKLab at least, */
export const APART = 0.05;
/** and the packs' colours by this. */
export const PACKS_APART = 0.1;

/** How much of its pack's colour a half's grass takes, and a striped half's darker bands: src/render/pitch.ts's. */
const HALF_TINT = 0.24;
const BAND_SHADE = 0.86;

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (c: number): number => Math.min(1, Math.max(0, c));

/** An sRGB colour, 0xRRGGBB, in linear light. */
export function linearRgb(hex: number): Triple {
  return [toLinear(((hex >> 16) & 255) / 255), toLinear(((hex >> 8) & 255) / 255), toLinear((hex & 255) / 255)];
}

/** A linear-light colour as sRGB, 0xRRGGBB, each channel clamped and rounded to 8 bits. */
export function srgbHex(c: Triple): number {
  const byte = (v: number): number => Math.round(clamp01(toSrgb(v)) * 255);
  return byte(c[0]) * 65536 + byte(c[1]) * 256 + byte(c[2]);
}

/** A linear-light colour in OKLab: L, a, b. */
export function oklab([r, g, b]: Triple): Triple {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** The dichromacy matrices at full severity, for linear RGB. */
const DICHROMACY: Readonly<Record<Exclude<Vision, 'normal'>, readonly Triple[]>> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

/** A linear-light colour as a vision sees it: unchanged for normal vision, else through its matrix, clamped. */
export function simulate(vision: Vision, c: Triple): Triple {
  if (vision === 'normal') return c;
  const [p, q, r] = DICHROMACY[vision];
  const row = (k: Triple): number => clamp01(k[0] * c[0] + k[1] * c[1] + k[2] * c[2]);
  return [row(p!), row(q!), row(r!)];
}

/** The Euclidean distance between two OKLab colours. */
export function oklabDistance(p: Triple, q: Triple): number {
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** How far apart two sRGB colours look to a vision, in OKLab. */
export function seenDistance(a: number, b: number, vision: Vision): number {
  return oklabDistance(oklab(simulate(vision, linearRgb(a))), oklab(simulate(vision, linearRgb(b))));
}

/** Each half's floor colours, by the pack that defends it (L68): one for a plain pack, two bands for a striped one. */
export function halfFloors(look: Look): readonly [readonly number[], readonly number[]] {
  const g = linearRgb(look.pitch.grass);
  const floor = (pack: Pack): readonly number[] => {
    const c = linearRgb(look.packs[pack].colour);
    const t = HALF_TINT;
    const tint = srgbHex([g[0] + (c[0] - g[0]) * t, g[1] + (c[1] - g[1]) * t, g[2] + (c[2] - g[2]) * t]);
    if (look.packs[pack].pattern === 'plain') return [tint];
    const band = linearRgb(tint);
    return [tint, srgbHex([band[0] * BAND_SHADE, band[1] * BAND_SHADE, band[2] * BAND_SHADE])];
  };
  return [floor(0), floor(1)];
}

/** One pair of colours under one vision. */
export interface PaletteCheck {
  readonly what: string;
  readonly vision: Vision;
  readonly a: number;
  readonly b: number;
  readonly distance: number;
  /** The least distance it passes at. */
  readonly min: number;
}

export interface PaletteVerdict {
  readonly pass: boolean;
  /** Every pair checked, pair by pair, each under every vision in VISIONS' order. */
  readonly checks: readonly PaletteCheck[];
  readonly failures: readonly PaletteCheck[];
}

/** A check's line: its vision, its pair, and how far apart they look against how far they must. */
export function describeCheck(c: PaletteCheck): string {
  return `${c.vision}: ${c.what}, ${c.distance.toFixed(3)} apart, at least ${c.min}`;
}

/** The look's palette checked (PLAN §12, C-51): its coats against the packs and the grass, the packs against each
 *  other, and each pack against both halves' floors. */
export function checkPalette(look: Look): PaletteVerdict {
  const checks: PaletteCheck[] = [];
  const pair = (what: string, a: number, b: number, min: number): void => {
    for (const vision of VISIONS) checks.push({ what, vision, a, b, distance: seenDistance(a, b, vision), min });
  };
  const packName = (p: Pack): string => `pack ${p === 0 ? 'A' : 'B'} (${look.packs[p].name})`;
  for (const [k, coat] of look.coats.entries()) {
    // A coat's marking colour shows only where its markings put it.
    const colours: [string, number][] = [['fur', coat.fur]];
    if (coat.markings !== 'none') colours.push(['marking', coat.marking]);
    for (const [part, colour] of colours) {
      const name = `coat ${k} (${coat.name}) ${part}`;
      for (const p of [0, 1] as const) pair(`${name} against ${packName(p)}`, colour, look.packs[p].colour, APART);
      pair(`${name} against the grass`, colour, look.pitch.grass, APART);
    }
  }
  pair(`${packName(0)} against ${packName(1)}`, look.packs[0].colour, look.packs[1].colour, PACKS_APART);
  const floors = halfFloors(look);
  for (const p of [0, 1] as const) {
    for (const h of [0, 1] as const) {
      const bands = floors[h];
      for (const [b, floor] of bands.entries()) {
        const where = bands.length > 1 ? `${packName(h)}'s half, band ${b + 1} of ${bands.length}` : `${packName(h)}'s half`;
        pair(`${packName(p)} against ${where}`, look.packs[p].colour, floor, APART);
      }
    }
  }
  const failures = checks.filter((c) => !(c.distance >= c.min));
  return { pass: failures.length === 0, checks, failures };
}
