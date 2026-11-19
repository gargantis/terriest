// Practice contacts nothing (PLAN P10, L238, §17's M3 exit; M3's design
// §6.4, §8.4, M3-Q22), in Chromium, as §16's Practice runs: §16's Practice
// setup through #test=net&mode=practice, 1 a side, seed 7, the person on
// script=sideways, counting RTCPeerConnections from before the page's own
// scripts, through the start countdown and play to the bot's first
// confirmed goal. Ready is pinned at tick 20, 5 ticks after the person's
// terrier lands in the final roster at tick 15, so a timer up to 5 ticks
// late still presses within the 0 to 10 ticks late that
// src/net/practice.test.ts plays over the timeline for seed 7. Checks: the
// start countdown from the Ready at its tick (§7.2); no RTCPeerConnection
// made, no WebSocket, no request outside the page's origin, the Trystero
// chunk never requested, and the goal latched once. M4's §16 Practice plays
// the whole match through the screens.

import { config } from '../src/config';
import { botIds, personId } from '../src/core/bot/bot-id';
import { CELEBRATION, ENDED, START_COUNTDOWN } from '../src/core/sim/state';
import { countPeerConnections, waitFor } from './lib/browsers';
import { expect, expectWebGL2, test } from './lib/guards';
import { expectStarted, installHook } from './lib/page';

const SEED = 7;
const READY = 20; // not a setting: the person's Ready, a tick (§7.2)
/** src/net/practice.test.ts: the bot's first confirmed goal latched at most 16.6 s after Practice
 *  started, over seed 7's Ready from 0 to 10 ticks late and 10 more seeds; with Ready 5 ticks late,
 *  as here, 10.6 s. Its slowest, with the page's load and a busy machine's timers, twice over. */
const FIRST_GOAL_MS = 45_000;
const SECOND_TICKS = config.ticksPerSecond;
/** The start countdown's first tick, from Ready at READY, the bots ready already (C-41): pressed in the
 *  first timer run at or past it, after the advance that sent tick READY + d, it rides in the next tick
 *  sent; later only by a timer run late by less than an input's flight, d + w ticks. */
const COUNTDOWN_FROM = READY + config.inputDelayTicks + 1;
const COUNTDOWN_TO = COUNTDOWN_FROM + config.inputDelayTicks + config.lateWindowTicks;

test.skip(({ browserName }) => browserName !== 'chromium', "Practice's spec runs in Chromium, as §16's Practice does (design §8.4)");

test("Practice plays to the bot's first confirmed goal, contacting nothing", async ({ page, guard, baseURL }) => {
  test.setTimeout(FIRST_GOAL_MS + 30_000);
  await expectWebGL2(page);
  await countPeerConnections(page);
  await installHook(page);
  const me = personId(SEED, 0);
  await page.goto(`./#test=net&mode=practice&packSize=1&minutes=1&seed=${SEED}&k=0&script=sideways&ready=${READY}`);
  await expectStarted(page);
  await expect(page.getByRole('main')).toHaveAttribute('id', 'net');
  await page.waitForFunction(() => window.terriestTest?.net !== undefined, null, { timeout: 30_000 });
  const pages = [{ page, watch: guard, engine: 'chromium' as const }];
  // The phases the looks saw, for the log: a goal comes only in play, after the start countdown, whose
  // first tick the looks note.
  const phases = new Set<number>();
  let countdown = -1;
  const [r] = await waitFor(
    pages,
    ([x]) => {
      phases.add(x!.phase);
      if (x!.phase === START_COUNTDOWN) countdown = x!.phaseStart;
      return x!.goals.length > 0;
    },
    {
      timeoutMs: FIRST_GOAL_MS,
      fail: ([x]) => (x!.phase === ENDED ? 'Practice ended without a confirmed goal' : x!.rtcConnections !== 0 ? `${x!.rtcConnections} RTCPeerConnections` : null),
    },
  );
  console.log(
    `Practice: the start countdown from tick ${countdown}, the first confirmed goal at tick ${r!.goals[0]!.tick}, latched by final tick ${r!.finalTick}; ` +
      `phases seen ${[...phases].sort().join(', ')}; cpu ${JSON.stringify(r!.cpu)}`,
  );
  expect(r!.mode).toBe('practice');
  // The Ready at its tick (§7.2), so the countdown begins where practice.test.ts plays it.
  expect(countdown, `the start countdown's first tick, from Ready at ${READY}`).toBeGreaterThanOrEqual(COUNTDOWN_FROM);
  expect(countdown, `the start countdown's first tick, from Ready at ${READY}`).toBeLessThanOrEqual(COUNTDOWN_TO);
  // The bot's, into pack A's open goal (§16's setup), latched once.
  expect(r!.goals, 'the goals latched').toEqual([{ tick: r!.goals[0]!.tick, pack: 1, ownGoal: false, scorers: [botIds(me)[0]] }]);
  expect(r!.score).toEqual([0, 1]);
  // Once: still the one goal a second of final ticks on, in its celebration.
  const [later] = await waitFor(pages, ([x]) => x!.finalTick > r!.goals[0]!.tick + SECOND_TICKS, { timeoutMs: 10_000 });
  expect(later!.goals, 'the goals latched, a second on').toEqual(r!.goals);
  expect(later!.phase).toBe(CELEBRATION);
  // Nothing contacted (P10): no RTCPeerConnection, which the request guard can't see, no peer, no
  // WebSocket, nothing outside the page's origin, and Trystero's chunk never loaded.
  expect([later!.rtcConnections, later!.peers, later!.refusedBy]).toEqual([0, 0, null]);
  expect(guard.requests.filter((u) => /^wss?:/.test(u)), 'WebSockets').toEqual([]);
  expect(guard.requests.filter((u) => !u.startsWith(new URL(baseURL!).origin)), "requests outside the page's origin").toEqual([]);
  expect(guard.requests.filter((u) => /\/trystero-[\w-]+\.js$/.test(u)), 'the Trystero chunk').toEqual([]);
});
