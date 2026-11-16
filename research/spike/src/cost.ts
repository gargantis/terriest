// M0 run 3's tick cost (PLAN §17 M0, C-2), one harness for every engine:
// the page's ?test=cost mode (src/cost-page.ts) runs it in Chromium, and
// scripts/cost-node.mjs in Node. It drives the simulation's replay bench
// (createReplayBench, src/sim/source.ts) and times each unit of work with
// the clock it's handed, since src/sim reads no clock.
//
// - A tick is roslambo's replay: finalise one tick from the base state, then
//   re-simulate the 12-tick window from a clone of it, 13 steps in all, as
//   the budget assumes every tick (C-2).
// - Before anything is timed: the scrum settles for `settleTicks` single
//   steps of the base, and `warmupTicks` 13-step ticks warm the JIT.
// - Then `ticks` 13-step ticks are timed one by one (PLAN asks for at least
//   600), with the solver's contacts counted over them.
// - Then the worst single ticks (D-11, C-2): bursts of 30, 42 and 270 steps
//   (a resync, a joiner's catch-up and a late-vote repair) in turn, each
//   from the base and timed alone against L286's 50 ms frame; the base moves
//   on one 13-step tick, untimed, after each, so the bursts start from
//   different moments of the scrum.
//
// Imports keep their .ts extensions, so Node runs this file as it is.

import type { SlipOutName } from './sim/config.ts';
import type { SolverStats } from './sim/physics.ts';
import { createReplayBench, type ReplayBench } from './sim/source.ts';

/** The 12-tick window plus the finalising step (C-2). */
export const WINDOW = 12;
export const STEPS_PER_TICK = WINDOW + 1;
/** The stop rule's ceiling for a 13-step tick's p95, in Chromium at 4× (§17 M0). */
export const STOP_RULE_P95_MS = 4;
/** L286's maximum frame, against which the worst single ticks are timed. */
export const FRAME_LIMIT_MS = 50;
export const BURST_STEPS: readonly number[] = [30, 42, 270];
/** Run 1's 4-a-side scrums, under M0's slip-out pick: the plan's script (at
 *  the wall) and the spike's densest (in the cut corner). */
export const COST_SCRIPTS: readonly string[] = ['scrum at the wall, flag42', 'scrum in the corner, flag42'];

export interface CostOptions {
  script: string;
  slipOut?: SlipOutName;
  settleTicks: number;
  warmupTicks: number;
  ticks: number;
  bursts: readonly number[];
  burstRuns: number;
}

export const DEFAULT_COST: CostOptions = {
  script: COST_SCRIPTS[0]!, settleTicks: 120, warmupTicks: 120, ticks: 1200, bursts: BURST_STEPS, burstRuns: 30,
};

export interface Stats {
  n: number;
  mean: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Quantiles as roslambo's frames.ts takes them: the element at floor(n × q) of the sorted values. */
export function stats(xs: readonly number[]): Stats {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number): number => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))]! : 0);
  return {
    n: s.length, mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0,
    min: s[0] ?? 0, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1] ?? 0,
  };
}

const scaled = (x: Stats, k: number): Stats => ({
  n: x.n, mean: x.mean * k, min: x.min * k, p50: x.p50 * k, p95: x.p95 * k, p99: x.p99 * k, max: x.max * k,
});

export interface ContactCounts {
  substeps: number;
  /** Every contact the solver saw, per substep, and of those against the floor and the rest. */
  perSubstep: number;
  floorPerSubstep: number;
  otherPerSubstep: number;
  /** The most contacts in one substep. */
  maxInSubstep: number;
  slipOutsPerSubstep: number;
}

export interface BurstReport {
  steps: number;
  runs: number;
  /** Milliseconds for the whole burst. */
  ms: Stats;
  /** The median burst's time per step. */
  perStepMs: number;
  limitMs: number;
  /** Bursts over the limit, and whether the slowest kept within it. */
  overLimit: number;
  within: boolean;
  contactsPerSubstep: number;
}

export interface CostReport {
  script: string;
  slipOut: string;
  packSize: number;
  window: number;
  stepsPerTick: number;
  settleTicks: number;
  warmupTicks: number;
  /** The base state's ticks over the timed window. */
  baseTicks: { from: number; to: number };
  /** Milliseconds per 13-step tick, and the same per step. */
  tick: Stats;
  step: Stats;
  contacts: ContactCounts;
  bursts: BurstReport[];
  /** §17's stop rule, which applies to Chromium at 4×; reported for every run. */
  stopRule: { p95LimitMs: number; tickP95: number; within: boolean };
}

type Phase = 'warmup' | 'timed' | 'bursts' | 'done';

const copy = (s: Readonly<SolverStats>): SolverStats => ({ ...s });

function counts(a: SolverStats, b: SolverStats, maxInSubstep: number): ContactCounts {
  const substeps = b.substeps - a.substeps;
  const per = (x: number): number => (substeps > 0 ? x / substeps : 0);
  const contacts = b.contacts - a.contacts;
  const floor = b.floorContacts - a.floorContacts;
  return {
    substeps, perSubstep: per(contacts), floorPerSubstep: per(floor), otherPerSubstep: per(contacts - floor),
    maxInSubstep, slipOutsPerSubstep: per(b.slipOuts - a.slipOuts),
  };
}

/** One measurement, advanced a unit of work at a time by whoever drives it. */
export class CostRun {
  readonly options: CostOptions;
  readonly bench: ReplayBench;
  private phase: Phase = 'warmup';
  private count = 0;
  private readonly tickMs: number[] = [];
  private readonly burstMs: number[][];
  private readonly burstStats: { substeps: number; contacts: number }[];
  private timedFrom: SolverStats | null = null;
  private timedTo: SolverStats | null = null;
  private maxInSubstep = 0;
  private baseFrom = 0;
  private baseTo = 0;

  constructor(options: Partial<CostOptions> = {}) {
    this.options = { ...DEFAULT_COST, ...options };
    const o = this.options;
    this.bench = createReplayBench({ script: o.script, window: WINDOW, warmTicks: o.settleTicks, ...(o.slipOut ? { slipOut: o.slipOut } : {}) });
    this.burstMs = o.bursts.map(() => []);
    this.burstStats = o.bursts.map(() => ({ substeps: 0, contacts: 0 }));
  }

  get done(): boolean {
    return this.phase === 'done';
  }

  /** Which part of the run comes next, and how far into it. */
  progress(): { phase: Phase; done: number; of: number } {
    const o = this.options;
    const of = this.phase === 'warmup' ? o.warmupTicks : this.phase === 'timed' ? o.ticks : this.phase === 'bursts' ? o.bursts.length * o.burstRuns : 0;
    return { phase: this.phase, done: this.count, of };
  }

  /** Does the next unit of work, timing it with `now` (ms). False once the run is over. */
  step(now: () => number): boolean {
    const o = this.options;
    const b = this.bench;
    if (this.phase === 'warmup') {
      if (this.count < o.warmupTicks) {
        b.tick();
        this.count++;
        return true;
      }
      this.phase = 'timed';
      this.count = 0;
      this.timedFrom = copy(b.stats());
      // The most contacts in one substep is a running maximum: start it over
      // for the timed window. The bench hands out its live counters.
      (b.stats() as SolverStats).maxContacts = 0;
      this.baseFrom = b.base.tick;
    }
    if (this.phase === 'timed') {
      if (this.count < o.ticks) {
        const t0 = now();
        b.tick();
        this.tickMs.push(now() - t0);
        this.count++;
        return true;
      }
      this.timedTo = copy(b.stats());
      this.maxInSubstep = b.stats().maxContacts;
      this.baseTo = b.base.tick;
      this.phase = 'bursts';
      this.count = 0;
    }
    if (this.phase === 'bursts') {
      const total = o.bursts.length * o.burstRuns;
      if (this.count < total) {
        const i = this.count % o.bursts.length;
        const before = copy(b.stats());
        const t0 = now();
        b.burst(o.bursts[i]!);
        this.burstMs[i]!.push(now() - t0);
        const after = b.stats();
        this.burstStats[i]!.substeps += after.substeps - before.substeps;
        this.burstStats[i]!.contacts += after.contacts - before.contacts;
        b.tick();
        this.count++;
        return true;
      }
      this.phase = 'done';
    }
    return false;
  }

  report(): CostReport {
    const o = this.options;
    const tick = stats(this.tickMs);
    const zero = { substeps: 0, contacts: 0, floorContacts: 0, maxContacts: 0, slipOuts: 0 };
    return {
      script: this.bench.script.name,
      slipOut: this.bench.script.slipOut,
      packSize: this.bench.script.packSize,
      window: WINDOW,
      stepsPerTick: STEPS_PER_TICK,
      settleTicks: o.settleTicks,
      warmupTicks: o.warmupTicks,
      baseTicks: { from: this.baseFrom, to: this.baseTo },
      tick,
      step: scaled(tick, 1 / STEPS_PER_TICK),
      contacts: counts(this.timedFrom ?? zero, this.timedTo ?? this.timedFrom ?? zero, this.maxInSubstep),
      bursts: o.bursts.map((steps, i) => {
        const ms = stats(this.burstMs[i]!);
        const st = this.burstStats[i]!;
        const over = this.burstMs[i]!.filter((x) => x > FRAME_LIMIT_MS).length;
        return {
          steps, runs: ms.n, ms, perStepMs: ms.p50 / steps, limitMs: FRAME_LIMIT_MS, overLimit: over,
          within: ms.n > 0 && ms.max <= FRAME_LIMIT_MS, contactsPerSubstep: st.substeps > 0 ? st.contacts / st.substeps : 0,
        };
      }),
      stopRule: { p95LimitMs: STOP_RULE_P95_MS, tickP95: tick.p95, within: tick.n > 0 && tick.p95 <= STOP_RULE_P95_MS },
    };
  }
}

/** The smallest step the clock shows, in ms, by sampling it. */
export function clockResolution(now: () => number, samples = 20_000): number {
  let best = Infinity;
  let last = now();
  for (let i = 0; i < samples; i++) {
    const t = now();
    if (t !== last) {
      best = Math.min(best, t - last);
      last = t;
    }
  }
  return best;
}
