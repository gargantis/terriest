// The built page starts in every engine (PLAN §16), served three ways:
// - by `vite preview`;
// - under dist/_headers, by the strict server, as terriest.com serves it
//   (D-35), so the shipped policy blocks nothing the page needs;
// - from a subpath, /a/b/ on the preview's own origin, answered from dist/
//   by interception with dist/_headers applied, and every request staying
//   under it (L232).
// Each asserts WebGL 2 first (C-6), loads the page as a visitor would, at
// the default render quality, waits for it to start and draw, and runs on
// for a second, so an error from the frame loop reaches the guard, which
// checks "Everywhere" as each test ends.

import { startServer, type Server } from './lib/serve.mjs';
import { expect, expectWebGL2, test } from './lib/guards';
import { expectStarted, inspect, installHook, mountDist } from './lib/page';

let strict: Server;
test.beforeAll(async () => {
  strict = await startServer();
});
test.afterAll(async () => {
  await strict?.close();
});

for (const served of ['vite preview', 'dist/_headers', 'a subpath'] as const) {
  test(`the page starts and draws the pitch, served by ${served}`, async ({ page, baseURL, guard }) => {
    await expectWebGL2(page);
    await installHook(page);
    const base = served === 'vite preview' ? baseURL! : served === 'dist/_headers' ? strict.url : new URL('a/b/', baseURL).href;
    guard.allowed = [base];
    if (served === 'a subpath') await mountDist(page, base);
    const response = await page.goto(base);
    if (served !== 'vite preview') expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
    await expect(page).toHaveTitle('terriest');
    await expectStarted(page);
    const { render } = await inspect(page);
    expect(render.calls).toBeGreaterThan(0);
    expect(render.triangles).toBeGreaterThan(0);
    // An error from after the first frame (the frame loop, a timer) reaches
    // the guard if it comes within this second.
    await page.waitForTimeout(1_000);
    expect((await inspect(page)).render.frames).toBeGreaterThan(render.frames);
  });
}
