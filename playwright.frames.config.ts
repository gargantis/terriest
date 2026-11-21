import { defineConfig } from '@playwright/test';

// The frame-time bench's runs outside the gate (M4's design,
// research/m4/DESIGN.md, §8.4; PLAN §16's frame-time run, L286, M3-Q14,
// D-15, D-16, R-6): e2e/frames.run.ts, runs 1 to 7, each its own test, so
// one is picked by its title. Against the built page under vite preview, on
// a port of its own so a gate's server (4339) and the load run's (4349)
// can't collide with it:
//   npm run build && TERRIEST_FRAMES_OUT=<file> npx playwright test -c playwright.frames.config.ts -g "run 4:"
// Each run appends a JSON line to the file TERRIEST_FRAMES_OUT names, and
// refuses without it, so nothing lands in the repo by accident;
// docs/acceptance.md takes the figures. On a quiet machine, as M3's load
// run (§8.4): each run first waits until the 1-minute load has fallen
// under 1 and 8 more minutes have passed, and its lines record the load
// before and after each page; TERRIEST_FRAMES_QUIET=0 skips the wait, and
// its lines then decide nothing. On C-6's GPU path where the run asks it,
// with GALLIUM_DRIVER set (e2e/lib/gl.ts). Named .run.ts, so the gate's
// playwright.config.ts, which matches *.spec.ts, never runs it.
const BASE_URL = 'http://127.0.0.1:4348/';

export default defineConfig({
  testDir: './e2e',
  testMatch: /frames\.run\.ts$/,
  forbidOnly: true,
  timeout: 6 * 60 * 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  webServer: {
    command: 'npx vite preview --port 4348',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: { baseURL: BASE_URL, headless: true },
});
