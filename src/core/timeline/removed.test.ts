import { describe, expect, it, vi } from 'vitest';
import { botId } from '../bot/bot-id';
import { encodeInput, FRAME_PITCH, JOIN, LEAVE, WARM_UP } from '../sim';
import { expectAgreement, inside, Pump, type PumpNode } from './testing';
import type { Timeline } from './timeline';

// Voters removed for silence (PLAN D-13; M3's design, research/m3/DESIGN.md,
// §3.2, §3.6; M3 phase 5b, flood-F3): a page whose incoming messages are
// held past removalSilentTicks in warm-up finalises the others absent, and
// its final state removes them, while their TICKs, held on live
// connections, carry votes of a lineage in which they play on. Counting only
// its own roster, it agreed with itself alone for good. A voter its lineage
// removed for silence while connected here is counted, so its tallies
// disagree and it repairs; one removed while not connected, or whose
// connection went, isn't; a LEAVE isn't a silence; a bot's host votes for
// it; and one back in the roster leaves the list. Over the test pump, the
// timelines alone, each told every player is connected (the session's
// rule), but where a test says otherwise.

vi.setConfig({ testTimeout: 60_000 });

const MATCH = '5b5b5b5b5b5b5b5b';
const HOLD_AT = 1000; // not a setting: in warm-up, after every page joined
const HOLD_MS = 4500; // not a setting: past removalSilentTicks' 3 s
const AFTER_MS = 7000; // not a setting: a repair, then the lineage it replaced ageing out of the history

const playerId = (k: number): string => (0xc0 + k).toString(16).padStart(32, '0');

/** A person's input that changes now and then, from its local tick. */
function wander(k: number, t: Timeline): () => number {
  return () => encodeInput({ frame: FRAME_PITCH, step: ((t.localTick >> 4) * 7 + k * 5) & 31 });
}

/** n starts from one genesis, 2 a side, and plays in a pack; or, for a host, sends only its bot's
 *  input (§4.8). */
function plays(n: PumpNode, pack: number, bot = false): void {
  n.t.start(0, { packSize: 2, matchMinutes: 1 }, MATCH);
  if (bot) {
    const id = botId(n.id, 0);
    n.t.bots.set(id, wander(n.k + 4, n.t));
    n.t.queueEvent(id, { events: JOIN, joinPack: pack, coat: 7, name: 'Bot' });
    return;
  }
  n.t.sending = true;
  n.t.controls = wander(n.k, n.t);
  n.t.queueEvent(n.id, { events: JOIN, joinPack: pack, coat: n.k, name: `P${n.k}` });
}

/** From HOLD_AT, the first message to `to` on each link waits ms more, and FIFO holds those behind it:
 *  every link to it stalls, and its backlog lands at once. */
function hold(q: Pump, to: PumpNode, ms = HOLD_MS): void {
  const held = new Set<number>();
  q.rules.push((from, x, _m, now) => {
    if (x !== to || now < HOLD_AT || held.has(from.k)) return 0;
    held.add(from.k);
    return ms;
  });
}

/** Three pages, 2 a side, so warm-up goes on; the last's incoming links held (hold). connected: what
 *  each tells its timeline of its connections. */
function cutOff(o: { connected?: boolean; bots?: boolean } = {}): { q: Pump; a: PumpNode; b: PumpNode; c: PumpNode } {
  const q = new Pump({ ids: playerId });
  const [a, b, c] = [q.add({ verify: 0 }), q.add({ verify: 0 }), q.add({ verify: 2 })];
  for (const n of [a, b, c]) n.t.connected = () => o.connected ?? true;
  plays(a, 0, o.bots);
  plays(b, 1, o.bots);
  plays(c, 0);
  hold(q, c);
  return { q, a, b, c };
}

const roster = (n: PumpNode): string[] => n.t.final.terriers.map((T) => T.id).sort();
const removedAt = (n: PumpNode): string[] => [...inside(n.t).removed].sort();

describe('a page cut off from the room in warm-up (flood-F3)', () => {
  it('counts the voters its lineage removed for silence while connected, loses its tallies to them and repairs', () => {
    const { q, a, b, c } = cutOff();
    q.run(HOLD_AT + HOLD_MS - 500);
    // Its final state removed the others for their silence, and it counts them.
    expect(c.t.final.phase).toBe(WARM_UP);
    expect(roster(c)).toEqual([c.id]);
    expect(removedAt(c)).toEqual([a.id, b.id].sort());
    q.run(500 + AFTER_MS);
    expect(c.t.stats.resyncs).toBeGreaterThanOrEqual(1);
    expect([a.t.stats.resyncs, b.t.stats.resyncs]).toEqual([0, 0]);
    // One match: every page in every roster, one hash at every tick they share, and the list empty.
    for (const n of [a, b, c]) expect(roster(n)).toEqual([a.id, b.id, c.id].sort());
    expect(removedAt(c)).toEqual([]);
    expect(c.t.stats.verifyMismatches).toBe(0);
    expectAgreement([a, b, c]);
  });

  it('counts a bot’s host for the bot removed', () => {
    // a and b only host a bot each: c's lineage removes the bots, and counts their hosts.
    const { q, a, b, c } = cutOff({ bots: true });
    q.run(HOLD_AT + HOLD_MS - 500);
    expect(roster(c)).toEqual([c.id]);
    expect(removedAt(c)).toEqual([a.id, b.id].sort());
    q.run(500 + AFTER_MS);
    expect(c.t.stats.resyncs).toBeGreaterThanOrEqual(1);
    for (const n of [a, b, c]) expect(roster(n)).toEqual([botId(a.id, 0), botId(b.id, 0), c.id].sort());
    expectAgreement([a, b, c]);
  });

  it('counts none removed while not connected here, a session’s players only', () => {
    // A timeline without a session: never connected. Its tallies count its own roster, c alone.
    const { q, a, c } = cutOff({ connected: false });
    q.run(HOLD_AT + HOLD_MS + AFTER_MS);
    expect(removedAt(c)).toEqual([]);
    expect(roster(c)).toEqual([c.id]);
    expect(c.t.stats.disagree).toBe(0);
    const g = c.t.finalTick - 30;
    expect(c.t.hashAt(g)).not.toBe(a.t.hashAt(g));
  });

  it("forgets one whose connection went (forget), as a voter speaking for it on another isn't the one removed", () => {
    const { q, a, b, c } = cutOff();
    q.run(HOLD_AT + HOLD_MS - 500);
    expect(removedAt(c)).toEqual([a.id, b.id].sort());
    // Their connections close and others open under their IDs: the session forgets each, and tells
    // its timeline the players are connected again.
    c.t.forget(a.id);
    c.t.forget(b.id);
    expect(removedAt(c)).toEqual([]);
    q.run(500 + AFTER_MS);
    expect(c.t.stats.disagree).toBe(0);
    expect(roster(c)).toEqual([c.id]);
  });
});

describe('what goes in the list', () => {
  it("not a voter that leaves: a LEAVE's record isn't a silence, though its TICKs go on", () => {
    const q = new Pump({ ids: playerId });
    const [a, b] = [q.add({ verify: 0 }), q.add({ verify: 0 })];
    for (const n of [a, b]) n.t.connected = () => true;
    plays(a, 0);
    plays(b, 1);
    q.run(1000);
    b.t.queueEvent(b.id, { events: LEAVE });
    q.run(4000);
    // b still sends its input, outside the roster; a's lineage removed it for its LEAVE, not silence.
    expect(roster(a)).toEqual([a.id]);
    expect(a.t.receivedInput(b.id, a.t.finalTick)).toBeDefined();
    expect(removedAt(a)).toEqual([]);
  });
});
