import { describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import { T } from '../../src/core/protocol/messages';
import { netSettings } from '../../src/core/session/settings';
import { type Backlog, backlogOf, type Poll, polledPage, type Reported, verdictOf } from './backlog';

// The load run's backlog watch (dev/load/backlog.ts), in the gate, on
// synthetic rooms: every player sends a TICK each tick, a broadcast to every
// page it's linked to, from well before the first poll, each player's ticks
// a fraction of a tick out of step with the others', and each copy reaches
// its receiver after its lag; the run's reports are counts of those sends
// and arrivals, read every 2 s, each page at its own moment. Each case fails
// with its rule planted out: a growing lag (the backlog summed over the
// intervals, in seconds of the senders' output, and the onset past d + w); a
// lag that rises and falls (each page's largest and the run's, not the last
// poll's); a step in the machine's clock (each sender's rate by its own
// ticks, not the reports' times); a constant read skew (the growth since the
// first poll, not the counts' totals); spectators that send nothing (only
// TICKs are output, and a page no one sends to owes nothing); one link
// behind alone (a receiver's backlog is summed over its senders); a peer
// count that changes (the interval skipped, and those that end with the mesh
// not whole) under a growing lag (the backlog carried over the skip); and
// the verdict (the backlog's onset no later than the first poll that shows a
// late input, counted from the first poll; inputs late first, counted to the
// poll before the onset, and those from the first interval; and nothing read
// when no interval had the mesh whole).

const net = netSettings();
/** (d + w) × tickMs in seconds, from the configuration, as the watch reads it. */
const LIMIT = ((net.timeline.delay + net.timeline.window) * net.tickMs) / 1000;
const RATE = config.ticksPerSecond; // a player's TICKs a second
const TICK_S = 1 / RATE;
const POLL_S = 2; // the load run's poll period
const BEFORE_S = 40; // play before the first poll, so a page's counts aren't the measured play's alone
/** One TICK of seven senders' output: each sender's count in flight is whole, but seven or eight
 *  senders out of step with each other round apart, so the room's comes within one TICK of the
 *  model's (the worst here is about half of one). */
const ROUNDING = TICK_S / 7;

interface Room {
  readonly players: number;
  readonly spectators: number;
  /** Polls at 0, POLL_S, 2·POLL_S, … s into the play measured. */
  readonly polls: number;
  /** Seconds a TICK sent at t by page s takes to reach page r: none by default. */
  readonly lag?: (r: number, t: number, s: number) => number;
  /** Seconds after a poll's start at which page k's report is made: none by default. */
  readonly skew?: (k: number) => number;
  /** Whether pages a and b are linked at t: always by default. */
  readonly linked?: (a: number, b: number, t: number) => boolean;
  /** Page k's late inputs by t: none by default. */
  readonly late?: (k: number, t: number) => number;
}

/** A room's series, the players being its first pages and the spectators, which send nothing, the rest. */
function seriesOf(room: Room): Poll[] {
  const n = room.players + room.spectators;
  const { lag = () => 0, skew = () => 0, linked = () => true, late = () => 0 } = room;
  const endS = (room.polls - 1) * POLL_S + 1;
  const sent: number[][] = Array.from({ length: n }, () => []); // by sender, each copy's time
  const arrived: number[][] = Array.from({ length: n }, () => []); // by receiver
  for (let s = 0; s < room.players; s++) {
    for (let m = 0; ; m++) {
      const t = -BEFORE_S + (m + (s + 0.5) / room.players) * TICK_S;
      if (t > endS) break;
      for (let r = 0; r < n; r++) {
        if (r === s || !linked(s, r, t)) continue;
        sent[s]!.push(t);
        arrived[r]!.push(t + lag(r, t, s));
      }
    }
  }
  for (const times of [...sent, ...arrived]) times.sort((x, y) => x - y);
  /** How many of the sorted times are at or before t. */
  const upTo = (times: readonly number[], t: number): number => {
    let lo = 0;
    for (let hi = times.length; lo < hi;) {
      const mid = (lo + hi) >> 1;
      if (times[mid]! <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const peers = (k: number, t: number): number => Array.from({ length: n }, (_, j) => j !== k && linked(k, j, t)).filter(Boolean).length;
  return Array.from({ length: room.polls }, (_, i) => ({
    ms: i * POLL_S * 1000,
    load: [0.5, 0.4, 0.3],
    pages: Array.from({ length: n }, (_, k) => {
      const t = i * POLL_S + skew(k);
      const tick = Math.floor((t + BEFORE_S) * RATE);
      return {
        ms: t * 1000, ticksSent: upTo(sent[k]!, t), ticksReceived: upTo(arrived[k]!, t), peers: peers(k, t),
        localTick: tick, finalTick: tick - net.timeline.delay, late: late(k, t), jumps: 0,
      };
    }),
  }));
}

/** Each page's backlog at each poll, beside what it should be. */
function expectSeconds(seconds: readonly (readonly number[])[], want: (k: number, i: number) => number, within: number): void {
  for (const [i, row] of seconds.entries()) {
    for (const [k, x] of row.entries()) expect(Math.abs(x - want(k, i)), `page ${k} at poll ${i}: ${x} s`).toBeLessThanOrEqual(within);
  }
}

/** Page 3, a player among 8 with 4 spectators, takes its TICKs ever later from the first poll: one
 *  sent at t arrives g·t later, so at t its backlog is g·t / (1 + g) s of its senders' output, which
 *  passes d + w at 23 s, between the polls at 22 and 24 s, whatever d + w is. */
const GROWTH = LIMIT / (23 - LIMIT);
const growingLag: Room['lag'] = (r, t) => (r === 3 && t > 0 ? GROWTH * t : 0);
const growing = (late?: Room['late']): Poll[] => seriesOf({ players: 8, spectators: 4, polls: 16, lag: growingLag, ...(late ? { late } : {}) });
const grown = (k: number, i: number): number => (k === 3 ? (GROWTH * i * POLL_S) / (1 + GROWTH) : 0);
/** Pages 1 and 2, both players, lose their link at 9 s and have it again at 13 s. */
const cut = (a: number, b: number, t: number): boolean => a + b === 3 && a * b === 2 && t >= 9 && t < 13;

describe('the backlog watch (dev/load/backlog.ts)', () => {
  it('sizes a growing lag at every poll, summed over the intervals, and finds the first poll past d + w', () => {
    const b = backlogOf(growing());
    expectSeconds(b.seconds, grown, ROUNDING);
    expect(b.onset).toMatchObject({ poll: 12, ms: 24_000, page: 3 });
    expect(b.max).toMatchObject({ poll: 15, ms: 30_000, page: 3 });
    expect(Math.abs(b.max!.seconds - grown(3, 15))).toBeLessThanOrEqual(ROUNDING);
    for (const [k, x] of b.largest.entries()) expect(Math.abs(x - grown(k, 15)), `page ${k}'s largest`).toBeLessThanOrEqual(ROUNDING);
    expect([b.limitSeconds, b.skipped, b.lateOnset]).toEqual([LIMIT, [], null]);
  });

  it('keeps each page\'s largest backlog and the run\'s, not the last poll\'s, when a lag rises and falls', () => {
    // Page 3 takes its TICKs ever later until 16 s, then at once: at the poll at 16 s it's at its
    // most behind, and from the poll at 18 s it has taken every TICK sent it.
    const b = backlogOf(seriesOf({ players: 8, spectators: 4, polls: 12, lag: (r, t) => (r === 3 && t > 0 && t <= 16 ? GROWTH * t : 0) }));
    expectSeconds(b.seconds, (k, i) => (i <= 8 ? grown(k, i) : 0), ROUNDING);
    expect(b.max).toMatchObject({ poll: 8, ms: 16_000, page: 3 });
    for (const [k, x] of b.largest.entries()) expect(Math.abs(x - grown(k, 8)), `page ${k}'s largest`).toBeLessThanOrEqual(ROUNDING);
    expect(b.onset).toBeNull();
  });

  it("takes each sender's rate by its own ticks, so a step in the machine's clock changes nothing", () => {
    // From the poll at 14 s on, the machine's clock reads 1.36 s ahead, the poll's time and every
    // page's report time with it, as Hyper-V's time sync stepped it in M3's last load runs, while
    // every page ticks on.
    const STEP_MS = 1360;
    const stepped = growing().map((p, i) => (i < 7 ? p : { ...p, ms: p.ms + STEP_MS, pages: p.pages.map((x) => ({ ...x, ms: x.ms + STEP_MS })) }));
    const b = backlogOf(stepped);
    expect(b.seconds).toEqual(backlogOf(growing()).seconds);
    expectSeconds(b.seconds, grown, ROUNDING);
    expect(b.onset).toMatchObject({ poll: 12, ms: 24_000 + STEP_MS, page: 3 });
  });

  it('reads a constant skew between the pages\' reports as no backlog: the growth since the first poll, not the totals', () => {
    // Page 0's report comes at each poll's start and every other page's 0.32 to 0.52 s later, so
    // at every poll page 0's senders have sent it more than it has taken, about 0.38 s of their
    // output, and every other page has taken more from page 0 than it had sent: the same at every
    // poll, so none of it is backlog.
    const b = backlogOf(seriesOf({ players: 8, spectators: 4, polls: 11, skew: (k) => (k === 0 ? 0 : 0.3 + 0.02 * k) }));
    expectSeconds(b.seconds, () => 0, ROUNDING);
    expect([b.onset, b.skipped]).toEqual([null, []]);
  });

  it('counts no output from spectators, which send no TICKs, and nothing owed to a page no one sends to', () => {
    // One player and three spectators: the player hears from no page, so it owes nothing, and each
    // spectator hears from the player alone; page 2 takes its TICKs ever later.
    const b = backlogOf(seriesOf({ players: 1, spectators: 3, polls: 6, lag: (r, t) => (r === 2 && t > 0 ? 0.1 * t : 0) }));
    for (const [i, row] of b.seconds.entries()) expect(row[0], `the player at poll ${i}`).toBe(0);
    // One sender's count in flight is whole: within a TICK of its output.
    expectSeconds(b.seconds, (k, i) => (k === 2 ? (0.1 * i * POLL_S) / 1.1 : 0), TICK_S);
    expect(b.max).toMatchObject({ poll: 5, page: 2 });
    expect(b.onset).toMatchObject({ page: 2 });

    // A spectator's report: PEERS and a STATE_REQ sent, TICKs only taken.
    const count = (sent: number, received: number) => ({ sent, received, sentBytes: 30 * sent, receivedBytes: 30 * received });
    const page = { peers: 11, localTick: 5000, finalTick: 4998, stats: { late: 4, jumps: 1 } };
    const watcher: Reported = {
      ...page, traffic: { ...count(131, 20_875), byType: { [T.TICK]: count(0, 20_743), [T.PEERS]: count(130, 132), [T.STATE_REQ]: count(1, 0) } },
    };
    expect(polledPage(1500, watcher)).toEqual({ ms: 1500, ticksSent: 0, ticksReceived: 20_743, peers: 11, localTick: 5000, finalTick: 4998, late: 4, jumps: 1 });
    // A page that has neither sent nor taken a TICK has no row for them.
    const quiet: Reported = { ...page, traffic: { ...count(3, 3), byType: { [T.PEERS]: count(3, 3) } } };
    expect(polledPage(0, quiet)).toMatchObject({ ticksSent: 0, ticksReceived: 0 });
  });

  it("reads one link behind alone at its share of the receiver's backlog, summed over its senders", () => {
    // Every TICK page 1 sends page 3 from the first poll on comes 1 s late, past the late window,
    // and every other link's at once: page 3 has 7 senders, so it reads a seventh of a second
    // behind, under d + w, and the verdict says each receiver's backlog is summed.
    const b = backlogOf(seriesOf({ players: 8, spectators: 4, polls: 6, lag: (r, t, s) => (s === 1 && r === 3 && t > 0 ? 1 : 0) }));
    expectSeconds(b.seconds, (k, i) => (k === 3 && i > 0 ? 1 / 7 : 0), ROUNDING);
    expect(b.onset).toBeNull();
    expect(verdictOf(b).text).toContain("no receiver's backlog, summed over its senders, passed");
  });

  it("skips an interval in which a page's peer count changed, and one that ends with the mesh not whole", () => {
    // The intervals that end at the polls at 10 and 14 s are skipped for the counts that changed,
    // and the one that ends at 12 s for the mesh not whole, though no count changed in it.
    // Counted, each would read page 2 behind on page 1's TICKs it was never sent, and every other
    // page off on page 1's copies.
    const polls = seriesOf({ players: 8, spectators: 4, polls: 11, linked: (a, b, t) => !cut(a, b, t) });
    expect(polls.map((p) => p.pages[1]!.peers)).toEqual([11, 11, 11, 11, 11, 10, 10, 11, 11, 11, 11]);
    const b = backlogOf(polls);
    expectSeconds(b.seconds, () => 0, ROUNDING);
    expect([b.onset, b.skipped]).toEqual([null, [5, 6, 7]]);
    expect(verdictOf(b).text).toBe(
      `The rig's message path kept up: no receiver's backlog, summed over its senders, passed d + w (${LIMIT.toFixed(3)} s) in the 7 of 10 intervals with the mesh whole. Its largest backlog: 0.00 s, page 0's at 0.0 s.`,
    );
  });

  it('carries the backlog over the intervals it skips', () => {
    // Page 3's growing lag, with pages 1 and 2 cut apart as above: the backlog stands at the poll
    // at 8 s's through the skipped intervals, and grows again from the poll at 14 s's, without
    // what grew in between, which the watch can't read, so it passes d + w a poll later.
    const b = backlogOf(seriesOf({ players: 8, spectators: 4, polls: 16, lag: growingLag, linked: (a, c, t) => !cut(a, c, t) }));
    expect(b.skipped).toEqual([5, 6, 7]);
    const unread = grown(3, 7) - grown(3, 4);
    expectSeconds(b.seconds, (k, i) => (i <= 4 ? grown(k, i) : i < 7 ? grown(k, 4) : k === 3 ? grown(k, i) - unread : 0), ROUNDING);
    expect(b.onset).toMatchObject({ poll: 15, page: 3 });
  });
});

describe("the verdict a failing load run's message starts with", () => {
  /** The growing lag's sentences, its figures as the watch found them. */
  const fell = (b: Backlog): string =>
    `The rig's message path fell ${b.onset!.seconds.toFixed(2)} s behind at 24.0 s into the play (the TICKs to page 3), past d + w (${LIMIT.toFixed(3)} s)`;
  const largest = (b: Backlog): string => `Its largest backlog: ${b.max!.seconds.toFixed(2)} s, page 3's at 30.0 s.`;
  const unsure = "the watch can't tell the machine's capacity from the protocol's.";

  it("is the machine's capacity when the backlog passed d + w no later than the first poll that showed a late input", () => {
    const none = backlogOf(growing());
    expect(verdictOf(none)).toEqual({
      capacity: true, text: `${fell(none)}, with no input late: the machine's capacity rather than the protocol's. ${largest(none)}`,
    });
    // Inputs first late by the onset's poll, at 24 s, and first late at a later poll, at 26 s.
    for (const [from, at] of [[23, '24.0'], [25, '26.0']] as const) {
      const b = backlogOf(growing((k, t) => (k === 5 && t > from ? 7 : 0)));
      expect(verdictOf(b)).toEqual({
        capacity: true,
        text: `${fell(b)}, no later than the first poll that showed a late input, at ${at} s: the machine's capacity rather than the protocol's. ${largest(b)}`,
      });
    }
  });

  it("says how many inputs came late before the path fell behind, from when, and that it can't tell which failed first", () => {
    // Page 5: 3 inputs late from 19 s, 4 more from 21 s, and 7 more from 23 s, after the poll at
    // 22 s, the last before the onset's.
    const b = backlogOf(growing((k, t) => (k === 5 ? (t > 19 ? 3 : 0) + (t > 21 ? 4 : 0) + (t > 23 ? 7 : 0) : 0)));
    expect(b.late.slice(9, 13)).toEqual([0, 3, 7, 14]);
    expect(verdictOf(b)).toEqual({ capacity: false, text: `${fell(b)}, but 7 inputs had come late before that, from 20.0 s: ${unsure} ${largest(b)}` });
  });

  it('says inputs late in the first interval may have come late from before the play measured', () => {
    // One input late on page 5 at 1 s, as a cold start's transient, or a lateness that began before
    // the first poll, which the polls don't see.
    const b = backlogOf(growing((k, t) => (k === 5 && t > 1 ? 1 : 0)));
    expect(b.lateOnset).toEqual({ poll: 1, ms: 2000, late: 1 });
    expect(verdictOf(b)).toEqual({
      capacity: false, text: `${fell(b)}, but 1 input had come late before that, from the play's first interval, so perhaps from before it: ${unsure} ${largest(b)}`,
    });
  });

  it('says the path kept up when no backlog passed d + w, and that it read nothing when the mesh was never whole', () => {
    const v = verdictOf(backlogOf(seriesOf({ players: 8, spectators: 4, polls: 6, late: (k, t) => (t > 3 ? k : 0) })));
    expect(v).toEqual({
      capacity: false, text: `The rig's message path kept up: no receiver's backlog, summed over its senders, passed d + w (${LIMIT.toFixed(3)} s). Its largest backlog: 0.00 s, page 0's at 0.0 s.`,
    });
    // Pages 0 and 1 never linked: every interval skipped.
    const apart = verdictOf(backlogOf(seriesOf({ players: 8, spectators: 4, polls: 6, linked: (a, b) => a + b !== 1 })));
    expect(apart).toEqual({ capacity: false, text: "The rig's message path wasn't read: no interval of the play measured had the mesh whole." });
  });

  it('counts late inputs from the first poll on, not those before the play measured', () => {
    // Page 4 had 50 late inputs before the play measured, and takes 3 more at 19 s.
    const b = backlogOf(growing((k, t) => (k === 4 ? 50 + (t > 19 ? 3 : 0) : 0)));
    expect(b.lateOnset).toEqual({ poll: 10, ms: 20_000, late: 3 });
    expect(verdictOf(b)).toEqual({ capacity: false, text: `${fell(b)}, but 3 inputs had come late before that, from 20.0 s: ${unsure} ${largest(b)}` });
  });
});
