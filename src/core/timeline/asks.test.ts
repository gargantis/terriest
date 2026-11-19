import { describe, expect, it, vi } from 'vitest';
import { T } from '../protocol/messages';
import { netSettings } from '../session/settings';
import { encodeInput, JOIN } from '../sim';
import { expectAgreement, inside, Pump, type PumpNode } from './testing';

// A resync's asks (M3 phase 4's fixes, reviewer H2; M3's design,
// research/m3/DESIGN.md, §3.4, §4.10): a peer answers one STATE_REQ per
// connection per resyncRetryMs, and leaves the rest unanswered, so a resync
// passes over a candidate it asked less than that ago, a repair having
// ended the resync that asked it, and asks the next; with only such left,
// it waits until the first may be asked, rather than fail. A dissenter whose
// final state is spoiled three times running, each time just after its
// repair, asks a, then c, then a again once resyncRetryMs has passed since
// a was asked, its one-way delay on top for the jitter between the two
// requests' paths, and repairs each time.

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const MATCH = 'a5a5a5a5a5a5a5a5';
const playerId = (k: number): string => (0xa0 + k).toString(16).padStart(32, '0');

/** n starts from one genesis and plays, its input a step that turns now and then. */
function plays(n: PumpNode, pack: number): void {
  n.t.start(0, { packSize: 2, matchMinutes: 1 }, MATCH);
  n.t.sending = true;
  n.t.controls = () => encodeInput({ step: ((n.t.localTick >> 5) + n.k * 7) & 31 });
  n.t.queueEvent(n.id, { events: JOIN, joinPack: pack, coat: n.k, name: `P${n.k}` });
}

/** b's final state spoiled, its chain to be recomputed from it: its next finals lose every tally. */
function spoil(b: PumpNode): void {
  const x = inside(b.t);
  x.F.ball.x += 0.25;
  x.validTo = b.t.finalTick;
}

describe("a resync's candidates (reviewer H2, design §3.4)", () => {
  /** b spoiled three times; its asks, as they leave. With a one-way delay set for a and c, as the
   *  session sets its connections', and jitter on the links. */
  function spoiledThrice(oneWay: number, jitter: number): void {
    // Fast links, so a repair ends well within resyncRetryMs of its ask.
    const q = new Pump({ ids: playerId });
    q.latency = 10;
    q.jitter = jitter;
    const [a, b, c] = [q.add(), q.add(), q.add()];
    if (oneWay > 0) for (const n of [a, c]) b.t.setOneWay(n.id, oneWay);
    plays(a, 0);
    plays(b, 1);
    plays(c, 0);
    q.run(1500);
    expect(b.t.final.terriers.length).toBe(3);
    // b's STATE_REQs, as they leave.
    const asks: { at: number; to: number }[] = [];
    q.rules.push((from, to, m) => {
      if (from === b && m.type === T.STATE_REQ) asks.push({ at: q.now, to: to.k });
      return 0;
    });
    // Spoiled, and spoiled again each time its repair ends, three times.
    spoil(b);
    let spoiled = 1;
    q.run(4000, () => {
      if (b.t.stats.resyncs === spoiled && spoiled < 3 && !b.t.repairing) {
        spoiled++;
        spoil(b);
      }
    });
    const s = b.t.stats;
    expect([s.resyncs, s.resyncFailed], JSON.stringify(s.log.slice(-8))).toEqual([3, 0]);
    expect(asks.map((x) => x.to)).toEqual([a.k, c.k, a.k]);
    const retry = NET.timeline.resyncRetryMs;
    // The second resync came within resyncRetryMs of the first ask, and asked c at once; the third
    // within it of both, and waited for a's, its one-way delay on top.
    expect(asks[1]!.at - asks[0]!.at).toBeLessThan(retry);
    expect(asks[2]!.at - asks[1]!.at).toBeLessThan(retry);
    expect(asks[2]!.at - asks[0]!.at).toBeGreaterThanOrEqual(retry + oneWay);
    expect(asks[2]!.at - asks[0]!.at).toBeLessThan(retry + oneWay + 2 * NET.tickMs);
    expect(q.problems).toEqual([]);
    for (const n of q.nodes) expect(n.t.stats.verifyMismatches, `${n.k}`).toBe(0);
    expectAgreement(q.nodes);
  }

  it('passes over a candidate asked within resyncRetryMs for the next, and waits for one when only such are left', () => spoiledThrice(0, 0));

  it("waits its one-way delay longer, for the jitter between the two requests' paths", () => spoiledThrice(60, 8));
});
