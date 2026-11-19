import { describe, expect, it, vi } from 'vitest';
import { freezes, THAWS } from './freezes-testing';

// rtt-periodic.test.ts's freezes at 2 a side (clock-F1): the frozen page's
// own round trips to its three peers all swelled with its held pongs, and
// it jumped ahead by its whole inflated median, then back. Now no page
// jumps, and none that never froze misses an input of its own.

vi.setConfig({ testTimeout: 120_000 });

describe('a page frozen 500 ms every second for 10 s at 2 a side moves no clock (clock-F1)', () => {
  it.each(THAWS)('thawing %s first', (thaw) => {
    for (const [seed, phase] of [[804, 244], [805, 305]] as const) {
      const r = freezes({ seed, packSize: 2, thaw, phase, ms: 500 });
      expect([r.jumps, r.ownAbsent.filter((_, k) => k !== 1), r.stalls], r.label).toEqual([[0, 0, 0, 0], [0, 0, 0], [0, 0, 0, 0]]);
    }
  });
});
