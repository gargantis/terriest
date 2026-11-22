// PLAN §16's three-engine match through the screens (M4's design,
// research/m4/DESIGN.md, §4.6, §5.2–§5.11, §9.1, §9.4; L280–L282, L344,
// page-F3, page-F4, M4-Q3, M4-Q36), once, in the net project: Chromium,
// Firefox and WebKit through e2e/lib/browsers.ts, each a normal page of the
// built app (openAppPage) with the hook's relay the local one and ICE
// local, stored low quality, 640 × 360, its profile personId(7, k) and a
// name, so the match is seed 7's setup as src/net/setups-testing.ts
// validated it over the network simulator (screens-setup-1 to -13 and
// screens-hold-start in the gate, the whole Ready band by
// dev/screens-band.vitest.config.ts off it), its scripts and latitudes read
// from that file, which no spec may import (it imports vitest):
// - Chromium proposes from Home: Propose a match, pack size 2, 1 minute,
//   Create; Created shows the link and the code, axe there; Play in pack A,
//   and on Pre-match Add a bot to pack A, the arrows taking the focus back
//   to Ready. Firefox, at Home, goes to the link (page.goto, the fragment's
//   change routed to Join), "Connecting to the match…" and then the packs,
//   axe there, and plays in pack B; WebKit types the code in lower case on
//   Home and joins, axe on its Join, and plays in pack B once Firefox is in
//   it, as the replays' pages join in turn. The players' pages open at Home
//   before Create, so the screens fit before tick 600.
// - Warm-up: each player holds W for 30 ticks, and its terrier moves; then
//   Ready, by Enter on Chromium and Firefox and by the stubbed pad's Start
//   on WebKit, each at its first look at or past tick 600, Ready focused
//   from Pre-match's entry (Q-17), each press's own tick, as the page read
//   it when Ready turned "Ready ✓", inside 600–660.
// - The start countdown: WebKit presses Space three times in it, each at a
//   look that shows at most 240 ticks of it, which D-10 drops; from each
//   countdown Chromium holds S, back in ball view, released at its first
//   look at a second of play, through a goal that comes sooner, as the
//   replays hold it; nobody else holds anything.
// - From the keeper's looks, never a sleep: a fourth page, Chromium's,
//   opens the link once play shows under 50 s on the clock, sees the match
//   has started with Watch in view, and watches: the ball, then the next by
//   C, by the pad's right shoulder and back by its left, a terrier by a tap
//   on its name in the HUD's list, and the last by C, its button inside the
//   list's box (P5), the HUD's choice and the camera following each; WebKit
//   reloads once play shows under 35 s, the leave prompt accepted, skips
//   Join and takes its terrier back, its first input after the rebase
//   holding the base's counters, jump 3 and pounce 0, and its terrier never
//   taking off (§4.6, page-F4).
// - The end: Chromium holds Space from its first look at the head's end and
//   mashes it as Results appear, every press inside the 0.5 s guard
//   dropped and announced, Results unpressed; then Play again by Enter on
//   Chromium and by the pad's Start on WebKit, both to the next match's
//   Pre-match, at the ID every press derives (D-12, C-42), its fragment set
//   by replace: history.length as it was on Results (§5.2, net-F1).
// Checks, beside each step's own: the terriers and the ball moved; every
// page's announcements against its arrival, page-F3's rule as M3's spec
// rules it, each countdown since and each goal latched since, a goal under
// way at the arrival required unless the arrival came in the last 141 of
// its celebration's 204 ticks; the same Results everywhere, the score,
// rows and Terriest, pack A scored and the score not level at 0:00; one
// hash at a common final tick; the spectator outside the roster, seeing the
// same match (L281); WebKit's return; nothing compiled from the start
// countdown to Results on the pages that neither reloaded nor joined
// mid-match; the holds and the Ready presses inside the latitudes the
// replays validated, the holds' starts inside screens-hold-start's; axe on
// Created, Firefox's and WebKit's Join and every page's Results; and
// expectEverywhere on all four pages. Every look at a page is 50 ms after
// the last, and fails at once on an overtime (PLAN §16: a match level at
// 0:00 fails), a stall or a message screen, by its code (§5.10). Chromium
// in software GL takes its messages late (phase 2c's measurement), so every
// page's late inputs, disagreements, resyncs, rollbacks, clock jumps and
// tick rate are logged, never judged, with its countdowns. The run logs one line,
// `screens-match-measure {…}`, attached to the test too, which its timeouts
// were set from. New at M4, by phase 2d's match builder.

import { readFileSync } from 'node:fs';
import type { Browser, Page } from '@playwright/test';
import { config, derived } from '../src/config';
import { botIds, personId } from '../src/core/bot/bot-id';
import { BACK_IN_BALL_VIEW } from '../src/core/bot/setups';
import { formatMatchId, nextMatchId } from '../src/core/match-id';
import { FRAME_BALL, frameOf, jumpCount, pounceCount, stepOf } from '../src/core/sim/input';
import { ENDED, IN_PLAY, KICKOFF_COUNTDOWN, NEVER, START_COUNTDOWN, WARM_UP } from '../src/core/sim/state';
import type { Inspection } from '../src/main';
import type { ResourceCounts } from '../src/render/stage-types';
import { startNostrRelay } from '../vendor/hermet/nostr-relay.mjs';
import { type AppPage, type Engine, launch, openAppPage, SPEC_SEED, waitForStart } from './lib/browsers';
import { PAD, press } from './lib/gamepad';
import { expect, expectEverywhere, test } from './lib/guards';
import { acceptLeavePrompt, expectAxeClean, hashAt, hudOf, inspect, monotonicMs, POLL_MS } from './lib/page';
import { focused, LATEST_START_TICKS, READY_LATITUDE, RELEASE_LATITUDE, SHOWN_MS, where } from './lib/practice';

// --- What the replays validated (src/net/setups-testing.ts) ---

const VALIDATED = readFileSync(new URL('../src/net/setups-testing.ts', import.meta.url), 'utf8');

/** Every number in a constant as that file writes it, exported or not: `const NAME = 50;`, or an array of
 *  them, nested or not, `= [600, 630, 660] as const;`. */
function validated(name: string): number[] {
  const m = new RegExp(`^(?:export )?const ${name} = ([^;]+);`, 'm').exec(VALIDATED);
  if (m === null) throw new Error(`src/net/setups-testing.ts has no ${name} in the form e2e/match.screens.net.spec.ts reads`);
  return Array.from(m[1]!.replace(/ as const$/, '').matchAll(/\d+/g), (x) => Number(x[0]));
}

/** The spec's seed, the replays' and openAppPage's. */
const SEED = validated('SCREENS_SEED')[0]!;
/** Ready at every look's first tick at or past this, validated to READY_LATITUDE later (§9.1, setups-F1). */
const READY_FROM = validated('SCREENS_READY')[0]!;
const READY_TO = READY_FROM + READY_LATITUDE;
/** WebKit's presses, validated as late as this many ticks into the start countdown, a second before its end. */
const JUMPS_BY = Math.max(...validated('JUMPS'));
/** The triggers, on the keeper's clock in play (§8.4). */
const SPECTATOR_UNDER_SECONDS = validated('SPECTATOR_UNDER_SECONDS')[0]!;
const RELOAD_UNDER_SECONDS = validated('RELOAD_UNDER_SECONDS')[0]!;
/** Each player's W in warm-up, held this many ticks. */
const WARM_UP_TICKS = validated('WARM_UP_TICKS')[0]!;

const TPS = config.ticksPerSecond;
const D = config.inputDelayTicks;
/** A hold goes once a second of play shows (setups.ts' specSampler). */
const SECOND = TPS;
/** The keeper's hold, S: BACK in ball view (src/core/bot/setups.ts), step 16, frame 1; the warm-up's W, step 0. */
const HOLD_KEY = 'KeyS';
const HOLD = { step: stepOf(BACK_IN_BALL_VIEW), frame: frameOf(BACK_IN_BALL_VIEW) } as const;
const WARM_KEY = 'KeyW';
const WARM = { step: 0, frame: FRAME_BALL } as const;
/** How far W must run a terrier to count as moved: a test's threshold, not a setting, as practice.spec's. */
const MOVED_M = 0.5;
/** The ball seen this far from the centre spot in play has moved: a test's threshold. */
const BALL_MOVED_M = 1;
/** Results takes a press that begins this long after it shows (Q-17, M4-Q26). */
const GUARD_MS = config.resultsPressGuardSeconds * 1000;
/** The closing mash: Space pressed while Results has shown for less than this, at most MASH_PRESSES times, so
 *  each press is well inside the guard however long it takes to reach the page. */
const MASH_UNTIL_MS = 250;
const MASH_PRESSES = 5;
/** Play again only once Results has shown this long, past the guard. */
const AFTER_GUARD_MS = GUARD_MS + 200;
/** page-F3, as M3's e2e/match.net.spec.ts rules it: how far past its arrival a page's scoreboard can take its
 *  own, d + w + 1 ticks, a STATE's flight between two pages on one machine with the clock's one-way delay
 *  (100 ms), and a timer run's gap short of a stall; so a goal the page arrived during the celebration of,
 *  sooner than this before the celebration's end, must be latched. */
const FLIGHT_TICKS = 6; // not a setting: M3's spec's
const ARRIVAL_LAG_TICKS = D + config.lateWindowTicks + 1 + FLIGHT_TICKS + Math.ceil(config.timerStallSeconds * TPS);
const CELEBRATION_TICKS = derived.celebrationTicks;

// --- Timeouts, from this spec's measured runs (phase 2d's scratch runs, software GL, loads 6 to 25) ---
// As e2e/lib/practice.ts sets them: a wait the machine's load lengthens, a screen's answer, its worst run × 3
// + 2 s; a wait the page's clock sets, the slowest the replays validated, plus the most a run took past its
// ticks, × 1.5, + 2 s; a wait on the room's connection, past the page's own connection failure, which says so
// at 20 s (§5.10); each rounded up to a second, or to 5 s past a minute.

/** A screen's answer to a click, a key or a pad's press: at worst 899 ms, WebKit's return to its terrier after
 *  its reload's start, the next 778 ms, WebKit's Home prepared with three pages loading; 3 × 0.9 + 2 = 4.7 s,
 *  practice.ts' SHOWN_MS. */
const ANSWER_MS = SHOWN_MS;
/** From data-boot=started to Home with the pitch prepared behind it: at worst 778 ms; 3 × 0.78 + 2 = 4.3 s. */
const HOME_MS = 5_000;
/** A room's connection, Created's, Join's state, the return's and the next match's: the page says it couldn't
 *  connect at 20 s (§5.10), which this outlasts; the runs took at most 1.2 s from Created to Join's packs. */
const CONNECT_MS = 30_000;
/** To tick 600, Ready's anchor, 10 s after genesis, and a page's start countdown after its press, at most the
 *  band's second more: 1.5 × 10 + 2 = 17 s. The runs waited at most 6.9 s for the anchor after W. */
const TO_READY_MS = 20_000;
/** The start countdown's 300 ticks, to play: 1.5 × 5 + 2 = 9.5 s; the runs waited at most 4.8 s after WebKit's
 *  third press. */
const TO_PLAY_MS = 10_000;
/** From the last Ready press to every page's Results: the replays' slowest, Ready 632's, 142.0 s, and a run's
 *  most past its ticks, 1.2 s (its Results 136.4 s after its last press, for 135.3 s of ticks);
 *  1.5 × 143.2 + 2 = 216.8 s, which also covers Chromium's clock at 52 ticks a second in software GL
 *  (phase 2c), 163.8 s. */
const TO_RESULTS_MS = 220_000;
/** The whole test: its worst run, made as long as the slowest match the replays validated, × 2, which leaves
 *  each wait inside it to fail first, with its own message: 151.5 s to the next match's Pre-match, its match
 *  128.9 s from the last Ready press to the end, 13.1 s short of 142.0; (151.5 + 13.1) × 2 = 329 s. */
const TEST_MS = 330_000;

// --- One page ---

type Match = NonNullable<Inspection['match']>;
type Hold = NonNullable<Inspection['controls']>['holds'][number];
type Who = 'chromium' | 'firefox' | 'webkit' | 'spectator';

const countsOf = (r: Inspection['render']): ResourceCounts => ({ programs: r.programs, geometries: r.geometries, textures: r.textures });
const sameCounts = (a: ResourceCounts, b: ResourceCounts): boolean => a.programs === b.programs && a.geometries === b.geometries && a.textures === b.textures;

/** A countdown the keeper played, and the play after it, as its looks showed the drawn head. */
interface Period {
  readonly kind: 'start' | 'kickoff';
  readonly countdown: number;
  readonly countdownTicks: number;
  play: number | null;
  /** The head's tick at the look that pressed S for it; null: held still from before. */
  pressedAt: number | null;
  /** The head's tick at the look that let S go in its play; null: the play ended first. */
  releasedAt: number | null;
}

/** What the run logs: the line its timeouts are set from. */
interface Measure {
  ok: boolean;
  error: string | null;
  /** ms since the test began, at each step, on the monotonic clock. */
  readonly wallMs: Record<string, number>;
  /** Each wait's longest, ms, by what it waited for. */
  readonly waits: Record<string, number>;
  /** Each player's Ready: the local tick of the look that pressed it, and of the press itself. */
  readonly ready: Partial<Record<Who, { pollTick: number; pressTick: number }>>;
  /** Each page's start countdown as its first look at it showed it. */
  readonly countdownSeen: Partial<Record<Who, number>>;
  readonly warmUp: Partial<Record<Who, { from: number; to: number | null; moved: number }>>;
  holds: Hold[];
  periods: Period[];
  webkit: {
    pressesInto: number[]; jumpsAtPlay: number | null; takeOffBefore: number | null; base: number | null; first: number | null;
    takeOffBack: number | null; takeOffEnd: number | null; awayMs: number | null; joinStatuses: string[] | null;
  };
  spectator: { follows: string[]; p5: unknown };
  results: Partial<Record<Who, { arrival: number | null; countdowns: readonly number[]; goals: readonly number[]; finalTick: number }>>;
  end: unknown;
  mash: { presses: number; log: unknown };
  /** Each page's figures at its Results: the timeline's stats, the timer, the tick rate since Ready. */
  readonly figures: Partial<Record<Who, { stats: Match['stats']; timer: Match['timer']; ticksPerSecond: number | null; own: Match['own'] }>>;
  next: string | null;
}

/** One page's looks at the hook, every 50 ms, each failing at once on an overtime, a stall, or, once asked,
 *  anything compiled after prepare() (PLAN §12). */
class Look {
  readonly who: Who;
  readonly measure: Measure;
  app: AppPage | null = null;
  last: Inspection | null = null;
  /** The last look on Pre-match or Match, where the controls' figures are. */
  lastPitch: Inspection | null = null;
  /** Nothing compiled from here on, until Results. */
  compiles = false;
  /** The local tick and the monotonic time at its Ready press, for its tick rate. */
  readyAt: { tick: number; ms: number } | null = null;
  /** history.length and the fragment just before its Play again (net-F1). */
  againAt: { length: number; hash: string } | null = null;

  constructor(who: Who, measure: Measure) {
    this.who = who;
    this.measure = measure;
  }

  get page(): Page {
    if (this.app === null) throw new Error(`${this.who}'s page isn't open yet`);
    return this.app.page;
  }

  async look(): Promise<Inspection> {
    const i = await inspect(this.page);
    this.last = i;
    if (i.screen === 'prematch' || i.screen === 'match') this.lastPitch = i;
    // A message ends the page's part at once, by its code: a refusal, the connection failure or the players
    // gone (§5.10), rather than a wait's timeout later.
    if (i.screen === 'message') throw new Error(`${this.who}: the ${i.message} message (§5.10); ${where(i)}`);
    const m = i.match;
    if (m?.overtime === true) throw new Error(`${this.who}: an overtime, which a decisive setup never plays (PLAN §16); ${where(i)}`);
    if (m !== null && m.timer.gapsOverStall > 0) throw new Error(`${this.who}: a timer gap over the stall's 2 s (D-31); ${where(i)}`);
    const r = i.render;
    if (this.compiles && i.screen !== 'results' && r.prepared && r.firstFrame !== null && !sameCounts(countsOf(r), r.firstFrame)) {
      throw new Error(`${this.who}: compiled after prepare(), ${JSON.stringify(countsOf(r))} against ${JSON.stringify(r.firstFrame)} (PLAN §12); ${where(i)}`);
    }
    return i;
  }

  /** Looks until `cond` holds of one, playing `each` at every look before it, and fails on a timeout with
   *  where the page is, and `detail`'s more; the wait's length goes into the line's waits under `what`. */
  async until(
    cond: (i: Inspection) => boolean,
    o: { what: string; timeoutMs: number; each?: (i: Inspection) => Promise<void>; detail?: (i: Inspection) => string },
  ): Promise<Inspection> {
    const began = monotonicMs();
    for (;;) {
      const i = await this.look();
      if (cond(i)) {
        const key = `${this.who}: ${o.what}`;
        this.measure.waits[key] = Math.max(this.measure.waits[key] ?? 0, Math.round(monotonicMs() - began));
        return i;
      }
      await o.each?.(i);
      if (monotonicMs() - began > o.timeoutMs) throw new Error(`${this.who}: ${o.what}: not reached within ${o.timeoutMs} ms; ${where(i)}${o.detail === undefined ? '' : `; ${o.detail(i)}`}`);
      await this.page.waitForTimeout(POLL_MS);
    }
  }
}

/** A promise someone else settles: a trigger from the keeper's looks, a page reaching a step. */
class Signal<T> {
  readonly promise: Promise<T>;
  resolve!: (v: T) => void;
  done = false;

  constructor() {
    this.promise = new Promise<T>((r) => {
      this.resolve = (v) => {
        this.done = true;
        r(v);
      };
    });
  }
}

// --- What the pages record by themselves, by init scripts that only watch ---

/** Ready's states at each change, with the hook's local tick then, and Join's status lines and whether its
 *  packs were offered, each load's own: so a state too short for a look is still checked (§9.6), a press's
 *  tick is its own rather than a look's, and a page that skips Join is seen to. */
async function recorders(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __screensReady: { text: string; canAct: boolean; focused: boolean; tick: number | null }[]; __screensJoin: { statuses: string[]; offered: boolean };
      terriestTest?: { inspect?: () => { match: { localTick: number } | null } };
    };
    w.__screensReady = [];
    w.__screensJoin = { statuses: [], offered: false };
    let lastReady = '';
    const look = (): void => {
      const b = document.querySelector('[data-test="ready"]');
      if (b !== null && b.closest('[hidden]') === null) {
        const s = { text: b.textContent ?? '', canAct: b.getAttribute('aria-disabled') !== 'true', focused: document.activeElement === b };
        const key = JSON.stringify(s);
        if (key !== lastReady) {
          lastReady = key;
          // The local tick in the task that changed it: a press's own (src/ui/prematch.ts follows it at once).
          w.__screensReady.push({ ...s, tick: w.terriestTest?.inspect?.().match?.localTick ?? null });
        }
      }
      const status = document.querySelector('[data-test="join-status"]')?.textContent ?? null;
      const j = w.__screensJoin;
      if (status !== null && j.statuses.at(-1) !== status) j.statuses.push(status);
      const offer = document.querySelector<HTMLElement>('.join-packs');
      if (offer !== null && !offer.hidden) j.offered = true;
    };
    // Join's status and offer from the changes themselves too, so one a later change in the same task takes
    // out of the page, as a return's move to the pitch screen would, is still seen.
    const changed = (records: MutationRecord[]): void => {
      const j = w.__screensJoin;
      for (const r of records) {
        const el = r.target instanceof Element ? r.target : r.target.parentElement;
        if (el === null) continue;
        if (r.type === 'attributes' && el.classList.contains('join-packs') && !(el as HTMLElement).hidden) j.offered = true;
        const status = el.closest('[data-test="join-status"]')?.textContent ?? null;
        if (status !== null && j.statuses.at(-1) !== status) j.statuses.push(status);
      }
      look();
    };
    new MutationObserver(changed).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-disabled', 'hidden'] });
    document.addEventListener('focusin', look);
    document.addEventListener('focusout', () => setTimeout(look, 0));
  });
}

type ReadyState = { readonly text: string; readonly canAct: boolean; readonly focused: boolean; readonly tick: number | null };
const readyStates = (page: Page): Promise<ReadyState[]> => page.evaluate(() => (window as unknown as { __screensReady: ReadyState[] }).__screensReady);
const joinSeen = (page: Page): Promise<{ statuses: string[]; offered: boolean }> =>
  page.evaluate(() => (window as unknown as { __screensJoin: { statuses: string[]; offered: boolean } }).__screensJoin);

/** ms since Results showed, by the page's own clock, which the log's shownAtMs is on (src/ui/clock.ts); null
 *  once the page has left Results, its log another match's. */
function sinceResults(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const i = window.terriestTest?.inspect?.();
    const shown = i?.announcements?.results?.shownAtMs;
    return i?.screen === 'results' && shown !== undefined ? performance.now() - shown : null;
  });
}

/** history.length and the fragment: Play again moves the fragment by replace, adding no entry (§5.2, net-F1). */
const historyOf = (page: Page): Promise<{ length: number; hash: string }> => page.evaluate(() => ({ length: history.length, hash: location.hash }));

/** A box, its whole inside another, to half a pixel, the engines' rounding. */
interface Box { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
const inside = (a: Box, b: Box): boolean => a.left >= b.left - 0.5 && a.top >= b.top - 0.5 && a.right <= b.right + 0.5 && a.bottom <= b.bottom + 0.5;

/** An element's box and the window's, or null without one. */
function boxes(page: Page, selector: string): Promise<{ box: Box; window: Box } | null> {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, window: { left: 0, top: 0, right: innerWidth, bottom: innerHeight } };
  }, selector);
}

/** Results as the page drew it: the heading, the final score, the Terriest line, and each row's name, pack,
 *  goals and touches, the viewer's own "you" tag aside. */
function resultsSeen(page: Page): Promise<{ heading: string; score: string; terriest: string; rows: string[][] }> {
  return page.evaluate(() => ({
    heading: document.querySelector('main h1')?.textContent ?? '',
    score: document.querySelector('[data-test="final-score"]')?.textContent ?? '',
    terriest: document.querySelector('[data-test="terriest"]')?.textContent ?? '',
    rows: Array.from(document.querySelectorAll('[data-test="results"] tbody tr'), (tr) => {
      const th = tr.querySelector('th')!.cloneNode(true) as HTMLElement;
      for (const tag of Array.from(th.querySelectorAll('.tag'))) if (tag.textContent === 'you') tag.remove();
      return [th.textContent ?? '', ...Array.from(tr.querySelectorAll('td'), (td) => td.textContent ?? '')];
    }),
  }));
}

/**
 * S's spans as the keeper's controls sampled them from the start countdown on, against the periods it played,
 * by the replays' rules (src/net/setups-testing.ts' expectHolds, screens-hold-start's range, practice.ts'
 * holdProblems for A): each period's span begins with an input from d + 1 ticks into its countdown to
 * LATEST_START_TICKS before its end, unless one is held still; it ends, where the keeper let go in that play,
 * with an input from a second of play and d ticks to RELEASE_LATITUDE later; S in ball view; nothing else
 * held. A last span sampled to the end, or whose let-go no look saw before Results, counts as held to the end,
 * which the ended state takes no input of (D-8's M2 note): a validated release covers it only if the end came
 * by the latest one, and the replays' "a hold the end found down" covers one that never let go.
 */
function holdProblems(holds: readonly Hold[], periods: readonly Period[], end: number): string[] {
  const out: string[] = [];
  let k = 0;
  let open: Hold | null = null;
  for (const [n, p] of periods.entries()) {
    if (open === null) {
      const h = holds[k++];
      if (h === undefined) {
        out.push(`no hold for countdown ${n}, from tick ${p.countdown}`);
        return out;
      }
      if (h.step !== HOLD.step || h.frame !== HOLD.frame) out.push(`hold ${k - 1} at step ${h.step}, frame ${h.frame}: S in ball view is ${HOLD.step}, ${HOLD.frame}`);
      const first = p.countdown + 1 + D;
      const latest = p.countdown + p.countdownTicks - LATEST_START_TICKS + 1 + D;
      if (h.from < first || h.from > latest) out.push(`hold ${k - 1} from tick ${h.from}: countdown ${n} validates ${first} to ${latest}`);
      open = h;
    }
    if (p.releasedAt === null) continue;
    const lo = p.play! + SECOND + D;
    const hi = lo + RELEASE_LATITUDE;
    if (n === periods.length - 1 && (open.to === null || open.to >= end)) {
      if (end > hi) out.push(`hold ${k - 1} held to the end at tick ${end}: play ${n}, from ${p.play}, validates a let-go by ${hi}`);
    } else if (open.to === null || open.to < lo || open.to > hi) {
      out.push(`hold ${k - 1} to tick ${open.to}: play ${n}, from ${p.play}, validates ${lo} to ${hi}`);
    }
    open = null;
  }
  for (; k < holds.length; k++) out.push(`a hold the keeper didn't play: ${JSON.stringify(holds[k])}`);
  return out;
}

// --- The match ---

class ScreensMatch {
  readonly base: string;
  readonly relay: string;
  readonly measure: Measure;
  readonly began = monotonicMs();
  readonly chromium: Look;
  readonly firefox: Look;
  readonly webkit: Look;
  readonly spectator: Look;
  /** Chromium's browser, where the spectator's page opens at its trigger. */
  cr: Browser | null = null;
  /** The match: its ID, the link Created shows and the code. */
  readonly created = new Signal<{ id: string; link: string; code: string }>();
  /** The keeper's looks: play under 50 s, and under 35 s, on its clock (§9.4's step 6). */
  readonly spectatorGo = new Signal<Inspection>();
  readonly reloadGo = new Signal<Inspection>();
  /** Each page on Results, with its first look there; and the go for Play again once all are checked. */
  readonly atResults: Record<Who, Signal<Inspection>>;
  readonly againGo = new Signal<void>();
  /** The keeper's periods, its ball's furthest in play, and the start countdown's first tick. */
  readonly periods: Period[] = [];
  ballMoved = 0;
  countdown = -1;
  private sDown = false;
  private spaceDown = false;

  constructor(base: string, relay: string) {
    this.base = base;
    this.relay = relay;
    this.measure = {
      ok: false, error: null, wallMs: {}, waits: {}, ready: {}, countdownSeen: {}, warmUp: {}, holds: [], periods: this.periods,
      webkit: { pressesInto: [], jumpsAtPlay: null, takeOffBefore: null, base: null, first: null, takeOffBack: null, takeOffEnd: null, awayMs: null, joinStatuses: null },
      spectator: { follows: [], p5: null }, results: {}, end: null, mash: { presses: 0, log: null }, figures: {}, next: null,
    };
    this.chromium = new Look('chromium', this.measure);
    this.firefox = new Look('firefox', this.measure);
    this.webkit = new Look('webkit', this.measure);
    this.spectator = new Look('spectator', this.measure);
    this.atResults = { chromium: new Signal(), firefox: new Signal(), webkit: new Signal(), spectator: new Signal() };
  }

  mark(step: string): void {
    this.measure.wallMs[step] = Math.round(monotonicMs() - this.began);
  }

  get pages(): Look[] {
    return [this.chromium, this.firefox, this.webkit, this.spectator];
  }

  async open(who: Look, browser: Browser, k: number, name: string, o: { fragment?: string; gamepad?: boolean } = {}): Promise<AppPage> {
    const app = await openAppPage(browser, this.base, { k, name, relay: this.relay, ...o, beforeLoad: recorders });
    acceptLeavePrompt(app.page);
    who.app = app;
    this.mark(`${who.who} started`);
    return app;
  }

  // --- The setup, to Ready ---

  /** Chromium from Home: Propose, Create, Created's link and code and axe; Play in A; Add a bot to A; the
   *  arrows back to Ready; W; Ready by Enter at its anchor. */
  async chromiumSetup(): Promise<void> {
    const k = this.chromium;
    const page = k.page;
    await k.until((i) => i.screen === 'home' && i.startMs.prepared !== null, { what: 'Home, the pitch prepared', timeoutMs: HOME_MS });
    await page.locator('[data-test="propose"]').click();
    await k.until((i) => i.screen === 'propose', { what: 'Propose', timeoutMs: ANSWER_MS });
    await page.locator('[data-test="pack-size"]').selectOption('2');
    await page.locator('[data-test="match-length"]').selectOption('1');
    await page.locator('[data-test="create"]').click();
    const created = await k.until((i) => i.screen === 'created' && i.match?.matchId != null && i.match.started, { what: 'Created', timeoutMs: CONNECT_MS });
    this.mark('created');
    const id = created.match!.matchId!;
    const link = await page.locator('[data-test="invite-link"]').inputValue();
    const code = (await page.locator('[data-test="invite-code"]').textContent()) ?? '';
    // The link is this page's address with the match in its fragment, set by location.replace (§5.2).
    expect([link, code, new URL(page.url()).hash], "Created's link and code, and the page's fragment").toEqual([`${this.base}#join=${id}`, formatMatchId(id), `#join=${id}`]);
    this.created.resolve({ id, link, code });
    await expectAxeClean(page);
    this.mark('created axe');
    await page.locator('[data-test="play-0"]').click();
    await this.readyActs(k, 'Pre-match by Created\'s Play in pack A');
    const pre = k.last!;
    expect(pre.match!.clock, 'a match of 1 minute, its clock unstarted in warm-up').toBe(60 * TPS);
    // Add a bot to pack A (D-39), by a click, which takes the focus; the arrows bring it back to Ready (Q-17).
    const states = (await readyStates(page)).length;
    const add = page.locator('[data-test="add-bot-0"]');
    await expect(add, 'Add a bot to pack A able to act').not.toHaveAttribute('aria-disabled', 'true', { timeout: ANSWER_MS });
    await add.click();
    const bot = botIds(personId(SEED, 0))[0]!;
    await k.until((i) => i.match!.roster.some((r) => r.id === bot && r.pack === 0), { what: "the keeper's bot in pack A", timeoutMs: ANSWER_MS });
    this.mark('bot');
    const before = await readyStates(page);
    expect(before.slice(0, states).filter((s) => !s.focused), `Ready's states before Add a bot, all focused (Q-17): ${JSON.stringify(before)}`).toEqual([]);
    for (let n = 0; n < 8 && (await focused(page)) !== 'ready'; n++) await page.keyboard.press('ArrowUp');
    expect(await focused(page), 'Ready, by the arrows from Add a bot (Q-17)').toBe('ready');
    await this.warmUp(k);
    await this.ready(k, 'enter');
  }

  /** Firefox by the link, from Home, as a player pastes it into a tab already showing terriest: page.goto(link),
   *  the fragment's change routed to Join (§5.2, C-32); Connecting…, then the packs, axe; Play in B; W; Ready by
   *  Enter. Its page opened before Create, so its load is off the 10 s to Ready. */
  async firefoxSetup(): Promise<void> {
    const f = this.firefox;
    await f.until((i) => i.screen === 'home' && i.startMs.prepared !== null, { what: 'Home, the pitch prepared', timeoutMs: HOME_MS });
    const { id, link } = await this.created.promise;
    await f.page.goto(link);
    await this.joinOffered(f, 'by the link');
    expect(new URL(f.page.url()).hash, "the link's fragment").toBe(`#join=${id}`);
    await expectAxeClean(f.page);
    this.mark('firefox join axe');
    await f.page.locator('[data-test="play-1"]').click();
    await this.readyActs(f, "Pre-match by Join's Play in pack B");
    const states = await readyStates(f.page);
    expect(states.filter((s) => !s.focused), `Firefox's Ready states, all focused from Pre-match's entry (Q-17): ${JSON.stringify(states)}`).toEqual([]);
    await this.warmUp(f);
    await this.ready(f, 'enter');
  }

  /** WebKit at Home: the code typed in lower case, Join, the packs, axe; Play in B once Firefox is in it; W;
   *  Ready by the pad's Start. */
  async webkitSetup(): Promise<void> {
    const w = this.webkit;
    const page = w.page;
    await w.until((i) => i.screen === 'home' && i.startMs.prepared !== null, { what: 'Home, the pitch prepared', timeoutMs: HOME_MS });
    const { id, code } = await this.created.promise;
    await page.locator('[data-test="code"]').pressSequentially(code.toLowerCase());
    await page.locator('[data-test="join"]').click();
    await this.joinOffered(w, 'by the code');
    expect(new URL(page.url()).hash, "Join by code sets the link's fragment (§5.2)").toBe(`#join=${id}`);
    await expectAxeClean(page);
    this.mark('webkit join axe');
    const firefoxId = personId(SEED, 1);
    await w.until((i) => i.match!.roster.some((r) => r.id === firefoxId && r.pack === 1), { what: "Firefox's terrier in pack B, before WebKit plays", timeoutMs: TO_READY_MS });
    await page.locator('[data-test="play-1"]').click();
    await this.readyActs(w, "Pre-match by Join's Play in pack B");
    const states = await readyStates(page);
    expect(states.filter((s) => !s.focused), `WebKit's Ready states, all focused from Pre-match's entry (Q-17): ${JSON.stringify(states)}`).toEqual([]);
    await this.warmUp(w);
    await this.ready(w, 'start');
  }

  /** Join's first status "Connecting to the match…", then the packs offered once the state is held (§5.6,
   *  M4-Q2). */
  async joinOffered(p: Look, how: string): Promise<void> {
    await p.until((i) => i.screen === 'join', { what: `Join ${how}`, timeoutMs: ANSWER_MS });
    await expect(p.page.locator('.join-packs'), `Join's packs offered ${how}`).toBeVisible({ timeout: CONNECT_MS });
    await expect(p.page.locator('[data-test="join-status"]')).toHaveText('Play in a pack, or watch.');
    const seen = await joinSeen(p.page);
    expect(seen.statuses[0], `Join's first status ${how}, before the state: ${JSON.stringify(seen)}`).toBe('Connecting to the match…');
    this.mark(`${p.who} join`);
  }

  /** Pre-match drawing, the player in the final roster and Ready able to act, focused and in view. */
  async readyActs(p: Look, what: string): Promise<void> {
    await p.until((i) => i.screen === 'prematch' && i.match?.inRoster === true && i.render.frames > 0, { what, timeoutMs: CONNECT_MS });
    const ready = p.page.locator('[data-test="ready"]');
    await expect(ready, `${p.who}'s Ready able to act`).not.toHaveAttribute('aria-disabled', 'true', { timeout: ANSWER_MS });
    await expect(ready).toHaveText('Ready');
    expect(await focused(p.page), `${p.who}'s Ready focused from Pre-match's entry (Q-17)`).toBe('ready');
    const b = await boxes(p.page, '[data-test="ready"]');
    expect(b !== null && inside(b.box, b.window), `${p.who}'s Ready in view: ${JSON.stringify(b)}`).toBe(true);
    this.mark(`${p.who} in`);
  }

  /** W held in warm-up until the controls have sampled it for WARM_UP_TICKS, the inputs up to the local tick
   *  and d past it, the terrier seen to move (§9.4's step 3). */
  async warmUp(p: Look): Promise<void> {
    const page = p.page;
    const before = await p.look();
    const held = (i: Inspection): number => {
      const h = i.controls?.holds.find((x) => x.step === WARM.step && x.frame === WARM.frame && x.to === null);
      return h === undefined ? 0 : i.match!.localTick + D - h.from + 1;
    };
    await page.keyboard.down(WARM_KEY);
    try {
      await p.until((i) => held(i) >= WARM_UP_TICKS, { what: `W held ${WARM_UP_TICKS} ticks`, timeoutMs: ANSWER_MS });
    } finally {
      await page.keyboard.up(WARM_KEY);
    }
    const after = await p.until((i) => i.controls?.holds.some((h) => h.step === WARM.step && h.frame === WARM.frame && h.to !== null) === true, {
      what: "W's span closed", timeoutMs: ANSWER_MS,
    });
    const span = after.controls!.holds.find((h) => h.step === WARM.step && h.frame === WARM.frame)!;
    const [a, b] = [before.match!.mine!, after.match!.mine!];
    const moved = Math.hypot(b.x - a.x, b.y - a.y);
    p.measure.warmUp[p.who] = { from: span.from, to: span.to, moved };
    expect(span.to! - span.from + 1, `${p.who}'s W, held ${WARM_UP_TICKS} ticks at least: ${JSON.stringify(span)}`).toBeGreaterThanOrEqual(WARM_UP_TICKS);
    expect(moved, `${p.who}'s terrier moved by W, from ${JSON.stringify(a)} to ${JSON.stringify(b)}`).toBeGreaterThan(MOVED_M);
    expect(after.match!.phase, `${p.who}'s W in warm-up`).toBe(WARM_UP);
  }

  /** Ready at the first look at or past READY_FROM, by Enter or the pad's Start, Ready focused; the press's
   *  own local tick, as the page's recorder read it when Ready turned "Ready ✓", inside the validated band. */
  async ready(p: Look, by: 'enter' | 'start'): Promise<void> {
    const page = p.page;
    const at = await p.until((i) => i.match!.localTick >= READY_FROM, { what: `local tick ${READY_FROM}, Ready's anchor`, timeoutMs: TO_READY_MS });
    p.readyAt = { tick: at.match!.localTick, ms: monotonicMs() };
    expect(await focused(page), `${p.who}'s Ready focused at its press (Q-17)`).toBe('ready');
    if (by === 'enter') await page.keyboard.press('Enter');
    else await press(page, PAD.start, ANSWER_MS);
    this.mark(`${p.who} ready`);
    await expect(page.locator('[data-test="ready"]'), `${p.who}'s Ready pressed`).toHaveText(/^(?:Ready ✓|Starting…)$/, { timeout: ANSWER_MS });
    const states = await readyStates(page);
    const pressed = states.find((x) => x.text === 'Ready ✓');
    const r = { pollTick: at.match!.localTick, pressTick: pressed?.tick ?? -1 };
    p.measure.ready[p.who] = r;
    expect([r.pressTick >= READY_FROM, r.pressTick <= READY_TO], `${p.who}'s Ready pressed at local tick ${r.pressTick}, by a look at ${r.pollTick}: validated from ${READY_FROM} to ${READY_TO} (§9.1); ${JSON.stringify(states)}`)
      .toEqual([true, true]);
  }

  /** Every player's start countdown, the first tick each first look showed (logged, as a slow page's catch-up
   *  can delay it, phase 2c). */
  async countdownSeen(p: Look): Promise<Inspection> {
    const c = await p.until((i) => i.match!.phase === START_COUNTDOWN, { what: 'the start countdown', timeoutMs: TO_READY_MS });
    p.measure.countdownSeen[p.who] = c.match!.phaseStart;
    p.compiles = p.who === 'chromium' || p.who === 'firefox';
    return c;
  }

  // --- The match ---

  /** The keeper's hold at one look (§9.1): S down at a countdown's first look, up at the first look that shows
   *  a second of play; Space down from its first look at the head's end; and the triggers. */
  private async keeperLook(i: Inspection): Promise<void> {
    const m = i.match;
    if (m === null) return;
    const page = this.chromium.page;
    const start = m.phase === START_COUNTDOWN;
    const last = this.periods.at(-1);
    if (start || m.phase === KICKOFF_COUNTDOWN) {
      if (last !== undefined && last.countdown === m.phaseStart) return;
      const p: Period = {
        kind: start ? 'start' : 'kickoff', countdown: m.phaseStart, countdownTicks: start ? derived.startCountdownTicks : derived.kickoffCountdownTicks,
        play: null, pressedAt: null, releasedAt: null,
      };
      this.periods.push(p);
      if (!this.sDown) {
        await page.keyboard.down(HOLD_KEY);
        this.sDown = true;
        p.pressedAt = m.headTick;
      }
      return;
    }
    if (m.phase === ENDED) {
      if (!this.spaceDown) {
        await page.keyboard.down('Space');
        this.spaceDown = true;
        this.mark('the head ends');
      }
      return;
    }
    if (m.phase !== IN_PLAY || last === undefined) return;
    this.ballMoved = Math.max(this.ballMoved, Math.hypot(m.ball.x, m.ball.y));
    if (last.play === null) last.play = m.phaseStart;
    if (last.play !== m.phaseStart) throw new Error(`play from tick ${m.phaseStart} with no countdown seen before it: the last began at ${last.countdown}`);
    if (this.sDown && m.headTick - m.phaseStart >= SECOND) {
      await page.keyboard.up(HOLD_KEY);
      this.sDown = false;
      last.releasedAt = m.headTick;
    }
    if (!this.spectatorGo.done && m.clock < SPECTATOR_UNDER_SECONDS * TPS) {
      this.mark('spectator trigger');
      this.spectatorGo.resolve(i);
    }
    if (!this.reloadGo.done && m.clock < RELOAD_UNDER_SECONDS * TPS) {
      this.mark('reload trigger');
      this.reloadGo.resolve(i);
    }
  }

  /** Chromium from Ready to Results: S from each countdown, Space from the head's end, the triggers; then the
   *  mash as Results appear, every press inside the guard dropped and announced (§4.9, Q-17, M4-Q26). */
  async chromiumPlays(): Promise<void> {
    const k = this.chromium;
    const page = k.page;
    const c = await this.countdownSeen(k);
    this.countdown = c.match!.phaseStart;
    await this.keeperLook(c);
    const results = await k.until((i) => i.screen === 'results', { what: 'Results', timeoutMs: TO_RESULTS_MS, each: (i) => this.keeperLook(i) });
    this.mark('chromium results');
    expect(this.spaceDown, 'Space held from the first look at the head’s end, through the final whistle (§9.4’s step 7)').toBe(true);
    if (this.sDown) await page.keyboard.up(HOLD_KEY);
    this.sDown = false;
    await page.keyboard.up('Space');
    let mashed = 0;
    const since = async (): Promise<number> => {
      const ms = await sinceResults(page);
      if (ms === null) throw new Error(`Results' buttons pressed inside the ${GUARD_MS} ms guard (Q-17, M4-Q26): the page left Results after ${mashed} mashed presses`);
      return ms;
    };
    while (mashed < MASH_PRESSES && (await since()) < MASH_UNTIL_MS) {
      await page.keyboard.press('Space');
      mashed++;
    }
    this.measure.mash.presses = mashed;
    expect(mashed, `Space mashed as Results appeared, inside ${MASH_UNTIL_MS} ms of it`).toBeGreaterThan(0);
    while ((await since()) < AFTER_GUARD_MS) await page.waitForTimeout(POLL_MS);
    const after = await k.look();
    const log = after.announcements!.results!;
    this.measure.mash.log = log;
    expect(after.screen, "Results' buttons unpressed by the mash").toBe('results');
    expect(log.presses.length, `each mashed press announced: ${JSON.stringify(log)}`).toBe(mashed);
    expect(log.presses.filter((p) => p.atMs >= GUARD_MS || p.accepted || p.source !== 'keyboard'), `every press inside the guard, dropped (Q-17): ${JSON.stringify(log)}`)
      .toEqual([]);
    this.atResults.chromium.resolve(results);
    await this.againGo.promise;
    expect(await focused(page), 'Play again focused on Results (Q-17)').toBe('again');
    k.againAt = await historyOf(page);
    await page.keyboard.press('Enter');
    this.mark('chromium again');
  }

  /** Firefox from Ready to Results: it holds nothing (the validated setup's pack B). */
  async firefoxPlays(): Promise<void> {
    const f = this.firefox;
    await this.countdownSeen(f);
    this.atResults.firefox.resolve(await f.until((i) => i.screen === 'results', { what: 'Results', timeoutMs: TO_RESULTS_MS }));
    this.mark('firefox results');
  }

  /** WebKit from Ready: Space three times in the start countdown, dropped (D-10); its counter 3 at play; the
   *  reload at the keeper's trigger, skipping Join, the rebase's first input; then Results and Play again by
   *  the pad's Start. */
  async webkitPlays(): Promise<void> {
    const w = this.webkit;
    const page = w.page;
    const into: number[] = this.measure.webkit.pressesInto;
    let i = await this.countdownSeen(w);
    for (;;) {
      const m = i.match!;
      const ticksIn = m.headTick - m.phaseStart;
      expect([m.phase, ticksIn <= JUMPS_BY], `WebKit's press ${into.length + 1} at ${ticksIn} ticks into the start countdown: validated to ${JUMPS_BY} (§9.4's step 4)`)
        .toEqual([START_COUNTDOWN, true]);
      const counted = i.controls!.presses.jump;
      await page.keyboard.press('Space');
      into.push(ticksIn);
      i = await w.until((x) => x.controls!.presses.jump > counted, { what: `Space ${into.length} counted`, timeoutMs: ANSWER_MS });
      if (into.length === 3) break;
    }
    const play = await w.until((x) => x.match!.phase === IN_PLAY, { what: 'play', timeoutMs: TO_PLAY_MS });
    const mine = play.match!.mine!;
    this.measure.webkit.jumpsAtPlay = jumpCount(mine.lastInput);
    expect([jumpCount(mine.lastInput), mine.takeOffTick, play.controls!.presses.jump], "WebKit's terrier at play: its counter at 3, never off the ground (D-10)")
      .toEqual([3, NEVER, 3]);
    const before = await w.until(() => this.reloadGo.done, { what: "the keeper's reload trigger", timeoutMs: TO_RESULTS_MS });
    this.measure.webkit.takeOffBefore = before.match!.mine!.takeOffTick;
    const left = monotonicMs();
    await page.reload();
    await waitForStart(page);
    this.mark('webkit reloaded');
    const returned = (x: Inspection): string => `returning ${x.match?.returning}, in the roster ${x.match?.inRoster}, controls ${x.controls === null ? 'none' : 'made'}`;
    await w.until((x) => x.screen === 'match' && x.match?.returning === true && x.match.inRoster && x.controls !== null, {
      what: 'its terrier taken back, Join skipped', timeoutMs: CONNECT_MS, detail: returned,
    });
    this.measure.webkit.awayMs = Math.round(monotonicMs() - left);
    this.mark('webkit back');
    // The rebase reaches the pitch screen's controls, and its first input after it is sampled within a tick
    // (§4.6): a return that loses it starts the counters at 0 against the stored 3, which acts a jump.
    const back = await w.until((x) => x.controls !== null && x.controls.firstAfterBase !== null, {
      what: "the rebase at onControl, and the first input after it (§4.6, page-F4)", timeoutMs: ANSWER_MS,
      detail: (x) => `${returned(x)}; base ${x.controls?.base ?? null}, its first input ${x.controls?.firstAfterBase ?? null}, the last ${x.controls?.lastInput ?? null}; ` +
        `the terrier's stored input ${x.match?.mine?.lastInput ?? null} (jump ${jumpCount(x.match?.mine?.lastInput ?? 0)}), take-off tick ${x.match?.mine?.takeOffTick ?? null}, ` +
        `${this.measure.webkit.takeOffBefore} before the reload`,
    });
    const join = await joinSeen(page);
    this.measure.webkit.joinStatuses = join.statuses;
    expect([join.offered, join.statuses.filter((s) => s !== 'Connecting to the match…')], `the return skips Join's choices (L215, D-17, M4-Q2): ${JSON.stringify(join)}`)
      .toEqual([false, []]);
    const c = back.controls!;
    const base = c.base!;
    const first = c.firstAfterBase!;
    this.measure.webkit.base = base;
    this.measure.webkit.first = first;
    expect([jumpCount(base), pounceCount(base), jumpCount(first), pounceCount(first)], `the rebase's base and its first input, ${base} and ${first} (§4.6, page-F4)`)
      .toEqual([3, 0, 3, 0]);
    this.measure.webkit.takeOffBack = back.match!.mine!.takeOffTick;
    expect(back.match!.mine!.takeOffTick, "WebKit's terrier's take-off tick across the return (page-F4)").toBe(this.measure.webkit.takeOffBefore);
    const results = await w.until((x) => x.screen === 'results', { what: 'Results', timeoutMs: TO_RESULTS_MS });
    this.mark('webkit results');
    this.atResults.webkit.resolve(results);
    await this.againGo.promise;
    expect(await focused(page), 'Play again focused on Results (Q-17)').toBe('again');
    w.againAt = await historyOf(page);
    await press(page, PAD.start, ANSWER_MS);
    this.mark('webkit again');
  }

  /** The spectator: at the keeper's trigger, the link, Join's "started" with Watch in view; then the follow
   *  choice by C, the pad's shoulders and a tap, the HUD and the camera following each, and P5's box. */
  async spectatorWatches(): Promise<void> {
    await this.spectatorGo.promise;
    const s = this.spectator;
    const { link } = await this.created.promise;
    await this.open(s, this.cr!, 3, 'Watcher', { fragment: link.slice(this.base.length), gamepad: true });
    const page = s.page;
    await s.until((i) => i.screen === 'join', { what: 'Join by the link', timeoutMs: ANSWER_MS });
    const status = page.locator('[data-test="join-status"]');
    await expect(status, "Join on a started match, offering Watch alone (§5.6, P8's layout)").toHaveText('This match has started: you can watch it.', { timeout: CONNECT_MS });
    const watch = page.locator('[data-test="watch"]');
    await expect(watch).toBeVisible();
    const w = await boxes(page, '[data-test="watch"]');
    expect(w !== null && inside(w.box, w.window), `Watch in view at 640 × 360: ${JSON.stringify(w)}`).toBe(true);
    await watch.click();
    const first = await s.until((i) => i.screen === 'match' && i.view?.mode.kind === 'spectator', { what: 'the match, watched', timeoutMs: ANSWER_MS });
    this.mark('spectator in');
    expect([first.match!.inRoster, first.controls], 'a spectator: outside the roster, with no controls').toEqual([false, null]);
    const order = [...first.match!.roster].sort((a, b) => a.pack - b.pack || a.spot - b.spot).map((r) => r.id);
    expect(order.length, 'the follow choice’s four terriers').toBe(4);
    await this.follows('ball', 'the ball, from the start (D-28)');
    await page.keyboard.press('KeyC');
    await this.follows(order[0]!, 'the next by C');
    await press(page, PAD.view, ANSWER_MS);
    await this.follows(order[1]!, "the next by the pad's right shoulder");
    await press(page, PAD.prev, ANSWER_MS);
    await this.follows(order[0]!, "back by the pad's left shoulder");
    await page.locator(`[data-test="hud-follow"] button[data-follow="${order[2]!}"]`).click();
    await this.follows(order[2]!, 'a terrier by a tap on its name');
    await page.keyboard.press('KeyC');
    await this.follows(order[3]!, 'the last by C');
    // P5: the button pressed brought into the list's view, which scrolls sideways, at 640 × 360.
    const p5 = await page.evaluate(() => {
      const list = document.querySelector('[data-test="hud-follow"] .hud-follow-list')!;
      const on = list.querySelector('button[aria-pressed="true"]')!;
      const box = (r: DOMRect): { left: number; top: number; right: number; bottom: number } => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      return { list: box(list.getBoundingClientRect()), pressed: box(on.getBoundingClientRect()), scrolled: list.scrollLeft, follow: on.getAttribute('data-follow') };
    });
    this.measure.spectator.p5 = p5;
    expect([p5.follow, inside(p5.pressed, p5.list)], `P5: the last terrier's button pressed, its box inside the list's: ${JSON.stringify(p5)}`).toEqual([order[3]!, true]);
    this.atResults.spectator.resolve(await s.until((i) => i.screen === 'results', { what: 'Results', timeoutMs: TO_RESULTS_MS }));
    this.mark('spectator results');
  }

  /** The spectator's HUD choice pressed on `want`, 'ball' or a terrier's ID, the view's mode following it, and
   *  the camera drawn following it (render.camera.follow). */
  private async follows(want: string, what: string): Promise<void> {
    const s = this.spectator;
    const i = await s.until((x) => {
      const mode = x.view?.mode;
      const camera = x.render.camera;
      return hudOf(x)?.following === want && mode?.kind === 'spectator' && (mode.follow ?? 'ball') === want && camera.kind === 'spectator' && camera.follow === want;
    }, { what: `following ${what}`, timeoutMs: ANSWER_MS });
    this.measure.spectator.follows.push(`${what}: ${hudOf(i)!.following}`);
  }

  // --- Results, on every page ---

  /** The four pages on Results: the same end, a common hash, each log against its arrival, the holds and the
   *  presses, axe; then Play again's go. */
  async allResults(): Promise<void> {
    await Promise.all(this.pages.map((p) => this.atResults[p.who].promise));
    this.mark('all results');
    // Every page at once, so their final ticks are near enough for one to be in every history.
    const now = await Promise.all(this.pages.map((p) => p.look()));
    const tick = Math.min(...now.map((i) => i.match!.finalTick));
    const hashes = await Promise.all(this.pages.map((p) => hashAt(p.page, tick)));
    const ends = now.map((i) => i.match!.end);
    const end = ends[0] ?? null;
    if (end === null) throw new Error(`no confirmed end on the keeper's Results; ${where(now[0]!)}`);
    this.measure.end = { ...end, hashTick: tick };
    for (const [k, p] of this.pages.entries()) {
      const i = now[k]!;
      const m = i.match!;
      this.measure.results[p.who] = { arrival: i.announcements!.arrivalTick, countdowns: i.announcements!.countdowns, goals: i.announcements!.goals.map((g) => g.tick), finalTick: m.finalTick };
      const ready = p.readyAt;
      const rate = ready === null ? null : ((m.localTick - ready.tick) * 1000) / (monotonicMs() - ready.ms);
      this.measure.figures[p.who] = { stats: m.stats, timer: m.timer, ticksPerSecond: rate === null ? null : Math.round(rate * 10) / 10, own: m.own };
    }
    // Logged, never judged (phase 2c): Chromium's late inputs, disagreements, resyncs, clock jumps and tick
    // rate, and every page's countdowns, against its arrival.
    const ready = Object.entries(this.measure.ready).map(([who, r]) => `${who} ${r.pressTick} (its look at ${r.pollTick})`).join(', ');
    console.log(`Ready at ${ready}; the start countdown at ${this.countdown}, as each player's first look saw it ${JSON.stringify(this.measure.countdownSeen)}; ` +
      `the end at tick ${end.tick}, ${end.score.join('–')}, ${Math.round((monotonicMs() - this.began) / 100) / 10} s into the test`);
    for (const p of this.pages) {
      const f = this.measure.figures[p.who]!;
      const r = this.measure.results[p.who]!;
      const s = f.stats;
      console.log(`  ${p.who}: arrival ${r.arrival}, countdowns ${r.countdowns.join(' ')}, goals ${r.goals.join(' ')}; late ${s.late} (absent ${s.lateAbsent}), ` +
        `disagreements ${s.disagree}, resyncs ${s.resyncs}, rollbacks ${s.rollbacks}, corrections ${s.corrections}, clock samples ${s.clockSamples} ` +
        `(dropped ${s.clockSamplesDropped}), clock jumps ${s.jumps}, ${f.ticksPerSecond ?? '-'} ticks a second since Ready, ` +
        `timer ${JSON.stringify(f.timer)}, own ${JSON.stringify(f.own)}`);
    }
    for (const [k, e] of ends.entries()) expect(e, `${this.pages[k]!.who}'s confirmed end: its tick, score, winner and rows`).toEqual(end);
    expect(hashes.every((h) => h !== ''), `every page holds final tick ${tick}: ${JSON.stringify(hashes)}`).toBe(true);
    expect(new Set(hashes).size, `one state at final tick ${tick} (P1, P2)`).toBe(1);
    expect([end.score[0] > 0, end.score[0] !== end.score[1], now[0]!.match!.clock], `pack A scored, not level at 0:00: ${JSON.stringify(end.score)}`)
      .toEqual([true, true, 0]);
    // The setup's roster, the three players and pack A's bot, the spectator outside it (L281).
    const roster = [[personId(SEED, 0), 0], [botIds(personId(SEED, 0))[0]!, 0], [personId(SEED, 1), 1], [personId(SEED, 2), 1]].map(([id, pack]) => `${id}:${pack}`);
    for (const i of now) expect(i.match!.roster.map((r) => `${r.id}:${r.pack}`).sort(), `${i.match!.me}'s final roster`).toEqual(roster.sort());
    expect([now[3]!.match!.inRoster, now[3]!.match!.me], "the spectator's page, outside the roster").toEqual([false, personId(SEED, 3)]);
    // The terriers and the ball moved (§9.4): W moved each, checked at its warm-up; the ball left the spot.
    expect(this.ballMoved, "the ball's furthest from the centre spot in play, as the keeper's looks saw it").toBeGreaterThan(BALL_MOVED_M);
    // page-F3: every page showed what it could since its arrival, by the keeper's periods and goals, the
    // keeper there from genesis.
    const goals = now[0]!.match!.goals.map((g) => g.tick);
    expect(now[0]!.announcements!.countdowns, "the keeper's countdowns, each its looks saw").toEqual(this.periods.map((p) => p.countdown));
    for (const [k, p] of this.pages.entries()) this.expectArrival(p.who, now[k]!, goals);
    // What the players played, inside the validated latitudes (§9.1).
    this.expectPlayed(now);
    // The keeper's closing Space never reached its terrier, which the ended state takes no input of (D-8).
    expect(jumpCount(now[0]!.match!.mine!.lastInput), "the keeper's terrier's jump counter at the end: its closing Space dropped").toBe(0);
    const backAtEnd = now[2]!.match!.mine!;
    this.measure.webkit.takeOffEnd = backAtEnd.takeOffTick;
    expect([backAtEnd.takeOffTick, jumpCount(backAtEnd.lastInput)], "WebKit's terrier at the end: never off the ground, its counter at 3 (page-F4)")
      .toEqual([this.measure.webkit.takeOffBefore, 3]);
    // Results as drawn, the same on every page, and axe there.
    const seen = await Promise.all(this.pages.map(async (p) => {
      await expect(p.page.locator('[data-test="final-score"]')).toHaveText(/\d+–\d+/, { timeout: ANSWER_MS });
      return resultsSeen(p.page);
    }));
    for (const [k, r] of seen.entries()) expect(r, `${this.pages[k]!.who}'s Results as drawn`).toEqual(seen[0]);
    expect([seen[0]!.heading, seen[0]!.rows.length, seen[0]!.score.includes(`${end.score[0]}–${end.score[1]}`)]).toEqual(['Results', 4, true]);
    for (const p of this.pages) await expectAxeClean(p.page);
    this.mark('results checked');
    this.againGo.resolve();
  }

  /** page-F3 for one page, as M3's spec rules it: each countdown since its arrival shown, and the one under way
   *  at it maybe; each goal latched since, and the one whose celebration it arrived during, required unless the
   *  arrival came in its last ARRIVAL_LAG_TICKS, each once and none taken back. */
  private expectArrival(who: Who, i: Inspection, goals: readonly number[]): void {
    const log = i.announcements!;
    const arrival = log.arrivalTick!;
    expect(arrival, `${who}'s arrival`).not.toBeNull();
    const since = this.periods.filter((p) => p.countdown > arrival).map((p) => p.countdown);
    const underWay = this.periods.find((p) => p.countdown <= arrival && (p.play === null || arrival < p.play));
    const ways = underWay === undefined ? [since] : [since, [underWay.countdown, ...since]];
    expect(ways, `${who}'s countdowns ${JSON.stringify(log.countdowns)}, from its arrival at ${arrival}`).toContainEqual(log.countdowns);
    const after = goals.filter((g) => g > arrival);
    const before = goals.filter((g) => g <= arrival).at(-1);
    const into = before === undefined ? Infinity : arrival - before;
    const want = into < CELEBRATION_TICKS - ARRIVAL_LAG_TICKS ? [[before!, ...after]] : into < CELEBRATION_TICKS ? [after, [before!, ...after]] : [after];
    const shown = log.goals.map((g) => g.tick);
    expect(want, `${who}'s goals ${JSON.stringify(log.goals)}, from its arrival at ${arrival}`).toContainEqual(shown);
    expect(log.goals.filter((g) => g.withdrawnAtMs !== null), `${who}'s goals taken back`).toEqual([]);
    expect(new Set(shown).size, `${who}'s goals, each once`).toBe(shown.length);
  }

  /** The holds and the Ready presses against the latitudes the replays validated (§9.1, M4-Q36): the keeper's S
   *  from each countdown, its warm-up's W ended before it; B's players' W ended, nothing after; the reloaded
   *  page holding nothing; every Ready press inside the band, and the start countdown after the latest. */
  private expectPlayed(now: readonly Inspection[]): void {
    const firstInput = this.countdown + 1 + D;
    const end = now[0]!.match!.end!.tick;
    const holds = this.chromium.lastPitch?.controls?.holds ?? [];
    this.measure.holds = [...holds];
    const played = holds.filter((h) => h.from >= firstInput);
    const before = holds.filter((h) => h.from < firstInput);
    expect(holdProblems(played, this.periods, end), `S's spans as sampled, ${JSON.stringify(played)}, against the periods ${JSON.stringify(this.periods)}, the end at ${end}`)
      .toEqual([]);
    // The warm-up's W alone before the countdown, ended by it, on each player's page that played it through.
    const warmUpOnly = (h: readonly Hold[]): (number | boolean)[][] => h.map((x) => [x.step, x.frame, x.to !== null && x.to < firstInput]);
    expect(warmUpOnly(before), `the keeper's spans before the countdown: ${JSON.stringify(before)}`).toEqual([[WARM.step, WARM.frame, true]]);
    const firefox = this.firefox.lastPitch?.controls?.holds ?? [];
    expect(warmUpOnly(firefox), `Firefox's spans: W in warm-up alone, nothing from the countdown on: ${JSON.stringify(firefox)}`).toEqual([[WARM.step, WARM.frame, true]]);
    const back = this.webkit.lastPitch?.controls ?? null;
    expect([back?.holds ?? null, back?.presses.jump ?? null], "the reloaded page's spans and presses: none").toEqual([[], 0]);
    const presses = Object.entries(this.measure.ready);
    expect(presses.map(([who]) => who).sort(), 'three Ready presses').toEqual(['chromium', 'firefox', 'webkit']);
    // The start countdown from the latest READY's tick, d + 1 after its press, or later by a slow page's
    // catch-up (phase 2c): logged, and never before.
    const latest = Math.max(...presses.map(([, r]) => r.pressTick));
    expect(this.countdown, `the start countdown at ${this.countdown}, d + 1 or more after the latest Ready press, at ${latest}`).toBeGreaterThanOrEqual(latest + D + 1);
  }
}

test('three engines play a match through the screens: proposed, joined by link and by code, watched, reloaded, to one Results and Play again', async ({ baseURL }, testInfo) => {
  test.setTimeout(TEST_MS);
  expect(SEED, "openAppPage's seed, the replays' (src/net/setups-testing.ts)").toBe(SPEC_SEED);
  const base = baseURL!;
  const relayServer = await startNostrRelay();
  const relay = `ws://127.0.0.1:${relayServer.port}`;
  const run = new ScreensMatch(base, relay);
  const browsers: Browser[] = [];
  try {
    const engines: Engine[] = ['chromium', 'firefox', 'webkit'];
    for (const e of engines) browsers.push(await launch(e));
    run.cr = browsers[0]!;
    run.mark('launched');
    // The players' pages open at Home before anything is proposed, so the setup's screens fit before tick 600
    // (a fresh Firefox page took 11 s to start under load 13.8); the spectator's opens the link at its trigger.
    await Promise.all([
      run.open(run.chromium, browsers[0]!, 0, 'Chromium'),
      run.open(run.firefox, browsers[1]!, 1, 'Firefox'),
      run.open(run.webkit, browsers[2]!, 2, 'WebKit', { gamepad: true }),
    ]);
    await Promise.all([
      run.chromiumSetup().then(() => run.chromiumPlays()),
      run.firefoxSetup().then(() => run.firefoxPlays()),
      run.webkitSetup().then(() => run.webkitPlays()),
      run.spectatorWatches(),
      run.allResults(),
    ]);
    // Play again by Enter on Chromium and by the pad's Start on WebKit, both to the next match's Pre-match, at
    // the ID every press derives (D-12, C-42), its fragment set by replace, so the history is as it was on
    // Results (§5.2, net-F1).
    const { id } = await run.created.promise;
    const next = await nextMatchId(id);
    run.measure.next = next;
    for (const p of [run.chromium, run.webkit]) {
      await p.until((i) => i.screen === 'prematch' && i.match?.matchId === next, { what: "the next match's Pre-match", timeoutMs: CONNECT_MS });
      const was = p.againAt!;
      expect(was.hash, `${p.who}'s fragment on Results, the match's`).toBe(`#join=${id}`);
      expect(await historyOf(p.page), `${p.who}'s fragment, the next match's, and its history as it was on Results`).toEqual({ length: was.length, hash: `#join=${next}` });
    }
    run.mark('next prematch');
    for (const p of run.pages) expectEverywhere(p.app!.watch);
    run.measure.ok = true;
  } catch (e) {
    run.measure.error = e instanceof Error ? e.message.split('\n')[0]! : String(e);
    throw e;
  } finally {
    const line = JSON.stringify(run.measure);
    console.log(`screens-match-measure ${line}`);
    await testInfo.attach('screens-match-measure', { body: line, contentType: 'application/json' });
    for (const b of browsers) await b.close();
    await relayServer.close();
  }
});
