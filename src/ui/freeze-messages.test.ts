import { describe, expect, it, vi } from 'vitest';
import { freezeOnce } from './world-testing';

// freeze.test.ts's case, the phase 4 reviewer's, with the frozen page
// taking the messages held for it before its late timer run, as a browser
// may (PLAN D-15, D-31, C-10; M3 phase 5): taken first, the TICKs as old as
// the freeze reached the median at that very run, and every seed swung.

vi.setConfig({ testTimeout: 120_000 });

const SEEDS = 16; // not a setting: the reviewer's seeds, 601 to 616

describe('a freeze at 1 a side, thawing the messages held first (D-15, C-10, M3 phase 5)', () => {
  it('of 1 s moves no clock at 16 seeds, nor one ending just before the frozen page takes the median, and the page that never froze misses none of its own inputs', async () => {
    const runs = [];
    for (let seed = 1; seed <= SEEDS; seed++) runs.push(await freezeOnce(seed, 'messages', 1000));
    for (const seed of [3, 11]) runs.push(await freezeOnce(seed, 'messages', 850, { before: 40 }));
    for (const r of runs) {
      expect([r.stalled, r.jumps], r.label).toEqual([false, [0, 0]]);
      expect([r.ownAbsent[0], r.late[0]], r.label).toEqual([0, 0]);
      expect(r.verifyMismatches, r.label).toEqual([0, 0]);
    }
  });
});
