// M0 run 3 (PLAN §17 M0, C-2): the simulation's tick cost, with a 13-step
// replay every tick re-simulated from a cloned state, on run 1's 4-a-side
// scrums, in Chromium on the desktop and at the Pixel 8a's size (Playwright's
// 'Pixel 8a' device), at 1× and 4× CPU throttle (DevTools'
// Emulation.setCPUThrottlingRate); then the worst single ticks, bursts of
// 30, 42 and 270 steps in one tick, each against L286's 50 ms frame. The page's
// ?test=cost mode runs src/cost.ts's harness, and Node runs the same harness
// (scripts/cost-node.mjs) for comparison.
//
// - Each configuration runs twice: drawn (the scene draws the bench's base
//   state at the device's size while the clock drives one unit of work per
//   60 Hz tick, as in a match) and not drawn (the units back to back). Node
//   runs both ways too: paced at 60 Hz with nothing drawn, and back to back.
//   Pacing alone costs: the CPU idles between paced ticks.
// - Every run: 120 settling steps, 120 untimed 13-step ticks to warm the
//   JIT, 1,200 timed 13-step ticks (PLAN asks for at least 600), then 30
//   bursts of each size.
// - The test server cross-origin isolates the page (COOP and COEP, never in
//   public/_headers), so Chromium's performance.now() steps by 5 µs, not
//   100 µs; the policy from public/_headers still applies.
// - The stop rule (§17: p95 of a 13-step tick over 4 ms in Chromium at 4×)
//   and the 50 ms frame are findings, reported, not asserted: the spec
//   asserts that each run measured what it says it did.
// The figures go to results/cost.json, and one JSON line per run is logged.
//
//   npx playwright test e2e/cost.spec.ts

import { chromium, devices, expect, test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CostPageResult } from '../src/cost-page';
import type { CostReport } from '../src/cost';
import { startServer, type Server } from './serve.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// src/cost.ts's COST_SCRIPTS, DEFAULT_COST and limits, restated so this file
// imports nothing at run time from the page's sources.
const SCRIPTS = ['scrum at the wall, flag42', 'scrum in the corner, flag42'];
const TICKS = 1200;
const BURST_RUNS = 30;
const BURSTS = [30, 42, 270];
const STOP_RULE_P95_MS = 4;
const FRAME_LIMIT_MS = 50;

const DEVICES: Record<string, BrowserContextOptions> = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  'Pixel 8a': devices['Pixel 8a']!,
};
const RATES = [1, 4];

interface Row {
  script: string;
  device: string;
  rate: number;
  draw: boolean;
  wallMs: number;
  env: CostPageResult['env'];
  frames: CostPageResult['frames'];
  report: CostReport;
}

const rows: Row[] = [];
let node: { node: string; v8: string; clockResolutionMs: number; runs: { mode: 'tight' | 'paced'; wallMs: number; report: CostReport }[] } | null = null;
let browser: Browser;
let server: Server;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  browser = await chromium.launch();
  server = await startServer({
    extraHeaders: [['Cross-Origin-Opener-Policy', 'same-origin'], ['Cross-Origin-Embedder-Policy', 'require-corp']],
  });
});

test.afterAll(async () => {
  await browser?.close();
  await server?.close();
});

function line(r: Pick<Row, 'script' | 'device' | 'rate' | 'draw' | 'report'> & Partial<Row>, engine = 'chromium'): string {
  const p = r.report;
  const f = (x: number): number => +x.toFixed(4);
  return JSON.stringify({
    engine, script: r.script, device: r.device, rate: r.rate, draw: r.draw,
    tickMs: { mean: f(p.tick.mean), p50: f(p.tick.p50), p95: f(p.tick.p95), max: f(p.tick.max), n: p.tick.n },
    stepMs: { mean: f(p.step.mean), p95: f(p.step.p95), max: f(p.step.max) },
    contactsPerSubstep: f(p.contacts.perSubstep), floor: f(p.contacts.floorPerSubstep), maxInSubstep: p.contacts.maxInSubstep,
    bursts: p.bursts.map((b) => ({ steps: b.steps, median: f(b.ms.p50), max: f(b.ms.max), perStep: f(b.perStepMs), within50: b.within })),
    stopRule: p.stopRule.within, clockStepMs: r.env?.clockResolutionMs ?? null, isolated: r.env?.crossOriginIsolated ?? null,
    fps: r.frames ? +(1000 / (r.frames.interval.mean || 1)).toFixed(1) : null,
  });
}

for (const script of SCRIPTS) {
  for (const [device, options] of Object.entries(DEVICES)) {
    for (const rate of RATES) {
      for (const draw of [true, false]) {
        test(`${script}: ${device}, ${rate}× CPU, ${draw ? 'drawn, on the clock' : 'not drawn'}`, async () => {
          test.setTimeout(240_000);
          const context = await browser.newContext(options);
          try {
            const page = await context.newPage();
            const errors: string[] = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            page.on('console', (m) => {
              if (m.type() === 'error') errors.push(m.text());
            });
            const cdp = await context.newCDPSession(page);
            await cdp.send('Emulation.setCPUThrottlingRate', { rate });
            const q = new URLSearchParams({ test: 'cost', script, ticks: String(TICKS), runs: String(BURST_RUNS), draw: draw ? '1' : '0', quality: 'low' });
            await page.goto(`${server.url}?${q.toString()}`);
            await page.waitForFunction(() => window.spikeCost?.state === 'done' || window.spikeCost?.state === 'failed', null, { timeout: 220_000, polling: 500 });
            const got = (await page.evaluate(() => window.spikeCost)) as CostPageResult;
            expect(got.error).toBe('');
            const report = got.report!;
            const row: Row = { script, device, rate, draw, wallMs: got.wallMs, env: got.env, frames: got.frames, report };
            rows.push(row);
            console.log(line(row));
            // It measured what it says: the script, at least 600 timed ticks of 13 steps, every burst, on a fine clock.
            expect(report.script).toBe(script);
            expect(report.stepsPerTick).toBe(13);
            expect(report.tick.n).toBe(TICKS);
            expect(report.tick.n).toBeGreaterThanOrEqual(600);
            expect(report.contacts.substeps).toBe(TICKS * 13 * 4);
            expect(report.contacts.perSubstep).toBeGreaterThan(0);
            expect(report.bursts.map((b) => [b.steps, b.runs])).toEqual(BURSTS.map((s) => [s, BURST_RUNS]));
            expect(got.env.crossOriginIsolated).toBe(true);
            expect(got.env.clockResolutionMs).toBeLessThanOrEqual(0.01);
            if (device === 'Pixel 8a') expect(got.env.viewport).toEqual({ width: 412, height: 839 });
            if (draw) expect(got.frames?.count ?? 0).toBeGreaterThan(0);
            expect(errors).toEqual([]);
          } finally {
            await context.close();
          }
        });
      }
    }
  }
}

test('Node runs the same harness, for comparison', () => {
  test.setTimeout(240_000);
  // A clean environment: no loader of the test runner's reaches the child.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_OPTIONS' && !k.startsWith('PW_')));
  const out = execFileSync(process.execPath, ['scripts/cost-node.mjs', '--mode', 'both', '--ticks', String(TICKS), '--runs', String(BURST_RUNS)], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 << 20 });
  node = JSON.parse(out) as NonNullable<typeof node>;
  for (const r of node.runs) {
    console.log(line({ script: r.report.script, device: `node, ${r.mode}`, rate: 1, draw: false, report: r.report }, 'node'));
    expect(r.report.tick.n).toBe(TICKS);
  }
  expect(node.runs.map((r) => [r.mode, r.report.script])).toEqual(['tight', 'paced'].flatMap((m) => SCRIPTS.map((s) => [m, s])));
});

test('the results: throttling took effect, and the stop rule and the 50 ms frame as found', () => {
  expect(rows.length).toBe(SCRIPTS.length * Object.keys(DEVICES).length * RATES.length * 2);
  // 4× must show: each configuration's mean tick at 4× is well over its 1× mean.
  for (const r of rows.filter((x) => x.rate === 4)) {
    const one = rows.find((x) => x.rate === 1 && x.script === r.script && x.device === r.device && x.draw === r.draw)!;
    expect(r.report.tick.mean, `${r.script}, ${r.device}, draw ${r.draw}`).toBeGreaterThan(2 * one.report.tick.mean);
  }
  const at4 = rows.filter((r) => r.rate === 4);
  const worstP95 = Math.max(...at4.map((r) => r.report.tick.p95));
  const worstBurst = Object.fromEntries(BURSTS.map((steps) => [steps, Math.max(...at4.map((r) => r.report.bursts.find((b) => b.steps === steps)!.ms.max))]));
  // Chromium against Node, like for like: desktop at 1×, back to back, and paced at 60 Hz (drawn in the page, not in Node).
  const brief = (r: CostReport | undefined): Record<string, number> | null => (r ? { mean: r.tick.mean, p50: r.tick.p50, p95: r.tick.p95, max: r.tick.max } : null);
  const chromiumVsNode = Object.fromEntries(SCRIPTS.map((script) => [script, {
    backToBack: {
      chromium: brief(rows.find((r) => r.script === script && r.device === 'desktop' && r.rate === 1 && !r.draw)?.report),
      node: brief(node?.runs.find((r) => r.mode === 'tight' && r.report.script === script)?.report),
    },
    paced: {
      chromiumDrawn: brief(rows.find((r) => r.script === script && r.device === 'desktop' && r.rate === 1 && r.draw)?.report),
      node: brief(node?.runs.find((r) => r.mode === 'paced' && r.report.script === script)?.report),
    },
  }]));
  const summary = {
    chromiumVsNode,
    stopRule: { judgedOn: 'Chromium at 4×, every script, device and mode', p95LimitMs: STOP_RULE_P95_MS, worstTickP95Ms: worstP95, within: worstP95 <= STOP_RULE_P95_MS },
    worstSingleTicksAt4x: { limitMs: FRAME_LIMIT_MS, maxMs: worstBurst, within: Object.fromEntries(Object.entries(worstBurst).map(([k, v]) => [k, v <= FRAME_LIMIT_MS])) },
  };
  console.log(JSON.stringify(summary));
  mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../results/cost.json', import.meta.url), `${JSON.stringify({
    utc: new Date().toISOString(), chromium: browser.version(), cpu: cpus()[0]?.model ?? '', cpus: cpus().length,
    method: { ticks: TICKS, settleTicks: 120, warmupTicks: 120, burstRuns: BURST_RUNS, bursts: BURSTS, quality: 'low', isolated: true },
    summary, runs: rows, node,
  }, null, 1)}\n`);
});
