// M0 run 4 (PLAN §17 M0): the page, drawing the spike's simulation (the
// default showcase: a 4-a-side kickoff that plays on, 8 terriers), in
// Chromium, Firefox and WebKit at once, launched together in one test, from
// dist/ served by e2e/serve.mjs with public/_headers applied as terriest.com
// would apply it. Each engine plays the same six page loads one after
// another, each in a fresh context, so nothing comes from a cache:
// - the code-built drawer at low and high quality (D-33);
// - the code-built drawer with every animation frame held at 60 ms or more
//   (?frameWork=60), so the frame rate falls under 17 fps;
// - the model drawer, fed the generated stand-in by request interception
//   (D-27), under the shipped policy, and under D-35's planned policy (blob:
//   added to connect-src, by the test server only) at both qualities.
// It checks:
// - frame-rate independence: in every load, at whatever frame rate the
//   engine managed, the simulation's tick is the clock's count of 60 a
//   second, read at the same instant, with nothing dropped; and the page's
//   clock keeps Node's wall time;
// - DrawStats (renderer.info and the drawer's counts) and the bytes each
//   load transferred, by Resource Timing in the page and by Playwright, for
//   both drawers, against §12's starting guesses;
// - D-35: whether the stand-in's embedded texture loads under the shipped
//   policy, and, if it doesn't, that every refusal is connect-src refusing a
//   blob: URL, and that the planned policy loads it with no refusal at all.
// The figures go to results/page.json, and one JSON line per load is logged.
//
//   npx playwright test e2e/page.spec.ts

import { chromium, expect, firefox, test, webkit, type Browser, type BrowserType } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { makeStandin } from '../scripts/make-standin.mjs';
import { addSources, headersFor, parseHeadersFile, startServer, type Server } from './serve.mjs';
import type { SpikePage } from '../src/main';
import type { SpikeResult } from '../src/scene/page';

const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };
/** D-35's policy, as the plan writes it out. */
const PLANNED_CSP = "script-src 'self'; connect-src 'self' wss: blob:; object-src 'none'; base-uri 'none'";
const HEADER_RULES = parseHeadersFile(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'));
const STANDIN = makeStandin();
const SECONDS = 5;
const WARMUP = 1;
const FRAME_WORK = 60;
// §12's starting guesses, which M0 may lower but never raise.
const BUDGET = { codeTriangles: 2000, modelTriangles: 8000, modelBones: 32, modelTexture: 512, drawCalls: 40 };

interface Load {
  label: string;
  drawer: 'code' | 'model';
  policy: 'shipped' | 'planned';
  quality: 'low' | 'high';
  frameWork: number;
}

const LOADS: Load[] = [
  { label: 'code, low', drawer: 'code', policy: 'shipped', quality: 'low', frameWork: 0 },
  { label: 'code, high', drawer: 'code', policy: 'shipped', quality: 'high', frameWork: 0 },
  { label: `code, low, frames held to ${FRAME_WORK} ms`, drawer: 'code', policy: 'shipped', quality: 'low', frameWork: FRAME_WORK },
  { label: 'model, low, shipped policy', drawer: 'model', policy: 'shipped', quality: 'low', frameWork: 0 },
  { label: 'model, low, blob: allowed', drawer: 'model', policy: 'planned', quality: 'low', frameWork: 0 },
  { label: 'model, high, blob: allowed', drawer: 'model', policy: 'planned', quality: 'high', frameWork: 0 },
];

interface Transfer {
  url: string;
  status: number;
  encoding: string;
  bodyBytes: number;
  headerBytes: number;
}

interface Outcome {
  load: Load;
  result: SpikeResult;
  page: SpikePage | null;
  errors: string[];
  requests: string[];
  transfers: Transfer[];
  /** The page's performance.now() against Node's clock, over the window. */
  clock: { pageMs: number; nodeLowMs: number; nodeHighMs: number };
}

const base = (u: string): string => {
  try {
    const url = new URL(u);
    return url.protocol === 'blob:' || url.protocol === 'data:' ? url.protocol : url.pathname.replace(/^.*\//, '') || 'index.html';
  } catch {
    return u;
  }
};

/** What kind of file a request was, by its name. */
function kind(name: string): string {
  if (name === 'index.html' || name === '') return 'html';
  if (name.startsWith('model-drawer')) return 'model chunk';
  if (name.startsWith('index-')) return 'entry chunk';
  if (name.endsWith('.glb')) return 'model';
  return name;
}

async function playLoad(browser: Browser, load: Load, servers: Record<Load['policy'], Server>): Promise<Outcome> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    const requests: string[] = [];
    const sized: Promise<Transfer | null>[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('request', (r) => requests.push(r.url()));
    page.on('websocket', (s) => requests.push(s.url()));
    page.on('requestfinished', (r) => {
      sized.push((async () => {
        const [sizes, response] = await Promise.all([r.sizes(), r.response()]);
        return {
          url: r.url(), status: response?.status() ?? 0, encoding: (await response?.headerValue('content-encoding')) ?? '',
          bodyBytes: sizes.responseBodySize, headerBytes: sizes.responseHeadersSize,
        };
      })().catch(() => null));
    });
    if (load.drawer === 'model') {
      await page.route('**/standin.glb', (r) => r.fulfill({ body: STANDIN, contentType: 'model/gltf-binary' }));
      await page.addInitScript(() => {
        window.spikeTest = { modelUrl: './standin.glb' };
      });
    }
    const query = `?quality=${load.quality}&seconds=${SECONDS}&warmup=${WARMUP}${load.frameWork ? `&frameWork=${load.frameWork}` : ''}`;
    await page.goto(`${servers[load.policy].url}${query}`);
    await expect(page.locator('html'), 'WebGL 2; Firefox needs DISPLAY or WAYLAND_DISPLAY').toHaveAttribute('data-webgl2', 'yes');
    // The page's clock against Node's, bracketed by each evaluate's round trip.
    const sample = async (): Promise<{ page: number; low: number; high: number }> => {
      const low = performance.now();
      const p = await page.evaluate(() => performance.now());
      return { page: p, low, high: performance.now() };
    };
    await page.waitForFunction(() => window.spikeResult?.state === 'measuring' || window.spikeResult?.state === 'failed', null, { timeout: 90_000, polling: 100 });
    const a = await sample();
    await page.waitForTimeout((SECONDS - 1.5) * 1000);
    const b = await sample();
    await page.waitForFunction(() => window.spikeResult?.state === 'done' || window.spikeResult?.state === 'failed', null, { timeout: 90_000, polling: 250 });
    const result = (await page.evaluate(() => window.spikeResult)) as SpikeResult;
    const spikePage = (await page.evaluate(() => window.spikePage ?? null)) as SpikePage | null;
    const transfers = (await Promise.all(sized)).filter((t): t is Transfer => t !== null);
    return {
      load, result, page: spikePage, errors, requests, transfers,
      clock: { pageMs: b.page - a.page, nodeLowMs: b.low - a.high, nodeHighMs: b.high - a.low },
    };
  } finally {
    await context.close();
  }
}

/**
 * What each way of drawing costs to download, in one engine, from its
 * low-quality loads: the code-built path (the document and the entry chunk)
 * and what the model path adds (the model drawer's chunk and the model).
 * Bodies as sent (compressed), and with headers, as Playwright saw them; the
 * stand-in is served by interception, so its size is the file's, since the
 * engines report a fulfilled response's bytes unevenly.
 */
function pathBytes(os: readonly Outcome[]): Record<string, unknown> {
  const pick = (o: Outcome | undefined, k: string): Transfer | undefined => o?.transfers.find((t) => kind(base(t.url)) === k);
  const code = os.find((o) => o.load.label === 'code, low');
  const model = os.find((o) => o.load.label === 'model, low, blob: allowed');
  const html = pick(code, 'html');
  const entry = pick(code, 'entry chunk');
  const chunk = pick(model, 'model chunk');
  const sum = (ts: (Transfer | undefined)[]): { bodies: number; withHeaders: number } => ({
    bodies: ts.reduce((n, t) => n + (t?.bodyBytes ?? 0), 0), withHeaders: ts.reduce((n, t) => n + (t ? t.bodyBytes + t.headerBytes : 0), 0),
  });
  return {
    encoding: entry?.encoding ?? '',
    codePath: { document: html?.bodyBytes ?? 0, entryChunk: entry?.bodyBytes ?? 0, ...sum([html, entry]) },
    modelPathAdds: { modelChunk: chunk?.bodyBytes ?? 0, standinFile: STANDIN.length, bodies: (chunk?.bodyBytes ?? 0) + STANDIN.length },
    entryChunkDecoded: code?.result.resources.find((e) => kind(e.name) === 'entry chunk')?.decodedBodySize ?? 0,
  };
}

/** The figures of one load, for the log and results/page.json. */
function figures(engine: string, o: Outcome): Record<string, unknown> {
  const r = o.result;
  const resources = r.resources.map((e) => ({ name: e.name, kind: kind(e.name), transfer: e.transferSize, encoded: e.encodedBodySize, decoded: e.decodedBodySize }));
  // Playwright reports WebKit's blob: fetch of the embedded image as a request: no network bytes.
  const wire = o.transfers.filter((t) => !/^(blob|data):/.test(t.url))
    .map((t) => ({ name: base(t.url), kind: kind(base(t.url)), status: t.status, encoding: t.encoding, body: t.bodyBytes, headers: t.headerBytes }));
  const html = wire.find((w) => w.kind === 'html');
  return {
    engine, load: o.load.label, drawer: r.drawer, quality: r.quality, policy: o.load.policy, frameWork: o.load.frameWork,
    script: o.page?.script ?? '', renderer: r.env.renderer, pixelRatio: r.env.pixelRatio, samples: r.env.samples,
    frames: r.frames, fps: +(r.frames / r.seconds).toFixed(1), interval: r.interval, work: r.work, advance: r.advance,
    ticks: r.ticks, clockTicks: r.clock.expectedTicks, droppedTicks: r.clock.droppedTicks, maxTicksPerCall: r.clock.maxTicksPerCall,
    clock: o.clock,
    draw: { frame: r.draw.frame, terriers: r.draw.terriers, terrierPass: r.draw.terrierPass, perTerrier: r.draw.perTerrier, programs: r.draw.programs, memoryAtStart: r.draw.memoryAtStart, memoryAtEnd: r.draw.memoryAtEnd },
    model: r.model.requested ? { state: r.model.state, error: r.model.error, texture: r.model.info?.texture ?? null, missingClips: r.model.info?.missingClips ?? null, importMs: r.model.importMs, loadMs: r.model.info?.loadMs ?? 0, compileMs: r.model.compileMs } : null,
    csp: r.csp,
    bytes: {
      // Resource Timing in the page (the document itself isn't a resource entry), and what Playwright saw on the wire.
      resources,
      resourceTotals: { transfer: resources.reduce((n, e) => n + e.transfer, 0), encoded: resources.reduce((n, e) => n + e.encoded, 0), decoded: resources.reduce((n, e) => n + e.decoded, 0) },
      wire,
      wireTotal: wire.reduce((n, w) => n + w.body + w.headers, 0),
      wireBodies: wire.reduce((n, w) => n + w.body, 0),
      document: html ? html.body + html.headers : 0,
    },
    errors: o.errors,
  };
}

test('the page in Chromium, Firefox and WebKit at once: ticks by the clock, draw counts, bytes and the policy', async () => {
  test.setTimeout(8 * 60_000);
  const shipped = await startServer();
  // D-35's planned policy, by the test server only: amorfus's plus blob: in connect-src.
  const planned = await startServer({ rewriteCsp: (v) => addSources(v, 'connect-src', ['blob:']) });
  const servers = { shipped, planned };
  const browsers: Record<string, Browser> = {};
  try {
    // The server sends public/_headers's headers, as dist/ carries them; the planned one differs only in D-35's blob:.
    const index = await fetch(shipped.url);
    const entry = /src="\.\/(assets\/[^"]+\.js)"/.exec(await index.text())?.[1] ?? '';
    const asset = await fetch(`${shipped.url}${entry}`);
    for (const [k, v] of headersFor(HEADER_RULES, '/')) expect(index.headers.get(k), k).toBe(v);
    for (const [k, v] of headersFor(HEADER_RULES, `/${entry}`)) expect(asset.headers.get(k), k).toBe(v);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await fetch(planned.url)).headers.get('content-security-policy')).toBe(PLANNED_CSP);
    const launched = await Promise.all(Object.entries(ENGINES).map(async ([name, type]) => [name, await type.launch()] as const));
    for (const [name, b] of launched) browsers[name] = b;
    const t0 = Date.now();
    // All three engines at once; within each, one load after another.
    const byEngine = await Promise.all(Object.entries(browsers).map(async ([engine, browser]) => {
      const outcomes: Outcome[] = [];
      for (const load of LOADS) {
        const o = await playLoad(browser, load, servers);
        console.log(JSON.stringify(figures(engine, o)));
        outcomes.push(o);
      }
      return [engine, outcomes] as const;
    }));
    const wallSeconds = (Date.now() - t0) / 1000;

    // The answers, before the assertions, so a failing check still leaves its figures.
    const all = byEngine.flatMap(([engine, os]) => os.map((o) => ({ engine, o })));
    const fps = all.map(({ o }) => o.result.frames / o.result.seconds);
    const shippedModel = all.filter(({ o }) => o.load.drawer === 'model' && o.load.policy === 'shipped');
    const plannedModel = all.filter(({ o }) => o.load.drawer === 'model' && o.load.policy === 'planned');
    const answers = {
      frameRateIndependence: {
        loads: all.length,
        fps: { min: +Math.min(...fps).toFixed(1), max: +Math.max(...fps).toFixed(1) },
        everyTickOnTheClock: all.every(({ o }) => o.result.clock.droppedTicks === 0 && Math.abs(o.result.ticks - o.result.clock.expectedTicks) <= 1),
        worstTickError: Math.max(...all.map(({ o }) => Math.abs(o.result.ticks - o.result.clock.expectedTicks))),
      },
      textureUnderShippedPolicy: Object.fromEntries(shippedModel.map(({ engine, o }) => [engine, {
        loaded: o.result.model.info?.texture.present ?? false,
        refusals: o.result.csp,
      }])),
      textureUnderPlannedPolicy: Object.fromEntries(plannedModel.map(({ engine, o }) => [engine, {
        loaded: o.result.model.info?.texture.present ?? false,
        refusals: o.result.csp.length,
      }])),
      bytes: Object.fromEntries(byEngine.map(([engine, os]) => [engine, pathBytes(os)])),
      policyMustAllow: shippedModel.every(({ o }) => o.result.model.info?.texture.present) ? 'nothing beyond the shipped policy'
        : shippedModel.every(({ o }) => o.result.csp.length > 0 && o.result.csp.every((v) => v.directive === 'connect-src' && v.blocked.startsWith('blob')))
          ? 'blob: in connect-src' : 'more than blob: in connect-src (see the refusals)',
    };
    mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
    const versions = Object.fromEntries(Object.entries(browsers).map(([n, b]) => [n, b.version()]));
    writeFileSync(new URL('../results/page.json', import.meta.url), `${JSON.stringify({
      utc: new Date().toISOString(), seconds: SECONDS, warmup: WARMUP, wallSeconds, versions, budget: BUDGET, answers,
      loads: all.map(({ engine, o }) => figures(engine, o)),
    }, null, 1)}\n`);
    console.log(JSON.stringify({ wallSeconds, answers }));

    for (const { engine, o } of all) {
      const r = o.result;
      const what = `${engine}, ${o.load.label}`;
      expect(r.state, `${what}: ${r.error}`).toBe('done');
      expect(o.page?.script, what).toBe('showcase 4');
      // Frame-rate independence: the tick is the clock's count, nothing dropped (D-31).
      expect(r.clock.droppedTicks, what).toBe(0);
      expect(Math.abs(r.ticks - r.clock.expectedTicks), what).toBeLessThanOrEqual(1);
      expect(r.ticks, what).toBeGreaterThanOrEqual(60 * (SECONDS + WARMUP) - 1);
      // The page's clock keeps Node's wall time, within each sample's round trip and 1%.
      expect(o.clock.pageMs, what).toBeGreaterThanOrEqual(o.clock.nodeLowMs * 0.99);
      expect(o.clock.pageMs, what).toBeLessThanOrEqual(o.clock.nodeHighMs * 1.01);
      if (o.load.frameWork > 0) expect(r.frames / r.seconds, `${what}: frames held down`).toBeLessThan(1000 / o.load.frameWork + 1);
      // Nothing compiles or uploads in play (§12); the terriers' own pass matches the drawer's counts.
      expect(r.draw.programs.atEnd, what).toBe(r.draw.programs.atStart);
      expect(r.draw.memoryAtEnd, what).toEqual(r.draw.memoryAtStart);
      expect(r.draw.terrierPass, what).toEqual({ drawCalls: r.draw.terriers.drawCalls, triangles: r.draw.terriers.triangles });
      expect(r.draw.counts?.terriers, what).toBe(8);
      expect(r.draw.counts?.coatsPainted.length, what).toBe(8);
      expect(r.draw.counts?.packsPainted, what).toEqual([0, 1]);
      expect(r.draw.terriers.drawCalls, what).toBeLessThanOrEqual(BUDGET.drawCalls);
      // Every request stays on the page's origin (C-9's request guard).
      const origin = new URL(servers[o.load.policy].url).origin;
      expect(o.requests.filter((u) => !u.startsWith(`${origin}/`) && !u.startsWith('blob:') && !u.startsWith('data:')), what).toEqual([]);
      const names = r.resources.map((e) => e.name);
      if (o.load.drawer === 'code') {
        expect(r.drawer, what).toBe('code');
        expect(r.draw.perTerrier.triangles, what).toBeLessThanOrEqual(BUDGET.codeTriangles);
        // The code-built path loads neither the model drawer's chunk nor a model.
        expect(names.filter((n) => n.startsWith('model-drawer') || n.endsWith('.glb')), what).toEqual([]);
        expect(r.csp, what).toEqual([]);
        expect(o.errors, what).toEqual([]);
      } else {
        expect(r.model.state, `${what}: ${r.model.error}`).toBe('ready');
        expect(r.drawer, what).toBe('model');
        expect(r.model.info?.missingClips, what).toEqual([]);
        expect(names.some((n) => n.startsWith('model-drawer')), what).toBe(true);
        expect(o.requests.some((u) => u.endsWith('/standin.glb')), what).toBe(true);
        expect(r.draw.perTerrier.triangles, what).toBeLessThanOrEqual(BUDGET.modelTriangles);
        expect(r.draw.perTerrier.bones, what).toBeLessThanOrEqual(BUDGET.modelBones);
        if (o.load.policy === 'planned') {
          // D-35's planned policy loads the embedded texture, refusing nothing.
          expect(r.model.info?.texture, what).toMatchObject({ present: true, width: 256, height: 256 });
          expect(Math.max(r.model.info?.texture.width ?? 0, r.model.info?.texture.height ?? 0), what).toBeLessThanOrEqual(BUDGET.modelTexture);
          expect(r.csp, what).toEqual([]);
          expect(o.errors, what).toEqual([]);
        } else if (!r.model.info?.texture.present) {
          // Refused: then only connect-src refused, and only blob: URLs, so blob: is what it must allow.
          expect(r.csp.length, what).toBeGreaterThan(0);
          expect(r.csp.every((v) => v.directive === 'connect-src' && v.blocked.startsWith('blob')), `${what}: ${JSON.stringify(r.csp)}`).toBe(true);
          expect(o.errors.filter((e) => !/blob:|Content Security Policy|Couldn't load texture/i.test(e)), what).toEqual([]);
        } else {
          expect(r.csp, what).toEqual([]);
          expect(o.errors, what).toEqual([]);
        }
      }
    }
    expect(answers.policyMustAllow).not.toMatch(/^more than/);
  } finally {
    await Promise.all(Object.values(browsers).map((b) => b.close()));
    await shipped.close();
    await planned.close();
  }
});
