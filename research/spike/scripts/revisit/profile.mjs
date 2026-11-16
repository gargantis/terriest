// M0's cost revisit: where a step's time goes, by V8's sampling CPU profile
// in Node. Runs run 3's harness back to back (src/cost.ts: 120 settling
// steps, 120 untimed 13-step ticks, then the timed ticks; no bursts) on the
// plan's script under a solver variant, in a child Node started with
// --cpu-prof at a 50 µs sampling interval, then sums each function's self
// time over the whole child and groups it by the solver's parts (D-5's
// steps). Node's V8 is older than Chromium's, and nothing here is throttled
// or drawn, so the shares are what this shows, not the page's times.
//
//   node scripts/revisit/profile.mjs --solver m0 [--ticks 3000]   -> results/revisit/profile-<name>.json
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySolverDefaults, parseSolver, solverLabel, solverName } from '../../src/solver-settings.ts';

const args = process.argv.slice(2);
const value = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback);
const spec = value('--solver', 'base');
const ticks = Number(value('--ticks', '3000'));
const settings = { ...applySolverDefaults(undefined), ...parseSolver(spec) };
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = 'scrum at the wall, flag42';

if (process.argv[2] === '--child') {
  const { CostRun } = await import('../../src/cost.ts');
  const run = new CostRun({ script: SCRIPT, ticks: Number(process.argv[3]), bursts: [], burstRuns: 1, config: parseSolver(process.argv[4] ?? '') });
  const now = () => performance.now();
  while (run.step(now));
  const r = run.report();
  process.stdout.write(JSON.stringify({ meanTickMs: r.tick.mean, stepUs: r.step.mean * 1000, contactsPerSubstep: r.contacts.perSubstep, label: r.solverLabel }));
  process.exit(0);
}

// The raw profile goes to results/tmp/ (not tracked) and is removed once read.
const dir = join(ROOT, 'results', 'tmp', 'revisit', `profile-${solverName(settings)}`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_OPTIONS'));
const timed = JSON.parse(execFileSync(process.execPath, ['--cpu-prof', '--cpu-prof-interval', '50', '--cpu-prof-dir', dir, fileURLToPath(import.meta.url), '--child', String(ticks), spec],
  { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 << 20 }));
const file = readdirSync(dir).find((f) => f.endsWith('.cpuprofile'));
const prof = JSON.parse(readFileSync(join(dir, file), 'utf8'));
rmSync(dir, { recursive: true, force: true });

// Self time per node, from the samples and their time deltas (µs).
const self = new Map();
for (let i = 0; i < prof.samples.length; i++) self.set(prof.samples[i], (self.get(prof.samples[i]) ?? 0) + (prof.timeDeltas[i] ?? 0));
const byFn = new Map();
for (const n of prof.nodes) {
  const us = self.get(n.id) ?? 0;
  if (!us) continue;
  const url = n.callFrame.url.replace(/^file:\/\//, '');
  const where = url.startsWith(ROOT) ? url.slice(ROOT.length) : url || '(native)';
  const key = `${n.callFrame.functionName || '(anonymous)'} ${where}`;
  byFn.set(key, (byFn.get(key) ?? 0) + us);
}
// The solver's parts (physics.ts's methods), and the rest of a tick.
const PART = [
  ['5: impulses (solve, solveSlot, impulseStep, applyImpulse)', /^(solve|solveSlot|impulseStep|applyImpulse) src\/sim\/physics/],
  ['6: position passes (positions, overlap, move)', /^(positions|overlap|move) src\/sim\/physics/],
  ['3: detection (detect, pair, piece, pieceContact, add)', /^(detect|pair|piece|add) src\/sim\/physics|^pieceContact src\/sim\/pitch/],
  ['4 and prepare: support, restitution targets', /^(support|prepare) src\/sim\/physics/],
  ['1-2: forces and integration (forcesAndIntegrate, drive, slow)', /^(forcesAndIntegrate|drive|slow) src\/sim\/physics/],
  ['7: slip-out', /^slipOut src\/sim\/physics/],
  ['the rest of a substep and tick (step.ts: substep, step, intents, touches, pushes, the goal test)', /src\/sim\/step\.ts$/],
  ['the window\'s state clone (state.ts)', /src\/sim\/state\.ts$/],
];
const total = [...byFn.values()].reduce((a, b) => a + b, 0);
const sim = [...byFn.entries()].filter(([k]) => / src\/sim\//.test(k)).reduce((a, [, v]) => a + v, 0);
const parts = PART.map(([name, re]) => {
  const us = [...byFn.entries()].filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0);
  return { part: name, ms: +(us / 1000).toFixed(1), shareOfSim: +(us / sim).toFixed(3) };
});
const named = parts.reduce((a, p) => a + p.ms * 1000, 0);
parts.push({ part: 'the rest of src/sim (angle.ts, physics.ts\'s other methods, …)', ms: +((sim - named) / 1000).toFixed(1), shareOfSim: +((sim - named) / sim).toFixed(3) });
const top = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([fn, us]) => ({ fn, ms: +(us / 1000).toFixed(1), share: +(us / total).toFixed(3) }));
const name = solverName(settings);
const out = {
  about: "M0's cost revisit: a step's time by D-5's parts, from V8's CPU profile in Node (scripts/revisit/profile.mjs)",
  utc: new Date().toISOString(), node: process.version, v8: process.versions.v8, spec, name, label: solverLabel(settings),
  method: { script: SCRIPT, harness: 'src/cost.ts back to back, no bursts', ticks, samplingIntervalUs: 50 },
  timed, profileMs: +(total / 1000).toFixed(1), simMs: +(sim / 1000).toFixed(1), parts, top,
};
mkdirSync(fileURLToPath(new URL('../../results/revisit/', import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL(`../../results/revisit/profile-${name}.json`, import.meta.url)), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${out.label}: ${timed.stepUs.toFixed(1)} µs a step in the timed ticks; of the simulation's ${out.simMs} ms of samples:`);
for (const p of parts) console.log(`  ${(100 * p.shareOfSim).toFixed(1).padStart(5)}%  ${p.part}`);
