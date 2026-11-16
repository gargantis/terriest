// M0's stop rule (PLAN §17 M0), evaluated condition by condition from the
// runs' results, with the simulation's own conditions measured here as well,
// with counts, rather than read off a passing assertion:
// - a resting ball held bit-still: contacts.test.ts's three scenes, 36,000
//   ticks (10 minutes) each, every body's float64 bits, headings and floor
//   flags compared with the start after every tick, with the contacts the
//   bodies rest on counted;
// - simultaneous hitters gaining no energy: hits.test.ts's and
//   measure.test.ts's hits, k = 1 to 4, from the floor and level, parallel
//   and aimed at the centre, under both readings of the floor, the kinetic
//   energy compared with its start after every substep;
// - a mirrored kickoff exactly mirrored (P8, by value, after every
//   substep): mirror.test.ts's kickoffs, every mirrored golden script, and
//   kickoffs and pinches at each pack size under M0's pick (42° + the flag);
// - and from the other runs' files: run 1 (results/determinism-*.json), the
//   slip-out survey (results/sim.json, written by measure.test.ts), and run
//   3's tick cost and worst single ticks (results/cost-*.json and
//   results/cost.json), with the load each ran under (results/runs-log.json).
// Writes results/stop-rule.json and prints a line per condition.
//
//   node scripts/stop-rule.mjs
//
// M0's cost revisit: with --measured-only, only the three conditions
// measured here run, written to the file --out names; TERRIEST_SPIKE_SOLVER
// runs them under a solver variant (src/solver-settings.ts), which is
// refused without --measured-only, since the runs' files belong to M0's
// settings.
//
//   TERRIEST_SPIKE_SOLVER=i4 node scripts/stop-rule.mjs --measured-only --out results/revisit/conditions-i4.json
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dir, fractionOfTurn, HALF_TURN } from '../src/sim/angle.ts';
import { makeConfig, SLIP_OUT_RULES, substepDt } from '../src/sim/config.ts';
import { WALL } from '../src/sim/pitch.ts';
import { ballDir, chasey, GOLDEN_SCRIPTS, park, pinch, place, placeBall, scriptConfig, scriptInputs, scriptStart } from '../src/sim/scripts.ts';
import { makeSim, step } from '../src/sim/step.ts';
import { kineticEnergy, mirrorMismatches, momentum, run, scenario } from '../src/sim/testing.ts';
import { applySolverDefaults } from '../src/solver-settings.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = join(root, 'results');
const readJson = (name) => JSON.parse(readFileSync(join(results, name), 'utf8'));
const t0 = performance.now();
const variant = process.env.TERRIEST_SPIKE_SOLVER ?? '';
const MEASURED_ONLY = process.argv.includes('--measured-only');
if (variant.trim() !== '' && !MEASURED_ONLY) throw new Error('a solver variant runs only the measured conditions: pass --measured-only and --out');
const outArg = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const outFile = outArg ? resolve(outArg) : join(results, MEASURED_ONLY ? 'stop-rule-measured.json' : 'stop-rule.json');
const solver = applySolverDefaults(variant);

// --- A resting ball, bit-still -----------------------------------------------

/** The float64 bits of every body's position and velocity, its heading and its floor flag. */
function bodies(s) {
  const all = [s.ball, ...s.terriers];
  const f = new Float64Array(6 * all.length);
  all.forEach((b, i) => f.set([b.x, b.y, b.z, b.vx, b.vy, b.vz], 6 * i));
  return { bits: new Uint8Array(f.buffer).slice(), values: f, flags: all.map((b) => (b.onFloor ? 1 : 0)).join(''), headings: s.terriers.map((t) => t.heading).join(',') };
}

function bitStill(name, setup, settle, input = () => 0) {
  const sc = scenario(1, {}, setup);
  if (settle) run(sc, settle, input);
  // The contacts the bodies rest on, counted while they're compared: every
  // contact, terrier 0 against the ball, and the ball against a wall.
  const P = sc.sim.physics;
  const contacts = { perSubstep: 0, terrierBallSubsteps: 0, ballWallSubsteps: 0 };
  sc.sim.probe = () => {
    contacts.perSubstep += P.cnt;
    for (let c = 0; c < P.cnt; c++) {
      if (P.ci[c] === 0 && P.cj[c] === P.ball) contacts.terrierBallSubsteps++;
      if (P.ci[c] === P.ball && P.cj[c] < 0 && P.pieceSurface(c) === WALL) contacts.ballWallSubsteps++;
    }
  };
  const want = bodies(sc.s);
  const TICKS = 36_000;
  let changedTicks = 0;
  let first = -1;
  let maxDeviation = 0;
  for (let i = 1; i <= TICKS; i++) {
    run(sc, 1, input);
    const got = bodies(sc.s);
    let same = got.flags === want.flags && got.headings === want.headings;
    for (let j = 0; same && j < got.bits.length; j++) if (got.bits[j] !== want.bits[j]) same = false;
    if (!same) {
      changedTicks++;
      if (first < 0) first = i;
      for (let j = 0; j < got.values.length; j++) maxDeviation = Math.max(maxDeviation, Math.abs(got.values[j] - want.values[j]));
    }
  }
  return {
    scene: name, ticks: TICKS, settleTicks: settle, bodies: 1 + sc.s.terriers.length,
    float64sComparedPerTick: want.values.length, alsoCompared: 'each terrier heading (u32) and every body floor flag',
    ticksDiffering: changedTicks, firstDifferingTick: first, maxAbsDeviation: maxDeviation,
    ballZ: sc.s.ball.z, ballOnFloor: sc.s.ball.onFloor,
    contacts: { perSubstep: contacts.perSubstep / (TICKS * sc.sim.C.substeps), terrierBallSubsteps: contacts.terrierBallSubsteps, ballWallSubsteps: contacts.ballWallSubsteps, substeps: TICKS * sc.sim.C.substeps },
  };
}

// Placed at exactly the touching distances, rounding leaves the terrier
// 6.7e-16 m clear of the ball and the ball 7e-16 m clear of the wall, and the
// solver sees only the floor's contacts: so each body starts 1 µm into the next.
const EPS = 1e-6;
const againstWall = (s) => {
  placeBall(s, 3, -14 + 0.8 - EPS);
  place(s, 0, 3, -14 + 0.8 - EPS + Math.sqrt(0.8) - EPS);
  park(s, 1);
};
const still = [
  bitStill('a resting ball with two standing terriers, nothing held', (s) => {
    placeBall(s, 0, 0);
    place(s, 0, -3, 2);
    place(s, 1, 3, -2);
  }, 0),
  // The position passes take 5 ticks to settle the 1 µm overlaps.
  bitStill('a ball against the side wall, a terrier resting against the ball, nothing held', againstWall, 10),
  // The bodies settle by tick 11; the terrier's gait and push tick move by design.
  bitStill('a terrier holding at the ball, pressing it into the side wall', againstWall, 60, (k) => (k === 0 ? ballDir(0) : 0)),
];
for (const r of still.slice(1)) if (r.contacts.terrierBallSubsteps !== r.contacts.substeps) throw new Error(`${r.scene}: the terrier touched the ball in only ${r.contacts.terrierBallSubsteps} of ${r.contacts.substeps} substeps`);
if (still[2].contacts.ballWallSubsteps === 0) throw new Error(`${still[2].scene}: the ball never touched the wall`);

// --- Simultaneous hitters, no energy gained ----------------------------------

const LEAD = 6 * substepDt(makeConfig()) * 20.5;
const PARALLEL_Y = [[0], [-0.26, 0.26], [-0.52, 0, 0.52], [-0.78, -0.26, 0.26, 0.78]];
const CENTRE_DEG = [[0], [-25, 25], [-35, 0, 35], [-55, -20, 20, 55]];
const hits = [];
for (const floorInSolve of [true, false]) {
  for (const level of [false, true]) {
    for (const layout of ['parallel', 'centre']) {
      for (let k = 1; k <= 4; k++) {
        const dz = level ? 0 : 0.55;
        const z = level ? 0.8 : 0.25;
        const d = new Float64Array(2);
        const sc = scenario(4, { drive: false, friction: false, rolling: false, gravity: level ? 0 : 9.8, floorInSolve }, (s) => {
          for (let j = 0; j < 8; j++) park(s, j);
          placeBall(s, 0, 0);
          for (let j = 0; j < k; j++) {
            if (layout === 'parallel') {
              const y = PARALLEL_Y[k - 1][j];
              place(s, 2 * j, -Math.sqrt(1.05 * 1.05 - dz * dz - y * y) - LEAD, y, z);
              s.terriers[2 * j].vx = 6;
            } else {
              const deg = CENTRE_DEG[k - 1][j];
              dir((HALF_TURN + fractionOfTurn(deg < 0 ? 360 + deg : deg, 360)) >>> 0, d);
              const reach = Math.sqrt(1.05 * 1.05 - dz * dz) + LEAD;
              place(s, 2 * j, reach * d[0], reach * d[1], z);
              s.terriers[2 * j].vx = -6 * d[0];
              s.terriers[2 * j].vy = -6 * d[1];
            }
          }
        });
        const C = sc.sim.C;
        const g = level ? 0 : 9.8;
        // Mechanical energy: kinetic plus potential, the potential measured from the start's heights.
        const z0 = [sc.s.ball.z, ...sc.s.terriers.map((t) => t.z)];
        const mech = (s) => kineticEnergy(s, C) + g * (C.ballMass * (s.ball.z - z0[0]) + s.terriers.reduce((a, t, i) => a + C.terrierMass * (t.z - z0[i + 1]), 0));
        const p0 = momentum(sc.s, C);
        const e0 = kineticEnergy(sc.s, C);
        const m0 = mech(sc.s);
        let worstGain = -Infinity;
        let worstMechGain = -Infinity;
        let substeps = 0;
        let keRises = 0;
        let mechRises = 0;
        let lastKe = e0;
        let lastMech = m0;
        sc.sim.probe = (s) => {
          const e = kineticEnergy(s, C);
          const m = mech(s);
          worstGain = Math.max(worstGain, e - e0);
          worstMechGain = Math.max(worstMechGain, m - m0);
          if (e > lastKe + 1e-12) keRises++;
          if (m > lastMech + 1e-9) mechRises++;
          lastKe = e;
          lastMech = m;
          substeps++;
        };
        run(sc, 30);
        const p1 = momentum(sc.s, C);
        hits.push({
          floorInSolve, where: level ? 'level' : 'from the floor', layout, k, substeps,
          kineticStartJ: e0, kineticEndJ: kineticEnergy(sc.s, C), kineticWorstOverStartJ: worstGain,
          // With gravity (from the floor), a hopped ball falling back turns height into kinetic energy; the total is what can't rise.
          substepsKineticRose: keRises, mechanicalWorstOverStartJ: worstMechGain, substepsMechanicalRoseOver1e9J: mechRises,
          momentumChange: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), ballSpeed: Math.hypot(sc.s.ball.vx, sc.s.ball.vy),
        });
      }
    }
  }
}

// --- Mirrored kickoffs, exactly mirrored (P8) --------------------------------

function mirrored(spec) {
  const C = scriptConfig(spec);
  const sim = makeSim(C, spec.packSize);
  const s = scriptStart(spec, C);
  let substeps = 0;
  let mismatched = 0;
  let first = null;
  sim.probe = (st) => {
    substeps++;
    const m = mirrorMismatches(st, 1);
    if (m.length > 0) {
      mismatched++;
      first ??= `tick ${st.tick + 1}, substep ${substeps}: ${m[0]}`;
    }
  };
  const inputs = [];
  for (let t = 1; t <= spec.ticks; t++) step(sim, s, scriptInputs(spec, t, inputs));
  return {
    script: spec.name, packSize: spec.packSize, pitch: spec.pitch, slipOut: spec.slipOut, ticks: spec.ticks, substeps,
    valuesComparedPerSubstep: 4 + 39 * spec.packSize, substepsMismatched: mismatched, firstMismatch: first,
    contacts: sim.physics.stats.contacts, slipOuts: sim.physics.stats.slipOuts,
  };
}

const p8Kickoff = (packSize, pitch, seed, slipOut, frames) => ({
  name: `mirrored kickoff ${packSize}, ${pitch}, ${slipOut}, chasey ${frames}`, packSize, pitch, slipOut, ticks: frames === 'all' ? 2400 : 3000,
  start: 'countdown', mirrored: true, input: chasey(seed, frames),
});
const p8 = [];
// mirror.test.ts's runs: sizes 1–4 on both shapes, seeded inputs in all three frames.
for (const pitch of ['main', 'second']) for (let p = 1; p <= 4; p++) p8.push({ set: 'mirror.test.ts kickoffs', ...mirrored(p8Kickoff(p, pitch, 40 + p, 'drafted', 'all')) });
// Every mirrored golden script (kickoffs, squeeze, pinches), each under its own rule.
for (const spec of GOLDEN_SCRIPTS.filter((s) => s.mirrored)) p8.push({ set: 'mirrored golden scripts', ...mirrored(spec) });
// M0's pick: kickoffs at sizes 1–4 on both shapes, and pinches 1–4 (zoomies at even sizes).
for (const pitch of ['main', 'second']) for (let p = 1; p <= 4; p++) p8.push({ set: 'under 42+flag', ...mirrored(p8Kickoff(p, pitch, 70 + p, 'flag42', 'contact')) });
for (let p = 1; p <= 4; p++) p8.push({ set: 'under 42+flag', ...mirrored(pinch(p, 'flag42', p % 2 === 0)) });

// --- The conditions measured here ---------------------------------------------

const bitStillCondition = {
  condition: 'a resting ball not bit-still',
  verdict: still.every((r) => r.ticksDiffering === 0) ? 'pass' : 'fail',
  numbers: still.map((r) => `${r.scene}: ${r.ticks} ticks, ${r.float64sComparedPerTick} float64s plus headings and floor flags compared each tick, ${r.ticksDiffering} ticks differing, largest deviation ${r.maxAbsDeviation}; ${r.contacts.perSubstep} contacts a substep, the terrier on the ball in ${r.contacts.terrierBallSubsteps} and the ball on the wall in ${r.contacts.ballWallSubsteps} of ${r.contacts.substeps} substeps`),
};
const energyCondition = {
  condition: 'simultaneous hitters gaining energy',
  verdict: hits.every((h) => h.kineticWorstOverStartJ <= 0 && h.mechanicalWorstOverStartJ <= 1e-9) && hits.filter((h) => h.where === 'level').every((h) => h.substepsKineticRose === 0) ? 'pass' : 'fail',
  numbers: [
    `${hits.length} hits (k = 1-4, from the floor and level, parallel and at the centre, floor in and out of the solve), ${hits.reduce((a, h) => a + h.substeps, 0)} substeps`,
    `largest kinetic energy above its start, over every substep: ${Math.max(...hits.map((h) => h.kineticWorstOverStartJ))} J`,
    `level (no gravity): substeps where kinetic energy rose on the one before: ${hits.filter((h) => h.where === 'level').reduce((a, h) => a + h.substepsKineticRose, 0)}`,
    `from the floor: largest kinetic plus potential energy above its start ${Math.max(...hits.filter((h) => h.where !== 'level').map((h) => h.mechanicalWorstOverStartJ)).toExponential(2)} J; substeps where it rose by over 1e-9 J on the one before: ${hits.filter((h) => h.where !== 'level').reduce((a, h) => a + h.substepsMechanicalRoseOver1e9J, 0)}`,
    `largest horizontal momentum change: ${Math.max(...hits.map((h) => h.momentumChange)).toExponential(2)}`,
  ],
};
const mirrorCondition = {
  condition: 'a mirrored kickoff not exactly mirrored',
  verdict: p8.every((r) => r.substepsMismatched === 0) ? 'pass' : 'fail',
  numbers: [
    `${p8.length} mirrored runs, ${p8.reduce((a, r) => a + r.substeps, 0)} substeps, ${p8.reduce((a, r) => a + r.substeps * r.valuesComparedPerSubstep, 0)} values compared by value after every substep`,
    `substeps mismatched: ${p8.reduce((a, r) => a + r.substepsMismatched, 0)}; sizes 1-4 on both shapes; slip-outs fired in them: ${p8.reduce((a, r) => a + r.slipOuts, 0)}`,
  ],
};
const measured = {
  bitStill: still,
  hits,
  mirror: { runs: p8.length, substeps: p8.reduce((a, r) => a + r.substeps, 0), substepsMismatched: p8.reduce((a, r) => a + r.substepsMismatched, 0), perRun: p8 },
};
const printCondition = (c) => console.log(`${c.verdict.toUpperCase().padEnd(12)} ${c.condition}${c.byReading ? ` (${Object.entries(c.byReading).map(([k, v]) => `${k.split(' (')[0]}: ${v}`).join('; ')})` : ''}\n${c.numbers.map((n) => `             ${n}`).join('\n')}`);
if (MEASURED_ONLY) {
  const conditions = [bitStillCondition, energyCondition, mirrorCondition];
  const seconds = +((performance.now() - t0) / 1000).toFixed(1);
  writeFileSync(outFile, `${JSON.stringify({
    utc: new Date().toISOString(), node: process.version, solver,
    about: "M0's stop rule, the three conditions scripts/stop-rule.mjs measures itself (--measured-only), under the solver settings named",
    conditions, measured, seconds,
  }, null, 1)}\n`);
  for (const c of conditions) printCondition(c);
  console.log(`(${seconds} s; ${outFile.slice(root.length + 1)})`);
  process.exit(0);
}

// --- From the runs' files ------------------------------------------------------

const determinism = ['node', 'chromium', 'firefox', 'webkit'].map((engine) => {
  const f = `determinism-${engine}.json`;
  if (!existsSync(join(results, f))) return { engine, file: `results/${f}`, measured: false };
  const r = readJson(f);
  return {
    engine, file: `results/${f}`, measured: true, version: r.userAgent ?? r.node, pass: r.pass, runs: r.runs, checkpoints: r.checkpoints,
    checkpointEvery: r.checkpointEvery, mismatches: r.mismatches.length, runsMatching: r.perRun.filter((x) => x.match).length, canary: r.canary, suiteMs: r.suiteMs,
  };
});

// The slip-out survey: §16's four cases under each candidate, with slipout.test.ts's marks.
const REST_MARK = 1.5; // s from the first landing, the mark M0 set (slipout.test.ts)
const SIT_MARK = 0.5; // s, §16's own
const sim = readJson('sim.json');
const slipOut = sim.slipOut.map((r) => {
  const sitting = typeof r.sittingWorst === 'number' ? r.sittingWorst : null;
  const cases = {
    restingOnPushers: r.restHeld === 0 && r.restWorst <= REST_MARK && r.mirroredMismatches === 0,
    twoSitting: sitting !== null && sitting <= SIT_MARK,
    dribbles: r.dribbleSlips === 0,
    kickoffPinchMirrored: r.pinchMismatches === 0,
  };
  return {
    rule: r.rule, sweep: r.sweep, passesAll: Object.values(cases).every(Boolean), cases,
    numbers: {
      restCases: r.restCases, restHeldUp: r.restHeld, restWorstS: r.restWorst, restMirrorMismatches: r.mirroredMismatches,
      sittingWorstS: r.sittingWorst, sittingWorstAtDeg: r.sittingWorstAt, dribbles: r.dribbles, dribbleSlipOuts: r.dribbleSlips,
      pinchDownS: r.pinchDown, pinchMirrorMismatches: r.pinchMismatches,
    },
  };
});

// Run 3: every cost file, the plan's script and the denser corner scrum, at 4×.
const PLAN_SCRIPT = 'scrum at the wall, flag42';
const costFiles = readdirSync(results).filter((f) => /^cost(-\d+)?\.json$/.test(f)).sort((a, b) => (a === 'cost.json' ? 1 : b === 'cost.json' ? -1 : a.localeCompare(b)));
const runsLog = existsSync(join(results, 'runs-log.json')) ? readJson('runs-log.json').runs : [];
const cost = costFiles.map((f) => {
  const c = readJson(f);
  const log = runsLog.filter((r) => (r.results ?? []).includes(`results/${f}`)).at(-1);
  return {
    file: `results/${f}`, utc: c.utc, chromium: c.chromium,
    load: log ? { before1m: log.load.before.l1, uptime: log.load.before.uptime, max1mDuring: log.load.during.max1m, cpuCores: log.load.during.cpuCores ?? null } : null,
    at4x: c.runs.filter((r) => r.rate === 4).map((r) => ({
      script: r.script, device: r.device, mode: r.draw ? 'drawn, paced at 60 Hz' : 'back to back',
      tickMs: { mean: +r.report.tick.mean.toFixed(3), p50: +r.report.tick.p50.toFixed(3), p95: +r.report.tick.p95.toFixed(3), p99: +r.report.tick.p99.toFixed(3), max: +r.report.tick.max.toFixed(3), n: r.report.tick.n },
      stepUsMean: +(r.report.step.mean * 1000).toFixed(1),
      contactsPerSubstep: +r.report.contacts.perSubstep.toFixed(2), floorPerSubstep: +r.report.contacts.floorPerSubstep.toFixed(2), maxInSubstep: r.report.contacts.maxInSubstep,
      over4ms: r.report.tick.p95 > 4,
      bursts: r.report.bursts.map((b) => ({ steps: b.steps, runs: b.runs, medianMs: +b.ms.p50.toFixed(2), maxMs: +b.ms.max.toFixed(2), over50: b.overLimit })),
    })),
  };
});

// --- The verdicts --------------------------------------------------------------

const planAt4 = cost.flatMap((c) => c.at4x.filter((r) => r.script === PLAN_SCRIPT).map((r) => ({ file: c.file, ...r })));
const byMode = (mode) => planAt4.filter((r) => r.mode === mode);
const p95s = (rows) => rows.map((r) => `${r.device} ${r.tickMs.p95}`);
const drawn = byMode('drawn, paced at 60 Hz');
const tight = byMode('back to back');
const bursts = cost.flatMap((c) => c.at4x.flatMap((r) => r.bursts.map((b) => ({ file: c.file, script: r.script, device: r.device, mode: r.mode, ...b }))));
const b270 = bursts.filter((b) => b.steps === 270);

const conditions = [
  {
    condition: 'any engine mismatching in run 1',
    verdict: determinism.every((d) => d.measured) ? (determinism.every((d) => d.pass) ? 'pass' : 'fail') : 'not-measured',
    numbers: determinism.map((d) => (d.measured ? `${d.engine}: ${d.runsMatching} of ${d.runs} runs and ${d.checkpoints} checkpoints equal, ${d.mismatches} mismatches, canary ${d.canary}` : `${d.engine}: not measured`)),
  },
  bitStillCondition,
  energyCondition,
  mirrorCondition,
  {
    condition: "no slip-out rule passing §16's cases",
    verdict: slipOut.some((r) => r.passesAll) ? 'pass' : 'fail',
    numbers: [
      `passing all four: ${slipOut.filter((r) => r.passesAll).map((r) => `${r.rule} (${r.sweep} sweep: rest worst ${r.numbers.restWorstS} s of ${r.numbers.restCases} cases, none held; sitting ${r.numbers.sittingWorstS} s; ${r.numbers.dribbles} dribbles, 0 slip-outs; pinches down in ${Object.values(r.numbers.pinchDownS).filter((x) => x !== null).length} of 8)`).join('; ')}`,
      `failing: ${slipOut.filter((r) => !r.passesAll).map((r) => `${r.rule} [${Object.entries(r.cases).filter(([, v]) => !v).map(([k]) => k).join(', ')}]`).join('; ')}`,
      `marks: resting on pushers ${REST_MARK} s from the first landing (set at M0), two sitting ${SIT_MARK} s`,
    ],
  },
  {
    condition: 'the p95 of a 13-step tick over 4 ms in Chromium at 4x throttle',
    verdict: planAt4.length === 0 ? 'not-measured' : planAt4.some((r) => r.over4ms) ? 'fail' : 'pass',
    byReading: {
      'drawn, paced at 60 Hz (as a match runs, and as roslambo measured tick cost in its proxy)': drawn.length ? (drawn.some((r) => r.over4ms) ? 'fail' : 'pass') : 'not-measured',
      'back to back (nothing drawn, no pacing)': tight.length ? (tight.some((r) => r.over4ms) ? 'fail' : 'pass') : 'not-measured',
    },
    numbers: [
      `${PLAN_SCRIPT}, ${cost.length} repetitions; drawn at 60 Hz, p95 ms: ${p95s(drawn).join(', ')}`,
      `back to back, p95 ms: ${p95s(tight).join(', ')}`,
      `configurations over 4 ms: ${planAt4.filter((r) => r.over4ms).length} of ${planAt4.length}`,
    ],
  },
];

const worstTicks = {
  note: "a worst single tick over L286's 50 ms doesn't stop M0: D-11 then spreads its steps over several ticks (M3)",
  over50ms: b270.some((b) => b.maxMs > 50) || bursts.some((b) => b.maxMs > 50),
  numbers: [30, 42, 270].map((steps) => {
    const bs = bursts.filter((b) => b.steps === steps);
    return {
      steps, configurations: bs.length, medianMsRange: [Math.min(...bs.map((b) => b.medianMs)), Math.max(...bs.map((b) => b.medianMs))],
      maxMsRange: [Math.min(...bs.map((b) => b.maxMs)), Math.max(...bs.map((b) => b.maxMs))],
      configurationsWithAnyOver50: bs.filter((b) => b.maxMs > 50).length, burstsOver50: bs.reduce((a, b) => a + b.over50, 0), burstsTimed: bs.reduce((a, b) => a + b.runs, 0),
    };
  }),
};

const out = {
  utc: new Date().toISOString(),
  node: process.version,
  about: "M0's stop rule (PLAN §17 M0), condition by condition, with the simulation's conditions measured by scripts/stop-rule.mjs and the rest read from the runs' result files",
  solver,
  conditions,
  worstSingleTicks: worstTicks,
  measured,
  fromFiles: {
    run1: determinism,
    slipOut: { source: 'results/sim.json (measure.test.ts)', restMarkS: REST_MARK, sittingMarkS: SIT_MARK, rules: slipOut, onlyPassingAll: slipOut.filter((r) => r.passesAll).map((r) => r.rule) },
    run3: { planScript: PLAN_SCRIPT, repetitions: cost },
  },
  seconds: +((performance.now() - t0) / 1000).toFixed(1),
};
writeFileSync(outFile, `${JSON.stringify(out, null, 1)}\n`);
for (const c of conditions) printCondition(c);
console.log(`worst single ticks over 50 ms: ${worstTicks.over50ms}; ${worstTicks.numbers.map((n) => `${n.steps} steps max ${n.maxMsRange.join('-')} ms, median ${n.medianMsRange.join('-')} ms, ${n.configurationsWithAnyOver50} of ${n.configurations} configurations over`).join('; ')}`);
console.log(`(${out.seconds} s; ${outFile.slice(root.length + 1)})`);
// Reference the slip-out rules so a renamed rule fails loudly here.
for (const r of slipOut) if (!Object.values(SLIP_OUT_RULES).some((x) => x.name === r.rule)) throw new Error(`results/sim.json names an unknown rule ${r.rule}`);
