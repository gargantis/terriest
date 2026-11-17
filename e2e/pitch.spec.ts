// The empty pitch (PLAN §12, §17 M1) in each engine, read through the test
// hook (window.terriestTest), after asserting WebGL 2 (C-6). The gate draws
// at the low render quality, as it plays (C-6, D-33); the quality test
// loads both. Nothing here depends on the frame rate: the rate is measured
// and reported for CI's first run (§15), never judged.

import { expect, expectWebGL2, test } from './lib/guards';
import { expectStarted, inspect, installHook } from './lib/page';
import { decodePng, meanColour } from './lib/png';

test.beforeEach(async ({ page }) => {
  await expectWebGL2(page);
  await installHook(page);
});

test('the pitch draws, and nothing compiles after its first frame', async ({ page }) => {
  await page.goto('./?quality=low');
  await expectStarted(page);
  const first = (await inspect(page)).render;
  expect(first.quality).toBe('low');
  expect(first.frames).toBeGreaterThanOrEqual(1);
  expect(first.calls).toBeGreaterThan(0);
  expect(first.triangles).toBeGreaterThan(0);
  // A second of frames compiles and uploads nothing new (§12).
  await page.waitForTimeout(1_000);
  const later = (await inspect(page)).render;
  expect(later.frames).toBeGreaterThan(first.frames);
  const kept = (r: typeof first): number[] => [r.programs, r.geometries, r.textures];
  expect(kept(later), 'programs, geometries, textures').toEqual(kept(first));

  // What it drew: from the spectators' side, pack A's half on the left and
  // pack B's on the right, each tinted by its pack (L68): blue, orange.
  const image = decodePng(await page.screenshot());
  const left = meanColour(image, image.width * 0.3, image.height * 0.55, 12);
  const right = meanColour(image, image.width * 0.7, image.height * 0.55, 12);
  const at = `left half ${left.map(Math.round).join(', ')}, right half ${right.map(Math.round).join(', ')}`;
  expect(Math.min(left[1], right[1]), `lit grass: ${at}`).toBeGreaterThan(100);
  expect(left[2] - right[2], `pack A's half is the bluer: ${at}`).toBeGreaterThan(30);
  expect(right[0] - left[0], `pack B's half is the redder: ${at}`).toBeGreaterThan(30);
});

test('the canvas fills the window, and redraws at a new size', async ({ page }) => {
  await page.goto('./?quality=low');
  await expectStarted(page);
  for (const [width, height] of [[480, 800], [1600, 500]] as const) {
    await page.setViewportSize({ width, height });
    await expect.poll(async () => {
      const r = (await inspect(page)).render;
      return [r.width, r.height];
    }).toEqual([width, height]);
    expect(await page.locator('canvas').boundingBox()).toEqual({ x: 0, y: 0, width, height });
    const frames = (await inspect(page)).render.frames;
    await expect.poll(async () => (await inspect(page)).render.frames).toBeGreaterThan(frames);
  }
});

test("the empty pitch's frame rate, reported, not judged", async ({ page, browserName }, testInfo) => {
  await page.goto('./?quality=low');
  await expectStarted(page);
  await page.waitForTimeout(500);
  const sample = (): Promise<{ at: number; frames: number }> =>
    page.evaluate(() => ({ at: performance.now(), frames: window.terriestTest!.inspect!().render.frames }));
  const a = await sample();
  await page.waitForTimeout(3_000);
  const b = await sample();
  const seconds = (b.at - a.at) / 1000;
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl ? String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none';
  });
  const size = page.viewportSize();
  const line =
    `${browserName}: ${((b.frames - a.frames) / seconds).toFixed(1)} frames a second over ${seconds.toFixed(1)} s, ` +
    `low quality, ${size?.width}×${size?.height}, ${renderer}`;
  console.log(`The empty pitch's frame rate, ${line}`);
  testInfo.annotations.push({ type: 'frame rate', description: line });
});

test.describe('the render quality (D-33)', () => {
  test.use({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 3 });

  test('high caps the pixel ratio at 2, with MSAA, and is the default; low caps it at 1, without', async ({ page }) => {
    const loads = [
      { query: '?quality=low', quality: 'low', ratio: 1 },
      { query: '?quality=high', quality: 'high', ratio: 2 },
      { query: '', quality: 'high', ratio: 2 },
    ] as const;
    const lines: number[] = [];
    for (const load of loads) {
      await page.goto(`./${load.query}`);
      await expectStarted(page);
      const r = (await inspect(page)).render;
      const what = load.query || 'no parameter';
      expect(r.quality, what).toBe(load.quality);
      expect(r.pixelRatio, what).toBe(load.ratio);
      expect([r.width, r.height], what).toEqual([640 * load.ratio, 360 * load.ratio]);
      if (load.quality === 'low') expect(r.samples, what).toBe(0);
      else expect(r.samples, what).toBeGreaterThan(0);
      lines.push(r.lines);
    }
    // Low draws the nets with fewer ropes.
    expect(lines[0]).toBeLessThan(lines[1]!);
  });
});
