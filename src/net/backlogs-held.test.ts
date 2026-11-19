import { describe, expect, it, vi } from 'vitest';
import { IN_PLAY } from '../core/sim/index';
import { Rig } from './freezes-testing';

// An honest backlog closes nothing, a held link's either (PLAN D-19; M3's
// design, research/m3/DESIGN.md, §4.10; M3 phase 5a, harness-F1): the
// network holds what reaches one page for a while, its timers running on,
// then lands it at once, as a stalled path does. Counted by arrival, more
// than about 4 s of it closed the page's connections. At 2 a side, all its
// incoming links held, then one.

vi.setConfig({ testTimeout: 120_000 });

const AT = 10_005; // not a setting: in play
const AFTER_MS = 6000; // not a setting: past floodMs after the release

function heldKeepsAll(seed: number, ms: number, from?: readonly number[]): void {
  const rig = new Rig({ seed, packSize: 2 });
  rig.hold(2, AT, ms, from);
  rig.runTo(AT - 5);
  expect(rig.final(0).phase).toBe(IN_PLAY);
  rig.runTo(AT + ms + AFTER_MS);
  const label = `seed ${seed}, held ${ms} ms from ${from === undefined ? 'every page' : `page ${from.join(', ')}`}: ${rig.logs()}`;
  expect(rig.closed(), label).toEqual({ sessions: [[], [], [], []], transport: [] });
  expect(rig.nodes.map((x) => x.neighbours.size), label).toEqual([3, 3, 3, 3]);
  expect(rig.nodes.map((x) => x.session.stalls), label).toEqual([0, 0, 0, 0]);
  rig.expectClean(label);
}

describe("a page's incoming messages held, then landing at once, keep every connection (harness-F1)", () => {
  it('held 2.5, 4.5 and 6 s on every link to it', () => {
    for (const [seed, ms] of [[11, 2500], [12, 4500], [13, 6000]] as const) heldKeepsAll(seed, ms);
  });

  it('held 2.5, 4.5 and 6 s on one link to it', () => {
    for (const [seed, ms] of [[14, 2500], [15, 4500], [16, 6000]] as const) heldKeepsAll(seed, ms, [0]);
  });

  it('held 4.5 s from when it enters the room, its connections’ first TICKs a backlog: the silence since each opened counts', () => {
    // Page 3 enters at 600 ms: pages 1's and 2's first messages to it on their new connections, and all
    // behind them, land 4.5 s on. Page 0's aren't held: it asks page 0 first, whose STATE comes on time.
    const rig = new Rig({ seed: 17, packSize: 2 });
    rig.hold(3, 600, 4500, [1, 2]);
    rig.runTo(600 + 4500 + AFTER_MS);
    const label = `held from entering: ${rig.logs()}`;
    expect(rig.closed(), label).toEqual({ sessions: [[], [], [], []], transport: [] });
    expect(rig.nodes.map((x) => x.neighbours.size), label).toEqual([3, 3, 3, 3]);
    expect(rig.nodes[3]!.session.timeline.started, label).toBe(true);
    rig.expectClean(label);
  });
});
