// Touch through the real page (PLAN D-29, D-30, L78, L169, L170, L284; M4's
// design, research/m4/DESIGN.md, §4.3, §4.7, §5.13, §5.14, §9.3's
// touch.spec.ts, §9.6), in Chromium, whose touches CDP sends several at
// once (e2e/lib/touch.ts), in a context with touch, on Practice's Pre-match
// played as e2e/lib/practice.ts plays it, at the gate's 640 × 360 and
// stored low quality, Home and the setup by keys, since a mouse's press
// hides the control layer:
// - the control layer hidden until the page's first touch, then shown;
// - the stick: its base where the thumb lands, A's step from a thumb moved
//   left, the terrier running sideways in ball view; past its rim zoomies,
//   held until the thumb comes back inside it; the touch hints from its
//   first use, and axe on the control layer with the hints showing;
// - jump and pounce held at once by two thumbs, both pressed, lifted
//   together; a thumb that slides off its button holding it, by pointer
//   capture, until it lifts; bark and view, each pressed by a tap, view
//   twice, back to ball view; each touch hint clearing as its control is
//   used, the panel gone with the sixth;
// - a touch inside the edge margin, even one that slides into the stick's
//   area, never moving the stick, and one just inside it taking it;
// - the mirrored layout, chosen by touch in the match menu's Settings
//   panel, putting the stick on the right and the buttons on the left, the
//   stick's steps still the screen's;
// - a phone held upright (412 × 915, with touch) showing the turn prompt
//   on Pre-match, axe on it, and turned sideways (915 × 412) clearing it.
// Every look polls the hook every 50 ms, never on animation frames (C-6).
// New at M4.

import type { Page } from '@playwright/test';
import { heldDirection, stepOf } from '../src/core/sim/input';
import { ZOOMING } from '../src/core/sim/state';
import type { Inspection } from '../src/main';
import { expect, expectWebGL2, test } from './lib/guards';
import { expectAxeClean, hintsOf, hudOf, smallViewport, touchOf, turnOf } from './lib/page';
import { expectNothingContacted, focused, PracticeRun, SHOWN_MS } from './lib/practice';
import { boxOf, Fingers, type Point, pointIn } from './lib/touch';

test.skip(({ browserName }) => browserName !== 'chromium', "touches go through Chromium's CDP, several at once (M4's design §9.3)");

/** Each test's whole timeout, from phase 2b's measured runs, × 2 as e2e/lib/practice.ts' whole tests are:
 *  its worst run, made as long as a hang in its longest wait would make it, the start's 30 s
 *  (expectStarted), so each wait inside it fails first, with its own message. The control layer's ran
 *  6.5 s at worst (load 7.23), (6.5 + 30) × 2 = 73 s; the phone's 2.5 s (load 1.05), (2.5 + 30) × 2 = 65 s. */
const TOUCH_TEST_MS = 75_000;
const PHONE_TEST_MS = 65_000;
/** How far the stick's thumb moves from its base: inside the rim (its travel is 56 CSS px, src/input/touch.ts),
 *  past the dead zone, and past the rim for zoomies. Test distances, not settings. */
const INSIDE_PX = 40;
const BEYOND_PX = 80;
/** How far the terrier must run its way to count, as e2e/practice.spec.ts' runs. */
const MOVED_M = 0.5;
/** A.2's step for a thumb moved left of its base, screen-relative: a quarter turn counter-clockwise from up,
 *  8 of 32, the validated sideways step in ball view. */
const LEFT_STEP = 8;
/** The touch panel's six lines, in its order (src/input/hints.ts' CONTROLS). */
const SIX = ['run', 'zoomies', 'jump', 'pounce', 'bark', 'view'] as const;

type Mine = NonNullable<NonNullable<Inspection['match']>['mine']>;
const mine = (i: Inspection): Mine => i.match!.mine!;

/** The origin every request stays under (P10): the preview's. */
const originOf = (baseURL: string | undefined): string => `${new URL(baseURL!).origin}/`;

/** A point where nothing on Pre-match takes a press, the control layer hidden: the pitch's middle, clear of
 *  the HUD's bar and Pre-match's panel at the gate's 640 × 360. */
const PITCH = { x: 200, y: 150 } as const;

/** The terrier's run from where it stands, along a way turned `turn` radians counter-clockwise from the ball
 *  line then, as the stick held now runs it. */
function runAlong(at: Inspection, turn: number): (i: Inspection) => number {
  const from = mine(at);
  const way = Math.atan2(at.match!.ball.y - from.y, at.match!.ball.x - from.x) + turn;
  return (i) => (mine(i).x - from.x) * Math.cos(way) + (mine(i).y - from.y) * Math.sin(way);
}

/** The stick's thumb down at `at`, then moved left of it inside the rim: held, A.2's sideways step read, and
 *  the terrier running sideways in ball view. Returns the finger, still down. */
async function stickLeft(run: PracticeRun, f: Fingers, at: Point, what: string): Promise<number> {
  const start = await run.poll();
  const id = await f.press(at);
  await run.until((i) => touchOf(i)?.stick.held === true, { what: `the stick taking the thumb, ${what}`, timeoutMs: SHOWN_MS });
  await f.move(id, { x: at.x - INSIDE_PX, y: at.y }, 4);
  const along = runAlong(start, Math.PI / 2);
  const ran = await run.until((i) => touchOf(i)?.stick.step === LEFT_STEP && along(i) >= MOVED_M, { what: `the terrier run sideways by the stick, ${what}`, timeoutMs: SHOWN_MS });
  const input = ran.controls!.lastInput!;
  expect([heldDirection(input), stepOf(input)], `the stick's step in the input, ${what}`).toEqual([true, LEFT_STEP]);
  return id;
}

/** Taps a button of the control layer, by its data-test, and looks until `shown` holds of what it did. */
async function taps(run: PracticeRun, f: Fingers, button: string, shown: (i: Inspection, before: Inspection) => boolean, what: string): Promise<Inspection> {
  const before = await run.poll();
  await f.tap(await pointIn(run.page, button));
  return run.until((i) => shown(i, before), { what, timeoutMs: SHOWN_MS });
}

/** The point at the middle of an element's box, scrolled into view first: a control a finger can reach. */
async function reach(page: Page, test: string): Promise<Point> {
  await page.locator(`[data-test="${test}"]`).scrollIntoViewIfNeeded();
  return pointIn(page, test);
}

test.describe('the control layer', () => {
  // The gate's window and stored low quality, as every spec on the pitch draws (§9.1), with touch.
  test.use({ hasTouch: true, viewport: smallViewport });

  test('the stick, its rim, the buttons held, slid off and tapped, the edge margin, the touch hints, axe and the mirrored layout', async ({ page, guard, baseURL }, testInfo) => {
    test.setTimeout(TOUCH_TEST_MS);
    const run = new PracticeRun(page, testInfo, 'touch');
    await run.measured(async () => {
      await expectWebGL2(page);
      await run.load('./');
      const pre = await run.practice();
      // Hidden until a touch: Home and the setup went by keys (§4.3).
      expect(touchOf(pre), 'the control layer before any touch').toMatchObject({ mode: null, shown: false });
      await expect(page.locator('[data-test="touch"]')).toBeHidden();
      const f = await Fingers.on(page);
      try {
        // The page's first touch shows it, on the pitch where nothing takes it.
        await f.tap(PITCH);
        await run.until((i) => touchOf(i)?.shown === true && touchOf(i)?.mode === 'touch', { what: 'the control layer, after the first touch', timeoutMs: SHOWN_MS });
        await expect(page.locator('[data-test="touch"]')).toBeVisible();
        expect(hintsOf(await run.poll())?.shown, 'no hints until a control is used').toBeNull();

        // The stick (§4.3): its base where the thumb lands in its area, the lower half of the left side; A's
        // step from a thumb moved left, the terrier running sideways; the touch hints from its first use.
        const stickAt = await pointIn(page, 'touch-stick', 0.5, 0.6);
        const stick = await stickLeft(run, f, stickAt, 'its first use');
        expect(touchOf(await run.poll())?.stick.base, "the base where the thumb landed").toEqual(stickAt);
        await run.hints('touch', SIX.filter((c) => c !== 'run'), 'once the stick ran');
        // axe on the control layer, its hints panel showing (§9.6), the thumb still down.
        await expectAxeClean(page);
        // Past the rim: zoomies, the HUD's meter falling, held until the thumb comes back inside (C-20).
        await f.move(stick, { x: stickAt.x - BEYOND_PX, y: stickAt.y }, 4);
        await run.until((i) => touchOf(i)?.stick.zoomies === true && mine(i).anim === ZOOMING && (hudOf(i)?.meter ?? 1) < 1, {
          what: "zoomies past the stick's rim, the meter falling", timeoutMs: SHOWN_MS,
        });
        await run.hints('touch', ['jump', 'pounce', 'bark', 'view'], 'once the rim zoomed');
        await f.move(stick, { x: stickAt.x - INSIDE_PX, y: stickAt.y }, 4);
        await run.until((i) => touchOf(i)?.stick.zoomies === false && touchOf(i)?.stick.step === LEFT_STEP, { what: 'zoomies let go, the thumb back inside the rim', timeoutMs: SHOWN_MS });
        await f.lift(stick);
        await run.until((i) => touchOf(i)?.stick.held === false && !heldDirection(i.controls!.lastInput!), { what: 'the stick let go, no direction', timeoutMs: SHOWN_MS });

        // Jump and pounce held at once by two thumbs, both pressed, then lifted together (§4.3).
        const before = await run.poll();
        await f.press(await pointIn(page, 'touch-jump'));
        await f.press(await pointIn(page, 'touch-pounce'));
        const both = await run.until((i) => (touchOf(i)?.held.length ?? 0) === 2, { what: 'jump and pounce held at once', timeoutMs: SHOWN_MS });
        expect(touchOf(both)?.held, 'both held').toEqual(['jump', 'pounce']);
        const pressed = await run.until((i) => mine(i).takeOffTick !== mine(before).takeOffTick && i.controls!.presses.pounce > before.controls!.presses.pounce, {
          what: 'the jump and the pounce, both pressed', timeoutMs: SHOWN_MS,
        });
        expect(pressed.controls!.presses.jump, 'the jump pressed once').toBe(before.controls!.presses.jump + 1);
        await run.hints('touch', ['bark', 'view'], 'once jump and pounce were pressed');
        await f.liftAll();
        await run.until((i) => touchOf(i)?.held.length === 0, { what: 'both let go, lifted together', timeoutMs: SHOWN_MS });

        // A thumb that slides off its button still holds it, by pointer capture, and lets it go as it lifts.
        const jumpAt = await pointIn(page, 'touch-jump');
        const slide = await f.press(jumpAt);
        await run.until((i) => touchOf(i)?.held.includes('jump') === true, { what: 'jump held, before the slide', timeoutMs: SHOWN_MS });
        await f.move(slide, { x: jumpAt.x - 150, y: jumpAt.y - 120 }, 6);
        expect(touchOf(await run.poll())?.held, 'jump still held, the thumb slid off it').toEqual(['jump']);
        await f.lift(slide);
        await run.until((i) => touchOf(i)?.held.length === 0, { what: 'jump let go as the slid thumb lifts', timeoutMs: SHOWN_MS });

        // Bark and view by taps: the bark's mark and the drawer's bark; chase view, the sixth control, the
        // panel gone; then ball view again.
        await taps(run, f, 'touch-bark', (i, b) => i.announcements!.barksShown > b.announcements!.barksShown
          && i.render.drawer!.overlaysShown.barking > b.render.drawer!.overlaysShown.barking, "the bark button: its mark and the drawer's bark");
        await run.hints('touch', ['view'], 'once the bark button barked');
        await taps(run, f, 'touch-view', (i) => i.render.camera.view === 'chase', 'the view button: chase view');
        await run.hints(null, [], 'every touch control used: the panel gone');
        await taps(run, f, 'touch-view', (i) => i.render.camera.view === 'ball', 'the view button: ball view again');
        const presses = touchOf(await run.poll())!.presses;
        expect(presses, "the buttons' presses: jump twice, the slid one too").toEqual({ jump: 2, pounce: 1, bark: 1, view: 2 });

        // The edge margin (D-29): a thumb inside it, even one sliding into the stick's area, never takes the
        // stick, so nothing runs; one just inside the margin does.
        const margin = await boxOf(page, 'touch-stick');
        const edge = { x: margin.x / 2, y: stickAt.y };
        const ignored = await run.poll();
        const edgeThumb = await f.press(edge);
        await f.move(edgeThumb, { x: margin.x + INSIDE_PX, y: edge.y }, 4);
        await page.waitForTimeout(SHOWN_MS / 10);
        const after = await run.poll();
        expect({ held: touchOf(after)?.stick.held, refused: touchOf(after)?.refused, direction: heldDirection(after.controls!.lastInput!) },
          `a thumb in the margin, ${margin.x} px wide, at ${edge.x}`).toEqual({ held: false, refused: touchOf(ignored)?.refused, direction: false });
        await f.lift(edgeThumb);
        const inside = await f.press({ x: margin.x + 8, y: stickAt.y });
        await run.until((i) => touchOf(i)?.stick.held === true, { what: 'a thumb just inside the margin, the stick taking it', timeoutMs: SHOWN_MS });
        await f.lift(inside);
        await run.until((i) => touchOf(i)?.stick.held === false, { what: 'the stick let go again', timeoutMs: SHOWN_MS });
        // No touch on the pitch or its controls took the focus from Ready, so Enter still presses it (§4.9).
        expect(await focused(page), 'Ready, still focused through every touch').toBe('ready');

        // The mirrored layout, chosen by touch in the menu's Settings panel (PLAN §11), applies at once: the
        // stick on the right half, the buttons on the left, the words unturned, and the stick's steps still
        // the screen's.
        await f.tap(await pointIn(page, 'menu-button'));
        await run.until((i) => i.menu === 'menu', { what: "the menu, by the HUD's Menu button", timeoutMs: SHOWN_MS });
        await f.tap(await pointIn(page, 'menu-settings'));
        await run.until((i) => i.menu === 'settings', { what: 'the Settings panel, by its button', timeoutMs: SHOWN_MS });
        await f.tap(await reach(page, 'mirror-touch'));
        await expect(page.locator('[data-test="mirror-touch"]'), 'the mirrored layout, chosen').toBeChecked();
        await f.tap(await reach(page, 'back'));
        await run.until((i) => i.menu === 'closed' && touchOf(i)?.mirrored === true, { what: "the panel's Back, the layout mirrored", timeoutMs: SHOWN_MS });
        const width = page.viewportSize()!.width;
        const right = await boxOf(page, 'touch-stick');
        expect(right.x, 'the stick on the right half').toBeGreaterThanOrEqual(width / 2 - 1);
        for (const b of ['touch-jump', 'touch-pounce', 'touch-bark', 'touch-view']) {
          const box = await boxOf(page, b);
          expect(box.x + box.width, `${b} on the left half`).toBeLessThanOrEqual(width / 2);
        }
        await expect(page.locator('[data-test="touch-jump"]'), 'the words unturned').toHaveText('Jump');
        const mirroredStick = await stickLeft(run, f, await pointIn(page, 'touch-stick', 0.5, 0.6), 'the stick mirrored');
        await f.lift(mirroredStick);
        await run.until((i) => touchOf(i)?.stick.held === false, { what: 'the mirrored stick let go', timeoutMs: SHOWN_MS });
      } finally {
        await f.liftAll();
        await f.detach();
      }
      await expectNothingContacted(page, guard, { origin: originOf(baseURL) });
    });
  });
});

test.describe('a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 412, height: 915 } });

  test('held upright shows the turn prompt on Pre-match, axe clean, and turned sideways clears it', async ({ page, guard, baseURL }, testInfo) => {
    test.setTimeout(PHONE_TEST_MS);
    const run = new PracticeRun(page, testInfo, 'touch');
    await run.measured(async () => {
      await expectWebGL2(page);
      await run.load('./');
      const pre = await run.practice();
      const upright = await run.until((i) => turnOf(i)?.shown === true, { what: 'the turn prompt, upright', timeoutMs: SHOWN_MS });
      expect(turnOf(upright), 'a phone, upright (D-30)').toMatchObject({ phone: true, upright: true, shown: true });
      expect(turnOf(pre)?.phone, "the phone told on Pre-match's first look").toBe(true);
      const prompt = page.locator('[data-test="turn"]');
      await expect(prompt).toBeVisible();
      await expect(prompt.getByRole('heading', { level: 2 })).toHaveText('Turn your phone sideways to play');
      await expectAxeClean(page);
      // Sideways: the prompt goes, still a phone (L170).
      await page.setViewportSize({ width: 915, height: 412 });
      const sideways = await run.until((i) => turnOf(i)?.shown === false, { what: 'the turn prompt gone, sideways', timeoutMs: SHOWN_MS });
      expect(turnOf(sideways), 'a phone, sideways').toMatchObject({ phone: true, upright: false, shown: false });
      await expect(prompt).toBeHidden();
      await expectNothingContacted(page, guard, { origin: originOf(baseURL) });
    });
  });
});
