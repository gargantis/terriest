import { describe, expect, it, vi } from 'vitest';
import { botIds, personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type ScriptName, scriptSampler } from '../core/bot/setups';
import {
  type BotEntry, decode, encodeFwd, encodePeers, encodeStateReq, encodeTick, type Hello, NO_TICK, PROTOCOL_VERSION, ROLE, type StateMsg, T,
  TIMELINE_KIND, ZERO_HASH,
} from '../core/protocol/messages';
import { type Accepted, commonRefusal, type Refusal, type RoomPeer } from '../core/session/room-peer';
import { Session } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, ENDED, type MatchState, WARM_UP } from '../core/sim/index';
import { expectAgreement, NetPump, senderInput, TEST_BUILD } from '../core/timeline/testing';
import type { Timeline } from '../core/timeline/timeline';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';
import type { Transport } from './transport';

// Made-up IDs for a whole match (M3 phase 4's fixes, reviewer H5; M3's
// design, research/m3/DESIGN.md, §2.12, §4.10, §5.5, R-18): a connection may
// speak in FWDs for at most peersMax origins in any floodMs, those its PEERS
// lists, so a rogue that lists peersMax fresh ones every floodMs, each with
// two bots, used to grow the per-ID state a timeline keeps for every sender
// it has heard, without bound, and to fill STATEs with them. Now a sender
// outside the roster whose newest tick here is retired is forgotten, and a
// STATE leaves out a sender outside the roster without a JOIN. Over a whole
// 1-minute match, what the keeper keeps for each sender stays within a few
// floodMs' worth of the rogue's IDs, however many it invents; the honest
// players are never forgotten; a STATE the keeper sends just after a burst
// carries none of the made-up IDs, nor one a spectator joins from; and the
// match ends confirmed, every page agreeing. And so for two other forms of
// the made-up TICKs: for a far tick, past what the stores keep, so a TICK
// counts only at the ticks it can write (H5's cap); and with no input, as a
// spectator's, so each is forgotten by when it was heard. And the senders a
// match still needs are kept however long they're silent: a player in the
// roster, which the abandoned rule reads (Q-16). The timeline's
// forget.test.ts has the made-up senders a STATE brings.

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const ROOM = NET.room;
const P = defaultParams;
const D = NET.timeline.delay;
const MATCH = 'ae5ae5ae5ae5ae5a';
const id = (k: number): string => personId(23, k);
/** peersMax: the origins one connection may speak for in any floodMs. */
const PEERS_MAX = ROOM.meshPlayersMax + ROOM.spectatorsMax - 1;
const BOTS = 2; // each made-up origin's bot entries
const FAR = 100_000; // not a setting: ticks past the clock, far past what the stores keep

type Node = LoopNode<Session>;
type Room = NetPump<LoopbackNet>;

function uniform(seed: number, lo: number, hi: number, jitter: number): (a: string, b: string) => LinkSpec {
  const r = mulberry32(seed);
  const memo = new Map<string, number>();
  return (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!memo.has(k)) memo.set(k, lo + r() * (hi - lo));
    return { base: memo.get(k)!, jitter };
  };
}

/** Page k, its own terrier driven by the brain or idle, made again from each base onControl hands it. */
function node(room: Room, k: number, o: { verify?: number; script?: ScriptName } = {}): Node {
  const me = id(k);
  return room.net.add(
    `n${k}`,
    room.peer(
      (link, mode) => {
        const s = new Session({ P, B: defaultBotParams, net: NET, me, name: `P${k}`, coat: k, build: TEST_BUILD, forwarding: true, mode, verify: o.verify ?? 0 }, link);
        let sample = scriptSampler(o.script ?? 'none', me, 0, P, defaultBotParams);
        s.controls = () => sample(s.timeline.head, s.timeline.headTick);
        s.onControl = (base) => {
          sample = scriptSampler(o.script ?? 'none', me, base, P, defaultBotParams);
        };
        return s;
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
  );
}

/** A peer of the test's own: it admits whatever commonRefusal passes, announces no timeline, keeps
 *  the STATEs it's sent, and sends what the test hands it each timer run. */
class Rogue implements RoomPeer {
  readonly joined = new Set<string>();
  readonly states: StateMsg[] = [];
  each: ((now: number) => void) | null = null;
  readonly link: Transport;

  constructor(link: Transport) {
    this.link = link;
  }

  hello(): Hello {
    return {
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: id(9), role: ROLE.UNDECIDED, timeline: ZERO_HASH,
      timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name: 'R',
    };
  }

  checkHello(hello: Hello): Accepted | Refusal {
    return commonRefusal(hello, TEST_BUILD, id(9)) ?? { ok: true, hello };
  }

  onPeerJoin(peer: string): void {
    this.joined.add(peer);
  }

  onHandshakeFailed(): void {}

  onPeerLeave(peer: string): void {
    this.joined.delete(peer);
  }

  onRtt(): void {}

  onMessage(_peer: string, bytes: Uint8Array): void {
    const m = decode(bytes);
    if (m?.type === T.STATE) this.states.push(m);
  }

  advance(now: number): void {
    this.each?.(now);
  }
}

/** What a timeline keeps for each sender: every map and set keyed by ID (H5). */
function perId(t: Timeline): Record<string, number> {
  const x = t as unknown as {
    senders: Set<string>; firstHeard: Map<string, number>; lastHeard: Map<string, number>;
    seen: Map<string, number>; botIdsOf: Map<string, unknown>; ticks: { firstHeard: Map<string, number> }; store: { newestOf: Map<string, unknown> };
  };
  return {
    senders: x.senders.size, firstHeard: x.firstHeard.size, lastHeard: x.lastHeard.size, seen: x.seen.size,
    botIdsOf: x.botIdsOf.size, clock: x.ticks.firstHeard.size, newest: x.store.newestOf.size,
  };
}

/** The made-up TICKs' form: as a player's, for a tick past the stores' window, or with no input, a
 *  spectator's. */
type Form = 'player' | 'far' | 'bare';

/** A whole match with the rogue's bursts in the given form, and what the keeper and a spectator kept. */
function rogueMatch(form: Form): void {
  {
    const room = new NetPump(new LoopbackNet(41, uniform(41, 30, 60, 10)));
    const net = room.net;
    // The brain against an idle terrier: a match decided in regulation, so it ends.
    const [a, b] = [node(room, 0, { verify: 8, script: 'brain' }), node(room, 1)];
    net.join(a, 0, (now) => {
      a.session.propose(a.local(now), { packSize: 1, matchMinutes: 1 }, MATCH);
      a.session.play(0);
    });
    net.join(b, 200, () => b.session.play(1));
    net.at(2000, () => a.session.ready(true));
    net.at(2050, () => b.session.ready(true));
    const r = net.add('r', (link) => new Rogue(link));
    const c = node(room, 2);
    net.join(r, 1000);
    room.until(() => r.session.joined.has('n0'), 3000);
    // As fast as the keeper takes new origins: once the last burst's have left its floodMs window,
    // peersMax fresh ones in a PEERS and a burst of FWDs, a TICK for each, with two bots derived
    // from it. Every tenth burst, a STATE_REQ right after it.
    let seq = 0;
    let batch: string[] = [];
    let burstAt = -Infinity;
    let bursts = 0;
    const t = (): Timeline => a.session.timeline;
    r.session.each = () => {
      if (!r.session.joined.has('n0') || net.now - burstAt < ROOM.floodMs + 200) return;
      burstAt = net.now;
      batch = Array.from({ length: PEERS_MAX }, () => personId(77, seq++));
      r.session.link.send('n0', encodePeers(batch, ROLE.SPECTATOR));
      const u = Math.floor(t().clock(a.local(net.now))) + D + (form === 'far' ? FAR : 0);
      for (const x of batch) {
        const bots: BotEntry[] = form === 'bare' ? [] : botIds(x).slice(0, BOTS).map((bot) => ({ id: bot, ...senderInput(new Map([[u, 0x11]]), u) }));
        const own = form === 'bare' ? null : senderInput(new Map([[u, 0x2a]]), u);
        r.session.link.send('n0', encodeFwd(x, encodeTick({ t: u, own, voteTick: NO_TICK, voteHash: ZERO_HASH, phase: 0, bots })));
      }
      if (++bursts % 10 === 0) r.session.link.send('n0', encodeStateReq(NO_TICK, ZERO_HASH));
    };
    const ended = (n: Node): boolean => n.session.timeline.final.phase === ENDED && n.session.timeline.isConfirmed(n.session.timeline.final.phaseStart);
    // What the keeper keeps for each sender, each second, and whether it still keeps the players.
    const samples: Record<string, number>[] = [];
    const honest: boolean[] = [];
    const look = (): void => {
      samples.push(perId(t()));
      const seen = (t() as unknown as { seen: Map<string, number> }).seen;
      honest.push(seen.has(id(1)) && (t() as unknown as { senders: Set<string> }).senders.has(id(1)));
      if (!ended(a)) net.at(net.now + 1000, look);
    };
    net.at(net.now + 1000, look);
    // A spectator mid-match, linked to the keeper alone, so its STATE is the keeper's: it carries none
    // of the made-up IDs (§5.5).
    net.block('n1', 'n2');
    let joinedSenders: string[] = [];
    net.join(c, 40_000, () => c.session.watch());
    net.at(41_000, () => {
      joinedSenders = [...(c.session.timeline as unknown as { senders: Set<string> }).senders];
    });
    room.run(200_000, () => [a, b, c].every(ended));
    r.session.each = null;
    for (const n of [a, b, c]) expect(ended(n), n.id).toBe(true);
    // The rogue made up many times what the keeper ever kept at once. The keeper keeps a burst's IDs
    // until their ticks retire, history ticks on, then until the next forgetting, at most history
    // ticks later: about 9 s here, four bursts.
    const invented = seq * (1 + BOTS);
    const bound = 5 * PEERS_MAX * (1 + BOTS) + 3;
    expect(invented).toBeGreaterThan(5 * bound);
    for (const key of Object.keys(samples[0]!)) {
      const sizes = samples.map((x) => x[key]!);
      expect(Math.max(...sizes), key).toBeLessThanOrEqual(bound);
      // And no more in the match's second half than in its first: no growth.
      const half = sizes.length >> 1;
      expect(Math.max(...sizes.slice(half)), key).toBeLessThanOrEqual(Math.max(...sizes.slice(0, half)) + PEERS_MAX * (1 + BOTS));
    }
    expect(honest.every(Boolean)).toBe(true);
    expect(joinedSenders.sort()).toEqual([id(0), id(1)].sort());
    // The keeper's STATEs, each sent just after a burst whose records are in its ticks: the players' only.
    expect(r.session.states.length).toBeGreaterThan(3);
    for (const m of r.session.states) {
      expect(m.others, `STATE at ${m.g}`).toEqual([]);
      expect(new Set(m.inputs.flat().map((x) => x.player)).size, `STATE at ${m.g}`).toBeLessThanOrEqual(2);
    }
    for (const n of [a, b]) expect(n.session.timeline.stats.statesTruncated, n.id).toBe(0);
    for (const n of [a, b, c]) expect([n.session.timeline.stats.resyncs, n.session.timeline.stats.disagree], n.id).toEqual([0, 0]);
    expect(a.session.dropped).toEqual([]);
    expect(room.problems).toEqual([]);
    for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `${n.k}`).toBe(0);
    expectAgreement([a, b, c].map((n) => ({ t: n.session.timeline })));
    const final: Readonly<MatchState> = a.session.timeline.final;
    expect(final.terriers.map((x) => x.id).sort()).toEqual([id(0), id(1)].sort());
  }
}

describe("a rogue's made-up IDs (reviewer H5, design §2.12, §4.10)", () => {
  it('keep what the keeper holds for each sender bounded over a whole match, forget no honest player, and reach no STATE', () => rogueMatch('player'));

  it('keep it bounded when their TICKs are for a tick far past what the stores keep', () => rogueMatch('far'));

  it('keep it bounded when their TICKs carry no input, as a spectator\'s', () => rogueMatch('bare'));


  it('forget no player still in the roster, however long it is silent: the abandoned rule reads when it was last heard', () => {
    // Two players and a spectator, 3 minutes; both players' pages go at 15 s, and the spectator stays,
    // forgetting what it can every history ticks.
    const room = new NetPump(new LoopbackNet(9, uniform(9, 40, 45, 5)));
    const net = room.net;
    const [a, b, s] = [node(room, 0), node(room, 1), node(room, 2)];
    net.join(a, 0, (now) => {
      a.session.propose(a.local(now), { packSize: 1, matchMinutes: 3 }, MATCH);
      a.session.play(0);
    });
    net.join(b, 200, () => b.session.play(1));
    net.join(s, 400, () => s.session.watch());
    net.at(2000, () => a.session.ready(true));
    net.at(2050, () => b.session.ready(true));
    room.run(15_000);
    expect(s.session.timeline.final.phase).not.toBe(WARM_UP);
    net.leave(a, net.now);
    net.leave(b, net.now);
    const goneAt = net.now;
    let abandonedAt = -1;
    room.run(ROOM.abandonedMs + 5000, () => {
      if (abandonedAt < 0 && s.session.abandoned(s.local(net.now))) abandonedAt = net.now;
      return false;
    });
    // abandonedMs after their last TICKs, within the polls' 500 ms, and not when a forgetting came.
    expect(abandonedAt - goneAt).toBeGreaterThanOrEqual(ROOM.abandonedMs - 100);
    expect(abandonedAt - goneAt).toBeLessThanOrEqual(ROOM.abandonedMs + 500);
    const x = s.session.timeline as unknown as { seen: Map<string, number>; senders: Set<string> };
    for (const p of [id(0), id(1)]) {
      expect([x.seen.has(p), x.senders.has(p), s.session.timeline.heardAt(p) !== undefined], p).toEqual([true, true, true]);
    }
    expect(room.problems).toEqual([]);
  });
});
