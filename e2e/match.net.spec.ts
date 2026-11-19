// PLAN §16's "M3's #test=net match" (M3's design §8.4, R-2, R-3, R-5, R-7;
// PLAN §17's M3 exit): a scripted match over the local relay through the
// #test=net page, without the screens, as roslambo's e2e/round.spec.ts,
// once, in the net project. Three engines through e2e/lib/browsers.ts, in
// one fresh room, seed 7, as §16's three-engine setup: Chromium the keeper
// in pack A on script=back, hosting pack A's bot; Firefox and WebKit in
// pack B on script=none; Ready at tick 600, by which every page is in the
// roster here; pack size 2, 1 minute, decisive by setup (§16), as
// src/net/bots-setups.test.ts plays it over the loopback first (R-7).
// Mid-match, each triggered from the keeper's report, never a sleep: a
// fourth page, in Chromium, joins as a spectator once play shows under 50 s
// on the clock (L281), and WebKit's page reloads once it's under 35 s
// (L282, D-17), each with no celebration under way. The reloading page
// leaves its room on pagehide (design §6.3), so its peers see it go: none
// meets its HELLOs with its old connection still there.
// Checks: the start countdown begins where R-7's replay has it, from every
// page's Ready at its tick (§7.2); every page, the spectator and the
// reloaded one included, reaches the confirmed end at one tick, with one
// score, rows and Terriest, and one hash at a common final tick (P1, P2);
// pack A scored and the score isn't level; every page's confirmed goals are
// the keeper's from its arrival, a goal it arrived during the celebration of
// included, each once (P9, §3.5); the reloaded page returned, and its
// terrier's last input, in every page's final state, is within 30 ticks of
// the end's tick, so it was in control again; and no page logged an error or
// requested anything but the preview and the relay (expectEverywhere). Any
// page's overtime fails it at once (§16: a match level at 0:00 fails its
// test), and every wait's deadline is the match's, from measured runs, each
// failure printing each page's phase, score and clock, and any duplicate
// HELLOs (C-12) a page logged, the reloaded page's among them
// (e2e/lib/browsers.ts's waitFor). Its test is guards.ts's, as every spec's,
// though the guard's own page goes unused here: each page this spec opens
// is watched by openNetPage and checked with expectEverywhere.

import type { Browser } from '@playwright/test';
import { config, derived } from '../src/config';
import { botIds, personId } from '../src/core/bot/bot-id';
import { IN_PLAY, START_COUNTDOWN, WARM_UP } from '../src/core/sim/state';
import type { NetReport } from '../src/nettest-params';
import { startNostrRelay } from '../vendor/hermet/nostr-relay.mjs';
import { type Engine, freshRoom, hashAt, launch, type NetPage, openNetPage, waitFor } from './lib/browsers';
import { expect, expectEverywhere, test } from './lib/guards';

const SEED = 7;
const READY = 600; // not a setting: the setup's Ready tick (design §8.4)
const TPS = config.ticksPerSecond;
const SPECTATOR_UNDER_SECONDS = 50; // not a setting: §8.4's trigger, on the clock
const RELOAD_UNDER_SECONDS = 35; // not a setting: §8.4's trigger, on the clock
const IN_CONTROL_TICKS = 30; // not a setting: §8.4's check
/** The start countdown's first tick, from Ready at READY: pressed in the first timer run at or past it,
 *  after the advance that sent tick READY + d, it rides in the next tick sent, as R-7's replay has it
 *  (603); later only by a timer run late by less than an input's flight, d + w ticks. */
const COUNTDOWN_FROM = READY + config.inputDelayTicks + 1;
const COUNTDOWN_TO = COUNTDOWN_FROM + config.inputDelayTicks + config.lateWindowTicks;
/** A STATE's flight between two pages on one machine, with the one-way delay its clock adds: 100 ms. */
const FLIGHT_TICKS = 6; // not a setting
/** How far past NetGame's arrival a page's scoreboard can take its own (§3.5): it arrives after the
 *  advance of the timer run that follows the STATE, once that has finalised what the STATE's records
 *  hold, up to the page's clock. That runs at most d + w + 1 ticks ahead of the STATE's tick, the
 *  STATE's flight more, and the run's gap, short of a stall, more again. So a goal the page arrived
 *  during the celebration of, sooner than this before the celebration's end, must be latched. */
const ARRIVAL_LAG_TICKS = config.inputDelayTicks + config.lateWindowTicks + 1 + FLIGHT_TICKS + Math.ceil(config.timerStallSeconds * TPS);
/** From the keeper's genesis to every page's confirmed end, at most: over the loopback the setup
 *  ended at most 150.4 s from genesis over 13 runs, seed 7's at 145.3 s (src/net/bots-setups*.test.ts);
 *  here, with the pages' loads, the relay and four pages' timers on one machine, a third more. */
const MATCH_MS = 200_000;
/** Launching the three engines and the keeper's page, before genesis. */
const LAUNCH_MS = 60_000;
const ENGINES: Engine[] = ['chromium', 'firefox', 'webkit'];

/** waitFor's fail: an overtime fails the match at once (§16). */
const overtime = (rs: readonly NetReport[]): string | null =>
  rs.some((r) => r.overtime) ? 'overtime: the match was level at 0:00, which a decisive setup never is (PLAN §16)' : null;

/** Play on the keeper's clock under `seconds`, with no celebration under way. */
const playUnder = (seconds: number) => ([r]: readonly NetReport[]): boolean => r!.phase === IN_PLAY && r!.clock < seconds * TPS;

/** id's terrier in r's final state, its last input within IN_CONTROL_TICKS of `tick`. */
function controlled(r: NetReport, id: string, tick: number): boolean {
  const T = r.roster.find((x) => x.id === id);
  return T !== undefined && tick - T.lastInputTick < IN_CONTROL_TICKS;
}

function line(p: NetPage, r: NetReport): string {
  return (
    `${p.engine} ${r.me.slice(-4)} (${r.role}): end ${r.end?.tick ?? '-'} ${r.end?.score.join('-') ?? ''}, final ${r.finalTick}, ` +
    `arrived ${r.arrivedTick}, peers ${r.peers}, returning ${r.returning}, goals ${r.goals.map((g) => g.tick).join(' ')}; late ${r.stats.late}, ` +
    `lateAbsent ${r.stats.lateAbsent}, disagree ${r.stats.disagree}, resyncs ${r.stats.resyncs}, rollbacks ${r.stats.rollbacks}, ` +
    `maxSteps ${r.stats.maxStepsPerAdvance}, jumps ${r.stats.jumps}, cpu ${r.cpu === null ? '-' : `${r.cpu.mean.toFixed(2)}/${r.cpu.p95.toFixed(2)}/${r.cpu.max.toFixed(1)} ms`}` +
    `${r.duplicates.length > 0 ? `; duplicates ${JSON.stringify(r.duplicates)}` : ''}`
  );
}

test('three engines, a spectator and a reload play a scripted match to one confirmed end', async ({ baseURL }) => {
  test.setTimeout(LAUNCH_MS + MATCH_MS + 30_000);
  const relayServer = await startNostrRelay();
  const relay = `ws://127.0.0.1:${relayServer.port}`;
  const room = freshRoom();
  const browsers: Browser[] = [];
  try {
    for (const engine of ENGINES) browsers.push(await launch(engine));
    const [cr, ff, wk] = [browsers[0]!, browsers[1]!, browsers[2]!];
    const common = { room, seed: SEED, packSize: 2, minutes: 1, ready: READY };
    const keeper = await openNetPage(cr, 'chromium', baseURL!, relay, { ...common, k: 0, role: 'keeper', pack: 0, script: 'back', bots: '0' });
    const genesis = Date.now();
    const left = (): number => Math.max(1, genesis + MATCH_MS - Date.now());
    const [firefox, webkit] = await Promise.all([
      openNetPage(ff, 'firefox', baseURL!, relay, { ...common, k: 1, role: 'player', pack: 1, script: 'none' }),
      openNetPage(wk, 'webkit', baseURL!, relay, { ...common, k: 2, role: 'player', pack: 1, script: 'none' }),
    ]);
    const players = [keeper, firefox, webkit];
    const inRoster = await waitFor(players, (rs) => rs.every((r) => r.roster.length === 4), { timeoutMs: left(), fail: overtime });
    console.log(`every player and the bot in every final roster by final tick ${Math.max(...inRoster.map((r) => r.finalTick))}; Ready at ${READY}`);
    // Every page's Ready at its tick (§7.2), so the start countdown begins where R-7's replay has it.
    const [counting] = await waitFor([keeper], ([r]) => r!.phase !== WARM_UP, { timeoutMs: left(), fail: overtime });
    console.log(`the start countdown from tick ${counting!.phaseStart}`);
    expect(counting!.phase, "the keeper's phase after warm-up").toBe(START_COUNTDOWN);
    expect(counting!.phaseStart, `the start countdown's first tick, from Ready at ${READY}`).toBeGreaterThanOrEqual(COUNTDOWN_FROM);
    expect(counting!.phaseStart, `the start countdown's first tick, from Ready at ${READY}`).toBeLessThanOrEqual(COUNTDOWN_TO);

    // The spectator, once play shows under 50 s (L281).
    await waitFor([keeper], playUnder(SPECTATOR_UNDER_SECONDS), { timeoutMs: left(), fail: overtime });
    const spectator = await openNetPage(cr, 'chromium', baseURL!, relay, { ...common, k: 3, role: 'spectator' });

    // WebKit's reload, once play shows under 35 s (L282, D-17).
    const [atReload] = await waitFor([keeper], playUnder(RELOAD_UNDER_SECONDS), { timeoutMs: left(), fail: overtime });
    console.log(`the spectator in, then the reload at the keeper's final tick ${atReload!.finalTick}, clock ${atReload!.clock}`);
    await webkit.page.reload({ timeout: Math.min(30_000, left()) });
    await webkit.page.waitForFunction(() => window.terriestTest?.net !== undefined, null, { timeout: Math.min(30_000, left()) });
    const all = [keeper, firefox, spectator, webkit];
    const me = personId(SEED, 2);
    const [back] = await waitFor([webkit], ([r]) => r!.returning && r!.arrivedTick >= 0, { timeoutMs: left(), fail: overtime });
    // Its takeover: an input it sent since its return, final on every page.
    await waitFor(all, (rs) => rs.every((r) => (r.roster.find((x) => x.id === me)?.lastInputTick ?? -1) > back!.arrivedTick), {
      timeoutMs: left(),
      fail: overtime,
    });

    // The confirmed end on every page.
    const ends = await waitFor(all, (rs) => rs.every((r) => r.end !== null), { timeoutMs: left(), fail: overtime });
    const tick = Math.min(...ends.map((r) => r.finalTick));
    const hashes = await Promise.all(all.map((p) => hashAt(p.page, tick)));
    console.log(`the match ended ${((Date.now() - genesis) / 1000).toFixed(1)} s after genesis`);
    for (const [k, p] of all.entries()) console.log(`  ${line(p, ends[k]!)}`);

    const end = ends[0]!.end!;
    for (const r of ends) expect(r.end, `${r.me}'s confirmed end: its tick, score, rows and Terriest`).toEqual(end);
    expect(hashes.every((h) => h !== ''), `every page holds final tick ${tick}`).toBe(true);
    expect(new Set(hashes).size, `the state at final tick ${tick}`).toBe(1);
    expect(end.score[0], 'pack A scored').toBeGreaterThan(0);
    expect(end.score[0], "the score isn't level").not.toBe(end.score[1]);
    // The setup's roster: the three players and pack A's bot, the spectator outside it.
    const roster = [[personId(SEED, 0), 0], [botIds(personId(SEED, 0))[0]!, 0], [personId(SEED, 1), 1], [me, 1]].map(([id, pack]) => `${id}:${pack}`);
    for (const r of ends) expect(r.roster.map((T) => `${T.id}:${T.pack}`).sort(), `${r.me}'s final roster`).toEqual(roster.sort());

    // P9: the keeper, there from genesis, latched every goal, the end's score. Every page latched the
    // keeper's goals from its arrival on, at their ticks, each once, and before them the goal whose
    // celebration it arrived during (§3.5). Its scoreboard takes the arrival up to ARRIVAL_LAG_TICKS
    // after the page's, so only a goal whose celebration ended within that of the arrival may go
    // either way. The spectator arrives near goal 1914 here: in the runs so far, from a tick before it to
    // 41 ticks into its celebration.
    const goals = ends[0]!.goals;
    expect([0, 1].map((pack) => goals.filter((g) => g.pack === pack).length), "the keeper's goals, by the pack each counts for").toEqual(end.score);
    for (const r of ends) {
      const after = goals.filter((g) => g.tick > r.arrivedTick);
      const before = goals.filter((g) => g.tick <= r.arrivedTick).at(-1);
      const into = before === undefined ? Infinity : r.arrivedTick - before.tick; // ticks into its celebration
      const ways = into < derived.celebrationTicks - ARRIVAL_LAG_TICKS ? [[before!, ...after]] : into < derived.celebrationTicks ? [after, [before!, ...after]] : [after];
      expect(ways, `${r.me}'s goals ${JSON.stringify(r.goals)}, from its arrival at ${r.arrivedTick}`).toContainEqual(r.goals);
      expect(new Set(r.goals.map((g) => g.tick)).size, `${r.me}'s goals, each once`).toBe(r.goals.length);
    }

    // The reload (D-17): back in its terrier, and in control of it to the end on every page.
    expect(ends[3]!.returning, 'the reloaded page took its terrier back').toBe(true);
    expect(ends[3]!.arrivedTick).toBeGreaterThan(atReload!.finalTick);
    for (const r of ends) expect(controlled(r, me, end.tick), `${r.me}'s state: the reloaded terrier's last input, by the end's tick ${end.tick}`).toBe(true);
    expect(ends[2]!.roster.some((T) => T.id === personId(SEED, 3)), "the spectator's terrier").toBe(false);
    for (const p of all) expectEverywhere(p.watch);
  } finally {
    for (const b of browsers) await b.close();
    await relayServer.close();
  }
});
