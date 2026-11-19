import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type AgainChoice, Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, type MatchState, type Pack } from '../core/sim/index';
import { expectAgreement, NetPump, TEST_BUILD, twin } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';

// A Play-again race around a ring (P7's peer side, D-12; M3 phase 4's
// fixes; M3's design, research/m3/DESIGN.md, §4.9, §5.4, §8.1): presses
// that each saw no AGAIN propose there, and the pages that saw one join
// whichever match they find first, so pages that met before either held a
// timeline hold different ones and must weigh each other's in PEERS, which
// now carries the timeline its sender holds. Three presses a tick apart
// around a ring of five; races.test.ts has two presses two ticks apart
// whose halves meet through two pages. Every mesh gives each pair a link or
// a common neighbour, as forwarding needs (P5). Every test ends as one
// timeline, every player in its pack, one node verifying its chain: the
// race run twice, incrementally and as a full replay (design §2.7), which
// the old code fails, and then over more seeds, each as a full replay too,
// twin comparing the runs at their common ticks, ending on the press with
// the smallest ID, the presses being a tie (outranks), each page moving
// only to better timelines, never back to one it left, with no
// disagreement, where the first fix's frozen announcements swapped pages to
// and fro and ended some on the younger press, or split (M3 phase 4's
// review, protocol-F1): seed 3 here, and 7, 11, 12, 29 and 40 in
// ring-seeds and ring-more.test.ts, run only incrementally until M3 phase
// 4's integration.

vi.setConfig({ testTimeout: 120_000 });

/** The seeds the ring plays over, each as a full replay too: here 3, and in ring-seeds and
 *  ring-more.test.ts the rest, split for design §13's 8 s a file. */
const SEEDS = [3];

const NET = netSettings();
const SEED = 21;
const id = (k: number): string => personId(SEED, k);
/** A timeline ID of one hex digit sixteen times: the smaller digit is the smaller ID. */
const tl = (c: string): string => c.repeat(16);

/** A session as NetGame drives it (design §1.24): a gap over stallMs between timer runs is a stall. */
class GameSession extends Session {
  /** The timelines it took, in order. */
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

/** Page k, its own input idle; a Play again's choices if it has them. */
function node(room: Room, k: number, o: { verify?: number; again?: AgainChoice } = {}): Node {
  return room.net.add(
    `n${k}`,
    room.peer(
      (link, mode) => {
        const cfg: SessionConfig = {
          P: defaultParams, B: defaultBotParams, net: NET, me: id(k), name: `P${k}`, coat: k % defaultParams.coatCount, build: TEST_BUILD,
          forwarding: true, mode, verify: o.verify ?? 0, ...(o.again ? { again: o.again } : {}),
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

/** One timeline at the end: every node holds `want`, its roster each player in its pack, and agrees. */
function expectOne(room: Room, ks: readonly number[], want: string, packs: ReadonlyMap<number, Pack>): void {
  const nodes = ks.map((k) => nodeOf(room, k));
  for (const n of nodes) expect([n.session.timeline.started, n.session.timeline.id], n.id).toEqual([true, want]);
  const roster = new Map(finalOf(nodes[0]!).terriers.map((T) => [T.id, T.pack]));
  expect(Object.fromEntries(roster)).toEqual(Object.fromEntries([...packs].map(([k, p]) => [id(k), p])));
  for (const n of nodes) expect(finalOf(n).terriers.map((T) => `${T.id}:${T.pack}`).sort(), n.id).toEqual([...roster].map(([i, p]) => `${i}:${p}`).sort());
  expectAgreement(nodes.map((n) => ({ t: n.session.timeline })));
}

describe('P7: a Play-again race around a ring (M3 phase 4, P7, D-12, §4.9)', () => {
  /** A Play again's choices: its old pack, no bots, and whether an AGAIN reached it, when it joins. */
  const again = (pack: Pack, seen: boolean): AgainChoice => ({ pack, bots: [], againSeen: seen });

  /** Each of ks joins at its time and proposes its timeline if no AGAIN reached it, as NetGame's
   *  Play again does (design §4.9). */
  function race(room: Room, ks: readonly number[], packs: ReadonlyMap<number, Pack>, presses: ReadonlyMap<number, [number, string]>, others: number): void {
    const nodes = ks.map((k) => node(room, k, { verify: k === 0 ? 8 : 0, again: again(packs.get(k)!, !presses.has(k)) }));
    for (const k of ks) {
      const n = nodes[k]!;
      const press = presses.get(k);
      room.net.join(n, press?.[0] ?? others, (now) => {
        if (press !== undefined) n.session.propose(n.local(now), { packSize: 3, matchMinutes: 1 }, tl(press[1]));
      });
    }
  }

  /** One timeline at the end, one of the presses', whichever: every node holds the first node's. */
  function onOne(room: Room, ks: readonly number[], packs: ReadonlyMap<number, Pack>, presses: ReadonlyMap<number, [number, string]>): void {
    const held = nodeOf(room, ks[0]!).session.timeline.id;
    expect([...presses.values()].map(([, t]) => tl(t))).toContain(held);
    expectOne(room, ks, held, packs);
  }

  it('ends three presses a tick apart around a ring of five, each page linked to its two neighbours alone, as one match', () => {
    const ks = [0, 1, 2, 3, 4];
    const packs = new Map(ks.map((k): [number, Pack] => [k, (k % 2) as Pack]));
    const presses = new Map<number, [number, string]>([[0, [0, '1']], [2, [17, '2']], [4, [34, '3']]]);
    const run = twin(ROOM(35), (room) => {
      race(room, ks, packs, presses, 10);
      blockAllBut(room, ks, ks.map((k) => [k, (k + 1) % 5].sort().map((x) => `n${x}`).join('|')));
      room.run(9000);
    });
    onOne(run, ks, packs, presses);
  });

  /** The race's mesh and presses, as above. */
  const RING = {
    ks: [0, 1, 2, 3, 4],
    packs: new Map([0, 1, 2, 3, 4].map((k): [number, Pack] => [k, (k % 2) as Pack])),
    presses: new Map<number, [number, string]>([[0, [0, '1']], [2, [17, '2']], [4, [34, '3']]]),
    open: [0, 1, 2, 3, 4].map((k) => [k, (k + 1) % 5].sort().map((x) => `n${x}`).join('|')),
  };

  for (const seed of SEEDS) {
    it(`ends the ring on the press with the smallest ID at seed ${seed}, run as a full replay too, each page moving on only to a better timeline, with no disagreement`, () => {
      const r = RING;
      const room = twin(ROOM(seed), (x) => {
        race(x, r.ks, r.packs, r.presses, 10);
        blockAllBut(x, r.ks, r.open);
        x.run(9000);
      });
      const label = `ring, seed ${seed}`;
      const want = tl([...r.presses.values()].map(([, t]) => t).sort()[0]!);
      expectOne(room, r.ks, want, r.packs);
      for (const k of r.ks) {
        const n = nodeOf(room, k);
        const took = n.session.took;
        expect(new Set(took).size, `${label}: n${k} ${took.map((x) => x[0]).join('>')}`).toBe(took.length);
        expect(took.length, `${label}: n${k}`).toBeLessThanOrEqual(r.presses.size);
        const s = n.session.timeline.stats;
        expect([s.disagree, s.resyncFailed, s.verifyMismatches], `${label}: n${k} ${JSON.stringify(s.log.slice(0, 6))}`).toEqual([0, 0, 0]);
      }
    });
  }
});
