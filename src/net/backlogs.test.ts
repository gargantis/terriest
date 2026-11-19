import { describe, expect, it, vi } from 'vitest';
import { findTerrier, IN_PLAY } from '../core/sim/index';
import { NET, Rig, THAWS } from './freezes-testing';

// An honest backlog closes nothing (PLAN D-19, D-31; M3's design,
// research/m3/DESIGN.md, §4.10, §4.12; M3 phase 5a, harness-F1): a page
// frozen in play takes every TICK held for it at once when it thaws, and a
// flood's count by arrival closed every connection after a freeze over
// about 4 s, the page then alone for good. Counted by the ticks they carry,
// a backlog's TICKs take a tick each. At 2 a side, frozen past stallMs (a
// rejoin, §4.12) and under it (a catch-up), in both thaw orders.
// backlogs-held.test.ts holds a page's incoming messages instead, and
// backlogs-relay.test.ts holds a forwarder's.

vi.setConfig({ testTimeout: 120_000 });

const AT = 10_005; // not a setting: in play, just after the frozen page's timer pinged
const AFTER_MS = 6000; // not a setting: past floodMs after the rejoin, when the count by arrival closed them

/** Page 2 frozen ms in play at 2 a side: nothing closed, every page connected to every other, the
 *  frozen page back in play, and every hash equal. */
export function frozenKeepsAll(seed: number, ms: number, thaw: (typeof THAWS)[number]): void {
  const rig = new Rig({ seed, packSize: 2, thaw });
  rig.freeze(2, AT, ms);
  rig.runTo(AT - 5);
  expect(rig.final(0).phase).toBe(IN_PLAY);
  rig.runTo(AT + ms + AFTER_MS);
  const label = `seed ${seed}, frozen ${ms} ms, ${thaw} first: ${rig.logs()}`;
  expect(rig.closed(), label).toEqual({ sessions: [[], [], [], []], transport: [] });
  expect(rig.nodes.map((x) => x.neighbours.size), label).toEqual([3, 3, 3, 3]);
  const frozen = rig.nodes[2]!.session;
  expect([frozen.stalls, frozen.stall], label).toEqual([ms > NET.stallMs ? 1 : 0, 'none']);
  // In play again, its terrier's inputs final everywhere.
  for (let k = 0; k < 4; k++) {
    const s = rig.final(k);
    const T = s.terriers[findTerrier(s, frozen.cfg.me)]!;
    expect(s.tick - T.lastInputTick, `${label}: page ${k}`).toBeLessThan(30);
  }
  rig.expectClean(label);
}

describe('a page frozen in play keeps every connection, its backlog no flood (harness-F1)', () => {
  it.each(THAWS)('under the stall threshold, 1.9 s, and past it, 2.5 and 4.5 s (thawing %s first)', (thaw) => {
    for (const [seed, ms] of [[1, 1900], [2, 2500], [3, 4500]] as const) frozenKeepsAll(seed, ms, thaw);
  });

  it.each(THAWS)('for 6 and 8 s (thawing %s first)', (thaw) => {
    for (const [seed, ms] of [[4, 6000], [5, 8000]] as const) frozenKeepsAll(seed, ms, thaw);
  });
});
