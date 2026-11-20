// The load run's backlog watch (M3's design, research/m3/DESIGN.md, §8.5;
// e2e/load.run.ts): from the reports the run polls every 2 s of its play,
// each receiver's backlog of TICKs in seconds of its senders' output, so a
// run that fails says whether the rig's message path fell behind before any
// input came late. A TICK that waits in the path longer than (d + w) ×
// tickMs reaches its receiver past the late window, so once a receiver's
// backlog passes that, its remote inputs come late whatever the protocol
// does, and its clock reads the others behind, as in M3's failed load runs
// (research/corrections/REPORT.md section 2.7). Pure: the run polls, this
// reads.
// - A sender's output to each other page over an interval is its TICKs
//   sent, which count a broadcast once for each connection it went out on
//   (src/ui/game.ts's counting link), over its peer count. A page that sent
//   none, such as a spectator without bots, is no sender. Only TICKs count:
//   a spectator's PEERS and STATE_REQs aren't output.
// - A receiver's backlog is what its senders sent it, less what it took,
//   summed over the intervals counted since the first poll: its growth,
//   not the counts' totals, so a constant skew between the pages' reports,
//   which come one page after another, cancels. It's in seconds of its
//   senders' output at tickMs a tick: over their TICKs to it a tick across
//   the same intervals, each sender's by its own local ticks. So it's how
//   long a TICK waits in the senders' ticks, which the late window counts,
//   and no report's time counts: the machine's clock, which the reports'
//   times read, stepped by over a second at a time in M3's last load runs.
//   A receiver no page sends to owes nothing.
// - It's each receiver's, summed over its senders: the series holds each
//   page's counts, not who sent what to whom, so one link alone behind shows
//   at its share: in the load run's room, a seventh of it at a player and an
//   eighth at a spectator. A link's own backlog needs counts by peer, which
//   the reports don't hold.
// - An interval counts only while the mesh is whole: no page's peer count
//   changed in it, and at its end every page has all the others as peers.
//   A broadcast's copies change with the peer count, a closed connection's
//   messages in flight never arrive, and the series holds each page's count,
//   not who is linked to whom, so only then can a receiver's TICKs be
//   matched to its senders'. The backlog carries over a skipped interval.
// - The onset is the first poll at which a receiver's backlog is past
//   (d + w) × tickMs, all three from netSettings; the late onset, the first
//   at which a page's late inputs have risen since the first poll. When the
//   backlog passed d + w no later than inputs came late, or none came late,
//   the rig's message path fell behind first: the machine's capacity rather
//   than the protocol's, which a failing run's message says (verdictOf).
//   When inputs came late before that, the message says how many, and
//   claims neither: a lateness before the backlog's can be the protocol's, a
//   cold start's transient, or a receiver's clock running ahead of its
//   senders', which takes their inputs late before its backlog reaches
//   d + w; and one already in the first interval may have begun before the
//   play measured, which the polls don't see. With no interval read, the
//   verdict says so, and claims neither.

import { T } from '../../src/core/protocol/messages';
import { type NetSettings, netSettings } from '../../src/core/session/settings';
import type { NetReport } from '../../src/nettest-params';

const MS_PER_SECOND = 1000; // not a setting

/** One page at one poll, from its report (src/nettest-params.ts's NetReport). */
export interface PolledPage {
  /** ms from the measured play's start to the page's report, by the page's clock, which is the
   *  machine's, as Node's: for the record, since that clock can step, and no rate is read from it. */
  readonly ms: number;
  /** TICKs sent, a broadcast counted once for each connection it went out on, and TICKs received
   *  (traffic.byType), over the page's whole run. */
  readonly ticksSent: number;
  readonly ticksReceived: number;
  readonly peers: number;
  /** The page's local tick, by which its rate as a sender is read, and its final tick. */
  readonly localTick: number;
  readonly finalTick: number;
  /** Late inputs and clock jumps (stats), over the page's whole run. */
  readonly late: number;
  readonly jumps: number;
}

/** Every page's figures at one poll, and the machine's load. */
export interface Poll {
  /** ms from the measured play's start to the poll's start, by Node's clock. */
  readonly ms: number;
  /** os.loadavg() at the poll's start: the 1-, 5- and 15-minute loads. */
  readonly load: readonly number[];
  /** By page, in the run's order. */
  readonly pages: readonly PolledPage[];
}

/** What polledPage reads of a page's report. */
export type Reported = Pick<NetReport, 'peers' | 'localTick' | 'finalTick' | 'traffic'> & {
  readonly stats: Pick<NetReport['stats'], 'late' | 'jumps'>;
};

/** A page's figures from its report, made `ms` after the measured play's start: its TICKs alone,
 *  none when it has neither sent nor taken one. */
export function polledPage(ms: number, r: Reported): PolledPage {
  const ticks = r.traffic.byType[T.TICK];
  return {
    ms, ticksSent: ticks?.sent ?? 0, ticksReceived: ticks?.received ?? 0, peers: r.peers,
    localTick: r.localTick, finalTick: r.finalTick, late: r.stats.late, jumps: r.stats.jumps,
  };
}

/** A receiver's backlog at a poll. */
export interface BacklogAt {
  readonly poll: number;
  /** The poll's ms from the measured play's start. */
  readonly ms: number;
  readonly page: number;
  /** In seconds of its senders' output. */
  readonly seconds: number;
}

export interface Backlog {
  /** (d + w) × tickMs, in seconds. */
  readonly limitSeconds: number;
  /** Each receiver's backlog at each poll, in seconds of its senders' output, by poll, then page: 0
   *  at the first poll. */
  readonly seconds: readonly (readonly number[])[];
  /** Each page's largest. */
  readonly largest: readonly number[];
  /** The polls that end an interval left out, the mesh not whole through it. */
  readonly skipped: readonly number[];
  /** The largest backlog of any receiver at any poll; null with no poll. */
  readonly max: BacklogAt | null;
  /** The first poll at which a receiver's backlog is past the limit, and the largest then; null if
   *  none is. */
  readonly onset: BacklogAt | null;
  /** The room's late inputs since the first poll, by poll: 0 at the first. */
  readonly late: readonly number[];
  /** The first poll at which a page's late inputs have risen since the first poll, and by how many
   *  in all then; null if none has. */
  readonly lateOnset: { readonly poll: number; readonly ms: number; readonly late: number } | null;
}

const whole = (p: Poll): boolean => p.pages.every((x) => x.peers === p.pages.length - 1);
/** Whether the interval from a to b counts: no page's peer count changed, and the mesh is whole at
 *  its end. */
const counted = (a: Poll, b: Poll): boolean => a.pages.every((x, k) => x.peers === b.pages[k]!.peers) && whole(b);

/** The backlog watch over a run's series of polls, every poll with the same pages in the same order
 *  (above). */
export function backlogOf(series: readonly Poll[], net: NetSettings = netSettings()): Backlog {
  const limitSeconds = ((net.timeline.delay + net.timeline.window) * net.tickMs) / MS_PER_SECOND;
  const tickSeconds = net.tickMs / MS_PER_SECOND;
  const n = series[0]?.pages.length ?? 0;
  for (const [i, p] of series.entries()) {
    if (p.pages.length !== n) throw new Error(`poll ${i} has ${p.pages.length} pages, the first ${n}`);
  }
  const owed = Array.from({ length: n }, () => 0); // by receiver: TICKs its senders sent it less those it took
  const output = Array.from({ length: n }, () => 0); // by sender: TICKs it sent each other page
  const spentTicks = Array.from({ length: n }, () => 0); // by sender: its own ticks over which it sent them
  /** The interval from a to b, counted. */
  const count = (a: Poll, b: Poll): void => {
    const out = b.pages.map((p, k) => (p.peers > 0 ? (p.ticksSent - a.pages[k]!.ticksSent) / p.peers : 0));
    const all = out.reduce((x, y) => x + y, 0);
    for (const [k, p] of b.pages.entries()) {
      const q = a.pages[k]!;
      owed[k]! += all - out[k]! - (p.ticksReceived - q.ticksReceived);
      output[k]! += out[k]!;
      spentTicks[k]! += p.localTick - q.localTick;
    }
  };
  const seconds: number[][] = [];
  const skipped: number[] = [];
  for (const [i, poll] of series.entries()) {
    const before = series[i - 1];
    if (before !== undefined) {
      if (counted(before, poll)) count(before, poll);
      else skipped.push(i);
    }
    seconds.push(owed.map((m, r) => {
      let perTick = 0; // its senders' TICKs to it a tick, each by its own ticks
      for (let s = 0; s < n; s++) if (s !== r && spentTicks[s]! > 0) perTick += output[s]! / spentTicks[s]!;
      return perTick > 0 ? (m / perTick) * tickSeconds : 0;
    }));
  }

  let max: BacklogAt | null = null;
  let onset: BacklogAt | null = null;
  for (const [i, row] of seconds.entries()) {
    const ms = series[i]!.ms;
    let top: BacklogAt | null = null;
    for (const [page, x] of row.entries()) if (top === null || x > top.seconds) top = { poll: i, ms, page, seconds: x };
    if (top === null) continue;
    if (max === null || top.seconds > max.seconds) max = top;
    if (onset === null && top.seconds > limitSeconds) onset = top;
  }
  const lateAtFirst = series[0]?.pages.map((p) => p.late) ?? [];
  const late = series.map((poll) => poll.pages.reduce((a, p, k) => a + Math.max(0, p.late - lateAtFirst[k]!), 0));
  const first = late.findIndex((x) => x > 0);
  const lateOnset = first < 0 ? null : { poll: first, ms: series[first]!.ms, late: late[first]! };
  const largest = Array.from({ length: n }, (_, k) => Math.max(...seconds.map((row) => row[k]!)));
  return { limitSeconds, seconds, largest, skipped, max, onset, late, lateOnset };
}

/** What a run's backlog says of a failure: capacity when the rig's message path fell past d + w no
 *  later than the first poll that showed a late input, or with none late. */
export interface Verdict {
  readonly capacity: boolean;
  readonly text: string;
}

const secondsText = (ms: number): string => (ms / MS_PER_SECOND).toFixed(1);

/** What a failing run's message starts with (e2e/load.run.ts): the capacity verdict; or that inputs
 *  came late before the path fell behind, how many, and that the watch can't tell which failed
 *  first; or that the path kept up; or that it wasn't read, the mesh never whole through an
 *  interval. */
export function verdictOf(b: Backlog): Verdict {
  const limit = `d + w (${b.limitSeconds.toFixed(3)} s)`;
  const largest = b.max === null ? '' : ` Its largest backlog: ${b.max.seconds.toFixed(2)} s, page ${b.max.page}'s at ${secondsText(b.max.ms)} s.`;
  const { onset, lateOnset } = b;
  const intervals = Math.max(0, b.seconds.length - 1);
  const read = intervals - b.skipped.length;
  if (read === 0) return { capacity: false, text: "The rig's message path wasn't read: no interval of the play measured had the mesh whole." };
  if (onset === null) {
    const some = b.skipped.length > 0 ? ` in the ${read} of ${intervals} intervals with the mesh whole` : '';
    return { capacity: false, text: `The rig's message path kept up: no receiver's backlog, summed over its senders, passed ${limit}${some}.${largest}` };
  }
  const fell = `The rig's message path fell ${onset.seconds.toFixed(2)} s behind at ${secondsText(onset.ms)} s into the play (the TICKs to page ${onset.page}), past ${limit}`;
  if (lateOnset !== null && lateOnset.poll < onset.poll) {
    const before = b.late[onset.poll - 1]!;
    const inputs = `${before} input${before === 1 ? '' : 's'}`;
    const from = lateOnset.poll === 1 ? "from the play's first interval, so perhaps from before it" : `from ${secondsText(lateOnset.ms)} s`;
    return { capacity: false, text: `${fell}, but ${inputs} had come late before that, ${from}: the watch can't tell the machine's capacity from the protocol's.${largest}` };
  }
  const late = lateOnset === null ? 'with no input late' : `no later than the first poll that showed a late input, at ${secondsText(lateOnset.ms)} s`;
  return { capacity: true, text: `${fell}, ${late}: the machine's capacity rather than the protocol's.${largest}` };
}
