// Practice through the screens (PLAN §16's Practice, L73–L83, L238, P10,
// Q-15, Q-17; M4's design, research/m4/DESIGN.md, §4.3–§4.9, §5.9, §7,
// §9.1, §9.3, §9.5, §9.6, M4-Q28, M4-Q36), as phases 1 and 2 build it: the
// keyboard and the stubbed gamepad, the menu, the HUD's meter and pounce
// wait, your mark, the arrow, the bark marks, the control hints and Show
// control hints again, the whole match with its network figures, Copy and
// its sound's cues; phase 3 adds the stand-in, names and away marks. Every
// run plays seed 7's setup at the gate's 640 × 360 and stored low quality,
// as e2e/lib/practice.ts plays it: Home and Practice's setup on the keyboard
// alone; Ready at its anchor, A held from each countdown to a second of
// play, and the holds, the presses and the Ready tick checked inside the
// latitudes the Node replays validated (src/net/practice-spec-whole-1 to -6,
// practice-spec-goal-1 to -4, whose bands play the controls run's kind of
// warm-up), so a page too slow to stay in them fails saying so rather than
// with another match. Each look at the page fails at once on an overtime, a
// stall or anything compiled after prepare() (PLAN §12). The focus Q-17
// names is read once, at its screen's first look, inside the window, and
// what the HUD, the marks and the hints show is read from the page as
// drawn, not from the hook alone. Each run logs one line,
// `practice-measure {…}`, for the Measure steps.
// - The whole match, in Chromium: Home, Practice, 1 a side, 1 minute,
//   Start; Ready by Enter at tick 600; the start countdown's seconds on the
//   HUD; the menu at the 2nd goal's latch, the clock still, Resume by Enter,
//   and at the 4th's, Escape twice; Results with the bot's pack ahead at
//   0:00, every goal and countdown shown, Play again focused and in view;
//   the sound's cues decided, a kickoff whistle at each start of play, a
//   goal's whistle and chorus per confirmed goal and one end whistle (§7);
//   the network figures, Practice's own, with no late input or resync
//   (§5.9); Copy reached by the arrows, in view, and the clipboard holding
//   the figures drawn; Play again to a fresh Pre-match; Leave to Home;
//   nothing contacted. The bot's row on Pre-match and on Results by the
//   robot dog's name its host gave it, the person's name taken, and every
//   name on the list on one line in the bot's Results row, the table inside
//   its screen, at 640 × 360 and at a phone's width held upright (the
//   owner, 2026-11-22).
// - Through the controls, in each engine, the gamepad stubbed: on
//   Pre-match no hints before a control is used; your mark drawn and on top
//   of the HUD and the panel, a click on the pitch leaving the focus on
//   Ready; on the keyboard W, A, S and D moving the terrier, Space jumping
//   without pressing the focused Ready, Shift with W zooming, E pouncing,
//   each gauge drawn as its value says, Q barking, its mark drawn over your
//   terrier and the bark marks under the HUD and the panel, and C switching
//   to chase view, where S runs until the ball is behind the camera and the
//   arrow shows, drawn and on top, and C going back to ball view; then the
//   pad's stick each way, its bottom button jumping, its trigger's zoomies,
//   its left button pouncing, its top button barking and its right shoulder
//   switching the view and back; the keyboard's hints from its first use,
//   then the pad's, each line clearing as its control is used and each
//   panel gone with its sixth; Ready by the pad's Start at the first anchor
//   120 ticks after the warm-up's last input; play to the bot's first
//   confirmed goal, its digits on the HUD; then the menu by Escape and
//   Resume by Enter, by the pad's Back and closed by it, by the pad's Back
//   and Resume by its Start, a hidden page opening the menu, and a reload
//   going Home; the hints still cleared there, Settings' Show control hints
//   again from Home by the pad, and a new Practice's Pre-match showing the
//   keyboard's hints and the pad's again; nothing contacted.

import { config, derived } from '../src/config';
import { BOT_NAMES, botName } from '../src/core/bot/bot-id';
import { FRAME_BALL, frameOf, heldDirection, stepOf } from '../src/core/sim/input';
import { AIRBORNE, ZOOMING } from '../src/core/sim/state';
import type { Control } from '../src/input/source';
import type { Inspection } from '../src/main';
import { PAD, setButton, setStick } from './lib/gamepad';
import { expect, expectWebGL2, test } from './lib/guards';
import { acceptLeavePrompt, expectStarted, hintsOf, hudOf, namesInRow, overlayOf, POLL_MS, smallViewport } from './lib/page';
import {
  AFTER_WARM_UP_TICKS, anchorAfter, barksSeen, BOT, clearReadyStates, copiedFrom, emulateHidden, expectBotFirst, expectFocusOnce, expectGaugeShort,
  expectNothingContacted, FIRST_GOAL_MS, focused, gaugeSeen, kickoffWhistles, lastInputBy, PracticeRun, readoutSeen, RESULTS_MS, SHOWN_MS, topAt,
  WHOLE_ANCHOR, where,
} from './lib/practice';

test.use({ viewport: smallViewport });

/** Each test's whole timeout, from the measured runs: its worst run, made as long as the slowest match the
 *  replays validated (for the controls run, its anchor the most its warm-up can leave it from, 721 ticks;
 *  Ready 60 ticks late; then the latest end or the slowest first goal), × 2, which leaves each wait inside
 *  it to fail first, with its own message. The whole match's ran 147.8 s in phase 1c (load 0.89), 156.2 s
 *  so made, and 141.8 s with phase 2b's Copy and cues (load 7.23), 155.7 s so made; a hang in its longest
 *  wait, to Results, fails by about 237 s. */
const WHOLE_TEST_MS = 315_000;
/** The controls run's, with phase 2b's gamepad warm-up and menus, the hints again and their Practices: at
 *  worst 68.5 s so made, from a 29.8 s run (Firefox, its anchor 600, load 6.39); a hang at the goal fails by
 *  about 87 s. */
const CONTROLS_TEST_MS = 140_000;
/** The off-screen arrow, S held in chase view: at worst 308 ms (WebKit, load 1.73), most runs within a
 *  look; 3 × 0.31 + 2 = 2.9 s, as e2e/lib/practice.ts' waits. */
const ARROW_MS = 3_000;
/** How far a direction key must run the terrier its way to count: a test's threshold, not a setting. */
const MOVED_M = 0.5;
/** The way each key runs the terrier in ball view (A.2, src/core/sim/movement.ts): W along the ball line
 *  toward the ball, A a quarter turn counter-clockwise from it, S away, D a quarter turn clockwise. */
const WAYS = { KeyW: 0, KeyA: Math.PI / 2, KeyS: Math.PI, KeyD: -Math.PI / 2 } as const;
/** The pad's left stick for each key's way (§4.4): its axes, screen y down, as e2e/lib/gamepad.ts sets them. */
const STICK = { KeyW: [0, -1], KeyA: [-1, 0], KeyS: [0, 1], KeyD: [1, 0] } as const;
/** A.2's step each key's way sends in ball view, screen-relative, and the stick its way too (§4.5): up 0, a
 *  quarter turn counter-clockwise 8 of 32, down 16, a quarter turn clockwise 24. */
const STEPS = { KeyW: 0, KeyA: 8, KeyS: 16, KeyD: 24 } as const;
/** The menus at the goals' latches (§9.5): at the 2nd, the clock checked still and Resume by Enter; at the
 *  4th, Escape opens it and Escape closes it. */
const MENUS = [[2, 'resume'], [4, 'escape']] as const;
/** The six controls each kind's hints list, in the panel's order (src/input/hints.ts' CONTROLS). */
const SIX: readonly Control[] = ['run', 'zoomies', 'jump', 'pounce', 'bark', 'view'];
/** A kind's hint lines left once `used` have been. */
const left = (...used: Control[]): Control[] => SIX.filter((c) => !used.includes(c));
/** Settings' status after Show control hints again (src/ui/screens/settings.ts' HINTS_AGAIN). */
const HINTS_AGAIN = 'Each control’s hint shows again until you use it.';
/** Every control's bit in a kind's hints mask: all six used (A.3, M4-Q28). */
const ALL_SIX = (1 << SIX.length) - 1;
/** A name as long as C-17 allows, of its widest letter (phase 2b's review, P3). */
const LONG_NAME = 'W'.repeat(20);
/** The bot's name, as its host gives it with the person's taken (the owner, 2026-11-22). */
const BOT_NAME = botName(BOT, [LONG_NAME]);
/** A phone held upright, where Results shows as any screen does: the screens spec's phone (C-15). */
const PHONE_UPRIGHT = { width: 412, height: 915 } as const;

/** The origin every request stays under (P10): the preview's. */
const originOf = (baseURL: string | undefined): string => `${new URL(baseURL!).origin}/`;
/** A point of the pitch at the gate's 640 × 360, clear of Pre-match's panel, the HUD's bar and its gauges. */
const ON_THE_PITCH = { x: 160, y: 216 } as const;
/** Where in each mark's shape a hit lands inside its outline: the chevron's lower arm, the arrow's middle
 *  as it points right unturned, the bubble's middle (overlay.css). */
const INSIDE = { chevron: [0.5, 0.75], arrow: [0.5, 0.5], bubble: [0.5, 0.5] } as const;

type Mine = NonNullable<NonNullable<Inspection['match']>['mine']>;
const mine = (i: Inspection): Mine => i.match!.mine!;

test.describe('the whole match', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', "the whole match runs in Chromium, as PLAN §16's Practice does (M4's design §9.3)");

  test('Practice plays through every screen to Results, Copy, Play again and Leave, compiling nothing and contacting no one', async ({ page, guard, baseURL }, testInfo) => {
    test.setTimeout(WHOLE_TEST_MS);
    const run = new PracticeRun(page, testInfo, 'whole');
    await run.measured(async () => {
      await expectWebGL2(page);
      // Copy writes the clipboard, which Chromium lets a page read back once granted (§9.5).
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(baseURL!).origin });
      // A name as long as C-17 allows, of its widest letter, which Results' table wraps (P3).
      await run.load('./', { profile: { name: LONG_NAME } });
      await run.practice();
      // The bot's row by the robot dog's name its host gave it (the owner, 2026-11-22).
      expect(BOT_NAMES, "the bot's name, from the list").toContain(BOT_NAME);
      await expect(page.locator('[data-test="pack-1"] li:not(.free) .name'), "the bot's row on Pre-match").toHaveText([BOT_NAME]);
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
      // Results (§5.9, Q-17): Play again focused first, read at the first look that shows it, and in view at
      // the gate's 640 × 360, so Enter never presses a button the player can't see.
      await expectFocusOnce(page, 'again', 'Play again', 'Play again, first on Results (Q-17)');
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

      // What the sound decided (§7), counted whatever the context did, as headless engines may never run
      // one: a kickoff whistle at each start of play, a goal's whistle and its chorus per confirmed goal,
      // and one end whistle, at the end with Results.
      const heard = await run.until((i) => (i.audio?.decided.whistleEnd ?? 0) > 0, { what: 'the end whistle decided', timeoutMs: SHOWN_MS });
      const decided = heard.audio!.decided;
      const kickoffs = kickoffWhistles(run.periods, end!.tick, m.timer.gapMaxMs);
      const cues = `${JSON.stringify(decided)}, the periods ${JSON.stringify(run.periods)}, the end at ${end!.tick}`;
      expect({ whistleGoal: decided.whistleGoal, chorus: decided.chorus, whistleEnd: decided.whistleEnd }, `the goals' and the end's cues: ${cues}`)
        .toEqual({ whistleGoal: m.goals.length, chorus: m.goals.length, whistleEnd: 1 });
      expect(decided.whistleKickoff, `a kickoff whistle at each start of play, ${kickoffs.min} to ${kickoffs.max}: ${cues}`).toBeGreaterThanOrEqual(kickoffs.min);
      expect(decided.whistleKickoff, `a kickoff whistle at each start of play, ${kickoffs.min} to ${kickoffs.max}: ${cues}`).toBeLessThanOrEqual(kickoffs.max);

      // The final score and the outcome said once filled (§5.14).
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Results');
      await expect(page.locator('[data-test="final-score"]')).toHaveText(new RegExp(`^\\S+ ${end!.score[0]}–${end!.score[1]} \\S+$`), { timeout: SHOWN_MS });
      await expect(page.locator('[data-test="outcome"]')).toHaveText(/ pack wins\. Your pack lost\.$/);
      await expect(page.locator('[data-test="results"] tbody tr')).toHaveCount(2);
      await expect(page.locator('[data-test="terriest"]')).toHaveText(/^The Terriests?: .+\.$/);
      // The table inside its screen, the long name wrapping in its cell (P3).
      const fits = await page.evaluate(() => {
        const screen = document.querySelector('.screen.results')!;
        const s = screen.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(screen).paddingRight) || 0;
        const t = document.querySelector('[data-test="results"]')!.getBoundingClientRect();
        return { table: Math.round(t.right), screen: Math.round(s.right - pad) };
      });
      expect(fits.table, `Results' table's right edge within its screen's content, ${JSON.stringify(fits)}`).toBeLessThanOrEqual(fits.screen + 1);
      await expect(page.locator('[data-test="results"] tbody th').filter({ hasText: LONG_NAME })).toHaveCount(1);
      // The bot's row by the name Pre-match showed, and every name on the list on one line in it, the row
      // inside the screen, here and at a phone's width held upright, the window's size and scroll put back
      // after (the owner, 2026-11-22).
      const botRow = '[data-test="results"] tbody tr:not(.you)';
      await expect(page.locator(`${botRow} th .name-row > span:nth-child(2)`), "the bot's row on Results").toHaveText([BOT_NAME]);
      const unfitted = async (): Promise<object[]> =>
        (await namesInRow(page, { row: botRow, name: 'th .name-row > span:nth-child(2)', inside: '.screen.results', within: 'th, td' }, BOT_NAMES))
          .filter((f) => f.lines !== 1 || f.clipped || !f.inside);
      expect(await unfitted(), `list names past the bot's Results row at ${smallViewport.width}×${smallViewport.height}`).toEqual([]);
      const scrolled = await page.evaluate(() => [scrollX, scrollY] as const);
      await page.setViewportSize(PHONE_UPRIGHT);
      expect(await unfitted(), `list names past the bot's Results row at ${PHONE_UPRIGHT.width}×${PHONE_UPRIGHT.height}`).toEqual([]);
      await page.setViewportSize(smallViewport);
      await page.evaluate(([x, y]) => scrollTo(x, y), scrolled);

      // The network figures, Practice's own (§5.9, M3-Q24): its lone timeline takes no input from another
      // browser, so no late input, resync or repair; its final ticks those that ended it, at the least, and
      // no more than it holds now; its rollbacks and corrections the timeline's, and the sizes' table alone.
      const figures = await readoutSeen(page);
      const atEnd = await run.poll();
      expect(figures.lines.map((l) => l.test), "Practice's figures: no late input or resync").toEqual(['ticks', 'rollbacks', 'corrections']);
      expect(figures.tables.map((t) => [t.test, t.rows.length]), 'the sizes, no repair').toEqual([['readout-sizes', 4]]);
      expect(figures.note, 'said why').toMatch(/^Practice’s own: .*nothing resyncs\.$/);
      const ticks = Number(figures.lines[0]!.value);
      expect(ticks, `the final ticks, from the end at ${end!.tick} to the final tick now, ${atEnd.match!.finalTick}`).toBeGreaterThanOrEqual(end!.tick);
      expect(ticks).toBeLessThanOrEqual(atEnd.match!.finalTick);
      expect(figures.lines.slice(1).map((l) => l.value), "the timeline's rollbacks and corrections").toEqual([String(atEnd.match!.stats.rollbacks), String(atEnd.match!.stats.corrections)]);
      expect(figures.copy, 'nothing copied yet').toBe('idle');

      // Copy, reached by the arrows from Play again, past Home, once Results' guard has passed by the page's
      // clock (Q-17): focused and brought into view at the gate's 640 × 360, though it sits below the fold,
      // and pressed by Enter; its status said in view, the press logged as acted, and the clipboard holding
      // the figures as drawn (§9.5).
      const guardMs = config.resultsPressGuardSeconds * 1000;
      await page.waitForFunction((o) => performance.now() - o.shown >= o.ms, { shown: log.results!.shownAtMs, ms: guardMs }, { polling: POLL_MS });
      await page.keyboard.press('ArrowRight');
      expect(await focused(page), 'Home, one along from Play again').toBe('home');
      await page.keyboard.press('ArrowRight');
      await expectFocusOnce(page, 'copy-figures', 'Copy', "Copy, two along from Play again, brought into view (§5.14)");
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-test="readout"]'), 'copied').toHaveAttribute('data-copy', 'copied', { timeout: SHOWN_MS });
      const copied = await readoutSeen(page);
      expect([copied.status, copied.statusInView], "Copy's status, in view").toEqual(['Copied.', true]);
      const pressed = (await run.poll()).announcements!.results!.presses;
      expect(pressed.map((p) => [p.source, p.accepted, p.atMs >= guardMs]), "Copy's press, logged and acted").toEqual([['keyboard', true, true]]);
      const clipboard = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboard, 'the clipboard: the figures as Results drew them').toBe(copiedFrom(copied, true));

      // Play again by Enter, back on it by the arrows: a new Practice's Pre-match, with a log of its own
      // (§1.40) and Ready focused from its entry again (Q-15).
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await expectFocusOnce(page, 'again', 'Play again', 'Play again, two back from Copy, in view again');
      await clearReadyStates(page);
      // Its drawing counted past the stage's frames on Results, which drew the match before (specs-F3).
      const onResults = (await run.poll()).render.frames;
      await page.keyboard.press('Enter');
      const again = await run.readyActs(onResults);
      run.mark('again');
      expect(again.announcements, 'a fresh log for the new match').toMatchObject({ matchId: null, arrivalTick: 0, countdowns: [], goals: [], results: null });
      expect(again.match?.localTick ?? Infinity, 'a new Practice, from its own start').toBeLessThan(WHOLE_ANCHOR);

      // Leave, two along from Ready by the arrows (Q-17), and Enter: Home, its heading focused.
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      expect(await focused(page), 'Leave, two along from Ready').toBe('prematch-leave');
      await page.keyboard.press('Enter');
      const home = await run.until((i) => i.screen === 'home', { what: 'Home, after Leave', timeoutMs: SHOWN_MS });
      await expectFocusOnce(page, 'h1', 'terriest', "Home's heading, after Leave (Q-17)");
      expect(home.match, 'the match left').toBeNull();
      await expectNothingContacted(page, guard, { origin: originOf(baseURL) });
    });
  });
});

/** Runs the terrier its key's way, MOVED_M from where it stood when the run began, by the ball line then,
 *  so the last run's slide can't pass for this one's: by holding the key, or the pad's stick its way; the
 *  input it sent the key's step in ball view's frame, as a terrier that only curved round to it wouldn't. */
async function runs(run: PracticeRun, key: keyof typeof WAYS, by: 'keyboard' | 'pad' = 'keyboard'): Promise<void> {
  const at = (await run.poll()).match!;
  const from = at.mine!;
  const way = Math.atan2(at.ball.y - from.y, at.ball.x - from.x) + WAYS[key];
  const along = (i: Inspection): number => (mine(i).x - from.x) * Math.cos(way) + (mine(i).y - from.y) * Math.sin(way);
  const [x, y] = STICK[key];
  const what = by === 'keyboard' ? key : `the pad's stick (${x}, ${y})`;
  if (by === 'keyboard') await run.page.keyboard.down(key);
  else await setStick(run.page, x, y);
  try {
    const ran = await run.until((i) => along(i) >= MOVED_M, { what: `the terrier run its way by ${what}`, timeoutMs: SHOWN_MS });
    const input = ran.controls!.lastInput!;
    expect([heldDirection(input), stepOf(input), frameOf(input)], `the input ${what} sent, its step in ball view's frame (§4.5)`)
      .toEqual([true, STEPS[key], FRAME_BALL]);
  } finally {
    if (by === 'keyboard') await run.page.keyboard.up(key);
    else await setStick(run.page, 0, 0);
  }
}

/** Does `act` once, and looks until `shown` holds of what it did. */
async function acts(run: PracticeRun, act: () => Promise<void>, shown: (i: Inspection, before: Inspection) => boolean, what: string): Promise<Inspection> {
  const before = await run.poll();
  await act();
  return run.until((i) => shown(i, before), { what, timeoutMs: SHOWN_MS });
}

/** Presses `key` once, and looks until `shown` holds of what it did. */
function presses(run: PracticeRun, key: string, shown: (i: Inspection, before: Inspection) => boolean, what: string): Promise<Inspection> {
  return acts(run, () => run.page.keyboard.press(key), shown, what);
}

/** Presses pad button `button` once, and looks until `shown` holds of what it did. */
function padPresses(run: PracticeRun, button: number, shown: (i: Inspection, before: Inspection) => boolean, what: string): Promise<Inspection> {
  return acts(run, () => run.pad(button, what), shown, what);
}

/** The pad's d-pad, a press at a time, each landing on the next of `stops`, focused and inside the window
 *  (Q-17, L82). */
async function dpad(run: PracticeRun, button: number, stops: readonly string[], where: string): Promise<void> {
  for (const want of stops) {
    await run.pad(button, `${where}'s d-pad`);
    await expectFocusOnce(run.page, want, null, `${where}'s d-pad to ${want}`);
  }
}

/** Your bark's press acted, so a bot's bark never passes for a lost one, and a bark shown, its mark counted and the
 *  drawer's bark begun (§9.1's latched): any terrier's, as neither count says whose (src/ui/app-bark.test.ts pins
 *  your own). */
const barked = (i: Inspection, b: Inspection): boolean =>
  i.controls!.presses.bark > b.controls!.presses.bark
  && i.announcements!.barksShown > b.announcements!.barksShown && i.render.drawer!.overlaysShown.barking > b.render.drawer!.overlaysShown.barking;

/** Leave from Pre-match, two along from Ready by the arrows (Q-17), and Enter: Home. */
async function leave(run: PracticeRun, what: string): Promise<void> {
  await run.page.keyboard.press('ArrowRight');
  await run.page.keyboard.press('ArrowRight');
  expect(await focused(run.page), `Leave, two along from Ready, ${what}`).toBe('prematch-leave');
  await run.page.keyboard.press('Enter');
  await run.until((i) => i.screen === 'home', { what: `Home, after Leave, ${what}`, timeoutMs: SHOWN_MS });
}

test('every control on the keyboard and the gamepad, to the first confirmed goal, then the menus, a hidden page, a reload and the hints again', async ({ page, guard, baseURL }, testInfo) => {
  test.setTimeout(CONTROLS_TEST_MS);
  const run = new PracticeRun(page, testInfo, 'controls');
  await run.measured(async () => {
    await expectWebGL2(page);
    acceptLeavePrompt(page);
    // The touch's hints seeded cleared, as a player who once played by touch has them, so Show control hints
    // again is seen to clear them (specs-F8).
    await run.load('./', { gamepad: true, profile: { hints: { keyboard: 0, touch: ALL_SIX, gamepad: 0 } } });
    const pre = await run.practice();
    expect(pre.gamepad?.connected, 'the stubbed pad, connected').toBe(true);
    // A fresh context: no hints until a control is used on the pitch (§4.7, L83).
    expect(hintsOf(pre), 'no hints before any control is used').toMatchObject({ shown: null, seen: [], used: { keyboard: 0, touch: ALL_SIX, gamepad: 0 } });

    // The warm-up (§9.5): your mark over your terrier in ball view (L52), drawn by the page's own styles and
    // on top of the HUD and Pre-match's panel wherever it meets them (§2.6, M4-Q10).
    await run.until((i) => overlayOf(i)?.mine?.shown === true && i.render.camera.view === 'ball', { what: 'your mark, in ball view', timeoutMs: SHOWN_MS });
    await expect(page.locator('.overlay-mine .overlay-chevron'), 'your mark, shown').toBeVisible();
    for (const over of ['[data-test="hud-clock"]', '[data-test="prematch"]']) {
      expect(await topAt(page, '.overlay-mine', over, INSIDE.chevron), `your mark over ${over}`).toBe('mark');
    }
    // A click on the pitch leaves the focus on Ready, so Enter still presses it (§4.9).
    await page.mouse.click(ON_THE_PITCH.x, ON_THE_PITCH.y);
    expect(await focused(page), 'Ready, still focused after a click on the pitch').toBe('ready');

    // Then each control once on the keyboard, its hints from its first use, each line clearing as its control
    // is used (§4.7).
    await runs(run, 'KeyW');
    await run.hints('keyboard', left('run'), "the keyboard's, once W ran");
    for (const key of ['KeyA', 'KeyS', 'KeyD'] as const) await runs(run, key);
    await presses(run, 'Space', (i, b) => mine(i).takeOffTick !== mine(b).takeOffTick, 'a jump: its take-off tick');
    await run.hints('keyboard', left('run', 'jump'), "the keyboard's, once Space jumped");
    await run.until((i) => mine(i).anim !== AIRBORNE, { what: 'landed', timeoutMs: SHOWN_MS });
    await expect(page.locator('[data-test="ready"]'), 'Space only jumps: the focused Ready not pressed (C-34)').toHaveText('Ready');
    // Zoomies, Shift with W: zooming, and the HUD's meter falling (L167), its gauge drawn short of full.
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    try {
      await run.until((i) => mine(i).anim === ZOOMING && (hudOf(i)?.meter ?? 1) < 1, { what: "zoomies, the HUD's meter falling", timeoutMs: SHOWN_MS });
      expectGaugeShort(await gaugeSeen(page, 'hud-meter'), 'the zoomies meter');
    } finally {
      await page.keyboard.up('KeyW');
      await page.keyboard.up('ShiftLeft');
    }
    await run.hints('keyboard', left('run', 'jump', 'zoomies'), "the keyboard's, once Shift zoomed");
    // A pounce: a lunge latched, then its wait on the HUD (L167), the gauge drawn short of full.
    await presses(run, 'KeyE', (i, b) => mine(i).lunges > mine(b).lunges && mine(i).pounceWait > 0 && (hudOf(i)?.pounceWait ?? 0) > 0,
      "a pounce: a lunge, then the HUD's pounce wait");
    expectGaugeShort(await gaugeSeen(page, 'hud-pounce'), 'the pounce wait');
    await run.hints('keyboard', ['bark', 'view'], "the keyboard's, once E pounced");
    // A bark: its mark over the terrier, drawn by the page's styles, and the drawer's bark, each counted as it
    // starts (§9.1's latched); then the bark marks under the HUD and Pre-match's panel (§5.8, L103).
    const barking = await barksSeen(page);
    const keyBark = await presses(run, 'KeyQ', barked, "a bark: its mark and the drawer's bark");
    const drawn = await barksSeen(page);
    const over = drawn.marks.slice(barking.marks.length).filter((m) => m.drawn && Math.abs(m.x - overlayOf(keyBark)!.mine!.x) < 40 && m.y < overlayOf(keyBark)!.mine!.y);
    expect(over, `a bark mark drawn over your terrier, of ${JSON.stringify(drawn.marks.slice(barking.marks.length))}`).not.toEqual([]);
    for (const box of ['[data-test="hud-clock"]', '[data-test="prematch"]']) {
      expect(await topAt(page, '.overlay-bark', box, INSIDE.bubble), `a bark mark under ${box}`).toBe('box');
    }
    await run.hints('keyboard', ['view'], "the keyboard's, once Q barked");
    // The view: chase, its sixth control, the keyboard's panel gone; there S runs until the ball is behind the
    // camera and its arrow shows (D-28, L90), drawn and on top of the panel and the gauges; then ball view
    // again, as every hold in play is played (§9.1).
    await presses(run, 'KeyC', (i) => i.render.camera.view === 'chase', 'chase view');
    await run.hints(null, [], "every keyboard control used: the keyboard's panel gone");
    await page.keyboard.down('KeyS');
    try {
      await run.until((i) => overlayOf(i)?.arrow.shown === true, { what: 'the off-screen arrow, S held in chase view', timeoutMs: ARROW_MS });
      await expect(page.locator('.overlay-arrow .overlay-arrow-shape'), 'the arrow, shown').toBeVisible();
      for (const box of ['[data-test="prematch"]', '[data-test="hud-meter"]']) {
        expect(await topAt(page, '.overlay-arrow', box, INSIDE.arrow), `the arrow over ${box}`).toBe('mark');
      }
    } finally {
      await page.keyboard.up('KeyS');
    }
    await presses(run, 'KeyC', (i) => i.render.camera.view === 'ball', 'ball view again');

    // Then each control once on the stubbed gamepad (§4.4, D-29), its hints from its first use: the left stick
    // each way, as W, A, S and D ran; the bottom button's jump, once landed; the right trigger's zoomies, with
    // the stick up; the left button's pounce, once the keyboard's pounce wait is over; the top button's bark,
    // a bark gap after the keyboard's (L327); and the right shoulder's view, twice, back to ball view.
    await runs(run, 'KeyW', 'pad');
    await run.hints('gamepad', left('run'), "the pad's, once its stick ran");
    for (const key of ['KeyA', 'KeyS', 'KeyD'] as const) await runs(run, key, 'pad');
    await run.until((i) => mine(i).anim !== AIRBORNE, { what: 'landed, before the pad\'s jump', timeoutMs: SHOWN_MS });
    await padPresses(run, PAD.jump, (i, b) => mine(i).takeOffTick !== mine(b).takeOffTick, "the pad's jump: its take-off tick");
    await run.hints('gamepad', left('run', 'jump'), "the pad's, once its bottom button jumped");
    await run.until((i) => mine(i).anim !== AIRBORNE, { what: "landed after the pad's jump", timeoutMs: SHOWN_MS });
    await setStick(page, ...STICK.KeyW);
    await setButton(page, PAD.zoomies, 1);
    try {
      await run.until((i) => mine(i).anim === ZOOMING && (hudOf(i)?.meter ?? 1) < 1, { what: "the pad's zoomies, the HUD's meter falling", timeoutMs: SHOWN_MS });
    } finally {
      await setButton(page, PAD.zoomies, 0);
      await setStick(page, 0, 0);
    }
    await run.hints('gamepad', left('run', 'jump', 'zoomies'), "the pad's, once its trigger zoomed");
    await run.until((i) => mine(i).pounceWait === 0, { what: "the keyboard's pounce wait over", timeoutMs: SHOWN_MS });
    await padPresses(run, PAD.pounce, (i, b) => mine(i).lunges > mine(b).lunges && mine(i).pounceWait > 0, "the pad's pounce: a lunge");
    await run.hints('gamepad', ['bark', 'view'], "the pad's, once its left button pounced");
    await run.until((i) => i.match!.localTick >= keyBark.match!.localTick + derived.barkGapTicks, { what: "a bark gap after the keyboard's bark", timeoutMs: SHOWN_MS });
    await padPresses(run, PAD.bark, barked, "the pad's bark: its mark and the drawer's bark");
    await run.hints('gamepad', ['view'], "the pad's, once its top button barked");
    await padPresses(run, PAD.view, (i) => i.render.camera.view === 'chase', "the pad's view: chase");
    await run.hints(null, [], "every pad control used: the pad's panel gone");
    const end = await padPresses(run, PAD.view, (i) => i.render.camera.view === 'ball', "the pad's view: ball again");
    run.mark('warmedUp');

    // The warm-up's end: every key and the stick let go and every press acted, once each a device and the view
    // twice; the pad's own figures a press of each button the spec pressed; Ready at the first anchor at least
    // 120 ticks after its last input (§9.1).
    const c = end.controls!;
    expect(c.presses, "the warm-up's presses, the keyboard's and the pad's").toEqual({ jump: 2, pounce: 2, bark: 2, view: 4 });
    expect(c.barksDropped, 'no bark dropped in the bark gap (L327)').toBe(0);
    expect(c.holds.filter((h) => h.to === null), "the warm-up's directions, all let go").toEqual([]);
    const pad = end.gamepad!.presses;
    expect([PAD.jump, PAD.pounce, PAD.bark, PAD.view, PAD.zoomies].map((b) => pad[String(b)]), "the pad's presses: bottom, left, top, right shoulder, trigger")
      .toEqual([1, 1, 1, 2, 1]);
    const lastInput = lastInputBy(end);
    const anchor = anchorAfter(lastInput);
    run.measure.warmUp = { lastInputTick: lastInput, lastHoldTo: c.holds.at(-1)?.to ?? null, anchor: anchor ?? -1, presses: c.presses };
    expect(anchor, `an anchor ${AFTER_WARM_UP_TICKS} ticks after the warm-up's last input, at tick ${lastInput} at the latest`).not.toBeNull();
    // Ready by the pad's Start (§9.5, Q-17).
    await run.ready(anchor!, 'start');

    // Play to the bot's first confirmed goal, A held from the start countdown to a second of play.
    const goal = await run.until((i) => (i.match?.goals.length ?? 0) > 0, { what: "the bot's first confirmed goal", timeoutMs: FIRST_GOAL_MS });
    run.mark('firstGoal');
    expect(run.held, `A held at the first goal's latch: no validated run is; ${where(goal)}`).toBe(false);
    await run.stopHolding();
    const shown = await run.until((i) => (i.announcements?.goals.length ?? 0) > 0, { what: 'the HUD showing the first goal', timeoutMs: SHOWN_MS });
    expectBotFirst(shown);
    expect(hudOf(shown)?.score, "the HUD's score").toBe('0–1');
    // The score as the player sees it: each pack's digits drawn on the HUD (§5.8).
    const digits = page.locator('[data-test="hud"] .hud-goals');
    await expect(digits, "the HUD's digits").toHaveText(['0', '1']);
    for (const d of await digits.all()) await expect(d).toBeVisible();
    run.expectPlayed(shown, { end: lastInput, presses: c.presses });

    // After the latch, where the replays stop: the menu by Escape, paused, Resume focused and pressed by
    // Enter (Q-15, Q-17); by the pad's Back, which closes it too; and by the pad's Back with Resume pressed by
    // its Start (§4.4, §4.9). Then a hidden page opens it, paused, and showing the page again leaves it open,
    // until Resume.
    await run.menuAt(1, 'resume');
    await run.menuBy('back', 'back', "the pad's Back, after the first goal");
    await run.menuBy('back', 'start', "the pad's Back and Start, after the first goal");
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
    await expectFocusOnce(page, 'h1', 'terriest', "Home's heading, after the reload (Q-17)");
    run.mark('reloaded');
    expect([home.match, home.announcements], 'no match after the reload').toEqual([null, null]);

    // The hints stay cleared after it (M4-Q28): a new Practice's Pre-match, a bark and the pad's stick used,
    // shows no panel, the profile's masks holding all six for the keyboard and the pad.
    await run.practice('prematchAfterReload');
    // Barked once your terrier is in view, as the warm-up's first bark is (a bark mark is counted as it's drawn).
    await run.until((i) => overlayOf(i)?.mine?.shown === true && i.render.camera.view === 'ball', { what: 'your mark, in ball view, after the reload', timeoutMs: SHOWN_MS });
    await presses(run, 'KeyQ', barked, 'a bark after the reload');
    await runs(run, 'KeyW', 'pad');
    const cleared = await run.hints(null, [], 'none after the reload, every control used before it');
    expect(hintsOf(cleared), 'the keyboard and the pad used here, each with all six cleared').toMatchObject({
      seen: ['keyboard', 'gamepad'], used: { keyboard: ALL_SIX, touch: ALL_SIX, gamepad: ALL_SIX },
    });
    await leave(run, 'after the reload');

    // Settings' Show control hints again from Home, by the pad alone (L82): Home's d-pad to Settings, its
    // Start; Settings' d-pad to the button, its Start, the status saying so; then Back, Home again.
    await dpad(run, PAD.down, ['propose', 'join', 'practice', 'settings'], 'Home');
    await run.pad(PAD.start, "Settings, by the pad's Start");
    await run.until((i) => i.screen === 'settings', { what: "Settings, by the pad's Start", timeoutMs: SHOWN_MS });
    await dpad(run, PAD.down, ['quality-high', 'quality-low', 'sound', 'names', 'ball-view', 'calm-camera', 'mirror-touch', 'hints-again'], 'Settings');
    await run.pad(PAD.start, "Show control hints again, by the pad's Start");
    await expect(page.locator('[data-test="settings-message"]'), 'Show control hints again, said').toHaveText(HINTS_AGAIN, { timeout: SHOWN_MS });
    // Said where it's seen, at the window's foot, though the status line sits below the screen's fold (P4).
    await expect(page.locator('[data-test="settings-message"]'), 'Show control hints again, said in view').toBeInViewport();
    await dpad(run, PAD.down, ['back'], 'Settings');
    await run.pad(PAD.start, "Settings' Back, by the pad's Start");
    await run.until((i) => i.screen === 'home', { what: "Home, by Settings' Back", timeoutMs: SHOWN_MS });
    await expectFocusOnce(page, 'h1', 'terriest', "Home's heading, back from Settings (Q-17)");

    // And a new Practice's Pre-match shows the keyboard's hints again from its first use, then the pad's
    // (§9.5, M4-Q28), the touch's cleared too, from the all six seeded.
    await clearReadyStates(page);
    await run.practice('prematchHintsAgain');
    await run.until((i) => overlayOf(i)?.mine?.shown === true && i.render.camera.view === 'ball', { what: 'your mark, in ball view, the hints shown again', timeoutMs: SHOWN_MS });
    await presses(run, 'KeyQ', barked, 'a bark, the hints shown again');
    await run.hints('keyboard', left('bark'), "the keyboard's again, once Q barked");
    await runs(run, 'KeyW', 'pad');
    const again = await run.hints('gamepad', left('run'), "the pad's again, once its stick ran");
    expect(hintsOf(again)?.used, 'each kind cleared, then only what was used here').toEqual({ keyboard: 1 << SIX.indexOf('bark'), touch: 0, gamepad: 1 << SIX.indexOf('run') });
    run.mark('hintsAgain');
    await expectNothingContacted(page, guard, { origin: originOf(baseURL) });
  });
});
