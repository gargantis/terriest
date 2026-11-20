// Test support for the backlog and round-trip tests (M3's design,
// research/m3/DESIGN.md, §1.6, §4.10, §4.12; M3 phase 5a, harness-F1 and
// clock-F1): pages over the loopback as stalls.test.ts plays them, NetGame's
// stall rule included, a page frozen or its incoming messages held, and
// what the tests count: the connections closed, each page's clock jumps and
// its own final ticks without its input. Page 0 proposes and plays pack A,
// the others join 200 ms apart and play the packs in turn, and every page
// presses Ready once all have joined; each plays the brain's script, and
// page 0 verifies its chain at 8 (design §8.3). And M3 phase 5b's runs: a
// page cut off from the room, a joiner held as it enters and a partition,
// in a full mesh or a partial one, each in warm-up, then one match. Only
// tests import it, so no build bundles it.

import { expect } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { scriptSampler } from '../core/bot/setups';
import type { Link } from '../core/session/room-peer';
import { Session } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, IN_PLAY, type MatchState, type Pack, WARM_UP } from '../core/sim/index';
import { expectAgreement, NetPump, sharedHashes, TEST_BUILD } from '../core/timeline/testing';
import type { Timeline } from '../core/timeline/timeline';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32, type ThawOrder } from './loopback';

export const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const MATCH = '5a1e5a1e5a1e5a1e'; // not a setting: a timeline ID
const JOIN_EVERY_MS = 200; // not a setting: the lobby's pace, stalls.test.ts's
const READY_AT_MS = 2000; // not a setting: Ready this long after the last page joined
const CHECK_MS = 1500; // not a setting: after a release, every page agreeing this long (settle)

/** A thawing page's late timer run first, as the loopback's default, or the messages held for it first:
 *  a browser may run a woken page's tasks either way (M3 phase 5). */
export const THAWS = ['timer', 'messages'] as const satisfies readonly ThawOrder[];

/** A session as NetGame drives it (design §1.24): a gap over stallMs between timer runs is a stall. */
export class GameSession extends Session {
  stalls = 0;
  private last = -1;

  override advance(now: number): void {
    if (this.last >= 0 && now - this.last > this.cfg.net.stallMs) {
      this.stalls++;
      this.stalled(now);
    }
    this.last = now;
    super.advance(now);
  }
}

export type Node = LoopNode<GameSession>;

/** Links of lo to hi ms one way, each pair's drawn once from the seed, with this much jitter. */
export function uniform(seed: number, lo: number, hi: number, jitter: number): (a: string, b: string, now: number) => LinkSpec {
  const r = mulberry32(seed);
  const memo = new Map<string, number>();
  return (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!memo.has(k)) memo.set(k, lo + r() * (hi - lo));
    return { base: memo.get(k)!, jitter };
  };
}

export interface RigOptions {
  readonly seed: number;
  readonly packSize: number;
  readonly thaw?: ThawOrder;
  /** The links, by default 30 to 60 ms one way with 20 ms of jitter, from the seed. */
  readonly latency?: (a: string, b: string, now: number) => LinkSpec;
  /** Pairs of pages that can't connect, by index. */
  readonly blocked?: readonly (readonly [number, number])[];
  readonly matchMinutes?: number;
  /** Page k's link as a test changes what it sends: a rogue's (M3 phase 5b). */
  readonly link?: (k: number, link: Link) => Link;
}

/** 2·packSize pages in a room, on to play (above). */
export class Rig {
  readonly room: NetPump<LoopbackNet>;
  readonly net: LoopbackNet;
  readonly nodes: Node[] = [];
  private readonly linkOf: ((k: number, link: Link) => Link) | undefined;

  constructor(o: RigOptions) {
    this.linkOf = o.link;
    this.net = new LoopbackNet(o.seed, o.latency ?? uniform(o.seed * 5, 30, 60, 20), { thaw: o.thaw ?? 'timer' });
    this.room = new NetPump(this.net);
    const n = 2 * o.packSize;
    for (let k = 0; k < n; k++) this.nodes.push(this.add(k));
    for (const [a, b] of o.blocked ?? []) this.net.block(`n${a}`, `n${b}`);
    const first = this.nodes[0]!;
    this.net.join(first, 0, (now) => {
      first.session.propose(first.local(now), { packSize: o.packSize, matchMinutes: o.matchMinutes ?? 1 }, MATCH);
      first.session.play(0);
    });
    for (let k = 1; k < n; k++) this.net.join(this.nodes[k]!, JOIN_EVERY_MS * k, () => this.nodes[k]!.session.play((k % 2) as Pack));
    this.nodes.forEach((x, k) => this.net.at(READY_AT_MS + JOIN_EVERY_MS * n + 50 * k, () => x.session.ready(true)));
  }

  private add(k: number): Node {
    return this.page(`n${k}`, personId(23, k), k, (link) => this.linkOf?.(k, link) ?? link);
  }

  /** A page as the rig's, as page k's but for its player ID and its link, not yet in the room: one a test
   *  adds (M3 phase 5b). */
  page(id: string, me: string, k: number, wrap: (link: Link) => Link = (link) => link): Node {
    return this.net.add(
      id,
      this.room.peer(
        (link, mode) => {
          const s = new GameSession({ P, B, net: NET, me, name: `P${k}`, coat: k, build: TEST_BUILD, forwarding: true, mode, verify: k === 0 ? 8 : 0 }, wrap(link));
          let sample = scriptSampler('brain', me, 0, P, B);
          s.controls = () => sample(s.timeline.head, s.timeline.headTick);
          s.onControl = (base) => {
            sample = scriptSampler('brain', me, base, P, B);
          };
          return s;
        },
        (s) => ({ t: s.timeline, host: s.bots }),
      ),
    );
  }

  runTo(t: number): void {
    this.room.run(t - this.net.now);
  }

  /** Page k frozen from `at` for ms, then thawed in the network's order. */
  freeze(k: number, at: number, ms: number): void {
    this.net.pace(this.nodes[k]!, at, Infinity);
    this.net.pace(this.nodes[k]!, at + ms, NET.timerMs);
  }

  /** From `at`, every message to page k from each page of `from`, all but k by default, waits ms more,
   *  and FIFO holds what follows it behind it: those links stall, and their backlog lands at once. */
  hold(k: number, at: number, ms: number, from?: readonly number[]): void {
    const to = this.nodes[k]!.id;
    const senders = from ?? this.nodes.map((_, j) => j).filter((j) => j !== k);
    this.net.at(at, () => {
      for (const j of senders) this.net.delayNext(this.nodes[j]!.id, to, () => true, ms);
    });
  }

  /** From `at`, every message between pages [0, half) and the rest waits ms more, both ways: a
   *  partition, whose backlogs land at once (M3 phase 5b). */
  partition(half: number, at: number, ms: number): void {
    const a = this.nodes.map((_, j) => j).filter((j) => j < half);
    const b = this.nodes.map((_, j) => j).filter((j) => j >= half);
    for (const k of a) this.hold(k, at, ms, b);
    for (const k of b) this.hold(k, at, ms, a);
  }

  /** One match, and nothing closed (M3 phase 5b): every page's final roster holds every page's
   *  player, every page holds one hash at each final tick they share from `from` on, no connection
   *  closed, the drawn head's contract held everywhere, and the verifying page's chain matched a full
   *  replay. */
  expectOneMatch(label: string, from = 0): void {
    const ids = this.nodes.map((x) => x.session.cfg.me).sort();
    for (const [k, x] of this.nodes.entries()) {
      expect(x.session.timeline.final.terriers.map((T) => T.id).sort(), `${label}: page ${k}'s roster`).toEqual(ids);
    }
    expect(this.closed(), label).toEqual({ sessions: this.nodes.map(() => []), transport: [] });
    expect(this.room.problems, label).toEqual([]);
    for (const x of this.room.nodes) expect(x.t.stats.verifyMismatches, `${label}: page ${x.k}`).toBe(0);
    const shared = sharedHashes(this.nodes.map((x) => ({ t: x.session.timeline })), 1).filter((s) => s.tick >= from);
    expect(shared.length, label).toBeGreaterThan(0);
    for (const s of shared) expect(new Set(s.hashes).size, `${label}: tick ${s.tick}`).toBe(1);
  }

  /** Holds released at `release` settle (M3 phase 5b): run settleMs past it, then CHECK_MS more, one
   *  match from then on, with no page repairing at the end. */
  settle(label: string, release: number, settleMs: number): void {
    this.runTo(release + settleMs + CHECK_MS);
    const all = `${label}: ${this.logs()}`;
    this.expectOneMatch(all, Math.ceil((release + settleMs) / NET.tickMs));
    for (const x of this.nodes) expect(x.session.timeline.repairing, all).toBe(false);
  }

  /** From now on, each page's clock jumps and its own final ticks with no input of its own, whatever
   *  timeline it holds, read every 10 ms. */
  watch(): () => { readonly jumps: number[]; readonly ownAbsent: number[] } {
    const nodes = this.nodes;
    const held: Timeline[] = nodes.map((x) => x.session.timeline);
    const jumps0 = held.map((t) => t.stats.jumps);
    const jumps = nodes.map(() => 0);
    const absent = nodes.map(() => 0);
    const last = held.map((t) => t.finalTick);
    const look = (): void => {
      nodes.forEach((x, k) => {
        const t = x.session.timeline;
        if (t !== held[k]) {
          jumps[k]! += held[k]!.stats.jumps - jumps0[k]!;
          held[k] = t;
          jumps0[k] = t.stats.jumps;
          last[k] = t.finalTick;
        }
        for (let u = last[k]! + 1; u <= t.finalTick; u++) if (t.receivedInput(x.session.cfg.me, u) === undefined) absent[k]!++;
        last[k] = Math.max(last[k]!, t.finalTick);
      });
      this.net.at(this.net.now + 10, look);
    };
    look();
    return () => ({ jumps: jumps.map((j, k) => j + held[k]!.stats.jumps - jumps0[k]!), ownAbsent: [...absent] });
  }

  /** The connections closed, by any page's session or as the transport saw them. */
  closed(): { readonly sessions: string[][]; readonly transport: [string, string][] } {
    return { sessions: this.nodes.map((x) => [...x.session.dropped]), transport: [...this.net.drops] };
  }

  final(k: number): Readonly<MatchState> {
    return this.nodes[k]!.session.timeline.final;
  }

  /** The run was clean (design §8.3): the drawn head's contract held everywhere, every chain the
   *  verifying page checked matched a full replay, and every page holds one hash at every final tick
   *  they share. */
  expectClean(label: string): void {
    expect(this.room.problems, label).toEqual([]);
    for (const x of this.room.nodes) expect(x.t.stats.verifyMismatches, `${label}: page ${x.k}`).toBe(0);
    expectAgreement(this.nodes.map((x) => ({ t: x.session.timeline })));
  }

  /** The last few lines of each page's timeline log, for a failure's label. */
  logs(): string {
    return this.nodes.map((x, k) => `${k} ${JSON.stringify(x.session.timeline.stats.log.slice(-4))}`).join('; ');
  }
}

/** What a run of freezes left, from their start on, by page: page 1 is the frozen one. */
export interface Freezes {
  readonly label: string;
  readonly jumps: number[];
  readonly ownAbsent: number[];
  readonly stalls: number[];
}

/** Page 1 frozen ms every `every` ms for span ms from 12 s + phase, in play, or with `again`, frozen ms,
 *  on for `again` ms, and frozen ms again; watched to 6 s after, when the freezes' last tick has left the
 *  final history, and every page holds one hash at every final tick they share (M3 phase 5a, clock-F1). */
export function freezes(
  o: RigOptions & { readonly phase: number; readonly ms: number; readonly every?: number; readonly span?: number; readonly again?: number },
): Freezes {
  const rig = new Rig(o);
  const start = 12_000 + o.phase; // not a setting: in play
  const every = o.every ?? 1000;
  let end: number;
  if (o.again !== undefined) {
    rig.freeze(1, start, o.ms);
    rig.freeze(1, start + o.ms + o.again, o.ms);
    end = start + 2 * o.ms + o.again;
  } else {
    end = start + (o.span ?? 10_000);
    for (let t = start; t + o.ms <= end; t += every) rig.freeze(1, t, o.ms);
  }
  rig.runTo(start - 5);
  expect(rig.final(0).phase).toBe(IN_PLAY);
  const seen = rig.watch();
  rig.runTo(end + 6000);
  const { jumps, ownAbsent } = seen();
  const what = o.again !== undefined ? `frozen ${o.ms} ms twice, ${o.again} ms apart` : `frozen ${o.ms} ms every ${every} ms`;
  const label = `seed ${o.seed}, ${o.packSize} a side, ${what}, ${o.thaw ?? 'timer'} first, from ${start}: jumps ${jumps}, own inputs missed ${ownAbsent}: ${rig.logs()}`;
  rig.expectClean(label);
  return { label, jumps, ownAbsent, stalls: rig.nodes.map((x) => x.session.stalls) };
}

/** Every page's but page 1's, the frozen one's. */
export const others = (xs: readonly number[]): number[] => xs.filter((_, k) => k !== 1);

/** M3 phase 5b, flood-F3: a page's incoming links held ms from `at`, in warm-up, its timers running on.
 *  Cut off, its final state holds itself alone; settleMs after the release, one match (settle), the
 *  page having repaired to the room. */
export function cutOff(o: { readonly seed: number; readonly packSize: number; readonly page: number; readonly at: number; readonly ms: number; readonly settleMs: number }): void {
  const rig = new Rig({ seed: o.seed, packSize: o.packSize });
  rig.hold(o.page, o.at, o.ms);
  rig.runTo(o.at + o.ms - 100);
  const label = `seed ${o.seed}, ${o.packSize} a side, page ${o.page} held ${o.ms} ms from ${o.at}`;
  const held = rig.nodes[o.page]!.session;
  expect(rig.final(o.page).terriers.map((T) => T.id), label).toEqual([held.cfg.me]);
  expect(rig.final(o.page).phase, label).toBe(WARM_UP);
  rig.settle(label, o.at + o.ms, o.settleMs);
  expect(held.timeline.stats.resyncs, label).toBeGreaterThanOrEqual(1);
}

/** M3 phase 5b: a partition in warm-up, pages [0, half) and the rest, both ways, ms from `at`, in a full
 *  mesh or with some pairs blocked (D-19's forwarding for them, split-F2). Each half's final state
 *  removes the other's players; settleMs after the release, one match (settle), every page in it, one
 *  half having repaired to the other's state and JOINed again. */
export function partitioned(o: {
  readonly seed: number; readonly packSize: number; readonly half: number; readonly at: number; readonly ms: number; readonly settleMs: number;
  readonly blocked?: readonly (readonly [number, number])[];
}): void {
  const rig = new Rig({ seed: o.seed, packSize: o.packSize, ...(o.blocked !== undefined ? { blocked: o.blocked } : {}) });
  rig.partition(o.half, o.at, o.ms);
  rig.runTo(o.at + o.ms - 100);
  const n = rig.nodes.length;
  const label = `seed ${o.seed}, ${o.packSize} a side, ${o.half}–${n - o.half} for ${o.ms} ms from ${o.at}${o.blocked !== undefined ? `, blocked ${JSON.stringify(o.blocked)}` : ''}`;
  const ids = rig.nodes.map((x) => x.session.cfg.me);
  for (let k = 0; k < n; k++) {
    const mine = ids.filter((_, j) => j < o.half === k < o.half).sort();
    expect(rig.final(k).terriers.map((T) => T.id).sort(), `${label}: page ${k}, split`).toEqual(mine);
  }
  rig.settle(label, o.at + o.ms, o.settleMs);
}

/** M3 phase 5b, the session builder's joining split: the last page's incoming links held ms from when it
 *  enters, the STATE it asks for among the messages held, so it adopts one ms old, with no round trip
 *  yet. Its clock catches up, its lineage finalises the gap with the others absent and removes them,
 *  and it holds itself alone, where the room never had it; settleMs after the release, one match
 *  (settle), the joiner in it. */
export function joinerHeld(o: { readonly seed: number; readonly packSize: number; readonly ms: number; readonly settleMs: number }): void {
  const rig = new Rig({ seed: o.seed, packSize: o.packSize });
  const k = rig.nodes.length - 1;
  const at = JOIN_EVERY_MS * k;
  rig.hold(k, at, o.ms);
  const joiner = rig.nodes[k]!.session;
  let alone = false;
  const look = (): void => {
    const t = joiner.timeline;
    if (t.started && t.final.terriers.length === 1 && t.final.terriers[0]!.id === joiner.cfg.me) alone = true;
    if (rig.net.now < at + o.ms + o.settleMs) rig.net.at(rig.net.now + 50, look);
  };
  rig.net.at(at, look);
  const label = `seed ${o.seed}, ${o.packSize} a side, page ${k} held ${o.ms} ms from entering at ${at}`;
  rig.settle(label, at + o.ms, o.settleMs);
  expect(alone, `${label}: alone in its lineage once`).toBe(true);
}
