import { afterAll, describe, expect, it, vi } from 'vitest';
import { SIDEWAYS_IN_BALL_VIEW, specSampler } from '../core/bot/setups';
import {
  CELEBRATION, defaultParams, encodeInput, ENDED, genesis, heldDirection, IN_PLAY, jumpCount, KICKOFF_COUNTDOWN, type MatchState, NEVER,
  type Phase, pounceCount, START_COUNTDOWN, WARM_UP,
} from '../core/sim/index';
import {
  band, drawnFor, expectBotFirst, expectHoldsAsPlayed, expectReadyAt, expectWhole, HOLD_STARTS, ON_TIME, playSpec, playWhole, printEnds, releases,
  type SpecRun, WHOLE_ANCHOR, WHOLE_SHARES, wholeShare,
} from './practice-spec-testing';

// §16's Practice setup as e2e/practice.spec.ts plays it through the real
// page (M4's design, research/m4/DESIGN.md, §9.1, §9.2, §9.5, M4-Q36; PLAN
// §16): seed 7's whole match over Practice's own timeline, the person
// holding A from each countdown and letting it go a second and e ticks
// into play, the menu opened at the second and fourth goals, ends at 0:00
// with the bot's pack ahead, before the spec relies on it
// (practice-spec-testing.ts plays it). Ready at every tick from 600 to 660
// across practice-spec-whole-1 to -6, here 600 to 608, each with e at 0,
// at 60 and drawn for each kickoff, so no file runs much over 8 s alone;
// here too the specs' scripts themselves, and the hold begun at the
// countdown's first tick, its middle or 30 ticks before its end.

// Whole matches in virtual time: CPU-bound, as M3's setups are.
vi.setConfig({ testTimeout: 120_000 });

const P = defaultParams;
const SECOND = P.config.ticksPerSecond;

/** A sampler's input on each tick of a head moving a tick at a time through these phases, each from its
 *  first tick, to end. */
function sampled(sample: (s: Readonly<MatchState>) => number, plan: readonly (readonly [Phase, number])[], end: number): number[] {
  const s = genesis({ packSize: 1, matchMinutes: 1 }, P);
  const out: number[] = [];
  let k = 0;
  for (let tick = 0; tick <= end; tick++) {
    while (k + 1 < plan.length && plan[k + 1]![1] <= tick) k++;
    [s.phase, s.phaseStart, s.tick] = [plan[k]![0], plan[k]![1], tick];
    out.push(sample(s));
  }
  return out;
}

/** The first and last tick of each run of ticks whose input holds a direction. */
function spans(inputs: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  inputs.forEach((v, tick) => {
    if (!heldDirection(v)) return;
    const last = out.at(-1);
    if (last !== undefined && last[1] === tick - 1) last[1] = tick;
    else out.push([tick, tick]);
  });
  return out;
}

// A match's phases as a head shows them: the start countdown at 100, play at
// 400, a goal at 700, a kickoff at 904 and play at 1084, a goal 26 ticks
// into it, sooner than any release, a kickoff at 1314, play at 1494, the
// end at 2000.
const PLAN: readonly (readonly [Phase, number])[] = [ // not a setting: a scene's ticks
  [WARM_UP, 0], [START_COUNTDOWN, 100], [IN_PLAY, 400], [CELEBRATION, 700], [KICKOFF_COUNTDOWN, 904], [IN_PLAY, 1084], [CELEBRATION, 1110],
  [KICKOFF_COUNTDOWN, 1314], [IN_PLAY, 1494], [ENDED, 2000],
];
const LATE = [5, 10, 20]; // not a setting: e for each kickoff of the scene

describe("the specs' scripts (M4's design §9.1, M4-Q36)", () => {
  it('holds the direction from each countdown, from its first tick, middle or 30 ticks before its end, to a second of play and e more', () => {
    const late = (k: number): number => LATE[k]!;
    const base = encodeInput({ jump: 2, pounce: 1 });
    const want = {
      // Let go at 400 + 60 + 5; then held from the kickoff at 904 through the quick goal's celebration
      // and the next countdown, to 1494 + 60 + 20, the third kickoff's e.
      first: [[100, 464], [904, 1573]],
      middle: [[250, 464], [994, 1573]],
      latest: [[370, 464], [1054, 1573]],
    };
    for (const [name, from] of Object.entries(HOLD_STARTS)) {
      const inputs = sampled(specSampler({ hold: { input: SIDEWAYS_IN_BALL_VIEW, late, from } }, base, P), PLAN, 2100);
      expect(spans(inputs), name).toEqual(want[name as keyof typeof want]);
      // The held input is the hold's; and every input keeps base's counters, so it presses nothing (D-10).
      expect(new Set(inputs.map((v) => (heldDirection(v) ? v & ~base : -1))), name).toEqual(new Set([-1, SIDEWAYS_IN_BALL_VIEW]));
      expect(new Set(inputs.map((v) => `${jumpCount(v)} ${pounceCount(v)}`)), name).toEqual(new Set(['2 1']));
    }
    // From the first tick by default; the release's e from each kickoff's count, the start's 0.
    const plain = sampled(specSampler({ hold: { input: SIDEWAYS_IN_BALL_VIEW, late } }, 0, P), PLAN, 2100);
    expect(spans(plain)).toEqual(want.first);
    expect(spans(sampled(specSampler({ hold: { input: SIDEWAYS_IN_BALL_VIEW, late: () => 0 } }, 0, P), PLAN, 2100))).toEqual([
      [100, 459], [904, 1553],
    ]);
    // No hold, no direction.
    expect(spans(sampled(specSampler({}, 0, P), PLAN, 2100))).toEqual([]);
  });

  it("presses jump in the start countdown, one a sample, each with a second of it left, on base's counters (M4's design §4.6, §9.4)", () => {
    const base = encodeInput({ jump: 2, pounce: 1 });
    const inputs = sampled(specSampler({ jumps: [0, 0, 30] }, base, P), PLAN, 2100);
    const counts = inputs.map(jumpCount);
    // 2 before, then 3, 0 (4 mod 4) on the next sample, and 1 at 30 ticks in; then it stays.
    expect([counts[99], counts[100], counts[101], counts[102], counts[129], counts[130], counts[2100]]).toEqual([2, 3, 0, 0, 0, 1, 1]);
    expect(new Set(inputs.map(pounceCount))).toEqual(new Set([1]));
    expect(spans(inputs)).toEqual([]);
    // A press whose first sample comes with less than a second of the countdown left, after a head
    // that skipped ticks, is never made.
    const presses = specSampler({ jumps: [0, 200] }, 0, P);
    const s = genesis({ packSize: 1, matchMinutes: 1 }, P);
    const at = (phase: Phase, phaseStart: number, tick: number): number => {
      [s.phase, s.phaseStart, s.tick] = [phase, phaseStart, tick];
      return jumpCount(presses(s));
    };
    const late = 100 + P.startCountdownTicks - SECOND + 1;
    expect([at(START_COUNTDOWN, 100, 100), at(START_COUNTDOWN, 100, 110), at(START_COUNTDOWN, 100, late), at(IN_PLAY, 400, 400)]).toEqual([1, 1, 1, 1]);
    // The boundary: a jump sampled with exactly a second of the countdown left is pressed; one first
    // sampled a tick later never is.
    const edge = P.startCountdownTicks - SECOND;
    const firstSampledAt = (tick: number): [number, number] => {
      const sampler = specSampler({ jumps: [edge] }, 0, P);
      const h = genesis({ packSize: 1, matchMinutes: 1 }, P);
      [h.phase, h.phaseStart, h.tick] = [START_COUNTDOWN, 100, tick];
      const then = jumpCount(sampler(h));
      [h.phase, h.phaseStart, h.tick] = [IN_PLAY, 400, 400];
      return [then, jumpCount(sampler(h))];
    };
    expect(firstSampledAt(100 + edge)).toEqual([1, 1]);
    expect(firstSampledAt(100 + edge + 1)).toEqual([0, 0]);
    // And one that couldn't leave a second of it isn't a script.
    expect(() => specSampler({ jumps: [P.startCountdownTicks - SECOND + 1] }, 0, P)).toThrow(/less than a second/);
    expect(() => specSampler({ jumps: [-1] }, 0, P)).toThrow(/less than a second/);
    expect(() => specSampler({ jumps: [P.startCountdownTicks - SECOND] }, 0, P)).not.toThrow();
  });

  it("presses that D-10 drops act nowhere: three jumps in Practice's start countdown move the counter and nothing else", () => {
    const plain = playSpec({ ready: WHOLE_ANCHOR, late: ON_TIME, to: 'goal' });
    const pressed = playSpec({ ready: WHOLE_ANCHOR, late: ON_TIME, to: 'goal', jumps: [0, 30, 60] });
    const [a, b] = [plain.plays[0]!.person, pressed.plays[0]!.person];
    // At play's first tick: the stored input holds the counter, 3, and no jump was taken.
    expect([jumpCount(a.prevInput), jumpCount(b.prevInput), a.takeOffTick, b.takeOffTick]).toEqual([0, 3, NEVER, NEVER]);
    expect({ ...b, prevInput: a.prevInput }).toEqual(a);
    // And the match after it is the same: the first goal, and every body at its latch.
    expect([pressed.goals[0], pressed.bodies]).toEqual([plain.goals[0], plain.bodies]);
    expectBotFirst(pressed);
    expectHoldsAsPlayed(pressed);
  });

  it('shares 600–660 among the six files, every tick once', () => {
    expect(WHOLE_SHARES.flatMap((_, k) => wholeShare(k + 1))).toEqual(band(WHOLE_ANCHOR));
    expect(WHOLE_SHARES).toHaveLength(6);
  });
});

describe("the hold's start in the countdown (M4's design §9.2)", () => {
  it("leaves the state at every play's first tick the same, begun at the countdown's first tick, its middle or 30 ticks before its end", () => {
    const late = drawnFor(WHOLE_ANCHOR, 'whole');
    const [first, ...others] = Object.entries(HOLD_STARTS).map(([name, from]) => {
      const r = playWhole(WHOLE_ANCHOR, late, from);
      expectWhole(r);
      expectHoldsAsPlayed(r, from);
      return [name, r] as const;
    });
    const [, a] = first!;
    // Every play's first tick seen, the start's and each kickoff's.
    expect(a.plays.map((p) => p.tick)).toEqual(a.periods.flatMap((p) => (p.play === null ? [] : [p.play])));
    for (const [name, b] of others) {
      expect(b.plays, name).toEqual(a.plays);
      expect([b.end, b.stopHash], name).toEqual([a.end, a.stopHash]);
    }
  });
});

const runs: SpecRun[] = [];
afterAll(() => printEnds('practice-spec-whole-1.test.ts', runs));

const READY = wholeShare(1);

describe(`§16's Practice setup over Practice's own timeline, seed 7, Ready at ${READY[0]}–${READY.at(-1)} (M4's design §9.2)`, () => {
  for (const ready of READY) {
    for (const [name, late] of releases(ready)) {
      it(`ends at 0:00 with the bot's pack ahead: Ready at ${ready}, e ${name}`, () => {
        const r = playWhole(ready, late);
        runs.push(r);
        expectReadyAt(r, ready);
        expectWhole(r);
        expectHoldsAsPlayed(r);
      });
    }
  }
});
