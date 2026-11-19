import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { T } from '../core/protocol/messages';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, encodeInput, findTerrier, FRAME_PITCH, type InputParts, type MatchState, type Pack } from '../core/sim/index';
import { type Mode, NetPump, oldest, TEST_BUILD, twin } from '../core/timeline/testing';
import type { Timeline } from '../core/timeline/timeline';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32, type NodeOptions } from './loopback';

// The replay checks over the loopback network (PLAN D-11, R-1; M3's design,
// research/m3/DESIGN.md, §2.7, §8.1, §13): every node verifies its chain
// against a full replay after every advance (verify: 1), through each way
// a network moves the chain: late inputs, absences, a join, a resync, a
// late-vote flip, a spread worst tick, a merge, forwarding, bots, a hidden
// page's bursts, a sender paced at 100 ms for a second then at 4 ms with its
// inputs changing, a forced clock jump, a sender going silent, and a
// returning player; and each again in fullReplay mode, twin comparing every
// final tick both runs made and the drawn heads where neither had a spread
// pending (testing.ts). Scenarios a few seconds long, in warm-up but where a
// case needs more, every person's input from its local tick, never from
// the drawn head, which a spread holds longer in the full replay (§2.8).
// Practice's catch-ups are practice.test.ts's. Here: late inputs, absences,
// a join and a resync; replay-repairs, replay-mesh and replay-senders.test.ts
// have the rest (design §13's 8 s a file).

// Matches in virtual time, twice each, every chain verified each advance: CPU-bound, as M2's suites are.
vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const B = defaultBotParams;
const P = defaultParams;
const W = NET.timeline.window;
const MATCH = '5e9e5e9e5e9e5e9e';
const SEED = 29;
const id = (k: number): string => personId(SEED, k);

/** A session as NetGame drives it (design §1.24): a gap over stallMs between timer runs is a stall. */
class GameSession extends Session {
  private last = -1;

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

/** A person's wandering input from its local tick: a step that changes every 16 ticks, held most of
 *  the time, zoomies in spells and a jump now and then; never read from the drawn head. */
function wander(k: number, s: Session): number {
  const n = s.timeline.localTick;
  const p: InputParts = { frame: FRAME_PITCH, zoomies: ((n >> 7) + k) % 3 === 0, jump: (n >> 6) & 3 };
  if (((n >> 5) + k) % 4 !== 0) p.step = ((n >> 4) * 7 + k * 5) & 31;
  return encodeInput(p);
}

interface Spec {
  readonly nodeId?: string;
  readonly net?: typeof NET;
  readonly opts?: NodeOptions;
}

/** Player k's session, verifying after every advance, its terrier wandering. */
function node(room: Room, k: number, spec: Spec = {}): Node {
  const me = id(k);
  return room.net.add(
    spec.nodeId ?? `n${k}`,
    room.peer(
      (link, mode) => {
        const cfg: SessionConfig = {
          P, B, net: spec.net ?? NET, me, name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, forwarding: true, mode, verify: 1,
        };
        const s = new GameSession(cfg, link);
        s.controls = () => wander(k, s);
        return s;
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
    spec.opts,
  );
}

const tl = (n: Node): Timeline => n.session.timeline;
const stats = (n: Node): Timeline['stats'] => tl(n).stats;
const finalOf = (n: Node): Readonly<MatchState> => tl(n).final;
const isTick = (bytes: Uint8Array): boolean => bytes[0] === T.TICK;
const ROOM = (seed: number) => (mode: Mode): Room => new NetPump(new LoopbackNet(seed, uniform(seed * 7, 30, 60, 20)), { mode });

/** Node `from` proposes timeline `t` and plays in pack A; the next players join 200·k ms on and play,
 *  in packs B, A, B, so the match stays in warm-up. */
function lobby(room: Room, players: number, o: { specs?: readonly Spec[]; t?: string; from?: number } = {}): Node[] {
  const net = room.net;
  const from = o.from ?? 0;
  const k0 = node(room, from, o.specs?.[0]);
  net.join(k0, 0, (now) => {
    k0.session.propose(k0.local(now), { packSize: 2, matchMinutes: 1 }, o.t ?? MATCH);
    k0.session.play(0);
  });
  const nodes = [k0];
  for (let k = 1; k < players; k++) {
    const n = node(room, from + k, o.specs?.[k]);
    net.join(n, 200 * k, () => n.session.play((k % 2) as Pack));
    nodes.push(n);
  }
  return nodes;
}

/** A scenario run incremental and as a full replay, every node verifying each advance (twin); every
 *  page online then holds one hash at each of the last second's final ticks they all hold, whatever a
 *  dissent left in a repaired page's history before (§3.2). The incremental run's nodes. */
function replayed(seed: number, scene: (room: Room) => void): Node[] {
  const room = twin(ROOM(seed), scene);
  const nodes = ([...room.net.nodes.values()] as Node[]).filter((n) => n.online && n.session.timeline.started);
  const ts = nodes.map(tl);
  const hi = Math.min(...ts.map((t) => t.finalTick));
  const lo = Math.max(...ts.map(oldest), hi - NET.timeline.history / 4);
  expect(hi - lo).toBeGreaterThan(W);
  for (let g = lo; g <= hi; g++) expect(new Set(ts.map((t) => t.hashAt(g))).size, `tick ${g}`).toBe(1);
  for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `node ${n.k}`).toBe(0);
  return nodes;
}

const nodeNamed = (nodes: readonly Node[], name: string): Node => nodes.find((n) => n.id === name)!;

describe('the replay checks: every node verifying each advance, and the same again as a full replay (§2.7, §8.1)', () => {
  it('late inputs: one sender’s TICKs late at every page', () => {
    const nodes = replayed(1, (room) => {
      lobby(room, 3);
      room.net.at(2500, () => {
        for (const to of ['n0', 'n2']) room.net.delayNext('n1', to, isTick, 300);
      });
      room.run(4500);
    });
    for (const k of ['n0', 'n2']) expect(stats(nodeNamed(nodes, k)).late, k).toBeGreaterThan(0);
    expect(stats(nodeNamed(nodes, 'n1')).resyncs).toBeGreaterThan(0);
  });
  it('absences: a page whose timer runs every 500 ms sends only its newest ticks, the rest absent for good', () => {
    const nodes = replayed(2, (room) => {
      const [, x] = lobby(room, 3);
      room.net.pace(x!, 2000, 500);
      room.net.pace(x!, 3500, NET.timerMs);
      room.run(4500);
    });
    for (const n of nodes) expect([stats(n).resyncs, stats(n).disagree], n.id).toEqual([0, 0]);
    // The ticks its catch-ups skipped have no input of its own anywhere: absent, as its marks said.
    const t = tl(nodeNamed(nodes, 'n0'));
    let absent = 0;
    for (let u = 2000 / NET.tickMs + 2 * W; u < 3500 / NET.tickMs; u++) if (t.receivedInput(id(1), u) === undefined) absent++;
    expect(absent).toBeGreaterThan(W);
  });
  it('a join: a player who comes in from a STATE and warms up', () => {
    const nodes = replayed(3, (room) => {
      lobby(room, 2);
      const late = node(room, 2);
      room.net.join(late, 2000, () => late.session.play(0));
      room.run(4500);
    });
    for (const n of nodes) expect(findTerrier(finalOf(n), id(2)), n.id).toBeGreaterThanOrEqual(0);
  });
  it('a resync: a page that missed one of another’s TICKs repairs', () => {
    const nodes = replayed(4, (room) => {
      lobby(room, 3);
      room.net.at(2500, () => room.net.delayNext('n0', 'n1', isTick, 400));
      room.run(4500);
    });
    expect(stats(nodeNamed(nodes, 'n1')).resyncs).toBe(1);
  });
});
