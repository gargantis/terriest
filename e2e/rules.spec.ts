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
//   rule, Pre-match lists it, and in its warm-up zoomies empty the meter in
//   the 1 s of ticks the rule gives it, where the default's 3 s would take
//   three times as long: the simulation plays by the rule, and the hook's
//   meter reads its share of the match's own full meter.
// The guard watches the page, which contacts nothing: Practice opens no
// room.

import type { Page } from '@playwright/test';
import { config } from '../src/config';
import { personId } from '../src/core/bot/bot-id';
import { ZOOMING } from '../src/core/sim/state';
import type { Inspection } from '../src/main';
import { RULES_KEY } from '../src/storage/schema';
import { expect, expectWebGL2, test } from './lib/guards';
import { expectAxeClean, expectStarted, inspect, installHook, seedStorage, smallViewport, waitForInspection, waitForScreen } from './lib/page';
import { chooseByKeys, PREPARED_MS, READY_ACTS_MS, SHOWN_MS } from './lib/practice';

test.use({ viewport: smallViewport });

/** The specs' seed: personId(7, k) (§9.1). */
const ME = personId(7, 0);
/** The shortest zoomies meter on offer, and a run speed that isn't the default. */
const METER_SECONDS = config.matchRules.zoomiesFullSeconds[0];
const RUN_SPEED = config.matchRules.runSpeedMetresPerSecond.find((v) => v !== config.runSpeedMetresPerSecond)!;
/** A full meter's ticks of zoomies under the rule, and under the default: the drain is the meter's units a
 *  tick, so a meter of t seconds lasts t seconds of ticks (A.1). Empty, it locks zoomies out and refills a
 *  unit a tick, so a look every 3 ticks may never see it at 0: the wait is for it under a tenth. */
const RULE_TICKS = METER_SECONDS * config.ticksPerSecond;
const DEFAULT_TICKS = config.zoomiesFullSeconds * config.ticksPerSecond;
const LOW_SHARE = 0.1;
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

/** The match rules as the page stored them (A.3): null with none stored. */
async function storedRules(page: Page): Promise<unknown> {
  return JSON.parse((await page.evaluate((key) => localStorage.getItem(key), RULES_KEY)) ?? 'null') as unknown;
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

  // Zoomies in the warm-up, Shift with W: the meter empties in the rule's ticks, not the default's.
  const mine = (i: Inspection): NonNullable<NonNullable<Inspection['match']>['mine']> => i.match!.mine!;
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  try {
    const from = await waitForInspection(page, (i) => i.match?.mine !== null && mine(i).anim === ZOOMING && mine(i).meter < 1, { what: 'zooming, the meter falling', timeoutMs: SHOWN_MS });
    const low = await waitForInspection(page, (i) => i.match?.mine !== null && mine(i).meter < LOW_SHARE, { what: 'the meter under a tenth', timeoutMs: SHOWN_MS });
    const ticks = low.match!.headTick - from.match!.headTick;
    // Between the two looks the meter ran from under full to under a tenth: within the rule's ticks, a look's
    // lateness either side (two polls of 3 ticks) aside, and well short of the default's.
    expect(ticks, `the meter fell under a tenth in ${ticks} ticks, the rule's meter lasting ${RULE_TICKS} (the default's ${DEFAULT_TICKS})`).toBeLessThanOrEqual(RULE_TICKS + 6);
    expect(ticks).toBeLessThan((1 - LOW_SHARE) * DEFAULT_TICKS / 2);
  } finally {
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
  }
  expect((await inspect(page)).match!.settings.rules, 'the match plays on under its rule').toEqual({ zoomiesFullSeconds: METER_SECONDS });
});
