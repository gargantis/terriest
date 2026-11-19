import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import type { Hello } from '../core/protocol/messages';
import type { Accepted, Refusal } from '../core/session/room-peer';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, type Pack } from '../core/sim/index';
import { expectAgreement, type Mode, NetPump, TEST_BUILD, twin } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';

// An overlapping burst of joiners with spectators among them (M3 phase 4's
// fixes, reviewer T6; M3's design, research/m3/DESIGN.md, §3.4, §4.2, §6.2,
// §8.1), as bursts.test.ts has its bursts, which says what they check: a
// joiner's warm-up waits for a spectator, which never sends, warmupMs after
// the later of its adoption and their meeting, and no longer; every page
// verifying its chain, the burst run twice, incrementally and as a full
// replay (twin, design §2.7). Split from bursts.test.ts for design §13's
// 8 s a file.

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

describe('an overlapping burst of joiners and spectators (reviewer T6, design §3.4)', () => {
  it('waits for a spectator, which never sends, warmupMs after the later of the adoption and its meeting, and no longer', () => {
    const b: Burst = { lo: 60, hi: 150, seed: 5, watchers: 2 };
    const r = twin((mode) => room(b, mode), (x) => play(x, b, 8));
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
