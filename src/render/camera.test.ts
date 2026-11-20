import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { mix } from '../core/sim/math';
import { defaultParams } from '../core/sim/params';
import { buildPitch, CAPSULE, insideRegion, pitch, type Pitch, QUAD } from '../core/sim/pitch';
import {
  ceilingAt, fitSpectator, framedPoints, insidePitch, newPlaced, type Placed, placeCamera, project, spectatorCamera, subjectCone, viewUp,
} from './camera';
import { spectatorCentreLimit } from './camera-rig';
import type { CameraFrame, ViewMode } from './frame';

// The spectators' camera (PLAN D-28, L91): at any window shape (D-30), the
// whole empty pitch is in view, tightly and centred, from high above one
// side, outside the walls and above the net, whatever the pitch's shape
// (D-4).
const shapes: [string, Pitch][] = [
  ['the pitch', pitch],
  // D-4's second shape, as src/config.test.ts builds it.
  ['50 × 30 m, cut 6 and 3 m', buildPitch({ ...config.pitch, lengthMetres: 50, widthMetres: 30, cornerCutsMetres: [6, 3, 6, 3], mouthWidthMetres: 10 })],
  ['walls 30 m high', buildPitch({ ...config.pitch, heightMetres: 30 })],
];

describe("the spectators' camera", () => {
  for (const [name, p] of shapes) {
    it.each([0.3, 0.75, 1, 4 / 3, 16 / 9, 2.4, 5])(`frames ${name} at aspect %f`, (aspect) => {
      const camera = spectatorCamera();
      fitSpectator(camera, aspect, p);
      const ndc = framedPoints(p).map((q) => q.project(camera));
      const xs = ndc.map((q) => q.x);
      const ys = ndc.map((q) => q.y);
      // Inside the view, with its 5 % margin, and between the near and far planes.
      for (const q of ndc) {
        expect(Math.abs(q.x)).toBeLessThanOrEqual(0.95 + 1e-9);
        expect(Math.abs(q.y)).toBeLessThanOrEqual(0.95 + 1e-9);
        expect(Math.abs(q.z)).toBeLessThan(1);
      }
      // As near as it can be: on one axis, the pitch reaches the margin at both edges.
      const tight = (vs: number[]): boolean => Math.abs(Math.max(...vs) - 0.95) < 1e-6 && Math.abs(Math.min(...vs) + 0.95) < 1e-6;
      expect(tight(xs) || tight(ys), 'edge to edge on one axis').toBe(true);
      // On the −y side, outside the wall and above the net.
      expect(camera.position.y).toBeLessThan(-p.shape.widthMetres / 2);
      expect(camera.position.z).toBeGreaterThan(p.shape.heightMetres);
    });
  }

  it('looks straight across the middle of a pitch that is symmetric end to end', () => {
    const camera = spectatorCamera();
    fitSpectator(camera, 16 / 9, pitch);
    expect(camera.position.x).toBeCloseTo(0, 9);
    const xs = framedPoints(pitch).map((q) => q.project(camera).x);
    expect(Math.max(...xs) + Math.min(...xs)).toBeCloseTo(0, 9);
  });

  it("holds the floor plan, the walls' tops and both goals", () => {
    // 8 outline corners at the floor and at the walls' tops, and each goal's 4 floor corners and its top.
    expect(framedPoints(pitch)).toHaveLength(8 * 2 + 2 * 4 * 2);
  });
});

// --- M4: the players' and spectators' cameras (D-28, L89, L91; M4's design §1.9, §3.2, §3.3, §3.6) ---

const margin = config.cameraWallMarginMetres;
const r = defaultParams.terrierRadius;
const hx = pitch.goalLineX;
const hy = pitch.shape.widthMetres / 2;
const height = pitch.shape.heightMetres;
const PHONE = 915 / 355; // the phone held sideways, in CSS px (M4's design §1.60)
const ASPECTS = [16 / 9, PHONE, 0.75];

/** Each plane and quad the point lies across, as insidePitch reads them: its height over the face. */
function faceHeights(v: Vector3): { name: string; h: number }[] {
  const out: { name: string; h: number }[] = [];
  for (const q of pitch.pieces) {
    if (q.kind === CAPSULE) continue;
    const dx = v.x - q.ox;
    const dy = v.y - q.oy;
    const dz = v.z - q.oz;
    if (q.kind === QUAD) {
      const u = (dx * q.e1x + dy * q.e1y + dz * q.e1z) * q.inv1;
      const w = (dx * q.e2x + dy * q.e2y + dz * q.e2z) * q.inv2;
      if (u < 0 || u > 1 || w < 0 || w > 1) continue;
    }
    out.push({ name: q.name, h: dx * q.nx + dy * q.ny + dz * q.nz });
  }
  return out;
}

/** A camera as the stage sets it from a placement. */
function cameraFor(placed: Placed, aspect: number): PerspectiveCamera {
  const c = new PerspectiveCamera(placed.fovDegrees, aspect, placed.near, placed.far);
  c.position.copy(placed.position);
  c.up.copy(placed.up);
  c.lookAt(placed.lookAt);
  c.updateMatrixWorld();
  return c;
}

const player = (view: ViewMode, s: Vector3, yaw: number, target: Vector3): CameraFrame => ({
  mode: { kind: 'player', view, terrier: 't' }, yaw, target, subject: s,
});

describe('inside the pitch (L89, §3.2)', () => {
  it('moves any point inside the region the pieces bound, the goals included, by the margin from every face it lies across', () => {
    let seed = 1;
    const next = (): number => (seed = mix(seed, 7)) / 4294967296;
    for (let k = 0; k < 4000; k++) {
      const v = new Vector3(-26 + 52 * next(), -18 + 36 * next(), -1 + 9 * next());
      const from = v.clone();
      insidePitch(v, pitch, margin);
      const at = `from ${from.toArray().map((c) => c.toFixed(2)).join(', ')} to ${v.toArray().map((c) => c.toFixed(2)).join(', ')}`;
      expect(insideRegion(pitch.shape, v.x, v.y, v.z, 1e-9), at).toBe(true);
      for (const f of faceHeights(v)) expect(f.h, `${at}: ${f.name}`).toBeGreaterThanOrEqual(margin - 1e-9);
    }
  });

  it('leaves a point inside by the margin where it is, and brings one behind a wall, a goal or the net back to the margin', () => {
    const still = new Vector3(3, -2, 2);
    expect(insidePitch(still.clone(), pitch, margin)).toEqual(still);
    expect(insidePitch(new Vector3(0, -16, 2), pitch, margin).y).toBeCloseTo(-hy + margin, 12);
    expect(insidePitch(new Vector3(-21, 8, 2), pitch, margin).x).toBeCloseTo(-hx + margin, 12);
    // Behind a goal's back netting: back into the goal, not out onto the pitch (the spike's box clamp did that).
    const back = insidePitch(new Vector3(-23, 0, 1), pitch, margin);
    expect(back.x).toBeCloseTo(-hx - pitch.shape.goalDepthMetres + margin, 12);
    expect(insidePitch(new Vector3(0, 0, 7), pitch, margin).z).toBeCloseTo(height - margin, 12);
    expect(insidePitch(new Vector3(21, 0, 2.9), pitch, margin).z).toBeCloseTo(pitch.shape.mouthHeightMetres - margin, 12);
  });

  it('reads the ceiling as the net, or the goal\'s roof inside a goal, less the margin', () => {
    expect(ceilingAt(pitch, 0, 0, margin)).toBe(height - margin);
    expect(ceilingAt(pitch, -hx + 0.1, 0, margin)).toBe(height - margin);
    expect(ceilingAt(pitch, -hx - 1, 0, margin)).toBe(pitch.shape.mouthHeightMetres - margin);
    expect(ceilingAt(pitch, hx + 1, -3, margin)).toBe(pitch.shape.mouthHeightMetres - margin);
    expect(ceilingAt(pitch, hx + 1, hy - 1, margin)).toBe(height - margin);
  });
});

describe("a player's camera (D-28, §3.2)", () => {
  // A terrier with its back to each wall, in each cut corner, under the net and inside each goal, facing
  // away from what's behind it.
  const corner = (k: number): { s: Vector3; yaw: number } => {
    const sx = k === 0 || k === 3 ? -1 : 1;
    const sy = k < 2 ? -1 : 1;
    const cut = pitch.shape.cornerCutsMetres[k]!;
    const mid = new Vector3(sx * (hx - cut / 2), sy * (hy - cut / 2), r);
    const inward = new Vector3(-sx, -sy, 0).normalize();
    return { s: mid.addScaledVector(inward, r), yaw: Math.atan2(inward.y, inward.x) };
  };
  const cases: { name: string; s: Vector3; yaw: number }[] = [
    { name: 'its back to the −y side wall', s: new Vector3(5, -hy + r, r), yaw: Math.PI / 2 },
    { name: 'its back to the +y side wall', s: new Vector3(-5, hy - r, r), yaw: -Math.PI / 2 },
    { name: 'its back to the −x end wall', s: new Vector3(-hx + r, 7, r), yaw: 0 },
    { name: 'its back to the +x end wall', s: new Vector3(hx - r, -7, r), yaw: Math.PI },
    ...[0, 1, 2, 3].map((k) => ({ name: `in cut corner ${k}`, ...corner(k) })),
    { name: 'high under the net', s: new Vector3(2, 1, 4), yaw: 0.3 },
    { name: 'deep in pack A\'s goal, facing out', s: new Vector3(-hx - 2 + r + 0.05, 0, r), yaw: 0 },
    { name: 'deep in pack B\'s goal, facing out', s: new Vector3(hx + 2 - r - 0.05, 1, r), yaw: Math.PI },
    { name: 'in pack A\'s goal, its back to the side netting', s: new Vector3(-hx - 1, 4 - r, r), yaw: -Math.PI / 2 },
    { name: 'on the pitch, nothing behind it', s: new Vector3(0, 0, r), yaw: 0.5 },
  ];

  it('stays inside the pitch, under its ceiling, rising when nearer than cameraNearestMetres, with the terrier in view', () => {
    let raised = 0;
    for (const c of cases) {
      for (const view of ['ball', 'chase'] as const) {
        for (const aspect of ASPECTS) {
          const at = `${c.name}, ${view} view, aspect ${aspect.toFixed(2)}`;
          const ball = c.s.clone().add(new Vector3(Math.cos(c.yaw), Math.sin(c.yaw), 0).multiplyScalar(4));
          ball.z = defaultParams.ballRadius;
          const placed = placeCamera(player(view, c.s, c.yaw, ball), pitch, aspect, newPlaced());
          const p = placed.position;
          expect(insideRegion(pitch.shape, p.x, p.y, p.z, 1e-9), at).toBe(true);
          for (const f of faceHeights(p)) expect(f.h, `${at}: ${f.name}`).toBeGreaterThanOrEqual(margin - 1e-9);
          expect(p.z, at).toBeLessThanOrEqual(ceilingAt(pitch, p.x, p.y, margin) + 1e-9);
          const near = Math.hypot(p.x - c.s.x, p.y - c.s.y);
          expect(placed.raised, `${at}: ${near.toFixed(2)} m away`).toBe(near < config.cameraNearestMetres);
          if (placed.raised) raised++;
          const ndc = c.s.clone().project(cameraFor(placed, aspect));
          const front = c.s.clone().applyMatrix4(cameraFor(placed, aspect).matrixWorldInverse).z < 0;
          expect(front && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1, `${at}: the terrier at ${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)}`).toBe(true);
          expect(placed.fovDegrees).toBe(config.cameraFovDegrees);
        }
      }
    }
    expect(raised, 'some cases rose').toBeGreaterThan(20);
  });

  it('sits cameraBehindMetres behind the floor point along the yaw and cameraAboveMetres above it, on open grass', () => {
    const s = new Vector3(1, 2, r);
    const yaw = 0.7;
    const placed = placeCamera(player('chase', s, yaw, s), pitch, 16 / 9, newPlaced());
    const want = new Vector3(s.x - config.cameraBehindMetres * Math.cos(yaw), s.y - config.cameraBehindMetres * Math.sin(yaw), config.cameraAboveMetres);
    expect(placed.position.distanceTo(want)).toBeLessThan(1e-12);
    expect(placed.raised).toBe(false);
    // Chase view: the terrier low in the view, the look ahead of it along the yaw.
    const ndc = s.clone().project(cameraFor(placed, 16 / 9));
    expect(Math.abs(ndc.x)).toBeLessThan(1e-9);
    expect(ndc.y).toBeLessThan(-0.2);
    // Ball view aims at the ball, its terrier well in view.
    const ball = s.clone().add(new Vector3(Math.cos(yaw), Math.sin(yaw), 0).multiplyScalar(8));
    ball.z = defaultParams.ballRadius;
    const aimed = placeCamera(player('ball', s, yaw, ball), pitch, 16 / 9, newPlaced());
    const b = ball.clone().project(cameraFor(aimed, 16 / 9));
    expect(Math.hypot(b.x, b.y)).toBeLessThan(1e-9);
    // A ball high over it turns the aim to keep the terrier in view instead.
    const high = placeCamera(player('ball', s, yaw, s.clone().setZ(5)), pitch, 16 / 9, newPlaced());
    const t = s.clone().project(cameraFor(high, 16 / 9));
    expect(Math.abs(t.y)).toBeLessThan(1);
  });

  it('keeps the aim within 60° of the horizontal unless the terrier needs more to stay in view, and then no more', () => {
    // Every case: past 60°, the terrier sits right on the edge of the cone it's kept in, so the aim
    // turned no further than it had to.
    let steep = 0;
    for (const c of cases) {
      for (const aspect of ASPECTS) {
        // The ball just in front of the camera's foot, far below it when raised.
        const ball = c.s.clone().add(new Vector3(Math.cos(c.yaw), Math.sin(c.yaw), 0).multiplyScalar(1.2));
        ball.z = defaultParams.ballRadius;
        const placed = placeCamera(player('ball', c.s, c.yaw, ball), pitch, aspect, newPlaced());
        const look = placed.lookAt.clone().sub(placed.position).normalize();
        if (Math.abs(Math.asin(look.z)) <= (60 * Math.PI) / 180 + 1e-9) continue;
        steep++;
        const toTerrier = c.s.clone().sub(placed.position).normalize();
        expect(look.angleTo(toTerrier), `${c.name} at ${aspect.toFixed(2)}`).toBeCloseTo(subjectCone(aspect), 9);
      }
    }
    expect(steep, 'some looked down past 60°').toBeGreaterThan(5);
    const s = new Vector3(0, 0, r);
    // The ball high over the camera itself: the aim would be nearly straight up.
    const ball = new Vector3(-3.9, 0, 5.5);
    const placed = placeCamera(player('ball', s, 0, ball), pitch, 16 / 9, newPlaced());
    const look = placed.lookAt.clone().sub(placed.position).normalize();
    expect(Math.asin(look.z)).toBeLessThanOrEqual((60 * Math.PI) / 180 + 1e-9);
    // Raised over a terrier with its back to the wall, it looks down past 60° to keep it in view.
    const wall = new Vector3(5, -hy + r, r);
    const down = placeCamera(player('ball', wall, Math.PI / 2, new Vector3(5, 0, 0.8)), pitch, 16 / 9, newPlaced());
    expect(down.raised).toBe(true);
    expect(Math.asin(down.lookAt.clone().sub(down.position).normalize().z)).toBeLessThan((-60 * Math.PI) / 180);
    // And the view's up stays the yaw's way, so the pitch ahead is up the screen.
    expect(down.up.y).toBeGreaterThan(0);
  });
});

describe("the view's up (§3.2)", () => {
  it("is square to the aim, the aim's own up for a shallow look, and the yaw's way for a steep one, straight down included", () => {
    const yaw = Math.PI / 2;
    const shallow = new Vector3(0.3, 1, -0.4).normalize();
    const up = viewUp(shallow, yaw, new Vector3());
    expect(up.dot(shallow)).toBeCloseTo(0, 12);
    expect(up.z).toBeGreaterThan(0);
    for (const d of [new Vector3(0, 0, -1), new Vector3(0.05, 0.02, -1).normalize(), new Vector3(-0.05, -0.02, -1).normalize()]) {
      const u = viewUp(d, yaw, new Vector3());
      expect(u.length(), d.toArray().join()).toBeCloseTo(1, 12);
      expect(u.dot(d)).toBeCloseTo(0, 12);
      // Up the screen is up the pitch along the yaw, +y here, wherever the steep look leans.
      expect(u.y, d.toArray().join()).toBeGreaterThan(0.99);
    }
  });
});

describe("the spectators' camera (L91, §3.2)", () => {
  const limit = spectatorCentreLimit(pitch);
  const targets = [
    new Vector3(0, 0, 0.8), new Vector3(-18, -12, 0.8), new Vector3(18, 12, 0.8), new Vector3(0, hy - 1, 3),
    new Vector3(5, -hy + 1, 0.8), new Vector3(-hx - 1, 0, 0.8), new Vector3(hx + 1.5, 2, 2),
  ];

  it('stays outside the near wall and above the net, framing its window, the target in view', () => {
    for (const t of targets) {
      for (const aspect of [16 / 9, PHONE, 1, 0.5]) {
        const at = `following ${t.toArray().join(', ')} at aspect ${aspect.toFixed(2)}`;
        const placed = placeCamera({ mode: { kind: 'spectator', follow: null }, yaw: 0, target: t, subject: null }, pitch, aspect, newPlaced());
        expect(placed.position.y, at).toBeLessThanOrEqual(-hy - margin + 1e-9);
        expect(placed.position.z, at).toBeGreaterThanOrEqual(height + margin - 1e-9);
        // Its window on the pitch: the centre kept within reach of the goal lines.
        expect(placed.position.x, at).toBeCloseTo(Math.max(-limit, Math.min(limit, t.x)), 12);
        const camera = cameraFor(placed, aspect);
        const seen = t.clone().project(camera);
        expect(Math.abs(seen.x) <= 1 && Math.abs(seen.y) <= 1, at).toBe(true);
        for (const end of [-1, 1]) {
          const edge = new Vector3(placed.lookAt.x + (end * config.spectatorViewLengthMetres) / 2, placed.lookAt.y, placed.lookAt.z).project(camera);
          expect(Math.abs(edge.x), `${at}: the window's end`).toBeLessThanOrEqual(0.95 + 1e-9);
        }
        expect(placed.fovDegrees).toBe(40);
      }
    }
  });

  it("draws the overview as M1's fit", () => {
    const placed = placeCamera({ mode: { kind: 'overview' }, yaw: 0, target: new Vector3(), subject: null }, pitch, 16 / 9, newPlaced());
    const camera = spectatorCamera();
    fitSpectator(camera, 16 / 9, pitch);
    expect(placed.position.distanceTo(camera.position)).toBeLessThan(1e-12);
    expect([placed.near, placed.far, placed.fovDegrees]).toEqual([camera.near, camera.far, camera.fov]);
  });
});

describe('the off-screen arrow (D-28, §3.3)', () => {
  const s = new Vector3(0, 0, r);
  const placed = placeCamera(player('chase', s, 0, s), pitch, 16 / 9, newPlaced());
  const camera = cameraFor(placed, 16 / 9);
  camera.updateProjectionMatrix();
  const W = 640;
  const H = 360;

  it("points to a ball behind the camera, round the way it lies, and down when it's straight behind", () => {
    // Behind the camera, which is 4.2 m behind the terrier, and to the left: +y faces left along +x.
    const left = project(camera, -6, 3, 0.8, W, H);
    expect(left.inView).toBe(false);
    expect(Math.cos(left.angle)).toBeLessThan(0);
    expect(left.angle).toBeGreaterThan(Math.PI / 2 - 0.3);
    const right = project(camera, -6, -3, 0.8, W, H);
    expect(Math.cos(right.angle)).toBeGreaterThan(0);
    const behind = project(camera, -9, 0, placed.position.z, W, H);
    expect(behind.inView).toBe(false);
    expect(behind.angle).toBeCloseTo(Math.PI / 2, 1);
    // On the canvas's edge.
    for (const q of [left, right, behind]) {
      expect(Math.abs(q.x - W / 2) >= W / 2 - 1e-9 || Math.abs(q.y - H / 2) >= H / 2 - 1e-9).toBe(true);
    }
  });

  it('shows a ball in front as in view where it projects, and one off to the side as out of view, pointing to it', () => {
    const ahead = project(camera, 4, 0, 0.8, W, H);
    expect(ahead.inView).toBe(true);
    expect(ahead.x).toBeCloseTo(W / 2, 6);
    expect(ahead.y > 0 && ahead.y < H).toBe(true);
    const side = project(camera, 2, -14, 0.8, W, H);
    expect(side.inView).toBe(false);
    expect(Math.abs(side.angle)).toBeLessThan(Math.PI / 4);
  });
});
