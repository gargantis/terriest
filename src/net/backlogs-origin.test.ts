import { describe, expect, it, vi } from 'vitest';
import { Rig, THAWS } from './freezes-testing';

// A backlog of FWDs for an origin new to the page they reach closes nothing
// (PLAN D-19; M3's design, research/m3/DESIGN.md, §4.10; M3 phase 5a,
// flood-F2): page 1 can't reach the last page to join, and gets its TICKs
// forwarded. A count for an origin new to a page starts from when the
// forwarder's PEERS listed it there, or from when the forwarder's link went
// silent, if that ended just now: so when page 1 is frozen as the last page
// enters, and thaws to the forwarder's PEERS listing it and its relayed
// backlog together, or when the forwarder is frozen as the last page starts
// sending and relays its backlog at its thaw, the backlog meets the silence
// it was held through. A count for a new origin as if silent floodMs at
// most closed the forwarder after about 363 FWDs. At 3 a side, frozen 8 s,
// in both thaw orders.

vi.setConfig({ testTimeout: 120_000 });

type Inner = { peers: Map<string, { player: string; peers: ReadonlySet<string> | null }> };

/** 3 a side, page 1 blocked from the last; `freeze` picks the page frozen ms and when, polled each ms
 *  from the start; nothing closed, every page in the match, every hash equal. */
function keepsAll(seed: number, thaw: (typeof THAWS)[number], label: string, freeze: (rig: Rig) => number | null): void {
  const ms = 8000; // not a setting: past floodMs and the stall threshold
  const rig = new Rig({ seed, packSize: 3, thaw, blocked: [[1, 5]] });
  let frozen = -1;
  let at = -1;
  const poll = (): void => {
    const k = freeze(rig);
    if (k === null) {
      rig.net.at(rig.net.now + 1, poll);
      return;
    }
    frozen = k;
    at = rig.net.now;
    rig.freeze(k, at, ms);
  };
  rig.net.at(1, poll);
  rig.runTo(20_000 + ms);
  const what = `seed ${seed}, ${label}: page ${frozen} frozen ${ms} ms from ${Math.round(at)}, ${thaw} first: ${rig.logs()}`;
  expect(frozen, what).toBeGreaterThanOrEqual(0);
  expect(rig.closed(), what).toEqual({ sessions: rig.nodes.map(() => []), transport: [] });
  expect(rig.nodes.map((x) => x.neighbours.size), what).toEqual([5, 4, 5, 5, 5, 4]);
  for (const x of rig.nodes) expect(x.session.timeline.final.terriers.length, what).toBe(6);
  rig.expectClean(what);
}

describe('a backlog of FWDs for an origin new to the page they reach closes nothing (flood-F2)', () => {
  it.each(THAWS)('page 1 frozen as the last page enters, thawing to its relayed backlog (thawing %s first)', (thaw) => {
    // Once page 1 is connected both ways to every page but the last, before the last enters.
    keepsAll(41, thaw, 'the receiver frozen', (rig) => {
      const p1 = rig.nodes[1]!;
      const ready = rig.nodes.every((x, k) => k === 1 || k === 5 || (x.neighbours.has(p1.id) && p1.neighbours.has(x.id)));
      return ready ? 1 : null;
    });
  });

  it.each(THAWS)("the forwarder frozen as the last page starts sending, relaying its backlog at its thaw (thawing %s first)", (thaw) => {
    // Page 1's forwarder for the last page, the smallest player ID whose PEERS lists it there, once
    // one does and before the last page's first TICK.
    keepsAll(52, thaw, 'the forwarder frozen', (rig) => {
      const last = rig.nodes[5]!.session;
      expect(last.timeline.started && last.timeline.stats.sent > 0).toBe(false);
      const inner = (rig.nodes[1]!.session as unknown as Inner).peers;
      const listing = [...inner.entries()].filter(([, i]) => i.peers?.has(last.cfg.me)).sort(([, a], [, b]) => (a.player < b.player ? -1 : 1));
      return listing.length === 0 ? null : rig.nodes.findIndex((x) => x.id === listing[0]![0]);
    });
  });
});
