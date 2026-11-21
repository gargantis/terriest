// The page's one animation-frame loop (M4's design, research/m4/DESIGN.md,
// §1.47, §2.1, §8.2; PLAN §17's "From M3": "keep the timeline and its
// messages a guaranteed share of the main thread, degrading drawing
// first"): it runs only while a pitch screen shows, and hands each frame
// the page clock's time, performance.now()'s, the clock the keyboard's
// event times are on, so the key-to-screen figure measures one clock (R-6,
// src/input/controls.ts).
//
// Phase 1's (slice) is the governor's last step alone: when a timer gap
// since the last animation frame passed drawingLateTimerMs, the frame after
// one drawn is skipped, so while frames block the timer it draws every
// other animation frame and the timer gets the thread back, with no scale
// plumbing (R-3). The fallback counts as on from the first late gap until a
// drawn frame is followed by none, each change logged in the hook's
// frames.log. Phase 2b's frames builder adds the whole governor (§8.2): the
// stage's scale first, from what slow frames cost the page (own(), §8.1),
// stepping back after drawingRecoverSeconds. New at M4.

import { config } from '../config';
import type { Stage } from '../render/stage-types';
import type { Clock } from './clock';
import type { Inspection } from './inspect';
import type { OwnFigures } from './match-types';

type Frames = Inspection['frames'];

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
const LOG_KEPT = 200;

export interface FrameLoopOptions {
  /** One frame: the page clock's time, and the time since the frame drawn before it, 0 for the first. */
  readonly frame: (nowMs: number, dtMs: number) => void;
  readonly clock: Clock;
  /** The governor's scale (phase 2b): the stage held now, read at each call. */
  readonly stage: Pick<Stage, 'setScale'>;
  readonly frames?: AnimationFrames;
}

export class FrameLoop {
  private readonly o: FrameLoopOptions;
  private readonly frames: AnimationFrames;
  private pending: number | null = null;
  private running = false;
  private lastDrawnAt: number | null = null;
  /** The largest timer gap since the last animation frame, drawn or skipped. */
  private gapSinceFrame = 0;
  private lastRunAt: number | null = null;
  private drewLast = true;
  private skipping = false;
  private drawn = 0;
  private skipped = 0;
  private actions = 0;
  private readonly log: Frames['log'][number][] = [];

  constructor(o: FrameLoopOptions) {
    this.o = o;
    this.frames = o.frames ?? browserFrames;
  }

  /** Draws from the next animation frame on. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastDrawnAt = null;
    this.drewLast = true;
    this.gapSinceFrame = 0;
    this.pending = this.frames.request(() => this.tick());
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.pending !== null) this.frames.cancel(this.pending);
    this.pending = null;
    this.lastRunAt = null;
    if (this.skipping) this.act(false, this.o.clock.now());
  }

  /** After each timer run of the match held: its time, and its own() figures for phase 2b's governor. */
  timerRan(nowMs: number, _own: Readonly<OwnFigures> | null): void {
    if (this.lastRunAt !== null) this.gapSinceFrame = Math.max(this.gapSinceFrame, nowMs - this.lastRunAt);
    this.lastRunAt = nowMs;
  }

  /** The hook's frames (§1.40): headHashMismatches is the pitch screen's, which the app adds. */
  inspect(): Frames {
    return {
      frames: this.drawn, scale: 1, skipping: this.skipping, actions: this.actions,
      log: this.log.map((e) => ({ ...e })), headHashMismatches: 0,
    };
  }

  /** Frames skipped by phase 1's fallback, for the tests and the log. */
  get skippedFrames(): number {
    return this.skipped;
  }

  private tick(): void {
    if (!this.running) return;
    this.pending = this.frames.request(() => this.tick());
    const now = this.o.clock.now();
    const late = this.gapSinceFrame > config.drawingLateTimerMs;
    this.gapSinceFrame = 0;
    if (late && !this.skipping) this.act(true, now);
    else if (!late && this.skipping && this.drewLast) this.act(false, now);
    if (late && this.drewLast) {
      this.drewLast = false;
      this.skipped++;
      return;
    }
    this.drewLast = true;
    const dt = this.lastDrawnAt === null ? 0 : Math.max(0, now - this.lastDrawnAt);
    this.lastDrawnAt = now;
    this.drawn++;
    this.o.frame(now, dt);
  }

  /** The fallback on, from a late gap, or off, a drawn frame followed by none. */
  private act(on: boolean, atMs: number): void {
    this.skipping = on;
    this.actions++;
    this.log.push({ atMs, scale: 1, skipping: on, why: on ? 'gaps' : 'recovered' });
    if (this.log.length > LOG_KEPT) this.log.shift();
  }
}
