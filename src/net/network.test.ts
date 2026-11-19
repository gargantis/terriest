import { describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { botId, botIds, personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type ScriptName, scriptSampler } from '../core/bot/setups';
import { REFUSAL, ROLE, T } from '../core/protocol/messages';
import type { BotTimeline } from '../core/session/bots';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import {
  defaultParams, ENDED, findTerrier, IN_PLAY, JOIN, LEAVE, type MatchState, type Pack, READY, type SimParams, simParams, SWITCH, WARM_UP,
} from '../core/sim/index';
import { expectAgreement, inside, NetPump, TEST_BUILD, twin } from '../core/timeline/testing';
import type { Timeline } from '../core/timeline/timeline';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32, type NodeOptions } from './loopback';

// Matches over the loopback network in virtual time (PLAN §8, §16; M3's
// design, research/m3/DESIGN.md, §4, §8.1): roslambo's network tests with
// their assertions, on terriest's session. P1 and P2, a proposer, three
// players and a late spectator to the confirmed end, and AGAIN; D-16's
// received inputs; P4, six JOINs at once and two for one place in one
// tick; P5, a pair that can't connect, with and without forwarding; P7, two
// timelines merged, the losing side's players and bots back in their packs
// (against a full replay); the proposer leaving; a player beyond the late
// window; a late joiner, a full pack, a refused switch, a switch's cancelled
// Ready; a Ready whose TICKs came late, and its expiry; the refusals; and
// Timeline as BotHost's BotTimeline. Each runs one node at verify: 8, the
// rest unverified (design §8.3).

// Whole matches in virtual time: CPU-bound, as M2's suites are.
vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const B = defaultBotParams;
const D = NET.timeline.delay;
const W = NET.timeline.window;
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

/** Runs the room's network to virtual time t. */
const runTo = (room: Room, t: number): void => room.run(t - room.net.now);
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

describe('matches over the network (P1, P2)', () => {
  it('a proposer, three players and a late spectator play a 1-minute match to its confirmed end and agree, which trails the end, and AGAIN reaches every other page (P1, P2, D-10)', () => {
    const { room, net, nodes } = lobby(ROOM(1, uniform(11, 30, 60, 20)), {
      keeperPack: 0, keeperScript: 'brain', readyAt: 2000,
      players: [{ k: 1, pack: 0, script: 'brain' }, { k: 2, pack: 1 }, { k: 3, pack: 1 }],
    });
    const spectator = node(room, 9);
    net.join(spectator, 20_000, () => spectator.session.watch());
    nodes.push(spectator);
    const confirmed = (n: Node): boolean => finalOf(n).phase === ENDED && n.session.timeline.isConfirmed(finalOf(n).phaseStart);
    // Confirmed the moment its final state ended? The vote trails the end (roslambo D-10).
    const atEnd = new Map<string, boolean>();
    const look = (): void => {
      for (const n of nodes) if (finalOf(n).phase === ENDED && !atEnd.has(n.id)) atEnd.set(n.id, confirmed(n));
      if (atEnd.size < nodes.length) net.at(net.now + NET.timerMs, look);
    };
    net.at(0, look);
    room.run(240_000, () => atEnd.size === nodes.length);
    expect([...atEnd.values()], 'the vote trails the end').toEqual(nodes.map(() => false));
    room.run(4000, () => nodes.every(confirmed));
    for (const n of nodes) expect(confirmed(n), n.id).toBe(true);
    expectClean(room);
    agree(nodes);
    expect(new Set(nodes.map((n) => finalOf(n).phaseStart)).size).toBe(1);
    expect(new Set(nodes.map((n) => finalOf(n).score.join(':'))).size).toBe(1);
    expect(roster(nodes[0]!).sort()).toEqual([0, 1, 2, 3].map(id).sort());
    // Pack A's brains beat pack B's idle terriers, in regulation.
    expect(finalOf(nodes[0]!).score[0]).toBeGreaterThan(finalOf(nodes[0]!).score[1]);
    expect(finalOf(nodes[0]!).overtime).toBe(false);
    for (const n of nodes) expect([stats(n).resyncs, stats(n).disagree, stats(n).verifyMismatches], n.id).toEqual([0, 0, 0]);
    expect(spectator.session.role()).toBe(ROLE.SPECTATOR);
    // AGAIN reaches every other page, but not its sender (§4.9).
    nodes[1]!.session.announceAgain();
    room.run(1000);
    expect(nodes.map((n) => n.session.againSeen)).toEqual([true, false, true, true, true]);
  });

  it("gives a page's own input exactly as sent and others' as received, never a predicted one (D-16)", () => {
    const sent = [0, 1, 2, 3].map(() => new Map<number, number>());
    const room = ROOM(3, uniform(13, 30, 60, 20));
    const net = room.net;
    const nodes = [0, 1, 2, 3].map((k) => node(room, k, { script: 'brain', sent: sent[k]!, verify: k === 0 ? 8 : 0 }));
    const packs: Pack[] = [0, 1, 0, 1];
    net.join(nodes[0]!, 0, (now) => {
      nodes[0]!.session.propose(nodes[0]!.local(now), { packSize: 2, matchMinutes: 1 }, MATCH);
      nodes[0]!.session.play(0);
    });
    for (const k of [1, 2, 3]) net.join(nodes[k]!, 200 * k, () => nodes[k]!.session.play(packs[k]!));
    nodes.forEach((n, k) => net.at(2000 + 50 * k, () => n.session.ready(true)));
    const tally = { own: 0, others: 0, received: 0 };
    for (let at = 9000; at < 18_000; at += 250) {
      net.at(at, () => {
        nodes.forEach((n, k) => {
          const t = n.session.timeline;
          for (let u = t.finalTick - W; u <= t.localTick + D; u++) {
            nodes.forEach((m, j) => {
              const got = t.receivedInput(m.session.cfg.me, u);
              const truth = sent[j]!.get(u);
              if (j === k) {
                if (truth === undefined) return;
                tally.own++;
                expect(got, `${n.id}'s own at ${u}`).toBe(truth);
              } else if (u <= t.finalTick) {
                tally.others++;
                if (got === undefined) return;
                tally.received++;
                expect(got, `${n.id}'s of ${m.id} at ${u}`).toBe(truth);
              } else if (got !== undefined) {
                expect(got, `${n.id}'s of ${m.id} at ${u}, received early`).toBe(truth);
              }
            });
          }
        });
      });
    }
    room.run(18_000);
    expectClean(room);
    expect(finalOf(nodes[0]!).phase).toBeGreaterThanOrEqual(IN_PLAY);
    expect(tally.own).toBeGreaterThan(3000);
    expect(tally.received / tally.others).toBeGreaterThan(0.99);
    // The barks are in what's received: the brains bark, and the bark bits reach the others.
    const barks = new Set([...sent[1]!.values()].map((v) => (v >> 13) & 3));
    expect(barks.size).toBeGreaterThan(1);
  });
});

describe('joining and packs (P4, D-12)', () => {
  it('numbers players the same everywhere when six join at the same moment over links of 10 to 150 ms (P4)', () => {
    const room = ROOM(2, uniform(12, 10, 150, 40));
    const net = room.net;
    const keeper = node(room, 0, { verify: 8 });
    net.join(keeper, 0, (now) => keeper.session.propose(keeper.local(now), { packSize: 3, matchMinutes: 1 }, MATCH));
    const nodes = [keeper];
    for (let k = 1; k <= 6; k++) {
      const n = node(room, k);
      net.join(n, 300, () => n.session.play(k % 2 === 0 ? 0 : 1));
      nodes.push(n);
    }
    room.run(8000);
    expectClean(room);
    agree(nodes);
    const rosters = nodes.map((n) => finalOf(n).terriers.map((T) => `${T.id}:${T.pack}:${T.spot}`).join(','));
    expect(new Set(rosters).size).toBe(1);
    expect(roster(keeper)).toHaveLength(6);
    expect(nodes.slice(1).every((n) => n.session.inRoster() && n.session.refused === null)).toBe(true);
    expect(keeper.session.role()).toBe(ROLE.KEEPER);
  });

  it('numbers six players the same everywhere when they press Play together, JOINs landing in one tick, with no disagreement (P4, reviewer T6)', () => {
    const room = ROOM(2, uniform(12, 10, 150, 40));
    const net = room.net;
    const keeper = node(room, 0, { verify: 8 });
    net.join(keeper, 0, (now) => keeper.session.propose(keeper.local(now), { packSize: 3, matchMinutes: 1 }, MATCH));
    const nodes = [keeper];
    for (let k = 1; k <= 6; k++) {
      const n = node(room, k);
      net.join(n, 300);
      net.at(3000, () => n.session.play(k % 2 === 0 ? 0 : 1));
      nodes.push(n);
    }
    room.run(6000);
    const joins = finalOf(keeper).terriers.map((T) => T.joinTick);
    expect(joins).toHaveLength(6);
    expect(new Set(joins).size).toBeLessThan(6);
    const rosters = nodes.map((n) => finalOf(n).terriers.map((T) => `${T.id}:${T.pack}:${T.spot}`).join(','));
    expect(new Set(rosters).size).toBe(1);
    for (const n of nodes) expect([stats(n).resyncs, stats(n).disagree], n.id).toEqual([0, 0]);
    expectClean(room);
    agree(nodes);
  });

  it("gives a pack's last place, sought by two JOINs in one tick, to the smaller ID everywhere; the other's JOIN, a later Play and a SWITCH for that full pack are given up (P4, D-12)", () => {
    // Every link 40 ms with no jitter, so the two who race join, sync and press Play alike.
    const room = ROOM(4, () => ({ base: 40, jitter: 0 }));
    const net = room.net;
    const keeper = node(room, 0, { verify: 8 });
    net.join(keeper, 0, (now) => {
      keeper.session.propose(keeper.local(now), { packSize: 2, matchMinutes: 1 }, MATCH);
      keeper.session.play(0);
    });
    const b1 = node(room, 1);
    net.join(b1, 200, () => b1.session.play(1));
    const racers = [node(room, 2), node(room, 3)];
    for (const n of racers) net.join(n, 1000);
    net.at(2500, () => {
      for (const n of racers) n.session.play(0);
    });
    room.run(4500);
    const nodes = [keeper, b1, ...racers];
    expectClean(room);
    agree(nodes);
    const [win, lose] = [...racers].sort((x, y) => (x.session.cfg.me < y.session.cfg.me ? -1 : 1)) as [Node, Node];
    // The JOINs rode in one tick: the loser's own record holds it at the winner's join tick.
    const tick = terrier(keeper, win.session.cfg.me)!.joinTick;
    expect(inside(lose.session.timeline).store.get(lose.session.cfg.me, tick)!.events & JOIN).toBe(JOIN);
    for (const n of nodes) {
      expect(terrier(n, win.session.cfg.me)?.pack, n.id).toBe(0);
      expect(terrier(n, lose.session.cfg.me), n.id).toBeUndefined();
    }
    expect([lose.session.refused, lose.session.role(), lose.session.timeline.sending]).toEqual(['full', ROLE.SPECTATOR, false]);
    expect([win.session.refused, win.session.role()]).toEqual([null, ROLE.PLAYER]);
    // A Play for the full pack is given up at once, nothing sent; the other pack takes it.
    const late = node(room, 4);
    net.join(late, 5000, () => undefined);
    net.at(6500, () => late.session.play(0));
    runTo(room, 7000);
    expect(late.session.refused).toBe('full');
    expect(late.session.timeline.eventsInFlight(late.session.cfg.me)).toBe(0);
    late.session.play(1);
    runTo(room, 9000);
    expect(late.session.inRoster()).toBe(true);
    expect(late.session.refused).toBeNull();
    // Both packs full now: a SWITCH is refused at once, and the switcher stays.
    b1.session.switchPack();
    runTo(room, 9500);
    expect([b1.session.switchRefused, terrier(keeper, b1.session.cfg.me)!.pack]).toEqual([true, 1]);
    agree([keeper, b1, win, late]);
  });

  it("lands a switch, which cancels the Ready, and the Ready stays cancelled (D-12)", () => {
    const { room, nodes } = lobby(ROOM(6, uniform(16, 30, 60, 20)), { keeperPack: 0, readyAt: null, players: [{ k: 1, pack: 1 }] });
    const [keeper, p] = nodes as [Node, Node];
    const me = p.session.cfg.me;
    room.run(2000);
    p.session.ready(true);
    room.run(1500);
    expect(terrier(keeper, me)!.readyUntil).toBeGreaterThan(finalOf(keeper).tick);
    p.session.switchPack();
    room.run(1000);
    expect(terrier(keeper, me)!.pack).toBe(0);
    expect(p.session.switchRefused).toBe(false);
    // Not ready, and not again: the switch ended the Ready wish, well past a retry.
    const until = room.net.now + ((D + W + NET.room.eventRetryTicks) * 3 * 1000) / config.ticksPerSecond;
    while (room.net.now < until) {
      room.run(100);
      for (const n of nodes) expect(terrier(n, me)!.readyUntil, n.id).toBe(0);
    }
    expectClean(room);
    agree(nodes);
  });

  it('sends a Ready again when its TICKs reached the others after its tick was final, and one that expires stays expired (D-12, Q-15)', () => {
    // A Ready of 5 s, so its expiry comes soon.
    const P = simParams({ ...config, readyExpirySeconds: 5 });
    let slowFrom = Infinity;
    const links = (a: string, _b: string, now: number): LinkSpec => ({ base: a === 'n1' && now >= slowFrom && now < slowFrom + 400 ? 400 : 40, jitter: 10 });
    const { room, net, nodes } = lobby(ROOM(7, links), { keeperPack: 0, readyAt: null, players: [{ k: 1, pack: 1 }, { k: 2, pack: 0 }], P });
    const p = nodes[1]!;
    const me = p.session.cfg.me;
    const bases: number[] = [];
    const based = p.session.onControl;
    p.session.onControl = (base) => {
      bases.push(base);
      based?.(base);
    };
    room.run(3000);
    // Its Ready's TICKs all leave on a slow link: every one reaches the others late.
    slowFrom = net.now;
    p.session.ready(true);
    room.run(300);
    const ready = (n: Node): boolean => (terrier(n, me)?.readyUntil ?? 0) > finalOf(n).tick;
    expect(ready(nodes[0]!)).toBe(false);
    // The Ready reached nobody in time; the vote repairs the sender, which sends it again.
    room.until(() => nodes.every(ready), 3000);
    expect(stats(p).resyncs).toBeGreaterThan(0);
    // A resync keeps the timeline: no new base for its counters, only its JOIN's (design §4.6).
    expect(bases).toEqual([0]);
    // It expires, everywhere, and nothing sends it again.
    room.until(() => !ready(nodes[0]!), P.readyExpiryTicks * NET.tickMs + 1000);
    for (let k = 0; k < 30; k++) {
      room.run(100);
      for (const n of nodes) expect(ready(n), n.id).toBe(false);
    }
    expect(finalOf(nodes[0]!).phase).toBe(WARM_UP);
    expectClean(room);
    agree(nodes);
  });

  it("sends a JOIN and a READY that a hidden page's catch-up sent late only once, not again while they're in flight (M3 phase 3's answers)", () => {
    const { room, net, nodes } = lobby(ROOM(12, uniform(22, 30, 60, 20)), { keeperPack: 0, readyAt: null, players: [{ k: 1, pack: 1 }] });
    const hidden = node(room, 2);
    net.join(hidden, 1000);
    runTo(room, 2000);
    const t = hidden.session.timeline;
    expect(t.started).toBe(true);
    const me = hidden.session.cfg.me;
    const queued: number[] = [];
    const queue = t.queueEvent.bind(t);
    t.queueEvent = (who, e) => {
      if (who === me) queued.push(e.events);
      queue(who, e);
    };
    // Hidden: a timer run a second, each catching up about 60 ticks and sending the newest 3 (D-31).
    net.pace(hidden, 2000, 1000);
    net.at(2500, () => hidden.session.play(0));
    runTo(room, 7000);
    expect(hidden.session.inRoster()).toBe(true);
    expect(queued.filter((e) => (e & JOIN) !== 0)).toHaveLength(1);
    hidden.session.ready(true);
    runTo(room, 11_000);
    for (const n of [...nodes, hidden]) expect(terrier(n, me)!.readyUntil, n.id).toBeGreaterThan(finalOf(n).tick);
    expect(queued.filter((e) => (e & READY) !== 0)).toHaveLength(1);
    // And a SWITCH, likewise: once, its retry waiting while it rides (reviewer S12).
    hidden.session.switchPack();
    runTo(room, 15_000);
    for (const n of [...nodes, hidden]) expect(terrier(n, me)!.pack, n.id).toBe(1);
    expect(queued.filter((e) => (e & SWITCH) !== 0)).toHaveLength(1);
    expect(hidden.session.switchRefused).toBe(false);
    expect(t.stats.sent).toBeGreaterThan(0);
    expectClean(room);
    agree([...nodes, hidden]);
  });

  it('turns a player who joins after the start countdown began into a spectator, who stops sending (D-12)', () => {
    const { room, net, nodes } = lobby(ROOM(10, uniform(20, 30, 60, 20)), {
      keeperPack: 0, readyAt: 2000, players: [{ k: 1, pack: 1 }, { k: 2, pack: 0 }, { k: 3, pack: 1 }],
    });
    const late = node(room, 4);
    net.join(late, 6000, () => late.session.play(0));
    room.run(12_000);
    expect(finalOf(nodes[0]!).phase).not.toBe(WARM_UP);
    expect([late.session.refused, late.session.role(), late.session.timeline.sending]).toEqual(['started', ROLE.SPECTATOR, false]);
    expect(terrier(nodes[0]!, late.session.cfg.me)).toBeUndefined();
    expectClean(room);
    agree([...nodes, late]);
  });
});

describe('switching and leaving in flight (D-12, reviewer S12)', () => {
  it('gives up a SWITCH that a final tick shows refused, its pack filled by a JOIN that landed first', () => {
    const { room, net, nodes } = lobby(ROOM(13, uniform(23, 30, 60, 20)), { keeperPack: 0, readyAt: null, players: [{ k: 1, pack: 1 }] });
    const [keeper, p] = nodes as [Node, Node];
    const other = node(room, 3);
    net.join(other, 600);
    runTo(room, 2500);
    // other's JOIN for pack A's last place goes out first; p's SWITCH to A ten ticks after.
    other.session.play(0);
    runTo(room, net.now + (10 * 1000) / config.ticksPerSecond);
    expect(other.session.timeline.eventsInFlight(other.session.cfg.me) & JOIN).toBe(JOIN);
    p.session.switchPack();
    expect(p.session.timeline.eventsInFlight(p.session.cfg.me) & SWITCH).toBe(SWITCH);
    runTo(room, net.now + 1500);
    expect([terrier(keeper, other.session.cfg.me)?.pack, terrier(keeper, p.session.cfg.me)?.pack]).toEqual([0, 1]);
    expect(p.session.switchRefused).toBe(true);
    // Given up: nothing of it rides any more.
    expect(p.session.timeline.eventsInFlight(p.session.cfg.me) & SWITCH).toBe(0);
    expectClean(room);
    agree([...nodes, other]);
  });

  it('sends a LEAVE pressed while the JOIN rides, and never in the JOIN\'s own input, so the terrier goes again', () => {
    for (const when of ['in flight', 'same tick'] as const) {
      const { room, net, nodes } = lobby(ROOM(14, uniform(24, 30, 60, 20)), { keeperPack: 0, readyAt: null, players: [] });
      const p = node(room, 2);
      net.join(p, 300);
      runTo(room, 1500);
      const me = p.session.cfg.me;
      p.session.play(1);
      let left = false;
      let queuedAt = -1;
      p.session.after = () => {
        const t = p.session.timeline;
        if (left || (t.eventsInFlight(me) & JOIN) === 0) return;
        if (queuedAt < 0) queuedAt = t.localTick;
        // The timer run that queued the JOIN, or one three ticks on, with the JOIN still riding.
        if (when === 'in flight' && t.localTick < queuedAt + 3) return;
        left = true;
        p.session.leave();
      };
      runTo(room, net.now + 1500);
      expect(left, when).toBe(true);
      // The JOIN landed, then the LEAVE: nobody keeps the terrier, and nothing of it rides.
      for (const n of [...nodes, p]) expect(terrier(n, me), `${when} ${n.id}`).toBeUndefined();
      expect(p.session.timeline.eventsInFlight(me) & (JOIN | LEAVE), when).toBe(0);
      expectClean(room);
      agree([...nodes, p]);
    }
  });
});

describe('a changed configuration (reviewer S10)', () => {
  it("joins and plays at d = 3, each message decoded by its configuration's limits", () => {
    const c = { ...config, inputDelayTicks: 3 };
    const net3 = netSettings(c);
    const P = simParams(c);
    const room = ROOM(15, uniform(25, 30, 60, 20));
    const a = node(room, 0, { P, net: net3, verify: 8 });
    const b = node(room, 1, { P, net: net3 });
    room.net.join(a, 0, (now) => {
      a.session.propose(a.local(now), { packSize: 1, matchMinutes: 1 }, MATCH);
      a.session.play(0);
    });
    room.net.join(b, 1000, () => b.session.play(1));
    room.run(5000);
    expect([a.session.timeline.cfg.delay, b.session.inRoster()]).toEqual([3, true]);
    expect([stats(a).statesSent, stats(b).resyncs, stats(a).disagree, stats(b).disagree]).toEqual([1, 0, 0, 0]);
    expectClean(room);
    agree([a, b]);
  });
});

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

describe('refusals (D-21, design §4.3)', () => {
  it('refuses a mismatched build, a duplicate player, a HELLO under a bot’s ID and a fifth spectator', () => {
    const { room, net, nodes } = lobby(ROOM(9, uniform(19, 20, 30, 5)), {
      keeperPack: 0, readyAt: null, players: [{ k: 1, pack: 1 }, { k: 2, pack: 0 }, { k: 3, pack: 1 }],
    });
    const wrong = node(room, 4, { over: { build: 'f'.repeat(16) } });
    net.join(wrong, 1000);
    const twin2 = node(room, 1, { nodeId: 'twin' }); // the same player as n1, in another tab
    net.join(twin2, 1500);
    const bot = node(room, 5, { me: botIds(id(0))[3]! });
    net.join(bot, 1500);
    // Refused, they go, before the watchers come: the other tab would race n1 for their handshakes.
    for (const n of [wrong, twin2, bot]) net.leave(n, 2500);
    // Both packs are full: four places for spectators and none free, so the fifth is refused.
    const watchers = [20, 21, 22, 23, 24].map((k) => node(room, k));
    watchers.forEach((n, k) => net.join(n, 3000 + 400 * k, () => n.session.watch()));
    room.run(8000);
    const from = (to: Node): number[] => net.refusals.filter((r) => r.to === to.id && nodes.some((n) => n.id === r.from)).map((r) => r.reason);
    expect(new Set(from(wrong))).toEqual(new Set([REFUSAL.BUILD]));
    expect(new Set(from(twin2))).toEqual(new Set([REFUSAL.DUPLICATE]));
    expect(new Set(from(bot))).toEqual(new Set([REFUSAL.DUPLICATE]));
    expect(watchers.slice(0, 4).map((n) => from(n))).toEqual([[], [], [], []]);
    expect(new Set(from(watchers[4]!))).toEqual(new Set([REFUSAL.SPECTATORS_FULL]));
    expect(watchers[4]!.session.timeline.started).toBe(false);
    expect(nodes.every((n) => n.session.peerCount() === 3 + 4)).toBe(true);
    expectClean(room);
    agree([...nodes, ...watchers.slice(0, 4)]);
  });
});

describe('connection failure (PLAN §8)', () => {
  it('fails a page with no timeline connectionFailureMs after it opened the room, but never a keeper', () => {
    const cfg = (k: number): SessionConfig => ({ P: defaultParams, B, net: NET, me: id(k), name: '', coat: 0, build: TEST_BUILD, forwarding: true });
    const link = { send: (): void => undefined, broadcast: (): void => undefined };
    const lone = new Session(cfg(0), link);
    const keeper = new Session(cfg(1), link);
    keeper.propose(1000, { packSize: 1, matchMinutes: 1 }, MATCH);
    const T0 = 1000;
    for (let now = T0; now < T0 + NET.room.connectionFailureMs; now += NET.timerMs) {
      lone.advance(now);
      keeper.advance(now);
      expect(lone.failed(now)).toBe(false);
    }
    expect(lone.failed(T0 + NET.room.connectionFailureMs)).toBe(true);
    expect(keeper.failed(T0 + NET.room.connectionFailureMs)).toBe(false);
  });
});

describe('the bot host on the real timeline (design §0, §1.11)', () => {
  it('drives BotHost through the Timeline, which satisfies BotTimeline, started and eventsInFlight included', () => {
    const room = ROOM(11, uniform(21, 30, 60, 20));
    const net = room.net;
    const host = node(room, 0, { verify: 8 });
    net.join(host, 0, (now) => {
      host.session.propose(host.local(now), { packSize: 1, matchMinutes: 1 }, MATCH);
      expect(host.session.addBot(1)).toBe(true);
    });
    room.run(50);
    const t: BotTimeline = host.session.timeline;
    const bot = host.session.hostedBots()[0]!;
    expect([t.started, t.cfg.delay, t.bots.has(bot)]).toEqual([true, D, true]);
    expect(t.eventsInFlight(bot) & (JOIN | READY)).toBe(JOIN | READY);
    room.run(1000);
    expect(t.eventsInFlight(bot)).toBe(0);
    expect(roster(host)).toEqual([bot]);
    expect(terrier(host, bot)!.readyUntil).toBeGreaterThan(t.finalTick);
    expectClean(room);
  });
});
