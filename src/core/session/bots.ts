// The bots this browser hosts (PLAN §14, D-39, C-41; M3's design,
// research/m3/DESIGN.md, §1.11, §4.8, §4.9): their IDs, coats and names,
// their brains, their JOINs until the state shows them, their READYs before
// they expire, their removal, and their adoption after a reload.
// roslambo's HostedBot, addBot, removeBot, adoptBots and tendBots
// (src/core/session/session.ts), changed:
// - packs, and Play again's pack fallback (D-12);
// - brains (newBrain, think) instead of roslambo's stateless botButtons,
//   each thinking once per head tick (M3-Q25);
// - a bot's READY goes again once its Ready has botReadyRenewTicks left,
//   where roslambo's went once it had expired, which left the bot not ready
//   for a moment (C-41, M3-Q17);
// - a LEAVE never rides in the input its bot's JOIN rides in, where the
//   JOIN would win (D-12's order), and goes again in a new timeline;
// - a removed bot stays hosted until the final state no longer shows it
//   and neither its JOIN nor its LEAVE is in flight, wherever a catch-up or
//   a STATE put them, where roslambo unhosted it at the tick it worked out
//   when the LEAVE was queued; a LEAVE a repair's lineage undid goes again
//   (M3 phase 2's integration);
// - a JOIN's retry and a READY's renewal skip their re-send while the event
//   is in flight, and go once its tick is final without the state showing
//   it, as the session's retries do (M3 phase 3's answers, phase 4);
// - an adopted bot's brain starts from the newest input of its own that the
//   timeline holds past the final tick, else its terrier's stored previous
//   input, as the session's onControl does (D-10, M3 phase 4);
// - a narrow timeline interface, BotTimeline, so this builds beside the
//   timeline (design §0): timeline.ts's Timeline satisfies it, which the
//   session's tests assert.
// Pure: the timeline it's handed is its only way out.

import { botCoat, botIds, botName } from '../bot/bot-id';
import { type BotParams, type Brain, newBrain, think } from '../bot/brain';
import type { EventPayload } from '../protocol/messages';
import { findTerrier, JOIN, KEPT_BITS, LEAVE, type MatchState, type Pack, packCount, READY, type SimParams, WARM_UP } from '../sim/index';
import type { RoomSettings } from './settings';

/** What BotHost needs of a timeline, declared here so bot-host builds beside the timeline (design §0);
 *  timeline.ts's Timeline satisfies it, which the session's tests assert. */
export interface BotTimeline {
  /** A timeline is held: started, or adopted from a STATE. Before, no event can be queued. */
  readonly started: boolean;
  readonly final: Readonly<MatchState>;
  readonly head: Readonly<MatchState>;
  readonly headTick: number;
  readonly finalTick: number;
  readonly localTick: number;
  readonly cfg: { readonly delay: number };
  /** Hosted bots' inputs, sampled once a sent tick (D-39, design §4.8). */
  readonly bots: Map<string, () => number>;
  /** Events for `who`'s next input: an event queued at local tick n rides in the input for n + 1 + d,
   *  or later after a catch-up. */
  queueEvent(who: string, e: EventPayload): void;
  /** The event bits of `who`'s events not yet final here: queued, or riding until their tick is final. */
  eventsInFlight(who: string): number;
  /** The newest input held for `who`, with its tick: a bot's own record, or one a STATE brought. */
  newestInput(who: string): { readonly tick: number; readonly input: number } | undefined;
}

/** A bot this browser hosts. */
export interface HostedBot {
  readonly id: string;
  pack: Pack; // the pack it asks for; Play again may move it (D-12)
  brain: Brain;
  wanted: boolean; // false once removed, until its LEAVE is final
  joinSentAt: number; // local tick of its last JOIN, −1 if none pending
  readySentAt: number; // local tick of its last READY, −1 if none
  /** Once removed, the tick its LEAVE was queued to ride in, n + 1 + d (a catch-up or a STATE may move
   *  it later); −1 while the LEAVE waits for an input of its own. */
  leaveAt: number;
  /** It may no longer take the other pack: it did, or it isn't Play again's, which alone does (D-12). */
  triedOther: boolean;
}

/** The sampler's memory beside a hosted bot's. */
interface Hosted extends HostedBot {
  thought: number; // the head tick it last thought on, −1 for none
  input: number; // what it thought then
}

const NONE = -1; // not a setting: no tick

export class BotHost {
  private readonly P: SimParams;
  private readonly B: BotParams;
  private readonly room: RoomSettings;
  private readonly ids: readonly string[]; // botIds(me): the IDs this browser gives its bots, in order
  private readonly list: Hosted[] = [];
  private adoptedFor: BotTimeline | null = null;
  private resetFor: BotTimeline | null = null;

  constructor(me: string, P: SimParams, B: BotParams, room: RoomSettings) {
    this.P = P;
    this.B = B;
    this.room = room;
    this.ids = botIds(me);
  }

  /** The bots hosted, oldest first: wanted ones, and removed ones until their LEAVE is final. */
  get hosted(): readonly HostedBot[] {
    return this.list;
  }

  /** Before the start countdown, with a place in pack for it counting joins on their way: this host's
   *  own bots' it counts itself, and pendingInPack is the rest, this browser's player's JOIN. s is the
   *  final state, null without a timeline yet (Play again): its JOIN waits for one, and may be given up. */
  canAdd(pack: Pack, s: Readonly<MatchState> | null, pendingInPack: number): boolean {
    if (this.freeId(s) === null) return false;
    if (s === null) return true;
    if (s.phase !== WARM_UP) return false;
    let pending = pendingInPack;
    for (const b of this.list) if (b.wanted && b.pack === pack && findTerrier(s, b.id) < 0) pending++;
    return packCount(s, pack) + pending < s.packSize;
  }

  /** A bot for pack, under the first of this browser's bot IDs neither hosted nor in the final roster:
   *  its JOIN | READY with botCoat and botName go in the next input, or once a timeline is held. Only a
   *  free ID and the warm-up are checked here, so Practice's swap can JOIN a place its SWITCH frees in
   *  the same tick (D-22); a person's Add checks canAdd first. `again`: Play again's bot, which takes the
   *  other pack when its own is full (D-12). Null with no free ID, or from the start countdown on. */
  add(pack: Pack, t: BotTimeline, again = false): HostedBot | null {
    const s = t.started ? t.final : null;
    if (s !== null && s.phase !== WARM_UP) return null;
    const id = this.freeId(s);
    if (id === null) return null;
    const b: Hosted = {
      id, pack, brain: newBrain(id, 0, this.P, this.B), wanted: true,
      joinSentAt: NONE, readySentAt: NONE, leaveAt: NONE, triedOther: !again, thought: NONE, input: 0,
    };
    this.list.push(b);
    t.bots.set(id, this.sampler(b, t));
    if (t.started) this.join(b, t);
    return b;
  }

  /** The newest wanted bot in pack, before the start countdown: its LEAVE, and it's unhosted once that's
   *  final here (tend); without a timeline, at once. False if there's none, or the countdown has begun. */
  remove(pack: Pack, t: BotTimeline): boolean {
    if (t.started && t.final.phase !== WARM_UP) return false;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i]!;
      if (!b.wanted || b.pack !== pack) continue;
      this.unwant(b, t);
      return true;
    }
    return false;
  }

  /** The host leaves (PLAN §14): every wanted bot's LEAVE. From the countdown on, LEAVEs are ignored and
   *  the bots sit, unhosted once tend's hostLeft says so. */
  removeAll(t: BotTimeline): void {
    for (const b of [...this.list]) if (b.wanted) this.unwant(b, t);
  }

  /** A timeline is held (D-10, D-17, design §4.6): this host's bots in its final roster are hosted
   *  again, each brain's counters from the bot's newest input the timeline holds past its final tick,
   *  which its terrier's stored previous input will become, or else from that stored input, as the
   *  session's onControl does, so its first input presses nothing: a STATE's records past g carry the
   *  inputs this host sent before a reload. Once for each timeline: a brain based again mid-timeline
   *  would lag its own inputs in flight, and a bot unhosted while still in the roster would come back. */
  adopt(t: BotTimeline): void {
    if (!t.started || t === this.adoptedFor) return;
    this.adoptedFor = t;
    const s = t.final;
    for (const id of this.ids) {
      const at = findTerrier(s, id);
      if (at < 0) continue;
      const T = s.terriers[at]!;
      let b = this.list.find((x) => x.id === id);
      if (!b) {
        b = { id, pack: T.pack, brain: newBrain(id, 0, this.P, this.B), wanted: true, joinSentAt: NONE, readySentAt: NONE, leaveAt: NONE, triedOther: true, thought: NONE, input: 0 };
        this.list.push(b);
      }
      const n = t.newestInput(id);
      b.pack = T.pack;
      b.brain = newBrain(id, n !== undefined && n.tick > t.finalTick ? n.input & KEPT_BITS : T.prevInput, this.P, this.B);
      b.thought = NONE;
      b.joinSentAt = NONE;
      t.bots.set(id, this.sampler(b, t));
    }
  }

  /** Each local tick, after the timeline's advance (roslambo's tendBots), from the final state: a wanted
   *  bot JOINs until the state shows it, again eventRetryTicks after its last JOIN is final; it's given
   *  up once a final tick shows its pack full or the start countdown begun, a JOIN in flight getting
   *  until it's final here (Play again's take the other pack first); a bot in the roster sends READY
   *  again once its Ready has botReadyRenewTicks left, and again after eventRetryTicks if the state
   *  doesn't show it, so one lost once lands on its second sending (C-41, PLAN §7.4); a removed bot is
   *  unhosted once its LEAVE is final here, unless the roster locked first, when it plays on, hosted
   *  again, but for a host that's leaving (hostLeft). A JOIN or a READY still in flight, which a
   *  catch-up may send ticks after it was queued, isn't sent again until its tick is final without
   *  the state showing it (M3 phase 4). */
  tend(t: BotTimeline, hostLeft: boolean): void {
    if (!t.started) return;
    const s = t.final;
    const f = t.finalTick;
    const retry = t.cfg.delay + this.room.eventRetryTicks;
    for (const b of [...this.list]) {
      const at = findTerrier(s, b.id);
      const T = at < 0 ? undefined : s.terriers[at]!;
      if (!b.wanted) {
        this.tendRemoved(b, t, T !== undefined, hostLeft);
        continue;
      }
      const flying = t.eventsInFlight(b.id);
      if (T) {
        b.joinSentAt = NONE;
        const renew = s.phase === WARM_UP && T.readyUntil - s.tick <= this.room.botReadyRenewTicks;
        if (renew && (flying & READY) === 0 && (b.readySentAt === NONE || f > b.readySentAt + retry)) {
          t.queueEvent(b.id, { events: READY });
          b.readySentAt = t.localTick;
        }
        continue;
      }
      if (s.phase !== WARM_UP || packCount(s, b.pack) >= s.packSize) {
        // No JOIN can take this pack now; one in flight gets until it's final here, however late a
        // catch-up sent it.
        if ((flying & JOIN) !== 0) continue;
        const other: Pack = b.pack === 0 ? 1 : 0;
        if (s.phase === WARM_UP && !b.triedOther && packCount(s, other) < s.packSize) {
          b.pack = other;
          b.triedOther = true;
          this.join(b, t);
        } else {
          this.unhost(b, t);
        }
        continue;
      }
      if ((flying & JOIN) === 0 && (b.joinSentAt === NONE || f > b.joinSentAt + retry)) this.join(b, t);
    }
  }

  /** A new timeline (a merge or a rejoin, design §4.6): each bot's sampler reads it, and every pending
   *  JOIN and READY, and a removed bot's LEAVE, goes again in it, since none of the old one's events
   *  reach it. Once for each timeline. */
  reset(t: BotTimeline): void {
    if (t === this.resetFor) return;
    this.resetFor = t;
    for (const b of this.list) {
      b.joinSentAt = NONE;
      b.readySentAt = NONE;
      if (!b.wanted) b.leaveAt = NONE;
      b.thought = NONE;
      t.bots.set(b.id, this.sampler(b, t));
    }
  }

  /** A removed bot, from the final state and what's in flight, not from a tick worked out when its
   *  LEAVE was queued: a catch-up sends only its newest ticks, and a STATE moves a LEAVE it wiped to
   *  the next input, so the LEAVE may ride later (design §2.4, §4.8). Its sampler and its outbox stay
   *  until the state no longer shows it and neither its JOIN nor its LEAVE is in flight. The roster
   *  locked with it in: it plays, hosted again (roslambo), but for a leaving host's, which sits. Shown
   *  in warm-up with nothing in flight: a repair's lineage undid its LEAVE, which goes again. */
  private tendRemoved(b: Hosted, t: BotTimeline, shown: boolean, hostLeft: boolean): void {
    if (b.leaveAt === NONE) {
      this.leave(b, t);
      return;
    }
    if (shown && t.final.phase !== WARM_UP) {
      if (hostLeft) this.unhost(b, t);
      else b.wanted = true;
      return;
    }
    if ((t.eventsInFlight(b.id) & (JOIN | LEAVE)) !== 0) return;
    if (shown) this.leave(b, t);
    else this.unhost(b, t);
  }

  /** The first of this browser's bot IDs neither hosted nor in s's roster (design §4.8). */
  private freeId(s: Readonly<MatchState> | null): string | null {
    for (const id of this.ids) {
      if (this.list.some((b) => b.id === id)) continue;
      if (s !== null && findTerrier(s, id) >= 0) continue;
      return id;
    }
    return null;
  }

  /** The bot's input, sampled once a sent tick: it thinks once per head tick (M3-Q25), on the head as
   *  the advance found it, and otherwise repeats its last input, press counters and all. So the ticks a
   *  catch-up sends on one head, and a head held through a spread, neither press twice nor shorten its
   *  reaction (design §1.11, §2.8). */
  private sampler(b: Hosted, t: BotTimeline): () => number {
    return () => {
      if (t.headTick !== b.thought) {
        b.input = think(b.brain, t.head);
        b.thought = t.headTick;
      }
      return b.input;
    };
  }

  private join(b: Hosted, t: BotTimeline): void {
    t.queueEvent(b.id, { events: JOIN | READY, joinPack: b.pack, coat: botCoat(b.id, this.P.coatCount), name: botName(b.id) });
    b.joinSentAt = t.localTick;
    b.readySentAt = t.localTick;
  }

  private unwant(b: Hosted, t: BotTimeline): void {
    if (!t.started) {
      this.unhost(b, t);
      return;
    }
    b.wanted = false;
    b.leaveAt = NONE;
    this.leave(b, t);
  }

  /** A removed bot's LEAVE, unless its JOIN rides in the next input, where the JOIN would come after it
   *  and win (D-12's order): then from the next local tick's tend. */
  private leave(b: Hosted, t: BotTimeline): void {
    if (b.joinSentAt === t.localTick) return;
    t.queueEvent(b.id, { events: LEAVE });
    b.leaveAt = t.localTick + 1 + t.cfg.delay;
  }

  private unhost(b: Hosted, t: BotTimeline): void {
    this.list.splice(this.list.indexOf(b), 1);
    t.bots.delete(b.id);
  }
}
