// The code-built terrier's procedural pose (PLAN D-27, D-9, §12; L98, L208,
// L345; M4's design, research/m4/DESIGN.md, §1.5, §2.4, §2.5). Every
// animation but barking is read from the state's fields with the drawn
// time, so a rollback or a resync redraws the same pose: each layer's phase
// at the seconds since its start, blended by the layers' weights; then the
// overlays from the state: turning (the heading's change this tick), being
// pushed (the last push's direction and tick), landing (the landing tick);
// then the bark and the celebration the view hands in with their starts
// and weights, the bark over any animation and the celebration over
// standing and running alone (L98); and last the pushing pose, held for
// config.pushPoseTicks after a contact with the ball or a terrier and then
// released over config.animationBlendMs of drawn time, so its limits keep
// every part out of a touching ball whatever else is drawn (D-27's fit).
// A contact up to a tick after the drawn time counts as now: the drawn
// match takes its ticks from the nearer state (src/render/interpolate.ts).
// A terrier's push jolts it through the pushing pose, its lurch, head whip
// and ears added after it, for D-27 lets terriers overhang each other; a
// ball's holds it still, for the fit.
//
// Everything is in the terrier's own frame: +x along its heading, +y to its
// left, +z up, the origin on the floor under its collider (D-4), the shape
// the look's (src/render/look.ts). For the eyes and the ears, a shape's y
// is the mirrored half-spacing; every other part sits on the mid-plane, as
// the spike's did. Its pose constants (the angles, the bobs, the overlays'
// envelopes) are the look's own, never settings: what the owner tunes is in
// src/config.ts (§0).
//
// A port of the M0 spike's research/spike/src/scene/terrier-pose.ts
// (poseParams, poseParts, rootMatrix), with M4's changes (§1.5): the phases
// are A.1's codes and each layer is timed from its own start; the shape is
// a Look's plain numbers; the run speed and the jump speed are
// defaultParams', the collider's radius the caller's, never copies; the
// pushing pose reads config.pushPoseTicks, follows a terrier contact as well
// as the ball's, and releases instead of snapping; and turning, being
// pushed, landing, barking and celebrating are new. The spike checked its
// fit with the ball straight ahead; checked all round, its pushing pose let
// the tail into a ball from behind, an ear into one from the front's sides,
// a rising nose into one in front, and the phases it left out, tumbled,
// getting up and sitting, put the head in one; and in the air, where a ball
// can be level with it or below it, the face went into a level one and the
// legs into one below. So the pose now holds in every phase, levels the
// body on its feet, draws the head back as well as down, lays the ears
// flat, stands the tail up and, in the air, tucks the legs under the body
// (src/render/drawers/code.test.ts). The bark opens a jaw, the
// snout's second instance, so PartMatrices gains `jaw` (§1.5 names `mouth`
// but no part for it to move). Three's Matrix4 for the parts; the pose's
// maths are three-free.

import { Matrix4 } from 'three';
import { config } from '../../config';
import { defaultParams } from '../../core/sim/params';
import { AIRBORNE, type AnimPhase, GETTING_UP, LUNGING, NEVER, RUNNING, SITTING, STANDING, TUMBLED, ZOOMING } from '../../core/sim/state';
import { secondsSince, type TerrierFrame } from '../drawer';
import type { TerrierShape } from '../look';

/** The pose's free parameters: radians and metres in the terrier's frame. */
export interface PoseParams {
  bob: number;
  /** About the body's lateral axis at (pitchPivotX, pitchPivotZ): positive tips the nose down and forward. */
  pitch: number;
  pitchPivotX: number;
  pitchPivotZ: number;
  /** About the heading, at the body's centre: positive lifts its left side. */
  roll: number;
  /** Along the heading. */
  stretch: number;
  /** About the neck: positive lowers the nose. */
  headPitch: number;
  /** About the neck: positive turns the nose to the left. */
  headYaw: number;
  neckBack: number;
  neckDown: number;
  /** Positive tips the ears forward. */
  earPitch: number;
  earSplay: number;
  /** Front left, front right, back left, back right: positive swings a foot back. */
  legs: [number, number, number, number];
  tailYaw: number;
  /** Negative lifts the tail. */
  tailPitch: number;
  /** The jaw's opening: positive drops it. */
  mouth: number;
}

/** One terrier's part transforms in world space, in a fixed order. */
export interface PartMatrices {
  body: Matrix4;
  /** The head, the snout and the face. */
  head: Matrix4;
  /** The lower jaw: the snout's second instance, which the mouth opens. */
  jaw: Matrix4;
  ears: [Matrix4, Matrix4];
  /** Front left, front right, back left, back right. */
  legs: [Matrix4, Matrix4, Matrix4, Matrix4];
  tail: Matrix4;
  bandana: Matrix4;
  /** The pack cue's base: the terrier's floor point, world-aligned, untouched by the pose. */
  cue: Matrix4;
}

/** How much of each overlay a pose shows, for the drawer's counts. */
export interface OverlayWeights {
  bark: number;
  celebrate: number;
  pushing: number;
}

export function newPartMatrices(): PartMatrices {
  return {
    body: new Matrix4(), head: new Matrix4(), jaw: new Matrix4(),
    ears: [new Matrix4(), new Matrix4()],
    legs: [new Matrix4(), new Matrix4(), new Matrix4(), new Matrix4()],
    tail: new Matrix4(), bandana: new Matrix4(), cue: new Matrix4(),
  };
}

export function newPoseParams(): PoseParams {
  return {
    bob: 0, pitch: 0, pitchPivotX: 0, pitchPivotZ: 0, roll: 0, stretch: 1,
    headPitch: 0, headYaw: 0, neckBack: 0, neckDown: 0, earPitch: 0, earSplay: 0,
    legs: [0, 0, 0, 0], tailYaw: 0, tailPitch: 0, mouth: 0,
  };
}

export function newOverlayWeights(): OverlayWeights {
  return { bark: 0, celebrate: 0, pushing: 0 };
}

const TAU = 2 * Math.PI;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const clamp01 = (x: number): number => clamp(x, 0, 1);
const ease = (x: number): number => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

// The pose's own look: each overlay's envelope and size.
/** Turning at the full turn rate: the head leads, the body leans in with the speed, the tail swings out. */
const TURN_HEAD = 0.3;
const TURN_LEAN = 0.12;
const TURN_TAIL = 0.4;
/** Being pushed: a jolt the way it went, settled within this. */
const JOLT_SECONDS = 0.3;
const JOLT_PITCH = 0.35;
const JOLT_ROLL = 0.45;
const JOLT_HEAD = 0.35;
const JOLT_EARS = 0.5;
/** Landing: a squash this long, the legs splayed this far at its deepest and the body as low as keeps the feet down. */
const LANDING_SECONDS = 0.18;
const LANDING_SPLAY = 0.4;
const LANDING_EARS = 0.35;
/** A bark: one woof, the jaw open and the nose tossed up, closed again within WOOF_SECONDS of its start, inside the
 *  view's 0.4 s (src/render/view.ts), so it never snaps shut. */
const WOOF_SECONDS = 0.34;
const WOOF_JAW = 0.5;
const WOOF_TOSS = 0.3;
const WOOF_EARS = 0.2;
/** Celebrating: a hop every HOP_SECONDS, HOP_METRES high, the legs tucked, the tail up and wagging, the head up. */
const HOP_SECONDS = 0.42;
const HOP_METRES = 0.07;
const HOP_TUCK = 0.35;
const WAG_RADIANS = 0.8;
const WAG_HZ = 5;
const CHEER_TAIL = -1.1;
const CHEER_EARS = 0.3;
const CHEER_HEAD = 0.12;
/** The pushing pose's limits, the spike's but for the head's draw-back and the tuck: the body straight, low and still,
 *  and the head down and back, back far enough that the face clears a ball level with it in front, as a jump meets
 *  one (L57). On its feet, the body is level, for a raised nose carries the face up into a ball in front; off them,
 *  sitting or tumbled, the body keeps its own lean, and no overlay adds to it. The ears lie flat and the tail stands up
 *  over the back, inside the collider, out of a ball from any side; in the air the legs tuck under the body, the front
 *  feet back and the back feet forward, out of a ball below it (D-27's fit, measured all round, from 31.6° to 90° on
 *  the floor and from −90° to 90° in the air). */
const PUSH_BOB_MAX = 0.01;
const PUSH_HEAD_PITCH = 0.4;
const PUSH_NECK_BACK = 0.06;
const PUSH_NECK_DOWN = 0.04;
const PUSH_EARS = -0.8;
const PUSH_SPLAY = 0.35;
const PUSH_TAIL = 0.15;
const PUSH_TUCK = 0.7;

/** The fastest a terrier turns, radians a tick: config's turn rate. */
const TURN_PER_TICK = (TAU * config.turnRateTurnsPerSecond) / config.ticksPerSecond;
const TICK_MS = 1000 / config.ticksPerSecond;

/** The phases the celebration plays over (L98). */
const cheers = (anim: AnimPhase): boolean => anim === STANDING || anim === RUNNING;
/** The phases a terrier is on its feet in, or about to land on them: not tumbled, getting up or sitting, whose own
 *  poses hold their bodies. A landing squashes only these, and their pushing pose holds the body level. */
const onFeet = (anim: AnimPhase): boolean => anim !== TUMBLED && anim !== GETTING_UP && anim !== SITTING;
/** The phases in the air, where a ball can meet the terrier level with it or from below. */
const aloft = (anim: AnimPhase): boolean => anim === AIRBORNE || anim === LUNGING;

function setLegs(q: PoseParams, a: number, b: number, c: number, d: number): void {
  q.legs[0] = a;
  q.legs[1] = b;
  q.legs[2] = c;
  q.legs[3] = d;
}

/** One animation phase's pose at `seconds` into it (the spike's poseParams, without the overlays): its legs by the
 *  gait for running and zooming, running's amount by the speed, airborne's lean by the vertical speed. Writes `out`
 *  and returns it. */
export function phasePose(anim: AnimPhase, seconds: number, t: TerrierFrame, shape: TerrierShape, out: PoseParams = newPoseParams()): PoseParams {
  const q = out;
  const s = seconds;
  const speed = Math.hypot(t.vx, t.vy);
  const g = t.gait * TAU;
  q.bob = 0;
  q.pitch = 0;
  q.pitchPivotX = shape.body.centre[0];
  q.pitchPivotZ = shape.body.centre[2];
  q.roll = 0;
  q.stretch = 1;
  q.headPitch = 0;
  q.headYaw = 0;
  q.neckBack = 0;
  q.neckDown = 0;
  q.earPitch = 0;
  q.earSplay = 0.35;
  setLegs(q, 0, 0, 0, 0);
  q.tailYaw = 0;
  q.tailPitch = -0.6;
  q.mouth = 0;
  const trot = (amp: number): void => {
    const a = amp * Math.sin(g);
    setLegs(q, a, -a, -a, a);
  };
  switch (anim) {
    case STANDING: {
      q.bob = 0.004 * Math.sin((TAU * s) / 1.6);
      q.headPitch = 0.05 * Math.sin((TAU * s) / 3.1);
      q.headYaw = 0.25 * Math.sin((TAU * s) / 5.3);
      q.tailYaw = 0.5 * Math.sin(TAU * s * 2.2);
      break;
    }
    case RUNNING: {
      const k = Math.min(1, speed / defaultParams.runSpeed);
      trot(0.55 * k);
      q.bob = 0.02 * k * Math.abs(Math.sin(g));
      q.pitch = 0.04 * Math.sin(2 * g);
      q.headPitch = -0.05 * Math.sin(2 * g);
      q.tailYaw = 0.35 * Math.sin(g);
      q.earPitch = -0.2 * k;
      break;
    }
    case ZOOMING: {
      trot(0.85);
      q.bob = 0.03 * Math.abs(Math.sin(g));
      q.pitch = 0.08;
      q.stretch = 1.05;
      q.earPitch = -0.6;
      q.tailPitch = -1.2;
      break;
    }
    case AIRBORNE: {
      // Nose up while rising, down while falling, by the vertical speed against the jump's.
      const up = clamp(t.vz / defaultParams.jumpSpeed, -1, 1);
      q.pitch = -0.35 * up;
      setLegs(q, -0.7, -0.7, 0.7, 0.7);
      q.earPitch = -0.3;
      q.tailPitch = -0.3;
      break;
    }
    case LUNGING: {
      q.pitch = 0.1;
      q.stretch = 1.08;
      setLegs(q, -1.1, -1.1, 1.0, 1.0);
      q.headPitch = 0.15;
      q.earPitch = -0.7;
      q.tailPitch = -1.3;
      break;
    }
    case TUMBLED: {
      // Over and over once, then on its side (PLAN §12: rolls over).
      const roll = s < 0.6 ? (s / 0.6) * (TAU + Math.PI / 2) : Math.PI / 2;
      q.roll = roll;
      q.bob = -0.085 * Math.abs(Math.sin(roll));
      const kick = 0.4 * Math.sin(TAU * s * 3);
      setLegs(q, kick, -kick, -kick, kick);
      q.earSplay = 0.9;
      break;
    }
    case GETTING_UP: {
      // Back on its feet in 0.25 s, then shakes itself off.
      if (s < 0.25) {
        q.roll = (Math.PI / 2) * (1 - ease(s / 0.25));
        q.bob = -0.085 * Math.abs(Math.sin(q.roll));
      } else {
        const fade = 1 - clamp01((s - 0.25) / 0.25);
        q.roll = 0.25 * fade * Math.sin(TAU * 7 * (s - 0.25));
        q.headYaw = 0.5 * fade * Math.sin(TAU * 7 * (s - 0.25) + 1);
        q.earSplay = 0.35 + 0.6 * fade * Math.abs(Math.sin(TAU * 7 * (s - 0.25)));
      }
      break;
    }
    case SITTING: {
      // Back on its haunches, about the back hips.
      const k = ease(s / 0.25);
      q.pitch = -0.55 * k;
      q.pitchPivotX = shape.legs.back;
      q.pitchPivotZ = shape.legs.top - shape.legs.radius / 2;
      q.bob = -0.06 * k;
      setLegs(q, 0.55 * k, 0.55 * k, -1.3 * k, -1.3 * k);
      q.headPitch = 0.45 * k;
      q.tailPitch = -1.45;
      q.tailYaw = 0.3 * Math.sin(TAU * s * 1.2);
      break;
    }
  }
  return q;
}

/** Copies a pose into `out`, which keeps its own legs. */
export function copyPose(from: PoseParams, out: PoseParams): PoseParams {
  const legs = out.legs;
  Object.assign(out, from);
  out.legs = legs;
  for (let k = 0; k < 4; k++) legs[k] = from.legs[k]!;
  return out;
}

/** a + (b − a) · w, field by field, into out, which may be a or b. */
export function blendPoses(a: PoseParams, b: PoseParams, w: number, out: PoseParams): PoseParams {
  const mix = (x: number, y: number): number => x + (y - x) * w;
  out.bob = mix(a.bob, b.bob);
  out.pitch = mix(a.pitch, b.pitch);
  out.pitchPivotX = mix(a.pitchPivotX, b.pitchPivotX);
  out.pitchPivotZ = mix(a.pitchPivotZ, b.pitchPivotZ);
  out.roll = mix(a.roll, b.roll);
  out.stretch = mix(a.stretch, b.stretch);
  out.headPitch = mix(a.headPitch, b.headPitch);
  out.headYaw = mix(a.headYaw, b.headYaw);
  out.neckBack = mix(a.neckBack, b.neckBack);
  out.neckDown = mix(a.neckDown, b.neckDown);
  out.earPitch = mix(a.earPitch, b.earPitch);
  out.earSplay = mix(a.earSplay, b.earSplay);
  for (let k = 0; k < 4; k++) out.legs[k] = mix(a.legs[k]!, b.legs[k]!);
  out.tailYaw = mix(a.tailYaw, b.tailYaw);
  out.tailPitch = mix(a.tailPitch, b.tailPitch);
  out.mouth = mix(a.mouth, b.mouth);
  return out;
}

/** Seconds since a state's tick at the drawn time, or null for one that never happened or hasn't yet. */
function since(time: number, tick: number): number | null {
  return tick === NEVER || time < tick ? null : (time - tick) / config.ticksPerSecond;
}

/** How far a contact at `tick` holds the pushing pose at the drawn time: whole for config.pushPoseTicks, then falling
 *  to nothing over config.animationBlendMs of drawn time. A contact up to a tick after the drawn time counts as now:
 *  the drawn match takes its ticks from the nearer state, the head from halfway through the tick before it, and from
 *  every fraction across a catch-up (src/render/interpolate.ts), so a push held tick after tick keeps its pose in
 *  every frame. */
function contactWeight(tick: number, time: number): number {
  if (tick === NEVER || tick > time + 1) return 0;
  const after = time - tick - config.pushPoseTicks;
  const kept = after <= 0 ? 1 : 1 - (after * TICK_MS) / config.animationBlendMs;
  return kept > 0 ? kept : 0;
}

/** The pushing pose's weight: whole for config.pushPoseTicks after the later of the last ball and terrier contacts,
 *  in every phase, then falling to nothing over config.animationBlendMs of drawn time. It comes in at once, so the
 *  head is out of the ball from the contact's tick (D-27's fit), and goes out as an overlay does (L208). */
export function pushingWeight(t: TerrierFrame, time: number): number {
  return Math.max(contactWeight(t.lastBallContactTick, time), contactWeight(t.lastTerrierContactTick, time));
}

const layerPose = newPoseParams();
const pushPose = newPoseParams();

/** The terrier's pose at the drawn time (ticks): its layers blended by weight, then the overlays from the state
 *  (turning, being pushed, landing), the bark and the celebration, and last the pushing pose. Writes `out` and
 *  returns it; `weights`, if given, takes how much of each overlay it shows. */
export function terrierPose(t: TerrierFrame, time: number, shape: TerrierShape, out: PoseParams, weights?: OverlayWeights): PoseParams {
  const tps = config.ticksPerSecond;
  // The layers, blended by weight; the celebration plays over the share of them standing or running.
  let total = 0;
  let cheering = 0;
  let footed = 0;
  // The lowest pitch the pushing pose keeps: level on its feet, else each layer's own lean back.
  let lowest = 0;
  // The share in the air, whose legs the pushing pose tucks.
  let aloftShare = 0;
  for (const L of t.layers) {
    if (!(L.weight > 0)) continue;
    const p = phasePose(L.anim, secondsSince(time, L.start, tps), t, shape, layerPose);
    if (total === 0) copyPose(p, out);
    total += L.weight;
    blendPoses(out, p, L.weight / total, out);
    if (cheers(L.anim)) cheering += L.weight;
    const feet = onFeet(L.anim);
    if (feet) footed += L.weight;
    if (aloft(L.anim)) aloftShare += L.weight;
    lowest += ((feet ? 0 : Math.min(0, p.pitch)) - lowest) * (L.weight / total);
  }
  if (total === 0) phasePose(STANDING, 0, t, shape, out);
  const q = out;
  const speed = Math.hypot(t.vx, t.vy);

  // Turning: by the heading's change this tick, against the fastest turn.
  const turn = clamp(t.headingChange / TURN_PER_TICK, -1, 1);
  q.headYaw += TURN_HEAD * turn;
  q.roll -= TURN_LEAN * turn * Math.min(1, speed / defaultParams.runSpeed);
  q.tailYaw -= TURN_TAIL * turn;

  // Being pushed: a jolt the way the push went, relative to the heading. Its roll now; its lurch, head whip and ears
  // after the pushing pose, which a ball's contact holds them out of (D-27's fit) and a terrier's lets through.
  let joltPitch = 0;
  let joltHead = 0;
  let joltEars = 0;
  const pushed = since(time, t.lastPushTick);
  if (pushed !== null && pushed < JOLT_SECONDS) {
    const u = pushed / JOLT_SECONDS;
    const k = Math.sin(Math.PI * u) * (1 - u);
    const rel = t.lastPushDir - t.heading;
    joltPitch = JOLT_PITCH * Math.cos(rel) * k;
    q.roll -= JOLT_ROLL * Math.sin(rel) * k;
    joltHead = -JOLT_HEAD * Math.sin(rel) * k;
    joltEars = JOLT_EARS * k;
  }

  // Landing: the legs splay and the body drops as far as keeps the feet on the floor.
  const landed = since(time, t.landingTick);
  if (landed !== null && landed < LANDING_SECONDS && footed > 0) {
    const k = Math.sin((Math.PI * landed) / LANDING_SECONDS) * (footed / total);
    const a = LANDING_SPLAY * k;
    q.legs[0] -= a;
    q.legs[1] -= a;
    q.legs[2] += a;
    q.legs[3] += a;
    q.bob -= (shape.legs.length - shape.legs.radius) * (1 - Math.cos(a));
    q.earPitch += LANDING_EARS * k;
  }

  // The bark, over any animation: one woof from its start.
  let barking = 0;
  const bark = t.bark;
  if (bark !== null && bark.weight > 0 && time >= bark.start) {
    barking = bark.weight;
    const s = (time - bark.start) / tps;
    if (s < WOOF_SECONDS) {
      const k = Math.sin(Math.PI * (s / WOOF_SECONDS) ** 0.6) * barking;
      q.mouth += WOOF_JAW * k;
      q.headPitch -= WOOF_TOSS * k;
      q.earPitch -= WOOF_EARS * k;
    }
  }

  // The celebration, over standing and running: hops and a wagging tail, timed from the goal's tick.
  let celebrating = 0;
  const cel = t.celebrate;
  if (cel !== null && cel.weight > 0 && time >= cel.start && total > 0) {
    celebrating = cel.weight * (cheering / total);
    if (celebrating > 0) {
      const s = (time - cel.start) / tps;
      const hop = Math.abs(Math.sin((Math.PI * s) / HOP_SECONDS)) * celebrating;
      q.bob += HOP_METRES * hop;
      q.legs[0] += HOP_TUCK * hop;
      q.legs[1] += HOP_TUCK * hop;
      q.legs[2] -= HOP_TUCK * hop;
      q.legs[3] -= HOP_TUCK * hop;
      q.tailYaw += (WAG_RADIANS * Math.sin(TAU * WAG_HZ * s) - q.tailYaw) * celebrating;
      q.tailPitch += (CHEER_TAIL - q.tailPitch) * celebrating;
      q.earPitch -= CHEER_EARS * celebrating;
      q.headPitch -= CHEER_HEAD * celebrating;
    }
  }

  // The pushing pose, last, so no lean, stretch, bob, toss, ear or tail is carried into a touching ball (D-27).
  const pushing = pushingWeight(t, time);
  if (pushing > 0) {
    const h = copyPose(q, pushPose);
    h.pitch = clamp(q.pitch, lowest, 0);
    h.stretch = 1;
    h.bob = Math.min(q.bob, PUSH_BOB_MAX);
    h.headPitch = PUSH_HEAD_PITCH;
    h.headYaw = 0;
    h.neckBack = PUSH_NECK_BACK;
    h.neckDown = PUSH_NECK_DOWN;
    h.earPitch = Math.min(q.earPitch, PUSH_EARS);
    h.earSplay = Math.min(q.earSplay, PUSH_SPLAY);
    h.tailPitch = Math.max(q.tailPitch, PUSH_TAIL);
    if (aloftShare > 0) {
      const tuck = aloftShare / total;
      for (let k = 0; k < 4; k++) h.legs[k] = q.legs[k]! + ((k < 2 ? PUSH_TUCK : -PUSH_TUCK) - q.legs[k]!) * tuck;
    }
    // Whole, it's the held pose exactly, its limits unrounded.
    if (pushing >= 1) copyPose(h, q);
    else blendPoses(q, h, pushing, q);
  }
  // The jolt's lurch, head whip and ears, but as far as a ball's contact holds the pose for the fit.
  const free = 1 - contactWeight(t.lastBallContactTick, time);
  q.pitch += joltPitch * free;
  q.headYaw += joltHead * free;
  q.earSplay += joltEars * free;
  if (weights !== undefined) {
    weights.bark = barking;
    weights.celebrate = celebrating;
    weights.pushing = pushing;
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

/** The jaw, the snout's lower half: the snout's geometry mapped onto it, about its hinge at the snout's back. */
function jawMatrix(out: Matrix4, headMatrix: Matrix4, mouth: number, shape: TerrierShape): Matrix4 {
  const { centre: c, radii: r } = shape.snout;
  const hx = c[0] - 0.95 * r[0];
  const hz = c[2] - 0.5 * r[2];
  out.copy(headMatrix).multiply(m1.makeTranslation(hx, 0, hz)).multiply(m2.makeRotationY(mouth)).multiply(m1.makeTranslation(-hx, 0, -hz));
  out.multiply(m1.makeTranslation(c[0] - 0.05 * r[0], 0, c[2] - 0.5 * r[2])).multiply(m2.makeScale(0.9, 0.85, 0.5));
  return out.multiply(m1.makeTranslation(-c[0], 0, -c[2]));
}

/** Writes each part's world matrix for a pose. `root` is the terrier's floor point and heading in world space; the
 *  identity gives the terrier's own frame. */
export function poseParts(root: Matrix4, q: PoseParams, shape: TerrierShape, out: PartMatrices): void {
  // The body: bob, then pitch about its pivot, roll about the heading at its centre, stretched along the heading.
  const c = shape.body.centre;
  body.copy(root).multiply(m1.makeTranslation(0, 0, q.bob));
  body.multiply(m1.makeTranslation(q.pitchPivotX, 0, q.pitchPivotZ)).multiply(m2.makeRotationY(q.pitch)).multiply(m1.makeTranslation(-q.pitchPivotX, 0, -q.pitchPivotZ));
  body.multiply(m1.makeTranslation(c[0], 0, c[2])).multiply(m2.makeRotationX(q.roll)).multiply(m1.makeTranslation(-c[0], 0, -c[2]));
  out.body.copy(body).multiply(m1.makeTranslation(c[0], 0, c[2])).multiply(m2.makeScale(q.stretch, 1, 1));

  // The head, about the neck pivot; the snout and the face share its matrix, the jaw hangs from it.
  const n = shape.neck;
  at(head, body, n[0] - q.neckBack, 0, n[2] - q.neckDown).multiply(m1.makeRotationZ(q.headYaw)).multiply(m2.makeRotationY(q.headPitch));
  out.head.copy(head);
  jawMatrix(out.jaw, head, q.mouth, shape);

  const e = shape.ear.pivot;
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? 1 : -1;
    at(out.ears[k]!, head, e[0], side * e[1], e[2]).multiply(m1.makeRotationX(-side * q.earSplay)).multiply(m2.makeRotationY(q.earPitch));
  }

  const L = shape.legs;
  for (let k = 0; k < 4; k++) {
    at(out.legs[k]!, body, k < 2 ? L.front : L.back, k % 2 === 0 ? L.side : -L.side, L.top).multiply(m1.makeRotationY(q.legs[k]!));
  }

  const tp = shape.tail.pivot;
  at(out.tail, body, tp[0], 0, tp[2]).multiply(m1.makeRotationZ(q.tailYaw)).multiply(m2.makeRotationY(q.tailPitch));

  const b = shape.bandana;
  at(out.bandana, body, b.centre[0], 0, b.centre[2]).multiply(m1.makeRotationY(b.tilt));

  const r = root.elements;
  out.cue.makeTranslation(r[12]!, r[13]!, r[14]!);
}

/** The terrier's floor point and heading as a world matrix: its collider's centre less the collider's radius. */
export function rootMatrix(out: Matrix4, t: { readonly x: number; readonly y: number; readonly z: number; readonly heading: number }, colliderRadius: number): Matrix4 {
  return out.makeRotationZ(t.heading).setPosition(t.x, t.y, t.z - colliderRadius);
}
