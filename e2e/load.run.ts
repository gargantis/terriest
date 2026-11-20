// The 12-page load run (M3's design, research/m3/DESIGN.md, §8.5; PLAN
// §16's checks outside the gate), off the gate, on a quiet machine, as
// roslambo's e2e/load.spec.ts was:
//
//   npm run build && TERRIEST_LOAD_OUT=research/load/results.json npx playwright test -c playwright.load.config.ts
//
// 12 Chromium pages on one machine through #test=net, against vite preview
// and hermet's local relay: 8 players at 4 a side, each driving its own
// terrier with the brain (script=brain), the first of them the keeper, and
// 4 spectators, in one match of the default 3 minutes, measured for
// LOAD_SECONDS (default 90) of play from the first report that every page
// is in play.
// - It checks: every page connected to 11 peers, at the start and the end;
//   the 8 players in every page's roster; every page's hash equal at a
//   common final tick; every page in the same phase; and no console error
//   or request outside the base URL and the relay (expectEverywhere). It
//   fails at once when a page reports a failed connection or a refusal.
// - It logs, for each page, from its reports at the start and the end of
//   the measured play, so each count is the play's: late inputs (lateBy
//   and lateAbsent too), disagreements, resyncs, clock jumps, steps per
//   tick (the mean over the play; the max is the page's whole run), CPU per
//   timer run (the page's own figures, over its whole run), the match
//   summary (§1.16), and traffic, messages and bytes a second by type, from
//   NetGame's counting link (D-20's measurement).
// - It watches the backlog, so a run that fails says whether the rig's
//   message path fell behind before any input came late: every 2 s of the
//   play measured it polls every page's report through the hook, keeping
//   each page's time, TICKs sent and received, peers, local and final
//   ticks, late inputs and clock jumps, and the machine's load
//   (os.loadavg()). dev/load/backlog.ts reads each receiver's backlog from
//   them, summed over its senders, in seconds of their output by their own
//   ticks. Each page's line logs its largest, and the last line the largest
//   of all, the first poll past d + w and the first that showed a late
//   input. When a check fails, its message starts with what the backlog
//   shows: past d + w no later than the first poll that showed a late
//   input, the rig's message path fell behind, the machine's capacity
//   rather than the protocol's; with inputs late before that, how many, and
//   that the watch can't tell which failed first (verdictOf).
// - Its raw reports, both of each page's with the rates, and the series with
//   each poll's backlogs, go to the file TERRIEST_LOAD_OUT names. Without it
//   the run refuses at once, before it opens a page, so
//   research/load/results.json is written only on purpose, as
//   dev/corrections.measure.ts refuses to overwrite its results.
// phase 6 writes the run's row in docs/acceptance.md, with the machine and
// the date.

import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, loadavg } from 'node:os';
import { dirname, resolve } from 'node:path';
import { backlogOf, type Poll, polledPage, verdictOf } from '../dev/load/backlog';
import { T } from '../src/core/protocol/messages';
import { IN_PLAY } from '../src/core/sim/state';
import type { NetReport } from '../src/nettest-params';
import { startNostrRelay } from '../vendor/hermet/nostr-relay.mjs';
import { freshRoom, hashAt, launch, type NetPage, openNetPage, waitFor } from './lib/browsers';
import { expect, expectEverywhere, test } from './lib/guards';

const SECONDS = Number(process.env.LOAD_SECONDS ?? 90);
const OUT = process.env.TERRIEST_LOAD_OUT;
const PLAYERS = 8; // not a setting: §8.5's 4 a side, the mesh's players
const SPECTATORS = 4; // not a setting: §8.5's, the spectator cap
const PACK_SIZE = 4; // not a setting: §8.5's
const SEED = 7; // not a setting: the end-to-end setups' seed
/** The tick at which the players press Ready, once in the roster: 40 s, by which the 12 pages have
 *  opened, one after another, and the 8 players are final in the roster. */
const READY_TICK = 2400; // not a setting: a tick, so the countdown starts at one tick on every page
/** From the last page's opening to every page in play: the Ready tick, the countdown, and margin. */
const TO_PLAY_MS = 180_000; // not a setting
const SAME_PHASE_MS = 10_000; // not a setting: a goal's celebration can start a tick apart on two pages
const POLL_MS = 2000; // not a setting: the backlog watch's period
/** The type bytes' names (src/core/protocol/messages.ts's T). */
const TYPE_NAMES: Readonly<Record<number, string>> = Object.fromEntries(Object.entries(T).map(([name, code]) => [code, name]));

/** A page's reason to stop the run at once: a connection that failed, or a refusal. */
function failure(rs: readonly NetReport[]): string | null {
  for (const [k, r] of rs.entries()) {
    if (r.failed) return `page ${k} couldn't connect (PLAN §8's connection failure)`;
    if (r.refused !== null) return `page ${k}'s JOIN was given up: ${r.refused}`;
    if (r.spectatorsFull) return `page ${k} found the spectators full (D-21)`;
  }
  return null;
}

/** Messages and bytes, sent and received. */
interface Counts {
  readonly sent: number;
  readonly received: number;
  readonly sentBytes: number;
  readonly receivedBytes: number;
}

/** What a page did over the measured play: counts, and a second where they're rates. */
interface Rates {
  readonly seconds: number;
  readonly ticks: number;
  readonly remoteInputs: number;
  readonly late: number;
  readonly lateShare: number;
  readonly lateBy: readonly number[];
  readonly lateAbsent: number;
  readonly disagree: number;
  readonly resyncs: number;
  readonly resyncFailed: number;
  readonly jumps: number;
  readonly stepsPerTick: number;
  readonly maxStepsPerAdvance: number; // over the page's whole run
  readonly cpu: NetReport['cpu']; // ms per timer run that moved the clock, over the page's whole run
  readonly traffic: Counts & { readonly byType: Readonly<Record<string, Counts>> }; // a second
}

function rates(a: NetReport, b: NetReport, seconds: number): Rates {
  const ticks = b.localTick - a.localTick;
  const d = (f: (r: NetReport) => number): number => f(b) - f(a);
  const perSecond = (x: Counts, y: Counts): Counts => ({
    sent: (y.sent - x.sent) / seconds, received: (y.received - x.received) / seconds,
    sentBytes: (y.sentBytes - x.sentBytes) / seconds, receivedBytes: (y.receivedBytes - x.receivedBytes) / seconds,
  });
  const zero: Counts = { sent: 0, received: 0, sentBytes: 0, receivedBytes: 0 };
  const byType: Record<string, Counts> = {};
  const types = new Set([...Object.keys(a.traffic.byType), ...Object.keys(b.traffic.byType)].map(Number));
  for (const type of [...types].sort((x, y) => x - y)) byType[TYPE_NAMES[type] ?? String(type)] = perSecond(a.traffic.byType[type] ?? zero, b.traffic.byType[type] ?? zero);
  const remoteInputs = d((r) => r.stats.receivedInputs);
  const late = d((r) => r.stats.late);
  return {
    seconds, ticks, remoteInputs, late, lateShare: remoteInputs > 0 ? late / remoteInputs : 0,
    lateBy: b.stats.lateBy.map((n, k) => n - (a.stats.lateBy[k] ?? 0)), lateAbsent: d((r) => r.stats.lateAbsent),
    disagree: d((r) => r.stats.disagree), resyncs: d((r) => r.stats.resyncs), resyncFailed: d((r) => r.stats.resyncFailed), jumps: d((r) => r.stats.jumps),
    stepsPerTick: ticks > 0 ? d((r) => r.stats.steps) / ticks : 0, maxStepsPerAdvance: b.stats.maxStepsPerAdvance, cpu: b.cpu,
    traffic: { ...perSecond(a.traffic, b.traffic), byType },
  };
}

const fixed = (n: number | undefined, digits = 2): string => (n === undefined ? '-' : n.toFixed(digits));
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, Math.max(0, ms)));

/** A page's report through its hook, and when the page made it: its Date.now(), the machine's clock,
 *  as Node's, for the record, since that clock can step and the watch reads no rate from it. The
 *  page runs nothing else meanwhile, so its counts hold for that moment. */
function stamped(p: NetPage): Promise<{ readonly at: number; readonly report: NetReport }> {
  return p.page.evaluate(() => {
    const net = window.terriestTest?.net;
    if (net === undefined) throw new Error('no window.terriestTest.net: the hook goes in before load, and the page adds net once started');
    const report = net.report();
    return { at: Date.now(), report };
  });
}

test(`${PLAYERS} players and ${SPECTATORS} spectators stay in step for LOAD_SECONDS of play (design §8.5)`, async ({ baseURL }) => {
  if (OUT === undefined || OUT === '') {
    throw new Error('Refusing to run without TERRIEST_LOAD_OUT: set it to the file the raw reports go to, research/load/results.json to write that on purpose');
  }
  expect(SECONDS > 0, `LOAD_SECONDS ${process.env.LOAD_SECONDS} isn't a number of seconds`).toBe(true);
  test.setTimeout((SECONDS + 900) * 1000);
  const base = baseURL!;
  const relay = await startNostrRelay();
  const relayUrl = `ws://127.0.0.1:${relay.port}`;
  const browser = await launch('chromium');
  const pages: NetPage[] = [];
  try {
    const room = freshRoom();
    for (let k = 0; k < PLAYERS; k++) {
      const role = k === 0 ? 'keeper' : 'player';
      pages.push(await openNetPage(browser, 'chromium', base, relayUrl, { room, seed: SEED, k, role, pack: k % 2, packSize: PACK_SIZE, script: 'brain', ready: READY_TICK }));
    }
    for (let k = PLAYERS; k < PLAYERS + SPECTATORS; k++) {
      pages.push(await openNetPage(browser, 'chromium', base, relayUrl, { room, seed: SEED, k, role: 'spectator', packSize: PACK_SIZE }));
    }
    const peers = PLAYERS + SPECTATORS - 1;
    await waitFor(pages, (rs) => rs.every((r) => r.peers === peers && r.phase === IN_PLAY), { timeoutMs: TO_PLAY_MS, fail: failure });
    // The play measured, every page's report polled every POLL_MS for the backlog watch, from the
    // first report to the last.
    const from = Date.now();
    const polls: Poll[] = [];
    const poll = async (): Promise<NetReport[]> => {
      const ms = Date.now() - from;
      const load = loadavg();
      const got = await Promise.all(pages.map(stamped));
      polls.push({ ms, load, pages: got.map((g) => polledPage(g.at - from, g.report)) });
      return got.map((g) => g.report);
    };
    const start = await poll();
    const until = from + SECONDS * 1000;
    for (let due = from + POLL_MS; due < until; due += POLL_MS) {
      await sleep(due - Date.now());
      await poll();
    }
    await sleep(until - Date.now());
    const end = await poll();
    const seconds = (Date.now() - from) / 1000;
    // One hash at the newest final tick every page holds, read before it leaves their histories.
    const tick = Math.min(...end.map((r) => r.finalTick));
    const hashes = await Promise.all(pages.map((p) => hashAt(p.page, tick)));
    const backlog = backlogOf(polls);
    const verdict = verdictOf(backlog);
    const { limitSeconds, max, onset, lateOnset } = backlog;

    // The raw reports go out before the checks, so a failing run leaves its figures.
    const rows = pages.map((_, k) => ({ k, role: end[k]!.role, rates: rates(start[k]!, end[k]!, seconds) }));
    const machine = { cpu: cpus()[0]?.model ?? null, cores: availableParallelism(), node: process.version, browser: browser.version() };
    const out = resolve(OUT);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({
      utc: new Date().toISOString(), ...machine, loadSeconds: SECONDS, seconds, readyTick: READY_TICK, seed: SEED, tick, hashes,
      backlog: { limitSeconds, max, onset, lateOnset, skipped: backlog.skipped, largest: backlog.largest, verdict },
      pages: rows.map((r, k) => ({ ...r, start: start[k], end: end[k] })),
      // The series, each poll with each receiver's backlog then, in seconds of its senders' output.
      pollMs: POLL_MS, polls: polls.map((p, i) => ({ ...p, backlog: backlog.seconds[i] })),
    }, null, 1)}\n`);
    for (const [k, r] of end.entries()) {
      const x = rows[k]!.rates;
      console.log(
        `${String(k).padStart(2)} ${r.role.padEnd(9)} ${r.me.slice(-4)}: phase ${r.phase}, final ${r.finalTick}, peers ${r.peers}; late ${x.late} (${fixed(x.lateShare * 100)}%), ` +
          `lateAbsent ${x.lateAbsent}, disagree ${x.disagree}, resyncs ${x.resyncs}, jumps ${x.jumps}; steps a tick ${fixed(x.stepsPerTick)} mean, ${x.maxStepsPerAdvance} max; ` +
          `cpu a timer run ${fixed(r.cpu?.mean)} mean, ${fixed(r.cpu?.p95)} p95, ${fixed(r.cpu?.max, 1)} max ms; ` +
          `sent ${fixed(x.traffic.sent, 0)} messages, ${fixed(x.traffic.sentBytes / 1000, 1)} kB a second (${Object.entries(x.traffic.byType).map(([t, c]) => `${t} ${fixed(c.sent, 0)}`).join(', ')}); ` +
          `summary: corrections ${r.summary.corrections}, ball p95 ${fixed(r.summary.ball.p95, 3)} m, remote p95 ${fixed(r.summary.remote.p95, 3)} m; ` +
          `backlog ${fixed(backlog.largest[k], 3)} s at most`,
      );
    }
    const when = (ms: number): string => `${fixed(ms / 1000, 1)} s`;
    const limit = `d + w (${fixed(limitSeconds, 3)} s)`;
    const loads = polls.map((p) => p.load[0]!);
    console.log(
      `Wrote ${out}: ${fixed(seconds, 1)} s of play, every page's hash at tick ${tick}: ${[...new Set(hashes)].join(', ')}; ` +
        `the backlog ${fixed(max?.seconds, 3)} s at most (page ${max?.page ?? '-'}'s at ${max === null ? '-' : when(max.ms)}), ` +
        `${onset === null ? `never past ${limit}` : `past ${limit} from ${when(onset.ms)} (page ${onset.page}'s)`}; ` +
        `late inputs ${lateOnset === null ? 'none' : `from ${when(lateOnset.ms)}`}; ${backlog.skipped.length} of ${polls.length - 1} intervals skipped; ` +
        `the 1-minute load ${fixed(loads[0])} at the first poll, ${fixed(Math.max(...loads))} at most`,
    );

    try {
      for (const r of [...start, ...end]) expect(r.peers, `${r.me}: connected to the other ${peers}`).toBe(peers);
      for (const r of end) expect(r.roster.length, `${r.me}'s roster`).toBe(PLAYERS);
      expect(hashes.every((h) => h !== ''), `every page holds tick ${tick}`).toBe(true);
      expect(new Set(hashes).size, `one hash at tick ${tick}`).toBe(1);
      // One phase on every page: a goal's celebration can begin a tick apart, so it's polled for.
      await waitFor(pages, (rs) => new Set(rs.map((r) => r.phase)).size === 1, { timeoutMs: SAME_PHASE_MS, fail: failure });
      for (const p of pages) expectEverywhere(p.watch);
    } catch (e) {
      // The check's own message, after what the backlog says of the failure: the machine's capacity
      // when the rig's message path fell past d + w no later than the first late input (verdictOf).
      if (e instanceof Error) e.message = `${verdict.text}\n\n${e.message}`;
      throw e;
    }
  } finally {
    await browser.close();
    await relay.close();
  }
});
