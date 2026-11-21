import { describe, expect, it } from 'vitest';
import { netSettings } from '../session/settings';
import { defaultParams } from '../sim';
import { PHASE_CAP } from './clock';
import { at, tickOf } from './testing';
import { Timeline } from './timeline';

// The clock's two counters in the timeline's stats (M4's design, research/m4/DESIGN.md, §1.40, §8.4's
// run 4; PLAN D-15): every direct TICK the clock takes as a sample is counted in clockSamples, and every
// one its freeze rule drops, held for this page through a freeze of its timers (M3 phase 5), in
// clockSamplesDropped. A forwarded TICK is no sample, nor one taken while paused or sent catching up,
// its phase at the cap: those are in neither. The bench reads them (src/frames.ts), as the hook will.

const NET = netSettings();
const D = NET.timeline.delay;
const W = NET.timeline.window;
const ME = 'a0'.padStart(32, '0');
const THEM = 'b0'.padStart(32, '0');
/** A freeze: a gap between timer runs longer than an input's time in flight, d + w ticks (TickClock). */
const FREEZE_MS = (D + W) * NET.tickMs;
const NONE = new Map<number, number>();

/** A started timeline for this page, its timer run every timerMs up to local tick n. */
function page(n: number): { t: Timeline; last: number } {
  const t = new Timeline({ ...NET.timeline, P: defaultParams, me: ME }, { broadcast: () => {}, sendToPlayer: () => false, sendToPeer: () => {} });
  t.start(0, { packSize: 1, matchMinutes: 1 }, 'feedfacecafebeef');
  let now = 0;
  for (; now <= at(n); now += NET.timerMs) t.advance(now);
  return { t, last: now - NET.timerMs };
}

/** Their TICK for the tick this page's clock is in, at now: on time, its phase a little into the tick. */
function theirs(t: Timeline, now: number, phase = 0.1): ReturnType<typeof tickOf> {
  return { ...tickOf(NONE, Math.floor(t.clock(now)) + D), phase };
}

const counts = (t: Timeline): [number, number] => [t.stats.clockSamples, t.stats.clockSamplesDropped];

describe("the clock's samples in the timeline's stats (§8.4's run 4, D-15)", () => {
  it('counts each direct TICK the clock takes, between timer runs on time, and no forwarded one', () => {
    const { t, last } = page(60);
    expect(counts(t)).toEqual([0, 0]);
    let now = last;
    for (let k = 0; k < 10; k++) {
      now += NET.timerMs;
      t.advance(now);
      t.onTick(THEM, theirs(t, now + 1), now + 1, true);
    }
    expect(counts(t)).toEqual([10, 0]);
    // A FWD's TICK is no clock sample: its forwarder's timing, not its origin's (§4.10).
    t.onTick(THEM, theirs(t, now + 2), now + 2, false);
    expect(counts(t)).toEqual([10, 0]);
  });

  it("counts those the freeze rule drops: handled once the timer is d + w ticks overdue, and after the freeze's late run until the next", () => {
    const { t, last } = page(60);
    // The page's timers stop, as a long frame or a frozen page stops them: a TICK handled before d + w
    // ticks have passed is still a sample, one handled after is held.
    t.onTick(THEM, theirs(t, last + FREEZE_MS - 1), last + FREEZE_MS - 1, true);
    expect(counts(t)).toEqual([1, 0]);
    t.onTick(THEM, theirs(t, last + FREEZE_MS + 1), last + FREEZE_MS + 1, true);
    t.onTick(THEM, theirs(t, last + FREEZE_MS + 50), last + FREEZE_MS + 50, true);
    expect(counts(t)).toEqual([1, 2]);
    // The freeze's late run, a page whose timer runs first: the TICKs it then takes were held as long.
    const late = last + 600;
    t.advance(late);
    t.onTick(THEM, theirs(t, late + 1), late + 1, true);
    expect(counts(t)).toEqual([1, 3]);
    // The next run on time ends it: samples again.
    t.advance(late + NET.timerMs);
    t.onTick(THEM, theirs(t, late + NET.timerMs + 1), late + NET.timerMs + 1, true);
    expect(counts(t)).toEqual([2, 3]);
    // A gap after a gap isn't a freeze (TickClock.ran): a hidden page's second wake takes its samples.
    t.advance(late + NET.timerMs + 1000);
    t.advance(late + NET.timerMs + 2000);
    t.onTick(THEM, theirs(t, late + NET.timerMs + 2001), late + NET.timerMs + 2001, true);
    expect(counts(t)).toEqual([3, 3]);
  });

  it('counts in neither a TICK refused for another reason: paused, or sent catching up at the phase cap', () => {
    const { t, last } = page(60);
    // Sent catching up after its sender's stall: no sample, and not the freeze rule's.
    t.onTick(THEM, theirs(t, last + 1, PHASE_CAP), last + 1, true);
    expect(counts(t)).toEqual([0, 0]);
    // Paused (Practice's pause, §4.12's deciding): a reading that doesn't move takes none, held or not.
    t.pause(last + 2);
    t.onTick(THEM, theirs(t, last + 3), last + 3, true);
    t.onTick(THEM, theirs(t, last + FREEZE_MS + 10), last + FREEZE_MS + 10, true);
    expect(counts(t)).toEqual([0, 0]);
  });
});
