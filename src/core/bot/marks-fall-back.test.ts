import { describe, expect, it, vi } from 'vitest';
import { CHASE, FALL_BACK } from './brain';
import { chargesTheBall, type FallBackPlay, fallBackRun, type FallBackRun, noFallBack, theBrain } from './marks';

// §16's fall-back mark (L142, Q-9), restated for bots-F1 (marks.ts's
// fallBackRun says how): seeded states at each pack size in which a rival is
// nearer the ball than a pack's nearest bot; in at least 90 of 100, that bot
// is moving toward a point between the ball and its own goal within 0.5 s
// after its reaction delay. Two test-only brains, one with no fall-back and
// one that charges the ball, show the mark can fail. Exact operations, so
// the counts are the same everywhere (D-39).
vi.setConfig({ testTimeout: 120_000 });

const runs = (packSize: number, play: FallBackPlay): FallBackRun[] => Array.from({ length: 100 }, (_, seed) => fallBackRun(packSize, seed, play));

describe('the fall-back (§16, L142)', () => {
  for (let packSize = 1; packSize <= 4; packSize++) {
    it(`gets toward Q, between the ball and its own goal, when a rival at the ball is nearer, ${packSize} a side, in at least 90 of 100`, () => {
      const all = runs(packSize, theBrain);
      // Each state is §16's, as the brain sees it too: it falls back at once.
      expect(all.filter((r) => r.role !== FALL_BACK).map((r) => r.seed)).toEqual([]);
      const failed = all.filter((r) => !r.pass).map((r) => `${r.seed} (${r.how})`);
      expect(100 - failed.length, `failed: ${failed.join('; ')}`).toBeGreaterThanOrEqual(90);
    });
  }
});

describe('the fall-back mark can fail (bots-F1)', () => {
  for (const [what, play, role] of [['with no fall-back', noFallBack, CHASE], ['that charges the ball', chargesTheBall, FALL_BACK]] as const) {
    for (let packSize = 1; packSize <= 4; packSize++) {
      it(`fails a brain ${what}, ${packSize} a side`, () => {
        const all = runs(packSize, play);
        expect(all.filter((r) => r.role !== role).map((r) => r.seed)).toEqual([]);
        const passed = all.filter((r) => r.pass).length;
        expect(passed, `${passed} of 100 passed`).toBeLessThan(90);
      });
    }
  }
});
