import { describe, expect, it, vi } from 'vitest';
import { BURST_STEPS, clockResolution, COST_SCRIPTS, CostRun, STEPS_PER_TICK, stats } from './cost';

// Runs whole scrums; under a parallel run they need more than vitest's 5 s.
vi.setConfig({ testTimeout: 60_000 });

// src/cost.ts, the harness run 3 shares between the page and Node.
describe('the tick-cost harness', () => {
  it('takes quantiles as roslambo does', () => {
    expect(stats([5, 1, 4, 2, 3])).toEqual({ n: 5, mean: 3, min: 1, p50: 3, p95: 5, p99: 5, max: 5 });
    expect(stats([])).toMatchObject({ n: 0, mean: 0, max: 0 });
  });

  it('settles, warms up, times each 13-step tick, then each burst, one unit of work per step()', () => {
    const run = new CostRun({ settleTicks: 10, warmupTicks: 2, ticks: 5, burstRuns: 2 });
    expect(run.bench.base.tick).toBe(10);
    // A clock that moves 1 ms each time it's read: every timed unit takes 1 ms.
    let t = 0;
    const now = (): number => t++;
    const phases: string[] = [];
    let units = 0;
    for (;;) {
      phases.push(run.progress().phase);
      if (!run.step(now)) break;
      units++;
    }
    expect(units).toBe(2 + 5 + 3 * 2);
    expect(phases.slice(0, 3)).toEqual(['warmup', 'warmup', 'warmup']);
    expect(run.done).toBe(true);
    expect(run.step(now)).toBe(false);
    const r = run.report();
    expect(r).toMatchObject({ script: COST_SCRIPTS[0], slipOut: 'flag42', packSize: 4, window: 12, stepsPerTick: STEPS_PER_TICK });
    expect(r.tick).toMatchObject({ n: 5, mean: 1, max: 1 });
    expect(r.step.mean).toBeCloseTo(1 / 13, 12);
    // The base moved one tick per 13-step tick, timed or not, and per burst's untimed tick after it.
    expect(r.baseTicks).toEqual({ from: 12, to: 17 });
    expect(run.bench.base.tick).toBe(10 + 2 + 5 + 3 * 2);
    expect(r.contacts.substeps).toBe(5 * 13 * 4);
    expect(r.contacts.perSubstep).toBeGreaterThan(0);
    expect(r.contacts.floorPerSubstep + r.contacts.otherPerSubstep).toBeCloseTo(r.contacts.perSubstep, 12);
    expect(r.contacts.maxInSubstep).toBeGreaterThan(0);
    expect(r.bursts.map((b) => [b.steps, b.runs, b.ms.max, b.within])).toEqual(BURST_STEPS.map((s) => [s, 2, 1, true]));
    expect(r.bursts[2]!.perStepMs).toBeCloseTo(1 / 270, 12);
    expect(r.stopRule).toEqual({ p95LimitMs: 4, tickP95: 1, within: true });
  });

  it('flags a burst over the 50 ms frame, and a p95 over the stop rule', () => {
    const run = new CostRun({ script: COST_SCRIPTS[1]!, settleTicks: 0, warmupTicks: 0, ticks: 3, burstRuns: 1 });
    let t = 0;
    // Each read moves the clock 60 ms: every unit takes 60 ms.
    while (run.step(() => (t += 60)));
    const r = run.report();
    expect(r.script).toBe('scrum in the corner, flag42');
    expect(r.stopRule.within).toBe(false);
    expect(r.bursts.every((b) => !b.within && b.overLimit === 1)).toBe(true);
  });

  it('reads the clock’s step', () => {
    let t = 0;
    expect(clockResolution(() => Math.floor((t += 0.3) / 5) * 5, 1000)).toBe(5);
  });
});
