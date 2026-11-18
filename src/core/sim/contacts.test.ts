import { describe, expect, it, vi } from 'vitest';
import { encodeInput, FRAME_BALL } from './input';
import { WALL } from './pitch';
import { ballDir, NOTHING, park, place, placeBall } from './scenes';
import { NEVER, WARM_UP } from './state';
import { bodyBits, kineticEnergy, run, type Scenario, scenario } from './testing';
import { stateProblems } from './valid';

// PLAN §16 Simulation, M0 run 2 (D-5, L308, L311, L312, A.5): resting
// contact, bounces and settling, rolling, the ball's last hit, and the fixed
// warm-up ball (design §2.3, §4.1, §4.2). The M0 spike's contacts.test.ts,
// with M0's figures pinned to the digits research/spike/REPORT.md §5.2 and
// §6 print. The 36,000-tick scenes take a few seconds, so on a busy worker
// pool they get more than vitest's 5 s.
vi.setConfig({ testTimeout: 120_000 });

/** The run's substeps a tick. */
const substeps = (sc: Scenario): number => sc.sim.P.substeps;

describe('resting contact (D-5 step 4)', () => {
  it('holds a resting ball and standing terriers bit-still for 10 minutes of ticks', () => {
    const sc = scenario(1, {}, (s, P) => {
      placeBall(P, s, 0, 0);
      place(P, s, 0, -3, 2);
      place(P, s, 1, 3, -2);
    });
    const want = bodyBits(sc.s);
    let changed = -1;
    for (let i = 1; i <= 36_000 && changed < 0; i++) {
      run(sc, 1);
      if (bodyBits(sc.s) !== want) changed = i;
    }
    expect(changed, 'the first tick a body changed').toBe(-1);
    expect(sc.s.tick).toBe(36_000);
  });

  // A terrier standing against the ball, the ball against the side wall.
  // Placed at exactly the touching distances, rounding leaves the terrier
  // 6.7e-16 m clear of the ball and the ball 7e-16 m clear of the wall, so
  // the solver would see only the floor's three contacts: each body starts
  // 1 µm into the next, and the contacts it rests on are counted (M0,
  // research/spike/REPORT.md §6).
  const EPS = 1e-6;
  const againstWall = (): Scenario =>
    scenario(1, {}, (s, P) => {
      placeBall(P, s, 3, -14 + 0.8 - EPS);
      place(P, s, 0, 3, -14 + 0.8 - EPS + Math.sqrt(0.8) - EPS);
      park(P, s, 1);
    });
  /** Substeps with terrier 0 touching the ball and with the ball touching a
   *  wall, and the fewest and most contacts in a substep. */
  function countContacts(sc: Scenario): { terrierBall: number; ballWall: number; fewest: number; most: number } {
    const P = sc.sim.physics;
    const ball = P.ball;
    const seen = { terrierBall: 0, ballWall: 0, fewest: Infinity, most: 0 };
    sc.sim.probe = () => {
      let wall = false;
      for (let c = 0; c < P.cnt; c++) {
        if (P.ci[c] === 0 && P.cj[c] === ball) seen.terrierBall++;
        if (P.ci[c] === ball && P.cj[c]! < 0 && P.pieceSurface(c) === WALL) wall = true;
      }
      if (wall) seen.ballWall++;
      seen.fewest = Math.min(seen.fewest, P.cnt);
      seen.most = Math.max(seen.most, P.cnt);
    };
    return seen;
  }

  it('holds a terrier resting against a ball at the wall bit-still too, nothing held', () => {
    const sc = againstWall();
    run(sc, 10); // the position passes take 5 ticks to settle the 1 µm overlaps
    const seen = countContacts(sc);
    const want = bodyBits(sc.s);
    let changed = -1;
    for (let i = 1; i <= 36_000 && changed < 0; i++) {
      run(sc, 1);
      if (bodyBits(sc.s) !== want) changed = i;
    }
    expect(changed).toBe(-1);
    // Touching in every substep. Settled, the ball sits exactly at the wall,
    // which the closest-point test reads as clear of it: REPORT.md §6's 4
    // contacts a substep, the terrier on the ball and the three floors.
    expect(seen.terrierBall).toBe(36_000 * substeps(sc));
    expect([seen.fewest, seen.most], 'contacts a substep').toEqual([4, 4]);
  });

  it('holds a terrier pressing the ball into the wall bit-still, every contact under load', () => {
    // The terrier holds at the ball, so the drive presses it into the ball
    // and the ball into the wall every substep. Its gait and push tick move
    // by design; the bodies settle by tick 11 and then don't move a bit.
    const sc = againstWall();
    const hold = (k: number): number => (k === 0 ? ballDir(0) : NOTHING);
    run(sc, 60, hold);
    const seen = countContacts(sc);
    const want = bodyBits(sc.s);
    let changed = -1;
    for (let i = 1; i <= 36_000 && changed < 0; i++) {
      run(sc, 1, hold);
      if (bodyBits(sc.s) !== want) changed = i;
    }
    expect(changed).toBe(-1);
    expect(seen.terrierBall).toBe(36_000 * substeps(sc));
    // REPORT.md §5.2, §6: the ball on the wall in 72,000 of the 144,000 substeps.
    expect(seen.ballWall, 'substeps with the ball on the wall').toBe(72_000);
    // REPORT.md §9: wedged 0.13 mm up, with its floor flag clear (design §14, Q-19).
    expect(sc.s.ball.onFloor).toBe(false);
    expect((sc.s.ball.z - 0.8) * 1000).toBeCloseTo(0.13, 2);
  });
});

describe('bounces keep their fraction above 0.3 m/s (D-5, L308, L311)', () => {
  it('the ball off the floor keeps 70% of its impact speed, within 1%: 0.6973–0.7031 of √(2gh) from 0.25–4 m', () => {
    // The rebound speed against the ideal impact speed √(2gh). The apex
    // ratio also carries semi-implicit Euler's O(dt) error, about 1% at a
    // 1 m drop, so it's checked from 2 m.
    const es: number[] = [];
    for (const h0 of [0.25, 0.5, 1, 2, 4]) {
      const sc = scenario(1, {}, (s, P) => {
        park(P, s, 0);
        park(P, s, 1);
        placeBall(P, s, 0, 0, 0.8 + h0);
      });
      let vOut = 0;
      let apex = 0;
      let lastVz = 0;
      sc.sim.probe = (s) => {
        if (vOut === 0 && lastVz < 0 && s.ball.vz > 0) vOut = s.ball.vz;
        if (vOut > 0) apex = Math.max(apex, s.ball.z - 0.8);
        lastVz = s.ball.vz;
      };
      run(sc, 150);
      const e = vOut / Math.sqrt(2 * 9.8 * h0);
      const eApex = Math.sqrt(apex / h0);
      es.push(e);
      expect(Math.abs(e - 0.7) / 0.7, `drop ${h0} m: e = ${e}`).toBeLessThan(0.01);
      if (h0 >= 2) expect(Math.abs(eApex - 0.7) / 0.7, `drop ${h0} m: apex e = ${eApex}`).toBeLessThan(0.01);
      expect(sc.sim.physics.stats.floorBounces).toBeGreaterThan(0);
    }
    expect(Math.min(...es).toFixed(4)).toBe('0.6973');
    expect(Math.max(...es).toFixed(4)).toBe('0.7031');
  });

  it('the ball off a wall, the overhead net, a post and a crossbar keeps 70% of its normal speed, and the goal netting its configured fraction', () => {
    const cases: { name: string; ball: [number, number, number]; v: [number, number, number]; net: boolean; axis: 0 | 1 | 2 }[] = [
      { name: 'side wall', ball: [0, 10, 0.8], v: [0, 5, 0], net: false, axis: 1 },
      { name: 'end wall', ball: [-15, 8, 0.8], v: [-5, 0, 0], net: false, axis: 0 },
      { name: 'overhead net', ball: [0, 0, 4.5], v: [0, 0, 6], net: false, axis: 2 },
      { name: 'post', ball: [-17, 4.1, 0.8], v: [-5, 0, 0], net: false, axis: 0 },
      { name: 'crossbar', ball: [17, 0, 3.1], v: [5, 0, 0], net: false, axis: 0 },
      { name: 'back netting', ball: [-20.6, 0, 0.8], v: [-3, 0, 0], net: true, axis: 0 },
    ];
    // The netting at its configured fraction, read from SimParams so a tuned
    // value moves the test with it; at 0, which keeps none (C-48), and M2
    // settled; and at A.5's starting 0.3, so a fraction that keeps some is
    // checked too.
    for (const netting of [undefined, 0, 0.3]) {
      for (const c of cases) {
        const sc = scenario(1, { rollingSlowdownMetresPerSecond2: 0, gravityMetresPerSecond2: 0, ...(netting === undefined ? {} : { goalNetRestitution: netting }) }, (s, P) => {
          park(P, s, 0);
          park(P, s, 1);
          placeBall(P, s, c.ball[0], c.ball[1], c.ball[2], c.v[0], c.v[1], c.v[2]);
        });
        const before = c.v[c.axis];
        run(sc, 60);
        const b = sc.s.ball;
        const after = [b.vx, b.vy, b.vz][c.axis]!;
        const e = c.net ? sc.sim.P.ballGoalNet : sc.sim.P.ballSurface;
        expect(Math.abs(-after / before - e), `${c.name}, netting ${netting ?? 'configured'}`).toBeLessThan(1e-10);
        expect(sc.sim.physics.stats.pieceBounces, c.name).toBe(1);
      }
    }
  });

  it('a terrier hitting a resting ball level keeps 50% of the closing speed, sending it off at 3, 4.5 and 5 m/s from 6, 9 and 10', () => {
    const speeds: string[] = [];
    for (const v of [6, 9, 10]) {
      const sc = scenario(1, { rollingSlowdownMetresPerSecond2: 0, gravityMetresPerSecond2: 0 }, (s, P) => {
        park(P, s, 1);
        placeBall(P, s, 0, 0);
        place(P, s, 0, -1.5, 0, 0.8);
        s.terriers[0]!.vx = v;
      });
      run(sc, 30);
      const t = sc.s.terriers[0]!;
      const b = sc.s.ball;
      expect((b.vx - t.vx) / v, `at ${v} m/s`).toBeCloseTo(0.5, 10);
      expect(b.vx / v, "half the hitter's speed (masses 1 and 2)").toBeCloseTo(0.5, 10);
      speeds.push(b.vx.toFixed(3));
    }
    expect(speeds).toEqual(['3.000', '4.500', '5.000']);
  });

  it('terriers off each other and off a wall keep 30%', () => {
    const sc = scenario(1, { accelerationMetresPerSecond2: 0, idleFrictionMetresPerSecond2: 0 }, (s, P) => {
      placeBall(P, s, 0, 8);
      place(P, s, 0, -2, -5);
      place(P, s, 1, 2, -5);
      s.terriers[0]!.vx = 6;
      s.terriers[1]!.vx = -6;
    });
    run(sc, 60);
    expect(sc.s.terriers[1]!.vx - sc.s.terriers[0]!.vx).toBeCloseTo(0.3 * 12, 10);
    const w = scenario(1, { accelerationMetresPerSecond2: 0, idleFrictionMetresPerSecond2: 0 }, (s, P) => {
      park(P, s, 1);
      place(P, s, 0, 0, -12);
      s.terriers[0]!.vy = -4;
    });
    run(w, 60);
    expect(w.s.terriers[0]!.vy).toBeCloseTo(0.3 * 4, 10);
  });

  it('settles without a bounce at or below 0.3 m/s', () => {
    const sc = scenario(1, { rollingSlowdownMetresPerSecond2: 0, gravityMetresPerSecond2: 0 }, (s, P) => {
      park(P, s, 0);
      park(P, s, 1);
      placeBall(P, s, 0, 13.1, 0.8, 0, 0.25, 0);
    });
    run(sc, 60);
    expect(sc.s.ball.vy).toBe(0);
    expect(sc.s.ball.y).toBeCloseTo(14 - 0.8, 12);
    expect(sc.sim.physics.stats.pieceBounces).toBe(0);
  });

  it('a terrier landing from any height stays on the floor, with no bounce (L312)', () => {
    for (const h of [0.2, 1, 3, 5]) {
      const sc = scenario(1, {}, (s, P) => {
        park(P, s, 1);
        place(P, s, 0, -5, 0, 0.25 + h);
      });
      let bounced = false;
      let landed = false;
      sc.sim.probe = (s) => {
        const t = s.terriers[0]!;
        if (t.onFloor) landed = true;
        if (landed && (t.vz !== 0 || t.z !== 0.25)) bounced = true;
      };
      run(sc, 120);
      expect(landed && !bounced, `from ${h} m`).toBe(true);
      expect(sc.s.terriers[0]!.landingTick).not.toBe(NEVER);
    }
  });
});

describe('rolling (A.5)', () => {
  it('slows the ball by the configured rate within 1e-12 m/s a substep and stops it exactly', () => {
    const sc = scenario(1, {}, (s, P) => {
      park(P, s, 0);
      park(P, s, 1);
      placeBall(P, s, -6, -3, 0.8, 3, 1.5, 0);
    });
    const dv = sc.sim.P.rollingSlowdownDt;
    let worst = 0;
    let last = Math.hypot(3, 1.5);
    let stoppedAt = -1;
    let n = 0;
    sc.sim.probe = (s) => {
      n++;
      const sp = Math.hypot(s.ball.vx, s.ball.vy);
      if (sp > 0) worst = Math.max(worst, Math.abs(last - sp - dv));
      else if (stoppedAt < 0) stoppedAt = n;
      last = sp;
    };
    run(sc, 600);
    expect(worst).toBeLessThan(1e-12);
    expect(sc.s.ball.vx === 0 && sc.s.ball.vy === 0).toBe(true);
    // 3.354 m/s at 0.5 m/s² stops after 6.708 s, rolling 11.25 m.
    expect(stoppedAt / substeps(sc) / 60).toBeCloseTo(Math.hypot(3, 1.5) / 0.5, 1);
    expect(Math.hypot(sc.s.ball.x + 6, sc.s.ball.y + 3)).toBeCloseTo(11.25, 1);
  });

  it('keeps the kinetic energy of a ball in flight between bounces (no air drag)', () => {
    const sc = scenario(1, { gravityMetresPerSecond2: 0 }, (s, P) => {
      park(P, s, 0);
      park(P, s, 1);
      placeBall(P, s, 0, 0, 3, 2, 1, 0);
    });
    const e0 = kineticEnergy(sc.s, sc.sim.P);
    run(sc, 60);
    expect(kineticEnergy(sc.s, sc.sim.P)).toBe(e0);
  });
});

describe("the ball's last hit: its tick, strength and velocity change, in play (D-9, L101; design §2.3, §3)", () => {
  interface Hit { at: number; tick: number; strength: number; dv: [number, number, number] }
  /** The ball's hit record after the first substep that sets it, with the tick it was in. */
  function firstHit(sc: Scenario, ticks: number): Hit | null {
    let hit: Hit | null = null;
    sc.sim.probe = (s) => {
      const b = s.ball;
      if (hit === null && b.lastHitTick !== NEVER) hit = { at: s.tick + 1, tick: b.lastHitTick, strength: b.lastHitStrength, dv: [b.lastHitDvx, b.lastHitDvy, b.lastHitDvz] };
    };
    run(sc, ticks);
    return hit;
  }

  it('a terrier hitting a resting ball level: its tick, the closing speed, and the impulse alone, (3, 0, 0)', () => {
    const sc = scenario(1, { gravityMetresPerSecond2: 0, rollingSlowdownMetresPerSecond2: 0 }, (s, P) => {
      park(P, s, 1);
      placeBall(P, s, 0, 0);
      place(P, s, 0, -1.5, 0, 0.8);
      s.terriers[0]!.vx = 6;
    });
    const hit = firstHit(sc, 30);
    expect(hit).not.toBeNull();
    expect(hit!.tick).toBe(hit!.at);
    expect(hit!.tick, "the terrier's contact").toBe(sc.s.terriers[0]!.lastBallContactTick);
    expect(hit!.strength).toBe(6);
    // 30 ticks on, no later substep has rewritten it. The ball was at rest,
    // so its change is its velocity since.
    const b = sc.s.ball;
    expect([b.lastHitTick, b.lastHitStrength]).toEqual([hit!.tick, 6]);
    expect(b.lastHitDvx).toBeCloseTo(3, 10);
    expect(b.lastHitDvx).toBe(b.vx);
    expect([b.lastHitDvy, b.lastHitDvz]).toEqual([0, 0]);
  });

  it('a ball in flight off the end wall: along the normal only, with no gravity in it', () => {
    const sc = scenario(1, { rollingSlowdownMetresPerSecond2: 0 }, (s, P) => {
      park(P, s, 0);
      park(P, s, 1);
      placeBall(P, s, -18.5, 8, 2.5, -5, 0, 0);
    });
    const hit = firstHit(sc, 30);
    expect(hit).not.toBeNull();
    expect(hit!.tick).toBe(hit!.at);
    expect(hit!.strength).toBe(5);
    expect(hit!.dv[0]).toBeCloseTo(5 + 5 * sc.sim.P.ballSurface, 10); // −5 → +3.5
    expect([hit!.dv[1], hit!.dv[2]]).toEqual([0, 0]);
  });

  it('a floor bounce is a hit: the impact speed, and a vertical change of 1.7 times it', () => {
    const sc = scenario(1, {}, (s, P) => {
      park(P, s, 0);
      park(P, s, 1);
      placeBall(P, s, 0, 0, 1.8);
    });
    const hit = firstHit(sc, 60);
    expect(hit).not.toBeNull();
    expect(hit!.tick).toBe(hit!.at);
    // From 1 m, within semi-implicit Euler's 1% of √(2gh).
    expect(Math.abs(hit!.strength / Math.sqrt(2 * sc.sim.P.config.gravityMetresPerSecond2) - 1)).toBeLessThan(0.01);
    expect([hit!.dv[0], hit!.dv[1]]).toEqual([0, 0]);
    expect(hit!.dv[2]).toBeCloseTo((1 + sc.sim.P.ballSurface) * hit!.strength, 10); // −v → 0.7 v
    expect(sc.sim.physics.stats.floorBounces).toBeGreaterThan(0);
  });
});

describe('the warm-up ball (D-8; design §4.2)', () => {
  it('stays bit-still and finite through 600 ticks of terriers running, jumping and pouncing into it', () => {
    // 2 a side in warm-up, one slot empty (B2's): the three terriers hold at
    // the ball in the ball frame with zoomies, and press jump and pounce on
    // their own schedules.
    const sc = scenario(2, {}, undefined, { phase: WARM_UP, members: [2, 1] });
    expect(sc.s.terriers.map((t) => t.pack)).toEqual([0, 1, 0]);
    const b0 = { ...sc.s.ball };
    const ballKeys = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'onFloor'] as const;
    let moved = '';
    let infinite = '';
    let substepsSeen = 0;
    let landedOn = 0; // substeps with a terrier on top of the ball
    sc.sim.probe = (s) => {
      substepsSeen++;
      for (const k of ballKeys) if (!moved && !Object.is(s.ball[k], b0[k])) moved = `ball.${k} at tick ${s.tick + 1}`;
      for (const t of s.terriers) {
        for (const v of [t.x, t.y, t.z, t.vx, t.vy, t.vz]) if (!infinite && !Number.isFinite(v)) infinite = `terrier ${t.id} at tick ${s.tick + 1}`;
        const dz = t.z - s.ball.z;
        if (dz > 0 && Math.hypot(t.x - s.ball.x, t.y - s.ball.y, dz) <= 1.05 + 1e-9) landedOn++;
      }
      for (const v of [s.ball.lastHitStrength, s.ball.lastHitDvx, s.ball.lastHitDvy, s.ball.lastHitDvz]) if (!infinite && !Number.isFinite(v)) infinite = 'the ball';
    };
    // Lunges and take-offs as they begin, read before each tick.
    let pounces = 0;
    let jumps = 0;
    const lunging = [false, false, false];
    const takeOff = sc.s.terriers.map((t) => t.takeOffTick);
    run(sc, 600, (k, t) => {
      const T = sc.s.terriers[k]!;
      if (T.lunge > 0 && !lunging[k]) pounces++;
      lunging[k] = T.lunge > 0;
      if (T.takeOffTick !== takeOff[k]) jumps++;
      takeOff[k] = T.takeOffTick;
      return encodeInput({ step: 0, frame: FRAME_BALL, zoomies: true, jump: Math.floor((t + 20 * k) / 45), pounce: Math.floor((t + 31 * k) / 70) });
    });
    expect(moved, 'the ball moved').toBe('');
    expect(infinite, 'a float that is not finite').toBe('');
    expect(substepsSeen).toBe(600 * sc.sim.P.substeps);
    expect(pounces).toBeGreaterThan(10);
    expect(jumps).toBeGreaterThan(10);
    expect(landedOn, 'substeps with a terrier on top of the ball').toBeGreaterThan(0);
    // Its contacts set their ticks, and its hit's change is 0: no axis (A.1).
    const ball = sc.s.ball;
    for (const t of sc.s.terriers) {
      expect(t.lastBallContactTick, t.id).not.toBe(NEVER);
      expect(t.touches, 'touches count only in play').toBe(0);
    }
    expect(ball.lastContactTick).not.toBe(NEVER);
    expect(ball.lastHitTick).not.toBe(NEVER);
    expect(ball.lastHitStrength).toBeGreaterThan(0.3);
    expect([ball.lastHitDvx, ball.lastHitDvy, ball.lastHitDvz]).toEqual([0, 0, 0]);
    expect(stateProblems(sc.s)).toEqual([]);
  });

  it('sends a terrier running straight in at v back at 0.5 v, at the terrier–ball restitution', () => {
    for (const v of [6, 9, 10]) {
      const sc = scenario(1, { gravityMetresPerSecond2: 0 }, (s, P) => {
        park(P, s, 1);
        place(P, s, 0, -1.5, 0, 0.8);
        s.terriers[0]!.vx = v;
      }, { phase: WARM_UP });
      const b0 = { ...sc.s.ball };
      run(sc, 30);
      expect(sc.s.terriers[0]!.vx / v, `at ${v} m/s`).toBeCloseTo(-0.5, 10);
      expect(sc.s.ball).toEqual(Object.assign(b0, { lastHitTick: sc.s.ball.lastHitTick, lastHitStrength: v, lastContactTick: sc.s.ball.lastContactTick }));
      expect(sc.s.ball.lastHitTick).not.toBe(NEVER);
    }
  });
});
