// The scene page in each engine, one engine at a time (PLAN §17 M0; run 4
// itself, all three engines at once, is e2e/page.spec.ts), from dist/ served
// by e2e/serve.mjs with dist/_headers applied unchanged, as terriest.com
// serves it: both drawers draw the simulation's 8 terriers (the page's
// default, the 4-a-side showcase); the ticks follow the clock whatever the
// frame rate; nothing compiles in play; every request stays on the page's
// origin; the drawing counts stay inside §12's starting guesses; and the
// stand-in model, made here and served by interception (D-27), loads under
// the content security policy, which answers D-35's blob: question.
// Each test logs one JSON line of its figures for research/spike/REPORT.md.
//
// dist/ comes from playwright.config.ts's web server command (vite build).

import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { makeStandin } from '../scripts/make-standin.mjs';
import { addSources, startServer } from './serve.mjs';
import type { SpikeResult } from '../src/scene/page';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const STANDIN = makeStandin();
// §12's starting guesses, which M0 may lower but never raise.
const BUDGET = { codeTriangles: 2000, modelTriangles: 8000, modelBones: 32, modelTexture: 512, drawCalls: 40 };

let shipped: Awaited<ReturnType<typeof startServer>>;
let withBlob: Awaited<ReturnType<typeof startServer>>;

test.beforeAll(async () => {
  shipped = await startServer({ distDir: DIST });
  // D-35's planned policy: amorfus's plus blob: in connect-src, for comparison only.
  withBlob = await startServer({ distDir: DIST, rewriteCsp: (v) => addSources(v, 'connect-src', ['blob:']) });
});

test.afterAll(async () => {
  await shipped?.close();
  await withBlob?.close();
});

interface Watch {
  errors: string[];
  requests: string[];
}

function watch(page: Page): Watch {
  const w: Watch = { errors: [], requests: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') w.errors.push(m.text());
  });
  page.on('pageerror', (e) => w.errors.push(String(e)));
  page.on('request', (r) => w.requests.push(r.url()));
  page.on('websocket', (s) => w.requests.push(s.url()));
  return w;
}

async function serveStandin(page: Page): Promise<void> {
  await page.route('**/standin.glb', (r) => r.fulfill({ body: STANDIN, contentType: 'model/gltf-binary' }));
  await page.addInitScript(() => {
    window.spikeTest = { modelUrl: './standin.glb' };
  });
}

async function run(page: Page, port: number, query: string): Promise<SpikeResult> {
  await page.goto(`http://127.0.0.1:${port}/${query}`);
  await expect(page.locator('html'), 'WebGL 2; Firefox needs DISPLAY or WAYLAND_DISPLAY').toHaveAttribute('data-webgl2', 'yes');
  await page.waitForFunction(() => window.spikeResult?.state === 'done' || window.spikeResult?.state === 'failed', null, { timeout: 75_000, polling: 250 });
  const r = (await page.evaluate(() => window.spikeResult)) as SpikeResult;
  expect(r.error).toBe('');
  return r;
}

function figures(engine: string, label: string, r: SpikeResult): string {
  return JSON.stringify({
    engine, label, drawer: r.drawer, quality: r.quality, renderer: r.env.renderer, pixelRatio: r.env.pixelRatio, samples: r.env.samples,
    frames: r.frames, interval: r.interval, work: r.work, ticks: r.ticks, clockTicks: r.clock.expectedTicks, dropped: r.clock.droppedTicks,
    maxTicksPerCall: r.clock.maxTicksPerCall, draw: r.draw.frame, terriers: r.draw.terriers, terrierPass: r.draw.terrierPass,
    perTerrier: r.draw.perTerrier, programs: r.draw.programs, memory: r.draw.memoryAtEnd, model: r.model.info ? { texture: r.model.info.texture, loadMs: r.model.info.loadMs, importMs: r.model.importMs, compileMs: r.model.compileMs } : null,
    csp: r.csp, resources: r.resources.map((e) => ({ name: e.name, transfer: e.transferSize, encoded: e.encodedBodySize, decoded: e.decodedBodySize })),
  });
}

function expectCommon(r: SpikeResult, w: Watch, port: number): void {
  // The clock, not the frame rate, sets the tick (D-31); nothing was dropped.
  expect(r.clock.droppedTicks).toBe(0);
  expect(Math.abs(r.ticks - r.clock.expectedTicks)).toBeLessThanOrEqual(1);
  expect(r.frames).toBeGreaterThan(5);
  // Nothing compiles in play (§12), and nothing new is uploaded.
  expect(r.draw.programs.atEnd).toBe(r.draw.programs.atStart);
  expect(r.draw.memoryAtEnd).toEqual(r.draw.memoryAtStart);
  // The terriers alone, as renderer.info counted them, match the drawer's counts.
  expect(r.draw.terrierPass).toEqual({ drawCalls: r.draw.terriers.drawCalls, triangles: r.draw.terriers.triangles });
  expect(r.draw.counts?.terriers).toBe(8);
  expect(r.draw.counts?.coatsPainted.length).toBe(8);
  expect(r.draw.counts?.packsPainted).toEqual([0, 1]);
  expect(r.draw.terriers.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  // Every request stays on the page's origin (C-9's request guard).
  expect(w.requests.filter((u) => !u.startsWith(`http://127.0.0.1:${port}/`) && !u.startsWith('blob:') && !u.startsWith('data:'))).toEqual([]);
}

test('the code-built drawer draws the match under the shipped headers', async ({ page, browserName }) => {
  const w = watch(page);
  const r = await run(page, shipped.port, '?quality=low&seconds=3&warmup=1');
  console.log(figures(browserName, 'code, shipped headers', r));
  expect(r.drawer).toBe('code');
  expectCommon(r, w, shipped.port);
  expect(r.draw.perTerrier.triangles).toBeLessThanOrEqual(BUDGET.codeTriangles);
  expect(r.csp).toEqual([]);
  expect(w.errors).toEqual([]);
  // The code-built path never loads the model drawer's chunk.
  expect(r.resources.map((e) => e.name).filter((n) => n.startsWith('model-drawer'))).toEqual([]);
});

test('the stand-in model draws the match under the shipped headers', async ({ page, browserName }) => {
  const w = watch(page);
  await serveStandin(page);
  const r = await run(page, shipped.port, '?quality=low&seconds=3&warmup=1');
  console.log(figures(browserName, 'model, shipped headers', r));
  expect(r.model.state, r.model.error).toBe('ready');
  expect(r.drawer).toBe('model');
  expect(r.model.info?.missingClips).toEqual([]);
  expectCommon(r, w, shipped.port);
  expect(r.draw.perTerrier.triangles).toBeLessThanOrEqual(BUDGET.modelTriangles);
  expect(r.draw.perTerrier.bones).toBeLessThanOrEqual(BUDGET.modelBones);
  expect(r.resources.map((e) => e.name).some((n) => n.startsWith('model-drawer'))).toBe(true);
  // D-35's question, as measured: under amorfus's policy, GLTFLoader's
  // embedded image is fetched from a blob: URL and connect-src refuses it.
  // The model still draws, untextured, and the loader logs the failure.
  expect(r.model.info?.texture.present).toBe(false);
  expect(r.csp.map((v) => v.directive)).toContain('connect-src');
  expect(r.csp.every((v) => v.directive === 'connect-src' && v.blocked.startsWith('blob'))).toBe(true);
  expect(w.errors.filter((e) => !/blob:|Content Security Policy|Couldn't load texture/i.test(e))).toEqual([]);
});

test('with blob: in connect-src, the stand-in loads with its texture', async ({ page, browserName }) => {
  const w = watch(page);
  await serveStandin(page);
  const r = await run(page, withBlob.port, '?quality=low&seconds=3&warmup=1');
  console.log(figures(browserName, 'model, blob: added', r));
  expect(r.model.state, r.model.error).toBe('ready');
  expect(r.model.info?.texture).toMatchObject({ present: true, width: 256, height: 256 });
  expect(Math.max(r.model.info?.texture.width ?? 0, r.model.info?.texture.height ?? 0)).toBeLessThanOrEqual(BUDGET.modelTexture);
  expectCommon(r, w, withBlob.port);
  expect(r.csp).toEqual([]);
  expect(w.errors).toEqual([]);
});

for (const quality of ['high', 'low'] as const) {
  test(`render quality ${quality}: its pixel-ratio cap and MSAA (D-33)`, async ({ browser, browserName }) => {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 3 });
    try {
      const page = await ctx.newPage();
      const w = watch(page);
      const r = await run(page, shipped.port, `?quality=${quality}&seconds=2&warmup=1`);
      console.log(figures(browserName, `code, ${quality}, device pixel ratio 3`, r));
      expect(r.env.pixelRatio).toBe(quality === 'high' ? 2 : 1);
      expect(r.env.canvas).toEqual({ width: 640 * r.env.pixelRatio, height: 360 * r.env.pixelRatio });
      if (quality === 'low') expect(r.env.samples).toBe(0);
      else expect(r.env.samples).toBeGreaterThan(0);
      expectCommon(r, w, shipped.port);
      expect(w.errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
