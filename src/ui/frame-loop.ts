// The page's one animation-frame loop, and the governor that makes drawing
// give way (M4's design, research/m4/DESIGN.md, §1.47, §2.1, §8.2; PLAN
// §17's "From M3": "keep the timeline and its messages a guaranteed share of
// the main thread, degrading drawing first"; M4-Q17). It runs only while a
// pitch screen shows, and hands each frame the page clock's time,
// performance.now()'s, the clock the keyboard's event times are on, so the
// key-to-screen figure measures one clock (R-6, src/input/controls.ts).
//
// The governor watches what slow frames cost the page, not the frames:
// over each second of the page clock, from the timer runs the app reports
// (timerRan), two shares:
// - of the ticks this page moved, those it skipped, over every sender it
//   sends for (the match's own(), §1.37, §8.1);
// - of the second, the time spent in timer gaps longer than
//   drawingLateTimerMs, each gap's whole length.
// Either past drawingLateShare, drawing gives way one step: the stage's
// pixel-ratio scale falls by drawingScaleStep of its cap, down to
// drawingScaleMin, a cheaper fill on the same context, so the quality never
// changes (D-33); and at that scale, the loop draws every other animation
// frame. After drawingRecoverSeconds with neither, it steps back one. Each
// action is logged in the hook's frames.log, its why the skipped share's
// ('skipped') before the gaps' ('gaps'), or 'recovered'. It never touches
// the timeline: the timer's period, its catch-ups and what it sends are
// M3's (M4-Q6); drawing only does less, so more of the thread is the
// timer's. A new scale is applied just before the next frame drawn, in the
// same task as that frame's drawing, so the stage never reports a scale its
// buffer wasn't drawn at (§9.1's rule). A hidden page's frames aren't
// judged (D-31): its timer wakes about once a second whatever drawing does,
// so its seconds, and the first gap after it shows again, count for
// nothing. Leaving the pitch screen (stop) gives drawing back its full
// scale, from the next frame drawn, and each start applies its scale again
// before its first frame, on whichever stage is held then, since the app
// may swap in a stage it kept off the pitch (§2.8). The bench's held
// frames (§8.1) turn it off, so each frame takes what the run holds it to.
// Phase 1's (slice) had the last step alone, on each late gap; phase 2b's
// frames builder makes it the whole governor (§8.2). Tested in virtual
// time (src/ui/frame-loop.test.ts). New at M4.

import { config } from '../config';
import type { Stage } from '../render/stage-types';
import type { Clock } from './clock';
import type { Inspection } from './inspect';
import type { OwnFigures } from './match-types';

type Frames = Inspection['frames'];
type Why = Frames['log'][number]['why'];

/** requestAnimationFrame and its cancel: the page's, or a test's. */
export interface AnimationFrames {
  request(fn: () => void): number;
  cancel(id: number): void;
}

export const browserFrames: AnimationFrames = {
  request: (fn) => requestAnimationFrame(() => fn()),
  cancel: (id) => cancelAnimationFrame(id),
};

/** The log's entries kept, the most recent; every action is counted. */
const LOG_KEPT = 200; // not a setting: the hook's bound
/** The governor's measure: a second of the page clock (§8.2). */
const SECOND_MS = 1000; // not a setting: §8.2's window

/** The governor's steps (§8.2): the scale at each, 1 down by drawingScaleStep to drawingScaleMin; one step
 *  past the last, every other frame is skipped at that scale. */
const SCALES: readonly number[] = Array.from(
  { length: Math.ceil((1 - config.drawingScaleMin) / config.drawingScaleStep) + 1 },
  (_, k) => Math.max(config.drawingScaleMin, 1 - k * config.drawingScaleStep),
);
const SKIPPING = SCALES.length;

/** The page hidden: document.visibilityState's, as src/ui/clock.ts's browserPage reads it. */
const documentHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState !== 'visible';

export interface FrameLoopOptions {
  /** One frame: the page clock's time, and the time since the frame drawn before it, 0 for the first. */
  readonly frame: (nowMs: number, dtMs: number) => void;
  readonly clock: Clock;
  /** The governor's scale: the stage held now, read at each call. */
  readonly stage: Pick<Stage, 'setScale'>;
  readonly frames?: AnimationFrames;
  /** Whether the page is hidden: the document's by default, a test's otherwise. */
  readonly hidden?: () => boolean;
  /** false: the governor measures but never acts, for the bench's held frames (§8.1, §8.4's run 6). */
  readonly govern?: boolean;
}

export class FrameLoop {
  private readonly o: FrameLoopOptions;
  private readonly frames: AnimationFrames;
  private readonly hidden: () => boolean;
  private pending: number | null = null;
  private running = false;
  private lastDrawnAt: number | null = null;
  private drewLast = true;
  private drawn = 0;
  private skipped = 0;
  // The governor: its step, the scale it set and the one still to apply, and its log.
  private level = 0;
  private scale = 1;
  private scaleDue: number | null = null;
  private actions = 0;
  private readonly log: Frames['log'][number][] = [];
  // The second being measured: its start, the time in late gaps ending in it, and the match's figures at
  // its start; the time since the last action or late second; the last timer run, and whether the page
  // was hidden then.
  private windowStart = 0;
  private lateMs = 0;
  private windowOwn: OwnFigures | null = null;
  private calmMs = 0;
  private lastRunAt: number | null = null;
  private lastHidden = false;

  constructor(o: FrameLoopOptions) {
    this.o = o;
    this.frames = o.frames ?? browserFrames;
    this.hidden = o.hidden ?? documentHidden;
  }

  /** Draws from the next animation frame on, the governor measuring from now. Its scale is applied again
   *  before the first frame drawn, as the stage held then may be another than the one it last drew on: a
   *  stage the app kept off the pitch, swapped back in at the scale it drew at then (§2.8). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastDrawnAt = null;
    this.drewLast = true;
    this.lastRunAt = null;
    this.lastHidden = false;
    this.restartWindow(this.o.clock.now(), null);
    this.calmMs = 0;
    this.scaleDue = this.scale;
    this.pending = this.frames.request(() => this.tick());
  }

  /** Stops drawing; drawing gets its full scale back from the next frame drawn, whatever pitch it's for. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.pending !== null) this.frames.cancel(this.pending);
    this.pending = null;
    this.lastRunAt = null;
    if (this.level > 0) this.step(0, 'recovered', this.o.clock.now());
  }

  /** After each timer run of the match held: its time, and its own() figures (§1.37), for the governor. */
  timerRan(nowMs: number, own: Readonly<OwnFigures> | null): void {
    const gap = this.lastRunAt === null ? 0 : nowMs - this.lastRunAt;
    this.lastRunAt = nowMs;
    if (!this.running) return;
    const hidden = this.hidden();
    const wasHidden = this.lastHidden;
    this.lastHidden = hidden;
    // A hidden page's timer sleeps whatever drawing does, and its frames aren't judged (D-31): neither its
    // seconds nor the gap that ends as it shows again.
    if (hidden || wasHidden) {
      this.restartWindow(nowMs, own);
      return;
    }
    if (gap > config.drawingLateTimerMs) this.lateMs += gap;
    if (this.windowOwn === null && own !== null) this.windowOwn = { ...own };
    const length = nowMs - this.windowStart;
    if (length >= SECOND_MS) this.judge(nowMs, length, own);
  }

  /** The hook's frames (§1.40): headHashMismatches is the pitch screen's, which the app adds. */
  inspect(): Frames {
    return {
      frames: this.drawn, scale: this.scale, skipping: this.level === SKIPPING, actions: this.actions,
      log: this.log.map((e) => ({ ...e })), headHashMismatches: 0,
    };
  }

  /** Animation frames the last step skipped. */
  get skippedFrames(): number {
    return this.skipped;
  }

  /** The second just measured: one step down if either share passed drawingLateShare, its why the
   *  skipped share's first; one step back after drawingRecoverSeconds with neither. */
  private judge(nowMs: number, length: number, own: Readonly<OwnFigures> | null): void {
    const base = this.windowOwn;
    const moved = own !== null && base !== null ? own.ticks - base.ticks : 0;
    const skipped = own !== null && base !== null ? own.skipped - base.skipped : 0;
    const skippedShare = moved > 0 ? Math.max(0, skipped) / moved : 0;
    const gapShare = this.lateMs / length;
    const share = config.drawingLateShare;
    const why: Why | null = skippedShare > share ? 'skipped' : gapShare > share ? 'gaps' : null;
    this.restartWindow(nowMs, own);
    if (this.o.govern === false) return;
    if (why !== null) {
      this.calmMs = 0;
      if (this.level < SKIPPING) this.step(this.level + 1, why, nowMs);
      return;
    }
    this.calmMs += length;
    if (this.level > 0 && this.calmMs >= config.drawingRecoverSeconds * SECOND_MS) {
      this.calmMs = 0;
      this.step(this.level - 1, 'recovered', nowMs);
    }
  }

  private restartWindow(nowMs: number, own: Readonly<OwnFigures> | null): void {
    this.windowStart = nowMs;
    this.lateMs = 0;
    this.windowOwn = own === null ? null : { ...own };
  }

  /** To a step: its scale applied before the next frame drawn, every other frame skipped at the last. */
  private step(level: number, why: Why, atMs: number): void {
    this.level = level;
    const scale = SCALES[Math.min(level, SCALES.length - 1)]!;
    if (scale !== this.scale) {
      this.scale = scale;
      this.scaleDue = scale;
    }
    this.drewLast = true;
    this.actions++;
    this.log.push({ atMs, scale, skipping: level === SKIPPING, why });
    if (this.log.length > LOG_KEPT) this.log.shift();
  }

  private tick(): void {
    if (!this.running) return;
    this.pending = this.frames.request(() => this.tick());
    const now = this.o.clock.now();
    if (this.level === SKIPPING && this.drewLast) {
      this.drewLast = false;
      this.skipped++;
      return;
    }
    this.drewLast = true;
    if (this.scaleDue !== null) {
      this.o.stage.setScale(this.scaleDue);
      this.scaleDue = null;
    }
    const dt = this.lastDrawnAt === null ? 0 : Math.max(0, now - this.lastDrawnAt);
    this.lastDrawnAt = now;
    this.drawn++;
    this.o.frame(now, dt);
  }
}
