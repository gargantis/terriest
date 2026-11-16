import { describe, expect, it, vi } from 'vitest';
import { substepDt } from './config';
import { WALL } from './pitch';
import { ballDir, NOTHING, park, place, placeBall } from './scripts';
import { kineticEnergy, run, scenario } from './testing';

// These run whole scripted matches; under a parallel run they need more than vitest's 5 s.
vi.setConfig({ testTimeout: 120_000 });

// PLAN §16 Simulation, M0 run 2: resting contact, bounces and settling.

/** The bits of every body's position and velocity, and the ball's flags. */
function bodyBits(s: { ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number; onFloor: boolean }; terriers: { x: number; y: number; z: number; vx: number; vy: number; vz: number; heading: number; onFloor: boolean }[] }): string {
  const f = new Float64Array(6 * (1 + s.terriers.length));
  const all = [s.ball, ...s.terriers];
  all.forEach((b, i) => f.set([b.x, b.y, b.z, b.vx, b.vy, b.vz], 6 * i));
  const bytes = new Uint8Array(f.buffer);
  let hex = '';
  for (const v of bytes) hex += v.toString(16).padStart(2, '0');
  return `${hex}|${all.map((b) => (b.onFloor ? 1 : 0)).join('')}|${s.terriers.map((t) => t.heading).join(',')}`;
}

describe('resting contact (D-5 step 4)', () => {
  it('holds a resting ball and standing terriers bit-still for 10 minutes of ticks', () => {
    const sc = scenario(1, {}, (s) => {
      placeBall(s, 0, 0);
      place(s, 0, -3, 2);
      place(s, 1, 3, -2);
    });
    const want = bodyBits(sc.s);
    let changed = -1;
    for (let i = 1; i <= 36_000 && changed < 0; i++) {
      run(sc, 1);
      if (bodyBits(sc.s) !== want) changed = i;
    }
    expect(changed, 'first tick a body changed').toBe(-1);
    expect(sc.s.tick).toBe(36_000);
  }, 120_000);

  // A terrier standing against the ball, the ball against the side wall.
  // Placed at exactly the touching distances, rounding leaves the terrier
  // 6.7e-16 m clear of the ball and the ball 7e-16 m clear of the wall, so
  // the solver would see only the floor's three contacts: each body starts
  // 1 µm into the next, and the contacts it rests on are counted.
  const EPS = 1e-6;
  const againstWall = (): ReturnType<typeof scenario> => scenario(1, {}, (s) => {
    placeBall(s, 3, -14 + 0.8 - EPS);
    place(s, 0, 3, -14 + 0.8 - EPS + Math.sqrt(0.8) - EPS);
    park(s, 1);
  });
  /** Substeps with terrier 0 touching the ball, and ticks with the ball touching a wall. */
  function countContacts(sc: ReturnType<typeof scenario>): { terrierBall: number; ballWallTicks: number } {
    const P = sc.sim.physics;
    const ball = P.ball;
    const seen = { terrierBall: 0, ballWallTicks: 0 };
    let wallThisTick = false;
    sc.sim.probe = (_s, sub) => {
      for (let c = 0; c < P.cnt; c++) {
        if (P.ci[c] === 0 && P.cj[c] === ball) seen.terrierBall++;
        if (P.ci[c] === ball && P.cj[c]! < 0 && P.pieceSurface(c) === WALL) wallThisTick = true;
      }
      if (sub === sc.sim.C.substeps - 1) {
        if (wallThisTick) seen.ballWallTicks++;
        wallThisTick = false;
      }
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
    // which the closest-point test reads as clear of it.
    expect(seen.terrierBall).toBe(36_000 * sc.sim.C.substeps);
  }, 120_000);

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
    expect(seen.terrierBall).toBe(36_000 * sc.sim.C.substeps);
    expect(seen.ballWallTicks).toBe(36_000);
  }, 120_000);
});

describe('bounces keep their fraction above 0.3 m/s (D-5, L308, L311)', () => {
  it('the ball off the floor keeps 70% of its impact speed, within 1%, at every drop height', () => {
    // The rebound speed against the ideal impact speed √(2gh). The apex
    // ratio also carries semi-implicit Euler's O(dt) error, about 1% at a
    // 1 m drop, so it's checked from 2 m.
    const rows: string[] = [];
    for (const h0 of [0.25, 0.5, 1, 2, 4]) {
      const sc = scenario(1, {}, (s) => {
        park(s, 0);
        park(s, 1);
        placeBall(s, 0, 0, 0.8 + h0);
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
      rows.push(`${h0} m: e ${e.toFixed(4)}, by apex ${eApex.toFixed(4)}`);
      expect(Math.abs(e - 0.7) / 0.7, `drop ${h0} m: e = ${e}`).toBeLessThan(0.01);
      if (h0 >= 2) expect(Math.abs(eApex - 0.7) / 0.7, `drop ${h0} m: apex e = ${eApex}`).toBeLessThan(0.01);
    }
    console.log(`[floor bounce] ${rows.join('; ')}`);
  });

  it('the ball off a wall, the overhead net, a post and a crossbar keeps 70% of its normal speed; the goal netting 30%', () => {
    const cases: { name: string; ball: [number, number, number]; v: [number, number, number]; e: number; axis: 0 | 1 | 2 }[] = [
      { name: 'side wall', ball: [0, 10, 0.8], v: [0, 5, 0], e: 0.7, axis: 1 },
      { name: 'end wall', ball: [-15, 8, 0.8], v: [-5, 0, 0], e: 0.7, axis: 0 },
      { name: 'overhead net', ball: [0, 0, 4.5], v: [0, 0, 6], e: 0.7, axis: 2 },
      { name: 'post', ball: [-17, 4.1, 0.8], v: [-5, 0, 0], e: 0.7, axis: 0 },
      { name: 'crossbar', ball: [17, 0, 3.1], v: [5, 0, 0], e: 0.7, axis: 0 },
      { name: 'back netting', ball: [-20.6, 0, 0.8], v: [-3, 0, 0], e: 0.3, axis: 0 },
    ];
    for (const c of cases) {
      const sc = scenario(1, { rolling: false, gravity: 0 }, (s) => {
        park(s, 0);
        park(s, 1);
        placeBall(s, c.ball[0], c.ball[1], c.ball[2], c.v[0], c.v[1], c.v[2]);
      });
      const before = c.v[c.axis];
      run(sc, 60);
      const b = sc.s.ball;
      const after = [b.vx, b.vy, b.vz][c.axis]!;
      expect(-after / before, c.name).toBeCloseTo(c.e, 10);
    }
  });

  it('a terrier hitting a resting ball level keeps 50% of the closing speed, sending it at half its speed', () => {
    for (const v of [6, 9, 10]) {
      const sc = scenario(1, { rolling: false, gravity: 0 }, (s) => {
        park(s, 1);
        placeBall(s, 0, 0);
        place(s, 0, -1.5, 0, 0.8);
        s.terriers[0]!.vx = v;
      });
      run(sc, 30);
      const t = sc.s.terriers[0]!;
      const b = sc.s.ball;
      expect((b.vx - t.vx) / v, `at ${v} m/s`).toBeCloseTo(0.5, 10);
      expect(b.vx / v, 'half the hitter\'s speed (masses 1 and 2)').toBeCloseTo(0.5, 10);
    }
  });

  it('terriers off each other and off a wall keep 30%', () => {
    const sc = scenario(1, { drive: false, friction: false }, (s) => {
      placeBall(s, 0, 8);
      place(s, 0, -2, -5);
      place(s, 1, 2, -5);
      s.terriers[0]!.vx = 6;
      s.terriers[1]!.vx = -6;
    });
    run(sc, 60);
    expect(sc.s.terriers[1]!.vx - sc.s.terriers[0]!.vx).toBeCloseTo(0.3 * 12, 10);
    const w = scenario(1, { drive: false, friction: false }, (s) => {
      park(s, 1);
      place(s, 0, 0, -12);
      s.terriers[0]!.vy = -4;
    });
    run(w, 60);
    expect(w.s.terriers[0]!.vy).toBeCloseTo(0.3 * 4, 10);
  });

  it('settles without a bounce at or below 0.3 m/s', () => {
    const sc = scenario(1, { rolling: false, gravity: 0 }, (s) => {
      park(s, 0);
      park(s, 1);
      placeBall(s, 0, 13.1, 0.8, 0, 0.25, 0);
    });
    run(sc, 60);
    expect(sc.s.ball.vy).toBe(0);
    expect(sc.s.ball.y).toBeCloseTo(14 - 0.8, 12);
  });

  it('a terrier landing from any height stays on the floor, with no bounce', () => {
    for (const h of [0.2, 1, 3, 5]) {
      const sc = scenario(1, {}, (s) => {
        park(s, 1);
        place(s, 0, -5, 0, 0.25 + h);
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
    }
  });
});

describe('rolling (A.5)', () => {
  it('slows the ball by the configured rate within 1e-12 m/s a substep and stops it exactly', () => {
    const sc = scenario(1, {}, (s) => {
      park(s, 0);
      park(s, 1);
      placeBall(s, -6, -3, 0.8, 3, 1.5, 0);
    });
    let worst = 0;
    let last = Math.hypot(3, 1.5);
    let stoppedAt = -1;
    let n = 0;
    sc.sim.probe = (s) => {
      n++;
      const sp = Math.hypot(s.ball.vx, s.ball.vy);
      if (sp > 0) worst = Math.max(worst, Math.abs(last - sp - 0.5 * substepDt(sc.sim.C)));
      else if (stoppedAt < 0) stoppedAt = n;
      last = sp;
    };
    run(sc, 600);
    expect(worst).toBeLessThan(1e-12);
    expect(sc.s.ball.vx === 0 && sc.s.ball.vy === 0).toBe(true);
    // 3.354 m/s at 0.5 m/s² stops after 6.708 s, rolling 11.25 m.
    expect(stoppedAt / sc.sim.C.substeps / 60).toBeCloseTo(Math.hypot(3, 1.5) / 0.5, 1);
    expect(Math.hypot(sc.s.ball.x + 6, sc.s.ball.y + 3)).toBeCloseTo(11.25, 1);
  });

  it('keeps the kinetic energy of a ball in flight between bounces (no air drag)', () => {
    const sc = scenario(1, { gravity: 0 }, (s) => {
      park(s, 0);
      park(s, 1);
      placeBall(s, 0, 0, 3, 2, 1, 0);
    });
    const e0 = kineticEnergy(sc.s, sc.sim.C);
    run(sc, 60);
    expect(kineticEnergy(sc.s, sc.sim.C)).toBe(e0);
  });
});
