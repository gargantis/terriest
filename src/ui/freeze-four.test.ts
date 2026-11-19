import { describe, expect, it, vi } from 'vitest';
import type { ThawOrder } from '../net/loopback';
import { freezeOnce } from './world-testing';

// freeze.test.ts's case at 2 a side, in both thaw orders (PLAN D-15, D-31;
// M3 phase 5): the median of three peers held at the pages that never
// froze, but the frozen one, taking its held TICKs as samples, jumped its
// whole median off and back, its inputs late at the others meanwhile.

vi.setConfig({ testTimeout: 120_000 });

const THAWS = ['timer', 'messages'] as const satisfies readonly ThawOrder[];

describe('a freeze under the stall threshold at 2 a side (D-15, M3 phase 5)', () => {
  it.each(THAWS)('moves no clock, and the pages that never froze miss none of their inputs, thawing %s first', async (thaw) => {
    // 1 s, and 850 ms ending 40 ms before the frozen page takes the median.
    for (const [seed, ms, before] of [[1, 1000, undefined], [6, 1000, undefined], [4, 850, 40], [12, 850, 40]] as const) {
      const r = await freezeOnce(seed, thaw, ms, before === undefined ? { players: 4 } : { players: 4, before });
      expect([r.stalled, r.jumps], r.label).toEqual([false, [0, 0, 0, 0]]);
      for (const k of [0, 2, 3]) expect([r.ownAbsent[k], r.late[k]], `page ${k}, ${r.label}`).toEqual([0, 0]);
      expect(r.verifyMismatches, r.label).toEqual([0, 0, 0, 0]);
    }
  });
});
