// One player ID on two pages at once, through the real screens (M4's
// design, research/m4/DESIGN.md, §5.10, §9.1; PLAN C-12, D-21; phase 2d's
// review, screens-msg-F1 and -F3), once, in the net project: one Chromium
// with three contexts, each a normal page opened by e2e/lib/browsers.ts'
// openAppPage over the local relay alone, its ICE local (M4-Q3), at
// 640 × 360 and stored low quality (§9.1). Every wait polls the hook every
// 50 ms, never animation frames (C-6). Nobody presses Ready, so the match
// stays in warm-up.
// - A keeper proposes at 1 a side for a minute and plays in pack A; a
//   joiner opens the link and plays in pack B.
// - A third context, seeded with the joiner's player ID, as a window of
//   the same browser without its tab lock would be, opens the link: every
//   page refuses it as a duplicate while the joiner's connection is heard
//   (D-21). It reads "Connecting to the match…", no message at any look,
//   until its refusal has stood a lingering connection's silence and a
//   handshake, 12 s, and then "This match is open in another tab or window
//   of this browser", its heading focused, with Try again and Home; axe.
// - Its Try again, refused again, then the joiner's renderer killed (CDP
//   Page.crash), as an OS kills a phone's tab: the joiner's connection
//   lingers at the keeper, silent, and the page is let in once it has been
//   silent 2 s, replacing it (C-12), back in its terrier on Pre-match, or
//   on Join's choices if warm-up's 3 s silence took the terrier first;
//   never a message.
// - The keeper and the page that came back logged no error and requested
//   nothing but the preview and the relay (expectEverywhere).
// The refusals are the hook's match.refusal, the match's status().refusal.
// Its timeouts are from its measured runs (see ANSWER_MS's and the
// test's). New at M4, by phase 2d's review.

import type { Browser, Locator, Page } from '@playwright/test';
import { config } from '../src/config';
import { personId } from '../src/core/bot/bot-id';
import { REFUSAL } from '../src/core/protocol/messages';
import type { Inspection } from '../src/main';
import { startNostrRelay } from '../vendor/hermet/nostr-relay.mjs';
import { type AppPage, launch, openAppPage, SPEC_SEED } from './lib/browsers';
import { expect, expectEverywhere, test } from './lib/guards';
import { expectAxeClean, inspect, monotonicMs, POLL_MS, waitForInspection, waitForScreen } from './lib/page';

const PACK_SIZE = 1; // not a setting: the room's
const MINUTES = 1; // not a setting: the room's
const JOINER = personId(SPEC_SEED, 1);
/** A duplicate's refusal stands once it has outlasted a lingering connection's silence and a handshake. */
const HOLD_MS = (config.duplicateIdSilentSeconds + config.handshakeTimeoutSeconds) * 1000;
/** A connection silent this long is replaced by a HELLO with its player ID (C-12). */
const SILENT_MS = config.duplicateIdSilentSeconds * 1000;
/** Warm-up's removal of a silent player's terrier (roslambo Q-15). */
const REMOVAL_MS = (config.removalSilentTicks / config.ticksPerSecond) * 1000;

/**
 * Timeouts, from this spec's measured runs (phase 2d's review, software GL, the machine's load 7 to 25),
 * each wait the machine's load lengthens its worst × 3 + 2 s, rounded up to a second, as e2e/lib/
 * practice.ts' are; the watchers spec's where this one's are its. ANSWER_MS: a screen's answer to a
 * click, a peer counted, the watchers spec's 4 s. JOIN_MS: from a page's start on the link to Join's
 * choices, the watchers spec's 12 s (at worst 3.05 s there). REFUSED_MS: from the page's start to its
 * first refusal seen, at worst 0.71 s here, and in the room spec, whose stale page every handshake refuses
 * as this one's are, 2.40 s: 3 × 2.40 + 2 = 9.2 s, set to its 10 s. The message: no sooner than
 * HOLD_MS after that refusal, on the page's own clock, which a 50 ms look can only lengthen, and within
 * HOLD_MS + MESSAGE_SLACK_MS of it, at worst 12.0 s, a timer run's lateness and a look's lag inside the
 * 2 s. BACK_MS: from the kill's command to the page back in the room, at worst 2.4 s: 3 × 2.4 + 2 = 9.2 s,
 * set to 12 s, past warm-up's 3 s removal and the Join that follows it.
 */
const ANSWER_MS = 4_000;
const JOIN_MS = 12_000;
const REFUSED_MS = 10_000;
const MESSAGE_SLACK_MS = 2_000;
const BACK_MS = 12_000;
/** The whole test, made as long as a hang in its longest wait would make it, × 2, as the other net specs'. */
const DUPLICATE_TEST_MS = 120_000;

const at = (page: Page, id: string): Locator => page.locator(`[data-test="${id}"]`);

/** The page's hook every 50 ms until `done`, each look to `each` first; returns the look that ended it and
 *  when, on the monotonic clock. */
async function looks(page: Page, done: (i: Inspection) => boolean, o: { what: string; timeoutMs: number; each?: (i: Inspection) => void }): Promise<{ i: Inspection; atMs: number }> {
  const from = monotonicMs();
  for (;;) {
    const i = await inspect(page);
    o.each?.(i);
    if (done(i)) return { i, atMs: monotonicMs() };
    if (monotonicMs() - from > o.timeoutMs) throw new Error(`${o.what}: not within ${o.timeoutMs} ms; screen ${i.screen}, message ${i.message}, refusal ${i.match?.refusal ?? null}, peers ${i.match?.peers ?? null}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

test("a duplicate player ID waits out a lingering connection before its message, and a killed tab's page comes back by itself (C-12, D-21, §5.10)", async ({ baseURL }) => {
  test.setTimeout(DUPLICATE_TEST_MS);
  const base = baseURL!;
  const relayServer = await startNostrRelay();
  const relay = `ws://127.0.0.1:${relayServer.port}`;
  const browsers: Browser[] = [];
  const watched: AppPage[] = [];
  const took: Record<string, number> = {};
  try {
    const cr = await launch('chromium');
    browsers.push(cr);

    // The keeper proposes at 1 a side and plays in pack A; the joiner plays in pack B by the link.
    const keeper = await openAppPage(cr, base, { k: 0, name: 'Ada', relay });
    watched.push(keeper);
    const kp = keeper.page;
    await waitForScreen(kp, 'home', ANSWER_MS);
    await at(kp, 'propose').click();
    await waitForScreen(kp, 'propose', ANSWER_MS);
    await at(kp, 'pack-size').selectOption(String(PACK_SIZE));
    await at(kp, 'match-length').selectOption(String(MINUTES));
    await at(kp, 'create').click();
    await waitForScreen(kp, 'created', ANSWER_MS);
    const fragment = new URL(await at(kp, 'invite-link').inputValue()).hash;
    await at(kp, 'play-0').click();
    await waitForInspection(kp, (i) => i.screen === 'prematch' && i.match?.inRoster === true, { what: 'the keeper in pack A', timeoutMs: ANSWER_MS });
    const joiner = await openAppPage(cr, base, { k: 1, name: 'Bea', relay, fragment });
    const jp = joiner.page;
    const joining = monotonicMs();
    await waitForScreen(jp, 'join', JOIN_MS);
    await expect(at(jp, 'join-status')).toHaveText('Play in a pack, or watch.', { timeout: JOIN_MS });
    took['join'] = Math.round(monotonicMs() - joining);
    await at(jp, 'play-1').click();
    await waitForInspection(kp, (i) => i.match?.roster.some((T) => T.id === JOINER && T.pack === 1) === true && i.match.peers === 1, {
      what: "the joiner's terrier in pack B, and the keeper's one peer", timeoutMs: ANSWER_MS,
    });

    // The joiner's ID in another context, both pages alive: refused, connecting, no message until it has stood.
    const twin = await openAppPage(cr, base, { k: 1, name: 'Bea', relay, fragment });
    watched.push(twin);
    const tp = twin.page;
    const opened = monotonicMs();
    const messages: string[] = [];
    const noted = (i: Inspection): void => {
      if (i.message !== null && !messages.includes(i.message)) messages.push(i.message);
    };
    const refused = await looks(tp, (i) => i.match?.refusal === REFUSAL.DUPLICATE || i.screen === 'message', {
      what: "the twin's first refusal, a duplicate", timeoutMs: REFUSED_MS, each: noted,
    });
    took['first refusal'] = Math.round(refused.atMs - opened);
    expect([refused.i.screen, messages], 'the twin connecting, refused, no message yet').toEqual(['join', []]);
    await expect(at(tp, 'join-status')).toHaveText('Connecting to the match…');
    const shown = await looks(tp, (i) => i.screen === 'message', {
      what: 'the duplicate message', timeoutMs: HOLD_MS + MESSAGE_SLACK_MS + ANSWER_MS,
      each: (i) => {
        if (i.screen !== 'message' && i.screen !== 'join') throw new Error(`the twin on ${i.screen} while refused`);
      },
    });
    const stood = shown.atMs - refused.atMs;
    took['message after the refusal'] = Math.round(stood);
    expect(shown.i.message, "the twin's message").toBe('duplicate');
    // The hold: a lingering connection's silence and a handshake, on the page's own clock, which a 50 ms look
    // and its evaluate can only lengthen; and not much past it.
    expect(stood, `the duplicate message ${Math.round(stood)} ms after the first refusal seen: no sooner than ${HOLD_MS} ms (C-12)`).toBeGreaterThanOrEqual(HOLD_MS - POLL_MS);
    expect(stood, `and within ${HOLD_MS + MESSAGE_SLACK_MS} ms of it`).toBeLessThanOrEqual(HOLD_MS + MESSAGE_SLACK_MS);
    const message = tp.locator('section[data-test="message"][data-message="duplicate"]');
    const heading = message.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText('This match is open in another tab or window of this browser');
    await expect(heading, "the message's heading, focused on entry").toBeFocused();
    await expect(message.locator('button')).toHaveText(['Try again', 'Home']);
    await expectAxeClean(tp);
    expect(await tp.evaluate(() => location.hash), "the link's fragment kept for Try again and a reload").toBe(fragment);

    // Try again, refused again while the joiner plays; then the joiner's tab killed. Its connection lingers,
    // silent, and once it has been for 2 s the twin is let in in its place (C-12), with no message. The kill
    // is timed from its command: the renderer's IO thread takes Page.crash at once, whatever its main thread
    // is doing, so the joiner sends nothing from a few ms after it. The crash event reaches Node only once the
    // browser has seen the process exit, which a machine that first dumps its core may put off. On GitHub's
    // runner the twin was back 373 ms after the event, the joiner by then silent 2 s at the keeper: probably the
    // event late, though a joiner stalled just before the kill would look the same. How late the event came,
    // in a failure's message as in the log, tells the two apart.
    await at(tp, 'message-try-again').click();
    await waitForScreen(tp, 'join', ANSWER_MS);
    messages.length = 0;
    await looks(tp, (i) => i.match?.refusal === REFUSAL.DUPLICATE, { what: 'the twin refused again', timeoutMs: REFUSED_MS, each: noted });
    const crashed = new Promise<void>((resolve) => jp.once('crash', () => resolve()));
    const cdp = await joiner.context.newCDPSession(jp);
    const killed = monotonicMs();
    void cdp.send('Page.crash').catch(() => {});
    await crashed;
    took['crash reported'] = Math.round(monotonicMs() - killed);
    const reported = `the crash reported ${took['crash reported']} ms after it`;
    // Back in its terrier, or on Join with the match held and the terrier gone, warm-up's removal: Join while the
    // roster still holds it is the moment between the STATE's adoption and the timer run that shows Pre-match.
    const back = await looks(tp, (i) => i.screen === 'prematch' || (i.screen === 'join' && i.match?.started === true && !i.match.returning && !i.match.inRoster), {
      what: `the twin back in the room after the kill's command, ${reported}`, timeoutMs: BACK_MS, each: noted,
    });
    took['back after the kill'] = Math.round(back.atMs - killed);
    expect(messages, 'no message once the joiner had gone (C-12)').toEqual([]);
    expect(back.atMs - killed, `the twin let in ${Math.round(back.atMs - killed)} ms after the kill's command, ${reported}: no sooner than the old connection's ${SILENT_MS} ms of silence`)
      .toBeGreaterThanOrEqual(SILENT_MS - POLL_MS);
    const returned = back.i.screen === 'prematch';
    console.log(`duplicate: the twin back ${took['back after the kill']} ms after the kill, ${returned ? 'in its terrier' : `on Join, warm-up's ${REMOVAL_MS} ms having taken its terrier`}`);
    if (returned) {
      expect(back.i.match, "the twin in the joiner's terrier").toMatchObject({ returning: true, inRoster: true, peers: 1 });
      await waitForInspection(kp, (i) => i.match?.roster.some((T) => T.id === JOINER) === true && i.match.peers === 1, {
        what: "the keeper's roster with the terrier, its one peer the twin", timeoutMs: ANSWER_MS,
      });
    } else {
      await expect(at(tp, 'join-status')).toHaveText('Play in a pack, or watch.', { timeout: ANSWER_MS });
    }

    console.log(`duplicate: ${JSON.stringify(took)}`);
    for (const p of watched) expectEverywhere(p.watch);
  } finally {
    for (const b of browsers) await b.close();
    await relayServer.close();
  }
});
