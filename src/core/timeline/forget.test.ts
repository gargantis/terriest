import { describe, expect, it, vi } from 'vitest';
import { encodeInput, JOIN } from '../sim';
import { expectAgreement, inside, Pump, type PumpNode, tickOf } from './testing';

// A sender a STATE brings (M3 phase 4's fixes, reviewer H5; M3's design,
// research/m3/DESIGN.md, §2.12, §5.5): a STATE leaves out a sender outside
// the roster unless it has a JOIN, which a full pack ignores, so a joiner
// takes such a sender from the records it imports, and forgets it as it
// forgets one it heard, history ticks after its newest record, rather than
// keep it for good.

vi.setConfig({ testTimeout: 120_000 });

const MATCH = 'f0f0f0f0f0f0f0f0';
const playerId = (k: number): string => (0xb0 + k).toString(16).padStart(32, '0');
const MADE_UP = 'c'.repeat(32); // not a setting: an ID nobody's connection holds

/** n starts from one genesis and plays, 1 a side. */
function plays(n: PumpNode, pack: number): void {
  n.t.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
  n.t.sending = true;
  n.t.controls = () => encodeInput({ step: n.k * 5 });
  n.t.queueEvent(n.id, { events: JOIN, joinPack: pack, coat: n.k, name: `P${n.k}` });
}

const senders = (n: PumpNode): Set<string> => (n.t as unknown as { senders: Set<string> }).senders;
const seen = (n: PumpNode): Map<string, number> => (n.t as unknown as { seen: Map<string, number> }).seen;

describe('a sender a STATE brings (reviewer H5, design §5.5)', () => {
  it("is forgotten by the joiner history ticks after its JOIN, which a full pack ignored, as one it heard", () => {
    const q = new Pump({ ids: playerId });
    const [a, b, j] = [q.add(), q.add(), q.add()];
    plays(a, 0);
    plays(b, 1);
    q.run(1500);
    expect(a.t.final.terriers.length).toBe(2);
    // A JOIN for a's pack, full, from a sender a has no connection to, for a's next tick; then j asks a
    // for its STATE, whose records hold it.
    const u = a.t.localTick + a.t.cfg.delay;
    a.t.onTick(MADE_UP, tickOf(new Map([[u, 0]]), u, [{ back: 0, events: JOIN, joinPack: 0, coat: 0, name: '' }]), q.now, false);
    j.t.requestState(a.peer);
    q.until(() => j.t.started, 1000);
    expect(senders(j).has(MADE_UP)).toBe(true);
    expect(inside(j.t).store.get(MADE_UP, u)?.events).toBe(JOIN);
    // Past its record's retirement and the next forgetting: twice history ticks.
    q.run(2 * j.t.cfg.history * j.t.cfg.clock.tickMs + 1000);
    expect([senders(j).has(MADE_UP), seen(j).has(MADE_UP), j.t.newestInput(MADE_UP)]).toEqual([false, false, undefined]);
    for (const n of [a, b, j]) expect([...senders(n)].sort(), `${n.k}`).toEqual([a.id, b.id].sort());
    expect(j.t.final.terriers.map((T) => T.id).sort()).toEqual([a.id, b.id].sort());
    expect(q.problems).toEqual([]);
    expectAgreement(q.nodes);
  });
});
