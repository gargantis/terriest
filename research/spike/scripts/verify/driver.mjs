// Drives the verification page (scripts/verify/page, built first by
// scripts/verify/vite.config.mjs into results/tmp/verify-page):
// - cost: run 3's 13-step tick on the plan's script in Chromium, desktop and
//   'Pixel 8a', at 1× and 4× (DevTools' Emulation.setCPUThrottlingRate),
//   back to back and paced at 60 Hz with nothing drawn, every timed tick
//   kept, a busy-loop probe of the throttle, and at 4× again with five
//   times the JIT warm-up -> results/verify/cost-series.json;
// - det: the extra determinism runs in Node, Chromium, Firefox and WebKit,
//   compared hash by hash -> results/verify/det-extra.json.
// The page is cross-origin isolated (COOP and COEP), so the clock steps by 5 µs.
//
//   npx vite build --config scripts/verify/vite.config.mjs && node scripts/verify/driver.mjs cost|det
/* global window */
import { writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, devices, firefox, webkit } from '@playwright/test';
import { startServer } from '../../e2e/serve.mjs';
import { runExtra } from './page/det-runs.ts';

const what = process.argv[2];
const out = (name) => fileURLToPath(new URL(`../../results/verify/${name}`, import.meta.url));
const server = await startServer({
  distDir: fileURLToPath(new URL('../../results/tmp/verify-page', import.meta.url)),
  extraHeaders: [['Cross-Origin-Opener-Policy', 'same-origin'], ['Cross-Origin-Embedder-Policy', 'require-corp']],
});
const load = () => loadavg().map((x) => +x.toFixed(2));
const f3 = (x) => +x.toFixed(3);

async function costRun(browser, device, rate, paced, extra = {}) {
  const ctx = await browser.newContext(device === 'desktop' ? { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } : devices['Pixel 8a']);
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const qs = new URLSearchParams({ mode: 'cost', script: 'scrum at the wall, flag42', ticks: '1200', runs: '10', paced: paced ? '1' : '0', ...extra });
    const before = load();
    await page.goto(`${server.url}?${qs}`);
    await page.waitForFunction(() => window.verify?.state === 'done', null, { timeout: 300_000, polling: 500 });
    const r = await page.evaluate(() => window.verify);
    const t = r.report.tick;
    const row = {
      device, rate, mode: paced ? 'paced at 60 Hz, nothing drawn' : 'back to back', extra, loadBefore: before, loadAfter: load(),
      isolated: r.isolated, viewport: r.viewport, dpr: r.dpr, probeMsBefore: f3(r.probeMs), probeMsAfter: f3(r.probeAfterMs),
      tick: { mean: f3(t.mean), p50: f3(t.p50), p95: f3(t.p95), p99: f3(t.p99), max: f3(t.max), n: t.n },
      stepUs: +(r.report.step.mean * 1000).toFixed(1), contactsPerSubstep: +r.report.contacts.perSubstep.toFixed(2), maxInSubstep: r.report.contacts.maxInSubstep,
      baseTicks: r.report.baseTicks, quarters: r.blocks.map((b) => ({ mean: f3(b.mean), p95: f3(b.p95), max: f3(b.max) })),
      bursts: r.report.bursts.map((b) => ({ steps: b.steps, runs: b.runs, median: +b.ms.p50.toFixed(2), max: +b.ms.max.toFixed(2) })),
      dropped: r.dropped, errors, tickMs: r.tickMs.map((x) => +x.toFixed(4)),
    };
    console.log(JSON.stringify({ ...row, tickMs: undefined }));
    return row;
  } finally {
    await ctx.close();
  }
}

if (what === 'cost') {
  const browser = await chromium.launch();
  const rows = [];
  for (const device of ['desktop', 'Pixel 8a']) for (const rate of [1, 4]) for (const paced of [false, true]) rows.push(await costRun(browser, device, rate, paced));
  for (const device of ['desktop', 'Pixel 8a']) for (const paced of [false, true]) rows.push(await costRun(browser, device, 4, paced, { warm: '600' }));
  writeFileSync(out('cost-series.json'), JSON.stringify({ utc: new Date().toISOString(), chromium: browser.version(), cpu: cpus()[0]?.model, cpus: cpus().length, rows }, null, 1));
  await browser.close();
} else if (what === 'det') {
  const t0 = performance.now();
  const node = runExtra();
  const engines = { node: { version: process.version, ms: performance.now() - t0, runs: node } };
  for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
    const browser = await type.launch();
    const page = await browser.newPage();
    await page.goto(`${server.url}?mode=det`);
    await page.waitForFunction(() => window.verify?.state === 'done', null, { timeout: 300_000, polling: 500 });
    const r = await page.evaluate(() => window.verify);
    engines[name] = { version: browser.version(), ms: r.ms, runs: r.runs };
    await browser.close();
  }
  const compare = {};
  for (const e of ['chromium', 'firefox', 'webkit']) {
    let mismatches = 0;
    let first = null;
    engines[e].runs.forEach((r, i) => {
      const w = node[i];
      r.hashes.forEach((h, k) => {
        if (h !== w.hashes[k]) {
          mismatches++;
          first ??= `${r.name} at tick ${(k + 1) * 100}`;
        }
      });
      if (r.name !== w.name || r.hashes.length !== w.hashes.length || r.final !== w.final || r.contacts !== w.contacts || r.slipOuts !== w.slipOuts) {
        mismatches++;
        first ??= `${r.name}: name, final hash or counters`;
      }
    });
    compare[e] = { runs: engines[e].runs.length, mismatches, first };
  }
  const summary = {
    runs: node.length, ticks: node.reduce((a, r) => a + r.ticks, 0), hashesPerEngine: node.reduce((a, r) => a + r.hashes.length, 0), compare,
    versions: Object.fromEntries(Object.entries(engines).map(([k, v]) => [k, v.version])),
    ms: Object.fromEntries(Object.entries(engines).map(([k, v]) => [k, Math.round(v.ms)])),
  };
  console.log(JSON.stringify(summary, null, 1));
  writeFileSync(out('det-extra.json'), JSON.stringify({ utc: new Date().toISOString(), summary, node: node.map((r) => ({ name: r.name, ticks: r.ticks, final: r.final, contacts: r.contacts, slipOuts: r.slipOuts, hashes: r.hashes })) }, null, 1));
}
await server.close();
