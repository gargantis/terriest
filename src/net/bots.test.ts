import { describe, expect, it, vi } from 'vitest';
import { botIds, personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import {
  decode, encodeFwd, encodeTick, type Hello, NO_TICK, PROTOCOL_VERSION, ROLE, T, type Tick, TIMELINE_KIND, wireLimits, ZERO_HASH,
} from '../core/protocol/messages';
import { type Accepted, commonRefusal, type Link, type Refusal, type RoomPeer } from '../core/session/room-peer';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, encodeInput, findTerrier, IN_PLAY, jumpCount, type MatchState, type Pack, pounceCount, WARM_UP } from '../core/sim/index';
import { expectAgreement, inside, NetPump, spoil, TEST_BUILD } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';

// Bot hosting over the loopback network in virtual time (PLAN §14, D-39,
// D-13, D-19; M3's design, research/m3/DESIGN.md, §4.8, §8.1): roslambo's
// bots tests with their assertions, on terriest's session and packs. A
// host's bots ride in its TICK, and it votes once however many it hosts, so
// two players outvote it; a host that reloads mid-match takes its bots
// back; Remove takes the newest bot in a pack, and a host that leaves before
// the countdown takes the rest out at once; a bot's inputs come only from
// its host; a host's catch-up thinks once per head tick, so the ticks it
// sends in one timer run carry one input a bot (M3-Q25); and a spectator's
// bots reach a page that can't reach it through a forwarder (P5's bots
// half). BotHost alone is src/core/session/bots.test.ts's. Each test runs
// one node at verify: 8 (design §8.3).

// Matches in virtual time: CPU-bound, as M2's suites are.
vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const WIRE = wireLimits();
const MATCH = 'b0b0b0b0b0b0b0b0';
const id = (k: number): string => personId(41, k);

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

const ROOM = (seed: number): Room => new NetPump(new LoopbackNet(seed, uniform(seed * 7, 30, 60, 20)));

interface Spec {
  readonly verify?: number;
  /** A node ID other than n<k>: a reload of the same player. */
  readonly nodeId?: string;
  /** Each message the session sends, with the time. */
  readonly sent?: (bytes: Uint8Array, now: number) => void;
}

/** The link, each message it carries handed to sent first. */
function recording(link: Link, sent: (bytes: Uint8Array) => void): Link {
  const out = Object.create(link) as Link;
  out.send = (peer, bytes) => {
    sent(bytes);
    link.send(peer, bytes);
  };
  out.broadcast = (bytes) => {
    sent(bytes);
    link.broadcast(bytes);
  };
  return out;
}

/** Player k's session, its own input idle. */
function node(room: Room, k: number, spec: Spec = {}): Node {
  return room.net.add(
    spec.nodeId ?? `n${k}`,
    room.peer(
      (link, mode) => {
        const cfg: SessionConfig = {
          P, B, net: NET, me: id(k), name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, forwarding: true, mode, verify: spec.verify ?? 0,
        };
        const sent = spec.sent;
        return new GameSession(cfg, sent === undefined ? link : recording(link, (bytes) => sent(bytes, room.net.now)));
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
  );
}

const finalOf = (n: Node): Readonly<MatchState> => n.session.timeline.final;
const roster = (n: Node): string[] => finalOf(n).terriers.map((T) => T.id).sort();
const terrier = (n: Node, who: string): MatchState['terriers'][number] | undefined => finalOf(n).terriers[findTerrier(finalOf(n), who)];
const agree = (nodes: readonly Node[]): void => expectAgreement(nodes.map((n) => ({ t: n.session.timeline })));
const stats = (n: Node): Node['session']['timeline']['stats'] => n.session.timeline.stats;
/** The run was clean (design §8.3, R-1): the drawn head's contract held on every node, and every chain
 *  a verifying node checked matched a full replay (reviewer S5). */
function expectClean(room: Room): void {
  expect(room.problems).toEqual([]);
  for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `node ${n.k}: ${JSON.stringify(n.t.stats.log.slice(-4))}`).toBe(0);
}
/** In control: the terrier's newest input is within 30 ticks of n's final tick, and it isn't sitting. */
function inControl(n: Node, who: string): [boolean, boolean] {
  const T = terrier(n, who);
  return [T !== undefined && finalOf(n).tick - T.lastInputTick < 30, T?.sitting ?? true];
}

/** n0 proposes at 0, plays in keeperPack and adds keeperBots; each player joins 200·k ms on, plays
 *  in its pack and adds its bots; each player presses Ready at readyAt + 50·k ms, unless readyAt is
 *  null (bots are ready from their JOIN, C-41). */
function lobby(
  room: Room,
  o: {
    readonly packSize: number; readonly keeperPack: Pack; readonly keeperBots?: readonly Pack[]; readonly keeper?: Spec;
    readonly players: readonly { readonly k: number; readonly pack: Pack; readonly bots?: readonly Pack[]; readonly spec?: Spec }[];
    readonly readyAt: number | null;
  },
): Node[] {
  const net = room.net;
  const keeper = node(room, 0, { verify: 8, ...o.keeper });
  net.join(keeper, 0, (now) => {
    keeper.session.propose(keeper.local(now), { packSize: o.packSize, matchMinutes: 1 }, MATCH);
    keeper.session.play(o.keeperPack);
    for (const p of o.keeperBots ?? []) expect(keeper.session.addBot(p)).toBe(true);
  });
  const nodes = [keeper];
  for (const p of o.players) {
    const n = node(room, p.k, p.spec);
    net.join(n, 200 * p.k, () => {
      n.session.play(p.pack);
      for (const b of p.bots ?? []) expect(n.session.addBot(b)).toBe(true);
    });
    nodes.push(n);
  }
  if (o.readyAt !== null) nodes.forEach((n, k) => net.at(o.readyAt! + 50 * k, () => n.session.ready(true)));
  return nodes;
}

/** Spoils n's final state, the ball nudged, so its next final ticks hash apart from everyone's
 *  (design §0's on-purpose corruptions, testing.ts's spoil). */
const corrupt = (n: Node): void => spoil(n.session.timeline, (F) => void (F.ball.x += 1e-9));

describe('bots over the network (PLAN §14, D-39, design §4.8)', () => {
  it("rides a host's bots in its TICK, and counts its vote once however many it hosts: two players outvote it (D-13)", () => {
    // The host and two of its bots in pack A, its third bot and two players in pack B. Its four
    // terriers, counted a vote each, would outvote the two players and repair them to its spoilt state.
    const room = ROOM(1);
    const net = room.net;
    const ticks: Tick[] = [];
    const bots = botIds(id(0)).slice(0, 3);
    const nodes = lobby(room, {
      packSize: 3, keeperPack: 0, keeperBots: [0, 0, 1], readyAt: 2000,
      keeper: { sent: (bytes) => (bytes[0] === T.TICK ? ticks.push(decode(bytes, P, WIRE) as Tick) : 0) },
      players: [{ k: 1, pack: 1 }, { k: 2, pack: 1 }],
    });
    const [host, x, y] = nodes as [Node, Node, Node];
    // Each second, the bots' inputs y holds for its final ticks are those the host's TICKs carried.
    let checked = 0;
    for (let at = 3000; at <= 15_000; at += 1000) {
      net.at(at, () => {
        const sent = new Map(ticks.flatMap((m) => m.bots.map((b): [string, number] => [`${b.id} ${m.t}`, b.input])));
        const t = y.session.timeline;
        for (let u = Math.max(1, t.finalTick - NET.timeline.history + 1); u <= t.finalTick; u++) {
          for (const b of bots) {
            const got = t.receivedInput(b, u);
            if (got === undefined) continue;
            checked++;
            expect(got, `${b} at ${u}`).toBe(sent.get(`${b} ${u}`));
          }
        }
      });
    }
    room.run(15_000);
    expect(finalOf(host).phase).toBe(IN_PLAY);
    expect(roster(x)).toEqual([id(0), id(1), id(2), ...bots].sort());
    // Every TICK of the host's since its bots were added carries the three.
    expect(ticks.length).toBeGreaterThan(800);
    for (const m of ticks) expect(m.bots.map((b) => b.id), `tick ${m.t}`).toEqual(bots);
    expect(checked).toBeGreaterThan(5000);
    corrupt(host);
    room.run(10_000);
    expect(stats(host).resyncs, 'the host').toBe(1);
    expect([stats(x).resyncs, stats(y).resyncs], 'the players').toEqual([0, 0]);
    expect(stats(x).disagree, 'the players never lose a tally').toBe(0);
    expectClean(room);
    agree(nodes);
  });

  it('lets a host that reloads mid-match take its bots back: they sit while it is away, and play again (D-17, PLAN §14)', () => {
    const room = ROOM(2);
    const net = room.net;
    const nodes = lobby(room, { packSize: 2, keeperPack: 0, keeperBots: [0, 1], readyAt: 2000, players: [{ k: 1, pack: 1 }] });
    const [host, x] = nodes as [Node, Node];
    const bots = botIds(id(0)).slice(0, 2);
    net.leave(host, 20_000);
    net.at(24_000, () => {
      expect(finalOf(x).phase).toBe(IN_PLAY);
      for (const b of [id(0), ...bots]) expect(inControl(x, b), `${b} while its host is away`).toEqual([false, true]);
    });
    const back = node(room, 0, { nodeId: 'back' });
    net.join(back, 25_000);
    room.run(35_000);
    expect([back.session.returning, back.session.inRoster(), [...back.session.hostedBots()].sort()]).toEqual([true, true, [...bots].sort()]);
    for (const n of [x, back]) for (const b of [id(0), ...bots]) expect(inControl(n, b), `${b} on ${n.id}`).toEqual([true, false]);
    expect(finalOf(x).phase).not.toBe(WARM_UP);
    expectClean(room);
    agree([x, back]);
  });

  it('takes out the newest bot in a pack on Remove, and the rest at once when its host leaves before the countdown (PLAN §14)', () => {
    const room = ROOM(3);
    const net = room.net;
    // Nobody readies: the warm-up lasts. n1 hosts two bots in pack A and one in B.
    const nodes = lobby(room, { packSize: 3, keeperPack: 0, readyAt: null, players: [{ k: 1, pack: 1, bots: [0, 0, 1] }] });
    const [keeper, host] = nodes as [Node, Node];
    const [b0, b1, b2] = botIds(id(1)) as [string, string, string];
    net.at(5000, () => {
      expect(roster(keeper)).toEqual([id(0), id(1), b0, b1, b2].sort());
      expect(host.session.removeBot(0)).toBe(true);
    });
    net.at(6000, () => {
      expect(roster(keeper)).toEqual([id(0), id(1), b0, b2].sort());
      expect(host.session.hostedBots()).toEqual([b0, b2]);
      host.session.leave();
    });
    // NetGame closes the room leaveGraceMs on, once its LEAVEs are out (design §4.2).
    net.leave(host, 6000 + NET.room.leaveGraceMs);
    // Silence alone would take removalSilentTicks, 3 s, to remove them (D-12).
    room.run(7000);
    expect(roster(keeper)).toEqual([id(0)]);
    expect(finalOf(keeper).phase).toBe(WARM_UP);
    expectClean(room);
  });

  it("takes a bot's inputs only from its host: another peer's TICK and FWD carrying them change nothing (roslambo Q-23, §4.10)", () => {
    const room = ROOM(4);
    const net = room.net;
    const nodes = lobby(room, { packSize: 2, keeperPack: 0, keeperBots: [0, 1], readyAt: 2000, players: [{ k: 1, pack: 1 }] });
    const [host, x] = nodes as [Node, Node];
    const bots = botIds(id(0)).slice(0, 2);
    const rogue = net.add('r', (link) => new Rogue(link, id(0)));
    net.join(rogue, 1000);
    // Each second, every input x holds for a bot is its host's own, never the rogue's.
    let checked = 0;
    for (let at = 3000; at <= 20_000; at += 1000) {
      net.at(at, () => {
        const t = x.session.timeline;
        for (let u = Math.max(1, t.finalTick - NET.timeline.history + 1); u <= t.localTick + NET.timeline.delay; u++) {
          for (const b of bots) {
            const got = t.receivedInput(b, u);
            if (got === undefined) continue;
            checked++;
            expect(got, `${b} at ${u}`).not.toBe(FORGED);
            if (u <= t.finalTick) expect(got, `${b} at ${u}`).toBe(host.session.timeline.receivedInput(b, u));
          }
        }
      });
    }
    room.run(20_000);
    expect(rogue.session.forged).toBeGreaterThan(1000);
    expect(net.drops).toEqual([]);
    expect(finalOf(x).phase).toBe(IN_PLAY);
    expect(checked).toBeGreaterThan(5000);
    for (const b of bots) expect(inControl(x, b)).toEqual([true, false]);
    expect([stats(host).resyncs, stats(x).resyncs]).toEqual([0, 0]);
    expectClean(room);
    agree(nodes);
  });

  it('thinks once per head tick: the ticks a paced host sends in one timer run carry one input a bot, pressing at most once (M3-Q25)', () => {
    // The host, its timers 100 ms apart from 10 s, as a throttled page's, sends its newest
    // stallSendTicks ticks each run, all on one head; its bots chase the ball, and press.
    const room = ROOM(5);
    const net = room.net;
    const runs = new Map<number, Tick[]>();
    const nodes = lobby(room, {
      packSize: 2, keeperPack: 0, keeperBots: [0, 1], readyAt: 2000, players: [{ k: 1, pack: 1 }],
      keeper: {
        sent: (bytes, now) => {
          if (bytes[0] !== T.TICK || now < 10_000) return;
          const list = runs.get(now) ?? [];
          list.push(decode(bytes, P, WIRE) as Tick);
          runs.set(now, list);
        },
      },
    });
    const [host, x] = nodes as [Node, Node];
    const bots = botIds(id(0)).slice(0, 2);
    net.pace(host, 10_000, 100);
    room.run(30_000);
    expect(finalOf(x).phase).not.toBe(WARM_UP);
    let presses = 0;
    let caught = 0;
    const last = new Map<string, number>();
    for (const [at, list] of runs) {
      if (list.length > 1) caught++;
      for (const b of bots) {
        const inputs = list.map((m) => m.bots.find((e) => e.id === b)!.input);
        expect(new Set(inputs).size, `${b} at ${at}`).toBe(1);
        const v = inputs[0]!;
        const was = last.get(b);
        if (was !== undefined && (jumpCount(v) !== jumpCount(was) || pounceCount(v) !== pounceCount(was))) {
          presses++;
          // One think: each counter moves by one press at most.
          expect([(jumpCount(v) - jumpCount(was) + 4) % 4, (pounceCount(v) - pounceCount(was) + 4) % 4].every((d) => d <= 1), `${b} at ${at}`).toBe(true);
        }
        last.set(b, v);
      }
    }
    expect(caught).toBeGreaterThan(150);
    expect(presses).toBeGreaterThan(3);
    // Half their ticks absent, the bots stay in control on the others' pages, never sitting.
    for (const b of bots) expect(inControl(x, b)).toEqual([true, false]);
    expectClean(room);
    agree(nodes);
  });

  it("forwards a spectator's bot to a page that can't reach it, and counts its vote (P5, D-19, design §4.8)", () => {
    // n9 watches and hosts pack A's bot; it can't reach n2, and each one's TICKs reach the other
    // through a forwarder, its votes too.
    const room = ROOM(6);
    const net = room.net;
    net.block('n9', 'n2');
    const nodes = lobby(room, { packSize: 2, keeperPack: 0, readyAt: 2000, players: [{ k: 1, pack: 1 }, { k: 2, pack: 1 }] });
    const host = node(room, 9);
    const bot = botIds(id(9))[0]!;
    net.join(host, 600, () => {
      host.session.watch();
      expect(host.session.addBot(0)).toBe(true);
    });
    room.run(30_000);
    const all = [...nodes, host];
    expect(finalOf(nodes[2]!).phase).not.toBe(WARM_UP);
    expect(host.session.peerCount()).toBe(nodes.length - 1);
    expect([host.session.role(), host.session.inRoster()]).toEqual([ROLE.SPECTATOR, false]);
    for (const n of all) expect(inControl(n, bot), n.id).toEqual([true, false]);
    for (const n of all) expect([stats(n).resyncs, stats(n).disagree], n.id).toEqual([0, 0]);
    // n2 books its votes, which come only through the forwarder, under its own ID, which counts in a
    // tally while its bot is in the roster (D-13).
    const t2 = nodes[2]!.session.timeline;
    for (let g = t2.finalTick - 40; g <= t2.finalTick - 30; g++) expect(inside(t2).book.voters(g, t2.hashAt(g), id(2)), `tick ${g}`).toContain(id(9));
    expect(stats(nodes[2]!).agree).toBeGreaterThan(1000);
    expectClean(room);
    agree(all);
  });

  it("counts a spectator host's vote through the bot it hosts: of two players, the spoilt one loses 2 to 1 and repairs (D-13)", () => {
    // n0 in pack A and n1 in pack B, at 2 a side; n9 watches and hosts a bot in each pack, so its vote
    // is the third, one however many bots it hosts. n0 spoilt alone against n1 would be a tie the smaller
    // hash wins, and where that's n0's, n1 and n9 would repair to the spoilt state. Seeds from 1 on until
    // two are such, checking every seed it plays (hashes, not seeds, decide which).
    let spoiltSmaller = 0;
    for (let seed = 1; spoiltSmaller < 2 && seed <= 12; seed++) {
      const room = ROOM(seed);
      const net = room.net;
      // Each vote the spoilt page sends, by tick.
      const votes = new Map<number, string>();
      const keeper: Spec = {
        sent: (bytes) => {
          const m = bytes[0] === T.TICK ? (decode(bytes, P, WIRE) as Tick | null) : null;
          if (m !== null && m.voteTick !== NO_TICK) votes.set(m.voteTick, m.voteHash);
        },
      };
      const [x, y] = lobby(room, { packSize: 2, keeperPack: 0, keeper, readyAt: 2000, players: [{ k: 1, pack: 1 }] }) as [Node, Node];
      const host = node(room, 9);
      net.join(host, 600, () => {
        host.session.watch();
        for (const p of [0, 1] as const) expect(host.session.addBot(p)).toBe(true);
      });
      room.run(12_000);
      const label = `seed ${seed}`;
      expect([finalOf(x).phase, host.session.role(), host.session.inRoster(), roster(y)], label).toEqual([
        IN_PLAY, ROLE.SPECTATOR, false, [id(0), id(1), ...botIds(id(9)).slice(0, 2)].sort(),
      ]);
      corrupt(x);
      const g = x.session.timeline.finalTick + 1;
      room.run(1500);
      const honest = y.session.timeline.hashAt(g);
      room.run(6500);
      expect([stats(x).resyncs, stats(x).resyncFailed], label).toEqual([1, 0]);
      for (const n of [y, host]) expect([stats(n).resyncs, stats(n).disagree, stats(n).resyncFailed], `${label}: ${n.id}`).toEqual([0, 0, 0]);
      expect([votes.has(g), honest.length, votes.get(g) === honest], label).toEqual([true, 16, false]);
      if (votes.get(g)! < honest) spoiltSmaller++;
      expectClean(room);
      agree([x, y, host]);
    }
    // Where the spoilt hash was the smaller, only the host's vote kept the honest pages from repairing to it.
    expect(spoiltSmaller).toBe(2);
  });
});

/** A spectator of the test's own, holding no timeline: for each TICK of the host's it hears, a TICK of
 *  its own for the same tick carrying the host's bots with an input of its own, to every page, and the
 *  host's TICK so changed in a FWD under the host's ID, to every page but the host, which would count
 *  one speaking for it as invalid (roslambo Q-23, design §4.10). */
class Rogue implements RoomPeer {
  forged = 0;
  private readonly link: Link;
  private readonly host: string;
  private hostPeer: string | null = null;
  private readonly peers = new Set<string>();
  private readonly me = id(30);

  constructor(link: Link, host: string) {
    this.link = link;
    this.host = host;
  }

  hello(): Hello {
    return {
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: this.me, role: ROLE.SPECTATOR, timeline: ZERO_HASH,
      timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name: 'R',
    };
  }

  checkHello(hello: Hello): Accepted | Refusal {
    return commonRefusal(hello, TEST_BUILD, this.me) ?? { ok: true, hello };
  }

  onPeerJoin(peer: string, hello: Hello): void {
    this.peers.add(peer);
    if (hello.player === this.host) this.hostPeer = peer;
  }

  onHandshakeFailed(): void {}

  onPeerLeave(peer: string): void {
    this.peers.delete(peer);
  }

  onRtt(): void {}

  onMessage(peer: string, bytes: Uint8Array): void {
    if (peer !== this.hostPeer) return;
    const m = decode(bytes, P, WIRE);
    if (m === null || m.type !== T.TICK || m.bots.length === 0) return;
    const bots = m.bots.map((b) => ({ ...b, input: FORGED }));
    this.link.broadcast(encodeTick({ t: m.t, own: null, voteTick: NO_TICK, voteHash: ZERO_HASH, phase: m.phase, bots }, WIRE));
    const fwd = encodeFwd(this.host, encodeTick({ ...m, bots }, WIRE));
    for (const p of this.peers) if (p !== this.hostPeer) this.link.send(p, fwd);
    this.forged++;
  }

  advance(): void {}
}

/** The rogue's input for the host's bots: zoomies along a step no brain holds there, with presses. */
const FORGED = encodeInput({ step: 5, zoomies: true, jump: 3, pounce: 3 });
