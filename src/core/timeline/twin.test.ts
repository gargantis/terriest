import { describe, expect, it, vi } from 'vitest';
import { netSettings } from '../session/settings';
import { encodeInput, FRAME_PITCH, type InputParts, JOIN } from '../sim';
import { type Mode, Pump, type PumpNode, spoil, twin } from './testing';
import type { Timeline } from './timeline';

// twin, testing.ts's check of a run against its full replay (design §2.7,
// §8.1; PLAN D-11): the full replay steps every final where the incremental
// run reuses predictions, so a catch-up longer than the spread's cap is
// spread over more advances there, its finals later and its head held
// longer. twin compares the two at their common ticks: every final tick
// both made, by tick, and the drawn heads at the advances where neither
// had a spread pending. It passes a joiner's catch-up spread differently,
// and still catches a final or a drawn head planted in one run alone.

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const MATCH = '7e1a7e1a7e1a7e1a';

const playerId = (k: number): string => (0xb0 + k).toString(16).padStart(32, '0');

const pump = (mode: Mode): Pump => new Pump({ mode, ids: playerId, corrections: true });

/** A wandering input from the local tick: a step that changes every 16 ticks, a jump now and then. */
function wander(k: number, t: Timeline): () => number {
  return () => {
    const n = t.localTick;
    const p: InputParts = { frame: FRAME_PITCH, jump: (n >> 6) & 3 };
    if (((n >> 5) + k) % 4 !== 0) p.step = ((n >> 4) * 7 + k * 5) & 31;
    return encodeInput(p);
  };
}

function plays(n: PumpNode, pack: number): void {
  n.t.start(0, { packSize: 2, matchMinutes: 1 }, MATCH);
  n.t.sending = true;
  n.t.controls = wander(n.k, n.t);
  n.t.queueEvent(n.id, { events: JOIN, joinPack: pack, coat: n.k, name: `P${n.k}` });
}

/** a and b play; a's timers wake once a second from 2 s on, so c, asking it at 2.9 s, takes a STATE
 *  most of a second old and catches up about a second of ticks once its warm-up ends: predictions
 *  reused incrementally, every one stepped in the full replay, past the cap, so spread. Then `end`
 *  runs 3 s on, 150 ms before the run stops, sooner than a tally could see what it changes. */
function lateJoin(q: Pump, end?: (q: Pump, nodes: readonly PumpNode[]) => void): readonly PumpNode[] {
  const nodes = [q.add(), q.add()];
  nodes.forEach((n, k) => plays(n, k));
  q.run(2000);
  nodes[0]!.pace = 1000;
  q.run(900);
  const c = q.add();
  c.t.requestState(nodes[0]!.peer);
  q.run(3000);
  end?.(q, [...nodes, c]);
  q.run(150);
  return [...nodes, c];
}

/** What twin found the two runs disagree on, for one node: the differences it lists, or the
 *  assertion it failed instead. */
function disagreement(run: (q: Pump) => void): unknown {
  try {
    twin(pump, run);
  } catch (e) {
    const x = e as { message?: string; actual?: unknown };
    return /^node \d+:/.test(x.message ?? '') ? x.actual : x.message;
  }
  return 'no difference';
}

/** The node's spreads, as twin reads them: each advance's, s where one was pending. */
const spreads = (n: PumpNode): string => n.watch.steps.map((s) => (s.calm ? '.' : 's')).join('');

describe('twin (design §2.7)', () => {
  it("passes a joiner's catch-up spread over more advances in the full replay than incrementally, its finals and heads the same at their common ticks", () => {
    const runs: Pump[] = [];
    const inc = twin(pump, (q) => {
      runs.push(q);
      lateJoin(q);
    });
    const [, full] = runs as [Pump, Pump];
    const [ci, cf] = [inc.nodes[2]!, full.nodes[2]!];
    // The joiner caught up past the cap: reusing incrementally, stepping and spreading in the full replay.
    expect(ci.t.stats.reusedFinals).toBeGreaterThan(NET.timeline.spreadCap);
    expect(cf.t.stats.spreadTicks).toBeGreaterThan(ci.t.stats.spreadTicks);
    expect(spreads(cf)).not.toBe(spreads(ci));
    expect(cf.watch.finals.length).toBe(ci.watch.finals.length);
  });

  it('catches a final planted in the full replay alone, where the spreads differ', () => {
    // b's final state spoiled near the end in the full replay, too late for a tally to see it.
    const plant = (q: Pump, nodes: readonly PumpNode[]): void => {
      if (q.mode === 'fullReplay') spoil(nodes[1]!.t, (F) => void (F.ball.x += 1e-9));
    };
    const found = disagreement((q) => lateJoin(q, plant));
    expect(found).toEqual(expect.arrayContaining([expect.stringMatching(/^final 0 \d+: \w+ incremental, \w+ in full$/)]));
    expect((found as string[]).every((d) => d.startsWith('final '))).toBe(true);
  });

  it('catches a drawn head planted in the full replay alone, at an advance where neither run spreads', () => {
    // b's input changed for its last ticks in the full replay, none of them final by the end: only the
    // drawn heads differ.
    const plant = (q: Pump, nodes: readonly PumpNode[]): void => {
      if (q.mode === 'fullReplay') nodes[1]!.t.controls = () => encodeInput({ step: 9, frame: FRAME_PITCH, zoomies: true });
    };
    const found = disagreement((q) => lateJoin(q, plant));
    expect(found).toEqual(expect.arrayContaining([expect.stringMatching(/^advance \d+: head \d+ \w+ incremental, \d+ \w+ in full$/)]));
    expect((found as string[]).some((d) => d.startsWith('final '))).toBe(false);
  });
});
