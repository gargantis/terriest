// The boot page's failures (PLAN D-30, §16), in each engine. Each test
// switches one thing off and checks its message: the code, the heading in
// the main landmark, focused, the app's canvas never made, and axe. All
// four run in every engine, because the engines differ here: on file://,
// Chromium and WebKit refuse the module script, while Firefox runs it,
// and it must then do nothing. Each first asserts that the engine has
// WebGL 2 (C-6), so a run without a display fails here at once, and the
// test that switches WebGL 2 off shows the switch did it, not the engine.

import type { Browser, Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { CHROMIUM_GL_ARGS } from './lib/gl';
import { expect, expectEverywhere, expectWebGL2, test, watchPage } from './lib/guards';
import { expectBootMessage, moduleScript, mountDist } from './lib/page';
import { DIST } from './lib/serve.mjs';

const escaped = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.beforeEach(async ({ page }) => {
  await expectWebGL2(page);
});

test('without WebGL 2, the page says so, and nothing else runs', async ({ page, browserName, playwright, baseURL }) => {
  // Chromium and Firefox switch WebGL 2 off at launch; WebKit has no
  // switch, so an init script hides it.
  let own: Browser | null = null;
  let target: Page = page;
  if (browserName === 'webkit') {
    await page.addInitScript(() => {
      const canvas = HTMLCanvasElement.prototype as unknown as { getContext(type: string, ...rest: unknown[]): unknown };
      const getContext = canvas.getContext;
      canvas.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return type === 'webgl2' ? null : getContext.call(this, type, ...rest);
      };
    });
  } else {
    own = await playwright[browserName].launch(
      browserName === 'chromium'
        ? { args: ['--disable-webgl2', ...CHROMIUM_GL_ARGS] }
        : { firefoxUserPrefs: { 'webgl.enable-webgl2': false } },
    );
    // A page of its own context: axe opens another page in it.
    target = await (await own.newContext()).newPage();
  }
  try {
    // The guard watches the test's own page; a launched browser's is watched here.
    const watch = own === null ? null : await watchPage(target, [baseURL!]);
    // Playwright's clock, running, so the load timeout can be passed at once below.
    await target.clock.install();
    await target.goto(baseURL!);
    await expectBootMessage(target, 'W', /^terriest needs WebGL 2$/);
    const webgl2 = await target.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null);
    expect(webgl2, 'WebGL 2 switched off').toBe(false);
    // The message stays (D-30): past the load timeout, it's still W's.
    await target.clock.fastForward(20_000);
    await expect(target.locator('html')).toHaveAttribute('data-boot', 'W');
    await expect(target.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(/^terriest needs WebGL 2$/);
    if (watch) expectEverywhere(watch);
  } finally {
    await own?.close();
  }
});

test('in an insecure context, the page says to use https or localhost', async ({ page, guard }) => {
  // http://insecure.test/ is answered from dist/ by interception (§16).
  const base = 'http://insecure.test/';
  guard.allowed = [base];
  await mountDist(page, base);
  await page.goto(base);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await expectBootMessage(page, 'S', /^terriest needs a secure connection$/);
  await expect(page.getByRole('main')).toContainText('http://localhost:8000/');
});

test('opened as a file, the page says how to serve it', async ({ page, guard, browserName }) => {
  const dir = `${pathToFileURL(DIST).href}/`;
  const module = escaped(new URL(await moduleScript(), dir).href);
  guard.allowed = [dir];
  // The engines' own errors as they refuse the module from file://.
  guard.allowedErrors = {
    chromium: [
      new RegExp(`Access to script at '${module}' from origin 'null' has been blocked by CORS policy: .*`),
      /Failed to load resource: net::ERR_FAILED/,
    ],
    firefox: [],
    webkit: [/(Failed to load resource: )?Origin null is not allowed by Access-Control-Allow-Origin\. Status code: 0/],
  }[browserName];
  await page.goto(`${dir}index.html`);
  await expectBootMessage(page, 'F', /^terriest can't run from a file$/);
  await expect(page.getByRole('main')).toContainText('http://localhost:8000/');
});

test('if the app never starts, the page says so after 20 s', async ({ page, baseURL, guard, browserName }) => {
  // The module refused as a content blocker would refuse it, and the
  // timer run on Playwright's clock, paused from before the load, so the
  // test needn't wait 20 s, the time is exact, and the page has no
  // test-only path.
  const at = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time: at });
  await page.clock.pauseAt(at);
  await page.route(new URL(await moduleScript(), baseURL).href, (route) => route.abort('blockedbyclient'));
  // Firefox warns and WebKit informs; only Chromium logs an error.
  guard.allowedErrors = browserName === 'chromium' ? [/Failed to load resource: net::ERR_BLOCKED_BY_CLIENT(\.Inspector)?/] : [];
  await page.goto(baseURL!);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-boot', 'loading');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Loading terriest…');
  await page.clock.fastForward(19_999);
  await expect(html).toHaveAttribute('data-boot', 'loading');
  await page.clock.fastForward(1);
  await expect(html).toHaveAttribute('data-boot', 'L');
  // axe runs on the page's timers, so the clock runs again.
  await page.clock.resume();
  await expectBootMessage(page, 'L', /^terriest is taking too long to start$/);
});
