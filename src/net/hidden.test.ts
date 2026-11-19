import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type ScriptName, scriptSampler } from '../core/bot/setups';
import { decode, T, type Tick } from '../core/protocol/messages';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, encodeInput, findTerrier, IN_PLAY, jumpCount, type MatchState, NEVER, type Pack, type Terrier, WARM_UP } from '../core/sim/index';
import { NetPump, oldest, TEST_BUILD } from '../core/timeline/testing';
import type { Timeline } from '../core/timeline/timeline';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';

// Hidden pages and silent senders over the loopback network (PLAN D-31,
// D-11, D-16; M3's design, research/m3/DESIGN.md, §2.2, §2.8, §8.1): a page
// whose timers wake once a second catches up in one advance and sends its
// newest ticks, so it never sits, in the final or the predicted state, is
// never removed or renumbered, keeps its Ready, and no page resyncs, jumps
// or changes its rate (roslambo's); players who join while the proposer's
// page is hidden keep everyone in, with no jump, late input or resync,
// since a STATE carries the clock, not a sleeping page's stale tick
// (roslambo's, the owner's report); an input late everywhere while a
// hidden page sleeps is dropped there too, its late boundary on the clock,
// so its hash stays the others'; a TICK lost and filled from a later
// TICK's history leaves the predicted counters as they were, a press acted
// once; and a silent player's terrier, and a bot whose host is away, sit
// in every peer's predicted state within the sit threshold plus w ticks,
// and stand again when their inputs return.

// Matches in virtual time: CPU-bound, as M2's suites are.
vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const B = defaultBotParams;
const P = defaultParams;
const D = NET.timeline.delay;
const W = NET.timeline.window;
const MATCH = '41dde941dde941dd';
const SEED = 23;
const id = (k: number): string => personId(SEED, k);

/** A session as NetGame drives it (design §1.24): a gap over stallMs between timer runs is a stall. */
class GameSession extends Session {
  /** What the test does right after a timer run. */
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

interface Spec {
  readonly script?: ScriptName;
  readonly controls?: (s: Session) => number;
  readonly verify?: number;
}

/** Player k's session, its terrier driven by a script on its head, made again from each base
 *  onControl hands it (D-10), or by controls. */
function node(room: Room, k: number, spec: Spec = {}): Node {
  const me = id(k);
  const script = spec.script ?? 'none';
  return room.net.add(
    `n${k}`,
    room.peer(
      (link, mode) => {
        const cfg: SessionConfig = {
          P, B, net: NET, me, name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, forwarding: true, mode, verify: spec.verify ?? 0,
        };
        const s = new GameSession(cfg, link);
        let sample = scriptSampler(script, me, 0, P, B);
        s.controls = () => (spec.controls ? spec.controls(s) : sample(s.timeline.head, s.timeline.headTick));
        s.onControl = (base) => {
          sample = scriptSampler(script, me, base, P, B);
        };
        return s;
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
  );
}

const tl = (n: Node): Timeline => n.session.timeline;
const stats = (n: Node): Timeline['stats'] => tl(n).stats;
const finalOf = (n: Node): Readonly<MatchState> => tl(n).final;
/** The roster as a set: each terrier's ID, pack and join tick, a kickoff placement's new spots aside. */
const rosterOf = (s: Readonly<MatchState>): string => s.terriers.map((T) => `${T.id}:${T.pack}:${T.joinTick}`).sort().join(',');
const terrierIn = (s: Readonly<MatchState>, who: string): Terrier | undefined => s.terriers[findTerrier(s, who)];
const isTick = (bytes: Uint8Array): boolean => bytes[0] === T.TICK;

/** The run was clean (design §8.3, R-1): the drawn head's contract held on every node, and every chain
 *  a verifying node checked matched a full replay. */
function expectClean(room: Room): void {
  expect(room.problems).toEqual([]);
  for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `node ${n.k}: ${JSON.stringify(n.t.stats.log.slice(-4))}`).toBe(0);
}

/** Every page holds one hash at every final tick they all hold, from `from` on. */
function agreeFrom(nodes: readonly Node[], from = 0): void {
  const ts = nodes.map(tl);
  const lo = Math.max(from, ...ts.map(oldest));
  const hi = Math.min(...ts.map((t) => t.finalTick));
  expect(hi - lo).toBeGreaterThan(W);
  for (let g = lo; g <= hi; g++) expect(new Set(ts.map((t) => t.hashAt(g))).size, `tick ${g}`).toBe(1);
}

/** n0 proposes and plays in pack A; players 1… join 200·k ms on and play, in packs B, A, B; with
 *  readyAt, all press Ready then. n0 verifies at 8. */
function lobby(room: Room, players: number, readyAt: number | null, specs: readonly Spec[] = [], packSize = 2): Node[] {
  const net = room.net;
  const k0 = node(room, 0, { verify: 8, ...specs[0] });
  net.join(k0, 0, (now) => {
    k0.session.propose(k0.local(now), { packSize, matchMinutes: 1 }, MATCH);
    k0.session.play(0);
  });
  const nodes = [k0];
  for (let k = 1; k < players; k++) {
    const n = node(room, k, specs[k]);
    net.join(n, 200 * k, () => n.session.play((k % 2) as Pack));
    nodes.push(n);
  }
  if (readyAt !== null) nodes.forEach((n, k) => net.at(readyAt + 50 * k, () => n.session.ready(true)));
  return nodes;
}

const ROOM = (seed: number): Room => new NetPump(new LoopbackNet(seed, uniform(seed * 7, 30, 60, 20)));

/** No page resynced, disagreed, jumped its clock or changed its rate. */
function expectCalm(nodes: readonly Node[]): void {
  for (const n of nodes) {
    const s = stats(n);
    expect([s.resyncs, s.disagree, s.resyncFailed, s.jumps, s.rateAdj], n.id).toEqual([0, 0, 0, 0, 0]);
  }
}

describe('a hidden page (D-31)', () => {
  it('throttled to one timer a second never sits, final or predicted, is never removed or renumbered, keeps its Ready, and moves nobody’s clock', () => {
    const room = ROOM(1);
    const net = room.net;
    // In warm-up nobody Readies on schedule; the hidden page Readies at 3 s and hides from 4 s to 12 s.
    // Then all press Ready, play starts about 18.2 s in, and it hides again from 20 s to 28 s.
    const nodes = lobby(room, 4, null);
    const hidden = nodes[2]!;
    const me = hidden.session.cfg.me;
    net.at(3000, () => hidden.session.ready(true));
    net.pace(hidden, 4000, 1000);
    net.pace(hidden, 12_000, NET.timerMs);
    nodes.forEach((n, k) => net.at(13_000 + 50 * k, () => n.session.ready(true)));
    net.pace(hidden, 20_000, 1000);
    net.pace(hidden, 28_000, NET.timerMs);
    const rosters = new Set<string>();
    const seen = { sat: [] as string[], readyLost: false, played: false };
    for (const n of nodes) {
      n.session.after = (now) => {
        const t = tl(n);
        if (!t.started || now < 3500) return;
        rosters.add(rosterOf(t.final));
        // Never sitting, in the final state or the drawn, predicted head.
        for (const [s, which] of [[t.final, 'final'], [t.head, 'head']] as const) {
          const T = terrierIn(s, me);
          if (T?.sitting === true) seen.sat.push(`${n.id} ${which} ${s.tick}`);
        }
        // Its Ready held through the warm-up's hiding.
        const T = terrierIn(t.final, me);
        if (t.final.phase === WARM_UP && now < 12_500 && T !== undefined && !(T.readyUntil > t.final.tick)) seen.readyLost = true;
        if (t.final.phase === IN_PLAY && now > 20_000) seen.played = true;
      };
    }
    room.run(30_000);
    expect([...rosters]).toEqual([rosterOf(finalOf(nodes[0]!))]);
    expect(findTerrier(finalOf(nodes[0]!), me)).toBeGreaterThanOrEqual(0);
    expect([seen.sat, seen.readyLost, seen.played]).toEqual([[], false, true]);
    // Its timers slept, but no page lost an input, resynced, or had its clock dragged by its bursts.
    expectCalm(nodes);
    for (const n of nodes) expect([stats(n).late, stats(n).lateAbsent], n.id).toEqual([0, 0]);
    expectClean(room);
    agreeFrom(nodes);
  });

  it("keeps in every player who joins while the proposer's page is hidden: no jump, late input or resync, the STATE carrying the clock", () => {
    const room = ROOM(2);
    const net = room.net;
    // The keeper proposes and plays at once, then its page hides from 500 ms on; two players join.
    const keeper = node(room, 0, { verify: 8 });
    net.join(keeper, 0, (now) => {
      keeper.session.propose(keeper.local(now), { packSize: 2, matchMinutes: 1 }, MATCH);
      keeper.session.play(0);
    });
    net.pace(keeper, 500, 1000);
    const nodes = [keeper];
    for (const k of [1, 2]) {
      const n = node(room, k);
      net.join(n, 800 * k, () => n.session.play((k % 2) as Pack));
      nodes.push(n);
    }
    const all = [id(0), id(1), id(2)];
    const rosters = new Set<string>();
    for (const n of nodes) {
      n.session.after = (now) => {
        const t = tl(n);
        if (now < 4000 || !t.started) return;
        const ids = t.final.terriers.map((T) => T.id);
        rosters.add(ids.length === 3 ? [...ids].sort().join(',') : `${n.id}: ${ids.length} terriers`);
        if (ids.length > 0 && !ids.includes(id(0))) rosters.add(`${n.id} without the proposer`);
      };
    }
    room.run(12_000);
    expect([...rosters]).toEqual([[...all].sort().join(',')]);
    for (const n of nodes) expect([stats(n).jumps, stats(n).late, stats(n).resyncs, stats(n).disagree], n.id).toEqual([0, 0, 0, 0]);
    expectClean(room);
    agreeFrom(nodes);
  });

  it("drops, while it sleeps, an input every other page finalised absent: its late boundary is on the clock, so its hash stays the others'", () => {
    // x's links all 40 ms one way, no jitter, so its held TICKs come as late to every page.
    const base = uniform(21, 30, 60, 20);
    const room = new NetPump(new LoopbackNet(3, (a, b) => (a === 'n1' || b === 'n1' ? { base: 40, jitter: 0 } : base(a, b))));
    const net = room.net;
    const nodes = lobby(room, 4, 2000, [{ script: 'brain' }]);
    const [, x, hidden] = nodes as [Node, Node, Node, Node];
    const xid = x.session.cfg.me;
    net.pace(hidden, 9000, 1000);
    // 100 ms after the hidden page's run at about 10 s, x's TICKs to every page are held 300 ms, FIFO
    // holding those behind: each finalises x absent for a few ticks, and they reach the hidden page
    // before it wakes again, its final tick then most of a second stale.
    const at = { finalAtArrival: -1, from: -1, phase: -1 };
    net.at(10_100, () => {
      at.from = tl(x).localTick + D;
      at.phase = finalOf(x).phase;
      for (const n of nodes) if (n !== x) net.delayNext(x.id, n.id, isTick, 300);
    });
    net.at(10_700, () => {
      at.finalAtArrival = tl(hidden).finalTick;
    });
    room.run(14_000);
    expect(at.phase).toBe(IN_PLAY);
    // The held inputs were for ticks the hidden page hadn't finalised when they came, which a final
    // tick boundary would have taken; it dropped them as late, as every other page did.
    expect(at.finalAtArrival).toBeLessThan(at.from);
    for (const n of nodes) if (n !== x) expect(stats(n).late, n.id).toBeGreaterThan(0);
    // Only x, whose own inputs it had, lost tallies: the hidden page agreed with the rest throughout.
    expectCalm(nodes.filter((n) => n !== x).map((n) => n));
    expect([stats(x).resyncs, stats(x).resyncFailed]).toEqual([1, 0]);
    expect(terrierIn(finalOf(nodes[0]!), xid)).toBeDefined();
    expectClean(room);
    agreeFrom(nodes, at.from + W + NET.timeline.voteWindow + 60);
  });
});

describe('a TICK lost and filled from the history (D-10, D-11)', () => {
  it('leaves the predicted counters as they were: the press acted once, newest the newer input', () => {
    const room = ROOM(4);
    const net = room.net;
    // b jumps once, from its local tick 600 on, holding the counter; its TICK with the press is lost
    // on the way to a, and the next TICK's history fills it.
    const press = { at: 600 };
    const nodes = lobby(room, 2, 2000, [{}, { controls: (s) => encodeInput({ jump: s.timeline.localTick >= press.at ? 1 : 0 }) }], 1);
    const [a, b] = nodes as [Node, Node];
    const tick = press.at + D;
    net.dropNext(b.id, a.id, (bytes) => isTick(bytes) && (decode(bytes, P) as Tick).t === tick);
    const offs = new Set<number>();
    const counters = new Set<number>();
    a.session.after = () => {
      const T = terrierIn(tl(a).head, b.session.cfg.me);
      if (T === undefined || tl(a).headTick < tick - 5) return;
      offs.add(T.takeOffTick);
      counters.add(jumpCount(T.prevInput));
    };
    room.run(14_000);
    const t = tl(a);
    expect(finalOf(a).phase).toBe(IN_PLAY);
    // Filled from the history: the input as sent, newest the newer one, one take-off at the press.
    expect(t.receivedInput(b.session.cfg.me, tick)).toBe(encodeInput({ jump: 1 }));
    expect(t.newestInput(b.session.cfg.me)!.input).toBe(encodeInput({ jump: 1 }));
    expect(terrierIn(t.final, b.session.cfg.me)!.takeOffTick).toBe(tick);
    // Every head a drew shows no take-off but the press's, and the counter never past 1.
    expect([...offs].filter((x) => x !== NEVER)).toEqual([tick]);
    expect([...counters].sort()).toEqual([0, 1]);
    expectCalm(nodes);
    expectClean(room);
    agreeFrom(nodes);
  });
});

describe('a silent terrier (D-11, D-16)', () => {
  it('a silent player’s and a bot’s whose host is away sit in every peer’s predicted state within the sit threshold plus w, and stand when their inputs return', () => {
    const room = ROOM(5);
    const net = room.net;
    // Pack A: n0, with the brain, and n2; pack B: n1 and a bot n2 hosts. n3 watches. All Ready at 2 s.
    const nodes = lobby(room, 3, 2000, [{ script: 'brain' }]);
    const [n0, n1, n2] = nodes as [Node, Node, Node];
    const watcher = node(room, 3);
    net.join(watcher, 1000, () => watcher.session.watch());
    net.at(1500, () => expect(n2.session.addBot(1)).toBe(true));
    room.run(9000);
    expect(finalOf(n0).phase).toBe(IN_PLAY);
    const bot = n2.session.hostedBots()[0]!;
    // n1's page and the bot's host freeze 3 s: stalls, after which each rejoins from a peer whose
    // clock ran on, and is in control again (§4.12).
    net.pace(n1, 9000, Infinity);
    net.pace(n2, 9000, Infinity);
    net.pace(n1, 12_000, NET.timerMs);
    net.pace(n2, 12_000, NET.timerMs);
    const silent = [n1.session.cfg.me, bot];
    const seen = new Map<string, { last: number; sat: number; stood: number }>();
    for (const n of [n0, watcher]) {
      for (const who of silent) seen.set(`${n.id} ${who}`, { last: -1, sat: -1, stood: -1 });
      n.session.after = (now) => {
        const t = tl(n);
        for (const who of silent) {
          const w = seen.get(`${n.id} ${who}`)!;
          // Its newest input tick here once the freeze has had time to cut it off.
          if (now >= 9150 && w.last < 0) w.last = t.newestInput(who)!.tick;
          const T = terrierIn(t.head, who);
          if (w.last < 0 || T === undefined) continue;
          if (w.sat < 0 && T.sitting) w.sat = t.headTick;
          if (w.sat >= 0 && w.stood < 0 && !T.sitting) w.stood = t.headTick;
        }
      };
    }
    room.run(6000);
    for (const [key, w] of seen) {
      expect(w.sat, key).toBeGreaterThanOrEqual(w.last + P.sitAfterTicks);
      expect(w.sat, key).toBeLessThanOrEqual(w.last + P.sitAfterTicks + W);
      expect(w.stood, key).toBeGreaterThan(w.sat);
    }
    // Back in control: each stands in every final state, its inputs arriving again.
    for (const n of [...nodes, watcher]) {
      for (const who of silent) {
        const T = terrierIn(finalOf(n), who)!;
        expect([T.sitting, finalOf(n).tick - T.lastInputTick < 30], `${n.id} ${who}`).toEqual([false, true]);
      }
    }
    expectClean(room);
    agreeFrom([...nodes, watcher]);
  });
});
