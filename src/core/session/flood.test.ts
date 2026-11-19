import { describe, expect, it } from 'vitest';
import { personId } from '../bot/bot-id';
import { defaultBotParams } from '../bot/brain';
import { encodeFwd, encodePeers, encodeTick, type Hello, NO_TICK, PROTOCOL_VERSION, ROLE, T, TIMELINE_KIND, ZERO_HASH } from '../protocol/messages';
import { defaultParams } from '../sim/index';
import { senderInput, TEST_BUILD } from '../timeline/testing';
import { Session } from './session';
import { netSettings } from './settings';

// A flood's count by the ticks TICKs carry, on a link played by hand (PLAN
// D-19; M3's design, research/m3/DESIGN.md, §4.10; M3 phase 5a,
// harness-F1, flood-F4, flood-F5): a sender's ticks may jump further than
// its possible clock can have moved, as a merge onto an older timeline
// moves them, or a clock's jump; the count moves only as far as that clock,
// and goes on from there, so the jump leaves no lag behind it that a later
// backlog would pile up on. The limit is floodTicksPerTick a tick of the
// sender's possible clock, (1 + rateMax) ticks a tick. A FWD count for an
// origin new here starts when the forwarder's PEERS listed it, so a
// forwarder that lists a fresh origin and bursts for it is closed, and one
// pruned for room gives back none of the allowance it spent.
// src/net/floods.test.ts and the backlogs tests play the rest over the
// loopback.

const NET = netSettings();
const ROOM = NET.room;
const TIMER = NET.timerMs;
const D = NET.timeline.delay;

const tickBytes = (t: number, phase = 0): Uint8Array =>
  encodeTick({ t, own: senderInput(new Map([[t, 0]]), t), voteTick: NO_TICK, voteHash: ZERO_HASH, phase, bots: [] });

/** A session in a match alone, and peer 'p' connected to it at 0, its messages handed in by the test. */
function link(): { s: Session; dropped: string[]; to: (bytes: Uint8Array, now: number) => void } {
  const dropped: string[] = [];
  const s = new Session(
    { P: defaultParams, B: defaultBotParams, net: NET, me: personId(5, 0), name: 'P0', coat: 0, build: TEST_BUILD, forwarding: false },
    { send: () => undefined, broadcast: () => undefined, drop: (peer) => dropped.push(peer) },
  );
  s.propose(0, { packSize: 1, matchMinutes: 1 }, 'b0b0b0b0b0b0b0b0');
  s.play(0);
  const hello: Hello = {
    type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: personId(5, 1), role: ROLE.PLAYER,
    timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name: 'P1',
  };
  expect(s.checkHello(hello, 0, 'p').ok).toBe(true);
  s.onPeerJoin('p', hello, s.hello(), 0);
  return { s, dropped, to: (bytes, now) => s.onMessage('p', bytes, now) };
}

describe('a sender whose ticks jump past its possible clock (harness-F1)', () => {
  it('keeps its connection through a backlog after the jump, as one of a merge onto an older timeline', () => {
    const { s, dropped, to } = link();
    let now = 0;
    // Its TICKs carry this page's ticks plus `ahead`, one a tick, as a peer on time sends them.
    let ahead = 0;
    let sentFor = -1;
    const tick = (u: number): void => to(tickBytes(u), now);
    const run = (ms: number): void => {
      for (const end = now + ms; now < end; ) {
        now += TIMER;
        s.advance(now);
        const u = s.timeline.localTick + D + ahead;
        if (u !== sentFor) tick((sentFor = u));
      }
    };
    run(3000);
    // It merges onto a timeline 2000 ticks older, and goes on sending from there.
    to(encodePeers([], ROLE.PLAYER, { timeline: 'f0f0f0f0f0f0f0f0', timelineKind: TIMELINE_KIND.LIVE, finalTick: 2000, hash: ZERO_HASH }), now);
    ahead = 2000;
    run(3000);
    // Then this page's link from it stalls 7 s: its TICKs land at once, each a tick on.
    const from = sentFor;
    const held = 7000;
    now += held;
    for (let u = from + 1; u <= from + held / NET.tickMs; u++) tick(u);
    expect([s.dropped, dropped]).toEqual([[], []]);
    expect(s.peerCount()).toBe(1);
  });
});

describe('the limit, floodTicksPerTick a tick of the possible clock (flood-F4)', () => {
  /** n TICKs a tick for 20 s, their ticks moving `rate` ticks a tick, their phase at the cap, as no clock
   *  sample: when the connection closed, from its start, or -1 for never. */
  const steady = (n: number, rate: number): number => {
    const { s, dropped, to } = link();
    let carry = 0;
    let t = 100;
    for (let now = 0; now <= 20_000; now += TIMER) {
      s.advance(now);
      for (carry += n * (TIMER / NET.tickMs); carry >= 1 && dropped.length === 0; carry--) {
        to(tickBytes(Math.floor(t), 1), now);
        t += rate / n;
      }
      if (dropped.length > 0) return now;
    }
    return -1;
  };

  it.each([
    ['on the clock', 1],
    ['running ahead of it as fast as any clock runs', 1 + NET.timeline.clock.rateMax],
  ])('closes 3.2 TICKs a tick and leaves 2.9 alone, their ticks %s', (_what, rate) => {
    const over = steady(ROOM.floodTicksPerTick + 0.2, rate);
    expect(over).toBeGreaterThanOrEqual(ROOM.floodMs);
    expect(over).toBeLessThan(2 * ROOM.floodMs);
    expect(steady(ROOM.floodTicksPerTick - 0.1, rate)).toBe(-1);
  });
});

describe("an origin's FWD count, from when its forwarder could first have relayed it (flood-F5)", () => {
  const origin = (k: number): string => personId(77, k);
  /** n FWDs for origin x, for consecutive ticks from t, at once. */
  const burst = (to: (bytes: Uint8Array, now: number) => void, x: string, t: number, n: number, now: number): void => {
    for (let k = 0; k < n; k++) to(encodeFwd(x, tickBytes(t + k)), now);
  };
  const N = 1500; // not a setting: a burst of FWDs for one origin, over four times the limit

  it('closes a forwarder that lists a fresh origin each second and bursts for it, by its second burst', () => {
    // Its connection 30 s old and silent: the first burst meets that silence, as an honest backlog's
    // would; the next lists its origin a second after the burst before.
    const { s, dropped, to } = link();
    let bursts = 0;
    for (let k = 0; k < 5 && dropped.length === 0; k++) {
      const now = 30_000 + 1000 * k;
      to(encodePeers([origin(k)], ROLE.SPECTATOR), now);
      burst(to, origin(k), 1000, N, now);
      bursts++;
    }
    expect([dropped, s.dropped]).toEqual([['p'], ['p']]);
    expect(bursts).toBeLessThanOrEqual(2);
  });

  it('gives a count pruned for room none of the allowance it spent: the origin listed since is counted from its last FWD', () => {
    const { dropped, to } = link();
    const xs = Array.from({ length: NET.room.meshPlayersMax + NET.room.spectatorsMax - 1 }, (_, k) => origin(k)); // peersMax origins
    to(encodePeers(xs, ROLE.SPECTATOR), 100);
    for (const x of xs) burst(to, x, 1000, 1, 200);
    // 30 s on, a burst for the first, as a backlog of that silence: kept.
    burst(to, xs[0]!, 1001, N, 30_000);
    expect(dropped).toEqual([]);
    // floodMs on, a new origin needs room: every count goes. Another burst for the first is a burst
    // over floodMs of silence again, and closes the connection; one for an origin silent since 200 ms
    // would have been kept.
    const later = 30_000 + ROOM.floodMs + 200;
    to(encodePeers([...xs.slice(0, -1), origin(99)], ROLE.SPECTATOR), later);
    burst(to, origin(99), 1000, 1, later);
    burst(to, xs[1]!, 1001, N, later);
    expect(dropped).toEqual([]);
    burst(to, xs[0]!, 1001 + N, N, later);
    expect(dropped).toEqual(['p']);
  });
});
