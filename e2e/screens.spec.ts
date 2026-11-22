// The screens through the real page, in each engine (M4's design,
// research/m4/DESIGN.md, §5, §6, §9.1, §9.3's screens row, §9.6; PLAN §10,
// §11, D-23, D-24, D-30, L169), at the gate's 640 × 360 and stored low
// quality, each a seeded profile, every read the hook's, polled every 50 ms,
// never on animation frames (C-6):
// - Home's name and coat stored as typed and kept after a reload; its
//   primary button readable under the mouse, 4.5:1 or more on a hover of
//   its own (phase 2d's review); Settings' checks, a bad relay and a bad
//   TURN server each saying why beside its field and storing nothing; axe
//   on Home and Settings;
// - start in ball view off, sound off and the calmer camera on, from Home's
//   Settings, then a short Practice: chase view from its start
//   (render.camera.view), the calmer rig (render.camera.calm, and its turn
//   cap the calmer one), your bark at its key decided and none played,
//   sampled before the bot's first bark can come; Switch pack and
//   back; axe on Practice's setup, its Pre-match, Match, the menu and its
//   Settings panel, the menu a modal dialog whose Tab and Shift+Tab go
//   round its controls, the panel's too;
// - with prefers-reduced-motion emulated, the calmer camera on until the
//   player chooses, in Settings and in the rig, and off once chosen so;
// - the canary, the page's expected hash rewritten by interception: Propose,
//   Join by code and a #join= link say this browser can't play with others
//   and open no room, and Practice reaches its start countdown (D-23,
//   M4-Q31);
// - a second page in the same context shows the other-tab message, its
//   compile waiting, and Use here moves the game there, the first page then
//   showing the message (D-24);
// - over a local relay, with ice 'none': a code that isn't one contacting
//   nothing; history.length unchanged across Create, Leave, Join by code and
//   Join's Home, the fragment set and cleared by location.replace, and Back
//   leaving the page (§5.2, D-38, net-F1); Created's wake lock as the hook
//   reports it, refused in Chromium headless and held in Firefox and WebKit
//   (§5.13); Created's code at a phone's width held upright, each group of
//   four on one line (C-15); axe on Propose;
// - Chromium alone: the sound prompt before any key and gone after one, the
//   context running, with an AudioContext made suspended and refusing
//   resume() until a trusted key, as a browser's autoplay policy would,
//   since headless engines and Playwright's page reads otherwise let it run
//   (§7, D-32); and the connection failure, over a local relay started for
//   it with ice 'none', for a match nobody proposed: Join connecting, its
//   message once 20 s have passed and within 21 s of Join's room, axe, Try
//   again opening the link again and Home leaving it (PLAN §8, §5.10); and
//   a room that can't open, Trystero's chunk refused as a dropped network
//   or a deploy would refuse it: from Create and from Join by code, "Couldn't
//   open the match", its reload's advice, Try again and Home, axe, and no
//   relay, peer connection or room contacted (phase 2d's review).
// Play again's fragment and history are the screens' match's to check
// (e2e/match.screens.net.spec.ts), which alone reaches a networked Results.
// Every page is watched by the guard, a second page by watchPage, and no
// spec here contacts a public host: a room's relay is the loopback's, or
// nothing (§5.12, M4-Q3). Each test logs one line, `screens-measure {…}`,
// with how long each wait took, from which its timeouts are set, each with
// its margin, by e2e/lib/practice.ts' rule: a wait the machine's load
// lengthens is its worst run × 3 + 2 s, one the page's clock sets 1.5 × its
// ticks' time and the most a run took past them, + 2 s.

import { readFileSync } from 'node:fs';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { config, derived } from '../src/config';
import { personId } from '../src/core/bot/bot-id';
import { formatMatchId, generateMatchId } from '../src/core/match-id';
import { START_COUNTDOWN } from '../src/core/sim/state';
import type { Inspection } from '../src/main';
import { SETTINGS_KEY } from '../src/storage/schema';
import { startNostrRelay } from '../vendor/hermet/nostr-relay.mjs';
import { countPeerConnections } from './lib/browsers';
import { expect, expectEverywhere, expectWebGL2, type PageWatch, test, watchPage } from './lib/guards';
import {
  expectAxeClean, expectStarted, inspect, installHook, monotonicMs, seedStorage, smallViewport, waitForInspection,
} from './lib/page';
import { COUNTDOWN_MS, PREPARED_MS, READY_ACTS_MS, SHOWN_MS } from './lib/practice';

test.use({ viewport: smallViewport });

/** The specs' seed: personId(7, k) (§9.1). */
const SEED = 7;
const ME = personId(SEED, 0);
/** The gate's stored quality (C-6, D-33). */
const LOW = { quality: 'low' } as const;
/** The earliest local tick at which a bot's first bark can be decided: the brain's period less the bark gap
 *  after its first think, at the match's start or later, its input d ticks ahead (src/core/bot/brain.ts). */
const BOT_BARK_FROM = derived.botBarkEveryTicks - derived.barkGapTicks - config.inputDelayTicks;

// --- Timeouts, from this spec's measured runs (screens-measure), each with its margin ---

/** The start countdown to Match: its 5 s of ticks on the page's clock, and play's first poll; the runs took
 *  4.96 to 5.03 s in the three engines; 1.5 × 5.03 + 2 = 9.5 s. */
const TO_PLAY_MS = 10_000;
/** No timeline 20 s after the room opened (PLAN §8): the runs saw the message 19.9 to 20.0 s after the hook
 *  showed Join holding its room, and at most 20.4 s after the navigation; 1.5 × 20.4 + 2 = 32.6 s. */
const CONNECT_MS = 33_000;
/** The earliest the connection failure may show, from the navigation, which the room's opening follows. */
const CONNECT_EARLIEST_MS = config.connectionFailureSeconds * 1000;
/** The latest, from the hook showing Join's room, which comes after the room opened: PLAN §8's 20 s, a timer
 *  run's lateness under load, at most 391 ms in the gate's match, and a look's 50 ms; the runs saw 19.9 to
 *  20.0 s (phase 2d's review, screens-msg-F4). */
const CONNECT_LATEST_MS = config.connectionFailureSeconds * 1000 + 1000;
/** Each test's own, as pad-menus' and the touch tests' are: its slowest run, with a hang in its longest wait,
 *  the start's 30 s, × 2. Over six runs in each engine, at loads of 3 to 25, the short tests took 1.1 to
 *  14.9 s, the slowest Firefox's Home and Settings at load 21, its axe runs the longer, (14.9 + 30) × 2 =
 *  89.8 s; the Practice through Settings 10.7 to 21.8 s, (21.8 + 30) × 2 = 103.6 s; and the connection
 *  failure 20.4 to 23.0 s, (23.0 + 30) × 2 = 106 s. */
const SHORT_TEST_MS = 90_000;
const PRACTICE_TEST_MS = 105_000;
const CONNECTION_TEST_MS = 110_000;

/** The canary's expected hash, as goldens.json holds it, and what the interception writes in its place. */
const CANARY = (JSON.parse(readFileSync(new URL('../src/core/sim/goldens.json', import.meta.url), 'utf8')) as { canary: string }).canary;
const NOT_THE_CANARY = '0'.repeat(CANARY.length);

/** One look at each wait: how long it took, for the test's line (screens-measure). */
class Waits {
  readonly ms: Record<string, number> = {};
  private readonly began = monotonicMs();
  private readonly page: Page;
  private readonly testInfo: TestInfo;

  constructor(page: Page, testInfo: TestInfo) {
    this.page = page;
    this.testInfo = testInfo;
  }

  /** The hook polled every 50 ms until `cond` holds, the wait's length kept under `what`. */
  async until(what: string, cond: (i: Inspection) => boolean, timeoutMs: number, page: Page = this.page): Promise<Inspection> {
    const t = monotonicMs();
    const i = await waitForInspection(page, cond, { what, timeoutMs });
    this.ms[what] = Math.max(this.ms[what] ?? 0, Math.round(monotonicMs() - t));
    return i;
  }

  /** The test's line, logged whether it passed or not. */
  async log(error: string | null): Promise<void> {
    const engine = this.page.context().browser()?.browserType().name() ?? 'unknown';
    const line = JSON.stringify({ test: this.testInfo.title, engine, ok: error === null, error, wallMs: Math.round(monotonicMs() - this.began), waits: this.ms });
    console.log(`screens-measure ${line}`);
    await this.testInfo.attach('screens-measure', { body: line, contentType: 'application/json' });
  }
}

/** A test's waits, its line logged as it ends, passed or not. */
async function measured(page: Page, testInfo: TestInfo, body: (w: Waits) => Promise<void>): Promise<void> {
  const w = new Waits(page, testInfo);
  let error: string | null = null;
  try {
    await body(w);
  } catch (e) {
    error = e instanceof Error ? e.message.split('\n')[0]! : String(e);
    throw e;
  } finally {
    await w.log(error);
  }
}

/** WebGL 2 first (C-6), the profile seeded with personId(7, k) and low quality, the hook installed with any
 *  of the plan's fields, then the page, started on its first screen. */
async function load(page: Page, o: { k?: number; hook?: Parameters<typeof installHook>[1]; at?: string; settings?: Record<string, unknown> } = {}): Promise<void> {
  await expectWebGL2(page);
  await seedStorage(page, { profile: { playerId: personId(SEED, o.k ?? 0) }, settings: { ...LOW, ...o.settings } });
  await installHook(page, o.hook ?? {});
  await page.goto(o.at ?? './');
  await expectStarted(page);
}

/** The settings as the page stored them (A.3). */
async function storedSettings(page: Page): Promise<Record<string, unknown>> {
  return JSON.parse((await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY)) ?? 'null') as Record<string, unknown>;
}

/** What has the focus: its data-test, or its tag and text. */
function focusOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement;
    if (a === null || a === document.body) return 'nothing';
    return a.getAttribute('data-test') ?? `${a.tagName.toLowerCase()} ${(a.textContent ?? '').trim()}`;
  });
}

/** The WebSockets a page opened: a relay's, the only way a room opens (§5.12). */
const sockets = (w: PageWatch): string[] => w.requests.filter((u) => /^wss?:/.test(u));
/** Trystero's chunk, which only a room's opening loads (L238). */
const trystero = (w: PageWatch): string[] => w.requests.filter((u) => /\/trystero-[\w-]+\.js$/.test(u));
const peerConnections = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __rtcCount: number }).__rtcCount);
/** A control's text and background colours as drawn, and their contrast, WCAG 2's. */
function coloursOf(l: Locator): Promise<{ fg: string; bg: string; ratio: number }> {
  return l.evaluate((el) => {
    const s = getComputedStyle(el);
    const lum = (c: string): number => {
      const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
        const x = Number(v) / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const [a, b] = [lum(s.color), lum(s.backgroundColor)].sort((x, y) => y - x);
    return { fg: s.color, bg: s.backgroundColor, ratio: (a! + 0.05) / (b! + 0.05) };
  });
}

/** The lines each group of a shown code takes: 1 for each, unless a line splits a group (C-15). */
const groupLines = (page: Page, test: string): Promise<number[]> =>
  page.evaluate((t) => Array.from(document.querySelectorAll(`[data-test="${t}"] .code-group`), (g) => g.getClientRects().length), test);

/** A page that isn't the app's, its encoding declared, so no engine says it guessed one. */
const BEFORE = 'data:text/html;charset=utf-8,<!doctype html><title>Before terriest</title><p>Before terriest.</p>';

/** Practice's setup by clicks, 1 a side for 1 minute, to Pre-match drawing with the person in the final roster
 *  and Ready able to act (Q-15); axe on the setup when asked. */
async function practice(page: Page, w: Waits, o: { axe?: boolean } = {}): Promise<Inspection> {
  await page.locator('[data-test="practice"]').click();
  await w.until("Practice's setup", (i) => i.screen === 'practice', SHOWN_MS);
  if (o.axe === true) await expectAxeClean(page);
  await page.locator('[data-test="pack-size"]').selectOption('1');
  await page.locator('[data-test="match-length"]').selectOption('1');
  await page.locator('[data-test="start"]').click();
  await w.until("Practice's Pre-match", (i) => i.screen === 'prematch', SHOWN_MS);
  const i = await w.until('Pre-match drawing, the person in the roster', (x) => x.render.frames > 0 && x.match?.inRoster === true, READY_ACTS_MS);
  await expect(page.locator('[data-test="ready"]')).not.toHaveAttribute('aria-disabled', 'true', { timeout: READY_ACTS_MS });
  return i;
}

/** The modal dialog's controls that show, first and last, by their data-test, and the focus's: whether it's
 *  inside the dialog. */
function dialogStops(page: Page): Promise<{ first: string; last: string; focus: string; inside: boolean }> {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')!;
    const shown = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea')].filter((el) => el.getClientRects().length > 0);
    const name = (el: Element | null): string => el?.getAttribute('data-test') ?? el?.tagName.toLowerCase() ?? 'nothing';
    return { first: name(shown[0]!), last: name(shown.at(-1)!), focus: name(document.activeElement), inside: dialog.contains(document.activeElement) };
  });
}

/** Tab past the dialog's last control comes round to its first, and Shift+Tab before its first, or from the
 *  heading a panel focuses, round to its last: the modal menu keeps the focus (§5.14). */
async function expectTabWraps(page: Page, what: string): Promise<void> {
  const s = await dialogStops(page);
  expect([s.inside, s.focus === s.first || s.focus === 'h2'], `${what}: the focus on the dialog's first control or its heading, ${s.focus}`)
    .toEqual([true, true]);
  await page.keyboard.press('Shift+Tab');
  expect(await focusOf(page), `${what}: Shift+Tab, round to its last`).toBe(s.last);
  await page.keyboard.press('Tab');
  expect(await focusOf(page), `${what}: Tab from its last, round to its first`).toBe(s.first);
  await page.keyboard.press('Shift+Tab');
  expect(await focusOf(page), `${what}: Shift+Tab from its first, round to its last`).toBe(s.last);
}

test("Home keeps the name and coat typed after a reload, and Settings says why a bad relay or TURN server isn't stored (PLAN §10, §11, A.3)", async ({ page }, testInfo) => {
  test.setTimeout(SHORT_TEST_MS);
  await measured(page, testInfo, async (w) => {
    await load(page);
    await w.until('Home, prepared', (i) => i.screen === 'home' && i.startMs.prepared !== null, PREPARED_MS);
    await expectAxeClean(page);
    // Home's primary button under the mouse: a hover of its own, its dark text still readable (§5.14).
    const propose = page.locator('[data-test="propose"]');
    const still = await coloursOf(propose);
    await propose.hover();
    const hovered = await coloursOf(propose);
    expect([hovered.bg !== still.bg, hovered.ratio >= 4.5], `Propose under the mouse, ${JSON.stringify(hovered)}, from ${JSON.stringify(still)}: a hover of its own, 4.5:1 or more`)
      .toEqual([true, true]);
    await page.mouse.move(0, 0);
    // The name and the coat, each stored as it changes (§5.3): the name when the field is left.
    await page.locator('[data-test="name"]').fill('Rosie the Rapid');
    await page.keyboard.press('Tab');
    await page.locator('[data-test="coat-2"]').check();
    await page.reload();
    await expectStarted(page);
    await w.until('Home after the reload', (i) => i.screen === 'home', SHOWN_MS);
    await expect(page.locator('[data-test="name"]'), 'the name kept').toHaveValue('Rosie the Rapid');
    await expect(page.locator('[data-test="coat-2"]'), 'the coat kept').toBeChecked();
    await expect(page.locator('[data-test="coat-0"]')).not.toBeChecked();
    // A name past C-17's 20 characters is fitted to them as it's stored.
    await page.locator('[data-test="name"]').fill('Bartholomew the Magnificent');
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-test="name"]')).toHaveValue('Bartholomew the Magn');

    // Settings: axe; then a relay and a TURN server that fail its checks, each saying why beside its field,
    // marked invalid, and storing nothing (§6).
    await page.locator('[data-test="settings"]').click();
    await w.until('Settings', (i) => i.screen === 'settings', SHOWN_MS);
    await expectAxeClean(page);
    const before = await storedSettings(page);
    expect([before['relays'], before['turn']], 'no extra relay nor TURN server stored').toEqual([[], []]);
    const relays = page.locator('[data-test="relays"]');
    const why = '“ws://127.0.0.1:9” must start with wss://.';
    await relays.fill('ws://127.0.0.1:9');
    await expect(page.locator('[data-test="relays-problem"]'), "why it isn't a relay").toHaveText(why);
    await expect(relays).toHaveAttribute('aria-invalid', 'true');
    await relays.blur();
    await expect(page.locator('[data-test="settings-message"]'), 'the status line, as the field is left').toHaveText(why);
    expect(await storedSettings(page), 'nothing stored for a bad relay').toEqual(before);
    await relays.fill('');
    await expect(page.locator('[data-test="relays-problem"]')).toBeHidden();
    await expect(relays).not.toHaveAttribute('aria-invalid');
    const url = page.locator('[data-test="turn-url"]');
    await url.fill('stun:127.0.0.1:9');
    await expect(page.locator('[data-test="turn-problem"]')).toHaveText('A TURN URL starts with turn: or turns:, for example turns:turn.example.com:443.');
    await expect(url).toHaveAttribute('aria-invalid', 'true');
    await url.fill('turn:127.0.0.1:9');
    await page.locator('[data-test="turn-user"]').fill('someone');
    await page.locator('[data-test="turn-user"]').blur();
    await expect(page.locator('[data-test="turn-problem"]')).toHaveText('A TURN server needs its user name and credential.');
    await expect(page.locator('[data-test="turn-credential"]')).toHaveAttribute('aria-invalid', 'true');
    await expect(url).not.toHaveAttribute('aria-invalid');
    await expect(page.locator('[data-test="settings-message"]')).toHaveText('A TURN server needs its user name and credential.');
    expect(await storedSettings(page), 'nothing stored for an incomplete TURN server').toEqual(before);
    await page.locator('[data-test="back"]').click();
    await w.until('Home from Settings', (i) => i.screen === 'home', SHOWN_MS);
  });
});

test("Settings from Home apply in a short Practice: chase view from its start, the calmer rig, your bark decided and none played; Switch pack and back; the menu a modal dialog; axe on each screen (§5.4, §5.7, §5.8, §6)", async ({ page, browserName }, testInfo) => {
  test.setTimeout(PRACTICE_TEST_MS);
  await measured(page, testInfo, async (w) => {
    await load(page);
    await w.until('Home, prepared', (i) => i.screen === 'home' && i.startMs.prepared !== null, PREPARED_MS);
    // Home's Settings: start in ball view off, sound off and the calmer camera on.
    await page.locator('[data-test="settings"]').click();
    await w.until('Settings', (i) => i.screen === 'settings', SHOWN_MS);
    await page.locator('[data-test="ball-view"]').uncheck();
    await page.locator('[data-test="sound"]').uncheck();
    await page.locator('[data-test="calm-camera"]').check();
    await w.until("sound off, the page's sound following it", (i) => i.audio?.enabled === false, SHOWN_MS);
    expect(await storedSettings(page)).toMatchObject({ ballView: false, sound: false, calmCamera: true });
    await page.locator('[data-test="back"]').click();
    await w.until('Home from Settings', (i) => i.screen === 'home', SHOWN_MS);

    // Practice, axe on its setup and its Pre-match.
    await practice(page, w, { axe: true });
    // Your bark by its key, at once: decided though the sound is off, and none played (§7, feasibility-F9). The
    // bot's barks are 4 to 6 s apart, its first as long after it joined at the start, so a press sampled
    // before then is the only bark there can be.
    await page.keyboard.press('KeyQ');
    const barked = await w.until('your bark sampled', (i) => (i.controls?.presses.bark ?? 0) > 0, SHOWN_MS);
    expect(barked.match!.localTick, "your bark sampled before the bot's first could come").toBeLessThan(BOT_BARK_FROM);
    expect(barked.audio, 'your bark decided, the sound off').toMatchObject({ enabled: false, decided: { bark: 1 }, played: { bark: 0 } });
    expect(Object.values(barked.audio!.played).filter((n) => n !== 0), 'cues played with the sound off').toEqual([]);
    // Chase view from the first frame the player's camera draws, never ball view; the calmer rig, its cap the
    // calmer one once it has stepped (D-28, §3.1).
    const views: string[] = [];
    const drawn = await w.until("the player's camera, stepped", (i) => {
      views.push(`${i.render.camera.kind} ${i.render.camera.view}`);
      return i.render.camera.kind === 'player' && i.render.camera.turnCap !== null;
    }, SHOWN_MS);
    expect(views.filter((v) => v.endsWith(' ball')), 'ball view at any look, with start in ball view off').toEqual([]);
    expect(drawn.render.camera).toMatchObject({ view: 'chase', calm: true, turnCap: config.chaseCalmerMaxTurnsPerSecond });
    expect(drawn.controls?.view, "the controls' view, which anchors the keys").toBe('chase');
    await expectAxeClean(page);

    // Switch pack and back (D-22): the person swapped with the other pack's bot, then back in A.
    const packOf = (i: Inspection): number | undefined => i.match?.roster.find((r) => r.id === ME)?.pack;
    await page.locator('[data-test="switch-pack"]').click();
    await w.until('the person in pack B', (i) => packOf(i) === 1 && i.match?.roster.length === 2, SHOWN_MS);
    await expect(page.locator('[data-test="switch-pack"]')).not.toHaveAttribute('aria-disabled', 'true', { timeout: SHOWN_MS });
    await page.locator('[data-test="switch-pack"]').click();
    const back = await w.until('the person back in pack A', (i) => packOf(i) === 0, SHOWN_MS);
    expect(back.match!.roster.map((r) => r.pack).sort(), 'one a side').toEqual([0, 1]);

    // Ready, the start countdown, then Match: axe on it, its menu and the Settings panel.
    await expect(page.locator('[data-test="ready"]')).not.toHaveAttribute('aria-disabled', 'true', { timeout: SHOWN_MS });
    await page.locator('[data-test="ready"]').click();
    await w.until('the start countdown', (i) => i.match?.phase === START_COUNTDOWN, COUNTDOWN_MS);
    await w.until('Match', (i) => i.screen === 'match', TO_PLAY_MS);
    await expectAxeClean(page);
    await page.keyboard.press('Escape');
    await w.until('the menu, Practice paused', (i) => i.menu === 'menu' && i.match?.paused === true, SHOWN_MS);
    const dialog = page.getByRole('dialog');
    await expect(dialog, 'the menu a modal dialog (§5.14)').toHaveAttribute('aria-modal', 'true');
    expect(await focusOf(page), "the menu's first button focused (Q-17)").toBe('resume');
    await expectAxeClean(page);
    await expectTabWraps(page, "the menu's buttons");
    await page.locator('[data-test="menu-settings"]').click();
    await w.until('the Settings panel', (i) => i.menu === 'settings', SHOWN_MS);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(await focusOf(page), "the panel's heading focused").toBe('h2 Settings');
    await expectAxeClean(page);
    await expectTabWraps(page, 'the Settings panel');
    await page.locator('[data-test="settings-panel"] [data-test="back"]').click();
    await w.until('the match again, the menu closed', (i) => i.menu === 'closed' && i.match?.paused === false, SHOWN_MS);
    await page.keyboard.press('Escape');
    await w.until('the menu again', (i) => i.menu === 'menu', SHOWN_MS);
    await page.locator('[data-test="leave"]').click();
    await w.until('Home, the match left', (i) => i.screen === 'home' && i.match === null, SHOWN_MS);
    console.log(`${browserName}: the governor acted ${(await inspect(page)).frames.actions} times`);
  });
});

test('the calmer camera follows prefers-reduced-motion until the player chooses (PLAN §11, A.3, §5.14)', async ({ page }, testInfo) => {
  test.setTimeout(SHORT_TEST_MS);
  await measured(page, testInfo, async (w) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await load(page);
    await w.until('Home, prepared', (i) => i.screen === 'home' && i.startMs.prepared !== null, PREPARED_MS);
    // Settings shows the system's choice, and follows it as it changes, saying so, while nothing is chosen.
    await page.locator('[data-test="settings"]').click();
    await w.until('Settings', (i) => i.screen === 'settings', SHOWN_MS);
    const calm = page.locator('[data-test="calm-camera"]');
    await expect(calm, 'on, by the system').toBeChecked();
    await expect(page.locator('[data-test="calm-camera-note"]')).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(calm, 'off, following the system').not.toBeChecked();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(calm, 'on again').toBeChecked();
    expect((await storedSettings(page))['calmCamera'], 'nothing chosen').toBeNull();
    await page.locator('[data-test="back"]').click();
    await w.until('Home from Settings', (i) => i.screen === 'home', SHOWN_MS);
    // The rig the calmer one, by the system.
    await practice(page, w);
    const rig = await w.until("the player's camera, stepped", (i) => i.render.camera.kind === 'player' && i.render.camera.turnCap !== null, SHOWN_MS);
    expect(rig.render.camera, 'calm by the system').toMatchObject({ calm: true, turnCap: config.ballViewCalmerMaxTurnsPerSecond });
    // Chosen off in the match's Settings panel: off at once, the system's preference notwithstanding.
    await page.keyboard.press('Escape');
    await w.until('the menu', (i) => i.menu === 'menu', SHOWN_MS);
    await page.locator('[data-test="menu-settings"]').click();
    await w.until('the Settings panel', (i) => i.menu === 'settings', SHOWN_MS);
    await page.locator('[data-test="settings-panel"] [data-test="calm-camera"]').uncheck();
    await w.until('the camera not calm', (i) => !i.render.camera.calm, SHOWN_MS);
    expect((await storedSettings(page))['calmCamera'], 'chosen').toBe(false);
    await page.locator('[data-test="settings-panel"] [data-test="back"]').click();
    const chosen = await w.until('the rig stepped since', (i) => i.menu === 'closed' && i.render.camera.turnCap === config.ballViewSwingMaxTurnsPerSecond, SHOWN_MS);
    expect(chosen.render.camera.calm).toBe(false);
    await page.keyboard.press('Escape');
    await w.until('the menu again', (i) => i.menu === 'menu', SHOWN_MS);
    await page.locator('[data-test="leave"]').click();
    await w.until('Home, the match left', (i) => i.screen === 'home', SHOWN_MS);
    // And Settings says so: off, with no note of the system's.
    await page.locator('[data-test="settings"]').click();
    await w.until('Settings again', (i) => i.screen === 'settings', SHOWN_MS);
    await expect(calm, 'off, as chosen').not.toBeChecked();
    await expect(page.locator('[data-test="calm-camera-note"]')).toBeHidden();
  });
});

test("the canary failing, the page's expected hash rewritten: Propose, Join by code and a link say why and open no room, and Practice plays (D-23, M4-Q31)", async ({ page, guard }, testInfo) => {
  test.setTimeout(SHORT_TEST_MS);
  await measured(page, testInfo, async (w) => {
    // The page's scripts as built, but the one hash of the goldens they hold, the canary's, another's.
    const rewritten: string[] = [];
    await page.route((u) => u.pathname.endsWith('.js'), async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (!body.includes(CANARY)) {
        await route.fulfill({ response, body });
        return;
      }
      rewritten.push(new URL(route.request().url()).pathname);
      await route.fulfill({ response, body: body.replaceAll(CANARY, NOT_THE_CANARY) });
    });
    await countPeerConnections(page);
    // A relay nothing answers, on the loopback, so even a room opened by mistake contacts nothing beyond it.
    const relay = 'ws://127.0.0.1:9';
    const link = generateMatchId();
    await load(page, { hook: { relay, ice: 'none' }, at: `./#join=${link}` });
    expect(rewritten.length, "the page's scripts that hold the canary's hash").toBeGreaterThan(0);
    // A link: the message at once, its heading focused, with Practice and Home (§5.10).
    const linked = await w.until('the canary message, from the link', (i) => i.screen === 'message', SHOWN_MS);
    expect([linked.message, linked.match]).toEqual(['canary', null]);
    const message = page.locator('section[data-test="message"][data-message="canary"]');
    await expect(message.getByRole('heading', { level: 1 })).toHaveText('This browser can’t play matches with others');
    await expect(message.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(message.locator('button')).toHaveText(['Practice', 'Home']);
    await expectAxeClean(page);
    await message.locator('[data-test="message-home"]').click();
    await w.until('Home', (i) => i.screen === 'home', SHOWN_MS);
    expect(await page.evaluate(() => location.hash), "the link's fragment cleared").toBe('');
    // Propose a match, and Join by a code: each says why.
    await page.locator('[data-test="propose"]').click();
    expect((await w.until('the canary message, from Propose', (i) => i.screen === 'message', SHOWN_MS)).message).toBe('canary');
    await page.locator('[data-test="message-home"]').click();
    await w.until('Home again', (i) => i.screen === 'home', SHOWN_MS);
    await page.locator('[data-test="code"]').fill(formatMatchId(generateMatchId()));
    await page.locator('[data-test="code"]').press('Enter');
    expect((await w.until('the canary message, from Join', (i) => i.screen === 'message', SHOWN_MS)).message).toBe('canary');
    // No room opened: no relay contacted, no peer connection made, Trystero never loaded (D-23).
    expect(sockets(guard), 'WebSockets').toEqual([]);
    expect(trystero(guard), "Trystero's chunk").toEqual([]);
    expect(await peerConnections(page), 'RTCPeerConnections').toBe(0);
    // Practice still plays: from the message to its start countdown.
    await page.locator('[data-test="message-practice"]').click();
    await w.until("Practice's setup, from the message", (i) => i.screen === 'practice', SHOWN_MS);
    await page.locator('[data-test="back"]').click();
    await w.until('Home', (i) => i.screen === 'home', SHOWN_MS);
    await practice(page, w);
    await page.locator('[data-test="ready"]').click();
    await w.until('the start countdown', (i) => i.match?.phase === START_COUNTDOWN, COUNTDOWN_MS);
    expect([sockets(guard), trystero(guard), await peerConnections(page)], 'nothing contacted').toEqual([[], [], 0]);
    await page.keyboard.press('Escape');
    await w.until('the menu', (i) => i.menu === 'menu', SHOWN_MS);
    await page.locator('[data-test="leave"]').click();
    await w.until('Home', (i) => i.screen === 'home', SHOWN_MS);
  });
});

test('a second page in the same browser shows the other-tab message, and Use here moves the game there (D-24, §6)', async ({ page, baseURL, context }, testInfo) => {
  test.setTimeout(SHORT_TEST_MS);
  await measured(page, testInfo, async (w) => {
    await load(page);
    await w.until('Home, prepared', (i) => i.screen === 'home' && i.startMs.prepared !== null, PREPARED_MS);
    const second = await context.newPage();
    const watch = await watchPage(second, [baseURL!]);
    await installHook(second);
    await second.goto('./');
    await expectStarted(second);
    const held = await w.until('the other-tab message', (i) => i.screen === 'message', SHOWN_MS, second);
    expect([held.message, held.match], 'another tab holds the game').toEqual(['other-tab', null]);
    const message = second.locator('section[data-test="message"][data-message="other-tab"]');
    await expect(message.getByRole('heading', { level: 1 })).toHaveText('terriest is open in another tab');
    await expect(message.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(message.locator('button')).toHaveText(['Use here']);
    await expectAxeClean(second);
    // A page that can't play compiles nothing while it waits (§5.1, M4-Q38).
    expect((await inspect(second)).startMs.prepared, 'the compile waiting for Use here').toBeNull();
    await message.locator('[data-test="message-use-here"]').click();
    await w.until('Home on the page that took the game, prepared', (i) => i.screen === 'home' && i.startMs.prepared !== null, PREPARED_MS + SHOWN_MS, second);
    const lost = await w.until('the other-tab message on the first page', (i) => i.screen === 'message', SHOWN_MS);
    expect(lost.message).toBe('other-tab');
    await expect(page.locator('section[data-test="message"][data-message="other-tab"] h1')).toBeVisible();
    await second.close();
    expectEverywhere(watch);
  });
});

test('over a local relay: a bad code contacts nothing; Create, Leave and Join by code keep the history as it was, and Back leaves the page; Created holds a wake lock where the browser gives one (§5.2, §5.3, §5.13, D-38)', async ({ page, guard, browserName }, testInfo) => {
  test.setTimeout(SHORT_TEST_MS);
  const relayServer = await startNostrRelay();
  const relay = `ws://127.0.0.1:${relayServer.port}`;
  guard.allowed.push(relay);
  try {
    await measured(page, testInfo, async (w) => {
      // A page before the app's, so Back has an entry to go to in every engine: Firefox lets the first
      // navigation of a new tab replace its blank page rather than keep it. A data: URL is no request.
      await page.goto(BEFORE);
      await countPeerConnections(page);
      await load(page, { hook: { relay, ice: 'none' } });
      await w.until('Home, prepared', (i) => i.screen === 'home' && i.startMs.prepared !== null, PREPARED_MS);
      const length = (): Promise<number> => page.evaluate(() => history.length);
      const fragment = (): Promise<string> => page.evaluate(() => location.hash);
      const entries = await length();
      // A code that isn't one says so, and contacts nothing (§5.3, L190).
      await page.locator('[data-test="code"]').fill('terriest-is-not-a-code');
      await page.locator('[data-test="code"]').press('Enter');
      await expect(page.locator('[data-test="code-error"]')).toHaveText('That code isn’t valid. Check it and try again: it has 21 characters.');
      expect((await inspect(page)).screen).toBe('home');
      expect([sockets(guard), trystero(guard), await peerConnections(page)], 'nothing contacted for a bad code').toEqual([[], [], 0]);

      // Propose, axe, Create: Created, its fragment set by replace, no history entry.
      await page.locator('[data-test="propose"]').click();
      await w.until('Propose', (i) => i.screen === 'propose', SHOWN_MS);
      await expectAxeClean(page);
      await page.locator('[data-test="pack-size"]').selectOption('1');
      await page.locator('[data-test="match-length"]').selectOption('1');
      await page.locator('[data-test="create"]').click();
      const created = await w.until('Created', (i) => i.screen === 'created', SHOWN_MS);
      const id = created.match!.matchId!;
      expect([await fragment(), await length()], 'Created: its fragment, and the history as it was').toEqual([`#join=${id}`, entries]);
      expect(sockets(guard).length > 0 && sockets(guard).every((u) => u.startsWith(relay)), `the room opened on the local relay alone: ${sockets(guard).join(', ')}`).toBe(true);
      // The wake lock, wanted on Created until someone joins: Chromium headless refuses it, quietly, and Firefox
      // and WebKit hold it (§5.13, §0).
      const wake = (await w.until('the wake lock answered', (i) => i.wakeLock?.state === 'held' || i.wakeLock?.state === 'refused', SHOWN_MS)).wakeLock!;
      console.log(`${browserName}: Created's wake lock ${JSON.stringify(wake)}`);
      expect(wake).toMatchObject(browserName === 'chromium'
        ? { wanted: true, state: 'refused', refusals: 1, lastRefusal: 'NotAllowedError' }
        : { wanted: true, state: 'held', refusals: 0 });
      // Its code at a phone's width held upright: each group of four on one line, read out whole (C-15).
      await page.setViewportSize({ width: 412, height: 915 });
      expect(await groupLines(page, 'invite-code'), "Created's code at 412 px wide, each group's lines").toEqual(Array(6).fill(1));
      await page.setViewportSize(smallViewport);
      // Leave: Home, the fragment cleared by replace, the wake lock let go.
      await page.locator('[data-test="created-leave"]').click();
      const left = await w.until('Home from Created', (i) => i.screen === 'home' && i.match === null, SHOWN_MS);
      expect(left.wakeLock?.wanted, 'the wake lock not wanted off Created').toBe(false);
      expect(left.wakeLock?.state).not.toBe('held');
      expect([await fragment(), await length()], 'Home: no fragment, and the history as it was').toEqual(['', entries]);
      // Join by the code, typed in lower case and grouped as Created shows it: Join, its room on the relay.
      await page.locator('[data-test="code"]').fill(formatMatchId(id).toLowerCase());
      await page.locator('[data-test="code"]').press('Enter');
      await w.until('Join', (i) => i.screen === 'join' && i.match?.matchId === id, SHOWN_MS);
      expect([await fragment(), await length()], 'Join: its fragment, and the history as it was').toEqual([`#join=${id}`, entries]);
      await page.locator('[data-test="join-home"]').click();
      await w.until('Home from Join', (i) => i.screen === 'home' && i.match === null, SHOWN_MS);
      expect([await fragment(), await length()], 'Home again: the history as it was').toEqual(['', entries]);
      // Back leaves the app: no entry of its own to walk back through (§5.2).
      await page.goBack();
      expect(page.url(), 'Back, from Home: the page before the app').toBe(BEFORE);
    });
  } finally {
    await relayServer.close();
  }
});

/** As a browser's autoplay policy would have it (D-32): the page's AudioContext made suspended, and its
 *  resume() refused until a trusted key has gone down, which no click or page read of Playwright's stands in
 *  for; headless engines would otherwise let it run (2a's Wire step). It only refuses: the page's own code
 *  runs unchanged. Run in the page before its scripts. */
function suspendedAudio(): void {
  const Native = window.AudioContext;
  if (typeof Native !== 'function') return;
  let keyed = false;
  window.addEventListener('keydown', (e) => {
    if (e.isTrusted) keyed = true;
  }, true);
  const resume = Native.prototype.resume;
  Native.prototype.resume = function (this: AudioContext): Promise<void> {
    return keyed ? resume.call(this) : Promise.reject(new DOMException('No user activation', 'NotAllowedError'));
  };
  window.AudioContext = class extends Native {
    constructor(o?: AudioContextOptions) {
      super(o);
      void this.suspend();
    }
  };
}

test('Chromium: the sound prompt shows until a key, and the context runs after one (§5.8, §7, D-32)', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'the AudioContext stub and its prompt are checked in Chromium (§9.3)');
  test.setTimeout(SHORT_TEST_MS);
  await measured(page, testInfo, async (w) => {
    await page.addInitScript(suspendedAudio);
    await load(page);
    await w.until('Home, prepared', (i) => i.screen === 'home' && i.startMs.prepared !== null, PREPARED_MS);
    expect((await inspect(page)).audio, 'waiting for a key, sound on').toMatchObject({ state: 'waiting', enabled: true, prompt: false });
    // To Pre-match by clicks alone: the prompt over the pitch, a polite status (D-32).
    await practice(page, w);
    const waiting = await w.until('the sound prompt', (i) => i.audio?.prompt === true, SHOWN_MS);
    expect([waiting.audio?.state, (waiting.layers['sound'] as { prompt: boolean } | undefined)?.prompt]).toEqual(['waiting', true]);
    const prompt = page.locator('[data-test="sound-prompt"]');
    await expect(prompt).toBeVisible();
    await expect(prompt).toHaveText('Press a key or tap for sound');
    await expect(prompt).toHaveAttribute('role', 'status');
    // A key: the context runs, and the prompt goes.
    await page.keyboard.press('KeyW');
    const running = await w.until('the context running, the prompt gone', (i) => i.audio?.state === 'running' && i.audio.prompt === false, SHOWN_MS);
    expect((running.layers['sound'] as { prompt: boolean }).prompt).toBe(false);
    await expect(prompt).toBeHidden();
  });
});

test("Chromium: a match nobody proposed says it couldn't connect once 20 s have passed, over a local relay with no ICE servers (PLAN §8, §5.10)", async ({ page, guard, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'the connection failure is checked in Chromium (§9.3)');
  test.setTimeout(CONNECTION_TEST_MS);
  const relayServer = await startNostrRelay();
  const relay = `ws://127.0.0.1:${relayServer.port}`;
  guard.allowed.push(relay);
  try {
    await measured(page, testInfo, async (w) => {
      const id = generateMatchId();
      // The room opens after the navigation begins, so 20 s from here are no more than 20 s of its own.
      const navigated = monotonicMs();
      await load(page, { hook: { relay, ice: 'none' }, at: `./#join=${id}` });
      await w.until('Join, connecting', (i) => i.screen === 'join' && i.match?.matchId === id, SHOWN_MS);
      const joined = monotonicMs();
      await expect(page.locator('[data-test="join-status"]')).toHaveText('Connecting to the match…');
      const failed = await w.until('the connection failure', (i) => i.screen === 'message', CONNECT_MS);
      const after = monotonicMs() - navigated;
      const afterJoin = monotonicMs() - joined;
      console.log(`the connection failure ${Math.round(after)} ms after the navigation, ${Math.round(afterJoin)} ms after Join showed its room`);
      expect(after, 'no sooner than 20 s after the room opened').toBeGreaterThanOrEqual(CONNECT_EARLIEST_MS);
      expect(afterJoin, `and within ${CONNECT_LATEST_MS} ms of Join showing its room`).toBeLessThanOrEqual(CONNECT_LATEST_MS);
      expect([failed.message, failed.match], 'the match left').toEqual(['connect', null]);
      expect(sockets(guard).every((u) => u.startsWith(relay)) && sockets(guard).length > 0, `the local relay alone: ${sockets(guard).join(', ')}`).toBe(true);
      const message = page.locator('section[data-test="message"][data-message="connect"]');
      await expect(message.getByRole('heading', { level: 1 })).toHaveText('Couldn’t connect');
      await expect(message.getByRole('heading', { level: 1 })).toBeFocused();
      await expect(message.locator('button')).toHaveText(['Try again', 'Home']);
      await expectAxeClean(page);
      expect(await page.evaluate(() => location.hash), "the link's fragment kept, so a reload tries again").toBe(`#join=${id}`);
      // Try again: Join again, connecting to the same match.
      await message.locator('[data-test="message-try-again"]').click();
      await w.until('Join again', (i) => i.screen === 'join' && i.match?.matchId === id, SHOWN_MS);
      await expect(page.locator('[data-test="join-status"]')).toHaveText('Connecting to the match…');
      await page.locator('[data-test="join-home"]').click();
      await w.until('Home', (i) => i.screen === 'home' && i.match === null, SHOWN_MS);
      expect(await page.evaluate(() => location.hash)).toBe('');
    });
  } finally {
    await relayServer.close();
  }
});

test("Chromium: a room that can't open, its chunk refused as a dropped network or a deploy would refuse it, says so from Create and from Join by code, contacting no one (§5.10, phase 2d's review)", async ({ page, guard, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', "the browser's own words for a refused request are Chromium's");
  test.setTimeout(SHORT_TEST_MS);
  const relayServer = await startNostrRelay();
  const relay = `ws://127.0.0.1:${relayServer.port}`;
  guard.allowed.push(relay);
  // The browser's own error for the one request this test refuses, never the page's (§16).
  guard.allowedErrors.push(/Failed to load resource: net::ERR_FAILED/);
  try {
    await measured(page, testInfo, async (w) => {
      // Trystero's chunk, which only a room's opening loads (L238), refused.
      const refused: string[] = [];
      await page.route((u) => /\/trystero-[\w-]+\.js$/.test(u.pathname), async (route) => {
        refused.push(new URL(route.request().url()).pathname);
        await route.abort();
      });
      await countPeerConnections(page);
      await load(page, { hook: { relay, ice: 'none' } });
      await w.until('Home, prepared', (i) => i.screen === 'home' && i.startMs.prepared !== null, PREPARED_MS);
      // Create: "Couldn't open the match", a reload's advice and no other players' or TURN's words.
      await page.locator('[data-test="propose"]').click();
      await w.until('Propose', (i) => i.screen === 'propose', SHOWN_MS);
      await page.locator('[data-test="create"]').click();
      const fromCreate = await w.until("the room that can't open, from Create", (i) => i.screen === 'message', SHOWN_MS);
      expect([fromCreate.message, fromCreate.match, refused.length > 0]).toEqual(['open', null, true]);
      const message = page.locator('section[data-test="message"][data-message="open"]');
      await expect(message.getByRole('heading', { level: 1 })).toHaveText('Couldn’t open the match');
      await expect(message.getByRole('heading', { level: 1 })).toBeFocused();
      await expect(message).toContainText('reload the page');
      await expect(message, "no other players' words: there were none to reach").not.toContainText(/other players|TURN/);
      await expect(message.locator('button')).toHaveText(['Try again', 'Home']);
      await expectAxeClean(page);
      expect(await page.evaluate(() => location.hash), 'no fragment: nothing proposed').toBe('');
      // Try again: back to Propose; then Back, and Join by a code: the same message, the link's fragment kept.
      await message.locator('[data-test="message-try-again"]').click();
      await w.until('Propose again', (i) => i.screen === 'propose', SHOWN_MS);
      await page.locator('[data-test="back"]').click();
      await w.until('Home', (i) => i.screen === 'home', SHOWN_MS);
      const id = generateMatchId();
      await page.locator('[data-test="code"]').fill(formatMatchId(id));
      await page.locator('[data-test="code"]').press('Enter');
      const fromJoin = await w.until("the room that can't open, from Join", (i) => i.screen === 'message', SHOWN_MS);
      expect([fromJoin.message, fromJoin.match, await page.evaluate(() => location.hash)]).toEqual(['open', null, `#join=${id}`]);
      await expect(page.locator('section[data-test="message"][data-message="open"] button')).toHaveText(['Try again', 'Home']);
      // No room was ever opened: no relay, no peer connection.
      expect([sockets(guard), await peerConnections(page)], 'nothing contacted').toEqual([[], 0]);
      await page.locator('[data-test="message-home"]').click();
      await w.until('Home, the fragment cleared', (i) => i.screen === 'home', SHOWN_MS);
      expect(await page.evaluate(() => location.hash)).toBe('');
    });
  } finally {
    await relayServer.close();
  }
});
