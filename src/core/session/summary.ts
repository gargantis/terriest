// A match's network summary on a real page (M3's design §1.16, §9.3, §9.4,
// M3-Q24; PLAN §17's M5 logging, through M4's readout): the timeline's late
// inputs against the inputs received, rollbacks and resyncs, and the
// corrections' sizes, a repair's apart, as p50, p95 and max from fixed
// log-spaced bins, so a long match keeps no list. Also the one definition of
// a correction's size, which the correction measurement uses too (design
// §9.3). New at M3. Pure: fed by the timeline's onCorrection.

import { angleDiff, type Body, findTerrier, TURN } from '../sim';
import type { Correction, TimelineStats } from '../timeline/timeline';

/** One body's change: metres in 3D, and a terrier's heading in degrees, the shorter way round. */
export interface BodyChange {
  readonly metres: number;
  readonly degrees: number;
}

export interface CorrectionSizes {
  readonly ball: number; // m, 3D
  readonly ballFlat: number; // m, horizontal
  readonly remote: readonly BodyChange[]; // each other terrier in both states, in the corrected state's order
  readonly own: BodyChange | null; // this browser's player's terrier, if in both
}

const metresApart = (a: Readonly<Body>, b: Readonly<Body>): number => {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const DEGREES_PER_UNIT = 360 / TURN; // not a setting: A.1's binary angle, 2^32 units a turn

/** Position changes in 3D; heading changes the shorter way round, in degrees (design §9.3). A terrier
 *  in only one of the two states, one a correction moved a JOIN or a LEAVE for, has no size. A bot
 *  this browser hosts counts as remote: own is its player's terrier, the one ownSmoothingMs glides. */
export function correctionSizes(c: Correction, me: string): CorrectionSizes {
  const a = c.before.ball;
  const b = c.after.ball;
  const dx = b.x - a.x, dy = b.y - a.y;
  const remote: BodyChange[] = [];
  let own: BodyChange | null = null;
  for (const T of c.after.terriers) {
    const k = findTerrier(c.before, T.id);
    if (k < 0) continue;
    const U = c.before.terriers[k]!;
    const change = { metres: metresApart(U, T), degrees: Math.abs(angleDiff(U.heading, T.heading)) * DEGREES_PER_UNIT };
    if (T.id === me) own = change;
    else remote.push(change);
  }
  return { ball: metresApart(a, b), ballFlat: Math.sqrt(dx * dx + dy * dy), remote, own };
}

/** count samples, zero of them exactly 0; p50, p95 and max over the rest, the ones that moved, as
 *  design §9.4 reports them; all 0 when none moved. */
export interface Quantiles {
  readonly count: number;
  readonly zero: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

// The bins: 20 a decade from 1 µm (or 1e-6 of a degree) to 1 km, about ±6% about each bin's
// geometric middle, an open bin below and one above (M3-Q24). Sizes on the pitch are under 60 m,
// and headings at most 180°.
const LOWEST = 1e-6; // not a setting: the bins' scale
const PER_DECADE = 20; // not a setting: the bins' scale
const DECADES = 9; // not a setting: the bins' scale
const BIN_COUNT = PER_DECADE * DECADES + 2;

/** Positive samples counted in fixed log-spaced bins, zeros apart, with the exact maximum: the memory
 *  is the same however many are added. A percentile is the nearest rank's bin, at its geometric
 *  middle, kept inside the smallest and largest samples. */
export class LogBins {
  private readonly bins = new Float64Array(BIN_COUNT);
  private count = 0;
  private zeros = 0;
  private least = Infinity;
  private most = 0;

  /** A size: 0 counts as a zero, and anything not a number at or above 0 is ignored. */
  add(v: number): void {
    if (!(v >= 0)) return;
    this.count++;
    if (v === 0) {
      this.zeros++;
      return;
    }
    if (v < this.least) this.least = v;
    if (v > this.most) this.most = v;
    const k = Math.floor(Math.log10(v / LOWEST) * PER_DECADE) + 1;
    this.bins[k < 0 ? 0 : k >= BIN_COUNT ? BIN_COUNT - 1 : k]!++;
  }

  quantiles(): Quantiles {
    const moved = this.count - this.zeros;
    if (moved === 0) return { count: this.count, zero: this.zeros, p50: 0, p95: 0, max: 0 };
    return { count: this.count, zero: this.zeros, p50: this.percentile(moved, 50), p95: this.percentile(moved, 95), max: this.most };
  }

  /** The pct-th percentile of the moved samples by nearest rank: ⌈moved × pct / 100⌉. */
  private percentile(moved: number, pct: number): number {
    const rank = Math.max(1, Math.ceil((moved * pct) / 100));
    let seen = 0;
    let k = 0;
    while (k < BIN_COUNT - 1) {
      seen += this.bins[k]!;
      if (seen >= rank) break;
      k++;
    }
    const middle = LOWEST * 10 ** ((k - 0.5) / PER_DECADE);
    return middle < this.least ? this.least : middle > this.most ? this.most : middle;
  }
}

/** The sizes of a set of corrections, body by body (design §9.4). */
export interface CorrectionFigures {
  readonly ball: Quantiles; // m, 3D
  readonly remote: Quantiles; // m, each other terrier's position
  readonly own: Quantiles; // m, this browser's player's terrier
  readonly headings: Quantiles; // degrees, each other terrier's heading
}

/** A repair's corrections, apart (design §9.4): how many, and their sizes. */
export interface RepairFigures extends CorrectionFigures {
  readonly count: number;
}

export interface MatchNetSummary extends CorrectionFigures {
  readonly ticks: number; // final ticks this timeline took: reused and stepped, a repair's again
  /** The inputs received from others, each TICK's own and each bot entry's, direct or forwarded, as
   *  late and lateAbsent count them, so each over this is a share of the inputs (design §1.16,
   *  TimelineStats' receivedInputs, reviewer SUM-1). */
  readonly remoteInputs: number;
  readonly late: number;
  readonly lateAbsent: number;
  readonly lateBy: readonly number[];
  readonly rollbacks: number;
  readonly corrections: number; // every correction the timeline fired, a repair's included
  readonly resyncs: number;
  readonly resyncFailed: number;
  // ball, remote, own and headings: the corrections that weren't a repair's, design §9.4's decisive
  // figures. A repair's are governed by w and the losses, which resyncs counts, and are kept apart:
  readonly repair: RepairFigures;
}

/** One set of corrections' bins, body by body. */
class Figures {
  count = 0;
  private readonly ball = new LogBins();
  private readonly remote = new LogBins();
  private readonly own = new LogBins();
  private readonly headings = new LogBins();

  add(s: CorrectionSizes): void {
    this.count++;
    this.ball.add(s.ball);
    for (const r of s.remote) {
      this.remote.add(r.metres);
      this.headings.add(r.degrees);
    }
    if (s.own !== null) this.own.add(s.own.metres);
  }

  figures(): CorrectionFigures {
    return { ball: this.ball.quantiles(), remote: this.remote.quantiles(), own: this.own.quantiles(), headings: this.headings.quantiles() };
  }
}

/** Fed by onCorrection; percentiles from fixed log-spaced bins, so a long match keeps no list. It
 *  keeps nothing of a correction but its sizes, so the states it is handed may change after. A
 *  repair's corrections go to bins of their own, for M5 (M3 phase 4's fixes, reviewer SUM-1). */
export class SummaryBuilder {
  private readonly me: string;
  private readonly predicted = new Figures();
  private readonly repaired = new Figures();

  constructor(me: string) {
    this.me = me;
  }

  add(c: Correction): void {
    (c.repair ? this.repaired : this.predicted).add(correctionSizes(c, this.me));
  }

  summary(stats: TimelineStats): MatchNetSummary {
    return {
      ticks: stats.reusedFinals + stats.steppedFinals,
      remoteInputs: stats.receivedInputs,
      late: stats.late,
      lateAbsent: stats.lateAbsent,
      lateBy: [...stats.lateBy],
      rollbacks: stats.rollbacks,
      corrections: stats.corrections,
      resyncs: stats.resyncs,
      resyncFailed: stats.resyncFailed,
      ...this.predicted.figures(),
      repair: { count: this.repaired.count, ...this.repaired.figures() },
    };
  }
}
