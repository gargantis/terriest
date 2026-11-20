import { defineConfig } from '@playwright/test';

// The 12-page load run (M3's design §8.5, §1.38), outside the gate: it
// takes minutes, and needs a quiet machine. Start it with the 1-minute load
// under 1 and nothing else running, and on WSL2 with the Windows side idle
// too, since WSL2's load doesn't see Windows'. On a busy machine the rig's
// message path can fail it rather than the protocol, as it did in M3's
// measurement; the backlog watch says whether that path fell behind before
// any input came late, or that it can't tell (dev/load/backlog.ts). A cold
// first run may show transient late inputs, disagreements and resyncs and
// still pass, its backlog flat, as the first of M3's A/B runs did
// (research/corrections/REPORT.md section 2.7). Against the built page
// under vite preview, on a port of its own so a gate's server (4339) can't
// collide with it, and hermet's local relay, which the run starts:
//   npm run build && TERRIEST_LOAD_OUT=research/load/results.json npx playwright test -c playwright.load.config.ts
// LOAD_SECONDS sets the play measured, 90 s by default. e2e/load.run.ts
// says what it checks and logs. Named .run.ts, so the gate's
// playwright.config.ts, which matches *.spec.ts, never runs it.
const BASE_URL = 'http://127.0.0.1:4349/';

export default defineConfig({
  testDir: './e2e',
  testMatch: /load\.run\.ts$/,
  forbidOnly: true,
  timeout: 20 * 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  webServer: {
    command: 'npx vite preview --port 4349',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: { baseURL: BASE_URL, headless: true },
});
