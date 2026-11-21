import { afterAll, describe, expect, it, vi } from 'vitest';
import { NEVER } from '../core/sim/index';
import {
  band, drawnFor, expectBotFirst, expectHoldsAsPlayed, expectReadyAt, GOAL_ANCHORS, playSpec, printFirstGoals, type SpecRun, WARM_UP_ENDS,
} from './practice-spec-testing';

// §16's Practice setup as e2e/practice.spec.ts's runs through the controls
// play it in each engine (M4's design, research/m4/DESIGN.md, §9.1, §9.2,
// §9.5, M4-Q36; PLAN §16): seed 7 to the bot's first confirmed goal over
// Practice's own timeline, the person holding A from the start countdown
// and letting it go a second and e ticks into play, e drawn for each run,
// with Ready at every tick of an anchor's band, the first anchor at least
// 120 ticks after the run's warm-up script: practice-spec-goal-1 to -4,
// one band each, here 1,800 to 1,860. And the warm-up script itself, every
// control used once in warm-up, which the kickoff's placement and the
// bot's countdown leave no trace of in play.

vi.setConfig({ testTimeout: 120_000 });

const ANCHOR = GOAL_ANCHORS[2];
const AFTER_SCRIPT = 120; // not a setting: M4's design §9.1's gap from the warm-up script's end to the anchor

describe("the controls run's warm-up script (M4's design §9.5)", () => {
  it(`leaves the first goal as it was, every control used once before Ready at ${ANCHOR}`, () => {
    expect(ANCHOR - WARM_UP_ENDS).toBeGreaterThanOrEqual(AFTER_SCRIPT);
    const late = drawnFor(ANCHOR, 'goal');
    const plain = playSpec({ ready: ANCHOR, late, to: 'goal' });
    const warm = playSpec({ ready: ANCHOR, late, to: 'goal', warmUp: true });
    // It ran, jumped and touched the ball in warm-up, and its counters moved; the placement kept them.
    const [a, b] = [plain.plays[0]!.person, warm.plays[0]!.person];
    expect([a.takeOffTick, a.lastBallContactTick]).toEqual([NEVER, NEVER]);
    expect([b.takeOffTick !== NEVER, b.lastBallContactTick !== NEVER, b.gait !== a.gait, b.prevInput !== a.prevInput]).toEqual([true, true, true, true]);
    expect(warm.plays[0]!.hash).not.toBe(plain.plays[0]!.hash);
    // And nothing it did reaches play: the same first goal, every body the same at its latch.
    expect([warm.goals[0], warm.bodies]).toEqual([plain.goals[0], plain.bodies]);
    expectBotFirst(warm);
    // And from the start countdown on, it held A as the spec does, and nothing else.
    expectHoldsAsPlayed(warm);
  });
});

const runs: SpecRun[] = [];
afterAll(() => printFirstGoals('practice-spec-goal-3.test.ts', runs));

describe(`§16's Practice setup to the bot's first goal, seed 7, Ready at ${ANCHOR}–${band(ANCHOR).at(-1)} (M4's design §9.2)`, () => {
  for (const ready of band(ANCHOR)) {
    it(`ends with the bot's first confirmed goal: Ready at ${ready}, e drawn`, () => {
      const r = playSpec({ ready, late: drawnFor(ready, 'goal'), to: 'goal' });
      runs.push(r);
      expectReadyAt(r, ready);
      expectBotFirst(r);
      expectHoldsAsPlayed(r);
    });
  }
});
