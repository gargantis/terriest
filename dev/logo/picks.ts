// The four pictures the owner picked on 2026-11-22, the comparison's
// recommended set (PLAN's status), as the page draws them (dev/logo.html):
// - F1, the tab icon: the head-on face, standing at rest, its body hidden so
//   the bandana reads as a scarf, outlined in ink for a light tab and in the
//   page's light text colour for a dark one; its 16 px framed 1.14 times
//   closer about the top, so the head is larger and the scarf shows 4 rows,
//   with the eyes 1 × 2 px and the nose 2 × 2 px of pure ink;
// - L1, the logo: the same dog trotting at half the run speed, mid-stride,
//   turning so its head faces the camera, the legs taking no shadow from the
//   body, on the game's blob shadow at 0.3, faded out before the edges;
// - W1, the lock-up's mark: the same pose without the blob, beside the name;
// - T1, the phone's icon: the face on a full-bleed square of the look's
//   grass, over a soft contact shadow.
// Each is coat 6, cream with brown ears in the placeholder look, in pack
// A's bandana, under a warm key nearer the camera, a warm fill and a lifted
// ground. Catchlights from 180 px up, matte below, where a highlight's pixel
// would eat a 1 px eye.

import { config } from '../../src/config';
import { RUNNING, STANDING } from '../../src/core/sim/state';
import { FACE_DARK } from '../../src/render/drawers/code';
import { PLACEHOLDER_LOOK } from '../../src/render/look';
import type { PortraitLights, PortraitPart, PortraitShot } from '../../src/render/portrait';
import type { LockupSpec } from './lockup';
import type { PostOp } from './post';

/** index.html's background and text colours. */
export const PAGE_DARK = 0x1d2b1f;
export const PAGE_LIGHT = 0xeef3ea;

const HEAD: readonly PortraitPart[] = ['head', 'snout', 'jaw', 'face', 'ears', 'bandana'];
const ALL: readonly PortraitPart[] = ['body', 'head', 'snout', 'jaw', 'face', 'ears', 'legs', 'tail', 'bandana'];
const NO_BODY = ['terrier-body', 'terrier-legs', 'terrier-tail'];

const WARM: PortraitLights = {
  key: { az: -25, el: 42, i: 2.4, colour: 0xfff1e0 },
  fill: { az: 65, el: 12, i: 1.1, colour: 0xfff4e6 },
  rim: { az: 160, el: 38, i: 2.2, colour: 0xffffff },
  hemi: { sky: 0xffffff, ground: 0xd8c8b0, i: 0.9 },
  ambient: 0.15,
};

/** The turn rate in radians a tick, against which pose.ts reads a turn. */
const turnPerTick = (2 * Math.PI * config.turnRateTurnsPerSecond) / config.ticksPerSecond;

const HEAD_ON = {
  coat: 6, pack: 0, light: WARM, pose: { time: 0, layers: [{ anim: STANDING, start: 0, weight: 1 }] },
  view: { az: 0, el: 6, dist: 4, fovDeg: 12 }, hide: NO_BODY, master: 2048, ss: 2,
} as const satisfies Omit<PortraitShot, 'frame'>;

const TROTTING = {
  coat: 6, pack: 0, light: WARM, noReceive: ['terrier-legs'], catchlight: true,
  // Turning right at 0.8 of the turn rate turns the head 0.24 rad towards a camera on the terrier's right.
  pose: { time: 300, layers: [{ anim: RUNNING, start: 200, weight: 1 }], vx: 0.5 * config.runSpeedMetresPerSecond, gait: 0.25, headingChange: -0.8 * turnPerTick },
  view: { az: -40, el: 14, dist: 2.6, fovDeg: 22 }, master: 2048, ss: 2,
} as const satisfies Omit<PortraitShot, 'frame'>;

const line = (px: number): PostOp => ({ op: 'outline', px, colour: FACE_DARK, opacity: 0.92 });
const darkLine = (px: number): PostOp => ({ op: 'outline', px, colour: PAGE_LIGHT, opacity: 0.6 });
const HINT: PostOp = { op: 'hint', eye: [1, 2], nose: [2, 2], colour: FACE_DARK };

export interface Output { readonly name: string; readonly size: number; readonly post: readonly PostOp[] }
export interface Shot { readonly scene: PortraitShot; readonly outputs: readonly Output[] }

export const SHOTS: readonly Shot[] = [
  {
    scene: { ...HEAD_ON, frame: { parts: HEAD, pad: 0.015 } },
    outputs: [
      { name: 'fav48', size: 48, post: [line(1.25)] },
      { name: 'fav32', size: 32, post: [line(1.25)] },
      { name: 'fav32Dark', size: 32, post: [darkLine(1.25)] },
    ],
  },
  {
    scene: { ...HEAD_ON, hide: [...NO_BODY, 'terrier-face'], frame: { parts: HEAD, pad: 0.015, zoomTop: 1.14 } },
    outputs: [{ name: 'fav16', size: 16, post: [line(1), HINT] }],
  },
  {
    scene: { ...TROTTING, blob: { opacity: 0.3, fade: { left: 0.08, right: 0.08, bottom: 0.1 } }, frame: { parts: ALL, pad: 0.02, grow: [0, 0, 0.04, 0] } },
    outputs: [{ name: 'logo', size: 1024, post: [] }],
  },
  { scene: { ...TROTTING, frame: { parts: ALL, pad: 0.01 } }, outputs: [{ name: 'lockupMark', size: 400, post: [] }] },
  {
    scene: { ...HEAD_ON, catchlight: true, frame: { parts: HEAD, pad: 0.005 } },
    outputs: [{
      name: 'apple', size: 180,
      post: [{ op: 'badge', colour: PLACEHOLDER_LOOK.pitch.grass, scale: 0.8, square: true, shadow: { blur: 0.025, dy: 0.02, opacity: 0.35, colour: PAGE_DARK } }],
    }],
  },
];

/** The lock-ups: lockupMark beside the name, its nearest foot on the baseline; dark text for light grounds, and
 *  light text for dark ones. */
export const LOCKUP_MARK = 'lockupMark';
export const LOCKUP: Omit<LockupSpec, 'mark' | 'feet' | 'box' | 'colour'> = {
  text: 'terriest', family: 'DejaVu Sans', weight: 700, fontPx: 190, round: 0.04, gap: 30, margin: 18,
};
export const LOCKUPS: readonly { readonly name: string; readonly colour: number }[] = [
  { name: 'lockupLight', colour: PAGE_DARK },
  { name: 'lockupDark', colour: PAGE_LIGHT },
];
