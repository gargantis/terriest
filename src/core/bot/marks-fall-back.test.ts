import { describe, expect, it, vi } from 'vitest';
import { fallBackRun } from './marks';

// §16's fall-back mark (L142, Q-9; design §8.5, §8.6): placed in play at
// each pack size, every terrier a bot, pack A on the attacking side of a
// seeded ball and a pack-B rival nearer it than pack A's nearest bot. In at
// least 90 of 100 at each size, that bot is moving toward Q, 3 m from the
// ball toward its own goal's centre, 0.5 s after its reaction delay: within
// 1.5 m of it, or at 1 m/s or more within 45° of it.
vi.setConfig({ testTimeout: 120_000 });

describe('the fall-back (§16, L142)', () => {
  for (let packSize = 1; packSize <= 4; packSize++) {
    it(`gets between the ball and its own goal when a rival is nearer, ${packSize} a side, in at least 90 of 100`, () => {
      const runs = Array.from({ length: 100 }, (_, seed) => fallBackRun(packSize, seed));
      const failed = runs.filter((r) => !r.pass).map((r) => `${r.seed} (${r.distance.toFixed(2)} m from Q, ${r.speed.toFixed(2)} m/s, cos ${r.cos.toFixed(2)})`);
      expect(100 - failed.length, `failed: ${failed.join('; ')}`).toBeGreaterThanOrEqual(90);
    });
  }
});
