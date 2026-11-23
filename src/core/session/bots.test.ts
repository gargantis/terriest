import { describe, expect, it, vi } from 'vitest';
import { BOT_NAMES, botCoat, botId, botIds, botName, botNames, personId } from '../bot/bot-id';
import { defaultBotParams, newBrain, think } from '../bot/brain';
import {
  decode, encodeState as encodeStateMessage, type EventPayload, type InputRecord, NO_TICK, type StateMsg, type Tick, type TickEvent,
  wireLimits, ZERO_HASH,
} from '../protocol/messages';
import {
  cloneState, defaultParams, encodeInput, encodeState, findTerrier, genesis, hash64, IN_PLAY, JOIN, jumpCount, LEAVE, makeSim,
  type MatchSettings, type MatchState, type Pack, pounceCount, READY, type Sim, START_COUNTDOWN, step, type TickInput, WARM_UP,
} from '../sim/index';
import { park, place, placeBall, placedMatch } from '../sim/scenes';
import { at, tickOf } from '../timeline/testing';
import { Timeline } from '../timeline/timeline';
import { BotHost, type BotTimeline } from './bots';
import { netSettings, type RoomSettings } from './settings';

// BotHost (PLAN §14, D-39, C-41; M3's design §1.11, §4.8, §4.9) against a
// timeline pumped by hand, with no session or network (design §8.3): IDs,
// coats and names, JOIN until the state shows it, READY renewed before it
// expires, removal, adoption after a reload and into a new timeline, giving
// up when full or started, Play again's pack fallback, and one think per
// head tick. Then over the real timeline, which satisfies BotTimeline: a
// removed bot hosted until its LEAVE is final here, wherever a catch-up or a
// STATE put it (M3 phase 2's integration).

// The real timeline's runs verify their chains: CPU-bound, as M2's suites are.
vi.setConfig({ testTimeout: 120_000 });

const P = defaultParams;
const B = defaultBotParams;
const NET = netSettings();
const ROOM = NET.room;
const D = NET.timeline.delay;
const W = NET.timeline.window;
const V = NET.timeline.voteWindow;
const E = ROOM.eventRetryTicks;
const me = personId(5, 0);
const ids = botIds(me);
/** A person whose ID sorts before every bot of `me`'s: it takes a pack's last place from them (P4). */
const FIRST = '00000000000040008000000000000001';

/** One input a sender sent, and the head it was sampled on. */
interface Sent {
  readonly id: string;
  readonly tick: number;
  readonly input: number;
  readonly headTick: number;
  readonly head: Readonly<MatchState>;
}

/** A timeline pumped by hand. Each local tick sends every hosted bot's input
 *  for localTick + d with the events queued for it since the last, as
 *  timeline.ts sends (design §2.3, §2.4): so an event queued at local tick n
 *  rides in the input for n + 1 + d, and is in flight until that's final.
 *  The final state follows w behind, by the real step, and the head follows
 *  it, as a clone, or with ahead, as the real timeline's, stepped on to
 *  localTick with the inputs known; unless held. Every input is known here,
 *  so a tick's final inputs are those sent, and the people's, but for the
 *  events a test loses: as if their TICKs reached every other peer after the
 *  tick was final, and a repair's lineage left them out. */
class FakeTimeline implements BotTimeline {
  started = true;
  final: MatchState;
  head: MatchState;
  headTick: number;
  finalTick: number;
  localTick: number;
  readonly cfg = { delay: D };
  readonly bots = new Map<string, () => number>();
  /** Every event queued, with the local tick it was queued at. */
  readonly queued: { who: string; at: number; e: EventPayload }[] = [];
  readonly sent: Sent[] = [];
  /** Senders whose next events are lost. */
  readonly lose = new Set<string>();
  /** The head holds where it is, as through a spread (design §2.8). */
  held = false;
  /** The head runs ahead of the final state, to localTick, as the real timeline's predicted head. */
  ahead = false;
  /** The people's inputs for a tick. */
  people: (t: number) => TickInput[] = () => [];
  /** Each bot's newest input held, with its tick: its own as it sends, or a STATE's record, set by a test. */
  readonly newest = new Map<string, { tick: number; input: number }>();
  private readonly outbox = new Map<string, EventPayload>();
  /** Each sender's events sent, by the tick they ride in. */
  private readonly flying = new Map<string, { t: number; events: number }[]>();
  private readonly inputs = new Map<number, TickInput[]>();
  private readonly sim: Sim;

  /** Genesis with settings, or a state held at its tick, as adopted: final there, the clock w on. */
  constructor(from: MatchSettings | MatchState) {
    this.final = 'phase' in from ? cloneState(from) : genesis(from, P);
    this.sim = makeSim(P, this.final.packSize);
    this.finalTick = this.final.tick;
    this.localTick = 'phase' in from ? this.finalTick + W : 0;
    this.head = cloneState(this.final);
    this.headTick = this.finalTick;
  }

  queueEvent(who: string, e: EventPayload): void {
    this.queued.push({ who, at: this.localTick, e });
    const o = this.outbox.get(who);
    this.outbox.set(who, o ? { ...o, ...e, events: o.events | e.events } : { ...e });
  }

  eventsInFlight(who: string): number {
    let bits = this.outbox.get(who)?.events ?? 0;
    for (const x of this.flying.get(who) ?? []) if (x.t > this.finalTick) bits |= x.events;
    return bits;
  }

  newestInput(who: string): { readonly tick: number; readonly input: number } | undefined {
    return this.newest.get(who);
  }

  /** One timer run in which the clock moves `ticks` local ticks: each sends, all on the head as it
   *  stands (a catch-up's); then finalisation, and the head. */
  advance(ticks = 1): void {
    for (let k = 0; k < ticks; k++) {
      this.localTick++;
      const t = this.localTick + D;
      const list: TickInput[] = [];
      for (const [id, sample] of this.bots) {
        const input = sample();
        this.sent.push({ id, tick: t, input, headTick: this.headTick, head: this.head });
        this.newest.set(id, { tick: t, input });
        const e = this.outbox.get(id);
        this.outbox.delete(id);
        if (e) this.flying.set(id, [...(this.flying.get(id) ?? []), { t, events: e.events }]);
        list.push(e && !this.lose.delete(id) ? { id, input, ...e } : { id, input, events: 0 });
      }
      this.inputs.set(t, list);
    }
    while (this.finalTick < this.localTick - W) {
      const t = this.finalTick + 1;
      step(this.sim, this.final, this.inputsAt(t));
      this.inputs.delete(t);
      this.finalTick = t;
    }
    if (this.held) return;
    this.head = cloneState(this.final);
    this.headTick = this.finalTick;
    if (!this.ahead) return;
    for (let u = this.finalTick + 1; u <= this.localTick; u++) step(this.sim, this.head, this.inputsAt(u));
    this.headTick = this.localTick;
  }

  private inputsAt(t: number): TickInput[] {
    return [...(this.inputs.get(t) ?? []), ...this.people(t)];
  }

  /** The events queued for who, of a kind. */
  events(who: string, kind: number): { at: number; e: EventPayload }[] {
    return this.queued.filter((q) => q.who === who && (q.e.events & kind) !== 0);
  }

  terrier(id: string): MatchState['terriers'][number] | undefined {
    return this.final.terriers[findTerrier(this.final, id)];
  }
}

/** Advances and tends, as the session does once a timer run (roslambo's order). */
function run(t: FakeTimeline, host: BotHost, ticks: number, o: { hostLeft?: boolean; each?: () => void; until?: () => boolean } = {}): void {
  for (let k = 0; k < ticks && !(o.until?.() ?? false); k++) {
    t.advance();
    host.tend(t, o.hostLeft ?? false);
    o.each?.();
  }
}

/** A person present every tick from tick 1: its JOIN at joinAt, into pack, and READY at readyAt. */
function person(id: string, pack: Pack, joinAt = 1, readyAt = -1): (t: number) => TickInput {
  return (t) => {
    const events = (t === joinAt ? JOIN : 0) | (t === readyAt ? READY : 0);
    return events & JOIN ? { id, input: 0, events, joinPack: pack, coat: 0, name: 'P' } : { id, input: 0, events };
  };
}

const ready = (T: { readyUntil: number } | undefined, tick: number): boolean => T !== undefined && T.readyUntil > tick;

describe('BotHost (PLAN §14, D-39)', () => {
  it('hosts its bots under its own IDs, in order, each JOIN with READY, its coat and its name', () => {
    const t = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const host = new BotHost(me, P, B, ROOM);
    expect([host.add(0, t)!.id, host.add(1, t)!.id]).toEqual(ids.slice(0, 2));
    // Named in turn, the second with the first's name taken (the owner, 2026-11-22).
    const names = botNames(ids.slice(0, 2));
    expect(t.queued).toEqual(
      [0, 1].map((k) => ({ who: ids[k], at: 0, e: { events: JOIN | READY, joinPack: k, coat: botCoat(ids[k]!, P.coatCount), name: names[k] } })),
    );
    expect([...t.bots.keys()]).toEqual(ids.slice(0, 2));
    // Its JOIN rides in tick 1 + d, final w later.
    run(t, host, 1 + D + W);
    for (const k of [0, 1]) {
      const T = t.terrier(ids[k]!)!;
      expect([T.pack, T.coat, T.name, T.joinTick, ready(T, t.finalTick)]).toEqual([k, botCoat(ids[k]!, P.coatCount), names[k], 1 + D, true]);
    }
    run(t, host, 600);
    expect(t.queued, 'nothing more once the state shows them').toHaveLength(2);
  });

  it('sends a JOIN again until the state shows it, once its last has been final eventRetryTicks', () => {
    const t = new FakeTimeline({ packSize: 1, matchMinutes: 1 });
    const host = new BotHost(me, P, B, ROOM);
    t.lose.add(ids[0]!);
    host.add(1, t);
    run(t, host, 400);
    // The first, lost, at local tick 0; the second once tick 1 + d had been final eventRetryTicks.
    expect(t.events(ids[0]!, JOIN).map((q) => q.at)).toEqual([0, D + E + 1 + W]);
    expect(t.terrier(ids[0]!)?.joinTick).toBe(D + E + 1 + W + 1 + D);
    expect(host.hosted.map((b) => [b.id, b.wanted, b.joinSentAt])).toEqual([[ids[0], true, -1]]);
  });

  it('keeps a bot ready through a warm-up of minutes: READY again once its Ready has botReadyRenewTicks left (C-41)', () => {
    const R = ROOM.botReadyRenewTicks; // 10 s
    const t = new FakeTimeline({ packSize: 1, matchMinutes: 1 });
    t.people = (tick) => [person(FIRST, 0)(tick)]; // never ready: the warm-up lasts
    const host = new BotHost(me, P, B, ROOM);
    host.add(1, t);
    let joined = false;
    const left: number[] = [];
    let readies = 0;
    run(t, host, 4 * P.readyExpiryTicks, {
      each: () => {
        const T = t.terrier(ids[0]!);
        if (T) joined = true;
        if (joined) expect(ready(T, t.finalTick), `ready at final tick ${t.finalTick}`).toBe(true);
        const n = t.events(ids[0]!, READY).length;
        if (n > readies) {
          readies = n;
          left.push(T ? T.readyUntil - t.finalTick : -1);
        }
      },
    });
    expect(t.final.phase).toBe(WARM_UP);
    // The JOIN's, then one each time 10 s are left, never sooner.
    expect(left[0]).toBe(-1);
    expect(left.length - 1).toBeGreaterThanOrEqual(3);
    expect(left.slice(1)).toEqual(left.slice(1).map(() => R));
  });

  // A READY sent at local tick n, with r ticks of the Ready left in the final state, w behind, rides
  // in tick n + 1 + d; lost, it goes again once the final tick passes n + d + eventRetryTicks, at
  // local tick n + d + w + eventRetryTicks + 1, and rides in tick n + 2d + w + eventRetryTicks + 2.
  // The Ready ends at n − w + r, and a READY for that tick still renews it, so r must be at least
  // 2d + 2w + eventRetryTicks + 2.
  it('lands a READY lost once on its second sending with 2d + 2w + eventRetryTicks + 2 ticks left, and not with one less', () => {
    const bound = 2 * D + 2 * W + E + 2;
    const lapses = (renew: number): number[] => {
      const room: RoomSettings = { ...ROOM, botReadyRenewTicks: renew };
      const t = new FakeTimeline({ packSize: 1, matchMinutes: 1 });
      t.people = (tick) => [person(FIRST, 0)(tick)];
      const host = new BotHost(me, P, B, room);
      host.add(1, t);
      const notReady: number[] = [];
      let lost = false;
      run(t, host, P.readyExpiryTicks + 200, {
        each: () => {
          // The first renewal's TICK reaches everyone late.
          if (!lost && t.events(ids[0]!, READY).length === 2) {
            lost = true;
            t.lose.add(ids[0]!);
          }
          const T = t.terrier(ids[0]!);
          if (T && !ready(T, t.finalTick)) notReady.push(t.finalTick);
        },
      });
      expect(t.events(ids[0]!, READY).length, `renewing with ${renew} ticks left`).toBeGreaterThanOrEqual(3);
      return notReady;
    };
    expect(lapses(bound)).toEqual([]);
    expect(lapses(bound - 1)).toHaveLength(1);
  });

  it('removes the newest wanted bot in a pack: its LEAVE, then unhosted once the LEAVE is final', () => {
    const t = new FakeTimeline({ packSize: 3, matchMinutes: 1 });
    const host = new BotHost(me, P, B, ROOM);
    host.add(0, t);
    host.add(0, t);
    host.add(1, t);
    run(t, host, 1 + D + W);
    expect(t.final.terriers.map((T) => T.id).sort()).toEqual(ids.slice(0, 3).sort());
    expect(host.remove(0, t)).toBe(true);
    const at = t.localTick;
    expect(t.events(ids[1]!, LEAVE).map((q) => q.at)).toEqual([at]);
    const b = host.hosted.find((x) => x.id === ids[1])!;
    expect([b.wanted, b.leaveAt]).toEqual([false, at + 1 + D]);
    // Still sending until its LEAVE is final: an unhosted bot's events would go unsent.
    run(t, host, 1 + D + W - 1);
    expect(t.bots.has(ids[1]!)).toBe(true);
    run(t, host, 1);
    expect([t.bots.has(ids[1]!), host.hosted.map((x) => x.id), t.terrier(ids[1]!)]).toEqual([false, [ids[0], ids[2]], undefined]);
    expect(host.remove(1, t)).toBe(true);
    expect(host.remove(1, t), 'none wanted left in pack B').toBe(false);
    expect(host.remove(0, t)).toBe(true);
    run(t, host, 1 + D + W);
    expect([host.hosted, [...t.bots.keys()], t.final.terriers]).toEqual([[], [], []]);
    // The first free ID again.
    expect(host.add(1, t)!.id).toBe(ids[0]);
  });

  it("never sends a LEAVE in its bot's JOIN's input, where the JOIN would come after it and win (D-12's order)", () => {
    const t = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const host = new BotHost(me, P, B, ROOM);
    run(t, host, 5);
    host.add(0, t);
    expect(host.remove(0, t)).toBe(true);
    expect(t.events(ids[0]!, LEAVE)).toEqual([]);
    run(t, host, 1);
    expect(t.events(ids[0]!, LEAVE).map((q) => q.at)).toEqual([t.localTick]);
    run(t, host, 1 + D + W);
    // In for a tick, then out: unhosted with its LEAVE final.
    expect([host.hosted, t.final.terriers]).toEqual([[], []]);
  });

  it('leaves a bot playing, hosted again, when the roster locked before its LEAVE; a leaving host lets it sit', () => {
    const r = 100; // the person's READY: both packs full and ready, so the start countdown begins there
    for (const hostLeft of [false, true]) {
      const t = new FakeTimeline({ packSize: 1, matchMinutes: 1 });
      t.people = (tick) => [person(FIRST, 0, 1, r)(tick)];
      const host = new BotHost(me, P, B, ROOM);
      host.add(1, t);
      run(t, host, r - 1 + W);
      expect([t.finalTick, t.final.phase]).toEqual([r - 1, WARM_UP]);
      // Its LEAVE rides in a tick after r.
      if (hostLeft) host.removeAll(t);
      else expect(host.remove(1, t)).toBe(true);
      run(t, host, 1 + D + W, { hostLeft });
      expect(t.final.phase).toBe(START_COUNTDOWN);
      expect(t.terrier(ids[0]!), 'still in the roster').toBeDefined();
      expect([host.hosted.map((b) => [b.id, b.wanted]), t.bots.has(ids[0]!)]).toEqual(hostLeft ? [[], false] : [[[ids[0], true]], true]);
      expect(host.remove(1, t), 'from the countdown on').toBe(false);
    }
  });

  it("takes its bots back after a reload, each brain's counters from its terrier's stored previous input (D-10, D-17)", () => {
    const t = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const first = new BotHost(me, P, B, ROOM);
    first.add(0, t);
    first.add(1, t);
    run(t, first, 1 + D + W + 60);
    const base = encodeInput({ jump: 3, pounce: 2 });
    for (const id of ids.slice(0, 2)) t.terrier(id)!.prevInput = base; // as if they had pressed before the reload
    // The page reloads: a new host, a timeline from a peer's STATE.
    const again = new FakeTimeline(t.final);
    const host = new BotHost(me, P, B, ROOM);
    host.adopt(again);
    expect(host.hosted.map((b) => [b.id, b.pack, b.wanted, b.triedOther])).toEqual([[ids[0], 0, true, true], [ids[1], 1, true, true]]);
    expect([...again.bots.keys()]).toEqual(ids.slice(0, 2));
    const brains = host.hosted.map((b) => b.brain);
    run(again, host, 30);
    // In warm-up a brain presses nothing: every input carries the stored counters.
    for (const x of again.sent) expect([jumpCount(x.input), pounceCount(x.input)], x.id).toEqual([3, 2]);
    expect(again.queued, 'neither JOIN nor READY: in the roster, its Ready fresh').toEqual([]);
    // Once for each timeline: a second call doesn't base the brains again.
    host.adopt(again);
    expect(host.hosted.map((b) => b.brain)).toEqual(brains);
    expect(host.hosted[0]!.brain).toBe(brains[0]);
  });

  it("bases an adopted brain on the newest input of the bot's the timeline holds past its final tick, as onControl does (D-10, M3 phase 4)", () => {
    const t = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const first = new BotHost(me, P, B, ROOM);
    first.add(0, t);
    first.add(1, t);
    run(t, first, 1 + D + W + 60);
    const stored = encodeInput({ jump: 1 });
    for (const id of ids.slice(0, 2)) t.terrier(id)!.prevInput = stored;
    // A STATE from before the reload's last inputs: its records past g hold one bot's press after the
    // stored input, bark bits and all, and the other's newest record is g's own, the stored input.
    const again = new FakeTimeline(t.final);
    const g = again.finalTick;
    const newer = encodeInput({ jump: 2, pounce: 1, bark: 3 });
    again.newest.set(ids[0]!, { tick: g + 4, input: newer });
    again.newest.set(ids[1]!, { tick: g, input: encodeInput({ jump: 3 }) });
    const host = new BotHost(me, P, B, ROOM);
    host.adopt(again);
    run(again, host, 30);
    // In warm-up a brain presses nothing: each input carries the counters it was based on.
    const counts = (id: string): [number, number][] => again.sent.filter((x) => x.id === id).map((x) => [jumpCount(x.input), pounceCount(x.input)]);
    expect(new Set(counts(ids[0]!).map((c) => c.join()))).toEqual(new Set(['2,1']));
    expect(new Set(counts(ids[1]!).map((c) => c.join()))).toEqual(new Set(['1,0']));
    expect(counts(ids[0]!)).toHaveLength(30);
  });

  it('gives up a bot whose pack filled first: of two JOINs for its last place, the smaller ID wins (P4)', () => {
    expect(ids.every((id) => FIRST < id)).toBe(true);
    const t = new FakeTimeline({ packSize: 1, matchMinutes: 1 });
    t.people = (tick) => [person(FIRST, 1, 1 + D)(tick)]; // its JOIN in the bot's JOIN's tick
    const host = new BotHost(me, P, B, ROOM);
    expect(host.canAdd(1, t.final, 0)).toBe(true);
    host.add(1, t);
    run(t, host, 1 + D + W - 1);
    expect(host.hosted).toHaveLength(1);
    run(t, host, 1);
    expect([host.hosted, t.bots.size, t.terrier(FIRST)?.pack]).toEqual([[], 0, 1]);
    expect(host.canAdd(1, t.final, 0)).toBe(false);
    expect(host.canAdd(0, t.final, 0)).toBe(true);
    run(t, host, 200);
    expect(t.events(ids[0]!, JOIN), 'given up, never sent again').toHaveLength(1);
  });

  it('gives up a JOIN that the start countdown beat, once it is final', () => {
    const r = 100;
    const t = new FakeTimeline({ packSize: 1, matchMinutes: 1 });
    t.people = (tick) => [person(FIRST, 0, 1, r)(tick), person(personId(5, 9), 1, r, r)(tick)];
    const host = new BotHost(me, P, B, ROOM);
    run(t, host, r - 1 + W);
    // Pack B is empty in the final state, but its JOIN lands after the countdown has begun.
    expect(host.canAdd(1, t.final, 0)).toBe(true);
    host.add(1, t);
    run(t, host, 1 + D + W - 1);
    expect([t.final.phase, host.hosted.length]).toEqual([START_COUNTDOWN, 1]);
    run(t, host, 1);
    expect([host.hosted, t.bots.size, t.terrier(ids[0]!)]).toEqual([[], 0, undefined]);
    expect(host.canAdd(1, t.final, 0)).toBe(false);
    expect(host.add(1, t), 'from the countdown on').toBeNull();
  });

  it("takes the other pack for Play again's bot when its own is full, and stays out when both are (D-12)", () => {
    const fallback = (people: (tick: number) => TickInput[], again: boolean): { pack: Pack | undefined; joins: (number | undefined)[] } => {
      const t = new FakeTimeline({ packSize: 1, matchMinutes: 1 });
      t.people = people;
      const host = new BotHost(me, P, B, ROOM);
      run(t, host, W + 10);
      host.add(0, t, again);
      run(t, host, 3 * (1 + D + W));
      return { pack: t.terrier(ids[0]!)?.pack, joins: t.events(ids[0]!, JOIN).map((q) => q.e.joinPack) };
    };
    const packA = (tick: number): TickInput[] => [person(FIRST, 0)(tick)];
    const both = (tick: number): TickInput[] => [person(FIRST, 0)(tick), person(personId(5, 9), 1)(tick)];
    expect(fallback(packA, true)).toEqual({ pack: 1, joins: [0, 1] });
    expect(fallback(both, true)).toEqual({ pack: undefined, joins: [0] });
    // A bot added by hand stays where it was asked for: given up.
    expect(fallback(packA, false)).toEqual({ pack: undefined, joins: [0] });
  });

  it('waits for a timeline before its JOIN, and without one removes a bot at once (Play again)', () => {
    const t = new FakeTimeline({ packSize: 1, matchMinutes: 1 });
    t.started = false;
    const host = new BotHost(me, P, B, ROOM);
    expect(host.canAdd(0, null, 0)).toBe(true);
    host.add(0, t);
    host.add(1, t);
    host.tend(t, false);
    expect(t.queued).toEqual([]);
    expect(host.remove(1, t)).toBe(true);
    expect([host.hosted.map((b) => b.id), [...t.bots.keys()]]).toEqual([[ids[0]], [ids[0]]]);
    t.started = true;
    host.adopt(t);
    host.tend(t, false);
    expect(t.queued.map((q) => [q.who, q.e.events, q.e.joinPack])).toEqual([[ids[0], JOIN | READY, 0]]);
  });

  it('counts the places left, its own JOINs on their way and the caller’s, before the start countdown only', () => {
    const t = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    t.people = (tick) => [person(FIRST, 0)(tick)];
    const host = new BotHost(me, P, B, ROOM);
    run(t, host, 1 + W);
    expect([host.canAdd(0, t.final, 0), host.canAdd(0, t.final, 1), host.canAdd(1, t.final, 1)]).toEqual([true, false, true]);
    host.add(0, t);
    expect(host.canAdd(0, t.final, 0), "its own bot's JOIN on its way").toBe(false);
    host.add(1, t);
    expect([host.canAdd(1, t.final, 0), host.canAdd(1, t.final, 1)]).toEqual([true, false]);
    run(t, host, 1 + D + W);
    expect([host.canAdd(0, t.final, 0), host.canAdd(1, t.final, 0)]).toEqual([false, true]);
    // Without a timeline only its 8 IDs bound it.
    const none = new BotHost(me, P, B, ROOM);
    const unheld = new FakeTimeline({ packSize: 4, matchMinutes: 1 });
    unheld.started = false;
    for (let k = 0; k < ids.length; k++) expect(none.add((k % 2) as Pack, unheld)?.id).toBe(ids[k]);
    expect([none.canAdd(0, null, 0), none.add(0, unheld)]).toEqual([false, null]);
    // From the start countdown on, none.
    const locked = cloneState(t.final);
    locked.phase = START_COUNTDOWN;
    expect(host.canAdd(1, locked, 0)).toBe(false);
  });

  it('skips an ID still in the roster that it no longer hosts', () => {
    const t = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const first = new BotHost(me, P, B, ROOM);
    first.add(0, t);
    run(t, first, 1 + D + W);
    // Another page with the same ID that hasn't adopted: its first bot ID belongs to a terrier.
    const other = new BotHost(me, P, B, ROOM);
    expect(other.add(1, t)!.id).toBe(ids[1]);
  });

  it('thinks once per head tick: the ticks a catch-up sends and a held head get one input, pressing once (M3-Q25)', () => {
    // In play, the bot behind the ball, lined up with the goal it attacks and in reach: it pounces.
    const s = placedMatch(P, 1, { phase: IN_PLAY });
    s.terriers[0]!.id = ids[0]!;
    s.terriers[0]!.name = botName(ids[0]!);
    placeBall(P, s, 0, 0);
    place(P, s, 0, -2.4, 0);
    s.terriers[0]!.heading = 0;
    park(P, s, 1);
    const rival = s.terriers[1]!.id;
    const t = new FakeTimeline(s);
    // The head runs w ahead of the final state, as the real timeline's: the bot reads the head.
    t.ahead = true;
    t.people = () => [{ id: rival, input: 0, events: 0 }];
    const host = new BotHost(me, P, B, ROOM);
    host.adopt(t);
    // Thought on at every send, it would press at each.
    const every = newBrain(ids[0]!, 0, P, B);
    expect([0, 1, 2].map(() => pounceCount(think(every, t.head)))).toEqual([1, 2, 3]);
    // A catch-up: three ticks sent in one run, on one head.
    t.advance(3);
    host.tend(t, false);
    const caught = t.sent.map((x) => x.input);
    expect(caught.map(pounceCount)).toEqual([1, 1, 1]);
    expect(new Set(caught).size).toBe(1);
    // A spread holds the head: its input holds too, thought once on the head held.
    t.held = true;
    run(t, host, 4);
    t.held = false;
    run(t, host, 20);
    const held = t.sent.slice(3, 7);
    expect(new Set(held.map((x) => x.headTick)).size).toBe(1);
    expect(new Set(held.map((x) => x.input)).size).toBe(1);
    // Each input is a brain's that thought once on each new head, in order, never on the final state.
    expect([t.headTick, t.headTick - t.finalTick]).toEqual([t.localTick, W]);
    const ref = newBrain(ids[0]!, 0, P, B);
    let thought = -1;
    let input = 0;
    for (const x of t.sent) {
      if (x.headTick !== thought) {
        input = think(ref, x.head);
        thought = x.headTick;
      }
      expect(x.input, `tick ${x.tick}`).toBe(input);
    }
    expect(new Set(t.sent.map((x) => x.headTick)).size).toBeGreaterThan(10);
  });

  it('sends every pending JOIN and READY, and a LEAVE, again in a new timeline, its samplers reading it', () => {
    const t = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const host = new BotHost(me, P, B, ROOM);
    host.add(0, t);
    host.add(1, t);
    run(t, host, 1 + D + W);
    t.lose.add(ids[2]!);
    host.add(0, t); // its JOIN lost, and the timeline gone before it goes again
    expect(host.remove(1, t)).toBe(true);
    run(t, host, 2);
    // A merge's or a rejoin's timeline: the state as it stood, before the LEAVE or the JOIN landed.
    const next = new FakeTimeline(t.final);
    host.reset(next);
    host.adopt(next);
    expect([...next.bots.keys()].sort()).toEqual(ids.slice(0, 3).sort());
    host.tend(next, false);
    expect(next.queued.map((q) => [q.who, q.e.events])).toEqual([[ids[1], LEAVE], [ids[2], JOIN | READY]]);
    // Once for each timeline: a second reset, with the LEAVE and the JOIN still in flight, sends neither again.
    host.reset(next);
    host.tend(next, false);
    expect(next.queued).toHaveLength(2);
    run(next, host, 1 + D + W);
    expect(next.final.terriers.map((T) => T.id).sort()).toEqual([ids[0], ids[2]].sort());
    expect(host.hosted.map((b) => b.id)).toEqual([ids[0], ids[2]]);
    // The samplers read the new timeline's head.
    const x = next.sent.find((y) => y.id === ids[0])!;
    expect(x.head).not.toBe(t.head);
    expect(next.sent.every((y) => y.headTick >= t.finalTick)).toBe(true);
    // Once for each timeline.
    const queued = next.queued.length;
    host.reset(next);
    host.tend(next, false);
    expect(next.queued).toHaveLength(queued);
  });

  it('sends a READY renewal still on its way again in a new timeline, at once', () => {
    // Renewed 40 ticks after the JOIN lands, so the renewal comes soon.
    const room: RoomSettings = { ...ROOM, botReadyRenewTicks: P.readyExpiryTicks - 40 };
    const t = new FakeTimeline({ packSize: 1, matchMinutes: 1 });
    const host = new BotHost(me, P, B, room);
    host.add(1, t);
    run(t, host, 400, { until: () => t.events(ids[0]!, READY).length >= 2 });
    // The renewal is queued, not yet final: the new timeline's state shows the Ready as it was.
    const next = new FakeTimeline(t.final);
    host.reset(next);
    host.adopt(next);
    host.tend(next, false);
    expect(next.queued.map((q) => [q.who, q.e.events])).toEqual([[ids[0], READY]]);
  });

  it("adopts a bot it hosts already into a new timeline: its pack and its counters from the state, thinking afresh (design §4.6)", () => {
    const t = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const host = new BotHost(me, P, B, ROOM);
    host.add(0, t);
    run(t, host, 1 + D + W + 30);
    const brain = host.hosted[0]!.brain;
    const thought = t.sent[t.sent.length - 1]!.headTick;
    // A merge's timeline, where the same bot joined pack B and pressed jump and pounce, at the tick it last thought on.
    const other = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const pressed = encodeInput({ jump: 3, pounce: 2 });
    other.people = (tick) => [
      tick === 1 ? { id: ids[0]!, input: pressed, events: JOIN | READY, joinPack: 1, coat: 0, name: 'x' } : { id: ids[0]!, input: pressed, events: 0 },
    ];
    while (other.finalTick < thought) other.advance();
    const next = new FakeTimeline(other.final);
    expect([next.headTick, next.terrier(ids[0]!)?.pack, next.terrier(ids[0]!)?.prevInput]).toEqual([thought, 1, pressed]);
    host.adopt(next);
    expect(host.hosted.map((b) => [b.id, b.pack, b.wanted])).toEqual([[ids[0], 1, true]]);
    expect(host.hosted[0]!.brain).not.toBe(brain);
    expect(next.bots.has(ids[0]!)).toBe(true);
    next.advance();
    // In warm-up a brain presses nothing: its first input carries the counters it was based on.
    const first = next.sent.find((x) => x.id === ids[0])!;
    expect([first.headTick, jumpCount(first.input), pounceCount(first.input)]).toEqual([thought, 3, 2]);
  });

  it("thinks afresh on a new timeline's head, though it stands at the tick the bot last thought on", () => {
    const t = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const host = new BotHost(me, P, B, ROOM);
    host.add(0, t);
    run(t, host, 1 + D + W + 30);
    const last = t.sent[t.sent.length - 1]!;
    // A rejoin's timeline at that tick, the bot standing elsewhere on the floor.
    const s = cloneState(t.final);
    s.tick = last.headTick;
    const T = s.terriers[findTerrier(s, ids[0]!)]!;
    T.x = -T.x;
    T.y = -T.y;
    const next = new FakeTimeline(s);
    host.reset(next);
    next.advance();
    // The brain, fed every head it was, then this one: what the first input in the new timeline is.
    const ref = newBrain(ids[0]!, 0, P, B);
    let thought = -1;
    for (const x of t.sent) {
      if (x.headTick === thought) continue;
      think(ref, x.head);
      thought = x.headTick;
    }
    const want = think(ref, s);
    expect(want).not.toBe(last.input);
    expect(next.sent.map((x) => [x.headTick, x.input])).toEqual([[last.headTick, want]]);
  });

  it('takes every wanted bot out when its host leaves before the countdown (PLAN §14)', () => {
    const t = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const host = new BotHost(me, P, B, ROOM);
    host.add(0, t);
    host.add(1, t);
    host.add(1, t);
    run(t, host, 1 + D + W);
    expect(t.final.terriers).toHaveLength(3);
    // The newest in pack B already on its way out: removeAll sends the other two theirs.
    expect(host.remove(1, t)).toBe(true);
    host.removeAll(t);
    expect(ids.slice(0, 3).map((id) => t.events(id, LEAVE).length)).toEqual([1, 1, 1]);
    run(t, host, 1 + D + W, { hostLeft: true });
    expect([host.hosted, t.final.terriers, [...t.bots.keys()]]).toEqual([[], [], []]);
  });

  it('sends a LEAVE again while the state still shows the bot once it was final: a repair undid it', () => {
    const t = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const host = new BotHost(me, P, B, ROOM);
    host.add(0, t);
    run(t, host, 1 + D + W);
    const at = t.localTick;
    // Its LEAVE is left out of the final inputs, as a winner's lineage that never had it would.
    t.lose.add(ids[0]!);
    expect(host.remove(0, t)).toBe(true);
    run(t, host, 1 + D + W);
    expect(t.events(ids[0]!, LEAVE).map((q) => q.at)).toEqual([at, at + 1 + D + W]);
    expect([t.bots.has(ids[0]!), t.terrier(ids[0]!) !== undefined]).toEqual([true, true]);
    run(t, host, 1 + D + W);
    expect([host.hosted, t.final.terriers]).toEqual([[], []]);
  });

  it('renews no READY from the start countdown on, when every event is ignored', () => {
    const s = placedMatch(P, 1, { phase: IN_PLAY });
    s.terriers[0]!.id = ids[0]!;
    const rival = s.terriers[1]!.id;
    const t = new FakeTimeline(s);
    t.people = () => [{ id: rival, input: 0, events: 0 }];
    const host = new BotHost(me, P, B, ROOM);
    host.adopt(t);
    expect(t.terrier(ids[0]!)!.readyUntil - t.final.tick).toBeLessThanOrEqual(ROOM.botReadyRenewTicks);
    run(t, host, 200);
    expect(t.queued).toEqual([]);
  });
});

// --- Names (the owner, 2026-11-22) ---

/** A person present every tick from tick 1, named: its JOIN at joinAt, into pack. */
function namedPerson(id: string, pack: Pack, name: string, joinAt = 1): (t: number) => TickInput {
  return (t) => (t === joinAt ? { id, input: 0, events: JOIN, joinPack: pack, coat: 0, name } : { id, input: 0, events: 0 });
}

/** The list's k-th name from id's first choice on, round the end: what its walk meets. */
const walk = (id: string, k: number): string => BOT_NAMES[(BOT_NAMES.indexOf(botName(id)) + k) % BOT_NAMES.length]!;

/** Each JOIN's name queued for a bot, in order. */
const joinNames = (t: FakeTimeline, id: string): (string | undefined)[] => t.events(id, JOIN).map((q) => q.e.name);

/** The final state's names, which must differ. */
const finalNames = (t: FakeTimeline): string[] => t.final.terriers.map((T) => T.name);

describe("BotHost's names (the owner, 2026-11-22)", () => {
  it("names every bot it adds in one go apart, none as its player, whose JOIN the state doesn't show yet (Practice's genesis)", () => {
    // This browser's player is named as its first bot would be, and JOINs beside its bots, as Practice's does.
    const mine = walk(ids[0]!, 0);
    const t = new FakeTimeline({ packSize: 4, matchMinutes: 1 });
    t.people = (tick) => [namedPerson(me, 0, mine, 1 + D)(tick)];
    const host = new BotHost(me, P, B, ROOM, mine);
    for (let k = 1; k < 4; k++) host.add(0, t);
    for (let k = 0; k < 4; k++) host.add(1, t);
    const want = botNames(ids.slice(0, 7), [mine]);
    expect(ids.slice(0, 7).map((id) => joinNames(t, id))).toEqual(want.map((name) => [name]));
    expect(want[0], "its first bot walks past its player's name").toBe(walk(ids[0]!, 1));
    run(t, host, 1 + D + W);
    const names = finalNames(t);
    expect(names).toHaveLength(8);
    expect(new Set(names).size, names.join(', ')).toBe(8);
    expect(names.filter((n) => n !== mine).every((n) => BOT_NAMES.includes(n))).toBe(true);
  });

  it('takes no name a terrier has in the final state or the head: a person, another host\'s bot, or a JOIN only the head shows yet', () => {
    // Another host whose first bot's first choice is this host's first bot's.
    let other = '';
    for (let k = 0; other === ''; k++) if (botName(botId(personId(9, k), 0)) === walk(ids[0]!, 0)) other = botId(personId(9, k), 0);
    const x = personId(6, 0);
    const z = personId(6, 1);
    const t = new FakeTimeline({ packSize: 4, matchMinutes: 1 });
    t.ahead = true;
    const late = 60; // z's JOIN: in the head once the clock passes it, final w later
    t.people = (tick) => [
      namedPerson(other, 1, walk(ids[0]!, 0))(tick), namedPerson(x, 0, walk(ids[0]!, 1))(tick), namedPerson(z, 1, walk(ids[0]!, 2), late)(tick),
    ];
    const host = new BotHost(me, P, B, ROOM);
    run(t, host, late);
    expect([t.terrier(z), findTerrier(t.head, z) >= 0], "z's JOIN in the head alone").toEqual([undefined, true]);
    host.add(0, t);
    expect(joinNames(t, ids[0]!)).toEqual([walk(ids[0]!, 3)]);
    run(t, host, 1 + D + W);
    expect(new Set(finalNames(t)).size).toBe(4);
  });

  it("names a bot added as another leaves apart from it, and an ID that comes back its own name again (Remove, Practice's swap)", () => {
    // A host whose first two bots would choose one name first.
    let h = '';
    for (let k = 0; h === ''; k++) if (botName(botId(personId(9, k), 0)) === botName(botId(personId(9, k), 1))) h = personId(9, k);
    const [b0, b1] = botIds(h) as [string, string];
    const t = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const host = new BotHost(h, P, B, ROOM);
    host.add(0, t);
    run(t, host, 1 + D + W);
    const first = t.terrier(b0)!.name;
    expect(first).toBe(botName(b0));
    // In one tick, as Practice's Switch pack: a new bot, the next ID, in the other pack, and the first's LEAVE.
    expect(host.add(1, t)!.id).toBe(b1);
    expect(host.remove(0, t)).toBe(true);
    expect(joinNames(t, b1)).toEqual([walk(b1, 1)]);
    expect(walk(b1, 0), "the name it would take first, the leaving bot's").toBe(first);
    run(t, host, 2 * (1 + D + W));
    expect([host.hosted.map((b) => b.id), finalNames(t)]).toEqual([[b1], [walk(b1, 1)]]);
    // The first ID free again: it comes back, and its name with it.
    expect(host.add(0, t)!.id).toBe(b0);
    expect(joinNames(t, b0)).toEqual([first, first]);
  });

  it("waits for a timeline to name Play again's bots, then names them apart and clear of the state's (D-12)", () => {
    // The next match as a STATE brings it: a person in it already, named as the first bot would be.
    const s = genesis({ packSize: 2, matchMinutes: 1 }, P);
    const sim = makeSim(P, 2);
    const x = personId(6, 0);
    const taken = walk(ids[0]!, 0);
    for (let u = 1; u <= 3; u++) step(sim, s, [namedPerson(x, 0, taken)(u)]);
    const t = new FakeTimeline(s);
    t.people = (tick) => [namedPerson(x, 0, taken, -1)(tick)];
    t.started = false;
    const host = new BotHost(me, P, B, ROOM);
    host.add(0, t, true);
    host.add(1, t, true);
    host.tend(t, false);
    expect(t.queued, 'no name before a timeline').toEqual([]);
    t.started = true;
    host.adopt(t);
    host.tend(t, false);
    const want = botNames(ids.slice(0, 2), [taken]);
    expect(ids.slice(0, 2).map((id) => joinNames(t, id))).toEqual(want.map((name) => [name]));
    run(t, host, 1 + D + W);
    expect(finalNames(t).sort()).toEqual([taken, ...want].sort());
    expect(new Set(finalNames(t)).size).toBe(3);
  });

  it("names a JOIN that goes again afresh: a person who took its name meanwhile keeps it, and so does a new timeline's", () => {
    const t = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const x = personId(6, 0);
    const name = walk(ids[0]!, 0);
    t.people = (tick) => [namedPerson(x, 0, name, 5)(tick)];
    const host = new BotHost(me, P, B, ROOM);
    // Its first JOIN lost; before it goes again, x joins under the name it carried.
    t.lose.add(ids[0]!);
    host.add(1, t);
    run(t, host, 400);
    expect(joinNames(t, ids[0]!)).toEqual([name, walk(ids[0]!, 1)]);
    expect([t.terrier(x)!.name, t.terrier(ids[0]!)!.name]).toEqual([name, walk(ids[0]!, 1)]);
    // A JOIN on its way when a merge's timeline comes goes again in it, named from what that one holds:
    // there y joined under the name the JOIN carried.
    const a = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const other = new BotHost(me, P, B, ROOM);
    a.lose.add(ids[0]!);
    other.add(1, a);
    expect(joinNames(a, ids[0]!)).toEqual([name]);
    const merged = new FakeTimeline({ packSize: 2, matchMinutes: 1 });
    const y = personId(6, 1);
    merged.people = (tick) => [namedPerson(y, 0, name)(tick)];
    while (merged.finalTick <= 1) merged.advance();
    expect(merged.terrier(y)!.name).toBe(name);
    const next = new FakeTimeline(merged.final);
    next.people = merged.people;
    other.reset(next);
    other.adopt(next);
    other.tend(next, false);
    expect(joinNames(next, ids[0]!)).toEqual([walk(ids[0]!, 1)]);
  });
});

// --- Over the real timeline (design §2.4, §4.8; M3 phase 2's integration) ---

describe('BotHost over the real timeline (design §2.4, §4.8)', () => {
  const MATCH = 'feedfacecafebeef';
  const bot = ids[0]!;
  const WIRE = wireLimits();

  /** The bot's LEAVE in a TICK, as the tick it's for. */
  const leaveIn = (m: Tick): number | null => {
    const e = m.bots.find((b) => b.id === bot)?.events.find((x) => (x.events & LEAVE) !== 0);
    return e === undefined ? null : m.t - e.back;
  };

  /** A host, sending nothing of its own, whose bot is in pack B, and a person x in pack A from tick
   *  1 + d, READY at readyAt (−1: never), whose TICKs the test writes. The bot is removed at local
   *  tick 40 and the host's next timer run comes stallTicks later, a catch-up that sends only its
   *  newest stallSendTicks ticks. Each timer run advances, then tends, as the session does. */
  function removedThenStalled(stallTicks: number, readyAt: number) {
    const leaves: number[] = [];
    const t = new Timeline({ ...NET.timeline, P, me }, {
      broadcast: (bytes) => {
        const u = leaveIn(decode(bytes, P, WIRE) as Tick);
        if (u !== null) leaves.push(u);
      },
      sendToPlayer: () => false,
      sendToPeer: () => {},
    });
    t.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    const host = new BotHost(me, P, B, ROOM);
    host.add(1, t);
    const x = personId(6, 0);
    const xs = new Map<number, number>();
    const fromX = (u: number, now: number): void => {
      xs.set(u, 0);
      const events: TickEvent[] = [];
      if (u === 1 + D) events.push({ back: 0, events: JOIN, joinPack: 0, coat: 0, name: 'x' });
      if (u === readyAt) events.push({ back: 0, events: READY });
      t.onTick(x, tickOf(xs, u, events), now, true);
    };
    // The final tick at the first timer run that found the bot unhosted, and any where the state still showed it.
    const seen = { unhostedAt: -1, shownUnhosted: [] as number[] };
    const timer = (n: number): void => {
      t.advance(at(n));
      host.tend(t, false);
      const hosted = t.bots.has(bot);
      if (!hosted && seen.unhostedAt < 0) seen.unhostedAt = t.finalTick;
      if (!hosted && findTerrier(t.final, bot) >= 0) seen.shownUnhosted.push(t.finalTick);
    };
    for (let n = 1; n <= 40; n++) {
      timer(n);
      fromX(n + D, at(n));
    }
    expect([findTerrier(t.final, bot) >= 0, findTerrier(t.final, x) >= 0, t.final.phase]).toEqual([true, true, WARM_UP]);
    expect(host.remove(1, t)).toBe(true);
    expect(host.hosted[0]!.leaveAt).toBe(40 + 1 + D);
    timer(40 + stallTicks);
    for (let n = 41; n <= 40 + stallTicks; n++) fromX(n + D, at(40 + stallTicks));
    for (let n = 41 + stallTicks; n <= 400; n++) {
      timer(n);
      fromX(n + D, at(n));
    }
    return { t, host, leaves, seen };
  }

  const STALL = 24;
  // The catch-up's first tick sent carries the LEAVE: its newest stallSendTicks ticks, from 40 + 24 − 3 + 1.
  const RIDES = 40 + STALL - NET.timeline.stallSendTicks + 1 + D;

  it("waits for a JOIN a catch-up sent late before giving up its full pack: a place freed in the JOIN's tick takes it", () => {
    const t = new Timeline({ ...NET.timeline, P, me }, { broadcast: () => {}, sendToPlayer: () => false, sendToPeer: () => {} });
    t.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    const host = new BotHost(me, P, B, ROOM);
    // x holds pack B from tick 1 + d and leaves in the tick the bot's late JOIN rides in.
    const x = personId(6, 0);
    const xs = new Map<number, number>();
    const fromX = (u: number, now: number): void => {
      xs.set(u, 0);
      const events: TickEvent[] = [];
      if (u === 1 + D) events.push({ back: 0, events: JOIN, joinPack: 1, coat: 0, name: 'x' });
      if (u === RIDES) events.push({ back: 0, events: LEAVE });
      t.onTick(x, tickOf(xs, u, events), now, true);
    };
    const shownUnhosted: number[] = [];
    const timer = (n: number): void => {
      t.advance(at(n));
      host.tend(t, false);
      if (!t.bots.has(bot) && findTerrier(t.final, bot) >= 0) shownUnhosted.push(t.finalTick);
    };
    for (let n = 1; n <= 40; n++) {
      timer(n);
      fromX(n + D, at(n));
    }
    // Pack B is full, so only the place x's LEAVE frees can take the bot: add checks no places (D-22's swap).
    expect(host.add(1, t)?.id).toBe(bot);
    timer(40 + STALL);
    for (let n = 41; n <= 40 + STALL; n++) fromX(n + D, at(40 + STALL));
    for (let n = 41 + STALL; n <= 200; n++) {
      timer(n);
      fromX(n + D, at(n));
    }
    const T = t.final.terriers[findTerrier(t.final, bot)];
    expect([T?.pack, T?.joinTick, findTerrier(t.final, x), shownUnhosted]).toEqual([1, RIDES, -1, []]);
    expect(host.hosted.map((b) => [b.id, b.wanted])).toEqual([[bot, true]]);
  });

  /** A host, sending nothing of its own, whose bot is for pack B, added at local tick 0, or at stallAt
   *  if `addAt` says so, and a person x in pack A from tick 1 + d who never readies, whose TICKs the
   *  test writes. After local tick stallAt's timer run, the host's next comes 60 ticks later, a
   *  catch-up that sends only its newest stallSendTicks ticks, so what it queued at stallAt rides late
   *  (design §2.4). Each timer run advances, then tends, as the session does. Returns the ticks the
   *  bot's JOINs and READYs rode in, each once, in order, and `late`, the catch-up's first tick. */
  const CATCH_UP = 60;
  /** The tick a catch-up CATCH_UP ticks after local tick n sends first: its newest stallSendTicks. */
  const lateAfter = (n: number): number => n + CATCH_UP - NET.timeline.stallSendTicks + 1 + D;
  function queuedThenStalled(room: RoomSettings, stallAt: number, until: number, addAt: 'start' | 'stall') {
    const rode = { join: [] as number[], ready: [] as number[] };
    const t = new Timeline({ ...NET.timeline, P, me }, {
      broadcast: (bytes) => {
        const m = decode(bytes, P, WIRE) as Tick;
        for (const e of m.bots.find((b) => b.id === bot)?.events ?? []) {
          const u = m.t - e.back;
          if ((e.events & JOIN) !== 0 && !rode.join.includes(u)) rode.join.push(u);
          if ((e.events & READY) !== 0 && !rode.ready.includes(u)) rode.ready.push(u);
        }
      },
      sendToPlayer: () => false,
      sendToPeer: () => {},
    });
    t.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    const host = new BotHost(me, P, B, room);
    if (addAt === 'start') host.add(1, t);
    const x = personId(6, 0);
    const xs = new Map<number, number>();
    const fromX = (u: number, now: number): void => {
      xs.set(u, 0);
      const events: TickEvent[] = u === 1 + D ? [{ back: 0, events: JOIN, joinPack: 0, coat: 0, name: 'x' }] : [];
      t.onTick(x, tickOf(xs, u, events), now, true);
    };
    const timer = (n: number): void => {
      t.advance(at(n));
      host.tend(t, false);
    };
    for (let n = 1; n <= stallAt; n++) {
      timer(n);
      fromX(n + D, at(n));
    }
    if (addAt === 'stall') host.add(1, t);
    timer(stallAt + CATCH_UP);
    for (let n = stallAt + 1; n <= stallAt + CATCH_UP; n++) fromX(n + D, at(stallAt + CATCH_UP));
    for (let n = stallAt + CATCH_UP + 1; n <= until; n++) {
      timer(n);
      fromX(n + D, at(n));
    }
    return { t, rode, late: lateAfter(stallAt) };
  }

  it('sends a JOIN that a catch-up sent late once, not again while it rides though its retry is due (M3 phase 4)', () => {
    // Added at local tick 40: the catch-up that follows sends its JOIN for 98 + d, when the final
    // tick, 88, is past the retry's, 40 + d + eventRetryTicks.
    const { t, rode, late } = queuedThenStalled(ROOM, 40, 200, 'stall');
    expect(late - W).toBeGreaterThan(40 + D + E);
    expect(rode.join).toEqual([late]);
    const T = t.final.terriers[findTerrier(t.final, bot)];
    expect([T?.pack, T?.joinTick]).toEqual([1, late]);
  });

  it('sends a READY renewal that a catch-up sent late once, not again while it rides though its retry is due (C-41, M3 phase 4)', () => {
    // Renewed 40 ticks after the JOIN lands, at final tick 1 + d + 40, queued at local tick w later;
    // the catch-up that follows sends it late, its retry due before it's final. Up to the next renewal.
    const room: RoomSettings = { ...ROOM, botReadyRenewTicks: P.readyExpiryTicks - 40 };
    const renewAt = 1 + D + 40 + W;
    const { t, rode, late } = queuedThenStalled(room, renewAt, lateAfter(renewAt) + W + 30, 'start');
    expect(late - W).toBeGreaterThan(renewAt + D + E);
    expect(rode.ready).toEqual([1 + D, late]);
    expect(t.final.terriers[findTerrier(t.final, bot)]!.readyUntil).toBe(late + P.readyExpiryTicks);
  });

  it("keeps a removed bot hosted until its LEAVE is final here, however late a catch-up sent it", () => {
    const { t, host, leaves, seen } = removedThenStalled(STALL, -1);
    expect(RIDES).toBeGreaterThan(40 + 1 + D);
    // It rode in every TICK until its tick was final here, and the bot went with it.
    expect(new Set(leaves)).toEqual(new Set([RIDES]));
    expect(leaves.length).toBeGreaterThanOrEqual(W);
    expect([seen.unhostedAt, seen.shownUnhosted]).toEqual([RIDES, []]);
    expect([host.hosted, findTerrier(t.final, bot), t.final.phase]).toEqual([[], -1, WARM_UP]);
  });

  it('hosts it again when the roster locked before that LEAVE landed: it plays (roslambo)', () => {
    // x readies at 60: both packs full and ready, the start countdown begins before the LEAVE's tick.
    const { t, host, seen } = removedThenStalled(STALL, 60);
    expect(t.final.phase).toBe(IN_PLAY);
    expect([seen.unhostedAt, seen.shownUnhosted]).toEqual([-1, []]);
    expect(host.hosted.map((b) => [b.id, b.wanted])).toEqual([[bot, true]]);
    const T = t.final.terriers[findTerrier(t.final, bot)]!;
    expect([T.sitting, t.finalTick - T.lastInputTick]).toEqual([false, 0]);
  });

  it("keeps a bot hosted while a LEAVE a STATE wiped out rides again, until it's final here (M3 phase 1's answers)", () => {
    const sent: Tick[] = [];
    const t = new Timeline({ ...NET.timeline, P, me, verify: 1 }, {
      broadcast: (bytes) => sent.push(decode(bytes, P, WIRE) as Tick),
      sendToPlayer: () => true,
      sendToPeer: () => {},
    });
    const host = new BotHost(me, P, B, ROOM);
    t.start(0, { packSize: 2, matchMinutes: 1 }, MATCH);
    t.sending = true;
    t.queueEvent(me, { events: JOIN, joinPack: 0, coat: 1, name: 'me' });
    host.add(1, t);
    // Two remote players whose TICKs the test writes: they join at once and hold nothing.
    const [x, y] = [personId(6, 0), personId(6, 1)];
    const held = new Map<number, number>();
    const remote = (n: number, vote: [number, string]): void => {
      held.set(n + D, 0);
      for (const [id, pack] of [[x, 1], [y, 0]] as const) {
        const events: TickEvent[] = n === 1 ? [{ back: 0, events: JOIN, joinPack: pack, coat: 2, name: 'r' }] : [];
        t.onTick(id, tickOf(held, n + D, events, ...vote), at(n), true);
      }
    };
    let n = 0;
    const tickTo = (to: number, vote: [number, string] = [NO_TICK, ZERO_HASH]): void => {
      while (n < to) {
        n++;
        t.advance(at(n));
        host.tend(t, false);
        remote(n, vote);
      }
    };
    tickTo(52);
    const g = t.finalTick;
    expect(findTerrier(t.final, bot)).toBeGreaterThanOrEqual(0);
    // x and y vote for another state at g: this browser loses its tally 2 to 1 and asks for it.
    const theirs = { ...t.final, ball: { ...t.final.ball, vx: t.final.ball.vx + 1 } };
    const bytes = encodeState(theirs);
    const win = hash64(bytes);
    tickTo(g + W + V - 4, [g, win]);
    expect(host.remove(1, t)).toBe(true);
    tickTo(g + W + V - 3, [g, win]);
    const leaveTick = sent[sent.length - 1]!.t;
    expect(leaveIn(sent[sent.length - 1]!)).toBe(leaveTick);
    tickTo(g + W + V, [g, win]);
    expect(t.repairing).toBe(true);
    // The winner's STATE: its records keep every sender, the bot without its LEAVE.
    const senderFinal = leaveTick + 1;
    const inputs: InputRecord[][] = [];
    for (let u = g + 1; u <= senderFinal + D; u++) {
      inputs.push([x, y, me, bot].sort().map((player) => ({ player, input: t.receivedInput(player, u) ?? 0, events: 0 })));
    }
    const wire = encodeStateMessage({ timeline: MATCH, senderTick: senderFinal, phase: 0, g, senderFinal, state: bytes, inputs }, theirs.terriers.map((z) => z.id), WIRE);
    expect(t.onState('peer-x', decode(wire.bytes, P, WIRE) as StateMsg, 0, at(n))).toBe(true);
    host.tend(t, false);
    // The LEAVE goes again with the bot's next input, and rides until that tick is final here.
    const after = sent.length;
    let unhostedAt = -1;
    while (n < g + W + V + 4 * W) {
      tickTo(n + 1);
      if (unhostedAt < 0 && !t.bots.has(bot)) unhostedAt = t.finalTick;
      if (!t.bots.has(bot)) expect(findTerrier(t.final, bot)).toBe(-1);
    }
    const moved = sent.slice(after).map(leaveIn).filter((u) => u !== null);
    expect(moved.length).toBeGreaterThanOrEqual(W);
    expect(new Set(moved).size).toBe(1);
    expect(moved[0]).toBeGreaterThan(leaveTick);
    expect(unhostedAt).toBe(moved[0]);
    expect([host.hosted, t.stats.resyncs, t.stats.verifyMismatches]).toEqual([[], 1, 0]);
  });
});
