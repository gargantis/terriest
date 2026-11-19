import { afterAll, describe, it, vi } from 'vitest';
import { ABSENCES, expectDecisive, type Outcome, playSetup, printSlowest, SPEC_READY } from './setups-testing';

// R-7's check (M3's design, research/m3/DESIGN.md, §8.1, §8.4, R-7; PLAN
// §16): §16's three-engine setup over the loopback network, as §8.4 has
// e2e/match.net.spec.ts play it, ends at 0:00 with the bot's pack ahead on
// every page, before the spec relies on it (setups-testing.ts plays it).
// Seed 7, the spec's, with its Ready tick, the reload away 0.5 and 2 s
// here; bots-setups-1.test.ts has the 5 s, and bots-setups-1 to -6 the 10
// more seeds, their Ready ticks, and so their start countdowns, shifted.
// Two matches a file, so no file runs much over 8 s alone (design §13).
// Each file prints its slowest first goal and latest end for the spec's
// timeout.

// Whole matches in virtual time: CPU-bound, as M2's suites are.
vi.setConfig({ testTimeout: 120_000 });

const runs: Outcome[] = [];
afterAll(() => printSlowest('bots-setups.test.ts', runs));

describe("R-7: §16's three-engine setup over the loopback, seed 7 (design §8.1, §8.4)", () => {
  for (const absence of ABSENCES.slice(0, 2)) {
    it(`ends at 0:00 with the bot's pack ahead, the reload away ${absence / 1000} s`, () => {
      const r = playSetup(7, SPEC_READY, absence);
      runs.push(r);
      expectDecisive(r);
    });
  }
});
