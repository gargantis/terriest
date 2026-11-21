// The page's sound output (PLAN §13, D-32, Q-15; M4's design,
// research/m4/DESIGN.md, §1.27, §7, R-9): one AudioContext, made at start-up,
// and its master gain.
// - The context is resumed at each keydown, click, pointerup or touchend
//   until it runs, heard on the window before the page's own handlers, and
//   when the page is shown; each resume()'s promise is caught, so a refusal
//   is never a page error. A gamepad press may not count, so while sound is
//   on and the context waits, the sound layer says "Press a key or tap for
//   sound" (src/ui/layers/sound.ts, waitsForInput).
// - With no Web Audio, or a context that can't be made, its state is 'none'
//   and nothing sounds: no listener, no node, no prompt.
// - The master gain follows Settings' sound (setEnabled), faded, not cut,
//   into a limiter, so a chorus over a whistle stays clear of clipping.
// - Practice's menu suspends the context, so sound stops with play (Q-15);
//   a key pressed while it's paused doesn't resume it.
// - Every cue SoundCues decides is counted in `decided`, whatever the
//   context's state, and in `played` only when scheduled: while the context
//   runs, sound is on and Practice isn't paused. One decided while the
//   context waits is dropped, never queued: a suspended context's time
//   stands still, so every cue scheduled on it would sound at once when it
//   resumed (feasibility-F9).
// src/ui/layers/sound.ts holds the page's one, audioOut(), whose inspect() is
// the hook's audio (§1.40). Three-free. New at M4.

import type { AudioInspection, CueKind } from '../ui/inspect';
import { type Cue, schedule } from './synth';

/** What AudioOut needs of the window: its AudioContext, and the events that may start one. Window
 *  satisfies it; a test passes a fake. */
export interface AudioWindow {
  readonly AudioContext?: (new () => AudioContext) | undefined;
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
}

/** What AudioOut needs of the document: when the page is shown. Document satisfies it. */
export interface AudioDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
}

/** The inputs that may start a context (D-32): a gamepad press isn't among them. */
const GESTURES = ['keydown', 'click', 'pointerup', 'touchend'] as const;
/** The master gain while sound is on. */
const LEVEL = 0.8;
/** The master gain's time constant: sound turned off or on fades this fast, with no click. */
const FADE_SECONDS = 0.02;
/** The limiter before the speakers: gentle until a pile of cues nears full scale. */
const LIMITER = { thresholdDb: -6, kneeDb: 4, ratio: 8, attackSeconds: 0.003, releaseSeconds: 0.2 };

/** A count for each kind of cue, every one there (Record<CueKind, …> holds it to the union). */
const counts = (): Record<CueKind, number> => ({
  bark: 0, thump: 0, whoosh: 0, thud: 0, whistleKickoff: 0, whistleGoal: 0, whistleEnd: 0, chorus: 0,
});

/** A context's promise, its refusal caught, so it's never a page error (§0, R-9); `settled` once it settles
 *  either way, or at once if the call throws. */
function caught(call: () => Promise<void> | undefined, settled?: () => void): void {
  let p: Promise<void> | undefined;
  try {
    p = call();
  } catch {
    settled?.();
    return;
  }
  const done = (): void => settled?.();
  Promise.resolve(p).then(done, done);
}

export class AudioOut {
  private readonly ctx: AudioContext | null;
  private readonly master: GainNode | null;
  private on = true;
  private pausedNow = false;
  /** Whether the context ran when Practice paused it, and so is coming back once it resumes. */
  private ranWhenPaused = false;
  /** Coming back from Practice's pause: its resume() not yet settled. */
  private returning = false;
  private prompt = false;
  /** A cue that threw: logged once, never again. */
  private failed = false;
  private readonly decided = counts();
  private readonly played = counts();

  /** The AudioContext, made at start-up (D-32), and the listeners that resume it. */
  constructor(target: AudioWindow, doc: AudioDocument) {
    let ctx: AudioContext | null = null;
    let master: GainNode | null = null;
    const Context = target.AudioContext;
    if (typeof Context === 'function') {
      try {
        ctx = new Context();
        master = ctx.createGain();
        master.gain.value = LEVEL;
        const limit = ctx.createDynamicsCompressor();
        limit.threshold.value = LIMITER.thresholdDb;
        limit.knee.value = LIMITER.kneeDb;
        limit.ratio.value = LIMITER.ratio;
        limit.attack.value = LIMITER.attackSeconds;
        limit.release.value = LIMITER.releaseSeconds;
        master.connect(limit).connect(ctx.destination);
      } catch {
        ctx = null;
        master = null;
      }
    }
    this.ctx = ctx;
    this.master = master;
    if (ctx === null) return;
    const wake = (): void => this.wake();
    for (const type of GESTURES) target.addEventListener(type, wake, { capture: true, passive: true });
    target.addEventListener('pageshow', wake, { passive: true });
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'visible') this.wake();
    });
  }

  /** Running, or waiting for a key or a tap (PLAN §13); 'none' without Web Audio. */
  get state(): 'running' | 'waiting' | 'none' {
    const c = this.ctx;
    if (c === null || c.state === 'closed') return 'none';
    return c.state === 'running' ? 'running' : 'waiting';
  }

  /** Settings' sound. */
  get enabled(): boolean {
    return this.on;
  }

  /** Practice's pause. */
  get paused(): boolean {
    return this.pausedNow;
  }

  /** The context waits for a key or a tap, and not because Practice paused it, nor while it comes back
   *  from that pause: with sound on, the sound layer's prompt shows (D-32). */
  get waitsForInput(): boolean {
    return this.state === 'waiting' && !this.pausedNow && !this.returning;
  }

  /** Settings' sound: the master gain, faded to it. */
  setEnabled(on: boolean): void {
    this.on = on;
    const c = this.ctx;
    const m = this.master;
    if (c === null || m === null) return;
    m.gain.setTargetAtTime(on ? LEVEL : 0, c.currentTime, FADE_SECONDS);
  }

  /** Practice's menu (Q-15): the context suspends, and resumes when it closes. */
  setPaused(on: boolean): void {
    if (on === this.pausedNow) return;
    this.pausedNow = on;
    const c = this.ctx;
    if (c === null) return;
    if (on) {
      this.ranWhenPaused = c.state === 'running' || this.returning;
      this.returning = false;
      caught(() => c.suspend());
    } else {
      this.returning = this.ranWhenPaused;
      this.resume(c);
    }
  }

  /** The sound layer's prompt, shown or not, for the hook (§1.40). */
  setPrompt(shown: boolean): void {
    this.prompt = shown;
  }

  /** A cue SoundCues decided: counted in `decided` whatever the context's state; scheduled, and counted in
   *  `played`, only while the context runs, sound is on and Practice isn't paused. A cue decided while the
   *  context waits is dropped, never queued: a suspended context's time stands still, so every cue
   *  scheduled on it would sound at once when it resumes. */
  play(cue: Cue): void {
    this.decided[cue.kind]++;
    const c = this.ctx;
    const m = this.master;
    if (c === null || m === null || c.state !== 'running' || !this.on || this.pausedNow) return;
    try {
      schedule(c, m, cue, c.currentTime);
      this.played[cue.kind]++;
    } catch (e) {
      // Not a refusal the page expects: the page's own error, which the gate's guard fails, but once, and
      // never at the cost of the timer run that decided it.
      if (!this.failed) console.error('A sound could not be played:', e);
      this.failed = true;
    }
  }

  inspect(): AudioInspection {
    return {
      state: this.state, enabled: this.on, paused: this.pausedNow, prompt: this.prompt,
      decided: { ...this.decided }, played: { ...this.played },
    };
  }

  /** A gesture, or the page shown: the context resumed, unless it runs or Practice paused it. */
  private wake(): void {
    const c = this.ctx;
    if (c === null || this.pausedNow || c.state === 'running' || c.state === 'closed') return;
    this.resume(c);
  }

  private resume(c: AudioContext): void {
    caught(() => c.resume(), () => {
      this.returning = false;
    });
  }
}
