import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { netSettings, type NetSettings, practiceSettings } from '../core/session/settings';
import { defaultParams } from '../core/sim/index';
import { Timeline } from '../core/timeline/timeline';
import { FakeClock } from './clock-testing';
import { type AnimationFrames, FrameLoop } from './frame-loop';
import { OwnTally } from './match';
import type { OwnFigures } from './match-types';

// The frame loop and its governor, in virtual time (M4's design, research/m4/DESIGN.md, §1.47, §8.2;
// PLAN §17's "From M3", R-3, M4-Q17): the animation frames are the test's, the page clock a FakeClock,
// and the match's own() figures a real timeline's, advanced at each timer run and counted by the Match
// adapter's OwnTally (src/ui/match.ts, §1.37), so a catch-up sends what M3's timeline sends: a networked
// page only its newest stallSendTicks, Practice every tick (D-22). A frame that blocks the main thread
// blocks the timer too, which then runs once, late; otherwise the timer runs every timerMs. First the
// loop itself, then the governor's last step, every other frame, then §8.2's steps: steady 40 ms frames
// give nothing way; 67 ms frames in a networked match step down within a second; a 500 ms frame every
// second steps down; 3 s with neither steps back; in Practice the gaps alone step it.

const NET = netSettings();
const ME = 'a0'.padStart(32, '0');
const STEP = config.drawingScaleStep;
const MIN = config.drawingScaleMin;
const LATE = config.drawingLateTimerMs;
const RECOVER_MS = config.drawingRecoverSeconds * 1000;

/** The test's animation frames: each request waits for the next run(). */
class FakeFrames implements AnimationFrames {
  private next = 1;
  private queue: { id: number; fn: () => void }[] = [];

  request(fn: () => void): number {
    const id = this.next++;
    this.queue.push({ id, fn });
    return id;
  }

  cancel(id: number): void {
    this.queue = this.queue.filter((x) => x.id !== id);
  }

  get pending(): number {
    return this.queue.length;
  }

  run(): void {
    const due = this.queue;
    this.queue = [];
    for (const x of due) x.fn();
  }
}

/** A page drawing a match: the loop, the scale it sets, and the timeline whose figures it's told. */
class Page {
  readonly clock = new FakeClock(0);
  readonly frames = new FakeFrames();
  readonly drawn: [number, number][] = [];
  /** Each setScale, with the frames drawn before it: a scale is applied just before a frame is drawn. */
  readonly scales: [number, number][] = [];
  hidden = false;
  /** Called after each timer run the loop is told of. */
  afterRun: () => void = () => {};
  readonly loop: FrameLoop;
  private readonly t: Timeline | null;
  private readonly tally = new OwnTally();

  /** net: a networked page's timeline; practice: Practice's, which sends every tick; null: no figures. */
  constructor(match: 'net' | 'practice' | null = 'net') {
    this.loop = new FrameLoop({
      frame: (now, dt) => this.drawn.push([now, dt]),
      clock: this.clock,
      stage: { setScale: (s) => this.scales.push([s, this.drawn.length]) },
      frames: this.frames,
      hidden: () => this.hidden,
    });
    const net: NetSettings | null = match === 'net' ? NET : match === 'practice' ? practiceSettings(NET) : null;
    this.t = net === null ? null : new Timeline({ ...net.timeline, P: defaultParams, me: ME }, { broadcast: () => {}, sendToPlayer: () => false, sendToPeer: () => {} });
    if (this.t !== null) {
      this.t.start(0, { packSize: 1, matchMinutes: 1 }, 'feedfacecafebeef');
      this.t.sending = true;
      this.tally.ran(this.t);
    }
  }

  /** The match's figures now: the tally's, over the sender this page sends for. */
  own(): OwnFigures | null {
    return this.t === null ? null : this.tally.figures();
  }

  /** One timer run now, as the app reports it. */
  run(): void {
    if (this.t !== null) {
      this.t.advance(this.clock.now());
      this.tally.ran(this.t);
    }
    this.loop.timerRan(this.clock.now(), this.own());
    this.afterRun();
  }

  /** One animation frame of `ms`: blocking the timer for its whole length, which then runs once, late; or
   *  with the timer running every timerMs through it. */
  frame(ms: number, blocks: boolean): void {
    this.frames.run();
    if (blocks) {
      this.clock.advance(ms);
      this.run();
    } else {
      for (let t = NET.timerMs; t <= ms; t += NET.timerMs) {
        this.clock.advance(NET.timerMs);
        this.run();
      }
    }
  }

  /** Frames of `ms` for `forMs` of the page clock. */
  frames_(ms: number, blocks: boolean, forMs: number): void {
    const end = this.clock.now() + forMs;
    while (this.clock.now() < end) this.frame(ms, blocks);
  }

  get log(): ReturnType<FrameLoop['inspect']>['log'] {
    return this.loop.inspect().log;
  }
}

describe('the frame loop (§1.47)', () => {
  it('draws every frame while the timer keeps its time, with the page clock and the time since the last frame drawn', () => {
    const p = new Page();
    p.loop.start();
    p.frames_(16, false, 5000);
    expect(p.drawn.length).toBe(Math.ceil(5000 / 16));
    expect(p.drawn[0]).toEqual([0, 0]);
    expect(p.drawn[1]).toEqual([16, 16]);
    expect(p.loop.inspect()).toMatchObject({ frames: p.drawn.length, scale: 1, skipping: false, actions: 0, log: [] });
    // Its scale applied once, before the first frame drawn, and never again while it stands.
    expect(p.scales).toEqual([[1, 0]]);
  });

  it('runs only between start and stop, a new start drawing from a fresh time', () => {
    const p = new Page();
    p.loop.start();
    p.frame(16, false);
    p.loop.stop();
    expect(p.frames.pending).toBe(0);
    p.clock.advance(1000);
    p.loop.start();
    p.loop.start();
    expect(p.frames.pending).toBe(1);
    p.frame(16, false);
    expect(p.drawn).toEqual([[0, 0], [1016, 0]]);
  });
});

describe("the governor's last step: every other frame (§1.47, §8.2, R-3)", () => {
  it('at its last step draws every other animation frame, never none, at the lowest scale', () => {
    const p = new Page();
    p.loop.start();
    // Frames that hold the timer well past the threshold, until the governor has taken every step.
    while (!p.loop.inspect().skipping) p.frame(200, true);
    const f = p.loop.inspect();
    expect([f.scale, f.actions]).toEqual([MIN, Math.round((1 - MIN) / STEP) + 1]);
    const [drawn, skipped] = [p.drawn.length, p.loop.skippedFrames];
    for (let k = 0; k < 20; k++) p.frame(200, true);
    expect([p.drawn.length - drawn, p.loop.skippedFrames - skipped]).toEqual([10, 10]);
  });

  it('keeps the newest 200 of its log, and counts every action', () => {
    const p = new Page(null);
    p.loop.start();
    // Down a step in a second of late gaps, back after drawingRecoverSeconds of none, over and over, each
    // action's time noted at the timer run that took it.
    const acted: number[] = [];
    p.afterRun = () => {
      const n = p.loop.inspect().actions;
      while (acted.length < n) acted.push(p.clock.now());
    };
    const until = (ms: number, blocks: boolean): void => {
      const before = acted.length;
      for (let k = 0; acted.length === before; k++) {
        if (k > 1000) throw new Error('the governor took no step in 1,000 frames');
        p.frame(ms, blocks);
      }
    };
    for (let k = 0; k < 150; k++) {
      until(LATE + 20, true);
      until(16, false);
    }
    const f = p.loop.inspect();
    expect(acted.length).toBe(300);
    expect([f.actions, f.log.length]).toEqual([300, 200]);
    expect(f.log.map((e) => e.atMs)).toEqual(acted.slice(-200));
  });
});

describe('the governor (§8.2, M4-Q17)', () => {
  it('gives nothing way for steady 40 ms frames, which block the timer under drawingLateTimerMs and skip no tick', () => {
    const p = new Page();
    p.loop.start();
    p.frames_(40, true, 10_000);
    expect(p.own()!.skipped).toBe(0);
    expect(p.loop.inspect()).toMatchObject({ scale: 1, skipping: false, actions: 0 });
    expect(p.drawn.length).toBe(250);
  });

  it('takes a timer gap of exactly drawingLateTimerMs as on time, and one a millisecond longer as late', () => {
    // Practice, whose catch-ups send every tick, so the gaps alone decide (D-22).
    const at = new Page('practice');
    at.loop.start();
    at.frames_(LATE, true, 5000);
    expect(at.loop.inspect()).toMatchObject({ scale: 1, skipping: false, actions: 0 });
    const past = new Page('practice');
    past.loop.start();
    past.frames_(LATE + 1, true, 1000 + LATE + 1);
    expect(past.log).toEqual([{ atMs: expect.any(Number), scale: 1 - STEP, skipping: false, why: 'gaps' }]);
  });

  it('steps down within a second for 67 ms frames in a networked match, the skipped share first, then on down a step a second', () => {
    const p = new Page();
    // The frames drawn, and the scales set, when each action was taken.
    const drawnAt: number[] = [];
    const scalesAt: number[] = [];
    p.afterRun = () => {
      while (drawnAt.length < p.loop.inspect().actions) {
        drawnAt.push(p.drawn.length);
        scalesAt.push(p.scales.length);
      }
    };
    p.loop.start();
    p.frames_(67, true, 1000 + 67);
    // A run after a 67 ms frame moves 4 ticks and sends the newest 3: a quarter skipped (§8.1).
    const own = p.own()!;
    expect(own.skipped / own.ticks).toBeCloseTo(0.25, 1);
    expect(p.log).toEqual([{ atMs: expect.any(Number), scale: 1 - STEP, skipping: false, why: 'skipped' }]);
    expect(p.log[0]!.atMs).toBeLessThanOrEqual(1000 + 67);
    // Applied just before the next frame drawn, in its task, so the stage never reports a scale its buffer
    // wasn't drawn at (§9.1): after the start's own full scale, nothing until then.
    p.frame(67, true);
    expect(p.scales[0]).toEqual([1, 0]);
    expect(p.scales.slice(scalesAt[0])).toEqual([[1 - STEP, drawnAt[0]]]);
    p.frames_(67, true, 3000);
    expect(p.log.map((e) => [e.scale, e.skipping, e.why])).toEqual([
      [1 - STEP, false, 'skipped'], [MIN, false, 'skipped'], [MIN, true, 'skipped'],
    ]);
    expect(p.scales.map(([s]) => s)).toEqual([1, 1 - STEP, MIN]);
  });

  it('steps down for a 500 ms frame every second, its gaps half the second and most of its ticks unsent', () => {
    const p = new Page();
    p.loop.start();
    const second = (): void => {
      p.frame(500, true);
      p.frames_(16, false, 500);
    };
    second();
    second();
    expect(p.log.length).toBeGreaterThan(0);
    expect(p.log[0]).toMatchObject({ scale: 1 - STEP, why: 'skipped' });
  });

  it('steps back after drawingRecoverSeconds with neither, one step each time, and logs each', () => {
    const p = new Page();
    p.loop.start();
    p.frames_(67, true, 2000 + 67);
    expect(p.loop.inspect().scale).toBe(MIN);
    const down = p.log.length;
    // Not before: a second short of drawingRecoverSeconds, nothing.
    p.frames_(16, false, RECOVER_MS - 1000);
    expect(p.log.length).toBe(down);
    p.frames_(16, false, 2000);
    expect(p.log.length).toBe(down + 1);
    expect(p.log.at(-1)).toMatchObject({ scale: MIN + STEP, skipping: false, why: 'recovered' });
    // drawingRecoverSeconds of seconds with neither share past drawingLateShare since the last step down.
    expect(p.log.at(-1)!.atMs - p.log[down - 1]!.atMs).toBeGreaterThanOrEqual(RECOVER_MS);
    p.frames_(16, false, RECOVER_MS + 1000);
    expect(p.log.at(-1)).toMatchObject({ scale: 1, why: 'recovered' });
    expect(p.loop.inspect()).toMatchObject({ scale: 1, skipping: false, actions: down + 2 });
    expect(p.scales.map(([s]) => s)).toEqual([1, 1 - STEP, MIN, MIN + STEP, 1]);
    // A late second puts off the next step back: the count starts again.
    p.frames_(67, true, 1000 + 67);
    expect(p.log.at(-1)).toMatchObject({ scale: 1 - STEP, why: 'skipped' });
  });

  it('steps down in Practice on the gaps alone, its catch-ups sending every tick (D-22)', () => {
    const p = new Page('practice');
    p.loop.start();
    p.frames_(67, true, 1000 + 67);
    expect(p.own()!.skipped).toBe(0);
    expect(p.log).toEqual([{ atMs: expect.any(Number), scale: 1 - STEP, skipping: false, why: 'gaps' }]);
  });

  it('steps down on the skipped share alone, its timer on time: the figures own() reports, whatever skipped them', () => {
    const p = new Page(null);
    p.loop.start();
    // A run every timerMs, no late gap, while the match's figures say a fifth of its ticks went unsent.
    let ticks = 0;
    let skipped = 0;
    for (let n = 1; p.clock.now() < 1000 + NET.timerMs; n++) {
      p.frames.run();
      p.clock.advance(NET.timerMs);
      if (n % 4 === 0) {
        ticks += 1;
        if (n % 20 === 0) skipped += 1;
      }
      p.loop.timerRan(p.clock.now(), { ticks, sent: ticks - skipped, skipped, senders: 2 });
    }
    expect(p.log).toEqual([{ atMs: expect.any(Number), scale: 1 - STEP, skipping: false, why: 'skipped' }]);
  });

  it('judges nothing on a hidden page, whose timer wakes once a second, nor the gap that ends as it shows again (D-31)', () => {
    const p = new Page();
    p.loop.start();
    p.frames_(16, false, 1000);
    p.hidden = true;
    for (let k = 0; k < 10; k++) {
      p.clock.advance(1000);
      p.run();
    }
    p.hidden = false;
    p.clock.advance(1000);
    p.run();
    p.frames_(16, false, 3000);
    expect(p.loop.inspect()).toMatchObject({ scale: 1, actions: 0 });
  });

  it('gives drawing back its full scale on stop, from the next frame drawn, and measures afresh from start', () => {
    const p = new Page();
    p.loop.start();
    p.frames_(67, true, 2000 + 67);
    expect(p.loop.inspect().scale).toBe(MIN);
    p.loop.stop();
    expect(p.loop.inspect()).toMatchObject({ scale: 1, skipping: false });
    expect(p.log.at(-1)).toMatchObject({ scale: 1, skipping: false, why: 'recovered' });
    expect(p.scales.map(([s]) => s)).toEqual([1, 1 - STEP, MIN]);
    p.clock.advance(5000);
    p.run();
    p.loop.start();
    p.frame(16, false);
    expect(p.scales.map(([s]) => s)).toEqual([1, 1 - STEP, MIN, 1]);
    const acted = p.loop.inspect().actions;
    p.frames_(16, false, 3000);
    expect(p.loop.inspect().actions).toBe(acted);
  });

  it('applies its scale again at each start, on the stage held then: a stage kept off the pitch and swapped back in draws at it (§2.8)', () => {
    const p = new Page();
    // Two stages, as the app keeps one a quality off the pitch; the loop reads the one held at each call.
    const scales = { a: [] as number[], b: [] as number[] };
    let held: 'a' | 'b' = 'a';
    const loop = new FrameLoop({
      frame: () => {}, clock: p.clock, stage: { setScale: (s) => scales[held].push(s) }, frames: p.frames, hidden: () => false,
    });
    const frames = (ms: number, blocks: boolean, forMs: number): void => {
      const end = p.clock.now() + forMs;
      while (p.clock.now() < end) {
        p.frames.run();
        const steps = blocks ? [ms] : Array.from({ length: Math.floor(ms / NET.timerMs) }, () => NET.timerMs);
        for (const step of steps) {
          p.clock.advance(step);
          loop.timerRan(p.clock.now(), null);
        }
      }
    };
    // Stage a draws a pitch until the governor has stepped it down; the pitch goes.
    loop.start();
    frames(LATE + 20, true, 1000 + LATE + 20);
    p.frames.run();
    expect(scales.a.at(-1)).toBe(1 - STEP);
    loop.stop();
    // Stage b draws the next pitch, at full scale from its first frame.
    held = 'b';
    loop.start();
    frames(16, false, 1000);
    expect(scales.b.at(-1)).toBe(1);
    loop.stop();
    // Stage a swapped back in, the governor at full scale all the while: its first frame draws at full
    // scale again, not at the step it was left at.
    held = 'a';
    const before = scales.a.length;
    loop.start();
    p.frames.run();
    expect(scales.a.slice(before)).toEqual([1]);
    expect(loop.inspect()).toMatchObject({ scale: 1, skipping: false });
  });

  it("takes no step when told not to govern, for the bench's held frames (§8.1, §8.4's run 6)", () => {
    const p = new Page();
    const held = new FrameLoop({ frame: () => {}, clock: p.clock, stage: { setScale: () => {} }, frames: p.frames, hidden: () => false, govern: false });
    held.start();
    for (let k = 0; k < 40; k++) {
      p.frames.run();
      p.clock.advance(200);
      held.timerRan(p.clock.now(), { ticks: 12 * k, sent: 3 * k, skipped: 9 * k, senders: 1 });
    }
    expect(held.inspect()).toMatchObject({ scale: 1, skipping: false, actions: 0 });
  });
});
