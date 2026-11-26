// Test support for the pitch screen and its layers (M4's design,
// research/m4/DESIGN.md, §1.38, §1.43, §9.2; §12's 1b: the shell builds
// the pitch screen against Stage, MatchViewApi and ControlsApi with fakes,
// and the slice wires the real ones): a stage whose ready() the test
// settles, a view and controls that record each call into one log, so a
// test reads their order, and a Match over a state the test sets, its timer
// runs, stalls and corrections told when the test says, and its settings,
// from C-59 its rules among them, its final state's. A real Practice
// match in virtual time stands in where the session's rules matter
// (src/ui/match.ts's practiceMatch). Only tests import it, so no build
// bundles it. New at M4.

import type { BarkEvent, ConfirmedEnd, ConfirmedGoal, Correction, MatchNetSummary, Scoreboard, Session, TimelineStats } from '../core/session/index';
import {
  defaultParams, genesis, type MatchSettings, matchSettingsOf, type MatchState, newTerrier, type Pack, READY, sortTerriers, UNREADY,
} from '../core/sim/index';
import type { ControlsApi, ControlsInspection } from '../input/source';
import type { CameraMode, DrawnMatch, FrameOut, StageFrame } from '../render/frame';
import { interpolate, newDrawnMatch } from '../render/interpolate';
import { PLACEHOLDER_LOOK } from '../render/look';
import type { MatchViewApi, RenderInfo, Stage } from '../render/stage-types';
import { DEFAULT_SETTINGS, type Profile, type ProfileSource, type Settings, type SettingsSource, type StoredSettings } from '../storage/schema';
import { FakeClock } from './clock-testing';
import type { Announcement } from './inspect';
import type { PitchHost } from './layer';
import type { Match, MatchStatus, OwnFigures, PauseReason } from './match-types';

/** The calls the fakes saw, in order. */
export type Calls = string[];

/** A state of `size` a side at `tick`, its terriers by ID, pack and coat, in (spot, pack) order. */
export function stateWith(
  size: number, tick: number, terriers: readonly { readonly id: string; readonly pack: Pack; readonly name?: string; readonly coat?: number }[],
  settings: Partial<MatchSettings> = {},
): MatchState {
  const s = genesis({ packSize: size, matchMinutes: 1, ...settings }, defaultParams);
  s.tick = tick;
  for (const t of terriers) s.terriers.push(newTerrier(t.id, t.name ?? '', t.pack, t.coat ?? 0, 0, defaultParams));
  for (const p of [0, 1] as const) s.terriers.filter((T) => T.pack === p).forEach((T, k) => (T.spot = k));
  sortTerriers(s);
  return s;
}

/** The match drawn from a state as it is: its time the state's tick. */
export const drawnOf = (s: Readonly<MatchState>): DrawnMatch => interpolate(s, s, 1, null, newDrawnMatch());

const point = (x: number, y: number, inView = true, angle = 0): { x: number; y: number; inView: boolean; angle: number } => ({ x, y, inView, angle });

/** A stage whose ready() the test settles, which records each frame it draws and answers with `out`. */
export class FakeStage implements Stage {
  readonly canvas = null as unknown as HTMLCanvasElement;
  readonly drawn: (StageFrame | null)[] = [];
  out: FrameOut = { ball: point(320, 180), terriers: [], yaw: 0, cssWidth: 640, cssHeight: 360 };
  onGraphics: ((state: 'lost' | 'restored') => void) | null = null;
  /** The context lost, as the stage keeps it whoever was told (src/render/scene.ts's watch). */
  lost = false;
  private readonly calls: Calls;
  private readonly settled: Promise<void>;
  private settle: { ok: () => void; fail: (e: unknown) => void } | null = null;

  constructor(calls: Calls) {
    this.calls = calls;
    this.settled = new Promise<void>((ok, fail) => {
      this.settle = { ok, fail };
    });
  }

  /** prepare() has finished. */
  finish(): Promise<void> {
    this.settle?.ok();
    return this.settled;
  }

  /** prepare() failed. */
  fail(): Promise<void> {
    this.settle?.fail(new Error('the compile failed'));
    return this.settled.catch(() => {});
  }

  prepare(): Promise<void> {
    return this.settled;
  }

  ready(): Promise<void> {
    return this.settled;
  }

  draw(frame: StageFrame | null): FrameOut {
    this.calls.push('stage.draw');
    this.drawn.push(frame);
    return this.out;
  }

  /** Whether the context is lost, which a pitch screen reads as it's made (§5.8); no other figure. */
  info(): RenderInfo {
    return { lost: this.lost } as RenderInfo;
  }

  setModel(): void {}

  rebuild(): Promise<void> {
    return Promise.resolve();
  }

  setScale(_scale: number): void {}

  dispose(): void {}
}

/** A view over a match's head: each frame the head drawn at `fraction` of the tick before it, its drawing
 *  clock `lag` ms behind the page's, as after a pause; each run the barks the test queued. */
export class FakeView implements MatchViewApi {
  mode: CameraMode = { kind: 'overview' };
  drawn: DrawnMatch | null = null;
  yaw = 0;
  drawMs = 0;
  fraction = 1;
  lag = 0;
  /** What the next run() returns. */
  barks: BarkEvent[] = [];
  /** The page time each call was handed. */
  readonly times: { readonly run: number[]; readonly correct: number[]; readonly ownBark: number[]; readonly frame: number[] } = {
    run: [], correct: [], ownBark: [], frame: [],
  };
  /** Each frame's dt, and each ownBark's tick. */
  readonly dts: number[] = [];
  readonly ownBarks: number[] = [];
  /** A hook into each frame, as a faulty view's drawing would be. */
  onFrame: ((head: MatchState) => void) | null = null;
  private readonly calls: Calls;
  private readonly match: Match;

  constructor(calls: Calls, match: Match) {
    this.calls = calls;
    this.match = match;
  }

  run(now: number): readonly BarkEvent[] {
    this.calls.push('view.run');
    this.times.run.push(now);
    const b = this.barks;
    this.barks = [];
    return b;
  }

  correct(_c: Readonly<Correction>, now: number): void {
    this.calls.push('view.correct');
    this.times.correct.push(now);
  }

  ownBark(tick: number, now: number): void {
    this.calls.push(`view.ownBark ${tick}`);
    this.ownBarks.push(tick);
    this.times.ownBark.push(now);
  }

  frame(now: number, dt: number): StageFrame {
    this.calls.push('view.frame');
    this.dts.push(dt);
    this.times.frame.push(now);
    this.drawMs = now - this.lag;
    const t = this.match.session.timeline;
    this.onFrame?.(t.head as MatchState);
    this.drawn = t.started ? interpolate(t.head, t.head, this.fraction, null, newDrawnMatch()) : null;
    const camera = { mode: this.mode, yaw: this.yaw, target: { x: 0, y: 0, z: 0 }, subject: null };
    return { match: this.drawn, drawer: null, camera, nowMs: this.drawMs, dtMs: dt, fadeTo: null };
  }

  inspect(): { mode: CameraMode; yaw: number; headTick: number; snaps: number; corrections: number; drawMs: number } {
    return { mode: this.mode, yaw: this.yaw, headTick: 0, snaps: 0, corrections: 0, drawMs: this.drawMs };
  }
}

/** Controls that record what the screen asks of them, and sample `input`. */
export class FakeControls implements ControlsApi {
  input = 0;
  readonly samples: number[] = [];
  readonly rebases: number[] = [];
  readonly drawnTicks: number[] = [];
  /** Each frameDrawn's tick and time. */
  readonly drawnAt: [tick: number, atMs: number][] = [];
  releases = 0;
  viewChanges = 0;
  private readonly calls: Calls;

  constructor(calls: Calls) {
    this.calls = calls;
  }

  add(): void {}
  remove(): void {}

  sample(_head: Readonly<MatchState>, _headTick: number, tick: number): number {
    this.samples.push(tick);
    return this.input;
  }

  rebase(base: number): void {
    this.rebases.push(base);
  }

  release(): void {
    this.calls.push('controls.release');
    this.releases++;
  }

  viewChanged(): void {
    this.viewChanges++;
  }

  frameDrawn(tick: number, atMs: number): void {
    this.calls.push('controls.frameDrawn');
    this.drawnTicks.push(tick);
    this.drawnAt.push([tick, atMs]);
  }

  inspect(): ControlsInspection {
    return {
      devices: [], view: null, lastInput: null, base: null, firstAfterBase: null, presses: { jump: 0, pounce: 0, bark: 0, view: 0 },
      barksDropped: 0, latencyMs: { count: 0, p50: null, p95: null }, holds: [],
    };
  }
}

type Listener = Parameters<Match['subscribe']>[0];

/** A Match over a state the test sets, whose timer runs, stalls and corrections it tells. */
export class StateMatch implements Match {
  kind: 'practice' | 'net' = 'practice';
  readonly me: string;
  readonly matchId = null;
  readonly clock: FakeClock;
  readonly reasons = new Set<PauseReason>();
  readonly readies: boolean[] = [];
  switches = 0;
  /** The events in flight that the timeline reports for this page's player. */
  inFlight = 0;
  switchRefused = false;
  leaves = 0;
  sampler: ((head: Readonly<MatchState>, headTick: number, tick: number) => number) | null = null;
  rebaser: ((base: number) => void) | null = null;
  readonly board: { goals: ConfirmedGoal[]; end: ConfirmedEnd | null; score: readonly [number, number] } = { goals: [], end: null, score: [0, 0] };
  private readonly listeners = new Set<Listener>();
  private readonly timeline: {
    started: boolean; id: string; head: MatchState; prevHead: MatchState; final: MatchState; finalTick: number; headTick: number; localTick: number;
    eventsInFlight(id: string): number;
  };

  constructor(me: string, state: MatchState, clock = new FakeClock(1000)) {
    this.me = me;
    this.clock = clock;
    this.timeline = {
      started: true, id: '00000000000000aa', head: state, prevHead: state, final: state,
      finalTick: state.tick, headTick: state.tick, localTick: state.tick,
      eventsInFlight: (id: string) => (id === this.me ? this.inFlight : 0),
    };
  }

  /** The head and the final state, one state as both, as when every input is in. */
  set state(s: MatchState) {
    const t = this.timeline;
    t.head = t.prevHead = t.final = s;
    t.finalTick = t.headTick = t.localTick = s.tick;
  }

  get state(): MatchState {
    return this.timeline.head;
  }

  /** The settings its final state's genesis took, its rules among them (matchSettingsOf), as a networked
   *  match's follow its held timeline's final state (C-59). */
  get settings(): MatchSettings {
    return matchSettingsOf(this.timeline.final);
  }

  /** The head alone moves on: a predicted state the final hasn't reached. */
  set head(s: MatchState) {
    this.timeline.head = this.timeline.prevHead = s;
    this.timeline.headTick = s.tick;
  }

  /** The timeline hasn't started: no state held yet. */
  set started(on: boolean) {
    this.timeline.started = on;
  }

  get session(): Session {
    return { timeline: this.timeline } as unknown as Session;
  }

  get scoreboard(): Scoreboard {
    return this.board as unknown as Scoreboard;
  }

  get paused(): boolean {
    return this.reasons.size > 0;
  }

  /** A timer run: each subscriber's run. */
  run(): void {
    for (const l of [...this.listeners]) l.run?.();
  }

  stall(why: 'stall' | 'hidden'): void {
    for (const l of [...this.listeners]) l.stalled?.(why);
  }

  correction(c: Correction): void {
    for (const l of [...this.listeners]) l.correction?.(c);
  }

  get subscribers(): number {
    return this.listeners.size;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  setControls(sample: (head: Readonly<MatchState>, headTick: number, tick: number) => number, rebase: (base: number) => void): void {
    this.sampler = sample;
    this.rebaser = rebase;
  }

  /** As the session's: the event queued, so the timeline reports it in flight until the test says. */
  ready(on: boolean): void {
    this.readies.push(on);
    this.inFlight |= on ? READY : UNREADY;
  }

  switchPack(): void {
    this.switches++;
  }

  canAddBot(): boolean {
    return false;
  }

  addBot(): boolean {
    return false;
  }

  removeBot(): boolean {
    return false;
  }

  play(): void {}
  watch(): void {}

  pause(why: PauseReason): void {
    this.reasons.add(why);
  }

  resume(why: PauseReason): void {
    this.reasons.delete(why);
  }

  status(): MatchStatus {
    return {
      refusal: null, failed: false, abandoned: false, refused: null, switchRefused: this.switchRefused, returning: false,
      spectatorsFull: false, leaving: false, closed: false, peers: 0, againSeen: false,
    };
  }

  own(): OwnFigures {
    return { ticks: 0, sent: 0, skipped: 0, senders: 1 };
  }

  summary(): MatchNetSummary {
    throw new Error('no summary in the fake match');
  }

  stats(): TimelineStats {
    throw new Error('no stats in the fake match');
  }

  traffic(): null {
    return null;
  }

  leave(): void {
    this.leaves++;
  }

  playAgain(): Promise<Match> {
    return Promise.reject(new Error('no Play again in the fake match'));
  }

  close(): void {}
}

/** Settings in memory: what the stores' tests check of the real one, enough for the screens. */
export class MemorySettings implements SettingsSource {
  persistent = true;
  value: StoredSettings = DEFAULT_SETTINGS;
  private readonly fns = new Set<(s: Settings) => void>();

  get(): Settings {
    return { ...this.value, calmCamera: this.value.calmCamera ?? false, quality: this.value.quality ?? 'high' };
  }

  stored(): StoredSettings {
    return this.value;
  }

  set(change: Partial<StoredSettings>): string | null {
    this.value = { ...this.value, ...change };
    for (const fn of [...this.fns]) fn(this.get());
    return null;
  }

  subscribe(fn: (s: Settings) => void): () => void {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }
}

/** A profile in memory. */
export class MemoryProfile implements ProfileSource {
  persistent = true;
  value: Profile;

  constructor(playerId: string) {
    this.value = { v: 1, playerId, name: '', coat: 0, hints: { keyboard: 0, touch: 0, gamepad: 0 } };
  }

  get(): Profile {
    return this.value;
  }

  update(change: (p: Profile) => Profile | null): boolean {
    const next = change(this.value);
    if (next === null) return false;
    this.value = next;
    return true;
  }
}

/** A pitch host over the given match, view, stage and controls, recording what it's told. */
export interface TestHost extends PitchHost {
  readonly announced: Announcement[];
  readonly told: string[];
}

export function testHost(o: {
  readonly match: Match; readonly view: MatchViewApi; readonly stage: Stage; readonly controls: ControlsApi | null;
  readonly settings?: SettingsSource; readonly test?: boolean;
}): TestHost {
  const announced: Announcement[] = [];
  const told: string[] = [];
  return {
    match: o.match, view: o.view, stage: o.stage, controls: o.controls,
    settings: o.settings ?? new MemorySettings(), profile: new MemoryProfile(o.match.me), look: PLACEHOLDER_LOOK, test: o.test ?? false,
    announce: (a) => announced.push(a),
    openMenu: () => told.push('openMenu'),
    closeMenu: () => told.push('closeMenu'),
    leave: () => told.push('leave'),
    ui: (c) => told.push(`ui ${c.kind}`),
    setMode: (m) => told.push(`setMode ${m.kind === 'player' ? m.view : m.kind}`),
    announced, told,
  };
}
