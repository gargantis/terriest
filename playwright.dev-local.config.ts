import { defineConfig } from '@playwright/test';

// The provisional settle of the owner's desktop connection (M3's design
// §15, M3-Q4, §1.38), outside the gate: npm run dev:local, the dev server
// with hermet's local relay, and its #test=net page in headless Chromium and
// Firefox, on C-6's GPU path:
//   GALLIUM_DRIVER=d3d12 npx playwright test -c playwright.dev-local.config.ts
// e2e/dev-local.run.ts says what it checks. The dev server takes a port of
// its own, so a gate's server (4339) can't collide with it. The relay's port
// is whichever was free, and dev:local prints it first: the wait reads it
// into TERRIEST_DEV_RELAY_PORT for the run, and ends at Vite's own line, once
// the server listens. Teardown sends SIGTERM, on which dev:local stops Vite
// and closes the relay. Named .run.ts, so the gate's playwright.config.ts,
// which matches *.spec.ts, never runs it.
const PORT = 4359;

export default defineConfig({
  testDir: './e2e',
  testMatch: /dev-local\.run\.ts$/,
  forbidOnly: true,
  timeout: 12 * 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  webServer: {
    command: `npm run dev:local -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    wait: { stdout: new RegExp(`the local relay is on 127\\.0\\.0\\.1:(?<terriest_dev_relay_port>\\d+)[\\s\\S]*Local:\\s+http://127\\.0\\.0\\.1:${PORT}/`) },
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
  use: { baseURL: `http://127.0.0.1:${PORT}/`, headless: true },
});
