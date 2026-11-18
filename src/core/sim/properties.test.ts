import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { decodeState, encodeState, hashState } from './codec';
import { canonicalInputs, encodeInput, JOIN, LEAVE, SWITCH, type TickInput } from './input';
import { type Match, newMatch, noisyInputs, say, shuffled, stack, startedMatch, tick } from './match-testing';
import { mix } from './math';
import { defaultParams } from './params';
import { insideRegion } from './pitch';
import { applyEvents, applyPresence } from './rules';
import { placedMatch } from './scenes';
import {
  ballSlot, CELEBRATION, cloneState, ENDED, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, NEVER, type Phase, slotOf, START_COUNTDOWN, WARM_UP,
} from './state';
import { bindSlots, makeSim, type Sim, step } from './step';
import { testId } from './testing';
import { stateProblems } from './valid';

// The property and fuzz tests (PLAN §16, P4, D-10, D-12; design §5.1, §7.7):
// arrival order never matters; step never throws and the state stays valid
// from every phase, through stacked terriers' LEAVEs, removals and
// SWITCHes, and in the marks' short packs; every u16 is a valid input; the
// bark bits never reach the hash; presses after absent ticks.
vi.setConfig({ testTimeout: 120_000 });

const P = defaultParams;

/** Names a JOIN may carry: allowed ones, and ones cleanName refuses. */
const NAMES = [
  '', 'Rex', 'x'.repeat(20), 'x'.repeat(21), `${'é'.repeat(16)}x`, 'tab\there', 'nul\u0000', 'del\u007f', 'c1\u0085', 'c1\u009f',
  '🐶 and 🐕\u200d🦺', '🐶'.repeat(9), 'lone \ud83d', '\udc36 lone', '\ufeffbom',
];
const names = fc.array(fc.oneof(fc.constantFrom(...NAMES), fc.string({ unit: 'binary', maxLength: 24 })), { minLength: 1, maxLength: 6 });
const hexId = fc.uint8Array({ minLength: 16, maxLength: 16 }).map((b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''));
const ids = (min: number, max: number): fc.Arbitrary<string[]> => fc.uniqueArray(hexId, { minLength: min, maxLength: max });
const packSize = fc.integer({ min: 1, max: 4 });
const seed = fc.integer({ min: 0, max: 0xffffffff });

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** What every valid state keeps, checked (design §7.7): no problem, the
 *  bytes round-trip, and the ball inside the space the pieces enclose, with
 *  about a substep's travel at 25 m/s of slack. */
function valid(s: Readonly<MatchState>, what: string): void {
  // Plain checks first: an expect costs more than the checks.
  const problems = stateProblems(s);
  if (problems.length > 0) expect(problems, what).toEqual([]);
  const bytes = encodeState(s);
  const back = decodeState(bytes);
  if (back === null || !sameBytes(encodeState(back), bytes)) expect.fail(`${what}: the bytes don't round-trip`);
  const b = s.ball;
  if (!insideRegion(P.pitch.shape, b.x, b.y, b.z, 0.11)) expect.fail(`${what}: the ball at (${b.x}, ${b.y}, ${b.z}) has left the pitch`);
}

/** Steps 1 and 2 alone, on a clone, as step runs them (design §3): the
 *  state the substeps start from, before their own clear lets go of a slip
 *  whose body is gone or down, which could hide a missing vacate. */
function afterEvents(sim: Sim, s: Readonly<MatchState>, inputs: readonly TickInput[]): MatchState {
  const c = cloneState(s);
  const t = c.tick + 1;
  canonicalInputs(inputs, sim.ins);
  bindSlots(sim, c);
  if (applyEvents(sim, c, t)) bindSlots(sim, c);
  applyPresence(sim, c, t);
  return c;
}

/** Whether every slip names the ball or another terrier that's there, so
 *  the drive's backstop never fires (design §4.2, §6.1). */
function slipsNamePresent(s: Readonly<MatchState>): boolean {
  const ball = ballSlot(s.packSize);
  return s.terriers.every((T) =>
    T.slipping === (T.slipFrom !== -1) && (T.slipFrom === -1 || T.slipFrom === ball || s.terriers.some((U) => U !== T && slotOf(U) === T.slipFrom)));
}

/** Counts across a property's runs, so none of them passes empty. */
interface Seen { joins: number; leaves: number; switches: number; starts: number; plays: number; goals: number; slips: number }
const seen = (): Seen => ({ joins: 0, leaves: 0, switches: 0, starts: 0, plays: 0, goals: 0, slips: 0 });

/** What a tally reads of a state: each member by ID, its pack and join
 *  tick, the phase and the goals. */
interface Glance { readonly members: readonly string[]; readonly phase: Phase; readonly goals: number }
const glance = (s: Readonly<MatchState>): Glance => ({
  members: s.terriers.map((T) => `${T.id} ${T.pack} ${T.joinTick}`), phase: s.phase, goals: s.score[0] + s.score[1],
});

/** What a tick did to the roster and the phase. */
function tally(c: Seen, before: Glance, s: Readonly<MatchState>): void {
  for (const T of s.terriers) {
    const was = before.members.find((x) => x.startsWith(T.id));
    if (!was || T.joinTick === s.tick) c.joins++;
    else if (!was.startsWith(`${T.id} ${T.pack}`)) c.switches++;
    if (T.slipping) c.slips++;
  }
  for (const x of before.members) if (!s.terriers.some((T) => x.startsWith(T.id))) c.leaves++;
  if (before.phase === WARM_UP && s.phase === START_COUNTDOWN) c.starts++;
  if (before.phase !== IN_PLAY && s.phase === IN_PLAY) c.plays++;
  c.goals += s.score[0] + s.score[1] - before.goals;
}

/** Fails with both hashes when two states differ: a plain comparison
 *  first, since an expect a tick costs more than the step. */
function same(a: Readonly<MatchState>, b: Readonly<MatchState>, what: string): void {
  const h = hashState(a);
  const g = hashState(b);
  if (g !== h) expect(g, what).toBe(h);
}

describe('P4: the same events in any arrival order give the same state (§16)', () => {
  it('steps random rosters of 1 to 12 IDs with random events, packs, coats, names and u16s from genesis, the inputs shuffled two ways and duplicated', () => {
    const c = seen();
    fc.assert(
      fc.property(packSize, ids(1, 12), names, seed, seed, seed, (n, roster, list, s0, s1, s2) => {
        const runs = [0, 1, 2].map(() => newMatch(P, n));
        for (let t = 1; t <= 300; t++) {
          const inputs = noisyInputs(s0, roster, list, t);
          const before = glance(runs[0]!.s);
          step(runs[0]!.sim, runs[0]!.s, inputs);
          step(runs[1]!.sim, runs[1]!.s, shuffled(inputs, mix(s1, t)));
          step(runs[2]!.sim, runs[2]!.s, shuffled([...inputs, ...shuffled(inputs, t)], mix(s2, t)));
          same(runs[0]!.s, runs[1]!.s, `tick ${t}, shuffled`);
          same(runs[0]!.s, runs[2]!.s, `tick ${t}, shuffled and duplicated`);
          tally(c, before, runs[0]!.s);
        }
      }),
    );
    expect(c.joins).toBeGreaterThan(500);
    expect(c.leaves).toBeGreaterThan(100);
    expect(c.switches).toBeGreaterThan(50);
    expect(c.starts).toBeGreaterThan(5);
  });
});

// --- step never throws, and the state stays valid ---

/** A start in any phase: genesis, a started match, or a placed one with a
 *  real clock anywhere in its minute, either pack ahead or level, and
 *  overtime where it can be. */
interface Start {
  packSize: number;
  kind: 'genesis' | 'started' | Phase;
  clock: number;
  lead: number;
  overtime: boolean;
  shot: boolean; // in play or a celebration: the ball rolling into a goal
  seed: number;
}
const start: fc.Arbitrary<Start> = fc.record({
  packSize,
  kind: fc.constantFrom<Start['kind']>('genesis', 'started', WARM_UP, KICKOFF_COUNTDOWN, IN_PLAY, CELEBRATION, ENDED),
  clock: fc.oneof(fc.integer({ min: 0, max: 3600 }), fc.integer({ min: 0, max: 30 })),
  lead: fc.integer({ min: -1, max: 1 }),
  overtime: fc.boolean(),
  shot: fc.boolean(),
  seed,
});

function begin(st: Start): Match {
  if (st.kind === 'genesis') return newMatch(P, st.packSize);
  if (st.kind === 'started') return startedMatch(P, st.packSize, 1, st.seed);
  const s = placedMatch(P, st.packSize, { phase: st.kind, seed: st.seed, matchMinutes: 1 });
  s.clock = st.clock;
  s.score = [1 + (st.lead > 0 ? 1 : 0), 1 + (st.lead < 0 ? 1 : 0)];
  if (st.overtime && st.kind >= KICKOFF_COUNTDOWN) s.overtime = true;
  if (st.shot && (st.kind === IN_PLAY || st.kind === CELEBRATION)) {
    // 2 m out, rolling in at 5 m/s, into either goal.
    const end = (st.seed & 1) === 0 ? 1 : -1;
    Object.assign(s.ball, { x: end * (P.pitch.goalLineX - 2), y: 0, vx: end * 5, vy: 0 });
  }
  return { P, sim: makeSim(P, st.packSize), s };
}

describe('step never throws, and the state stays valid (D-12, D-20; design §7.7)', () => {
  it('from every phase, under random events and inputs: every 10 ticks no problem, the bytes round-trip and the ball stays in', () => {
    const c = seen();
    // Starts every run takes besides the random ones, so each path is
    // stepped whatever the seed: a goal, the end and the overtime kickoff
    // at 0:00, a celebration's end at 0:00, warm-up's churn, a started match.
    const at = (kind: Start['kind'], packSize: number, clock: number, lead: number, shot: boolean): Start => ({ packSize, kind, clock, lead, overtime: false, shot, seed: clock + packSize });
    const six = [1, 2, 3, 4, 5, 6].map((k) => testId(k));
    const examples: [Start, string[], string[], number][] = [
      [at(IN_PLAY, 2, 3600, 0, true), [], ['Rex'], 1],
      [at(IN_PLAY, 1, 3, 0, false), [], ['Rex'], 2],
      [at(IN_PLAY, 3, 3, 1, false), [], [''], 3],
      [at(CELEBRATION, 4, 0, 0, false), [], [''], 4],
      [at('genesis', 2, 0, 0, false), six, NAMES, 5],
      [at('started', 1, 0, 0, false), six.slice(0, 2), NAMES, 6],
    ];
    fc.assert(
      fc.property(start, ids(0, 6), names, seed, (st, strangers, list, s0) => {
        const m = begin(st);
        const roster = [...m.s.terriers.map((T) => T.id), ...strangers];
        valid(m.s, 'the start');
        for (let t = m.s.tick + 1; t <= 400; t++) {
          const before = glance(m.s);
          step(m.sim, m.s, noisyInputs(s0, roster, list, t));
          tally(c, before, m.s);
          if (t % 10 === 0) valid(m.s, `${String(st.kind)}, tick ${t}`);
        }
        valid(m.s, 'the end');
      }),
      { examples },
    );
    expect(c.joins).toBeGreaterThan(50);
    expect(c.plays).toBeGreaterThan(10);
    expect(c.goals).toBeGreaterThan(0);
  });

  it('takes every u16 in a stride of 7 as a valid input, in every phase (A.2)', () => {
    const phases: Phase[] = [WARM_UP, START_COUNTDOWN, KICKOFF_COUNTDOWN, IN_PLAY, CELEBRATION, ENDED];
    const CHUNK = 150; // inside every phase's shortest timer, so each chunk stays in its phase
    let steps = 0;
    for (const phase of phases) {
      for (let v0 = 0; v0 < 65536; v0 += 7 * CHUNK) {
        const s = placedMatch(P, 2, { phase, seed: v0, matchMinutes: 1 });
        const sim = makeSim(P, 2);
        for (let v = v0; v < 65536 && v < v0 + 7 * CHUNK; v += 7) {
          // Each terrier its own transform of v, so every value meets every slot.
          const inputs = s.terriers.map((T, k): TickInput => ({ id: T.id, input: [v, (v * 31) & 0xffff, v ^ 0xa5a5, 0xffff - v][k]!, events: 0 }));
          step(sim, s, inputs);
          steps++;
          if (((v - v0) / 7) % 10 === 9) valid(s, `phase ${phase}, input ${v}`);
        }
      }
    }
    expect(steps).toBe(6 * Math.ceil(65536 / 7));
  });

  it('keeps every slip naming a present body through LEAVEs, removals and SWITCHes of stacked terriers, upper and lower (design §6.1)', () => {
    const c = seen();
    let freed = 0; // events that freed a slot some slip named
    const plan = fc.record({
      packSize: fc.integer({ min: 1, max: 4 }),
      members: fc.tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 })),
      stacks: fc.array(fc.tuple(fc.nat(), fc.nat()), { minLength: 1, maxLength: 3 }),
      events: fc.array(fc.record({ at: fc.integer({ min: 1, max: 12 }), who: fc.nat(), kind: fc.constantFrom('leave', 'remove', 'switch', 'leave and join') }), { minLength: 1, maxLength: 4 }),
      seed,
    });
    fc.assert(
      fc.property(plan, (p) => {
        const n = p.packSize;
        const members: [number, number] = [Math.min(p.members[0], n), Math.min(p.members[1], n)];
        const s = placedMatch(P, n, { phase: WARM_UP, members, seed: p.seed });
        s.tick = 1000; // so a removal can be scheduled by the last input tick
        for (const T of s.terriers) T.lastInputTick = 1000;
        const m: Match = { P, sim: makeSim(P, n), s };
        const early = makeSim(P, n);
        for (const [a, b] of p.stacks) {
          const lower = a % s.terriers.length;
          const upper = b % s.terriers.length;
          if (lower !== upper) stack(P, s, lower, upper);
        }
        let fresh = 0;
        for (let i = 1; i <= 40; i++) {
          const t = s.tick + 1;
          const due = p.events.filter((e) => e.at === i && s.terriers.length > 0);
          const inputs: TickInput[] = [];
          const silent: string[] = [];
          const named = s.terriers.filter((T) => T.slipFrom >= 0 && T.slipFrom < 2 * n).map((T) => T.slipFrom);
          for (const e of due) {
            const T = s.terriers[e.who % s.terriers.length]!;
            if (named.includes(slotOf(T)) || T.slipping) freed++;
            if (e.kind === 'leave') inputs.push(say(T.id, LEAVE));
            else if (e.kind === 'switch') inputs.push(say(T.id, SWITCH, 0, { switchPack: 1 - T.pack }));
            else if (e.kind === 'leave and join') inputs.push(say(T.id, LEAVE), say(`${(fresh++).toString(16).padStart(8, '0')}${'f'.repeat(24)}`, JOIN, 0, { joinPack: T.pack }));
            else {
              T.lastInputTick = t - P.removeAfterTicks;
              silent.push(T.id);
            }
          }
          for (const T of s.terriers) if (!silent.includes(T.id) && !inputs.some((x) => x.id === T.id)) inputs.push(say(T.id, 0, encodeInput({ step: (t * 5) & 31 })));
          // Between the events and the substeps, too: no slip names a freed slot.
          if (!slipsNamePresent(afterEvents(early, s, inputs))) expect.fail(`tick ${i}: after the events, a slip names a slot they freed`);
          const before = glance(s);
          tick(m, inputs);
          tally(c, before, s);
          valid(s, `tick ${i}`);
        }
      }),
    );
    expect(c.slips).toBeGreaterThan(100);
    expect(freed).toBeGreaterThan(20);
    expect(c.leaves + c.switches).toBeGreaterThan(100);
  });

  it("steps the marks' short packs in play, and finds nothing in them but the full-pack rule (design §2.3)", () => {
    let goals = 0;
    fc.assert(
      fc.property(packSize, fc.nat(), fc.boolean(), fc.boolean(), ids(0, 3), names, seed, (n, short, which, shot, strangers, list, s0) => {
        const few = short % n; // 0 to n − 1 in the short pack
        const members: [number, number] = which ? [n, few] : [few, n];
        const s = placedMatch(P, n, { members, seed: s0 });
        // Half of them with the ball rolling into a goal, so a celebration's
        // end places a short pack.
        if (shot) Object.assign(s.ball, { x: P.pitch.goalLineX - 2, vx: 5 });
        const sim = makeSim(P, n);
        const roster = [...s.terriers.map((T) => T.id), ...strangers];
        for (let t = 1; t <= 200; t++) {
          step(sim, s, noisyInputs(s0, roster, list, t));
          if (t % 10 !== 0) continue;
          const problems = stateProblems(s);
          expect(problems.length).toBeGreaterThan(0);
          expect(problems.filter((x) => !/both packs are full/.test(x)), `tick ${t}`).toEqual([]);
          expect(insideRegion(P.pitch.shape, s.ball.x, s.ball.y, s.ball.z, 0.11)).toBe(true);
        }
        goals += s.score[0] + s.score[1];
        expect(encodeState(s).length).toBeGreaterThan(0); // a test-only state still encodes, and hashes
        expect(decodeState(encodeState(s))).toBeNull(); // but never decodes
      }),
    );
    expect(goals).toBeGreaterThan(0);
  });

  it('refuses to encode NaN and ±Infinity anywhere, and every state it encodes decodes (D-1)', () => {
    const fields = ['x', 'y', 'z', 'vx', 'vy', 'vz'] as const;
    const ballOnly = ['lastHitStrength', 'lastHitDvx', 'lastHitDvy', 'lastHitDvz'] as const;
    fc.assert(
      fc.property(start, fc.nat(), fc.nat(), fc.constantFrom(NaN, Infinity, -Infinity), seed, (st, where, field, bad, s0) => {
        const m = begin(st);
        for (let t = 1; t <= 20; t++) step(m.sim, m.s, noisyInputs(s0, m.s.terriers.map((T) => T.id), NAMES, t));
        const s = m.s;
        expect(decodeState(encodeState(s))).not.toBeNull();
        const k = where % (s.terriers.length + 1);
        const body = k === s.terriers.length ? s.ball : s.terriers[k]!;
        const keys = k === s.terriers.length ? [...fields, ...ballOnly] : fields;
        const key = keys[field % keys.length]!;
        const good = (body as unknown as Record<string, number>)[key]!;
        (body as unknown as Record<string, number>)[key] = bad;
        expect(() => encodeState(s)).toThrow(/not a finite float/);
        expect(() => hashState(s)).toThrow(/not a finite float/);
        expect(stateProblems(s).join('\n')).toMatch(/not finite/);
        (body as unknown as Record<string, number>)[key] = good;
        expect(decodeState(encodeState(s))).not.toBeNull();
      }),
    );
  });
});

// --- Inputs (A.2, D-10) ---

describe('inputs (A.2, D-10)', () => {
  it('never lets the bark bits reach the hash: inputs differing only in bits 13 to 15 give equal states', () => {
    fc.assert(
      fc.property(start, ids(0, 4), names, seed, seed, (st, strangers, list, s0, s1) => {
        const a = begin(st);
        const b = begin(st);
        const roster = [...a.s.terriers.map((T) => T.id), ...strangers];
        for (let t = 1; t <= 150; t++) {
          // One copy of each ID, so the flipped bits can't change which copy is kept.
          const inputs = canonicalInputs(noisyInputs(s0, roster, list, t));
          step(a.sim, a.s, inputs);
          step(b.sim, b.s, inputs.map((x, k) => ({ ...x, input: x.input ^ ((mix(mix(s1, t), k) & 7) << 13) })));
          same(a.s, b.s, `tick ${t}`);
        }
      }),
    );
  });

  it("acts a press once after 1 to 13 absent ticks, and a returning player's first input acts none (D-10)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 13 }), fc.integer({ min: 0, max: 3 }), fc.integer({ min: 1, max: 3 }), fc.boolean(), (gap, c, d, pounce) => {
        const s = placedMatch(P, 1);
        const sim = makeSim(P, 1);
        const A = s.terriers[0]!;
        A.heading = 0;
        const press = (count: number): number => encodeInput(pounce ? { pounce: count } : { jump: count });
        // A returning player: the stored previous input already holds c.
        A.prevInput = press(c);
        const acts: number[] = [];
        const tickWith = (input: number | null): void => {
          const t = s.tick + 1;
          step(sim, s, input === null ? [] : [{ id: A.id, input, events: 0 }]);
          if (pounce ? A.lunge === P.lungeTicks - 1 : A.takeOffTick === t) acts.push(t);
        };
        for (let i = 0; i < 150; i++) tickWith(press(c)); // held: never a press
        for (let i = 0; i < gap; i++) tickWith(null);
        const at = s.tick + 1;
        tickWith(press((c + d) & 3)); // a new count, by 1, 2 or 3: one press
        for (let i = 0; i < 150; i++) tickWith(press((c + d) & 3));
        expect(acts).toEqual([at]);
        expect(A.prevInput).toBe(press((c + d) & 3));
        expect(A.takeOffTick).toBe(pounce ? NEVER : at);
      }),
    );
  });
});
