import { describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DT, SLIP_OUT_RULES, type SlipOutName } from './config';
import { goldenSuite } from './golden';
import { pushScript } from './scripts';
import { ballOnTerriers, dribble, type Holding, kickoffPinch, pushTime } from './cases';
import { createReplayBench } from './source';
import { park, place, placeBall } from './scripts';
import { kineticEnergy, momentum, run, scenario } from './testing';
import { dir, fractionOfTurn, HALF_TURN } from './angle';

// M0's measurements behind research/spike/REPORT.md, from the simulation's
// side: run 2's numbers in full, and run 3's tick cost in Node. Slow, so
// guarded:
//   TERRIEST_SPIKE_MEASURE=1 npx vitest run src/sim/measure.test.ts
// writes results/sim.json and prints each table. TERRIEST_SPIKE_MEASURE=quick
// skips the fine slip-out sweeps.

const MODE = process.env.TERRIEST_SPIKE_MEASURE;
const out: Record<string, unknown> = { utc: new Date().toISOString(), node: process.version };
const results = fileURLToPath(new URL('../../results/sim.json', import.meta.url));

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

describe.runIf(MODE !== undefined)('M0 measurements (simulation)', () => {
  it('push times, under both readings of the floor', () => {
    const rows: Record<string, unknown>[] = [];
    for (const floorInSolve of [true, false]) {
      const cases: [string, 'train' | 'line' | 'round', number, 'pitch' | 'ball'][] = [
        ['one pusher, pitch frame', 'train', 1, 'pitch'], ['one pusher, ball frame', 'train', 1, 'ball'],
        ['two in a train', 'train', 2, 'pitch'], ['four in a train', 'train', 4, 'pitch'],
        ['two round the ball, pitch frame', 'round', 2, 'pitch'], ['two round the ball, ball frame', 'round', 2, 'ball'],
        ['two on a line, pitch frame', 'line', 2, 'pitch'], ['two on a line, ball frame', 'line', 2, 'ball'],
        ['four round the ball, pitch frame', 'round', 4, 'pitch'], ['four round the ball, ball frame', 'round', 4, 'ball'],
        ['four on a line, pitch frame', 'line', 4, 'pitch'], ['four on a line, ball frame', 'line', 4, 'ball'],
      ];
      for (const [name, layout, m, frame] of cases) {
        const r = pushTime(pushScript(name, layout, m, frame), { floorInSolve }, 600);
        rows.push({ name, floorInSolve, seconds: r.seconds, top: r.top, ballOffFloorShare: r.airborneShare, slipOuts: r.slipOuts });
      }
    }
    out.pushes = rows;
    console.table(rows);
  });

  it('simultaneous hits, under both readings of the floor', () => {
    const rows: Record<string, unknown>[] = [];
    const LEAD = 6 * DT * 20.5;
    const d = new Float64Array(2);
    for (const floorInSolve of [true, false]) for (const level of [false, true]) for (const layout of ['parallel', 'centre'] as const) {
      const speeds: number[] = [];
      let worstGain = -Infinity;
      let worstDp = 0;
      for (let k = 1; k <= 4; k++) {
        const dz = level ? 0 : 0.55, z = level ? 0.8 : 0.25;
        const sc = scenario(4, { drive: false, friction: false, rolling: false, gravity: level ? 0 : 9.8, floorInSolve }, (s) => {
          for (let j = 0; j < 8; j++) park(s, j);
          placeBall(s, 0, 0);
          for (let j = 0; j < k; j++) {
            if (layout === 'parallel') {
              const y = [[0], [-0.26, 0.26], [-0.52, 0, 0.52], [-0.78, -0.26, 0.26, 0.78]][k - 1]![j]!;
              place(s, 2 * j, -Math.sqrt(1.05 * 1.05 - dz * dz - y * y) - LEAD, y, z);
              s.terriers[2 * j]!.vx = 6;
            } else {
              const deg = [[0], [-25, 25], [-35, 0, 35], [-55, -20, 20, 55]][k - 1]![j]!;
              dir((HALF_TURN + fractionOfTurn(deg < 0 ? 360 + deg : deg, 360)) >>> 0, d);
              const reach = Math.sqrt(1.05 * 1.05 - dz * dz) + LEAD;
              place(s, 2 * j, reach * d[0]!, reach * d[1]!, z);
              s.terriers[2 * j]!.vx = -6 * d[0]!;
              s.terriers[2 * j]!.vy = -6 * d[1]!;
            }
          }
        });
        const C = sc.sim.C;
        const p0 = momentum(sc.s, C);
        const e0 = kineticEnergy(sc.s, C);
        sc.sim.probe = (s) => { worstGain = Math.max(worstGain, kineticEnergy(s, C) - e0); };
        run(sc, 30);
        const p1 = momentum(sc.s, C);
        worstDp = Math.max(worstDp, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));
        speeds.push(Math.hypot(sc.s.ball.vx, sc.s.ball.vy));
      }
      rows.push({ floorInSolve, where: level ? 'level' : 'from the floor', layout, speeds: speeds.map((v) => +v.toFixed(4)), worstMomentumChange: worstDp, worstEnergyGain: worstGain });
    }
    out.hits = rows;
    console.table(rows);
  });

  it('slip-out candidates: the coarse survey for all, the fine sweep for the leaders', () => {
    const names = Object.keys(SLIP_OUT_RULES) as SlipOutName[];
    const fine = MODE === 'quick' ? [] : (['flag42', 'flag42E0', 'flag', 'flagE0', 'flag44E0', 'drafted'] as SlipOutName[]);
    const table: Record<string, unknown>[] = [];
    for (const name of names) {
      const step = fine.includes(name) ? 1 : 5;
      let worst = 0, held = 0, cases = 0, mismatches = 0;
      const heldCases: string[] = [];
      for (let th = 5; th <= 58; th += step) {
        for (const holding of ['ball frame', 'pitch frame, opposite'] as Holding[]) for (let p = 1; p <= 4; p++) for (const offMirror of [false, true]) {
          const r = ballOnTerriers(name, { packSize: p, thetaDeg: th, holding, offMirror }, 8);
          if (r.landed === null) continue;
          cases++;
          if (r.down === null) { held++; if (heldCases.length < 8) heldCases.push(`${holding} θ${th} ×${p}${offMirror ? ' off-mirror' : ''}`); } else worst = Math.max(worst, r.down);
          if (!offMirror && r.mirror !== null) mismatches++;
        }
      }
      let sitWorst = 0, sitAt = 0;
      for (let th = 4; th <= 58; th += step === 1 ? 0.25 : 2) {
        const r = ballOnTerriers(name, { packSize: 1, thetaDeg: th, holding: 'sitting' }, 8);
        if (r.landed === null) continue;
        const v = r.down ?? Infinity;
        if (v > sitWorst) { sitWorst = v; sitAt = th; }
      }
      let dribbleSlips = 0, dribbles = 0;
      for (const fr of ['ball', 'pitch'] as const) for (const z of [false, true]) for (let v = 0; v <= (z ? 9 : 6); v += 3) for (let i = 0; i < (step === 1 ? 12 : 4); i++) {
        for (const stepOff of fr === 'ball' ? [0, 3, 29] : [0]) { dribbleSlips += dribble(name, fr, z, 0.05 + i * 0.0313, {}, v, stepOff).slipOuts; dribbles++; }
      }
      const pinches: Record<string, number | null> = {};
      let pinchMismatches = 0;
      for (let p = 1; p <= 4; p++) for (const z of [false, true]) {
        const r = kickoffPinch(name, p, z, 10);
        pinches[`${p}${z ? ' zoomies' : ''}`] = r.down === null ? null : +r.down.toFixed(3);
        if (r.mirror !== null) pinchMismatches++;
      }
      table.push({
        rule: SLIP_OUT_RULES[name].name, sweep: step === 1 ? 'fine' : 'coarse', restCases: cases, restHeld: held, restWorst: +worst.toFixed(3), restHeldCases: heldCases,
        mirroredMismatches: mismatches, sittingWorst: Number.isFinite(sitWorst) ? +sitWorst.toFixed(3) : 'held', sittingWorstAt: sitAt,
        dribbles, dribbleSlips, pinchDown: pinches, pinchMismatches,
      });
    }
    out.slipOut = table;
    console.table(table.map((r) => ({ ...r, restHeldCases: (r.restHeldCases as string[]).length, pinchDown: JSON.stringify(r.pinchDown) })));
  }, 3_600_000);

  it('the dribble hop angles, the cone bound they set', () => {
    let min = 180, at = '';
    let n = 0;
    for (const fr of ['ball', 'pitch'] as const) for (const z of [false, true]) for (let v = 0; v <= (z ? 9 : 6); v += 1.5) for (let i = 0; i < 24; i++) {
      for (let stepOff = 0; stepOff <= 8; stepOff++) {
        const d = dribble('none', fr, z, 0.05 + i * 0.0157, {}, v, fr === 'ball' ? stepOff : 0);
        n++;
        if (d.hopAngles[0] < min) { min = d.hopAngles[0]; at = `${fr} frame step ${stepOff}, ${z ? 'zoomies' : 'run'}, from ${v} m/s, run-up ${(0.05 + i * 0.0157).toFixed(4)} m`; }
        if (fr === 'pitch') break;
      }
    }
    out.dribbleHop = { runs: n, smallestDegFromVertical: +min.toFixed(3), at, sittingFrictionBoundDeg: +((Math.atan(8 / 9.8) * 180) / Math.PI).toFixed(2) };
    console.log(out.dribbleHop);
  }, 600_000);

  it('tick cost in Node: a 13-step replay every tick on the 4-a-side scrums, and the worst single ticks', () => {
    const rows: Record<string, unknown>[] = [];
    for (const script of ['scrum in the corner, flag42', 'scrum in the corner', 'scrum at the wall, flag42', 'scrum at the wall']) {
      const bench = createReplayBench({ script, warmTicks: 120 });
      for (let i = 0; i < 60; i++) bench.tick(); // warm the JIT
      const s0 = { ...bench.stats() };
      const times: number[] = [];
      for (let i = 0; i < 1200; i++) {
        const t0 = performance.now();
        bench.tick();
        times.push(performance.now() - t0);
      }
      const st = { ...bench.stats() }; // before the bursts below add to it
      const subs = st.substeps - s0.substeps;
      const bursts: Record<string, { median: number; max: number }> = {};
      for (const steps of [13, 30, 42, 270]) {
        const ts: number[] = [];
        for (let i = 0; i < 20; i++) {
          const t0 = performance.now();
          bench.burst(steps);
          ts.push(performance.now() - t0);
        }
        bursts[`${steps} steps`] = { median: +pct(ts, 50).toFixed(3), max: +Math.max(...ts).toFixed(3) };
      }
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      rows.push({
        script, ticksTimed: times.length,
        tickMs: { p50: +pct(times, 50).toFixed(3), p95: +pct(times, 95).toFixed(3), max: +Math.max(...times).toFixed(3), mean: +mean.toFixed(3) },
        stepUs: +((mean / 13) * 1000).toFixed(1),
        contactsPerSubstep: +((st.contacts - s0.contacts) / subs).toFixed(2),
        ofWhichFloor: +((st.floorContacts - s0.floorContacts) / subs).toFixed(2),
        maxContacts: st.maxContacts,
        bursts,
      });
    }
    out.tickCost = rows;
    for (const r of rows) console.log(r);
  }, 600_000);

  it('the golden suite, timed in Node', () => {
    const t0 = performance.now();
    const runs = goldenSuite();
    const ms = performance.now() - t0;
    const ticks = runs.reduce((a, r) => a + r.checkpoints.length * 500, 0);
    out.goldens = { runs: runs.length, ms: +ms.toFixed(0), ticksAtCheckpoints: ticks };
    console.log(out.goldens);
    mkdirSync(fileURLToPath(new URL('../../results/', import.meta.url)), { recursive: true });
    writeFileSync(results, JSON.stringify(out, null, 1) + '\n');
  });
});
