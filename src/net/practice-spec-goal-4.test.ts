import { afterAll, describe, expect, it, vi } from 'vitest';
import { NEVER } from '../core/sim/index';
import {
  band, CONTACT_WARM_UP, drawnFor, expectBotFirst, expectHoldsAsPlayed, expectReadyAt, GOAL_ANCHORS, PAGE_WARM_UP, playSpec, printFirstGoals, type SpecRun,
} from './practice-spec-testing';

// §16's Practice setup as e2e/practice.spec.ts's runs through the controls
// play it in each engine (M4's design, research/m4/DESIGN.md, §9.1, §9.2,
// §9.5, M4-Q36; PLAN §16): seed 7 to the bot's first confirmed goal over
// Practice's own timeline, the person warming up as the page's controls
// run does, every control used once, then holding A from the start
// countdown and letting it go a second and e ticks into play, e drawn for
// each run, with Ready at every tick of an anchor's band, the first anchor
// at least 120 ticks after the warm-up script: practice-spec-goal-1 to -4,
// one band each, here 2,400 to 2,460. And the warm-up scripts themselves, the
// page's kind and one that meets the ball, which the kickoff's placement
// and the bot's countdown leave no trace of in play.

vi.setConfig({ testTimeout: 120_000 });

const ANCHOR = GOAL_ANCHORS[3];
const AFTER_SCRIPT = 120; // not a setting: M4's design §9.1's gap from the warm-up script's end to the anchor

describe("the controls run's warm-up scripts (M4's design §9.5)", () => {
  it(`leave the first goal as it was, every control used once before Ready at ${ANCHOR}`, () => {
    const late = drawnFor(ANCHOR, 'goal');
    const plain = playSpec({ ready: ANCHOR, late, to: 'goal' });
    const a = plain.plays[0]!.person;
    expect([a.takeOffTick, a.lastBallContactTick]).toEqual([NEVER, NEVER]);
    for (const [name, warmUp] of [['the page\'s kind', PAGE_WARM_UP], ['one meeting the ball', CONTACT_WARM_UP]] as const) {
      expect(ANCHOR - warmUp.ends, name).toBeGreaterThanOrEqual(AFTER_SCRIPT);
      const warm = playSpec({ ready: ANCHOR, late, to: 'goal', warmUp });
      // It ran and jumped in warm-up, and its counters moved; the placement kept them. The one meeting the
      // ball left its contact tick too; the page's kind may, where the bot's wander knocks the ball into it.
      const b = warm.plays[0]!.person;
      expect([b.takeOffTick !== NEVER, b.gait !== a.gait, b.prevInput !== a.prevInput], name).toEqual([true, true, true]);
      if (warmUp === CONTACT_WARM_UP) expect(b.lastBallContactTick, name).not.toBe(NEVER);
      expect(warm.plays[0]!.hash, name).not.toBe(plain.plays[0]!.hash);
      // And nothing it did reaches play: the same first goal, every body the same at its latch.
      expect([warm.goals[0], warm.bodies], name).toEqual([plain.goals[0], plain.bodies]);
      expectBotFirst(warm);
      // And from the start countdown on, it held A as the spec does, and nothing else.
      expectHoldsAsPlayed(warm);
    }
  });
});

const runs: SpecRun[] = [];
afterAll(() => printFirstGoals('practice-spec-goal-4.test.ts', runs));

describe(`§16's Practice setup to the bot's first goal, seed 7, the page's warm-up, Ready at ${ANCHOR}–${band(ANCHOR).at(-1)} (M4's design §9.2)`, () => {
  for (const ready of band(ANCHOR)) {
    it(`ends with the bot's first confirmed goal: Ready at ${ready}, e drawn`, () => {
      const r = playSpec({ ready, late: drawnFor(ready, 'goal'), to: 'goal', warmUp: PAGE_WARM_UP });
      runs.push(r);
      expectReadyAt(r, ready);
      expectBotFirst(r);
      expectHoldsAsPlayed(r);
    });
  }
});
