// The built page starts in every engine (PLAN §16; M4's design §9.3),
// served three ways:
// - by `vite preview`;
// - under dist/_headers, by the strict server, as terriest.com serves it
//   (D-35), so the shipped policy blocks nothing the page needs;
// - from a subpath, /a/b/ on the preview's own origin, answered from dist/
//   by interception with dist/_headers applied, and every request staying
//   under it (L232).
// Each asserts WebGL 2 first (C-6), loads the page as a visitor would, at
// the default render quality and the gate's small window, waits for it to
// start on Home, its heading focused, goes through Practice's setup to its
// Pre-match by keys,
// which draws the pitch (Home draws nothing, M4-Q9), and runs on for a
// second, so an error from the frame loop reaches the guard, which checks
// "Everywhere" as each test ends.

import { startServer, type Server } from './lib/serve.mjs';
import { expect, expectWebGL2, test } from './lib/guards';
import { expectStarted, inspect, installHook, mountDist, openPractice, smallViewport, waitForInspection } from './lib/page';

test.use({ viewport: smallViewport });

let strict: Server;
test.beforeAll(async () => {
  strict = await startServer();
});
test.afterAll(async () => {
  await strict?.close();
});

for (const served of ['vite preview', 'dist/_headers', 'a subpath'] as const) {
  test(`the page starts on Home and draws Practice's Pre-match, served by ${served}`, async ({ page, baseURL, guard }) => {
    await expectWebGL2(page);
    await installHook(page);
    const base = served === 'vite preview' ? baseURL! : served === 'dist/_headers' ? strict.url : new URL('a/b/', baseURL).href;
    guard.allowed = [base];
    if (served === 'a subpath') await mountDist(page, base);
    const response = await page.goto(base);
    if (served !== 'vite preview') expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
    await expect(page).toHaveTitle('terriest');
    await expectStarted(page);
    // Home, its heading focused as the landmark shows (Q-17, §5.1): read once, never waited for (§9.6).
    const focus = await page.evaluate(() => {
      const a = document.activeElement;
      return [a?.tagName, a?.textContent, a?.closest('main')?.id];
    });
    expect(focus, "Home's heading, focused as the app started").toEqual(['H1', 'terriest', 'app']);
    expect((await inspect(page)).screen).toBe('home');
    await openPractice(page, { packSize: 1, minutes: 1 });
    const { render } = await waitForInspection(page, (i) => i.render.frames > 0, { what: 'the pitch drawn' });
    expect(render.calls).toBeGreaterThan(0);
    expect(render.triangles).toBeGreaterThan(0);
    // An error from after the first frame (the frame loop, a timer) reaches
    // the guard if it comes within this second.
    await page.waitForTimeout(1_000);
    expect((await inspect(page)).render.frames).toBeGreaterThan(render.frames);
  });
}
