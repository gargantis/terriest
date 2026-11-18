// Inputs to intents, PLAN §7.2's step 4 (D-6, D-7, D-8, D-10), and step 7,
// the timers and the animation fields (D-9); plus the helpers the
// substep's contact rules call (design §1.9, §4.3, §5). The M0 spike's
// step.ts: its intents() without its presence lines, which are step 2's
// now (rules.ts), its timers block, animate(), endLunge(), tumble() and
// push(). Intents go to sim.intents by terrier slot, not into the state
// (A.1); the phases are A.1's, with the start countdown; the gait divides
// by the ticks a second and its running threshold is a setting. New at M2:
// C-18's ball-frame push assist (design §4.4), off by default.
// Exact operations only (D-1).

import {
  FRAME_BALL, FRAME_NOSE, frameOf, heldDirection, jumpCount, KEPT_BITS, pounceCount, STEP_MASK, STEP_UNITS, ZOOMIES,
} from './input';
import { angleDiff, datan2, dir } from './math';
import type { SimParams } from './params';
import {
  AIRBORNE, type AnimPhase, CELEBRATION, ENDED, GETTING_UP, IN_PLAY, LUNGING, type MatchState, RUNNING, SITTING, slotOf, STANDING,
  type Terrier, TUMBLED, WARM_UP, ZOOMING,
} from './state';
import type { Sim } from './step';

/** Step 4 for every terrier, in list order: its input (present when
 *  sim.inputOf names one), new presses, the ball-overhead flag, what the
 *  phase allows, the direction in its frame, zoomies and the meter, a jump
 *  then a pounce, and the drive's target. */
export function resolveIntents(sim: Sim, s: MatchState, t: number): void {
  const list = s.terriers;
  for (let k = 0; k < list.length; k++) resolveOne(sim, s, list[k]!, t);
}

function resolveOne(sim: Sim, s: MatchState, T: Terrier, t: number): void {
  const P = sim.P;
  const intents = sim.intents;
  const slot = slotOf(T);
  const at = sim.inputOf[slot]!;
  const present = at >= 0;
  // Every number is a valid input: masked to 16 bits as it's read (A.2).
  const cur = present ? (sim.ins[at]!.input >>> 0) & 0xffff : 0;
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
    if (h2 < P.overheadEnter2) {
      T.ballOverhead = true;
      T.overheadRef = T.heading;
    }
  } else if (h2 > P.overheadLeave2) {
    T.ballOverhead = false;
  }
  // What the phase allows (D-8): in countdowns, turn only; in a
  // celebration, run and turn; presses in warm-up and in play. A press
  // that can't act was still taken above, so it's dropped (D-10).
  const canAct = T.tumble === 0 && !T.sitting;
  const run = canAct && (s.phase === IN_PLAY || s.phase === CELEBRATION || s.phase === WARM_UP);
  const turn = canAct && s.phase !== ENDED;
  const press = canAct && (s.phase === IN_PLAY || s.phase === WARM_UP);
  const held = heldDirection(cur);
  const frame = frameOf(cur);
  const zoomHeld = (cur & ZOOMIES) !== 0;
  if (!zoomHeld) T.zoomLocked = false;
  const oldHeading = T.heading;
  const d = sim.d;
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
      if (turn && T.lunge === 0) T.heading = (T.heading + Math.round(side * P.noseTurnPerTick)) >>> 0;
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
        const cap = P.turnPerTick;
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
    T.meter -= P.meterDrain;
    if (T.meter <= 0) {
      T.meter = 0;
      T.zoomLocked = true;
    }
  } else if (T.meter < P.meterFull) {
    T.meter = Math.min(P.meterFull, T.meter + P.meterRefill);
  }
  intents.zooming[slot] = zooming ? 1 : 0;
  // Presses: a jump from the pitch floor, then a pounce along the heading.
  if (press && jumpPress && T.onFloor && T.lunge === 0) {
    T.vz = P.jumpSpeed;
    T.onFloor = false;
    T.takeOffTick = t;
  }
  if (press && pouncePress && T.lunge === 0 && T.pounceWait === 0) {
    dir(T.heading, d);
    T.vx = P.pounceSpeed * d[0]!;
    T.vy = P.pounceSpeed * d[1]!;
    T.lunge = P.lungeTicks;
  }
  // The drive's target (D-6, D-7's nose throttle, C-18's push assist).
  const driveOn = run && held;
  intents.driveOn[slot] = driveOn ? 1 : 0;
  let speed = 0;
  if (driveOn) {
    if (frame === FRAME_NOSE) {
      if (speedScale > 0) speed = speedScale * (zooming ? P.zoomiesSpeed : P.runSpeed);
      else if (speedScale < 0) speed = speedScale * P.noseReverse;
    } else {
      speed = zooming ? P.zoomiesSpeed : P.runSpeed;
      // C-18's ball-frame push assist (design §4.4). A pusher holding within
      // a step of forward (steps 31, 0 and 1) and touching a ball that moves
      // faster than the restitution threshold, 0.3 m/s, drives along its
      // direction d at base / cos φ, where cos φ = d·u and u is the ball's
      // direction, capped: so its speed along the ball's travel is its base
      // speed until the cap binds. A cap of 0 is off and skips it all, so
      // nothing changes. One square root and one division (D-1).
      if (P.pushAssistCap > 0 && frame === FRAME_BALL && T.touchingBall && ((cur + 1) & STEP_MASK) <= 2) {
        const vx = ball.vx;
        const vy = ball.vy;
        const along = tx * vx + ty * vy; // |v| cos φ, d = (tx, ty) a unit vector
        if (along > 0) {
          const sp = Math.sqrt(vx * vx + vy * vy);
          // cos φ < 1: a pusher on the ball's travel keeps its base speed,
          // bit for bit on an axis, where dir() is exact; off the axes cos φ
          // can round just under 1, and its speed gains an ulp. "Moving" is
          // design §4.4's 0.3 m/s, read from the restitution threshold, not
          // a key of its own: tuning the threshold moves the assist too.
          if (along < sp && sp > P.restitutionThreshold) {
            const assisted = (speed * sp) / along;
            if (assisted > speed) speed = assisted < P.pushAssistCap ? assisted : P.pushAssistCap;
          }
        }
      }
    }
  }
  intents.targetVx[slot] = speed * tx;
  intents.targetVy[slot] = speed * ty;
}

/** A lunge ends: lunge 0, and the pounce wait starts (D-6). */
export function endLunge(P: SimParams, T: Terrier): void {
  T.lunge = 0;
  T.pounceWait = P.pounceWaitTicks;
}

/** A tumble (D-6), unless the terrier is tumbled or guarded already: it ends
 *  any lunge and clears the terrier's intents for the rest of the tick. */
export function tumble(sim: Sim, T: Terrier, slot: number): void {
  if (T.tumble > 0 || T.guard > 0) return;
  T.tumble = sim.P.tumbleTicks;
  if (T.lunge > 0) endLunge(sim.P, T);
  const intents = sim.intents;
  intents.driveOn[slot] = 0;
  intents.zooming[slot] = 0;
  intents.targetVx[slot] = 0;
  intents.targetVy[slot] = 0;
}

/** The last push a terrier received (D-9): its direction as a binary angle,
 *  and its tick. An angle of −1, a purely vertical push, records none. */
export function recordPush(T: Terrier, angle: number, t: number): void {
  if (angle < 0) return;
  T.lastPushDir = angle;
  T.lastPushTick = t;
}

/** Step 7a: the lunge, the pounce wait, the tumble and the guard count down;
 *  a lunge's end starts the wait, and a tumble's end the guard (D-6). */
export function advanceTimers(sim: Sim, s: MatchState): void {
  const P = sim.P;
  const list = s.terriers;
  for (let k = 0; k < list.length; k++) {
    const T = list[k]!;
    if (T.lunge > 0) {
      T.lunge--;
      if (T.lunge === 0) T.pounceWait = P.pounceWaitTicks;
    } else if (T.pounceWait > 0) {
      T.pounceWait--;
    }
    if (T.tumble > 0) {
      T.tumble--;
      if (T.tumble === 0) T.guard = P.guardTicks;
    } else if (T.guard > 0) {
      T.guard--;
    }
  }
}

/** Step 7b, D-9: each terrier's animation phase and the tick it began, and
 *  its gait, advanced by the distance run this tick on the floor. */
export function animate(sim: Sim, s: MatchState, t: number): void {
  const P = sim.P;
  const intents = sim.intents;
  const list = s.terriers;
  for (let k = 0; k < list.length; k++) {
    const T = list[k]!;
    const slot = slotOf(T);
    const sp = Math.sqrt(T.vx * T.vx + T.vy * T.vy);
    let a: AnimPhase;
    if (T.tumble > 0) a = T.tumble > P.getUpTicks ? TUMBLED : GETTING_UP;
    else if (T.sitting) a = SITTING;
    else if (T.lunge > 0) a = LUNGING;
    else if (!T.onFloor) a = AIRBORNE;
    else if (intents.zooming[slot] === 1) a = ZOOMING;
    else if (intents.driveOn[slot] === 1 || sp > P.runningMinSpeed) a = RUNNING;
    else a = STANDING;
    if (a !== T.anim) {
      T.anim = a;
      T.animStart = t;
    }
    // The spike's literal 60 is the ticks a second, divided by, not
    // multiplied by a tick's seconds, which would round differently.
    if (T.onFloor && sp > 0) T.gait = (T.gait + Math.round((sp * P.gaitUnitsPerMetre) / P.config.ticksPerSecond)) >>> 0;
  }
}
