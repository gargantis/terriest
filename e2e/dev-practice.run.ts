// Practice under npm run dev (M4's design, research/m4/DESIGN.md, §9.7 and
// §12's phase 1 exit; PLAN §16's Practice, P10), off the gate, so phase 1
// sees the dev path too:
//
//   npx playwright test -c playwright.dev-local.config.ts e2e/dev-practice.run.ts
//
// The config starts npm run dev:local, the dev server with its local relay,
// which Practice never contacts. In headless Chromium, the config's
// default, Practice plays through the screens to the bot's first confirmed
// goal as e2e/practice.spec.ts's whole match begins it (e2e/lib/
// practice.ts): the profile seeded with personId(7, 0) and low quality,
// Home, Practice, 1 a side, 1 minute, Start; Ready by Enter at tick 600; A
// held from the start countdown to a second of play; the bot's goal, shown
// on the HUD, with the hold and the Ready tick inside the latitudes the Node
// replays validated; nothing compiled after prepare(), no stall, no
// overtime; and nothing contacted but the dev server, its HMR socket among
// it. Under npm run dev the modules are unbundled, and the dev server may
// reload a page once at its first load as it optimises a dependency
// (docs/acceptance.md's M3 steps), so a page in a context of its own loads
// first and is closed, as e2e/dev-local.run.ts's is. Its line is
// `practice-measure {…}`, as the spec's are.

import { expect, expectWebGL2, test } from './lib/guards';
import { hudOf, smallViewport } from './lib/page';
import { expectBotFirst, expectNothingContacted, FIRST_GOAL_MS, PracticeRun, SHOWN_MS, WHOLE_ANCHOR, where } from './lib/practice';

test.use({ viewport: smallViewport });

/** The first page's load, the dev server transforming every module as it's asked: provisional, until phase
 *  1c's Measure step times it. */
const WARM_MS = 120_000;
/** The whole run: the first page, then Practice to its first goal (e2e/lib/practice.ts' timeouts); provisional. */
const DEV_TEST_MS = 6 * 60_000;

test("Practice plays through the screens to the bot's first confirmed goal on the dev server", async ({ browser, page, guard, baseURL }, testInfo) => {
  test.setTimeout(DEV_TEST_MS);
  const base = baseURL!;
  // Vite's client keeps a WebSocket to the dev server, its own, on the same host and port.
  const hmr = base.replace(/^http:/, 'ws:');
  guard.allowed = [base, hmr];
  const warm = await browser.newContext({ viewport: smallViewport });
  try {
    const first = await warm.newPage();
    await first.goto(base);
    await expect(first.locator('html')).toHaveAttribute('data-boot', 'started', { timeout: WARM_MS });
  } finally {
    await warm.close();
  }

  const run = new PracticeRun(page, testInfo, 'dev');
  await run.measured(async () => {
    await expectWebGL2(page);
    await run.load(base);
    await run.practice();
    await run.ready(WHOLE_ANCHOR);
    const goal = await run.until((i) => (i.match?.goals.length ?? 0) > 0, { what: "the bot's first confirmed goal", timeoutMs: FIRST_GOAL_MS });
    run.mark('firstGoal');
    expect(run.held, `A held at the first goal's latch: no validated run is; ${where(goal)}`).toBe(false);
    await run.stopHolding();
    const shown = await run.until((i) => (i.announcements?.goals.length ?? 0) > 0, { what: 'the HUD showing the first goal', timeoutMs: SHOWN_MS });
    expectBotFirst(shown);
    expect(hudOf(shown)?.score, "the HUD's score").toBe('0–1');
    run.expectPlayed(shown, null);
    await expectNothingContacted(page, guard, { origin: base, sockets: [hmr] });
  });
});
