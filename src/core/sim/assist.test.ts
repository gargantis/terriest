import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { config, type Config } from '../../config';
import { pushTime } from './cases';
import { hashState } from './codec';
import { type GoldenResult, type Goldens, replay } from './golden';
import { mirrorInput, STEP_MASK } from './input';
import { dir, fractionOfTurn, HALF_TURN } from './math';
import { defaultParams, type SimParams } from './params';
import {
  ballDir, chasey, NOTHING, park, pinchScene, place, placeBall, pushScene, type Scene, sceneInputs, sceneStart, touchReach,
} from './scenes';
import { GOLDEN_SCRIPTS } from './scripts';
import { cloneState, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, slotOf, type Terrier } from './state';
import { makeSim, type Sim, step } from './step';
import { kineticEnergy, mirrorMismatches, momentum, paramsWith, run, scenario } from './testing';

// C-18's ball-frame push assist (design §4.4; movement.ts): a pusher touching
// a moving ball, holding within a step of forward in the ball frame, drives
// at base / cos φ, capped, so its speed along the ball's travel is its base
// speed. M2 settled it on, at a cap of 9 m/s, provisionally by measurement
// (research/tuning/REPORT.md). A cap of 0 turns it off and skips it
// entirely; on, its cap is at least the zoomies speed (a configuration
// check, src/config.test.ts).
vi.setConfig({ testTimeout: 120_000 });

const ON = 9; // the settled cap: the zoomies speed, the smallest that's on
const at = (cap: number): Partial<Config> => ({ pushAssistCapMetresPerSecond: cap });
const OFF = paramsWith(at(0));
const seconds = (s: number | null): string => (s === null ? 'not reached' : s.toFixed(3));

describe('the push assist on by default, and off (design §4.4)', () => {
  it('is on at its settled cap, which the goldens were emitted at: runs it moves replay to goldens.json, and off they differ', () => {
    expect(config.pushAssistCapMetresPerSecond).toBe(ON);
    expect(defaultParams.pushAssistCap).toBe(ON);
    expect(OFF.pushAssistCap).toBe(0);
    const want = JSON.parse(readFileSync(fileURLToPath(new URL('./goldens.json', import.meta.url)), 'utf8')) as Goldens;
    // Seeded play in all three frames, from genesis: the assist moves both.
    // Off, the rule is skipped: step.test.ts's bit pins run at M0's values,
    // a cap of 0 among them, and still match the spike's bits.
    for (const name of ['match 1', 'roster']) {
      const k = GOLDEN_SCRIPTS.findIndex((r) => r.name === name);
      const golden: GoldenResult = want.runs[k]!;
      expect(replay(GOLDEN_SCRIPTS[k]!), `${name}, on`).toEqual(golden);
      expect(replay(GOLDEN_SCRIPTS[k]!, OFF).final, `${name}, off`).not.toBe(golden.final);
    }
  });
});

describe('the push assist on (design §4.4, C-18)', () => {
  it('pushes two and four abreast in ball view faster than off, and than one pusher: 1.175, 1.175, 0.983 and 0.854 s at 9 m/s', () => {
    // Off they're M0's times, slower than one pusher's 1.225 s.
    const want: [layout: 'round' | 'line', m: number, off: string, on: string][] = [
      ['round', 2, '2.033', '1.175'], ['line', 2, '2.033', '1.175'], ['round', 4, '1.313', '0.983'], ['line', 4, '0.921', '0.854'],
    ];
    const one = pushTime('train', 1, 'ball', at(ON)).seconds!;
    expect(seconds(one)).toBe('1.225');
    expect(seconds(pushTime('train', 1, 'ball', at(0)).seconds)).toBe('1.225');
    for (const [layout, m, offTime, onTime] of want) {
      const off = pushTime(layout, m, 'ball', at(0), 600);
      expect(seconds(off.seconds), `${m} ${layout}, off`).toBe(offTime);
      for (const cap of [ON, 12, 20]) {
        const r = pushTime(layout, m, 'ball', at(cap), 600);
        expect(r.seconds, `${m} ${layout}, cap ${cap}`).not.toBeNull();
        expect(r.seconds!, `${m} ${layout}, cap ${cap}: faster than off`).toBeLessThan(off.seconds!);
        expect(r.seconds!, `${m} ${layout}, cap ${cap}: faster than one pusher`).toBeLessThan(one);
        expect(r.slipOuts).toBe(0);
        if (cap === ON) expect(seconds(r.seconds), `${m} ${layout}`).toBe(onTime);
      }
    }
  });

  // On an axis, dir() is exact, so cos φ is exactly 1 there. Off the axes it
  // can round just under 1, and a lone pusher is then assisted by an ulp:
  // its bits change, but not its push time (below).
  it('leaves one pusher and the trains on an axis, and the pitch frame, alone, bit for bit', () => {
    const scenes = [pushScene('train', 1, 'ball'), pushScene('train', 2, 'ball'), pushScene('train', 4, 'ball'), pushScene('round', 2, 'pitch'), pushScene('line', 4, 'pitch')];
    const on = paramsWith(at(20));
    for (const scene of scenes) {
      const a = { sim: makeSim(OFF, scene.packSize), s: sceneStart(scene, OFF) };
      const b = { sim: makeSim(on, scene.packSize), s: sceneStart(scene, on) };
      for (let t = 1; t <= 120; t++) {
        step(a.sim, a.s, sceneInputs(scene, a.s, t));
        step(b.sim, b.s, sceneInputs(scene, b.s, t));
        expect(hashState(b.s), `${scene.name}, tick ${t}`).toBe(hashState(a.s));
      }
      expect(Math.hypot(a.s.ball.vx, a.s.ball.vy), `${scene.name}: the ball was pushed`).toBeGreaterThan(5);
    }
  });

  it("leaves one pusher's push time alone off the axes too: 1.225 s from 7° to 200°", () => {
    const reach = touchReach(defaultParams);
    const d = new Float64Array(2);
    for (const deg of [7, 30, 45, 61, 135, 200]) {
      dir((HALF_TURN + fractionOfTurn(deg, 360)) >>> 0, d);
      const scene: Scene = {
        name: `one pusher at ${deg}°`, packSize: 1, phase: IN_PLAY, mirrored: false,
        setup: (s, P) => {
          park(P, s, 0);
          park(P, s, 1);
          placeBall(P, s, 0, 0);
          place(P, s, 0, reach * d[0]!, reach * d[1]!);
        },
        input: (pack, rank) => (pack === 0 && rank === 0 ? ballDir(0) : NOTHING),
      };
      for (const cap of [0, ON, 20]) expect(seconds(pushSeconds(scene, paramsWith(at(cap)))), `${scene.name}, cap ${cap}`).toBe('1.225');
    }
  });
});

/** pushTime's measure (cases.ts) for any scene: seconds, by substeps, for
 *  the ball to reach 95% of run speed, or null within 600 ticks. */
function pushSeconds(scene: Scene, P: SimParams): number | null {
  const sim = makeSim(P, scene.packSize);
  const s = sceneStart(scene, P);
  let sub = 0;
  let reached: number | null = null;
  sim.probe = (st) => {
    sub++;
    if (reached === null && Math.hypot(st.ball.vx, st.ball.vy) >= 0.95 * P.runSpeed) reached = sub / (P.config.ticksPerSecond * P.substeps);
  };
  for (let t = 1; t <= 600 && reached === null; t++) step(sim, s, sceneInputs(scene, s, t));
  return reached;
}

/** A scene whose pack A holds `stepOf(rank)` in place of its scene's step. */
function holding(scene: Scene, stepOf: (rank: number) => number): Scene {
  return {
    ...scene,
    name: `${scene.name}, steps changed`,
    input: (pack, rank, t, s) => {
      const v = scene.input(pack, rank, t, s);
      return v === null || v === NOTHING ? v : (v & ~STEP_MASK) | stepOf(rank);
    },
  };
}

describe("the push assist's rule (design §4.4)", () => {
  // The rule restated from the state before each tick and the drive's
  // targets after it (sim.intents, by slot): with a forward step held in the
  // ball frame, touching a ball that moves faster than 0.3 m/s, cos φ in
  // (0, 1), the target speed is min(cap, base / cos φ), so its speed along
  // the ball's travel is the base speed until the cap binds; else the base.
  it("drives each pusher at min(cap, base / cos φ) while it acts, and at its base speed otherwise", () => {
    for (const cap of [ON, 20]) {
      const P = paramsWith(at(cap));
      let assisted = 0;
      let capped = 0;
      for (const [layout, m] of [['round', 2], ['line', 2], ['round', 4], ['line', 4]] as const) {
        const scene = pushScene(layout, m, 'ball');
        const sim = makeSim(P, scene.packSize);
        const s = sceneStart(scene, P);
        for (let t = 1; t <= 150; t++) {
          const vx = s.ball.vx;
          const vy = s.ball.vy;
          const sp = Math.hypot(vx, vy);
          const touching = s.terriers.map((T) => T.touchingBall);
          step(sim, s, sceneInputs(scene, s, t));
          expect(s.phase, `${scene.name}, tick ${t}`).toBe(IN_PLAY);
          for (const T of s.terriers) {
            const k = slotOf(T);
            if (sim.intents.driveOn[k] !== 1) continue;
            const base = sim.intents.zooming[k] === 1 ? P.zoomiesSpeed : P.runSpeed;
            const tvx = sim.intents.targetVx[k]!;
            const tvy = sim.intents.targetVy[k]!;
            const speed = Math.hypot(tvx, tvy);
            const cos = sp > 0 ? (tvx * vx + tvy * vy) / (speed * sp) : 0;
            const acts = touching[s.terriers.indexOf(T)]! && sp > P.restitutionThreshold && cos > 0 && cos < 1;
            const want = acts ? Math.min(cap, base / cos) : base;
            expect(Math.abs(speed - want) / want, `${scene.name}, cap ${cap}, tick ${t}, slot ${k}: ${speed} against ${want}`).toBeLessThan(1e-9);
            if (speed > base * (1 + 1e-9)) {
              assisted++;
              if (speed >= cap * (1 - 1e-12)) capped++;
              else expect(speed * cos, `${scene.name}, tick ${t}, slot ${k}: its speed along the ball's travel`).toBeCloseTo(base, 9);
            }
          }
        }
      }
      // It acted, and at cap 9 the outer of four round the ball, 49.5° off, hit the cap.
      expect(assisted, `cap ${cap}`).toBeGreaterThan(100);
      if (cap === ON) expect(capped).toBeGreaterThan(0);
    }
  });

  it('acts on a step either side of forward, but not two steps aside', () => {
    // A ball-view push gets the ball going with the assist on; from that
    // state, each pusher holds a step other than forward, on and off.
    const on = paramsWith(at(ON));
    const scene = pushScene('round', 2, 'ball');
    const sim = makeSim(on, scene.packSize);
    const s = sceneStart(scene, on);
    for (let t = 1; t <= 45; t++) step(sim, s, sceneInputs(scene, s, t));
    for (const [steps, acts] of [[[1, 31], true], [[31, 1], true], [[2, 30], false], [[30, 2], false]] as const) {
      const turned = holding(scene, (rank) => steps[rank]!);
      const a = { sim: makeSim(on, scene.packSize), s: cloneState(s) };
      const b = { sim: makeSim(OFF, scene.packSize), s: cloneState(s) };
      let differs = 0;
      let could = 0; // ticks where only the step keeps it from acting: touching a moving ball, cos φ in (0, 1)
      for (let t = 46; t <= 90; t++) {
        const vx = b.s.ball.vx;
        const vy = b.s.ball.vy;
        const sp = Math.hypot(vx, vy);
        const touching = b.s.terriers.map((T) => T.touchingBall);
        step(a.sim, a.s, sceneInputs(turned, a.s, t));
        step(b.sim, b.s, sceneInputs(turned, b.s, t));
        if (hashState(a.s) !== hashState(b.s)) differs++;
        for (const T of b.s.terriers) {
          const k = slotOf(T);
          if (b.sim.intents.driveOn[k] !== 1) continue;
          const tvx = b.sim.intents.targetVx[k]!;
          const tvy = b.sim.intents.targetVy[k]!;
          const cos = (tvx * vx + tvy * vy) / (Math.hypot(tvx, tvy) * sp);
          if (touching[b.s.terriers.indexOf(T)] && sp > on.restitutionThreshold && cos > 0 && cos < 1) could++;
        }
      }
      expect(could, `steps ${steps.join(' and ')}: touching a moving ball`).toBeGreaterThan(20);
      if (acts) expect(differs, `steps ${steps.join(' and ')}: assisted`).toBeGreaterThan(0);
      else expect(differs, `steps ${steps.join(' and ')}: the same as off, bit for bit`).toBe(0);
    }
  });

  it('waits for the ball to move faster than 0.3 m/s: the first ticks of a push are the same as off, bit for bit', () => {
    const on = paramsWith(at(ON));
    for (const [layout, m] of [['round', 2], ['line', 2], ['round', 4], ['line', 4]] as const) {
      const scene = pushScene(layout, m, 'ball');
      const a = { sim: makeSim(on, scene.packSize), s: sceneStart(scene, on) };
      const b = { sim: makeSim(OFF, scene.packSize), s: sceneStart(scene, OFF) };
      let slow = 0; // ticks touching a ball that moves, slower than the threshold, cos φ in (0, 1)
      for (let t = 1; t <= 60 && Math.hypot(b.s.ball.vx, b.s.ball.vy) <= on.restitutionThreshold; t++) {
        const vx = b.s.ball.vx;
        const vy = b.s.ball.vy;
        const sp = Math.hypot(vx, vy);
        const touching = b.s.terriers.map((T) => T.touchingBall);
        step(a.sim, a.s, sceneInputs(scene, a.s, t));
        step(b.sim, b.s, sceneInputs(scene, b.s, t));
        expect(hashState(a.s), `${scene.name}, tick ${t}`).toBe(hashState(b.s));
        for (const T of b.s.terriers) {
          const k = slotOf(T);
          if (b.sim.intents.driveOn[k] !== 1 || sp === 0) continue;
          const tvx = b.sim.intents.targetVx[k]!;
          const tvy = b.sim.intents.targetVy[k]!;
          const cos = (tvx * vx + tvy * vy) / (Math.hypot(tvx, tvy) * sp);
          if (touching[b.s.terriers.indexOf(T)] && cos > 0 && cos < 1) slow++;
        }
      }
      expect(slow, `${scene.name}: pushers touching a slow ball, off its line`).toBeGreaterThan(0);
    }
  });
});

describe('energy with the push assist on (design §4.4)', () => {
  // The assist changes only the drive's target, which the rule's tests
  // above check. These check the hits and pushes it steers: with the drive
  // off, nothing it does can add energy, which an assist that wrote
  // velocities would; with the drive on, the contacts add none under the
  // assisted inputs, the solver's own property (hits.test.ts).
  const SPEED = 6;
  const LEAD = SPEED * defaultParams.dt * 20.5;
  /** hits.test.ts's hits: k terriers at 6 m/s hitting a resting ball, here
   *  holding at it in the ball frame, so the assist steers them once they
   *  touch it. The solve is watched: the kinetic energy around each call. */
  function hit(k: number, level: boolean, layout: 'parallel' | 'centre', over: Partial<Config>): { ballSpeed: number; dp: number; gain: number; solveGain: number } {
    const dz = level ? 0 : 0.8 - 0.25;
    const z = level ? 0.8 : 0.25;
    const d = new Float64Array(2);
    const sc = scenario(4, { idleFrictionMetresPerSecond2: 0, rollingSlowdownMetresPerSecond2: 0, gravityMetresPerSecond2: level ? 0 : 9.8, ...over }, (s, P) => {
      for (let j = 0; j < 8; j++) park(P, s, j);
      placeBall(P, s, 0, 0);
      for (let j = 0; j < k; j++) {
        const t = 2 * j;
        if (layout === 'parallel') {
          const y = [[0], [-0.26, 0.26], [-0.52, 0, 0.52], [-0.78, -0.26, 0.26, 0.78]][k - 1]![j]!;
          place(P, s, t, -Math.sqrt(1.05 * 1.05 - dz * dz - y * y) - LEAD, y, z);
          s.terriers[t]!.vx = SPEED;
        } else {
          const deg = [[0], [-25, 25], [-35, 0, 35], [-55, -20, 20, 55]][k - 1]![j]!;
          dir((HALF_TURN + fractionOfTurn(deg < 0 ? 360 + deg : deg, 360)) >>> 0, d);
          const reach = Math.sqrt(1.05 * 1.05 - dz * dz);
          place(P, s, t, (reach + LEAD) * d[0]!, (reach + LEAD) * d[1]!, z);
          s.terriers[t]!.vx = -SPEED * d[0]!;
          s.terriers[t]!.vy = -SPEED * d[1]!;
        }
      }
    });
    const P = sc.sim.P;
    const ph = sc.sim.physics;
    const solve = ph.solve.bind(ph);
    let solveGain = -Infinity;
    ph.solve = (bodies) => {
      const e0 = kineticEnergy(sc.s, P);
      solve(bodies);
      solveGain = Math.max(solveGain, kineticEnergy(sc.s, P) - e0);
    };
    const p0 = momentum(sc.s, P);
    const ke0 = kineticEnergy(sc.s, P);
    let gain = -Infinity;
    sc.sim.probe = (s) => { gain = Math.max(gain, kineticEnergy(s, P) - ke0); };
    run(sc, 30, (j) => (j % 2 === 0 && j / 2 < k ? ballDir(0) : 0));
    const p1 = momentum(sc.s, P);
    return { ballSpeed: Math.hypot(sc.s.ball.vx, sc.s.ball.vy), dp: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), gain, solveGain };
  }

  it("gains none in M0's hits, with the drive off: momentum within 1e-9 and M0's speeds", () => {
    const speeds: string[] = [];
    for (const level of [false, true]) {
      for (const layout of ['parallel', 'centre'] as const) {
        for (let k = 1; k <= 4; k++) {
          const r = hit(k, level, layout, { accelerationMetresPerSecond2: 0, ...at(20) });
          expect(r.gain, `k = ${k}, ${layout}${level ? ', level' : ''}`).toBeLessThanOrEqual(1e-9);
          expect(r.dp).toBeLessThan(1e-9);
          speeds.push(r.ballSpeed.toFixed(3));
        }
      }
    }
    // hits.test.ts's figures: from the floor, then level; parallel, then at the centre.
    expect(speeds).toEqual(['2.656', '3.571', '3.810', '3.685', '2.656', '3.690', '4.300', '4.477', '3.000', '4.354', '4.999', '5.213', '3.000', '4.478', '5.469', '6.157']);
  });

  it('and with the drive on, the contacts add none under assisted inputs: in every hit and every push, each solve keeps or loses kinetic energy', () => {
    for (const cap of [ON, 20]) {
      for (const level of [false, true]) {
        for (const layout of ['parallel', 'centre'] as const) {
          for (let k = 1; k <= 4; k++) expect(hit(k, level, layout, at(cap)).solveGain, `cap ${cap}, k = ${k}, ${layout}`).toBeLessThanOrEqual(0);
        }
      }
      for (const [layout, m] of [['round', 2], ['line', 2], ['round', 4], ['line', 4]] as const) {
        const P = paramsWith(at(cap));
        const scene = pushScene(layout, m, 'ball');
        const sim = makeSim(P, scene.packSize);
        const s = sceneStart(scene, P);
        const solve = sim.physics.solve.bind(sim.physics);
        let worst = -Infinity;
        sim.physics.solve = (bodies) => {
          const e0 = kineticEnergy(s, P);
          solve(bodies);
          worst = Math.max(worst, kineticEnergy(s, P) - e0);
        };
        for (let t = 1; t <= 240; t++) step(sim, s, sceneInputs(scene, s, t));
        expect(worst, `${scene.name}, cap ${cap}`).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe('P8 with the push assist on (design §4.4)', () => {
  it('keeps mirrored kickoffs exactly mirrored at every pack size, and acts in none: in a mirrored state the ball is still horizontally', () => {
    const on = paramsWith(at(20));
    for (let packSize = 1; packSize <= 4; packSize++) {
      const scenes: Scene[] = [
        { name: `kickoff ${packSize}, all`, packSize, phase: KICKOFF_COUNTDOWN, mirrored: true, input: chasey(40 + packSize, 'all') },
        { name: `kickoff ${packSize}, contact`, packSize, phase: KICKOFF_COUNTDOWN, mirrored: true, input: chasey(90 + packSize, 'contact') },
        pinchScene(packSize, packSize % 2 === 0),
      ];
      for (const scene of scenes) {
        const a = { sim: makeSim(on, packSize), s: sceneStart(scene, on) };
        const b = { sim: makeSim(OFF, packSize), s: sceneStart(scene, OFF) };
        let first: string | null = null;
        a.sim.probe = (st, sub) => {
          if (first !== null) return;
          const m = mirrorMismatches(st, 1);
          if (m.length > 0) first = `tick ${st.tick + 1}, substep ${sub}: ${m[0]}`;
        };
        for (let t = 1; t <= 900; t++) {
          step(a.sim, a.s, sceneInputs(scene, a.s, t));
          step(b.sim, b.s, sceneInputs(scene, b.s, t));
        }
        expect(first, scene.name).toBeNull();
        // The ball's horizontal velocity is its own negation, ±0, so the rule's speed test never passes.
        expect(hashState(a.s), `${scene.name}: the same as off`).toBe(hashState(b.s));
      }
    }
  });

  /** A push scene and its point mirror: pack B's terriers in pack A's
   *  places, negated, and pack A's in pack B's, each sending the mirror of
   *  the other's input. The kickoff placement already gives mirrored
   *  headings, and park() mirrored corners. */
  function mirrorOf(scene: Scene): Scene {
    return {
      ...scene,
      name: `${scene.name}, mirrored`,
      setup: (s, P) => {
        scene.setup?.(s, P);
        for (let k = 0; k + 1 < s.terriers.length; k += 2) {
          const A = s.terriers[k]!, B = s.terriers[k + 1]!;
          const ax = A.x, ay = A.y;
          place(P, s, k, -B.x, -B.y);
          place(P, s, k + 1, -ax, -ay);
        }
      },
      input: (pack, rank, t, s) => {
        const v = scene.input((1 - pack) as 0 | 1, rank, t, s);
        return v === null ? null : mirrorInput(v);
      },
    };
  }
  /** Body by body, what differs between a state and the point mirror of another. */
  function unmirrored(a: Readonly<MatchState>, b: Readonly<MatchState>): string[] {
    const out: string[] = [];
    const turned = (h: number): number => (h + HALF_TURN) >>> 0;
    const pair = (x: Readonly<Terrier> | Readonly<MatchState['ball']>, y: typeof x, who: string, heading: boolean): void => {
      const want = [-x.x, -x.y, x.z, -x.vx, -x.vy, x.vz, x.onFloor];
      const got = [y.x, y.y, y.z, y.vx, y.vy, y.vz, y.onFloor];
      if (heading) {
        want.push(turned((x as Terrier).heading), (x as Terrier).touchingBall, (x as Terrier).slipping);
        got.push((y as Terrier).heading, (y as Terrier).touchingBall, (y as Terrier).slipping);
      }
      for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) out.push(`${who}: field ${i}, ${String(got[i])} against ${String(want[i])}`);
    };
    for (let k = 0; k + 1 < a.terriers.length; k += 2) {
      pair(a.terriers[k]!, b.terriers[k + 1]!, `A${k >> 1} against B${k >> 1}`, true);
      pair(a.terriers[k + 1]!, b.terriers[k]!, `B${k >> 1} against A${k >> 1}`, true);
    }
    pair(a.ball, b.ball, 'the ball', false);
    return out;
  }

  it('steers a push and its point mirror to exact mirror images, at 1, 2 and 4 a side, while it acts', () => {
    const on = paramsWith(at(ON));
    const runOf = (P: SimParams, scene: Scene): { sim: Sim; s: MatchState } => ({ sim: makeSim(P, scene.packSize), s: sceneStart(scene, P) });
    for (const scene of [pushScene('train', 1, 'ball'), pushScene('round', 2, 'ball'), pushScene('line', 2, 'ball'), pushScene('round', 4, 'ball'), pushScene('line', 4, 'ball')]) {
      const twin = mirrorOf(scene);
      const a = runOf(on, scene), b = runOf(on, twin), off = runOf(OFF, scene);
      expect(unmirrored(a.s, b.s), `${scene.name}: placed`).toEqual([]);
      for (let t = 1; t <= 180; t++) {
        step(a.sim, a.s, sceneInputs(scene, a.s, t));
        step(b.sim, b.s, sceneInputs(twin, b.s, t));
        step(off.sim, off.s, sceneInputs(scene, off.s, t));
        expect(unmirrored(a.s, b.s).slice(0, 3), `${scene.name}, tick ${t}`).toEqual([]);
      }
      // Pushers off the ball's travel were steered: the run differs from the assist's off.
      if (scene.name.startsWith('1 ')) expect(hashState(a.s)).toBe(hashState(off.s));
      else expect(hashState(a.s), scene.name).not.toBe(hashState(off.s));
    }
  });
});
