import { describe, expect, it, vi } from 'vitest';
import { freezeOnce } from './world-testing';

// D-15's tick clock at 1 a side, the two pages each the other's one peer
// (PLAN D-15, D-31, C-10; M3's design §1.6, §4.12; M3 phase 5): NetGame in
// virtual time over the loopback, one page frozen 1 s in play, under the
// stall threshold, and thawed its late timer run first; freeze-messages
// thaws the messages held for it first. The phase 4 reviewer's case: those
// TICKs, as old as the freeze, pulled the frozen page's offset about 10
// ticks off; its jump, then both pages jumping the whole median toward each
// other each rebalanceMs, swapped the clocks for good, the page that never
// froze skipping its own inputs as it jumped forward. Now no clock moves.

vi.setConfig({ testTimeout: 120_000 });

const SEEDS = 16; // not a setting: the reviewer's seeds, 601 to 616

describe('a freeze at 1 a side, thawing the late timer run first (D-15, C-10, M3 phase 5)', () => {
  it('of 1 s moves no clock at 16 seeds, nor one ending just before the frozen page takes the median, and the page that never froze misses none of its own inputs', async () => {
    // The reviewer's case, which never swung this way round: the median was taken at the late run,
    // before the held TICKs, and a second of fresh ones came before the next. A freeze that ends
    // 40 ms before the frozen page's rebalance leaves the held TICKs to be taken first.
    const runs = [];
    for (let seed = 1; seed <= SEEDS; seed++) runs.push(await freezeOnce(seed, 'timer', 1000));
    for (const seed of [3, 11]) runs.push(await freezeOnce(seed, 'timer', 850, { before: 40 }));
    for (const r of runs) {
      expect([r.stalled, r.jumps], r.label).toEqual([false, [0, 0]]);
      // The page that ran on: its own input in every final tick, and none of b's came late. (Its hash
      // may still lose a two-voter tally to b's, which took a's held TICKs late: §3.6's repair.)
      expect([r.ownAbsent[0], r.late[0]], r.label).toEqual([0, 0]);
      expect(r.verifyMismatches, r.label).toEqual([0, 0]);
    }
  });
});
