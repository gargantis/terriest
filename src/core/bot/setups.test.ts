import { describe, expect, it } from 'vitest';
import { encodeInput, FRAME_BALL, frameOf, heldDirection, jumpCount, pounceCount, stepOf, ZOOMIES } from '../sim/input';
import { defaultParams } from '../sim/params';
import { park, place, placeBall, placedMatch } from '../sim/scenes';
import { CELEBRATION, ENDED, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, type Phase, START_COUNTDOWN, WARM_UP } from '../sim/state';
import { personId } from './bot-id';
import { defaultBotParams, newBrain, think } from './brain';
import { e2eMatch } from './marks';
import { BACK_IN_BALL_VIEW, heldFirstSecond, scriptSampler, SIDEWAYS_IN_BALL_VIEW } from './setups';

// §16's end-to-end setups' scripts (M3's design §1.12, §7.2): the people
// M2's marks scripted, moved here so the #test=net page and the loopback's
// replays run the same code, and the sampler that drives a page's own
// terrier from the timeline's head.

const P = defaultParams;
const B = defaultBotParams;
const me = personId(7, 0);

/** M2's scripted person, as marks.ts defined it before the move (design §8.6). */
const m2Person = (step: number) => (s: Readonly<MatchState>): number =>
  s.phase === IN_PLAY && s.tick - s.phaseStart < 60 ? encodeInput({ step, frame: FRAME_BALL }) : 0;

/** A 1-a-side state in phase, its tick and phaseStart given. */
function at(phase: Phase, tick: number, phaseStart: number): MatchState {
  const s = placedMatch(P, 1, { phase });
  s.tick = tick;
  s.phaseStart = phaseStart;
  return s;
}

describe("§16's end-to-end scripts (M3's design §1.12)", () => {
  it('holds back and sideways in ball view: A.2 inputs with nothing else in them', () => {
    for (const [v, step] of [[BACK_IN_BALL_VIEW, 16], [SIDEWAYS_IN_BALL_VIEW, 8]] as const) {
      expect([heldDirection(v), stepOf(v), frameOf(v), v & ZOOMIES, jumpCount(v), pounceCount(v)]).toEqual([true, step, FRAME_BALL, 0, 0, 0]);
    }
  });

  it('holds its input for the first second of play after each kickoff, and nothing else', () => {
    const person = heldFirstSecond(BACK_IN_BALL_VIEW, P);
    const second = P.config.ticksPerSecond;
    expect([0, 1, second - 1].map((k) => person(at(IN_PLAY, 500 + k, 500)))).toEqual([BACK_IN_BALL_VIEW, BACK_IN_BALL_VIEW, BACK_IN_BALL_VIEW]);
    expect([second, second + 1, 1000].map((k) => person(at(IN_PLAY, 500 + k, 500)))).toEqual([0, 0, 0]);
    for (const phase of [WARM_UP, START_COUNTDOWN, KICKOFF_COUNTDOWN, CELEBRATION, ENDED] as const) {
      expect(person(at(phase, 500, 500)), `phase ${phase}`).toBe(0);
    }
  });

  it("is M2's scripted person on every tick of the end-to-end matches, which the marks play with it", () => {
    for (const [setup, script, step] of [['three-engine', 'back', 16], ['practice', 'sideways', 8]] as const) {
      const sample = scriptSampler(script, me, 0, P, B);
      const m2 = m2Person(step);
      let held = 0;
      let ticks = 0;
      const bad: number[] = [];
      e2eMatch(setup, 7, P, B, (s) => {
        const v = sample(s, s.tick);
        if (v !== m2(s)) bad.push(s.tick);
        if (v !== 0) held++;
        ticks++;
      });
      expect(bad, setup).toEqual([]);
      // Held after each kickoff: far from every tick, and far from none.
      expect(held, setup).toBeGreaterThan(5 * P.config.ticksPerSecond);
      expect(held, setup).toBeLessThan(ticks / 4);
    }
  });

  it("starts a person's press counters from the stored previous input, so its first input presses nothing (D-10)", () => {
    const base = encodeInput({ step: 3, zoomies: true, jump: 3, pounce: 2 });
    const counters = encodeInput({ jump: 3, pounce: 2 });
    const play = at(IN_PLAY, 500, 500);
    const warm = at(WARM_UP, 500, 0);
    expect(scriptSampler('none', me, base, P, B)(play, play.tick)).toBe(counters);
    expect(scriptSampler('back', me, base, P, B)(play, play.tick)).toBe(BACK_IN_BALL_VIEW | counters);
    expect(scriptSampler('back', me, base, P, B)(warm, warm.tick)).toBe(counters);
    expect(scriptSampler('sideways', me, base, P, B)(play, play.tick)).toBe(SIDEWAYS_IN_BALL_VIEW | counters);
    expect(scriptSampler('none', me, 0, P, B)(play, play.tick)).toBe(0);
  });

  it("drives the page's terrier with the brain, from the stored input, thinking once per head tick (M3-Q25)", () => {
    // Behind the ball, lined up with the goal it attacks and in reach: the brain pounces.
    const s = placedMatch(P, 1, { phase: IN_PLAY });
    s.terriers[0]!.id = me;
    placeBall(P, s, 0, 0);
    place(P, s, 0, -2.4, 0);
    s.terriers[0]!.heading = 0;
    park(P, s, 1);
    const base = encodeInput({ jump: 2, pounce: 1 });
    s.terriers[0]!.prevInput = base;
    // Thought on at every call, as a sampler without the rule would, it presses at each.
    const every = newBrain(me, base, P, B);
    expect([1, 2, 3].map(() => pounceCount(think(every, s)))).toEqual([2, 3, 0]);
    // The sampler: one think for a head tick, however many ticks are sent on it.
    const sample = scriptSampler('brain', me, base, P, B);
    const first = sample(s, s.tick);
    expect([jumpCount(first), pounceCount(first)]).toEqual([2, 2]);
    expect([sample(s, s.tick), sample(s, s.tick)]).toEqual([first, first]);
    // A new head tick: it thinks again, as a brain thinking once a tick does.
    const once = newBrain(me, base, P, B);
    think(once, s);
    const next = { ...s, tick: s.tick + 1 };
    const again = sample(next, next.tick);
    expect(again).toBe(think(once, next));
    expect(pounceCount(again)).toBe(3);
    // In warm-up a brain presses nothing: its first input carries the stored counters.
    const warm = at(WARM_UP, 40, 0);
    warm.terriers[0]!.id = me;
    const w = scriptSampler('brain', me, base, P, B)(warm, warm.tick);
    expect([jumpCount(w), pounceCount(w)]).toEqual([2, 1]);
  });
});
