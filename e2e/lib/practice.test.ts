import { describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import { HOLD, holdProblems, LATEST_START_TICKS, type Period, RELEASE_LATITUDE } from './practice';

// The Practice spec's check of what the person played (M4's design §9.1,
// §9.5; e2e/lib/practice.ts' holdProblems), by the rules the Node replays
// validated (src/net/practice-spec-testing.ts' expectHoldsAsPlayed): each
// period's span from d + 1 ticks into its countdown to LATEST_START_TICKS
// before its end, unless one is held still; its let-go from a second of
// play and d ticks to RELEASE_LATITUDE later; A's step and frame alone;
// held through a goal that comes first; and a last span counted as held to
// the confirmed end, which a validated let-go covers only by the latest.

const D = config.inputDelayTicks;
const SECOND = config.ticksPerSecond;
const span = (from: number, to: number | null, s: { step: number; frame: number } = HOLD) => ({ ...s, from, to });
/** The start countdown from c, 300 ticks; its play from c + 300; released at a second of play, or not. */
const start = (c: number, released: boolean): Period =>
  ({ kind: 'start', countdown: c, countdownTicks: 300, play: c + 300, pressedAt: c + 1, releasedAt: released ? c + 300 + SECOND : null });
/** A kickoff's countdown from c, 180 ticks; A pressed at it, or still held from before. */
const kickoff = (c: number, released: boolean, pressed = true): Period =>
  ({ kind: 'kickoff', countdown: c, countdownTicks: 180, play: c + 180, pressedAt: pressed ? c : null, releasedAt: released ? c + 180 + SECOND : null });

// The start countdown at 605: its first input 605 + 1 + d; play at 905; the let-go validated from a second of
// play and d ticks on to RELEASE_LATITUDE later.
const C = 605;
const FIRST = C + 1 + D;
const LO = C + 300 + SECOND + D;
const HI = LO + RELEASE_LATITUDE;
const LATEST = C + 300 - LATEST_START_TICKS + 1 + D;

describe("the Practice spec's holds (M4's design §9.1)", () => {
  it('passes what the replays validate: the earliest and latest starts and let-goes, and a kickoff', () => {
    expect(holdProblems([span(FIRST, LO)], [start(C, true)])).toEqual([]);
    expect(holdProblems([span(LATEST, HI)], [start(C, true)])).toEqual([]);
    const K = 1415;
    expect(holdProblems([span(FIRST, LO), span(K + 180 - LATEST_START_TICKS + 1 + D, K + 180 + SECOND + D)], [start(C, true), kickoff(K, true)])).toEqual([]);
  });

  it('fails a span begun or let go outside them, another step or frame, a stray, and a countdown with none', () => {
    expect(holdProblems([span(FIRST, HI + 1)], [start(C, true)])).toHaveLength(1);
    expect(holdProblems([span(FIRST, LO - 1)], [start(C, true)])).toHaveLength(1);
    expect(holdProblems([span(FIRST - 1, LO)], [start(C, true)])).toHaveLength(1);
    expect(holdProblems([span(LATEST + 1, LO)], [start(C, true)])).toHaveLength(1);
    expect(holdProblems([span(FIRST, LO, { step: HOLD.step - 4, frame: HOLD.frame })], [start(C, true)])).toHaveLength(1);
    expect(holdProblems([span(FIRST, LO, { step: HOLD.step, frame: 1 - HOLD.frame })], [start(C, true)])).toHaveLength(1);
    expect(holdProblems([span(FIRST, LO), span(1000, 1003)], [start(C, true)])).toHaveLength(1);
    expect(holdProblems([], [start(C, true)])).toHaveLength(1);
  });

  it('carries a hold through a goal that comes before its let-go, into the next countdown', () => {
    const K = 1415;
    const release = K + 180 + SECOND + D;
    expect(holdProblems([span(FIRST, release)], [start(C, false), kickoff(K, true, false)])).toEqual([]);
    expect(holdProblems([span(FIRST, release + RELEASE_LATITUDE + 1)], [start(C, false), kickoff(K, true, false)])).toHaveLength(1);
  });

  it('counts a last span as held to the confirmed end, which a validated let-go covers only by the latest', () => {
    const periods = [start(C, true)];
    // The end a tick after the let-go's look: open at the last look, or sampled past the end.
    expect(holdProblems([span(FIRST, null)], periods, LO - 1)).toEqual([]);
    expect(holdProblems([span(FIRST, LO + 3)], periods, LO - 1)).toEqual([]);
    expect(holdProblems([span(FIRST, null)], periods, HI)).toEqual([]);
    expect(holdProblems([span(FIRST, null)], periods, HI + 1)).toHaveLength(1);
    expect(holdProblems([span(FIRST, HI + 40)], periods, HI + 1)).toHaveLength(1);
    // A span closed before the end is checked as ever.
    expect(holdProblems([span(FIRST, LO - 1)], periods, HI + 1)).toHaveLength(1);
    expect(holdProblems([span(FIRST, LO)], periods, HI + 1)).toEqual([]);
    // Only the last period's: an open span before it is a failure, whenever the end came.
    const K = 1415;
    const two = [start(C, true), kickoff(K, true)];
    expect(holdProblems([span(FIRST, null), span(K + 3 + D, K + 240 + D)], two, 1700)).toHaveLength(1);
    expect(holdProblems([span(FIRST, null), span(K + 3 + D, K + 240 + D)], two, 1000)).toHaveLength(1);
    // And with no end, an open span is a failure.
    expect(holdProblems([span(FIRST, null)], periods)).toHaveLength(1);
  });
});
