// Where each camera goes (PLAN D-28, L87–L91, C-57; M4's design,
// research/m4/DESIGN.md, §1.9, §3.2, §3.3, M4-Q34).
//
// The overview (M1's, the empty pitch, for prepare()'s first frame and a
// pitch screen's view until its match's state arrives) looks across the
// pitch from the −y side, pack A's goal on the left, down at a fixed angle,
// from the nearest point at which the floor, the walls' tops and both goals
// fit the view at the canvas's aspect, so the pitch shows whole at any
// window size (D-30). That point is always outside the walls and above the
// net: the angle down is steeper than half the field of view, so the
// view's lower edge still points down and ahead, and with the near wall's
// foot in view the camera is behind it; the far wall's top is below the
// view's upper edge, which points down too, so the camera is above the net.
//
// A player's camera sits cameraBehindMetres behind the terrier's floor
// point along the rig's yaw and cameraAboveMetres above it, with a vertical
// field of cameraFovDegrees (the spike's camera); ball view looks at the
// drawn ball, chase view at a point chaseLookAheadMetres ahead of the
// terrier along the yaw at its height, so the terrier sits low in the view
// with the pitch ahead. It keeps that place wherever it falls, outside the
// walls and in or behind a goal included (L89, C-57): the walls are clear
// plexiglass, and the glass, the goals' frames and their netting give way
// round the camera and the line to its terrier as they're drawn instead, so
// nothing of the arena moves it, and it never rises or comes closer. Its
// only limits are the ground's and the overhead net's: at least
// cameraWallMarginMetres above the one and under the other, anywhere, which
// move it only for a terrier far below the floor or high above it, never in
// play. The aim's pitch is held within ±60° of the horizontal, a drawing
// constant, but keeping the terrier in view comes first. The view's up is
// the yaw's, so a steep look stays level with the pitch.
//
// Spectators (L91) watch from high above the near side, outside the walls
// and above the net, at the overview's 50° down and 40° field, framing a
// window spectatorViewLengthMetres long whose centre the rig eases along
// the pitch's length (src/render/camera-rig.ts) and which stays on the
// pitch, the goals included, its aim following the body across; further
// out if that's what keeps it outside the walls and above the net.
//
// Which numbers are settings (M4-Q34): those the owner tunes with the swing
// on the feel page, from src/config.ts; the overview's fit, its elevation
// and field, the ±60° limit and the insets keep the maths and the layout
// valid, and stay drawing constants here, as M1's did. Metres, z up (D-4).
// The players' placement is new at M4, from the spike's
// research/spike/src/scene/camera.ts, whose box clamp it replaced; C-57's
// prototype, E, took out the clamp inside the walls and the rise that went
// with it.

import { PerspectiveCamera, Vector3 } from 'three';
import { config } from '../config';
import { defaultParams } from '../core/sim/params';
import { NET, type Pitch } from '../core/sim/pitch';
import { spectatorCentreLimit } from './camera-rig';
import type { CameraFrame, ScreenPoint, ViewMode } from './frame';

const FOV_DEGREES = 40; // vertical: the overview's and the spectators'
const ELEVATION_DEGREES = 50; // the view's angle below the horizontal: more than half the field of view
/** The share of the view's half-width and half-height left clear at each edge. */
const EDGE_MARGIN = 0.05;
/** A player's aim at its target stays within this of the horizontal. */
const AIM_PITCH_LIMIT_DEGREES = 60;
/** A player's terrier is kept inside this share of the view's half-field. */
const SUBJECT_INSET = 0.8;
/** Steeper than this from the horizontal, the view's up comes from the yaw. */
const STEEP_DEGREES = 80;
const PLAYER_NEAR_METRES = 0.05;
const SPECTATOR_NEAR_METRES = 0.5;
const FAR_METRES = 200;
/** A projected point inside this much of the view's half-width and half-height is in view. */
const IN_VIEW = 0.95;

const UP = new Vector3(0, 0, 1);
const RADIANS = Math.PI / 180;

export function spectatorCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(FOV_DEGREES, 1, 1, 1000);
  camera.up.copy(UP);
  return camera;
}

/** The points the view must hold: the floor plan at the floor and at the
 *  walls' tops, and each goal's floor and top. */
export function framedPoints(p: Pitch): Vector3[] {
  const height = p.shape.heightMetres;
  const out: Vector3[] = [];
  for (const [x, y] of p.outline) out.push(new Vector3(x, y, 0), new Vector3(x, y, height));
  for (const goal of p.goals) {
    for (const [x, y] of goal.floor) out.push(new Vector3(x, y, 0), new Vector3(x, y, goal.mouthHeight));
  }
  return out;
}

/**
 * Places the camera for an aspect (width / height). With the direction
 * fixed, each point P bounds the camera's position C along the view axis
 * w: |(P − C)·x| ≤ tan(fov_x / 2) (P − C)·w, and the same for y. The
 * nearest C meeting every bound sits midway between the tightest ones on
 * each axis, so the pitch reaches the margin at both edges on one axis.
 * It draws as far as the farthest of them and 50 m more, and at least
 * FAR_METRES past the centre spot along the view, as far as the other
 * cameras draw, so the ground outside the walls has faded into the sky
 * before the view ends, at any window's shape (C-57).
 */
export function fitSpectator(camera: PerspectiveCamera, aspect: number, p: Pitch): void {
  const el = ELEVATION_DEGREES * RADIANS;
  const w = new Vector3(0, Math.cos(el), -Math.sin(el)); // forward
  const x = new Vector3(1, 0, 0); // right
  const y = new Vector3().crossVectors(x, w); // up, in the view
  const ty = Math.tan((FOV_DEGREES * RADIANS) / 2) * (1 - EDGE_MARGIN);
  const tx = ty * aspect;
  const points = framedPoints(p);
  const tightest = (axis: Vector3, t: number): { across: number; along: number } => {
    let a = Infinity;
    let b = Infinity;
    for (const q of points) {
      const depth = q.dot(w);
      const side = q.dot(axis) / t;
      a = Math.min(a, depth - side);
      b = Math.min(b, depth + side);
    }
    return { across: (t * (b - a)) / 2, along: (a + b) / 2 };
  };
  const h = tightest(x, tx);
  const v = tightest(y, ty);
  const c = new Vector3()
    .addScaledVector(x, h.across)
    .addScaledVector(y, v.across)
    .addScaledVector(w, Math.min(h.along, v.along));

  let far = 0;
  for (const q of points) far = Math.max(far, new Vector3().subVectors(q, c).dot(w));
  camera.position.copy(c);
  camera.lookAt(new Vector3().addVectors(c, w));
  camera.aspect = aspect;
  camera.near = 1;
  camera.far = Math.max(far + 50, FAR_METRES - c.dot(w));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

// --- A player's camera's limits (L89, C-57) ---

function netHeight(p: Pitch): number {
  return p.pieces.find((q) => q.surface === NET)?.oz ?? p.shape.heightMetres;
}

/** A player's camera at v held to its only limits (C-57): at least `margin` above the ground, the floor
 *  inside the walls and the ground outside them alike, at z 0, and at most the overhead net's height less
 *  `margin`, wherever it is, inside the walls or outside them. Nothing else of the pitch moves it: not the
 *  walls, the posts or the goals' netting, which give way round it as they're drawn. */
function limitHeight(v: Vector3, p: Pitch, margin: number): Vector3 {
  v.z = Math.max(margin, Math.min(netHeight(p) - margin, v.z));
  return v;
}

// --- Placement (D-28, §3.2) ---

/** Where the camera goes for a frame. The vectors are placeCamera's to write. */
export interface Placed {
  readonly position: Vector3;
  readonly lookAt: Vector3;
  /** The view's up: square to the aim. */
  readonly up: Vector3;
  fovDegrees: number;
  near: number;
  far: number;
}

export function newPlaced(): Placed {
  return { position: new Vector3(), lookAt: new Vector3(), up: new Vector3(0, 0, 1), fovDegrees: FOV_DEGREES, near: 1, far: FAR_METRES };
}

const aim = new Vector3();
const dir = new Vector3();
const toSubject = new Vector3();
const right = new Vector3();
const overviewCamera = spectatorCamera();
let overviewFor: { p: Pitch; aspect: number } | null = null;

/** Where the camera goes for a frame (D-28, §3.2): a player's behind and above its terrier along the
 *  yaw, wherever that falls, outside the walls and in or behind a goal included, held only to its limits
 *  above the ground and under the net (L89, C-57), and aimed so the terrier stays in view; the
 *  spectators' high above the near side, outside the walls; the overview M1's. A player's frame with no
 *  subject, its terrier not in the drawn match, watches its target as a spectator would. */
export function placeCamera(f: CameraFrame, p: Pitch, aspect: number, out: Placed): Placed {
  const m = f.mode;
  if (m.kind === 'overview') return placeOverview(p, aspect, out);
  if (m.kind === 'player' && f.subject !== null) return placePlayer(f, m.view, f.subject, p, aspect, out);
  return placeSpectator(f.target, p, aspect, out);
}

function placeOverview(p: Pitch, aspect: number, out: Placed): Placed {
  if (overviewFor?.p !== p || overviewFor.aspect !== aspect) {
    fitSpectator(overviewCamera, aspect, p);
    overviewFor = { p, aspect };
  }
  out.position.copy(overviewCamera.position);
  overviewCamera.getWorldDirection(out.lookAt).add(overviewCamera.position);
  out.up.copy(UP);
  out.fovDegrees = FOV_DEGREES;
  out.near = overviewCamera.near;
  out.far = overviewCamera.far;
  return out;
}

type Point3 = { readonly x: number; readonly y: number; readonly z: number };

function placePlayer(f: CameraFrame, view: ViewMode, s: Point3, p: Pitch, aspect: number, out: Placed): Placed {
  const c = config;
  const cx = Math.cos(f.yaw);
  const cy = Math.sin(f.yaw);
  const floor = s.z - defaultParams.terrierRadius;
  const pos = out.position.set(s.x - c.cameraBehindMetres * cx, s.y - c.cameraBehindMetres * cy, floor + c.cameraAboveMetres);
  limitHeight(pos, p, c.cameraWallMarginMetres);

  if (view === 'ball') aim.set(f.target.x, f.target.y, f.target.z);
  else aim.set(s.x + c.chaseLookAheadMetres * cx, s.y + c.chaseLookAheadMetres * cy, floor + c.terrierShoulderHeightMetres);
  dir.subVectors(aim, pos);
  if (dir.lengthSq() < 1e-12) dir.set(cx, cy, 0);
  dir.normalize();
  limitPitch(dir, cx, cy);
  keepInView(dir, toSubject.set(s.x - pos.x, s.y - pos.y, s.z - pos.z), subjectCone(aspect));
  out.lookAt.copy(pos).add(dir);
  viewUp(dir, f.yaw, out.up);
  out.fovDegrees = c.cameraFovDegrees;
  out.near = PLAYER_NEAR_METRES;
  out.far = FAR_METRES;
  return out;
}

/** The half-angle round a player's aim its terrier is kept inside: SUBJECT_INSET of the smaller of the
 *  view's half-fields at the aspect. */
export function subjectCone(aspect: number): number {
  const halfV = (config.cameraFovDegrees * RADIANS) / 2;
  return Math.min(halfV, Math.atan(Math.tan(halfV) * aspect)) * SUBJECT_INSET;
}

/** The aim's pitch held within ±60° of the horizontal, along its own heading, or the yaw's if vertical. */
function limitPitch(d: Vector3, cx: number, cy: number): void {
  const most = Math.sin(AIM_PITCH_LIMIT_DEGREES * RADIANS);
  if (Math.abs(d.z) <= most) return;
  const across = Math.hypot(d.x, d.y);
  const hx = across > 1e-9 ? d.x / across : cx;
  const hy = across > 1e-9 ? d.y / across : cy;
  const level = Math.cos(AIM_PITCH_LIMIT_DEGREES * RADIANS);
  d.set(hx * level, hy * level, Math.sign(d.z) * most);
}

/** The aim d turned toward the subject, the shortest way, until the subject is within `limit` of it. */
function keepInView(d: Vector3, to: Vector3, limit: number): void {
  const length = to.length();
  if (length < 1e-9) return;
  to.divideScalar(length);
  const theta = Math.acos(Math.max(-1, Math.min(1, d.dot(to))));
  if (theta <= limit) return;
  const sinTheta = Math.sin(theta);
  if (sinTheta < 1e-9) {
    d.copy(to);
    return;
  }
  const turn = theta - limit;
  const a = Math.sin(theta - turn) / sinTheta;
  const b = Math.sin(turn) / sinTheta;
  d.multiplyScalar(a).addScaledVector(to, b).normalize();
}

/** The view's up for the unit aim d: square to it, from the aim's right in plan, or from the yaw's right
 *  when the aim is steep, so a camera looking down at its terrier keeps the yaw's way up the screen, and
 *  one looking straight down still has an up. */
export function viewUp(d: Vector3, yaw: number, out: Vector3): Vector3 {
  const cx = Math.cos(yaw);
  const cy = Math.sin(yaw);
  if (Math.abs(d.z) < Math.sin(STEEP_DEGREES * RADIANS)) right.crossVectors(d, UP);
  else right.set(cy, -cx, 0).addScaledVector(d, -(cy * d.x - cx * d.y));
  if (right.lengthSq() < 1e-12) right.crossVectors(d, UP);
  right.normalize();
  return out.crossVectors(right, d).normalize();
}

function placeSpectator(t: Point3, p: Pitch, aspect: number, out: Placed): Placed {
  const el = ELEVATION_DEGREES * RADIANS;
  const ce = Math.cos(el);
  const se = Math.sin(el);
  const margin = config.cameraWallMarginMetres;
  const limit = spectatorCentreLimit(p);
  const hy = p.shape.widthMetres / 2;
  const height = netHeight(p);
  const ax = Math.max(-limit, Math.min(limit, t.x));
  const ay = Math.max(-hy, Math.min(hy, t.y));
  const az = Math.max(0, Math.min(height, t.z));
  const across = Math.tan((FOV_DEGREES * RADIANS) / 2) * (1 - EDGE_MARGIN) * aspect;
  // Near enough to frame the window across the view, but outside the near wall and above the net.
  let d = config.spectatorViewLengthMetres / 2 / across;
  d = Math.max(d, (ay + hy + margin) / ce, (height + margin - az) / se);
  out.position.set(ax, ay - d * ce, az + d * se);
  out.lookAt.set(ax, ay, az);
  out.up.copy(UP);
  out.fovDegrees = FOV_DEGREES;
  out.near = SPECTATOR_NEAR_METRES;
  out.far = FAR_METRES;
  return out;
}

// --- Projections, for the DOM overlay (§3.3, M4-Q10) ---

const viewPoint = new Vector3();

/** Where a point shows on a camera's canvas, in CSS px from its top left, and whether it's in view: in
 *  front of the camera and inside 95% of the view's half-width and half-height. `angle` is the way to
 *  the point from the canvas's centre, for the off-screen arrow (D-28): radians clockwise from the
 *  canvas's right, as CSS's rotate() turns, y down. A point behind the camera is put on the canvas's edge
 *  the way it lies round the view, straight behind pointing down. The camera's matrices are current. */
export function project(camera: PerspectiveCamera, x: number, y: number, z: number, cssWidth: number, cssHeight: number): ScreenPoint {
  const v = viewPoint.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
  const halfW = cssWidth / 2;
  const halfH = cssHeight / 2;
  if (v.z < -camera.near) {
    v.applyMatrix4(camera.projectionMatrix);
    const dx = v.x * halfW;
    const dy = -v.y * halfH;
    return {
      x: halfW + dx, y: halfH + dy,
      inView: Math.abs(v.x) <= IN_VIEW && Math.abs(v.y) <= IN_VIEW,
      angle: Math.atan2(dy, dx),
    };
  }
  let dx = v.x;
  let dy = -v.y;
  if (dx * dx + dy * dy < 1e-12) {
    dx = 0;
    dy = 1;
  }
  const reach = Math.min(dx === 0 ? Infinity : halfW / Math.abs(dx), dy === 0 ? Infinity : halfH / Math.abs(dy));
  return { x: halfW + dx * reach, y: halfH + dy * reach, inView: false, angle: Math.atan2(dy, dx) };
}
