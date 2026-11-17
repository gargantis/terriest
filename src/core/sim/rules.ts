// The match rules, PLAN D-8 and D-12 (design §1.10, §6): events, presence,
// phases, kickoffs and arrivals, Q-8's bowling, goals and credit, the clock,
// the end and the Terriest. Phase 2 writes the subset the M0 spike's tests
// need, from its step.ts (bowled, goal, the phase changes) and state.ts
// (placeKickoff): events as a no-op, presence with sitting only, a
// countdown's end and a celebration's end to a kickoff, the kickoff
// placement by ID rank, bowling, the goal test and credit, the clock as a
// no-op, and the winner and the Terriest. Phase 3's rules builder completes
// it from roslambo's rules.ts: the events, removal and Ready, the start
// countdown, the clock, overtime, the end, arrivals and vacated slots. The
// signatures are final.
// Exact operations only (D-1).

import { datan2 } from './math';
import type { SimParams } from './params';
import {
  CELEBRATION, ENDED, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, NEVER, type Pack, SITTING, slotOf, sortTerriers, STANDING,
  START_COUNTDOWN, type Terrier, WARM_UP,
} from './state';
import type { Sim } from './step';

/** A u8 counter's ceiling: scores and goals saturate there (A.1). */
const U8_MAX = 255; // not a setting

/** Step 1 (design §6.1): the roster events, in warm-up only; true if the
 *  roster or a slot changed. Reads s and sim.ins only. Phase 3. */
export function applyEvents(_sim: Sim, _s: MatchState, _t: number): boolean {
  return false;
}

/** Step 2 (design §6.2): each terrier with an input this tick was heard
 *  from now and stands; from the start countdown on, a terrier silent for
 *  the sitting threshold sits (D-16). True if a terrier was removed, which
 *  phase 3's warm-up removal adds. */
export function applyPresence(sim: Sim, s: MatchState, t: number): boolean {
  const P = sim.P;
  const list = s.terriers;
  for (let k = 0; k < list.length; k++) {
    const T = list[k]!;
    if (sim.inputOf[slotOf(T)]! >= 0) {
      T.lastInputTick = t;
      T.sitting = false;
    } else if (s.phase !== WARM_UP && t - T.lastInputTick >= P.sitAfterTicks) {
      T.sitting = true;
    }
  }
  return false;
}

/** Step 3 (design §6.3): a countdown's end starts play, and a celebration's
 *  end starts a kickoff countdown with its placement. True if it placed the
 *  terriers. Phase 3 adds Ready's expiry, the start countdown, and a
 *  celebration's end in overtime or at 0:00. */
export function applyPhaseChanges(sim: Sim, s: MatchState, t: number): boolean {
  const P = sim.P;
  if (
    (s.phase === START_COUNTDOWN && t - s.phaseStart >= P.startCountdownTicks) ||
    (s.phase === KICKOFF_COUNTDOWN && t - s.phaseStart >= P.kickoffCountdownTicks)
  ) {
    s.phase = IN_PLAY;
    s.phaseStart = t;
    return false;
  }
  if (s.phase === CELEBRATION && t - s.phaseStart >= P.celebrationTicks) {
    placeKickoff(sim, s, t);
    s.phase = KICKOFF_COUNTDOWN;
    s.phaseStart = t;
    return true;
  }
  return false;
}

/** D-8's kickoff placement (design §6.4). Within each pack, terriers sorted
 *  by player ID, a string compare, take spots 0, 1, … in that order, and
 *  the list goes back into (spot, pack) order: step binds the slots again.
 *  Every terrier, sitting ones included, is at rest on its spot, pack B's
 *  the point mirror of pack A's, facing the ball, with no overhead flag,
 *  slip, zoomies lockout, timers or touch, a full meter, and its animation
 *  sitting or standing. The ball is at rest on the centre spot. The previous
 *  input, the counts and the contact, take-off, landing and push ticks stay
 *  (D-10, D-16). The scorers clear, and so do the tick's intents, so step 7
 *  doesn't animate a terrier just placed as running. */
export function placeKickoff(sim: Sim, s: MatchState, t: number): void {
  const P = sim.P;
  const list = s.terriers;
  // Ranks by ID within each pack: `<`, never localeCompare (D-38).
  for (let k = 0; k < list.length; k++) {
    const T = list[k]!;
    let rank = 0;
    for (let j = 0; j < list.length; j++) {
      const U = list[j]!;
      if (U.pack === T.pack && U.id < T.id) rank++;
    }
    T.spot = rank;
  }
  sortTerriers(s);
  const b = s.ball;
  b.x = 0; b.y = 0; b.z = P.ballRadius; b.vx = 0; b.vy = 0; b.vz = 0; b.onFloor = true;
  for (let k = 0; k < list.length; k++) {
    const T = list[k]!;
    const spot = P.kickoffSpots[T.pack][s.packSize]?.[T.spot];
    if (!spot) throw new Error(`no kickoff spot ${T.spot} for pack ${T.pack} at ${s.packSize} a side (A.5)`);
    T.x = spot[0];
    T.y = spot[1];
    T.z = P.terrierRadius;
    T.vx = 0; T.vy = 0; T.vz = 0; T.onFloor = true;
    T.heading = datan2(-T.y, -T.x);
    T.overheadRef = T.heading;
    T.ballOverhead = false;
    T.slipping = false;
    T.slipFrom = -1;
    T.zoomLocked = false;
    T.meter = P.meterFull;
    T.pounceWait = 0; T.lunge = 0; T.tumble = 0; T.guard = 0;
    T.touchingBall = false;
    T.headingChange = 0;
    const anim = T.sitting ? SITTING : STANDING;
    if (T.anim !== anim) {
      T.anim = anim;
      T.animStart = t;
    }
  }
  s.scorers = 0;
  const intents = sim.intents;
  intents.driveOn.fill(0);
  intents.zooming.fill(0);
  intents.targetVx.fill(0);
  intents.targetVy.fill(0);
}

/** A warm-up arrival (design §6.5): reads s, never sim.bodies. Phase 3. */
export function placeArrival(_sim: Sim, _s: MatchState, _T: Terrier, _t: number): void {
  throw new Error('warm-up arrivals arrive with the rules, in phase 3 (design §6.5)');
}

/** Frees a slot: every terrier's slipping flag and slipFrom that name it
 *  clear. LEAVE, removal and SWITCH all call it (design §6.1). Phase 3. */
export function vacate(_s: MatchState, _slot: number): void {
  throw new Error('vacating a slot arrives with the rules, in phase 3 (design §6.1)');
}

/** Vacates a terrier's slot, then removes it (design §6.1). Phase 3. */
export function removeTerrier(_s: MatchState, _index: number): void {
  throw new Error('removal arrives with the rules, in phase 3 (design §6.1)');
}

/** Q-8's bowling rule: the ball's horizontal velocity along the horizontal
 *  line from the ball to the terrier, read before the contact is settled,
 *  at the bowling speed or faster. Never a lunging, tumbled or guarded
 *  terrier, or the one that touched the ball last; no horizontal offset
 *  counts as 0. */
export function bowled(P: SimParams, s: Readonly<MatchState>, T: Readonly<Terrier>): boolean {
  if (T.lunge > 0 || T.tumble > 0 || T.guard > 0) return false;
  const ball = s.ball;
  if (ball.lastContactTick !== NEVER && T.lastBallContactTick === ball.lastContactTick) return false;
  const hx = T.x - ball.x;
  const hy = T.y - ball.y;
  const h2 = hx * hx + hy * hy;
  if (h2 === 0) return false;
  return (ball.vx * hx + ball.vy * hy) / Math.sqrt(h2) >= P.bowlingSpeed;
}

/** The goal test, every substep in play (D-8): the ball's centre more than
 *  its radius behind a goal line. Only the mouth lets it there. */
export function goalTest(sim: Sim, s: MatchState, t: number): void {
  const line = sim.P.pitch.goalLineX + sim.P.ballRadius;
  const x = s.ball.x;
  if (x < -line) scoreGoal(sim, s, 1, t);
  else if (x > line) scoreGoal(sim, s, 0, t);
}

/** A goal for pack (D-8, design §6.8): credit to the attackers among the
 *  latest touchers, each counting a goal (C-26), else an own goal, which
 *  still counts for the pack (L108); then the celebration. Scores and goals
 *  saturate at 255 (A.1). */
export function scoreGoal(_sim: Sim, s: MatchState, pack: Pack, t: number): void {
  if (s.score[pack] < U8_MAX) s.score[pack]++;
  s.lastGoalTick = t;
  s.lastGoalPack = pack;
  const list = s.terriers;
  let scorers = 0;
  const last = s.ball.lastContactTick;
  if (last !== NEVER) {
    for (let k = 0; k < list.length; k++) {
      const T = list[k]!;
      if (T.lastBallContactTick === last && T.pack === pack) scorers |= 1 << k;
    }
  }
  s.ownGoal = scorers === 0;
  s.scorers = scorers;
  for (let k = 0; k < list.length; k++) {
    const T = list[k]!;
    if ((scorers & (1 << k)) !== 0 && T.goals < U8_MAX) T.goals++;
  }
  s.phase = CELEBRATION;
  s.phaseStart = t;
}

/** Step 6 (design §6.6): the clock, in a tick that began in play; true if
 *  it placed the terriers for the overtime kickoff. Phase 3. */
export function advanceClock(_sim: Sim, _s: MatchState, _t: number, _beganInPlay: boolean): boolean {
  return false;
}

/** The pack that won: in ENDED, the one with more goals; null before the
 *  end, or level. */
export function winner(s: Readonly<MatchState>): Pack | null {
  if (s.phase !== ENDED) return null;
  const [a, b] = s.score;
  return a > b ? 0 : b > a ? 1 : null;
}

/** The Terriest (D-8): the list indices of the terriers with the most
 *  goals, then the most touches; terriers still level share it. Own goals
 *  credit nobody (L112). */
export function terriest(s: Readonly<MatchState>): number[] {
  const list = s.terriers;
  let goals = -1;
  let touches = -1;
  for (let k = 0; k < list.length; k++) {
    const T = list[k]!;
    if (T.goals > goals || (T.goals === goals && T.touches > touches)) {
      goals = T.goals;
      touches = T.touches;
    }
  }
  const out: number[] = [];
  for (let k = 0; k < list.length; k++) if (list[k]!.goals === goals && list[k]!.touches === touches) out.push(k);
  return out;
}
