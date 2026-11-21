// The frame-time bench's runs outside the gate (M4's design,
// research/m4/DESIGN.md, §8.4; PLAN §16's frame-time run, L286; M3-Q14,
// D-15, D-16, D-31, R-6, M4-Q6), as M3's load run is (e2e/load.run.ts):
//
//   npm run build && TERRIEST_FRAMES_OUT=<file> npx playwright test -c playwright.frames.config.ts -g "run 4:"
//
// Each run is a test of its own, picked by its title, "run N: …"; each of
// its pages opens #test=frames (src/frames.ts) with the run's parameters,
// waits for its report, and appends one JSON line to the file
// TERRIEST_FRAMES_OUT names: the run, its page's engine, viewport, CPU
// throttle and GL path, the machine's 1-minute load before and after the
// page, whether the run waited by the quiet rule, and the page's whole
// FrameReport. Without the variable it refuses at once, before it opens a
// page, so nothing lands in the repo by accident. docs/acceptance.md takes
// the figures (phase 2c's slow-frames runs 4 and 6, 4b's measure the rest).
// - The quiet rule (§0, §8.4): each run first waits until the 1-minute load
//   has fallen under 1 and 8 more minutes have passed, with no builder,
//   gate, build or dev server running, which no run can check, so it's the
//   runner's; TERRIEST_FRAMES_QUIET=0 skips the wait, for a smoke, and its
//   lines say they decide nothing.
// - The GPU path: GALLIUM_DRIVER set, Chromium with ANGLE's GL flags
//   (e2e/lib/gl.ts, C-6), as runs 1, 2, 4 and 6 ask; each line records it.
// - The runs, §8.4's:
//   1. the frame-time run (L286): a whole 4-a-side match, no witness, in
//      each engine, with the code-built drawer and again with the stand-in
//      (model=standin.glb, its bytes scripts/make-standin.mjs's, served by
//      interception as e2e/lib/standin.ts serves them; until phase 3 makes
//      it, that page is recorded as skipped);
//   2. the CPU figures at the Pixel 8a's size, 915 × 412 at 2.625 device
//      pixels a CSS pixel, held sideways, in Chromium at 1× and 4× CPU
//      throttle: the timer run's cost, and the frame's own work without its
//      draw submission; its frame intervals are SwiftShader's, which
//      throttling doesn't slow, so they're no phone proxy (PLAN §16);
//   3. the forced repair (M3-Q14): repair=1, the witness in its Worker, at
//      4× throttle in Chromium, 20 pages, a fresh one each: every call of
//      the repair and the STATE's adoption alone, against M3's 25 ms; a
//      60 s window, as the hold waits up to 15 s for a calm room (bench-F2);
//   4. the timers' cadence with real frames (D-15, D-31): each engine at
//      both qualities, the timer gaps against the freeze's 233 ms and the
//      stall's 2 s, and the clock's samples taken, dropped and their age;
//   5. the glide's check (D-16, §2.3): the corrections' sizes in the match
//      summary at 20–80 ms with 15 ms of jitter; the drawn bodies' speed
//      beyond the simulation's comes with phase 3's smoother;
//   6. the slow-frame share (§8.1, M4-Q6): every sender's skipped share with
//      each frame held to 33, 50, 67 and 100 ms in Chromium, and in the
//      three engines at once at 640 × 360 and low quality with the governor
//      acting;
//   7. key to screen (R-6): the sample-to-screen latency, p50 and p95, for
//      the owner's Q-10 judgment, beside the Practice specs' figures.
// - TERRIEST_FRAMES_SECONDS sets the window of the runs that don't play a
//   whole match (2, 4, 6 and 7), 90 s by default, and TERRIEST_FRAMES_PAGES
//   run 3's pages, 20 by default; a run made with fewer decides nothing.
// Every page is watched as the gate watches one: no console error, and no
// request outside the preview's origin (expectEverywhere).

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { availableParallelism, cpus, loadavg } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, type BrowserContextOptions, chromium, firefox, type Page, webkit } from '@playwright/test';
import type { BenchStatus, FrameParams, FrameReport } from '../src/frames';
import { CHROMIUM_GL_ARGS, GL_PATH } from './lib/gl';
import { expect, expectEverywhere, expectWebGL2, test, watchPage } from './lib/guards';
import { monotonicMs } from './lib/page';

type Engine = 'chromium' | 'firefox' | 'webkit';

const OUT = process.env.TERRIEST_FRAMES_OUT;
const QUIET = process.env.TERRIEST_FRAMES_QUIET !== '0';
const SECONDS = Number(process.env.TERRIEST_FRAMES_SECONDS ?? 90);
/** §8.4's run 3: 20 pages, a fresh one each, as M3's cap check repeated its repair (M3-Q14). */
const REPAIR_PAGES = Number(process.env.TERRIEST_FRAMES_PAGES ?? 20);
const REPAIR_PAGES_METHOD = 20; // not a setting: §8.4's
const ENGINES: readonly Engine[] = ['chromium', 'firefox', 'webkit'];
/** §8.4's quiet machine: the 1-minute load under this, then this long before a run starts. */
const LOAD_QUIET = 1; // not a setting: §8.4's
const QUIET_AFTER_MS = 8 * 60_000; // not a setting: §8.4's
const LOAD_POLL_MS = 15_000; // not a setting
/** A whole match: warm-up, the 3 minutes, each goal's celebration and the end's confirmation, and margin. */
const MATCH_MS = 8 * 60_000; // not a setting
const POLL_MS = 500; // not a setting: the report's polls, never on animation frames (C-6)
/** The Pixel 8a held sideways, as Pre-match and Match want a phone (D-30, L170): its CSS size and ratio. */
const PIXEL_8A: BrowserContextOptions = { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true };
const SMALL: BrowserContextOptions = { viewport: { width: 640, height: 360 } };
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 720 } };
const HELD_FRAMES_MS = [33, 50, 67, 100] as const; // not a setting: §8.4's run 6
const STANDIN = fileURLToPath(new URL('../scripts/make-standin.mjs', import.meta.url));

function launch(engine: Engine): Promise<Browser> {
  if (engine === 'chromium') return chromium.launch(CHROMIUM_GL_ARGS.length > 0 ? { args: [...CHROMIUM_GL_ARGS] } : {});
  return engine === 'firefox' ? firefox.launch() : webkit.launch();
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, Math.max(0, ms)));

/** Refuses at once without TERRIEST_FRAMES_OUT, before any page opens. */
function out(): string {
  if (OUT === undefined || OUT === '') {
    throw new Error('Refusing to run without TERRIEST_FRAMES_OUT: set it to the file each run appends its JSON lines to');
  }
  const file = resolve(OUT);
  mkdirSync(dirname(file), { recursive: true });
  return file;
}

/** The quiet rule's wait, before a run's first page: the load under 1, then 8 more minutes (§8.4). */
async function quietly(): Promise<{ readonly waited: boolean; readonly underAt: string | null; readonly startedAt: string }> {
  if (!QUIET) return { waited: false, underAt: null, startedAt: new Date().toISOString() };
  while (loadavg()[0]! >= LOAD_QUIET) await sleep(LOAD_POLL_MS);
  const underAt = new Date().toISOString();
  await sleep(QUIET_AFTER_MS);
  return { waited: true, underAt, startedAt: new Date().toISOString() };
}

/** The stand-in's bytes, scripts/make-standin.mjs's, when phase 3 has made it; null until then. */
async function standin(): Promise<Uint8Array | null> {
  if (!existsSync(STANDIN)) return null;
  const path = STANDIN;
  const mod = (await import(path)) as { makeStandin: () => Uint8Array };
  return mod.makeStandin();
}

interface PageRun {
  readonly label: string;
  readonly engine: Engine;
  readonly params: Readonly<Record<string, string | number>>;
  readonly context: BrowserContextOptions;
  readonly throttle?: number;
  readonly model?: Uint8Array;
}

/** The bench's status through its hook, polled while it measures: null until its match is open. */
function benchStatus(page: Page): Promise<BenchStatus | null> {
  return page.evaluate(() => window.terriestTest?.bench?.status() ?? null);
}

/** One page of a run: the bench opened with its parameters, its report awaited, and its line. */
async function onePage(browser: Browser, base: string, run: PageRun, timeoutMs: number): Promise<Record<string, unknown>> {
  const context = await browser.newContext(run.context);
  try {
    const page = await context.newPage();
    const watch = await watchPage(page, [base]);
    await expectWebGL2(page);
    await page.addInitScript(() => {
      window.terriestTest = {};
    });
    if (run.model !== undefined) {
      const body = Buffer.from(run.model);
      await page.route('**/standin.glb', (route) => route.fulfill({ status: 200, contentType: 'model/gltf-binary', body }));
    }
    if (run.throttle !== undefined) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: run.throttle });
    }
    const query = new URLSearchParams([['test', 'frames']]);
    for (const [k, v] of Object.entries(run.params)) query.set(k, String(v));
    const before = loadavg();
    // The deadline and the line's time on the monotonic clock: Date.now() can step a second ahead (phase 2b's
    // review, specs-F10).
    const from = monotonicMs();
    await page.goto(`${base}#${query.toString()}`);
    for (;;) {
      const s = await benchStatus(page);
      if (s?.done === true) break;
      if (monotonicMs() - from > timeoutMs) throw new Error(`${run.label}: no report within ${timeoutMs / 1000} s: ${JSON.stringify(s)}`);
      await sleep(POLL_MS);
    }
    const r = (await page.evaluate(() => window.terriestTest!.bench!.report())) as FrameReport;
    const after = loadavg();
    expectEverywhere(watch);
    console.log(
      `${run.label}: ${r.verdict} (${r.why}); frames ${r.frames.count}, work ${r.frames.work.mean.toFixed(2)} ms mean; ` +
        `timer ${r.timer.cost.mean.toFixed(2)} ms mean, ${r.timer.cost.p95.toFixed(2)} p95, gaps ${r.timer.gapMaxMs.toFixed(0)} ms max; ` +
        `skipped ${r.own.skipped} of ${r.own.ticks}; samples ${r.clock.samples}, ${r.clock.dropped} dropped; governor ${r.governor.actions}; ` +
        `latency ${r.latency.p50.toFixed(0)}/${r.latency.p95.toFixed(0)} ms${r.repair === null ? '' : `; repair: adopt ${r.repair.adoptMs?.toFixed(2) ?? '-'} ms, worst ${r.repair.worstMs.toFixed(2)} ms`}; ` +
        `load ${before[0]!.toFixed(2)} to ${after[0]!.toFixed(2)}`,
    );
    return {
      label: run.label, engine: run.engine, browser: browser.version(), params: run.params, context: run.context, throttle: run.throttle ?? 1,
      gl: GL_PATH, load: { before, after }, ms: monotonicMs() - from, report: r,
    };
  } finally {
    await context.close();
  }
}

type Quiet = Awaited<ReturnType<typeof quietly>>;

/** A line of a run, with the machine and whether it waited by the quiet rule, and so decides. */
function append(n: number, title: string, quiet: Quiet, line: Record<string, unknown>, decides = quiet.waited): void {
  const machine = { cpu: cpus()[0]?.model ?? null, cores: availableParallelism(), node: process.version };
  appendFileSync(out(), `${JSON.stringify({ run: n, title, utc: new Date().toISOString(), ...machine, quiet, decides, ...line })}\n`);
}

/** A run's pages, one after another, the quiet rule's wait first, each line appended as it's done; a line
 *  decides only if the run waited, and `decides` doesn't say otherwise. */
async function runPages(n: number, title: string, base: string, pages: readonly PageRun[], o: { readonly decides?: boolean } = {}): Promise<Quiet> {
  out();
  const quiet = await quietly();
  const browsers = new Map<Engine, Browser>();
  try {
    for (const p of pages) {
      let b = browsers.get(p.engine);
      if (b === undefined) {
        b = await launch(p.engine);
        browsers.set(p.engine, b);
      }
      append(n, title, quiet, await onePage(b, base, p, MATCH_MS), quiet.waited && (o.decides ?? true));
    }
  } finally {
    for (const b of browsers.values()) await b.close();
  }
  return quiet;
}

/** A line saying why a page of a run was skipped. */
function skipped(n: number, title: string, label: string, why: string): void {
  appendFileSync(out(), `${JSON.stringify({ run: n, title, utc: new Date().toISOString(), label, skipped: why })}\n`);
  console.log(`${label}: skipped, ${why}`);
}

/** The parameters a page passes, by the page's own names. */
const params = (o: Partial<Record<keyof FrameParams, string | number>>): Readonly<Record<string, string | number>> => o;

test.beforeEach(() => {
  expect(SECONDS > 0, `TERRIEST_FRAMES_SECONDS ${process.env.TERRIEST_FRAMES_SECONDS} isn't a number of seconds`).toBe(true);
  expect(Number.isInteger(REPAIR_PAGES) && REPAIR_PAGES > 0, `TERRIEST_FRAMES_PAGES ${process.env.TERRIEST_FRAMES_PAGES} isn't a count of pages`).toBe(true);
});

test('run 1: the frame-time run (L286), a whole match in each engine, code-built and with the stand-in', async ({ baseURL }) => {
  out();
  const model = await standin();
  const pages: PageRun[] = ENGINES.map((engine) => ({ label: `run 1: ${engine}, code-built`, engine, params: params({}), context: DESKTOP }));
  if (model !== null) for (const engine of ENGINES) pages.push({ label: `run 1: ${engine}, the stand-in`, engine, params: params({ model: 'standin.glb' }), context: DESKTOP, model });
  else for (const engine of ENGINES) skipped(1, 'the frame-time run', `run 1: ${engine}, the stand-in`, 'scripts/make-standin.mjs comes with phase 3');
  await runPages(1, 'the frame-time run', baseURL!, pages);
});

test("run 2: the CPU figures at the Pixel 8a's size in Chromium, at 1× and 4× CPU throttle", async ({ baseURL }) => {
  out();
  await runPages(2, 'the CPU figures', baseURL!, [1, 4].map((throttle) => ({
    label: `run 2: chromium at ${throttle}× throttle`, engine: 'chromium' as const, params: params({ seconds: SECONDS }), context: PIXEL_8A, throttle,
  })));
});

test('run 3: the forced repair (M3-Q14), the witness in its Worker, at 4× throttle in Chromium, 20 pages', async ({ baseURL }) => {
  out();
  const pages = Array.from({ length: REPAIR_PAGES }, (_, k) => ({
    label: `run 3: repair ${k + 1} of ${REPAIR_PAGES}`, engine: 'chromium' as const, params: params({ repair: 1, seconds: 60 }), context: SMALL, throttle: 4,
  }));
  await runPages(3, 'the forced repair', baseURL!, pages, { decides: REPAIR_PAGES >= REPAIR_PAGES_METHOD });
});

test("run 4: the timers' cadence with real frames (D-15, D-31), each engine at both qualities", async ({ baseURL }) => {
  out();
  await runPages(4, "the timers' cadence", baseURL!, ENGINES.flatMap((engine) => (['high', 'low'] as const).map((quality) => ({
    label: `run 4: ${engine}, ${quality} quality`, engine, params: params({ quality, seconds: SECONDS }), context: DESKTOP,
  }))));
});

test("run 5: the glide's check (D-16, §2.3), the corrections' sizes over a whole match", async ({ baseURL }) => {
  out();
  await runPages(5, "the glide's check", baseURL!, [{ label: 'run 5: chromium', engine: 'chromium', params: params({}), context: DESKTOP }]);
});

test('run 6: the slow-frame share (§8.1, M4-Q6), frames held in Chromium, then the three engines at once with the governor acting', async ({ baseURL }) => {
  const quiet = await runPages(6, 'the slow-frame share', baseURL!, HELD_FRAMES_MS.map((frameMs) => ({
    label: `run 6: chromium, frames held to ${frameMs} ms`, engine: 'chromium' as const, params: params({ frameMs, seconds: SECONDS }), context: DESKTOP,
  })));
  // The three engines at once, as the screens' match draws: 640 × 360, low quality.
  const browsers = await Promise.all(ENGINES.map(launch));
  try {
    const lines = await Promise.all(ENGINES.map((engine, k) => onePage(browsers[k]!, baseURL!, {
      label: `run 6: ${engine}, the three at once`, engine, params: params({ quality: 'low', seconds: SECONDS }), context: SMALL,
    }, MATCH_MS)));
    for (const line of lines) append(6, 'the slow-frame share', quiet, { together: true, ...line });
  } finally {
    for (const b of browsers) await b.close();
  }
});

test('run 7: key to screen (R-6), the sample-to-screen latency', async ({ baseURL }) => {
  out();
  await runPages(7, 'key to screen', baseURL!, [{ label: 'run 7: chromium', engine: 'chromium', params: params({ seconds: SECONDS }), context: DESKTOP }]);
});
