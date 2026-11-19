import { afterAll, describe, it, vi } from 'vitest';
import { ABSENCES, expectDecisive, type Outcome, playSetup, printSlowest, SPEC_READY } from './setups-testing';

// R-7's check, continued from bots-setups.test.ts (M3's design §8.1, §8.4,
// R-7): seed 7 with the reload away 5 s, and the first of the 10 more
// seeds, each with its Ready tick, and so its start countdown, 31 ticks a
// seed later than the spec's 600, and the reload's absence by turns. Two
// matches a file, so no file runs much over 8 s alone (design §13).

vi.setConfig({ testTimeout: 120_000 });

/** The k-th of the 10 more seeds, 1 to 10: its seed, its Ready tick and its reload's absence. */
const shifted = (k: number, seed: number): [number, number, number] => [seed, SPEC_READY + 31 * k, ABSENCES[k % ABSENCES.length]!];

const runs: Outcome[] = [];
afterAll(() => printSlowest('bots-setups-1.test.ts', runs));

describe("R-7: §16's three-engine setup over the loopback, continued (design §8.1, §8.4)", () => {
  it("ends seed 7 at 0:00 with the bot's pack ahead, the reload away 5 s", () => {
    const r = playSetup(7, SPEC_READY, ABSENCES[2]);
    runs.push(r);
    expectDecisive(r);
  });
  it(`ends seed 1 at 0:00 with the bot's pack ahead, its Ready ${SPEC_READY + 31 * 1}`, () => {
    const r = playSetup(...shifted(1, 1));
    runs.push(r);
    expectDecisive(r);
  });
});
