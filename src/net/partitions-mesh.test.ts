import { describe, it, vi } from 'vitest';
import { partitioned } from './freezes-testing';

// A partition in warm-up in a partial mesh (PLAN D-13, D-19; M3's design,
// research/m3/DESIGN.md, §3.2, §4.10; M3 phase 5b, split-F2): partitions.test.ts's
// case where some pairs can't connect, so each page reaches part of the
// other half only through a forwarder. Counting only the voters it removed
// on a connection of their own, each page counted fewer of the other half
// than its own half holds, won every tally and kept its half's lineage: two
// matches for good under one timeline ID. Now a voter removed while a
// connection's latest PEERS lists it, whose FWDs this page takes, counts as
// one removed on a connection: one match after.

vi.setConfig({ testTimeout: 120_000 });

const SETTLE_MS = 3500; // not a setting: from the release, past the slowest seen (2.65 s, 2–2)

describe('a partition in warm-up in a partial mesh ends in one match (split-F2)', () => {
  it('2–2, each page linked to one of the other half: 8 s', () => {
    partitioned({ seed: 9104, packSize: 2, half: 2, at: 1300, ms: 8000, settleMs: SETTLE_MS, blocked: [[0, 3], [1, 2]] });
  });

  it('4–4, each page blocked from one of the other half: 8 s', () => {
    partitioned({ seed: 9116, packSize: 4, half: 4, at: 2100, ms: 8000, settleMs: SETTLE_MS, blocked: [[0, 4], [1, 5], [2, 6], [3, 7]] });
  });
});
