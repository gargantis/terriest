// The pitch (PLAN §12, §17 M1; M4's design §9.3, M4-Q9) in each engine,
// read through the test hook (window.terriestTest), after asserting WebGL 2
// (C-6), and what assistive technology reads of it. No overview draws on
// Home now, so the pitch is read from Practice's Pre-match at 4 a side,
// from the player's ball view, at the gate's 640 × 360 and stored low
// quality, as every spec that plays draws (C-6, D-33); the quality test
// sets both through Home's Settings, a player's real choice (M4-Q4). Two
// tests, one load each (§9.9). Nothing here depends on the frame rate: the
// rate is measured and reported, with the GL path, never judged.

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

/** Pre-match drawing: the pitch ready and a few frames on it. */
function drawing(page: Page, after = 0): Promise<Inspection> {
  return waitForInspection(page, (i) => i.screen === 'prematch' && i.render.frames > after + 3, { what: 'Pre-match drawing' });
}

/** The median colour of small samples along a row, so a terrier or the ball in one of them changes nothing. */
function median(image: Image, fy: number, xs: readonly number[]): [number, number, number] {
  const samples = xs.map((fx) => meanColour(image, image.width * fx, image.height * fy, 3));
  const mid = (k: number): number => samples.map((c) => c[k]!).sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
  return [mid(0), mid(1), mid(2)];
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
  await seedStorage(page, { profile: { playerId: personId(7, 0) }, settings: { quality: 'low' } });
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

  // The one landmark, the app's, with the pitch a named image in it (M4-Q1), and axe (§5.14).
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveAttribute('id', 'app');
  await expect(page.getByRole('main').getByRole('img', { name: 'The pitch' })).toBeVisible();
  await expectAxeClean(page);

  // What it drew, from behind the player in pack A, which defends −x: its own half near, tinted blue,
  // and pack B's far, tinted orange (L68), each read off the medians of a row on the left, clear of
  // Pre-match's panel on the right and the gauges at the bottom.
  const shown = await inspect(page);
  const image = decodePng(await page.screenshot());
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
  console.log(`${browserName}: the frame loop's fallback acted ${frames.frames.actions} times (§1.47)`);

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
    await page.goto('./');
    await expectStarted(page);
    /** Practice's Pre-match at this quality, read, then Leave to Home. */
    const read = async (what: string): Promise<Inspection['render']> => {
      await openPractice(page, { packSize: 1, minutes: 1 });
      const r = (await drawing(page)).render;
      await expectFilled(page, r, smallViewport.width, smallViewport.height);
      await page.locator('[data-test="prematch-leave"]').click();
      await waitForScreen(page, 'home');
      expect(r.quality, what).toBe(r.cap === 2 ? 'high' : 'low');
      return r;
    };
    /** Home's Settings, the quality chosen, and Back: the stage re-created behind Home (§2.8). */
    const choose = async (quality: 'high' | 'low'): Promise<void> => {
      await page.locator('[data-test="settings"]').click();
      await waitForScreen(page, 'settings');
      await page.locator(`[data-test="quality-${quality}"]`).check();
      await expect(page.locator('[data-test="settings-message"]')).toHaveText('Saved.');
      await page.locator('[data-test="back"]').click();
      await waitForInspection(page, (i) => i.screen === 'home' && i.render.quality === quality, { what: `the ${quality} stage behind Home` });
    };

    const byDefault = await read('no setting');
    expect([byDefault.quality, byDefault.cap, byDefault.pixelRatio]).toEqual(['high', 2, 2]);
    expect(byDefault.samples).toBeGreaterThan(0);
    await choose('low');
    const low = await read('low');
    expect([low.cap, low.pixelRatio, low.samples]).toEqual([1, 1, 0]);
    // Low draws the nets with fewer ropes.
    expect(low.lines).toBeLessThan(byDefault.lines);
    await choose('high');
    const high = await read('high');
    expect([high.cap, high.pixelRatio]).toEqual([2, 2]);
    expect(high.samples).toBeGreaterThan(0);
    expect(low.lines).toBeLessThan(high.lines);
  });
});
