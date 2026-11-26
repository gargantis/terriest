// The match rules through the real page, in each engine (C-59; PLAN §10,
// §11, A.3), at the gate's 640 × 360 and stored low quality, a seeded
// profile, every read the hook's, polled every 50 ms, never on animation
// frames (C-6):
// - Practice's setup: its Rules row at the defaults, and Rules… to the
//   Rules screen, axe on both; a rule chosen by the arrows, the browser's
//   own keys on its select, and another by its select, each stored at once
//   as A.3's record says and the status line saying so; Back to the setup
//   with its pack size kept, the focus on Rules… and the rules in its
//   summary;
// - a reload keeps them; Reset to defaults sets every rule to its default,
//   the record to none and the button to say it can do nothing more;
// - a Practice under a 1 s zoomies meter: the hook's settings carry the
//   rule, and Pre-match lists it; in its warm-up, the meter full by the
//   hook's share and by the HUD's gauge, each over the match's own full
//   meter, where the build's 3 s meter would make both read a third; then
//   zoomies, Shift with W, drain it at the rule's rate exactly, its drain a
//   tick over its full meter, a 60th of it a tick, where the default's
//   would drain a 180th: the simulation plays by the rule. The rate is
//   taken between two looks at least 6 ticks apart in one zoom, each
//   showing the terrier zooming from the same tick, its meter neither full
//   nor empty, and each look's meter and tick from one head state, so a
//   look's lateness changes neither; a hold whose second look comes after
//   the meter has run out is let go, and tried again from a full meter.
// The guard watches the page, which contacts nothing: Practice opens no
// room.

import type { Page } from '@playwright/test';
import { config } from '../src/config';
import { personId } from '../src/core/bot/bot-id';
import { ZOOMING } from '../src/core/sim/state';
import type { Inspection } from '../src/main';
import { expect, expectWebGL2, test } from './lib/guards';
import {
  expectAxeClean, expectStarted, hudOf, inspect, installHook, seedStorage, smallViewport, storedRules, waitForInspection, waitForScreen,
} from './lib/page';
import { chooseByKeys, PREPARED_MS, READY_ACTS_MS, SHOWN_MS } from './lib/practice';

test.use({ viewport: smallViewport });

/** The specs' seed: personId(7, k) (§9.1). */
const ME = personId(7, 0);
/** The shortest zoomies meter on offer, and a run speed that isn't the default. */
const METER_SECONDS = config.matchRules.zoomiesFullSeconds[0];
const RUN_SPEED = config.matchRules.runSpeedMetresPerSecond.find((v) => v !== config.runSpeedMetresPerSecond)!;
/** A full meter's ticks of zoomies under the rule, and under the default: a zooming tick drains the meter's
 *  units a tick, its half-ticks, so a meter of t seconds holds t seconds of ticks' worth (A.1). */
const RULE_TICKS = METER_SECONDS * config.ticksPerSecond;
const DEFAULT_TICKS = config.zoomiesFullSeconds * config.ticksPerSecond;
/** The share of a full meter a zooming tick drains under the rule, 1 / RULE_TICKS: its units a tick over its
 *  full meter's units; and under the default, 1 / DEFAULT_TICKS, a third of it. */
const UNITS = config.zoomiesMeterUnitsPerTick;
const RULE_DRAIN = UNITS / (RULE_TICKS * UNITS);
const DEFAULT_DRAIN = UNITS / (DEFAULT_TICKS * UNITS);
/** The two looks the drain is taken between: at least this many ticks apart by the head's tick. */
const LOOK_TICKS = 6; // not a setting: the spec's gap
/** The drain between two looks in one zoom is whole units over the full meter's, exact but for a division's
 *  rounding, so it's compared to this many decimal places. */
const EXACT_DIGITS = 12; // not a setting: the comparison's places
/** Holds of zoomies from a full meter, each let go once its looks are taken: one whose second look comes
 *  after the meter has run out, a look late by a frame drawn in software, is tried again. */
const HOLDS = 3; // not a setting: the spec's tries
/** A meter refilling from empty, in the rule's refill time, the meter's in the build's proportion
 *  (matchConfig): a wait the page's clock sets, so 1.5 × its seconds + 2 s, as e2e/lib/practice.ts' are,
 *  rounded up to a second. */
const REFILL_MS = Math.ceil(1.5 * METER_SECONDS * (config.zoomiesRefillSeconds / config.zoomiesFullSeconds) + 2) * 1000;
/** As screens.spec.ts' short tests: the slowest run, with a hang in its longest wait, × 2. */
const TEST_MS = 90_000;

/** WebGL 2 first (C-6), the profile seeded and low quality, the hook installed, then the page, started. */
async function load(page: Page): Promise<void> {
  await expectWebGL2(page);
  await seedStorage(page, { profile: { playerId: ME }, settings: { quality: 'low' } });
  await installHook(page);
  await page.goto('./');
  await expectStarted(page);
}

/** What has the focus: its data-test, or its tag. */
const focusOf = (page: Page): Promise<string> =>
  page.evaluate(() => document.activeElement?.getAttribute('data-test') ?? document.activeElement?.tagName.toLowerCase() ?? 'nothing');

/** Home's Practice, to its setup. */
async function toPractice(page: Page): Promise<void> {
  await waitForInspection(page, (i) => i.screen === 'home' && i.startMs.prepared !== null, { what: 'Home, prepared', timeoutMs: PREPARED_MS });
  await page.locator('[data-test="practice"]').click();
  await waitForScreen(page, 'practice', SHOWN_MS);
}

/** The person's terrier in the drawn head, as the hook reports it; null without one. */
const mineOf = (i: Inspection): NonNullable<Inspection['match']>['mine'] => i.match?.mine ?? null;

/** Zooming, its meter neither full nor empty: a tick that drained it, with more to drain. */
const zooming = (i: Inspection): boolean => {
  const T = mineOf(i);
  return T !== null && T.anim === ZOOMING && T.meter > 0 && T.meter < 1;
};

/** A look at the meter, every figure from one head state: its tick, and the terrier's animation and its
 *  start, and its meter's share. */
interface MeterLook {
  readonly tick: number;
  readonly anim: number;
  readonly animStart: number;
  readonly meter: number;
}

function lookOf(i: Inspection): MeterLook {
  const T = mineOf(i);
  if (T === null) throw new Error(`no terrier of the person's in the head at tick ${i.match?.headTick ?? '-'}`);
  return { tick: i.match!.headTick, anim: T.anim, animStart: T.animStart, meter: T.meter };
}

test('the Rules screen from Practice: rules chosen, stored and kept after a reload, Reset to defaults, and a Practice that plays by them (C-59)', async ({ page }) => {
  test.setTimeout(TEST_MS);
  await load(page);
  await toPractice(page);
  const summary = page.locator('[data-test="rules-summary"]');
  await expect(summary, 'the defaults, with nothing stored').toHaveText('The defaults');
  await expectAxeClean(page);
  // A pack size that isn't the default, to see Back bring it back.
  await page.locator('[data-test="pack-size"]').selectOption(String(config.packSizeMin));
  await page.locator('[data-test="rules"]').click();
  await waitForScreen(page, 'rules', SHOWN_MS);
  await expectAxeClean(page);

  // The zoomies meter by the arrows on its focused select, the browser's own keys; the run speed by its select.
  const meter = page.locator('[data-test="rule-zoomiesFullSeconds"]');
  const run = page.locator('[data-test="rule-runSpeedMetresPerSecond"]');
  await expect(meter, 'the default chosen').toHaveValue(String(config.zoomiesFullSeconds));
  await meter.focus();
  await chooseByKeys(page, String(METER_SECONDS));
  await expect(page.locator('[data-test="rules-message"]'), 'stored as it changed').toHaveText('Saved.');
  await run.selectOption(String(RUN_SPEED));
  const both = { v: 1, rules: { runSpeedMetresPerSecond: RUN_SPEED, zoomiesFullSeconds: METER_SECONDS } };
  await expect.poll(() => storedRules(page), 'A.3\'s record, the two rules only').toEqual(both);
  await expect(page.locator('[data-test="rules-reset"]'), 'Reset able to act').not.toHaveAttribute('aria-disabled', 'true');

  // Back: the setup with its pack size, Rules… focused, the rules in its summary.
  await page.locator('[data-test="back"]').click();
  await waitForScreen(page, 'practice', SHOWN_MS);
  await expect(page.locator('[data-test="pack-size"]'), 'the pack size kept').toHaveValue(String(config.packSizeMin));
  expect(await focusOf(page), 'Rules… focused on the way back').toBe('rules');
  await expect(summary).toContainText(`Run speed ${RUN_SPEED} m/s`);
  await expect(summary).toContainText(`Zoomies meter ${METER_SECONDS} s`);

  // A reload keeps them; Reset sets every rule to its default, and the record to none.
  await page.reload();
  await expectStarted(page);
  await toPractice(page);
  await expect(summary, 'the rules kept by the reload').toContainText(`Run speed ${RUN_SPEED} m/s`);
  await page.locator('[data-test="rules"]').click();
  await waitForScreen(page, 'rules', SHOWN_MS);
  await expect(meter).toHaveValue(String(METER_SECONDS));
  await expect(run).toHaveValue(String(RUN_SPEED));
  await page.locator('[data-test="rules-reset"]').click();
  await expect(page.locator('[data-test="rules-message"]')).toHaveText('Every rule is at its default.');
  await expect(meter).toHaveValue(String(config.zoomiesFullSeconds));
  await expect(run).toHaveValue(String(config.runSpeedMetresPerSecond));
  await expect.poll(() => storedRules(page), 'A.3\'s record, no rules').toEqual({ v: 1, rules: {} });
  await expect(page.locator('[data-test="rules-reset"]'), 'Reset with nothing to do').toHaveAttribute('aria-disabled', 'true');

  // The short meter again, then a Practice under it.
  await meter.selectOption(String(METER_SECONDS));
  await page.locator('[data-test="back"]').click();
  await waitForScreen(page, 'practice', SHOWN_MS);
  await expect(summary).toHaveText(`Zoomies meter ${METER_SECONDS} s, refilling in ${METER_SECONDS * (config.zoomiesRefillSeconds / config.zoomiesFullSeconds)} s`);
  await page.locator('[data-test="start"]').click();
  const pre = await waitForInspection(page, (i) => i.screen === 'prematch' && i.match?.inRoster === true, { what: 'Pre-match, the person in the roster', timeoutMs: READY_ACTS_MS });
  // The setup came fresh from the reload, at its defaults; the rule is the browser's.
  expect(pre.match!.settings, "the match's settings, the rule among them").toEqual({ packSize: config.packSizeDefault, matchMinutes: config.matchLengthDefaultMinutes, rules: { zoomiesFullSeconds: METER_SECONDS } });
  await expect(page.locator('[data-test="prematch-rules"]'), 'Pre-match lists the rule').toContainText(`Zoomies meter ${METER_SECONDS} s`);

  // Zoomies in the warm-up, Shift with W, from a full meter: it drains at the rule's rate, not the default's.
  const looks: MeterLook[][] = [];
  let drain: number | null = null;
  for (let hold = 1; hold <= HOLDS && drain === null; hold++) {
    // Full, by the hook's share and the HUD's gauge, each over the match's own full meter: over the build's,
    // three times as long, both would read a third.
    await waitForInspection(page, (i) => mineOf(i)?.meter === 1 && hudOf(i)?.meter === 1, { what: `a full meter, by the hook and the HUD, for hold ${hold}`, timeoutMs: REFILL_MS });
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    try {
      const first = await waitForInspection(page, zooming, { what: `zooming, the meter falling, in hold ${hold}`, timeoutMs: SHOWN_MS });
      const second = await waitForInspection(page, (i) => i.match!.headTick >= first.match!.headTick + LOOK_TICKS, {
        what: `a look ${LOOK_TICKS} ticks on in hold ${hold}`, timeoutMs: SHOWN_MS,
      });
      const [a, b] = [lookOf(first), lookOf(second)];
      looks.push([a, b]);
      // Each look's meter and tick are one head state's; and both looks in one zoom, begun at the same tick, so
      // every tick between them zoomed, since any other would have changed the animation and its start.
      if (zooming(second) && b.animStart === a.animStart) drain = (a.meter - b.meter) / (b.tick - a.tick);
    } finally {
      await page.keyboard.up('KeyW');
      await page.keyboard.up('ShiftLeft');
    }
  }
  console.log(`rules zoomies: ${JSON.stringify({ drain, looks })}`);
  expect(drain, `a hold whose two looks show one zoom, of ${HOLDS}: ${JSON.stringify(looks)}`).not.toBeNull();
  expect(drain!, `the drain a tick, as a share of the full meter, between looks ${JSON.stringify(looks.at(-1))}: the rule's ${RULE_DRAIN}, not the default's ${DEFAULT_DRAIN}`)
    .toBeCloseTo(RULE_DRAIN, EXACT_DIGITS);
  expect((await inspect(page)).match!.settings.rules, 'the match plays on under its rule').toEqual({ zoomiesFullSeconds: METER_SECONDS });
});
