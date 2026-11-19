import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type ScriptName, scriptSampler } from '../core/bot/setups';
import { decode, NO_TICK, type StateMsg, T, type Tick } from '../core/protocol/messages';
import { type ConfirmedGoal, Scoreboard } from '../core/session/scoreboard';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, encodeInput, findTerrier, IN_PLAY, JOIN, type MatchState, NEVER, type Pack, WARM_UP } from '../core/sim/index';
import { expectAgreement, NetPump, oldest, spoil, TEST_BUILD } from '../core/timeline/testing';
import type { Timeline } from '../core/timeline/timeline';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';

// Consensus over the loopback network (PLAN P3 with M3-Q1's bound, P9,
// C-10, D-14; M3's design, research/m3/DESIGN.md, §2.8, §3, §5.5, §8.1).
// P3: a dissenter holds the majority's state again within v ticks, a
// round trip and the ticks the spread takes, ⌈steps ÷ cap⌉: roslambo's two,
// a corrupted float and a lost terrier, outvoted 3 to 1; and late-vote
// flips from 2 s back, a page whose incoming TICKs all came 2 s late, in
// play and in warm-up, where two joiners came in meanwhile, so the STATE
// from before their JOINs carries them outside its roster (§5.5). Each
// repair within the bound, no advance's steps over the cap, no other page
// resyncing or disagreeing, every hash equal after.
// §3.6: with two voters every disagreement is a tie the smaller hash wins.
// At 1 a side, at 30 and 80 ms, the dissenter misses one of the other's
// inputs and loses the tie at the tick it diverges, at seeds where its
// votes already sent for the ticks after would win the ties there: within
// the one-way delay of its ask, the other browser lost one, asked a
// dissenter that answers nothing while it resyncs, and refused the
// dissenter's own ask meanwhile, so both failed. A voter a won tally saw
// lose isn't counted for the v − 1 ticks after, whose votes it sent before
// it knew (M3 phase 4): one completed resync, the dissenter's, no state
// adopted from it, every hash equal within P3's bound. Then three voters:
// a three-way split, the smallest hash winning and the other two repairing
// to it; and the three-way livelock M3 phase 4a's integration found, a
// player who leaves while its last TICKs reach each of the three voters
// left at a different tick, three lineages, where each voter lost a
// different tick and, none answering while it resynced, every resync
// failed (returning-seeds and returning-more.test.ts play returning.test.ts's
// scenario at 16 seeds).
// P9: every page latches the same goals at the same ticks, each when its
// tick is first confirmed there and never while repairing, none twice and
// none withdrawn, through a resync of one page's for a tick after the
// first goal showed there.

// Matches in virtual time: CPU-bound, as M2's suites are.
vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const B = defaultBotParams;
const P = defaultParams;
const W = NET.timeline.window;
const V = NET.timeline.voteWindow;
const CAP = NET.timeline.spreadCap;

// --- Pages ---

/** A goal latched or withdrawn, when, on what final tick, and when its tick was first confirmed. */
interface Event {
  readonly goal: ConfirmedGoal;
  readonly at: number;
  readonly finalTick: number;
  readonly confirmedAt: number;
}

/** A page's scoreboard, updated after each timer run, and what it did (design §1.24). */
class Board {
  readonly sb = new Scoreboard(P);
  readonly added: Event[] = [];
  readonly withdrawn: Event[] = [];
  /** Updates while the timeline repaired, and what they latched or withdrew: nothing. */
  repairingUpdates = 0;
  changedWhileRepairing = 0;
  private readonly firstConfirmed = new Map<number, number>();

  update(t: Timeline, now: number): void {
    const L = t.final.lastGoalTick;
    if (t.started && L !== NEVER && !this.firstConfirmed.has(L) && t.isConfirmed(L)) this.firstConfirmed.set(L, now);
    const { added, withdrawn } = this.sb.update(t);
    if (t.repairing) {
      this.repairingUpdates++;
      this.changedWhileRepairing += added.length + withdrawn.length;
    }
    const event = (goal: ConfirmedGoal): Event => ({ goal, at: now, finalTick: t.finalTick, confirmedAt: this.firstConfirmed.get(goal.tick) ?? -1 });
    this.added.push(...added.map(event));
    this.withdrawn.push(...withdrawn.map(event));
  }
}

/** What a page did that P3 bounds, as its timer runs saw it, and the STATEs its resyncs took. */
interface Seen {
  /** The local tick of the timer run whose tally first disagreed. */
  disagreedAt: number;
  /** Each STATE a resync took: its tick, and the local tick then, the steps its repair begins with. */
  readonly states: { readonly g: number; readonly local: number }[];
}

/** A session as NetGame drives it (design §1.24): a gap over stallMs between timer runs is a stall;
 *  its scoreboard, when it has one, updated after each timer run. It notes its timeline's first
 *  disagreement and each STATE a resync of it takes. */
class GameSession extends Session {
  readonly seen: Seen = { disagreedAt: -1, states: [] };
  board: Board | null = null;
  /** What the test does right after a timer run. */
  after: ((now: number) => void) | null = null;
  private last = -1;
  private watched: Timeline | null = null;

  override advance(now: number): void {
    if (this.last >= 0 && now - this.last > this.cfg.net.stallMs) this.stalled(now);
    this.last = now;
    super.advance(now);
    const t = this.timeline;
    if (t !== this.watched) this.observe(t);
    if (this.seen.disagreedAt < 0 && t.stats.disagree > 0) this.seen.disagreedAt = t.localTick;
    this.board?.update(t, now);
    this.after?.(now);
  }

  private observe(t: Timeline): void {
    this.watched = t;
    const take = t.onState.bind(t);
    t.onState = (peer, m, oneWayMs, now) => {
      const repair = t.started;
      const ok = take(peer, m, oneWayMs, now);
      if (ok && repair) this.seen.states.push({ g: m.g, local: t.localTick });
      return ok;
    };
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

/** Player me's session as node n<k>, named P<k>, its terrier driven by a script on its head, made
 *  again from each base onControl hands it (D-10), or by controls. */
function node(room: Room, k: number, me: string, spec: Spec = {}): Node {
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
const isTick = (bytes: Uint8Array): boolean => bytes[0] === T.TICK;

/** The run was clean (design §8.3, R-1): the drawn head's contract held on every node, every chain a
 *  verifying node checked matched a full replay, and no advance stepped over its budget. */
function expectClean(room: Room): void {
  expect(room.problems).toEqual([]);
  for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `node ${n.k}: ${JSON.stringify(n.t.stats.log.slice(-4))}`).toBe(0);
}

/** Every page holds one hash at every final tick they all hold (P2's check, every tick). */
const agree = (nodes: readonly Node[]): void => expectAgreement(nodes.map((n) => ({ t: tl(n) })), 1);

/** Every page holds one hash at every final tick from `from` on that they all hold: a late-vote
 *  repair re-finalises from the tick that flipped, and its history before it keeps the lineage it
 *  lost, whose late votes count no more (§3.2). */
function agreeFrom(nodes: readonly Node[], from: number): void {
  const ts = nodes.map(tl);
  const lo = Math.max(from, ...ts.map(oldest));
  const hi = Math.min(...ts.map((t) => t.finalTick));
  expect(hi - lo).toBeGreaterThan(W + V);
  for (let g = lo; g <= hi; g++) expect(new Set(ts.map((t) => t.hashAt(g))).size, `tick ${g}`).toBe(1);
}

/** The tick of a timeline's first lost tally, from its log, and the local tick then. */
function firstLoss(t: Timeline): { readonly g: number; readonly at: number } | null {
  const e = t.stats.log.find(([, x]) => x.startsWith('disagree '));
  return e === undefined ? null : { g: Number(e[1].slice('disagree '.length)), at: e[0] };
}

/** P3 (M3-Q1) for the one dissenter: one resync, taken from the STATE of g and done within a round
 *  trip and the spread's ticks of its start, its steps from g + 1 to the local tick that took the
 *  STATE, re-finalised and predicted (§2.8); no advance's steps over the cap; and with g, the tally
 *  that lost it v ticks after g was final. Its STATE's tick. */
function expectRepaired(n: Node, roundTripMs: number, g?: number): number {
  const s = stats(n);
  const seen = n.session.seen;
  expect([s.resyncs, s.resyncFailed, seen.states.length], `${n.id}: ${JSON.stringify(s.log.slice(0, 8))}`).toEqual([1, 0, 1]);
  const state = seen.states[0]!;
  if (g !== undefined) {
    expect(state.g).toBe(g);
    expect(seen.disagreedAt).toBe(g + W + V);
  }
  const spread = Math.ceil((state.local - state.g) / CAP);
  expect(s.resyncMs[0]!).toBeLessThanOrEqual(roundTripMs + spread * NET.tickMs + 2 * NET.timerMs);
  expect(s.maxStepsPerAdvance).toBeLessThanOrEqual(CAP);
  return state.g;
}

/** None of these resynced or disagreed. */
function expectUntouched(nodes: readonly Node[]): void {
  for (const n of nodes) expect([stats(n).resyncs, stats(n).disagree, stats(n).resyncFailed], n.id).toEqual([0, 0, 0]);
}

// --- P3 (M3-Q1) ---

describe('P3: a dissenter holds the majority’s state again within v ticks, a round trip and the spread’s ticks (M3-Q1)', () => {
  const MATCH = 'c0de5e9ac0de5e9a';
  const id = (k: number): string => personId(17, k);
  /** Links of 30 to 60 ms one way with 20 ms of jitter (design §8.3), and their longest round trip. */
  const ROUND_TRIP = 2 * (60 + 20);
  const ROOM = (seed: number): Room => new NetPump(new LoopbackNet(seed, uniform(seed * 7, 30, 60, 20)));

  /** n0 proposes and plays in pack A with the brain; the players join 200·k ms on and play, idle; and
   *  with ready, all press Ready at 2 s, so play starts about 7.2 s in. n0 verifies at 8. */
  function lobby(room: Room, packs: readonly Pack[], packSize: number, ready: boolean): Node[] {
    const net = room.net;
    const k0 = node(room, 0, id(0), { script: 'brain', verify: 8 });
    net.join(k0, 0, (now) => {
      k0.session.propose(k0.local(now), { packSize, matchMinutes: 1 }, MATCH);
      k0.session.play(packs[0]!);
    });
    const nodes = [k0];
    for (let k = 1; k < packs.length; k++) {
      const n = node(room, k, id(k));
      net.join(n, 200 * k, () => n.session.play(packs[k]!));
      nodes.push(n);
    }
    if (ready) nodes.forEach((n, k) => net.at(2000 + 50 * k, () => n.session.ready(true)));
    return nodes;
  }

  describe("roslambo's two, outvoted 3 to 1", () => {
    /** Four players at 2 a side in play; at 9 s `change` writes dissenter k's final state, so its next
     *  final tick, g, steps from it: the first it loses. */
    function spoiled(seed: number, k: number, change: (F: MatchState) => void): { nodes: Node[]; room: Room; g: number } {
      const room = ROOM(seed);
      const nodes = lobby(room, [0, 1, 0, 1], 2, true);
      let g = -1;
      room.net.at(9000, () => {
        const t = tl(nodes[k]!);
        expect(t.final.phase).toBe(IN_PLAY);
        spoil(t, change);
        g = t.finalTick + 1;
      });
      room.run(12_000);
      return { nodes, room, g };
    }

    it('a corrupted float: the dissenter loses its next final tick and takes the majority’s state back', () => {
      const { nodes, room, g } = spoiled(1, 2, (F) => void (F.terriers[0]!.x += 1e-9));
      expectRepaired(nodes[2]!, ROUND_TRIP, g);
      expectUntouched([nodes[0]!, nodes[1]!, nodes[3]!]);
      expectClean(room);
      agree(nodes);
    });

    it('a lost terrier: the dissenter that dropped one has it back, as the majority does', () => {
      const lost = id(1);
      const { nodes, room, g } = spoiled(2, 3, (F) => {
        // The terrier goes, and with it its scorers bit and any slip from its body (A.1).
        const k = findTerrier(F, lost);
        const [T] = F.terriers.splice(k, 1);
        F.scorers = (F.scorers & ((1 << k) - 1)) | ((F.scorers >>> (k + 1)) << k);
        for (const U of F.terriers) if (U.slipFrom === 2 * T!.spot + T!.pack) U.slipFrom = -1;
      });
      expectRepaired(nodes[3]!, ROUND_TRIP, g);
      expectUntouched([nodes[0]!, nodes[1]!, nodes[2]!]);
      for (const n of nodes) expect(findTerrier(finalOf(n), lost), n.id).toBeGreaterThanOrEqual(0);
      expectClean(room);
      agree(nodes);
    });
  });

  describe('late-vote flips from 2 s back, the repair spread at the cap (§2.8, §3.2)', () => {
    /** Every TICK to `to` from `from` held back 2 s once, FIFO holding the rest of each link behind it:
     *  to finalises their inputs absent and votes alone for 2 s, until the burst lands and the late
     *  votes flip its tallies. */
    function holdBack(room: Room, from: readonly string[], to: string, at: number): void {
      room.net.at(at, () => {
        for (const f of from) room.net.delayNext(f, to, isTick, 2000);
      });
    }

    /** The STATEs sent to `to` from `at` on, decoded: spies that never match (dropNext). */
    function statesTo(room: Room, from: readonly string[], to: string, at: number): StateMsg[] {
      const got: StateMsg[] = [];
      room.net.at(at, () => {
        for (const f of from) {
          room.net.dropNext(f, to, (bytes) => {
            if (bytes[0] === T.STATE) got.push(decode(bytes, P) as StateMsg);
            return false;
          });
        }
      });
      return got;
    }

    /** The dissenter's late-vote repair: flipped, from about 2 s back, spread over more than one
     *  advance at the cap, within the bound; its STATE's tick. */
    function expectLateRepair(n: Node, heldFrom: number): number {
      const s = stats(n);
      expect(s.lateVoteFlips).toBeGreaterThan(0);
      const g = expectRepaired(n, ROUND_TRIP);
      expect(n.session.seen.states[0]!.local - g).toBeGreaterThan(100);
      expect(g).toBeGreaterThanOrEqual(heldFrom);
      expect(s.spreadTicks).toBeGreaterThan(1);
      expect(s.maxStepsPerAdvance).toBe(CAP);
      return g;
    }

    it('in play: the page all of whose TICKs came 2 s late repairs from where it lost them', () => {
      const room = ROOM(3);
      const nodes = lobby(room, [0, 1, 0, 1], 2, true);
      let heldFrom = -1;
      room.net.at(9000, () => {
        heldFrom = tl(nodes[2]!).localTick;
        expect(finalOf(nodes[2]!).phase).toBe(IN_PLAY);
      });
      holdBack(room, ['n0', 'n1', 'n3'], 'n2', 9000);
      room.run(13_000);
      const g = expectLateRepair(nodes[2]!, heldFrom);
      expectUntouched([nodes[0]!, nodes[1]!, nodes[3]!]);
      expectClean(room);
      agreeFrom(nodes, g);
    });

    it('in warm-up: two joiners came in meanwhile, outside the roster of the STATE that brings their JOINs (§5.5)', () => {
      const room = ROOM(4);
      const net = room.net;
      // 3 a side; nobody Ready, so the match stays in warm-up.
      const nodes = lobby(room, [0, 1, 0], 3, false);
      let heldFrom = -1;
      net.at(4000, () => {
        heldFrom = tl(nodes[2]!).localTick;
      });
      holdBack(room, ['n0', 'n1'], 'n2', 4000);
      // The joiners never meet n2, so their TICKs reach it forwarded, on the held links.
      const joiners = [3, 4].map((k) => {
        net.block('n2', `n${k}`);
        const n = node(room, k, id(k));
        net.join(n, 4000 + 300 * (k - 2), () => n.session.play((k % 2) as Pack));
        return n;
      });
      const states = statesTo(room, ['n0', 'n1'], 'n2', 4000);
      // The burst lands at 6 s: run on while the repaired ticks are in every history.
      room.run(7500);
      expect(finalOf(nodes[0]!).phase).toBe(WARM_UP);
      const g = expectLateRepair(nodes[2]!, heldFrom);
      expectUntouched([nodes[0]!, nodes[1]!, ...joiners]);
      // The STATE from g: the joiners outside its state's roster, their JOINs in its records' ID table.
      const [state] = states;
      expect([states.length, state!.g]).toEqual([1, g]);
      for (const j of joiners) {
        const me = j.session.cfg.me;
        expect(findTerrier(state!.decoded, me), j.id).toBe(-1);
        expect(state!.inputs.some((records) => records.some((r) => r.player === me && (r.events & JOIN) !== 0)), j.id).toBe(true);
        for (const n of [...nodes, ...joiners]) expect(findTerrier(finalOf(n), me), `${j.id} on ${n.id}`).toBeGreaterThanOrEqual(0);
      }
      expectClean(room);
      agreeFrom([...nodes, ...joiners], g);
    });
  });
});

// --- §3.6 (C-10) ---

const VOTERS_MATCH = '7a07a07a07a07a07';

/** Each vote a node's TICKs to `to` carried, by tick, as sent: a spy that never matches (dropNext). */
function votesSent(room: Room, from: string, to: string): Map<number, string> {
  const votes = new Map<number, string>();
  room.net.dropNext(from, to, (bytes) => {
    if (bytes[0] === T.TICK) {
      const m = decode(bytes, P) as Tick | null;
      if (m !== null && m.voteTick !== NO_TICK) votes.set(m.voteTick, m.voteHash);
    }
    return false;
  });
  return votes;
}

describe('two voters, whose repairs mustn’t cross (§3.6, C-10)', () => {
  /** a and b at 1 a side, a with the brain, b idle, both Ready at 2 s; in play, at 9 s, one of a's
   *  TICKs to b is held 300 ms, FIFO holding those behind it, so b finalises a absent for a few ticks:
   *  the dissenter. Every link oneWay ms with 10 ms of jitter. */
  function pair(seed: number, oneWay: number): { room: Room; a: Node; b: Node; votes: { a: Map<number, string>; b: Map<number, string> } } {
    const room = new NetPump(new LoopbackNet(seed, () => ({ base: oneWay, jitter: 10 })));
    const net = room.net;
    const a = node(room, 0, personId(seed, 0), { script: 'brain', verify: 8 });
    const b = node(room, 1, personId(seed, 1));
    net.join(a, 0, (now) => {
      a.session.propose(a.local(now), { packSize: 1, matchMinutes: 1 }, VOTERS_MATCH);
      a.session.play(0);
    });
    net.join(b, 300, () => b.session.play(1));
    net.at(2000, () => a.session.ready(true));
    net.at(2050, () => b.session.ready(true));
    const votes = { a: votesSent(room, 'n0', 'n1'), b: votesSent(room, 'n1', 'n0') };
    room.run(9000);
    expect(finalOf(a).phase).toBe(IN_PLAY);
    net.delayNext('n0', 'n1', isTick, 300);
    room.run(6000);
    return { room, a, b, votes };
  }

  for (const oneWay of [30, 80]) {
    it(`at ${oneWay} ms one way: one completed resync, the dissenter's, no state adopted from it, every hash equal within P3's bound`, () => {
      // The crossing's reach: the ticks before b's ask reaches a, one fewer than the one-way delay's (§3.6).
      const reach = Math.ceil(oneWay / NET.tickMs) - 1;
      // Seeds from 1 on until three are ones the old rules lost: b loses the tie at the tick it
      // diverges, g, and its votes already sent for the ticks after would win a tie within the reach.
      const favouring: number[] = [];
      for (let seed = 1; favouring.length < 3 && seed <= 24; seed++) {
        const label = `${oneWay} ms, seed ${seed}`;
        const { room, a, b, votes } = pair(seed, oneWay);
        // Every seed: one resync, whichever lost the first tie, none failed, every hash equal after.
        expect([stats(a).resyncs + stats(b).resyncs, stats(a).resyncFailed, stats(b).resyncFailed], label).toEqual([1, 0, 0]);
        expectClean(room);
        const loss = firstLoss(tl(b));
        if (loss === null) {
          agreeFrom([a, b], firstLoss(tl(a))!.g);
          continue;
        }
        const g = loss.g;
        agreeFrom([a, b], g);
        let favours = false;
        for (let t = g + 1; t <= g + reach; t++) if (votes.b.get(t)! < votes.a.get(t)!) favours = true;
        if (!(votes.a.get(g)! < votes.b.get(g)!) || !favours) continue;
        favouring.push(seed);
        // The dissenter's resync, b's; a never lost a tally, so adopted no state of the dissenter's.
        expect([stats(b).resyncs, stats(a).resyncs, stats(a).disagree], label).toEqual([1, 0, 0]);
        // P3: b lost g's tally v ticks after g was final, and held a's state again within a round trip
        // and the spread's ticks of it.
        expect(loss.at, label).toBe(g + W + V);
        expectRepaired(b, 2 * (oneWay + 10), g);
      }
      expect(favouring.length).toBe(3);
    });
  }
});

describe('three voters (§3.6; M3 phase 4)', () => {
  /** Players at 2 a side, all Ready at 2 s, so four play from about 7.2 s and three stay in warm-up:
   *  n0 with the brain, the others idle. Links of 30 to 60 ms with 20 ms of jitter but where `links`
   *  says. */
  function trio(seed: number, players: number, links?: (a: string, b: string) => LinkSpec | null): { room: Room; nodes: Node[] } {
    const base = uniform(seed * 7, 30, 60, 20);
    const room = new NetPump(new LoopbackNet(seed, (a, b) => links?.(a, b) ?? base(a, b)));
    const net = room.net;
    const id = (k: number): string => personId(seed, k);
    const nodes = [node(room, 0, id(0), { script: 'brain', verify: 8 })];
    net.join(nodes[0]!, 0, (now) => {
      nodes[0]!.session.propose(nodes[0]!.local(now), { packSize: 2, matchMinutes: 1 }, VOTERS_MATCH);
      nodes[0]!.session.play(0);
    });
    for (let k = 1; k < players; k++) {
      // Pack B, A, B: a player that leaves is the second of pack A, holding a press from a second in.
      const n = node(room, k, id(k), k === 2 ? { controls: (s) => encodeInput({ jump: s.timeline.localTick > 60 ? 1 : 0 }) } : {});
      net.join(n, 200 * k, () => n.session.play((k % 2) as Pack));
      nodes.push(n);
    }
    nodes.forEach((n, k) => net.at(2000 + 50 * k, () => n.session.ready(true)));
    return { room, nodes };
  }

  it('a three-way split, in warm-up: the smallest hash wins, and the other two repair to it, no resync failing', () => {
    const { room, nodes } = trio(5, 3);
    const G = 600;
    // Two of the three spoiled two ways before they finalise G, each as its own final tick reaches it.
    const spoiled = new Set<Node>();
    const hashes = new Map<Node, string>();
    nodes.forEach((n, k) => {
      n.session.after = () => {
        const t = tl(n);
        if (t.finalTick === G - 1 && k > 0 && !spoiled.has(n)) {
          spoiled.add(n);
          spoil(t, (F) => void (F.terriers[0]!.x += k * 1e-9));
        }
        if (t.finalTick >= G && !hashes.has(n)) hashes.set(n, t.hashAt(G));
      };
    });
    room.run(13_000);
    expect(new Set(hashes.values()).size).toBe(3);
    const win = [...hashes.values()].sort()[0]!;
    const winner = nodes.find((n) => hashes.get(n) === win)!;
    for (const n of nodes) {
      const s = stats(n);
      expect([s.resyncs, s.resyncFailed], n.id).toEqual(n === winner ? [0, 0] : [1, 0]);
      if (n !== winner) expect(firstLoss(tl(n))!.g, n.id).toBe(G);
      expect(tl(n).hashAt(G), n.id).toBe(win);
    }
    expect(stats(winner).disagree).toBe(0);
    expectClean(room);
    agreeFrom(nodes, G);
  });

  it('a player who leaves with three voters left, its last TICKs reaching each at a different tick: no livelock, every resync completed', () => {
    // The leaver n2's links to n0, n1 and n3 a tick or so apart, no jitter, one way round and the
    // other: its last TICKs reach the three a tick apart, so they finalise three lineages.
    for (const [seed, ms] of [[1, [25, 45, 65]], [2, [25, 45, 65]], [4, [65, 45, 25]], [9, [65, 45, 25]]] as const) {
      const label = `seed ${seed}, ${ms.join('/')} ms`;
      const { room, nodes } = trio(seed, 4, (a, b) => {
        const other = a === 'n2' ? b : b === 'n2' ? a : null;
        const k = other === null ? -1 : ['n0', 'n1', 'n3'].indexOf(other);
        return k < 0 ? null : { base: ms[k]!, jitter: 0 };
      });
      const leaver = nodes[2]!;
      const voters = [nodes[0]!, nodes[1]!, nodes[3]!];
      room.net.leave(leaver, 10_000);
      room.run(10_150);
      expect(finalOf(nodes[0]!).phase, label).toBe(IN_PLAY);
      // Three lineages: each voter holds the leaver's inputs to a different last tick.
      const last = voters.map((n) => tl(n).newestInput(leaver.session.cfg.me)!.tick);
      expect(new Set(last).size, label).toBe(3);
      room.run(2850);
      // Each repair within a refused ask's retry, a round trip and the spread's ticks.
      const bound = NET.timeline.resyncRetryMs + 2 * (60 + 20) + Math.ceil((W + V + 12) / CAP) * NET.tickMs + 2 * NET.timerMs;
      for (const n of voters) {
        const s = stats(n);
        expect([s.resyncFailed, s.resyncs <= 1], `${label}: ${n.id} ${JSON.stringify(s.log.slice(0, 6))}`).toEqual([0, true]);
        for (const ms of s.resyncMs) expect(ms, `${label}: ${n.id}`).toBeLessThanOrEqual(bound);
      }
      expect(voters.filter((n) => stats(n).resyncs === 1).length, label).toBeGreaterThan(0);
      expectClean(room);
      agreeFrom(voters, Math.min(...last));
    }
  });
});

// --- P9 (D-14) ---

describe('P9: a goal shows on every peer, once, at its confirmed tick (D-14)', () => {
  const goalOf = (g: ConfirmedGoal): string => `${g.tick} ${g.pack} ${g.ownGoal} [${g.scorers.join(',')}] ${g.score.join('-')}`;
  const board = (n: Node): Board => n.session.board!;

  it('every page latches the same goals at the same ticks, none before confirmed and none twice, through a resync for a tick after the first showed', () => {
    const room = new NetPump(new LoopbackNet(19, uniform(19 * 7, 30, 60, 20)));
    const net = room.net;
    // Four players at 2 a side, pack A's two with the brain, pack B's idle; a scoreboard each.
    const packs: Pack[] = [0, 1, 0, 1];
    const nodes = packs.map((pack, k) => node(room, k, personId(19, k), { script: pack === 0 ? 'brain' : 'none', verify: k === 1 ? 8 : 0 }));
    for (const n of nodes) n.session.board = new Board();
    net.join(nodes[0]!, 0, (now) => {
      nodes[0]!.session.propose(nodes[0]!.local(now), { packSize: 2, matchMinutes: 1 }, '90a1590a1590a159');
      nodes[0]!.session.play(0);
    });
    for (const k of [1, 2, 3]) net.join(nodes[k]!, 200 * k, () => nodes[k]!.session.play(packs[k]!));
    nodes.forEach((n, k) => net.at(2000 + 50 * k, () => n.session.ready(true)));
    // Once b shows its first goal, one of d's TICKs to it is held 400 ms, FIFO holding those behind it:
    // b finalises d absent for a few ticks after the goal, loses the tally 3 to 1, and repairs.
    const [, b, , d] = nodes as [Node, Node, Node, Node];
    const held = { at: -1, shown: -1 };
    b.session.after = () => {
      if (held.at >= 0 || board(b).sb.goals.length === 0) return;
      held.at = tl(b).localTick;
      held.shown = board(b).sb.goals[0]!.tick;
      net.delayNext(d.id, b.id, isTick, 400);
    };
    // Until every page shows three goals, the last a while after b's repair.
    room.run(60_000, () => nodes.every((n) => board(n).sb.goals.length >= 3));
    expectClean(room);
    const shown = board(nodes[0]!).added.map((e) => goalOf(e.goal));
    expect(shown.length).toBeGreaterThanOrEqual(3);
    for (const n of nodes) {
      const x = board(n);
      // The same goals, at the same ticks, each once, and none withdrawn.
      expect(x.added.map((e) => goalOf(e.goal)), n.id).toEqual(shown);
      expect([x.withdrawn.length, x.changedWhileRepairing], n.id).toEqual([0, 0]);
      expect(x.sb.goals.map(goalOf), n.id).toEqual(shown);
      for (const e of x.added) {
        // Latched at the first update after its tick was confirmed here, never before: w + v at least
        // after the ball crossed (Q-7).
        expect(e.at, `${n.id} ${goalOf(e.goal)}`).toBe(e.confirmedAt);
        expect(e.finalTick - e.goal.tick, `${n.id} ${goalOf(e.goal)}`).toBeGreaterThanOrEqual(V);
      }
    }
    // Every page's goal ticks are final ticks with one hash, while the history holds them.
    const inHistory = board(nodes[0]!).added.filter((e) => e.goal.tick >= Math.max(...nodes.map((n) => oldest(tl(n)))));
    expect(inHistory.length).toBeGreaterThan(0);
    for (const e of inHistory) expect(new Set(nodes.map((n) => tl(n).hashAt(e.goal.tick))).size, goalOf(e.goal)).toBe(1);
    // b's resync was for a tick after the goal it showed, which it kept through the repair.
    const s = stats(b);
    expect([held.at > 0, s.resyncs, s.resyncFailed, b.session.seen.states.length]).toEqual([true, 1, 0, 1]);
    expect(b.session.seen.states[0]!.g).toBeGreaterThan(held.shown);
    expect(board(b).repairingUpdates).toBeGreaterThan(0);
    expectUntouched([nodes[0]!, nodes[2]!, d]);
  });
});
