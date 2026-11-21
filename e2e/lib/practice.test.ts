import { describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import type { CorrectionFigures } from '../../src/core/session/index';
import { readoutLines, readoutText, REPAIR_SIZES_CAPTION, SIZES_CAPTION, sizeLines } from '../../src/ui/screens/readout';
import { quantiles, summaryOf } from '../../src/ui/screens/readout-testing';
import { copiedFrom, HOLD, holdProblems, kickoffWhistles, LATEST_START_TICKS, type Period, type ReadoutSeen, RELEASE_LATITUDE } from './practice';

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

// The kickoff whistles a match's sound must have decided by its end (M4's design §7; e2e/lib/practice.ts'
// kickoffWhistles): one at each start of play; every countdown's but the last's certain, a goal having ended
// its play; the last's none when the end came at its play's first tick, certain when its play outlasted the
// most ticks a timer run can move the head, and either way when shorter.
describe('the kickoff whistles a whole match decided (§7)', () => {
  const periods = [
    { countdown: 605, countdownTicks: 300 }, { countdown: 1415, countdownTicks: 180 }, { countdown: 2100, countdownTicks: 180 },
  ] as const;
  const play = 2100 + 180;

  it('counts every start of play, the last too when its play outlasts a timer run', () => {
    expect(kickoffWhistles([], 0, 50)).toEqual({ min: 0, max: 0 });
    expect(kickoffWhistles(periods.slice(0, 1), 905 + 3600, 50)).toEqual({ min: 1, max: 1 });
    // 50 ms is 3 ticks, so a run moves the head 4 at the most.
    expect(kickoffWhistles(periods, play + 4, 50)).toEqual({ min: 3, max: 3 });
    expect(kickoffWhistles(periods, play + 600, 250)).toEqual({ min: 3, max: 3 });
  });

  it('counts none for a last kickoff whose play never came, the end at its first tick', () => {
    expect(kickoffWhistles(periods, play, 50)).toEqual({ min: 2, max: 2 });
  });

  it('allows either for a last play shorter than a timer run can move the head', () => {
    expect(kickoffWhistles(periods, play + 1, 50)).toEqual({ min: 2, max: 3 });
    expect(kickoffWhistles(periods, play + 3, 50)).toEqual({ min: 2, max: 3 });
    // 250 ms is 15 ticks: a 15-tick play may pass between two runs.
    expect(kickoffWhistles(periods, play + 15, 250)).toEqual({ min: 2, max: 3 });
    expect(kickoffWhistles(periods, play + 16, 250)).toEqual({ min: 3, max: 3 });
  });
});

// What Copy put on the clipboard, rebuilt from the figures Results drew (M4's design §5.9, §9.5; M3-Q24;
// e2e/lib/practice.ts' copiedFrom): the page's own text for the same summary, Practice's and a match with
// others', a repair's sizes among the latter's, so the spec's check follows src/ui/screens/readout.ts.
describe('the copied figures (§5.9)', () => {
  const s = summaryOf({
    ticks: 3600, remoteInputs: 7200, late: 12, lateAbsent: 1, rollbacks: 40, corrections: 31, resyncs: 2, resyncFailed: 1,
    ball: quantiles(30, 2, 0.0123, 0.217, 1.2), remote: quantiles(60, 10, 0.0694, 0.25, 3), own: quantiles(30, 30, 0, 0, 0), headings: quantiles(60, 5, 2.5, 56.3, 120),
    repair: { count: 1, ball: quantiles(1, 0, 0.5, 0.5, 0.5), remote: quantiles(2, 1, 0.75, 0.75, 0.75), own: quantiles(1, 1, 0, 0, 0), headings: quantiles(2, 0, 10, 12, 12) },
  });
  /** The figures as Results draws them for `s`, from the panel's own parts, in readoutSeen's shape. */
  const drawn = (practice: boolean): ReadoutSeen => {
    const rows = (f: CorrectionFigures): string[][] => sizeLines(f).map((z) => [z.label, z.moved, z.p50, z.p95, z.max]);
    return {
      lines: readoutLines(s, practice).map((l) => ({ test: l.test, label: l.label, value: l.value })),
      tables: [
        { test: 'readout-sizes', caption: SIZES_CAPTION, rows: rows(s) },
        ...(practice ? [] : [{ test: 'readout-repair-sizes', caption: REPAIR_SIZES_CAPTION, rows: rows(s.repair) }]),
      ],
      note: '', copy: 'idle', status: '', statusInView: false,
    };
  };

  it("is the page's own text for the figures drawn, Practice's and a match with others'", () => {
    for (const practice of [true, false]) expect(copiedFrom(drawn(practice), practice), practice ? 'Practice' : 'networked').toBe(readoutText(s, practice));
  });
});
