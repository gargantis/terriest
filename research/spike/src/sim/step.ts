// One tick of the spike's simulation (PLAN §7.2), for a fixed roster:
//   phase changes (a countdown's end starts play; a celebration's end places
//   the kickoff), then inputs to intents (D-6, D-7, D-10, what D-8's phase
//   allows), then the configuration's substeps of D-5 (4 by default, D-3)
//   with touches, tumbles and the goal test in each, then the timers and
//   the animation fields (D-9).
// The match clock, overtime and the roster events are not in the spike.
// Exact operations only (D-1).

import { angleDiff, datan2, dir } from './angle.ts';
import { NEVER, type Pack, type SimConfig } from './config.ts';
import {
  FRAME_BALL, FRAME_NOSE, frameOf, heldDirection, jumpCount, KEPT_BITS,
  pounceCount, STEP_MASK, STEP_UNITS, ZOOMIES,
} from './input.ts';
import { Physics } from './physics.ts';
import { buildPitch, FLOOR, type Pitch } from './pitch.ts';
import {
  AIRBORNE, type Body, CELEBRATION, ENDED, GETTING_UP, IN_PLAY, KICKOFF_COUNTDOWN, LUNGING,
  type MatchState, placeKickoff, RUNNING, SITTING, STANDING, START_COUNTDOWN, type Terrier,
  TUMBLED, WARM_UP, ZOOMING,
} from './state.ts';

/** The simulation's fixed parts for one configuration and pack size. */
export interface Sim {
  readonly C: SimConfig;
  readonly pitch: Pitch;
  readonly physics: Physics;
  /** Called after every substep: for tests that watch contacts as they
   *  happen. Never part of the simulation's output. */
  probe?: (s: MatchState, sub: number) => void;
}

export function makeSim(C: SimConfig, packSize: number): Sim {
  const pitch = buildPitch(C.pitch);
  return { C, pitch, physics: new Physics(C, pitch, packSize * 2) };
}

const scratch = new Float64Array(2);

/** The solver's body list for a state: its terriers, then the ball. Cached
 *  per state object, since a clone has new ones. */
const bodyLists = new WeakMap<MatchState, Body[]>();
function bodiesOf(_sim: Sim, s: MatchState): Body[] {
  let list = bodyLists.get(s);
  let ok = list !== undefined && list.length === s.terriers.length + 1 && list[s.terriers.length] === s.ball;
  for (let k = 0; ok && k < s.terriers.length; k++) ok = list![k] === s.terriers[k];
  if (!ok) {
    list = [...s.terriers, s.ball];
    bodyLists.set(s, list);
  }
  return list!;
}
const wasOnFloor: boolean[] = [];
const endsLunge = new Uint8Array(64);
const tumbles = new Uint8Array(64);

/** Advances s by one tick with the given inputs, indexed like s.terriers;
 *  null is an absent input (D-10). */
export function step(sim: Sim, s: MatchState, inputs: readonly (number | null)[]): void {
  const C = sim.C;
  const t = s.tick + 1;
  // Phase changes.
  if ((s.phase === KICKOFF_COUNTDOWN || s.phase === START_COUNTDOWN) && t - s.phaseStart >= C.kickoffCountdownTicks) {
    s.phase = IN_PLAY;
    s.phaseStart = t;
  } else if (s.phase === CELEBRATION && t - s.phaseStart >= C.celebrationTicks) {
    placeKickoff(s, C, t);
    s.phase = KICKOFF_COUNTDOWN;
    s.phaseStart = t;
  }
  // Inputs to intents.
  const nT = s.terriers.length;
  for (let k = 0; k < nT; k++) intents(C, s, s.terriers[k]!, inputs[k] ?? null, t);
  // Physics.
  const bodies = bodiesOf(sim, s);
  for (let k = 0; k < nT; k++) wasOnFloor[k] = s.terriers[k]!.onFloor;
  for (let sub = 0; sub < C.substeps; sub++) {
    substep(sim, s, bodies, t);
    for (let k = 0; k < nT; k++) {
      const T = s.terriers[k]!;
      if (wasOnFloor[k] && !T.onFloor) T.takeOffTick = t;
      else if (!wasOnFloor[k] && T.onFloor) T.landingTick = t;
      wasOnFloor[k] = T.onFloor;
    }
    sim.probe?.(s, sub);
  }
  // Timers and animation fields.
  for (let k = 0; k < nT; k++) {
    const T = s.terriers[k]!;
    if (T.lunge > 0) {
      T.lunge--;
      if (T.lunge === 0) T.pounceWait = C.pounceWaitTicks;
    } else if (T.pounceWait > 0) {
      T.pounceWait--;
    }
    if (T.tumble > 0) {
      T.tumble--;
      if (T.tumble === 0) T.guard = C.guardTicks;
    } else if (T.guard > 0) {
      T.guard--;
    }
    animate(C, T, t);
  }
  s.tick = t;
}

function intents(C: SimConfig, s: MatchState, T: Terrier, input: number | null, t: number): void {
  const present = input !== null;
  const cur = present ? input & 0xffff : 0;
  // Presence: a terrier sits after its browser has been silent a while,
  // and is back with its next input (D-16).
  if (present) {
    T.lastInputTick = t;
    T.sitting = false;
  } else if (s.phase !== WARM_UP && t - T.lastInputTick >= C.sitAfterTicks) {
    T.sitting = true;
  }
  // New presses: a changed counter in a present input (D-10). An absent
  // input leaves the previous one unchanged.
  const jumpPress = present && jumpCount(cur) !== jumpCount(T.prevInput);
  const pouncePress = present && pounceCount(cur) !== pounceCount(T.prevInput);
  if (present) T.prevInput = cur & KEPT_BITS;
  // The ball-overhead flag and reference, every tick for every terrier (D-7).
  const ball = s.ball;
  const bx = ball.x - T.x;
  const by = ball.y - T.y;
  const h2 = bx * bx + by * by;
  if (!T.ballOverhead) {
    if (h2 < C.overheadEnter2) {
      T.ballOverhead = true;
      T.overheadRef = T.heading;
    }
  } else if (h2 > C.overheadLeave2) {
    T.ballOverhead = false;
  }
  // What the phase allows (D-8): in countdowns, turn only; in a
  // celebration, run and turn; presses only in play.
  const canAct = T.tumble === 0 && !T.sitting;
  const run = canAct && (s.phase === IN_PLAY || s.phase === CELEBRATION || s.phase === WARM_UP);
  const turn = canAct && s.phase !== ENDED;
  const press = canAct && (s.phase === IN_PLAY || s.phase === WARM_UP);
  const held = heldDirection(cur);
  const frame = frameOf(cur);
  const zoomHeld = (cur & ZOOMIES) !== 0;
  if (!zoomHeld) T.zoomLocked = false;
  const oldHeading = T.heading;
  const d = scratch;
  let speedScale = 0; // the drive's target, along tx, ty, as a fraction of the speed
  let tx = 0;
  let ty = 0;
  let forward = true; // nose frame: f > 0
  if (held) {
    const stepAngle = (cur & STEP_MASK) * STEP_UNITS;
    if (frame === FRAME_NOSE) {
      dir(stepAngle, d);
      const f = d[0]!;
      const side = d[1]!;
      if (turn && T.lunge === 0) T.heading = (T.heading + Math.round(side * C.noseTurnPerTick)) >>> 0;
      dir(T.heading, d);
      tx = d[0]!;
      ty = d[1]!;
      speedScale = f;
      forward = f > 0;
    } else {
      let angle = stepAngle;
      if (frame === FRAME_BALL) angle = ((T.ballOverhead ? T.overheadRef : datan2(by, bx)) + stepAngle) >>> 0;
      if (turn && T.lunge === 0) {
        const diff = angleDiff(T.heading, angle);
        const cap = C.turnPerTick;
        if (diff <= cap && diff >= -cap) T.heading = angle;
        else T.heading = (T.heading + (diff > 0 ? cap : -cap)) >>> 0;
      }
      dir(angle, d);
      tx = d[0]!;
      ty = d[1]!;
      speedScale = 1;
    }
  }
  T.headingChange = angleDiff(oldHeading, T.heading);
  // Zoomies (D-6): held with a direction, a meter not empty, no lockout, on
  // the floor, not lunging; the meter in half-ticks drains 2 and refills 1.
  const zooming = run && held && zoomHeld && forward && T.meter > 0 && !T.zoomLocked && T.onFloor && T.lunge === 0;
  if (zooming) {
    T.meter -= C.meterDrain;
    if (T.meter <= 0) {
      T.meter = 0;
      T.zoomLocked = true;
    }
  } else if (T.meter < C.meterFull) {
    T.meter = Math.min(C.meterFull, T.meter + C.meterRefill);
  }
  T.zooming = zooming;
  // Presses: a jump from the pitch floor, then a pounce along the heading.
  if (press && jumpPress && T.onFloor && T.lunge === 0) {
    T.vz = C.jumpSpeed;
    T.onFloor = false;
    T.takeOffTick = t;
  }
  if (press && pouncePress && T.lunge === 0 && T.pounceWait === 0) {
    dir(T.heading, d);
    T.vx = C.pounceSpeed * d[0]!;
    T.vy = C.pounceSpeed * d[1]!;
    T.lunge = C.lungeTicks;
  }
  // The drive's target (D-6, D-7's nose throttle).
  T.driveOn = run && held;
  let speed = 0;
  if (T.driveOn) {
    if (frame === FRAME_NOSE) {
      if (speedScale > 0) speed = speedScale * (zooming ? C.zoomiesSpeed : C.runSpeed);
      else if (speedScale < 0) speed = speedScale * C.noseReverse;
    } else {
      speed = zooming ? C.zoomiesSpeed : C.runSpeed;
    }
  }
  T.targetVx = speed * tx;
  T.targetVy = speed * ty;
}

function substep(sim: Sim, s: MatchState, bodies: readonly Body[], t: number): void {
  const C = sim.C;
  const P = sim.physics;
  const terriers = s.terriers;
  const ball = s.ball;
  const ballK = P.ball;
  P.forcesAndIntegrate(bodies, terriers);
  P.detect(bodies);
  const bounce = P.support(bodies);
  P.prepare();
  let hit = bounce;
  const inPlay = s.phase === IN_PLAY;
  const pounces = inPlay || s.phase === WARM_UP;
  // Before the contacts are settled: bowling (in play), pounce tumbles, and
  // lunges ended by the ball, a terrier or a wall. All are found from the
  // state as detection left it, then applied, so no contact's order counts.
  const nT = terriers.length;
  endsLunge.fill(0, 0, nT);
  tumbles.fill(0, 0, nT);
  for (let c = 0; c < P.cnt; c++) {
    const i = P.ci[c]!, j = P.cj[c]!;
    const closing = P.closing[c]!;
    if (j === ballK) {
      const T = terriers[i]!;
      if (closing > C.restitutionThreshold && closing > hit) hit = closing;
      if (inPlay && bowled(C, s, T)) tumbles[i] = 1;
      if (T.lunge > 0) endsLunge[i] = 1;
    } else if (j >= 0) {
      const A = terriers[i]!, B = terriers[j]!;
      if (pounces && A.pack !== B.pack) {
        if (A.lunge > 0) tumbles[j] = 1;
        if (B.lunge > 0) tumbles[i] = 1;
      }
      if (A.lunge > 0) endsLunge[i] = 1;
      if (B.lunge > 0) endsLunge[j] = 1;
    } else if (P.pieceSurface(c) !== FLOOR) {
      if (i === ballK) {
        if (closing > C.restitutionThreshold && closing > hit) hit = closing;
      } else if (terriers[i]!.lunge > 0) {
        endsLunge[i] = 1;
      }
    }
  }
  for (let k = 0; k < nT; k++) {
    if (endsLunge[k] === 1) endLunge(C, terriers[k]!);
    if (tumbles[k] === 1) tumble(C, terriers[k]!);
  }
  if (hit > 0) {
    ball.lastHitTick = t;
    ball.lastHitStrength = hit;
  }
  P.solve(bodies);
  P.positions(bodies);
  P.slipOut(bodies, terriers);
  // Touches, contact ticks and pushes (D-8, D-9).
  for (let c = 0; c < P.cnt; c++) {
    const i = P.ci[c]!, j = P.cj[c]!;
    if (j === ballK) {
      const T = terriers[i]!;
      T.lastBallContactTick = t;
      ball.lastContactTick = t;
      if (!T.touchingBall) {
        T.touchingBall = true;
        if (inPlay) T.touches++;
      }
    } else if (j >= 0) {
      terriers[i]!.lastTerrierContactTick = t;
      terriers[j]!.lastTerrierContactTick = t;
    }
    if (P.clambda[c]! > 0 && (j >= 0 || P.pieceSurface(c) !== FLOOR)) {
      if (i !== ballK) push(terriers[i]!, P.pushDirection(c, i), t);
      if (j >= 0 && j !== ballK) push(terriers[j]!, P.pushDirection(c, j), t);
    }
  }
  for (let k = 0; k < terriers.length; k++) {
    const T = terriers[k]!;
    if (T.touchingBall && P.gap(bodies, k, ballK) >= C.rearmGap) T.touchingBall = false;
    if (T.slipping && (T.slipFrom < 0 || bodies[T.slipFrom]!.onFloor)) {
      T.slipping = false;
      T.slipFrom = -1;
    }
  }
  // The goal test, every substep (D-8): the ball's centre more than its
  // radius behind a goal line, while in play. The first goal counts.
  if (inPlay) {
    const line = sim.pitch.goalLineX + C.ballRadius;
    if (ball.x < -line) goal(s, 1, t);
    else if (ball.x > line) goal(s, 0, t);
  }
}

function push(T: Terrier, angle: number, t: number): void {
  if (angle < 0) return;
  T.lastPushDir = angle;
  T.lastPushTick = t;
}

function endLunge(C: SimConfig, T: Terrier): void {
  T.lunge = 0;
  T.pounceWait = C.pounceWaitTicks;
}

function tumble(C: SimConfig, T: Terrier): void {
  if (T.tumble > 0 || T.guard > 0) return;
  T.tumble = C.tumbleTicks;
  if (T.lunge > 0) endLunge(C, T);
  T.driveOn = false;
  T.zooming = false;
  T.targetVx = 0;
  T.targetVy = 0;
}

/** Q-8's bowling rule: the ball's horizontal velocity along the horizontal
 *  line from the ball to the terrier, before the contact is settled, at the
 *  bowling speed or faster, except for a lunging terrier and the terrier
 *  that touched the ball last. No horizontal offset counts as 0. */
function bowled(C: SimConfig, s: MatchState, T: Terrier): boolean {
  if (T.lunge > 0 || T.tumble > 0 || T.guard > 0) return false;
  const ball = s.ball;
  if (ball.lastContactTick !== NEVER && T.lastBallContactTick === ball.lastContactTick) return false;
  const hx = T.x - ball.x;
  const hy = T.y - ball.y;
  const h2 = hx * hx + hy * hy;
  if (h2 === 0) return false;
  return (ball.vx * hx + ball.vy * hy) / Math.sqrt(h2) >= C.bowlingSpeed;
}

/** A goal for pack (D-8): credit to the attackers among the latest touchers,
 *  else an own goal; then the celebration. */
function goal(s: MatchState, pack: Pack, t: number): void {
  s.score[pack]++;
  s.lastGoalTick = t;
  s.lastGoalPack = pack;
  let scorers = 0;
  const last = s.ball.lastContactTick;
  if (last !== NEVER) {
    for (let k = 0; k < s.terriers.length; k++) {
      const T = s.terriers[k]!;
      if (T.lastBallContactTick === last && T.pack === pack) scorers |= 1 << k;
    }
  }
  s.ownGoal = scorers === 0;
  s.scorers = scorers;
  for (let k = 0; k < s.terriers.length; k++) if ((scorers & (1 << k)) !== 0) s.terriers[k]!.goals++;
  s.phase = CELEBRATION;
  s.phaseStart = t;
}

function animate(C: SimConfig, T: Terrier, t: number): void {
  const sp = Math.sqrt(T.vx * T.vx + T.vy * T.vy);
  let a: number;
  if (T.tumble > 0) a = T.tumble > C.getUpTicks ? TUMBLED : GETTING_UP;
  else if (T.sitting) a = SITTING;
  else if (T.lunge > 0) a = LUNGING;
  else if (!T.onFloor) a = AIRBORNE;
  else if (T.zooming) a = ZOOMING;
  else if (T.driveOn || sp > 0.2) a = RUNNING;
  else a = STANDING;
  if (a !== T.anim) {
    T.anim = a;
    T.animStart = t;
  }
  // The gait advances by the distance run this tick, on the floor.
  if (T.onFloor && sp > 0) T.gait = (T.gait + Math.round((sp * C.gaitPerMetre) / 60)) >>> 0;
}
