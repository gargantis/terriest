// The frame-time bench's two smokes in the gate (M4's design,
// research/m4/DESIGN.md, §1.53, §9.3's frames row; M4-Q18), in Chromium,
// so the bench can't rot between milestones, as roslambo's frames spec ran
// in its gate; its measured runs are e2e/frames.run.ts's, outside it:
// - #test=frames&seconds=5: the bench plays the real pitch screen, stage and
//   NetGame over its room and reports: eight terriers in, a window of 5 s
//   with frames, timer runs, TICKs and clock samples in it, no verdict for a
//   cut-short window, its own landmark and no #app, and no Trystero or
//   witness chunk requested;
// - repair=1 with a hold 1 s into play, once the room is calm: the
//   witness's module Worker, a chunk of its own, joins, and answers the
//   page's STATE_REQ with a real STATE, which the page adopts, its resync
//   done (M3-Q14);
// - frameMs=50: each frame held 50 ms from the window's opening, all eight
//   still in and the page's clock keeping real time, as run 6 needs
//   (§8.1, phase 2b's review, bench-F1);
// - a refused fragment: the page says so and contacts nothing, with no
//   hook, no stage and no bench chunk past its own (bench-F10).
// Each draws at 640 × 360 and low quality, the gate's (§9.1), and reads the
// bench's status through the hook, polled, never on animation frames
// (C-6), and its report once; the guard fails a console error or a request
// outside the preview's origin. Its timeouts come from phase 2b's measured
// runs, by e2e/lib/practice.ts's margins: a wait the machine's load
// lengthens, its worst × 3 + 2 s; one the page's clock sets, × 1.5 + 2 s; a
// whole test, × 2.

import type { Page } from '@playwright/test';
import type { BenchStatus, FrameReport } from '../src/frames';
import { expect, expectWebGL2, test } from './lib/guards';

test.skip(({ browserName }) => browserName !== 'chromium', "the bench's smokes run in Chromium (M4's design §9.3)");
test.use({ viewport: { width: 640, height: 360 } });

const POLL_MS = 250;
/** The 5 s bench from load to its report: at worst 7.9 s (load 1.5 to 7.1), the start and the eight's joins
 *  load-lengthened, so 3 × 7.9 + 2 = 25.7 s; the whole test at worst 7.9 s, but for a cold engine's start. */
const BENCH_DONE_MS = 26_000;
const BENCH_TEST_MS = 30_000;
/** The repair's: all eight in at worst 3.9 s from load (the start-up's stall in SwiftShader among it), 3 × 3.9
 *  + 2 = 13.7 s. The page's repair, from all eight in, on the page's clock: the start countdown and 1 s of play,
 *  8 s at worst; the hold's wait for a calm room, up to its 15 s (bench-F2; 0 to 4 s in phase 2b's review's
 *  runs); the 4.1 s hold and the repair, 1 s; 1.5 × 28.1 + 2 = 44.2 s. The whole test more than its waits and
 *  the start's together, so a wait fails first, with its status (bench-F2); it ran 15.7 to 19.6 s. */
const EIGHT_IN_MS = 14_000;
const REPAIRED_MS = 45_000;
const REPAIR_TEST_MS = 30_000 + EIGHT_IN_MS + REPAIRED_MS + 5_000;
/** The held frames' 5 s bench from load to its report: at worst 7.4 s in phase 2b's review's runs (load 1.4 to
 *  2.5), 3 × 7.4 + 2 = 24.2 s; the whole test as the 5 s bench's. */
const HELD_DONE_MS = 26_000;
const HELD_TEST_MS = 30_000;
/** A held frame's length, and how far below real time the window's ticks may fall: its clock keeps time but
 *  for following its peers' samples as they age from the window's opening, a tenth of a 5 s window in phase 2b's
 *  review's runs, where a task a message starved them and moved under half (bench-F1). */
const HELD_MS = 50;
const KEEPS_TIME = 0.8;

test.beforeEach(async ({ page }) => {
  await expectWebGL2(page);
  // The hook a spec sets before load, which the bench's report needs (CLAUDE.md's test hook).
  await page.addInitScript(() => {
    window.terriestTest = {};
  });
});

/** The bench's report, once: its figures worked out at the call. */
async function report(page: Page): Promise<FrameReport> {
  const r = await page.evaluate(() => window.terriestTest?.bench?.report() ?? null);
  if (r === null) throw new Error('no window.terriestTest.bench: the hook goes in before load, and the bench adds it once its match is open');
  return r;
}

/** Polls the bench's status until `until` holds of it, failing with it otherwise, then reads its report. */
async function waitForBench(page: Page, until: (s: BenchStatus) => boolean, what: string, timeoutMs: number): Promise<FrameReport> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const s = await page.evaluate(() => window.terriestTest?.bench?.status() ?? null);
    if (s !== null && until(s)) return report(page);
    if (s?.error) throw new Error(`${what}: the bench stopped: ${s.error}`);
    if (performance.now() > deadline) throw new Error(`${what}: not within ${timeoutMs / 1000} s: ${JSON.stringify(s)}`);
    await page.waitForTimeout(POLL_MS);
  }
}

/** Its own landmark, its heading and its stage, and no #app. */
async function expectBenchPage(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-boot', 'started', { timeout: 30_000 });
  const main = page.getByRole('main');
  await expect(main).toHaveCount(1);
  await expect(main).toHaveAttribute('id', 'frames');
  await expect(main.getByRole('heading', { level: 1, name: 'Frame-time bench' })).toHaveCount(1);
  await expect(page.locator('#app')).toHaveCount(0);
  await expect(page.locator('#stage canvas')).toHaveCount(1);
}

/** The scripts the page requested, by their chunks' names. */
const chunks = (requests: readonly string[]): string[] => requests.map((u) => new URL(u).pathname).filter((p) => p.endsWith('.js'));

test('#test=frames&seconds=5 plays and reports, eight terriers in, no error', async ({ page, guard }) => {
  test.setTimeout(BENCH_TEST_MS);
  await page.goto('./#test=frames&seconds=5&quality=low');
  await expectBenchPage(page);
  const r = await waitForBench(page, (x) => x.done, 'the 5 s bench', BENCH_DONE_MS);
  console.log(
    `the bench, 5 s: ${r.terriers} terriers, frames ${r.frames.count} (interval p50 ${r.frames.interval.p50.toFixed(1)}, ` +
      `max ${r.frames.interval.max.toFixed(1)} ms), timer runs ${r.timer.runs} (${r.timer.cost.mean.toFixed(2)} ms mean, gaps ${r.timer.gapMaxMs.toFixed(0)} ms max), ` +
      `governor ${r.governor.actions}, room ${r.room.roomMs.p95PerTick.toFixed(3)} ms a tick at the p95; started ${r.startMs.started.toFixed(0)} ms, prepared ` +
      `${r.startMs.prepared?.toFixed(0) ?? '-'} ms`,
  );
  expect(r.error).toBe(null);
  expect(r.terriers).toBe(8);
  expect(r.window.endedBy).toBe('seconds');
  expect(r.window.seconds).toBeGreaterThanOrEqual(5);
  expect(r.window.toTick! - r.window.fromTick!).toBeGreaterThan(5 * 50);
  // It drew, its timer ran, the room's players sent and voted, and the page's clock took their samples.
  expect(r.frames.count).toBeGreaterThan(5);
  expect(r.frames.drawn).toBeGreaterThan(0);
  expect(r.timer.runs).toBeGreaterThan(100);
  expect(r.room.delivered.byKind['TICK']).toBeGreaterThan(7 * 5 * 50);
  expect(r.clock.samples).toBeGreaterThan(0);
  expect([r.stats.disagree, r.stats.resyncs]).toEqual([0, 0]);
  expect(r.own).toMatchObject({ senders: 1 });
  expect(r.room.witness).toBe('none');
  expect(r.repair).toBe(null);
  // No verdict for a window cut short of Results (L286, M4-Q17).
  expect(r.verdict).toBe('none');
  expect(r.why).toMatch(/not at Results/);
  expect(r.render.quality).toBe('low');
  expect(r.render.compiledInPlay).toBe(false);
  // Its chunks: the page's and the bench's, never Trystero's nor the witness's (L238).
  const scripts = chunks(guard.requests);
  expect(scripts.some((p) => /\/frames-[\w-]+\.js$/.test(p)), scripts.join(', ')).toBe(true);
  expect(scripts.filter((p) => /\/(trystero|witness)-[\w-]+\.js$/.test(p))).toEqual([]);
  await expect(page.locator('#frames pre')).toContainText('Frame-time bench: no verdict');
  // And beside the verdict, for a person without the hook, what compiled in play (§2.11, bench-F9).
  await expect(page.locator('#frames pre')).toContainText(
    `Drawing: ${r.render.atStart!.programs} programs, ${r.render.atStart!.geometries} geometries, ${r.render.atStart!.textures} textures as the window opened`,
  );
  await expect(page.locator('#frames pre')).toContainText('nothing compiled in play');
});

test("repair=1 with a hold 1 s into play: the witness's Worker answers the page's STATE_REQ, and the page repairs from it (M4-Q18)", async ({ page, guard }) => {
  test.setTimeout(REPAIR_TEST_MS);
  await page.goto('./#test=frames&quality=low&repair=1&holdAt=1&seconds=40');
  await expectBenchPage(page);
  const all = await waitForBench(page, (x) => x.terriers === 8, 'all eight in, the witness among them', EIGHT_IN_MS);
  expect(all.room.peers.filter((p) => p.witness)).toHaveLength(1);
  // A resync done once the hold has begun: the forced one, whatever a transient did before it.
  const r = await waitForBench(
    page, (x) => x.resyncsAtHold !== null && x.resyncs > x.resyncsAtHold, "the page's repair from the witness's STATE", REPAIRED_MS,
  );
  const repair = r.repair!;
  console.log(
    `the forced repair: the STATE adopted in ${repair.adoptMs?.toFixed(2) ?? '-'} ms, the worst call ${repair.worstMs.toFixed(2)} ms for ` +
      `${repair.worstSteps} steps, from ${repair.back ?? '-'} ticks back, ${repair.calls.length} calls kept, ${r.stats.lateAbsent} inputs finalised absent first; ` +
      `the hold ${JSON.stringify(r.room.hold)}; the page asked ${JSON.stringify(r.room.asks.slice(0, 6))}, the witness sent ${JSON.stringify(r.room.states.slice(0, 6))}; ` +
      `the witness ${JSON.stringify(r.room.witnessFigures?.stats ?? null)} ${JSON.stringify(r.room.witnessFigures?.log.filter(([, e]) => !e.startsWith('late ')).slice(0, 30) ?? null)}`,
  );
  expect(r.room.witness).toBe('worker');
  expect(r.room.witnessError).toBe(null);
  expect(repair.witnessStates).toBeGreaterThanOrEqual(1);
  expect(r.stats.resyncs).toBeGreaterThanOrEqual(1);
  // From the hold: none before it, and a STATE inside the witness's 256-tick history, its depth logged; run 3
  // of e2e/frames.run.ts measures the forced repair's, about 240 ticks back (§2.11).
  expect(r.room.hold).toMatchObject({ resyncsBefore: 0 });
  expect(repair.back).toBeGreaterThan(0);
  expect(repair.back).toBeLessThanOrEqual(256 + 12 + 2);
  // The STATE's adoption is among the calls kept, timed apart, with its steps (M3-Q14).
  expect(repair.adoptMs).not.toBe(null);
  expect(repair.calls.some((c) => c.kind === 'STATE' && c.steps > 0)).toBe(true);
  expect(repair.calls.some((c) => c.kind === 'timer')).toBe(true);
  // The witness is a Worker of its own chunk, same-origin; no Trystero.
  const workers = page.workers().map((w) => new URL(w.url()));
  expect(workers.map((u) => u.pathname)).toEqual([expect.stringMatching(/\/witness-[\w-]+\.js$/)]);
  expect(workers[0]!.origin).toBe(new URL(page.url()).origin);
  expect(chunks(guard.requests).filter((p) => /\/trystero-[\w-]+\.js$/.test(p))).toEqual([]);
  // It began once the room was calm, or said it didn't (bench-F2).
  expect(r.room.hold!.armedMs).toBeLessThanOrEqual(r.room.hold!.fromMs);
  expect(r.room.hold!.repairedMs).not.toBe(null);
});

test('frameMs=50 holds each frame from the window on, all eight in, the clock keeping real time (§8.1, bench-F1)', async ({ page, guard }) => {
  test.setTimeout(HELD_TEST_MS);
  await page.goto(`./#test=frames&seconds=5&quality=low&frameMs=${HELD_MS}`);
  await expectBenchPage(page);
  const r = await waitForBench(page, (x) => x.done, 'the held frames, 5 s', HELD_DONE_MS);
  const ticks = r.window.seconds * 1000 / (1000 / 60);
  console.log(
    `the held frames, ${HELD_MS} ms: ${r.terriers} terriers, frames ${r.frames.count} (interval p50 ${r.frames.interval.p50.toFixed(1)} ms), ` +
      `moved ${r.own.ticks} of ${ticks.toFixed(0)} ticks in ${r.window.seconds.toFixed(2)} s, skipped ${r.own.skipped}, ` +
      `kept samples' age p50 ${r.clock.keptAgeMs.p50.toFixed(0)} ms, the backlog's largest ${Math.max(...r.room.backlog.map((b) => b.total))}`,
  );
  expect(r.error).toBe(null);
  expect(r.terriers).toBe(8);
  expect(r.window.endedBy).toBe('seconds');
  // Held: every frame at least its length; not governed.
  expect(r.frames.interval.p50).toBeGreaterThanOrEqual(HELD_MS - 1);
  expect(r.governor).toMatchObject({ governs: false, actions: 0, before: 0 });
  // Its clock kept real time: the ticks it moved are the window's, not a starved delivery's dragged-back clock's.
  expect(r.own.ticks).toBeGreaterThanOrEqual(KEEPS_TIME * ticks);
  expect(r.clock.keptAgeMs.p50).toBeLessThan(250);
  expect(r.verdict).toBe('none');
  expect(r.why).toMatch(/each frame was held to 50 ms/);
  expect(chunks(guard.requests).filter((p) => /\/(trystero|witness)-[\w-]+\.js$/.test(p))).toEqual([]);
});

test('a refused fragment says so and contacts nothing: no hook, no stage, no bench past its own chunk (bench-F10)', async ({ page, guard }) => {
  await page.goto(`./#test=frames&model=${encodeURIComponent('https://example.invalid/standin.glb')}`);
  await expect(page.locator('html')).toHaveAttribute('data-boot', 'started', { timeout: 30_000 });
  await expect(page.getByRole('main')).toHaveAttribute('id', 'frames');
  await expect(page.locator('#frames pre')).toHaveText(
    "The bench didn't start, and contacted nothing: model: a relative path on this page's origin, with no scheme, '//' or '..'.",
  );
  // Still none, a while later: nothing it started.
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.terriestTest !== undefined && window.terriestTest.bench === undefined)).toBe(true);
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('#app')).toHaveCount(0);
  expect(page.workers()).toEqual([]);
  const scripts = chunks(guard.requests);
  expect(scripts.some((p) => /\/frames-[\w-]+\.js$/.test(p)), scripts.join(', ')).toBe(true);
  expect(scripts.filter((p) => /\/(trystero|witness)-[\w-]+\.js$/.test(p))).toEqual([]);
  // Nothing but the preview's origin, which the guard holds every request to (§16).
  const origin = new URL(page.url()).origin;
  expect(guard.requests.filter((u) => new URL(u).origin !== origin)).toEqual([]);
});
