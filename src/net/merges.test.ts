import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, type MatchState, type Pack } from '../core/sim/index';
import { expectAgreement, NetPump, TEST_BUILD, twin } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';

// Merges that reach pages through others (P7's peer side; M3 phase 4's
// fixes; M3's design, research/m3/DESIGN.md, §4.9, §4.10, §5.4, §8.1): a
// page that adopts a better timeline in a merge now says so in PEERS, which
// carries the timeline it holds, and each side weighs a peer's latest
// announcement, its HELLO's or a later PEERS', the timeline's age at one
// moment, so every page ranks two timelines alike. Before, a page that met
// only pages that had moved on held their stale HELLOs and stayed split for
// good. Three timelines met one after another, the last page reaching only
// the page that adopted the best one; and four in a diamond whose links
// open one by one, and all at once: the old code fails each. And the rule's
// tie: four Play-again timelines within half stallMs of each other in a
// partial mesh, the oldest with the largest ID, end on the smallest ID with
// each page moving once, where the builder's first rule swapped pages
// between timelines a hundred times; and of two timelines further apart the
// older wins, whatever their IDs. races.test.ts has the Play-again races,
// announce.test.ts the announcements' rules. Every mesh gives each pair a
// link or a common neighbour, as forwarding needs (P5). Every test ends as
// one timeline, every player in its pack, one node verifying its chain, the
// first three run twice, incrementally and as a full replay (design §2.7).

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const SEED = 21;
const id = (k: number): string => personId(SEED, k);
/** A timeline ID of one hex digit sixteen times: the smaller digit is the smaller ID. */
const tl = (c: string): string => c.repeat(16);

/** A session as NetGame drives it (design §1.24): a gap over stallMs between timer runs is a stall. It
 *  keeps the timelines it adopted, in order. */
class GameSession extends Session {
  readonly took: string[] = [];
  private last = -1;

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

/** Page k, its own input idle. */
function node(room: Room, k: number, o: { verify?: number } = {}): Node {
  return room.net.add(
    `n${k}`,
    room.peer(
      (link, mode) => {
        const cfg: SessionConfig = {
          P: defaultParams, B: defaultBotParams, net: NET, me: id(k), name: `P${k}`, coat: k % defaultParams.coatCount, build: TEST_BUILD,
          forwarding: true, mode, verify: o.verify ?? 0,
        };
        return new GameSession(cfg, link);
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
  );
}

const ROOM = (seed: number) => (mode: 'incremental' | 'fullReplay'): Room => new NetPump(new LoopbackNet(seed, uniform(seed * 3, 30, 60, 10)), { mode });
const nodeOf = (room: Room, k: number): Node => room.net.nodes.get(`n${k}`) as Node;
const finalOf = (n: Node): Readonly<MatchState> => n.session.timeline.final;

/** Every pair of these nodes' IDs blocked but the given ones, written n<k>|n<j>. */
function blockAllBut(room: Room, ks: readonly number[], open: readonly string[]): void {
  for (const a of ks) for (const b of ks) if (a < b && !open.includes(`n${a}|n${b}`)) room.net.block(`n${a}`, `n${b}`);
}

/** k proposes timeline `t` at `at`, 1 minute, playing in `pack`. */
function proposes(room: Room, n: Node, at: number, t: string, pack: Pack, packSize: number): void {
  room.net.join(n, at, (now) => {
    n.session.propose(n.local(now), { packSize, matchMinutes: 1 }, t);
    n.session.play(pack);
  });
}

/** One timeline at the end: every node holds `want`, its roster each player in its pack, and agrees. */
function expectOne(room: Room, ks: readonly number[], want: string, packs: ReadonlyMap<number, Pack>): void {
  const nodes = ks.map((k) => nodeOf(room, k));
  for (const n of nodes) expect([n.session.timeline.started, n.session.timeline.id], n.id).toEqual([true, want]);
  const roster = new Map(finalOf(nodes[0]!).terriers.map((T) => [T.id, T.pack]));
  expect(Object.fromEntries(roster)).toEqual(Object.fromEntries([...packs].map(([k, p]) => [id(k), p])));
  for (const n of nodes) expect(finalOf(n).terriers.map((T) => `${T.id}:${T.pack}`).sort(), n.id).toEqual([...roster].map(([i, p]) => `${i}:${p}`).sort());
  expectAgreement(nodes.map((n) => ({ t: n.session.timeline })));
}

describe('P7: pages that meet only pages that moved on (M3 phase 4, P7)', () => {
  it('follows a better timeline through the page that adopted it: three timelines met one after another, the last page reaching one page only', () => {
    // a's timeline is the oldest, then b's, then c's; e joins c's, from its proposer d, the one page it
    // ever reaches. d meets b's proposer c at 3 s: b's beats c's, and d moves to b's, which e hears of
    // only in d's PEERS. a meets c and d at 5 s: a's beats b's, and e hears of it only from d again.
    const ks = [0, 1, 2, 3];
    const run = twin(ROOM(31), (room) => {
      const [a, c, d, e] = [node(room, 0, { verify: 8 }), node(room, 1), node(room, 2), node(room, 3)];
      blockAllBut(room, ks, ['n2|n3']);
      proposes(room, a, 0, tl('a'), 0, 2);
      proposes(room, c, 500, tl('b'), 1, 2);
      proposes(room, d, 1000, tl('c'), 0, 2);
      room.net.join(e, 1200, () => e.session.play(1));
      room.net.at(2500, () => {
        expect([a, c, d, e].map((n) => n.session.timeline.id)).toEqual([tl('a'), tl('b'), tl('c'), tl('c')]);
      });
      room.net.at(3000, () => room.net.unblock('n1', 'n2'));
      room.net.at(4800, () => {
        // e moved to b's through d, whose PEERS told it of the change.
        expect([d, e].map((n) => n.session.timeline.id)).toEqual([tl('b'), tl('b')]);
      });
      room.net.at(5000, () => {
        room.net.unblock('n0', 'n1');
        room.net.unblock('n0', 'n2');
      });
      room.run(9000);
    });
    expectOne(run, ks, tl('a'), new Map<number, Pack>([[0, 0], [1, 1], [2, 0], [3, 1]]));
    expect(nodeOf(run, 3).session.peerCount()).toBe(1);
  });

  // A diamond of four proposers, the oldest timeline first: a's, b's, c's, d's. a and d never link,
  // nor b and c; each pair of those shares two neighbours.
  const DIAMOND = ['n0|n1', 'n0|n2', 'n1|n3', 'n2|n3'];
  const diamond = (room: Room, open: (room: Room) => void): void => {
    const nodes = [0, 1, 2, 3].map((k) => node(room, k, k === 0 ? { verify: 8 } : {}));
    blockAllBut(room, [0, 1, 2, 3], []);
    ['a', 'b', 'c', 'd'].forEach((t, k) => proposes(room, nodes[k]!, 600 * k, tl(t), (k % 2) as Pack, 2));
    open(room);
  };

  it('ends four timelines in a diamond as the best, its links opening by turns, the far pages reaching only pages that moved on', () => {
    // d meets b and c at 3 s, and moves to b's; c, which reaches b only through d, hears of it in d's
    // PEERS, and follows. a meets b and c at 5 s: both move to a's, and d, which never reaches a, hears
    // of it only in their PEERS.
    const run = twin(ROOM(32), (room) => {
      diamond(room, (r) => {
        r.net.at(3000, () => {
          r.net.unblock('n1', 'n3');
          r.net.unblock('n2', 'n3');
        });
        r.net.at(4800, () => expect([1, 2, 3].map((k) => nodeOf(r, k).session.timeline.id)).toEqual([tl('b'), tl('b'), tl('b')]));
        r.net.at(5000, () => {
          r.net.unblock('n0', 'n1');
          r.net.unblock('n0', 'n2');
        });
      });
      room.run(9000);
    });
    expectOne(run, [0, 1, 2, 3], tl('a'), new Map<number, Pack>([[0, 0], [1, 1], [2, 0], [3, 1]]));
    expect(run.net.drops).toEqual([]);
  });

  it('ends four timelines in a diamond as the best when its links all open at once', () => {
    const run = twin(ROOM(33), (room) => {
      diamond(room, (r) => r.net.at(3000, () => {
        for (const pair of DIAMOND) r.net.unblock(...(pair.split('|') as [string, string]));
      }));
      room.run(9000);
    });
    expectOne(run, [0, 1, 2, 3], tl('a'), new Map<number, Pack>([[0, 0], [1, 1], [2, 0], [3, 1]]));
  });
});

describe("P7's rank: the older timeline, and a tie within half stallMs (M3 phase 4, Q-7, §4.9)", () => {
  /** Each page moved at most `most` times, never back to a timeline it left, and, if `clean`, saw no
   *  disagreement. */
  function expectSettled(room: Room, ks: readonly number[], most: number, clean: boolean): void {
    for (const k of ks) {
      const n = nodeOf(room, k);
      const took = n.session.took;
      expect(took.length, `${n.id}: ${took.map((x) => x[0]).join('>')}`).toBeLessThanOrEqual(most);
      expect(new Set(took).size, n.id).toBe(took.length);
      const s = n.session.timeline.stats;
      expect(s.verifyMismatches, n.id).toBe(0);
      if (clean) expect([s.disagree, s.resyncFailed], `${n.id} ${JSON.stringify(s.log.slice(0, 12))}`).toEqual([0, 0]);
    }
    expect(room.problems).toEqual([]);
  }

  it('ends four Play-again timelines within half stallMs of each other, the oldest with the largest ID, on the smallest ID, each page moving once', () => {
    // Seven pages in a partial mesh, eight of its links opening late; the presses 32–52 ms apart, d's
    // the oldest. Every page ranks them alike, so each moves at most once. A FWD's two hops here can
    // take longer than w, so some inputs come late and pages repair, one timeline or four alike.
    const room: Room = new NetPump(new LoopbackNet(40, uniform(121, 30, 90, 15)));
    const N = 7;
    const ks = Array.from({ length: N }, (_, k) => k);
    const edges = ['0|1', '0|2', '0|3', '0|4', '0|5', '0|6', '1|2', '1|5', '2|4', '2|5', '2|6', '3|4', '3|5', '4|6', '5|6'];
    const late: [string, number][] = [['0|1', 3112], ['0|3', 4916], ['0|6', 2987], ['1|5', 3362], ['2|5', 1838], ['3|4', 1619], ['3|5', 3071], ['4|6', 5248]];
    const nodes = ks.map((k) => node(room, k, k === 0 ? { verify: 8 } : {}));
    blockAllBut(room, ks, edges.map((e) => e.split('|').map((x) => `n${x}`).join('|')));
    for (const [e, at] of late) {
      const [a, b] = e.split('|').map((x) => `n${x}`) as [string, string];
      room.net.block(a, b);
      room.net.at(at, () => room.net.unblock(a, b));
    }
    for (const [k, t, at] of [[3, 'd', 56], [2, 'c', 88], [5, 'b', 140], [0, 'a', 172]] as const) proposes(room, nodes[k]!, at, tl(t), (k % 2) as Pack, 4);
    for (const [k, at] of [[1, 1087], [4, 185], [6, 722]] as const) room.net.join(nodes[k]!, at, () => nodes[k]!.session.play((k % 2) as Pack));
    room.run(9000);
    expectOne(room, ks, tl('a'), new Map(ks.map((k): [number, Pack] => [k, (k % 2) as Pack])));
    // A joiner joins the winner at once, or its first timeline and then the winner.
    expectSettled(room, ks, 2, false);
    for (const k of [0, 2, 3, 5]) expect(nodeOf(room, k).session.took.length, `n${k}`).toBeLessThanOrEqual(1);
  });

  it('keeps the older of two timelines more than half stallMs apart, though its ID is the larger', () => {
    // b's timeline is 1.5 s older than a's; each side has a joiner, and the halves meet at 3.5 s.
    const room: Room = new NetPump(new LoopbackNet(42, uniform(126, 30, 60, 10)));
    const ks = [0, 1, 2, 3];
    const nodes = ks.map((k) => node(room, k, k === 0 ? { verify: 8 } : {}));
    blockAllBut(room, ks, ['n0|n1', 'n2|n3']);
    proposes(room, nodes[0]!, 0, tl('b'), 0, 2);
    room.net.join(nodes[1]!, 300, () => nodes[1]!.session.play(1));
    proposes(room, nodes[2]!, 1500, tl('a'), 0, 2);
    room.net.join(nodes[3]!, 1800, () => nodes[3]!.session.play(1));
    room.net.at(3500, () => {
      room.net.unblock('n0', 'n2');
      room.net.unblock('n1', 'n3');
    });
    room.run(8000);
    expectOne(room, ks, tl('b'), new Map<number, Pack>([[0, 0], [1, 1], [2, 0], [3, 1]]));
    expectSettled(room, ks, 2, true);
    expect(nodeOf(room, 0).session.took).toEqual([]);
  });
});
