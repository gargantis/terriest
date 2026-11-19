import { describe, expect, it, vi } from 'vitest';
import type { ThawOrder } from '../net/loopback';
import { freezeOnce } from './world-testing';

// freeze.test.ts's case at the other lengths under the stall threshold, in
// both thaw orders (PLAN D-15, D-31; M3 phase 5): half a second and 1.9 s at
// 1 a side. freeze-four.test.ts plays it at 2 a side.

vi.setConfig({ testTimeout: 120_000 });

const THAWS = ['timer', 'messages'] as const satisfies readonly ThawOrder[];

describe('freezes under the stall threshold at 1 a side (D-15, C-10, M3 phase 5)', () => {
  it.each(THAWS)('of half a second and 1.9 s move no clock, thawing %s first', async (thaw) => {
    const runs = [];
    for (const ms of [500, 1900]) for (const seed of [2, 5, 9, 13]) runs.push(await freezeOnce(seed, thaw, ms));
    // Half a second ending 40 ms before the frozen page takes the median: its held TICKs first.
    for (const seed of [7, 14]) runs.push(await freezeOnce(seed, thaw, 500, { before: 40 }));
    for (const r of runs) {
      expect([r.stalled, r.jumps], r.label).toEqual([false, [0, 0]]);
      expect([r.ownAbsent[0], r.late[0]], r.label).toEqual([0, 0]);
    }
  });
});
