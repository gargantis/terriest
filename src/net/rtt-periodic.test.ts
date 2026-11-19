import { describe, expect, it, vi } from 'vitest';
import { freezes, others, THAWS } from './freezes-testing';

// A page frozen 500 ms every second for 10 s (PLAN D-15, D-31; M3's design,
// research/m3/DESIGN.md, §1.6; M3 phase 5a, clock-F1): its pongs held
// through its freezes, and the pings it held unanswered, inflated round
// trips both ways, the one-way delays swelled, and the clocks leapfrogged
// forward for as long as the freezes lasted, the page that never froze
// skipping its own inputs. Those round trips are no samples now: no page
// that never froze jumps or misses an input of its own, and every hash is
// equal. At 1 a side, each page the other's one peer; rtt-periodic-two
// freezes a page at 2 a side.

vi.setConfig({ testTimeout: 120_000 });

describe('a page frozen 500 ms every second for 10 s moves no other clock (clock-F1)', () => {
  it.each(THAWS)('at 1 a side (thawing %s first)', (thaw) => {
    for (const [seed, phase] of [[804, 244], [801, 61], [807, 427], [812, 732]] as const) {
      const r = freezes({ seed, packSize: 1, thaw, phase, ms: 500 });
      expect([others(r.jumps), others(r.ownAbsent), r.stalls], r.label).toEqual([[0], [0], [0, 0]]);
    }
  });
});
