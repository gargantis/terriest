// The menus by the gamepad alone, through the real page (L82, Q-17; M4's
// design, research/m4/DESIGN.md, §4.4, §4.9, §5.14; phase 2a's review), in
// each engine, the stubbed pad's d-pad, Start and Back the only input:
// Home's nav to Settings; Settings' d-pad through its controls, Start
// turning Sound off, and on down to Back, at the foot of a screen taller
// than the gate's window, which the nav brings into view; Back to Home;
// Propose, its pack size and length chosen by the d-pad's left and right,
// a step past the last size going no further, and Back, creating nothing;
// Practice's setup likewise, 1 a side and 1 minute, and its Start, the
// match made at what was chosen; on Pre-match the pad's Back opening the
// menu, its Settings panel, Start turning Sound on again there, the d-pad
// down to Show control hints again below the panel's fold and back up to
// the first radio, each focus brought into the panel's view clear of its
// sticky head; and the pad's Back closing the menu. Every read polls the
// hook or the DOM, never animation frames (C-6). New at M4, by phase 2a's
// review; the choices by phase 2b (§4.9's pad parts, extended). Its
// timeouts by e2e/lib/practice.ts' margins (phase 2b's review, specs-F9):
// each press's effect is SHOWN_MS's kind, a pad's press, which phase 2b
// measured at most 857 ms; the whole test ran 7.7 to 8.9 s an engine, made
// as long as a hang in its longest wait, the start's 30 s, would make it,
// × 2, as the touch tests' are: (8.9 + 30) × 2 = 77.8 s.

import type { Page } from '@playwright/test';
import { config } from '../src/config';
import { personId } from '../src/core/bot/bot-id';
import { PAD, installGamepad, press } from './lib/gamepad';
import { expect, expectWebGL2, test } from './lib/guards';
import { expectStarted, inspect, installHook, seedStorage, smallViewport, waitForInspection, waitForScreen } from './lib/page';
import { SHOWN_MS } from './lib/practice';

test.use({ viewport: smallViewport });

const PAD_MENUS_TEST_MS = 80_000;

/** What has the focus, and its box against the window and, inside the Settings panel, the panel's view
 *  under its sticky head; a half pixel's slack for the engines' rounding. */
interface FocusBox {
  readonly what: string;
  readonly inWindow: boolean;
  /** Inside the panel's box and below its head; null outside the panel. */
  readonly inPanel: boolean | null;
}

function focusBox(page: Page): Promise<FocusBox> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a === null || a === document.body) return { what: 'nothing', inWindow: false, inPanel: null };
    const r = a.getBoundingClientRect();
    const panel = a.closest('.settings-panel');
    const head = panel?.querySelector('.settings-panel-head') ?? null;
    const inPanel = panel === null || head === null || head.contains(a)
      ? null
      : r.top >= head.getBoundingClientRect().bottom - 0.5 && r.bottom <= panel.getBoundingClientRect().bottom + 0.5;
    return { what: a.getAttribute('data-test') ?? a.tagName.toLowerCase(), inWindow: r.top >= -0.5 && r.bottom <= innerHeight + 0.5, inPanel };
  });
}

/** `n` presses of a d-pad button, each landing on the next of `expected`'s controls, every one in view. */
async function dpad(page: Page, button: number, expected: readonly string[], why: string): Promise<void> {
  for (const want of expected) {
    await press(page, button, SHOWN_MS);
    const f = await focusBox(page);
    expect(f.what, `${why}: the focus`).toBe(want);
    expect(f.inWindow, `${why}: ${want} inside the window (§5.14)`).toBe(true);
    if (f.inPanel !== null) expect(f.inPanel, `${why}: ${want} in the panel's view, clear of its head (§5.14)`).toBe(true);
  }
}

/** Presses of the d-pad's left or right on a focused select, its value after each as `values` says, the focus
 *  staying on it. */
async function choose(page: Page, button: number, select: string, values: readonly string[], why: string): Promise<void> {
  for (const want of values) {
    await press(page, button, SHOWN_MS);
    await expect(page.locator(`[data-test="${select}"]`), `${why}: ${select}`).toHaveValue(want, { timeout: SHOWN_MS });
    expect((await focusBox(page)).what, `${why}: the focus on ${select}`).toBe(select);
  }
}

test('a gamepad alone works Settings from Home and in the match menu, and the choices of Propose and Practice\'s setup, every focus brought into view (L82)', async ({ page }) => {
  test.setTimeout(PAD_MENUS_TEST_MS);
  await expectWebGL2(page);
  await seedStorage(page, { profile: { playerId: personId(7, 0) }, settings: { quality: 'low' } });
  await installHook(page);
  await installGamepad(page);
  await page.goto('./');
  await expectStarted(page);
  await waitForScreen(page, 'home', SHOWN_MS);
  expect((await inspect(page)).gamepad?.connected, 'the stubbed pad').toBe(true);

  // Home's nav: Propose a match, Join, Practice, Settings; Start opens Settings.
  await dpad(page, PAD.down, ['propose', 'join', 'practice', 'settings'], "Home's nav");
  await press(page, PAD.start, SHOWN_MS);
  await waitForScreen(page, 'settings', SHOWN_MS);

  // Settings: Sound off by Start, as a click would, and the page's sound follows it.
  await dpad(page, PAD.down, ['quality-high', 'quality-low', 'sound'], "Settings' nav");
  await press(page, PAD.start, SHOWN_MS);
  await waitForInspection(page, (i) => i.audio?.enabled === false, { what: "Sound off by the pad's Start", timeoutMs: SHOWN_MS });
  await expect(page.locator('[data-test="sound"]')).not.toBeChecked();
  // On to Back, at the foot of a screen taller than the window: each focus scrolled into view.
  await dpad(page, PAD.down, ['names', 'ball-view', 'calm-camera', 'mirror-touch', 'hints-again', 'back'], "Settings' nav to Back");
  await press(page, PAD.start, SHOWN_MS);
  await waitForScreen(page, 'home', SHOWN_MS);

  // Propose by the pad: the pack size up past the last, and the length down a minute, then Back, creating
  // nothing: the d-pad's left and right step a focused choice, its up and down move on (§4.9).
  await dpad(page, PAD.down, ['propose'], "Home's nav to Propose");
  await press(page, PAD.start, SHOWN_MS);
  await waitForScreen(page, 'propose', SHOWN_MS);
  await dpad(page, PAD.down, ['pack-size'], "Propose's nav");
  const sizes = Array.from({ length: config.packSizeMax - config.packSizeDefault }, (_, k) => String(config.packSizeDefault + k + 1));
  await choose(page, PAD.right, 'pack-size', [...sizes, String(config.packSizeMax)], "Propose's size, to the last and no further");
  await dpad(page, PAD.down, ['match-length'], "Propose's nav");
  await choose(page, PAD.left, 'match-length', [String(config.matchLengthDefaultMinutes - 1)], "Propose's length");
  await dpad(page, PAD.down, ['create', 'back'], "Propose's nav to Back");
  await press(page, PAD.start, SHOWN_MS);
  await waitForScreen(page, 'home', SHOWN_MS);
  expect((await inspect(page)).match, 'no match proposed').toBeNull();

  // Practice's setup by the pad: 1 a side and 1 minute, then Start, the match made at both.
  await dpad(page, PAD.down, ['propose', 'join', 'practice'], "Home's nav to Practice");
  await press(page, PAD.start, SHOWN_MS);
  await waitForScreen(page, 'practice', SHOWN_MS);
  await dpad(page, PAD.down, ['pack-size'], "Practice's setup");
  const down = Array.from({ length: config.packSizeDefault - config.packSizeMin }, (_, k) => String(config.packSizeDefault - k - 1));
  await choose(page, PAD.left, 'pack-size', [...down, String(config.packSizeMin)], "Practice's size, to 1 a side and no further");
  await dpad(page, PAD.down, ['match-length'], "Practice's setup");
  const minutes = Array.from({ length: config.matchLengthDefaultMinutes - 1 }, (_, k) => String(config.matchLengthDefaultMinutes - k - 1));
  await choose(page, PAD.left, 'match-length', minutes, "Practice's length, to 1 minute");
  await dpad(page, PAD.down, ['start'], "Practice's setup");
  await press(page, PAD.start, SHOWN_MS);
  await waitForScreen(page, 'prematch', SHOWN_MS);
  const made = await waitForInspection(page, (i) => i.match?.inRoster === true, { what: 'the person in the final roster', timeoutMs: SHOWN_MS });
  expect([made.match!.roster.map((r) => r.pack), made.match!.clock], 'the person in A and a bot in B, a match of 1 minute (Q-15)')
    .toEqual([[0, 1], 60 * config.ticksPerSecond]);

  // The match menu by the pad's Back, its Settings panel by Start.
  await press(page, PAD.back, SHOWN_MS);
  await waitForInspection(page, (i) => i.menu === 'menu' && i.match?.paused === true, { what: "the menu by the pad's Back", timeoutMs: SHOWN_MS });
  await dpad(page, PAD.down, ['menu-settings'], "the menu's nav");
  await press(page, PAD.start, SHOWN_MS);
  await waitForInspection(page, (i) => i.menu === 'settings', { what: "the Settings panel by the pad's Start", timeoutMs: SHOWN_MS });
  // Its checks and radios by the pad too: Sound on again, the page's sound with it.
  await dpad(page, PAD.down, ['back', 'quality-high', 'quality-low', 'sound'], "the panel's nav");
  await press(page, PAD.start, SHOWN_MS);
  await waitForInspection(page, (i) => i.audio?.enabled === true, { what: "Sound on by the pad's Start in the panel", timeoutMs: SHOWN_MS });
  // Down past the panel's fold, and back up to its first radio, under the sticky head.
  await dpad(page, PAD.down, ['names', 'ball-view', 'calm-camera', 'mirror-touch', 'hints-again'], "the panel's nav past its fold");
  await dpad(page, PAD.up, ['mirror-touch', 'calm-camera', 'ball-view', 'names', 'sound', 'quality-low', 'quality-high'], "the panel's nav back up");
  // The pad's Back closes the menu from the panel, and Practice plays on.
  await press(page, PAD.back, SHOWN_MS);
  await waitForInspection(page, (i) => i.menu === 'closed' && i.match?.paused === false, { what: "the menu closed by the pad's Back", timeoutMs: SHOWN_MS });
});
