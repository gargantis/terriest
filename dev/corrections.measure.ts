// The correction measurement (M3's design, research/m3/DESIGN.md, §9 and
// §1.38; PLAN D-11, D-16, §17's M3 entry), off the gate, in Node:
//
//   TERRIEST_CORRECTIONS_OUT=research/corrections/results.json npx vitest run --config dev/corrections.vitest.config.ts
//
// research/corrections/REPORT.md's method section, §9.2–§9.6 made
// concrete, is committed before a run counts (§9.1). Without
// TERRIEST_CORRECTIONS_OUT the run writes research/corrections/results.json
// and refuses to overwrite it, as the tuning metrics refuse
// (dev/tuning.metrics.ts), so while that file is committed a bare run stops
// at once: name it to rewrite it on purpose, or name another file. Its
// other options:
//   TERRIEST_CORRECTIONS_ONLY=pack1-30ms-d2-loss0,cap   only these profiles
//     and sections, by name, a * matching any characters ('pack4-*'): the
//     profiles are profiles()'s, and 'cap' is §9.6's cap check;
//   TERRIEST_CORRECTIONS_SEEDS=1   at most this many seeds a profile, for a
//     smoke run, which counts for nothing;
//   TERRIEST_CORRECTIONS_CAP_RUNS=2   the cap check's runs, 20 by default;
//   TERRIEST_CORRECTIONS_BASE='{"lateWindowTicks":14}'   measure from these
//     settings, by key path, instead of src/config.ts's, as rule 3 measures
//     its next w;
//   TERRIEST_CORRECTIONS_MERGE=a.json,b.json   measure nothing: take the
//     profiles and the cap check of these runs, decide the rules from them,
//     and write the result. So the profiles can run in several processes at
//     once, each with its own ONLY and OUT: they run in virtual time, and a
//     busy machine changes only their wall time. The cap check times Node,
//     so it runs alone.
//
// §9.2, the matches: every simulated browser runs a real Session, with its
// Timeline and its BotHost, over LoopbackNet; one browser a terrier, each
// driving its own terrier with the brain on its own head (M3-Q2), so every
// other terrier is remote to it. Browser 0 proposes a 1-minute match and
// plays in pack A; browser k joins 200·k ms later and plays in pack k mod 2;
// each presses Ready at the first timer run at or past READY_TICK with its
// terrier in the final roster, the one Ready rule of src/net/setups-testing.ts
// and the #test=net page; and the match plays to its confirmed end on every
// browser. A seed gives the IDs (personId), the links' jitter and loss, and
// each browser's clock: an offset uniform within ±30 ms and a drift within
// ±0.1%. Every link has the profile's one-way latency, 20 ms of jitter and
// its loss chance: M3-Q13's model, LoopbackNet's, where a message, with that
// chance, arrives an extra round trip, 2 × base, late, FIFO holding the
// messages behind it (§8.2). The partial-mesh profiles, phase 4a's, block
// one and then two pairs at pack size 4, whose inputs reach each other only
// forwarded (D-19); they're reported and decide nothing.
//
// §9.3, what it logs: every correction on every browser, through the
// timeline's onCorrection (§2.11), sized by src/core/session/summary.ts's
// correctionSizes, the match summary's own definition, with its depth and
// whether it was a repair's; and per browser and match, the timeline's
// stats summed over every timeline it held, the steps of each advance, and
// its traffic, counted round its link. The timeline's stats have no count
// of advances, so the steps per advance and the traffic are counted here.
// §9.4, what it reports: each profile pooled over its seeds, every p95 with
// its bootstrap 90% interval over the profile's matches (1,000 resamples,
// seeded by the profile's name, so a profile's figures don't depend on
// which others ran), and each lossy profile's reach, the partial mesh's
// forwarding reach beside it. The corrections that weren't a repair's are
// also reported split: those across a phase's start, where a late Ready or
// input moved a countdown or a goal by a tick, so the head shows a kickoff
// placement before or after it, metres for the driven terrier; and the
// steady rest. §9.5's three rules and §9.6's cap rule are decided from the
// results as research/corrections/REPORT.md's method says (decideRules,
// capRule): rules 1 and 2 read the steady corrections, rule 3 reads rule
// 1's d, and the same rules on every correction that wasn't a repair's,
// placements included, are reported beside them and decide nothing. Each
// results file records the commit it was measured at and whether the tree
// was clean, and the cap check the machine's load, so a busy machine's
// check decides nothing.
//
// This file is the measurement and the functions dev/corrections.test.ts
// checks in the gate. It registers the measurement's tests only under its
// own config, which sets TERRIEST_CORRECTIONS_MEASURING, so the gate's
// import of it registers nothing.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, loadavg } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { BUILD_INPUTS } from '../src/build-info';
import { config, type Config } from '../src/config';
import { personId } from '../src/core/bot/bot-id';
import { botParams } from '../src/core/bot/brain';
import { scriptSampler } from '../src/core/bot/setups';
import { T, wireLimits } from '../src/core/protocol/messages';
import { buildHash } from '../src/core/session/build';
import type { Link } from '../src/core/session/room-peer';
import { Session, type SessionConfig } from '../src/core/session/session';
import { netSettings } from '../src/core/session/settings';
import { correctionSizes, type CorrectionSizes, SummaryBuilder } from '../src/core/session/summary';
import { ENDED, IN_PLAY, type Pack, simParams } from '../src/core/sim/index';
import type { Correction, Timeline, TimelineStats } from '../src/core/timeline/timeline';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from '../src/net/loopback';
import type { Transport } from '../src/net/transport';
import { configWith, valueAt } from './tuning/model';

// ---- The method's figures (§9.2–§9.6): not settings, the measurement's own ----

export const PACK_SIZES = [1, 2, 3, 4] as const; // not a setting: §9.2's profiles
export const ONE_WAY_MS = [30, 80, 150] as const; // not a setting: §9.2's latencies, every link
export const JITTER_MS = 20; // not a setting: §9.2's, uniform in [0, 20)
export const D_VALUES = [2, 3] as const; // not a setting: §9.2's two input delays
export const LOSSES = [0, 0.001, 0.005] as const; // not a setting: M3-Q13's rates, a message
export const LOSS_FREE_SEEDS = 6; // not a setting: §9.2's
export const LOSSY_SEEDS = 4; // not a setting: §9.2's
/** The partial mesh (phase 4a's answers): pack size 4, these pairs of browsers blocked, at these latencies. */
export const MESH_ONE_WAY_MS = [30, 80] as const; // not a setting: the partial mesh's latencies
export const MESH_BLOCKED: readonly (readonly (readonly [number, number])[])[] = [[[1, 2]], [[1, 2], [5, 6]]]; // not a setting: one pair, then two
const MESH_PACK_SIZE = 4; // not a setting: the partial mesh's
const MATCH_MINUTES = 1; // not a setting: §9.2's 1-minute match, the configuration's least
const JOIN_EVERY_MS = 200; // not a setting: §9.2's join intervals
/** The tick at which each browser presses Ready, once in the roster: 6 s, by which 8 browsers that
 *  joined 200 ms apart over 150 ms links have joined, warmed up and are final in the roster. */
export const READY_TICK = 360; // not a setting: §9.2's fixed tick
const CLOCK_OFFSET_MS = 30; // not a setting: §9.2's, uniform within ±30 ms
const CLOCK_DRIFT = 0.001; // not a setting: §9.2's, within ±0.1%
/** A match that hasn't ended this long after genesis, in virtual time, is reported unended. */
const MATCH_CAP_MS = 600_000; // not a setting: the run's guard against an endless overtime
export const RESAMPLES = 1000; // not a setting: §9.4's bootstrap
export const INTERVAL_PERCENT = 90; // not a setting: §9.4's interval
const MATCH_ID = 'c07ec7edc07ec7ed'; // not a setting: a timeline ID, which no state holds
// Seeds' mixes, so each draw has a stream of its own (LoopbackNet's are the seed and seed ^ 0x5bd1e995).
const CLOCK_STREAM = 0x2545f491; // not a setting: a seed's mix

/** §9.5's rules. */
export const D_FALL = 0.25; // not a setting: rule 1's least fall of the p95 ball correction
export const BODY_GLIDES_MS = [50, 100, 150, 200] as const; // not a setting: rule 2's candidates for the bodies
export const OWN_GLIDES_MS = [25, 50, 100] as const; // not a setting: rule 2's candidates for your own terrier
export const LATE_ABSENT_SHARE_MAX = 0.005; // not a setting: rule 3's, of the remote inputs
export const RESYNCS_PER_MINUTE_MAX = 1; // not a setting: rule 3's, a browser-minute
export const W_NEXT = [14, 16, 18] as const; // not a setting: rule 3's candidates
/** §9.6's rule: M0's ratio of a drawn step at 4× throttle in Chromium to a step in Node, and half of
 *  L286's 50 ms frame. */
export const DRAWN_RATIO = 6.3; // not a setting: research/spike/REPORT.md §5.3's 183–195 µs against 27.8–31.2 µs
export const CAP_LIMIT_MS = 25; // not a setting: half of L286's 50 ms frame
export const CAP_RUNS = 20; // not a setting: §9.6's
/** §9.6's quiet machine: the 1-minute load average under this before the cap check's first run, and
 *  under it plus the check's own process, 1, after its last (method-F10). */
export const LOAD_QUIET = 1; // not a setting: the method's
const DEGREES_A_TURN = 360; // not a setting

// The cap check's match (§9.6): 4 a side over the loss-free 30 ms links; at HOLD_AT_MS, in play,
// every TICK to browser 3 is held HOLD_MS, FIFO holding the rest of each link behind it, so it
// finalises its peers' inputs absent, tallies alone, and repairs from about 240 ticks back when the
// late votes land, near the end of the 256-tick history: about 255 steps with prediction.
const CAP_SEED = 1; // not a setting: one match, repeated
const CAP_DISSENTER = 3; // not a setting: the browser whose links hold
const HOLD_AT_MS = 15_000; // not a setting: in play, from READY_TICK's countdown
export const HOLD_MS = 4100; // not a setting: the hold that starts the repair about 240 ticks back
const AROUND_MS = 5000; // not a setting: the normal advances' window either side of the repair
const NORMAL_SHOWN = 5; // not a setting: the worst normal advances reported

// ---- The profiles (§9.2) ----

/** What a profile's configuration, at its d, breaks of the checks the measurement relies on: TICK's
 *  u16 masks (wireLimits), PLAN §7.4's history covering d + w and windows inside the state history,
 *  and the spread's cap of at least a normal tick's w + 1 steps. A profile that breaks one isn't
 *  measured, and is reported (M3 phase 5's review, harness-F6): w over 13 at d = 3 takes protocol 2's
 *  32-tick history first (§9.5). */
export function profileProblems(p: Pick<Profile, 'd'>, c: Config): string[] {
  const pc = configWith({ inputDelayTicks: p.d }, c);
  const problems: string[] = [];
  try {
    wireLimits(pc);
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }
  const d = pc.inputDelayTicks;
  const w = pc.lateWindowTicks;
  if (!(pc.inputHistoryTicks >= d + w)) problems.push(`a TICK's ${pc.inputHistoryTicks}-tick input history doesn't cover d + w = ${d + w} ticks: protocol 2's 32-tick history first`);
  if (!(d + w + pc.voteWindowTicks < pc.stateHistoryTicks)) problems.push(`d + w + v = ${d + w + pc.voteWindowTicks} ticks isn't inside the ${pc.stateHistoryTicks}-tick state history`);
  if (!(pc.spreadMaxStepsPerTick >= w + 1)) problems.push(`the spread's cap, ${pc.spreadMaxStepsPerTick} steps a tick, is under a normal tick's worst, w + 1 = ${w + 1}`);
  return problems;
}

/** A profile: the pack size, every link's one-way latency and jitter, d, the loss chance, and the
 *  browser pairs with no direct link, whose inputs reach each other only forwarded (D-19). */
export interface Profile {
  readonly name: string;
  readonly packSize: number;
  readonly oneWayMs: number;
  readonly jitterMs: number;
  readonly d: number;
  readonly loss: number;
  readonly blocked: readonly (readonly [number, number])[];
  readonly seeds: number;
  /** The partial mesh's are reported and decide nothing. */
  readonly decides: boolean;
}

const percentText = (loss: number): string => String(Number((loss * 100).toFixed(3)));

export function profileName(packSize: number, oneWayMs: number, d: number, loss: number, blockedPairs = 0): string {
  return `pack${packSize}-${oneWayMs}ms-d${d}-${blockedPairs > 0 ? `blocked${blockedPairs}` : `loss${percentText(loss)}`}`;
}

/** §9.2's 72 profiles, 336 matches, and the partial mesh's 4, at c's d. */
export function profiles(c: Config = config): Profile[] {
  const out: Profile[] = [];
  for (const packSize of PACK_SIZES) {
    for (const oneWayMs of ONE_WAY_MS) {
      for (const d of D_VALUES) {
        for (const loss of LOSSES) {
          out.push({
            name: profileName(packSize, oneWayMs, d, loss), packSize, oneWayMs, jitterMs: JITTER_MS, d, loss, blocked: [],
            seeds: loss === 0 ? LOSS_FREE_SEEDS : LOSSY_SEEDS, decides: true,
          });
        }
      }
    }
  }
  for (const oneWayMs of MESH_ONE_WAY_MS) {
    for (const blocked of MESH_BLOCKED) {
      const d = c.inputDelayTicks;
      out.push({
        name: profileName(MESH_PACK_SIZE, oneWayMs, d, 0, blocked.length), packSize: MESH_PACK_SIZE, oneWayMs, jitterMs: JITTER_MS, d,
        loss: 0, blocked, seeds: LOSS_FREE_SEEDS, decides: false,
      });
    }
  }
  return out;
}

const globRe = (pattern: string): RegExp => new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

/** The names that `only` picks, a comma-separated list of names with * for any characters, among the
 *  given names; every name in the list must pick one. An empty list picks every name. */
export function pick(names: readonly string[], only: string): string[] {
  const patterns = only.split(',').map((x) => x.trim()).filter(Boolean);
  if (patterns.length === 0) return [...names];
  const none = patterns.filter((p) => !names.some((n) => globRe(p).test(n)));
  if (none.length > 0) {
    throw new Error(`TERRIEST_CORRECTIONS_ONLY: ${none.join(', ')} picks nothing; the names are pack<n>-<ms>ms-d<d>-loss<%> and pack4-<ms>ms-d<d>-blocked<pairs>, as ${names[0]}, and cap`);
  }
  return names.filter((n) => patterns.some((p) => globRe(p).test(n)));
}

// ---- The loss model (M3-Q13, §8.2) ----

/** Every link of the profile: its one-way latency, its jitter and its loss chance, which LoopbackNet
 *  turns into M3-Q13's model: a message, with that chance, arrives an extra round trip, 2 × base,
 *  late, and FIFO holds the messages behind it on its link. */
export function linkSpec(p: Pick<Profile, 'oneWayMs' | 'jitterMs' | 'loss'>): LinkSpec {
  return { base: p.oneWayMs, jitter: p.jitterMs, loss: p.loss };
}

// ---- Statistics (§9.4) ----

/** The pct-th percentile of sorted values, by nearest rank, ⌈n × pct / 100⌉, as the match summary's
 *  bins take it (src/core/session/summary.ts); 0 for none. */
export function percentile(sorted: ArrayLike<number>, pct: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const rank = Math.max(1, Math.ceil((n * pct) / 100));
  return sorted[Math.min(rank, n) - 1]!;
}

/** The middle of the values, the mean of the middle two for an even count; 0 for none. */
export function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** How many of the sorted values are at most v. */
function atMost(sorted: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Every value of the lists, sorted. */
export function sortedUnion(lists: readonly ArrayLike<number>[]): Float64Array {
  let n = 0;
  for (const l of lists) n += l.length;
  const all = new Float64Array(n);
  let at = 0;
  for (const l of lists) for (let i = 0; i < l.length; i++) all[at++] = l[i]!;
  return all.sort();
}

/** The pct-th percentile, by nearest rank, of the pool that holds weights[j] copies of each of
 *  byMatch[j]'s sorted values: a bootstrap resample's pooled samples, found without building it.
 *  all is every value of byMatch, sorted. 0 for an empty pool. */
export function pooledPercentile(byMatch: readonly ArrayLike<number>[], weights: readonly number[], pct: number, all: ArrayLike<number>): number {
  let total = 0;
  byMatch.forEach((m, j) => (total += (weights[j] ?? 0) * m.length));
  if (total === 0) return 0;
  const rank = Math.max(1, Math.ceil((total * pct) / 100));
  const count = (v: number): number => {
    let c = 0;
    byMatch.forEach((m, j) => {
      const w = weights[j] ?? 0;
      if (w > 0) c += w * atMost(m, v);
    });
    return c;
  };
  // The smallest value whose pooled count at or below it reaches the rank.
  let lo = 0;
  let hi = all.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (count(all[mid]!) >= rank) hi = mid;
    else lo = mid + 1;
  }
  return all[lo]!;
}

/** Resamples of n matches with replacement, seeded: each, how many times it takes each match. */
export function resampleCounts(n: number, resamples: number, seed: number): number[][] {
  const rand = mulberry32(seed);
  const out: number[][] = [];
  for (let r = 0; r < resamples; r++) {
    const w = new Array<number>(n).fill(0);
    for (let k = 0; k < n; k++) w[Math.floor(rand() * n)]!++;
    out.push(w);
  }
  return out;
}

export interface Interval {
  readonly lo: number;
  readonly hi: number;
}

/** The interval's ends of sorted replicates, INTERVAL_PERCENT of them between. */
export function intervalOf(replicates: readonly number[]): Interval {
  const s = Float64Array.from(replicates).sort();
  const tail = (100 - INTERVAL_PERCENT) / 2;
  return { lo: percentile(s, tail), hi: percentile(s, 100 - tail) };
}

/** A percentile's bootstrap over matches: its replicates, each the percentile of the pool of the
 *  matches one resample (draws) takes, and their interval. byMatch's lists are sorted, and all is
 *  their values, sorted, when the caller has it. */
export function bootstrapPercentile(
  byMatch: readonly ArrayLike<number>[], pct: number, draws: readonly (readonly number[])[], all: ArrayLike<number> = sortedUnion(byMatch),
): Interval & { readonly replicates: number[] } {
  const replicates = draws.map((w) => pooledPercentile(byMatch, w, pct, all));
  return { ...intervalOf(replicates), replicates };
}

/** A name's seed: FNV-1a, so a profile's bootstrap is the same whichever profiles ran. */
export function seedOf(name: string): number {
  let h = 0x811c9dc5; // not a setting: FNV-1a's offset basis
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0; // not a setting: FNV's prime
  return h;
}

/** Counts by bin: bin k holds edges[k] ≤ v < edges[k + 1], and the last every v from its edge up; a
 *  value under edges[0] is counted apart, as under. */
export function binCounts(values: Iterable<number>, edges: readonly number[]): { readonly counts: number[]; readonly under: number } {
  const counts = new Array<number>(edges.length).fill(0);
  let under = 0;
  for (const v of values) {
    if (!(v >= edges[0]!)) {
      under++;
      continue;
    }
    let lo = 0;
    let hi = edges.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (edges[mid]! <= v) lo = mid;
      else hi = mid - 1;
    }
    counts[lo]!++;
  }
  return { counts, under };
}

/** Two histograms of the same bins added, the shorter padded: lateBy's, pooled over browsers. */
export function addBins(a: readonly number[], b: readonly number[]): number[] {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, k) => (a[k] ?? 0) + (b[k] ?? 0));
}

// ---- The reach (§9.4) ----

/** The longest one-way latency at which a message whose trip takes `legs` one-way latencies over
 *  `hops` links, each drawing its own jitter, still lands in time: legs × one-way + hops × jitter ≤
 *  (d + w) ticks, less the clocks' residual. A retransmission's trip is 3 legs on its one link (§9.4:
 *  the model adds 2 × base to the message's own draw), whose ends sample each other's clocks, which
 *  the deadband leaves up to a tick apart; a forwarded TICK's 2 legs over 2 links (the partial mesh,
 *  phase 4a's answers), whose ends sample none of each other's, each within a deadband of the pages
 *  between, so up to two apart (M3 phase 5a, mesh-F4). */
export function reachMs(o: {
  readonly d: number; readonly w: number; readonly tickMs: number; readonly residualMs: number; readonly jitterMs: number; readonly legs: number; readonly hops: number;
}): number {
  return ((o.d + o.w) * o.tickMs - o.residualMs - o.hops * o.jitterMs) / o.legs;
}

export interface Reach {
  readonly legs: number;
  readonly hops: number;
  readonly reachMs: number;
  readonly inReach: boolean;
}

function reachOf(p: Profile, c: Config, legs: number, hops: number, deadbands: number): Reach {
  const tickMs = 1000 / c.ticksPerSecond;
  const r = reachMs({ d: p.d, w: c.lateWindowTicks, tickMs, residualMs: deadbands * c.clockDeadbandTicks * tickMs, jitterMs: p.jitterMs, legs, hops });
  return { legs, hops, reachMs: r, inReach: p.oneWayMs <= r };
}

/** The retransmission's reach beside a lossy profile, and the forwarding reach beside a partial
 *  mesh's (§9.4); none beside a loss-free full mesh. */
export function reachesOf(p: Profile, c: Config): { readonly loss?: Reach; readonly forwarding?: Reach } {
  return {
    ...(p.loss > 0 ? { loss: reachOf(p, c, 3, 1, 1) } : {}),
    ...(p.blocked.length > 0 ? { forwarding: reachOf(p, c, 2, 2, 2) } : {}),
  };
}

// ---- One match's browsers (§9.2, §9.3) ----

/** The bodies a correction moves (§9.3, §9.4): the ball in 3D and on the floor, each remote terrier's
 *  position and heading, and the driven terrier's apart. */
export const BODIES = ['ball', 'ballFlat', 'remote', 'headings', 'own', 'ownHeadings'] as const; // not a setting
export type Body = (typeof BODIES)[number];
const PHASE_NAMES = ['warmUp', 'startCountdown', 'kickoffCountdown', 'inPlay', 'celebration', 'ended'] as const; // not a setting: state.ts's phases, in order

type ByBody<V> = Record<Body, V>;
const byBody = <V>(make: (b: Body) => V): ByBody<V> => Object.fromEntries(BODIES.map((b) => [b, make(b)])) as ByBody<V>;

/** One kind of correction's sizes as they come: a repair's, or the rest. Each body's moved samples
 *  are kept, and its zeros counted (§9.4: the decisive figures are over the corrections that moved
 *  the body). */
export class Sizes {
  count = 0;
  still = 0; // moved nothing at all
  readonly moved: ByBody<number[]> = byBody(() => []);
  readonly zero: ByBody<number> = byBody(() => 0);
  readonly depths: number[] = [];

  add(s: CorrectionSizes, depth: number): void {
    this.count++;
    this.depths.push(depth);
    let moved = this.put('ball', s.ball);
    this.put('ballFlat', s.ballFlat);
    for (const r of s.remote) {
      moved = this.put('remote', r.metres) || moved;
      moved = this.put('headings', r.degrees) || moved;
    }
    if (s.own !== null) {
      moved = this.put('own', s.own.metres) || moved;
      moved = this.put('ownHeadings', s.own.degrees) || moved;
    }
    if (!moved) this.still++;
  }

  private put(b: Body, v: number): boolean {
    if (v > 0) {
      this.moved[b].push(v);
      return true;
    }
    this.zero[b]++;
    return false;
  }
}

/** A kind of correction's sizes over a match's browsers, each body's sorted. */
export interface MatchSizes {
  readonly count: number;
  readonly still: number;
  readonly moved: ByBody<Float64Array>;
  readonly zero: ByBody<number>;
  readonly depths: Float64Array;
}

/** A browser's corrections by kind (§9.4): those that weren't a repair's; a repair's, apart; and the
 *  first again, split by whether the correction crossed a phase's start, as when a late Ready or a
 *  remote input moves a goal or a countdown by a tick and the head shows a kickoff placement before
 *  or after it (placed), or not (steady), the kind rules 1 and 2 read (REPORT.md's method, 1.9). */
export interface SizesByKind {
  readonly predicted: Sizes;
  readonly repair: Sizes;
  readonly placed: Sizes;
  readonly steady: Sizes;
}

export const sizesByKind = (): SizesByKind => ({ predicted: new Sizes(), repair: new Sizes(), placed: new Sizes(), steady: new Sizes() });

/** A correction (§2.11), sized as the match summary sizes it, with its re-simulation's depth, H − from
 *  + 1 (§9.3), into its kinds. */
export function sortCorrection(into: SizesByKind, c: Correction, me: string): void {
  const sizes = correctionSizes(c, me);
  const depth = c.tick - c.from + 1;
  if (c.repair) {
    into.repair.add(sizes, depth);
  } else {
    into.predicted.add(sizes, depth);
    (crossesPhase(c) ? into.placed : into.steady).add(sizes, depth);
  }
}

/** A browser's exact p95s of one kind's corrections, by nearest rank over the samples that moved each
 *  body: the population its match summary bins (§1.16), so the two can be read side by side
 *  (method-F8). */
export function exactP95(s: Sizes): { readonly ball: number; readonly remote: number; readonly own: number; readonly headings: number } {
  const p95 = (b: Body): number => percentile(Float64Array.from(s.moved[b]).sort(), 95);
  return { ball: p95('ball'), remote: p95('remote'), own: p95('own'), headings: p95('headings') };
}

export function pooledSizes(list: readonly Sizes[]): MatchSizes {
  return {
    count: list.reduce((n, s) => n + s.count, 0),
    still: list.reduce((n, s) => n + s.still, 0),
    moved: byBody((b) => sortedUnion(list.map((s) => s.moved[b]))),
    zero: byBody((b) => list.reduce((n, s) => n + s.zero[b], 0)),
    depths: sortedUnion(list.map((s) => s.depths)),
  };
}

// The timeline's counters a browser's figures sum over every timeline it held (a merge or a rejoin
// replaces it, design §1.14).
const SUMMED = [
  'sent', 'received', 'receivedInputs', 'late', 'lateAbsent', 'agree', 'disagree', 'split', 'resyncs', 'resyncFailed', 'lateVoteFlips',
  'statesSent', 'statesTruncated', 'statesRefused', 'steps', 'spreadTicks', 'holds', 'reusedFinals', 'steppedFinals', 'rollbacks', 'corrections',
  'verifyMismatches', 'jumps',
] as const satisfies readonly (keyof TimelineStats)[]; // not a setting
type Summed = Record<(typeof SUMMED)[number], number> & { lateBy: number[]; maxStepsPerAdvance: number };

/** A call the cap check timed: an advance or a message, its steps and its Node time. */
interface Call {
  readonly at: number; // the browser's local ms
  readonly message: boolean;
  readonly steps: number;
  readonly ms: number;
  readonly adopted: boolean; // it adopted a repair's STATE
  readonly completed: boolean; // a repair completed in it
}

/** A simulated browser (§9.2): the session as NetGame drives it, a gap over stallMs between timer runs
 *  a stall (§4.12), Ready pressed at the first timer run at or past readyAt with its terrier in the
 *  final roster, as the #test=net page presses it; with what §9.3 logs of it. Its times are the
 *  network's virtual ms, read from clock. */
class Browser extends Session {
  readonly k: number;
  readonly joinAt: number;
  /** Its corrections by kind (sortCorrection). */
  readonly sizes = sizesByKind();
  readonly byPhase = new Array<number>(PHASE_NAMES.length).fill(0);
  /** The connections it closed (Session's drop, its dropped: a flood or garbage, §4.10), each with
   *  its local ms. */
  readonly closes: { readonly peer: string; readonly at: number }[] = [];
  /** The local ms of the advance or message being handled, which a drop happens in. */
  handling = 0;
  /** Steps of each advance that stepped: steps → advances. */
  readonly stepping = new Map<number, number>();
  ticks = 0;
  /** Round its link: a broadcast is a message to each neighbour; fwd counts the FWDs it sent (D-19). */
  readonly traffic = { sent: 0, sentBytes: 0, received: 0, receivedBytes: 0, fwd: 0 };
  /** The page's own summary of the same corrections (§1.16), its binned p95s beside the exact ones. */
  readonly summary: SummaryBuilder;
  readonly held: Timeline[] = [];
  startedAt = -1;
  endedAt = -1;
  lastAt = 0;
  /** The cap check's: every advance and message timed, the first that adopted a repair's STATE and
   *  the first after it that completed the repair, by index, and the repairs' STATEs, by tick. */
  calls: Call[] | null = null;
  repairFrom = -1;
  repairTo = -1;
  readonly repairs: { readonly g: number; readonly local: number; readonly w: number }[] = [];
  private readonly readyAt: number;
  private readonly clock: () => number;
  private pressed = false;
  private last = -1;
  private adoptedNow = false;

  constructor(cfg: SessionConfig, link: Link, k: number, joinAt: number, readyAt: number, clock: () => number) {
    super(cfg, link);
    this.k = k;
    this.joinAt = joinAt;
    this.readyAt = readyAt;
    this.clock = clock;
    this.summary = new SummaryBuilder(cfg.me);
  }

  override advance(now: number): void {
    this.handling = now;
    if (this.last >= 0 && now - this.last > this.cfg.net.stallMs) this.stalled(now);
    this.last = now;
    const t0 = this.timeline;
    const steps0 = t0.stats.steps;
    const tick0 = t0.localTick;
    const resyncs0 = t0.stats.resyncs;
    const timed = this.calls !== null;
    const start = timed ? performance.now() : 0;
    super.advance(now);
    const ms = timed ? performance.now() - start : 0;
    const t = this.see();
    const steps = t === t0 ? t.stats.steps - steps0 : 0;
    if (t === t0) this.ticks += Math.max(0, t.localTick - tick0);
    if (steps > 0) this.stepping.set(steps, (this.stepping.get(steps) ?? 0) + 1);
    if (timed) this.record({ at: now, message: false, steps, ms, adopted: this.adoptedNow, completed: t === t0 && t.stats.resyncs > resyncs0 });
    this.adoptedNow = false;
    if (!this.pressed && t.localTick >= this.readyAt && this.inRoster()) {
      this.pressed = true;
      this.ready(true);
    }
  }

  override onMessage(peer: string, bytes: Uint8Array, now: number): void {
    this.handling = now;
    this.traffic.received++;
    this.traffic.receivedBytes += bytes.length;
    const t0 = this.timeline;
    const steps0 = t0.stats.steps;
    const resyncs0 = t0.stats.resyncs;
    const timed = this.calls !== null;
    const start = timed ? performance.now() : 0;
    super.onMessage(peer, bytes, now);
    const ms = timed ? performance.now() - start : 0;
    const t = this.see();
    if (timed) {
      const steps = t === t0 ? t.stats.steps - steps0 : 0;
      this.record({ at: now, message: true, steps, ms, adopted: this.adoptedNow, completed: t === t0 && t.stats.resyncs > resyncs0 });
    }
    this.adoptedNow = false;
  }

  private record(c: Call): void {
    const calls = this.calls!;
    if (c.adopted && this.repairFrom < 0) this.repairFrom = calls.length;
    if (c.completed && this.repairFrom >= 0 && this.repairTo < 0) this.repairTo = calls.length;
    calls.push(c);
  }

  /** The timeline held now: a new one's corrections observed (§2.11), and its repairs' STATEs noted. */
  private see(): Timeline {
    const t = this.timeline;
    const now = this.clock();
    if (!this.held.includes(t)) {
      this.held.push(t);
      t.onCorrection = (c) => this.correction(c);
      const take = t.onState.bind(t);
      t.onState = (peer, m, oneWayMs, at) => {
        const repair = t.started;
        const ok = take(peer, m, oneWayMs, at);
        if (ok && repair) {
          this.adoptedNow = true;
          this.repairs.push({ g: m.g, local: t.localTick, w: t.cfg.window });
        }
        return ok;
      };
    }
    if (this.startedAt < 0 && t.started) this.startedAt = now;
    if (this.endedAt < 0 && ended(t)) this.endedAt = now;
    this.lastAt = now;
    return t;
  }

  private correction(c: Correction): void {
    sortCorrection(this.sizes, c, this.cfg.me);
    this.summary.add(c);
    this.byPhase[c.after.phase]!++;
  }

  /** The timeline's counters, over every timeline this browser held. */
  summed(): Summed {
    const s = { lateBy: [] as number[], maxStepsPerAdvance: 0 } as unknown as Summed;
    for (const k of SUMMED) s[k] = 0;
    for (const t of this.held) {
      for (const k of SUMMED) s[k] += t.stats[k];
      s.lateBy = addBins(s.lateBy, t.stats.lateBy);
      s.maxStepsPerAdvance = Math.max(s.maxStepsPerAdvance, t.stats.maxStepsPerAdvance);
    }
    return s;
  }
}

const ended = (t: Timeline): boolean => t.started && t.final.phase === ENDED && t.isConfirmed(t.final.phaseStart);

/** The correction moved a phase's start: the head before it and after it are in different phases, or
 *  in one that started at different ticks, so a kickoff placement may lie between them. */
export const crossesPhase = (c: Pick<Correction, 'before' | 'after'>): boolean => c.before.phase !== c.after.phase || c.before.phaseStart !== c.after.phaseStart;

/** One match's network (§9.2): LoopbackNet with the profile's links and blocked pairs, and a browser
 *  for each terrier, each with its own clock; the first proposes, the others join 200 ms apart. */
export class Rig {
  readonly net: LoopbackNet;
  readonly browsers: Browser[] = [];
  readonly nodes: LoopNode<Browser>[] = [];

  constructor(p: Profile, seed: number, c: Config) {
    const pc = configWith({ inputDelayTicks: p.d }, c);
    const P = simParams(pc);
    const B = botParams(pc);
    const net = netSettings(pc);
    const build = buildHash(pc, BUILD_INPUTS);
    const spec = linkSpec(p);
    this.net = new LoopbackNet(seed, () => spec);
    for (const [a, b] of p.blocked) this.net.block(`n${a}`, `n${b}`);
    const clocks = mulberry32(seed ^ CLOCK_STREAM);
    for (let k = 0; k < 2 * p.packSize; k++) {
      const me = personId(seed, k);
      const joinAt = JOIN_EVERY_MS * k;
      const cfg: SessionConfig = { P, B, net, me, name: `P${k}`, coat: k % P.coatCount, build, forwarding: true, mode: 'incremental', verify: 0 };
      const opts = { clockOffset: (2 * clocks() - 1) * CLOCK_OFFSET_MS, drift: (2 * clocks() - 1) * CLOCK_DRIFT };
      const node = this.net.add(`n${k}`, (link) => this.browser(cfg, link, k, joinAt), opts);
      this.nodes.push(node);
      const s = node.session;
      let sample = scriptSampler('brain', me, 0, P, B);
      s.controls = () => sample(s.timeline.head, s.timeline.headTick);
      s.onControl = (base) => {
        sample = scriptSampler('brain', me, base, P, B);
      };
      const pack = (k % 2) as Pack;
      this.net.join(node, joinAt, (now) => {
        if (k === 0) s.propose(node.local(now), { packSize: p.packSize, matchMinutes: MATCH_MINUTES }, MATCH_ID);
        s.play(pack);
      });
    }
  }

  /** The browser, its traffic counted round its link: a broadcast is one message to each neighbour;
   *  and each connection it closes noted, with when. */
  private browser(cfg: SessionConfig, link: Transport, k: number, joinAt: number): Browser {
    const counted = Object.create(link) as Transport;
    const b = new Browser(cfg, counted, k, joinAt, READY_TICK, () => this.net.now);
    counted.drop = (peer) => {
      b.closes.push({ peer, at: b.handling });
      link.drop?.(peer);
    };
    counted.send = (peer, bytes) => {
      b.traffic.sent++;
      b.traffic.sentBytes += bytes.length;
      if (bytes[0] === T.FWD) b.traffic.fwd++;
      link.send(peer, bytes);
    };
    counted.broadcast = (bytes) => {
      const n = link.peerCount();
      b.traffic.sent += n;
      b.traffic.sentBytes += n * bytes.length;
      if (bytes[0] === T.FWD) b.traffic.fwd += n;
      link.broadcast(bytes);
    };
    this.browsers.push(b);
    return b;
  }

  get allEnded(): boolean {
    return this.browsers.every((b) => ended(b.timeline));
  }
}

// ---- What a match and a profile report (§9.3, §9.4) ----

const DEPTH_EDGES = Array.from({ length: 32 }, (_, i) => i + 1); // not a setting: 1 to 31 ticks, then 32 or more
const METRE_EDGES = [0, 0.0001, 0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]; // not a setting: the sizes' histogram, m
const DEGREE_EDGES = [0, 0.1, 1, 5, 10, 20, 45, 90]; // not a setting: the headings' histogram, degrees

/** A browser in a match (§9.3). */
export interface BrowserFigures {
  readonly k: number;
  readonly pack: number;
  readonly minutes: number; // in the match: from its timeline's start to its confirmed end
  readonly corrections: { readonly count: number; readonly still: number; readonly repair: number; readonly timeline: number };
  readonly depth: { readonly p50: number; readonly p95: number; readonly max: number };
  readonly rollbacks: number;
  readonly rollbacksPerSecond: number;
  readonly stepsPerAdvance: { readonly mean: number; readonly p95: number; readonly max: number; readonly advances: number };
  readonly stepsPerTick: number;
  readonly spreadTicks: number;
  readonly resyncs: number;
  readonly resyncFailed: number;
  readonly disagree: number;
  readonly lateVoteFlips: number;
  readonly jumps: number;
  readonly late: {
    readonly remoteInputs: number; readonly count: number; readonly share: number; readonly lateBy: readonly number[];
    readonly lateAbsent: number; readonly lateAbsentShare: number;
  };
  /** Messages and bytes a second over its time online, from its join to its confirmed end, and the
   *  FWDs it sent, all told. */
  readonly traffic: {
    readonly sentPerSecond: number; readonly sentBytesPerSecond: number; readonly receivedPerSecond: number; readonly receivedBytesPerSecond: number;
    readonly fwdSent: number;
  };
  /** Its own match summary's p95s of the corrections that weren't a repair's, from the summary's bins
   *  (§1.16), and beside them the exact ones of the same samples, those that moved the body, as a
   *  check of the bins (method-F8). */
  readonly summaryP95: { readonly ball: number; readonly remote: number; readonly own: number; readonly headings: number };
  readonly exactP95: { readonly ball: number; readonly remote: number; readonly own: number; readonly headings: number };
}

export interface MatchFigures {
  readonly seed: number;
  readonly ended: boolean;
  readonly endTick: number;
  readonly endSeconds: number; // virtual, genesis to the last browser's confirmed end
  readonly score: readonly [number, number];
  readonly overtime: boolean;
  readonly wallSeconds: number;
  readonly browsers: readonly BrowserFigures[];
}

export interface Played {
  readonly figures: MatchFigures;
  readonly predicted: MatchSizes;
  readonly placed: MatchSizes;
  readonly steady: MatchSizes;
  readonly repair: MatchSizes;
  readonly stepping: Map<number, number>;
  readonly byPhase: number[];
  /** Each browser's timelines' logs, their first events (TimelineStats.log), for a look at one match. */
  readonly logs: readonly (readonly (readonly [number, string])[])[];
}

const share = (n: number, of: number): number => (of > 0 ? n / of : 0);

/** Steps of the advances that stepped, from a histogram: mean, p95 by nearest rank, max. */
function steppingFigures(h: ReadonlyMap<number, number>): { mean: number; p95: number; max: number; advances: number } {
  const keys = [...h.keys()].sort((a, b) => a - b);
  let n = 0;
  let sum = 0;
  for (const k of keys) {
    n += h.get(k)!;
    sum += k * h.get(k)!;
  }
  if (n === 0) return { mean: 0, p95: 0, max: 0, advances: 0 };
  const rank = Math.max(1, Math.ceil((n * 95) / 100));
  let seen = 0;
  let p95 = keys[keys.length - 1]!;
  for (const k of keys) {
    seen += h.get(k)!;
    if (seen >= rank) {
      p95 = k;
      break;
    }
  }
  return { mean: sum / n, p95, max: keys[keys.length - 1]!, advances: n };
}

/** One match of the profile, to its confirmed end on every browser, or MATCH_CAP_MS. */
export function playMatch(p: Profile, seed: number, c: Config): Played {
  const wall = performance.now();
  const rig = new Rig(p, seed, c);
  rig.net.run(MATCH_CAP_MS, () => rig.allEnded);
  const wallSeconds = (performance.now() - wall) / 1000;
  const first = rig.browsers[0]!.timeline.final;
  const lastEnd = Math.max(...rig.browsers.map((b) => b.endedAt));
  const browsers = rig.browsers.map((b): BrowserFigures => {
    const s = b.summed();
    const until = b.endedAt >= 0 ? b.endedAt : b.lastAt;
    const seconds = Math.max(0, until - (b.startedAt >= 0 ? b.startedAt : until)) / 1000;
    const online = Math.max(1e-9, (until - b.joinAt) / 1000);
    const depths = Float64Array.from(b.sizes.predicted.depths).sort();
    const summary = b.summary.summary(b.timeline.stats);
    return {
      k: b.k, pack: b.k % 2, minutes: seconds / 60,
      corrections: { count: b.sizes.predicted.count + b.sizes.repair.count, still: b.sizes.predicted.still + b.sizes.repair.still, repair: b.sizes.repair.count, timeline: s.corrections },
      depth: { p50: percentile(depths, 50), p95: percentile(depths, 95), max: depths.length > 0 ? depths[depths.length - 1]! : 0 },
      rollbacks: s.rollbacks, rollbacksPerSecond: share(s.rollbacks, seconds),
      stepsPerAdvance: steppingFigures(b.stepping), stepsPerTick: share(s.steps, b.ticks),
      spreadTicks: s.spreadTicks, resyncs: s.resyncs, resyncFailed: s.resyncFailed, disagree: s.disagree, lateVoteFlips: s.lateVoteFlips, jumps: s.jumps,
      late: {
        remoteInputs: s.receivedInputs, count: s.late, share: share(s.late, s.receivedInputs), lateBy: s.lateBy,
        lateAbsent: s.lateAbsent, lateAbsentShare: share(s.lateAbsent, s.receivedInputs),
      },
      traffic: {
        sentPerSecond: b.traffic.sent / online, sentBytesPerSecond: b.traffic.sentBytes / online,
        receivedPerSecond: b.traffic.received / online, receivedBytesPerSecond: b.traffic.receivedBytes / online, fwdSent: b.traffic.fwd,
      },
      summaryP95: { ball: summary.ball.p95, remote: summary.remote.p95, own: summary.own.p95, headings: summary.headings.p95 },
      exactP95: exactP95(b.sizes.predicted),
    };
  });
  const stepping = new Map<number, number>();
  for (const b of rig.browsers) for (const [k, n] of b.stepping) stepping.set(k, (stepping.get(k) ?? 0) + n);
  const byPhase = new Array<number>(PHASE_NAMES.length).fill(0);
  for (const b of rig.browsers) b.byPhase.forEach((n, i) => (byPhase[i]! += n));
  return {
    figures: {
      seed, ended: rig.allEnded, endTick: first.phase === ENDED ? first.phaseStart : -1, endSeconds: lastEnd >= 0 ? lastEnd / 1000 : -1,
      score: [first.score[0], first.score[1]], overtime: first.overtime, wallSeconds, browsers,
    },
    predicted: pooledSizes(rig.browsers.map((b) => b.sizes.predicted)),
    placed: pooledSizes(rig.browsers.map((b) => b.sizes.placed)),
    steady: pooledSizes(rig.browsers.map((b) => b.sizes.steady)),
    repair: pooledSizes(rig.browsers.map((b) => b.sizes.repair)),
    stepping, byPhase, logs: rig.browsers.map((b) => b.held.flatMap((t) => t.stats.log)),
  };
}

/** One body's figures over a profile's matches (§9.4): its moved samples and zeros, p50, p95 and max,
 *  and the p95's bootstrap interval; the replicates kept where the rules read them. */
export interface BodyFigures {
  readonly samples: number;
  readonly zero: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly p95Interval: Interval;
  readonly replicates?: readonly number[];
  readonly histogram: { readonly edges: readonly number[]; readonly counts: readonly number[] };
}

export interface KindFigures {
  readonly count: number;
  readonly still: number;
  readonly bodies: ByBody<BodyFigures>;
  readonly depth: { readonly p50: number; readonly p95: number; readonly max: number; readonly histogram: readonly number[] };
}

/** A profile, pooled over its seeds (§9.4). bodies are the corrections that weren't a repair's,
 *  placements included, reported beside the steady ones that rules 1 and 2 read; a repair's are
 *  apart. */
export interface ProfileReport {
  readonly profile: Profile & { readonly w: number; readonly v: number; readonly cap: number };
  readonly matches: readonly MatchFigures[];
  readonly corrections: { readonly count: number; readonly still: number; readonly repair: number; readonly byPhase: Readonly<Record<string, number>> };
  readonly bodies: ByBody<BodyFigures>;
  readonly depth: KindFigures['depth'];
  readonly repair: KindFigures;
  /** bodies' corrections split: those across a phase's start (crossesPhase), apart, and the rest, the
   *  steady ones, with the replicates the rules read: rules 1 and 2 read the steady ones (REPORT.md's
   *  method, 1.9). */
  readonly placed: KindFigures;
  readonly steady: KindFigures;
  readonly late: {
    readonly remoteInputs: number; readonly count: number; readonly share: number; readonly lateBy: readonly number[];
    readonly lateAbsent: number; readonly lateAbsentShare: number;
  };
  readonly browserMinutes: number;
  readonly resyncs: number;
  readonly resyncsPerBrowserMinute: number;
  readonly resyncFailed: number;
  readonly disagree: number;
  readonly lateVoteFlips: number;
  readonly jumps: number;
  readonly rollbacksPerSecond: number; // the browsers' mean
  readonly stepsPerAdvance: { readonly mean: number; readonly p95: number; readonly max: number };
  readonly stepsPerTick: number; // the browsers' mean
  readonly spreadTicks: number;
  readonly traffic: BrowserFigures['traffic']; // the browsers' mean a second, and every FWD sent
  readonly reach: { readonly loss?: Reach; readonly forwarding?: Reach };
  readonly ended: number; // matches that reached their confirmed end
  readonly wallSeconds: number;
}

/** The profiles whose replicates the rules read, so that a merge decides them as one run does: the
 *  loss-free 80 ms ones (rules 1 and 2). */
const keepsReplicates = (p: Profile): boolean => p.decides && p.loss === 0 && p.oneWayMs === 80;
/** The bodies rules 1 and 2 read; the ball on the floor is reported only. */
const RULED: readonly Body[] = ['ball', 'remote', 'headings', 'own', 'ownHeadings']; // not a setting

function kindFigures(list: readonly MatchSizes[], draws: readonly (readonly number[])[], keep: boolean): KindFigures {
  const bodies = byBody((b): BodyFigures => {
    const byMatch = list.map((m) => m.moved[b]);
    const all = sortedUnion(byMatch);
    const boot = bootstrapPercentile(byMatch, 95, draws, all);
    const edges = b === 'headings' || b === 'ownHeadings' ? DEGREE_EDGES : METRE_EDGES;
    return {
      samples: all.length, zero: list.reduce((n, m) => n + m.zero[b], 0),
      p50: percentile(all, 50), p95: percentile(all, 95), max: all.length > 0 ? all[all.length - 1]! : 0,
      p95Interval: { lo: boot.lo, hi: boot.hi },
      ...(keep && RULED.includes(b) ? { replicates: boot.replicates } : {}),
      histogram: { edges, counts: binCounts(all, edges).counts },
    };
  });
  const depths = sortedUnion(list.map((m) => m.depths));
  return {
    count: list.reduce((n, m) => n + m.count, 0), still: list.reduce((n, m) => n + m.still, 0), bodies,
    depth: {
      p50: percentile(depths, 50), p95: percentile(depths, 95), max: depths.length > 0 ? depths[depths.length - 1]! : 0,
      histogram: binCounts(depths, DEPTH_EDGES).counts,
    },
  };
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Rounds every fraction to 6 significant figures, so the report the rules read is the one written. */
const rounded = (_key: string, v: unknown): unknown => (typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v);
export const roundTrip = <V>(v: V): V => JSON.parse(JSON.stringify(v, rounded)) as V;

/** A profile's report from its matches (§9.4). */
export function reportOf(p: Profile, played: readonly Played[], c: Config): ProfileReport {
  const draws = resampleCounts(played.length, RESAMPLES, seedOf(p.name));
  const keep = keepsReplicates(p);
  const predicted = kindFigures(played.map((m) => m.predicted), draws, keep);
  const repair = kindFigures(played.map((m) => m.repair), draws, false);
  const placed = kindFigures(played.map((m) => m.placed), draws, false);
  const steady = kindFigures(played.map((m) => m.steady), draws, keep);
  const browsers = played.flatMap((m) => m.figures.browsers);
  const sum = (f: (b: BrowserFigures) => number): number => browsers.reduce((n, b) => n + f(b), 0);
  const minutes = sum((b) => b.minutes);
  const remoteInputs = sum((b) => b.late.remoteInputs);
  const stepping = new Map<number, number>();
  for (const m of played) for (const [k, n] of m.stepping) stepping.set(k, (stepping.get(k) ?? 0) + n);
  const steps = steppingFigures(stepping);
  const byPhase: Record<string, number> = {};
  PHASE_NAMES.forEach((name, i) => (byPhase[name] = played.reduce((n, m) => n + m.byPhase[i]!, 0)));
  const reach = reachesOf(p, c);
  return roundTrip({
    profile: { ...p, w: c.lateWindowTicks, v: c.voteWindowTicks, cap: c.spreadMaxStepsPerTick },
    matches: played.map((m) => m.figures),
    corrections: { count: predicted.count + repair.count, still: predicted.still + repair.still, repair: repair.count, byPhase },
    bodies: predicted.bodies, depth: predicted.depth, repair, placed, steady,
    late: {
      remoteInputs, count: sum((b) => b.late.count), share: share(sum((b) => b.late.count), remoteInputs),
      lateBy: browsers.reduce<number[]>((a, b) => addBins(a, b.late.lateBy), []),
      lateAbsent: sum((b) => b.late.lateAbsent), lateAbsentShare: share(sum((b) => b.late.lateAbsent), remoteInputs),
    },
    browserMinutes: minutes, resyncs: sum((b) => b.resyncs), resyncsPerBrowserMinute: share(sum((b) => b.resyncs), minutes),
    resyncFailed: sum((b) => b.resyncFailed), disagree: sum((b) => b.disagree), lateVoteFlips: sum((b) => b.lateVoteFlips), jumps: sum((b) => b.jumps),
    rollbacksPerSecond: mean(browsers.map((b) => b.rollbacksPerSecond)),
    stepsPerAdvance: { mean: steps.mean, p95: steps.p95, max: steps.max },
    stepsPerTick: mean(browsers.map((b) => b.stepsPerTick)), spreadTicks: sum((b) => b.spreadTicks),
    traffic: {
      sentPerSecond: mean(browsers.map((b) => b.traffic.sentPerSecond)), sentBytesPerSecond: mean(browsers.map((b) => b.traffic.sentBytesPerSecond)),
      receivedPerSecond: mean(browsers.map((b) => b.traffic.receivedPerSecond)), receivedBytesPerSecond: mean(browsers.map((b) => b.traffic.receivedBytesPerSecond)),
      fwdSent: sum((b) => b.traffic.fwdSent),
    },
    reach, ended: played.filter((m) => m.figures.ended).length, wallSeconds: played.reduce((n, m) => n + m.figures.wallSeconds, 0),
  });
}

// ---- The rules (§9.5) ----

/** What the rules read of a profile's report: with its matches, a report's, whose count says whether
 *  it was a smoke run's. */
export interface RuleFigures {
  readonly profile: Pick<Profile, 'name'>;
  readonly bodies: Readonly<Record<Body, Pick<BodyFigures, 'p95' | 'p95Interval' | 'replicates'>>>;
  readonly late: { readonly lateAbsentShare: number };
  readonly resyncsPerBrowserMinute: number;
  readonly matches?: readonly unknown[];
}

/** §9.2's matches for the profile of this name: LOSS_FREE_SEEDS loss-free, LOSSY_SEEDS lossy. */
export function seedsWanted(name: string): number {
  const loss = /-loss([0-9.]+)$/.exec(name);
  return loss !== null && Number(loss[1]) > 0 ? LOSSY_SEEDS : LOSS_FREE_SEEDS;
}

/** A decision from the figures of a smoke run, a profile with fewer matches than §9.2's, decides
 *  nothing, though its text still says what the figures would decide (harness-F5). */
function unlessSmoke(d: Decision, read: readonly (RuleFigures | undefined)[]): Decision {
  const smoke = read
    .filter((r): r is RuleFigures => r?.matches !== undefined && r.matches.length < seedsWanted(r.profile.name))
    .map((r) => `${r.profile.name} ${r.matches!.length} of ${seedsWanted(r.profile.name)}`);
  if (smoke.length === 0) return d;
  return { decided: false, value: null, text: `${d.text}; a smoke run, so it decides nothing: matches ${smoke.join(', ')}`, figures: d.figures };
}

export interface Decision {
  /** Whether every figure the rule reads was measured. */
  readonly decided: boolean;
  /** The value the rule picks, null when undecided. */
  readonly value: number | null;
  /** The decision, as REPORT.md states it, with its figures. */
  readonly text: string;
  readonly figures: readonly Record<string, unknown>[];
}

const byName = (reports: readonly RuleFigures[], name: string): RuleFigures | undefined => reports.find((r) => r.profile.name === name);
/** A figure a rule derives, a fall, a rate or a drawn time, to the 6 significant figures results.json
 *  holds, before it's compared with its limit: at a limit's edge the text decides, not floating-point
 *  noise (method-F5). */
export const sig = (x: number): number => (Number.isFinite(x) ? Number(x.toPrecision(6)) : x);
const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;
const num = (x: number): string => (x === 0 ? '0' : Math.abs(x) >= 100 ? x.toFixed(0) : x.toPrecision(3));

/** Each replicate's fall from a to b, 1 − b / a, paired by index: independent resamples of two
 *  profiles' matches, each fall to 6 significant figures (sig). null without replicates. */
export function fallInterval(a: readonly number[] | undefined, b: readonly number[] | undefined): Interval | null {
  if (a === undefined || b === undefined || a.length === 0 || a.length !== b.length) return null;
  const falls = a.map((x, i) => (x > 0 ? sig(1 - b[i]! / x) : NaN)).filter((x) => Number.isFinite(x));
  return falls.length === a.length ? intervalOf(falls) : null;
}

/** Rule 1 (d): d = 3 replaces 2 only if, at the loss-free 80 ms profiles, the p95 ball correction
 *  falls by at least 25% at every pack size, and at each the bootstrap interval of that fall lies
 *  wholly above 25%, each fall to 6 significant figures (sig). decideRules gives it the steady
 *  corrections' figures. */
export function ruleD(reports: readonly RuleFigures[]): Decision {
  const [from, to] = D_VALUES;
  const figures: Record<string, unknown>[] = [];
  const missing: string[] = [];
  const read: (RuleFigures | undefined)[] = [];
  let all = true;
  for (const packSize of PACK_SIZES) {
    const a = byName(reports, profileName(packSize, 80, from, 0));
    const b = byName(reports, profileName(packSize, 80, to, 0));
    read.push(a, b);
    if (a === undefined || b === undefined) {
      // Every profile it reads and lacks, named (method-F3).
      if (a === undefined) missing.push(profileName(packSize, 80, from, 0));
      if (b === undefined) missing.push(profileName(packSize, 80, to, 0));
      continue;
    }
    const p2 = a.bodies.ball.p95;
    const p3 = b.bodies.ball.p95;
    const fall = p2 > 0 ? sig(1 - p3 / p2) : NaN;
    const interval = fallInterval(a.bodies.ball.replicates, b.bodies.ball.replicates);
    const passes = fall >= D_FALL && interval !== null && interval.lo > D_FALL;
    all &&= passes;
    figures.push({ packSize, p95: { [`d${from}`]: p2, [`d${to}`]: p3 }, fall, fallInterval: interval, passes });
  }
  const shown = figures
    .map((f) => {
      const i = f.fallInterval as Interval | null;
      return `pack size ${String(f.packSize)}: ${pct(f.fall as number)} [${i ? `${pct(i.lo)}, ${pct(i.hi)}` : 'no interval'}]`;
    })
    .join('; ');
  if (missing.length > 0) return { decided: false, value: null, text: `rule 1 (d): undecided, ${missing.join(', ')} not measured${shown ? `; ${shown}` : ''}`, figures };
  const value = all ? to : from;
  const why = `the p95 ball correction falls from d = ${from} to d = ${to}, at the loss-free 80 ms profiles, by ${shown}; d = ${to} needs at least ${pct(D_FALL)} at every pack size, its interval wholly above it`;
  return unlessSmoke({ decided: true, value, text: `rule 1 (d): d = ${value} ${all ? `replaces ${from}` : 'stays'}: ${why}`, figures }, read);
}

/** Rule 2 (the glide), at rule 1's d and the loss-free 80 ms profiles at every pack size, each p95 at
 *  the upper end of its interval: the smallest candidate glide over which the p95 corrections of the
 *  bodies (the ball in 3D, the remote terriers' positions) are at most half the run speed, and the
 *  remote headings' at most half the turn rate; and for your own terrier, by the same rule on the
 *  driven terrier's. None passing: the largest candidate, and the figures go to M4's check.
 *  decideRules gives it the steady corrections' figures. */
export function ruleGlide(reports: readonly RuleFigures[], d: number, c: Config): { readonly bodies: Decision; readonly own: Decision } {
  const speed = c.runSpeedMetresPerSecond / 2;
  const turn = (c.turnRateTurnsPerSecond / 2) * DEGREES_A_TURN;
  const rows: { packSize: number; r: RuleFigures }[] = [];
  const missing: string[] = [];
  for (const packSize of PACK_SIZES) {
    const name = profileName(packSize, 80, d, 0);
    const r = byName(reports, name);
    if (r === undefined) missing.push(name);
    else rows.push({ packSize, r });
  }
  const glide = (what: string, key: string, candidates: readonly number[], clauses: readonly (readonly [Body, number, string])[]): Decision => {
    // Each p95 at its interval's upper end, and the least glide over which it keeps to its limit.
    const figures = rows.map(({ packSize, r }) => {
      const upper: Record<string, number> = {};
      for (const [b] of clauses) upper[b] = r.bodies[b].p95Interval.hi;
      return { packSize, upper, leastMs: Math.max(...clauses.map(([b, limit]) => (1000 * r.bodies[b].p95Interval.hi) / limit)) };
    });
    const passes = (ms: number): boolean => rows.every(({ r }) => clauses.every(([b, limit]) => r.bodies[b].p95Interval.hi / (ms / 1000) <= limit));
    const shown = figures.map((f) => `pack size ${f.packSize}: ${clauses.map(([b, , unit]) => `${b} ${num(f.upper[b]!)} ${unit}`).join(', ')}`).join('; ');
    const limits = clauses.map(([b, limit, unit]) => `${b} ${num(limit)} ${unit}/s`).join(', ');
    if (missing.length > 0) return { decided: false, value: null, text: `rule 2 (${what}, ${key}, at d = ${d}): undecided, ${missing.join(', ')} not measured`, figures };
    const chosen = candidates.find(passes);
    const value = chosen ?? candidates[candidates.length - 1]!;
    const verdict = chosen === undefined ? `none of ${candidates.join(', ')} ms passes, so ${value} ms, and the figures go to M4's check` : `${value} ms, the smallest of ${candidates.join(', ')} that passes`;
    const decision: Decision = { decided: true, value, text: `rule 2 (${what}, ${key}, at d = ${d}): ${verdict}: the p95s at their intervals' upper ends, ${shown}; over the glide each at most ${limits}`, figures };
    return unlessSmoke(decision, rows.map(({ r }) => r));
  };
  return {
    bodies: glide('the bodies', 'smoothingMs', BODY_GLIDES_MS, [['ball', speed, 'm'], ['remote', speed, 'm'], ['headings', turn, '°']]),
    own: glide('your own terrier', 'ownSmoothingMs', OWN_GLIDES_MS, [['own', speed, 'm'], ['ownHeadings', turn, '°']]),
  };
}

/** Rule 3 (w): w is confirmed if, at every pack size, lateAbsent is at most 0.5% of the remote inputs
 *  and resyncs are at most 1 a browser-minute, at rule 1's d, at the loss-free 30 and 80 ms profiles
 *  and the 30 ms profiles with either loss rate, which the model's reach covers. If one fails, the
 *  next of W_NEXT is measured, with rules 1 and 2 again, and becomes w if rule 3 confirms it there.
 *  A next w that takes, at this d, the TICK's 32-tick history (protocol 2), without which the
 *  harness measures none of its profiles, or no next w at all, decides nothing: the figures go to
 *  the owner in the C-row (method-F4). */
export function ruleW(reports: readonly RuleFigures[], d: number, c: Config): Decision {
  const w = c.lateWindowTicks;
  const figures: Record<string, unknown>[] = [];
  const missing: string[] = [];
  const failing: string[] = [];
  const read: (RuleFigures | undefined)[] = [];
  for (const packSize of PACK_SIZES) {
    for (const [oneWayMs, loss] of [[30, 0], [80, 0], [30, LOSSES[1]], [30, LOSSES[2]]] as const) {
      const name = profileName(packSize, oneWayMs, d, loss);
      const r = byName(reports, name);
      read.push(r);
      if (r === undefined) {
        missing.push(name);
        continue;
      }
      const passes = r.late.lateAbsentShare <= LATE_ABSENT_SHARE_MAX && r.resyncsPerBrowserMinute <= RESYNCS_PER_MINUTE_MAX;
      if (!passes) failing.push(name);
      figures.push({ name, lateAbsentShare: r.late.lateAbsentShare, resyncsPerBrowserMinute: r.resyncsPerBrowserMinute, passes });
    }
  }
  const worst = figures.length === 0 ? '' : `; the most: lateAbsent ${pct(Math.max(...figures.map((f) => f.lateAbsentShare as number)))} of the remote inputs, resyncs ${num(Math.max(...figures.map((f) => f.resyncsPerBrowserMinute as number)))} a browser-minute`;
  const limits = `lateAbsent at most ${pct(LATE_ABSENT_SHARE_MAX)} of the remote inputs and resyncs at most ${RESYNCS_PER_MINUTE_MAX} a browser-minute`;
  const head = `rule 3 (w = ${w}, at d = ${d})`;
  if (missing.length > 0) return { decided: false, value: null, text: `${head}: undecided, ${missing.join(', ')} not measured${worst}`, figures };
  if (failing.length === 0) return unlessSmoke({ decided: true, value: w, text: `${head}: confirmed: ${limits} at every pack size${worst}`, figures }, read);
  const fails = `${head}: fails at ${failing.join(', ')} (${limits})${worst}`;
  const next = W_NEXT.find((x) => x > w);
  // §9.5: past the history's 16 − d ticks, a w takes protocol 2's 32-tick history, which the harness
  // won't measure without (profileProblems): w = 14 fits at d = 2, any w over 13 at d = 3 doesn't.
  if (next === undefined) {
    return unlessSmoke({ decided: false, value: null, text: `${fails}; no w is left past ${w} (${W_NEXT.join(', ')}), so this decides nothing, and the figures go to the owner in the C-row`, figures }, read);
  }
  if (d + next > c.inputHistoryTicks) {
    const text =
      `${fails}; the next w, ${next}, takes at d = ${d} the TICK's 32-tick history first (protocol 2), without which none of its profiles is measured, ` +
      `so this decides nothing, and the figures go to the owner in the C-row: protocol 2 and w = ${next} measured, or w = ${w} kept with its residual`;
    return unlessSmoke({ decided: false, value: null, text, figures }, read);
  }
  const wider = D_VALUES.filter((x) => x + next > c.inputHistoryTicks);
  const history = wider.length === 0 ? '' : `; at w = ${next}, d = ${wider.join(' and ')} take the TICK's 32-tick history first, protocol 2, without which those profiles aren't measured, so rule 1 is undecided there and d stays ${D_VALUES[0]}`;
  const text =
    `${fails}; w = ${next} is measured next (TERRIEST_CORRECTIONS_BASE='{"lateWindowTicks":${next}}'), with rules 1 and 2 run again at it, and becomes w if rule 3 confirms it there; ` +
    `the plan states its costs: the goldens re-emitted, the confirmation delay (w + v) / 60 s, a normal tick's worst w + 1 steps, and past 16 − d the TICK's 32-tick history (protocol 2)${history}`;
  return unlessSmoke({ decided: true, value: next, text, figures }, read);
}

/** What decideRules reads of a profile's report: rule 1's and rule 2's figures, those of every
 *  correction that wasn't a repair's (bodies) and the steady ones apart, and rule 3's. */
export interface RulesInput extends RuleFigures {
  readonly steady: { readonly bodies: RuleFigures['bodies'] };
}

/** Rules 1 to 3 at one reading of the corrections. */
export interface RuleSet {
  readonly d: Decision;
  readonly glide: { readonly bodies: Decision; readonly own: Decision };
  readonly w: Decision;
}

export interface Rules extends RuleSet {
  /** Why rules 2 and 3 read d = 2, when rule 1 is undecided. */
  readonly note: string | null;
  /** The same rules on every correction that wasn't a repair's, placements included: reported, deciding
   *  nothing (REPORT.md's method, 1.9). */
  readonly withPlacements: RuleSet;
}

function ruleSet(reports: readonly RuleFigures[], c: Config): { readonly set: RuleSet; readonly atD: number } {
  const d = ruleD(reports);
  const atD = d.value ?? D_VALUES[0];
  return { set: { d, glide: ruleGlide(reports, atD, c), w: ruleW(reports, atD, c) }, atD };
}

/** §9.5's rules as REPORT.md's method decides them (1.9): rules 1 and 2 on the steady corrections,
 *  those that moved the body, weren't a repair's and didn't cross a phase's start; rule 3 at rule 1's
 *  d, d = 2 while rule 1 is undecided; and beside them, deciding nothing, the same rules on every
 *  correction that wasn't a repair's (method-F1). */
export function decideRules(reports: readonly RulesInput[], c: Config): Rules {
  const steady = ruleSet(reports.map((r) => ({ ...r, bodies: r.steady.bodies })), c);
  const note = steady.set.d.decided ? null : `rules 2 and 3 at d = ${steady.atD}, since rule 1 is undecided`;
  return { ...steady.set, note, withPlacements: ruleSet(reports, c).set };
}

// ---- The cap check (§9.6) ----

/** One run of the forced repair: its depth, every call of the repair, the worst of them, and the
 *  worst normal advances around it. */
export interface CapRun {
  readonly g: number; // the repaired STATE's tick
  readonly back: number; // local tick − w − g when the STATE was adopted: how far back it starts
  readonly steps: number; // local tick − g then: the steps the repair takes, with prediction
  readonly repairSteps: number; // the steps the repair's calls took
  readonly calls: readonly { readonly at: number; readonly message: boolean; readonly steps: number; readonly ms: number }[];
  readonly worst: { readonly ms: number; readonly steps: number };
  /** The worst normal advances around the repair, before the dissenter closed any connection. */
  readonly worstNormal: readonly { readonly ms: number; readonly steps: number }[];
  readonly inPlayAtHold: boolean;
  /** The other browsers' resyncs and lost tallies, which the hold alone shouldn't cause, and the
   *  first events of each that lost one, as [browser, local tick, event], beside the hold's start. */
  readonly others: { readonly resyncs: number; readonly disagree: number; readonly first: readonly (readonly [number, number, string])[] };
  readonly heldAtTick: number;
  /** Every connection a browser closed (Session's flood or garbage rule), with the closer's local ms:
   *  none in an honest run. The held TICKs landing at once can pass the dissenter's flood count, which
   *  counts by arrival (M3 phase 5's review, harness-F1); its connections are then gone for the rest
   *  of the run, so the others' lost tallies after it are the close's, not the hold's. */
  readonly drops: readonly { readonly by: number; readonly peer: string; readonly at: number }[];
  /** The 1-minute load average just before the run and just after it (method-F10). */
  readonly load?: { readonly before: number; readonly after: number };
}

/** The machine's load around the cap check (method-F10): the 1-minute load average before its first
 *  run and after its last. */
export interface CapLoad {
  readonly before: number;
  readonly after: number;
}

/** The forced repair (§9.6), once: a 4-a-side match into play, the dissenter's incoming TICKs held
 *  HOLD_MS, and its late-vote repair timed, call by call. */
export function capRun(c: Config, holdMs: number): CapRun {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) throw new Error("the cap check collects garbage before each run: run it with dev/corrections.vitest.config.ts, which passes Node's --expose-gc");
  gc();
  const p: Profile = { name: 'cap', packSize: MESH_PACK_SIZE, oneWayMs: ONE_WAY_MS[0], jitterMs: JITTER_MS, d: c.inputDelayTicks, loss: 0, blocked: [], seeds: 1, decides: false };
  const rig = new Rig(p, CAP_SEED, c);
  const dissenter = rig.browsers[CAP_DISSENTER]!;
  const node = rig.nodes[CAP_DISSENTER]!;
  const all: Call[] = [];
  dissenter.calls = all;
  let phaseAtHold = -1;
  let heldAt = -1;
  let heldAtTick = -1;
  const isTick = (bytes: Uint8Array): boolean => bytes[0] === T.TICK;
  rig.net.at(HOLD_AT_MS, () => {
    phaseAtHold = rig.browsers[0]!.timeline.final.phase;
    heldAt = node.local(rig.net.now);
    heldAtTick = dissenter.timeline.localTick;
    for (const n of rig.nodes) if (n.session !== dissenter) rig.net.delayNext(n.id, node.id, isTick, holdMs);
  });
  // On, until the normal advances' window after the repair has passed.
  rig.net.run(HOLD_AT_MS + holdMs + 60_000, () => dissenter.repairTo >= 0 && node.local(rig.net.now) > all[dissenter.repairTo]!.at + AROUND_MS);
  const from = dissenter.repairFrom;
  const to = dissenter.repairTo;
  if (from < 0 || to < 0 || dissenter.repairs.length === 0) {
    throw new Error(`the forced repair didn't happen: ${JSON.stringify(dissenter.timeline.stats.log.slice(-8))}`);
  }
  const repair = all.slice(from, to + 1);
  const stepped = repair.filter((x) => x.steps > 0);
  const worst = stepped.reduce((a, b) => (b.ms > a.ms ? b : a), stepped[0]!);
  const end = all[to]!.at;
  const drops = rig.browsers.flatMap((b) => b.closes.map((x) => ({ by: b.k, peer: x.peer, at: x.at })));
  // A dissenter that closed its connections advances alone from then on: no normal advance.
  const alone = Math.min(Infinity, ...dissenter.closes.map((x) => x.at));
  const normal = all
    .filter((x) => !x.message && x.at < alone && ((x.at >= heldAt - AROUND_MS && x.at < heldAt) || (x.at > end && x.at <= end + AROUND_MS)))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, NORMAL_SHOWN);
  const r = dissenter.repairs[0]!;
  const rest = rig.browsers.filter((b) => b !== dissenter);
  const others = rest.map((b) => b.summed());
  const first = rest.flatMap((b) =>
    b.held.flatMap((t) => t.stats.log).filter(([, e]) => /^(disagree|resync|split)/.test(e)).slice(0, 3).map(([tick, e]): [number, number, string] => [b.k, tick, e]),
  );
  return {
    g: r.g, back: r.local - r.w - r.g, steps: r.local - r.g, repairSteps: repair.reduce((n, x) => n + x.steps, 0),
    calls: repair.map((x) => ({ at: x.at, message: x.message, steps: x.steps, ms: x.ms })),
    worst: { ms: worst.ms, steps: worst.steps }, worstNormal: normal.map((x) => ({ ms: x.ms, steps: x.steps })), inPlayAtHold: phaseAtHold === IN_PLAY,
    others: { resyncs: others.reduce((n, s) => n + s.resyncs, 0), disagree: others.reduce((n, s) => n + s.disagree, 0), first },
    heldAtTick, drops,
  };
}

/** The cap check's runs in which a browser closed a connection, said beside the decision: nothing after
 *  such a close is an honest room's, though the repair's calls may come before it (harness-F1). */
export function dropsNote(runs: readonly { readonly drops?: CapRun['drops'] }[]): string {
  const dropped = runs.map((r) => r.drops ?? []).filter((x) => x.length > 0);
  if (dropped.length === 0) return '';
  const closers = [...new Set(dropped.flatMap((x) => x.map((y) => y.by)))].sort((a, b) => a - b);
  return (
    `; in ${dropped.length} of ${runs.length} runs browser ${closers.join(', ')} closed connections, up to ${Math.max(...dropped.map((x) => x.length))} a run, ` +
    "so those runs' worst normal advances stop at the dissenter's first close, and the other browsers' lost tallies after it are the close's"
  );
}

/** §9.6's rule: the cap stands if the median over the runs of each run's worst spread advance, times
 *  M0's ratio, is at most half L286's frame; otherwise the largest cap that meets it, by the median
 *  ms a step of those advances, below the cap measured and never under w + 1, measured again there.
 *  Even w + 1 failing, the figures go to M4's bench and the phone's run. Fewer runs than `wanted`,
 *  §9.6's 20 in the measurement, are a smoke run's, and a check on a busy machine, its 1-minute load
 *  at LOAD_QUIET or more before its first run or at LOAD_QUIET + 1 or more after its last, timed
 *  more than Node; either decides nothing (method-F10). */
export function capRule(runs: readonly Pick<CapRun, 'worst'>[], cap: number, w: number, wanted = 0, load?: CapLoad): Decision {
  const d = capDecision(runs, cap, w);
  if (runs.length > 0 && runs.length < wanted) {
    return { decided: false, value: null, text: `${d.text}; a smoke run, so it decides nothing: ${runs.length} of ${wanted} runs`, figures: d.figures };
  }
  if (runs.length > 0 && load !== undefined && !(load.before < LOAD_QUIET && load.after < LOAD_QUIET + 1)) {
    const text = `${d.text}; the machine was busy, its 1-minute load ${num(load.before)} before the first run and ${num(load.after)} after the last (under ${LOAD_QUIET} and ${LOAD_QUIET + 1} wanted), so it decides nothing: run it again alone`;
    return { decided: false, value: null, text, figures: d.figures };
  }
  return d;
}

function capDecision(runs: readonly Pick<CapRun, 'worst'>[], cap: number, w: number): Decision {
  if (runs.length === 0) return { decided: false, value: null, text: 'the cap check (§9.6): undecided, no run', figures: [] };
  const worst = runs.map((r) => r.worst.ms);
  const med = median(worst);
  const drawn = sig(med * DRAWN_RATIO);
  const most = Math.max(...worst);
  const perStep = median(runs.map((r) => (r.worst.steps > 0 ? r.worst.ms / r.worst.steps : 0)));
  const figures = [{ runs: runs.length, medianWorstMs: med, drawnMs: drawn, maxWorstMs: most, medianMsAStep: perStep }];
  const shown = `the median of ${runs.length} runs' worst spread advance ${num(med)} ms in Node, × ${DRAWN_RATIO} = ${num(drawn)} ms against ${CAP_LIMIT_MS} ms; their maximum ${num(most)} ms`;
  if (drawn <= CAP_LIMIT_MS) return { decided: true, value: cap, text: `the cap check (§9.6): the cap of ${cap} stands: ${shown}`, figures };
  // Below the cap measured, so the check steps down even when a worst call stepped more than the cap,
  // as a timer run whose clock moved two ticks may (method-F6).
  const largest = Math.min(perStep > 0 ? Math.floor(sig(CAP_LIMIT_MS / DRAWN_RATIO / perStep)) : cap, cap - 1);
  if (largest < w + 1) {
    return { decided: true, value: w + 1, text: `the cap check (§9.6): even w + 1 = ${w + 1} fails, ${num(perStep)} ms a step: the figures go to M4's bench and the phone's run; ${shown}`, figures };
  }
  return {
    decided: true, value: largest,
    text: `the cap check (§9.6): the cap of ${cap} fails: ${shown}; at ${num(perStep)} ms a step the largest cap that meets it is ${largest}, below ${cap} and at least w + 1 = ${w + 1}; measure it again there (TERRIEST_CORRECTIONS_BASE='{"spreadMaxStepsPerTick":${largest}}')`,
    figures,
  };
}

// ---- The run ----

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_OUT = 'research/corrections/results.json';

/** The settings measured from: src/config.ts's, or TERRIEST_CORRECTIONS_BASE's, by key path. */
function baseConfig(text: string | undefined): { c: Config; changes: Record<string, unknown> | null } {
  if (!text) return { c: config, changes: null };
  const given: unknown = JSON.parse(text);
  if (typeof given !== 'object' || given === null || Array.isArray(given)) throw new Error('TERRIEST_CORRECTIONS_BASE is a JSON object of settings by key path');
  const changes = given as Record<string, unknown>;
  for (const [key, v] of Object.entries(changes)) {
    const was = valueAt(config, key);
    if (was === undefined || typeof was === 'object' || typeof was !== typeof v) throw new Error(`TERRIEST_CORRECTIONS_BASE: ${key} is no setting of that type in src/config.ts`);
  }
  return { c: configWith(changes), changes };
}

/** The code a run measured with (§9.1, method-F11): the commit, the trees of src, dev and scripts at
 *  it, which a later commit changing none of them keeps, and whether the tree was clean, so the
 *  harness and the simulation are the commit's; null where git can't say. */
export interface Code {
  readonly commit: string | null;
  readonly trees?: { readonly src: string; readonly dev: string; readonly scripts: string } | null;
  readonly clean: boolean | null;
}

function codeOf(root: string): Code {
  const git = (...args: string[]): string | null => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  };
  const commit = git('rev-parse', 'HEAD');
  const trees = git('rev-parse', 'HEAD:src', 'HEAD:dev', 'HEAD:scripts')?.trim().split('\n') ?? [];
  const status = git('status', '--porcelain');
  return {
    commit: commit === null ? null : commit.trim(),
    trees: trees.length === 3 ? { src: trees[0]!, dev: trees[1]!, scripts: trees[2]! } : null,
    clean: status === null ? null : status.trim() === '',
  };
}

/** A results file as a merge reads it. */
export interface Run {
  readonly utc?: string;
  readonly node?: string;
  readonly cpu?: string | null;
  readonly cores?: number;
  readonly code?: Code;
  readonly base: unknown;
  readonly configuration: unknown;
  readonly method: unknown;
  readonly refused?: readonly { readonly name: string; readonly problems: readonly string[] }[];
  readonly profiles: readonly ProfileReport[];
  readonly cap?: unknown;
}

/** Runs merged (§1.12 of the method): one configuration, base, method and code, the merging process's
 *  own code too, each profile once, in `order`, the cap check from at most one, and every part's
 *  refused profiles carried; otherwise an error, and nothing is written. The result records the
 *  method, base and code they were measured with, and each part's file, time and machine. */
export function mergeRuns(
  files: readonly { readonly f: string; readonly run: Run }[], own: Code, order: readonly string[],
): Pick<Run, 'base' | 'configuration' | 'method' | 'code' | 'refused' | 'profiles' | 'cap'> & { readonly merged: readonly Record<string, unknown>[] } {
  const first = files[0];
  if (first === undefined) throw new Error('TERRIEST_CORRECTIONS_MERGE names no file');
  const profiles: ProfileReport[] = [];
  const refused: { name: string; problems: readonly string[] }[] = [];
  for (const { f, run } of files) {
    for (const key of ['configuration', 'base', 'method', 'code'] as const) {
      if (JSON.stringify(run[key] ?? null) !== JSON.stringify(first.run[key] ?? null)) throw new Error(`${f} was measured with another ${key} than ${first.f}`);
    }
    for (const r of run.profiles) {
      if (profiles.some((x) => x.profile.name === r.profile.name)) throw new Error(`${r.profile.name} is in two of ${files.map((x) => x.f).join(', ')}`);
      profiles.push(r);
    }
    for (const x of run.refused ?? []) if (!refused.some((y) => y.name === x.name)) refused.push({ name: x.name, problems: x.problems });
  }
  if (JSON.stringify(own) !== JSON.stringify(first.run.code ?? null)) throw new Error(`${first.f} was measured with another code than this merge's: ${JSON.stringify(first.run.code ?? null)} against ${JSON.stringify(own)}`);
  const caps = files.filter(({ run }) => run.cap !== undefined && run.cap !== null);
  if (caps.length > 1) throw new Error(`the cap check is in ${caps.map((x) => x.f).join(' and ')}`);
  const at = (name: string): number => order.indexOf(name);
  profiles.sort((a, b) => at(a.profile.name) - at(b.profile.name));
  refused.sort((a, b) => at(a.name) - at(b.name));
  return {
    base: first.run.base, configuration: first.run.configuration, method: first.run.method, code: own,
    ...(refused.length > 0 ? { refused } : {}), profiles, ...(caps[0] ? { cap: caps[0].run.cap } : {}),
    merged: files.map(({ f, run }) => ({ file: basename(f), utc: run.utc ?? null, node: run.node ?? null, cpu: run.cpu ?? null, cores: run.cores ?? null })),
  };
}

/** Arrays of numbers on one line each: the replicates and histograms stay readable. */
const written = (v: unknown): string => `${JSON.stringify(v, rounded, 1).replace(/\[[-0-9.e+,\s]*\]/g, (a) => a.replace(/\s+/g, ''))}\n`;

function describeProfile(r: ProfileReport): string {
  const of = (b: ByBody<BodyFigures>) => (k: Body, unit: string): string => `${k} ${num(b[k].p95)} ${unit} [${num(b[k].p95Interval.lo)}, ${num(b[k].p95Interval.hi)}]`;
  const body = of(r.bodies);
  const steady = of(r.steady.bodies);
  const reach = [r.reach.loss ? `loss reach ${num(r.reach.loss.reachMs)} ms (${r.reach.loss.inReach ? 'in reach' : 'out of reach'})` : '', r.reach.forwarding ? `forwarding reach ${num(r.reach.forwarding.reachMs)} ms (${r.reach.forwarding.inReach ? 'in reach' : 'out of reach'})` : ''].filter(Boolean).join(', ');
  return (
    `${r.profile.name}: ${r.matches.length} matches, ${r.ended} ended, ${num(r.wallSeconds)} s; corrections ${r.corrections.count} (${r.corrections.still} moved nothing, ${r.corrections.repair} a repair's); ` +
    `p95 ${body('ball', 'm')}, ${body('remote', 'm')}, ${body('headings', '°')}, ${body('own', 'm')}; ` +
    `without the ${r.placed.count} across a phase's start, ${steady('ball', 'm')}, ${steady('remote', 'm')}, ${steady('headings', '°')}, ${steady('own', 'm')}; depth p95 ${r.depth.p95}; ` +
    `late ${pct(r.late.share)}, lateAbsent ${pct(r.late.lateAbsentShare)}; resyncs ${num(r.resyncsPerBrowserMinute)} a browser-minute; ` +
    `steps an advance ${num(r.stepsPerAdvance.mean)} mean, ${r.stepsPerAdvance.p95} p95, ${r.stepsPerAdvance.max} max; ` +
    `${num(r.traffic.sentPerSecond)} messages and ${num(r.traffic.sentBytesPerSecond / 1000)} kB a second sent` +
    `${r.profile.blocked.length > 0 ? `; pairs ${r.profile.blocked.map(([a, b]) => `${a}–${b}`).join(', ')} blocked, ${r.traffic.fwdSent} FWDs` : ''}${reach ? `; ${reach}` : ''}`
  );
}

if (process.env.TERRIEST_CORRECTIONS_MEASURING === '1') {
  const { c: BASE, changes } = baseConfig(process.env.TERRIEST_CORRECTIONS_BASE);
  const OUT = resolve(ROOT, process.env.TERRIEST_CORRECTIONS_OUT ?? DEFAULT_OUT);
  const merging = (process.env.TERRIEST_CORRECTIONS_MERGE ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const all = profiles(BASE);
  const chosen = new Set(pick([...all.map((p) => p.name), 'cap'], process.env.TERRIEST_CORRECTIONS_ONLY ?? ''));
  const seedsMax = process.env.TERRIEST_CORRECTIONS_SEEDS ? Number(process.env.TERRIEST_CORRECTIONS_SEEDS) : Infinity;
  const capRuns = process.env.TERRIEST_CORRECTIONS_CAP_RUNS ? Number(process.env.TERRIEST_CORRECTIONS_CAP_RUNS) : CAP_RUNS;
  const whole = (n: number): boolean => Number.isInteger(n) && n >= 1;
  if (!(whole(seedsMax) || seedsMax === Infinity) || !whole(capRuns)) throw new Error('TERRIEST_CORRECTIONS_SEEDS and TERRIEST_CORRECTIONS_CAP_RUNS are whole numbers from 1');
  const wanted = merging.length > 0 ? [] : all.filter((p) => chosen.has(p.name));
  // A profile whose configuration breaks a check the measurement relies on isn't measured (harness-F6).
  const refused = wanted.map((p) => ({ name: p.name, problems: profileProblems(p, BASE) })).filter((x) => x.problems.length > 0);
  const measured = wanted.filter((p) => !refused.some((x) => x.name === p.name)).map((p) => ({ ...p, seeds: Math.min(p.seeds, seedsMax) }));
  const runsCap = merging.length === 0 && chosen.has('cap');
  const capProblems = runsCap ? profileProblems({ d: BASE.inputDelayTicks }, BASE) : [];
  const reports: ProfileReport[] = [];
  // The rules read the configuration measured: this run's, or the merged runs'.
  let measuredAt: Config = BASE;
  const out: Record<string, unknown> = {
    utc: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model ?? null, cores: availableParallelism(),
    code: codeOf(ROOT), base: changes ?? 'src/config.ts', configuration: BASE,
    method: {
      readyTick: READY_TICK, joinEveryMs: JOIN_EVERY_MS, matchMinutes: MATCH_MINUTES, clockOffsetMs: CLOCK_OFFSET_MS, clockDrift: CLOCK_DRIFT,
      resamples: RESAMPLES, intervalPercent: INTERVAL_PERCENT, matchCapMs: MATCH_CAP_MS,
      cap: { seed: CAP_SEED, dissenter: CAP_DISSENTER, holdAtMs: HOLD_AT_MS, holdMs: HOLD_MS, runs: capRuns, loadQuiet: LOAD_QUIET },
      seedsMax: Number.isFinite(seedsMax) ? seedsMax : null,
    },
    ...(refused.length > 0 ? { refused } : {}),
    profiles: reports,
  };
  // Set once the overwrite guard and the checks have passed: only then is anything written.
  let writing = false;

  describe('the correction measurement (design §9)', () => {
    beforeAll(() => {
      if (!process.env.TERRIEST_CORRECTIONS_OUT && existsSync(OUT)) {
        throw new Error(`Refusing to overwrite ${DEFAULT_OUT}: set TERRIEST_CORRECTIONS_OUT to the file to write, that one to rewrite it on purpose`);
      }
      if (capProblems.length > 0) throw new Error(`the cap check's configuration: ${capProblems.join('; ')}`);
      for (const x of refused) console.log(`${x.name}: not measured, its configuration: ${x.problems.join('; ')}`);
      if (merging.length > 0) {
        const files = merging.map((f) => ({ f, run: JSON.parse(readFileSync(resolve(ROOT, f), 'utf8')) as Run }));
        const m = mergeRuns(files, out.code as Code, all.map((p) => p.name));
        Object.assign(out, m);
        reports.splice(0, reports.length, ...m.profiles);
        out.profiles = reports;
        measuredAt = m.configuration as Config;
      }
      // A file whenever anything was picked, if only its refusals (method-F3).
      writing = true;
    });

    afterAll(() => {
      if (!writing) return;
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, written(out));
      console.log(`Wrote ${OUT}`);
    });

    for (const p of measured) {
      it(`${p.name}: ${p.seeds} matches (§9.2–§9.4)`, () => {
        const played: Played[] = [];
        for (let seed = 1; seed <= p.seeds; seed++) {
          const m = playMatch(p, seed, BASE);
          const f = m.figures;
          console.log(`${p.name} seed ${seed}: ${f.ended ? `ended at ${num(f.endSeconds)} s` : 'not ended'}, ${f.score.join('–')}${f.overtime ? ' after overtime' : ''}, ${f.browsers.length} browsers, ${num(f.wallSeconds)} s`);
          played.push(m);
        }
        const r = reportOf(p, played, BASE);
        reports.push(r);
        console.log(describeProfile(r));
      });
    }

    it("§9.5's rules, decided from the results as the method says (REPORT.md, 1.9)", () => {
      const rules = decideRules(reports, measuredAt);
      out.rules = rules;
      for (const x of [rules.d, rules.glide.bodies, rules.glide.own, rules.w]) console.log(x.text);
      if (rules.note !== null) console.log(rules.note);
      const w = rules.withPlacements;
      for (const x of [w.d, w.glide.bodies, w.glide.own, w.w]) console.log(`with the corrections across a phase's start, deciding nothing: ${x.text}`);
      // A merged cap check's decision, from its own runs and load.
      const cap = out.cap as { runs: CapRun[]; load?: CapLoad } | undefined;
      if (merging.length > 0 && cap !== undefined) {
        const decision = capRule(cap.runs, measuredAt.spreadMaxStepsPerTick, measuredAt.lateWindowTicks, CAP_RUNS, cap.load);
        out.cap = { ...cap, decision: { ...decision, text: `${decision.text}${dropsNote(cap.runs)}` } };
        console.log(`${decision.text}${dropsNote(cap.runs)}`);
      }
    });

    if (!runsCap) return;
    it(`§9.6's cap check: the forced repair, ${capRuns} runs, a garbage collection before each`, () => {
      const runs: CapRun[] = [];
      const before = loadavg()[0]!;
      for (let k = 0; k < capRuns; k++) {
        const at = loadavg()[0]!;
        const r = { ...capRun(BASE, HOLD_MS), load: { before: at, after: loadavg()[0]! } };
        const closed = r.drops.length === 0 ? '' : `; ${r.drops.length} connections closed, the first by browser ${r.drops[0]!.by} at ${num(r.drops[0]!.at)} ms`;
        console.log(
          `cap run ${k + 1}: from ${r.back} ticks back, ${r.steps} steps with prediction, in ${r.calls.length} calls; the worst ${num(r.worst.ms)} ms for ${r.worst.steps} steps; ` +
            `the worst normal ${r.worstNormal.map((x) => `${num(x.ms)} ms (${x.steps})`).join(', ')}; the load ${num(r.load.before)} to ${num(r.load.after)}${closed}`,
        );
        runs.push(r);
      }
      const load: CapLoad = { before, after: loadavg()[0]! };
      // The rule reads the runs as results.json holds them, as a merge does (method-F5).
      const decision = capRule(roundTrip(runs), BASE.spreadMaxStepsPerTick, BASE.lateWindowTicks, CAP_RUNS, roundTrip(load));
      out.cap = { load, runs, decision: { ...decision, text: `${decision.text}${dropsNote(runs)}` } };
      console.log(`${decision.text}${dropsNote(runs)}`);
    });
  });
}
