// The occluders' screen-door fade (M4's design, research/m4/DESIGN.md,
// §1.17, §2.6, M4-Q11; PLAN §12, D-28, L89), as PLAN §12's swap: each
// occluder's material is made in two variants, the opaque one and a
// dithered clone whose shader hook discards fragments in a 4 × 4 ordered
// dither inside the capsule round the line from the camera to the subject.
// Both are opaque materials, both compile at prepare, and an occluder draws
// with its dithered variant only in the frames its bounds cross the
// capsule, so no other frame runs a shader that can discard.
//
// Phase 1's stub, by the stage builder, with the final signatures: the
// material as both variants, the capsule recorded but never crossed, and
// the capsule's test in TypeScript. Phase 3's effects builder fills it;
// src/render/pitch.ts and ball.ts already make their materials through
// fadeVariants and swap by crossesFade, so neither changes then.
//
// From C-57, the line fade: the parts drawn among the transparent things,
// the glass walls (src/render/glass.ts) and the goals' frames and netting
// (goal-fade.ts), give way round the capsule's line by their alpha, not by
// the dither: clear within LINE_CLEAR_METRES[0] of the line and all there
// by [1], and only between the camera and its subject, so a wall behind a
// player's terrier keeps its band and posts: all there again from the
// subject's centre to LINE_BEYOND_METRES past it. Their materials share one
// set of uniforms, lineFadeUniforms(), which updateLineFade copies from
// this frame's capsule. The goals' frames stay an occluder too, their
// material no longer opaque: lit, drawn among the transparent things and
// writing depth, with a shader hook and a program key of its own
// (goal-fade.ts), both of which phase 3's dithered clone of it must keep.
// Its hook discards a fragment its fades have all but cleared, so a post
// faded out writes no depth. So the frames' undithered variant can discard
// in any frame, which the rule above keeps from the opaque occluders, but
// it's drawn after the opaque pass, whose early depth tests it doesn't
// touch, and covers little of the view.

import { type Box3, type IUniform, type Material, type Sphere, Vector2, Vector3 } from 'three';

/** An occluder material's two variants, made with it. */
export interface Faded<M extends Material> {
  readonly opaque: M;
  readonly dithered: M;
}

/** Phase 1: the material itself as both variants. */
export function fadeVariants<M extends Material>(m: M): Faded<M> {
  return { opaque: m, dithered: m };
}

/** This frame's capsule, copied from setFade's arguments. */
const capsule = { on: false, from: new Vector3(), to: new Vector3(), radius: 0 };

/** Each frame, before the render: the capsule's ends and radius; a null end, nothing fades. */
export function setFade(from: Vector3 | null, to: Vector3 | null, radius: number): void {
  capsule.on = from !== null && to !== null && radius > 0;
  if (from !== null) capsule.from.copy(from);
  if (to !== null) capsule.to.copy(to);
  capsule.radius = radius;
}

/** Whether an occluder's bounds cross the capsule this frame: it draws with its dithered variant only
 *  then. Phase 1: never. */
export function crossesFade(_bounds: Box3 | Sphere): boolean {
  return false;
}

// --- The line fade (C-57) ---

/** Round the capsule's line, clear inside the first distance and all there by the second. */
const LINE_CLEAR_METRES: readonly [number, number] = [0.5, 1.0];
/** Past the subject's centre, all there again by this far along the line. */
const LINE_BEYOND_METRES = 0.35;

/** The line fade's uniforms: one set for every material that fades round the line. */
export type LineFade = {
  readonly lineFadeOn: IUniform<number>;
  readonly lineFadeFrom: IUniform<Vector3>;
  readonly lineFadeTo: IUniform<Vector3>;
  readonly lineFadeRadii: IUniform<Vector2>;
  readonly lineFadeBeyond: IUniform<number>;
};

export function lineFadeUniforms(): LineFade {
  return {
    lineFadeOn: { value: 0 },
    lineFadeFrom: { value: new Vector3() },
    lineFadeTo: { value: new Vector3() },
    lineFadeRadii: { value: new Vector2(LINE_CLEAR_METRES[0], LINE_CLEAR_METRES[1]) },
    lineFadeBeyond: { value: LINE_BEYOND_METRES },
  };
}

/** Each frame, after setFade: the line fade's uniforms from this frame's capsule; off with it. */
export function updateLineFade(u: LineFade): void {
  u.lineFadeOn.value = capsule.on ? 1 : 0;
  u.lineFadeFrom.value.copy(capsule.from);
  u.lineFadeTo.value.copy(capsule.to);
}

/** The line fade in GLSL ES 3.0, for a material's fragment shader: lineFade(p), how much of a point at p shows. */
export const LINE_FADE_GLSL = `
uniform float lineFadeOn;
uniform vec3 lineFadeFrom;
uniform vec3 lineFadeTo;
uniform vec2 lineFadeRadii;
uniform float lineFadeBeyond;
float lineFade(vec3 p) {
  vec3 line = lineFadeTo - lineFadeFrom;
  float length2 = max(dot(line, line), 1e-6);
  float t = dot(p - lineFadeFrom, line) / length2;
  float off = length(p - (lineFadeFrom + clamp(t, 0.0, 1.0) * line));
  // Only between the camera and the subject: from the subject's centre to lineFadeBeyond past it, all there again.
  float past = (t - 1.0) * sqrt(length2);
  float zone = 1.0 - smoothstep(0.0, lineFadeBeyond, past);
  return mix(1.0, smoothstep(lineFadeRadii.x, lineFadeRadii.y, off), lineFadeOn * zone);
}
`;

// --- The capsule's test ---

const along = new Vector3();
const offset = new Vector3();

/** The capsule's test, as the dithered variant's shader makes it: p within `radius` of the segment from
 *  `from` to `to`. */
export function fadesAt(p: Vector3, from: Vector3, to: Vector3, radius: number): boolean {
  along.subVectors(to, from);
  offset.subVectors(p, from);
  const length2 = along.lengthSq();
  const t = length2 > 0 ? Math.min(1, Math.max(0, offset.dot(along) / length2)) : 0;
  return offset.addScaledVector(along, -t).lengthSq() <= radius * radius;
}
