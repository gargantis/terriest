// The real-time sources the match glue takes (M3's design §0, §1.23, M3-Q5;
// PLAN D-31): a monotonic clock with its timers, and the page's visibility.
// src/ui/game.ts and src/ui/practice.ts run their timeline timer and their
// stall and visibility rules on these, so their Node tests drive them with
// clock-testing.ts's fakes in virtual time instead (C-6). New at M3: roslambo's
// game glue called performance.now, setInterval and document itself.

export interface Clock {
  /** ms, monotonic. */
  now(): number;
  /** fn every ms, the first ms from now; returns its cancel. */
  every(ms: number, fn: () => void): () => void;
  /** fn once, ms from now; returns its cancel. */
  after(ms: number, fn: () => void): () => void;
}

export interface PageEvents {
  /** Not visible: a background tab, a minimised window, a locked phone (D-31). */
  hidden(): boolean;
  /** fn on each change of visibility; returns its removal. */
  onVisibility(fn: () => void): () => void;
}

/** performance.now, setInterval and setTimeout. */
export const browserClock: Clock = {
  now: () => performance.now(),
  every: (ms, fn) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
  after: (ms, fn) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

/** document.visibilityState and visibilitychange. Anything but visible is hidden, as roslambo read it. */
export const browserPage: PageEvents = {
  hidden: () => document.visibilityState !== 'visible',
  onVisibility: (fn) => {
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  },
};
