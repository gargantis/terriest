// The #test=frames page, the frame-time bench (M4's design,
// research/m4/DESIGN.md, §1.53, §2.11, §8.1–§8.4; PLAN §16's frame-time
// run, L286; M3-Q14, M4-Q16, M4-Q17, M4-Q18): the real pitch screen, stage
// and NetGame, through the networked Match adapter (src/ui/match.ts's
// openNetMatch) with the bench's room as its transport
// (src/bench/virtual-room.ts): this page's terrier and seven virtual
// players', all eight driven by the bot brain, at 4 a side and the default
// 3 minutes. A chunk of its own, which src/main.ts loads for #test=frames
// alone, as the determinism and net pages; like them:
// - its own landmark, <main id="frames">, never #app, and boot.started()
//   once it shows; no WebGL 2, boot.js's message;
// - its parameters in its own fragment (M4-Q4), read here and nowhere on a
//   normal page: seconds, quality, frameMs, capacity, repair=1 with holdAt
//   and hold, and model=<path>, a same-origin relative path only; a page
//   that refuses its parameters says so and contacts nothing;
// - its report, a FrameReport, published only for a spec that set
//   window.terriestTest before load, as its bench (report()), once its
//   match is open; and its verdict shown on the page for a person;
// - nothing contacted: the room is the transport, so NetGame.open never
//   loads Trystero's chunk, and the relays it's handed go unused; the
//   witness's Worker, with repair=1 only, is same-origin.
// What it does: the stage made at the fragment's quality and prepared,
// the model swapped in first when one is named, judged only once the swap
// is done (R-8); then the match proposed, this page in pack A pressing
// Ready once in the roster, the virtual players joining and readying; the
// frame loop with its governor (src/ui/frame-loop.ts) drawing the pitch
// screen, each frame held by a busy wait to frameMs when one is given
// (§8.1), from the window's opening, so the joins it doesn't measure aren't
// starved, the room then delivering every message due a task (phase 2b's
// review, bench-F1). It measures from the moment all eight are in the final roster,
// through warm-up, the start countdown and play, to Results, or for
// `seconds`: the interval between animation frames, the frame's own work
// and its draw submission, the timer runs' cost and gaps (timed by the
// clock handed to NetGame), what this page skipped of what it sends for
// (own(), §1.37), the clock's samples taken and dropped and the kept ones'
// age (§8.4's run 4), the forced repair's calls and the STATE's adoption
// alone, the room's own time, the drawer's counts and the model's state,
// the programs, geometries and textures at the window's start and end, the
// governor's actions, the sample-to-screen latency (R-6), and the times to
// its first screen and to prepared (§2.1). The machine's load before and
// after is e2e/frames.run.ts's. L286's verdict, p95 ≤ 18 ms and max ≤
// 50 ms, is given only for a whole match with no witness and no busy wait,
// a goal, its celebration and a kickoff inside it, the model drawn if one
// was named, and the governor never acting from the loop's start, the
// window's opening included (M4-Q17, bench-F6; benchVerdict); otherwise the
// report says why there's none, and a repair run's intervals decide nothing.
// The window's timeline counts are the match's, summed over every timeline
// it passed through, a rejoin's included (bench-F3). Its
// pitch draws names over the terriers, the most drawing a page does, as
// roslambo's bench did; sound is off. New at M4.

import { BUILD_INPUTS } from './build-info';
import { config, type RenderQuality } from './config';
import { defaultBotParams } from './core/bot/brain';
import { personId } from './core/bot/bot-id';
import { scriptSampler } from './core/bot/setups';
import { generateMatchId } from './core/match-id';
import { BarkTracker, buildHash, type MatchNetSummary, netSettings, type TimelineStats } from './core/session/index';
import { CELEBRATION, defaultParams, KICKOFF_COUNTDOWN, type MatchSettings } from './core/sim/index';
import { type RoomCall, type RoomReport, type Spread, type VirtualRoom, virtualRoom } from './bench/virtual-room';
import type { Boot } from './main';
import { createCodeDrawer } from './render/drawers/code';
import { PLACEHOLDER_LOOK } from './render/look';
import { createStage } from './render/scene';
import type { RenderInfo, ResourceCounts, Stage } from './render/stage-types';
import { MatchView } from './render/view';
import { DEFAULT_SETTINGS, type Profile, type ProfileSource, type Settings, type SettingsSource } from './storage/schema';
import { browserClock, browserPage, type Clock } from './ui/clock';
import { type AnimationFrames, FrameLoop } from './ui/frame-loop';
import type { Inspection } from './ui/inspect';
import { PITCH_LAYERS } from './ui/layers/index';
import { type NetMatch, openNetMatch } from './ui/match';
import type { OwnFigures } from './ui/match-types';
import { pitchScreen, type PitchScreen } from './ui/screens/pitch';

const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
/** L286's frame-time criteria, roslambo's (PLAN §16). */
const P95_MS = 18; // not a setting: L286's
const MAX_MS = 50; // not a setting: L286's
// The bench's method (PLAN §16, §2.11, §8.3): seven virtual peers at 20–80 ms one way with 15 ms of jitter,
// seed 7 as the specs' setups; the hold 15 s into play for 4,100 ms, as M3's cap check held it.
const SEED = 7; // not a setting: the end-to-end setups' seed
const LATENCY_MS = [20, 80] as const; // not a setting: PLAN §16's
const JITTER_MS = 15; // not a setting: PLAN §16's
const HOLD_AT_SECONDS = 15; // not a setting: §2.11's, M3's cap check's
const HOLD_MS = 4100; // not a setting: M3's cap check's, a repair from about 240 ticks back
const STATUS_EVERY_MS = 500; // not a setting: the status's refresh, for a person to read
const MODEL_POLL_MS = 100; // not a setting: the wait for the model's swap
const MODEL_WITHIN_MS = 120_000; // not a setting: a model that hasn't swapped in by then is reported
const EIGHT_WITHIN_MS = 60_000; // not a setting: a match that hasn't all eight in by then is reported
const SAMPLES_PENDING_MAX = 1000; // not a setting: the latency's queue
const MONO = 'white-space: pre-wrap; font: 0.8em/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 0';

// --- Its parameters (M4-Q4) ---

export interface FrameParams {
  /** The window's length from all eight in; null: to Results. */
  readonly seconds: number | null;
  readonly quality: RenderQuality;
  /** Each frame drawn held by a busy wait until this many ms have passed since it began; 0: none (§8.1). */
  readonly frameMs: number;
  /** The shared delivery's messages a second; null: unbounded (§8.3). */
  readonly capacity: number | null;
  /** The forced repair (M3-Q14): the witness, and the hold holdAt seconds into play for hold ms. */
  readonly repair: boolean;
  readonly holdAt: number;
  readonly hold: number;
  /** The model drawer's, a same-origin relative path; null: the code-built drawer alone. */
  readonly model: string | null;
}

const KEYS = ['test', 'seconds', 'quality', 'frameMs', 'capacity', 'repair', 'holdAt', 'hold', 'model'] as const; // not a setting: the page's parameters
const QUALITIES: readonly RenderQuality[] = ['high', 'low'];
const WHOLE = /^(?:0|[1-9][0-9]*)$/;
/** A relative path on this origin: segments of letters, digits, '-', '_' and '.', none starting with '.', so
 *  no scheme, no '//', no '..' and nothing root-absolute; './' may lead. */
const RELATIVE_PATH = /^(?:\.\/)?(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const PATH_MAX = 200; // not a setting: a model path's length
// holdAt from 1 s: the room makes its TICKs a little ahead, and holds those sent from the hold's start.
const LIMITS = {
  seconds: [1, 3600], frameMs: [0, 1000], capacity: [1, 1_000_000], holdAt: [1, 600], hold: [1, 60_000],
} as const; // not a setting: the parameters' ranges

class Bad extends Error {}

/** The bench's parameters from its fragment, or what's wrong with them, for the page to say before it
 *  contacts anything. Unknown parameters, and any given twice, are errors, as #test=net's are. */
export function parseFrameParams(hash: string): FrameParams | { error: string } {
  const q = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  try {
    for (const key of new Set(q.keys())) {
      if (!(KEYS as readonly string[]).includes(key)) throw new Bad(`${key}: this page takes no such parameter`);
      if (q.getAll(key).length > 1) throw new Bad(`${key}: given more than once`);
    }
    if (q.get('test') !== 'frames') throw new Bad('test: this is the #test=frames page');
    const whole = (key: keyof typeof LIMITS, fallback: number | null): number | null => {
      const text = q.get(key);
      if (text === null) return fallback;
      const [lo, hi] = LIMITS[key];
      const n = WHOLE.test(text) ? Number(text) : NaN;
      if (!(n >= lo && n <= hi)) throw new Bad(`${key}: a whole number from ${lo} to ${hi}`);
      return n;
    };
    const qualityText = q.get('quality');
    const quality = qualityText === null ? config.renderQualityDefault : QUALITIES.find((x) => x === qualityText);
    if (quality === undefined) throw new Bad(`quality: one of ${QUALITIES.join(', ')}`);
    const repairText = q.get('repair');
    if (repairText !== null && repairText !== '1') throw new Bad('repair: 1, for the forced repair');
    const repair = repairText === '1';
    if (!repair && (q.has('holdAt') || q.has('hold'))) throw new Bad('holdAt and hold: only with repair=1');
    const model = q.get('model');
    if (model !== null && (model.length > PATH_MAX || model.includes('..') || !RELATIVE_PATH.test(model))) {
      throw new Bad("model: a relative path on this page's origin, with no scheme, '//' or '..'");
    }
    return {
      seconds: whole('seconds', null), quality, frameMs: whole('frameMs', 0)!, capacity: whole('capacity', null), repair,
      holdAt: whole('holdAt', HOLD_AT_SECONDS)!, hold: whole('hold', HOLD_MS)!, model,
    };
  } catch (e) {
    if (e instanceof Bad) return { error: e.message };
    throw e;
  }
}

// --- Its report ---

export interface Stats {
  readonly count: number;
  readonly mean: number;
  readonly p95: number;
  readonly max: number;
}

export interface FrameReport {
  readonly done: boolean;
  /** Why the bench stopped short: a failure, or a match that never had all eight in. */
  readonly error: string | null;
  readonly params: FrameParams;
  /** L286's verdict, or none, and why (M4-Q17). */
  readonly verdict: 'pass' | 'fail' | 'none';
  readonly pass: boolean;
  readonly why: string;
  /** From all eight in to Results, or `seconds`, on the page clock and in local ticks. */
  readonly window: {
    readonly fromMs: number | null; readonly toMs: number | null; readonly seconds: number;
    readonly fromTick: number | null; readonly toTick: number | null; readonly endedBy: 'seconds' | 'results' | 'error' | null;
  };
  /** The final roster's size as the window opened. */
  readonly terriers: number;
  readonly frames: {
    /** Animation frames in the window, and the intervals between them (L286). */
    readonly count: number;
    readonly interval: { readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number };
    /** A drawn frame's own work, its busy wait aside, and its draw submission, stage.draw's (§8.4's run 2). */
    readonly work: Stats;
    readonly draw: Stats;
    readonly drawn: number;
    readonly skipped: number;
  };
  /** The page's timer runs in the window: their cost, and the gaps between them (§8.1, §8.4's run 4). */
  readonly timer: { readonly runs: number; readonly cost: Stats; readonly gapP95Ms: number; readonly gapMaxMs: number; readonly gapsOverFreeze: number; readonly gapsOverStall: number };
  /** What this page moved, sent and skipped over the window, for every sender it sends for (§1.37). */
  readonly own: OwnFigures;
  /** The timeline's clock samples over the window, and the kept ones' age (§8.4's run 4, D-15). */
  readonly clock: { readonly samples: number; readonly dropped: number; readonly droppedShare: number; readonly keptAgeMs: Spread };
  /** The forced repair: its calls, the STATE's adoption alone, the worst call (M3-Q14); null without one. */
  readonly repair: {
    readonly calls: readonly RoomCall[]; readonly adoptMs: number | null; readonly worstMs: number; readonly worstSteps: number;
    readonly steps: number; readonly resyncs: number;
    /** The witness's STATEs to the page: in the whole run, and from the hold's start. */
    readonly witnessStates: number; readonly statesFromHold: number;
    /** How far back the STATE the page took from the hold's start was: its sender's tick less its own (§2.11's
     *  about 240); null before one (bench-F4). */
    readonly back: number | null;
  } | null;
  readonly room: Omit<RoomReport, 'calls'>;
  readonly render: {
    readonly quality: RenderQuality; readonly cap: number; readonly drawer: RenderInfo['drawer']; readonly model: RenderInfo['model'];
    readonly atStart: ResourceCounts | null; readonly atEnd: ResourceCounts | null; readonly compiledInPlay: boolean;
  };
  /** The governor's actions in the window and before it, from the loop's start, and its log (§8.2); with frames
   *  held (frameMs), it doesn't govern. */
  readonly governor: {
    readonly governs: boolean; readonly actions: number; readonly before: number; readonly scale: number; readonly log: Inspection['frames']['log'];
  };
  /** From this page's input sampled to the first frame drawing its tick, ms (R-6, §8.4's run 7). */
  readonly latency: Spread;
  /** Since navigation: boot.started() and prepare()'s end (§2.1). */
  readonly startMs: { readonly started: number; readonly prepared: number | null };
  readonly match: {
    readonly goals: number; readonly celebration: boolean; readonly kickoff: boolean; readonly phase: number;
    readonly score: readonly [number, number]; readonly ended: boolean;
  };
  /** The page's timeline over the window, but for the most steps in an advance and the log, the run's. */
  readonly stats: {
    readonly late: number; readonly lateAbsent: number; readonly disagree: number; readonly resyncs: number; readonly resyncFailed: number;
    readonly rollbacks: number; readonly corrections: number; readonly jumps: number; readonly maxStepsPerAdvance: number;
    /** The page's timeline's log, its first entries, [local tick, event]. */
    readonly log: readonly (readonly [number, string])[];
  };
  /** The match's network summary, the corrections' sizes among it (§2.3's check, §8.4's run 5). */
  readonly summary: MatchNetSummary | null;
  readonly userAgent: string;
  readonly devicePixelRatio: number;
  readonly viewport: { readonly width: number; readonly height: number };
}

/** What a spec or a run polls while the bench measures: read from counters alone, so a poll costs the
 *  measured window nothing but its own call. */
export interface BenchStatus {
  readonly done: boolean;
  readonly error: string | null;
  /** The final roster's size as the window opened; 0 before. */
  readonly terriers: number;
  readonly window: { readonly fromMs: number | null; readonly seconds: number; readonly endedBy: FrameReport['window']['endedBy'] };
  /** The forced repair's progress: the page's completed resyncs, the hold's start once it has begun and the
   *  resyncs completed by then, and the witness's STATEs. */
  readonly resyncs: number;
  readonly holdFromMs: number | null;
  readonly resyncsAtHold: number | null;
  readonly witness: 'none' | 'worker';
  readonly witnessStates: number;
  readonly witnessError: string | null;
}

/** window.terriestTest.bench, added once the bench's match is open, only when a spec set
 *  window.terriestTest before load (CLAUDE.md's test hook): status() to poll, report() once it's done,
 *  whose figures it otherwise works out at each call. */
export interface BenchHook {
  status(): BenchStatus;
  report(): FrameReport;
}

declare module './ui/inspect' {
  interface TerriestTest {
    /** The #test=frames page's (M4's design §1.53). */
    bench?: BenchHook;
  }
}

/** What L286's verdict is made of (M4-Q17). */
export interface VerdictFacts {
  readonly params: Pick<FrameParams, 'repair' | 'frameMs' | 'model'>;
  readonly error: string | null;
  readonly done: boolean;
  readonly endedBy: FrameReport['window']['endedBy'];
  /** Goals scored in the window, and whether a celebration and a kickoff after it were. */
  readonly goals: number;
  readonly celebration: boolean;
  readonly kickoff: boolean;
  /** The model's state as the window opened; null before. */
  readonly model: RenderInfo['model'] | null;
  /** The governor's actions from the loop's start to the window's end, its opening included: a governor that
   *  stepped down before the window and stayed down would have the window judged at half scale (bench-F6). */
  readonly actions: number;
  readonly interval: FrameReport['frames']['interval'];
}

/** L286's verdict (M4-Q17): given only for a whole match, to Results, with no witness and no busy wait, a goal,
 *  its celebration and a kickoff in it, the model drawn if one was named, and the governor never acting; else
 *  none, saying why (bench-F7). */
export function benchVerdict(o: VerdictFacts): Pick<FrameReport, 'verdict' | 'pass' | 'why'> {
  const none: string[] = [];
  if (o.error !== null) none.push(o.error);
  if (o.params.repair) none.push('a forced repair decides nothing by its frames (M4-Q16)');
  if (o.params.frameMs > 0) none.push(`each frame was held to ${o.params.frameMs} ms`);
  if (o.endedBy !== 'results') none.push(o.done ? `the window ended by ${o.endedBy}, not at Results` : 'still measuring');
  if (o.goals < 1 || !o.celebration || !o.kickoff) none.push('no goal, its celebration and a kickoff inside the window');
  if (o.params.model !== null && o.model?.state !== 'drawn') {
    none.push(`the model ${o.params.model} wasn't drawn: ${o.model?.state ?? 'none'}${o.model?.error ? `, ${o.model.error}` : ''}`);
  }
  if (o.actions > 0) none.push(`the governor acted ${o.actions} times (§8.2)`);
  const figures = `p95 ${o.interval.p95.toFixed(1)} ms (≤ ${P95_MS}) and max ${o.interval.max.toFixed(1)} ms (≤ ${MAX_MS})`;
  if (none.length > 0) return { verdict: 'none', pass: false, why: `no verdict: ${none.join('; ')}; ${figures}` };
  const pass = o.interval.p95 <= P95_MS && o.interval.max <= MAX_MS;
  return { verdict: pass ? 'pass' : 'fail', pass, why: figures };
}

const stats = (xs: readonly number[]): Stats => {
  if (xs.length === 0) return { count: 0, mean: 0, p95: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  return { count: s.length, mean: s.reduce((a, b) => a + b, 0) / s.length, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!, max: s[s.length - 1]! };
};

const quantile = (sorted: readonly number[], q: number): number => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!);

const spreadOf = (xs: readonly number[]): Spread => {
  const s = [...xs].sort((a, b) => a - b);
  return { count: s.length, p50: quantile(s, 0.5), p95: quantile(s, 0.95), max: s.length === 0 ? 0 : s[s.length - 1]! };
};

/** The settings the bench plays at, from memory, never storage: the fragment's quality, names over the
 *  terriers, ball view, the swing camera and no sound. */
function benchSettings(quality: RenderQuality): SettingsSource {
  const s: Settings = { ...DEFAULT_SETTINGS, names: true, calmCamera: false, sound: false, quality };
  return {
    persistent: false,
    get: () => s,
    stored: () => ({ ...s }),
    set: () => 'the bench keeps its settings',
    subscribe: () => () => {},
  };
}

function benchProfile(me: string): ProfileSource {
  const p: Profile = { v: 1, playerId: me, name: 'Bench', coat: 0, hints: { keyboard: 0, touch: 0, gamepad: 0 } };
  return { persistent: false, get: () => p, update: () => false };
}

/** The stage, its draw() timed: the frame's draw submission (§8.4's run 2). */
function timedStage(s: Stage, took: (ms: number) => void): Stage {
  return {
    get canvas() {
      return s.canvas;
    },
    prepare: () => s.prepare(),
    ready: () => s.ready(),
    draw: (frame) => {
      const t0 = performance.now();
      const out = s.draw(frame);
      took(performance.now() - t0);
      return out;
    },
    info: () => s.info(),
    setModel: (url) => s.setModel(url),
    get onGraphics() {
      return s.onGraphics;
    },
    set onGraphics(fn) {
      s.onGraphics = fn;
    },
    rebuild: (quality) => s.rebuild(quality),
    setScale: (scale) => s.setScale(scale),
    dispose: () => s.dispose(),
  };
}

const counts = (r: RenderInfo): ResourceCounts => ({ programs: r.programs, geometries: r.geometries, textures: r.textures });

/** The drawing's counts, for a person to read. */
const drawn = (c: ResourceCounts | null): string => (c === null ? '…' : `${c.programs} programs, ${c.geometries} geometries, ${c.textures} textures`);

/** The timeline's counts the report gives over the window. */
const COUNTED = ['late', 'lateAbsent', 'disagree', 'resyncs', 'resyncFailed', 'rollbacks', 'corrections', 'jumps'] as const; // not a setting
type Counts = Record<(typeof COUNTED)[number], number>;
const countsOf = (s: TimelineStats): Counts => Object.fromEntries(COUNTED.map((k) => [k, s[k]])) as Counts;

/** The forced repair's figures from the calls kept (M3-Q14): the STATE the page took from the hold's start, not
 *  one of a rejoin's or a transient's before it (bench-F4), the first STATE call there that stepped, as one the
 *  page drops steps nothing, with its adoption alone and how far back it was; the worst call; their steps; the
 *  resyncs the page completed; and the STATEs the witness sent from the hold's start. */
export function repairFigures(calls: readonly RoomCall[], room: Pick<RoomReport, 'hold' | 'states' | 'witnessStates'>, resyncs: number): NonNullable<FrameReport['repair']> {
  const from = room.hold?.fromMs ?? null;
  const adopt = from === null ? undefined : calls.find((c) => c.kind === 'STATE' && c.steps > 0 && c.at >= from);
  const stepped = calls.filter((c) => c.steps > 0);
  const worst = stepped.reduce<RoomCall | null>((a, c) => (a === null || c.ms > a.ms ? c : a), null);
  const states = from === null ? [] : room.states.filter((s) => s.atMs >= from);
  return {
    calls: calls.map((c) => ({ ...c })), adoptMs: adopt?.ms ?? null, worstMs: worst?.ms ?? 0, worstSteps: worst?.steps ?? 0,
    steps: stepped.reduce((n, c) => n + c.steps, 0), resyncs, witnessStates: room.witnessStates, statesFromHold: states.length,
    back: adopt?.state === undefined ? null : adopt.state.senderTick - adopt.state.g,
  };
}

// --- The page ---

/** Shows the page and tells boot.js it has started, then runs the bench its fragment names, or says why
 *  not and contacts nothing. */
export function run(boot: Boot): void {
  const p = parseFrameParams(location.hash);
  const main = document.createElement('main');
  main.id = 'frames';
  const panel = document.createElement('div');
  panel.style.cssText =
    'position: fixed; left: 0; bottom: 0; z-index: 60; max-width: min(46rem, 100%); padding: 0.5rem 0.75rem; background: #1d2b1f; color: #eef3ea';
  const heading = document.createElement('h1');
  heading.textContent = 'Frame-time bench';
  heading.style.cssText = 'font-size: 1rem; margin: 0 0 0.25rem';
  const out = document.createElement('pre');
  out.style.cssText = MONO;
  panel.append(heading, out);
  if ('error' in p) {
    main.append(panel);
    document.body.append(main);
    out.textContent = `The bench didn't start, and contacted nothing: ${p.error}.`;
    boot.started();
    return;
  }
  const stage = createStage({ quality: p.quality, look: PLACEHOLDER_LOOK, drawer: createCodeDrawer, capacity: 2 * config.packSizeMax, modelUrl: '' });
  if (stage === null) {
    boot.noWebGL2();
    return;
  }
  // The canvas fills the window as the app's does (index.html's #stage), the screen over it.
  const stageBox = document.createElement('div');
  stageBox.id = 'stage';
  const canvas = stage.canvas;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The pitch');
  stageBox.append(canvas);
  const screenBox = document.createElement('div');
  screenBox.style.cssText = 'position: fixed; inset: 0; touch-action: none';
  main.append(stageBox, screenBox, panel);
  document.body.append(main);
  out.textContent = 'Getting the pitch ready…';
  const bench = new Bench(p, stage, screenBox, out);
  boot.started();
  bench.startedMs = performance.now();
  void bench.run().catch((e: unknown) => {
    bench.failed(e);
    // The page's own error, which the end-to-end guard fails (§16's "Everywhere").
    throw e;
  });
}

class Bench {
  startedMs = 0;
  private readonly p: FrameParams;
  private readonly stage: Stage;
  private readonly drawStage: Stage;
  private readonly screenBox: HTMLElement;
  private readonly out: HTMLElement;
  private readonly me = personId(SEED, 0);
  private readonly settings: MatchSettings = { packSize: config.packSizeMax, matchMinutes: config.matchLengthDefaultMinutes };
  private readonly room: VirtualRoom;
  private match: NetMatch | null = null;
  private view: MatchView | null = null;
  private screen: PitchScreen | null = null;
  private loop: FrameLoop | null = null;
  private unsubscribe: () => void = () => {};
  private preparedMs: number | null = null;
  private openedAt = 0;
  private readied = false;
  private error: string | null = null;
  private doneValue = false;
  private endedBy: FrameReport['window']['endedBy'] = null;
  private final: FrameReport | null = null;
  // The window.
  private fromMs: number | null = null;
  private toMs: number | null = null;
  private fromTick: number | null = null;
  private toTick: number | null = null;
  private terriers = 0;
  private ownFrom: OwnFigures | null = null;
  private ownTo: OwnFigures | null = null;
  private samplesFrom = { taken: 0, dropped: 0 };
  /** The page's timeline's counts as the window opened, and as it closed. */
  private countsFrom: Counts | null = null;
  private countsTo: Counts | null = null;
  private samplesTo = { taken: 0, dropped: 0 };
  /** The governor's actions from the loop's start as the window opened, and as it closed. */
  private actionsFrom = 0;
  private actionsTo: number | null = null;
  private renderFrom: ResourceCounts | null = null;
  private renderTo: ResourceCounts | null = null;
  private modelAtStart: RenderInfo['model'] | null = null;
  private goalsFrom = 0;
  private celebration = false;
  private kickoff = false;
  // What the window measures.
  private readonly stamps: number[] = [];
  private readonly work: number[] = [];
  private readonly draws: number[] = [];
  private drawMs = 0;
  private readonly costs: number[] = [];
  private readonly gaps: number[] = [];
  private lastRunAt: number | null = null;
  private gapsOverFreeze = 0;
  private gapsOverStall = 0;
  private readonly pending: [number, number][] = [];
  private readonly latencies: number[] = [];

  constructor(p: FrameParams, stage: Stage, screenBox: HTMLElement, out: HTMLElement) {
    this.p = p;
    this.stage = stage;
    this.drawStage = timedStage(stage, (ms) => {
      this.drawMs += ms;
    });
    this.screenBox = screenBox;
    this.out = out;
    this.room = virtualRoom({
      peers: 2 * this.settings.packSize - 1, seed: SEED, latencyMs: LATENCY_MS, jitterMs: JITTER_MS, build: buildHash(config, BUILD_INPUTS),
      capacityPerSecond: p.capacity, holdAtMs: p.repair ? p.holdAt * 1000 : null, holdMs: p.hold, witness: p.repair,
      // Held frames starve a task a message (bench-F1): every message due goes in each task instead.
      drain: p.frameMs > 0,
    });
  }

  private get open(): boolean {
    return this.fromMs !== null && this.toMs === null;
  }

  async run(): Promise<void> {
    await this.stage.prepare();
    this.preparedMs = performance.now();
    if (this.p.model !== null) await this.swapModel(this.p.model);
    await this.openMatch();
    const status = setInterval(() => {
      this.show();
      if (this.doneValue) clearInterval(status);
    }, STATUS_EVERY_MS);
    this.show();
  }

  /** The model asked of the stage, from this page's origin, and waited for until it has swapped in or
   *  failed, so frames are judged only after the swap (R-8). */
  private async swapModel(path: string): Promise<void> {
    const url = new URL(path, location.href);
    if (url.origin !== location.origin) throw new Error(`the model ${path} isn't on this page's origin`);
    this.stage.setModel(path);
    const until = performance.now() + MODEL_WITHIN_MS;
    for (;;) {
      const state = this.stage.info().model.state;
      if ((state !== 'loading' && state !== 'compiling') || performance.now() > until) return;
      this.out.textContent = `The model ${path}: ${state}…`;
      await new Promise((done) => setTimeout(done, MODEL_POLL_MS));
    }
  }

  /** The match on the bench's room, proposed, this page playing in pack A by the brain, drawn by the real
   *  pitch screen through the frame loop. */
  private async openMatch(): Promise<void> {
    const timed: Clock = {
      now: () => performance.now(),
      every: (ms, fn) => browserClock.every(ms, () => this.timerRun(fn)),
      after: (ms, fn) => browserClock.after(ms, fn),
    };
    const m = await openNetMatch({
      matchId: generateMatchId(), me: this.me, name: 'Bench', coat: 0, build: buildHash(config, BUILD_INPUTS),
      // The room is the transport: it contacts nothing, and these go unused.
      relays: null, ice: 'none', clock: timed, page: browserPage, transport: this.room,
    });
    this.match = m;
    this.openedAt = performance.now();
    this.room.attach(() => m.session.timeline);
    m.propose(this.settings);
    m.play(0);
    let sample = scriptSampler('brain', this.me, 0, P, B);
    m.setControls(
      (head, headTick, tick) => {
        const input = sample(head, headTick);
        if (this.open && this.pending.length < SAMPLES_PENDING_MAX) this.pending.push([tick, performance.now()]);
        return input;
      },
      (base) => {
        sample = scriptSampler('brain', this.me, base, P, B);
      },
    );
    const view = new MatchView(m, PLACEHOLDER_LOOK, () => ({ calmCamera: false, names: true }), new BarkTracker(this.me));
    this.view = view;
    const settings = benchSettings(this.p.quality);
    const screen = pitchScreen({
      match: m, stage: this.drawStage, view, controls: null, settings, profile: benchProfile(this.me), look: PLACEHOLDER_LOOK, test: false,
      announce: () => {}, openMenu: () => {}, closeMenu: () => {}, leave: () => this.finish('error', 'the bench was left'), ui: () => {},
      setMode: () => {}, results: () => this.finish('results'), page: browserPage, invite: null,
    }, PITCH_LAYERS);
    this.screen = screen;
    // This page plays, by the brain: drawn from its own ball view, as a player's page is.
    view.mode = { kind: 'player', view: 'ball', terrier: this.me };
    this.screenBox.append(screen.el);
    const frames: AnimationFrames = {
      request: (fn) => requestAnimationFrame((ts) => {
        if (this.open) this.stamps.push(ts);
        fn();
      }),
      cancel: (id) => cancelAnimationFrame(id),
    };
    // Frames held to frameMs aren't governed: each takes what the run holds it to (§8.1, §8.4's run 6).
    const loop = new FrameLoop({ frame: (now) => this.frame(now), clock: browserClock, stage: this.stage, frames, govern: this.p.frameMs === 0 });
    this.loop = loop;
    loop.start();
    this.unsubscribe = m.subscribe({ run: () => this.ran() });
    const test = window.terriestTest;
    if (test) test.bench = { status: () => this.status(), report: () => this.report() };
  }

  /** One of the page's timer runs, timed: its cost, the gap before it, and its steps for the repair's calls. */
  private timerRun(fn: () => void): void {
    const t = this.match?.session.timeline ?? null;
    const steps = t?.stats.steps ?? 0;
    const at = performance.now();
    fn();
    const ms = performance.now() - at;
    this.room.timerCall(at, ms, (t?.stats.steps ?? 0) - steps);
    if (!this.open) {
      this.lastRunAt = at;
      return;
    }
    this.costs.push(ms);
    if (this.lastRunAt !== null) {
      const gap = at - this.lastRunAt;
      this.gaps.push(gap);
      if (gap > (NET.timeline.delay + NET.timeline.window) * NET.tickMs) this.gapsOverFreeze++;
      if (gap > NET.stallMs) this.gapsOverStall++;
    }
    this.lastRunAt = at;
  }

  /** One frame drawn: the pitch screen's, then the busy wait to frameMs (§8.1), and the latency of each
   *  sample whose tick this frame first draws. */
  private frame(now: number): void {
    const screen = this.screen;
    if (screen === null) return;
    const t0 = performance.now();
    this.drawMs = 0;
    screen.frame(now);
    const work = performance.now() - t0;
    // Held from the window's opening, so the joins it doesn't measure aren't starved (bench-F1).
    if (this.p.frameMs > 0 && this.open) {
      const until = t0 + this.p.frameMs;
      while (performance.now() < until) {
        // The held frame (§8.1): the thread does nothing else.
      }
    }
    if (!this.open) return;
    this.work.push(work);
    this.draws.push(this.drawMs);
    const drawn = this.view?.drawn ?? null;
    if (drawn !== null) {
      const shown = Math.floor(drawn.time);
      while (this.pending.length > 0 && this.pending[0]![0] <= shown) this.latencies.push(now - this.pending.shift()![1]);
    }
  }

  /** After each timer run: the governor told, Ready pressed once in the roster, and the window opened once
   *  all eight are in, watched, and closed after `seconds`. */
  private ran(): void {
    const m = this.match;
    const loop = this.loop;
    if (m === null || loop === null || this.doneValue) return;
    const now = performance.now();
    loop.timerRan(now, m.own());
    const t = m.session.timeline;
    if (!t.started) return;
    if (!this.readied && m.session.inRoster()) {
      this.readied = true;
      m.ready(true);
    }
    if (this.fromMs === null) {
      if (t.final.terriers.length === 2 * this.settings.packSize) this.openWindow(now);
      else if (now - this.openedAt > EIGHT_WITHIN_MS) this.finish('error', `the match had ${t.final.terriers.length} terriers in ${EIGHT_WITHIN_MS / 1000} s, not ${2 * this.settings.packSize}`);
      return;
    }
    if (!this.open) return;
    const phase = t.final.phase;
    if (phase === CELEBRATION) this.celebration = true;
    if (phase === KICKOFF_COUNTDOWN && this.celebration) this.kickoff = true;
    if (this.p.seconds !== null && now - this.fromMs >= this.p.seconds * 1000) this.finish('seconds');
  }

  /** The window opened: the counts it's measured from, the timeline's the match's over every timeline it has
   *  passed through, so a rejoin in the window mixes nothing (bench-F3). */
  private openWindow(now: number): void {
    const m = this.match!;
    const t = m.session.timeline;
    const st = m.stats();
    this.fromMs = now;
    this.fromTick = t.localTick;
    this.terriers = t.final.terriers.length;
    this.ownFrom = { ...m.own() };
    this.samplesFrom = { taken: st.clockSamples, dropped: st.clockSamplesDropped };
    this.countsFrom = countsOf(st);
    this.actionsFrom = this.loop!.inspect().actions;
    const r = this.stage.info();
    this.renderFrom = counts(r);
    this.modelAtStart = { ...r.model };
    this.goalsFrom = m.scoreboard.goals.length;
  }

  private closeWindow(now: number): void {
    const m = this.match;
    if (this.fromMs === null || this.toMs !== null || m === null) return;
    const st = m.stats();
    this.toMs = now;
    this.toTick = m.session.timeline.localTick;
    this.ownTo = { ...m.own() };
    this.samplesTo = { taken: st.clockSamples, dropped: st.clockSamplesDropped };
    this.countsTo = countsOf(st);
    this.actionsTo = this.loop?.inspect().actions ?? null;
    this.renderTo = counts(this.stage.info());
  }

  /** The window closed, the report made and kept, and everything stopped: the loop, the match and its room. */
  finish(endedBy: 'seconds' | 'results' | 'error', error: string | null = null): void {
    if (this.doneValue) return;
    const now = performance.now();
    this.closeWindow(now);
    this.endedBy = endedBy;
    if (error !== null) this.error = error;
    this.doneValue = true;
    this.final = this.makeReport();
    this.unsubscribe();
    this.loop?.stop();
    this.screen?.dispose();
    this.match?.close();
    this.show();
  }

  failed(e: unknown): void {
    this.finish('error', e instanceof Error ? e.message : String(e));
  }

  report(): FrameReport {
    return this.final ?? this.makeReport();
  }

  status(): BenchStatus {
    const now = performance.now();
    const room = this.room.peek();
    return {
      done: this.doneValue, error: this.error, terriers: this.terriers,
      window: { fromMs: this.fromMs, seconds: this.fromMs === null ? 0 : ((this.toMs ?? now) - this.fromMs) / 1000, endedBy: this.endedBy },
      resyncs: this.match?.stats().resyncs ?? 0, witness: this.p.repair ? 'worker' : 'none', ...room,
    };
  }

  private makeReport(): FrameReport {
    const m = this.match;
    const t = m?.session.timeline ?? null;
    // The match's counts, over every timeline it passed through (bench-F3).
    const st = m?.stats();
    const now = performance.now();
    const intervals: number[] = [];
    for (let k = 1; k < this.stamps.length; k++) intervals.push(this.stamps[k]! - this.stamps[k - 1]!);
    const sorted = [...intervals].sort((a, b) => a - b);
    const interval = { p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95), p99: quantile(sorted, 0.99), max: sorted.length === 0 ? 0 : sorted[sorted.length - 1]! };
    const ownNow = this.ownTo ?? (m === null ? null : m.own());
    const ownFrom = this.ownFrom;
    const own: OwnFigures = ownNow === null || ownFrom === null
      ? { ticks: 0, sent: 0, skipped: 0, senders: 0 }
      : { ticks: ownNow.ticks - ownFrom.ticks, sent: ownNow.sent - ownFrom.sent, skipped: ownNow.skipped - ownFrom.skipped, senders: ownNow.senders };
    const samplesTo = this.toMs !== null || st === undefined ? this.samplesTo : { taken: st.clockSamples, dropped: st.clockSamplesDropped };
    const taken = this.fromMs === null ? 0 : samplesTo.taken - this.samplesFrom.taken;
    const dropped = this.fromMs === null ? 0 : samplesTo.dropped - this.samplesFrom.dropped;
    const { calls, ...room } = this.room.report(this.fromMs === null ? undefined : { fromMs: this.fromMs, toMs: this.toMs ?? Infinity });
    const frames = this.loop?.inspect() ?? null;
    // The governor's actions from the loop's start: before the window, and in it, to its close (bench-F6).
    const actionsNow = this.actionsTo ?? frames?.actions ?? 0;
    const before = this.fromMs === null ? actionsNow : this.actionsFrom;
    const actions = actionsNow - before;
    const r = this.stage.info();
    const atEnd = this.renderTo ?? (this.fromMs === null ? null : counts(r));
    const goals = m === null ? 0 : m.scoreboard.goals.length - this.goalsFrom;
    const ended = m !== null && m.scoreboard.end !== null;
    const repair = this.p.repair ? repairFigures(calls, room, st?.resyncs ?? 0) : null;
    const seconds = this.fromMs === null ? 0 : ((this.toMs ?? now) - this.fromMs) / 1000;
    const verdict = benchVerdict({
      params: this.p, error: this.error, done: this.doneValue, endedBy: this.endedBy, goals, celebration: this.celebration, kickoff: this.kickoff,
      model: this.modelAtStart, actions: before + actions, interval,
    });
    const countsNow = this.countsTo ?? (st === undefined ? null : countsOf(st));
    const over = (k: (typeof COUNTED)[number]): number => (countsNow === null || this.countsFrom === null ? 0 : countsNow[k] - this.countsFrom[k]);
    return {
      done: this.doneValue, error: this.error, params: this.p, ...verdict,
      window: { fromMs: this.fromMs, toMs: this.toMs, seconds, fromTick: this.fromTick, toTick: this.toTick, endedBy: this.endedBy },
      terriers: this.terriers,
      frames: { count: this.stamps.length, interval, work: stats(this.work), draw: stats(this.draws), drawn: frames?.frames ?? 0, skipped: this.loop?.skippedFrames ?? 0 },
      timer: {
        runs: this.costs.length, cost: stats(this.costs), gapP95Ms: spreadOf(this.gaps).p95, gapMaxMs: spreadOf(this.gaps).max,
        gapsOverFreeze: this.gapsOverFreeze, gapsOverStall: this.gapsOverStall,
      },
      own,
      clock: { samples: taken, dropped, droppedShare: taken + dropped > 0 ? dropped / (taken + dropped) : 0, keptAgeMs: room.keptSampleAgeMs },
      repair,
      room,
      render: {
        quality: r.quality, cap: r.cap, drawer: r.drawer, model: { ...r.model }, atStart: this.renderFrom, atEnd,
        compiledInPlay: this.renderFrom !== null && atEnd !== null && atEnd.programs !== this.renderFrom.programs,
      },
      governor: { governs: this.p.frameMs === 0, actions, before, scale: frames?.scale ?? 1, log: frames?.log ?? [] },
      latency: spreadOf(this.latencies),
      startMs: { started: this.startedMs, prepared: this.preparedMs },
      match: {
        goals, celebration: this.celebration, kickoff: this.kickoff, phase: t?.final.phase ?? 0,
        score: t === null ? [0, 0] : [t.final.score[0], t.final.score[1]], ended,
      },
      stats: {
        late: over('late'), lateAbsent: over('lateAbsent'), disagree: over('disagree'), resyncs: over('resyncs'), resyncFailed: over('resyncFailed'),
        rollbacks: over('rollbacks'), corrections: over('corrections'), jumps: over('jumps'),
        maxStepsPerAdvance: st?.maxStepsPerAdvance ?? 0, log: (st?.log ?? []).map(([tick, e]): [number, string] => [tick, e]),
      },
      summary: m === null ? null : m.summary(),
      userAgent: navigator.userAgent, devicePixelRatio, viewport: { width: innerWidth, height: innerHeight },
    };
  }


  /** The status, for a person to read: while the bench measures, from counters alone, so the window pays
   *  nothing for it; once done, the report. */
  private show(): void {
    if (!this.doneValue) {
      const s = this.status();
      this.out.textContent = s.window.fromMs === null
        ? 'Frame-time bench: waiting for all eight terriers…'
        : `Frame-time bench: measuring, ${s.window.seconds.toFixed(0)} s in: ${this.stamps.length} frames, ${this.costs.length} timer runs` +
          `${this.p.repair ? `; ${s.resyncs} repairs, ${s.witnessStates} STATEs from the witness` : ''}`;
      return;
    }
    const r = this.report();
    const f = (x: number, digits = 1): string => x.toFixed(digits);
    const state = r.verdict === 'none' ? r.why : `${r.verdict.toUpperCase()}: ${r.why}`;
    const lines = [
      `Frame-time bench: ${state}`,
      `${r.params.quality} quality${r.params.frameMs > 0 ? `, frames held to ${r.params.frameMs} ms` : ''}` +
        `${r.params.capacity !== null ? `, delivery capped at ${r.params.capacity} a second` : ''}` +
        `${r.params.repair ? `, a forced repair ${r.params.holdAt} s into play for ${r.params.hold} ms` : ''}` +
        `${r.params.model !== null ? `, model ${r.params.model} (${r.render.model.state})` : ''}; ${r.terriers} terriers`,
      `Frames ${r.frames.count}: interval p50 ${f(r.frames.interval.p50)}, p95 ${f(r.frames.interval.p95)}, p99 ${f(r.frames.interval.p99)}, ` +
        `max ${f(r.frames.interval.max)} ms; work ${f(r.frames.work.mean, 2)} mean, ${f(r.frames.work.p95, 2)} p95 ms; draw ${f(r.frames.draw.mean, 2)} mean ms`,
      `Timer runs ${r.timer.runs}: cost ${f(r.timer.cost.mean, 2)} mean, ${f(r.timer.cost.p95, 2)} p95, ${f(r.timer.cost.max)} max ms; ` +
        `gaps ${f(r.timer.gapP95Ms)} p95, ${f(r.timer.gapMaxMs)} max ms, ${r.timer.gapsOverFreeze} over a freeze`,
      `Sent ${r.own.sent} of ${r.own.ticks} ticks, ${r.own.skipped} skipped; clock samples ${r.clock.samples}, ${r.clock.dropped} dropped; ` +
        `the room ${f(r.room.roomMs.p95PerTick, 3)} ms a tick at the p95; governor ${r.governor.actions} actions, scale ${r.governor.scale}`,
      `Sample to screen ${f(r.latency.p50)} p50, ${f(r.latency.p95)} p95 ms; started ${f(r.startMs.started, 0)} ms, prepared ${r.startMs.prepared === null ? '…' : f(r.startMs.prepared, 0)} ms`,
      // What compiled in play, for a person reading the page without the hook (§2.11, bench-F9).
      `Drawing: ${drawn(r.render.atStart)} as the window opened, ${drawn(r.render.atEnd)} as it closed; ` +
        `${r.render.compiledInPlay ? 'a program compiled in play' : 'nothing compiled in play'}; the governor acted ${r.governor.before} times before the window`,
      ...(r.repair === null ? [] : [
        `Repair: ${r.repair.resyncs} resyncs, the STATE adopted in ${r.repair.adoptMs === null ? '…' : f(r.repair.adoptMs, 2)} ms, ` +
          `the worst call ${f(r.repair.worstMs, 2)} ms for ${r.repair.worstSteps} steps; the witness sent ${r.repair.witnessStates} STATEs` +
          `${r.room.witnessError !== null ? `; the witness failed: ${r.room.witnessError}` : ''}`,
      ]),
      ...(r.error === null ? [] : [`Stopped: ${r.error}`]),
      `${navigator.userAgent}; dpr ${devicePixelRatio}; ${innerWidth}×${innerHeight}`,
    ];
    this.out.textContent = lines.join('\n');
  }
}
