// One room in three engines over the local relay, through the real screens
// (M4's design, research/m4/DESIGN.md, §5.6, §5.10, §5.11, §9.3's room
// row, R-11; PLAN §16's mismatch, D-21, D-30, M3-Q20), once, in the net
// project: a pack-size-2 room, Chromium's player and its bot in pack A,
// Firefox's and WebKit's players in pack B, and a Chromium watcher, each a
// normal page opened by e2e/lib/browsers.ts' openAppPage, its hook's relay
// the local one and its ICE local (M4-Q3), at 640 × 360 and stored low
// quality (§9.1). Every button is a click on the real page, and every wait
// polls the hook every 50 ms, never animation frames (C-6); nobody presses
// Ready in phase 2d, so the room stays in warm-up.
// - The build mismatch (PLAN §16): a fifth page, in Chromium, loads the
//   bundle rewritten by interception, its build inputs' one literal
//   changed, so its build hash differs (D-21). Opening the link, every
//   handshake is refused for the build: the page counts no peer, and shows
//   "A different version" with Home alone, its heading focused; through
//   it, every page in the room stays on Pre-match counting the same peers.
// - The leave prompt kept (§5.11, M3-Q20, R-11): on Pre-match, after a key
//   press there, Firefox's page is closed with its beforeunload handlers
//   run and its prompt dismissed. The page stays open, and for 5 s of
//   ticks after, every page counts the same peers at every look, and
//   every page's final state holds Firefox's inputs to within 30 ticks of
//   its final tick: the guard stopped the event before Trystero's own
//   listener on the window, which would have left the room.
// - The leave prompt accepted: after a key press there, the watcher's page
//   is closed the same way, its prompt accepted. It closes, leaving its
//   room on pagehide, and every page left in the room counts one fewer:
//   at once when its leave reaches them, as it does in most runs, or by
//   Trystero's own disconnect path, 10 to 12 s, when the closing page goes
//   before its leave does (phase 2d's review, net-netspecs-F1). Which path
//   it took is logged.
// - Every page logged no error and requested nothing but the preview and
//   the relay (expectEverywhere).
// The lost contexts are phase 3's (§9.3), with Ready and play. The peer
// counts are the hook's match.peers, the match's status().peers. Its
// timeouts are from its measured runs (see ANSWER_MS's and the test's).
// New at M4, by phase 2d.

import { fileURLToPath } from 'node:url';
import type { Browser, Dialog, Locator, Page } from '@playwright/test';
import { buildInputs } from '../scripts/build-inputs.mjs';
import { config } from '../src/config';
import { botIds, personId } from '../src/core/bot/bot-id';
import type { Inspection } from '../src/main';
import { startNostrRelay } from '../vendor/hermet/nostr-relay.mjs';
import { type AppPage, launch, openAppPage, SPEC_SEED } from './lib/browsers';
import { expect, expectEverywhere, test } from './lib/guards';
import { inspect, monotonicMs, POLL_MS, waitForInspection, waitForScreen } from './lib/page';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACK_SIZE = 2; // not a setting: the room's (§9.3)
const MINUTES = 1; // not a setting: the room's
/** The pages, by k: Chromium's player, Firefox's, WebKit's, the Chromium watcher, the stale page. */
const NAMES: readonly string[] = ['Ada', 'Bea', 'Cal', 'Dot', 'Eli'];
const nameOf = (k: number): string => NAMES[k] ?? '';
const KEEPER = personId(SPEC_SEED, 0);
const FIREFOX = personId(SPEC_SEED, 1);
const WEBKIT = personId(SPEC_SEED, 2);
const BOT = botIds(KEEPER)[0]!;
/** "Seconds later" (§9.3): how long after the dismissed prompt every page is watched, in ticks. */
const KEPT_TICKS = 5 * config.ticksPerSecond; // not a setting: the spec's watch
/** A terrier in control: its last input within this many ticks of the final tick, as M3's spec checks. */
const IN_CONTROL_TICKS = 30; // not a setting: the spec's check

/**
 * Timeouts, from this spec's ten measured runs (phase 2d, software GL, the machine's load 7 to 25),
 * each wait the machine's load lengthens its worst × 3 + 2 s, rounded up to a second, and the one the
 * page's clock sets by e2e/lib/practice.ts' rule. ANSWER_MS: a screen's answer to a click, a terrier in
 * every final roster, the leave prompt after the close, every page's peers after a join or a leave: at
 * worst 345 ms (the prompt), so 3 × 0.35 + 2 = 3.1 s. JOIN_MS: from three engines' starts on the link to
 * Join's choices: at worst 1.68 s (the Wire step's runs), so 3 × 1.68 + 2 = 7.0 s, rounded up to 8 s. REFUSED_MS: from the stale page's start to
 * its message, every handshake refused: at worst 2.40 s, so 3 × 2.40 + 2 = 9.2 s. KEPT_MS: KEPT_TICKS of
 * every page's final ticks from just before the prompt, 5 s at the clock's rate, which took at most
 * 4.89 s and which Chromium's slow clock in software GL could stretch to 5.77 s (2c's 52 ticks a second):
 * 1.5 × 5.77 + 2 = 10.7 s.
 */
const ANSWER_MS = 4_000;
const JOIN_MS = 8_000;
const REFUSED_MS = 10_000;
const KEPT_MS = 11_000;
/** A closed page's departure, seen by the pages left: at once by its leave, which a closing page sends on
 *  pagehide (24 to 179 ms in 29 runs); or, when the page goes before its leave does, by Trystero's own
 *  disconnect path, ICE's disconnected then peer.mjs's 5 s, 10.0 to 12.2 s in the review's runs with no
 *  leave sent: 1.5 × 12.2 + 2 = 20.3 s. */
const DEPARTED_MS = 21_000;
/** Seen within this, the leave reached the pages; past it, the disconnect path took it. */
const LEAVE_SEEN_MS = 2_000;
/** The whole test: at most 30.4 s in its runs (the Wire step's full gate run, its departure by the
 *  disconnect path), made as long as a hang in its longest wait, a page's start in openAppPage (30 s),
 *  would make it, × 2, as the device specs' are: (30.4 + 30) × 2 = 120.8 s. */
const ROOM_TEST_MS = 125_000;

const at = (page: Page, id: string): Locator => page.locator(`[data-test="${id}"]`);

/** The room's connections as the hook reports them: match.peers, the match's status().peers. */
const peersOf = (i: Inspection): number | null => i.match?.peers ?? null;

/** id's last input in a look's final state, -1 if it isn't there. */
const lastInputOf = (i: Inspection, id: string): number => i.match?.roster.find((T) => T.id === id)?.lastInputTick ?? -1;

/**
 * Looks at every page every 50 ms until `done` holds of the looks, failing at once if any page counts
 * other than `peers` connections or leaves Pre-match: the room kept as it was while something else
 * happens. Returns the looks that ended it.
 */
async function roomKept(
  room: readonly AppPage[], peers: number, done: (looks: readonly Inspection[]) => boolean | Promise<boolean>, o: { what: string; timeoutMs: number },
): Promise<Inspection[]> {
  const from = monotonicMs();
  for (;;) {
    const looks = await Promise.all(room.map((p) => inspect(p.page)));
    for (const [k, i] of looks.entries()) {
      const p = room[k]!;
      if (peersOf(i) !== peers || i.screen !== 'prematch') {
        throw new Error(`${o.what}: ${p.engine}'s page ${(monotonicMs() - from).toFixed(0)} ms in counts ${peersOf(i)} peers, not ${peers}, on ${i.screen}`);
      }
    }
    if (await done(looks)) return looks;
    if (monotonicMs() - from > o.timeoutMs) throw new Error(`${o.what}: not within ${o.timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** Each page's look, every 50 ms, until every page counts `peers` connections, at most timeoutMs. Returns how
 *  long it took. */
async function expectPeers(pages: readonly AppPage[], peers: number, why: string, timeoutMs = ANSWER_MS): Promise<number> {
  const from = monotonicMs();
  for (;;) {
    const counts = await Promise.all(pages.map(async (p) => peersOf(await inspect(p.page))));
    if (counts.every((n) => n === peers)) return monotonicMs() - from;
    if (monotonicMs() - from > timeoutMs) {
      throw new Error(`${why}: every page counting ${peers} peers, not within ${timeoutMs} ms: ${pages.map((p, k) => `${p.engine} ${counts[k]}`).join(', ')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** The page's scripts served with the build inputs' literal changed by its last digit, so its build hash
 *  differs (PLAN §16's mismatch, D-21): each counted, so the spec knows the bundle held it. */
async function staleBundle(page: Page, base: string, rewrites: { count: number }): Promise<void> {
  const inputs = buildInputs(ROOT);
  const other = `${inputs.slice(0, -1)}${inputs.endsWith('0') ? '1' : '0'}`;
  await page.route((url) => url.href.startsWith(base) && url.pathname.endsWith('.js'), async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const n = body.split(inputs).length - 1;
    rewrites.count += n;
    await route.fulfill(n === 0 ? { response } : { response, body: body.replaceAll(inputs, other) });
  });
}

/** Closes the page with its beforeunload handlers run, as a player leaving it would (§5.11), its prompt
 *  answered `how`; returns the dialog's type, failing if none came within ANSWER_MS. */
async function closeAsked(p: AppPage, how: 'accept' | 'dismiss', who: string): Promise<string> {
  const page = p.page;
  const asked = new Promise<string>((resolve) => {
    page.once('dialog', (d: Dialog) => {
      resolve(d.type());
      void (how === 'accept' ? d.accept() : d.dismiss());
    });
  });
  await page.close({ runBeforeUnload: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const none = new Promise<string>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${who}: no leave prompt within ${ANSWER_MS} ms of the close`)), ANSWER_MS);
  });
  try {
    return await Promise.race([asked, none]);
  } finally {
    clearTimeout(timer);
  }
}

test('a stale build is refused with its message, a dismissed leave prompt keeps a page in its room, and an accepted one leaves it (D-21, D-30, M3-Q20)', async ({ baseURL }) => {
  test.setTimeout(ROOM_TEST_MS);
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
    const [cr, ff, wk] = await Promise.all([launch('chromium'), launch('firefox'), launch('webkit')]);
    browsers.push(cr, ff, wk);

    // Chromium proposes at 2 a side for a minute, plays in pack A and adds a bot there.
    const keeper = await openAppPage(cr, base, { k: 0, name: nameOf(0), relay });
    pages.push(keeper);
    const kp = keeper.page;
    await waitForScreen(kp, 'home', ANSWER_MS);
    await at(kp, 'propose').click();
    await waitForScreen(kp, 'propose', ANSWER_MS);
    await at(kp, 'pack-size').selectOption(String(PACK_SIZE));
    await at(kp, 'match-length').selectOption(String(MINUTES));
    await at(kp, 'create').click();
    await timed('created', () => waitForScreen(kp, 'created', ANSWER_MS));
    const fragment = new URL(await at(kp, 'invite-link').inputValue()).hash;
    await at(kp, 'play-0').click();
    await timed('in pack A', () => waitForInspection(kp, (i) => i.screen === 'prematch' && i.match?.inRoster === true, { what: 'the keeper in pack A', timeoutMs: ANSWER_MS }));
    await at(kp, 'add-bot-0').click();
    await timed('bot in', () => waitForInspection(kp, (i) => i.match?.roster.some((T) => T.id === BOT && T.pack === 0) === true, {
      what: "the keeper's bot in pack A", timeoutMs: ANSWER_MS,
    }));

    // Firefox and WebKit play in pack B, and a Chromium watcher watches, all by the link.
    const [firefox, webkit, watcher] = await timed('open', () => Promise.all([
      openAppPage(ff, base, { k: 1, name: nameOf(1), relay, fragment }),
      openAppPage(wk, base, { k: 2, name: nameOf(2), relay, fragment }),
      openAppPage(cr, base, { k: 3, name: nameOf(3), relay, fragment }),
    ]));
    pages.push(firefox, webkit, watcher);
    await timed('join', () => Promise.all([firefox, webkit, watcher].map(async (p) => {
      await waitForScreen(p.page, 'join', JOIN_MS);
      await expect(at(p.page, 'join-status'), `${p.engine}'s Join, once the state is held`).toHaveText('Play in a pack, or watch.', { timeout: JOIN_MS });
    })));
    await at(firefox.page, 'play-1').click();
    await at(webkit.page, 'play-1').click();
    await at(watcher.page, 'watch').click();
    const room = [keeper, firefox, webkit, watcher];
    const players = [KEEPER, BOT, FIREFOX, WEBKIT].sort();
    await timed('roster', () => Promise.all(room.map((p) => waitForInspection(p.page, (i) => i.screen === 'prematch' && (i.match?.roster ?? []).map((T) => T.id).sort().join() === players.join(), {
      what: `${p.engine}'s final roster: the keeper and its bot, Firefox's and WebKit's players`, timeoutMs: ANSWER_MS,
    }))));
    took['meshed'] = Math.round(await expectPeers(room, room.length - 1, 'the room'));

    // The build mismatch: refused for its build, with its message, the room unmoved throughout.
    const rewrites = { count: 0 };
    const stale = await openAppPage(cr, base, { k: 4, name: nameOf(4), relay, fragment, beforeLoad: (page) => staleBundle(page, base, rewrites) });
    pages.push(stale);
    expect(rewrites.count, "the build inputs' literal in the page's scripts, rewritten").toBe(1);
    // Measured from the stale page's start: its room opens at once, on Join (C-32).
    await timed('stale refused', () => roomKept(room, room.length - 1, async () => {
      const i = await inspect(stale.page);
      // Refused by every page: it never counts one as a peer, while its match is held, nor shows another message.
      if ((peersOf(i) ?? 0) !== 0) throw new Error(`the stale page counts ${peersOf(i)} peers`);
      if (i.message !== null && i.message !== 'build') throw new Error(`the stale page shows the ${i.message} message, not build`);
      return i.message === 'build';
    }, { what: 'the room while a stale page tries it, to its build message', timeoutMs: REFUSED_MS }));
    expect((await inspect(stale.page)).screen, "the stale page's screen").toBe('message');
    const message = stale.page.locator('section[data-test="message"][data-message="build"]');
    const heading = message.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText('A different version');
    await expect(heading, "the message's heading, focused on entry").toBeFocused();
    await expect(at(stale.page, 'message-home'), 'Home').toBeVisible();
    await expect(at(stale.page, 'message-try-again'), 'no Try again: everyone should reload (§5.10)').toHaveCount(0);
    await roomKept(room, room.length - 1, () => true, { what: 'the room, once the stale page was refused', timeoutMs: ANSWER_MS });

    // Firefox's leave prompt, dismissed after a key press there: the page stays, in its room.
    const fp = firefox.page;
    await fp.keyboard.press('KeyW');
    const from = await Promise.all(room.map((p) => inspect(p.page)));
    const kept = await timed('dismissed', () => closeAsked(firefox, 'dismiss', "Firefox's page"));
    expect(kept, "Firefox's prompt").toBe('beforeunload');
    expect(fp.isClosed(), "Firefox's page, its prompt dismissed").toBe(false);
    const after = await timed('kept', () => roomKept(room, room.length - 1, (looks) => looks.every((i, k) => i.match!.finalTick >= from[k]!.match!.finalTick + KEPT_TICKS), {
      what: 'the room after the dismissed prompt', timeoutMs: KEPT_MS,
    }));
    for (const [k, i] of after.entries()) {
      const last = lastInputOf(i, FIREFOX);
      console.log(`room: ${room[k]!.engine}'s page, ${i.match!.finalTick - from[k]!.match!.finalTick} final ticks on, holds Firefox's input ${i.match!.finalTick - last} behind`);
      expect(i.match!.finalTick - last, `${room[k]!.engine}'s final state: Firefox's last input, within ${IN_CONTROL_TICKS} ticks of its final tick ${i.match!.finalTick}`).toBeLessThan(IN_CONTROL_TICKS);
    }

    // The watcher's leave prompt, accepted after a key press there: it goes, and the others see it leave.
    const wp = watcher.page;
    await wp.keyboard.press('KeyW');
    const closed = wp.waitForEvent('close', { timeout: ANSWER_MS });
    expect(await closeAsked(watcher, 'accept', "the watcher's page"), "the watcher's prompt").toBe('beforeunload');
    await closed;
    const seen = await expectPeers([keeper, firefox, webkit], room.length - 2, 'the room once the watcher had gone', DEPARTED_MS);
    took['seen leaving'] = Math.round(seen);
    console.log(`room: the watcher's departure seen in ${Math.round(seen)} ms, ${seen <= LEAVE_SEEN_MS ? 'by its leave' : "by Trystero's disconnect path, its leave lost"}`);

    console.log(`room: ${JSON.stringify(took)}`);
    for (const p of pages) expectEverywhere(p.watch);
  } finally {
    for (const b of browsers) await b.close();
    await relayServer.close();
  }
});
