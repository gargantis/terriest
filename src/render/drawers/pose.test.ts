import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../../config';
import { defaultParams } from '../../core/sim/params';
import { AIRBORNE, type AnimPhase, GETTING_UP, LUNGING, NEVER, RUNNING, SITTING, STANDING, TUMBLED, ZOOMING } from '../../core/sim/state';
import type { AnimLayer, TerrierFrame } from '../drawer';
import { PLACEHOLDER_LOOK } from '../look';
import {
  newOverlayWeights, newPartMatrices, newPoseParams, phasePose, type PoseParams, poseParts, pushingWeight, rootMatrix, terrierPose,
} from './pose';

// The code-built terrier's pose (M4's design §1.5, §2.4, §2.5, §9.2; D-9,
// D-27, L98): each phase's pose at its start and its end, from the state's
// fields and the seconds since the phase began; the layers blended by
// weight, each timed from its own start; the overlays from the state
// (turning, being pushed, landing, pushing); and the bark's and the
// celebration's overlays. Its fit to the ball is the drawer's test
// (code.test.ts), on the geometry.

const shape = PLACEHOLDER_LOOK.terrier;
const TPS = config.ticksPerSecond;
const TIME = 6000; // a drawn time well into a match, in ticks
const ticks = (seconds: number): number => seconds * TPS;

function frame(over: Partial<TerrierFrame> = {}): TerrierFrame {
  return {
    id: 'terrier', pack: 0, coat: 0, mine: false, x: 0, y: 0, z: defaultParams.terrierRadius, vx: 0, vy: 0, vz: 0,
    heading: 0, headingChange: 0, layers: [{ anim: STANDING, start: TIME, weight: 1 }], gait: 0,
    takeOffTick: NEVER, landingTick: NEVER, lastBallContactTick: NEVER, lastTerrierContactTick: NEVER,
    lastPushDir: 0, lastPushTick: NEVER, bark: null, celebrate: null, ...over,
  };
}

/** One layer of an animation that began `seconds` before TIME. */
const layer = (anim: AnimPhase, seconds = 0, weight = 1): AnimLayer => ({ anim, start: TIME - ticks(seconds), weight });
const pose = (t: TerrierFrame, time = TIME): PoseParams => terrierPose(t, time, shape, newPoseParams());
const phase = (anim: AnimPhase, seconds: number, over: Partial<TerrierFrame> = {}): PoseParams => phasePose(anim, seconds, frame(over), shape);

describe("the phases' poses, from the state and the seconds since each began (D-9, L98)", () => {
  it('stands still at its start, then sways from the seconds since it', () => {
    const q = phase(STANDING, 0);
    expect([q.bob, q.pitch, q.roll, q.headPitch, q.headYaw, q.tailYaw, q.mouth]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(q.legs).toEqual([0, 0, 0, 0]);
    expect(q.stretch).toBe(1);
    const later = phase(STANDING, 1.3);
    expect(later.headYaw).toBeCloseTo(0.25 * Math.sin((2 * Math.PI * 1.3) / 5.3), 12);
    expect(Math.abs(later.tailYaw)).toBeGreaterThan(0);
  });

  it("runs by the gait, as far as its speed against the run speed, whenever the phase began", () => {
    const run = defaultParams.runSpeed;
    const full = phase(RUNNING, 0, { gait: 0.25, vx: run });
    expect(full.legs.map((a) => +a.toFixed(12))).toEqual([0.55, -0.55, -0.55, 0.55]);
    const half = phase(RUNNING, 0, { gait: 0.25, vx: run / 2, vy: 0 });
    expect(half.legs[0]).toBeCloseTo(0.275, 12);
    // The speed is the horizontal one, either way round.
    expect(phase(RUNNING, 0, { gait: 0.25, vx: 0, vy: -run }).legs[0]).toBeCloseTo(0.55, 12);
    expect(phase(RUNNING, 0, { gait: 0, vx: run }).legs).toEqual([0, -0, -0, 0]);
    // Faster than the run speed strides no further.
    expect(phase(RUNNING, 0, { gait: 0.25, vx: 2 * run }).legs[0]).toBeCloseTo(0.55, 12);
    expect(phase(RUNNING, 3.7, { gait: 0.25, vx: run })).toEqual(full);
  });

  it('zooms with a longer stride, stretched out, ears and tail flat', () => {
    const q = phase(ZOOMING, 0.4, { gait: 0.25 });
    expect(q.legs[0]).toBeCloseTo(0.85, 12);
    expect([q.stretch, q.earPitch, q.tailPitch]).toEqual([1.05, -0.6, -1.2]);
  });

  it("raises its nose rising and lowers it falling, by the vertical speed against the jump's", () => {
    const jump = defaultParams.jumpSpeed;
    expect(phase(AIRBORNE, 0, { vz: jump }).pitch).toBeCloseTo(-0.35, 12);
    expect(phase(AIRBORNE, 0.4, { vz: -jump }).pitch).toBeCloseTo(0.35, 12);
    expect(phase(AIRBORNE, 0.2, { vz: 0 }).pitch).toBeCloseTo(0, 12);
    expect(phase(AIRBORNE, 0, { vz: 3 * jump }).pitch).toBeCloseTo(-0.35, 12);
    expect(phase(AIRBORNE, 0, {}).legs).toEqual([-0.7, -0.7, 0.7, 0.7]);
  });

  it('lunges stretched out from its start to its end', () => {
    for (const s of [0, config.lungeSeconds]) {
      const q = phase(LUNGING, s);
      expect([q.stretch, q.pitch, ...q.legs]).toEqual([1.08, 0.1, -1.1, -1.1, 1.0, 1.0]);
    }
  });

  it('rolls over once when tumbled, then lies on its side to the tumble\'s end', () => {
    expect(phase(TUMBLED, 0).roll).toBe(0);
    expect(phase(TUMBLED, 0.3).roll).toBeCloseTo(0.5 * (2 * Math.PI + Math.PI / 2), 12);
    const tumbled = config.tumbleSeconds - config.getUpSeconds;
    for (const s of [0.6, tumbled]) expect(phase(TUMBLED, s).roll).toBeCloseTo(Math.PI / 2, 12);
    // On its side, lower: the roll's own drop.
    expect(phase(TUMBLED, tumbled).bob).toBeCloseTo(-0.085, 12);
  });

  it('gets back on its feet within a quarter second, then shakes itself off by the end of getting up', () => {
    expect(phase(GETTING_UP, 0).roll).toBeCloseTo(Math.PI / 2, 12);
    expect(phase(GETTING_UP, 0.25).roll).toBeCloseTo(0, 12);
    let shook = 0;
    for (let s = 0.25; s < 0.5; s += 1 / TPS) shook = Math.max(shook, Math.abs(phase(GETTING_UP, s).roll));
    expect(shook).toBeGreaterThan(0.1);
    expect(shook).toBeLessThanOrEqual(0.25);
    const end = phase(GETTING_UP, config.getUpSeconds);
    expect([end.roll, end.headYaw, end.earSplay].map((v) => +v.toFixed(12))).toEqual([0, 0, 0.35]);
  });

  it('sits back on its haunches about its back hips within a quarter second, and stays sat', () => {
    const start = phase(SITTING, 0);
    expect([start.pitch, start.bob]).toEqual([-0, -0]);
    expect([start.pitchPivotX, start.pitchPivotZ]).toEqual([shape.legs.back, shape.legs.top - shape.legs.radius / 2]);
    for (const s of [0.25, 30]) {
      const q = phase(SITTING, s);
      expect(q.pitch).toBeCloseTo(-0.55, 12);
      expect(q.bob).toBeCloseTo(-0.06, 12);
    }
  });
});

describe('the layers, blended by weight, each timed from its own start (§2.4, L208)', () => {
  it("blends a phase change's two animations by their weights", () => {
    const q = pose(frame({ layers: [layer(TUMBLED, 0.3, 0.25), layer(STANDING, 0, 0.75)] }));
    expect(q.roll).toBeCloseTo(0.25 * phase(TUMBLED, 0.3).roll, 12);
    expect(q.earSplay).toBeCloseTo(0.25 * 0.9 + 0.75 * 0.35, 12);
  });

  it("cross-fades one animation between two timings, as a correction's move does", () => {
    const q = pose(frame({ layers: [layer(TUMBLED, 0.3, 0.5), layer(TUMBLED, 0.25, 0.5)] }));
    expect(q.roll).toBeCloseTo((phase(TUMBLED, 0.3).roll + phase(TUMBLED, 0.25).roll) / 2, 12);
  });

  it('takes the weights as shares, and draws a terrier with no layers standing', () => {
    const shares = pose(frame({ layers: [layer(TUMBLED, 0.3, 2), layer(STANDING, 0, 2)] }));
    expect(shares).toEqual(pose(frame({ layers: [layer(TUMBLED, 0.3, 0.5), layer(STANDING, 0, 0.5)] })));
    expect(pose(frame({ layers: [] }))).toEqual(phase(STANDING, 0));
    expect(pose(frame({ layers: [layer(SITTING, 1, 0), layer(STANDING, 0, 1)] }))).toEqual(pose(frame()));
  });

  it('draws the same pose from the same state and drawn time, whatever it drew between: no clock of its own (L345)', () => {
    const t = frame({ layers: [layer(GETTING_UP, 0.3, 0.6), layer(RUNNING, 0.1, 0.4)], vx: 4, gait: 0.3, lastPushTick: TIME - 4, lastPushDir: 2 });
    const first = pose(t, TIME + 0.4);
    for (let k = 0; k < 5; k++) pose(frame({ layers: [layer(TUMBLED, k / 10)] }), TIME + k);
    expect(pose(t, TIME + 0.4)).toEqual(first);
  });
});

describe('the overlays from the state: turning, being pushed, landing (D-9, L98)', () => {
  const fullTurn = (2 * Math.PI * config.turnRateTurnsPerSecond) / TPS;

  it('turns its head into a turn, leans into it with its speed, and swings its tail out, by the heading change', () => {
    const run = defaultParams.runSpeed;
    const straight = pose(frame({ layers: [layer(RUNNING)], vx: run }));
    const left = pose(frame({ layers: [layer(RUNNING)], vx: run, headingChange: fullTurn }));
    expect(left.headYaw - straight.headYaw).toBeCloseTo(0.3, 12);
    expect(left.roll - straight.roll).toBeCloseTo(-0.12, 12);
    expect(left.tailYaw - straight.tailYaw).toBeCloseTo(-0.4, 12);
    const right = pose(frame({ layers: [layer(RUNNING)], vx: run, headingChange: -fullTurn / 2 }));
    expect(right.headYaw - straight.headYaw).toBeCloseTo(-0.15, 12);
    // Turning on the spot, as in a countdown: no lean; and no turn is faster than the turn rate's.
    expect(pose(frame({ headingChange: fullTurn })).roll).toBe(0);
    expect(pose(frame({ headingChange: 5 * fullTurn })).headYaw).toBeCloseTo(0.3, 12);
  });

  it('jolts the way it was pushed relative to its heading, from the push\'s tick, settled within a third of a second', () => {
    const still = pose(frame());
    // Facing −x, so a push read in the world's terms, not the terrier's, would jolt it the other way.
    const heading = Math.PI;
    const at = (rel: number, ago: number, h = heading): PoseParams => pose(frame({ lastPushTick: TIME - ago, lastPushDir: h + rel, heading: h }));
    // Pushed to its left: it tips left, its head whips right.
    const left = at(Math.PI / 2, 6);
    expect(left.roll).toBeLessThan(-0.1);
    expect(left.headYaw).toBeLessThan(still.headYaw - 0.1);
    // From behind, it lurches forward; from in front, back.
    expect(at(0, 6).pitch).toBeGreaterThan(0.1);
    expect(at(Math.PI, 6).pitch).toBeLessThan(-0.1);
    // The same push relative to its heading jolts it alike whichever way it faces.
    for (const h of [0, 1, -2.5]) expect(at(Math.PI / 2, 6, h).roll, `heading ${h}`).toBeCloseTo(left.roll, 12);
    expect(at(Math.PI / 2, 0).roll).toBeCloseTo(0, 12);
    expect(at(Math.PI / 2, ticks(1 / 3))).toEqual(still);
    // Not before its tick, and never for a push that never happened.
    expect(pose(frame({ lastPushTick: TIME + 1, lastPushDir: 2.5 }))).toEqual(still);
    expect(pose(frame({ lastPushTick: NEVER, lastPushDir: 2.5 }))).toEqual(still);
  });

  it('squashes on landing, legs splayed and body as low as keeps its feet on the floor, then stands again', () => {
    const still = pose(frame());
    const q = pose(frame({ landingTick: TIME - 5 }));
    expect(q.legs[0]).toBeLessThan(-0.2);
    expect(q.legs[2]).toBeGreaterThan(0.2);
    expect(q.bob).toBeLessThan(-0.005);
    // The lowest point of each leg's capsule, from the leg's own matrix.
    const m = newPartMatrices();
    poseParts(new Matrix4(), q, shape, m);
    const L = shape.legs;
    for (const leg of m.legs) {
      const foot = new Vector3(0, 0, -(L.length - L.radius)).applyMatrix4(leg);
      expect(foot.z - L.radius).toBeGreaterThanOrEqual(-1e-12);
      expect(foot.z - L.radius).toBeLessThan(0.002);
    }
    expect(pose(frame({ landingTick: TIME - ticks(0.2) }))).toEqual(still);
    // On its side, a landing squashes nothing.
    expect(pose(frame({ layers: [layer(TUMBLED, 1)], landingTick: TIME - 5 }))).toEqual(pose(frame({ layers: [layer(TUMBLED, 1)] })));
  });
});

describe('the pushing pose (D-27, A.4: Pushing pose)', () => {
  const pushTicks = config.pushPoseTicks;
  const blendTicks = (config.animationBlendMs / 1000) * TPS;

  it('lowers and draws back its head after a contact with the ball or a terrier, for config.pushPoseTicks', () => {
    for (const contact of ['lastBallContactTick', 'lastTerrierContactTick'] as const) {
      for (const ago of [0, pushTicks / 2, pushTicks]) {
        const q = pose(frame({ layers: [layer(ZOOMING)], gait: 0.2, [contact]: TIME - ago }));
        expect([q.headPitch, q.headYaw, q.neckBack, q.neckDown, q.stretch, q.pitch], `${contact} ${ago} ticks ago`).toEqual([0.4, 0, 0.03, 0.04, 1, 0]);
        expect(q.bob).toBeLessThanOrEqual(0.01);
        expect(q.earPitch).toBeLessThanOrEqual(-0.8);
        expect(q.tailPitch).toBeGreaterThanOrEqual(0.15);
      }
    }
  });

  it('then lets go over config.animationBlendMs, and draws nothing before the contact', () => {
    const t = (ago: number): TerrierFrame => frame({ lastBallContactTick: TIME - ago });
    expect(pushingWeight(t(pushTicks), TIME)).toBe(1);
    expect(pushingWeight(t(pushTicks + blendTicks / 2), TIME)).toBeCloseTo(0.5, 12);
    expect(pushingWeight(t(pushTicks + blendTicks), TIME)).toBe(0);
    const free = pose(frame());
    const halfway = pose(t(pushTicks + blendTicks / 2));
    expect(halfway.headPitch).toBeCloseTo((free.headPitch + 0.4) / 2, 12);
    expect(pose(t(pushTicks + blendTicks))).toEqual(free);
    expect(pose(frame({ lastBallContactTick: TIME + 1 }))).toEqual(free);
    expect(pushingWeight(frame({ lastBallContactTick: NEVER, lastTerrierContactTick: NEVER }), TIME)).toBe(0);
    // The later of the two contacts counts.
    expect(pushingWeight(frame({ lastBallContactTick: TIME - 40, lastTerrierContactTick: TIME - 2 }), TIME)).toBe(1);
  });

  it('holds a rising nose level on its feet, and a sitting terrier\'s lean back no further than its own', () => {
    const contact = { lastBallContactTick: TIME - 1 };
    expect(pose(frame({ layers: [layer(AIRBORNE)], vz: defaultParams.jumpSpeed, ...contact })).pitch).toBe(0);
    // Pushed from in front, which raises the nose, while touching the ball.
    const back = { lastPushTick: TIME - 6, lastPushDir: Math.PI };
    expect(pose(frame({ layers: [layer(RUNNING)], vx: 3, ...back, ...contact })).pitch).toBe(0);
    const sat = pose(frame({ layers: [layer(SITTING, 2)], ...back, ...contact }));
    expect(sat.pitch).toBeCloseTo(-0.55, 12);
  });
});

describe('the bark and the celebration, the overlays the view hands in (D-16, D-14, L98, §2.5)', () => {
  const bark = (secondsAgo: number, weight = 1): Partial<TerrierFrame> => ({ bark: { start: TIME - ticks(secondsAgo), weight } });

  it('opens its jaw and tosses its nose up from the bark\'s start, closed again before the view stops showing it', () => {
    const still = pose(frame());
    expect(pose(frame(bark(0)))).toEqual(still);
    const woof = pose(frame(bark(0.1)));
    expect(woof.mouth).toBeGreaterThan(0.4);
    expect(woof.headPitch).toBeLessThan(still.headPitch - 0.2);
    // The view shows a bark for 0.4 s of drawn time from its start (src/render/view.ts): shut by then.
    expect(pose(frame(bark(23 / TPS)))).toEqual(still);
    // Not before its start; half as much at half its weight.
    expect(pose(frame(bark(-0.05)))).toEqual(still);
    expect(pose(frame(bark(0.1, 0.5))).mouth).toBeCloseTo(woof.mouth / 2, 12);
  });

  it('barks over any animation', () => {
    for (const anim of [RUNNING, AIRBORNE, LUNGING, TUMBLED, GETTING_UP, SITTING] as const) {
      const over = pose(frame({ layers: [layer(anim, 0.2)], ...bark(0.1) }));
      expect(over.mouth - pose(frame({ layers: [layer(anim, 0.2)] })).mouth, `${anim}`).toBeGreaterThan(0.4);
    }
  });

  it("celebrates over standing and running with hops and a wagging tail, timed from the goal's tick", () => {
    const cheer = (anim: AnimPhase, secondsAgo: number, weight = 1): PoseParams =>
      pose(frame({ layers: [layer(anim, 1)], vx: anim === RUNNING ? 3 : 0, celebrate: { start: TIME - ticks(secondsAgo), weight } }));
    const base = pose(frame({ layers: [layer(STANDING, 1)] }));
    // A hop every 0.42 s, on the floor at each hop's start and up in the middle of it.
    expect(cheer(STANDING, 0).bob).toBeCloseTo(base.bob, 12);
    expect(cheer(STANDING, 0.21).bob - base.bob).toBeCloseTo(0.07, 12);
    expect(cheer(STANDING, 0.42).bob).toBeCloseTo(base.bob, 12);
    // The tail up and wagging, either way.
    const wags = [0.05, 0.15].map((s) => cheer(STANDING, 0.84 + s).tailYaw);
    expect(Math.sign(wags[0]!)).toBe(-Math.sign(wags[1]!));
    expect(cheer(STANDING, 1).tailPitch).toBeCloseTo(-1.1, 12);
    expect(cheer(RUNNING, 0.21).bob).toBeGreaterThan(pose(frame({ layers: [layer(RUNNING, 1)], vx: 3 })).bob + 0.05);
    // Part-way through, as it shows from the goal's confirmed tick (L208); half as much at half its weight.
    expect(cheer(STANDING, 2.31).bob - base.bob).toBeCloseTo(0.07, 12);
    expect(cheer(STANDING, 0.21, 0.5).bob - base.bob).toBeCloseTo(0.035, 12);
    // Not over the other phases.
    for (const anim of [ZOOMING, AIRBORNE, LUNGING, TUMBLED, GETTING_UP, SITTING] as const) {
      expect(cheer(anim, 0.21), `${anim}`).toEqual(pose(frame({ layers: [layer(anim, 1)] })));
    }
  });

  it('celebrates over the share of its layers standing or running, and reports each overlay\'s weight', () => {
    const w = newOverlayWeights();
    const t = frame({
      layers: [layer(TUMBLED, 1, 0.5), layer(STANDING, 0.1, 0.5)], celebrate: { start: TIME - 12, weight: 0.8 },
      bark: { start: TIME - 3, weight: 0.6 }, lastTerrierContactTick: TIME - 1,
    });
    terrierPose(t, TIME, shape, newPoseParams(), w);
    expect(w).toEqual({ bark: 0.6, celebrate: 0.4, pushing: 1 });
    terrierPose(frame(), TIME, shape, newPoseParams(), w);
    expect(w).toEqual({ bark: 0, celebrate: 0, pushing: 0 });
  });
});

describe('the parts (D-27)', () => {
  it("roots the terrier at its collider's floor point, turned to its heading", () => {
    const m = rootMatrix(new Matrix4(), { x: 3, y: -2, z: 1.25, heading: Math.PI / 2 }, defaultParams.terrierRadius);
    expect(new Vector3(0, 0, 0).applyMatrix4(m).toArray()).toEqual([3, -2, 1.25 - defaultParams.terrierRadius]);
    const nose = new Vector3(1, 0, 0).applyMatrix4(m);
    expect([nose.x, nose.y, nose.z].map((v) => +v.toFixed(12))).toEqual([3, -1, 1]);
  });

  it('hangs the jaw under the snout, closed with the mouth shut and dropped at the front as it opens', () => {
    const m = newPartMatrices();
    const snoutFront = (n: Matrix4): Vector3 => new Vector3(shape.snout.centre[0] + shape.snout.radii[0], 0, shape.snout.centre[2]).applyMatrix4(n);
    poseParts(new Matrix4(), phase(STANDING, 0), shape, m);
    const shut = snoutFront(m.jaw);
    // Closed, the jaw is the snout's lower half, inside its front.
    expect(shut.x).toBeLessThan(snoutFront(m.head).x);
    expect(shut.z).toBeLessThan(snoutFront(m.head).z);
    const open = { ...phase(STANDING, 0), mouth: 0.5 };
    poseParts(new Matrix4(), open, shape, m);
    expect(snoutFront(m.jaw).z).toBeLessThan(shut.z - 0.02);
  });

  it("stands the pack cue's base on the floor point, world-aligned, whatever the pose", () => {
    const root = rootMatrix(new Matrix4(), { x: -4, y: 6, z: 2, heading: 2 }, defaultParams.terrierRadius);
    const m = newPartMatrices();
    poseParts(root, { ...phase(TUMBLED, 0.4), bob: 0.3 }, shape, m);
    expect(m.cue.equals(new Matrix4().makeTranslation(-4, 6, 2 - defaultParams.terrierRadius))).toBe(true);
  });
});
