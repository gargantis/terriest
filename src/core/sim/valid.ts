// What every valid state keeps (design §6.7): the decoder applies it, so a
// peer's STATE can't put a state that breaks step into the timeline (D-20),
// and the property tests check it as the simulation runs. The structural
// checks, then the ones the rules imply (D-8, D-12): apart from the codec,
// so the rules' owner never edits a file it doesn't own.

import { rulesProblem } from '../../config';
import { isPlayerId, KEPT_BITS } from './input';
import { defaultParams, paramsFor, type SimParams } from './params';
import { ballSlot, CELEBRATION, ENDED, KICKOFF_COUNTDOWN, type MatchState, nameAllowed, SITTING, slotOf, STANDING, WARM_UP } from './state';

const whole = (x: number, min: number, max: number): boolean => Number.isInteger(x) && x >= min && x <= max;

/** 2^31 ticks, 414 days at 60 a second, which no match reaches. From a tick
 *  under it, step runs about 2^31 more ticks before a tick it writes, a
 *  Ready's end included, leaves A.1's u32 (design §6.7). */
const TICK_LIMIT = 0x80000000; // not a setting: 2^31

/** What makes a state invalid; [] for a valid one. Checked under the
 *  match's own parameters: its rules over P's base (C-59). */
export function stateProblems(s: Readonly<MatchState>, given: SimParams = defaultParams): string[] {
  const problems: string[] = [];
  const size = s.packSize;

  // The match rules: each one of its choices, and none the base's own setting (C-59). The rest is
  // checked under the parameters they make, or the base's if they're refused.
  const base = given.base ?? given;
  const rules: unknown = s.rules;
  const rulesWrong = typeof rules !== 'object' || rules === null ? 'they are no object of rules' : rulesProblem(s.rules, base.config);
  if (rulesWrong !== null) problems.push(`the match rules: ${rulesWrong} (C-59)`);
  const P = rulesWrong === null ? paramsFor(s.rules, base) : base;

  // The match.
  if (!whole(s.phase, WARM_UP, ENDED)) problems.push(`the phase is ${s.phase}, not 0 to 5`);
  if (!whole(size, P.packSizeMin, P.packSizeMax)) problems.push(`the pack size is ${size}, outside ${P.packSizeMin} to ${P.packSizeMax}`);
  if (!(Number.isInteger(s.matchLengthTicks) && s.matchLengthTicks > 0)) problems.push(`the match length is ${s.matchLengthTicks} ticks, not positive`);
  if (s.lastGoalPack !== 0 && s.lastGoalPack !== 1) problems.push(`the last goal's pack is ${s.lastGoalPack}, not 0 or 1`);
  const b = s.ball;
  const ballFloats: [string, number][] = [
    ['x', b.x], ['y', b.y], ['z', b.z], ['vx', b.vx], ['vy', b.vy], ['vz', b.vz],
    ['hit strength', b.lastHitStrength], ["hit's x change", b.lastHitDvx], ["hit's y change", b.lastHitDvy], ["hit's z change", b.lastHitDvz],
  ];
  for (const [what, v] of ballFloats) if (!Number.isFinite(v)) problems.push(`the ball's ${what} is ${v}, not finite (D-1)`);
  if (typeof b.onFloor !== 'boolean') problems.push(`the ball's floor flag is ${String(b.onFloor)}, not a boolean`);

  // The roster: at most a pack size in each pack, in (spot, pack) order
  // with unique slots (A.1).
  const list = s.terriers;
  const n = list.length;
  if (n > 2 * size) problems.push(`${n} terriers, more than two packs of ${size}`);
  const inPack = [0, 0];
  let previous = -1;
  for (let k = 0; k < n; k++) {
    const t = list[k]!;
    const who = `terrier ${k}`;
    if (t.pack === 0 || t.pack === 1) inPack[t.pack]!++;
    else problems.push(`${who}'s pack is ${t.pack}, not 0 or 1`);
    if (!whole(t.spot, 0, size - 1)) problems.push(`${who}'s spot is ${t.spot}, not under the pack size, ${size}`);
    const slot = slotOf(t);
    if (!(slot > previous)) problems.push(`${who} is out of (spot, pack) order, or shares a slot`);
    previous = slot;
    if (!isPlayerId(t.id)) problems.push(`${who}'s ID isn't 32 lower-case hex digits`);
    for (let j = 0; j < k; j++) if (list[j]!.id === t.id) problems.push(`${who}'s ID is terrier ${j}'s too`);
    if (!nameAllowed(t.name, P)) problems.push(`${who}'s name doesn't pass cleanName unchanged (C-17)`);
    if (!whole(t.coat, 0, P.coatCount - 1)) problems.push(`${who}'s coat is ${t.coat}, not one of ${P.coatCount}`);
    const floats: [string, number][] = [['x', t.x], ['y', t.y], ['z', t.z], ['vx', t.vx], ['vy', t.vy], ['vz', t.vz]];
    for (const [what, v] of floats) if (!Number.isFinite(v)) problems.push(`${who}'s ${what} is ${v}, not finite (D-1)`);
    const flags: [string, unknown][] = [
      ['floor flag', t.onFloor], ['sitting', t.sitting], ['zoomies lockout', t.zoomLocked],
      ['ball overhead', t.ballOverhead], ['slipping', t.slipping], ['touching the ball', t.touchingBall],
    ];
    for (const [what, v] of flags) if (typeof v !== 'boolean') problems.push(`${who}'s ${what} is ${String(v)}, not a boolean`);
    // Slipped from: none, the ball, or another terrier that's here (A.1; design §6.1).
    const from = t.slipFrom;
    const named = from === -1 || from === ballSlot(size) || (from !== slot && list.some((u) => slotOf(u) === from));
    if (!named) problems.push(`${who} slipped from slot ${from}, neither the ball's nor another terrier's`);
    if (t.slipping !== (from !== -1)) problems.push(`${who}'s slipping flag is ${String(t.slipping)} with slipped-from ${from}`);
    if (!whole(t.prevInput, 0, KEPT_BITS)) problems.push(`${who}'s previous input, ${t.prevInput}, holds more than bits 0 to 12 (D-10)`);
    // The meter and the timers within their maxima (A.1).
    const timers: [string, number, number][] = [
      ['zoomies meter', t.meter, P.meterFull], ['lunge', t.lunge, P.lungeTicks], ['pounce wait', t.pounceWait, P.pounceWaitTicks],
      ['tumble', t.tumble, P.tumbleTicks], ['guard', t.guard, P.guardTicks],
    ];
    for (const [what, v, max] of timers) if (!whole(v, 0, max)) problems.push(`${who}'s ${what} is ${v}, outside 0 to ${max}`);
    if (!whole(t.anim, STANDING, SITTING)) problems.push(`${who}'s animation phase is ${t.anim}, not 0 to 7`);
  }
  for (const pack of [0, 1] as const) if (inPack[pack]! > size) problems.push(`pack ${pack} has ${inPack[pack]} terriers, more than ${size}`);
  // A bit for each terrier in the list (A.1).
  if (!whole(s.scorers, 0, n < 8 ? (1 << n) - 1 : 0xff)) problems.push(`the scorers, ${s.scorers}, name a terrier past the list's ${n}`);

  // From the rules. The tick leaves step room, and the phase began at a tick
  // that has passed, so no countdown or celebration waits on a future one.
  if (!(s.tick < TICK_LIMIT)) problems.push(`the tick, ${s.tick}, is 2^31 or more: no match reaches it, and later ticks would leave a u32 (A.1)`);
  if (!(s.phaseStart <= s.tick)) problems.push(`the phase started at tick ${s.phaseStart}, after the tick, ${s.tick}`);
  // The scorers name the last goal's terriers from its celebration until
  // the next placement clears them, so they're 0 in any other phase (§6.8).
  if (s.scorers !== 0 && s.phase !== CELEBRATION && s.phase !== ENDED) problems.push(`the scorers, ${s.scorers}, outside a celebration or the end`);
  // Overtime begins with its kickoff (D-8).
  if (s.overtime === true && s.phase < KICKOFF_COUNTDOWN) problems.push(`overtime in phase ${s.phase}, before any kickoff countdown (D-8)`);
  // Outside overtime the clock counts down from the match's length; a
  // placed test state's 2^31-tick length and clock are valid (design §13, R-7).
  if (s.overtime !== true && !(s.clock <= s.matchLengthTicks)) problems.push(`the clock, ${s.clock}, is past the match length, ${s.matchLengthTicks}, outside overtime`);
  // The start countdown needs both packs full, and nothing leaves after it.
  // The marks' test-only short packs break this on purpose, and are never
  // encoded for a peer (design §2.3).
  if (s.phase !== WARM_UP) {
    for (const pack of [0, 1] as const) {
      if (inPack[pack] !== size) problems.push(`pack ${pack} has ${inPack[pack]} of ${size} terriers: from the start countdown on, both packs are full`);
    }
  }
  // A Ready lasts its expiry from the tick it was sent (D-12), and a terrier
  // joined and was last heard from at ticks that have passed, so none is
  // spared its sitting or removal (D-16).
  for (let k = 0; k < n; k++) {
    const T = list[k]!;
    const ready = T.readyUntil;
    if (ready !== 0 && !(ready <= s.tick + P.readyExpiryTicks)) problems.push(`terrier ${k} is ready until tick ${ready}, past the tick plus the Ready expiry`);
    if (!(T.joinTick <= s.tick && T.lastInputTick <= s.tick)) problems.push(`terrier ${k} joined or was last heard from after the tick, ${s.tick}`);
  }
  return problems;
}
