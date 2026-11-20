// The timeline's tests' shared support (M3's design, research/m3/DESIGN.md,
// §8.3), as src/core/sim/testing.ts is the simulation's: several nodes, each
// a Timeline with an optional BotHost, stepped in virtual time over links
// the test pumps by hand (Pump) or over src/net/loopback.ts's LoopbackNet
// (NetPump, around a TimelinePeer or, from phase 3, the session); §2.8's
// contract for the drawn head, checked after every advance and message
// (Watch); a run against the full replay (twin, D-11, §2.7); TICKs written
// by hand; and the timeline's insides the tests read. Moved from phase 2's
// timeline, predict, rollback and spread tests. Test support: only tests
// import it, so no build bundles it. src/core imports nothing outside
// src/core (design §1.36), so the loopback is declared here by what
// NetPump needs of it, as BotTimeline is beside the timeline (design §0).

import { expect } from 'vitest';
import { defaultBotParams } from '../bot/brain';
import {
  decode, type Hello, type Message, NO_TICK, PROTOCOL_VERSION, ROLE, type SenderInput, T, type Tick, type TickEvent, TIMELINE_KIND,
  wireLimits, type WireLimits, ZERO_HASH,
} from '../protocol/messages';
import { BotHost } from '../session/bots';
import { type Accepted, commonRefusal, type Link, type Refusal, type RoomPeer } from '../session/room-peer';
import { netSettings, type TimelineSettings } from '../session/settings';
import { cloneState, defaultParams, hash64, hashState, type MatchState, type SimParams, type TickInput } from '../sim';
import type { FinalHistory } from './history';
import type { InputStore } from './inputs';
import { type Correction, Timeline, type TimelineConfig, type TimelineOut } from './timeline';
import type { VoteBook } from './votes';

const NET = netSettings();

export type Mode = NonNullable<TimelineConfig['mode']>;

// --- TICKs written by hand, and the times a lone timeline advances at ---

/** A millisecond into local tick n, where a test advances a lone timeline (§2.13). */
export const at = (n: number): number => n * NET.tickMs + 1;

/** A sender's input in its TICK for t, from its inputs by tick: t's, and the history's values with
 *  their present bits, clear where it has none (§5.3). */
export function senderInput(
  inputs: ReadonlyMap<number, number>, t: number, events: TickEvent[] = [], history: number = NET.timeline.inputHistory,
): SenderInput {
  let present = 0;
  const hist: number[] = [];
  for (let k = 0; k < history; k++) {
    const v = inputs.get(t - 1 - k);
    if (v !== undefined) present |= 1 << k;
    hist.push(v ?? 0);
  }
  return { input: inputs.get(t) ?? 0, present, hist, events };
}

/** One sender's TICK for t, as its inputs by tick say, with these events and this vote: a remote
 *  sender's, as a test writes it. */
export function tickOf(
  inputs: ReadonlyMap<number, number>, t: number, events: TickEvent[] = [], voteTick: number = NO_TICK, voteHash: string = ZERO_HASH,
): Tick {
  return { type: T.TICK, t, own: senderInput(inputs, t, events), voteTick, voteHash, phase: 0, bots: [] };
}

// --- The timeline's insides ---

/** A predicted tick as the timeline keeps it: the state after the step, and the inputs it took (§2.1). */
export interface ChainEntry {
  readonly tick: number;
  readonly state: MatchState;
  readonly used: readonly TickInput[];
}

/** What the inside of a timeline shows its tests, and what they spoil on purpose (§2.1, §2.7, §3.4):
 *  the chain and its watermark, the input store, the vote book and the final history, the repair
 *  under way, whether the last work left the chain short of its target (a spread, §2.8), F, for
 *  the consensus tests' corruptions (design §0), and the voters removed for silence it counts. */
export interface Inside {
  validTo: number;
  touchedFrom: number;
  entryAt(u: number): ChainEntry | null;
  readonly store: InputStore;
  readonly book: VoteBook;
  readonly finals: FinalHistory;
  readonly repair: object | null;
  readonly behind: boolean;
  readonly F: MatchState;
  /** The voters the final lineage removed for silence while connected (M3 phase 5b). */
  readonly removed: ReadonlySet<string>;
}

export const inside = (t: Timeline): Inside => t as unknown as Inside;

/** Spoils t's final state on purpose, as a flipped bit would (P3, design §0): `change` writes F, and
 *  the chain predicted from the old F goes, so the next final tick steps from the spoiled one rather
 *  than reusing a prediction (§2.6). */
export function spoil(t: Timeline, change: (F: MatchState) => void): void {
  const x = inside(t);
  change(x.F);
  x.validTo = t.finalTick;
  x.touchedFrom = Math.min(x.touchedFrom, t.finalTick + 1);
}

/** The input u's chain entry took for id, if any. */
export const usedBy = (t: Timeline, u: number, id: string): TickInput | undefined => inside(t).entryAt(u)?.used.find((x) => x.id === id);

// --- The drawn head's contract (§2.8) ---

/** A drawn head the watch saw: its tick, its hash, and with keepStates a copy of it. */
export interface Head {
  readonly tick: number;
  readonly hash: string;
  readonly state?: MatchState;
}

export interface WatchOptions {
  /** Keep a copy of each head recorded. */
  readonly keepStates?: boolean;
  /** Record every advance's head, a repair's included, where by default only a change outside a repair is. */
  readonly everyHead?: boolean;
  /** Keep each correction, its states copied (§2.11). */
  readonly corrections?: boolean;
}

/** What the checks after an advance or a message compare with, taken before it. */
export interface Before {
  readonly t: Timeline;
  readonly steps: number;
  readonly local: number;
  readonly calm: boolean;
}

/** An advance as twin compares it (§2.7): the drawn head after it, as `tick hash`; whether the chain
 *  had caught up, no spread pending, as `behind` says (§2.8); and the corrections fired since the
 *  advance before, as `tick from repair` (§2.11). */
export interface Step {
  readonly head: string;
  readonly calm: boolean;
  readonly corrections: readonly string[];
}

/** One node's timeline under §2.8's contract, checked after each advance and each message: an
 *  advance steps at most spreadCap for each tick the clock moved, at least one tick's, and a message
 *  one tick's; the full replay recomputes its whole window from F each advance outside a repair
 *  (D-11); the drawn head is never F, never moved back, shows its own tick with the one drawn before
 *  it no later, and neither is written while drawn. Problems go to the list it's given. For twin it
 *  records every final state its timelines' histories take, the drawn head after each advance, and
 *  the corrections. A new timeline object, a merge's or a rejoin's, starts its checks afresh. */
export class Watch {
  readonly heads: Head[] = [];
  /** Every final state the watched timelines' histories took, in order, as `epoch tick hash`: the
   *  epoch counts the timeline objects watched, since a merge's ticks aren't the old match's. */
  readonly finals: string[] = [];
  readonly corrections: Correction[] = [];
  /** One for each advance (Step). */
  readonly steps: Step[] = [];
  /** The first final tick seen in its timeline, −1 before: where a full replay's stepping starts. */
  firstFinal = -1;
  private readonly problems: string[];
  private readonly opts: WatchOptions;
  private t: Timeline | null = null;
  private epoch = -1;
  private lastHeadTick = -1;
  private held: [Readonly<MatchState>, string][] = [];
  /** The corrections fired since the last advance, as twin compares them. */
  private fired: string[] = [];

  constructor(problems: string[], opts: WatchOptions = {}) {
    this.problems = problems;
    this.opts = opts;
  }

  /** Watches t from here on: the node's timeline, or the one a merge or a rejoin put in its place. Its
   *  history's writes and its corrections are recorded while it's the one watched. */
  adopt(t: Timeline): void {
    if (t === this.t) return;
    this.t = t;
    const epoch = ++this.epoch;
    this.firstFinal = -1;
    this.lastHeadTick = -1;
    this.held = [];
    const history = inside(t).finals;
    const put = history.put.bind(history);
    history.put = (tick, bytes, hash, roster) => {
      put(tick, bytes, hash, roster);
      if (this.t === t) this.finals.push(`${epoch} ${tick} ${hash}`);
    };
    const was = t.onCorrection;
    t.onCorrection = (c) => {
      if (this.t === t) {
        this.fired.push(`${c.tick} ${c.from} ${c.repair}`);
        if (this.opts.corrections) this.corrections.push({ ...c, before: cloneState(c.before), after: cloneState(c.after) });
      }
      was?.(c);
    };
  }

  /** calm: started, not repairing and not paused, so a full replay recomputes its window (a paused
   *  timeline, Practice's or a stall's, advances nothing). */
  before(t: Timeline): Before {
    this.adopt(t);
    return { t, steps: t.stats.steps, local: t.localTick, calm: t.started && !t.repairing && !t.paused };
  }

  /** After an advance of t, labelled `where` in a problem. */
  advanced(t: Timeline, where: string, b: Before): void {
    if (t === b.t) {
      const steps = t.stats.steps - b.steps;
      const budget = t.cfg.spreadCap * Math.max(1, t.localTick - b.local);
      if (steps > budget) this.problem(`${where}: ${steps} steps over ${budget}`);
      if (t.cfg.mode === 'fullReplay' && b.calm && !t.repairing && !t.paused && steps < t.localTick - t.finalTick) {
        this.problem(`${where}: ${steps} steps, not the window's ${t.localTick - t.finalTick}`);
      }
    } else {
      this.adopt(t);
    }
    const corrections = this.fired;
    this.fired = [];
    if (!t.started) {
      this.steps.push({ head: '', calm: false, corrections });
      return;
    }
    this.see(t);
    if (t.head === t.final || t.prevHead === t.final) this.problem(`${where}: the drawn head is F`);
    if (t.headTick < this.lastHeadTick) this.problem(`${where}: the head moved back from ${this.lastHeadTick} to ${t.headTick}`);
    // The state drawn is the head's tick's, and the one before it no later: never an older state swapped in.
    if (t.head.tick !== t.headTick || t.prevHead.tick > t.headTick) {
      this.problem(`${where}: the head shows ${t.head.tick}, prevHead ${t.prevHead.tick}, at ${t.headTick}`);
    }
    this.lastHeadTick = t.headTick;
    const held: [Readonly<MatchState>, string][] = [];
    for (const s of [t.head, t.prevHead]) {
      const h = hashState(s);
      if (this.held.some(([o, x]) => o === s && x !== h)) this.problem(`${where}: a drawn state was written`);
      held.push([s, h]);
    }
    this.held = held;
    const hash = held[0]![1];
    this.steps.push({ head: `${t.headTick} ${hash}`, calm: !inside(t).behind, corrections });
    const last = this.heads[this.heads.length - 1];
    if (this.opts.everyHead || (!t.repairing && (last === undefined || last.tick !== t.headTick || last.hash !== hash))) {
      this.heads.push(this.opts.keepStates ? { tick: t.headTick, hash, state: cloneState(t.head) } : { tick: t.headTick, hash });
    }
  }

  /** After t handled a message: adopting a STATE runs under one tick's budget too (§2.8). */
  handled(t: Timeline, where: string, b: Before): void {
    if (t !== b.t) {
      this.adopt(t);
      return;
    }
    const steps = t.stats.steps - b.steps;
    if (steps > t.cfg.spreadCap) this.problem(`${where}: a message's ${steps} steps`);
    if (t.started) this.see(t);
  }

  private see(t: Timeline): void {
    if (this.firstFinal < 0) this.firstFinal = t.finalTick;
  }

  private problem(p: string): void {
    this.problems.push(p);
  }
}

// --- The twin run (D-11, §2.7) ---

/** A node as twin reads it: its timeline, and the watch on it. */
export interface Watched {
  readonly t: Timeline;
  readonly watch: Watch;
}

/** A run as twin compares it. */
export interface Twinned {
  readonly mode: Mode;
  readonly nodes: readonly Watched[];
  readonly problems: readonly string[];
  /** Every message sent, as a pump traces it; none for a lone timeline's run. */
  readonly trace?: readonly string[];
}

/** The heads as twin compares them: tick and hash. */
export const headKeys = (heads: readonly Head[]): string[] => heads.map((h) => `${h.tick} ${h.hash}`);

/** Each final tick t holds in its history, with its hash. */
export function heldFinals(t: Timeline): string[] {
  const out: string[] = [];
  for (let g = Math.max(0, t.finalTick - t.cfg.history + 1); g <= t.finalTick; g++) out.push(`${g} ${t.hashAt(g)}`);
  return out;
}

/** A watch's finals by timeline and tick: the hashes each final tick took, in order. */
function finalsByTick(w: Watch): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of w.finals) {
    const at = f.lastIndexOf(' ');
    const key = f.slice(0, at);
    const hashes = out.get(key);
    if (hashes === undefined) out.set(key, [f.slice(at + 1)]);
    else hashes.push(f.slice(at + 1));
  }
  return out;
}

/** What two runs of one node disagree on, the first few: twin's comparisons at their common ticks. */
function differences(inc: Watched, full: Watched, strict: boolean): string[] {
  const out: string[] = [];
  const note = (d: string): void => {
    if (out.length < 8) out.push(d);
  };
  // Every final tick both runs made, by tick: the same hashes there, in the order taken.
  const a = finalsByTick(inc.watch);
  for (const [key, hashes] of finalsByTick(full.watch)) {
    const mine = a.get(key);
    if (mine !== undefined && mine.join() !== hashes.join()) note(`final ${key}: ${mine.join()} incremental, ${hashes.join()} in full`);
  }
  // The drawn head after each advance, where neither run had a spread pending; and the corrections
  // fired at an advance where neither had one pending then or at the advance before, which a spread's
  // touches change. Where the spreads were the same throughout, at every advance.
  const [x, y] = [inc.watch.steps, full.watch.steps];
  if (x.length !== y.length) note(`${x.length} advances incremental, ${y.length} in full`);
  for (let k = 0; k < Math.min(x.length, y.length); k++) {
    const [p, q] = [x[k]!, y[k]!];
    const calm = p.calm && q.calm;
    if ((strict || calm) && p.head !== q.head) note(`advance ${k}: head ${p.head} incremental, ${q.head} in full`);
    const settled = calm && k > 0 && x[k - 1]!.calm && y[k - 1]!.calm;
    if ((strict || settled) && p.corrections.join() !== q.corrections.join()) {
      note(`advance ${k}: corrections ${p.corrections.join(';')} incremental, ${q.corrections.join(';')} in full`);
    }
  }
  // The finals each history holds at the end, at the ticks both hold.
  const held = new Map(heldFinals(inc.t).map((f) => f.split(' ') as [string, string]));
  for (const f of heldFinals(full.t)) {
    const [tick, hash] = f.split(' ') as [string, string];
    const mine = held.get(tick);
    if (mine !== undefined && mine !== '' && hash !== '' && mine !== hash) note(`held ${tick}: ${mine} incremental, ${hash} in full`);
  }
  return out;
}

/** A scenario run twice, incremental and as a full replay, by runs make builds for each mode: neither
 *  run's watches found a problem, and every chain verified; the full replay reused no final and
 *  stepped each it took; and the two runs are the same at their common ticks (D-11, §2.7). The full
 *  replay steps every final where the incremental run reuses predictions, so a catch-up longer than
 *  the spread's cap, a warm-up's, spreads over more advances there, its finals coming later, its head
 *  held longer, and its votes and announcements sent later. So twin compares every final tick both
 *  runs made, by tick, each with the hashes it took in order; the drawn heads at each advance where
 *  neither run had a spread pending, the corrections where neither had one then or the advance
 *  before; and the finals both histories hold at the end. Where every node's spreads were the same
 *  throughout, it compares the messages too, and every head and correction; else as many messages.
 *  The incremental run, for the test to read on. */
export function twin<R extends Twinned>(make: (mode: Mode) => R, scenario: (run: R) => void): R {
  const inc = make('incremental');
  scenario(inc);
  const full = make('fullReplay');
  scenario(full);
  for (const r of [inc, full]) {
    expect(r.problems).toEqual([]);
    r.nodes.forEach((n, k) => expect(n.t.stats.verifyMismatches, `${r.mode} ${k}: ${JSON.stringify(n.t.stats.log.slice(-6))}`).toBe(0));
  }
  // The full replay steps every final, reusing none (D-11).
  full.nodes.forEach((n, k) => {
    const s = n.t.stats;
    const from = n.watch.firstFinal < 0 ? n.t.finalTick : n.watch.firstFinal;
    expect([s.reusedFinals, s.steppedFinals > 0, s.steppedFinals >= n.t.finalTick - from], `${k}`).toEqual([0, true, true]);
  });
  expect(full.nodes.length).toBe(inc.nodes.length);
  const spreads = (n: Watched): string => n.watch.steps.map((s) => (s.calm ? '.' : 's')).join('');
  const strict = inc.nodes.every((n, k) => spreads(n) === spreads(full.nodes[k]!));
  const trace = (r: R): readonly string[] => r.trace ?? [];
  expect(trace(full).length).toBe(trace(inc).length);
  if (strict) expect(trace(full)).toEqual(trace(inc));
  inc.nodes.forEach((n, k) => expect(differences(n, full.nodes[k]!, strict), `node ${k}`).toEqual([]));
  return inc;
}

// --- Agreement ---

/** t's oldest final tick still in its history: a joiner holds none before its STATE's. */
export function oldest(t: Timeline): number {
  let g = t.finalTick;
  while (g > 0 && t.hashAt(g - 1) !== '') g--;
  return g;
}

/** The hashes every node holds at each `every`th final tick they all hold, and at the newest of them,
 *  the one tick roslambo's agreeNow compared. */
export function sharedHashes(nodes: readonly { readonly t: Timeline }[], every = 7): { tick: number; hashes: string[] }[] {
  const lo = Math.max(...nodes.map((n) => oldest(n.t)));
  const hi = Math.min(...nodes.map((n) => n.t.finalTick));
  const out: { tick: number; hashes: string[] }[] = [];
  for (let g = lo; g <= hi; g += every) out.push({ tick: g, hashes: nodes.map((n) => n.t.hashAt(g)) });
  if (lo <= hi && (hi - lo) % every !== 0) out.push({ tick: hi, hashes: nodes.map((n) => n.t.hashAt(hi)) });
  return out;
}

/** The nodes share a final tick, and hold one hash at each they share (P2). */
export function expectAgreement(nodes: readonly { readonly t: Timeline }[], every = 7): void {
  const shared = sharedHashes(nodes, every);
  expect(shared.length).toBeGreaterThan(0);
  for (const s of shared) expect(new Set(s.hashes).size, `tick ${s.tick}`).toBe(1);
}

// --- Bots ---

/** A node's bots (§4.8): a BotHost with the default bot parameters and room settings, or the one made
 *  for its player ID. */
export type Bots = boolean | ((me: string) => BotHost);

function hostFor(me: string, P: SimParams, bots: Bots | undefined): BotHost | null {
  if (bots === undefined || bots === false) return null;
  return bots === true ? new BotHost(me, P, defaultBotParams, NET.room) : bots(me);
}

// --- The pump: links of its own, a millisecond at a time ---

export interface PumpOptions extends WatchOptions {
  readonly mode?: Mode;
  /** Node k's player ID; its transport peer ID is `peer-k`. */
  readonly ids?: (k: number) => string;
  readonly P?: SimParams;
  /** Each node's timeline settings, before its own changes: settings.ts's. */
  readonly settings?: TimelineSettings;
  /** A node's ms between timer runs to begin with: settings.ts's timer (D-31). */
  readonly pace?: number;
  /** The decoder's limits: wireLimits()'s. */
  readonly wire?: WireLimits;
}

export interface PumpNode extends Watched {
  readonly k: number;
  readonly id: string; // its player ID
  readonly peer: string; // its transport peer ID
  readonly t: Timeline;
  readonly host: BotHost | null;
  /** ms between timer runs: 4 awake, 1,000 hidden (D-31). */
  pace: number;
  /** When its timer runs next. */
  next: number;
  /** A frozen page runs nothing: no timer, and messages to it wait (M3 phase 2's answers). */
  frozen: boolean;
  /** What its BotHost's tend is told: its host is leaving (PLAN §14). */
  hostLeft: boolean;
  readonly watch: Watch;
  readonly heads: Head[];
  readonly finals: string[];
  readonly corrections: Correction[];
}

/** An extra delay for a message, in ms, or null to drop it. */
export type Rule = (from: PumpNode, to: PumpNode, m: Message, now: number) => number | null;

interface Post {
  readonly at: number;
  readonly seq: number;
  readonly from: PumpNode;
  readonly to: PumpNode;
  readonly bytes: Uint8Array;
}

const defaultId = (k: number): string => (0xe0 + k).toString(16).padStart(32, '0');

/** Timelines wired by a test pump, no transport (design §8.3): every message after the latency, a
 *  jitter from its sequence number and any rule's extra delay, FIFO per link; each node's timer
 *  every pace ms, which advances its timeline and tends its bots, its watch checking after each
 *  advance and each message. */
export class Pump implements Twinned {
  now = 0;
  readonly mode: Mode;
  readonly nodes: PumpNode[] = [];
  /** Every message posted, and every one a rule dropped, for comparing two runs. */
  readonly trace: string[] = [];
  /** The watches' problems. */
  readonly problems: string[] = [];
  latency = 70;
  jitter = 20;
  rules: Rule[] = [];
  private queue: Post[] = [];
  private seq = 0;
  private readonly lastAt = new Map<string, number>();
  private readonly opts: PumpOptions;
  private readonly P: SimParams;
  private readonly wire: WireLimits;

  constructor(opts: PumpOptions = {}) {
    this.opts = opts;
    this.mode = opts.mode ?? 'incremental';
    this.P = opts.P ?? defaultParams;
    this.wire = opts.wire ?? wireLimits();
  }

  /** A node, its timeline of this pump's mode verifying every advance unless over says otherwise. */
  add(over: Partial<TimelineConfig> = {}, opts: { readonly bots?: Bots } = {}): PumpNode {
    const k = this.nodes.length;
    const id = (this.opts.ids ?? defaultId)(k);
    const self: { node: PumpNode | null } = { node: null };
    const out: TimelineOut = {
      broadcast: (bytes) => {
        for (const to of this.nodes) if (to !== self.node) this.post(self.node!, to, bytes);
      },
      sendToPlayer: (player, bytes) => {
        const to = this.nodes.find((n) => n.id === player);
        if (to === undefined) return false;
        this.post(self.node!, to, bytes);
        return true;
      },
      sendToPeer: (peer, bytes) => {
        const to = this.nodes.find((n) => n.peer === peer);
        if (to !== undefined) this.post(self.node!, to, bytes);
      },
    };
    const settings = this.opts.settings ?? NET.timeline;
    const t = new Timeline({ ...settings, P: this.P, me: id, mode: this.mode, verify: 1, ...over }, out);
    const watch = new Watch(this.problems, this.opts);
    const node: PumpNode = {
      k, id, peer: `peer-${k}`, t, host: hostFor(id, this.P, opts.bots), pace: this.opts.pace ?? NET.timerMs, next: this.now,
      frozen: false, hostLeft: false, watch, heads: watch.heads, finals: watch.finals, corrections: watch.corrections,
    };
    watch.adopt(t);
    self.node = node;
    this.nodes.push(node);
    return node;
  }

  /** Runs ms of virtual time, a millisecond at a time: the messages due, then the timers due, then each. */
  run(ms: number, each?: (now: number) => void): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.now++;
      this.deliver();
      for (const n of this.nodes) {
        if (n.frozen || this.now < n.next) continue;
        n.next = this.now + n.pace;
        this.timer(n);
      }
      each?.(this.now);
    }
  }

  /** Runs until cond holds, at most ms. */
  until(cond: () => boolean, ms: number): void {
    const end = this.now + ms;
    while (!cond() && this.now < end) this.run(1);
    if (!cond()) throw new Error(`not reached within ${ms} ms`);
  }

  /** One timer run, as the session's: advance, then tend the bots (roslambo's order). */
  private timer(n: PumpNode): void {
    const b = n.watch.before(n.t);
    n.t.advance(this.now);
    n.host?.tend(n.t, n.hostLeft);
    n.watch.advanced(n.t, `${n.k} at ${this.now}`, b);
  }

  private post(from: PumpNode, to: PumpNode, bytes: Uint8Array): void {
    const m = decode(bytes, this.P, this.wire);
    if (m === null) throw new Error(`${from.k} sent bytes that don't decode`);
    let extra = 0;
    for (const rule of this.rules) {
      const x = rule(from, to, m, this.now);
      if (x === null) {
        this.trace.push(`${this.now} ${from.k}>${to.k} dropped ${hash64(bytes)}`);
        return;
      }
      extra += x;
    }
    const link = `${from.k}>${to.k}`;
    const seq = this.seq++;
    const jitter = this.jitter === 0 ? 0 : ((seq * 2654435761) >>> 0) % (this.jitter + 1);
    const at = Math.max(this.now + this.latency + jitter + extra, this.lastAt.get(link) ?? 0);
    this.lastAt.set(link, at);
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1]!.at > at) i--;
    this.queue.splice(i, 0, { at, seq, from, to, bytes });
    this.trace.push(`${this.now} ${link} ${hash64(bytes)}`);
  }

  private deliver(): void {
    const keep: Post[] = [];
    while (this.queue.length > 0 && this.queue[0]!.at <= this.now) {
      const q = this.queue.shift()!;
      // A frozen page runs nothing: its messages wait.
      if (q.to.frozen) keep.push(q);
      else this.dispatch(q);
    }
    if (keep.length > 0) this.queue.unshift(...keep);
  }

  private dispatch(q: Post): void {
    const m = decode(q.bytes, this.P, this.wire)!;
    const t = q.to.t;
    const b = q.to.watch.before(t);
    if (m.type === T.TICK) t.onTick(q.from.id, m, this.now, true);
    else if (m.type === T.STATE_REQ) t.onStateReq(q.from.peer, m, this.now, q.from.id);
    else if (m.type === T.STATE) t.onState(q.from.peer, m, this.latency, this.now);
    q.to.watch.handled(t, `${q.to.k} at ${this.now}`, b);
  }
}

// --- Over the loopback (design §6.2, §8.2) ---

/** What NetPump needs of src/net/loopback.ts's LoopbackNet: its virtual time, and running it. */
export interface VirtualNet {
  readonly now: number;
  run(until: number, stop?: () => boolean): void;
}

/** Where a room peer holds its timeline and its bots now: a TimelinePeer's own, or a session's, which
 *  a merge or a rejoin replaces (design §1.14). */
export interface Held {
  readonly t: Timeline;
  readonly host?: BotHost | null;
}

export interface NetPumpNode<S extends RoomPeer = RoomPeer> extends Watched {
  readonly k: number;
  readonly session: S;
  /** The timeline the session holds now, and its bots. */
  readonly t: Timeline;
  readonly host: BotHost | null;
  readonly watch: Watch;
  readonly heads: Head[];
  readonly finals: string[];
  readonly corrections: Correction[];
}

export interface NetPumpOptions extends WatchOptions {
  readonly mode?: Mode;
  readonly P?: SimParams;
  /** A TimelinePeer's timeline settings, before its own changes: settings.ts's. */
  readonly settings?: TimelineSettings;
}

/** Room peers over a LoopbackNet, each holding a timeline and perhaps a BotHost, watched as the pump's
 *  nodes are: after each timer run the net gives it and each message it takes, wherever its view
 *  finds its timeline then. The messages each sends through its link are traced. The net runs the
 *  time: LoopbackNet's join, leave, pace, block, dropNext and delayNext work as without the pump. */
export class NetPump<N extends VirtualNet = VirtualNet> implements Twinned {
  readonly net: N;
  readonly mode: Mode;
  readonly nodes: NetPumpNode[] = [];
  readonly problems: string[] = [];
  /** Every message a node's session sent, through its link. */
  readonly trace: string[] = [];
  private readonly opts: NetPumpOptions;

  constructor(net: N, opts: NetPumpOptions = {}) {
    this.net = net;
    this.opts = opts;
    this.mode = opts.mode ?? 'incremental';
  }

  /** For LoopbackNet.add: the room peer make builds on a traced link, for this pump's mode, watched
   *  where view finds its timeline. */
  peer<S extends RoomPeer>(make: (link: Link, mode: Mode) => S, view: (s: S) => Held): (link: Link) => S {
    return (link) => {
      const k = this.nodes.length;
      const s = make(this.traced(k, link), this.mode);
      const watch = new Watch(this.problems, this.opts);
      const node: NetPumpNode<S> = {
        k, session: s, watch, heads: watch.heads, finals: watch.finals, corrections: watch.corrections,
        get t() {
          return view(s).t;
        },
        get host() {
          return view(s).host ?? null;
        },
      };
      this.nodes.push(node);
      watch.adopt(node.t);
      const peer: RoomPeer = s;
      const advance = peer.advance.bind(s);
      const onMessage = peer.onMessage.bind(s);
      peer.advance = (now) => {
        const b = watch.before(node.t);
        advance(now);
        watch.advanced(node.t, `${k} at ${this.net.now}`, b);
      };
      peer.onMessage = (from, bytes, now) => {
        const b = watch.before(node.t);
        onMessage(from, bytes, now);
        watch.handled(node.t, `${k} at ${this.net.now}`, b);
      };
      return s;
    };
  }

  /** For LoopbackNet.add: a TimelinePeer of this pump's mode, verifying every advance unless over says
   *  otherwise, watched. */
  timeline(me: string, over: Partial<TimelineConfig> = {}, opts: TimelinePeerOptions = {}): (link: Link) => TimelinePeer {
    const P = this.opts.P ?? defaultParams;
    const settings = this.opts.settings ?? NET.timeline;
    return this.peer((link, mode) => new TimelinePeer(link, { ...settings, P, me, mode, verify: 1, ...over }, opts), (s) => s);
  }

  /** The node holding this session. */
  of(session: RoomPeer): NetPumpNode {
    const n = this.nodes.find((x) => x.session === session);
    if (n === undefined) throw new Error('no node of this pump holds that session');
    return n;
  }

  /** Runs the net ms on, or until stop holds, which LoopbackNet asks every 500 ms of virtual time. */
  run(ms: number, stop?: () => boolean): void {
    this.net.run(this.net.now + ms, stop);
  }

  /** Runs the net until cond holds, a millisecond at a time, at most ms. */
  until(cond: () => boolean, ms: number): void {
    const end = this.net.now + ms;
    while (!cond() && this.net.now < end) this.net.run(this.net.now + 1);
    if (!cond()) throw new Error(`not reached within ${ms} ms`);
  }

  /** The link, its sends traced; the rest of it, a Transport's own included, as it was. */
  private traced(k: number, link: Link): Link {
    const out = Object.create(link) as Link;
    out.send = (peer, bytes) => {
      this.trace.push(`${this.net.now} ${k}>${peer} ${hash64(bytes)}`);
      link.send(peer, bytes);
    };
    out.broadcast = (bytes) => {
      this.trace.push(`${this.net.now} ${k}>* ${hash64(bytes)}`);
      link.broadcast(bytes);
    };
    const drop = link.drop?.bind(link);
    if (drop !== undefined) {
      out.drop = (peer) => {
        this.trace.push(`${this.net.now} ${k} drops ${peer}`);
        drop(peer);
      };
    }
    return out;
  }
}

/** The build every TimelinePeer's HELLO carries, unless it's given another. */
export const TEST_BUILD = '0123456789abcdef'; // not a setting: a build hash's form (D-21)

export interface TimelinePeerOptions {
  /** Its HELLO's build: another's HELLO is refused unless the same (D-21). */
  readonly build?: string;
  readonly bots?: Bots;
  /** Until its timeline has started, it asks each peer it meets for a STATE (§3.4). */
  readonly join?: boolean;
}

/** A room peer of a timeline alone and its bots, before the session's (phase 3), for the timeline's
 *  tests over LoopbackNet: it admits every HELLO commonRefusal passes, maps each connection to its
 *  player, routes TICK, STATE_REQ and STATE to its timeline with half the connection's last round trip
 *  as its one-way delay, and on each timer run advances its timeline and then tends its bots, as the
 *  session will. A changed configuration passes its wire limits in cfg.wire, as the session does. */
export class TimelinePeer implements RoomPeer {
  readonly t: Timeline;
  readonly host: BotHost | null;
  hostLeft = false;
  private readonly build: string;
  private readonly join: boolean;
  private readonly P: SimParams;
  private readonly wire: WireLimits;
  private readonly playerOf = new Map<string, string>(); // connection → player
  private readonly peerOf = new Map<string, string>(); // player → connection
  private readonly oneWayOf = new Map<string, number>(); // connection → ms

  constructor(link: Link, cfg: TimelineConfig, opts: TimelinePeerOptions = {}) {
    this.build = opts.build ?? TEST_BUILD;
    this.join = opts.join ?? false;
    this.P = cfg.P;
    this.wire = cfg.wire ?? wireLimits();
    this.t = new Timeline(cfg, {
      broadcast: (bytes) => link.broadcast(bytes),
      sendToPlayer: (player, bytes) => {
        const peer = this.peerOf.get(player);
        if (peer === undefined) return false;
        link.send(peer, bytes);
        return true;
      },
      sendToPeer: (peer, bytes) => link.send(peer, bytes),
    });
    this.host = hostFor(cfg.me, cfg.P, opts.bots);
  }

  hello(): Hello {
    const t = this.t;
    return {
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: this.build, player: t.cfg.me, role: ROLE.PLAYER,
      timeline: t.started ? t.id : ZERO_HASH, timelineKind: t.started ? TIMELINE_KIND.LIVE : TIMELINE_KIND.NONE,
      phase: t.final.phase, finalTick: t.finalTick, hash: t.started ? t.hashAt(t.finalTick) : ZERO_HASH, name: '',
    };
  }

  checkHello(hello: Hello): Accepted | Refusal {
    return commonRefusal(hello, this.build, this.t.cfg.me) ?? { ok: true, hello };
  }

  onPeerJoin(peer: string, hello: Hello): void {
    this.playerOf.set(peer, hello.player);
    this.peerOf.set(hello.player, peer);
    if (this.join && !this.t.started) this.t.requestState(peer);
  }

  onHandshakeFailed(): void {}

  onPeerLeave(peer: string): void {
    const player = this.playerOf.get(peer);
    this.playerOf.delete(peer);
    this.oneWayOf.delete(peer);
    if (player === undefined || this.peerOf.get(player) !== peer) return;
    this.peerOf.delete(player);
    this.t.forget(player);
  }

  onRtt(peer: string, ms: number): void {
    this.oneWayOf.set(peer, ms / 2);
    const player = this.playerOf.get(peer);
    if (player !== undefined) this.t.setOneWay(player, ms / 2);
  }

  onMessage(peer: string, bytes: Uint8Array, now: number): void {
    const player = this.playerOf.get(peer);
    const m = decode(bytes, this.P, this.wire);
    if (player === undefined || m === null) return;
    if (m.type === T.TICK) this.t.onTick(player, m, now, true);
    else if (m.type === T.STATE_REQ) this.t.onStateReq(peer, m, now, player);
    else if (m.type === T.STATE) this.t.onState(peer, m, this.oneWayOf.get(peer) ?? 0, now);
  }

  advance(now: number): void {
    this.t.advance(now);
    this.host?.tend(this.t, this.hostLeft);
  }
}
