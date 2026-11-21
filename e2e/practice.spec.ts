// Practice through the screens (PLAN §16's Practice, L73–L83, L238, P10,
// Q-15, Q-17; M4's design, research/m4/DESIGN.md, §9.1, §9.3, §9.5, §9.6,
// M4-Q36), as phase 1 builds it: the keyboard, the menu, the HUD's meter
// and pounce wait, your mark, the arrow, the bark marks and the whole
// match. Phase 2 adds the gamepad, the hints, Show control hints again, the
// network figures and Copy; phase 3 the stand-in, names and away marks.
// Every run plays seed 7's setup at the gate's 640 × 360 and stored low
// quality, as e2e/lib/practice.ts plays it: Ready by Enter at its anchor,
// A held from each countdown to a second of play, and the holds, the
// presses and the Ready tick checked inside the latitudes the Node replays
// validated (src/net/practice-spec-whole-1 to -6, practice-spec-goal-1 to
// -4), so a page too slow to stay in them fails saying so rather than with
// another match. Each look at the page fails at once on an overtime, a
// stall or anything compiled after prepare() (PLAN §12). Each run logs one
// line, `practice-measure {…}`, for phase 1c's Measure step.
// - The whole match, in Chromium: Home, Practice, 1 a side, 1 minute,
//   Start; Ready at tick 600; the menu at the 2nd goal's latch, the clock
//   still, Resume by Enter, and at the 4th's, Escape twice; Results with
//   the bot's pack ahead at 0:00, every goal and countdown shown, Play
//   again focused; Play again to a fresh Pre-match; Leave to Home; nothing
//   contacted.
// - Through the controls, in each engine: on Pre-match W, A, S and D move
//   the terrier, Space jumps without pressing the focused Ready, Shift with
//   W zooms, E pounces, Q barks and C switches to chase view, where S runs
//   until the ball is behind the camera and the arrow shows, and C goes
//   back to ball view; your mark shown, and the HUD's meter and pounce wait
//   following; Ready at the first anchor 120 ticks after the warm-up's last
//   input; play to the bot's first confirmed goal; then the menu by Escape
//   and Resume by Enter, a hidden page opening the menu, and a reload going
//   Home; nothing contacted.

import { config } from '../src/config';
import { AIRBORNE, ZOOMING } from '../src/core/sim/state';
import type { Inspection } from '../src/main';
import { expect, expectWebGL2, test } from './lib/guards';
import { acceptLeavePrompt, expectStarted, hudOf, overlayOf, POLL_MS, smallViewport } from './lib/page';
import {
  AFTER_WARM_UP_TICKS, anchorAfter, clearReadyStates, emulateHidden, expectBotFirst, expectNothingContacted, FIRST_GOAL_MS, focused, lastInputBy,
  PracticeRun, RESULTS_MS, SHOWN_MS, WHOLE_ANCHOR, where,
} from './lib/practice';

test.use({ viewport: smallViewport });

/** Each test's whole timeout, provisional until phase 1c's Measure step sets them from measured runs: the
 *  start and Home's prepare (the slice saw well under 1 s), the anchor, the replays' slowest Results or
 *  first goal after Ready (e2e/lib/practice.ts), and the screens either side, each about doubled. */
const WHOLE_TEST_MS = 8 * 60_000;
const CONTROLS_TEST_MS = 6 * 60_000;
/** The off-screen arrow, S held in chase view: the slice saw it within a few seconds; provisional. */
const ARROW_MS = 15_000;
/** How far a direction key must run the terrier its way to count: a test's threshold, not a setting. */
const MOVED_M = 0.5;
/** The way each key runs the terrier in ball view (A.2, src/core/sim/movement.ts): W along the ball line
 *  toward the ball, A a quarter turn counter-clockwise from it, S away, D a quarter turn clockwise. */
const WAYS = { KeyW: 0, KeyA: Math.PI / 2, KeyS: Math.PI, KeyD: -Math.PI / 2 } as const;
/** The menus at the goals' latches (§9.5): at the 2nd, the clock checked still and Resume by Enter; at the
 *  4th, Escape opens it and Escape closes it. */
const MENUS = [[2, 'resume'], [4, 'escape']] as const;

/** The origin every request stays under (P10): the preview's. */
const originOf = (baseURL: string | undefined): string => `${new URL(baseURL!).origin}/`;

test.describe('the whole match', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', "the whole match runs in Chromium, as PLAN §16's Practice does (M4's design §9.3)");

  test('Practice plays through every screen to Results, Play again and Leave, compiling nothing and contacting no one', async ({ page, guard, baseURL }, testInfo) => {
    test.setTimeout(WHOLE_TEST_MS);
    const run = new PracticeRun(page, testInfo, 'whole');
    await run.measured(async () => {
      await expectWebGL2(page);
      await run.load('./');
      await run.practice();
      await run.ready(WHOLE_ANCHOR);

      // A held from each countdown, through the match to Results, with the menu at the 2nd and 4th goals'
      // latches, in their celebrations (§9.5).
      const results = await run.until((i) => i.screen === 'results', {
        what: 'Results', timeoutMs: RESULTS_MS,
        each: async (i) => {
          for (const [goal, close] of MENUS) {
            if ((i.match?.goals.length ?? 0) >= goal && !run.measure.menus.some((m) => m.goal === goal)) await run.menuAt(goal, close);
          }
        },
      });
      run.mark('results');
      await run.stopHolding();
      expect(run.measure.menus.map((m) => m.goal), 'the menus at the 2nd and 4th goals').toEqual(MENUS.map(([goal]) => goal));

      // The confirmed end (PLAN §16): the bot's pack, B, ahead at 0:00, with no overtime, which every look
      // has checked.
      const m = results.match!;
      const end = m.end;
      expect(end, `the confirmed end; ${where(results)}`).not.toBeNull();
      expect({ winner: end!.winner, ahead: end!.score[1] > end!.score[0], clock: m.clock }, `the end, ${JSON.stringify(end!.score)}`)
        .toEqual({ winner: 1, ahead: true, clock: 0 });
      // What the screens showed of it (§1.40, L103): every countdown and every goal latched, none taken back,
      // each goal's celebration, and the score on the HUD.
      const log = results.announcements!;
      expect(log.countdowns, 'the countdowns the HUD showed').toEqual(run.periods.map((p) => p.countdown));
      expect(log.goals.map((g) => [g.tick, g.withdrawnAtMs]), 'the goals the HUD showed').toEqual(m.goals.map((g) => [g.tick, null]));
      expect(log.celebrationsShown, 'a celebration drawn for each goal').toBe(m.goals.length);
      expect(log.results, "Results' own entry").not.toBeNull();
      expect(hudOf(run.lastPitch!)?.score, "the HUD's score at the last look at Match").toBe(`${m.score[0]}–${m.score[1]}`);
      // What the person played: Ready and every hold inside the validated latitudes, and no other input.
      run.expectPlayed(run.lastPitch!, null, end!.tick);

      // Results (§5.9, Q-17): Play again focused; the final score and the outcome said once filled (§5.14).
      await expect(page.locator('[data-test="again"]'), 'Play again first on Results (Q-17)').toBeFocused();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Results');
      await expect(page.locator('[data-test="final-score"]')).toHaveText(new RegExp(`^\\S+ ${end!.score[0]}–${end!.score[1]} \\S+$`), { timeout: SHOWN_MS });
      await expect(page.locator('[data-test="outcome"]')).toHaveText(/ pack wins\. Your pack lost\.$/);
      await expect(page.locator('[data-test="results"] tbody tr')).toHaveCount(2);
      await expect(page.locator('[data-test="terriest"]')).toHaveText(/^The Terriests?: .+\.$/);

      // Play again by Enter once Results' guard has passed, by the page's clock (Q-17): a new Practice's
      // Pre-match, with a log of its own (§1.40) and Ready focused from its entry again (Q-15).
      const guardMs = config.resultsPressGuardSeconds * 1000;
      await page.waitForFunction((o) => performance.now() - o.shown >= o.ms, { shown: log.results!.shownAtMs, ms: guardMs }, { polling: POLL_MS });
      await clearReadyStates(page);
      await page.keyboard.press('Enter');
      const again = await run.readyActs();
      run.mark('again');
      expect(again.announcements, 'a fresh log for the new match').toMatchObject({ matchId: null, arrivalTick: 0, countdowns: [], goals: [], results: null });
      expect(again.match?.localTick ?? Infinity, 'a new Practice, from its own start').toBeLessThan(WHOLE_ANCHOR);

      // Leave, two along from Ready by the arrows (Q-17), and Enter: Home, its heading focused.
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      expect(await focused(page), 'Leave, two along from Ready').toBe('prematch-leave');
      await page.keyboard.press('Enter');
      const home = await run.until((i) => i.screen === 'home', { what: 'Home, after Leave', timeoutMs: SHOWN_MS });
      expect(home.match, 'the match left').toBeNull();
      await expect(page.getByRole('main').getByRole('heading', { level: 1 }), "Home's heading focused (Q-17)").toBeFocused();
      await expectNothingContacted(page, guard, { origin: originOf(baseURL) });
    });
  });
});

/** Holds `key` until the terrier has run MOVED_M its key's way from where it stood when the key went down,
 *  by the ball line then, so the last key's slide can't pass for this one's run; then lets go. */
async function runs(run: PracticeRun, key: keyof typeof WAYS): Promise<void> {
  const at = (await run.poll()).match!;
  const from = at.mine!;
  const way = Math.atan2(at.ball.y - from.y, at.ball.x - from.x) + WAYS[key];
  const along = (i: Inspection): number => (i.match!.mine!.x - from.x) * Math.cos(way) + (i.match!.mine!.y - from.y) * Math.sin(way);
  await run.page.keyboard.down(key);
  try {
    await run.until((i) => along(i) >= MOVED_M, { what: `the terrier run its way by ${key}`, timeoutMs: SHOWN_MS });
  } finally {
    await run.page.keyboard.up(key);
  }
}

/** Presses `key` once, and looks until `shown` holds of what it did. */
async function presses(run: PracticeRun, key: string, shown: (i: Inspection, before: Inspection) => boolean, what: string): Promise<Inspection> {
  const before = await run.poll();
  await run.page.keyboard.press(key);
  return run.until((i) => shown(i, before), { what, timeoutMs: SHOWN_MS });
}

test('every control on the keyboard, to the first confirmed goal, then the menu, a hidden page and a reload', async ({ page, guard, baseURL }, testInfo) => {
  test.setTimeout(CONTROLS_TEST_MS);
  const run = new PracticeRun(page, testInfo, 'controls');
  await run.measured(async () => {
    await expectWebGL2(page);
    acceptLeavePrompt(page);
    await run.load('./');
    await run.practice();

    // The warm-up (§9.5): your mark over your terrier in ball view (L52), then each control once.
    await run.until((i) => overlayOf(i)?.mine?.shown === true && i.render.camera.view === 'ball', { what: 'your mark, in ball view', timeoutMs: SHOWN_MS });
    for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD'] as const) await runs(run, key);
    const mine = (i: Inspection): NonNullable<NonNullable<Inspection['match']>['mine']> => i.match!.mine!;
    await presses(run, 'Space', (i, b) => mine(i).takeOffTick !== mine(b).takeOffTick, 'a jump: its take-off tick');
    await run.until((i) => mine(i).anim !== AIRBORNE, { what: 'landed', timeoutMs: SHOWN_MS });
    await expect(page.locator('[data-test="ready"]'), 'Space only jumps: the focused Ready not pressed (C-34)').toHaveText('Ready');
    // Zoomies, Shift with W: zooming, and the HUD's meter falling (L167).
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    try {
      await run.until((i) => mine(i).anim === ZOOMING && (hudOf(i)?.meter ?? 1) < 1, { what: "zoomies, the HUD's meter falling", timeoutMs: SHOWN_MS });
    } finally {
      await page.keyboard.up('KeyW');
      await page.keyboard.up('ShiftLeft');
    }
    // A pounce: a lunge latched, then its wait on the HUD (L167).
    await presses(run, 'KeyE', (i, b) => mine(i).lunges > mine(b).lunges && mine(i).pounceWait > 0 && (hudOf(i)?.pounceWait ?? 0) > 0,
      "a pounce: a lunge, then the HUD's pounce wait");
    // A bark: its mark over the terrier and the drawer's bark, each counted as it starts (§9.1's latched).
    await presses(run, 'KeyQ', (i, b) => i.announcements!.barksShown > b.announcements!.barksShown
      && i.render.drawer!.overlaysShown.barking > b.render.drawer!.overlaysShown.barking, "a bark: its mark and the drawer's bark");
    // The view: chase, where S runs until the ball is behind the camera and its arrow shows (D-28, L90), then
    // ball view again, as every hold in play is played (§9.1).
    await presses(run, 'KeyC', (i) => i.render.camera.view === 'chase', 'chase view');
    await page.keyboard.down('KeyS');
    try {
      await run.until((i) => overlayOf(i)?.arrow.shown === true, { what: 'the off-screen arrow, S held in chase view', timeoutMs: ARROW_MS });
    } finally {
      await page.keyboard.up('KeyS');
    }
    const end = await presses(run, 'KeyC', (i) => i.render.camera.view === 'ball', 'ball view again');
    run.mark('warmedUp');

    // The warm-up's end: every key up and every press acted, once each and the view twice; Ready at the first
    // anchor at least 120 ticks after its last input (§9.1).
    const c = end.controls!;
    expect(c.presses, "the warm-up's presses").toEqual({ jump: 1, pounce: 1, bark: 1, view: 2 });
    expect(c.holds.filter((h) => h.to === null), "the warm-up's directions, all let go").toEqual([]);
    const lastInput = lastInputBy(end);
    const anchor = anchorAfter(lastInput);
    run.measure.warmUp = { lastInputTick: lastInput, lastHoldTo: c.holds.at(-1)?.to ?? null, anchor: anchor ?? -1, presses: c.presses };
    expect(anchor, `an anchor ${AFTER_WARM_UP_TICKS} ticks after the warm-up's last input, at tick ${lastInput} at the latest`).not.toBeNull();
    await run.ready(anchor!);

    // Play to the bot's first confirmed goal, A held from the start countdown to a second of play.
    const goal = await run.until((i) => (i.match?.goals.length ?? 0) > 0, { what: "the bot's first confirmed goal", timeoutMs: FIRST_GOAL_MS });
    run.mark('firstGoal');
    expect(run.held, `A held at the first goal's latch: no validated run is; ${where(goal)}`).toBe(false);
    await run.stopHolding();
    const shown = await run.until((i) => (i.announcements?.goals.length ?? 0) > 0, { what: 'the HUD showing the first goal', timeoutMs: SHOWN_MS });
    expectBotFirst(shown);
    expect(hudOf(shown)?.score, "the HUD's score").toBe('0–1');
    run.expectPlayed(shown, { end: lastInput, presses: c.presses });

    // After the latch, where the replays stop: the menu by Escape, paused, Resume focused and pressed by
    // Enter (Q-15, Q-17); then a hidden page opens it, paused, and showing the page again leaves it open,
    // until Resume.
    await run.menuAt(1, 'resume');
    await emulateHidden(page, true);
    await run.until((i) => i.menu === 'menu' && i.match?.paused === true, { what: 'the menu, the page hidden', timeoutMs: SHOWN_MS });
    await emulateHidden(page, false);
    await page.waitForTimeout(SHOWN_MS / 10);
    const still = await run.poll();
    expect([still.menu, still.match?.paused], 'the menu open, paused, the page shown again').toEqual(['menu', true]);
    expect(await focused(page), "Resume first in Practice's menu (Q-17)").toBe('resume');
    await page.keyboard.press('Enter');
    await run.until((i) => i.menu === 'closed' && i.match?.paused === false, { what: 'Resume, after the hidden page', timeoutMs: SHOWN_MS });
    await expectNothingContacted(page, guard, { origin: originOf(baseURL) });

    // A reload goes Home, with no match and no log, contacting no one (D-22).
    await page.reload();
    await expectStarted(page);
    const home = await run.until((i) => i.screen === 'home', { what: 'Home, after the reload', timeoutMs: SHOWN_MS });
    run.mark('reloaded');
    expect([home.match, home.announcements], 'no match after the reload').toEqual([null, null]);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 }), "Home's heading focused (Q-17)").toBeFocused();
    await expectNothingContacted(page, guard, { origin: originOf(baseURL) });
  });
});
