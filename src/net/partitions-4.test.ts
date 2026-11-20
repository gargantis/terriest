import { describe, it, vi } from 'vitest';
import { partitioned } from './freezes-testing';

// A partition in warm-up at 4 a side, halves of four (M3 phase 5b):
// partitions.test.ts's case, where the halves' tallies tie. Counted as any
// voter, setting aside for v − 1 ticks the votes of one it saw lose
// (lostAt), the voters a page removed kept both halves winning their own
// tallies at these seeds, each page setting aside a different few: so a
// voter removed for silence has none of its votes set aside, and every page
// counts the other half's alike.

vi.setConfig({ testTimeout: 120_000 });

const SETTLE_MS = 6000; // not a setting: from the release, past the slowest seen (4.05 s for 4–4)

describe('a partition in warm-up ends in one match, at 4 a side (M3 phase 5b)', () => {
  it('4–4, the smallest hash deciding: 6 and 8 s, at the seeds that kept two lineages', () => {
    partitioned({ seed: 1099, packSize: 4, half: 4, at: 2100, ms: 6000, settleMs: SETTLE_MS });
    partitioned({ seed: 1102, packSize: 4, half: 4, at: 2100, ms: 8000, settleMs: SETTLE_MS });
  });
});
