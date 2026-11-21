// PLAN §16 Determinism (design §7.5), in each engine: the production
// bundle's #test=determinism page replays every golden run and the canary,
// and every checkpoint, counter and check must equal
// src/core/sim/goldens.json, which Node emitted. Node replays the same
// suite in the unit stage (golden.test.ts), here and on CI's arm64. The
// page draws nothing: it makes no canvas, so WebGL is asserted only as
// every spec's first step (C-6). And a normal page never loads its chunk,
// which the built page's own module never holds: from M4 that page is the
// app's, its landmark #app, its stage's canvas in #stage (M4-Q1), and its
// module holds the simulation Practice plays, but still none of the goldens'
// runs (M2's design §7.5, M4-Q5); phase 2 adds the canary's hash alone.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Goldens } from '../src/core/sim/golden';
import type { DeterminismReport } from '../src/determinism';
import { expect, expectWebGL2, test } from './lib/guards';
import { expectStarted, moduleScript } from './lib/page';
import { DIST } from './lib/serve.mjs';

const goldens = JSON.parse(readFileSync(new URL('../src/core/sim/goldens.json', import.meta.url), 'utf8')) as Goldens;

test.beforeEach(async ({ page }) => {
  await expectWebGL2(page);
});

test('the production bundle replays every golden run and the canary as Node did', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('./#test=determinism');
  await expectStarted(page);
  await expect(page.getByRole('main')).toHaveAttribute('id', 'determinism');
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Determinism');
  const handle = await page.waitForFunction(() => window.terriestDeterminism, null, { timeout: 150_000, polling: 250 });
  const got = (await handle.jsonValue()) as DeterminismReport;
  console.log(`${got.runs.length} runs and the canary in ${(got.ms / 1000).toFixed(2)} s: ${got.userAgent}`);
  expect(got.runs.map((r) => r.name)).toEqual(goldens.runs.map((r) => r.name));
  for (let i = 0; i < goldens.runs.length; i++) {
    const want = goldens.runs[i]!;
    const run = got.runs[i]!;
    const k = want.checkpoints.findIndex((h, j) => h !== run.checkpoints[j]);
    expect(k, `${want.name}: the first differing checkpoint${k < 0 ? '' : `, at tick ${(k + 1) * goldens.checkpointEvery}`}`).toBe(-1);
    expect(run, want.name).toEqual(want);
  }
  expect(got.canary, 'the canary').toBe(goldens.canary);
  expect(got.checkpointEvery).toBe(goldens.checkpointEvery);
  // The page's own verdict: the same comparison, plus each run's coverage.
  expect(got.firstDifference).toBe('');
  expect(got.verdict).toBe('PASS');
  await expect(page.locator('html')).toHaveAttribute('data-determinism', 'pass');
  await expect(page.getByRole('main').locator('pre')).toContainText('Determinism: PASS');
  await expect(page.locator('canvas')).toHaveCount(0);
});

test("a normal page has no determinism page: no chunk, no report, and the app's landmark", async ({ page, guard }) => {
  await page.goto('./');
  await expectStarted(page);
  await expect(page.getByRole('main')).toHaveAttribute('id', 'app');
  await expect(page.locator('#stage canvas')).toHaveCount(1);
  expect(await page.evaluate(() => window.terriestDeterminism === undefined)).toBe(true);
  await expect(page.locator('html')).not.toHaveAttribute('data-determinism');
  expect(guard.requests.filter((u) => /determinism/.test(u)), 'requests for the determinism chunk').toEqual([]);
  // The goldens, the scripts and their replay are a chunk of their own,
  // and never weigh on the pitch's download (design §7.5).
  const chunks = readdirSync(join(DIST, 'assets')).filter((f) => /^determinism-[\w-]+\.js$/.test(f));
  expect(chunks, 'the determinism chunk').toHaveLength(1);
  expect(readFileSync(join(DIST, 'assets', chunks[0]!), 'utf8')).toContain(goldens.canary);
  const main = readFileSync(join(DIST, await moduleScript()), 'utf8');
  expect(main.includes(goldens.canary), "the canary's hash in the page's module").toBe(false);
  const names = goldens.runs.map((r) => r.name).filter((name) => name.includes(' '));
  expect(names.filter((name) => main.includes(name)), "the runs' names in the page's module").toEqual([]);
});
