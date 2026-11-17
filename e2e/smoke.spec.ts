// The built page loads in every engine (PLAN §16): WebGL 2 first (C-6),
// then the page draws its frame and runs on for a second, with no console
// error and no request outside the server it was loaded from ("Everywhere",
// checked by the guard as each test ends). It loads from `vite preview`,
// and again under dist/_headers as terriest.com serves it (D-35), so the
// shipped policy blocks nothing the page needs.

import { startServer, type Server } from './lib/serve.mjs';
import { expect, expectWebGL2, test } from './lib/guards';

let strict: Server;
test.beforeAll(async () => {
  strict = await startServer();
});
test.afterAll(async () => {
  await strict?.close();
});

for (const served of ['vite preview', 'dist/_headers'] as const) {
  test(`the page draws a frame, served by ${served}`, async ({ page, baseURL, guard }) => {
    await expectWebGL2(page);
    const base = served === 'vite preview' ? baseURL! : strict.url;
    guard.allowed = [base];
    const response = await page.goto(base);
    if (served === 'dist/_headers') expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
    await expect(page).toHaveTitle('terriest');
    await expect(page.locator('html')).toHaveAttribute('data-drawn', '1');
    await expect(page.locator('#fallback')).toHaveCount(0);
    // An error from after the first frame (a frame loop, a timer) reaches
    // the guard if it comes within this second.
    await page.waitForTimeout(1_000);
  });
}
