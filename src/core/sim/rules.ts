// The match rules, PLAN D-8 and D-12 (design §1.10, §6): events, presence,
// phases, kickoffs and arrivals, Q-8's bowling, goals and credit, the clock,
// the end and the Terriest. From the M0 spike's step.ts (bowled, goal, the
// phase changes) and state.ts (placeKickoff), and roslambo's rules.ts (the
// events, presence and Ready), with packs, SWITCH, warm-up arrivals, the
// start countdown, the clock, overtime, the end, spots ranked by player ID,
// and one vacate for every way a slot is freed.
// Exact operations only (D-1).

import { JOIN, LEAVE, READY, SWITCH, UNREADY } from './input';
import { datan2 } from './math';
import type { SimParams } from './params';
import { insideFloorPlan } from './pitch';
import {
  CELEBRATION, cleanName, ENDED, findTerrier, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, NEVER, newTerrier, type Pack, packCount,
  SITTING, slotOf, sortTerriers, STANDING, START_COUNTDOWN, type Terrier, WARM_UP,
} from './state';
import type { Sim } from './step';

/** A u8 counter's ceiling: scores and goals saturate there (A.1). */
const U8_MAX = 255; // not a setting
/** The overtime clock's ceiling, A.1's u32. */
const U32_MAX = 0xffffffff; // not a setting

/** Step 1 (design §6.1): the roster events, in warm-up only, over the
 *  canonical inputs, which are in ID order: LEAVE, then SWITCH, then JOIN,
 *  each in ID order, then READY, then UNREADY (D-12). So a place a LEAVE or
 *  a SWITCH frees can be taken in the same tick, as Practice's pack swap
 *  needs (D-22). Reads s and sim.ins only: a JOIN adds a terrier that
 *  sim.bodies holds only once step binds again. True if the roster or a
 *  slot changed. */
export function applyEvents(sim: Sim, s: MatchState, t: number): boolean {
  // From the start countdown the roster is locked: every event is ignored,
  // LEAVE included (roslambo).
  if (s.phase !== WARM_UP) return false;
  const P = sim.P;
  const ins = sim.ins;
  let changed = false;
  // A member leaves, freeing its place.
  for (let k = 0; k < ins.length; k++) {
    const x = ins[k]!;
    if ((x.events & LEAVE) === 0) continue;
    const at = findTerrier(s, x.id);
    if (at < 0) continue;
    removeTerrier(s, at);
    changed = true;
  }
  // A member moves to the other pack if it has room. Its old slot is
  // vacated, since its slot changes with its pack, and the switch cancels
  // its Ready (D-12). A non-member's SWITCH is ignored, even beside its JOIN:
  // the session re-sends it, and it lands a tick later (design §6.1).
  for (let k = 0; k < ins.length; k++) {
    const x = ins[k]!;
    if ((x.events & SWITCH) === 0) continue;
    const at = findTerrier(s, x.id);
    if (at < 0) continue;
    const T = s.terriers[at]!;
    const to = x.switchPack;
    if ((to !== 0 && to !== 1) || to === T.pack || packCount(s, to) >= s.packSize) continue;
    vacate(s, slotOf(T));
    T.pack = to;
    T.readyUntil = 0;
    placeArrival(sim, s, T, t);
    changed = true;
  }
  // A non-member joins a pack with room: for a pack's last place, the first
  // in ID order. A coat outside the list reads as coat 0, and a name that
  // isn't allowed as '' (D-12, C-17).
  for (let k = 0; k < ins.length; k++) {
    const x = ins[k]!;
    if ((x.events & JOIN) === 0 || findTerrier(s, x.id) >= 0) continue;
    const pack = x.joinPack;
    if ((pack !== 0 && pack !== 1) || packCount(s, pack) >= s.packSize) continue;
    const c = x.coat;
    const coat = c !== undefined && Number.isInteger(c) && c >= 0 && c < P.coatCount ? c : 0;
    const T = newTerrier(x.id, cleanName(x.name, P), pack, coat, t, P);
    s.terriers.push(T);
    placeArrival(sim, s, T, t);
    changed = true;
  }
  // Ready, then its cancellation: both in one input leave a member not
  // ready, as roslambo's do.
  for (let k = 0; k < ins.length; k++) {
    const x = ins[k]!;
    if ((x.events & READY) === 0) continue;
    const at = findTerrier(s, x.id);
    if (at >= 0) s.terriers[at]!.readyUntil = t + P.readyExpiryTicks;
  }
  for (let k = 0; k < ins.length; k++) {
    const x = ins[k]!;
    if ((x.events & UNREADY) === 0) continue;
    const at = findTerrier(s, x.id);
    if (at >= 0) s.terriers[at]!.readyUntil = 0;
  }
  if (changed) sortTerriers(s);
  return changed;
}

/** Step 2 (design §6.2): each terrier with an input this tick was heard
 *  from now and stands. In warm-up a terrier silent for the removal
 *  threshold is removed (roslambo Q-15); from the start countdown on, one
 *  silent for the sitting threshold sits instead, on its spot (D-16). True
 *  if a terrier was removed. */
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
  if (s.phase !== WARM_UP) return false;
  // Removal keeps the list's order, so it needs no sort.
  let removed = false;
  for (let k = list.length - 1; k >= 0; k--) {
    if (t - list[k]!.lastInputTick < P.removeAfterTicks) continue;
    removeTerrier(s, k);
    removed = true;
  }
  return removed;
}

/** Step 3 (design §6.3), in its order: Ready's expiry; the start countdown
 *  once both packs are full and every terrier is ready; a countdown's end,
 *  which starts play; a celebration's end, which starts a kickoff
 *  countdown, the overtime kickoff, or the end. Each countdown starts with
 *  the kickoff placement. True if it placed the terriers, whose slots the
 *  placement ranks by ID. */
export function applyPhaseChanges(sim: Sim, s: MatchState, t: number): boolean {
  const P = sim.P;
  const list = s.terriers;
  if (s.phase === WARM_UP) {
    for (let k = 0; k < list.length; k++) {
      const T = list[k]!;
      if (T.readyUntil !== 0 && t >= T.readyUntil) T.readyUntil = 0;
    }
    if (packCount(s, 0) !== s.packSize || packCount(s, 1) !== s.packSize) return false;
    for (let k = 0; k < list.length; k++) if (!(list[k]!.readyUntil > t)) return false;
    placeKickoff(sim, s, t);
    s.phase = START_COUNTDOWN;
    s.phaseStart = t;
    return true;
  }
  if (
    (s.phase === START_COUNTDOWN && t - s.phaseStart >= P.startCountdownTicks) ||
    (s.phase === KICKOFF_COUNTDOWN && t - s.phaseStart >= P.kickoffCountdownTicks)
  ) {
    s.phase = IN_PLAY;
    s.phaseStart = t;
    return false;
  }
  if (s.phase === CELEBRATION && t - s.phaseStart >= P.celebrationTicks) {
    // The overtime goal's celebration ends the match, and so does one at
    // 0:00 with a pack ahead. One at 0:00 that levelled it, the goal in the
    // tick that brought the clock to 0 (L107), leads to the overtime
    // kickoff, and the clock counts up from 0 (D-8).
    if (s.overtime || (s.clock === 0 && s.score[0] !== s.score[1])) {
      s.phase = ENDED;
      s.phaseStart = t;
      return false;
    }
    if (s.clock === 0) s.overtime = true;
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

/** Whether a standing terrier centred at (x, y) would be strictly apart from
 *  every body but T, in 3D: each other terrier's centre more than 2r away,
 *  and the ball's more than R + r (design §6.5). */
function clearOfBodies(P: SimParams, s: Readonly<MatchState>, T: Readonly<Terrier>, x: number, y: number): boolean {
  const r = P.terrierRadius;
  const touch = r + r;
  const list = s.terriers;
  for (let k = 0; k < list.length; k++) {
    const U = list[k]!;
    if (U === T) continue;
    const dx = U.x - x, dy = U.y - y, dz = U.z - r;
    if (dx * dx + dy * dy + dz * dz <= touch * touch) return false;
  }
  const b = s.ball;
  const reach = P.ballRadius + r;
  const dx = b.x - x, dy = b.y - y, dz = b.z - r;
  return dx * dx + dy * dy + dz * dz > reach * reach;
}

/** A warm-up arrival, a JOIN or a SWITCH into the other pack (D-8, design
 *  §6.5). It takes the pack's lowest spot that no other member holds, and
 *  stands on that spot's point if no body is in the way. Otherwise it goes
 *  to the first clear point in steps from the spot toward its own goal
 *  line, at the same y, inside the floor plan by its radius; if there is
 *  none, onto the spot, and the position passes push it out (D-5). It
 *  arrives at rest, facing the ball, with a full meter, no timers, flags or
 *  slip, and stands; it keeps the spot until the start countdown's
 *  placement ranks its pack by ID. Reads s, never sim.bodies: the terriers
 *  placed earlier in the tick are in s, and only there until step binds
 *  again (design §3). */
export function placeArrival(sim: Sim, s: MatchState, T: Terrier, t: number): void {
  const P = sim.P;
  const list = s.terriers;
  let held = 0;
  for (let k = 0; k < list.length; k++) {
    const U = list[k]!;
    if (U !== T && U.pack === T.pack) held |= 1 << U.spot;
  }
  let spot = 0;
  while ((held & (1 << spot)) !== 0) spot++;
  const at = P.kickoffSpots[T.pack][s.packSize]?.[spot];
  if (!at) throw new Error(`no kickoff spot ${spot} for pack ${T.pack} at ${s.packSize} a side (A.5)`);
  const r = P.terrierRadius;
  const y = at[1];
  let x = at[0];
  // Toward its own goal line: −x for pack A, +x for pack B, so a mirrored
  // arrival steps to the mirrored point. A step that isn't positive, which
  // the tuning page could set, never leaves the spot.
  const step = P.arrivalStep;
  if (step > 0 && !clearOfBodies(P, s, T, x, y)) {
    const toward = T.pack === 0 ? -step : step;
    for (let k = 1; ; k++) {
      const px = at[0] + k * toward;
      if (!insideFloorPlan(P.pitch.shape, px, y, r)) break;
      if (clearOfBodies(P, s, T, px, y)) {
        x = px;
        break;
      }
    }
  }
  T.spot = spot;
  T.x = x; T.y = y; T.z = r;
  T.vx = 0; T.vy = 0; T.vz = 0; T.onFloor = true;
  T.heading = datan2(-y, -x);
  T.overheadRef = T.heading;
  T.sitting = false; T.zoomLocked = false; T.ballOverhead = false; T.touchingBall = false;
  T.slipping = false;
  T.slipFrom = -1;
  T.meter = P.meterFull;
  T.pounceWait = 0; T.lunge = 0; T.tumble = 0; T.guard = 0;
  T.headingChange = 0;
  T.anim = STANDING;
  T.animStart = t;
}

/** Frees a slot: every terrier's slipping flag and slipFrom that name it
 *  clear. LEAVE, removal and SWITCH all call it, so no slipFrom ever names
 *  an empty slot, or a body that took the slot in the same tick (design
 *  §6.1). */
export function vacate(s: MatchState, slot: number): void {
  const list = s.terriers;
  for (let k = 0; k < list.length; k++) {
    const T = list[k]!;
    if (T.slipFrom !== slot) continue;
    T.slipping = false;
    T.slipFrom = -1;
  }
}

/** Vacates a terrier's slot, then removes it (design §6.1). The list keeps
 *  its order, and the scorers' bits above it move down, so each bit still
 *  names its terrier and none names one past the list (A.1). */
export function removeTerrier(s: MatchState, index: number): void {
  const list = s.terriers;
  vacate(s, slotOf(list[index]!));
  for (let k = index; k + 1 < list.length; k++) list[k] = list[k + 1]!;
  list.pop();
  s.scorers = (s.scorers & ((1 << index) - 1)) | ((s.scorers >>> (index + 1)) << index);
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

/** Step 6 (design §6.6): the clock, only in a tick that began in play,
 *  which means in play after step 3, so it counts exactly the ticks played.
 *  In overtime it counts up, saturating. Otherwise it counts down, and at 0
 *  with the phase still in play, so no goal this tick, the match ends with
 *  a pack ahead, or goes to the overtime kickoff level. A goal in the tick
 *  that brings it to 0 has started its celebration, whose end decides
 *  (L107). True if it placed the terriers for the overtime kickoff. */
export function advanceClock(sim: Sim, s: MatchState, t: number, beganInPlay: boolean): boolean {
  if (!beganInPlay) return false;
  if (s.overtime) {
    if (s.clock < U32_MAX) s.clock++;
    return false;
  }
  if (s.clock > 0) s.clock--;
  if (s.clock !== 0 || s.phase !== IN_PLAY) return false;
  if (s.score[0] !== s.score[1]) {
    s.phase = ENDED;
    s.phaseStart = t;
    return false;
  }
  s.overtime = true;
  placeKickoff(sim, s, t);
  s.phase = KICKOFF_COUNTDOWN;
  s.phaseStart = t;
  return true;
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
