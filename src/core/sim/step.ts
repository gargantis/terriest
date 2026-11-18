// One tick, in PLAN §7.2's order (design §1.11, §3): events, presence, phase
// changes, inputs to intents, the substeps of D-5 with touches, tumbles and
// the goal test in each, the clock, then the timers and the animation fields.
// The M0 spike's step.ts, its step() skeleton and substep(), with slots in
// place of list indices. step advances its state in place, as roslambo's and
// M0's do; a caller that needs the old state clones it first.
//
// step depends only on its state and inputs (design §0). The Sim holds
// scratch, reused so the loop makes no objects or arrays of its own, but
// nothing in it survives from one call to the next: step binds the slots
// from the state at the start of every call, and every scratch entry is
// written before it's read.
// So one Sim can step any states of its pack size, in any order, as M3's
// timeline steps the final state and its predicted clones through one
// (D-11). The spike's module-level scratch and its per-state body cache are
// gone with that.
// Exact operations only (D-1).

import { canonicalInputs, type TickInput } from './input';
import { advanceTimers, animate, endLunge, recordPush, resolveIntents, tumble } from './movement';
import type { SimParams } from './params';
import { type Intents, Physics } from './physics';
import { FLOOR } from './pitch';
import { advanceClock, applyEvents, applyPhaseChanges, applyPresence, bowled, goalTest } from './rules';
import { type Body, ENDED, IN_PLAY, type MatchState, type Phase, slotOf, type Terrier, WARM_UP } from './state';

/** Touches saturate at A.1's u16. */
const TOUCHES_MAX = 0xffff; // not a setting

/** The simulation's fixed parts for one configuration and pack size, and
 *  its scratch. */
export interface Sim {
  readonly P: SimParams;
  readonly packSize: number;
  readonly physics: Physics;
  /** By slot: terriers, then the ball. Bound from the state at the start of
   *  every step, and again after a step that changes the roster or places
   *  the terriers (design §3). */
  readonly bodies: (Body | null)[];
  /** By terrier slot. */
  readonly terriers: (Terrier | null)[];
  /** This tick's intents, by terrier slot (A.1: not state). */
  readonly intents: Intents;
  /** This tick's canonical inputs: its length is set every step. */
  readonly ins: TickInput[];
  /** By terrier slot: an index into ins, or −1 when absent; refilled by every bind. */
  readonly inputOf: Int32Array;
  // The rest of the scratch, by terrier slot unless named: each entry is
  // written in the step that reads it, before it's read.
  /** Each terrier's floor flag before the substep, for take-off and landing ticks. */
  readonly wasOnFloor: Uint8Array;
  /** The substep's lunges ended and tumbles, found before either is applied. */
  readonly endsLunge: Uint8Array;
  readonly tumbles: Uint8Array;
  /** The ball's velocity after step 2 of the substep: its hit's change is measured from it (A.1). */
  readonly kept: Float64Array;
  /** dir()'s output, for step 4. */
  readonly d: Float64Array;
  /** After every substep: for tests and the tuning page only, never part
   *  of the output. */
  probe?: (s: Readonly<MatchState>, sub: number) => void;
}

/** n nulls, pushed one by one: an array made with new Array(n) stays holey
 *  in V8, and the solver's inner loops index these thousands of times a
 *  tick. */
function packed<T>(n: number): (T | null)[] {
  const list: (T | null)[] = [];
  for (let k = 0; k < n; k++) list.push(null);
  return list;
}

export function makeSim(P: SimParams, packSize: number): Sim {
  if (!(Number.isInteger(packSize) && packSize >= 1 && packSize <= P.packSizeMax)) {
    throw new Error(`a pack size of ${packSize} is outside 1 to ${P.packSizeMax}`);
  }
  const terriers = 2 * packSize;
  return {
    P,
    packSize,
    physics: new Physics(P, packSize),
    bodies: packed<Body>(terriers + 1),
    terriers: packed<Terrier>(terriers),
    intents: {
      driveOn: new Uint8Array(terriers),
      zooming: new Uint8Array(terriers),
      targetVx: new Float64Array(terriers),
      targetVy: new Float64Array(terriers),
    },
    ins: [],
    inputOf: new Int32Array(terriers).fill(-1),
    wasOnFloor: new Uint8Array(terriers),
    endsLunge: new Uint8Array(terriers),
    tumbles: new Uint8Array(terriers),
    kept: new Float64Array(3),
    d: new Float64Array(2),
  };
}

/** sim.bodies, sim.terriers and sim.inputOf from s. Every entry is written:
 *  null and −1 first, then each present terrier's slot, with its input found
 *  by binary search of the ID-sorted sim.ins. */
export function bindSlots(sim: Sim, s: MatchState): void {
  const bodies = sim.bodies;
  const terriers = sim.terriers;
  const inputOf = sim.inputOf;
  const n = terriers.length;
  for (let k = 0; k < n; k++) {
    bodies[k] = null;
    terriers[k] = null;
    inputOf[k] = -1;
  }
  bodies[n] = s.ball;
  const ins = sim.ins;
  const list = s.terriers;
  for (let k = 0; k < list.length; k++) {
    const T = list[k]!;
    const slot = slotOf(T);
    if (!(slot >= 0 && slot < n)) throw new Error(`terrier ${k}'s slot, ${slot}, is outside ${s.packSize} a side`);
    bodies[slot] = T;
    terriers[slot] = T;
    let lo = 0;
    let hi = ins.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ins[mid]!.id < T.id) lo = mid + 1;
      else hi = mid;
    }
    if (lo < ins.length && ins[lo]!.id === T.id) inputOf[slot] = lo;
  }
}

/** Advances s by one tick, in place. Throws if s.packSize ≠ sim.packSize. */
export function step(sim: Sim, s: MatchState, inputs: readonly TickInput[]): void {
  if (s.packSize !== sim.packSize) throw new Error(`a ${s.packSize}-a-side state can't be stepped by a ${sim.packSize}-a-side Sim`);
  const t = s.tick + 1;
  // ENDED is terminal (design §6.6).
  if (s.phase === ENDED) {
    s.tick = t;
    return;
  }
  canonicalInputs(inputs, sim.ins);
  bindSlots(sim, s);
  // 1–3: events, presence and phase changes, binding again after any that
  // changes the roster or places the terriers.
  if (applyEvents(sim, s, t)) bindSlots(sim, s);
  if (applyPresence(sim, s, t)) bindSlots(sim, s);
  if (applyPhaseChanges(sim, s, t)) bindSlots(sim, s);
  // Step 3 may have ended the match: a celebration's end in overtime, or at
  // 0:00 with a pack ahead (design §6.3).
  if ((s.phase as Phase) === ENDED) {
    s.tick = t;
    return;
  }
  const beganInPlay = s.phase === IN_PLAY;
  // 4: inputs to intents.
  resolveIntents(sim, s, t);
  // 5: physics. In warm-up the ball is fixed (design §4.2).
  const physics = sim.physics;
  physics.ballFixed = s.phase === WARM_UP;
  const terriers = sim.terriers;
  const was = sim.wasOnFloor;
  for (let k = 0; k < terriers.length; k++) was[k] = terriers[k]?.onFloor === true ? 1 : 0;
  for (let sub = 0; sub < sim.P.substeps; sub++) {
    substep(sim, s, t);
    for (let k = 0; k < terriers.length; k++) {
      const T = terriers[k];
      if (!T) continue;
      if (was[k] === 1 && !T.onFloor) T.takeOffTick = t;
      else if (was[k] === 0 && T.onFloor) T.landingTick = t;
      was[k] = T.onFloor ? 1 : 0;
    }
    sim.probe?.(s, sub);
  }
  // 6: the clock.
  if (advanceClock(sim, s, t, beganInPlay)) bindSlots(sim, s);
  // 7: timers and animation.
  advanceTimers(sim, s);
  animate(sim, s, t);
  s.tick = t;
}

function substep(sim: Sim, s: MatchState, t: number): void {
  const P = sim.P;
  const ph = sim.physics;
  const bodies = sim.bodies;
  const terriers = sim.terriers;
  const ball = s.ball;
  const ballK = ph.ball;
  // A goal changes the phase within a tick, so it's read each substep.
  const inPlay = s.phase === IN_PLAY;
  const pounces = inPlay || s.phase === WARM_UP;
  ph.forcesAndIntegrate(bodies, terriers, sim.intents);
  const kept = sim.kept;
  kept[0] = ball.vx;
  kept[1] = ball.vy;
  kept[2] = ball.vz;
  ph.detect(bodies);
  let hit = ph.support(bodies);
  ph.prepare();
  // Before the contacts are settled: bowling (in play), pounce tumbles, and
  // lunges ended by the ball, a terrier or a wall. All are found from the
  // state as detection left it, then applied, so no contact's order counts.
  const ends = sim.endsLunge;
  const tumbles = sim.tumbles;
  ends.fill(0);
  tumbles.fill(0);
  for (let c = 0; c < ph.cnt; c++) {
    const i = ph.ci[c]!, j = ph.cj[c]!;
    const closing = ph.closing[c]!;
    if (j === ballK) {
      const T = terriers[i]!;
      if (closing > P.restitutionThreshold && closing > hit) hit = closing;
      if (inPlay && bowled(P, s, T)) tumbles[i] = 1;
      if (T.lunge > 0) ends[i] = 1;
    } else if (j >= 0) {
      const A = terriers[i]!, B = terriers[j]!;
      if (pounces && A.pack !== B.pack) {
        if (A.lunge > 0) tumbles[j] = 1;
        if (B.lunge > 0) tumbles[i] = 1;
      }
      if (A.lunge > 0) ends[i] = 1;
      if (B.lunge > 0) ends[j] = 1;
    } else if (ph.pieceSurface(c) !== FLOOR) {
      if (i === ballK) {
        if (closing > P.restitutionThreshold && closing > hit) hit = closing;
      } else if (terriers[i]!.lunge > 0) {
        ends[i] = 1;
      }
    }
  }
  for (let k = 0; k < terriers.length; k++) {
    const T = terriers[k];
    if (!T) continue;
    if (ends[k] === 1) endLunge(P, T);
    if (tumbles[k] === 1) tumble(sim, T, k);
  }
  if (hit > 0) {
    ball.lastHitTick = t;
    ball.lastHitStrength = hit;
  }
  ph.solve(bodies);
  // The hit's velocity change: the impulses and the floor's bounce, not
  // gravity (A.1). The fixed ball's is 0.
  if (hit > 0) {
    ball.lastHitDvx = ball.vx - kept[0]!;
    ball.lastHitDvy = ball.vy - kept[1]!;
    ball.lastHitDvz = ball.vz - kept[2]!;
  }
  ph.positions(bodies);
  ph.slipOut(bodies, terriers);
  // Touches, contact ticks and pushes (D-8, D-9).
  let pushed = false;
  for (let c = 0; c < ph.cnt; c++) {
    const i = ph.ci[c]!, j = ph.cj[c]!;
    if (j === ballK) {
      const T = terriers[i]!;
      T.lastBallContactTick = t;
      ball.lastContactTick = t;
      if (!T.touchingBall) {
        T.touchingBall = true;
        if (inPlay && T.touches < TOUCHES_MAX) T.touches++;
      }
      if (ph.clambda[c]! > 0) pushed = true;
    } else if (j >= 0) {
      terriers[i]!.lastTerrierContactTick = t;
      terriers[j]!.lastTerrierContactTick = t;
    }
    if (ph.clambda[c]! > 0 && (j >= 0 || ph.pieceSurface(c) !== FLOOR)) {
      if (i !== ballK) recordPush(terriers[i]!, ph.pushDirection(c, i), t);
      if (j >= 0 && j !== ballK) recordPush(terriers[j]!, ph.pushDirection(c, j), t);
    }
  }
  if (pushed) ph.stats.pushes++;
  for (let k = 0; k < terriers.length; k++) {
    const T = terriers[k];
    if (!T) continue;
    if (T.touchingBall && ph.gap(bodies, k, ballK) >= P.rearmGap) T.touchingBall = false;
    // The slip ends once the body above is down, or its slot is empty.
    if (T.slipping) {
      const above = T.slipFrom >= 0 ? bodies[T.slipFrom] : null;
      if (!above || above.onFloor) {
        T.slipping = false;
        T.slipFrom = -1;
      }
    }
  }
  // The goal test, every substep in play (D-8); the first goal counts.
  if (s.phase === IN_PLAY) goalTest(sim, s, t);
}
