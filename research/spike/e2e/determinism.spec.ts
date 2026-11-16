// M0 run 1 (PLAN §17 M0, §16 Determinism): the same scripted runs give
// bit-identical states in Node, Chromium, Firefox and WebKit. The production
// bundle's ?test=determinism page replays every golden script and the
// canary in each engine, and every hash must equal src/sim/goldens.json,
// which Node emitted, checkpoint by checkpoint. Node replays the suite too,
// in a process of its own with no bundler or transform (Node 22 strips the
// types itself), so a stale goldens.json fails here rather than passing as
// a browser mismatch. Each engine's figures go to
// results/determinism-<engine>.json.
//
//   npx playwright test e2e/determinism.spec.ts [--project=chromium|firefox|webkit]

import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DeterminismReport } from '../src/determinism';
import type { GoldenResult } from '../src/sim/golden';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
interface Goldens { codec: number; checkpointEvery: number; canary: string; runs: GoldenResult[] }
const goldens = JSON.parse(readFileSync(new URL('../src/sim/goldens.json', import.meta.url), 'utf8')) as Goldens;
const checkpoints = goldens.runs.reduce((n, r) => n + r.checkpoints.length, 0);

/** The first checkpoint, final hash or counter that differs from goldens.json, per run. */
function compare(runs: readonly GoldenResult[], canary: string): { mismatches: string[]; runs: { name: string; checkpoints: number; match: boolean }[] } {
  const mismatches: string[] = [];
  const rows = goldens.runs.map((want, i) => {
    const got = runs[i];
    let match = got !== undefined && got.name === want.name;
    if (!match) mismatches.push(`run ${i}: ${got?.name ?? 'missing'}, not ${want.name}`);
    else {
      const k = want.checkpoints.findIndex((h, j) => h !== got!.checkpoints[j]);
      if (k >= 0) mismatches.push(`${want.name}: first differing checkpoint ${k}, tick ${(k + 1) * goldens.checkpointEvery}`);
      else if (JSON.stringify(got) !== JSON.stringify(want)) mismatches.push(`${want.name}: final hash or counters differ`);
      match = k < 0 && JSON.stringify(got) === JSON.stringify(want);
    }
    return { name: want.name, checkpoints: want.checkpoints.length, match };
  });
  if (runs.length !== goldens.runs.length) mismatches.push(`${runs.length} runs, not ${goldens.runs.length}`);
  if (canary !== goldens.canary) mismatches.push(`canary ${canary}, not ${goldens.canary}`);
  return { mismatches, runs: rows };
}

function save(engine: string, figures: Record<string, unknown>): void {
  mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
  writeFileSync(new URL(`../results/determinism-${engine}.json`, import.meta.url), `${JSON.stringify({ engine, ...figures }, null, 1)}\n`);
}

test('the production bundle reproduces every golden, checkpoint by checkpoint', async ({ page, browserName }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('./?test=determinism');
  const handle = await page.waitForFunction(() => window.spikeDeterminism, null, { timeout: 150_000, polling: 250 });
  const got = (await handle.jsonValue()) as DeterminismReport;
  const { mismatches, runs } = compare(got.runs, got.canary);
  const figures = {
    userAgent: got.userAgent, suiteMs: +got.ms.toFixed(1), runs: got.runs.length, checkpoints, checkpointEvery: goldens.checkpointEvery,
    canary: got.canary, pass: mismatches.length === 0, mismatches, pageVerdict: got.verdict, pageFirstDifference: got.firstDifference, perRun: runs,
  };
  save(browserName, figures);
  console.log(JSON.stringify({ engine: browserName, suiteMs: figures.suiteMs, runs: figures.runs, checkpoints, pass: figures.pass, mismatches }));
  await expect(page.locator('html')).toHaveAttribute('data-determinism', 'pass');
  expect(got.runs.map((r) => r.name)).toEqual(goldens.runs.map((r) => r.name));
  expect(mismatches).toEqual([]);
  for (let i = 0; i < goldens.runs.length; i++) expect(got.runs[i], goldens.runs[i]!.name).toEqual(goldens.runs[i]);
  expect(got.canary).toBe(goldens.canary);
  expect(errors).toEqual([]);
});

test('Node replays the same suite to goldens.json, in a process of its own', ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Node runs once, beside the Chromium project');
  test.setTimeout(120_000);
  const script = [
    "import { canaryHash, goldenSuite } from './src/sim/golden.ts';",
    'const t0 = performance.now();',
    'const runs = goldenSuite();',
    'const canary = canaryHash();',
    'process.stdout.write(JSON.stringify({ ms: performance.now() - t0, canary, runs, node: process.version }));',
  ].join('\n');
  // A clean environment: no loader of the test runner's reaches the child.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_OPTIONS' && !k.startsWith('PW_')));
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 << 20 });
  const got = JSON.parse(out) as { ms: number; canary: string; runs: GoldenResult[]; node: string };
  const { mismatches, runs } = compare(got.runs, got.canary);
  save('node', {
    node: got.node, suiteMs: +got.ms.toFixed(1), runs: got.runs.length, checkpoints, checkpointEvery: goldens.checkpointEvery,
    canary: got.canary, pass: mismatches.length === 0, mismatches, perRun: runs,
  });
  console.log(JSON.stringify({ engine: 'node', node: got.node, suiteMs: +got.ms.toFixed(1), pass: mismatches.length === 0, mismatches }));
  expect(mismatches).toEqual([]);
});
