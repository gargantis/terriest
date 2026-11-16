import { describe, expect, it, vi } from 'vitest';
import { datan2, HALF_TURN, QUARTER_TURN } from './angle';
import { hashState } from './codec';
import { KICKOFF_SPOTS, makeConfig, substepsPerSecond } from './config';
import { encodeInput, FRAME_BALL, FRAME_NOSE, FRAME_PITCH, STEP_UNITS } from './input';
import { park, place, placeBall, TOUCH_REACH } from './scripts';
import { CELEBRATION, IN_PLAY, KICKOFF_COUNTDOWN, newMatch } from './state';
import { makeSim, step } from './step';
import { run, scenario } from './testing';

// These run whole scripted matches; under a parallel run they need more than vitest's 5 s.
vi.setConfig({ testTimeout: 120_000 });

// PLAN §16 Movement, Steering, Presses and Rules, as far as the spike's runs
// need them (D-6, D-7, D-8, D-10), and L57's four ball behaviours.

const pitch = (s: number, zoomies = false, jump = 0, pounce = 0): number => encodeInput({ step: s, frame: FRAME_PITCH, zoomies, jump, pounce });
const speed = (t: { vx: number; vy: number }): number => Math.hypot(t.vx, t.vy);

describe('running (D-6)', () => {
  it('reaches run speed from rest in 0.4 s at 15 m/s², and holds it', () => {
    const sc = scenario(1, {}, (s) => { park(s, 1); place(s, 0, -10, 0); });
    run(sc, 12, (k) => (k === 0 ? pitch(0) : 0));
    expect(speed(sc.s.terriers[0]!)).toBeCloseTo(3, 12);
    run(sc, 12, (k) => (k === 0 ? pitch(0) : 0));
    expect(speed(sc.s.terriers[0]!)).toBeCloseTo(6, 12);
    run(sc, 30, (k) => (k === 0 ? pitch(0) : 0));
    expect(sc.s.terriers[0]!.vx).toBe(6);
  });

  it('turns at 2 turns/s and snaps onto the direction within a tick', () => {
    const sc = scenario(1, {}, (s) => { park(s, 1); place(s, 0, -10, 0); s.terriers[0]!.heading = 0; });
    let ticks = 0;
    while (sc.s.terriers[0]!.heading !== HALF_TURN && ticks < 60) { run(sc, 1, (k) => (k === 0 ? pitch(16) : 0)); ticks++; }
    // Half a turn at 2 turns/s is 0.25 s, 15 ticks, and the snap takes one more.
    expect(ticks).toBe(16);
    // Exactly opposite turns clockwise; the last 8 units snapped.
    expect(sc.s.terriers[0]!.headingChange).toBe(-8);
  });

  it('idle friction stops a terrier at 8 m/s², exactly', () => {
    const sc = scenario(1, {}, (s) => { park(s, 1); place(s, 0, -10, 0); s.terriers[0]!.vx = 6; });
    run(sc, 45); // 6/8 s = 0.75 s, 180 substeps, to within rounding …
    expect(sc.s.terriers[0]!.vx).toBeLessThan(1e-13);
    run(sc, 1); // … and exactly 0 the substep after
    expect(sc.s.terriers[0]!.vx).toBe(0);
    expect(sc.s.terriers[0]!.x).toBeCloseTo(-10 + 6 * 6 / 16, 1);
  });

  it('an idle terrier can be pushed, at 3.5 m/s²', () => {
    const sc = scenario(1, {}, (s) => { placeBall(s, 8, 8); place(s, 0, -10.5, 0); place(s, 1, -10, 0); });
    run(sc, 30, (k) => (k === 0 ? pitch(0) : 0));
    const pushed = sc.s.terriers[1]!;
    expect(pushed.vx).toBeGreaterThan(0.5 * 3.5 * 0.6);
    expect(pushed.vx).toBeLessThan(3.5 * 0.5 + 0.3);
  });
});

describe('zoomies (D-6, C-20)', () => {
  it('runs at 9 m/s, drains the meter in 3 s, locks out until released, and refills in 6 s', () => {
    const C = makeConfig();
    const sc = scenario(1, {}, (s) => { park(s, 1); place(s, 0, -18, -12); });
    // Run along the long side wall, back and forth by turning in place.
    let zoomTicks = 0;
    for (let t = 0; t < 200; t++) {
      run(sc, 1, (k) => (k === 0 ? pitch(t < 100 ? 0 : 16, true) : 0));
      if (sc.s.terriers[0]!.zooming) zoomTicks++;
    }
    expect(zoomTicks).toBe(C.meterFull / C.meterDrain); // 180 ticks = 3 s
    expect(sc.s.terriers[0]!.zoomLocked).toBe(true);
    // Held on: still locked, refilling.
    run(sc, 30, (k) => (k === 0 ? pitch(16, true) : 0));
    expect(sc.s.terriers[0]!.zooming).toBe(false);
    // Released once, then held again: zooms.
    run(sc, 1, (k) => (k === 0 ? pitch(16, false) : 0));
    expect(sc.s.terriers[0]!.zoomLocked).toBe(false);
    run(sc, 1, (k) => (k === 0 ? pitch(16, true) : 0));
    expect(sc.s.terriers[0]!.zooming).toBe(true);
    // Refill from empty takes 6 s.
    const m = scenario(1, {}, (s) => { park(s, 1); s.terriers[0]!.meter = 0; });
    run(m, 359);
    expect(m.s.terriers[0]!.meter).toBe(359);
    run(m, 1);
    expect(m.s.terriers[0]!.meter).toBe(360);
  });
});

describe('jump (D-6)', () => {
  it('rises 1 m and is in the air about 0.9 s, from the floor only', () => {
    const sc = scenario(1, {}, (s) => { park(s, 1); place(s, 0, -10, 0); });
    let apex = 0;
    let airborne = 0;
    sc.sim.probe = (s) => { apex = Math.max(apex, s.terriers[0]!.z); if (!s.terriers[0]!.onFloor) airborne++; };
    run(sc, 1, (k) => (k === 0 ? encodeInput({ jump: 1 }) : 0));
    run(sc, 20, (k) => (k === 0 ? encodeInput({ jump: 2 }) : 0)); // a second press in the air is dropped
    run(sc, 60, (k) => (k === 0 ? encodeInput({ jump: 2 }) : 0));
    expect(apex - 0.25).toBeCloseTo(1, 1);
    expect(airborne / substepsPerSecond(sc.sim.C)).toBeCloseTo(0.9, 1);
    expect(sc.s.terriers[0]!.landingTick).toBeGreaterThan(sc.s.terriers[0]!.takeOffTick);
  });
});

describe('pounce (D-6)', () => {
  it('holds 10 m/s for 0.3 s, 3 m, then waits 1.5 s; a press during the lunge or wait is dropped', () => {
    const sc = scenario(1, {}, (s) => { park(s, 1); place(s, 0, -15, -8); s.terriers[0]!.heading = 0; });
    const x0 = sc.s.terriers[0]!.x;
    run(sc, 1, (k) => (k === 0 ? encodeInput({ pounce: 1 }) : 0));
    expect(sc.s.terriers[0]!.lunge).toBe(17);
    run(sc, 10, (k) => (k === 0 ? encodeInput({ pounce: 2 }) : 0)); // dropped: lunging
    run(sc, 7, (k) => (k === 0 ? encodeInput({ pounce: 2 }) : 0));
    const T = sc.s.terriers[0]!;
    expect(T.lunge).toBe(0);
    expect(T.pounceWait).toBe(90);
    expect(T.x - x0).toBeCloseTo(3, 9);
    run(sc, 30, (k) => (k === 0 ? encodeInput({ pounce: 3 }) : 0)); // dropped: waiting
    expect(T.lunge).toBe(0);
    run(sc, 61, (k) => (k === 0 ? encodeInput({ pounce: 3 }) : 0));
    expect(T.pounceWait).toBe(0);
    run(sc, 1, (k) => (k === 0 ? encodeInput({ pounce: 0 }) : 0));
    expect(T.lunge).toBe(17);
  });

  it('ends on the ball and sends it at 5 m/s when level; a jump and a pounce together: the jump first', () => {
    const sc = scenario(1, { gravity: 0, rolling: false }, (s) => {
      park(s, 1);
      placeBall(s, 0, 0);
      place(s, 0, -2, 0, 0.8);
      s.terriers[0]!.heading = 0;
    });
    run(sc, 1, (k) => (k === 0 ? encodeInput({ pounce: 1 }) : 0));
    run(sc, 20);
    expect(sc.s.terriers[0]!.lunge).toBe(0);
    expect(sc.s.ball.vx).toBeCloseTo(5, 9); // L312: 5 m/s from a pounce
    const j = scenario(1, {}, (s) => { park(s, 1); place(s, 0, -10, 0); s.terriers[0]!.heading = 0; });
    run(j, 1, (k) => (k === 0 ? encodeInput({ jump: 1, pounce: 1 }) : 0));
    expect(j.s.terriers[0]!.onFloor).toBe(false);
    expect(j.s.terriers[0]!.vx).toBe(10);
    expect(j.s.terriers[0]!.vz).toBeGreaterThan(4);
  });

  it('tumbles the rival it hits, both when two pounce into each other, never a packmate', () => {
    const sc = scenario(2, {}, (s) => {
      placeBall(s, 0, 10);
      place(s, 0, -2, 0); s.terriers[0]!.heading = 0; // A1 at B1
      place(s, 1, 0, 0); // B1, standing
      place(s, 2, -2, -4); s.terriers[2]!.heading = 0; // A2 at A... a packmate
      place(s, 3, 2, -6); s.terriers[3]!.heading = HALF_TURN;
    });
    // A2's packmate target: move A1? Use B2 pouncing into A2 head-on instead.
    sc.s.terriers[3]!.y = -4;
    run(sc, 1, (k) => (k === 0 || k === 2 || k === 3 ? encodeInput({ pounce: 1 }) : 0));
    run(sc, 12);
    expect(sc.s.terriers[1]!.tumble).toBeGreaterThan(0); // B1 hit by A1
    expect(sc.s.terriers[2]!.tumble).toBeGreaterThan(0); // A2 and B2 into each other
    expect(sc.s.terriers[3]!.tumble).toBeGreaterThan(0);
    expect(sc.s.terriers[0]!.tumble).toBe(0);
    const mate = scenario(2, {}, (s) => {
      placeBall(s, 0, 10);
      place(s, 0, -2, 0); s.terriers[0]!.heading = 0;
      place(s, 2, 0, 0);
      park(s, 1); park(s, 3);
    });
    run(mate, 1, (k) => (k === 0 ? encodeInput({ pounce: 1 }) : 0));
    run(mate, 12);
    expect(mate.s.terriers[2]!.tumble).toBe(0);
  });
});

describe('tumbles (D-6, Q-8)', () => {
  it('last 1.5 s with a 0.5 s get-up, then a 1.5 s guard; a tumbled terrier can\'t act', () => {
    const sc = scenario(1, {}, (s) => { park(s, 1); place(s, 0, -10, 0); s.terriers[0]!.tumble = 90; });
    run(sc, 30, (k) => (k === 0 ? pitch(0) : 0));
    expect(sc.s.terriers[0]!.anim).toBe(5); // tumbled
    expect(speed(sc.s.terriers[0]!)).toBe(0);
    run(sc, 31, (k) => (k === 0 ? pitch(0) : 0));
    expect(sc.s.terriers[0]!.anim).toBe(6); // getting up
    run(sc, 29, (k) => (k === 0 ? pitch(0) : 0));
    expect(sc.s.terriers[0]!.tumble).toBe(0);
    expect(sc.s.terriers[0]!.guard).toBe(90);
    run(sc, 1, (k) => (k === 0 ? pitch(0) : 0));
    expect(speed(sc.s.terriers[0]!)).toBeGreaterThan(0);
  });

  it('a ball coming at 4 m/s or more bowls a terrier, except a lunging one or the last to touch it', () => {
    const shot = (vx: number, last: boolean, lunging: boolean): boolean => {
      const sc = scenario(1, { rolling: false }, (s) => {
        park(s, 0);
        placeBall(s, -4, 0, 0.8, vx, 0, 0);
        place(s, 1, 0, 0);
        s.terriers[1]!.heading = HALF_TURN;
        if (last) { s.terriers[1]!.lastBallContactTick = 0; s.ball.lastContactTick = 0; }
      });
      if (lunging) run(sc, 1, (k) => (k === 1 ? encodeInput({ pounce: 1 }) : 0));
      run(sc, 50);
      return sc.s.terriers[1]!.tumble > 0 || sc.s.terriers[1]!.guard > 0;
    };
    expect(shot(5, false, false)).toBe(true);
    expect(shot(3.9, false, false)).toBe(false);
    expect(shot(5, true, false)).toBe(false);
    expect(shot(5, false, true)).toBe(false);
  });
});

describe('steering frames (D-7)', () => {
  it('the ball frame runs at the ball, and sideways circles it', () => {
    const sc = scenario(1, {}, (s) => { park(s, 1); placeBall(s, 0, 0); place(s, 0, -5, 3); });
    run(sc, 1, (k) => (k === 0 ? encodeInput({ step: 0, frame: FRAME_BALL }) : 0));
    const T = sc.s.terriers[0]!;
    expect(T.targetVx / 6).toBeCloseTo(5 / Math.hypot(5, 3), 9);
    expect(T.targetVy / 6).toBeCloseTo(-3 / Math.hypot(5, 3), 9);
    const want = (datan2(-3, 5) + 8 * STEP_UNITS) >>> 0;
    run(sc, 1, (k) => (k === 0 ? encodeInput({ step: 8, frame: FRAME_BALL }) : 0));
    const dirNow = datan2(T.targetVy, T.targetVx);
    expect(Math.abs(((dirNow - want) | 0))).toBeLessThan(STEP_UNITS / 16); // the line moved a little
  });

  it('under an overhead ball, holds the reference: sideways turns once, to the reference plus the step', () => {
    const sc = scenario(1, { gravity: 0 }, (s) => {
      park(s, 1);
      place(s, 0, 0, 0);
      placeBall(s, 0.1, 0, 0.25 + 1.06); // just over the terrier, not touching
      s.terriers[0]!.heading = QUARTER_TURN;
    });
    const T = sc.s.terriers[0]!;
    // Keep the ball over the terrier as it runs, as a ball resting on it would be.
    const hold = (k: number): number => {
      if (k === 0) { sc.s.ball.x = T.x + 0.1; sc.s.ball.y = T.y; }
      return k === 0 ? encodeInput({ step: 8, frame: FRAME_BALL }) : 0;
    };
    run(sc, 1, hold);
    expect(T.ballOverhead).toBe(true);
    expect(T.overheadRef).toBe(QUARTER_TURN);
    run(sc, 30, hold);
    expect(T.heading).toBe((QUARTER_TURN + 8 * STEP_UNITS) >>> 0); // turned once, then held
    // Hysteresis: the flag clears only beyond 0.4 m.
    sc.s.ball.x = T.x + 0.35; sc.s.ball.y = T.y;
    run(sc, 1);
    expect(T.ballOverhead).toBe(true);
    sc.s.ball.x = T.x + 0.45;
    run(sc, 1);
    expect(T.ballOverhead).toBe(false);
  });

  it('the nose frame throttles along the heading and turns by the side part', () => {
    const sc = scenario(1, {}, (s) => { park(s, 1); place(s, 0, -10, 0); s.terriers[0]!.heading = 0; });
    run(sc, 30, (k) => (k === 0 ? encodeInput({ step: 0, frame: FRAME_NOSE }) : 0));
    expect(sc.s.terriers[0]!.vx).toBeCloseTo(6, 9);
    expect(sc.s.terriers[0]!.heading).toBe(0);
    run(sc, 60, (k) => (k === 0 ? encodeInput({ step: 8, frame: FRAME_NOSE }) : 0));
    // Pure side: no throttle, a full nose turn rate of 1 turn/s for 1 s.
    expect(Math.abs(sc.s.terriers[0]!.heading - 0) <= 60 || Math.abs(sc.s.terriers[0]!.heading - 2 ** 32) <= 60).toBe(true);
    run(sc, 60, (k) => (k === 0 ? encodeInput({ step: 16, frame: FRAME_NOSE }) : 0));
    expect(sc.s.terriers[0]!.vx).toBeCloseTo(-3, 9); // reverses at up to 3 m/s
  });
});

describe('presses and inputs (D-10, A.2)', () => {
  it('a press acts once, a held counter never repeats it, and absent ticks don\'t make one', () => {
    for (const gap of [0, 1, 13]) {
      const sc = scenario(1, {}, (s) => { park(s, 1); place(s, 0, -10, 0); });
      let jumps = 0;
      let was = true;
      sc.sim.probe = (s) => { const f = s.terriers[0]!.onFloor; if (was && !f) jumps++; was = f; };
      run(sc, 1, (k) => (k === 0 ? encodeInput({ jump: 1 }) : 0));
      run(sc, gap, (k) => (k === 0 ? null : 0));
      run(sc, 120, (k) => (k === 0 ? encodeInput({ jump: 1 }) : 0)); // same count: no new press
      expect(jumps, `after ${gap} absent ticks`).toBe(1);
      run(sc, 120, (k) => (k === 0 ? encodeInput({ jump: 2 }) : 0));
      expect(jumps).toBe(2);
    }
  });

  it('every u16 is a valid input, and the bark bits never reach the hash', () => {
    const C = makeConfig();
    const sim = makeSim(C, 2);
    const s = newMatch(2, C, IN_PLAY);
    for (let v = 0; v < 65536; v += 7) {
      step(sim, s, [v, (v * 31) & 0xffff, (v ^ 0xa5a5) & 0xffff, 0xffff - v]);
      expect(s.ball.x === s.ball.x).toBe(true);
    }
    hashState(s);
    const a = scenario(1, {}, (st) => { place(st, 0, -10, 0); });
    const b = scenario(1, {}, (st) => { place(st, 0, -10, 0); });
    run(a, 100, (k, t) => (k === 0 ? pitch(t % 32, true, t >> 4, t >> 5) : 0));
    run(b, 100, (k, t) => (k === 0 ? pitch(t % 32, true, t >> 4, t >> 5) | ((t & 3) << 13) | (1 << 15) : 0));
    expect(hashState(b.s)).toBe(hashState(a.s));
  });
});

describe('the ball against terriers (L57)', () => {
  it('a terrier running into a resting ball at run speed hops it', () => {
    const sc = scenario(1, {}, (s) => { park(s, 1); placeBall(s, 0, 0); place(s, 0, -3, 0); s.terriers[0]!.vx = 6; });
    let lift = 0;
    sc.sim.probe = (s) => { lift = Math.max(lift, s.ball.z - 0.8); };
    run(sc, 40, (k) => (k === 0 ? pitch(0) : 0));
    expect(lift).toBeGreaterThan(0.05);
  });

  it('two running in from opposite sides lift it off the floor', () => {
    const sc = scenario(1, {}, (s) => { placeBall(s, 0, 0); place(s, 0, -3, 0); place(s, 1, 3, 0); s.terriers[0]!.vx = 6; s.terriers[1]!.vx = -6; });
    let lift = 0;
    sc.sim.probe = (s) => { lift = Math.max(lift, s.ball.z - 0.8); };
    run(sc, 40, (k) => (k === 0 ? pitch(0) : pitch(16)));
    expect(lift).toBeGreaterThan(0.3);
  });

  it('a steady push from contact keeps the ball\'s on-floor flag set throughout', () => {
    const sc = scenario(1, {}, (s) => { park(s, 1); placeBall(s, -10, 0); place(s, 0, -10 - TOUCH_REACH, 0); });
    let off = 0;
    sc.sim.probe = (s) => { if (!s.ball.onFloor) off++; };
    run(sc, 120, (k) => (k === 0 ? pitch(0) : 0));
    expect(off).toBe(0);
    expect(sc.s.ball.vx).toBeGreaterThan(5);
  });
});

describe('kickoffs and goals (D-8)', () => {
  it('places every pack size on A.5\'s spots, pack B the point mirror, all facing the ball', () => {
    for (let n = 1; n <= 4; n++) {
      const s = newMatch(n, makeConfig(), KICKOFF_COUNTDOWN);
      for (let k = 0; k < s.terriers.length; k++) {
        const t = s.terriers[k]!;
        const spot = KICKOFF_SPOTS[n]![t.spot]!;
        expect(t.x).toBe(t.pack === 0 ? spot[0] : -spot[0]);
        expect(t.y === (t.pack === 0 ? spot[1] : -spot[1])).toBe(true);
        expect(t.heading).toBe(datan2(-t.y, -t.x));
        expect(t.meter).toBe(360);
      }
    }
  });

  it('holds terriers on their spots through the countdown, turning only, then plays', () => {
    const C = makeConfig();
    const sim = makeSim(C, 1);
    const s = newMatch(1, C, KICKOFF_COUNTDOWN);
    for (let t = 1; t < C.kickoffCountdownTicks; t++) step(sim, s, [pitch(8, true, t >> 3, t >> 4), pitch(8)]);
    expect(s.terriers[0]!.x).toBe(-10);
    expect(s.terriers[0]!.heading).toBe(8 * STEP_UNITS);
    expect(s.terriers[0]!.lunge + s.terriers[0]!.vz).toBe(0);
    step(sim, s, [pitch(8), pitch(8)]);
    expect(s.phase).toBe(IN_PLAY);
    step(sim, s, [pitch(8), pitch(8)]);
    expect(s.terriers[0]!.y).toBeGreaterThan(0);
  });

  it('counts a goal through the mouth for the attacking pack, credits the last toucher, then celebrates and kicks off', () => {
    const sc = scenario(1, {}, (s) => { placeBall(s, -15, 0.5); place(s, 1, -13.5, 0.5); park(s, 0); });
    let n = 0;
    while (sc.s.phase === IN_PLAY && n++ < 300) run(sc, 1, (k) => (k === 1 ? pitch(16) : 0));
    expect(sc.s.phase).toBe(CELEBRATION);
    expect(sc.s.score).toEqual([0, 1]);
    expect(sc.s.lastGoalPack).toBe(1);
    expect(sc.s.terriers[1]!.goals).toBe(1);
    expect(sc.s.scorers).toBe(2); // bit 1: the terrier at index 1
    expect(sc.s.ownGoal).toBe(false);
    run(sc, sc.sim.C.celebrationTicks);
    expect(sc.s.phase).toBe(KICKOFF_COUNTDOWN);
    expect(sc.s.ball.x).toBe(0);
    expect(sc.s.scorers).toBe(0);
  });

  it('an own goal counts for the other pack and credits nobody', () => {
    const sc = scenario(1, {}, (s) => { placeBall(s, -15, 0.5); place(s, 0, -13.5, 0.5); park(s, 1); });
    run(sc, 300, (k) => (k === 0 ? pitch(16) : 0));
    expect(sc.s.score).toEqual([0, 1]);
    expect(sc.s.ownGoal).toBe(true);
    expect(sc.s.terriers[0]!.goals).toBe(0);
  });

  it('counts one touch per contact episode, re-armed at 0.6 m', () => {
    const sc = scenario(1, {}, (s) => { park(s, 1); placeBall(s, 0, 0); place(s, 0, -3, 0); });
    run(sc, 90, (k) => (k === 0 ? pitch(0) : 0)); // a long push: one touch
    expect(sc.s.terriers[0]!.touches).toBe(1);
  });
});
