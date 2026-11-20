import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { decode, encodeState as encodeStateMessage, encodeTick, type StateReq, T, type Tick } from '../core/protocol/messages';
import type { Link } from '../core/session/room-peer';
import { decodeState, encodeState, hash64 } from '../core/sim/index';
import { expectAgreement, inside } from '../core/timeline/testing';
import { NET, type Node, Rig } from './freezes-testing';

// A rogue the room removed for silence (PLAN D-13, L201, L203; M3 phase
// 5b): the voters a page's lineage removed for silence while connected are
// counted, so a page cut off from the room repairs to it. That gives a
// rogue nothing it hasn't as a player in the roster, which in warm-up it
// can be again by a JOIN: one vote, its own connection's. Silent until
// removed, then sending TICKs with made-up votes and no JOIN, it can't make
// an honest majority repair or leave its match; in a 1-a-side room the
// smallest hash decides between it and the page, as between any two voters
// (C-10); and a voter removed while not connected, one speaking under its
// ID on a connection that came after, isn't counted at all. Out of the
// roster, removed voters count only as many as it has free places
// (split-F1): rogues that each took the free place in turn, fell silent and
// stayed connected, uncounted then, stopped a full room's keeper confirming
// its match, and outvoted it into a state they made up.

vi.setConfig({ testTimeout: 120_000 });

const D = NET.timeline.delay;
const W = NET.timeline.window;
const SMALLEST = '0000000000000001'; // not a setting: a made-up hash, below any real one
const LARGEST = 'ffffffffffffffff'; // not a setting: a made-up hash, above any real one

/** A rogue's link: its session's TICKs as they are until silentFrom, none until madeUpFrom, then each
 *  with no events, so it never JOINs again, and a made-up vote for the tick it would vote. */
function rogue(now: () => number, o: { silentFrom: number; madeUpFrom: number; hash: string }): (link: Link) => Link {
  return (link) => {
    const rewrite = (bytes: Uint8Array): Uint8Array | null => {
      if (bytes[0] !== T.TICK || now() < o.silentFrom) return bytes;
      if (now() < o.madeUpFrom) return null;
      const m = decode(bytes) as Tick;
      const own = m.own === null ? null : { ...m.own, events: [] };
      return encodeTick({ t: m.t, own, voteTick: m.t - D - W, voteHash: o.hash, phase: m.phase, bots: [] });
    };
    const out = Object.create(link) as Link;
    out.broadcast = (bytes) => {
      const b = rewrite(bytes);
      if (b !== null) link.broadcast(b);
    };
    out.send = (peer, bytes) => {
      const b = rewrite(bytes);
      if (b !== null) link.send(peer, b);
    };
    return out;
  };
}

const ids = (x: Node): string[] => x.session.timeline.final.terriers.map((T) => T.id).sort();
const removedAt = (x: Node): string[] => [...inside(x.session.timeline).removed].sort();

describe('a rogue the room removed for silence (L203, M3 phase 5b)', () => {
  it('voting made-up hashes, makes an honest majority neither repair nor leave its match', () => {
    const clock = { now: (): number => 0 };
    const rig = new Rig({ seed: 61, packSize: 2, link: (k, l) => (k === 3 ? rogue(() => clock.now(), { silentFrom: 1300, madeUpFrom: 5300, hash: SMALLEST })(l) : l) });
    clock.now = () => rig.net.now;
    const honest = rig.nodes.slice(0, 3);
    const me = honest.map((x) => x.session.cfg.me).sort();
    const r = rig.nodes[3]!.session.cfg.me;
    rig.runTo(5300);
    // Removed, and counted: it stays connected.
    for (const x of honest) expect([ids(x), removedAt(x)]).toEqual([me, [r]]);
    const held = honest.map((x) => x.session.timeline);
    rig.runTo(12_000);
    const label = rig.logs();
    for (const [k, x] of honest.entries()) {
      const t = x.session.timeline;
      // The same match and timeline, every honest page in it, the rogue out.
      expect([t === held[k], x.session.stall, ids(x)], label).toEqual([true, 'none', me]);
      // Its votes came and were counted, and lost every tally: nothing repaired, nothing asked.
      expect(t.stats.split, label).toBeGreaterThan(0);
      const s = t.stats;
      expect([s.resyncs, s.resyncFailed, s.lateVoteFlips, s.disagree], label).toEqual([0, 0, 0, 0]);
    }
    expect(rig.closed(), label).toEqual({ sessions: [[], [], [], []], transport: [] });
    expectAgreement(honest.map((x) => ({ t: x.session.timeline })));
  });

  it('at 1 a side, ties the page as any voter does, the smallest hash winning (C-10)', () => {
    for (const hash of [SMALLEST, LARGEST]) {
      const clock = { now: (): number => 0 };
      const rig = new Rig({ seed: 62, packSize: 1, link: (k, l) => (k === 1 ? rogue(() => clock.now(), { silentFrom: 1000, madeUpFrom: 4500, hash })(l) : l) });
      clock.now = () => rig.net.now;
      const [a, b] = rig.nodes as [Node, Node];
      rig.runTo(4500);
      expect([ids(a), removedAt(a)]).toEqual([[a.session.cfg.me], [b.session.cfg.me]]);
      rig.runTo(8000);
      const t = a.session.timeline;
      const label = `${hash}: ${rig.logs()}`;
      if (hash === SMALLEST) {
        // It loses each tally to the rogue's hash and asks the rogue for that state, which it can't send.
        expect(t.stats.disagree, label).toBeGreaterThan(0);
        expect([t.stats.resyncs, t.stats.resyncFailed > 0], label).toEqual([0, true]);
      } else {
        // It wins each, and goes on confirming its own.
        expect([t.stats.disagree, t.stats.resyncs], label).toEqual([0, 0]);
        expect(t.agreedTo, label).toBeGreaterThan(t.finalTick - 2 * NET.timeline.voteWindow);
      }
      expect(rig.closed(), label).toEqual({ sessions: [[], []], transport: [] });
    }
  });

  it('is not counted under the ID of a voter removed while not connected: one speaking for it on a later connection', () => {
    const clock = { now: (): number => 0 };
    const rig = new Rig({ seed: 63, packSize: 1 });
    clock.now = () => rig.net.now;
    const [a, b] = rig.nodes as [Node, Node];
    const id = b.session.cfg.me;
    // b closes its page at 1 s; a's lineage removes it 3 s on, its connection gone.
    rig.net.leave(b, 1000);
    rig.runTo(4500);
    expect([ids(a), removedAt(a)]).toEqual([[a.session.cfg.me], []]);
    // A page under b's ID, sending made-up votes and no JOIN.
    const c = rig.page('n9', id, 9, rogue(() => clock.now(), { silentFrom: 0, madeUpFrom: 0, hash: SMALLEST }));
    rig.net.join(c, 4500, () => c.session.play(1));
    rig.runTo(9000);
    const t = a.session.timeline;
    const label = rig.logs();
    // Connected, its votes booked under b's ID, and not counted: a goes on confirming its own.
    expect(a.session.connectedRoles().has(id), label).toBe(true);
    expect(inside(t).book.votersAt(t.finalTick - 30), label).toContain(id);
    expect([t.stats.disagree, t.stats.resyncs, t.stats.resyncFailed, removedAt(a)], label).toEqual([0, 0, 0, []]);
    expect(t.agreedTo, label).toBeGreaterThan(t.finalTick - 2 * NET.timeline.voteWindow);
  });
});

/** A rogue's link: everything its session sends until silentFrom, none of it after (split-F1). */
interface Silent {
  link: Link | null;
  silentFrom: number;
  readonly node: Node;
}

function silentAfter(now: () => number, r: { link: Link | null; silentFrom: number }): (link: Link) => Link {
  return (link) => {
    r.link = link;
    const out = Object.create(link) as Link;
    out.broadcast = (bytes) => {
      if (now() < r.silentFrom) link.broadcast(bytes);
    };
    out.send = (peer, bytes) => {
      if (now() < r.silentFrom) link.send(peer, bytes);
    };
    return out;
  };
}

/** 1 a side. Page 0 proposes and plays pack A; k rogues take pack B in turn, each going silent once it's in
 *  page 0's roster, so the state removes it 3 s later while it stays connected, and the next enters; then
 *  an honest page b takes pack B and both press Ready. `from` is 3 s after b is in, when a test's rogues
 *  begin. */
function fullRoom(seed: number, k: number): { rig: Rig; n0: Node; b: Node; rogues: Silent[]; from: number } {
  const clock = { now: (): number => 0 };
  const first = { link: null as Link | null, silentFrom: Infinity };
  const rig = new Rig({ seed, packSize: 1, link: (j, l) => (j === 1 ? silentAfter(() => clock.now(), first)(l) : l) });
  clock.now = () => rig.net.now;
  const rogues: Silent[] = [Object.assign(first, { node: rig.nodes[1]! })];
  for (let j = 1; j < k; j++) {
    const r = { link: null as Link | null, silentFrom: Infinity };
    rogues.push(Object.assign(r, { node: rig.page(`r${j}`, personId(23, 10 + j), 10 + j, silentAfter(() => clock.now(), r)) }));
  }
  const n0 = rig.nodes[0]!;
  const b = rig.page('b', personId(23, 9), 9);
  let from = Infinity;
  let j = 0;
  const look = (): void => {
    const now = rig.net.now;
    const roster = ids(n0);
    const r = rogues[j];
    if (r !== undefined) {
      const id = r.node.session.cfg.me;
      if (r.silentFrom === Infinity && roster.includes(id)) r.silentFrom = now + 300;
      else if (r.silentFrom < now && !roster.includes(id)) {
        const next = rogues[++j];
        if (next !== undefined) rig.net.join(next.node, now, () => next.node.session.play(1));
        else rig.net.join(b, now, () => b.session.play(1));
      }
    } else if (roster.includes(b.session.cfg.me)) {
      n0.session.ready(true);
      b.session.ready(true);
      from = now + 3000;
      return;
    }
    rig.net.at(now + 50, look);
  };
  rig.net.at(500, look);
  while (from === Infinity && rig.net.now < 40_000) rig.runTo(rig.net.now + 100);
  expect(from, 'the room filled').toBeLessThan(43_000);
  return { rig, n0, b, rogues, from };
}

describe('rogues removed for silence in turn, out of a full room (split-F1)', () => {
  it('voting made-up hashes, stop neither keeper confirming its match', () => {
    for (const [k, hash] of [[2, SMALLEST], [3, LARGEST]] as const) {
      const { rig, n0, b, rogues, from } = fullRoom(70 + k, k);
      for (const x of rogues) {
        // A TICK of its own each tick, no input, voting the made-up hash for the tick an honest page votes.
        const beat = (): void => {
          const t = Math.floor(x.node.session.timeline.clock(x.node.local(rig.net.now))) + D;
          x.link!.broadcast(encodeTick({ t, own: null, voteTick: t - D - W, voteHash: hash, phase: 0, bots: [] }));
          rig.net.at(rig.net.now + NET.tickMs, beat);
        };
        rig.net.at(from, beat);
      }
      rig.runTo(from);
      const pair = [n0.session.cfg.me, b.session.cfg.me].sort();
      expect([ids(n0), ids(b)]).toEqual([pair, pair]);
      // Each rogue was removed while connected, and counted no more once its place was taken.
      expect(removedAt(n0)).toEqual(rogues.map((x) => x.node.session.cfg.me).sort());
      rig.runTo(from + 8000);
      for (const x of [n0, b]) {
        const t = x.session.timeline;
        const label = `${k} rogues voting ${hash}: ${rig.logs()}`;
        expect([t.stats.disagree, t.stats.resyncs, t.stats.resyncFailed], label).toEqual([0, 0, 0]);
        expect(t.agreedTo, label).toBeGreaterThan(t.finalTick - 2 * NET.timeline.voteWindow);
      }
      expectAgreement([n0, b].map((x) => ({ t: x.session.timeline })));
    }
  });

  it('serving a state they made up, with its hash as their votes, rewrite neither keeper’s score', () => {
    for (const k of [2, 3]) {
      const { rig, n0, b, rogues, from } = fullRoom(70 + k, k);
      // The rogues' book: for each tick they vote, b's final state there with pack B three goals up.
      const made = new Map<number, { bytes: Uint8Array; hash: string }>();
      const served: number[] = [];
      for (const x of rogues) {
        const node = x.node;
        const own = node.session.onMessage.bind(node.session);
        node.session.onMessage = (peer: string, bytes: Uint8Array, now: number): void => {
          if (bytes[0] === T.STATE_REQ) {
            const m = decode(bytes) as StateReq;
            const c = made.get(m.tick);
            if (c !== undefined && c.hash === m.want) {
              const senderTick = Math.floor(node.session.timeline.clock(node.local(rig.net.now)));
              const s = decodeState(c.bytes)!;
              const msg = { timeline: n0.session.timeline.id, senderTick, phase: 0, g: m.tick, senderFinal: m.tick, state: c.bytes, inputs: [] };
              x.link!.send(peer, encodeStateMessage(msg, s.terriers.map((T) => T.id)).bytes);
              served.push(m.tick);
              return;
            }
          }
          own(peer, bytes, now);
        };
        const beat = (): void => {
          const tb = b.session.timeline;
          const g = Math.min(n0.session.timeline.finalTick, tb.finalTick);
          let c = made.get(g);
          if (c === undefined) {
            const real = inside(tb).finals.bytes(g);
            if (real !== null) {
              const s = decodeState(real)!;
              s.score = [s.score[0], s.score[1] + 3];
              const bytes = encodeState(s);
              c = { bytes, hash: hash64(bytes) };
              made.set(g, c);
            }
          }
          const t = Math.floor(node.session.timeline.clock(node.local(rig.net.now))) + D;
          if (c !== undefined) x.link!.broadcast(encodeTick({ t, own: null, voteTick: g, voteHash: c.hash, phase: 0, bots: [] }));
          rig.net.at(rig.net.now + NET.tickMs, beat);
        };
        rig.net.at(from, beat);
      }
      rig.runTo(from + 8000);
      const label = `${k} rogues, served ${served.length}: ${rig.logs()}`;
      // An honest full room's state is its own: no voter outside it rewrites it (D-13, L201).
      for (const x of [n0, b]) {
        expect(x.session.timeline.final.score, label).toEqual([0, 0]);
        expect([x.session.timeline.stats.resyncs, x.session.timeline.stats.disagree], label).toEqual([0, 0]);
      }
      expect(served, label).toEqual([]);
      expectAgreement([n0, b].map((x) => ({ t: x.session.timeline })));
    }
  });
});
