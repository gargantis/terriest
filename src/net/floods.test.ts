import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { decode, encodeFwd, encodePeers, encodeTick, type Hello, NO_TICK, PROTOCOL_VERSION, ROLE, T, TIMELINE_KIND, ZERO_HASH } from '../core/protocol/messages';
import { commonRefusal, type Accepted, type Refusal, type RoomPeer } from '../core/session/room-peer';
import { Session } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, type Pack } from '../core/sim/index';
import { expectAgreement, NetPump, senderInput, TEST_BUILD } from '../core/timeline/testing';
import { LoopbackNet, type LoopNode } from './loopback';
import { uniform } from './freezes-testing';
import type { Transport } from './transport';

// The floods a count by the ticks TICKs carry still closes (PLAN D-19; M3's
// design, research/m3/DESIGN.md, §4.10; roslambo §9.3; M3 phase 5a,
// harness-F1): more than floodTicksPerTick a tick of the sender's possible
// clock, a connection's own TICKs or its FWDs for one origin. A TICK takes
// its own tick as far as that clock, (1 + rateMax) ticks a tick, can have
// moved since the one before, the newest otherwise: so a burst for one tick,
// old ticks sent again, ticks that run ahead faster than any clock, bursts
// after silences, and a slow sender's burst all bunch up, and close the
// connection as a count by arrival did, within 500 ms of the flood's start
// and not before the connection is floodMs old. Its limit is
// floodTicksPerTick a tick of the possible clock, which runs (1 + rateMax)
// ticks a tick, where a count by arrival's was floodTicksPerTick a tick of
// this page's: under it closes nothing, bursts of backlogs included, where
// a count by arrival closed two bursts that jitter landed within floodMs;
// src/core/session/flood.test.ts pins it either side (flood-F4, flood-F6).

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const ROOM = NET.room;
const P = defaultParams;
const B = defaultBotParams;
const D = NET.timeline.delay;
const MATCH = 'f100df100df100d1';
const id = (k: number): string => personId(31, k);
const ORIGIN = id(7); // not a setting: an origin with no connection here, which the rogue speaks for
const WINDOW_TICKS = ROOM.floodTicksMax / ROOM.floodTicksPerTick; // floodMs in ticks

/** A peer that admits whatever commonRefusal passes and sends what its shape hands it each timer run. */
class Rogue implements RoomPeer {
  readonly joined = new Set<string>();
  each: ((now: number) => void) | null = null;
  readonly link: Transport;
  readonly me: string;

  constructor(link: Transport, me: string) {
    this.link = link;
    this.me = me;
  }

  hello(): Hello {
    return {
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: this.me, role: ROLE.UNDECIDED,
      timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name: 'R',
    };
  }

  checkHello(hello: Hello): Accepted | Refusal {
    return commonRefusal(hello, TEST_BUILD, this.me) ?? { ok: true, hello };
  }

  onPeerJoin(peer: string): void {
    this.joined.add(peer);
  }

  onHandshakeFailed(): void {}

  onPeerLeave(peer: string): void {
    this.joined.delete(peer);
  }

  onRtt(): void {}

  onMessage(): void {}

  advance(now: number): void {
    this.each?.(now);
  }
}

/** What a shape sends: TICKs of its own, or FWDs for ORIGIN, each for tick t. */
type Send = (t: number) => void;

/** A flood's shape: what it sends on each timer run, given a's clock tick, the time since it began and its
 *  own state; when it begins, after the connection opened; and when its flood does, if later. */
interface Shape {
  readonly name: string;
  readonly startMs: number;
  readonly floodAtMs?: number;
  run(send: Send, clock: number, sinceMs: number, s: { t: number; last: number }): void;
}

/** A TICK for t, its phase at the cap, as a catch-up's: no clock sample, so no shape moves a clock. These
 *  tests are of the count; misbehaving.test.ts's rogues send TICKs on the clock. */
const tickBytes = (t: number): Uint8Array => encodeTick({ t, own: senderInput(new Map([[t, 0]]), t), voteTick: NO_TICK, voteHash: ZERO_HASH, phase: 1, bots: [] });

/** One burst of n TICKs for consecutive ticks from s.t on, as a backlog's. */
const burst = (send: Send, s: { t: number }, n: number): void => {
  for (let k = 0; k < n; k++) send(s.t++);
};

/** One TICK a tick over floodTicksPerTick for floodMs: 480 at A.4's values. */
const OVER = (ROOM.floodTicksPerTick + 1) * WINDOW_TICKS;

const SHAPES: readonly Shape[] = [
  {
    // Four TICKs a timer run, all for the tick it began at.
    name: 'TICKs for one tick',
    startMs: 0,
    run: (send, clock, _since, s) => {
      if (s.t < 0) s.t = clock + D;
      for (let k = 0; k < 4; k++) send(s.t);
    },
  },
  {
    // A live TICK a tick, as an honest sender's, and three for a tick 300 back with each.
    name: 'old ticks sent again',
    startMs: 0,
    run: (send, clock, _since, s) => {
      if (clock === s.last) return;
      s.last = clock;
      send(clock + D);
      for (let k = 0; k < 3; k++) send(clock + D - 300);
    },
  },
  {
    // A TICK each timer run, each a tick on: four ticks a tick, ahead of any clock.
    name: 'ticks that run ahead faster than any clock',
    startMs: 0,
    run: (send, clock, _since, s) => {
      if (s.t < 0) s.t = clock + D;
      send(s.t++);
    },
  },
  {
    // Silent floodMs, then a burst of consecutive ticks up to the clock, as a backlog, OVER of them.
    name: 'a burst after each silence of floodMs, as a backlog',
    startMs: ROOM.floodMs + 100,
    run: (send, clock, since, s) => {
      if (s.t < 0) s.t = clock + D - OVER;
      if (since >= s.last) {
        s.last = since + ROOM.floodMs;
        burst(send, s, OVER);
      }
    },
  },
  {
    // Five silences of floodMs, one TICK after each, banking nothing; then one burst over the limit for
    // a silence.
    name: 'silences banked for one burst',
    startMs: ROOM.floodMs,
    floodAtMs: 6 * ROOM.floodMs,
    run: (send, clock, since, s) => {
      if (s.t < 0) s.t = clock + D;
      if (since >= s.last && s.last < 5 * ROOM.floodMs) {
        s.last += ROOM.floodMs;
        send(s.t++);
      } else if (since >= 5 * ROOM.floodMs && s.last < Infinity) {
        s.last = Infinity;
        burst(send, s, (ROOM.floodTicksPerTick + 1) * (WINDOW_TICKS + 20));
      }
    },
  },
  {
    // A TICK a tick whose ticks move half a tick a tick, for 8 s, then a burst over the limit: a slow
    // sender banks nothing either.
    name: "a slow sender's burst",
    startMs: 0,
    floodAtMs: 8000,
    run: (send, clock, since, s) => {
      if (s.t < 0) s.t = clock + D;
      if (since < 8000) {
        if (clock === s.last) return;
        s.last = clock;
        send(Math.floor(s.t));
        s.t += 0.5;
      } else if (s.last < Infinity) {
        s.last = Infinity;
        s.t = Math.floor(s.t) + 1;
        burst(send, s, WINDOW_TICKS * ROOM.floodTicksPerTick);
      }
    },
  },
];

/** When the shape closed the rogue's connection at n0, from the connection's opening there; -1 for never,
 *  within 12 s of the shape's start. */
function close(shape: Shape, fwd: boolean, seed: number): { at: number; dropped: string[] } {
  const room = new NetPump(new LoopbackNet(seed, uniform(seed * 3, 30, 60, 10)));
  const net = room.net;
  const mk = (k: number): LoopNode<Session> =>
    net.add(
      `n${k}`,
      room.peer(
        (link, mode) => {
          const s = new Session({ P, B, net: NET, me: id(k), name: `P${k}`, coat: k, build: TEST_BUILD, forwarding: true, mode, verify: k === 0 ? 8 : 0 }, link);
          s.controls = () => 0x20 | k;
          return s;
        },
        (s) => ({ t: s.timeline, host: s.bots }),
      ),
    );
  const a = mk(0);
  const b = mk(1);
  net.join(a, 0, (now) => {
    a.session.propose(a.local(now), { packSize: 2, matchMinutes: 1 }, MATCH);
    a.session.play(0);
  });
  net.join(b, 200, () => b.session.play(1 as Pack));
  const r = net.add('r', (link) => new Rogue(link, id(9)));
  // Late enough that a tick 300 back is one.
  net.join(r, 6000);
  room.until(() => a.session.connectedRoles().has(id(9)), 8000);
  const opened = net.now;
  room.until(() => r.session.joined.has('n0'), 3000);
  if (fwd) {
    r.session.link.send('n0', encodePeers([id(0), ORIGIN], ROLE.UNDECIDED));
    room.run(50);
  }
  const send: Send = fwd ? (t) => r.session.link.send('n0', encodeFwd(ORIGIN, tickBytes(t))) : (t) => r.session.link.send('n0', tickBytes(t));
  const state = { t: -1, last: -1 };
  const start = opened + shape.startMs;
  r.session.each = () => {
    if (!r.session.joined.has('n0') || net.now < start) return;
    shape.run(send, Math.floor(a.session.timeline.clock(a.local(net.now))), net.now - start, state);
  };
  let at = -1;
  room.until(() => {
    if (at < 0 && a.session.dropped.length > 0) at = net.now;
    return at >= 0 || net.now > start + 12_000;
  }, 16_000);
  r.session.each = null;
  expect(room.problems).toEqual([]);
  expectAgreement([a, b].map((x) => ({ t: x.session.timeline })));
  return { at: at < 0 ? -1 : at - opened, dropped: a.session.dropped };
}

describe('the floods a count by the ticks they carry still closes (harness-F1, roslambo §9.3)', () => {
  for (const fwd of [false, true]) {
    for (const [k, shape] of SHAPES.entries()) {
      it(`${fwd ? 'FWDs for one origin' : 'TICKs'}: ${shape.name}`, () => {
        const c = close(shape, fwd, 40 + k);
        const label = JSON.stringify(c);
        expect(c.dropped, label).toEqual(['r']);
        // Within 500 ms of the flood's start, or of the connection being floodMs old.
        const from = Math.max(ROOM.floodMs, shape.floodAtMs ?? shape.startMs);
        expect(c.at, label).toBeGreaterThanOrEqual(from);
        expect(c.at, label).toBeLessThanOrEqual(from + 500);
      });
    }
  }

  it('closes nothing under floodTicksPerTick a tick of the possible clock, where a count by arrival closed two bursts landing within floodMs', () => {
    // Each floodMs, silent, then 2.75 TICKs a tick of it at once: as a backlog's ticks, one a tick of the
    // silence, and the rest for the newest again; or each a tick on, running ahead.
    const BURST = Math.floor((ROOM.floodTicksPerTick - 0.25) * WINDOW_TICKS);
    const each = (name: string, fill: (send: Send, s: { t: number }) => void): Shape => ({
      name,
      startMs: ROOM.floodMs + 100,
      run: (send, clock, since, s) => {
        if (s.t < 0) s.t = clock + D;
        if (since >= s.last) {
          s.last = since + ROOM.floodMs;
          fill(send, s);
        }
      },
    });
    const shapes = [
      each('a backlog and repeats', (send, s) => {
        burst(send, s, WINDOW_TICKS);
        for (let k = WINDOW_TICKS; k < BURST; k++) send(s.t - 1);
      }),
      each('ticks running ahead', (send, s) => burst(send, s, BURST)),
    ];
    for (const shape of shapes) for (const fwd of [false, true]) expect(close(shape, fwd, 60).dropped, `${shape.name}, ${fwd ? 'FWDs' : 'TICKs'}`).toEqual([]);
  });
});

describe('the shapes send what the wire takes', () => {
  it('a TICK for any tick a shape sends decodes, so what closes a connection is the count, never invalidMessagesMax', () => {
    for (const t of [0, 1000, 70_000]) expect(decode(tickBytes(t))?.type).toBe(T.TICK);
  });
});
