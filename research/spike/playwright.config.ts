import { defineConfig } from '@playwright/test';

// The spike's page in Chromium, Firefox and WebKit, headless, against the
// production build, served by e2e/serve.mjs with public/_headers applied as
// terriest.com would apply it, the content security policy included (D-35).
// - The per-engine projects run M0's run 1 (determinism.spec.ts), the
//   scene's checks and the smoke test once in each engine.
// - `engines` holds the specs that launch their own browsers: run 4
//   (page.spec.ts, all three engines at once in one test) and run 3
//   (cost.spec.ts, Chromium throttled through the DevTools protocol).
// Each spec runs on its own too: npx playwright test e2e/<name>.spec.ts.
// Specs that need another policy or cross-origin isolation start their own
// server from e2e/serve.mjs on a free port. Firefox draws WebGL only with
// DISPLAY or WAYLAND_DISPLAY set (WSLg sets both); every engine draws in
// software unless GALLIUM_DRIVER=d3d12 is set.
const PORT = 4329;
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const PER_ENGINE = /(smoke|scene|determinism)\.spec\.ts/;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  webServer: {
    command: `npx vite build && node e2e/serve.mjs --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: { baseURL: BASE_URL, headless: true },
  projects: [
    { name: 'chromium', testMatch: PER_ENGINE, use: { browserName: 'chromium' } },
    { name: 'firefox', testMatch: PER_ENGINE, use: { browserName: 'firefox' } },
    { name: 'webkit', testMatch: PER_ENGINE, use: { browserName: 'webkit' } },
    { name: 'engines', testMatch: /(page|cost)\.spec\.ts/ },
  ],
});
