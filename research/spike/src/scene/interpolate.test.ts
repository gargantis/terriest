import { describe, expect, it } from 'vitest';
import type { MatchView, TerrierView } from '../contract';
import { angleDelta, interpolate, snapshot } from './interpolate';

const TURN = 4294967296;

function terrier(over: Partial<TerrierView> = {}): TerrierView {
  return {
    pack: 0, spot: 0, coat: 0, x: 0, y: 0, z: 0.25, vx: 0, vy: 0, vz: 0,
    heading: 0, phase: 'standing', phaseStartTick: 0, gait: 0, lastBallContactTick: -1, ...over,
  };
}

function view(tick: number, t: Partial<TerrierView>, ball: Partial<MatchView['ball']> = {}): MatchView {
  return {
    tick, terriers: [terrier(t)],
    ball: { x: 0, y: 0, z: 0.8, vx: 0, vy: 0, vz: 0, lastHitTick: -1, lastHitStrength: 0, ...ball },
  };
}

describe('interpolation between two ticks (PLAN §12)', () => {
  it('takes binary angles the short way round, across the wrap', () => {
    expect(angleDelta(TURN - 10, 5)).toBe(15);
    expect(angleDelta(5, TURN - 10)).toBe(-15);
    expect(angleDelta(0, TURN / 2 - 1)).toBe(TURN / 2 - 1);
    // Halfway from just below a whole turn to just above it is the whole turn.
    const f = interpolate(view(9, { heading: TURN - 100 }), view(10, { heading: 100 }), 0.5);
    expect(f.terriers[0]!.heading).toBeCloseTo(2 * Math.PI, 12);
  });

  it('interpolates positions linearly and the time by the fraction', () => {
    const f = interpolate(view(9, { x: 1, y: -2 }, { z: 1 }), view(10, { x: 2, y: -4 }, { z: 2 }), 0.25);
    expect(f.time).toBe(9.25);
    expect(f.tick).toBe(9);
    expect(f.terriers[0]!.x).toBe(1.25);
    expect(f.terriers[0]!.y).toBe(-2.5);
    expect(f.ball.z).toBe(1.25);
  });

  it('wraps the gait into a fraction of a cycle', () => {
    const f = interpolate(view(9, { gait: TURN - TURN / 8 }), view(10, { gait: TURN / 8 }), 0.5);
    expect(f.terriers[0]!.gait).toBe(0);
    const g = interpolate(view(9, { gait: TURN / 4 }), view(10, { gait: TURN / 2 }), 0.5);
    expect(g.terriers[0]!.gait).toBe(0.375);
  });

  it('takes discrete fields from the nearer view', () => {
    const a = view(9, { phase: 'running', phaseStartTick: 3 }, { lastHitTick: 2 });
    const b = view(10, { phase: 'airborne', phaseStartTick: 10 }, { lastHitTick: 10 });
    expect(interpolate(a, b, 0.49).terriers[0]!.phase).toBe('running');
    expect(interpolate(a, b, 0.5).terriers[0]!.phase).toBe('airborne');
    expect(interpolate(a, b, 0.49).ball.lastHitTick).toBe(2);
    expect(interpolate(a, b, 0.5).ball.lastHitTick).toBe(10);
  });

  it('clamps the fraction and copies the last goal only when there is one', () => {
    const a = view(9, { x: 0 });
    const b: MatchView = { ...view(10, { x: 1 }), lastGoal: { tick: 10, pack: 1 } };
    expect(interpolate(a, b, 7).terriers[0]!.x).toBe(1);
    expect(interpolate(a, b, -1).terriers[0]!.x).toBe(0);
    expect('lastGoal' in interpolate(a, b, 0.2)).toBe(false);
    expect(interpolate(a, b, 0.8).lastGoal).toEqual({ tick: 10, pack: 1 });
  });

  it('snapshots a view, so a source that reuses its object cannot change it', () => {
    const v = view(3, { x: 1 });
    const s = snapshot(v);
    v.terriers[0]!.x = 99;
    v.ball.x = 99;
    expect(s.terriers[0]!.x).toBe(1);
    expect(s.ball.x).toBe(0);
  });
});
