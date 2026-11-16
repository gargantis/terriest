import { describe, expect, it } from 'vitest';
import type { AnimPhase } from '../contract';
import { StubSource } from './stub-source';

const TURN = 4294967296;

describe('the stub source (until integration)', () => {
  it('lists 2 x packSize terriers in (spot, pack) order', () => {
    for (const n of [1, 2, 3, 4]) {
      const v = new StubSource(n).view();
      expect(v.terriers.map((t) => [t.spot, t.pack])).toEqual(Array.from({ length: 2 * n }, (_, i) => [i >> 1, i & 1]));
    }
    expect(() => new StubSource(5)).toThrow();
  });

  it('is deterministic however its ticks are batched', () => {
    const a = new StubSource(4);
    const b = new StubSource(4);
    a.advance(1500);
    for (const k of [1, 2, 3, 7, 120, 1, 366, 1000]) b.advance(k);
    expect(b.view().tick).toBe(1500);
    expect(b.view()).toEqual(a.view());
  });

  it('keeps headings and gaits as u32 binary angles', () => {
    const s = new StubSource(4);
    for (let i = 0; i < 40; i++) {
      s.advance(37);
      for (const t of s.view().terriers) {
        for (const a of [t.heading, t.gait]) {
          expect(Number.isInteger(a)).toBe(true);
          expect(a >= 0 && a < TURN).toBe(true);
        }
      }
    }
  });

  it('runs every terrier through every animation phase, hits the ball and scores', () => {
    const s = new StubSource(4);
    const seen = new Set<AnimPhase>();
    let hits = 0;
    let lastHit = -1;
    let contacts = 0;
    for (let i = 0; i < 3000; i++) {
      s.advance(1);
      const v = s.view();
      for (const t of v.terriers) {
        seen.add(t.phase);
        if (t.lastBallContactTick === v.tick) contacts++;
      }
      if (v.ball.lastHitTick !== lastHit) {
        hits++;
        lastHit = v.ball.lastHitTick;
        expect(v.ball.lastHitStrength).toBeGreaterThan(0);
      }
    }
    expect([...seen].sort()).toEqual(['airborne', 'gettingUp', 'lunging', 'running', 'sitting', 'standing', 'tumbled', 'zooming']);
    expect(hits).toBeGreaterThan(5);
    expect(contacts).toBeGreaterThan(0);
    expect(s.view().lastGoal).toEqual({ tick: 3000, pack: 0 });
  });

  it('leaves lastGoal out until there is one (exactOptionalPropertyTypes)', () => {
    expect('lastGoal' in new StubSource(2).view()).toBe(false);
  });

  it('keeps every body inside the walls and on or above the floor', () => {
    const s = new StubSource(4);
    for (let i = 0; i < 200; i++) {
      s.advance(15);
      const v = s.view();
      for (const t of v.terriers) {
        expect(Math.abs(t.x)).toBeLessThanOrEqual(20);
        expect(Math.abs(t.y)).toBeLessThanOrEqual(14);
        expect(Math.abs(t.x) + Math.abs(t.y)).toBeLessThanOrEqual(30);
        expect(t.z).toBeGreaterThanOrEqual(0.25);
      }
      expect(v.ball.z).toBeGreaterThanOrEqual(0.8);
    }
  });
});
