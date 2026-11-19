import { describe, expect, it } from 'vitest';
import { personId } from '../bot/bot-id';
import { defaultBotParams } from '../bot/brain';
import { encodeTick, type Hello, NO_TICK, PROTOCOL_VERSION, ROLE, T, TIMELINE_KIND, ZERO_HASH } from '../protocol/messages';
import { defaultParams } from '../sim/index';
import { senderInput, TEST_BUILD } from '../timeline/testing';
import { Session } from './session';
import { netSettings } from './settings';

// The round trips a session takes for the one-way delay (PLAN D-15; M3's
// design, research/m3/DESIGN.md, §1.6; M3 phase 5a, clock-F1,
// rtt-clock5a-F1 to F3): a freeze's round trip measures the freeze, not the
// network, and is no sample, whether this page's freeze held the pong,
// which its clock's held state says, or the peer froze with the ping
// unanswered, its own TICKs falling silent for more than d + w ticks and
// coming back in a catch-up, as a thawed timeline sends them, or before its
// first TICK, for a player holding a timeline. A silence the peer's own
// clock explains, a jump back holding its ticks, ends in its next tick, and
// its round trip is taken. One late pong is covered by the smaller of the
// last two; a freeze every second held one each time, and the delay swelled.
// A link played by hand, its times exact.

const NET = netSettings();
const TIMER = NET.timerMs;
const D = NET.timeline.delay;
/** An input's time in flight, d + w ticks: a longer gap between a peer's TICKs is a silence. */
const QUIET_MS = (NET.timeline.delay + NET.timeline.window) * NET.tickMs;
const MATCH = 'c1c1c1c1c1c1c1c1';
/** A TICK's phase at the wire's cap, a catch-up's: 65535 / 65536 (design §5.3). */
const CAPPED = 1;

/** A session in a match alone, on time, and one peer connected to it, whose TICK comes each tick while it
 *  sends. Its HELLO announces a player without a timeline by default; `holds` makes it a player, or a
 *  spectator, holding the match's timeline: a player then sends from the handshake on. */
class Pair {
  readonly s: Session;
  now = 0;
  sends = true;
  /** How far its ticks are behind this page's, as a jump back leaves them until its clock catches up. */
  lag = 0;
  private sentFor = -1;

  constructor(o: { sends?: boolean; holds?: 'player' | 'spectator'; settle?: boolean } = {}) {
    this.sends = o.sends ?? true;
    this.s = new Session(
      { P: defaultParams, B: defaultBotParams, net: NET, me: personId(3, 0), name: 'P0', coat: 0, build: TEST_BUILD, forwarding: false },
      { send: () => undefined, broadcast: () => undefined },
    );
    this.s.propose(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    this.s.play(0);
    const hello: Hello = {
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: personId(3, 1), role: o.holds === 'spectator' ? ROLE.SPECTATOR : ROLE.PLAYER,
      timeline: o.holds ? MATCH : ZERO_HASH, timelineKind: o.holds ? TIMELINE_KIND.LIVE : TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH,
      name: 'P1',
    };
    expect(this.s.checkHello(hello, 0, 'p').ok).toBe(true);
    this.s.onPeerJoin('p', hello, this.s.hello(), 0);
    if (o.settle ?? true) this.run(2000);
  }

  /** The timer on time for ms, the peer's TICK each tick if it sends. */
  run(ms: number): void {
    for (const end = this.now + ms; this.now < end; ) {
      this.now += TIMER;
      this.s.advance(this.now);
      this.tick();
    }
  }

  /** The peer's TICK for its next tick, once a tick, as a peer on time sends it: none while its ticks
   *  are behind its last, as a jump back holds them. */
  tick(): void {
    const t = this.s.timeline.localTick + D - this.lag;
    if (!this.sends || t <= this.sentFor) return;
    this.send(t, 0);
  }

  /** A thawed peer's first TICKs: the newest stallSendTicks ticks of the ones it missed, the older
   *  ones late for their ticks, their phase at the cap (§2.4, A.4's Timer stall). */
  catchUp(): void {
    const t = this.s.timeline.localTick + D - this.lag;
    for (let u = Math.max(this.sentFor + 1, t - NET.timeline.stallSendTicks + 1); u <= t; u++) this.send(u, u < t ? CAPPED : 0);
  }

  /** No timer run for ms: this page frozen. */
  freeze(ms: number): void {
    this.now += ms;
  }

  get oneWay(): number | null {
    return (this.s as unknown as { peers: Map<string, { oneWayMs: number | null }> }).peers.get('p')!.oneWayMs;
  }

  private send(t: number, phase: number): void {
    this.sentFor = t;
    this.s.onMessage('p', encodeTick({ t, own: senderInput(new Map([[t, 0]]), t), voteTick: NO_TICK, voteHash: ZERO_HASH, phase, bots: [] }), this.now);
  }
}

describe('round trips a freeze held are no samples (clock-F1)', () => {
  it('takes the network’s round trips, half the smaller of the last two', () => {
    const p = new Pair();
    p.s.onRtt('p', 100, p.now);
    expect(p.oneWay).toBe(50);
    p.run(1000);
    p.s.onRtt('p', 160, p.now);
    expect(p.oneWay).toBe(50);
    p.run(1000);
    p.s.onRtt('p', 120, p.now);
    expect(p.oneWay).toBe(60);
  });

  it.each(['timer', 'messages'] as const)('takes none whose pong was held for this page through its freeze, twice running (thawing %s first)', (thaw) => {
    // A peer that sends no TICKs, as a spectator: only this page's clock can say its pong was held. A
    // sender's TICKs, held with the pong, would fall silent here too.
    const p = new Pair({ sends: false });
    p.s.onRtt('p', 100, p.now);
    for (const ms of [500, 450]) {
      p.run(1000);
      // Frozen with a ping out: its pong waited for the thaw, before or after the late timer run.
      p.freeze(ms);
      if (thaw === 'timer') p.s.advance(p.now);
      p.s.onRtt('p', ms + 60, p.now);
      if (thaw === 'messages') p.s.advance(p.now);
      expect(p.oneWay).toBe(50);
    }
    // On time again: the next is taken.
    p.run(1000);
    p.s.onRtt('p', 80, p.now);
    expect(p.oneWay).toBe(40);
  });

  it.each(['timer', 'messages'] as const)('takes none whose peer froze with the ping unanswered, its TICKs silent meanwhile, twice running (its %s first)', (first) => {
    const p = new Pair();
    p.s.onRtt('p', 100, p.now);
    for (const ms of [500, 450]) {
      p.run(1000);
      // The peer frozen ms: its TICKs stop, the ping waits, and as it thaws its pong comes before its
      // catch-up, or after it.
      p.sends = false;
      p.run(ms);
      p.sends = true;
      if (first === 'timer') p.catchUp();
      p.s.onRtt('p', ms + 60, p.now);
      if (first === 'messages') p.catchUp();
      expect(p.oneWay).toBe(50);
    }
    p.run(1000);
    p.s.onRtt('p', 80, p.now);
    expect(p.oneWay).toBe(40);
  });

  it("takes a round trip over a silence of d + w ticks or less, and a peer's that sends no TICKs", () => {
    const p = new Pair();
    p.s.onRtt('p', 100, p.now);
    // A gap of d + w ticks in its TICKs, jitter's, is no silence, even one ending in a catch-up.
    p.run(1000);
    p.sends = false;
    p.run(QUIET_MS - 2 * TIMER);
    p.sends = true;
    p.catchUp();
    p.s.onRtt('p', 180, p.now);
    p.s.onRtt('p', 200, p.now);
    expect(p.oneWay).toBe(90);
    // A peer that sends no TICKs, as a spectator, says nothing of its freezes: its round trips are taken.
    const q = new Pair({ sends: false });
    q.run(QUIET_MS * 4);
    q.s.onRtt('p', 300, q.now);
    q.run(1000);
    q.s.onRtt('p', 260, q.now);
    expect(q.oneWay).toBe(130);
  });

  it.each(['timer', 'messages'] as const)('takes none over a silence two timer runs past d + w ticks, ended in a catch-up (rtt-clock5a-F2; its %s first)', (first) => {
    const p = new Pair();
    p.s.onRtt('p', 100, p.now);
    p.run(1000);
    p.sends = false;
    p.run(QUIET_MS + 2 * TIMER);
    p.sends = true;
    if (first === 'timer') p.catchUp();
    p.s.onRtt('p', 300, p.now);
    if (first === 'messages') p.catchUp();
    p.run(100);
    p.s.onRtt('p', 320, p.now);
    // The 300 ms one was none: the smaller of the last two taken is the 320 ms one alone, with 100.
    expect(p.oneWay).toBe(50);
  });

  it('takes one over a longer silence its clock explains: a jump back holds its ticks, and its next comes on time (rtt-clock5a-F1)', () => {
    // Its clock jumped back 20 ticks, a whole median's at 2 a side: no TICK for 333 ms, then its next
    // tick, one a tick. A pong during that pause is decided by the TICK after it, and one after it is
    // taken at once.
    for (const during of [true, false]) {
      const p = new Pair();
      p.s.onRtt('p', 100, p.now);
      p.run(1000);
      p.lag += 20;
      if (during) {
        p.run(QUIET_MS + 40);
        p.s.onRtt('p', 400, p.now);
        expect(p.oneWay, 'decided by its next TICK').toBe(50);
        p.run(100);
      } else {
        p.run(QUIET_MS + 200);
        p.s.onRtt('p', 400, p.now);
      }
      p.run(1000);
      p.s.onRtt('p', 420, p.now);
      expect(p.oneWay, during ? 'a pong during the pause' : 'a pong after it').toBe(200);
    }
  });

  it.each(['timer', 'messages'] as const)('takes none from a player holding a timeline that froze as the connection opened, before its first TICK (rtt-clock5a-F3; its %s first)', (first) => {
    const p = new Pair({ holds: 'player', settle: false });
    // Frozen 600 ms from the handshake: none of its TICKs yet, and its pong to this side's first ping
    // waited for its thaw.
    p.sends = false;
    p.run(600);
    p.sends = true;
    if (first === 'timer') p.catchUp();
    p.s.onRtt('p', 650, p.now);
    if (first === 'messages') p.catchUp();
    p.run(1000);
    expect(p.oneWay).toBeNull();
    p.s.onRtt('p', 90, p.now);
    expect(p.oneWay).toBe(45);
    // A spectator holding the timeline sends none: its round trips are taken from the start.
    const q = new Pair({ sends: false, holds: 'spectator', settle: false });
    q.run(600);
    q.s.onRtt('p', 650, q.now);
    expect(q.oneWay).toBe(325);
  });
});
