// A networked Pre-match's bots and Invite, and its watchers up to the
// spectator cap, through the real screens (M4's design, research/m4/
// DESIGN.md, §5.6, §5.7, §5.10, §5.11, §9.3's watchers row, §9.6; PLAN
// §11, §14, D-21, D-39, C-11, L166; phase 2b's review, P8), once, in the
// net project: one Chromium with six contexts, each a normal page opened
// by e2e/lib/browsers.ts' openAppPage, over the local relay alone, its
// ICE local (M4-Q3), at 640 × 360 and stored low quality (§9.1). Every
// button is a click on the real page; every wait polls the hook every
// 50 ms, never animation frames (C-6), and no sleep stands in for an
// event. Nobody presses Ready, so the match stays in warm-up throughout.
// - A proposer at pack size 2 plays in pack A on a networked Pre-match.
//   Add a bot puts a bot in pack A, by its name, a robot dog's from the
//   list as its host names it with the proposer's taken (the owner,
//   2026-11-22), Remove shown and Add marked full; Remove a bot takes it
//   out, the button gone and the roster back to the proposer alone, Add
//   able again; Add again brings it back, by its name.
//   Invite shows the link and the code Created showed, each group of the
//   code on one line at 640 × 360 (C-15). axe on that Pre-match, Remove and
//   the invite showing (§9.6).
// - Four watchers, the cap (config.spectatorsMax), open the link and press
//   Watch: each a spectator on Pre-match, and every page counting the
//   other four.
// - A fifth opens the link and presses Watch: it's one spectator too many
//   by its own count (D-21, C-11), so it leaves the room and is shown
//   "This match has the most spectators it can take" with Try again and
//   Home, its heading focused; axe; and the others count four again. Its
//   Try again opens the link again, Join's choices once the state is held;
//   Watch, the same message; and Try again pressed at once, inside the
//   room's 0.4 s grace, Join's choices again, its room opened once the one
//   it left has closed (phase 2d's review, players-1); its Home, and the
//   others count four again.
// - One watcher's Leave goes Home with the fragment cleared (§5.2, §5.11),
//   and every page still in the room counts one fewer.
// - P8: the proposer fills pack B with two bots, and the watcher who left
//   opens the link again: Join, into a room whose packs are both full,
//   says "Both packs are full: you can watch." with Watch in view at
//   640 × 360, without scrolling. The proposer's three bots have three
//   names from the list, in its packs' lists, on a watcher's follow choice
//   and in Join's lists, none cut short or wrapped in either list, nor any
//   name on the list, at 640 × 360 and at a phone's size: held sideways for
//   the follow choice, as a phone watches, and upright for Join. Each bot's
//   follow button and Join row shows a robot's head for its swatch and is
//   heard as "… bot", the proposer's neither (the owner, 2026-11-23).
// - Every page logged no error and requested nothing but the preview and
//   the relay (expectEverywhere).
// The peer counts are the hook's match.peers, the match's status().peers.
// Its timeouts are from its measured runs (see ANSWER_MS and the test's).
// New at M4, by phase 2d.

import type { Browser, Locator, Page } from '@playwright/test';
import { config } from '../src/config';
import { BOT_NAMES, botIds, botName, personId } from '../src/core/bot/bot-id';
import type { Inspection } from '../src/main';
import { startNostrRelay } from '../vendor/hermet/nostr-relay.mjs';
import { type AppPage, launch, openAppPage, SPEC_SEED } from './lib/browsers';
import { expect, expectEverywhere, test } from './lib/guards';
import { expectAxeClean, inspect, markText, monotonicMs, namesInRow, POLL_MS, rowMarks, waitForInspection, waitForScreen } from './lib/page';

const PACK_SIZE = 2; // not a setting: the room's (§9.3)
const MINUTES = 1; // not a setting: the room's
/** The watchers: the spectator cap's worth, then one more (C-11). */
const WATCHERS = config.spectatorsMax;
/** The profiles' names, by k: the proposer's, each watcher's, the fifth's. */
const NAMES: readonly string[] = ['Ada', 'Bea', 'Cal', 'Dot', 'Eli', 'Fay'];
const nameOf = (k: number): string => NAMES[k] ?? '';
const PROPOSER = personId(SPEC_SEED, 0);
/** The proposer's bots: the first is the one its first Add a bot makes (D-39). */
const BOTS = botIds(PROPOSER);
const BOT = BOTS[0]!;
/** Its name, as its host names it with the proposer's own name taken (the owner, 2026-11-22). */
const BOT_NAME = botName(BOT, [nameOf(0)]);
/** A phone held upright, as it shows Join, and sideways, as it watches Pre-match and Match (D-30): the screens
 *  spec's phone. */
const PHONE_UPRIGHT = { width: 412, height: 915 } as const;
const PHONE_SIDEWAYS = { width: 915, height: 412 } as const;

/**
 * Timeouts, from this spec's measured runs (phase 2d and its review, software GL, the machine's load 7 to
 * 33), each wait the machine's load lengthens its worst × 3 + 2 s, rounded up to a second, as e2e/lib/
 * practice.ts' are. ANSWER_MS: a screen's answer to a click, a bot in or out of the final roster, every
 * page's peers counted after a join or a leave: at worst 498 ms (the peers falling after a Leave, its
 * 0.4 s grace in it), so 3 × 0.50 + 2 = 3.5 s. JOIN_MS: from a page's start on the link, or a Try again,
 * to Join's choices, the room met and its state held: at worst 3.05 s (the fifth's join in the Wire
 * step's run), so 3 × 3.05 + 2 = 11.2 s.
 */
const ANSWER_MS = 4_000;
const JOIN_MS = 12_000;
/** The whole test: at most 20.3 s in its runs (the Wire step's), and the fifth's two Try agains since, at
 *  most 1.4 s, made as long as a hang in its longest wait, a page's start in openAppPage (30 s), would
 *  make it, × 2, as the device specs' are: (20.3 + 1.4 + 30) × 2 = 103.4 s. */
const WATCHERS_TEST_MS = 105_000;

const at = (page: Page, id: string): Locator => page.locator(`[data-test="${id}"]`);
/** The lines each group of a shown code takes: 1 for each, unless a line splits a group (C-15). */
const groupLines = (page: Page, test: string): Promise<number[]> =>
  page.evaluate((t) => Array.from(document.querySelectorAll(`[data-test="${t}"] .code-group`), (g) => g.getClientRects().length), test);
/** A pack's terriers in Pre-match's list, its free places left out. */
const listed = (page: Page, pack: number): Locator => page.locator(`[data-test="pack-${pack}"] li:not(.free)`);

/** The room's connections as the hook reports them: match.peers, the match's status().peers. */
const peersOf = (i: Inspection): number | null => i.match?.peers ?? null;

/** The final roster's IDs in `pack`. */
const inPack = (i: Inspection, pack: number): string[] => (i.match?.roster ?? []).filter((T) => T.pack === pack).map((T) => T.id);
/** The proposer's bots in `pack`'s final roster. */
const botsIn = (i: Inspection, pack: number): number => inPack(i, pack).filter((id) => BOTS.includes(id)).length;
/** The proposer's bots' names in the final roster, by ID. */
const botNamesIn = (i: Inspection): Record<string, string> =>
  Object.fromEntries((i.match?.roster ?? []).filter((T) => BOTS.includes(T.id)).map((T) => [T.id, T.name]));

/** Each page's look, every 50 ms, until every page counts `peers` connections; fails on a timeout with
 *  what each counts. Returns how long it took. */
async function expectPeers(pages: readonly AppPage[], peers: number, why: string): Promise<number> {
  const from = monotonicMs();
  for (;;) {
    const counts = await Promise.all(pages.map(async (p) => peersOf(await inspect(p.page))));
    if (counts.every((n) => n === peers)) return monotonicMs() - from;
    if (monotonicMs() - from > ANSWER_MS) {
      throw new Error(`${why}: every page counting ${peers} peers, not within ${ANSWER_MS} ms: they count ${counts.join(', ')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** A newcomer that opened the link: Join, then its choices once the room is met and its state held (M4-Q2). */
async function joinScreen(p: AppPage, status: string): Promise<void> {
  await waitForScreen(p.page, 'join', JOIN_MS);
  await expect(at(p.page, 'join-status'), "Join's status once the state is held").toHaveText(status, { timeout: JOIN_MS });
}

test('a networked Pre-match adds, removes and adds a bot, shows its invite, takes four watchers and refuses a fifth, a Leave clearing the fragment, and a full room offers Watch in view (D-39, C-11, P8)', async ({ baseURL }) => {
  test.setTimeout(WATCHERS_TEST_MS);
  const base = baseURL!;
  const relayServer = await startNostrRelay();
  const relay = `ws://127.0.0.1:${relayServer.port}`;
  const browsers: Browser[] = [];
  const pages: AppPage[] = [];
  const took: Record<string, number> = {};
  const timed = async <T>(what: string, step: () => Promise<T>): Promise<T> => {
    const from = monotonicMs();
    const out = await step();
    took[what] = Math.round(monotonicMs() - from);
    return out;
  };
  try {
    const cr = await launch('chromium');
    browsers.push(cr);

    // The proposer: Home, Propose a match at 2 a side for a minute, Create, then Play in pack A.
    const proposer = await openAppPage(cr, base, { k: 0, name: nameOf(0), relay });
    pages.push(proposer);
    const pp = proposer.page;
    await waitForScreen(pp, 'home', ANSWER_MS);
    await at(pp, 'propose').click();
    await waitForScreen(pp, 'propose', ANSWER_MS);
    await at(pp, 'pack-size').selectOption(String(PACK_SIZE));
    await at(pp, 'match-length').selectOption(String(MINUTES));
    await at(pp, 'create').click();
    await timed('created', () => waitForScreen(pp, 'created', ANSWER_MS));
    const link = await at(pp, 'invite-link').inputValue();
    const code = (await at(pp, 'invite-code').textContent()) ?? '';
    const fragment = new URL(link).hash;
    expect(fragment, "Created's link").toMatch(/^#join=[0-9A-Z]{21}$/);
    await at(pp, 'play-0').click();
    await timed('in pack A', () => waitForInspection(pp, (i) => i.screen === 'prematch' && i.match?.inRoster === true, { what: 'the proposer in pack A', timeoutMs: ANSWER_MS }));

    // Add a bot, Remove a bot, Add again (D-39): the final roster, the list by name, and the buttons.
    const add = at(pp, 'add-bot-0');
    const remove = at(pp, 'remove-bot-0');
    await expect(remove, 'Remove a bot, with no bot hosted').toBeHidden();
    await add.click();
    await timed('bot in', () => waitForInspection(pp, (i) => inPack(i, 0).includes(BOT), { what: "the bot in pack A's final roster", timeoutMs: ANSWER_MS }));
    await expect(listed(pp, 0), "pack A's list, the bot in it").toHaveCount(PACK_SIZE, { timeout: ANSWER_MS });
    expect(BOT_NAMES, "the bot's name, from the list").toContain(BOT_NAME);
    expect(botNamesIn(await inspect(pp)), "the bot's name in the final roster").toEqual({ [BOT]: BOT_NAME });
    await expect(at(pp, 'pack-0'), "pack A's list").toContainText(BOT_NAME);
    await expect(remove, 'Remove a bot, with a bot hosted').toBeVisible();
    await expect(add, 'Add a bot to a full pack').toBeDisabled();
    await remove.click();
    const back = await timed('bot out', () => waitForInspection(pp, (i) => inPack(i, 0).length === 1, { what: "the bot out of pack A's final roster", timeoutMs: ANSWER_MS }));
    expect(back.match!.roster.map((T) => T.id), 'the roster back to the proposer alone').toEqual([PROPOSER]);
    await expect(remove, 'Remove a bot, once its bot is out').toBeHidden({ timeout: ANSWER_MS });
    await expect(listed(pp, 0), "pack A's list, the bot out").toHaveCount(1);
    await expect(at(pp, 'pack-0'), "pack A's list").not.toContainText(BOT_NAME);
    await expect(add, 'Add a bot, with a place again').toBeEnabled();
    await add.click();
    const backIn = await timed('bot in again', () => waitForInspection(pp, (i) => botsIn(i, 0) === 1, { what: "a bot in pack A's final roster again", timeoutMs: ANSWER_MS }));
    await expect(remove, 'Remove a bot, with the bot back').toBeVisible({ timeout: ANSWER_MS });
    // Back by a list name: the first ID's own once its LEAVE has gone, or the next ID's with it taken.
    const [againId, againName] = Object.entries(botNamesIn(backIn))[0]!;
    expect(againName, `the bot back in, ${againId}`).toBe(againId === BOT ? BOT_NAME : botName(againId, [nameOf(0), BOT_NAME]));
    await expect(at(pp, 'pack-0'), "pack A's list").toContainText(againName);

    // Invite: the link and the code Created showed (§5.7).
    const invite = at(pp, 'invite-button');
    await expect(invite).toHaveAttribute('aria-expanded', 'false');
    await invite.click();
    await expect(invite).toHaveAttribute('aria-expanded', 'true');
    await expect(at(pp, 'invite'), "Pre-match's invite").toBeVisible();
    await expect(at(pp, 'invite-link'), "the invite's link").toHaveValue(link);
    await expect(at(pp, 'invite-code'), "the invite's code").toHaveText(code);
    expect(await groupLines(pp, 'invite-code'), "the invite's code, each group of four on one line at 640 × 360 (C-15)").toEqual(Array(6).fill(1));
    await expectAxeClean(pp);

    // Four watchers, the cap, open the link and Watch: each a spectator on Pre-match, every page meshed.
    const watchers = await timed('watchers open', () => Promise.all(
      Array.from({ length: WATCHERS }, (_, n) => openAppPage(cr, base, { k: n + 1, name: nameOf(n + 1), relay, fragment })),
    ));
    pages.push(...watchers);
    await timed('watchers join', () => Promise.all(watchers.map((w) => joinScreen(w, 'Play in a pack, or watch.'))));
    for (const w of watchers) await at(w.page, 'watch').click();
    await timed('watchers watch', () => Promise.all(watchers.map((w) =>
      waitForInspection(w.page, (i) => i.screen === 'prematch' && i.match?.inRoster === false, { what: 'a watcher on Pre-match', timeoutMs: ANSWER_MS }))));
    for (const w of watchers) await expect(at(w.page, 'ready'), "a spectator's Ready").toBeHidden();
    const room = [proposer, ...watchers];
    took['meshed'] = Math.round(await expectPeers(room, WATCHERS, 'the proposer and the watchers'));

    // A fifth is one spectator too many (C-11): its message, with Try again, axe; the others count four again.
    // It opens once every page counts the other four, so each watcher has met the room and counted it.
    const fifth = await openAppPage(cr, base, { k: WATCHERS + 1, name: nameOf(WATCHERS + 1), relay, fragment });
    pages.push(fifth);
    await timed('fifth joins', () => joinScreen(fifth, 'Play in a pack, or watch.'));
    await at(fifth.page, 'watch').click();
    const full = await timed('fifth refused', () => waitForInspection(fifth.page, (i) => i.message === 'spectators', { what: 'the spectators message', timeoutMs: ANSWER_MS }));
    expect(full.screen, "the fifth's screen").toBe('message');
    const message = fifth.page.locator('section[data-test="message"][data-message="spectators"]');
    const heading = message.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText('This match has the most spectators it can take');
    await expect(heading, "the message's heading, focused on entry").toBeFocused();
    await expect(at(fifth.page, 'message-try-again'), 'Try again').toBeVisible();
    await expect(at(fifth.page, 'message-home'), 'Home').toBeVisible();
    await expectAxeClean(fifth.page);
    took['fifth gone'] = Math.round(await expectPeers(room, WATCHERS, 'the room once the fifth had gone'));
    // Try again: the link again, Join's choices; Watch, refused again; and Try again at once, inside the grace
    // its room takes to close: that room's ID opens again only once it has, and Join offers its choices.
    await at(fifth.page, 'message-try-again').click();
    await timed('fifth again', () => joinScreen(fifth, 'Play in a pack, or watch.'));
    expect(await fifth.page.evaluate(() => location.hash), "the fifth's fragment, the link's").toBe(fragment);
    await at(fifth.page, 'watch').click();
    await waitForInspection(fifth.page, (i) => i.message === 'spectators', { what: 'the spectators message again', timeoutMs: ANSWER_MS });
    await at(fifth.page, 'message-try-again').click();
    await timed('fifth again at once', () => joinScreen(fifth, 'Play in a pack, or watch.'));
    took['fifth in again'] = Math.round(await expectPeers(room, WATCHERS + 1, 'the room with the fifth in it again'));
    await at(fifth.page, 'join-home').click();
    await waitForScreen(fifth.page, 'home', ANSWER_MS);
    took['fifth home'] = Math.round(await expectPeers(room, WATCHERS, 'the room once the fifth had gone Home'));

    // One watcher's Leave: Home, the fragment cleared, and every page still in the room counting one fewer.
    const [leaver, ...stay] = watchers as [AppPage, ...AppPage[]];
    await at(leaver.page, 'prematch-leave').click();
    await timed('left', () => waitForScreen(leaver.page, 'home', ANSWER_MS));
    expect(await leaver.page.evaluate(() => location.hash), "the leaver's fragment").toBe('');
    expect((await inspect(leaver.page)).match, "the leaver's match").toBeNull();
    took['peers fall'] = Math.round(await expectPeers([proposer, ...stay], WATCHERS - 1, 'the room once a watcher had left'));

    // P8: both packs full, the proposer's two bots in pack B; the leaver opens the link again, and Join
    // offers Watch alone, beside its status, in view at 640 × 360.
    for (let n = 1; n <= PACK_SIZE; n++) {
      await at(pp, 'add-bot-1').click();
      await waitForInspection(pp, (i) => botsIn(i, 1) === n, { what: `bot ${n} in pack B's final roster`, timeoutMs: ANSWER_MS });
    }
    // Three bots of one host, three names from the list, in its lists and on a watcher's follow choice
    // (the owner, 2026-11-22), each whole there, as every name on the list is in a follow button, here and
    // at a phone's size held sideways.
    const bots = botNamesIn(await inspect(pp));
    const names = Object.values(bots);
    expect([names.length, new Set(names).size, names.every((n) => BOT_NAMES.includes(n))], `the bots' names, ${JSON.stringify(bots)}`).toEqual([3, 3, true]);
    for (const [id, name] of Object.entries(bots)) {
      await expect(pp.locator('.prematch-pack li:not(.free)').getByText(name, { exact: true }), `${id}'s row in its pack's list`).toHaveCount(1);
    }
    const viewer = stay[0]!.page;
    for (const name of names) {
      await expect(at(viewer, 'hud-follow').getByText(name, { exact: true }), `${name} on a watcher's follow choice`).toHaveCount(1, { timeout: ANSWER_MS });
    }
    const cut = (): Promise<unknown[]> =>
      viewer.locator('[data-test="hud-follow"] .hud-follow-name').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    const followRow = { row: `[data-test="hud-follow"] button[data-follow="${Object.keys(bots)[0]!}"]`, name: '.hud-follow-name' };
    const unfitted = async (): Promise<unknown[]> => (await namesInRow(viewer, followRow, BOT_NAMES)).filter((f) => f.lines !== 1 || f.clipped);
    expect([await cut(), await unfitted()], "names cut short on a watcher's follow choice, then the list's in a follow button").toEqual([[], []]);
    // The measure sees a name cut short: C-17's longest, of its widest letter, ends in an ellipsis there.
    expect((await namesInRow(viewer, followRow, ['W'.repeat(config.displayNameMaxChars)]))[0]!.clipped, 'a follow button cutting 20 W short').toBe(true);
    // Each bot's button marked as a bot's, its swatch a robot's head drawn in the swatch's own box and its name
    // heard as "… bot", the proposer's neither (the owner, 2026-11-23); Join's rows the same, below.
    const marks = [nameOf(0), ...names].map((name) => markText({ name, head: name !== nameOf(0), heardAsBot: name !== nameOf(0) })).sort();
    const followMarks = await rowMarks(viewer, '[data-test="hud-follow"] button:not([data-follow="ball"])', '.hud-follow-name');
    expect(followMarks.map(markText).sort(), "the follow choice's marks").toEqual(marks);
    await viewer.setViewportSize(PHONE_SIDEWAYS);
    expect([await cut(), await unfitted()], `the same at ${PHONE_SIDEWAYS.width}×${PHONE_SIDEWAYS.height}`).toEqual([[], []]);
    await viewer.setViewportSize({ width: 640, height: 360 });
    await leaver.page.goto(link);
    await timed('full join', () => joinScreen(leaver, 'Both packs are full: you can watch.'));
    const watch = at(leaver.page, 'watch');
    await expect(at(leaver.page, 'watch-alone').locator('[data-test="watch"]'), 'Watch beside the status (P8)').toBeVisible();
    await expect(watch, 'Watch in view at 640 × 360 (P8)').toBeInViewport({ ratio: 1 });
    for (const p of [0, 1]) await expect(at(leaver.page, `play-${p}`), `Play in pack ${p}, full`).toBeDisabled();
    // Join's lists by the bots' names, and every name on the list on one line in a bot's row there, inside its
    // pack's box, at 640 × 360 and at a phone's width held upright (the owner, 2026-11-22).
    for (const name of names) {
      await expect(leaver.page.locator('.join-pack li').getByText(name, { exact: true }), `${name} in Join's lists`).toHaveCount(1);
    }
    expect((await rowMarks(leaver.page, '.join-pack li:not(.free)', '.name')).map(markText).sort(), "Join's rows' marks").toEqual(marks);
    // Pack B's rows are the proposer's bots alone.
    const joinUnfitted = async (): Promise<unknown[]> =>
      (await namesInRow(leaver.page, { row: '[data-test="join-pack-1"] li:not(.free)', name: '.name', inside: '.join-pack', within: '.coat-name' }, BOT_NAMES))
        .filter((f) => f.lines !== 1 || f.clipped || !f.inside);
    expect(await joinUnfitted(), "list names past a bot's row in Join's lists at 640×360").toEqual([]);
    await leaver.page.setViewportSize(PHONE_UPRIGHT);
    expect(await joinUnfitted(), `list names past a bot's row in Join's lists at ${PHONE_UPRIGHT.width}×${PHONE_UPRIGHT.height}`).toEqual([]);
    await leaver.page.setViewportSize({ width: 640, height: 360 });

    console.log(`watchers: ${JSON.stringify(took)}`);
    for (const p of pages) expectEverywhere(p.watch);
  } finally {
    for (const b of browsers) await b.close();
    await relayServer.close();
  }
});
