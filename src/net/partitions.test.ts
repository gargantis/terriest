import { describe, it, vi } from 'vitest';
import { partitioned } from './freezes-testing';

// A partition in warm-up (PLAN D-13; M3's design, research/m3/DESIGN.md,
// §3.2, §3.6; M3 phase 5b): every message between two halves of the room
// held both ways for 4.5 to 8 s, then landing at once. Each half's final
// state removes the other's players for their silence, so each held a match
// of its own for good, one timeline ID with two lineages, each half
// counting only its own roster. Now each counts the voters it removed while
// connected: the most votes win, so the smaller half repairs to the
// larger's state, and of two halves alike the smallest hash wins tick by
// tick, as between any two voters (C-10), every page counting the other
// half's votes alike; the losers JOIN again. One match after, with every page in
// it, no lasting split. partitions-4.test.ts plays halves of four.

vi.setConfig({ testTimeout: 120_000 });

const SETTLE_MS = 3000; // not a setting: from the release, past the slowest seen (1.95 s, 3–5)

describe('a partition in warm-up ends in one match (M3 phase 5b)', () => {
  it('1–1 at 1 a side, the smallest hash deciding: 4.5, 6 and 8 s', () => {
    for (const [seed, ms] of [[1072, 4500], [1075, 6000], [1078, 8000]] as const) {
      partitioned({ seed, packSize: 1, half: 1, at: 900, ms, settleMs: SETTLE_MS });
    }
  });

  it('2–2, the smallest hash deciding: 4.5, 6 and 8 s', () => {
    for (const [seed, ms] of [[1084, 4500], [1087, 6000], [1090, 8000]] as const) {
      partitioned({ seed, packSize: 2, half: 2, at: 1300, ms, settleMs: SETTLE_MS });
    }
  });

  it('1–3 and 3–1, the most votes deciding: 4.5 and 8 s', () => {
    partitioned({ seed: 1081, packSize: 2, half: 1, at: 1300, ms: 4500, settleMs: SETTLE_MS });
    partitioned({ seed: 1093, packSize: 2, half: 3, at: 1300, ms: 8000, settleMs: SETTLE_MS });
  });

  it('3–5 at 4 a side: 8 s', () => {
    partitioned({ seed: 1105, packSize: 4, half: 3, at: 2100, ms: 8000, settleMs: SETTLE_MS });
  });
});
