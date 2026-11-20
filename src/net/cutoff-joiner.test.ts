import { describe, it, vi } from 'vitest';
import { joinerHeld } from './freezes-testing';

// A joiner whose incoming links are held as it enters (PLAN D-13, D-15;
// M3's design, research/m3/DESIGN.md, §3.4; M3 phase 5b, the session
// builder's joining split): the STATE it asks for comes 4.5 to 8 s late,
// with every TICK behind it and no round trip yet, so it adopts a state
// that old and sets its clock that far behind the room. It drops the TICKs
// past its window, its clock jumps, it finalises the gap with the others
// absent and removes them, and its JOIN, sent on its old clock, came too
// late for the room: it held itself alone, the room never had it, and every
// tick they shared disagreed for good. Now the voters its lineage removed
// for silence while connected are counted, so its tallies lose to the
// room's, it repairs to the room's state and JOINs again: one match, the
// joiner in every roster.

vi.setConfig({ testTimeout: 120_000 });

const SETTLE_MS = 5500; // not a setting: from the release, past the slowest seen (3.75 s at 2 a side, 4.65 s at 4)

describe('a joiner whose incoming links are held as it enters joins the room (the joining split)', () => {
  it('held 4.5 s, seed 17, as the session builder found it, and 8 s', () => {
    joinerHeld({ seed: 17, packSize: 2, ms: 4500, settleMs: SETTLE_MS });
    joinerHeld({ seed: 1044, packSize: 2, ms: 8000, settleMs: SETTLE_MS });
  });

  it('held 4.5 s at 4 a side', () => {
    joinerHeld({ seed: 1048, packSize: 4, ms: 4500, settleMs: SETTLE_MS });
  });
});
