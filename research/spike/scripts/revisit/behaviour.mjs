// M0's cost revisit (PLAN §17 M0's stop rule; REPORT.md §4): §16's
// behaviour tests under a solver variant, and run 2's measurements under it.
// - The whole vitest suite but the golden hashes (golden.test.ts), which
//   change with any setting by design, with TERRIEST_SPIKE_SOLVER set, so
//   every configuration the tests make starts from the variant
//   (test/solver-setup.ts): bit-still, bounces, simultaneous hits, push
//   times, the slip-out cases, P8, tunnelling and containment, movement and
//   L57, the cost harness's and the source's own tests.
// - measure.test.ts in full under the variant, writing
//   results/revisit/sim-<name>.json: push times, hits, the slip-out sweeps
//   (fine for the leaders, 42° with the flag among them), the dribbles' hop
//   angles and the tick cost in Node.
// - §16's four slip-out cases judged on that sweep with the marks M0 set
//   (scripts/stop-rule.mjs's): ball on pushers none held and down within
//   1.5 s and mirrored, two sitting within 0.5 s, no dribble slipping out,
//   the kickoff pinches mirrored.
// Each failed test is listed with its message, marked either as a §16
// behaviour or as a pinned M0 record: a slip-out candidate other than M0's
// pick (42° with the flag) reaching another verdict, or the k = 4 hits'
// order, which §16 is to stop asking for (REPORT.md §8).
// Writes results/revisit/behaviour-<name>.json; the raw output goes to
// results/tmp/revisit/ (not tracked).
//
//   node scripts/revisit/behaviour.mjs --solver i4+p1 [--no-measure]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applySolverDefaults, parseSolver, solverLabel, solverName } from '../../src/solver-settings.ts';
import { load, uptime } from './load.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const spec = value('--solver', 'base');
const settings = { ...applySolverDefaults(undefined), ...parseSolver(spec) };
const label = solverLabel(settings);
const name = solverName(settings);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const at = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
mkdirSync(at('results/revisit'), { recursive: true });
mkdirSync(at('results/tmp/revisit'), { recursive: true });

const PICK = '42+flag';
const REST_MARK = 1.5; // s from the first landing, the mark M0 set (slipout.test.ts)
const SIT_MARK = 0.5; // s, §16's own

function vitest(argv, env, tag) {
  const t0 = Date.now();
  const r = spawnSync('npx', ['vitest', 'run', ...argv], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 256 << 20 });
  writeFileSync(at(`results/tmp/revisit/${tag}-${name}.log`), `${r.stdout}\n${r.stderr}`);
  return { exitCode: r.status, wallSeconds: +((Date.now() - t0) / 1000).toFixed(1), stdout: r.stdout };
}

const before = { ...load(), uptime: uptime() };
const jsonFile = at(`results/tmp/revisit/vitest-${name}.json`);
const suite = vitest(['--exclude', 'src/sim/golden.test.ts', '--reporter=default', '--reporter=json', `--outputFile.json=${jsonFile}`],
  { TERRIEST_SPIKE_SOLVER: spec }, 'vitest');
const report = existsSync(jsonFile) ? JSON.parse(readFileSync(jsonFile, 'utf8')) : null;
// Stack traces name files by absolute path: keep them relative to this folder.
const relative = (text) => text.replaceAll(`file://${ROOT}`, '').replaceAll(ROOT, '');
const tests = (report?.testResults ?? []).flatMap((f) => f.assertionResults.map((a) => ({
  file: f.name.slice(ROOT.length), title: a.fullName, status: a.status, ms: Math.round(a.duration ?? 0),
  failure: a.failureMessages?.length ? relative(a.failureMessages[0].split('\n').slice(0, 3).join(' | ')).slice(0, 400) : undefined,
})));
const kind = (t) => {
  if (t.file.endsWith('slipout.test.ts') && /D-5 step 7\) /.test(t.title) && !t.title.endsWith(`7) ${PICK}`) && !/at least one candidate/.test(t.title)) return 'pinned M0 record: another candidate\'s verdict';
  if (t.file.endsWith('hits.test.ts') && /pinned M0 finding/.test(t.failure ?? '')) return 'pinned M0 record: the k = 4 hits\' order';
  return '§16 behaviour';
};
const failed = tests.filter((t) => t.status === 'failed').map((t) => ({ ...t, kind: kind(t) }));
// The numbers the tests print: hits, pushes, slip-out verdicts, P8's runs,
// tunnelling, the fuzz, bounces. A line '[push]' or '[P8]' alone heads a
// block of indented lines.
const printed = [];
{
  let block = null;
  for (const raw of suite.stdout.split('\n')) {
    const line = raw.trimEnd();
    if (block !== null && /^ {2}\S/.test(line)) {
      printed.push(`${block} ${line.trim()}`);
      continue;
    }
    block = null;
    const m = /^\[(hits|push|slip-out|tunnel|fuzz|floor bounce|P8)[^\]]*\]/.exec(line.trim());
    if (!m) continue;
    if (line.trim() === m[0]) block = m[0];
    else printed.push(line.trim());
  }
}

let measure = null;
if (!args.includes('--no-measure')) {
  const simFile = at(`results/revisit/sim-${name}.json`);
  const m = vitest(['src/sim/measure.test.ts'], { TERRIEST_SPIKE_SOLVER: spec, TERRIEST_SPIKE_MEASURE: '1', TERRIEST_SPIKE_MEASURE_OUT: simFile }, 'measure');
  const sim = existsSync(simFile) ? JSON.parse(readFileSync(simFile, 'utf8')) : null;
  const ran = sim && sim.solver && solverLabel(sim.solver) === label;
  const slipOut = (ran ? sim.slipOut : []).map((r) => {
    const sitting = typeof r.sittingWorst === 'number' ? r.sittingWorst : null;
    const cases = {
      restingOnPushers: r.restHeld === 0 && r.restWorst <= REST_MARK && r.mirroredMismatches === 0,
      twoSitting: sitting !== null && sitting <= SIT_MARK,
      dribbles: r.dribbleSlips === 0,
      kickoffPinchMirrored: r.pinchMismatches === 0,
    };
    return {
      rule: r.rule, sweep: r.sweep, passesAll: Object.values(cases).every(Boolean), cases,
      restCases: r.restCases, restHeld: r.restHeld, restWorstS: r.restWorst, sittingWorstS: r.sittingWorst, sittingWorstAtDeg: r.sittingWorstAt,
      dribbles: r.dribbles, dribbleSlips: r.dribbleSlips, pinchDownS: r.pinchDown, pinchMismatches: r.pinchMismatches,
    };
  });
  measure = {
    exitCode: m.exitCode, wallSeconds: m.wallSeconds, file: `results/revisit/sim-${name}.json`, ranUnderVariant: Boolean(ran),
    pick: slipOut.find((r) => r.rule === PICK) ?? null, passingAll: slipOut.filter((r) => r.passesAll).map((r) => r.rule), slipOut,
    pushes: ran ? sim.pushes : null, hits: ran ? sim.hits : null, dribbleHop: ran ? sim.dribbleHop : null,
    tickCostNode: ran ? sim.tickCost.map((r) => ({ script: r.script, tickMs: r.tickMs, stepUs: r.stepUs, contactsPerSubstep: r.contactsPerSubstep, ofWhichFloor: r.ofWhichFloor, bursts: r.bursts })) : null,
  };
}

const behaviourFailures = failed.filter((t) => t.kind === '§16 behaviour');
const pickPasses = measure === null ? null : measure.pick?.passesAll === true;
const out = {
  about: "M0's cost revisit: §16's behaviour tests and run 2's measurements under one solver variant (scripts/revisit/behaviour.mjs)",
  utc: before.utc, spec, name, label, settings, node: process.version, loadBefore: before,
  vitest: {
    command: 'npx vitest run --exclude src/sim/golden.test.ts, with TERRIEST_SPIKE_SOLVER set', exitCode: suite.exitCode, wallSeconds: suite.wallSeconds,
    files: report ? { passed: report.numPassedTestSuites, failed: report.numFailedTestSuites, total: report.numTotalTestSuites } : null,
    tests: report ? { passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests, total: report.numTotalTests } : null,
    failed,
  },
  printed,
  measure,
  verdict: {
    allTestsGreen: suite.exitCode === 0 && failed.length === 0 && report !== null,
    behaviourFailures: behaviourFailures.length,
    pinnedRecordFailures: failed.length - behaviourFailures.length,
    pickPassesFullSweep: pickPasses,
    qualifies: report !== null && behaviourFailures.length === 0 && pickPasses !== false,
    rule: "qualifies: no §16 behaviour test fails, and on the full sweep 42° with the flag passes all four slip-out cases; a pinned M0 record that moves is listed, not disqualifying",
  },
};
writeFileSync(at(`results/revisit/behaviour-${name}.json`), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${label} (${name}): vitest ${out.vitest.tests ? `${out.vitest.tests.passed} passed, ${out.vitest.tests.failed} failed, ${out.vitest.tests.skipped} skipped` : 'no report'}; ` +
  `${behaviourFailures.length} §16 behaviour failures, ${out.verdict.pinnedRecordFailures} pinned-record failures; ` +
  `pick on the full sweep: ${pickPasses === null ? 'not run' : pickPasses ? 'passes' : 'FAILS'}${measure?.pick ? ` (rest worst ${measure.pick.restWorstS} s, held ${measure.pick.restHeld}; sitting ${measure.pick.sittingWorstS} s; ${measure.pick.dribbleSlips} of ${measure.pick.dribbles} dribbles slipped)` : ''}; qualifies: ${out.verdict.qualifies}`);
for (const t of failed) console.log(`  FAILED [${t.kind}] ${t.title}: ${t.failure ?? ''}`);
