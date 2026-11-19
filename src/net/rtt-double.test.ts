import { describe, expect, it, vi } from 'vitest';
import { freezes, THAWS } from './freezes-testing';

// Back-to-back freezes (PLAN D-15; M3's design, research/m3/DESIGN.md,
// §1.6; M3 phase 5a, clock-F1): a page frozen 1 s, on for 1 or 4 ms, and
// frozen 1 s again, at 1 a side. Its second freeze's held TICKs are still
// samples there (TickClock's rule for a hidden page's wakes), but no round
// trip either freeze held is: the page that never froze makes no jump and
// misses none of its own inputs, where it jumped in about half these runs.

vi.setConfig({ testTimeout: 120_000 });

describe('back-to-back freezes at 1 a side move the clock of the page that never froze no more (clock-F1)', () => {
  it.each(THAWS)('1 s frozen, on 1 or 4 ms, 1 s frozen (thawing %s first)', (thaw) => {
    for (const again of [1, 4]) {
      for (const [seed, phase] of [[954, 244], [958, 488], [960, 610]] as const) {
        const r = freezes({ seed, packSize: 1, thaw, phase, ms: 1000, again });
        expect([r.jumps[0], r.ownAbsent[0], r.stalls], r.label).toEqual([0, 0, [0, 0]]);
      }
    }
  });
});
