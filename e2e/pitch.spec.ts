// The pitch (PLAN §12, §17 M1; M4's design §9.3, M4-Q9) in each engine,
// read through the test hook (window.terriestTest), after asserting WebGL 2
// (C-6), and what assistive technology reads of it. No overview draws on
// Home now, so the pitch is read from Practice's Pre-match at 4 a side,
// from the player's ball view, at the gate's 640 × 360 and stored low
// quality, as every spec that plays draws (C-6, D-33); the quality test
// sets both through Home's Settings, a player's real choice (M4-Q4), each
// screen opening at its top, and changes it twenty times more, the page's
// WebGL contexts counted as it goes: a stage made at a change's first ask
// and the other kept while Home and Settings show, so twenty changes make
// one and the page never holds more than two, the unused one giving its
// context back as Practice opens (§2.8, phase 2b), and a Practice then
// drawn on the stage swapped back in. Each read checks the buffer by the
// governor's scale it reads (§9.1), and Leave keeps its place as Ready
// relabels (phase 2b's review). Two tests, one load
// each (§9.9). Nothing here depends on the frame rate: the rate is measured
// and reported, with the GL path, never judged. What's drawn is read off a
// capture taken at a steady drawing buffer: WebKit's capture of a WebGL
// canvas reads black just after the buffer is reallocated, as a resize or a
// step of the governor's scale reallocates it (§8.2), which phase 2b's Wire
// step saw once in the gate and measured off it.

import type { Page } from '@playwright/test';
import { personId } from '../src/core/bot/bot-id';
import type { Inspection } from '../src/main';
import { GL_PATH } from './lib/gl';
import { expect, expectWebGL2, test } from './lib/guards';
import {
  expectAxeClean, expectStarted, inspect, installHook, openPractice, overlayOf, seedStorage, smallViewport, waitForInspection, waitForScreen,
} from './lib/page';
import { decodePng, type Image, meanColour } from './lib/png';

test.use({ viewport: smallViewport });

test.beforeEach(async ({ page }) => {
  await expectWebGL2(page);
  await installHook(page);
});

/** The page's live WebGL contexts as expected: a context given back is lost at once, and phase 2b's review
 *  saw each count within 64 ms at worst, in each engine (load 1.4 to 2.5); 3 × 0.064 + 2 = 2.2 s, as
 *  e2e/lib/practice.ts' margins go for a wait that load lengthens (specs-F9). */
const CONTEXTS_MS = 2_500;

/** Pre-match drawing on the stage held: the pitch ready and a few frames on it past `after`, its frames on
 *  Home, since a stage counts its frames over its whole life and one kept off the pitch drew before (§2.8). */
function drawing(page: Page, after = 0): Promise<Inspection> {
  return waitForInspection(page, (i) => i.screen === 'prematch' && i.render.frames > after + 3, { what: 'Pre-match drawing' });
}

/** An element's box, by its data-test. */
async function boxOf(page: Page, test: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await page.locator(`[data-test="${test}"]`).boundingBox();
  if (b === null) throw new Error(`no box for ${test}`);
  return b;
}

/** The median colour of small samples along a row, so a terrier or the ball in one of them changes nothing. */
function median(image: Image, fy: number, xs: readonly number[]): [number, number, number] {
  const samples = xs.map((fx) => meanColour(image, image.width * fx, image.height * fy, 3));
  const mid = (k: number): number => samples.map((c) => c[k]!).sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
  return [mid(0), mid(1), mid(2)];
}

/** What has the focus, read once, and whether its whole box is inside the window: a screen opens at its top
 *  whatever the last left the page scrolled to (§5.14). */
function focusInView(page: Page): Promise<{ what: string; inView: boolean }> {
  return page.evaluate(() => {
    const a = document.activeElement!;
    const r = a.getBoundingClientRect();
    return { what: `${a.tagName.toLowerCase()} ${a.textContent ?? ''}`, inView: r.height > 0 && r.top >= 0 && r.bottom <= innerHeight };
  });
}

/** The WebGL contexts the page makes, counted before its scripts run: each context getContext hands back,
 *  once, and how many of them aren't lost, so a spec reads how many stages the page holds (§2.8). It only
 *  watches; Playwright sends its source, so it reads nothing from outside itself. */
function countContexts(): void {
  const made: { isContextLost(): boolean }[] = [];
  const get = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, ...a: unknown[]) => RenderingContext | null;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: unknown, ...rest: unknown[]) {
    const c = get.call(this, kind, ...rest);
    if (c !== null && (kind === 'webgl2' || kind === 'webgl') && !made.includes(c as WebGL2RenderingContext)) made.push(c as WebGL2RenderingContext);
    return c;
  } as typeof HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(window, 'terriestContexts', {
    value: () => ({ made: made.length, alive: made.filter((c) => !c.isContextLost()).length }),
  });
}

/** The page's WebGL contexts so far: made, and alive, not lost. */
function contexts(page: Page): Promise<{ made: number; alive: number }> {
  return page.evaluate(() => (window as unknown as { terriestContexts: () => { made: number; alive: number } }).terriestContexts());
}

/** The page captured, and the inspection read just before, at a steady drawing buffer: after a frame drawn at
 *  the size first read, and again if the size changed across the capture, since WebKit's capture just after a
 *  reallocation, by a resize or the governor's step (§8.2), reads the canvas black (phase 2b's Wire step, at 4
 *  a side: 14 of 30 captures at once after a resize read black, none of 30 taken this way). */
async function steadyCapture(page: Page): Promise<{ readonly image: Image; readonly shown: Inspection }> {
  const size = (i: Inspection): string => `${i.render.width}×${i.render.height}`;
  for (let k = 1; ; k++) {
    const before = await inspect(page);
    const shown = await waitForInspection(page, (i) => i.render.frames > before.render.frames, { what: 'a frame drawn before the capture' });
    const png = await page.screenshot();
    const after = await inspect(page);
    if (size(before) === size(shown) && size(shown) === size(after)) return { image: decodePng(png), shown };
    if (k === 5) throw new Error(`the drawing buffer changed size across ${k} captures, the last ${size(before)}, ${size(shown)}, ${size(after)}`);
  }
}

/** The drawing buffer by §9.1's rule: the CSS size times min(devicePixelRatio, cap) times the governor's scale. */
async function expectFilled(page: Page, r: Inspection['render'], width: number, height: number): Promise<void> {
  const dpr = await page.evaluate(() => devicePixelRatio);
  const ratio = Math.min(dpr, r.cap) * r.scale;
  expect([r.cssWidth, r.cssHeight]).toEqual([width, height]);
  expect([r.width, r.height]).toEqual([Math.round(width * ratio), Math.round(height * ratio)]);
}

test("Practice's Pre-match draws the pitch from the player's ball view, fills the window and compiles nothing after prepare", async ({ page, browserName }, testInfo) => {
  test.setTimeout(90_000);
  // A name as long as C-17 allows, of its widest letter.
  await seedStorage(page, { profile: { playerId: personId(7, 0), name: 'W'.repeat(20) }, settings: { quality: 'low' } });
  await page.goto('./');
  await expectStarted(page);
  // Home draws nothing: the stage's box is hidden off the pitch screens (M4-Q9).
  await expect(page.locator('#stage')).toBeHidden();
  await openPractice(page, { packSize: 4, minutes: 1 });
  const first = (await drawing(page)).render;
  expect(first.quality).toBe('low');
  expect(first.camera).toMatchObject({ kind: 'player', view: 'ball' });
  expect(first.calls).toBeGreaterThan(0);
  expect(first.triangles).toBeGreaterThan(0);

  // Each pack's list, the long name wrapping in its row, so every row's Ready, the bots' too, stays inside the
  // panel (L166; phase 2b's review, P3).
  await expect(page.locator('.prematch-pack li .ready')).toHaveCount(8);
  const rows = await page.evaluate(() => {
    const panel = document.querySelector('[data-test="prematch"]')!.getBoundingClientRect();
    return [...document.querySelectorAll('.prematch-pack li')].map((li) => {
      const r = li.querySelector('.ready')!.getBoundingClientRect();
      return { row: li.textContent, inside: r.left >= panel.left - 0.5 && r.right <= panel.right + 0.5 };
    });
  });
  expect(rows.filter((r) => !r.inside), "rows whose Ready runs past the panel's edge").toEqual([]);

  // The one landmark, the app's, with the pitch a named image in it (M4-Q1), and axe (§5.14).
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveAttribute('id', 'app');
  await expect(page.getByRole('main').getByRole('img', { name: 'The pitch' })).toBeVisible();
  await expectAxeClean(page);

  // What it drew, from behind the player in pack A, which defends −x: its own half near, tinted blue,
  // and pack B's far, tinted orange (L68), each read off the medians of a row on the left, clear of
  // Pre-match's panel on the right and the gauges at the bottom.
  const { image, shown } = await steadyCapture(page);
  const xs = [0.2, 0.25, 0.3, 0.35, 0.4];
  const near = median(image, 0.68, xs);
  const far = median(image, 0.505, xs);
  const at = `near half ${near.join(', ')}, far half ${far.join(', ')}`;
  expect(Math.min(near[1], far[1]), `lit grass: ${at}`).toBeGreaterThan(100);
  expect(near[2] - far[2], `pack A's near half is the bluer: ${at}`).toBeGreaterThan(30);
  expect(far[0] - near[0], `pack B's far half is the redder: ${at}`).toBeGreaterThan(30);
  // Your terrier, its seeded coat white, is drawn where the stage projects it, the point the overlay's
  // chevron is placed above (§1.45): the grass there would be the near half's.
  const mine = overlayOf(shown)?.mine ?? null;
  expect(mine?.shown, 'your terrier in view').toBe(true);
  const coat = meanColour(image, mine!.x, mine!.y, 2);
  expect(coat[0] - near[0], `your white terrier at its projected point, ${coat.map(Math.round).join(', ')}, against the grass's ${near.join(', ')}`)
    .toBeGreaterThan(60);

  // Every frame after prepare(), seconds of them, compiles and uploads nothing new (§12): the counts stay
  // as prepare() left them.
  await page.waitForTimeout(1_000);
  const later = (await inspect(page)).render;
  expect(later.frames).toBeGreaterThan(first.frames);
  const counts = (r: typeof first): object => ({ programs: r.programs, geometries: r.geometries, textures: r.textures });
  expect(later.firstFrame?.programs, 'programs compiled by prepare()').toBeGreaterThan(0);
  expect(counts(later), 'programs, geometries, textures').toEqual(later.firstFrame);

  // The frame rate, reported, not judged (§15): Chromium alone names its renderer.
  const sample = (): Promise<{ at: number; frames: number }> =>
    page.evaluate(() => ({ at: performance.now(), frames: window.terriestTest!.inspect!().render.frames }));
  const a = await sample();
  await page.waitForTimeout(3_000);
  const b = await sample();
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl ? String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none';
  });
  const named = browserName === 'chromium' ? `renderer ${renderer}` : `renderer masked by the engine as "${renderer}"`;
  const seconds = (b.at - a.at) / 1000;
  const line =
    `${browserName}: ${((b.frames - a.frames) / seconds).toFixed(1)} frames a second over ${seconds.toFixed(1)} s, ` +
    `Pre-match at 4 a side, low quality, ${smallViewport.width}×${smallViewport.height}, ${GL_PATH}, ${named}`;
  console.log(`The pitch's frame rate, ${line}`);
  testInfo.annotations.push({ type: 'frame rate', description: line });
  const frames = await inspect(page);
  console.log(`${browserName}: the governor acted ${frames.frames.actions} times (§1.47, §8.2)`);

  // The canvas fills the window, and redraws at a new size, by the scale rule (§9.1).
  for (const [width, height] of [[480, 800], [1600, 500]] as const) {
    await page.setViewportSize({ width, height });
    const r = (await waitForInspection(page, (i) => i.render.cssWidth === width && i.render.cssHeight === height, { what: `the canvas at ${width}×${height}` })).render;
    await expectFilled(page, r, width, height);
    expect(await page.locator('#stage canvas').boundingBox()).toEqual({ x: 0, y: 0, width, height });
    await waitForInspection(page, (i) => i.render.frames > r.frames, { what: 'a frame at the new size' });
  }
});

test.describe('the render quality, set through Home\'s Settings (D-33, M4-Q4)', () => {
  test.use({ viewport: smallViewport, deviceScaleFactor: 3 });

  test('high caps the pixel ratio at 2, with MSAA, and is the default; low caps it at 1, without, and draws the nets with fewer ropes', async ({ page }) => {
    test.setTimeout(120_000);
    // Chromium keeps 16 live WebGL contexts a page, and past them loses the oldest, saying so.
    const tooMany: string[] = [];
    page.on('console', (m) => {
      if (/too many active webgl contexts/i.test(m.text())) tooMany.push(m.text());
    });
    await page.addInitScript(countContexts);
    await page.goto('./');
    await expectStarted(page);
    /** The page's contexts, made and alive, once they're as expected: a context given back is lost at once,
     *  but the read polls, never on animation frames (C-6). */
    const held = async (made: number, alive: number, what: string): Promise<void> => {
      await expect.poll(() => contexts(page), { message: `the page's WebGL contexts ${what}`, timeout: CONTEXTS_MS }).toEqual({ made, alive });
    };
    await waitForScreen(page, 'home');
    await held(1, 1, 'on Home');
    const dpr = await page.evaluate(() => devicePixelRatio);
    /** Practice's Pre-match at this quality, read, then Leave to Home: drawing on the stage held, its frames
     *  counted from Home's, since a stage kept off the pitch drew before (§2.8, specs-F3); the other stage's
     *  context given back as the pitch opens, before Leave (specs-F5); the buffer and the pixel ratio by the
     *  governor's scale the read reports, which the governor may step on Pre-match's opening (§9.1, specs-F2),
     *  its actions logged; and Leave where it was from the screen's entry, as Ready relabels (P6). */
    const read = async (what: string, made: number): Promise<Inspection['render']> => {
      const home = (await inspect(page)).render.frames;
      await openPractice(page, { packSize: 1, minutes: 1 });
      const entry = { leave: await boxOf(page, 'prematch-leave'), ready: await page.locator('[data-test="ready"]').textContent() };
      const shown = await drawing(page, home);
      await held(made, 1, `with ${what}'s Practice opened: the other stage given back`);
      const r = shown.render;
      await expectFilled(page, r, smallViewport.width, smallViewport.height);
      expect(r.pixelRatio, `${what}: min(devicePixelRatio, cap) × the scale read`).toBeCloseTo(Math.min(dpr, r.cap) * r.scale, 6);
      console.log(`${what}: scale ${r.scale}, the governor acted ${shown.frames.actions} times, ${JSON.stringify(shown.frames.log)}`);
      // Leave once Ready can act; the relabel moves no button (P6), checked from the screen's entry.
      await expect(page.locator('[data-test="ready"]'), 'Ready, the person in the final roster').toHaveText('Ready');
      expect(await boxOf(page, 'prematch-leave'), `Leave where it was as Ready read "${entry.ready}"`).toEqual(entry.leave);
      await page.locator('[data-test="prematch-leave"]').click();
      await waitForScreen(page, 'home');
      expect(r.quality, what).toBe(r.cap === 2 ? 'high' : 'low');
      return r;
    };
    /** Home's Settings, the quality chosen, and Back: a stage at it behind Home (§2.8). The click scrolls Home
     *  down to its Settings at 640 × 360, and each screen still opens at its top, its heading in view. */
    const choose = async (quality: 'high' | 'low'): Promise<void> => {
      await page.locator('[data-test="settings"]').click();
      await waitForScreen(page, 'settings');
      expect(await focusInView(page), "Settings' heading, in view").toEqual({ what: 'h1 Settings', inView: true });
      await page.locator(`[data-test="quality-${quality}"]`).check();
      // Said where it's seen, though the status line sits at the screen's foot (P4).
      await expect(page.locator('[data-test="settings-message"]')).toHaveText('Saved.');
      await expect(page.locator('[data-test="settings-message"]')).toBeInViewport();
      await page.locator('[data-test="back"]').click();
      await waitForInspection(page, (i) => i.screen === 'home' && i.render.quality === quality, { what: `the ${quality} stage behind Home` });
      expect(await focusInView(page), "Home's heading, in view").toEqual({ what: 'h1 terriest', inView: true });
    };

    const byDefault = await read('no setting', 1);
    expect([byDefault.quality, byDefault.cap]).toEqual(['high', 2]);
    expect(byDefault.samples).toBeGreaterThan(0);
    await held(1, 1, 'after a Practice');
    // The first change makes a stage at low, the high one kept while Home and Settings show; Practice's
    // opening gives the unused one's context back.
    await choose('low');
    await held(2, 2, 'with low chosen on Home: the high stage kept');
    const low = await read('low', 2);
    await held(2, 1, "after low's Practice: the high stage given back");
    expect([low.cap, low.samples]).toEqual([1, 0]);
    // Low draws the nets with fewer ropes.
    expect(low.lines).toBeLessThan(byDefault.lines);
    await choose('high');
    await held(3, 2, 'with high chosen on Home: the low stage kept');
    const high = await read('high', 3);
    await held(3, 1, "after high's Practice: the low stage given back");
    expect(high.cap).toBe(2);
    expect(high.samples).toBeGreaterThan(0);
    expect(low.lines).toBeLessThan(high.lines);

    // A player changing their mind: twenty changes in a row on Settings, the first making a stage at low and
    // each after it swapping to the other kept, so the page never holds more than two, and never more than
    // the browser keeps (§2.8).
    await page.locator('[data-test="settings"]').click();
    await waitForScreen(page, 'settings');
    for (let k = 0; k < 20; k++) {
      const quality = k % 2 === 0 ? 'low' : 'high';
      await page.locator(`[data-test="quality-${quality}"]`).check();
      await waitForInspection(page, (i) => i.render.quality === quality, { what: `change ${k + 1}, to ${quality}` });
      const c = await contexts(page);
      expect(c.alive, `the page's live WebGL contexts at change ${k + 1}`).toBeLessThanOrEqual(2);
    }
    await page.locator('[data-test="back"]').click();
    await waitForInspection(page, (i) => i.screen === 'home' && i.render.prepared, { what: 'the last stage, prepared behind Home' });
    await held(4, 2, 'after twenty changes: one stage made for them, two kept');
    // And a Practice drawn on the stage the last change swapped back in, high's from before the changes, as a
    // player who changes their mind then plays draws on it (§2.8, specs-F3).
    const again = await read('high, swapped back in', 4);
    expect([again.quality, again.cap]).toEqual(['high', 2]);
    await held(4, 1, 'after it: the low stage given back');
    expect(tooMany, 'contexts kept past the browser\'s cap').toEqual([]);
  });
});
