import { describe, expect, it, vi } from 'vitest';
import { e2eMatch } from './marks';

// Not a §16 mark: §16's end-to-end setups, which M3's and M4's specs rest
// on (design §8.5). An end-to-end match plays one seed it can't choose, and
// a match level at 0:00 fails its test at once, so over 25 seeds each,
// every whole 1-minute match must end at 0:00 with the bot's pack ahead:
// not level, and not in overtime. The slowest first goal's play time is
// printed, for M4's spec timeouts.
vi.setConfig({ testTimeout: 120_000 });

describe("§16's end-to-end setups", () => {
  for (const setup of ['three-engine', 'practice'] as const) {
    it(`ends every ${setup} match at 0:00 with the bot's pack ahead, over 25 seeds`, () => {
      const runs = Array.from({ length: 25 }, (_, seed) => e2eMatch(setup, seed));
      const bad = runs
        .filter((r) => !(r.ended && !r.overtime && r.score[r.botPack] > r.score[r.botPack === 0 ? 1 : 0]))
        .map((r) => `seed ${r.seed}: ${r.score.join('–')}${r.overtime ? ', overtime' : ''}${r.ended ? '' : ', not ended'}`);
      expect(bad).toEqual([]);
      const slowest = Math.max(...runs.map((r) => r.firstGoalPlay));
      console.log(`${setup}: the slowest first goal came after ${(slowest / 60).toFixed(1)} s of play`);
    });
  }
});
