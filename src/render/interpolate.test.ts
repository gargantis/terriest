import { describe, expect, it } from 'vitest';
import { HALF_TURN, QUARTER_TURN, TURN } from '../core/sim/math';
import { defaultParams } from '../core/sim/params';
import { placedMatch } from '../core/sim/scenes';
import { AIRBORNE, cloneState, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, NEVER, RUNNING, START_COUNTDOWN } from '../core/sim/state';
import type { PrevShift } from './frame';
import { interpolate, lerpAngle, newDrawnMatch, placementBetween, spreadFraction, toRadians } from './interpolate';

// The drawn match between the timeline's two drawn heads (PLAN §12's "Each
// frame", D-16; M4's design §1.13, §2.2): bodies linearly and angles the
// short way, the fraction spread over a catch-up so the drawn time stays a
// tick behind the clock, nothing interpolated across a kickoff placement,
// an arrival or a slot change, and the discrete fields from the nearer
// state. On placed states from M2's scenes, moved by hand.

const P = defaultParams;

/** A placed 2-a-side match in play at `tick`. */
function at(tick: number, change: (s: MatchState) => void = () => {}): MatchState {
  const s = placedMatch(P, 2);
  s.tick = tick;
  change(s);
  return s;
}

/** prev, and head `k` ticks on with the change made to a copy. */
function pair(k: number, change: (s: MatchState) => void, from = 10): [MatchState, MatchState] {
  const prev = at(from);
  const head = cloneState(prev);
  head.tick = from + k;
  change(head);
  return [prev, head];
}

describe('angles the short way round (roslambo)', () => {
  it('lerps binary angles across zero in both directions', () => {
    expect(lerpAngle(TURN - 100, 100, 0.5)).toBe(0);
    expect(lerpAngle(100, TURN - 100, 0.5)).toBe(0);
    expect(lerpAngle(TURN - 100, 100, 0.25)).toBe(TURN - 50);
    expect(lerpAngle(0, QUARTER_TURN, 0.5)).toBe(QUARTER_TURN / 2);
    // Just over half a turn apart goes the other way round.
    expect(lerpAngle(0, HALF_TURN + 2, 0.5)).toBe(TURN - (HALF_TURN - 2) / 2);
    expect(toRadians(QUARTER_TURN)).toBeCloseTo(Math.PI / 2, 15);
  });

  it("turns a terrier's heading the short way, and wraps its gait into a fraction of a cycle", () => {
    const [prev, head] = pair(1, (s) => {
      s.terriers[0]!.heading = 100;
      s.terriers[0]!.gait = TURN / 8;
    });
    prev.terriers[0]!.heading = TURN - 100;
    prev.terriers[0]!.gait = TURN - TURN / 8;
    const d = interpolate(prev, head, 0.5, null, newDrawnMatch()).terriers[0]!;
    expect(d.heading).toBe(0);
    expect(d.gait).toBe(0);
    const e = interpolate(prev, head, 0.25, null, newDrawnMatch()).terriers[0]!;
    expect(e.heading).toBeCloseTo(toRadians(TURN - 50), 9);
  });
});

describe('the drawn match (PLAN §12)', () => {
  it('moves bodies linearly by the fraction, a tick behind the head', () => {
    const [prev, head] = pair(1, (s) => {
      s.ball.x = 2;
      s.ball.vz = 4;
      s.terriers[1]!.y += 1;
    });
    const m = interpolate(prev, head, 0.25, null, newDrawnMatch());
    expect([m.time, m.headTick, m.fraction]).toEqual([10.25, 11, 0.25]);
    expect(m.ball.x).toBe(0.5);
    expect(m.ball.vz).toBe(1);
    expect(m.terriers[1]!.y).toBeCloseTo(prev.terriers[1]!.y + 0.25, 12);
    expect(interpolate(prev, head, 0, null, newDrawnMatch()).ball.x).toBe(0);
    expect(interpolate(prev, head, 1, null, newDrawnMatch()).ball.x).toBe(2);
    // The fraction is clamped: the head is never drawn past, nor prev before.
    expect(interpolate(prev, head, 7, null, newDrawnMatch()).ball.x).toBe(2);
    expect(interpolate(prev, head, -1, null, newDrawnMatch()).ball.x).toBe(0);
  });

  it('spreads the fraction over the k ticks of a catch-up, the drawn time still a tick behind the clock', () => {
    const [prev, head] = pair(6, (s) => {
      s.ball.x = 6;
    });
    expect(spreadFraction(prev, head, 0.5)).toBeCloseTo(5.5 / 6, 15);
    for (const f of [0, 0.5, 1]) {
      const m = interpolate(prev, head, f, null, newDrawnMatch());
      expect(m.time, `f ${f}`).toBe(15 + f);
      // As if the six ticks were one: the ball, at a metre a tick, is where the drawn time says.
      expect(m.ball.x, `f ${f}`).toBeCloseTo(5 + f, 12);
    }
  });

  it('takes the discrete fields from the nearer state, so a phase starting at the head shows from halfway through the tick before', () => {
    const [prev, head] = pair(1, (s) => {
      s.terriers[0]!.anim = AIRBORNE;
      s.terriers[0]!.animStart = 11;
      s.terriers[0]!.takeOffTick = 11;
      s.ball.lastHitTick = 11;
      s.ball.lastHitDvx = 3;
      s.phase = START_COUNTDOWN;
    });
    prev.terriers[0]!.anim = RUNNING;
    prev.terriers[0]!.animStart = 3;
    const before = interpolate(prev, head, 0.49, null, newDrawnMatch());
    expect([before.terriers[0]!.anim, before.terriers[0]!.animStart, before.terriers[0]!.takeOffTick]).toEqual([RUNNING, 3, NEVER]);
    expect([before.ball.lastHitTick, before.ball.lastHitDv[0], before.phase]).toEqual([NEVER, 0, IN_PLAY]);
    const after = interpolate(prev, head, 0.5, null, newDrawnMatch());
    expect([after.terriers[0]!.anim, after.terriers[0]!.animStart, after.terriers[0]!.takeOffTick]).toEqual([AIRBORNE, 11, 11]);
    expect([after.ball.lastHitTick, after.ball.lastHitDv[0], after.phase]).toEqual([11, 3, START_COUNTDOWN]);
    // After a catch-up the spread fraction is past halfway from its first tick: the head's.
    const [far, farHead] = pair(6, (s) => {
      s.terriers[0]!.anim = AIRBORNE;
    });
    expect(interpolate(far, farHead, 0, null, newDrawnMatch()).terriers[0]!.anim).toBe(AIRBORNE);
  });

  it('takes a new push and a new overhead reference from the nearer state, not part-way to an old one', () => {
    const [prev, head] = pair(1, (s) => {
      const T = s.terriers[0]!;
      T.lastPushTick = 11;
      T.lastPushDir = QUARTER_TURN;
      T.ballOverhead = true;
      T.overheadRef = HALF_TURN;
    });
    prev.terriers[0]!.lastPushTick = 2;
    prev.terriers[0]!.lastPushDir = 0;
    const d = interpolate(prev, head, 0.75, null, newDrawnMatch()).terriers[0]!;
    expect(d.lastPushDir).toBeCloseTo(Math.PI / 2, 12);
    expect(d.overheadRef).toBeCloseTo(Math.PI, 12);
  });

  it('draws the head as it is across a kickoff placement, one inside a 6-tick catch-up included', () => {
    const placed = (k: number, start: number): [MatchState, MatchState] =>
      pair(k, (s) => {
        s.phase = KICKOFF_COUNTDOWN;
        s.phaseStart = start;
        s.terriers[0]!.x = -10;
        s.ball.x = 0;
      });
    for (const [k, start] of [[1, 11], [6, 13], [6, 16]] as const) {
      const [prev, head] = placed(k, start);
      prev.terriers[0]!.x = 15;
      prev.ball.x = 5;
      expect(placementBetween(prev, head), `${k} ticks, placed at ${start}`).toBe(true);
      const m = interpolate(prev, head, 0.1, null, newDrawnMatch());
      expect([m.terriers[0]!.x, m.ball.x], `${k} ticks, placed at ${start}`).toEqual([-10, 0]);
      expect(m.time).toBe(head.tick - 1 + 0.1);
    }
    // A countdown that began at or before prev's tick has no placement between them: interpolated.
    const [prev, head] = placed(1, 10);
    prev.phase = KICKOFF_COUNTDOWN;
    prev.phaseStart = 10;
    prev.terriers[0]!.x = -12;
    expect(placementBetween(prev, head)).toBe(false);
    expect(interpolate(prev, head, 0.5, null, newDrawnMatch()).terriers[0]!.x).toBe(-11);
  });

  it("draws a terrier that arrived, or whose slot changed, as the head has it; the rest by ID", () => {
    const [prev, head] = pair(1, (s) => {
      for (const T of s.terriers) T.x += 1;
    });
    const arrived = prev.terriers.pop()!;
    const switched = head.terriers[1]!;
    prev.terriers[1]!.spot = 1;
    // prev's list in another order: matched by ID, not by index.
    prev.terriers.reverse();
    const m = interpolate(prev, head, 0.5, null, newDrawnMatch());
    expect(m.terriers.map((d) => d.id)).toEqual(head.terriers.map((T) => T.id));
    expect(m.terriers[0]!.x).toBe(head.terriers[0]!.x - 0.5);
    expect(m.terriers[2]!.x).toBe(head.terriers[2]!.x - 0.5);
    expect(m.terriers[1]!.x, 'switched').toBe(switched.x);
    expect(m.terriers[3]!.x, 'arrived').toBe(head.terriers[3]!.x);
    expect(arrived.id).toBe(head.terriers[3]!.id);
  });

  it("shifts prev's bodies by a correction's prevShift, the ball's under 'ball', in metres and radians", () => {
    const [prev, head] = pair(1, (s) => {
      s.ball.x = 2;
    });
    const T = head.terriers[0]!;
    const shift: PrevShift = new Map([
      ['ball', { dx: 1, dy: 0, dz: 0, dh: 0 }],
      [T.id, { dx: 0, dy: 2, dz: 0, dh: Math.PI / 2 }],
    ]);
    const start = interpolate(prev, head, 0, shift, newDrawnMatch());
    expect(start.ball.x).toBe(1);
    expect(start.terriers[0]!.y).toBe(T.y + 2);
    // A quarter turn on from the head's heading, whichever way round 2π it's written.
    const turned = start.terriers[0]!.heading - toRadians(T.heading) - Math.PI / 2;
    expect(Math.abs(Math.sin(turned)) + Math.abs(1 - Math.cos(turned))).toBeLessThan(1e-9);
    const end = interpolate(prev, head, 1, shift, newDrawnMatch());
    expect([end.ball.x, end.terriers[0]!.y]).toEqual([2, T.y]);
  });

  it('writes its output in place, reusing it, and leaves both states as they were', () => {
    const [prev, head] = pair(1, (s) => {
      s.ball.x = 2;
    });
    const before = JSON.stringify([prev, head]);
    const out = newDrawnMatch();
    const first = interpolate(prev, head, 0.5, null, out);
    const terrier = first.terriers[0];
    const again = interpolate(prev, head, 0.75, null, out);
    expect(again).toBe(out);
    expect(again.terriers[0]).toBe(terrier);
    expect(JSON.stringify([prev, head])).toBe(before);
    // Fewer terriers in the head, then more again.
    const fewer = cloneState(head);
    fewer.terriers.length = 1;
    expect(interpolate(prev, fewer, 0.5, null, out).terriers).toHaveLength(1);
    expect(interpolate(prev, head, 0.5, null, out).terriers.map((d) => d.id)).toEqual(head.terriers.map((T) => T.id));
  });
});
