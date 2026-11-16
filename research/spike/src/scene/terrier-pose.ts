// The code-built terrier's shape and procedural pose (PLAN D-27, §12).
// Everything here is in the terrier's own frame: +x along its heading, +y to
// its left, +z up, with the origin on the floor under its collider's centre
// (0.25 m up when standing, D-4). It fits the 0.6 x 0.5 x 0.5 m box around
// the collider (L310). The pose comes from the view alone: the phase, the
// seconds since it started, the gait and the speed, so a re-simulated state
// redraws the same pose (L345).

import { Matrix4, Vector3 } from 'three';
import type { TerrierPose } from './interpolate';

export const COLLIDER_R = 0.25;

/** Where each part's pivot sits, and its size. */
export const SHAPE = {
  body: { centre: new Vector3(-0.03, 0, 0.215), radii: new Vector3(0.19, 0.115, 0.095) },
  neck: new Vector3(0.1, 0, 0.31),
  /** Relative to the neck pivot. */
  head: { centre: new Vector3(0.05, 0, 0.05), radius: 0.105 },
  snout: { centre: new Vector3(0.135, 0, 0.02), radii: new Vector3(0.05, 0.05, 0.042) },
  eyes: { centre: new Vector3(0.135, 0.045, 0.075), radius: 0.018 },
  nose: { centre: new Vector3(0.182, 0, 0.035), radius: 0.02 },
  ear: { pivot: new Vector3(0.03, 0.06, 0.11), radius: 0.036, height: 0.08 },
  /** Relative to the body's origin, the terrier's floor point. */
  legs: { radius: 0.036, length: 0.18, front: 0.1, back: -0.13, side: 0.065, top: 0.18 },
  tail: { pivot: new Vector3(-0.19, 0, 0.255), radius: 0.022, length: 0.114 },
  bandana: { centre: new Vector3(0.075, 0, 0.29), radius: 0.078, tube: 0.024, tilt: 0.89 },
} as const;

/** One terrier's part transforms in world space, in a fixed order. */
export interface PartMatrices {
  body: Matrix4;
  head: Matrix4;
  ears: [Matrix4, Matrix4];
  /** Front left, front right, back left, back right. */
  legs: [Matrix4, Matrix4, Matrix4, Matrix4];
  tail: Matrix4;
  bandana: Matrix4;
}

export function newPartMatrices(): PartMatrices {
  return {
    body: new Matrix4(), head: new Matrix4(),
    ears: [new Matrix4(), new Matrix4()],
    legs: [new Matrix4(), new Matrix4(), new Matrix4(), new Matrix4()],
    tail: new Matrix4(), bandana: new Matrix4(),
  };
}

/** The pose's free parameters, all zero when standing still. */
export interface PoseParams {
  bob: number;
  /** About the body's lateral axis; negative lifts the nose. */
  pitch: number;
  pitchPivotX: number;
  pitchPivotZ: number;
  /** About the heading, at the body's centre. */
  roll: number;
  stretch: number;
  headPitch: number;
  headYaw: number;
  neckBack: number;
  neckDown: number;
  earPitch: number;
  earSplay: number;
  legs: [number, number, number, number];
  tailYaw: number;
  tailPitch: number;
}

const TAU = 2 * Math.PI;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const ease = (x: number): number => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/** How long after a ball contact a terrier still draws its pushing pose, in ticks. */
export const PUSH_TICKS = 8;

/**
 * The pose for a phase at `t` seconds into it. `time` is the drawn time in
 * ticks, used only for the pushing overlay, which lowers and draws back the
 * head so it stays out of the ball while they touch (D-27's fit).
 */
export function poseParams(p: TerrierPose, t: number, time: number): PoseParams {
  const speed = Math.hypot(p.vx, p.vy);
  const g = p.gait * TAU;
  const q: PoseParams = {
    bob: 0, pitch: 0, pitchPivotX: SHAPE.body.centre.x, pitchPivotZ: SHAPE.body.centre.z, roll: 0, stretch: 1,
    headPitch: 0, headYaw: 0, neckBack: 0, neckDown: 0, earPitch: 0, earSplay: 0.35,
    legs: [0, 0, 0, 0], tailYaw: 0, tailPitch: -0.6,
  };
  const trot = (amp: number): void => {
    const s = amp * Math.sin(g);
    q.legs = [s, -s, -s, s];
  };
  switch (p.phase) {
    case 'standing': {
      q.bob = 0.004 * Math.sin((TAU * t) / 1.6);
      q.headPitch = 0.05 * Math.sin((TAU * t) / 3.1);
      q.headYaw = 0.25 * Math.sin((TAU * t) / 5.3);
      q.tailYaw = 0.5 * Math.sin(TAU * t * 2.2);
      break;
    }
    case 'running': {
      const k = Math.min(1, speed / 6);
      trot(0.55 * k);
      q.bob = 0.02 * k * Math.abs(Math.sin(g));
      q.pitch = 0.04 * Math.sin(2 * g);
      q.headPitch = -0.05 * Math.sin(2 * g);
      q.tailYaw = 0.35 * Math.sin(g);
      q.earPitch = -0.2 * k;
      break;
    }
    case 'zooming': {
      trot(0.85);
      q.bob = 0.03 * Math.abs(Math.sin(g));
      q.pitch = 0.08;
      q.stretch = 1.05;
      q.earPitch = -0.6;
      q.tailPitch = -1.2;
      break;
    }
    case 'airborne': {
      const up = Math.max(-1, Math.min(1, p.vz / 4.43));
      q.pitch = -0.35 * up;
      q.legs = [-0.7, -0.7, 0.7, 0.7];
      q.earPitch = -0.3;
      q.tailPitch = -0.3;
      break;
    }
    case 'lunging': {
      q.pitch = 0.1;
      q.stretch = 1.08;
      q.legs = [-1.1, -1.1, 1.0, 1.0];
      q.headPitch = 0.15;
      q.earPitch = -0.7;
      q.tailPitch = -1.3;
      break;
    }
    case 'tumbled': {
      // Over and over once, then on its side (PLAN §12: rolls over).
      const roll = t < 0.6 ? (t / 0.6) * (TAU + Math.PI / 2) : Math.PI / 2;
      q.roll = roll;
      q.bob = -0.085 * Math.abs(Math.sin(roll));
      const kick = 0.4 * Math.sin(TAU * t * 3);
      q.legs = [kick, -kick, -kick, kick];
      q.earSplay = 0.9;
      break;
    }
    case 'gettingUp': {
      // Back on its feet in 0.25 s, then shakes itself off.
      if (t < 0.25) {
        q.roll = (Math.PI / 2) * (1 - ease(t / 0.25));
        q.bob = -0.085 * Math.abs(Math.sin(q.roll));
      } else {
        const fade = 1 - clamp01((t - 0.25) / 0.25);
        q.roll = 0.25 * fade * Math.sin(TAU * 7 * (t - 0.25));
        q.headYaw = 0.5 * fade * Math.sin(TAU * 7 * (t - 0.25) + 1);
        q.earSplay = 0.35 + 0.6 * fade * Math.abs(Math.sin(TAU * 7 * (t - 0.25)));
      }
      break;
    }
    case 'sitting': {
      const s = ease(t / 0.25);
      q.pitch = -0.55 * s;
      q.pitchPivotX = -0.13;
      q.pitchPivotZ = 0.16;
      q.bob = -0.06 * s;
      q.legs = [0.55 * s, 0.55 * s, -1.3 * s, -1.3 * s];
      q.headPitch = 0.45 * s;
      q.tailPitch = -1.45;
      q.tailYaw = 0.3 * Math.sin(TAU * t * 1.2);
      break;
    }
  }
  // The pushing overlay (§12: pushing), over the phases that can push.
  const pushing = time - p.lastBallContactTick;
  if (p.lastBallContactTick >= 0 && pushing >= 0 && pushing <= PUSH_TICKS && p.phase !== 'tumbled' && p.phase !== 'gettingUp' && p.phase !== 'sitting') {
    // The body straightens and stops bouncing, so no lean, stretch or bob
    // carries the head forward or up.
    q.pitch = Math.min(q.pitch, 0);
    q.stretch = 1;
    q.bob = Math.min(q.bob, 0.01);
    q.headPitch = 0.4;
    q.headYaw = 0;
    q.neckBack = 0.03;
    q.neckDown = 0.04;
    q.earPitch = Math.min(q.earPitch, -0.3);
  }
  return q;
}

const m1 = new Matrix4();
const m2 = new Matrix4();
const body = new Matrix4();
const head = new Matrix4();

function at(out: Matrix4, parent: Matrix4, x: number, y: number, z: number): Matrix4 {
  return out.multiplyMatrices(parent, m1.makeTranslation(x, y, z));
}

/**
 * Writes each part's world matrix for a pose. `root` is the terrier's floor
 * point and heading in world space; pass the identity to get the terrier's
 * own frame.
 */
export function poseParts(root: Matrix4, q: PoseParams, out: PartMatrices): void {
  // The body: bob, then pitch about its pivot, roll about the heading at its
  // centre, stretched along the heading.
  const c = SHAPE.body.centre;
  body.copy(root).multiply(m1.makeTranslation(0, 0, q.bob));
  body.multiply(m1.makeTranslation(q.pitchPivotX, 0, q.pitchPivotZ)).multiply(m1.makeRotationY(q.pitch)).multiply(m1.makeTranslation(-q.pitchPivotX, 0, -q.pitchPivotZ));
  body.multiply(m1.makeTranslation(c.x, 0, c.z)).multiply(m1.makeRotationX(q.roll)).multiply(m1.makeTranslation(-c.x, 0, -c.z));
  out.body.copy(body).multiply(m1.makeTranslation(c.x, 0, c.z)).multiply(m2.makeScale(q.stretch, 1, 1));

  // The head, about the neck pivot; the snout and face share its matrix.
  const n = SHAPE.neck;
  at(head, body, n.x - q.neckBack, 0, n.z - q.neckDown).multiply(m1.makeRotationZ(q.headYaw)).multiply(m2.makeRotationY(q.headPitch));
  out.head.copy(head);

  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? 1 : -1;
    const e = SHAPE.ear.pivot;
    at(out.ears[k]!, head, e.x, side * e.y, e.z).multiply(m1.makeRotationX(-side * q.earSplay)).multiply(m2.makeRotationY(q.earPitch));
  }

  const L = SHAPE.legs;
  const hips: [number, number][] = [[L.front, L.side], [L.front, -L.side], [L.back, L.side], [L.back, -L.side]];
  for (let k = 0; k < 4; k++) {
    const [x, y] = hips[k]!;
    at(out.legs[k]!, body, x, y, L.top).multiply(m1.makeRotationY(q.legs[k]!));
  }

  const tp = SHAPE.tail.pivot;
  at(out.tail, body, tp.x, 0, tp.z).multiply(m1.makeRotationZ(q.tailYaw)).multiply(m2.makeRotationY(q.tailPitch));

  const b = SHAPE.bandana;
  at(out.bandana, body, b.centre.x, 0, b.centre.z).multiply(m1.makeRotationY(b.tilt));
}

/** The terrier's floor point and heading as a world matrix. */
export function rootMatrix(out: Matrix4, p: TerrierPose): Matrix4 {
  return out.makeRotationZ(p.heading).setPosition(p.x, p.y, p.z - COLLIDER_R);
}
