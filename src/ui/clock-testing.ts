// Test support for the match glue (M3's design §1.23, §8.3): FakeClock,
// virtual time whose timers fire in order, and which can stall as a frozen
// page's timers do or batch them as a hidden page's are; and fakePage, a
// page whose visibility the test sets. Written in phase 3, so phase 4's
// src/ui/game.test.ts and src/ui/practice.test.ts import it rather than
// declare it. Only tests import it, so no build bundles it.

import type { Clock, PageEvents } from './clock';

interface Timer {
  readonly id: number;
  due: number;
  readonly period: number | null; // null: once
  readonly fn: () => void;
}

/** The most timers that may run at one instant: past it, timers keep setting timers due at once. */
const RUNS_AT_ONCE_MAX = 10_000; // not a setting: a test's guard

/** Virtual time for the glue's tests (C-6): nothing moves until the test advances it. */
export class FakeClock implements Clock {
  /** While set, timers run only at whole multiples of this many ms, each one due running once, as a
   *  hidden page's run about once a second (D-31): set it beside fakePage's hide(). null: on time. */
  throttle: number | null = null;
  private time: number;
  private nextId = 0;
  private timers: Timer[] = [];
  private busy = false;
  private runsAt = NaN;
  private runs = 0;

  constructor(start = 0) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  every(ms: number, fn: () => void): () => void {
    if (!(ms > 0 && ms < Infinity)) throw new RangeError(`an interval of ${ms} ms would never let virtual time move`);
    return this.set(ms, ms, fn);
  }

  /** As a browser's: a delay that isn't a positive number is 0, due at once but after the timer running. */
  after(ms: number, fn: () => void): () => void {
    return this.set(ms > 0 && ms < Infinity ? ms : 0, null, fn);
  }

  /** The timers set and neither cancelled nor done. */
  get pending(): number {
    return this.timers.length;
  }

  /** Runs ms of virtual time. On time: each timer at its due time, in that order and then the order
   *  they were set, an interval every period, now() reading its due time. Throttled: at each wake. */
  advance(ms: number): void {
    this.enter(ms);
    try {
      const end = this.time + ms;
      const q = this.throttle;
      if (q === null) {
        for (let x = this.dueBy(end); x !== null; x = this.dueBy(end)) {
          if (x.due > this.time) this.time = x.due;
          this.run(x);
        }
      } else {
        if (!(q > 0 && q < Infinity)) throw new RangeError(`a throttle of ${q} ms would never wake`);
        for (let w = (Math.floor(this.time / q) + 1) * q; w <= end; w += q) {
          this.time = w;
          this.wake();
        }
      }
      this.time = end;
    } finally {
      this.busy = false;
    }
  }

  /** A stall: ms pass with no timer running, as on a frozen page or a paused machine (D-31, design
   *  §4.12); then each timer that fell due runs once, an interval however many periods it missed,
   *  and goes on a period from then. */
  stall(ms: number): void {
    this.enter(ms);
    try {
      this.time += ms;
      this.wake();
    } finally {
      this.busy = false;
    }
  }

  /** Advances a millisecond at a time until cond holds, at most ms. */
  until(cond: () => boolean, ms: number): void {
    const end = this.time + ms;
    while (!cond() && this.time < end) this.advance(1);
    if (!cond()) throw new Error(`not reached within ${ms} ms`);
  }

  private set(ms: number, period: number | null, fn: () => void): () => void {
    const x: Timer = { id: this.nextId++, due: this.time + ms, period, fn };
    this.timers.push(x);
    return () => {
      this.timers = this.timers.filter((y) => y !== x);
    };
  }

  /** The timer due first at or before t: the earliest, then the first set. */
  private dueBy(t: number): Timer | null {
    let best: Timer | null = null;
    for (const x of this.timers) {
      if (x.due <= t && (best === null || x.due < best.due || (x.due === best.due && x.id < best.id))) best = x;
    }
    return best;
  }

  /** Runs x now. An interval is due again a period on from its due time, or from now if it ran late,
   *  set before it runs so that it may cancel itself. */
  private run(x: Timer): void {
    if (this.runsAt !== this.time) {
      this.runsAt = this.time;
      this.runs = 0;
    }
    if (++this.runs > RUNS_AT_ONCE_MAX) throw new Error(`timers keep setting timers due at ${this.time} ms`);
    if (x.period === null) this.timers = this.timers.filter((y) => y !== x);
    else x.due = (x.due < this.time ? this.time : x.due) + x.period;
    x.fn();
  }

  /** Every timer due now runs once, in order, as a woken page's do; an interval then a period on. */
  private wake(): void {
    for (let x = this.dueBy(this.time); x !== null; x = this.dueBy(this.time)) this.run(x);
  }

  private enter(ms: number): void {
    if (this.busy) throw new Error('a FakeClock moves from the test, never from inside one of its timers');
    if (!(ms >= 0 && ms < Infinity)) throw new RangeError(`virtual time moves on by a finite number of ms, not ${ms}`);
    this.busy = true;
  }
}

/** A page for the glue's tests, visible unless created hidden. */
export interface FakePage extends PageEvents {
  /** Hides it, telling each listener as visibilitychange does; nothing if it's hidden already. */
  hide(): void;
  show(): void;
  /** The listeners added and not removed. */
  readonly listeners: number;
}

export function fakePage(hidden = false): FakePage {
  let isHidden = hidden;
  const fns = new Set<() => void>();
  const set = (h: boolean): void => {
    if (h === isHidden) return;
    isHidden = h;
    // As the DOM's dispatch: a listener removed by an earlier one isn't called.
    for (const fn of [...fns]) if (fns.has(fn)) fn();
  };
  return {
    hidden: () => isHidden,
    onVisibility: (fn) => {
      fns.add(fn);
      return () => {
        fns.delete(fn);
      };
    },
    hide: () => set(true),
    show: () => set(false),
    get listeners() {
      return fns.size;
    },
  };
}
