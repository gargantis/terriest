// M0's cost revisit (PLAN §17 M0's stop rule; REPORT.md §4): run 3's tick
// cost under solver variants, by run 3's method (e2e/cost.spec.ts): the
// production build's ?test=cost page, on the plan's script (the 4-a-side
// scrum at the wall, under 42° with the flag), in Chromium at 4× CPU
// throttle (DevTools' Emulation.setCPUThrottlingRate), at the desktop's
// 1280 × 720 and as Playwright's 'Pixel 8a', drawn (the scene draws while
// the clock does one unit of work per 60 Hz tick) and back to back (nothing
// drawn). Each run: 120 settling steps, 120 untimed 13-step ticks, 1,200
// timed 13-step ticks, then 30 bursts each of 30, 42 and 270 steps; low
// quality; the page cross-origin isolated for a 5 µs clock; software GL
// (SwiftShader), as the spec draws.
//
// - Variants are solver specs (src/solver-settings.ts): 'm0' is M0's
//   settings, 'i4+p1' changes two of them.
// - Each repetition launches a fresh Chromium and runs every variant, in an
//   order rotated by one each repetition, each at both sizes and in both
//   modes.
// - Before each run, the 1-minute load average must be at most 4: the
//   driver waits, rechecking every 15 s for up to 20 minutes, and records
//   `uptime`, the wait and the CPU in use during the run, this run's
//   processes against every other (scripts/revisit/load.mjs).
// - The results go to results/revisit/cost-<name>.json, rewritten after
//   every run.
//
//   node scripts/revisit/cost.mjs --name <name> --solvers m0,i6,i4 [--reps 3]
//     [--devices desktop,pixel] [--modes drawn,tight] [--no-build]
/* global window */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';
import { startServer } from '../../e2e/serve.mjs';
import { applySolverDefaults, parseSolver, solverLabel, solverName } from '../../src/solver-settings.ts';
import { cpuSampler, LOAD_LIMIT, load, waitForLoad } from './load.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const name = value('--name');
if (!name || !/^[\w.-]+$/.test(name)) throw new Error('--name <plain word> is required');
const specs = value('--solvers', 'm0').split(',').filter(Boolean);
const reps = Number(value('--reps', '3'));
const deviceNames = value('--devices', 'desktop,pixel').split(',').map((d) => (d === 'pixel' ? 'Pixel 8a' : d));
const modes = value('--modes', 'drawn,tight').split(',');

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = fileURLToPath(new URL(`../../results/revisit/cost-${name}.json`, import.meta.url));
const SCRIPT = 'scrum at the wall, flag42';
const TICKS = 1200;
const BURST_RUNS = 30;
const RATE = 4;
const STOP_RULE_P95_MS = 4;
const DEVICES = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  'Pixel 8a': devices['Pixel 8a'],
};

// Each spec's full settings over the defaults as they stand, for the record.
const defaults = applySolverDefaults(undefined);
const variants = specs.map((spec) => {
  const settings = { ...defaults, ...parseSolver(spec) };
  return { spec, settings, label: solverLabel(settings), name: solverName(settings) };
});

if (!args.includes('--no-build')) execFileSync('npx', ['vite', 'build', '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit' });
const server = await startServer({
  extraHeaders: [['Cross-Origin-Opener-Policy', 'same-origin'], ['Cross-Origin-Embedder-Policy', 'require-corp']],
});

const f3 = (x) => +x.toFixed(3);
const rows = [];
let chromiumVersion = '';

function summary() {
  return variants.map((v) => {
    const mine = rows.filter((r) => r.label === v.label);
    const by = (device, mode) => mine.filter((r) => r.device === device && r.mode === mode).map((r) => r.tick.p95);
    const drawn = mine.filter((r) => r.mode === 'drawn');
    const tight = mine.filter((r) => r.mode === 'tight');
    const range = (xs) => (xs.length ? [Math.min(...xs), Math.max(...xs)] : null);
    return {
      spec: v.spec, name: v.name, label: v.label, runs: mine.length,
      p95: Object.fromEntries(deviceNames.map((d) => [d, Object.fromEntries(modes.map((m) => [m, by(d, m)]))])),
      drawnP95Range: range(drawn.map((r) => r.tick.p95)), tightP95Range: range(tight.map((r) => r.tick.p95)),
      drawnOver4: drawn.filter((r) => r.tick.p95 > STOP_RULE_P95_MS).length, drawnRuns: drawn.length,
      drawnMeanRange: range(drawn.map((r) => r.tick.mean)), tightMeanRange: range(tight.map((r) => r.tick.mean)),
      tightStepUsRange: range(tight.map((r) => r.stepUsMean)),
      contactsPerSubstep: range(mine.map((r) => r.contacts.perSubstep)),
      burstMaxMs: Object.fromEntries([30, 42, 270].map((s) => [s, range(mine.map((r) => r.bursts.find((b) => b.steps === s)?.maxMs ?? NaN))])),
      loadBefore1m: range(mine.map((r) => r.load.before.l1)), otherCoresMean: range(mine.map((r) => r.cpu.otherCoresMean ?? 0)),
      runsWithProblems: mine.filter((r) => r.problems.length > 0).length, runsOverLoadLimit: mine.filter((r) => !r.load.gateOk).length,
    };
  });
}

function save(done) {
  mkdirSync(fileURLToPath(new URL('../../results/revisit/', import.meta.url)), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({
    about: "M0's cost revisit: run 3's 13-step tick on the plan's script under solver variants, in Chromium at 4x throttle (scripts/revisit/cost.mjs)",
    name, utcStart: rows[0]?.utc ?? null, utcEnd: new Date().toISOString(), complete: done,
    chromium: chromiumVersion, cpu: cpus()[0]?.model ?? '', cpus: cpus().length, node: process.version,
    method: {
      page: '?test=cost on the production build (dist/), served by e2e/serve.mjs with COOP and COEP', script: SCRIPT,
      ticks: TICKS, settleTicks: 120, warmupTicks: 120, burstRuns: BURST_RUNS, bursts: [30, 42, 270], quality: 'low',
      cpuThrottle: RATE, gl: 'software (SwiftShader), as e2e/cost.spec.ts', modes: { drawn: 'one unit of work per 60 Hz tick while the scene draws', tight: 'back to back, nothing drawn' },
      devices: { desktop: '1280 x 720 at DPR 1', 'Pixel 8a': "Playwright's device: 412 x 839 at DPR 2.625" },
      order: 'a fresh Chromium per repetition; every variant per repetition, its order rotated by one each repetition; each variant: desktop then Pixel 8a, drawn then back to back',
      loadGate: `before each run, the 1-minute load average at most ${LOAD_LIMIT}, rechecked every 15 s for up to 20 minutes`,
    },
    variants, summary: summary(), runs: rows,
  }, null, 1)}\n`);
}

for (let rep = 0; rep < reps; rep++) {
  const browser = await chromium.launch();
  chromiumVersion = browser.version();
  const order = variants.map((_, i) => variants[(i + rep) % variants.length]);
  for (let slot = 0; slot < order.length; slot++) {
    const v = order[slot];
    for (const device of deviceNames) {
      for (const mode of modes) {
        const gate = await waitForLoad({ log: (m) => console.error(`  ${m}`) });
        const context = await browser.newContext(DEVICES[device]);
        try {
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (e) => errors.push(String(e)));
          page.on('console', (m) => {
            if (m.type() === 'error') errors.push(m.text());
          });
          const cdp = await context.newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
          const q = new URLSearchParams({ test: 'cost', script: SCRIPT, ticks: String(TICKS), runs: String(BURST_RUNS), draw: mode === 'drawn' ? '1' : '0', quality: 'low', solver: v.spec });
          const stop = cpuSampler();
          const utc = new Date().toISOString();
          await page.goto(`${server.url}?${q.toString()}`);
          await page.waitForFunction(() => window.spikeCost?.state === 'done' || window.spikeCost?.state === 'failed', null, { timeout: 300_000, polling: 500 });
          const cpu = stop();
          const got = await page.evaluate(() => window.spikeCost);
          const r = got.report;
          const problems = [...errors];
          if (got.error) problems.push(got.error);
          if (r.solverLabel !== v.label) problems.push(`timed ${r.solverLabel}, not ${v.label}`);
          if (r.script !== SCRIPT || r.tick.n !== TICKS || r.stepsPerTick !== 13) problems.push('not the planned measurement');
          if (r.contacts.substeps !== TICKS * 13 * r.solver.substeps) problems.push(`counted ${r.contacts.substeps} substeps`);
          if (!got.env.crossOriginIsolated || got.env.clockResolutionMs > 0.01) problems.push('clock not isolated');
          if (device === 'Pixel 8a' && (got.env.viewport.width !== 412 || got.env.viewport.height !== 839)) problems.push(`viewport ${JSON.stringify(got.env.viewport)}`);
          if (mode === 'drawn' && !(got.frames?.count > 0)) problems.push('no frames drawn');
          const row = {
            utc, rep, slot, spec: v.spec, name: v.name, label: v.label, solver: r.solver, device, mode,
            load: { gateOk: gate.ok, waitedS: gate.waitedS, checks: gate.checks, before: gate.before, after: load() }, cpu,
            wallMs: Math.round(got.wallMs),
            env: { viewport: got.env.viewport, devicePixelRatio: got.env.devicePixelRatio, isolated: got.env.crossOriginIsolated, clockStepMs: got.env.clockResolutionMs },
            frames: got.frames ? { count: got.frames.count, fps: +(1000 / (got.frames.interval.mean || 1)).toFixed(1), intervalP95Ms: +got.frames.interval.p95.toFixed(1) } : null,
            tick: { mean: f3(r.tick.mean), p50: f3(r.tick.p50), p95: f3(r.tick.p95), p99: f3(r.tick.p99), max: f3(r.tick.max), n: r.tick.n },
            stepUsMean: +(r.step.mean * 1000).toFixed(1),
            contacts: { perSubstep: +r.contacts.perSubstep.toFixed(2), floorPerSubstep: +r.contacts.floorPerSubstep.toFixed(2), otherPerSubstep: +r.contacts.otherPerSubstep.toFixed(2), maxInSubstep: r.contacts.maxInSubstep, slipOutsPerSubstep: +r.contacts.slipOutsPerSubstep.toFixed(4) },
            bursts: r.bursts.map((b) => ({ steps: b.steps, runs: b.runs, medianMs: +b.ms.p50.toFixed(2), maxMs: +b.ms.max.toFixed(2), over50: b.overLimit })),
            problems,
          };
          rows.push(row);
          console.log(JSON.stringify({
            rep, slot, solver: v.label, device, mode, load1m: gate.before.l1, waitedS: gate.waitedS, otherCores: cpu.otherCoresMean,
            p95: row.tick.p95, mean: row.tick.mean, stepUs: row.stepUsMean, contacts: row.contacts.perSubstep, fps: row.frames?.fps ?? null,
            b270max: row.bursts.find((b) => b.steps === 270)?.maxMs, problems,
          }));
          save(false);
        } finally {
          await context.close();
        }
      }
    }
  }
  await browser.close();
}
save(true);
await server.close();
for (const s of summary()) console.log(`${s.label.padEnd(18)} drawn p95 ${s.drawnP95Range?.join('-')} ms (${s.drawnOver4} of ${s.drawnRuns} over 4); back to back ${s.tightP95Range?.join('-')} ms; ${s.contactsPerSubstep?.join('-')} contacts a substep`);
