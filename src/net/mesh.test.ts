import { describe, expect, it, vi } from 'vitest';
import { botId, personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type ScriptName, scriptSampler } from '../core/bot/setups';
import { T } from '../core/protocol/messages';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, findTerrier, IN_PLAY, type MatchState, type Pack, type SimParams } from '../core/sim/index';
import { expectAgreement, NetPump, TEST_BUILD, twin } from '../core/timeline/testing';
import type { Timeline } from '../core/timeline/timeline';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32, type NodeOptions } from './loopback';

// The mesh over the loopback network in virtual time (PLAN §8, §16; M3's
// design, research/m3/DESIGN.md, §4.9, §4.10, §6.5, §8.1), from
// network.test.ts (split for design §13's 8 s a file, M3 phase 4's fixes):
// P5, a pair that can't connect, with and without forwarding; P7, two
// timelines merged, the losing side's players and bots back in their packs
// (against a full replay), three timelines that meet one after another or
// at once, and a winner whose holder goes; the proposer leaving; and a
// player beyond the late window. merges.test.ts has P7's peer side. Each
// runs one node at verify: 8, the rest unverified (design §8.3).

// Whole matches in virtual time: CPU-bound, as M2's suites are.
vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const B = defaultBotParams;
const D = NET.timeline.delay;
const MATCH = 'c0ffee00c0ffee00';
const SEED = 3;
const id = (k: number): string => personId(SEED, k);

/** A session as NetGame drives it (design §1.24): a gap over stallMs between timer runs is a stall. */
class GameSession extends Session {
  /** What the test does right after a timer run, in the same local tick. */
  after: ((now: number) => void) | null = null;
  private last = -1;

  override advance(now: number): void {
    if (this.last >= 0 && now - this.last > this.cfg.net.stallMs) this.stalled(now);
    this.last = now;
    super.advance(now);
    this.after?.(now);
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

interface NodeSpec {
  readonly script?: ScriptName;
  readonly over?: Partial<SessionConfig>;
  readonly opts?: NodeOptions;
  readonly verify?: number;
  readonly P?: SimParams;
  /** Each input this page sent, by the tick it's for. */
  readonly sent?: Map<number, number>;
  /** Each base onControl handed it (D-10). */
  readonly bases?: number[];
  /** A node ID other than n<k>: another tab of the same player. */
  readonly nodeId?: string;
  /** Its player ID, if not id(k). */
  readonly me?: string;
  /** Its configuration's settings, if not the default's. */
  readonly net?: ReturnType<typeof netSettings>;
}

/** Player k's session on the room, its own terrier driven by a script on its head, which it makes
 *  again from the base onControl hands it (D-10, design §7.2). */
function node(room: Room, k: number, spec: NodeSpec = {}): Node {
  const me = spec.me ?? id(k);
  const script = spec.script ?? 'none';
  const P = spec.P ?? defaultParams;
  return room.net.add(
    spec.nodeId ?? `n${k}`,
    room.peer(
      (link, mode) => {
        const cfg: SessionConfig = {
          P, B, net: spec.net ?? NET, me, name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, forwarding: true, mode, verify: spec.verify ?? 0,
          ...spec.over,
        };
        const s = new GameSession(cfg, link);
        let sample = scriptSampler(script, me, 0, P, B);
        s.controls = () => {
          const v = sample(s.timeline.head, s.timeline.headTick);
          spec.sent?.set(s.timeline.localTick + D, v);
          return v;
        };
        s.onControl = (base) => {
          spec.bases?.push(base);
          sample = scriptSampler(script, me, base, P, B);
        };
        return s;
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
    spec.opts,
  );
}

const finalOf = (n: Node): Readonly<MatchState> => n.session.timeline.final;
const roster = (n: Node): string[] => finalOf(n).terriers.map((T) => T.id);
const terrier = (n: Node, who: string): MatchState['terriers'][number] | undefined => finalOf(n).terriers[findTerrier(finalOf(n), who)];
const agree = (nodes: readonly Node[]): void => expectAgreement(nodes.map((n) => ({ t: n.session.timeline })));
/** The run was clean (design §8.3, R-1): the drawn head's contract held on every node, and every chain
 *  a verifying node checked matched a full replay (reviewer S5). */
function expectClean(room: Room): void {
  expect(room.problems).toEqual([]);
  for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `node ${n.k}: ${JSON.stringify(n.t.stats.log.slice(-4))}`).toBe(0);
}
const stats = (n: Node): Node['session']['timeline']['stats'] => n.session.timeline.stats;

interface Lobby {
  readonly room: Room;
  readonly net: LoopbackNet;
  readonly nodes: Node[];
}

/** n0 proposes at 0, playing in keeperPack, or keeping without one; each player joins 200·k ms on and
 *  presses Play; each in the roster presses Ready at readyAt + 50·k ms, unless readyAt is null. */
function lobby(
  room: Room,
  o: {
    readonly keeperPack: Pack | null;
    readonly players: readonly { readonly k: number; readonly pack: Pack; readonly script?: ScriptName; readonly verify?: number }[];
    readonly readyAt: number | null; readonly packSize?: number; readonly keeperScript?: ScriptName; readonly P?: SimParams;
  },
): Lobby {
  const net = room.net;
  // One node verifies its chain at 8 (design §8.3): the keeper, unless a player is named to.
  const verifier = o.players.some((p) => p.verify !== undefined) ? 0 : 8;
  const keeper = node(room, 0, { script: o.keeperScript ?? 'none', verify: verifier, ...(o.P ? { P: o.P } : {}) });
  net.join(keeper, 0, (now) => {
    keeper.session.propose(keeper.local(now), { packSize: o.packSize ?? 2, matchMinutes: 1 }, MATCH);
    if (o.keeperPack !== null) keeper.session.play(o.keeperPack);
  });
  const nodes = [keeper];
  for (const p of o.players) {
    const n = node(room, p.k, { script: p.script ?? 'none', verify: p.verify ?? 0, ...(o.P ? { P: o.P } : {}) });
    net.join(n, 200 * p.k, () => n.session.play(p.pack));
    nodes.push(n);
  }
  if (o.readyAt !== null) {
    nodes.forEach((n, k) => {
      if (k === 0 && o.keeperPack === null) return;
      net.at(o.readyAt! + 50 * k, () => n.session.ready(true));
    });
  }
  return { room, net, nodes };
}

const ROOM = (seed: number, links: (a: string, b: string, now: number) => LinkSpec): Room => new NetPump(new LoopbackNet(seed, links));

describe('the mesh (P5, P7)', () => {
  it('keeps a pair that can’t connect in step through forwarding, which diverges without it (P5)', () => {
    const run = (forwarding: boolean): Node[] => {
      const room = ROOM(4, uniform(14, 30, 60, 20));
      room.net.block('n1', 'n2');
      const { nodes } = lobby(room, { keeperPack: null, readyAt: 2000, players: [1, 2, 3, 4].map((k) => ({ k, pack: (k % 2) as Pack, script: 'brain' as const })) });
      for (const n of nodes) (n.session.cfg as { forwarding: boolean }).forwarding = forwarding;
      room.run(12_000);
      expectClean(room);
      return nodes;
    };
    const fwd = run(true);
    agree(fwd);
    for (const n of fwd) expect([stats(n).resyncs, stats(n).disagree], n.id).toEqual([0, 0]);
    expect(finalOf(fwd[0]!).phase).toBeGreaterThanOrEqual(IN_PLAY);
    expect(roster(fwd[0]!)).toHaveLength(4);
    // Without it, the blocked pair miss each other's inputs.
    const without = run(false);
    expect(stats(without[1]!).disagree + stats(without[2]!).disagree).toBeGreaterThan(0);
  });

  it("merges two timelines in one room: the older stays, and the losing side's players and bots JOIN again, back in their packs, as a full replay (P7)", () => {
    const run = twin(
      (mode) => new NetPump(new LoopbackNet(5, uniform(15, 30, 60, 20)), { mode }),
      (room) => {
        const net = room.net;
        const a = node(room, 0, { verify: 8 });
        const pa = node(room, 1);
        const b = node(room, 5);
        const pb = node(room, 6);
        for (const x of ['n0', 'n1']) for (const y of ['n5', 'n6']) net.block(x, y);
        net.join(a, 0, (now) => {
          a.session.propose(a.local(now), { packSize: 3, matchMinutes: 1 }, 'c'.repeat(16));
          a.session.play(0);
        });
        net.join(pa, 500, () => {
          pa.session.play(1);
          pa.session.addBot(0);
        });
        net.join(b, 1500, (now) => {
          b.session.propose(b.local(now), { packSize: 3, matchMinutes: 1 }, 'd'.repeat(16));
          b.session.play(1);
        });
        net.join(pb, 2000, () => {
          pb.session.play(0);
          pb.session.addBot(1);
        });
        net.at(3500, () => {
          // Each half has its two players and its bot, before they meet.
          expect([a, pa].map((n) => roster(n).length)).toEqual([3, 3]);
          expect([b, pb].map((n) => roster(n).length)).toEqual([3, 3]);
        });
        net.at(4000, () => {
          for (const x of ['n0', 'n1']) for (const y of ['n5', 'n6']) net.unblock(x, y);
        });
        room.run(8000);
      },
    );
    const nodes = run.nodes.map((n) => run.net.nodes.get(`n${[0, 1, 5, 6][n.k]}`) as Node);
    expect(new Set(nodes.map((n) => n.session.timeline.id))).toEqual(new Set(['c'.repeat(16)]));
    agree(nodes);
    const packs = new Map(finalOf(nodes[0]!).terriers.map((T) => [T.id, T.pack]));
    expect(Object.fromEntries(packs)).toEqual({
      [id(0)]: 0, [id(1)]: 1, [botId(id(1), 0)]: 0,
      [id(5)]: 1, [id(6)]: 0, [botId(id(6), 0)]: 1,
    });
    // The losers took the winner's timeline, joining as anyone does: nobody returned.
    expect(nodes.map((n) => n.session.returning)).toEqual([false, false, false, false]);
  });

  /** Each started timeline object n holds, in order, looked at every ms until `until`. */
  function held(room: Room, n: Node, until: number): Timeline[] {
    const seen: Timeline[] = [];
    const look = (): void => {
      const t = n.session.timeline;
      if (t.started && seen.at(-1) !== t) seen.push(t);
      if (room.net.now < until) room.net.at(room.net.now + 1, look);
    };
    room.net.at(0, look);
    return seen;
  }
  /** Their timelines, by each ID's first digit. */
  const timelinesOf = (seen: readonly Timeline[]): string[] => seen.map((t) => t.id.slice(0, 1));

  it('ends three timelines that meet one after another as the best, a stale HELLO moving nobody to a weaker one (P7, reviewer S1)', () => {
    // x's timeline beats w's, which beats b's. b meets x on a fast link and w on a slower one at 4 s,
    // the handshake with w begun on b's own HELLO; w meets x at 6 s.
    const fast = (a: string, b: string): LinkSpec => {
      const k = [a, b].sort().join('|');
      return { base: k === 'n0|n5' ? 10 : k === 'n1|n5' ? 40 : 30, jitter: 0 };
    };
    const room = ROOM(16, fast);
    const net = room.net;
    const bases: number[] = [];
    const [x, w, b] = [node(room, 0, { verify: 8 }), node(room, 1), node(room, 5, { bases })];
    for (const [p, q] of [['n0', 'n1'], ['n0', 'n5'], ['n1', 'n5']] as const) net.block(p, q);
    net.join(x, 0, (now) => {
      x.session.propose(x.local(now), { packSize: 2, matchMinutes: 1 }, 'a'.repeat(16));
      x.session.play(0);
    });
    net.join(w, 500, (now) => {
      w.session.propose(w.local(now), { packSize: 2, matchMinutes: 1 }, 'b'.repeat(16));
      w.session.play(0);
    });
    net.join(b, 1000, (now) => {
      b.session.propose(b.local(now), { packSize: 2, matchMinutes: 1 }, 'c'.repeat(16));
      b.session.play(1);
    });
    net.at(4000, () => {
      net.unblock('n0', 'n5');
      net.unblock('n1', 'n5');
    });
    net.at(6000, () => net.unblock('n0', 'n1'));
    const seen = held(room, b, 12_000);
    room.run(12_000);
    // b held its own, then x's, and never w's; its JOIN again, once (D-10's 0).
    expect(timelinesOf(seen)).toEqual(['c', 'a']);
    expect(bases).toEqual([0]);
    for (const n of [x, w, b]) expect(n.session.timeline.id, n.id).toBe('a'.repeat(16));
    expect(roster(x).sort()).toEqual([id(0), id(1), id(5)].sort());
    expectClean(room);
    agree([x, w, b]);
  });

  it('ends three timelines of two pages each, meeting at once, as the best (P7, reviewer H1)', () => {
    const room = ROOM(17, uniform(27, 30, 60, 10));
    const net = room.net;
    const groups = [[0, 1], [5, 6], [10, 11]].map(([k, j], g) => [node(room, k!, { verify: g === 0 ? 8 : 0 }), node(room, j!)] as const);
    const all = groups.flat();
    for (let g = 0; g < 3; g++) for (let h = g + 1; h < 3; h++) for (const p of groups[g]!) for (const q of groups[h]!) net.block(p.id, q.id);
    groups.forEach(([k, j], g) => {
      net.join(k, 1000 * g, (now) => {
        k.session.propose(k.local(now), { packSize: 3, matchMinutes: 1 }, ['a', 'b', 'c'][g]!.repeat(16));
        k.session.play(0);
      });
      net.join(j, 1000 * g + 300, () => j.session.play(1));
    });
    net.at(4000, () => {
      for (let g = 0; g < 3; g++) for (let h = g + 1; h < 3; h++) for (const p of groups[g]!) for (const q of groups[h]!) net.unblock(p.id, q.id);
    });
    room.run(12_000);
    for (const n of all) expect([n.session.timeline.started, n.session.timeline.id], n.id).toEqual([true, 'a'.repeat(16)]);
    // Everyone back in a pack: 3 a side holds the six.
    expect(roster(all[0]!)).toHaveLength(6);
    expectClean(room);
    agree(all);
  });

  it("keeps the timeline it holds when the winner's only holder goes before its STATE arrives, stranding nobody (reviewers S4, H1)", () => {
    const room = ROOM(18, () => ({ base: 40, jitter: 10 }));
    const net = room.net;
    const a = node(room, 0, { verify: 8 }); // the older timeline, alone
    const b = node(room, 5); // the newer one's proposer
    const pb = node(room, 6); // and its player, who never meets a
    net.block('n0', 'n5');
    net.block('n0', 'n6');
    net.join(a, 0, (now) => {
      a.session.propose(a.local(now), { packSize: 2, matchMinutes: 1 }, 'c'.repeat(16));
      a.session.play(0);
    });
    net.join(b, 1000, (now) => {
      b.session.propose(b.local(now), { packSize: 2, matchMinutes: 1 }, 'd'.repeat(16));
      b.session.play(0);
    });
    net.join(pb, 1200, () => pb.session.play(1));
    // a and b meet at 4 s; a's answer to b's STATE_REQ is lost, and a closes its tab.
    net.dropNext('n0', 'n5', (bytes) => bytes[0] === T.STATE);
    net.at(4000, () => net.unblock('n0', 'n5'));
    net.leave(a, 4300);
    const seen = held(room, b, 10_000);
    room.run(10_000);
    // b asked, and played on meanwhile: one timeline throughout, its terrier in it and in step.
    expect(timelinesOf(seen)).toEqual(['d']);
    for (const n of [b, pb]) expect([n.session.timeline.id, n.session.inRoster()], n.id).toEqual(['d'.repeat(16), true]);
    expect(b.session.failed(b.local(net.now))).toBe(false);
    expect(finalOf(pb).tick - terrier(pb, id(5))!.lastInputTick).toBeLessThan(30);
    expectClean(room);
    agree([b, pb]);
  });

  it('carries on after the proposer leaves', () => {
    const { room, net, nodes } = lobby(ROOM(7, uniform(17, 30, 60, 20)), {
      keeperPack: null, readyAt: 2000, players: [1, 2, 3, 4].map((k) => ({ k, pack: (k % 2) as Pack, script: 'brain' as const, ...(k === 1 ? { verify: 8 } : {}) })),
    });
    net.leave(nodes[0]!, 4000);
    room.run(25_000);
    const players = nodes.slice(1);
    agree(players);
    expect(finalOf(players[0]!).phase).toBeGreaterThanOrEqual(IN_PLAY);
    expect(players.every((n) => n.session.peerCount() === 3)).toBe(true);
    expectClean(room);
  });

  it('repairs a player beyond the late window, and the others never split', () => {
    const slow = (x: string, y: string): LinkSpec => ({ base: x === 'n3' || y === 'n3' ? 300 : 40, jitter: 20 });
    const { room, nodes } = lobby(ROOM(8, slow), {
      keeperPack: 0, readyAt: 2000, players: [{ k: 1, pack: 1 }, { k: 2, pack: 0 }, { k: 3, pack: 1 }],
    });
    room.run(20_000);
    agree(nodes.slice(0, 3));
    for (const n of nodes.slice(0, 3)) expect([stats(n).resyncs, stats(n).disagree], n.id).toEqual([0, 0]);
    expect(stats(nodes[3]!).resyncs).toBeGreaterThan(0);
    expectClean(room);
  });
});
