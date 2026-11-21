// The menus by the gamepad alone, through the real page (L82, Q-17; M4's
// design, research/m4/DESIGN.md, §4.4, §4.9, §5.14; phase 2a's review), in
// each engine, the stubbed pad's d-pad, Start and Back the only input:
// Home's nav to Settings; Settings' d-pad through its controls, Start
// turning Sound off, and on down to Back, at the foot of a screen taller
// than the gate's window, which the nav brings into view; Back to Home,
// then Practice's setup and its Start; on Pre-match the pad's Back opening
// the menu, its Settings panel, Start turning Sound on again there, the
// d-pad down to Show control hints again below the panel's fold and back up
// to the first radio, each focus brought into the panel's view clear of
// its sticky head; and the pad's Back closing the menu. Every read polls
// the hook, never animation frames (C-6). New at M4, by phase 2a's review.

import type { Page } from '@playwright/test';
import { personId } from '../src/core/bot/bot-id';
import { PAD, installGamepad, press } from './lib/gamepad';
import { expect, expectWebGL2, test } from './lib/guards';
import { expectStarted, inspect, installHook, seedStorage, smallViewport, waitForInspection, waitForScreen } from './lib/page';

test.use({ viewport: smallViewport });

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
    await press(page, button);
    const f = await focusBox(page);
    expect(f.what, `${why}: the focus`).toBe(want);
    expect(f.inWindow, `${why}: ${want} inside the window (§5.14)`).toBe(true);
    if (f.inPanel !== null) expect(f.inPanel, `${why}: ${want} in the panel's view, clear of its head (§5.14)`).toBe(true);
  }
}

test('a gamepad alone works Settings from Home and in the match menu, and Practice\'s setup, every focus brought into view (L82)', async ({ page }) => {
  test.setTimeout(90_000);
  await expectWebGL2(page);
  await seedStorage(page, { profile: { playerId: personId(7, 0) }, settings: { quality: 'low' } });
  await installHook(page);
  await installGamepad(page);
  await page.goto('./');
  await expectStarted(page);
  await waitForScreen(page, 'home');
  expect((await inspect(page)).gamepad?.connected, 'the stubbed pad').toBe(true);

  // Home's nav: Propose a match, Join, Practice, Settings; Start opens Settings.
  await dpad(page, PAD.down, ['propose', 'join', 'practice', 'settings'], "Home's nav");
  await press(page, PAD.start);
  await waitForScreen(page, 'settings');

  // Settings: Sound off by Start, as a click would, and the page's sound follows it.
  await dpad(page, PAD.down, ['quality-high', 'quality-low', 'sound'], "Settings' nav");
  await press(page, PAD.start);
  await waitForInspection(page, (i) => i.audio?.enabled === false, { what: "Sound off by the pad's Start", timeoutMs: 5_000 });
  await expect(page.locator('[data-test="sound"]')).not.toBeChecked();
  // On to Back, at the foot of a screen taller than the window: each focus scrolled into view.
  await dpad(page, PAD.down, ['names', 'ball-view', 'calm-camera', 'mirror-touch', 'hints-again', 'back'], "Settings' nav to Back");
  await press(page, PAD.start);
  await waitForScreen(page, 'home');

  // Practice's setup by the pad, and its Start.
  await dpad(page, PAD.down, ['propose', 'join', 'practice'], "Home's nav to Practice");
  await press(page, PAD.start);
  await waitForScreen(page, 'practice');
  await dpad(page, PAD.down, ['start'], "Practice's setup");
  await press(page, PAD.start);
  await waitForScreen(page, 'prematch');

  // The match menu by the pad's Back, its Settings panel by Start.
  await press(page, PAD.back);
  await waitForInspection(page, (i) => i.menu === 'menu' && i.match?.paused === true, { what: "the menu by the pad's Back", timeoutMs: 5_000 });
  await dpad(page, PAD.down, ['menu-settings'], "the menu's nav");
  await press(page, PAD.start);
  await waitForInspection(page, (i) => i.menu === 'settings', { what: "the Settings panel by the pad's Start", timeoutMs: 5_000 });
  // Its checks and radios by the pad too: Sound on again, the page's sound with it.
  await dpad(page, PAD.down, ['back', 'quality-high', 'quality-low', 'sound'], "the panel's nav");
  await press(page, PAD.start);
  await waitForInspection(page, (i) => i.audio?.enabled === true, { what: "Sound on by the pad's Start in the panel", timeoutMs: 5_000 });
  // Down past the panel's fold, and back up to its first radio, under the sticky head.
  await dpad(page, PAD.down, ['names', 'ball-view', 'calm-camera', 'mirror-touch', 'hints-again'], "the panel's nav past its fold");
  await dpad(page, PAD.up, ['mirror-touch', 'calm-camera', 'ball-view', 'names', 'sound', 'quality-low', 'quality-high'], "the panel's nav back up");
  // The pad's Back closes the menu from the panel, and Practice plays on.
  await press(page, PAD.back);
  await waitForInspection(page, (i) => i.menu === 'closed' && i.match?.paused === false, { what: "the menu closed by the pad's Back", timeoutMs: 5_000 });
});
