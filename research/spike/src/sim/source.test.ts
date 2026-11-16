import { describe, expect, it, vi } from 'vitest';
import { TICK_RATE } from '../contract';
import { createReplayBench, createSimSource } from './source';

// These run whole scripted matches; under a parallel run they need more than vitest's 5 s.
vi.setConfig({ testTimeout: 120_000 });

// The sim/scene contract from the simulation's side (src/contract.ts).
describe('createSimSource', () => {
  it('plays the showcase at every pack size, advanced by the clock', () => {
    for (let packSize = 1; packSize <= 4; packSize++) {
      const src = createSimSource({ packSize });
      expect(src.packSize).toBe(packSize);
      const v0 = src.view();
      expect(v0.tick).toBe(0);
      expect(v0.terriers.length).toBe(2 * packSize);
      expect(v0.lastGoal).toBeUndefined();
      // Advanced a second at a time for 20 s: terriers leave their spots
      // (a goal's kickoff puts them back, so the furthest is kept), and the
      // ball is hit.
      let furthest = 0;
      for (let sec = 0; sec < 20; sec++) {
        src.advance(TICK_RATE);
        for (const [k, t] of src.view().terriers.entries()) furthest = Math.max(furthest, Math.hypot(t.x - v0.terriers[k]!.x, t.y - v0.terriers[k]!.y));
      }
      const v = src.view();
      expect(v.tick).toBe(TICK_RATE * 20);
      expect(furthest).toBeGreaterThan(1);
      expect(v.ball.lastHitTick).toBeGreaterThan(0);
      for (const t of v.terriers) {
        expect(t.pack === 0 || t.pack === 1).toBe(true);
        expect(t.heading).toBeGreaterThanOrEqual(0);
        expect(t.heading).toBeLessThan(2 ** 32);
        expect(['standing', 'running', 'zooming', 'airborne', 'lunging', 'tumbled', 'gettingUp', 'sitting']).toContain(t.phase);
      }
    }
  });

  it('is deterministic: two sources with the same options agree, however they are advanced', () => {
    const a = createSimSource({ packSize: 3 });
    const b = createSimSource({ packSize: 3 });
    a.advance(600);
    for (let i = 0; i < 600; i++) b.advance(1);
    expect(a.hash()).toBe(b.hash());
    expect(b.view()).toEqual(a.view());
  });

  it('plays a named golden script and its rule, and refuses a pack size that differs', () => {
    const src = createSimSource({ script: 'goals', slipOut: 'flag42E0' });
    expect(src.packSize).toBe(1);
    expect(src.script.slipOut).toBe('flag42E0');
    src.advance(400);
    expect(src.view().lastGoal).toEqual({ tick: expect.any(Number), pack: 1 });
    expect(() => createSimSource({ script: 'goals', packSize: 2 })).toThrow();
    expect(() => createSimSource({ script: 'no such script' })).toThrow();
  });

  it('ignores fractional and negative advances', () => {
    const src = createSimSource({ packSize: 1 });
    src.advance(2.7);
    src.advance(-5);
    expect(src.view().tick).toBe(2);
  });
});

describe('createReplayBench', () => {
  it('re-steps the window from the base each tick, and leaves the base one tick on', () => {
    const bench = createReplayBench({ warmTicks: 60 });
    const t0 = bench.base.tick;
    bench.tick();
    bench.tick();
    expect(bench.base.tick).toBe(t0 + 2);
    expect(bench.stats().substeps).toBe(2 * 13 * 4);
    bench.burst(30);
    expect(bench.base.tick).toBe(t0 + 2);
    expect(bench.stats().substeps).toBe(2 * 13 * 4 + 30 * 4);
  });
});
