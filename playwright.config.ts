import { defineConfig } from '@playwright/test';
import { CHROMIUM_GL_ARGS } from './e2e/lib/gl';

// PLAN §16 end to end, in Chromium, Firefox and WebKit, headless, against
// the built dist/ (the gate runs `npm run build` first). `vite preview`
// serves it; a spec that needs dist/_headers applied starts the strict
// server, e2e/lib/serve.mjs, on a free port. Networked specs from M3 use
// hermet's local Nostr relay, so the gate contacts nothing public.
//
// Each spec runs once in each engine's project, except a *.net.spec.ts,
// which launches one browser per engine itself (e2e/lib/browsers.ts, from
// roslambo) and so runs once, in `net`. The two patterns split every spec
// between them, so none is skipped unseen; a spec for one engine skips the
// others itself, and is reported skipped there. A test.only left in fails
// the run instead of shrinking the gate. Firefox draws WebGL only with
// DISPLAY or WAYLAND_DISPLAY set, so the gate runs under WSLg or xvfb-run
// (C-6). With GALLIUM_DRIVER set, Chromium takes ANGLE's GL flags, so all
// three engines draw on the GPU path (e2e/lib/gl.ts); unset, no engine
// gets a GL flag.
const BASE_URL = 'http://127.0.0.1:4339/';
const NET = /\.net\.spec\.ts$/;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  forbidOnly: true,
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  webServer: {
    command: 'npx vite preview',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: { baseURL: BASE_URL, headless: true },
  projects: [
    {
      name: 'chromium',
      testIgnore: NET,
      use: { browserName: 'chromium', ...(CHROMIUM_GL_ARGS.length > 0 ? { launchOptions: { args: [...CHROMIUM_GL_ARGS] } } : {}) },
    },
    { name: 'firefox', testIgnore: NET, use: { browserName: 'firefox' } },
    { name: 'webkit', testIgnore: NET, use: { browserName: 'webkit' } },
    { name: 'net', testMatch: NET },
  ],
});
