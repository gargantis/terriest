import { describe, it, vi } from 'vitest';
import { cutOff } from './freezes-testing';

// A page cut off from the room in warm-up, at 4 a side (M3 phase 5b,
// flood-F3): cutoff.test.ts's case with seven others, its lineage removing
// all seven, at phase 5a's reviewer's seeds. Split for design §13's 8 s a
// file: cutoff-4-long.test.ts holds 8 s.

vi.setConfig({ testTimeout: 120_000 });

const AT = 2100; // not a setting: in warm-up, after the last page joined, before Ready
const SETTLE_MS = 2500; // not a setting: from the release, past the slowest repair seen (0.7 s)

describe('a page whose incoming links are held in warm-up repairs to the room, at 4 a side (flood-F3)', () => {
  it('held 4.5 s, seed 390', () => {
    cutOff({ seed: 390, packSize: 4, page: 1, at: AT, ms: 4500, settleMs: SETTLE_MS });
  });

  it('held 6 s, seed 394', () => {
    cutOff({ seed: 394, packSize: 4, page: 1, at: AT, ms: 6000, settleMs: SETTLE_MS });
  });
});
