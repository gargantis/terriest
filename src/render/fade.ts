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

import { Vector3, type Box3, type Material, type Sphere } from 'three';

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
