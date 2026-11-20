import { describe, expect, it, vi } from 'vitest';
import { IN_PLAY } from '../core/sim/index';
import { Rig } from './freezes-testing';

// A page cut off from the room in play, and a partition in play (PLAN D-13,
// D-16; M3's design, research/m3/DESIGN.md, §3.2; M3 phase 5b): from the
// start countdown no silent terrier is removed, it sits, so a held page's
// tallies count the room's votes all along and it repairs once they land,
// as backlogs-held.test.ts has it for up to 6 s. Here 8 s, past the final
// history, and both halves of a partition held as long: one match after,
// nothing closed. These pass without phase 5b's count of the voters a
// lineage removed, which only warm-up's removals reach: they guard the
// in-play holds against it (split-F4).

vi.setConfig({ testTimeout: 120_000 });

const AT = 10_005; // not a setting: in play
const SETTLE_MS = 2500; // not a setting: from the release, past the slowest repair seen

describe('held in play, one match after (M3 phase 5b)', () => {
  it('every link to one page held 8 s', () => {
    const rig = new Rig({ seed: 64, packSize: 2 });
    rig.hold(2, AT, 8000);
    rig.runTo(AT - 5);
    expect(rig.final(0).phase).toBe(IN_PLAY);
    rig.settle('page 2 held 8 s in play', AT + 8000, SETTLE_MS);
    expect(rig.nodes.map((x) => x.neighbours.size)).toEqual([3, 3, 3, 3]);
    expect(rig.nodes[2]!.session.timeline.stats.resyncs).toBeGreaterThanOrEqual(1);
  });

  it('a partition, 2–2, 8 s', () => {
    const rig = new Rig({ seed: 65, packSize: 2 });
    rig.partition(2, AT, 8000);
    rig.runTo(AT - 5);
    expect(rig.final(0).phase).toBe(IN_PLAY);
    rig.settle('2–2 for 8 s in play', AT + 8000, SETTLE_MS);
    expect(rig.nodes.map((x) => x.neighbours.size)).toEqual([3, 3, 3, 3]);
  });
});
