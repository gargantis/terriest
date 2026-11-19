import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type ScriptName, scriptSampler } from '../core/bot/setups';
import { ROLE } from '../core/protocol/messages';
import type { BotTimeline } from '../core/session/bots';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import {
  defaultParams, ENDED, findTerrier, IN_PLAY, JOIN, type MatchState, type Pack, READY, type SimParams,
} from '../core/sim/index';
import { expectAgreement, NetPump, TEST_BUILD } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32, type NodeOptions } from './loopback';

// Matches over the loopback network in virtual time (PLAN §8, §16; M3's
// design, research/m3/DESIGN.md, §4, §8.1): roslambo's network tests with
// their assertions, on terriest's session. P1 and P2, a proposer, three
// players and a late spectator to the confirmed end, and AGAIN; D-16's
// received inputs; a page that never holds a timeline fails, a keeper never;
// and Timeline as BotHost's BotTimeline. Joining and packs are in
// joining.test.ts, the mesh in mesh.test.ts (split for design §13's 8 s a
// file, M3 phase 4's fixes). Each runs one node at verify: 8, the rest
// unverified (design §8.3).

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
