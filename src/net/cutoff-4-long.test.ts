import { describe, it, vi } from 'vitest';
import { cutOff } from './freezes-testing';

// A page cut off from the room in warm-up for 8 s, at 4 a side (M3 phase
// 5b, flood-F3): cutoff-4.test.ts's case, held longer than the final
// history's 4.3 s, so no late vote of the room's names a tick its history
// still holds, at phase 5a's reviewer's seed and the last page.

vi.setConfig({ testTimeout: 120_000 });

const AT = 2100; // not a setting: in warm-up, after the last page joined, before Ready
const SETTLE_MS = 2500; // not a setting: from the release, past the slowest repair seen (0.7 s)

describe('a page whose incoming links are held 8 s in warm-up repairs to the room, at 4 a side (flood-F3)', () => {
  it('seed 398', () => {
    cutOff({ seed: 398, packSize: 4, page: 1, at: AT, ms: 8000, settleMs: SETTLE_MS });
  });

  it('the last page, seed 3980', () => {
    cutOff({ seed: 3980, packSize: 4, page: 7, at: AT, ms: 8000, settleMs: SETTLE_MS });
  });
});
