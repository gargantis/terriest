import { describe, expect, it, vi } from 'vitest';
import { hashState } from './codec';
import { encodeInput, FRAME_BALL, FRAME_NOSE, FRAME_PITCH, STEP_UNITS } from './input';
import { datan2, dir, HALF_TURN, QUARTER_TURN } from './math';
import { defaultParams } from './params';
import { park, place, placeBall, placedMatch, touchReach } from './scenes';
import { CELEBRATION, GETTING_UP, IN_PLAY, KICKOFF_COUNTDOWN, NEVER, SITTING, TUMBLED } from './state';
import { run, type Scenario, scenario } from './testing';

// PLAN §16 Movement, Steering, Presses and Rules, as far as M0's runs need
// them (D-6, D-7, D-8, D-10, D-16), and L57's ball behaviours: the M0
// spike's movement.test.ts, with intents read from the Sim's scratch
// (A.1: not state). Plus the rules of design §3, §4.3 and §5.2 it didn't
// check: the frames during a lunge and in the air, zoomies' limits, held
// counters across absent ticks, the guard, the re-arm gap, and the goal
// test's place in the substep.
vi.setConfig({ testTimeout: 120_000 });

const P = defaultParams;
const pitch = (s: number, zoomies = false, jump = 0, pounce = 0): number => encodeInput({ step: s, frame: FRAME_PITCH, zoomies, jump, pounce });
const speed = (t: { vx: number; vy: number }): number => Math.hypot(t.vx, t.vy);
/** Terrier 0, at the head of the list (slot 0), and its rival parked. */
const alone = (x: number, y: number): Scenario => scenario(1, {}, (s, P) => { park(P, s, 1); place(P, s, 0, x, y); });

describe('running (D-6)', () => {
  it('reaches run speed from rest in 0.4 s at 15 m/s², and holds it', () => {
    const sc = alone(-10, 0);
    run(sc, 12, (k) => (k === 0 ? pitch(0) : 0));
    expect(speed(sc.s.terriers[0]!)).toBeCloseTo(3, 12);
    run(sc, 12, (k) => (k === 0 ? pitch(0) : 0));
    expect(speed(sc.s.terriers[0]!)).toBeCloseTo(6, 12);
    run(sc, 30, (k) => (k === 0 ? pitch(0) : 0));
    expect(sc.s.terriers[0]!.vx).toBe(6);
  });

  it('turns at 2 turns/s and snaps onto the direction within a tick', () => {
    const sc = alone(-10, 0);
    sc.s.terriers[0]!.heading = 0;
    let ticks = 0;
    while (sc.s.terriers[0]!.heading !== HALF_TURN && ticks < 60) {
      run(sc, 1, (k) => (k === 0 ? pitch(16) : 0));
      ticks++;
    }
    // Half a turn at 2 turns/s is 0.25 s, 15 ticks, and the snap takes one more.
    expect(ticks).toBe(16);
    // Exactly opposite turns clockwise; the last 8 units snapped.
    expect(sc.s.terriers[0]!.headingChange).toBe(-8);
  });

  it('idle friction stops a terrier at 8 m/s², exactly', () => {
    const sc = alone(-10, 0);
    sc.s.terriers[0]!.vx = 6;
    run(sc, 45); // 6/8 s = 0.75 s, 180 substeps, to within rounding …
    expect(sc.s.terriers[0]!.vx).toBeLessThan(1e-13);
    run(sc, 1); // … and exactly 0 the substep after
    expect(sc.s.terriers[0]!.vx).toBe(0);
    expect(sc.s.terriers[0]!.x).toBeCloseTo(-10 + (6 * 6) / 16, 1);
  });

  it('an idle terrier can be pushed, at 3.5 m/s²', () => {
    const sc = scenario(1, {}, (s, P) => { placeBall(P, s, 8, 8); place(P, s, 0, -10.5, 0); place(P, s, 1, -10, 0); });
    run(sc, 30, (k) => (k === 0 ? pitch(0) : 0));
    const pushed = sc.s.terriers[1]!;
    expect(pushed.vx).toBeGreaterThan(0.5 * 3.5 * 0.6);
    expect(pushed.vx).toBeLessThan(3.5 * 0.5 + 0.3);
  });
});

describe('zoomies (D-6, C-20)', () => {
  it('runs at 9 m/s, drains the meter in 3 s, locks out until released, and refills in 6 s', () => {
    const sc = alone(-18, -12);
    const zooming = (): boolean => sc.sim.intents.zooming[0] === 1;
    // Run along the long side wall, back and forth by turning in place.
    let zoomTicks = 0;
    let top = 0;
    for (let t = 0; t < 200; t++) {
      run(sc, 1, (k) => (k === 0 ? pitch(t < 100 ? 0 : 16, true) : 0));
      if (zooming()) zoomTicks++;
      top = Math.max(top, speed(sc.s.terriers[0]!));
    }
    expect(zoomTicks).toBe(P.meterFull / P.meterDrain); // 180 ticks = 3 s
    expect(top).toBeCloseTo(9, 12);
    expect(sc.s.terriers[0]!.zoomLocked).toBe(true);
    // Held on: still locked, refilling.
    run(sc, 30, (k) => (k === 0 ? pitch(16, true) : 0));
    expect(zooming()).toBe(false);
    // Released once, then held again: zooms.
    run(sc, 1, (k) => (k === 0 ? pitch(16, false) : 0));
    expect(sc.s.terriers[0]!.zoomLocked).toBe(false);
    run(sc, 1, (k) => (k === 0 ? pitch(16, true) : 0));
    expect(zooming()).toBe(true);
    // Refill from empty takes 6 s.
    const m = alone(-10, 0);
    m.s.terriers[0]!.meter = 0;
    run(m, 359);
    expect(m.s.terriers[0]!.meter).toBe(359);
    run(m, 1);
    expect(m.s.terriers[0]!.meter).toBe(360);
  });
});

describe('jump (D-6)', () => {
  it('rises 1 m and is in the air about 0.9 s, from the floor only', () => {
    const sc = alone(-10, 0);
    let apex = 0;
    let airborne = 0;
    sc.sim.probe = (s) => {
      apex = Math.max(apex, s.terriers[0]!.z);
      if (!s.terriers[0]!.onFloor) airborne++;
    };
    run(sc, 1, (k) => (k === 0 ? encodeInput({ jump: 1 }) : 0));
    run(sc, 20, (k) => (k === 0 ? encodeInput({ jump: 2 }) : 0)); // a second press in the air is dropped
    run(sc, 60, (k) => (k === 0 ? encodeInput({ jump: 2 }) : 0));
    expect(apex - 0.25).toBeCloseTo(1, 1);
    expect(airborne / (P.config.ticksPerSecond * P.substeps)).toBeCloseTo(0.9, 1);
    expect(sc.s.terriers[0]!.takeOffTick).toBe(1);
    expect(sc.s.terriers[0]!.landingTick).toBeGreaterThan(sc.s.terriers[0]!.takeOffTick);
  });
});

describe('pounce (D-6)', () => {
  it('holds 10 m/s for 0.3 s, 3 m, then waits 1.5 s; a press during the lunge or wait is dropped', () => {
    const sc = alone(-15, -8);
    sc.s.terriers[0]!.heading = 0;
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
    const sc = scenario(1, { gravityMetresPerSecond2: 0, rollingSlowdownMetresPerSecond2: 0 }, (s, P) => {
      park(P, s, 1);
      placeBall(P, s, 0, 0);
      place(P, s, 0, -2, 0, 0.8);
      s.terriers[0]!.heading = 0;
    });
    run(sc, 1, (k) => (k === 0 ? encodeInput({ pounce: 1 }) : 0));
    run(sc, 20);
    expect(sc.s.terriers[0]!.lunge).toBe(0);
    expect(sc.s.ball.vx).toBeCloseTo(5, 9); // L312: 5 m/s from a pounce
    const j = alone(-10, 0);
    j.s.terriers[0]!.heading = 0;
    run(j, 1, (k) => (k === 0 ? encodeInput({ jump: 1, pounce: 1 }) : 0));
    expect(j.s.terriers[0]!.onFloor).toBe(false);
    expect(j.s.terriers[0]!.vx).toBe(10);
    expect(j.s.terriers[0]!.vz).toBeGreaterThan(4);
  });

  it('tumbles the rival it hits, both when two pounce into each other, never a packmate', () => {
    const sc = scenario(2, {}, (s, P) => {
      placeBall(P, s, 0, 10);
      place(P, s, 0, -2, 0); s.terriers[0]!.heading = 0; // A1 at B1
      place(P, s, 1, 0, 0); // B1, standing
      place(P, s, 2, -2, -4); s.terriers[2]!.heading = 0; // A2 and B2 head on
      place(P, s, 3, 2, -4); s.terriers[3]!.heading = HALF_TURN;
    });
    run(sc, 1, (k) => (k === 0 || k === 2 || k === 3 ? encodeInput({ pounce: 1 }) : 0));
    run(sc, 12);
    expect(sc.s.terriers[1]!.tumble).toBeGreaterThan(0); // B1 hit by A1
    expect(sc.s.terriers[2]!.tumble).toBeGreaterThan(0); // A2 and B2 into each other
    expect(sc.s.terriers[3]!.tumble).toBeGreaterThan(0);
    expect(sc.s.terriers[0]!.tumble).toBe(0);
    const mate = scenario(2, {}, (s, P) => {
      placeBall(P, s, 0, 10);
      place(P, s, 0, -2, 0); s.terriers[0]!.heading = 0;
      place(P, s, 2, 0, 0);
      park(P, s, 1); park(P, s, 3);
    });
    run(mate, 1, (k) => (k === 0 ? encodeInput({ pounce: 1 }) : 0));
    run(mate, 12);
    expect(mate.s.terriers[2]!.tumble).toBe(0);
  });
});

describe('tumbles (D-6, Q-8)', () => {
  it("last 1.5 s with a 0.5 s get-up, then a 1.5 s guard; a tumbled terrier can't act", () => {
    const sc = alone(-10, 0);
    sc.s.terriers[0]!.tumble = 90;
    run(sc, 30, (k) => (k === 0 ? pitch(0) : 0));
    expect(sc.s.terriers[0]!.anim).toBe(TUMBLED);
    expect(speed(sc.s.terriers[0]!)).toBe(0);
    run(sc, 31, (k) => (k === 0 ? pitch(0) : 0));
    expect(sc.s.terriers[0]!.anim).toBe(GETTING_UP);
    run(sc, 29, (k) => (k === 0 ? pitch(0) : 0));
    expect(sc.s.terriers[0]!.tumble).toBe(0);
    expect(sc.s.terriers[0]!.guard).toBe(90);
    run(sc, 1, (k) => (k === 0 ? pitch(0) : 0));
    expect(speed(sc.s.terriers[0]!)).toBeGreaterThan(0);
  });

  it('a ball coming at 4 m/s or more bowls a terrier, except a lunging one or the last to touch it', () => {
    const shot = (vx: number, last: boolean, lunging: boolean): boolean => {
      const sc = scenario(1, { rollingSlowdownMetresPerSecond2: 0 }, (s, P) => {
        park(P, s, 0);
        placeBall(P, s, -4, 0, 0.8, vx, 0, 0);
        place(P, s, 1, 0, 0);
        s.terriers[1]!.heading = HALF_TURN;
        if (last) {
          s.terriers[1]!.lastBallContactTick = 0;
          s.ball.lastContactTick = 0;
        }
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

  it('never tumbles a guarded terrier, by a pounce or a bowling ball, nor restarts a tumble (design §3, §4.3)', () => {
    // A1 pounces into B1, guarded or already tumbled.
    for (const [field, n] of [['guard', 90], ['tumble', 60]] as const) {
      const sc = scenario(1, {}, (s, P) => {
        placeBall(P, s, 0, 10);
        place(P, s, 0, -2, 0); s.terriers[0]!.heading = 0;
        place(P, s, 1, 0, 0); s.terriers[1]![field] = n;
      });
      run(sc, 1, (k) => (k === 0 ? encodeInput({ pounce: 1 }) : 0));
      run(sc, 12);
      const B = sc.s.terriers[1]!;
      expect(B.lastTerrierContactTick, `${field}: hit`).not.toBe(NEVER);
      expect(B.tumble, field).toBe(field === 'guard' ? 0 : n - 13);
    }
    // A ball at 5 m/s into a guarded terrier.
    const sc = scenario(1, { rollingSlowdownMetresPerSecond2: 0 }, (s, P) => {
      park(P, s, 0);
      placeBall(P, s, -4, 0, 0.8, 5, 0, 0);
      place(P, s, 1, 0, 0);
      s.terriers[1]!.guard = 90;
    });
    run(sc, 50);
    expect(sc.s.terriers[1]!.lastBallContactTick, 'hit').not.toBe(NEVER);
    expect(sc.s.terriers[1]!.tumble).toBe(0);
  });
});

describe('steering frames (D-7)', () => {
  it('the ball frame runs at the ball, and sideways circles it', () => {
    const sc = scenario(1, {}, (s, P) => { park(P, s, 1); placeBall(P, s, 0, 0); place(P, s, 0, -5, 3); });
    const intents = sc.sim.intents;
    run(sc, 1, (k) => (k === 0 ? encodeInput({ step: 0, frame: FRAME_BALL }) : 0));
    expect(intents.targetVx[0]! / 6).toBeCloseTo(5 / Math.hypot(5, 3), 9);
    expect(intents.targetVy[0]! / 6).toBeCloseTo(-3 / Math.hypot(5, 3), 9);
    const want = (datan2(-3, 5) + 8 * STEP_UNITS) >>> 0;
    run(sc, 1, (k) => (k === 0 ? encodeInput({ step: 8, frame: FRAME_BALL }) : 0));
    const dirNow = datan2(intents.targetVy[0]!, intents.targetVx[0]!);
    expect(Math.abs((dirNow - want) | 0)).toBeLessThan(STEP_UNITS / 16); // the line moved a little
  });

  it('under an overhead ball, holds the reference: sideways turns once, to the reference plus the step', () => {
    const sc = scenario(1, { gravityMetresPerSecond2: 0 }, (s, P) => {
      park(P, s, 1);
      place(P, s, 0, 0, 0);
      placeBall(P, s, 0.1, 0, 0.25 + 1.06); // just over the terrier, not touching
      s.terriers[0]!.heading = QUARTER_TURN;
    });
    const T = sc.s.terriers[0]!;
    // Keep the ball over the terrier as it runs, as a ball resting on it would be.
    const hold = (k: number): number => {
      if (k === 0) {
        sc.s.ball.x = T.x + 0.1;
        sc.s.ball.y = T.y;
      }
      return k === 0 ? encodeInput({ step: 8, frame: FRAME_BALL }) : 0;
    };
    run(sc, 1, hold);
    expect(T.ballOverhead).toBe(true);
    expect(T.overheadRef).toBe(QUARTER_TURN);
    run(sc, 30, hold);
    expect(T.heading).toBe((QUARTER_TURN + 8 * STEP_UNITS) >>> 0); // turned once, then held
    // Hysteresis: the flag clears only beyond 0.4 m.
    sc.s.ball.x = T.x + 0.35;
    sc.s.ball.y = T.y;
    run(sc, 1);
    expect(T.ballOverhead).toBe(true);
    sc.s.ball.x = T.x + 0.45;
    run(sc, 1);
    expect(T.ballOverhead).toBe(false);
  });

  it('the nose frame throttles along the heading and turns by the side part', () => {
    const sc = alone(-10, 0);
    sc.s.terriers[0]!.heading = 0;
    run(sc, 30, (k) => (k === 0 ? encodeInput({ step: 0, frame: FRAME_NOSE }) : 0));
    expect(sc.s.terriers[0]!.vx).toBeCloseTo(6, 9);
    expect(sc.s.terriers[0]!.heading).toBe(0);
    run(sc, 60, (k) => (k === 0 ? encodeInput({ step: 8, frame: FRAME_NOSE }) : 0));
    // Pure side: no throttle, a full nose turn rate of 1 turn/s for 1 s.
    const h = sc.s.terriers[0]!.heading;
    expect(h <= 60 || 2 ** 32 - h <= 60).toBe(true);
    run(sc, 60, (k) => (k === 0 ? encodeInput({ step: 16, frame: FRAME_NOSE }) : 0));
    expect(sc.s.terriers[0]!.vx).toBeCloseTo(-3, 9); // reverses at up to 3 m/s
  });

  it('in the nose frame, turns by round(s × the nose rate) a tick, in the air too, then drives along the new heading', () => {
    // Steps 4 and 28, forward and to each side, s = ±sin 45°: the turn isn't
    // a whole number of units, and at step 4 rounding it differs from
    // flooring or truncating it.
    for (const st of [4, 28]) {
      const sc = alone(-10, 0);
      const T = sc.s.terriers[0]!;
      T.heading = 0;
      run(sc, 1, (k) => (k === 0 ? encodeInput({ jump: 1 }) : 0));
      run(sc, 1, (k) => (k === 0 ? encodeInput({ step: st, frame: FRAME_NOSE, jump: 1 }) : 0));
      expect(T.onFloor, 'in the air').toBe(false);
      const fs = new Float64Array(2);
      dir(st * STEP_UNITS, fs);
      expect(T.headingChange, `step ${st}`).toBe(Math.round(fs[1]! * P.noseTurnPerTick));
      expect(T.heading).toBe(T.headingChange >>> 0);
      const along = new Float64Array(2);
      dir(T.heading, along);
      const { targetVx, targetVy } = sc.sim.intents;
      expect([targetVx[0], targetVy[0]], `step ${st}`).toEqual([fs[0]! * P.runSpeed * along[0]!, fs[0]! * P.runSpeed * along[1]!]);
    }
  });

  it('locks the heading during a lunge, in every frame', () => {
    for (const frame of [FRAME_PITCH, FRAME_BALL, FRAME_NOSE]) {
      const sc = alone(-15, -8);
      const T = sc.s.terriers[0]!;
      T.heading = 0;
      run(sc, 1, (k) => (k === 0 ? encodeInput({ pounce: 1 }) : 0));
      const quarter = (k: number): number => (k === 0 ? encodeInput({ step: 8, frame, pounce: 1 }) : 0);
      run(sc, 10, quarter); // a quarter turn held through the lunge
      expect(T.lunge, `frame ${frame}`).toBeGreaterThan(0);
      expect(T.heading, `frame ${frame}`).toBe(0);
      run(sc, 10, quarter); // and turning once it's over
      expect(T.lunge).toBe(0);
      expect(T.heading, `frame ${frame}`).not.toBe(0);
    }
  });

  it('zooms only on the floor, and in the nose frame only going forward', () => {
    const air = alone(-10, 0);
    run(air, 1, (k) => (k === 0 ? encodeInput({ jump: 1 }) : 0));
    run(air, 20, (k) => (k === 0 ? encodeInput({ step: 0, frame: FRAME_PITCH, zoomies: true, jump: 1 }) : 0));
    expect(air.s.terriers[0]!.onFloor).toBe(false);
    expect(air.s.terriers[0]!.meter, 'no drain in the air').toBe(P.meterFull);
    // Sideways (f = −0), back (f < 0) and forward (f > 0).
    for (const [st, zooms] of [[8, 0], [16, 0], [4, 1]] as const) {
      const sc = alone(-10, 0);
      run(sc, 1, (k) => (k === 0 ? encodeInput({ step: st, frame: FRAME_NOSE, zoomies: true }) : 0));
      expect(sc.sim.intents.zooming[0], `nose step ${st}`).toBe(zooms);
      expect(sc.s.terriers[0]!.meter).toBe(P.meterFull - zooms * P.meterDrain);
    }
  });

  it('releases the zoomies lockout on an absent input, which holds nothing (design §4.3)', () => {
    const sc = alone(-10, 0);
    const T = sc.s.terriers[0]!;
    T.meter = P.meterDrain;
    run(sc, 1, (k) => (k === 0 ? encodeInput({ step: 0, frame: FRAME_PITCH, zoomies: true }) : 0));
    expect([T.meter, T.zoomLocked]).toEqual([0, true]);
    run(sc, 1, (k) => (k === 0 ? null : 0));
    expect(T.zoomLocked).toBe(false);
  });
});

describe('presses and inputs (D-10, A.2)', () => {
  // Each held counter below is held until a repeat could act, on the floor
  // and past the pounce wait, before its absent ticks: inside the jump's
  // airtime or the wait, a repeated press would be dropped anyway.
  it("a press acts once, a held counter never repeats it, and absent ticks don't make one", () => {
    for (const gap of [0, 1, 13]) {
      const sc = alone(-10, 0);
      let jumps = 0;
      let was = true;
      sc.sim.probe = (s) => {
        const f = s.terriers[0]!.onFloor;
        if (was && !f) jumps++;
        was = f;
      };
      run(sc, 1, (k) => (k === 0 ? encodeInput({ jump: 1 }) : 0));
      run(sc, 120, (k) => (k === 0 ? encodeInput({ jump: 1 }) : 0)); // the same count: no new press
      expect(sc.s.terriers[0]!.onFloor, 'landed').toBe(true);
      run(sc, gap, (k) => (k === 0 ? null : 0));
      run(sc, 120, (k) => (k === 0 ? encodeInput({ jump: 1 }) : 0)); // still the same count, on the floor
      expect(jumps, `after ${gap} absent ticks`).toBe(1);
      run(sc, 120, (k) => (k === 0 ? encodeInput({ jump: 2 }) : 0));
      expect(jumps).toBe(2);
    }
  });

  it('a held pounce counter never repeats its pounce, before or after absent ticks', () => {
    for (const gap of [0, 1, 13]) {
      const sc = alone(-15, -8);
      const T = sc.s.terriers[0]!;
      T.heading = 0;
      let lunges = 0;
      const hold = (ticks: number, input: number | null): void => {
        for (let i = 0; i < ticks; i++) {
          run(sc, 1, (k) => (k === 0 ? input : 0));
          if (T.lunge === P.lungeTicks - 1) lunges++; // a lunge begun this tick
        }
      };
      hold(1, encodeInput({ pounce: 1 }));
      hold(120, encodeInput({ pounce: 1 })); // past the lunge and the wait
      expect(T.lunge + T.pounceWait, 'ready to pounce').toBe(0);
      hold(gap, null);
      hold(60, encodeInput({ pounce: 1 }));
      expect(lunges, `after ${gap} absent ticks`).toBe(1);
      hold(1, encodeInput({ pounce: 2 }));
      expect(lunges).toBe(2);
    }
  });

  it("a press that can't act is dropped, never deferred: in a countdown, or tumbled", () => {
    // Pressed during the kickoff countdown and held into play.
    const sc = scenario(1, {}, undefined, { phase: KICKOFF_COUNTDOWN });
    run(sc, 100);
    run(sc, 200, (k) => (k === 0 ? encodeInput({ jump: 1, pounce: 1 }) : 0));
    expect(sc.s.phase).toBe(IN_PLAY);
    expect(sc.s.terriers[0]!.takeOffTick).toBe(NEVER);
    expect(sc.s.terriers[0]!.lunge + sc.s.terriers[0]!.pounceWait).toBe(0);
    // Pressed while tumbled and held after it.
    const t = alone(-15, -8);
    const T = t.s.terriers[0]!;
    T.heading = 0;
    T.tumble = 90;
    run(t, 10);
    run(t, 100, (k) => (k === 0 ? encodeInput({ jump: 1, pounce: 1 }) : 0));
    expect(T.tumble).toBe(0);
    expect(T.takeOffTick).toBe(NEVER);
    expect(T.lunge + T.pounceWait).toBe(0);
  });

  it("a press after 1 or 13 absent ticks acts once, and a returning player's first input acts none", () => {
    for (const gap of [1, 13]) {
      const sc = alone(-10, 0);
      run(sc, gap, (k) => (k === 0 ? null : 0));
      run(sc, 1, (k) => (k === 0 ? encodeInput({ jump: 1 }) : 0));
      expect(sc.s.terriers[0]!.takeOffTick, `after ${gap} absent ticks`).toBe(gap + 1);
    }
    // A returning browser starts its counters from the stored previous input.
    const back = alone(-10, 0);
    back.s.terriers[0]!.prevInput = encodeInput({ jump: 2, pounce: 3 });
    run(back, 1, (k) => (k === 0 ? encodeInput({ jump: 2, pounce: 3 }) : 0));
    expect(back.s.terriers[0]!.takeOffTick).toBe(NEVER);
    expect(back.s.terriers[0]!.lunge).toBe(0);
  });

  it('every u16 is a valid input, and the bark bits never reach the hash', () => {
    const sc = scenario(2);
    for (let v = 0; v < 65536; v += 7) {
      run(sc, 1, (k) => [v, (v * 31) & 0xffff, (v ^ 0xa5a5) & 0xffff, 0xffff - v][k]!);
      expect(Number.isFinite(sc.s.ball.x)).toBe(true);
    }
    expect(() => hashState(sc.s)).not.toThrow();
    const a = scenario(1, {}, (s, P) => place(P, s, 0, -10, 0));
    const b = scenario(1, {}, (s, P) => place(P, s, 0, -10, 0));
    run(a, 100, (k, t) => (k === 0 ? pitch(t % 32, true, t >> 4, t >> 5) : 0));
    run(b, 100, (k, t) => (k === 0 ? pitch(t % 32, true, t >> 4, t >> 5) | ((t & 3) << 13) | (1 << 15) : 0));
    expect(hashState(b.s)).toBe(hashState(a.s));
  });
});

describe('presence (D-16)', () => {
  it("a silent terrier sits after 120 ticks in play, can't act but can be pushed, and stands with its next input", () => {
    const sc = scenario(1, {}, (s, P) => { placeBall(P, s, 8, 8); place(P, s, 0, -10.5, 0); place(P, s, 1, -10, 0); });
    run(sc, 119, (k) => (k === 1 ? null : 0));
    expect(sc.s.terriers[1]!.sitting).toBe(false);
    run(sc, 1, (k) => (k === 1 ? null : 0));
    expect(sc.s.terriers[1]!.sitting).toBe(true);
    expect(sc.s.terriers[1]!.anim).toBe(SITTING);
    run(sc, 30, (k) => (k === 0 ? pitch(0) : k === 1 ? null : 0)); // pushed, holding nothing
    expect(sc.s.terriers[1]!.vx).toBeGreaterThan(0.5);
    run(sc, 1, (k) => (k === 1 ? pitch(16) : 0));
    expect(sc.s.terriers[1]!.sitting).toBe(false);
    expect(sc.s.terriers[1]!.lastInputTick).toBe(sc.s.tick);
  });
});

describe('the ball against terriers (L57)', () => {
  it('a terrier running into a resting ball at run speed hops it', () => {
    const sc = scenario(1, {}, (s, P) => { park(P, s, 1); placeBall(P, s, 0, 0); place(P, s, 0, -3, 0); s.terriers[0]!.vx = 6; });
    let lift = 0;
    sc.sim.probe = (s) => { lift = Math.max(lift, s.ball.z - 0.8); };
    run(sc, 40, (k) => (k === 0 ? pitch(0) : 0));
    expect(lift).toBeGreaterThan(0.05);
  });

  it("one meeting it at the ball's centre height hits it level", () => {
    const sc = scenario(1, { gravityMetresPerSecond2: 0, rollingSlowdownMetresPerSecond2: 0 }, (s, P) => {
      park(P, s, 1);
      placeBall(P, s, 0, 0);
      place(P, s, 0, -1.5, 0, 0.8);
      s.terriers[0]!.vx = 6;
    });
    run(sc, 30);
    expect(sc.s.ball.vx).toBeCloseTo(3, 10);
    expect(sc.s.ball.vz).toBe(0);
    expect(sc.s.ball.z).toBe(0.8);
  });

  it('two running in from opposite sides lift it off the floor', () => {
    const sc = scenario(1, {}, (s, P) => { placeBall(P, s, 0, 0); place(P, s, 0, -3, 0); place(P, s, 1, 3, 0); s.terriers[0]!.vx = 6; s.terriers[1]!.vx = -6; });
    let lift = 0;
    sc.sim.probe = (s) => { lift = Math.max(lift, s.ball.z - 0.8); };
    run(sc, 40, (k) => (k === 0 ? pitch(0) : pitch(16)));
    expect(lift).toBeGreaterThan(0.3);
  });

  it("a steady push from contact keeps the ball's on-floor flag set throughout", () => {
    const sc = scenario(1, {}, (s, P) => { park(P, s, 1); placeBall(P, s, -10, 0); place(P, s, 0, -10 - touchReach(P), 0); });
    let off = 0;
    sc.sim.probe = (s) => { if (!s.ball.onFloor) off++; };
    run(sc, 120, (k) => (k === 0 ? pitch(0) : 0));
    expect(off).toBe(0);
    expect(sc.s.ball.vx).toBeGreaterThan(5);
  });
});

describe('kickoffs and goals (D-8)', () => {
  it("places every pack size on A.5's spots by ID rank, pack B the point mirror, all facing the ball", () => {
    for (let n = 1; n <= 4; n++) {
      const s = placedMatch(P, n, { phase: KICKOFF_COUNTDOWN, seed: 5 });
      expect(s.terriers).toHaveLength(2 * n);
      for (let k = 0; k < s.terriers.length; k++) {
        const t = s.terriers[k]!;
        expect([t.spot, t.pack], `list index ${k}`).toEqual([k >> 1, k & 1]);
        const spot = P.kickoffSpots[0][n]![t.spot]!;
        expect(t.x).toBe(t.pack === 0 ? spot[0] : -spot[0]);
        expect(t.y === (t.pack === 0 ? spot[1] : -spot[1])).toBe(true);
        expect(t.heading).toBe(datan2(-t.y, -t.x));
        expect(t.meter).toBe(360);
        // Spot k is the pack's k-th smallest ID.
        const mates = s.terriers.filter((u) => u.pack === t.pack).map((u) => u.id).sort();
        expect(mates.indexOf(t.id)).toBe(t.spot);
      }
    }
  });

  it('holds terriers on their spots through the countdown, turning only, then plays', () => {
    const sc = scenario(1, {}, undefined, { phase: KICKOFF_COUNTDOWN });
    run(sc, P.kickoffCountdownTicks - 1, (k, t) => (k === 0 ? pitch(8, true, t >> 3, t >> 4) : pitch(8)));
    const A = sc.s.terriers[0]!;
    expect(A.x).toBe(-10);
    expect(A.heading).toBe(8 * STEP_UNITS);
    expect(A.lunge + A.vz).toBe(0);
    expect(A.takeOffTick).toBe(NEVER);
    run(sc, 1, () => pitch(8));
    expect(sc.s.phase).toBe(IN_PLAY);
    run(sc, 1, () => pitch(8));
    expect(A.y).toBeGreaterThan(0);
  });

  it('counts a goal through the mouth for the attacking pack, credits the last toucher, then celebrates and kicks off', () => {
    const sc = scenario(1, {}, (s, P) => { placeBall(P, s, -15, 0.5); place(P, s, 1, -13.5, 0.5); park(P, s, 0); });
    let n = 0;
    while (sc.s.phase === IN_PLAY && n++ < 300) run(sc, 1, (k) => (k === 1 ? pitch(16) : 0));
    expect(sc.s.phase).toBe(CELEBRATION);
    expect(sc.s.score).toEqual([0, 1]);
    expect(sc.s.lastGoalPack).toBe(1);
    expect(sc.s.lastGoalTick).toBe(sc.s.tick);
    expect(sc.s.terriers[1]!.goals).toBe(1);
    expect(sc.s.scorers).toBe(2); // bit 1: the terrier at list index 1
    expect(sc.s.ownGoal).toBe(false);
    run(sc, P.celebrationTicks);
    expect(sc.s.phase).toBe(KICKOFF_COUNTDOWN);
    expect(sc.s.ball.x).toBe(0);
    expect(sc.s.scorers).toBe(0);
    // The last goal's tick, pack and own-goal flag stay, for the net's bulge (D-9).
    expect(sc.s.lastGoalPack).toBe(1);
    expect(sc.s.ownGoal).toBe(false);
  });

  it('an own goal counts for the other pack and credits nobody', () => {
    const sc = scenario(1, {}, (s, P) => { placeBall(P, s, -15, 0.5); place(P, s, 0, -13.5, 0.5); park(P, s, 1); });
    run(sc, 300, (k) => (k === 0 ? pitch(16) : 0));
    expect(sc.s.score).toEqual([0, 1]);
    expect(sc.s.ownGoal).toBe(true);
    expect(sc.s.scorers).toBe(0);
    expect(sc.s.terriers[0]!.goals).toBe(0);
  });

  it("credits a first touch in the goal's own substep: the goal test comes after the contacts are recorded (design §3)", () => {
    const sc = scenario(1, { gravityMetresPerSecond2: 0, rollingSlowdownMetresPerSecond2: 0 }, (s, P) => {
      const R = P.ballRadius;
      const line = P.pitch.goalLineX + R;
      placeBall(P, s, line - 0.002, 0); // 2 mm short of a goal, in the +x mouth
      place(P, s, 0, line - 0.002 - (R + P.terrierRadius) - 0.001, 0, R); // A1, level with it, 1 mm clear
      s.terriers[0]!.vx = 6;
      park(P, s, 1);
    });
    let sub = 0;
    let goalSub = -1;
    let touchSub = -1;
    sc.sim.probe = (s) => {
      sub++;
      if (touchSub < 0 && s.ball.lastContactTick !== NEVER) touchSub = sub;
      if (goalSub < 0 && s.phase === CELEBRATION) goalSub = sub;
    };
    run(sc, 2);
    expect(goalSub).toBeGreaterThan(0);
    expect(touchSub, 'the first touch and the goal share a substep').toBe(goalSub);
    expect(sc.s.score).toEqual([1, 0]);
    expect([sc.s.ownGoal, sc.s.scorers, sc.s.terriers[0]!.goals]).toEqual([false, 1, 1]);
  });

  it('counts one touch per contact episode, re-armed at 0.6 m', () => {
    // A long push, then both at rest with the terrier backed off to a
    // surface gap just past the re-arm gap, or just short of it, and in again.
    for (const [gap, touches] of [[P.rearmGap + 0.05, 2], [P.rearmGap - 0.05, 1]] as const) {
      const sc = alone(-3, 0);
      placeBall(P, sc.s, 0, 0);
      run(sc, 90, (k) => (k === 0 ? pitch(0) : 0)); // a long push: one touch
      const T = sc.s.terriers[0]!;
      expect(T.touches).toBe(1);
      expect(T.touchingBall).toBe(true);
      const b = sc.s.ball;
      placeBall(P, sc.s, b.x, b.y);
      const centres = gap + P.ballRadius + P.terrierRadius;
      const dz = P.ballRadius - P.terrierRadius;
      place(P, sc.s, 0, b.x - Math.sqrt(centres * centres - dz * dz), b.y);
      run(sc, 1);
      expect(T.touchingBall, `backed off to ${gap} m`).toBe(touches === 1);
      run(sc, 30, (k) => (k === 0 ? pitch(0) : 0));
      expect(T.touches, `backed off to ${gap} m`).toBe(touches);
    }
  });
});
