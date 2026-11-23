import { defineConfig } from '@playwright/test';
import { CHROMIUM_GL_ARGS } from './e2e/lib/gl';

// The logo's run, outside the gate (the owner's pick of 2026-11-22, PLAN's
// status): e2e/logo.run.ts builds dev/logo.html, draws the picks in
// headless Chromium, on C-6's GPU path while GALLIUM_DRIVER is set
// (e2e/lib/gl.ts), and writes the files to the folder TERRIEST_LOGO_OUT
// names, refusing without it:
//   GALLIUM_DRIVER=d3d12 TERRIEST_LOGO_OUT="$(mktemp -d)" npx playwright test -c playwright.logo.config.ts
// No server and no port: the run answers the page's requests itself. Named
// .run.ts, so the gate's playwright.config.ts, which matches *.spec.ts,
// never runs it.
export default defineConfig({
  testDir: './e2e',
  testMatch: /logo\.run\.ts$/,
  forbidOnly: true,
  timeout: 15 * 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { browserName: 'chromium', headless: true, ...(CHROMIUM_GL_ARGS.length > 0 ? { launchOptions: { args: [...CHROMIUM_GL_ARGS] } } : {}) },
});
