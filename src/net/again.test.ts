import { describe, expect, it, vi } from 'vitest';
import { botIds, personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { REFUSAL, ROLE, T } from '../core/protocol/messages';
import { againTimelineId } from '../core/session/roster';
import { type AgainChoice, Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, findTerrier, type MatchSettings, type MatchState, type Pack, START_COUNTDOWN, WARM_UP } from '../core/sim/index';
import { expectAgreement, NetPump, TEST_BUILD } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';

// Play again at the session level (PLAN D-12, C-42, P7; M3's design,
// research/m3/DESIGN.md, §4.9, M3-Q26, §8.1), as NetGame.playAgain runs it:
// a press sends AGAIN in the old room, opens the next match's room,
// nextMatchId(previous), which this test's new room stands for, with the old
// match's choices, its pack and its bots' packs, and proposes there only if
// no AGAIN reached it in the old room, the timeline's ID againTimelineId(the
// old timeline's clock at the press, floored, and 4 random bytes); the old
// room closes leaveGraceMs later. Both rooms are one LoopbackNet, every
// pair across them blocked, so the old room's AGAINs and the new
// room's merges run in one virtual time; each page's two sessions share its
// player ID, as one browser's do. The old match needn't have ended: nothing
// of the flow reads its phase, so each old room holds its match in warm-up,
// its players in their packs. Two presses at once, and presses about a tie
// apart, 60 ticks, the earlier with the larger random part, in a full mesh
// and in a partial mesh where AGAIN doesn't reach every page: each ends as
// one match on the earlier press everywhere, nobody taking again a timeline
// it left: random IDs, as presses had before 995f206, put the room on the
// later press wherever the pages see the two as a tie (M3 phase 4). A
// full room of 8 that play and 4 spectators pressing in a race, where
// nobody is refused with REFUSE 4 (M3-Q16); players and bots whose packs are
// full; a press after an AGAIN joins without proposing; and a press after
// the new match's countdown watches. Each runs one node at verify: 8
// (design §8.3).

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const OLD_MATCH = '0123012301230123';
const id = (k: number): string => personId(47, k);
const tickMs = NET.tickMs;

/** A session as NetGame drives it (design §1.24): a gap over stallMs between timer runs is a stall. It
 *  keeps the timelines it held, in order: its own proposal's, and each it adopted. */
class GameSession extends Session {
  readonly took: string[] = [];
  private last = -1;

  override propose(now: number, settings: MatchSettings, timelineId: string): void {
    super.propose(now, settings, timelineId);
    this.took.push(timelineId);
  }

  override onMessage(peer: string, bytes: Uint8Array, now: number): void {
    const was = this.timeline;
    const started = was.started;
    super.onMessage(peer, bytes, now);
    if (this.timeline.started && (this.timeline !== was || !started)) this.took.push(this.timeline.id);
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

/** One press's proposal in the new room. */
interface Proposal {
  readonly k: number;
  readonly at: number; // virtual time
  readonly tick: number; // the old timeline's at the press
  readonly id: string;
}

/** A page's choices in the old match, as the new room's session takes them (§4.9). */
interface Choice {
  readonly pack: Pack | null; // null: it watches
  readonly bots?: readonly Pack[];
}

/** Two rooms in one network: the old one, `o<k>`, whose match holds in warm-up, and the new one,
 *  `n<k>` for the presses' pages and `x<k>` for pages that open the new room's link without having
 *  played the old match. Each pair across the two is blocked; a partial mesh blocks the same pairs in
 *  each. */
class Rooms {
  readonly room: Room;
  readonly net: LoopbackNet;
  readonly old = new Map<number, Node>();
  readonly fresh = new Map<number, Node>();
  readonly proposals: Proposal[] = [];
  private readonly settings: MatchSettings;
  private readonly rand: () => number;
  private first = true;

  /** ks: the old match's pages; open: a partial mesh's links, as 'a|b', or null for a full mesh;
   *  newcomers: the new room's other pages. */
  constructor(seed: number, ks: readonly number[], settings: MatchSettings, open: readonly string[] | null = null, newcomers: readonly number[] = []) {
    this.room = new NetPump(new LoopbackNet(seed, uniform(seed * 13 + 1, 30, 60, 20)));
    this.net = this.room.net;
    this.settings = settings;
    this.rand = mulberry32(seed * 101 + 3);
    const all = [...ks, ...newcomers];
    for (const a of ks) for (const b of all) this.net.block(`o${a}`, `n${b}`);
    for (const a of ks) for (const b of newcomers) this.net.block(`o${a}`, `x${b}`);
    if (open !== null) {
      for (const a of ks) {
        for (const b of ks) {
          if (a >= b || open.includes(`${a}|${b}`)) continue;
          this.net.block(`o${a}`, `o${b}`);
          this.net.block(`n${a}`, `n${b}`);
        }
      }
    }
  }

  /** The old match: o<first> proposes at 0, the rest join 120 ms apart; each plays in its pack or
   *  watches, and adds its bots. */
  oldMatch(choices: ReadonlyMap<number, Choice>): void {
    let i = 0;
    for (const [k, c] of choices) {
      const n = this.node(`o${k}`, k);
      this.old.set(k, n);
      const proposer = i === 0;
      this.net.join(n, 120 * i++, (now) => {
        if (proposer) n.session.propose(n.local(now), this.settings, OLD_MATCH);
        if (c.pack === null) n.session.watch();
        else n.session.play(c.pack);
        for (const b of c.bots ?? []) expect(n.session.addBot(b)).toBe(true);
      });
    }
  }

  /** Page k presses Play again at `at` (§4.9): AGAIN in the old room; the new room's session with the
   *  old match's choices, proposing with againTimelineId(the old timeline's tick at the press, 4
   *  random bytes) only if no AGAIN reached it; the old room closed leaveGraceMs later. */
  press(k: number, at: number, random?: readonly number[]): void {
    this.net.at(at, () => {
      const old = this.old.get(k)!;
      const s = old.session;
      const t = s.timeline;
      const tick = Math.floor(t.clock(old.local(this.net.now)));
      const T = t.final.terriers[findTerrier(t.final, s.cfg.me)];
      const again: AgainChoice = { pack: T?.pack ?? null, bots: s.bots.hosted.filter((b) => b.wanted).map((b) => ({ pack: b.pack })), againSeen: s.againSeen };
      s.announceAgain();
      const n = this.node(`n${k}`, k, again);
      this.fresh.set(k, n);
      const bytes = Uint8Array.from(random ?? [0, 1, 2, 3].map(() => Math.floor(this.rand() * 256)));
      this.net.join(n, this.net.now, (now) => {
        if (again.againSeen) return;
        const timeline = againTimelineId(tick, bytes);
        this.proposals.push({ k, at: this.net.now, tick, id: timeline });
        n.session.propose(n.local(now), this.settings, timeline);
      });
      this.net.leave(old, this.net.now + NET.room.leaveGraceMs);
    });
  }

  /** A page that opens the new room's link at `at` without having played the old match, and plays. */
  newcomer(k: number, at: number, pack: Pack): Node {
    const n = this.node(`x${k}`, k);
    this.fresh.set(k, n);
    this.net.join(n, at, () => n.session.play(pack));
    return n;
  }

  /** The new room's pages. */
  get pages(): Node[] {
    return [...this.fresh.values()];
  }

  /** Runs until the new room has `pages` pages, each holding one timeline, out of its warm-up, with
   *  `size` terriers in its final roster, at most ms; then a second more, for any move still on its
   *  way to show. */
  settle(ms: number, pages: number, size: number): void {
    const settled = (): boolean => {
      const ps = this.pages;
      const want = ps[0]?.session.timeline.id;
      return ps.length === pages && ps.every((n) => n.session.timeline.started && !n.session.timeline.warming && n.session.timeline.id === want && finalOf(n).terriers.length === size);
    };
    this.room.run(ms, settled);
    this.room.run(1000);
  }

  /** The proposal every page must end on: the smallest ID, which againTimelineId gives the earliest
   *  press (roster.ts's outranks, §4.9). */
  get winner(): Proposal {
    expect(this.proposals.length).toBeGreaterThan(0);
    return this.proposals.reduce((a, b) => (b.id < a.id ? b : a));
  }

  private node(nodeId: string, k: number, again?: AgainChoice): Node {
    const verify = this.first && nodeId.startsWith('n') ? 8 : 0;
    if (verify > 0) this.first = false;
    return this.net.add(
      nodeId,
      this.room.peer(
        (link, mode) => {
          const cfg: SessionConfig = {
            P, B, net: NET, me: id(k), name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, forwarding: true, mode, verify,
            ...(again !== undefined ? { again } : {}),
          };
          return new GameSession(cfg, link);
        },
        (s) => ({ t: s.timeline, host: s.bots }),
      ),
    );
  }
}

const finalOf = (n: Node): Readonly<MatchState> => n.session.timeline.final;

/** One match at the end: every page of the new room holds `want`, each the same roster, agreeing; and
 *  none took again a timeline it had left. */
function expectOne(r: Rooms, want: string, label = ''): void {
  const pages = r.pages;
  for (const n of pages) expect([n.session.timeline.started, n.session.timeline.id], `${label} ${n.id}: ${n.session.took.join(' > ')}`).toEqual([true, want]);
  for (const n of pages) expect(new Set(n.session.took).size, `${label} ${n.id}: ${n.session.took.join(' > ')}`).toBe(n.session.took.length);
  const roster = finalOf(pages[0]!).terriers.map((T) => `${T.id}:${T.pack}`).sort();
  for (const n of pages) expect(finalOf(n).terriers.map((T) => `${T.id}:${T.pack}`).sort(), `${label} ${n.id}`).toEqual(roster);
  expect(r.room.problems, label).toEqual([]);
  for (const n of r.room.nodes) expect(n.t.stats.verifyMismatches, `${label} node ${n.k}`).toBe(0);
  expectAgreement(pages.map((n) => ({ t: n.session.timeline })));
}

/** The new room's roster, as `id:pack`, sorted. */
const rosterOf = (n: Node): string[] => finalOf(n).terriers.map((T) => `${T.id}:${T.pack}`).sort();
const member = (k: number, pack: Pack): string => `${id(k)}:${pack}`;

const TWO_A_SIDE: MatchSettings = { packSize: 2, matchMinutes: 1 };
/** Five pages, 2 a side and a spectator: pages 0 and 1 the presses'. */
const FIVE = new Map<number, Choice>([[0, { pack: 0 }], [1, { pack: 1 }], [2, { pack: 0 }], [3, { pack: 1 }], [4, { pack: null }]]);
/** A partial mesh of the five where 0 and 1 never link, nor 0 and 3, nor 1 and 4, so an AGAIN of 0's
 *  never reaches 1 or 3, nor one of 1's 4; each pair shares a neighbour, as forwarding needs (P5). */
const PARTIAL = ['0|2', '0|4', '1|2', '1|3', '2|3', '2|4', '3|4'];
const PRESS_AT = 3000;

/** The five's presses: 0 at PRESS_AT, 1 `apart` ms later, its AGAIN held up past that in a full
 *  mesh, as a lost message's retransmissions would hold it, and the other three after both AGAINs
 *  have gone, so they join; each press's random part given. */
function five(seed: number, open: readonly string[] | null, apart: number, randoms: readonly (readonly number[])[]): Rooms {
  const r = new Rooms(seed, [0, 1, 2, 3, 4], TWO_A_SIDE, open);
  r.oldMatch(FIVE);
  if (open === null) r.net.at(PRESS_AT - 1, () => r.net.delayNext('o0', 'o1', (bytes) => bytes[0] === T.AGAIN, apart + 500));
  r.press(0, PRESS_AT, randoms[0]);
  r.press(1, PRESS_AT + apart, randoms[1]);
  for (const k of [2, 3, 4]) r.press(k, PRESS_AT + apart + 400 + 150 * (k - 2));
  return r;
}

const PACKS = [member(0, 0), member(1, 1), member(2, 0), member(3, 1)].sort();

describe('Play again (D-12, C-42, design §4.9)', () => {
  for (const [mesh, open] of [['a full mesh', null], ['a partial mesh', PARTIAL]] as const) {
    it(`ends two presses at once as one match on the smaller ID, in ${mesh}`, () => {
      const r = five(1, open, 0, [[0x70, 0, 0, 0], [0x10, 0, 0, 0]]);
      r.settle(PRESS_AT + 9000, 5, 4);
      expect(r.proposals.map((p) => p.k).sort()).toEqual([0, 1]);
      expectOne(r, r.winner.id, mesh);
      expect(rosterOf(r.fresh.get(0)!)).toEqual(PACKS);
      expect(r.fresh.get(4)!.session.role()).toBe(ROLE.SPECTATOR);
    });

    it(`ends presses about a tie apart, the earlier with the larger random part, as one match on the earlier press everywhere, in ${mesh}`, () => {
      // 58 to 62 ticks apart, either side of the tie, where pages' estimates of the two timelines'
      // ages fall on its edge: random IDs, the later press's the smaller, end this room on the later
      // press at every spacing up to the tie (M3 phase 4).
      for (const ticks of [58, 59, 60, 61, 62]) {
        const label = `${mesh}, ${ticks} ticks apart`;
        const r = five(2 + ticks, open, ticks * tickMs, [[0xff, 0xff, 0xff, 0xff], [0, 0, 0, 1]]);
        r.settle(PRESS_AT + 10_000, 5, 4);
        expect(r.proposals.map((p) => p.k), label).toEqual([0, 1]);
        const [early, late] = r.proposals as [Proposal, Proposal];
        expect(late.tick - early.tick, label).toBeGreaterThanOrEqual(ticks - 1);
        expect(r.winner, label).toEqual(early);
        expectOne(r, early.id, label);
        expect(rosterOf(r.fresh.get(0)!), label).toEqual(PACKS);
      }
    });
  }

  it('ends a full room of 8 that play and 4 spectators pressing in a race as one match, nobody refused with REFUSE 4 (M3-Q16)', () => {
    const players = Array.from({ length: 8 }, (_, k) => k);
    const watchers = [8, 9, 10, 11];
    const choices = new Map<number, Choice>([...players.map((k): [number, Choice] => [k, { pack: (k % 2) as Pack }]), ...watchers.map((k): [number, Choice] => [k, { pack: null }])]);
    const r = new Rooms(5, [...players, ...watchers], { packSize: 4, matchMinutes: 1 });
    r.oldMatch(choices);
    // A spectator first, 10 ms apart: the first few saw no AGAIN, and propose.
    const order = [8, 0, 1, 9, 2, 3, 10, 4, 5, 11, 6, 7];
    order.forEach((k, i) => r.press(k, PRESS_AT + 10 * i));
    r.settle(PRESS_AT + 12_000, 12, 8);
    expect(r.proposals.length).toBeGreaterThan(1);
    const news = (x: string): boolean => !x.startsWith('o');
    expect(r.net.refusals.filter((x) => news(x.from) && news(x.to))).toEqual([]);
    expectOne(r, r.winner.id);
    expect(rosterOf(r.fresh.get(0)!)).toEqual(players.map((k) => member(k, (k % 2) as Pack)).sort());
    for (const k of watchers) {
      const s = r.fresh.get(k)!.session;
      expect([s.role(), s.spectatorsFull], `n${k}`).toEqual([ROLE.SPECTATOR, false]);
    }
    for (const n of r.pages) expect(n.session.peerCount(), n.id).toBe(11);
    expect(r.net.refusals.some((x) => x.reason === REFUSAL.SPECTATORS_FULL)).toBe(false);
  });

  it('puts a player and its bot in the other pack when their own is full, and leaves them watching and out when both are (D-12)', () => {
    // The old match, 3 a side: 0 in pack A with a bot there, 1 and 2 in pack B. 1 presses first and
    // proposes; three newcomers fill pack A before 0 presses. Pack B keeps 1 alone, or, with 2's press
    // and a fourth newcomer, is full too.
    for (const both of [false, true]) {
      const label = both ? 'both full' : 'its own full';
      const r = new Rooms(7 + (both ? 1 : 0), [0, 1, 2], { packSize: 3, matchMinutes: 1 }, null, [20, 21, 22, 23]);
      r.oldMatch(new Map<number, Choice>([[0, { pack: 0, bots: [0] }], [1, { pack: 1 }], [2, { pack: 1 }]]));
      r.press(1, PRESS_AT);
      [20, 21, 22].forEach((k, i) => r.newcomer(k, PRESS_AT + 500 + 150 * i, 0));
      if (both) {
        r.press(2, PRESS_AT + 300);
        r.newcomer(23, PRESS_AT + 950, 1);
      }
      r.press(0, PRESS_AT + 3000);
      r.settle(PRESS_AT + 9000, both ? 7 : 5, 6);
      expectOne(r, r.proposals[0]!.id, label);
      const host = r.fresh.get(0)!.session;
      const bot = botIds(id(0))[0]!;
      const packA = [member(20, 0), member(21, 0), member(22, 0)];
      if (both) {
        expect(rosterOf(r.fresh.get(1)!), label).toEqual([...packA, member(1, 1), member(2, 1), member(23, 1)].sort());
        expect([host.role(), host.refused, host.hostedBots(), host.inRoster()], label).toEqual([ROLE.SPECTATOR, 'full', [], false]);
      } else {
        expect(rosterOf(r.fresh.get(1)!), label).toEqual([...packA, member(1, 1), member(0, 1), `${bot}:1`].sort());
        expect([host.role(), host.refused, host.hostedBots(), host.inRoster()], label).toEqual([ROLE.PLAYER, null, [bot], true]);
      }
    }
  });

  it('joins a press after an AGAIN without proposing, so the room holds one match from the first press on (M3-Q26)', () => {
    const r = new Rooms(9, [0, 1, 2], TWO_A_SIDE);
    r.oldMatch(new Map<number, Choice>([[0, { pack: 0 }], [1, { pack: 1 }], [2, { pack: 0 }]]));
    r.press(0, PRESS_AT);
    r.press(1, PRESS_AT + 1000);
    r.press(2, PRESS_AT + 1500);
    r.settle(PRESS_AT + 6000, 3, 3);
    expect(r.proposals.map((p) => p.k)).toEqual([0]);
    expectOne(r, r.proposals[0]!.id);
    // Each page held that match alone, from its first STATE on.
    for (const n of r.pages) expect(n.session.took, n.id).toEqual([r.proposals[0]!.id]);
    expect(rosterOf(r.fresh.get(0)!)).toEqual([member(0, 0), member(1, 1), member(2, 0)].sort());
  });

  it("watches a press of a player that comes after the new match's countdown began, with the note (D-12, §4.9)", () => {
    // 2 a side: 0, 1 and 3 press and play, and a newcomer takes pack A's other place; all press Ready.
    // 2, which played in pack A, presses once the new match's start countdown has begun.
    const r = new Rooms(10, [0, 1, 2, 3], TWO_A_SIDE, null, [20]);
    r.oldMatch(new Map<number, Choice>([[0, { pack: 0 }], [1, { pack: 1 }], [2, { pack: 0 }], [3, { pack: 1 }]]));
    r.press(0, PRESS_AT);
    r.press(1, PRESS_AT + 300);
    r.press(3, PRESS_AT + 450);
    r.newcomer(20, PRESS_AT + 600, 0);
    for (const k of [0, 1, 3, 20]) r.net.at(PRESS_AT + 2000, () => r.fresh.get(k)!.session.ready(true));
    let late = -1;
    const look = (): void => {
      if (finalOf(r.fresh.get(0)!).phase === START_COUNTDOWN) {
        late = r.net.now;
        r.press(2, late + 200);
      } else r.net.at(r.net.now + 50, look);
    };
    r.net.at(PRESS_AT + 2000, look);
    r.settle(PRESS_AT + 9000, 5, 4);
    expect(late).toBeGreaterThan(0);
    expect(r.proposals.map((p) => p.k)).toEqual([0]);
    expectOne(r, r.proposals[0]!.id);
    const s = r.fresh.get(2)!.session;
    expect([s.role(), s.refused, s.inRoster(), s.timeline.sending]).toEqual([ROLE.SPECTATOR, 'started', false, false]);
    expect(finalOf(r.fresh.get(2)!).phase).not.toBe(WARM_UP);
    expect(rosterOf(r.fresh.get(0)!)).toEqual([member(0, 0), member(20, 0), member(1, 1), member(3, 1)].sort());
  });
});
