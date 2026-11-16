// Run 3's drawn reading on two GL paths: the spike's own ?test=cost page
// (dist/, so `npm run build` first), drawn, at 4×, on the plan's script, at
// the desktop's and the Pixel 8a's size, with software GL (SwiftShader,
// Playwright's default) and with the GPU (ANGLE on Mesa's D3D12 driver, which
// WSLg provides: GALLIUM_DRIVER=d3d12), sampling the CPU each Chromium process
// type used from /proc. Repetitions alternate the two paths.
//
//   node scripts/verify/drawn-gl.mjs [reps] [batch]   -> appends to results/verify/drawn-gl.json
/* global window, document */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';
import { startServer } from '../../e2e/serve.mjs';

const reps = Number(process.argv[2] ?? 2);
const batch = Number(process.argv[3] ?? 1);
const outFile = fileURLToPath(new URL('../../results/verify/drawn-gl.json', import.meta.url));
const server = await startServer({ extraHeaders: [['Cross-Origin-Opener-Policy', 'same-origin'], ['Cross-Origin-Embedder-Policy', 'require-corp']] });
const TICKS_PER_SECOND = 100; // getconf CLK_TCK
const GPU_ARGS = ['--use-gl=angle', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'];

/** CPU time (clock ticks) of every Chromium process, keyed by pid and process type. */
function chromeCpu() {
  const by = {};
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8');
      if (!/chrom|headless_shell/.test(cmd.split('\0')[0] ?? '')) continue;
      const type = (cmd.match(/--type=([\w-]+)/) ?? [null, 'browser'])[1];
      const s = readFileSync(`/proc/${d}/stat`, 'utf8');
      const rest = s.slice(s.lastIndexOf(')') + 2).split(' ');
      by[`${d}:${type}`] = Number(rest[11]) + Number(rest[12]);
    } catch {
      // gone between readdir and read
    }
  }
  return by;
}
function cores(a, b, seconds) {
  const out = {};
  for (const [k, v] of Object.entries(b)) {
    const type = k.split(':')[1];
    out[type] = (out[type] ?? 0) + (v - (a[k] ?? 0)) / TICKS_PER_SECOND / seconds;
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, +v.toFixed(2)]));
}

const rows = [];
for (let rep = 0; rep < reps; rep++) {
  for (const gl of ['software', 'gpu']) {
    const browser = await chromium.launch(gl === 'gpu' ? { args: GPU_ARGS, env: { ...process.env, GALLIUM_DRIVER: 'd3d12' } } : {});
    for (const device of ['desktop', 'Pixel 8a']) {
      const ctx = await browser.newContext(device === 'desktop' ? { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } : devices['Pixel 8a']);
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const renderer = await page.evaluate(() => {
        const gl2 = document.createElement('canvas').getContext('webgl2');
        const e = gl2?.getExtension('WEBGL_debug_renderer_info');
        return e ? gl2.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'none';
      });
      const load1m = +loadavg()[0].toFixed(2);
      const q = new URLSearchParams({ test: 'cost', script: 'scrum at the wall, flag42', ticks: '1200', runs: '10', draw: '1', quality: 'low' });
      const c0 = chromeCpu();
      const t0 = Date.now();
      await page.goto(`${server.url}?${q}`);
      await page.waitForFunction(() => window.spikeCost?.state === 'done' || window.spikeCost?.state === 'failed', null, { timeout: 240_000, polling: 500 });
      const seconds = (Date.now() - t0) / 1000;
      const c1 = chromeCpu();
      const r = await page.evaluate(() => window.spikeCost);
      const t = r.report.tick;
      const f3 = (x) => +x.toFixed(3);
      const row = {
        batch, rep, gl, device, renderer: String(renderer).slice(0, 80), load1mBefore: load1m, error: r.error,
        tick: { mean: f3(t.mean), p50: f3(t.p50), p95: f3(t.p95), p99: f3(t.p99), max: f3(t.max), n: t.n },
        fps: r.frames ? +(1000 / r.frames.interval.mean).toFixed(1) : null, frameP95: r.frames ? +r.frames.interval.p95.toFixed(1) : null,
        cpuCoresByProcessType: cores(c0, c1, seconds), seconds: +seconds.toFixed(1), isolated: r.env.crossOriginIsolated, viewport: r.env.viewport,
        bursts270: r.report.bursts.filter((b) => b.steps === 270).map((b) => ({ median: +b.ms.p50.toFixed(2), max: +b.ms.max.toFixed(2) }))[0],
      };
      console.log(JSON.stringify(row));
      rows.push(row);
      await ctx.close();
    }
    await browser.close();
  }
}
const prior = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : { rows: [], utc: [] };
writeFileSync(outFile, JSON.stringify({
  about: "The spike's ?test=cost page (dist/), drawn, at 4x, on the plan's script, with software GL (SwiftShader) and the GPU (ANGLE on D3D12); CPU in cores by Chromium process type (scripts/verify/drawn-gl.mjs)",
  utc: [...[prior.utc].flat(), new Date().toISOString()], rows: [...prior.rows, ...rows],
}, null, 1));
await server.close();
