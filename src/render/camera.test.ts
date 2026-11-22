import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { mix } from '../core/sim/math';
import { defaultParams } from '../core/sim/params';
import { buildPitch, insideFloorPlan, insideRegion, pitch, type Pitch } from '../core/sim/pitch';
import { fitSpectator, framedPoints, newPlaced, type Placed, placeCamera, project, spectatorCamera, subjectCone, viewUp } from './camera';
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

  it('draws at least as far past the centre spot as the other cameras draw, at any window shape, so the ground outside the walls fades first (C-57)', () => {
    for (const aspect of [0.3, 0.45, 1, 16 / 9, 4]) {
      const camera = spectatorCamera();
      fitSpectator(camera, aspect, pitch);
      const w = camera.getWorldDirection(new Vector3());
      expect(camera.far - new Vector3().sub(camera.position).dot(w), `aspect ${aspect}`).toBeGreaterThanOrEqual(newPlaced().far - 1e-9);
    }
  });

  it("holds the floor plan, the walls' tops and both goals", () => {
    // 8 outline corners at the floor and at the walls' tops, and each goal's 4 floor corners and its top.
    expect(framedPoints(pitch)).toHaveLength(8 * 2 + 2 * 4 * 2);
  });
});

// --- M4: the players' and spectators' cameras (D-28, L89, L91, C-57; M4's design §1.9, §3.2, §3.3, §3.6) ---

const margin = config.cameraWallMarginMetres;
const behind = config.cameraBehindMetres;
const above = config.cameraAboveMetres;
const r = defaultParams.terrierRadius;
const hx = pitch.goalLineX;
const hy = pitch.shape.widthMetres / 2;
const height = pitch.shape.heightMetres;
const depth = pitch.shape.goalDepthMetres;
const mouth = pitch.shape.mouthWidthMetres / 2;
const PHONE = 915 / 355; // the phone held sideways, in CSS px (M4's design §1.60)
const ASPECTS = [16 / 9, PHONE, 0.75];
/** A canvas's CSS height for the projections, its width by the aspect: the gate's. */
const CSS_H = 360;

/** Where a point falls: on the pitch, inside the walls and cut corners and in front of both goal lines; in a
 *  goal, inside its box behind its line; or outside, beyond the walls or behind a goal's back, sides or roof. */
type Where = 'pitch' | 'goal' | 'outside';
const whereIs = (v: Vector3): Where =>
  insideFloorPlan(pitch.shape, v.x, v.y) ? 'pitch' : insideRegion(pitch.shape, v.x, v.y, v.z, 0) ? 'goal' : 'outside';

/** A camera as the stage sets it from a placement. */
function cameraFor(placed: Placed, aspect: number): PerspectiveCamera {
  const c = new PerspectiveCamera(placed.fovDegrees, aspect, placed.near, placed.far);
  c.position.copy(placed.position);
  c.up.copy(placed.up);
  c.lookAt(placed.lookAt);
  c.updateMatrixWorld();
  return c;
}

/** Whether a point shows in the placement's view at the aspect, as the overlay reads it: in front of the
 *  camera and inside 95% of the half-width and half-height (project's inView). */
const shows = (placed: Placed, aspect: number, q: Vector3): boolean => project(cameraFor(placed, aspect), q.x, q.y, q.z, CSS_H * aspect, CSS_H).inView;

const player = (view: ViewMode, s: Vector3, yaw: number, target: Vector3): CameraFrame => ({
  mode: { kind: 'player', view, terrier: 't' }, yaw, target, subject: s,
});

/** The camera's place for a terrier at s and the yaw, by E's rules (C-57): cameraBehindMetres behind its
 *  floor point along the yaw and cameraAboveMetres above it, held only to the margin above the ground and
 *  under the net. */
const placeOf = (s: Vector3, yaw: number): Vector3 =>
  new Vector3(s.x - behind * Math.cos(yaw), s.y - behind * Math.sin(yaw), Math.max(margin, Math.min(height - margin, s.z - r + above)));

describe("a player's camera (D-28, L89, C-57, §3.2)", () => {
  // A terrier with its back to each side wall, each end wall beside the mouth, each cut corner, out in front
  // of each goal and inside each, facing away from what's behind it, on its feet; and where its camera falls.
  const corner = (k: number): { s: Vector3; yaw: number } => {
    const sx = k === 0 || k === 3 ? -1 : 1;
    const sy = k < 2 ? -1 : 1;
    const cut = pitch.shape.cornerCutsMetres[k]!;
    const mid = new Vector3(sx * (hx - cut / 2), sy * (hy - cut / 2), r);
    const inward = new Vector3(-sx, -sy, 0).normalize();
    return { s: mid.addScaledVector(inward, r), yaw: Math.atan2(inward.y, inward.x) };
  };
  const cases: { name: string; s: Vector3; yaw: number; camera: Where }[] = [
    { name: 'its back to the −y side wall', s: new Vector3(5, -hy + r, r), yaw: Math.PI / 2, camera: 'outside' },
    { name: 'its back to the +y side wall', s: new Vector3(-5, hy - r, r), yaw: -Math.PI / 2, camera: 'outside' },
    { name: 'its back to the −x end wall, beside the mouth', s: new Vector3(-hx + r, 7, r), yaw: 0, camera: 'outside' },
    { name: 'its back to the +x end wall, beside the mouth', s: new Vector3(hx - r, -7, r), yaw: Math.PI, camera: 'outside' },
    ...[0, 1, 2, 3].map((k) => ({ name: `its back to cut corner ${k}`, ...corner(k), camera: 'outside' as const })),
    { name: "3 m out from pack A's goal line, facing out", s: new Vector3(-hx + 3, 1, r), yaw: 0, camera: 'goal' },
    { name: "3 m out from pack B's goal line, facing out", s: new Vector3(hx - 3, -1, r), yaw: Math.PI, camera: 'goal' },
    { name: "deep in pack A's goal, facing out", s: new Vector3(-hx - depth + r + 0.05, 0, r), yaw: 0, camera: 'outside' },
    { name: "deep in pack B's goal, facing out", s: new Vector3(hx + depth - r - 0.05, 1, r), yaw: Math.PI, camera: 'outside' },
    { name: "in pack A's goal, its back to the side netting", s: new Vector3(-hx - 1, mouth - r, r), yaw: -Math.PI / 2, camera: 'outside' },
    { name: "in pack B's goal, its back to the side netting", s: new Vector3(hx + 1, r - mouth, r), yaw: Math.PI / 2, camera: 'outside' },
    { name: 'on the pitch, nothing behind it', s: new Vector3(0, 0, r), yaw: 0.5, camera: 'pitch' },
  ];

  it('keeps its place behind the terrier, outside the walls and in or behind a goal where that falls, never risen, the terrier and the ball in view', () => {
    for (const c of cases) {
      for (const view of ['ball', 'chase'] as const) {
        for (const aspect of ASPECTS) {
          const at = `${c.name}, ${view} view, aspect ${aspect.toFixed(2)}`;
          const ball = c.s.clone().add(new Vector3(Math.cos(c.yaw), Math.sin(c.yaw), 0).multiplyScalar(4));
          ball.z = defaultParams.ballRadius;
          const placed = placeCamera(player(view, c.s, c.yaw, ball), pitch, aspect, newPlaced());
          const p = placed.position;
          // Its place exactly, cameraAboveMetres over the floor point: no clamp has moved it in or up.
          expect(p.distanceTo(placeOf(c.s, c.yaw)), `${at}: at ${p.toArray().map((x) => x.toFixed(2)).join(', ')}`).toBeLessThan(1e-12);
          expect(p.z, at).toBe(c.s.z - r + above);
          expect(whereIs(p), at).toBe(c.camera);
          expect(shows(placed, aspect, c.s), `${at}: the terrier in view`).toBe(true);
          expect(shows(placed, aspect, ball), `${at}: the ball in view`).toBe(true);
          if (view === 'ball') {
            // Aimed at the ball: the terrier is inside its cone, so the aim never turned.
            const b = project(cameraFor(placed, aspect), ball.x, ball.y, ball.z, CSS_H * aspect, CSS_H);
            expect(Math.hypot(b.x - (CSS_H * aspect) / 2, b.y - CSS_H / 2), at).toBeLessThan(1e-6);
          }
          expect(placed.fovDegrees).toBe(config.cameraFovDegrees);
        }
      }
    }
  });

  it('sits anywhere a terrier stands at its place, by the yaw alone, its terrier in view', () => {
    // Terriers anywhere in the pitch's region, the goals included, on the floor or off it, at any yaw.
    let seed = 1;
    const next = (): number => (seed = mix(seed, 7)) / 4294967296;
    let outside = 0;
    for (let k = 0; k < 4000; k++) {
      const s = new Vector3(-hx - depth + (2 * (hx + depth)) * next(), -hy + 2 * hy * next(), r + 3 * next());
      if (!insideRegion(pitch.shape, s.x, s.y, s.z, -r)) continue;
      const yaw = 2 * Math.PI * next();
      const view = next() < 0.5 ? 'ball' : 'chase';
      const placed = placeCamera(player(view, s, yaw, new Vector3(0, 0, defaultParams.ballRadius)), pitch, 16 / 9, newPlaced());
      const at = `${view} view, the terrier at ${s.toArray().map((x) => x.toFixed(2)).join(', ')}, yaw ${yaw.toFixed(3)}`;
      expect(placed.position.distanceTo(placeOf(s, yaw)), at).toBeLessThan(1e-12);
      expect(shows(placed, 16 / 9, s), `${at}: the terrier in view`).toBe(true);
      if (whereIs(placed.position) === 'outside') outside++;
    }
    expect(outside, 'some cameras fell outside the walls').toBeGreaterThan(100);
  });

  it('holds itself at least the margin above the ground and under the net, anywhere, which moves it only for a terrier far off the floor', () => {
    // On the pitch, with its back to a wall, so the camera is outside it, and deep in a goal, so the camera is
    // behind it: the floor point from 3 m below the floor to 5 m above it.
    const spots: [string, Vector3, number][] = [
      ['on the pitch', new Vector3(1, 2, 0), 0.7],
      ['its back to the −y side wall', new Vector3(5, -hy + r, 0), Math.PI / 2],
      ["deep in pack A's goal", new Vector3(-hx - depth + r + 0.05, 0, 0), 0],
    ];
    const room = { below: above - margin, over: height - margin - above };
    for (const [name, at, yaw] of spots) {
      for (let k = -60; k <= 100; k++) {
        const floor = k / 20;
        const s = at.clone().setZ(floor + r);
        const placed = placeCamera(player('ball', s, yaw, new Vector3(0, 0, defaultParams.ballRadius)), pitch, 16 / 9, newPlaced());
        const p = placed.position;
        const what = `${name}, its floor point at ${floor} m`;
        expect([p.x, p.y], what).toEqual([s.x - behind * Math.cos(yaw), s.y - behind * Math.sin(yaw)]);
        if (floor < -room.below) expect(p.z, `${what}: at the margin above the ground`).toBe(margin);
        else if (floor > room.over) expect(p.z, `${what}: at the margin under the net`).toBe(height - margin);
        else expect(p.z, `${what}: at its height over the floor point`).toBeCloseTo(floor + above, 12);
        expect(shows(placed, 16 / 9, s), `${what}: the terrier in view`).toBe(true);
      }
    }
    // The limits act only off the floor by more than their room: a terrier more than 1.7 m below the floor or
    // 3.5 m above it, never one in play, and a goal's roof, 3 m up, bounds nothing.
    expect(room.below).toBeCloseTo(1.7, 12);
    expect(room.over).toBeCloseTo(3.5, 12);
    const high = new Vector3(-hx - 1, 0, 3 + r);
    expect(placeCamera(player('ball', high, 0, new Vector3()), pitch, 16 / 9, newPlaced()).position.z).toBeCloseTo(3 + above, 12);
  });

  it('moves no further than its terrier and its yaw do, along every wall, round each cut corner and past each goal: never in a jump', () => {
    // The floor plan's outline, its walls and cut corners, counter-clockwise, moved in by the terrier's radius;
    // a terrier walked round it 2 cm at a time, in ball view on a ball at the centre spot, and in chase view, its
    // yaw following its way round at most 0.01 rad a step, about a turn a second at run speed, as the rig's cap
    // lets it. Each step the camera moves at most as far as the terrier did and the yaw swung it: |Δs| + 4.2 m
    // × |Δyaw|. The old clamp inside the walls jumped up to 3.6 m a frame at the corners (C-57).
    const outline = pitch.outline;
    const n = outline.length;
    const inward = (k: number): [number, number] => {
      const [ax, ay] = outline[k]!;
      const [bx, by] = outline[(k + 1) % n]!;
      const len = Math.hypot(bx - ax, by - ay);
      return [-(by - ay) / len, (bx - ax) / len];
    };
    // Each corner of the path: where the two edges' lines, moved in by r, meet.
    const path = outline.map(([x, y], k) => {
      const [px, py] = inward((k + n - 1) % n);
      const [qx, qy] = inward(k);
      const bisect = new Vector3(px + qx, py + qy, 0);
      return new Vector3(x, y, r).addScaledVector(bisect, r / bisect.dot(new Vector3(qx, qy, 0)));
    });
    const STEP = 0.02;
    const TURN = 0.01;
    const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
    for (const view of ['ball', 'chase'] as const) {
      let last: { s: Vector3; yaw: number; at: Vector3 } | null = null;
      let worst = 0;
      for (let k = 0; k <= n; k++) {
        const a = path[k % n]!;
        const b = path[(k + 1) % n]!;
        const steps = Math.ceil(a.distanceTo(b) / STEP);
        const way = Math.atan2(b.y - a.y, b.x - a.x);
        for (let j = 0; j < steps; j++) {
          const s = a.clone().lerp(b, j / steps);
          const target = view === 'ball' ? Math.atan2(-s.y, -s.x) : way;
          const yaw: number = last === null ? target : last.yaw + Math.max(-TURN, Math.min(TURN, wrap(target - last.yaw)));
          const placed = placeCamera(player(view, s, yaw, new Vector3(0, 0, defaultParams.ballRadius)), pitch, 16 / 9, newPlaced());
          const p = placed.position.clone();
          const at = `${view} view, the terrier at ${s.x.toFixed(2)}, ${s.y.toFixed(2)}`;
          expect(p.z, at).toBe(above);
          if (last !== null) {
            const moved = p.distanceTo(last.at);
            const allowed = s.distanceTo(last.s) + behind * Math.abs(wrap(yaw - last.yaw));
            expect(moved, at).toBeLessThanOrEqual(allowed + 1e-9);
            worst = Math.max(worst, moved);
          }
          // In ball view on the centre spot's ball, the camera's behind the terrier from the ball: outside the
          // walls or behind a goal all the way round, the terrier and the ball in view.
          if (view === 'ball') {
            expect(whereIs(p), at).toBe('outside');
            expect(shows(placed, 16 / 9, new Vector3(0, 0, defaultParams.ballRadius)), `${at}: the ball in view`).toBe(true);
          }
          expect(shows(placed, 16 / 9, s), `${at}: the terrier in view`).toBe(true);
          last = { s, yaw, at: p };
        }
      }
      expect(worst, `${view} view's largest step`).toBeLessThan(0.1);
    }
  });

  it('sits cameraBehindMetres behind the floor point along the yaw and cameraAboveMetres above it, on open grass', () => {
    const s = new Vector3(1, 2, r);
    const yaw = 0.7;
    const placed = placeCamera(player('chase', s, yaw, s), pitch, 16 / 9, newPlaced());
    const want = new Vector3(s.x - config.cameraBehindMetres * Math.cos(yaw), s.y - config.cameraBehindMetres * Math.sin(yaw), config.cameraAboveMetres);
    expect(placed.position.distanceTo(want)).toBeLessThan(1e-12);
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

  it('keeps the aim within 60° of the horizontal and its terrier in view, turning it from the ball no further than it must', () => {
    // A ball 5 m over each terrier is far outside the cone round the terrier, wherever the camera is: the aim
    // turns from it toward the terrier until the terrier sits right on the cone's edge, and no further.
    for (const c of cases) {
      for (const aspect of ASPECTS) {
        const placed = placeCamera(player('ball', c.s, c.yaw, c.s.clone().setZ(c.s.z + 5)), pitch, aspect, newPlaced());
        const look = placed.lookAt.clone().sub(placed.position).normalize();
        expect(Math.abs(Math.asin(look.z)), `${c.name} at ${aspect.toFixed(2)}`).toBeLessThanOrEqual((60 * Math.PI) / 180 + 1e-9);
        const toTerrier = c.s.clone().sub(placed.position).normalize();
        expect(look.angleTo(toTerrier), `${c.name} at ${aspect.toFixed(2)}`).toBeCloseTo(subjectCone(aspect), 9);
      }
    }
    const s = new Vector3(0, 0, r);
    // The ball high over the camera itself: the aim would be nearly straight up.
    const ball = new Vector3(-3.9, 0, 5.5);
    const placed = placeCamera(player('ball', s, 0, ball), pitch, 16 / 9, newPlaced());
    const look = placed.lookAt.clone().sub(placed.position).normalize();
    expect(Math.asin(look.z)).toBeLessThanOrEqual((60 * Math.PI) / 180 + 1e-9);
    // With its back to the wall, it stays outside the wall at its height, aimed at the ball over its terrier,
    // which needs no turn, the view's up the yaw's way, so the pitch ahead is up the screen.
    const wall = new Vector3(5, -hy + r, r);
    const out = placeCamera(player('ball', wall, Math.PI / 2, new Vector3(5, 0, 0.8)), pitch, 16 / 9, newPlaced());
    expect([out.position.y, out.position.z]).toEqual([wall.y - behind, above]);
    expect(whereIs(out.position)).toBe('outside');
    const at = project(cameraFor(out, 16 / 9), 5, 0, 0.8, CSS_H * (16 / 9), CSS_H);
    expect([at.x, at.y].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([(CSS_H * (16 / 9)) / 2, CSS_H / 2]);
    expect(out.up.y).toBeGreaterThan(0);
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
