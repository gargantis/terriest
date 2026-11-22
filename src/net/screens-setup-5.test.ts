import { afterAll, describe, it, vi } from 'vitest';
import { expectScreens, playScreens, printScreens, type ScreensRun, screensName, screensRun } from './setups-testing';

// §9.4's setup over the loopback network, as e2e/match.screens.net.spec.ts
// plays it through the screens, continued from screens-setup-1.test.ts
// (M4's design, research/m4/DESIGN.md, §9.1, §9.2, §9.4, M4-Q36): seed 7,
// Ready at 630, e at 120, the reload away 5 s. One match a file, so no file
// runs much over 8 s alone (CLAUDE.md).

vi.setConfig({ testTimeout: 120_000 });

const run = screensRun(5);
const runs: ScreensRun[] = [];
afterAll(() => printScreens('screens-setup-5.test.ts', runs));

describe("§9.4's setup over the loopback, seed 7 (M4's design §9.2)", () => {
  it(`ends at 0:00 with pack A ahead: ${screensName(run)}`, () => {
    const r = playScreens(run);
    runs.push(r);
    expectScreens(r);
  });
});
