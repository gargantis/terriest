// Practice played through the real page (M4's design, research/m4/
// DESIGN.md, §9.1, §9.5, §9.6, §9.7, M4-Q36; PLAN §16's Practice), for
// e2e/practice.spec.ts and e2e/dev-practice.run.ts: seed 7's setup as its
// Node replays play it (src/net/practice-spec-testing.ts, in
// practice-spec-whole-1 to -6 and practice-spec-goal-1 to -4):
// - the profile seeded with personId(7, 0) and stored low quality, and
//   Practice at 1 a side for 1 minute, opened from Home by keys;
// - Ready by Enter at the first look at or past a fixed local tick, its
//   tick read back from the start countdown's first tick, d + 1 later;
// - A, the validated sideways step in ball view, pressed at the first look
//   that shows a countdown, the start's or a kickoff's, and let go at the
//   first that shows a second of play, both by the drawn head, whose ticks
//   e counts; held through a goal that comes sooner, as the replays hold it;
// - every look at the hook 50 ms apart, never on animation frames (C-6),
//   failing at once on an overtime, a stall, or anything compiled after
//   prepare() (PLAN §12);
// - the holds the controls sampled, the presses and the Ready tick checked
//   against the latitudes the replays validated, read from that file, which
//   no spec may import (it imports vitest), so a latitude widened there is
//   the specs' at once and no copy drifts;
// - Ready's focus recorded at each change, by an observer that only
//   watches, so a state too short for a look is still checked (§9.6);
// - nothing contacted (P10, L238);
// - one JSON line a run, `practice-measure {…}`, also attached to the test,
//   logged whether the run passed or not, with what phase 1c's Measure step
//   reads: the start and prepare(), the Ready tick against its anchor, each
//   hold against its countdown and play, the timer's figures, the
//   key-to-screen latency, and whether anything compiled.
// Its timeouts are provisional until that step sets them from measured runs.

import { readFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import { config, derived } from '../../src/config';
import { botIds, personId } from '../../src/core/bot/bot-id';
import { SIDEWAYS_IN_BALL_VIEW } from '../../src/core/bot/setups';
import { frameOf, stepOf } from '../../src/core/sim/input';
import { CELEBRATION, IN_PLAY, KICKOFF_COUNTDOWN, START_COUNTDOWN } from '../../src/core/sim/state';
import type { Inspection } from '../../src/main';
import type { ResourceCounts } from '../../src/render/stage-types';
import { countPeerConnections } from './browsers';
import { expect, type PageWatch } from './guards';
import { expectStarted, inspect, installHook, openPractice, POLL_MS, seedStorage } from './page';

// --- What the replays validated (src/net/practice-spec-testing.ts) ---

const VALIDATED = readFileSync(new URL('../../src/net/practice-spec-testing.ts', import.meta.url), 'utf8');

/** A number, or an array of them, as that file exports it: `export const NAME = 60;` or `= [600, 1200] as const;`. */
function validated(name: string): number[] {
  const m = new RegExp(`^export const ${name} = (\\[[\\d, ]+\\]|\\d+)(?: as const)?;`, 'm').exec(VALIDATED);
  if (m === null) throw new Error(`src/net/practice-spec-testing.ts exports no ${name} in the form e2e/lib/practice.ts reads`);
  return JSON.parse(m[1]!.startsWith('[') ? m[1]! : `[${m[1]!}]`) as number[];
}

/** The specs' seed: the profile holds personId(SEED, 0). */
export const SEED = validated('SEED')[0]!;
/** The whole match's Ready tick, and the runs through the controls' anchors (§9.1). */
export const WHOLE_ANCHOR = validated('WHOLE_ANCHOR')[0]!;
export const GOAL_ANCHORS: readonly number[] = validated('GOAL_ANCHORS');
/** Ready validated at every local tick from its anchor to this many later. */
export const READY_LATITUDE = validated('READY_LATITUDE')[0]!;
/** e: the release validated up to this many ticks after a second of play. */
export const RELEASE_LATITUDE = validated('RELEASE_LATITUDE')[0]!;
/** A hold validated as late as this many ticks before its countdown's end. */
export const LATEST_START_TICKS = validated('LATEST_START_TICKS')[0]!;

/** PLAN §16's Practice: 1 a side, 1 minute. */
export const PACK_SIZE = 1; // not a setting: the setup's
export const MINUTES = 1; // not a setting: the setup's
/** The person, and its one bot, in pack B, whose pack must lead (PLAN §16). */
export const ME = personId(SEED, 0);
export const BOT = botIds(ME)[0]!;
/** The controls run's Ready: the first anchor at least this many ticks after its warm-up's last input (§9.1). */
export const AFTER_WARM_UP_TICKS = 120; // not a setting: M4's design §9.1's gap

/** The held key, A: SIDEWAYS in ball view (src/core/bot/setups.ts), step 8, frame 1. */
export const HOLD_KEY = 'KeyA';
export const HOLD = { step: stepOf(SIDEWAYS_IN_BALL_VIEW), frame: frameOf(SIDEWAYS_IN_BALL_VIEW) } as const;
const D = config.inputDelayTicks;
/** A hold goes once a second of play shows (setups.ts' specSampler). */
const SECOND = config.ticksPerSecond;
/** §9.5's menu: the clock checked still over this many ticks' worth of time. */
const STILL_TICKS = 30; // not a setting: M4's design §9.5's check

// --- Timeouts: provisional until phase 1c's Measure step sets them from measured runs ---

/** From data-boot=started to Home with prepare() done behind it: the slice saw prepared 257–806 ms after
 *  navigation; 10 s is also the whole match's anchor, past which Ready couldn't be on time. */
export const PREPARED_MS = 10_000;
/** Pre-match drawing, the person in the final roster, Ready able to act: about 15 ticks (0.25 s). */
export const READY_ACTS_MS = 10_000;
/** To an anchor from Practice's start: 2,400 ticks, 40 s, at the latest, and a margin. */
export const TO_ANCHOR_MS = 60_000;
/** Ready to the start countdown on the head: d + 1 ticks, tens of ms. */
export const COUNTDOWN_MS = 10_000;
/** Ready to the first confirmed goal: the replays' slowest latched 38.2 s after Ready (Ready 650), every
 *  other band's under 13 s; twice that, and a margin. */
export const FIRST_GOAL_MS = 90_000;
/** Ready to Results: the replays' latest end latched 142.7 s after Ready, the menu's 0.7 s among it; about
 *  twice that. */
export const RESULTS_MS = 300_000;
/** A key's effect on a screen, the menu's opening or the HUD showing a goal: a frame or two. */
export const SHOWN_MS = 5_000;

// --- One run ---

type Hold = NonNullable<Inspection['controls']>['holds'][number];
type Presses = NonNullable<Inspection['controls']>['presses'];
export type RunKind = 'whole' | 'controls' | 'dev';

/** A countdown the spec played, and the play after it, as the looks showed the drawn head. */
export interface Period {
  readonly kind: 'start' | 'kickoff';
  /** The countdown's first tick. */
  readonly countdown: number;
  readonly countdownTicks: number;
  /** Play's first tick, once a look showed it. */
  play: number | null;
  /** The head's tick at the look that pressed A for this countdown; null: held still from before. */
  pressedAt: number | null;
  /** The head's tick at the look that let A go in this play; null: the play ended first, or hasn't. */
  releasedAt: number | null;
}

/** One of Ready's states, recorded at its change: what it read, whether it could act, whether its panel
 *  showed, and whether it had the focus. */
export interface ReadyState {
  readonly text: string;
  readonly canAct: boolean;
  readonly shown: boolean;
  readonly focused: boolean;
}

/** What one run logs for the Measure step: `practice-measure ` and this, as JSON, on one line. */
export interface Measure {
  readonly spec: string;
  readonly run: RunKind;
  readonly engine: string;
  ok: boolean;
  error: string | null;
  /** ms since the run began, at each step reached. */
  readonly wallMs: Record<string, number>;
  startMs: Inspection['startMs'] | null;
  prepareMs: number | null;
  /** pollTick: the local tick at the look that pressed Ready; tick: Ready's tick, the start countdown's first
   *  tick less d + 1; late: tick − anchor, validated up to latitude. */
  ready: { anchor: number; pollTick: number; tick: number | null; countdown: number | null; late: number | null; latitude: number } | null;
  /** Each period: its countdown and play, A's span as sampled, startAt (the ticks into the countdown its
   *  first input is for, less d + 1, validated up to latestStartAt) and e (its last input's ticks past a
   *  second of play and d, validated from 0 to RELEASE_LATITUDE). */
  holds: {
    kind: Period['kind']; countdown: number; countdownTicks: number; play: number | null; pressedAt: number | null; releasedAt: number | null;
    from: number | null; to: number | null; startAt: number | null; latestStartAt: number; e: number | null;
  }[];
  timer: NonNullable<Inspection['match']>['timer'] | null;
  latencyMs: NonNullable<Inspection['controls']>['latencyMs'] | null;
  /** The first look at counts unlike prepare()'s, or null: nothing compiled after prepare(), in play or before. */
  compiled: { at: string; counts: ResourceCounts; firstFrame: ResourceCounts } | null;
  counts: ResourceCounts | null;
  frames: { actions: number; skipping: boolean; logged: Record<string, number> } | null;
  goals: number[];
  score: readonly [number, number] | null;
  /** The confirmed end's first tick, for a run played to it. */
  end: number | null;
  /** The menu's checks: the goal whose latch opened it, the head's phase then, and the local tick and the
   *  drawing clock at the menu's first look, at the first after a frame drawn under it, where the still
   *  check starts, and 30 ticks' worth of time later. */
  menus: { goal: number; phase: number; tick: [number, number, number] | null; drawMs: [number, number, number] | null }[];
  /** The controls run's warm-up: its last input's tick at the latest, its last held tick, the anchor chosen
   *  from them, and its presses. */
  warmUp: { lastInputTick: number; lastHoldTo: number | null; anchor: number; presses: Presses } | null;
  polls: number;
}

const countsOf = (r: Inspection['render']): ResourceCounts => ({ programs: r.programs, geometries: r.geometries, textures: r.textures });
const sameCounts = (a: ResourceCounts, b: ResourceCounts): boolean => a.programs === b.programs && a.geometries === b.geometries && a.textures === b.textures;

/** Where the page is, for a failure's message: the screen, the ticks, the phase, the score, the clock, the timer. */
export function where(i: Inspection): string {
  const m = i.match;
  if (m === null) return `screen ${i.screen}, no match`;
  return `screen ${i.screen}, menu ${i.menu}, local tick ${m.localTick}, head ${m.headTick} in phase ${m.phase} from ${m.phaseStart}, ` +
    `final ${m.finalTick}, score ${m.score.join('–')}, clock ${m.clock}${m.overtime ? ' in overtime' : ''}, timer ${JSON.stringify(m.timer)}`;
}

/**
 * A's spans as the controls sampled them from the start countdown on, against the periods the spec played,
 * by the replays' rules (src/net/practice-spec-testing.ts' expectHoldsAsPlayed, over their latitudes): each
 * period's span begins with an input from d + 1 ticks into its countdown to LATEST_START_TICKS before its
 * end, unless one is held still; it ends, where the spec let go in that play, with an input from a second
 * of play and d ticks to RELEASE_LATITUDE later; step and frame A's in ball view; nothing else held. What
 * breaks them. `end`, the confirmed end's first tick, for a run played to it: the ended state takes no
 * input (D-8's M2 note), so a last span sampled to the end, or whose let-go no look saw before Results
 * took the pitch away, as a last play of 61 ticks leaves it, counts as held to the end, which a validated
 * release covers only if the end came by the latest one.
 */
export function holdProblems(holds: readonly Hold[], periods: readonly Period[], end: number | null = null): string[] {
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
      if (h.step !== HOLD.step || h.frame !== HOLD.frame) out.push(`hold ${k - 1} at step ${h.step}, frame ${h.frame}: A in ball view is ${HOLD.step}, ${HOLD.frame}`);
      const first = p.countdown + 1 + D;
      const latest = p.countdown + p.countdownTicks - LATEST_START_TICKS + 1 + D;
      if (h.from < first || h.from > latest) out.push(`hold ${k - 1} from tick ${h.from}: countdown ${n} validates ${first} to ${latest}`);
      open = h;
    }
    if (p.releasedAt === null) continue;
    const lo = p.play! + SECOND + D;
    const hi = lo + RELEASE_LATITUDE;
    if (n === periods.length - 1 && end !== null && (open.to === null || open.to >= end)) {
      if (end > hi) out.push(`hold ${k - 1} held to the end at tick ${end}: play ${n}, from ${p.play}, validates a let-go by ${hi}`);
    } else if (open.to === null || open.to < lo || open.to > hi) {
      out.push(`hold ${k - 1} to tick ${open.to}: play ${n}, from ${p.play}, validates ${lo} to ${hi}`);
    }
    open = null;
  }
  for (; k < holds.length; k++) out.push(`a hold the spec didn't play: ${JSON.stringify(holds[k])}`);
  return out;
}

/** Ready's states as the page showed them, recorded by an init script at each change (§9.6). */
async function recordReady(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __terriestReady: { states: unknown[]; last: string } };
    w.__terriestReady = { states: [], last: '' };
    const look = (): void => {
      const b = document.querySelector('[data-test="ready"]');
      if (b === null) return;
      const s = { text: b.textContent ?? '', canAct: b.getAttribute('aria-disabled') !== 'true', shown: b.closest('[hidden]') === null, focused: document.activeElement === b };
      const key = JSON.stringify(s);
      if (key === w.__terriestReady.last) return;
      w.__terriestReady.last = key;
      w.__terriestReady.states.push(s);
    };
    new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-disabled', 'hidden'] });
    document.addEventListener('focusin', look);
    document.addEventListener('focusout', () => setTimeout(look, 0));
  });
}

export function readyStates(page: Page): Promise<ReadyState[]> {
  return page.evaluate(() => (window as unknown as { __terriestReady: { states: ReadyState[] } }).__terriestReady.states);
}

/** Ready's recorder cleared, so the next Pre-match's states are its own: before Play again. */
export function clearReadyStates(page: Page): Promise<void> {
  return page.evaluate(() => {
    (window as unknown as { __terriestReady: { states: unknown[]; last: string } }).__terriestReady = { states: [], last: '' };
  });
}

/** What has the focus: its data-test, or its tag. */
export function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement;
    return a === null ? 'nothing' : (a.getAttribute('data-test') ?? a.tagName.toLowerCase());
  });
}

/** The page hidden, or shown again, as a background tab's would be (§9.5): document.visibilityState and
 *  document.hidden read so, then a visibilitychange. Playwright has no page visibility of its own to set. */
export async function emulateHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    const doc = document as unknown as Record<string, unknown>;
    if (h) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    } else {
      delete doc['visibilityState'];
      delete doc['hidden'];
    }
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** Nothing contacted (P10, L238): no RTCPeerConnection made, which the request guard can't see; no
 *  WebSocket but `sockets` (a dev server's own); no request outside `origin`; Trystero's code never
 *  requested, as a chunk or as a dev server's module. */
export async function expectNothingContacted(page: Page, guard: PageWatch, o: { origin: string; sockets?: readonly string[] }): Promise<void> {
  const rtc = await page.evaluate(() => (window as unknown as { __rtcCount?: number }).__rtcCount ?? null);
  expect(rtc, 'RTCPeerConnections made (P10)').toBe(0);
  const sockets = o.sockets ?? [];
  const devs = (u: string): boolean => sockets.some((s) => u.startsWith(s));
  expect(guard.requests.filter((u) => /^wss?:/.test(u) && !devs(u)), 'WebSockets (P10)').toEqual([]);
  expect(guard.requests.filter((u) => !u.startsWith(o.origin) && !u.startsWith('data:') && !u.startsWith('blob:') && !devs(u)), `requests outside ${o.origin}`)
    .toEqual([]);
  expect(guard.requests.filter((u) => /trystero/i.test(u)), "Trystero's code (L238)").toEqual([]);
}

/** The first confirmed goal is the bot's own, for its pack, B, into A's open goal (PLAN §16), and the HUD
 *  showed every goal latched (§1.40). */
export function expectBotFirst(i: Inspection): void {
  const m = i.match!;
  const g = m.goals[0];
  expect([g?.pack, g?.ownGoal, g?.scorers], `the first confirmed goal; ${where(i)}`).toEqual([1, false, [BOT]]);
  expect(i.announcements?.goals.map((x) => [x.tick, x.withdrawnAtMs]), 'the goals the HUD showed (§1.40)').toEqual(m.goals.map((x) => [x.tick, null]));
}

/** The last input tick of a warm-up whose keys are all up and whose presses have all acted by this look:
 *  every later sample reads them up, and the samples so far were for d ticks past the local tick at most
 *  (src/ui/match.ts' sampler). */
export const lastInputBy = (i: Inspection): number => i.match!.localTick + D;

/** The first anchor at least AFTER_WARM_UP_TICKS after `lastInput` (§9.1), or null: none left. */
export const anchorAfter = (lastInput: number): number | null => GOAL_ANCHORS.find((a) => a >= lastInput + AFTER_WARM_UP_TICKS) ?? null;

/**
 * One Practice through the real page: its looks at the hook, the hold it plays from each countdown, its
 * checks at every look, and its line for the Measure step.
 */
export class PracticeRun {
  readonly page: Page;
  readonly periods: Period[] = [];
  readonly measure: Measure;
  /** The last look, and the last on Pre-match or Match, where the controls' figures are. */
  last: Inspection | null = null;
  lastPitch: Inspection | null = null;
  private readonly testInfo: TestInfo;
  private readonly began = Date.now();
  private holding = false;
  private down = false;
  /** The looks the line's figures come from, kept when the hold stops: the match played, not the next. */
  private played: { last: Inspection | null; pitch: Inspection | null } | null = null;

  constructor(page: Page, testInfo: TestInfo, run: RunKind) {
    this.page = page;
    this.testInfo = testInfo;
    this.measure = {
      spec: testInfo.file.split(/[\\/]/).at(-1) ?? '', run, engine: page.context().browser()?.browserType().name() ?? 'unknown', ok: false, error: null,
      wallMs: {}, startMs: null, prepareMs: null, ready: null, holds: [], timer: null, latencyMs: null, compiled: null, counts: null,
      frames: null, goals: [], score: null, end: null, menus: [], warmUp: null, polls: 0,
    };
  }

  /** ms since the run began, noted under `step`. */
  mark(step: string): void {
    this.measure.wallMs[step] = Date.now() - this.began;
  }

  /** The body, then the run's line, logged whether it passed or not. */
  async measured(body: () => Promise<void>): Promise<void> {
    try {
      await body();
      this.measure.ok = true;
    } catch (e) {
      this.measure.error = e instanceof Error ? e.message.split('\n')[0]! : String(e);
      throw e;
    } finally {
      this.figures();
      const line = JSON.stringify(this.measure);
      console.log(`practice-measure ${line}`);
      await this.testInfo.attach('practice-measure', { body: line, contentType: 'application/json' });
    }
  }

  /** One look at the hook: what fails at once (an overtime, a stall, a compile after prepare), then the
   *  hold's next move. */
  async poll(): Promise<Inspection> {
    const i = await inspect(this.page);
    this.measure.polls++;
    this.last = i;
    if (i.screen === 'prematch' || i.screen === 'match') this.lastPitch = i;
    const m = i.match;
    if (m?.overtime === true) throw new Error(`an overtime: every validated match ends at 0:00 (M4's design §9.1); ${where(i)}`);
    if (m !== null && m.timer.gapsOverStall > 0) throw new Error(`a timer gap over the stall's 2 s (§9.5); ${where(i)}`);
    const r = i.render;
    if (r.prepared && r.firstFrame !== null && !sameCounts(countsOf(r), r.firstFrame)) {
      this.measure.compiled = { at: where(i), counts: countsOf(r), firstFrame: r.firstFrame };
      throw new Error(`compiled after prepare(): ${JSON.stringify(countsOf(r))} against its ${JSON.stringify(r.firstFrame)} (PLAN §12); ${where(i)}`);
    }
    if (this.holding && m !== null) await this.hold(m);
    return i;
  }

  /** Looks every 50 ms until `cond` holds of one, playing the hold and then `each` at every look, and failing
   *  on a timeout with where the page is. */
  async until(cond: (i: Inspection) => boolean, o: { what: string; timeoutMs: number; each?: (i: Inspection) => Promise<void> }): Promise<Inspection> {
    const deadline = Date.now() + o.timeoutMs;
    for (;;) {
      const i = await this.poll();
      if (cond(i)) return i;
      await o.each?.(i);
      if (Date.now() > deadline) throw new Error(`${o.what}: not reached within ${o.timeoutMs} ms; ${where(i)}`);
      await this.page.waitForTimeout(POLL_MS);
    }
  }

  /** Storage as a player's would hold it, the hook, the recorders, then the page, to Home with its heading
   *  focused and the pitch prepared behind it, and no RTCPeerConnection made (P10). */
  async load(url: string): Promise<Inspection> {
    const page = this.page;
    await seedStorage(page, { profile: { playerId: ME }, settings: { quality: 'low' } });
    await installHook(page);
    await countPeerConnections(page);
    await recordReady(page);
    await page.goto(url);
    await expectStarted(page);
    this.mark('started');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 }), "Home's heading focused (Q-17)").toBeFocused();
    const home = await this.until((i) => i.screen === 'home' && i.startMs.prepared !== null, { what: 'Home, the pitch prepared behind it', timeoutMs: PREPARED_MS });
    this.mark('prepared');
    this.measure.startMs = home.startMs;
    this.measure.prepareMs = home.render.prepareMs;
    expect(home.render.quality, "the stored quality, the gate's (D-33)").toBe('low');
    expect(await page.evaluate(() => (window as unknown as { __rtcCount?: number }).__rtcCount), 'RTCPeerConnections on Home (P10)').toBe(0);
    return home;
  }

  /** Home's Practice and its setup by keys, to Pre-match: drawing, the person in A and its bot in B, Ready
   *  able to act and focused from the screen's entry (Q-15, Q-17). */
  async practice(): Promise<Inspection> {
    await openPractice(this.page, { packSize: PACK_SIZE, minutes: MINUTES });
    this.mark('prematch');
    const i = await this.readyActs();
    expect(i.match?.kind).toBe('practice');
    expect(i.match?.roster.map((r) => [r.id, r.pack]), 'the person in A and its bot in B (Q-15)').toEqual([[ME, 0], [BOT, 1]]);
    return i;
  }

  /** A Pre-match just shown, drawing, with the person in the final roster and Ready able to act: Ready
   *  focused at every state it showed, "Joining…" among them (§9.6). */
  async readyActs(): Promise<Inspection> {
    const page = this.page;
    const i = await this.until((x) => x.screen === 'prematch' && x.render.frames > 0 && x.match?.inRoster === true, {
      what: 'Pre-match drawing, the person in the final roster', timeoutMs: READY_ACTS_MS,
    });
    const ready = page.locator('[data-test="ready"]');
    await expect(ready, 'Ready able to act').not.toHaveAttribute('aria-disabled', 'true', { timeout: READY_ACTS_MS });
    await expect(ready).toHaveText('Ready');
    const states = await readyStates(page);
    expect(states.filter((s) => s.shown && !s.focused), `Ready's states without the focus, of ${JSON.stringify(states)} (Q-17, §9.6)`).toEqual([]);
    expect(states.some((s) => s.shown && s.text === 'Joining…' && !s.canAct), `Ready read "Joining…" from the entry: ${JSON.stringify(states)}`).toBe(true);
    expect(states.at(-1), "Ready's latest state").toEqual({ text: 'Ready', canAct: true, shown: true, focused: true });
    return i;
  }

  /** Ready by Enter at the first look at or past `anchor`, its focus checked first; then the start
   *  countdown, whose first look presses A: from here the hold is played at every look. */
  async ready(anchor: number): Promise<Inspection> {
    const page = this.page;
    this.measure.ready = { anchor, pollTick: -1, tick: null, countdown: null, late: null, latitude: READY_LATITUDE };
    const at = await this.until((i) => (i.match?.localTick ?? 0) >= anchor, { what: `local tick ${anchor}, Ready's anchor`, timeoutMs: TO_ANCHOR_MS });
    expect(await focused(page), 'Ready focused at its press (Q-17)').toBe('ready');
    await page.keyboard.press('Enter');
    this.mark('ready');
    this.holding = true;
    this.measure.ready.pollTick = at.match!.localTick;
    const c = await this.until((i) => i.match?.phase === START_COUNTDOWN, { what: 'the start countdown after Ready', timeoutMs: COUNTDOWN_MS });
    this.mark('countdown');
    const countdown = c.match!.phaseStart;
    const tick = countdown - 1 - D;
    this.measure.ready = { ...this.measure.ready, tick, countdown, late: tick - anchor };
    return c;
  }

  /** The hold's move at one look (§9.1): A down at a countdown's first look, up at the first look that shows
   *  a second of play. */
  private async hold(m: NonNullable<Inspection['match']>): Promise<void> {
    const start = m.phase === START_COUNTDOWN;
    const last = this.periods.at(-1);
    if (start || m.phase === KICKOFF_COUNTDOWN) {
      if (last !== undefined && last.countdown === m.phaseStart) return;
      const p: Period = {
        kind: start ? 'start' : 'kickoff', countdown: m.phaseStart, countdownTicks: start ? derived.startCountdownTicks : derived.kickoffCountdownTicks,
        play: null, pressedAt: null, releasedAt: null,
      };
      this.periods.push(p);
      if (!this.down) {
        await this.page.keyboard.down(HOLD_KEY);
        this.down = true;
        p.pressedAt = m.headTick;
      }
      return;
    }
    if (m.phase !== IN_PLAY || last === undefined) return;
    if (last.play === null) last.play = m.phaseStart;
    if (last.play !== m.phaseStart) throw new Error(`play from tick ${m.phaseStart} with no countdown seen before it: the last began at ${last.countdown}`);
    if (this.down && m.headTick - m.phaseStart >= SECOND) {
      await this.page.keyboard.up(HOLD_KEY);
      this.down = false;
      last.releasedAt = m.headTick;
    }
  }

  /** A held now, by the spec's hand. */
  get held(): boolean {
    return this.down;
  }

  /** The hold no longer played, A let go if it's down, and the looks so far kept for the line: the match
   *  played, whatever the run does next. */
  async stopHolding(): Promise<void> {
    this.holding = false;
    this.played = { last: this.last, pitch: this.lastPitch };
    if (this.down) {
      await this.page.keyboard.up(HOLD_KEY);
      this.down = false;
    }
  }

  /**
   * The menu at a goal's latch, in its celebration (§9.5), with nothing held, since the menu lets go of what
   * is (§4.8) and the validated match holds nothing then: Escape opens it, paused, Resume focused (Q-17);
   * then either the clock checked still over 30 ticks' worth of time and Enter on Resume, or Escape again;
   * either way the clock runs on after. The still check starts once a frame has been drawn under the menu:
   * the drawing clock notices a pause at its next frame or timer run (src/render/view.ts' observe), so a
   * look before then reads it from before the pause.
   */
  async menuAt(goal: number, close: 'resume' | 'escape'): Promise<void> {
    const page = this.page;
    const at = this.last!;
    expect(this.down, `A held at goal ${goal}'s latch, which the menu would let go: the validated match holds nothing then (M4's design §4.8)`).toBe(false);
    expect(at.match?.phase, `goal ${goal}'s latch in its celebration; ${where(at)}`).toBe(CELEBRATION);
    await page.keyboard.press('Escape');
    const open = await this.until((i) => i.menu === 'menu' && i.match?.paused === true, { what: `the menu by Escape at goal ${goal}`, timeoutMs: SHOWN_MS });
    expect(await focused(page), "Resume first in Practice's menu (Q-17)").toBe('resume');
    const seen: Measure['menus'][number] = { goal, phase: at.match!.phase, tick: null, drawMs: null };
    this.measure.menus.push(seen);
    if (close === 'resume') {
      const base = await this.until((i) => i.render.frames > open.render.frames, { what: `a frame drawn under the menu at goal ${goal}`, timeoutMs: SHOWN_MS });
      await page.waitForTimeout((STILL_TICKS * 1000) / config.ticksPerSecond);
      const still = await this.poll();
      seen.tick = [open.match!.localTick, base.match!.localTick, still.match!.localTick];
      seen.drawMs = [open.view!.drawMs, base.view!.drawMs, still.view!.drawMs];
      expect({ tick: [seen.tick[0], seen.tick[2]], drawMs: seen.drawMs[2] }, `the local tick and the drawing clock over ${STILL_TICKS} ticks' worth of the menu (Q-15)`)
        .toEqual({ tick: [seen.tick[1], seen.tick[1]], drawMs: seen.drawMs[1] });
      expect(still.menu).toBe('menu');
      await page.keyboard.press('Enter');
    } else {
      await page.keyboard.press('Escape');
    }
    const closed = await this.until((i) => i.menu === 'closed' && i.match?.paused === false, { what: `the menu closed at goal ${goal}`, timeoutMs: SHOWN_MS });
    await this.until((i) => (i.match?.localTick ?? 0) > closed.match!.localTick, { what: `the clock running on after the menu at goal ${goal}`, timeoutMs: SHOWN_MS });
  }

  /**
   * What the person played, against the latitudes the replays validated (§9.1), from the controls' figures at
   * `i`: Ready's tick; A's spans from the start countdown on (holdProblems, with `end`, the confirmed end's
   * tick, for a run played to it); every span before it ended by the warm-up's last input, or none without
   * a warm-up; and the presses those the warm-up left, or none.
   */
  expectPlayed(i: Inspection, warmUp: { readonly end: number; readonly presses: Presses } | null, end: number | null = null): void {
    const r = this.measure.ready;
    const c = i.controls;
    expect(r?.tick ?? null, 'Ready pressed, its countdown seen').not.toBeNull();
    expect(c, 'the controls, on the pitch screen').not.toBeNull();
    const ready = `Ready at local tick ${r!.tick}, from the start countdown at ${r!.countdown}: validated from ${r!.anchor} to ${r!.anchor + READY_LATITUDE}`;
    expect(r!.late!, ready).toBeGreaterThanOrEqual(0);
    expect(r!.late!, ready).toBeLessThanOrEqual(READY_LATITUDE);
    const first = this.firstPlayedInput;
    const before = c!.holds.filter((h) => h.from < first);
    const played = c!.holds.filter((h) => h.from >= first);
    expect(holdProblems(played, this.periods, end), `A's spans as sampled, ${JSON.stringify(played)}, against the periods ${JSON.stringify(this.periods)}${end === null ? '' : `, the end at ${end}`}`)
      .toEqual([]);
    if (warmUp === null) {
      expect(before, 'a direction held before the start countdown, where the whole match holds none').toEqual([]);
      expect(c!.presses, 'presses: the whole match presses nothing but Ready').toEqual({ jump: 0, pounce: 0, bark: 0, view: 0 });
    } else {
      expect(before.filter((h) => h.to === null || h.to > warmUp.end), `the warm-up's spans, all ended by its last input at ${warmUp.end}`).toEqual([]);
      expect(c!.presses, 'presses since the warm-up: none').toEqual(warmUp.presses);
    }
  }

  /** The start countdown's first input tick: the controls' spans from here on are the hold's. */
  get firstPlayedInput(): number {
    return (this.measure.ready?.countdown ?? Infinity) + 1 + D;
  }

  /** The figures the line carries, from the looks at the match played. */
  private figures(): void {
    const last = this.played?.last ?? this.last;
    const pitch = this.played?.pitch ?? this.lastPitch;
    const m = last?.match ?? null;
    const c = pitch?.controls ?? null;
    const holds = c?.holds.filter((h) => h.from >= this.firstPlayedInput) ?? [];
    let k = 0;
    let open: Hold | null = null;
    this.measure.holds = this.periods.map((p) => {
      if (open === null) open = holds[k++] ?? null;
      const span: Hold | null = open;
      if (p.releasedAt !== null) open = null;
      const from = p.pressedAt !== null ? (span?.from ?? null) : null;
      const to = p.releasedAt !== null ? (span?.to ?? null) : null;
      return {
        kind: p.kind, countdown: p.countdown, countdownTicks: p.countdownTicks, play: p.play, pressedAt: p.pressedAt, releasedAt: p.releasedAt,
        from, to, startAt: from === null ? null : from - (p.countdown + 1 + D), latestStartAt: p.countdownTicks - LATEST_START_TICKS,
        e: to === null || p.play === null ? null : to - (p.play + SECOND + D),
      };
    });
    this.measure.timer = m?.timer ?? null;
    this.measure.latencyMs = c?.latencyMs ?? null;
    this.measure.counts = last === null ? null : countsOf(last.render);
    const f = last?.frames;
    if (f !== undefined) {
      const logged: Record<string, number> = {};
      for (const e of f.log) logged[e.why] = (logged[e.why] ?? 0) + 1;
      this.measure.frames = { actions: f.actions, skipping: f.skipping, logged };
    }
    this.measure.goals = m?.goals.map((g) => g.tick) ?? [];
    this.measure.score = m?.score ?? null;
    this.measure.end = m?.end?.tick ?? null;
  }
}
