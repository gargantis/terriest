import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { netSettings } from '../core/session/settings';
import { findTerrier, type MatchState, START_COUNTDOWN, WARM_UP } from '../core/sim/index';
import { TEST_BUILD } from '../core/timeline/testing';
import { FakeClock, fakePage } from './clock-testing';
import { OwnTally, type OwnTimeline, practiceMatch } from './match';
import type { Match } from './match-types';

// Practice's Match adapter (M4's design §1.37, §4.1, §8.1, §9.2; PLAN Q-15,
// D-22, D-30, P10), over M3's PracticeGame in virtual time (C-6): the timer
// runs its subscribers; pause reasons compose; a stall and a hidden page
// reach stalled; the sampler's tick is the one its input is for; own()
// counts every sender through a catch-up, and OwnTally what a networked
// catch-up skips; Play again and Leave close it, contacting no one.

vi.setConfig({ testTimeout: 60_000 });

const NET = netSettings();
const D = NET.timeline.delay;
const SECOND = 1000;

interface Practice {
  readonly match: Match;
  readonly clock: FakeClock;
  readonly page: ReturnType<typeof fakePage>;
  readonly me: string;
}

function practice(size = 1): Practice {
  const clock = new FakeClock(1000);
  const page = fakePage();
  const me = personId(7, 0);
  const match = practiceMatch({ me, name: 'P0', coat: 0, settings: { packSize: size, matchMinutes: 1 }, build: TEST_BUILD, clock, page });
  return { match, clock, page, me };
}

const inRoster = (x: Practice): boolean => findTerrier(x.match.session.timeline.final, x.me) >= 0;
const local = (m: Match): number => m.session.timeline.localTick;

describe("Practice's Match (M4's design §1.37)", () => {
  it("is M3's Practice: its timeline on the glue's timer, its scoreboard, and nobody contacted (P10)", () => {
    const x = practice(2);
    const m = x.match;
    expect([m.kind, m.me, m.matchId, m.settings]).toEqual(['practice', x.me, null, { packSize: 2, matchMinutes: 1 }]);
    expect(m.clock).toBe(x.clock);
    expect(m.session.timeline.started).toBe(true);
    x.clock.advance(SECOND);
    expect(local(m)).toBe(60);
    x.clock.until(() => inRoster(x), SECOND);
    expect(m.session.timeline.final.terriers).toHaveLength(4); // the person and three bots
    expect(m.scoreboard.score).toEqual([0, 0]);
    expect(m.status()).toEqual({
      refusal: null, failed: false, abandoned: false, refused: null, switchRefused: false, returning: false,
      spectatorsFull: false, leaving: false, closed: false, peers: 0, againSeen: false,
    });
    expect([m.traffic(), m.canAddBot(0), m.addBot(1), m.removeBot(1)]).toEqual([null, false, false, false]);
    expect(m.summary().remoteInputs).toBe(0);
    const stats = m.stats();
    expect(stats.sent).toBe(m.session.timeline.stats.sent);
    expect(stats).not.toBe(m.session.timeline.stats);
    m.close();
  });

  it('hands Ready and Switch pack to the session: the swap lands in warm-up, and Ready starts the countdown (Q-15, D-22)', () => {
    const x = practice(1);
    const m = x.match;
    const pack = (): number => m.session.timeline.final.terriers[findTerrier(m.session.timeline.final, x.me)]!.pack;
    x.clock.until(() => inRoster(x), SECOND);
    expect(pack()).toBe(0);
    m.switchPack();
    x.clock.until(() => pack() === 1, SECOND);
    x.clock.advance(SECOND);
    expect(m.session.timeline.head.phase).toBe(WARM_UP);
    m.ready(true);
    x.clock.until(() => m.session.timeline.head.phase === START_COUNTDOWN, SECOND);
    m.close();
  });

  it('runs its subscribers after each timer run, until they unsubscribe', () => {
    const x = practice();
    let runs = 0;
    const stop = x.match.subscribe({ run: () => runs++ });
    x.clock.advance(SECOND);
    expect(runs).toBe(SECOND / NET.timerMs);
    stop();
    x.clock.advance(SECOND);
    expect(runs).toBe(SECOND / NET.timerMs);
    x.match.close();
  });

  it('pauses while any reason holds, and runs on once none does (Q-15, D-30)', () => {
    const x = practice();
    const m = x.match;
    x.clock.advance(SECOND);
    m.pause('menu');
    expect(m.paused).toBe(true);
    x.clock.advance(SECOND);
    expect(local(m)).toBe(60);
    m.pause('graphics');
    m.resume('menu');
    expect(m.paused).toBe(true); // the graphics still hold it
    x.clock.advance(SECOND);
    expect(local(m)).toBe(60);
    m.resume('graphics');
    expect(m.paused).toBe(false);
    x.clock.advance(SECOND);
    expect(local(m)).toBe(120);
    m.close();
  });

  it("hands a stall's and a hidden page's pause to stalled, and the menu's reason then holds it (Q-15)", () => {
    const x = practice();
    const m = x.match;
    const why: string[] = [];
    m.subscribe({ stalled: (w) => why.push(w) });
    x.clock.advance(SECOND);
    x.clock.stall(NET.stallMs + 500);
    expect(why).toEqual(['stall']);
    expect(m.paused).toBe(true);
    m.pause('menu'); // the screen opens the menu
    m.resume('menu');
    x.clock.advance(SECOND);
    expect(local(m)).toBe(120);
    x.page.hide();
    expect(why).toEqual(['stall', 'hidden']);
    expect(m.paused).toBe(true);
    m.close();
  });

  it('samples once a sent tick, on the drawn head, for the tick its input is for: the local tick + d (§4.1)', () => {
    const x = practice();
    const m = x.match;
    const t = m.session.timeline;
    const calls: { tick: number; local: number; head: boolean }[] = [];
    m.setControls(
      (head: Readonly<MatchState>, headTick: number, tick: number) => {
        calls.push({ tick, local: t.localTick, head: head === t.head && headTick === t.headTick });
        return tick & 0x1f; // a step with no direction held: every u16 is an input (A.2)
      },
      () => {},
    );
    x.clock.advance(SECOND);
    x.clock.stall(500); // a catch-up: Practice sends every tick of it (D-22)
    x.clock.advance(SECOND / 2);
    expect(calls.length).toBeGreaterThan(100);
    calls.forEach((c, k) => {
      expect(c.tick, `call ${k}`).toBe(c.local + D);
      expect(c.head).toBe(true);
      if (k > 0) expect(c.tick).toBe(calls[k - 1]!.tick + 1); // each tick once, none skipped
      expect(t.receivedInput(x.me, c.tick)).toBe(c.tick & 0x1f);
    });
    m.close();
  });

  it('counts every tick moved and sent, none skipped, for the person and every bot, through a catch-up (§8.1)', () => {
    const x = practice(2);
    const m = x.match;
    expect(m.own()).toEqual({ ticks: 0, sent: 0, skipped: 0, senders: 4 });
    x.clock.advance(SECOND);
    expect(m.own()).toEqual({ ticks: 60, sent: 60, skipped: 0, senders: 4 });
    x.clock.stall(500); // one timer run 500 ms late: a catch-up of 30 ticks
    expect(local(m)).toBe(90);
    expect(m.own()).toEqual({ ticks: 90, sent: 90, skipped: 0, senders: 4 });
    m.close();
  });

  it("starts a new Practice with the same options on Play again, and closes this one (Q-15)", async () => {
    const x = practice(2);
    const m = x.match;
    x.clock.advance(SECOND);
    const old = m.session.timeline;
    const next = await m.playAgain();
    expect(m.status().closed).toBe(true);
    expect(x.clock.pending).toBe(1); // the new one's timer alone
    expect([next.kind, next.matchId, next.settings, next.me]).toEqual(['practice', null, { packSize: 2, matchMinutes: 1 }, x.me]);
    expect(next.session.timeline.id).not.toBe(old.id);
    x.clock.advance(SECOND);
    expect([old.localTick, local(next)]).toEqual([60, 60]);
    expect(next.own().ticks).toBe(60);
    next.leave();
    expect([next.status().closed, next.status().leaving, x.clock.pending]).toEqual([true, true, 0]);
    x.clock.advance(SECOND);
    expect(local(next)).toBe(60);
  });
});

describe('OwnTally (§8.1)', () => {
  const timeline = (localTick: number, sent: number, sending: boolean, bots: number): OwnTimeline => ({
    localTick, stats: { sent }, sending, bots: { size: bots },
  });

  it("counts a catch-up's skipped ticks once for every sender, nothing for a page that sends for no one, and starts again on another timeline", () => {
    const tally = new OwnTally();
    const t = { ...timeline(10, 5, true, 2) };
    tally.ran(t);
    expect(tally.figures()).toEqual({ ticks: 0, sent: 0, skipped: 0, senders: 3 });
    Object.assign(t, timeline(16, 8, true, 2)); // 6 ticks moved, the newest 3 sent
    tally.ran(t);
    expect(tally.figures()).toEqual({ ticks: 6, sent: 3, skipped: 3, senders: 3 });
    Object.assign(t, timeline(17, 9, true, 2));
    tally.ran(t);
    expect(tally.figures()).toEqual({ ticks: 7, sent: 4, skipped: 3, senders: 3 });
    Object.assign(t, timeline(21, 9, false, 0)); // watching: nothing to send, nothing skipped
    tally.ran(t);
    expect(tally.figures()).toEqual({ ticks: 11, sent: 4, skipped: 3, senders: 0 });
    const merged = timeline(500, 400, true, 1); // a merge's timeline: its own count, not a jump
    tally.ran(merged);
    expect(tally.figures()).toEqual({ ticks: 11, sent: 4, skipped: 3, senders: 2 });
    tally.ran(timeline(500, 400, true, 1)); // another object again
    tally.ran(merged);
    expect(tally.figures().ticks).toBe(11);
  });
});
