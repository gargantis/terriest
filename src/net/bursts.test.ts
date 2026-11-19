import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { PROTOCOL_VERSION, ROLE, T, TIMELINE_KIND, ZERO_HASH, type Hello } from '../core/protocol/messages';
import type { Accepted, Refusal } from '../core/session/room-peer';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, findTerrier, type Pack } from '../core/sim/index';
import { expectAgreement, type Mode, NetPump, TEST_BUILD, twin } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';

// Overlapping bursts of joiners over the loopback network (M3 phase 4's
// fixes, reviewer T6; M3's design, research/m3/DESIGN.md, §3.4, §4.2, §6.2,
// §8.1): a joiner whose STATE lacks a co-joiner's inputs, its handshake
// with that co-joiner still under way, used to finalise the co-joiner's
// JOIN tick before hearing it, drop the JOIN as late and diverge, and the
// dissenters could outvote the honest pages. Now a joiner's warm-up waits
// for every peer it's connected to or still handshaking with, from when it
// met it, until a TICK of that peer's comes, or warmupMs after the later of
// the adoption and the meeting, and only for one met within warmupMs of
// the adoption; and its own JOIN waits for its warm-up, so its peers then
// get it on their connections. Seven joiners arrive within 300 ms at
// 30–90, 60–150, 100–150 and 100–200 ms one way, each pressing Play at
// once, and two spectators with some; every page takes every JOIN, as one
// roster, with no disagreement and no resync anywhere: one burst run
// twice, incrementally and as a full replay (twin), and one with
// spectators with every page verifying its chain (design §2.7), here, and
// more in bursts-seeds.test.ts. The old code fails each of these seeds. And however a handshake hangs, a peer frozen mid-way or one that
// begins another every 400 ms and never completes, no warm-up holds the
// final tick, and the joiner's JOIN, longer than twice warmupMs, where the
// first fix waited handshakeTimeoutMs, or for good (reviewer F1).

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const MATCH = 'b0757b0757b0757b';

/** A session as NetGame drives it (design §1.24): a gap over stallMs between timer runs is a stall. It
 *  keeps when it met each peer, its HELLO's coming, and when it first held a timeline. */
class GameSession extends Session {
  readonly met: number[] = [];
  adoptedAt = -1;
  private last = -1;

  override checkHello(hello: Hello, now: number, peer: string): Accepted | Refusal {
    const v = super.checkHello(hello, now, peer);
    if (v.ok) this.met.push(now);
    return v;
  }

  override onMessage(peer: string, bytes: Uint8Array, now: number): void {
    super.onMessage(peer, bytes, now);
    if (this.adoptedAt < 0 && this.timeline.started) this.adoptedAt = now;
  }

  override advance(now: number): void {
    if (this.last >= 0 && now - this.last > this.cfg.net.stallMs) this.stalled(now);
    this.last = now;
    super.advance(now);
  }
}

type Node = LoopNode<GameSession>;
type Room = NetPump<LoopbackNet>;

/** Links of lo to hi ms one way, fixed per pair, with jitter. */
function uniform(seed: number, lo: number, hi: number, jitter: number): (a: string, b: string) => LinkSpec {
  const r = mulberry32(seed);
  const memo = new Map<string, number>();
  return (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!memo.has(k)) memo.set(k, lo + r() * (hi - lo));
    return { base: memo.get(k)!, jitter };
  };
}

/** Page k of a seed's room, its own input idle. */
function node(room: Room, seed: number, k: number, verify: number): Node {
  const me = personId(seed, k);
  return room.net.add(
    `n${k}`,
    room.peer(
      (link, mode) => {
        const cfg: SessionConfig = {
          P: defaultParams, B: defaultBotParams, net: NET, me, name: `P${k}`, coat: k % defaultParams.coatCount, build: TEST_BUILD,
          forwarding: true, mode, verify,
        };
        return new GameSession(cfg, link);
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
  );
}

interface Burst {
  readonly lo: number;
  readonly hi: number;
  readonly seed: number;
  /** Spectators among the joiners, pressing Watch, never sending. */
  readonly watchers?: number;
}

/** n0 proposes at 0, 4 a side, and plays; seven joiners and the watchers arrive at seeded times within
 *  300 ms from 500 ms on, each pressing Play, or Watch, at once, so their handshakes overlap. verify:
 *  every page's, or the keeper's and one joiner's at 8 (design §8.3). */
function burst(room: Room, b: Burst, verify?: number): Node[] {
  const net = room.net;
  const keeper = node(room, b.seed, 0, verify ?? 8);
  net.join(keeper, 0, (now) => {
    keeper.session.propose(keeper.local(now), { packSize: 4, matchMinutes: 1 }, MATCH);
    keeper.session.play(0);
  });
  const nodes = [keeper];
  const at = mulberry32(b.seed * 31);
  const watchers = b.watchers ?? 0;
  for (let k = 1; k <= 7 + watchers; k++) {
    const n = node(room, b.seed, k, verify ?? (k === 1 ? 8 : 0));
    const watching = k > 7;
    net.join(n, 500 + Math.floor(at() * 300), () => (watching ? n.session.watch() : n.session.play((k % 2) as Pack)));
    nodes.push(n);
  }
  return nodes;
}

const room = (b: Burst, mode?: Mode): Room => new NetPump(new LoopbackNet(b.seed, uniform(b.seed * 7, b.lo, b.hi, 20)), mode ? { mode } : {});

/** 6 s of the burst, by which every JOIN is final everywhere. */
function play(r: Room, b: Burst, verify?: number): Room {
  burst(r, b, verify);
  r.run(6000);
  return r;
}

/** Every page holds the eight players, as one roster, agrees, never disagreed or resynced, and every
 *  chain a page verified matched a full replay (design §2.7). */
function expectOne(r: Room, b: Burst): void {
  const label = `${b.lo}–${b.hi} ms, seed ${b.seed}`;
  expect(r.problems, label).toEqual([]);
  const rosters = r.nodes.map((n) => n.t.final.terriers.map((T) => `${T.id}:${T.pack}:${T.joinTick}`).sort().join(','));
  expect(new Set(rosters).size, label).toBe(1);
  expect(r.nodes[0]!.t.final.terriers.length, label).toBe(8);
  for (const n of r.nodes) {
    const s = n.t.stats;
    expect([s.disagree, s.resyncs, s.resyncFailed, s.lateAbsent, s.verifyMismatches], `${label}: node ${n.k} ${JSON.stringify(s.log.slice(0, 6))}`)
      .toEqual([0, 0, 0, 0, 0]);
  }
  expectAgreement(r.nodes);
}

describe('an overlapping burst of joiners (reviewer T6, design §3.4)', () => {
  it('takes every JOIN everywhere, with no disagreement or resync, run as a full replay too', () => {
    // A warm-up's catch-up longer than the spread's cap is spread further in the full replay, which
    // steps every final, so twin, which compares the finals as each advance takes them, runs one
    // burst whose catch-ups fit (D-11, §2.8).
    const b: Burst = { lo: 60, hi: 150, seed: 1 };
    expectOne(twin((mode) => room(b, mode), (r) => play(r, b)), b);
  });

  it('waits for a spectator, which never sends, warmupMs after the later of the adoption and its meeting, and no longer', () => {
    const b: Burst = { lo: 60, hi: 150, seed: 5, watchers: 2 };
    const r = play(room(b), b, 8);
    expectOne(r, b);
    const warmup = NET.timeline.warmupMs;
    for (const n of r.nodes.slice(1)) {
      const s = n.session as GameSession;
      const ms = n.t.stats.warmMs;
      expect(ms, `node ${n.k}`).toBeGreaterThanOrEqual(warmup);
      // Its wait ends warmupMs after the last peer it met within warmupMs of its adoption, if that came
      // later, within a timer run or two: never more than twice warmupMs.
      const last = Math.max(s.adoptedAt, ...s.met.filter((at) => at < s.adoptedAt + warmup));
      expect(ms, `node ${n.k}`).toBeLessThanOrEqual(last + warmup - s.adoptedAt + 2 * NET.timerMs);
      expect(ms, `node ${n.k}`).toBeLessThan(2 * warmup);
    }
  });
});

describe("a warm-up's bound, however a handshake hangs (reviewer F1, design §3.4)", () => {
  const flat = (): LinkSpec => ({ base: 40, jitter: 0 });
  const MATCH2 = 'abcabcabcabcabca';
  const id = (k: number): string => personId(7, k);

  it('ends warmupMs after the adoption when a page freezes mid-handshake with the joiner, which joins at once', () => {
    // n1 joins at 3 s and meets n0 and n2 at 3.08 s; n2 freezes then, its verdict never sent, until 16 s.
    const r: Room = new NetPump(new LoopbackNet(7, flat));
    const [n0, n1, n2] = [node(r, 7, 0, 8), node(r, 7, 1, 8), node(r, 7, 2, 0)];
    r.net.join(n0, 0, (now) => {
      n0.session.propose(n0.local(now), { packSize: 2, matchMinutes: 1 }, MATCH2);
      n0.session.play(0);
    });
    r.net.join(n2, 200, () => n2.session.play(1));
    r.net.join(n1, 3000, () => n1.session.play(0));
    r.net.pace(n2, 3081, Infinity);
    r.net.pace(n2, 16_000, NET.timerMs);
    let joinedAt = -1;
    r.run(6000, () => {
      if (joinedAt < 0 && findTerrier(n0.session.timeline.final, id(1)) >= 0) joinedAt = r.net.now;
      return false;
    });
    const s = n1.session.timeline.stats;
    expect(s.warmMs, JSON.stringify(s.log.slice(0, 6))).toBeLessThanOrEqual(NET.timeline.warmupMs + 2 * NET.timerMs);
    // Its JOIN went with the warm-up's end: n0's roster shows it within the next poll.
    expect(joinedAt).toBeGreaterThan(0);
    expect(joinedAt).toBeLessThanOrEqual(4500);
    expect(r.problems).toEqual([]);
    expectAgreement([n0, n1].map((n) => ({ t: n.session.timeline })));
  });

  it('ends within twice warmupMs of the adoption when a peer begins a handshake every 400 ms and never completes one', () => {
    // From before n1 holds the timeline, a ghost's HELLO every 400 ms, as Trystero's onPeerHandshake
    // would hand it, under a new peer ID each time, which the transport fails handshakeTimeoutMs later.
    const r: Room = new NetPump(new LoopbackNet(7, flat));
    const [n0, n1] = [node(r, 7, 0, 8), node(r, 7, 1, 8)];
    r.net.join(n0, 0, (now) => {
      n0.session.propose(n0.local(now), { packSize: 2, matchMinutes: 1 }, MATCH2);
      n0.session.play(0);
    });
    r.net.join(n1, 1000, () => n1.session.play(0));
    const ghost: Hello = {
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: personId(99, 1), role: ROLE.UNDECIDED, timeline: ZERO_HASH,
      timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name: 'G',
    };
    let k = 0;
    const meet = (): void => {
      const peer = `ghost-${k++}`;
      expect(n1.session.checkHello(ghost, n1.local(r.net.now), peer).ok).toBe(true);
      r.net.at(r.net.now + NET.room.handshakeTimeoutMs, () => n1.session.onHandshakeFailed(peer));
      // A new peer ID for the same player: the one before must fail first, or C-12's rule refuses it.
      if (r.net.now < 20_000) r.net.at(r.net.now + 400, () => {
        n1.session.onHandshakeFailed(`ghost-${k - 1}`);
        meet();
      });
    };
    r.net.at(1050, meet);
    r.run(24_000);
    const t = n1.session.timeline;
    expect([t.started, t.warming]).toEqual([true, false]);
    expect(t.stats.warmMs).toBeLessThan(2 * NET.timeline.warmupMs + 2 * NET.timerMs);
    expect(findTerrier(n0.session.timeline.final, id(1))).toBeGreaterThanOrEqual(0);
    expect(t.finalTick).toBeGreaterThan(t.localTick - 2 * t.cfg.window - t.cfg.delay);
    expect(r.problems).toEqual([]);
    expectAgreement(r.nodes);
  });
});
