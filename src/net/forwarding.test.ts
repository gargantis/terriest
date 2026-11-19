import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { scriptSampler } from '../core/bot/setups';
import { decode, T } from '../core/protocol/messages';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, type Pack } from '../core/sim/index';
import { expectAgreement, NetPump, TEST_BUILD } from '../core/timeline/testing';
import { LoopbackNet, type LoopNode } from './loopback';
import type { Transport } from './transport';

// Forwarding while the room changes (PLAN D-19, roslambo D-14 and P5, P7;
// M3's design, research/m3/DESIGN.md, §4.10, §9.2), over the loopback
// network in virtual time, each joiner with a smaller player ID than any
// before it, so each in turn is a pair's forwarder (M3 phase 5a):
// - two pairs that can't connect, 1–2 and 5–6, as the partial mesh's
//   pack4-*-blocked2 profiles block them, each get the other's every TICK
//   forwarded while a pack-4 room joins, 200 ms apart. A joiner relays
//   nothing until it holds the timeline, so the duty passes to it only once
//   it announces that timeline: one that took it on its PEERS alone left the
//   pairs unforwarded through its join, a few ticks at 30 ms one way and, at
//   80 ms, past the late window, where they finalised each other absent and
//   lost their tallies;
// - so does a pair while a page holding another timeline merges in, as it
//   announces that one until it adopts (mesh-F2);
// - and while a page already holding the timeline opens its link to an end,
//   as a joiner's last link opens after it adopted: the duty passes once
//   that end's PEERS lists it, which comes behind the TICKs it sent before
//   (mesh-F3);
// - a pair whose own link opens once both send loses nothing: a FWD for an
//   origin connected here whose connection has carried no TICK yet is taken
//   from a forwarder that listed it before, and a forwarder stops relaying
//   only on the origin's PEERS, so the TICKs sent before the link opened
//   come in time (mesh-F1).

vi.setConfig({ testTimeout: 60_000 });

const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const D = NET.timeline.delay;
const W = NET.timeline.window;
const JITTER_MS = 20; // §9.2's links
/** Browser k's player ID: smaller than every one before it, whatever the seed. */
const id = (k: number): string => (15 - k).toString(16) + personId(23, k).slice(1);

type Node = LoopNode<Session>;

/** What a browser sent and was forwarded: the ticks of its own TICKs, with when each went, and each
 *  origin's TICKs it got in a FWD, by tick; and the local tick it first held the timeline at. */
interface Seen {
  readonly sent: Map<number, number>;
  readonly forwarded: Map<string, Set<number>>;
  heldFrom: number;
}

/** Browser k, its own terrier driven by the brain on its head, as the correction measurement drives
 *  them (§9.2), its TICKs and the FWDs it gets noted; the first verifying its chain at 8 (§8.3). */
function browser(room: NetPump<LoopbackNet>, k: number, seen: Seen): Node {
  const me = id(k);
  return room.net.add(
    `n${k}`,
    room.peer(
      (link, mode) => {
        const out = Object.create(link) as Transport;
        out.broadcast = (bytes) => {
          const m = bytes[0] === T.TICK ? decode(bytes) : null;
          if (m?.type === T.TICK && m.own !== null && !seen.sent.has(m.t)) seen.sent.set(m.t, room.net.now);
          link.broadcast(bytes);
        };
        const cfg: SessionConfig = {
          P, B, net: NET, me, name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, forwarding: true, mode, verify: k === 0 ? 8 : 0,
        };
        const s = new Session(cfg, out);
        let sample = scriptSampler('brain', me, 0, P, B);
        s.controls = () => sample(s.timeline.head, s.timeline.headTick);
        s.onControl = (base) => {
          sample = scriptSampler('brain', me, base, P, B);
        };
        const onMessage = s.onMessage.bind(s);
        s.onMessage = (peer, bytes, now) => {
          const m = bytes[0] === T.FWD ? decode(bytes) : null;
          if (m?.type === T.FWD) {
            const ticks = seen.forwarded.get(m.origin) ?? new Set<number>();
            ticks.add(m.tick.t);
            seen.forwarded.set(m.origin, ticks);
          }
          onMessage(peer, bytes, now);
        };
        const advance = s.advance.bind(s);
        s.advance = (now) => {
          advance(now);
          if (seen.heldFrom === Infinity && s.timeline.started) seen.heldFrom = s.timeline.localTick;
        };
        return s;
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
  );
}

/** n browsers in a room of pack n / 2 over links of oneWayMs and JITTER_MS, joining at joinAt(k), each
 *  proposing `proposes(k)`'s timeline if it gives one, and each playing. */
function room(seed: number, oneWayMs: number, n: number, o: { joinAt?: (k: number) => number; proposes?: (k: number) => string | null } = {}) {
  const r = new NetPump(new LoopbackNet(seed, () => ({ base: oneWayMs, jitter: JITTER_MS })));
  const seen: Seen[] = [];
  const nodes: Node[] = [];
  for (let k = 0; k < n; k++) {
    seen.push({ sent: new Map(), forwarded: new Map(), heldFrom: Infinity });
    const x = browser(r, k, seen[k]!);
    nodes.push(x);
    const timeline = o.proposes?.(k) ?? (k === 0 ? 'f0f0f0f0f0f0f0f0' : null);
    r.net.join(x, o.joinAt?.(k) ?? 200 * k, (now) => {
      if (timeline !== null) x.session.propose(x.local(now), { packSize: n / 2, matchMinutes: 1 }, timeline);
      x.session.play((k % 2) as Pack);
    });
  }
  return { room: r, net: r.net, nodes, seen };
}

/** a's TICKs sent within [from, to) that b got in no FWD, but those still on their way. */
function unforwarded(nodes: readonly Node[], seen: readonly Seen[], a: number, b: number, from = -Infinity, to = Infinity): number[] {
  const last = nodes[b]!.session.timeline.localTick - D - W;
  const got = seen[b]!.forwarded.get(id(a)) ?? new Set<number>();
  return [...seen[a]!.sent].filter(([t, at]) => at >= from && at < to && t > seen[b]!.heldFrom + D && t <= last && !got.has(t)).map(([t]) => t);
}

/** No page disagreed, resynced, failed a resync, took an input late that it had finalised absent, or
 *  found a mismatch verifying; and they agree. */
function expectNoRepair(nodes: readonly Node[], label: string): void {
  for (const n of nodes) {
    const s = n.session.timeline.stats;
    expect([s.disagree, s.resyncs, s.resyncFailed, s.lateAbsent, s.verifyMismatches], `${label}, ${n.id}: ${JSON.stringify(s.log.slice(0, 6))}`).toEqual([0, 0, 0, 0, 0]);
  }
  expectAgreement(nodes.map((n) => ({ t: n.session.timeline })));
}

describe('forwarding while the room changes (P5, D-19)', () => {
  it.each([30, 80])('forwards every TICK of the blocked pairs through each joiner’s join, at %i ms one way, and no tally disagrees', (oneWayMs) => {
    const BLOCKED = [[1, 2], [5, 6]] as const;
    const { room: r, net, nodes, seen } = room(7, oneWayMs, 8);
    for (const [a, b] of BLOCKED) net.block(`n${a}`, `n${b}`);
    r.run(4000); // every browser joined, warmed up and tallying
    expect(r.problems).toEqual([]);
    expect(nodes[0]!.session.timeline.final.terriers).toHaveLength(8);
    for (const [a, b] of BLOCKED.flatMap(([x, y]) => [[x, y], [y, x]] as const)) expect(unforwarded(nodes, seen, a, b), `n${a}'s TICKs n${b} got in no FWD`).toEqual([]);
    expectNoRepair(nodes, `${oneWayMs} ms`);
  });

  it('forwards every TICK of a blocked pair while a page holding another timeline merges in, at 80 ms one way (mesh-F2)', () => {
    // n1–n2 forwarded by n0 on n0's timeline; n3, the smallest ID, proposes its own at 1 s, meets the
    // others at 3 s and merges into theirs. Until it adopts it announces its own, and relays none of
    // theirs, so the duty stays with n0.
    for (const seed of [1, 2]) {
      const U = 3000; // not a setting: the meeting
      const { room: r, net, nodes, seen } = room(seed, 80, 4, {
        joinAt: (k) => (k < 3 ? 200 * k : 1000),
        proposes: (k) => (k === 0 ? 'a'.repeat(16) : k === 3 ? 'b'.repeat(16) : null),
      });
      net.block('n1', 'n2');
      for (const k of [0, 1, 2]) net.block('n3', `n${k}`);
      net.at(U, () => {
        for (const k of [0, 1, 2]) net.unblock('n3', `n${k}`);
      });
      r.run(U + 4000);
      const label = `seed ${seed}`;
      expect(nodes.map((n) => n.session.timeline.id), label).toEqual(nodes.map(() => 'a'.repeat(16)));
      for (const [a, b] of [[1, 2], [2, 1]] as const) expect(unforwarded(nodes, seen, a, b, U, U + 2000), `${label}: n${a}'s TICKs n${b} got in no FWD`).toEqual([]);
      expectNoRepair(nodes, label);
    }
  });

  it('forwards every TICK of a blocked pair while a page holding the timeline opens its link to one end, at 80 ms one way (mesh-F3)', () => {
    // n1–n2 can't connect; n3, the smallest ID, joins last and adopts, its link to n2 opening only at
    // 4 s. Once it does, n3's PEERS lists both ends, but n2's TICKs sent before n2's side opened never
    // reached n3: the duty passes once n2's PEERS lists n3, behind them.
    for (const seed of [2, 7, 8]) {
      const U = 4000; // not a setting: n3's link to n2 opens
      const { room: r, net, nodes, seen } = room(seed, 80, 4);
      net.block('n1', 'n2');
      net.block('n3', 'n2');
      net.at(U, () => net.unblock('n3', 'n2'));
      r.run(U + 3000);
      const label = `seed ${seed}`;
      for (const [a, b] of [[1, 2], [2, 1]] as const) expect(unforwarded(nodes, seen, a, b, U - 200), `${label}: n${a}'s TICKs n${b} got in no FWD`).toEqual([]);
      expectNoRepair(nodes, label);
    }
  });

  it.each([1900, 4000])('loses nothing of a pair whose link opens at %i ms, once both send, at 80 ms one way (mesh-F1)', (U) => {
    // n2 and n7, the last joiner, forwarded until their link opens: as n7 adopts at 1.9 s, or later.
    // Their TICKs sent before it reach each other only through a forwarder, or in the history of the
    // first one sent on it, a direct latency later, past the late boundary.
    for (const seed of [1, 3]) {
      const { room: r, net, nodes } = room(seed, 80, 8);
      net.block('n2', 'n7');
      net.at(U, () => net.unblock('n2', 'n7'));
      r.run(U + 3000);
      expect(nodes[0]!.session.timeline.final.terriers).toHaveLength(8);
      expect(nodes[2]!.neighbours.has('n7')).toBe(true);
      expectNoRepair(nodes, `seed ${seed}, opened at ${U}`);
    }
  });
});
