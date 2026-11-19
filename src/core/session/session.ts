// One room's controller (PLAN §8, D-12, D-17, D-19, D-21, D-31, C-11, C-12,
// C-42, Q-16; M3's design, research/m3/DESIGN.md, §1.14, §4): the handshake's
// checks, refusals and admissions, the map from connections to players,
// PEERS with roles, forwarding, joining and merging timelines, the local
// player's Play, Watch, Ready, Switch and Leave, the bots this browser hosts
// through BotHost, returning players and rejoins, stalls, the abandoned
// rule, Play again's preferences, and closing connections that misbehave.
// roslambo's src/core/session/session.ts, with the design's changes:
// - packs, SWITCH and coats in JOIN, and Play again's pack fallback (D-12);
// - roles (§4.1), announced in HELLO and in PEERS on each change;
// - D-21's admission: every HELLO from outside the final roster counted,
//   whatever role it announces (M3-Q16), and an admitted one reserving its
//   place until it joins, fails or times out (§4.3);
// - C-12's replacement of a connection silent for duplicateSilentMs, with
//   liveness from messages and pongs (M3-Q23); a connection's leave clears
//   its player's state only while the player still maps to it (§4.4);
// - the spectator cap on Watch and on a refusal as a player (§4.5);
// - returns and rejoins (D-17, §4.6), with onControl re-basing the input
//   source's counters after any adoption (M3-Q28), and a stall's rule:
//   pause, rejoin only from a peer whose clock ran on, else re-anchor, the
//   old timeline kept until a STATE is adopted (§4.12, M3-Q9);
// - a merge (P7) whose losing timeline runs on until the winner's STATE is
//   adopted, given up once each holder was asked, so nobody is stranded (M3
//   phase 3's integration, where roslambo dropped the losing timeline at
//   once); one at a time, each connection asked once in it;
// - PEERS carries the timeline this side holds, as HELLO does, and goes
//   ahead of the first TICK or FWD to a peer last told of another timeline
//   or none; a TICK or FWD from a peer that announces another is ignored.
//   Each side weighs a peer's latest announcement, its HELLO's or a later
//   PEERS', so a page that meets only pages that moved to a better timeline
//   follows them. An announcement gives the timeline's clock tick, which the
//   receiver ages by the time since it was sent, so every page weighs two
//   timelines as they stand at one moment, whichever announcement is
//   fresher; and two whose ages differ by at most half stallMs are a tie,
//   the smaller ID winning, so pages whose estimates of the ages differ a
//   little rank them alike. A Play-again press's ID leads with the old
//   timeline's tick at the press (roster.ts's againTimelineId), so of one old
//   match's presses the earlier wins both ways, as the older past the tie
//   and as the smaller ID within it, and every page ranks them alike at any
//   spacing (P7's peer side, Q-7, §4.9, M3 phase 4);
// - a joiner's warm-up waits for every peer connected or still handshaking,
//   each from when this side met it and for at most warmupMs, and only one
//   met within warmupMs of the adoption (T6, M3 phase 4's fixes);
// - a watcher counting the room's spectators as it meets them after its
//   first STATE, not once at the adoption (§4.5);
// - what a peer may say (§4.10, M3-Q10): nothing about this browser or its
//   bots, a FWD only for an origin with no direct connection here and only
//   from a connection whose PEERS lists it, and for at most peersMax origins
//   in any floodMs; floods counted per connection and per forwarded origin,
//   a forwarder relaying only senders within half the limit; one STATE
//   answer per connection per resyncRetryMs, the rest unanswered; and no
//   STATE but one asked for;
// - a one-way delay from the smaller of the last two round trips, so a
//   freeze's pong doesn't move the clock (M3 phase 3's integration);
// - the bots through BotHost (§4.8), the abandoned rule (Q-16, §4.7);
// - a retry skips its re-send while its event is in flight, and goes once
//   the event's tick is final without the state showing it (M3 phase 3's
//   answers);
// - no saves, results peers, witnesses or ledger.
// Pure: the caller passes `now` (ms, monotonic) and wires a transport to
// the RoomPeer methods.

import { config } from '../../config';
import { botIds, isBot } from '../bot/bot-id';
import type { BotParams } from '../bot/brain';
import {
  type Announcement, decode, encodeAgain, encodeFwd, encodePeers, type Fwd, type Hello, NO_TIMELINE, type Peers, PROTOCOL_VERSION, REFUSAL,
  ROLE, type StateMsg, type StateReq, T, type Tick, TIMELINE_KIND, wireLimits, type WireLimits,
} from '../protocol/messages';
import {
  ENDED, findTerrier, JOIN, KEPT_BITS, LEAVE, type MatchSettings, type MatchState, type Pack, packCount, READY, type SimParams, SWITCH,
  type Terrier, UNREADY, WARM_UP,
} from '../sim/index';
import { Timeline, type TimelineConfig } from '../timeline/timeline';
import { BotHost } from './bots';
import { type Accepted, commonRefusal, type Link, type Refusal, type RoomPeer } from './room-peer';
import { admits, freePlaces, inRoster, outranks, spectatorsOverCap } from './roster';
import type { NetSettings, RoomSettings } from './settings';

/** Play again (D-12): the previous match's choices. */
export interface AgainChoice {
  readonly pack: Pack | null; // null: it watched
  readonly bots: readonly { readonly pack: Pack }[];
  readonly againSeen: boolean; // an AGAIN reached it in the previous room: join, don't propose (§4.9)
}

export interface SessionConfig {
  readonly P: SimParams;
  readonly B: BotParams;
  readonly net: NetSettings;
  readonly me: string;
  readonly name: string;
  readonly coat: number;
  readonly build: string;
  readonly forwarding: boolean;
  readonly mode?: 'incremental' | 'fullReplay';
  readonly verify?: number;
  readonly again?: AgainChoice;
  /** The wire's limits, the decoder's, the encoders' and each timeline's: by default wireLimits()
   *  with net's d, w, history and TICK history, as the timeline's own default, so a changed
   *  configuration's messages decode where its own limits decode them (M3 phase 1's notes). */
  readonly wire?: WireLimits;
}

export type Refused = 'full' | 'started';

/** C-12's rule at work, for the report: which rule refused a reloaded page's HELLO (design §4.3, R-5). */
export interface DuplicateHello {
  readonly player: string;
  readonly at: number;
  readonly verdict: number; // the one it got: REFUSAL.ACCEPTED, replacing the old connection, DUPLICATE or SPECTATORS_FULL
  readonly oldSilentMs: number; // how long the old connection had been silent
  readonly oldLeftAt: number | null; // when its leave arrived, if it has
}

/** Arrival times over a sliding window, oldest first: a flood's count (§4.10). */
class Arrivals {
  private readonly at: number[] = [];
  private head = 0;

  /** Adds now, forgets what's older than span, and returns how many are left. */
  add(now: number, span: number): number {
    this.at.push(now);
    while (this.at[this.head]! < now - span) this.head++;
    if (this.head * 2 >= this.at.length) {
      this.at.splice(0, this.head);
      this.head = 0;
    }
    return this.at.length - this.head;
  }

  /** The last arrival, −Infinity before one. */
  get newest(): number {
    return this.at.length > this.head ? this.at[this.at.length - 1]! : -Infinity;
  }
}

/** A connection that completed the handshake. */
interface PeerInfo {
  readonly player: string;
  readonly hello: Hello; // its HELLO
  /** Its latest announcement, its HELLO's and then each PEERS' (P7), and the local time it came: the
   *  tick it gives is aged from then (outranks). */
  heard: Announcement;
  heardWhen: number;
  /** The timeline this side last announced to it, in its HELLO or a PEERS: ZERO_HASH for none. No TICK
   *  goes to it before it's told the timeline the TICK is for (P7). */
  told: string;
  readonly metAt: number; // when its HELLO came, its handshake begun here (T6)
  readonly joinedAt: number;
  role: number; // announced: its HELLO's, then its PEERS' (§4.5)
  heardAt: number; // its last message or pong (C-12, M3-Q23)
  oneWayMs: number | null; // half the smaller of its last two round trips, none before one
  rttLast: number | null; // its last round trip under stallMs
  live: boolean; // holds a running timeline: its HELLO said so, or it sent a TICK or a STATE
  newestTick: number; // the newest tick its own TICKs were for, −1 before one
  peers: ReadonlySet<string> | null; // the players its latest PEERS lists
  readonly ticks: Arrivals; // its own TICKs
  readonly fwd: Map<string, Arrivals>; // its FWDs, by origin
  invalid: number;
  asks: number; // STATE_REQs this side sent it and no STATE has answered yet
  askedAt: number; // when this side last sent it a STATE_REQ, from any of its timelines
  answeredAt: number; // when this side last answered its STATE_REQ
}

/** An accepted HELLO whose handshake is under way (D-21's reservation when outside the roster). */
interface Handshake {
  readonly player: string;
  readonly at: number; // when its HELLO came (T6)
  readonly until: number;
  readonly outside: boolean;
}

/** A rejoin after a stall: a new timeline asks the peers whose clock ran on, while the old one is
 *  kept, paused, until a STATE is adopted (§4.12). */
interface Rejoin {
  readonly t: Timeline;
  next: number; // the next of ranOn to ask
  at: number; // when the last was asked
}

/** A merge under way (P7): a new timeline asks, one every stateRequestRetryMs, each connection whose
 *  latest announcement outranks the timeline held, the best first, while the timeline held keeps
 *  running; it ends when a STATE is adopted, or once each has been asked and none answered, when the
 *  page stays where it is. So a winner whose holders left, or an announcement of a timeline nobody
 *  holds, strands nobody (M3 phase 3's integration). One merge at a time, each connection asked once
 *  in it, so a peer's announcements, however many and however made up, build at most one timeline
 *  each stateRequestRetryMs and can't keep the page from an honest winner (M3 phase 4's fixes). */
interface Merge {
  readonly t: Timeline;
  readonly asked: Set<string>; // the connections asked
  at: number; // when the last was asked
}

/** A HELLO's announcement (P7). */
const announced = (h: Announcement): Announcement => ({ timeline: h.timeline, timelineKind: h.timelineKind, finalTick: h.finalTick, hash: h.hash });

/** A newcomer meeting the room after its first STATE: a Watch counts the spectators again as it meets
 *  them, until it has met every player the STATE's sender lists, or handshakeTimeoutMs has passed.
 *  Then it's an incumbent, counted by later newcomers and never again by itself (§4.5). */
interface Settling {
  readonly from: string; // the STATE's sender's connection
  readonly until: number;
}

interface PlayWish {
  pack: Pack;
  readonly again: boolean; // Play again's: the other pack by itself when its own is full (§4.9)
  triedOther: boolean;
}

interface ReadyWish {
  readonly on: boolean;
  sentAt: number; // local tick of its last READY or UNREADY
  readonly joinTick: number; // the terrier it was for: a new join ends the wish
  until: number; // the Ready's end once the state showed it, 0 before
}

interface SwitchWish {
  readonly to: Pack;
  sentAt: number;
  readonly joinTick: number;
}

const DUPLICATES_MAX = 50; // not a setting: the log keeps its first
const NONE = -1; // not a setting: no tick
const other = (p: Pack): Pack => (p === 0 ? 1 : 0);

type Mutable<X> = { -readonly [K in keyof X]: X[K] };

export class Session implements RoomPeer {
  readonly cfg: SessionConfig;
  readonly bots: BotHost;
  /** Connections this side closed for misbehaving (roslambo §9.4). */
  readonly dropped: string[] = [];
  /** This browser took control of its terrier from an adopted state (a join, a return, a rejoin, a
   *  merge), with that terrier's stored previous input: where the input source starts its press
   *  counters; 0 when it JOINs again, for the new terrier's (D-10, §4.6, M3-Q28). */
  onControl: ((base: number) => void) | null = null;

  private readonly link: Link;
  private readonly L: WireLimits;
  private readonly room: RoomSettings;
  private readonly botIdsOf = new Map<string, readonly string[]>();
  private current: Timeline;
  private rejoin: Rejoin | null = null;
  private merging: Merge | null = null;
  private settle: Settling | null = null;
  private readonly peers = new Map<string, PeerInfo>(); // by transport peer ID
  private readonly byPlayer = new Map<string, string>(); // player → its connection
  private readonly handshakes = new Map<string, Handshake>(); // by transport peer ID
  private readonly dupLog: { readonly record: Mutable<DuplicateHello>; readonly oldPeer: string }[] = [];
  private sample: () => number = () => 0;
  private choice: 'undecided' | 'keeper' | 'watch' = 'undecided';
  private wish: PlayWish | null = null;
  private joinSentAt = NONE;
  private readyWant: ReadyWish | null = null;
  private switchWant: SwitchWish | null = null;
  private leavePending = false;
  private hostLeft = false;
  private refusedWhy: Refused | null = null;
  private switchRefusedNow = false;
  private returningNow = false;
  private spectatorsFullNow = false;
  private againSeenNow = false;
  private everHeld = false;
  private stallNow: 'none' | 'deciding' | 'rejoining' = 'none';
  private stallAt = 0;
  private ranOn: string[] = []; // connections whose clock ran on through a stall here, in the order seen
  private readonly joinAsk = { next: 0, at: -Infinity };
  private peersDirty = true;
  private lastPeersSent = -Infinity;
  private lastRole = -1;
  /** P7's tie, in ticks: half stallMs, the longest one-way delay the session takes for the network's
   *  (onRtt), so two pages whose estimates of two timelines' ages differ by the network's errors rank
   *  them alike. Two Play-again presses of one old match are ranked alike at any spacing, a partial
   *  mesh's included, where an AGAIN doesn't reach every page: their IDs lead with the old timeline's
   *  tick at the press, so the earlier is both the older and the smaller ID (§4.9, M3 phase 4). */
  private readonly tieTicks: number;
  private openedAt = -1;
  private arrivedAt = 0;
  private lastNow = 0;

  constructor(cfg: SessionConfig, link: Link) {
    this.cfg = cfg;
    this.link = link;
    this.room = cfg.net.room;
    this.tieTicks = cfg.net.stallMs / 2 / cfg.net.tickMs;
    const tl = cfg.net.timeline;
    this.L =
      cfg.wire ??
      wireLimits({ ...config, inputDelayTicks: tl.delay, lateWindowTicks: tl.window, stateHistoryTicks: tl.history, inputHistoryTicks: tl.inputHistory });
    this.bots = new BotHost(cfg.me, cfg.P, cfg.B, cfg.net.room);
    this.current = this.newTimeline();
    const again = cfg.again;
    if (again !== undefined) {
      // Play again's choices (§4.9): the old pack, else the other, else watch; the bots likewise,
      // but out when both are full; a spectator stays one.
      if (again.pack !== null) this.wishToPlay(again.pack, true);
      else this.choice = 'watch';
      for (const b of again.bots) this.bots.add(b.pack, this.current, true);
    }
  }

  // ---- What the glue and the tests read ----

  /** The timeline held, replaced by a merge or a rejoin once its STATE is adopted. */
  get timeline(): Timeline {
    return this.current;
  }

  /** A JOIN given up (D-12): the UI offers the other pack, or watches. */
  get refused(): Refused | null {
    return this.refusedWhy;
  }

  get switchRefused(): boolean {
    return this.switchRefusedNow;
  }

  /** Took control from the page's first adopted state, skipping Join (D-17). */
  get returning(): boolean {
    return this.returningNow;
  }

  /** D-21's fifth spectator: the glue leaves the room (§4.5). */
  get spectatorsFull(): boolean {
    return this.spectatorsFullNow;
  }

  /** An AGAIN arrived (§4.9). */
  get againSeen(): boolean {
    return this.againSeenNow;
  }

  get stall(): 'none' | 'deciding' | 'rejoining' {
    return this.stallNow;
  }

  /** C-12's verdicts on duplicate HELLOs, the first 50. */
  get duplicates(): readonly DuplicateHello[] {
    return this.dupLog.map((d) => d.record);
  }

  /** This browser's own input, sampled once a sent tick. */
  set controls(sample: () => number) {
    this.sample = sample;
    this.current.controls = sample;
    if (this.rejoin !== null) this.rejoin.t.controls = sample;
    if (this.merging !== null) this.merging.t.controls = sample;
  }

  /** PLAN §8's roles (§4.1): a player or a candidate; a spectator, chosen or refused as a player; the
   *  keeper, before Play or Watch; else undecided. */
  role(): number {
    if (this.wish !== null || this.inRoster()) return ROLE.PLAYER;
    if (this.choice === 'watch') return ROLE.SPECTATOR;
    if (this.choice === 'keeper') return ROLE.KEEPER;
    return ROLE.UNDECIDED;
  }

  /** This browser's player is in the final roster. */
  inRoster(): boolean {
    const t = this.current;
    return t.started && findTerrier(t.final, this.cfg.me) >= 0;
  }

  peerCount(): number {
    return this.peers.size;
  }

  /** Each connected player ID and its announced role (HELLO, then PEERS). */
  connectedRoles(): ReadonlyMap<string, number> {
    const out = new Map<string, number>();
    for (const [player, peer] of this.byPlayer) out.set(player, this.peers.get(peer)!.role);
    return out;
  }

  // ---- The local player (§4.2) ----

  /** Genesis (§4.2): tick 0 of a new match, now, as the keeper. */
  propose(now: number, settings: MatchSettings, timelineId: string): void {
    const t = this.current;
    t.start(now, settings, timelineId);
    this.everHeld = true;
    this.arrivedAt = now;
    if (this.choice === 'undecided') this.choice = 'keeper';
    if (this.wish !== null) t.sending = true;
  }

  /** JOIN(pack, coat, name) once a timeline is held, again eventRetryTicks after it's final without
   *  the state showing the terrier, given up once a final tick shows the pack full or the start
   *  countdown begun (D-12). In the roster already, nothing. */
  play(pack: Pack): void {
    if (this.inRoster()) return;
    this.wishToPlay(pack, false);
  }

  /** A spectator (§4.5): counted against the cap once the state is held. A browser in the roster
   *  plays on. */
  watch(): void {
    if (this.inRoster()) return;
    this.wish = null;
    this.choice = 'watch';
    this.current.sending = false;
    this.spectatorCheck();
  }

  /** Ready or its cancel, re-sent until the state shows it, the wish ended by its expiry or a new
   *  join (roslambo's keepReady, Q-15). Only a player in the roster. */
  ready(on: boolean): void {
    const t = this.current;
    const T = this.mine(t);
    if (T === undefined || this.rejoin !== null) return;
    t.queueEvent(this.cfg.me, { events: on ? READY : UNREADY });
    this.readyWant = { on, sentAt: t.localTick, joinTick: T.joinTick, until: 0 };
  }

  /** SWITCH to the other pack in warm-up, re-sent likewise, given up once a final tick shows that pack
   *  full or the countdown begun (switchRefused). It cancels the Ready, and ends the Ready wish (D-12). */
  switchPack(): void {
    const t = this.current;
    const T = this.mine(t);
    if (T === undefined || t.final.phase !== WARM_UP || this.rejoin !== null) return;
    const to = other(T.pack);
    if (packCount(t.final, to) >= t.final.packSize) {
      this.switchWant = null;
      this.switchRefusedNow = true;
      return;
    }
    this.switchRefusedNow = false;
    this.readyWant = null;
    this.switchWant = { to, sentAt: t.localTick, joinTick: T.joinTick };
    t.queueEvent(this.cfg.me, { events: SWITCH, switchPack: to });
  }

  /** LEAVE for the player and every hosted bot; a LEAVE isn't re-sent (D-12), and the glue closes the
   *  room leaveGraceMs later. From the countdown on the state ignores it, and the terriers sit. */
  leave(): void {
    const t = this.current;
    this.wish = null;
    this.readyWant = null;
    this.switchWant = null;
    this.hostLeft = true;
    if (t.started && (this.inRoster() || (t.eventsInFlight(this.cfg.me) & JOIN) !== 0)) {
      // Never in the input the JOIN rides in, where the JOIN would win (D-12's order).
      if (this.joinSentAt === t.localTick) this.leavePending = true;
      else t.queueEvent(this.cfg.me, { events: LEAVE });
    }
    this.bots.removeAll(t);
  }

  // ---- Bots (§4.8) ----

  /** Before the start countdown, with a place in pack for it, counting joins on their way. */
  canAddBot(pack: Pack): boolean {
    const t = this.current;
    const pending = this.wish !== null && this.wish.pack === pack && !this.inRoster() ? 1 : 0;
    return this.bots.canAdd(pack, t.started ? t.final : null, pending);
  }

  addBot(pack: Pack): boolean {
    return this.canAddBot(pack) && this.bots.add(pack, this.current) !== null;
  }

  /** The newest wanted bot in pack: its LEAVE, before the countdown. */
  removeBot(pack: Pack): boolean {
    return this.bots.remove(pack, this.current);
  }

  hostedBots(): readonly string[] {
    return this.bots.hosted.filter((b) => b.wanted).map((b) => b.id);
  }

  /** Results: the next match exists (§4.9). Its sender's own againSeen stays as it was. */
  announceAgain(): void {
    if (this.peers.size > 0) this.link.broadcast(encodeAgain());
  }

  // ---- Q-16, PLAN §8 ----

  /** Q-16 (§4.7): past warm-up and not ended, controlling no terrier, and no TICK, direct or
   *  forwarded, carrying a terrier of the final roster for abandonedMs since this browser's arrival. */
  abandoned(now: number): boolean {
    const t = this.current;
    if (!t.started) return false;
    const s = t.final;
    if (s.phase === WARM_UP || s.phase === ENDED || this.controlsTerrier()) return false;
    let last = this.arrivedAt;
    for (const T of s.terriers) {
      const h = t.heardAt(T.id);
      if (h !== undefined && h > last) last = h;
    }
    return now - last >= this.room.abandonedMs;
  }

  /** Not a keeper, and no timeline yet connectionFailureMs after the page opened the room (PLAN §8). */
  failed(now: number): boolean {
    return !this.everHeld && this.choice !== 'keeper' && this.openedAt >= 0 && now - this.openedAt >= this.room.connectionFailureMs;
  }

  // ---- Stalls (§4.12, M3-Q9) ----

  /** A gap over stallMs between timer runs: the timeline pauses, sending no TICK and answering no
   *  STATE_REQ, and for stateRequestRetryMs the session watches for a TICK past localTick + d + w,
   *  whose sender's clock ran on; then it rejoins from that peer, or re-anchors if none came. */
  stalled(now: number): void {
    this.lastNow = now;
    const t = this.current;
    if (!t.started || this.rejoin !== null) return;
    this.stallAt = now;
    if (this.stallNow === 'deciding') return;
    t.pause(now);
    this.stallNow = 'deciding';
    this.ranOn = [];
    // TICKs that came before the stall was seen count too, in ID order.
    const past = t.localTick + t.cfg.delay + t.cfg.window;
    const seen = [...this.byPlayer].filter(([, peer]) => this.peers.get(peer)!.newestTick > past).sort(([a], [b]) => (a < b ? -1 : 1));
    for (const [, peer] of seen) this.ranOn.push(peer);
  }

  // ---- The handshake (§4.3, D-21) ----

  hello(): Hello {
    const t = this.current;
    return {
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: this.cfg.build, player: this.cfg.me, role: this.role(),
      ...this.announcement(), phase: t.final.phase, name: this.cfg.name,
    };
  }

  /** The timeline held, as HELLO and PEERS announce it (P7). Its tick is the clock's, how old the
   *  timeline is now, which a receiver ages by the time since (ageOf); a final tick, which a warm-up
   *  or a spread holds back, would announce a timeline just taken younger than it is. The hash, the
   *  final tick's, is no longer weighed (M3 phase 4's fixes). */
  private announcement(): Announcement {
    const t = this.current;
    if (!t.started) return { ...NO_TIMELINE };
    return { timeline: t.id, timelineKind: TIMELINE_KIND.LIVE, finalTick: Math.floor(t.clock(this.lastNow)), hash: t.hashAt(t.finalTick) };
  }

  /** In order: protocol, build, this browser's ID or a bot's (REFUSE 1, 2, 3); a duplicate, which
   *  replaces a connection silent for duplicateSilentMs and is otherwise REFUSE 3 (C-12); D-21's
   *  admission for a HELLO from outside the final roster, which holds its place under its peer ID
   *  until it joins, fails or times out (REFUSE 4 past the count). */
  checkHello(hello: Hello, now: number, peer: string): Accepted | Refusal {
    this.lastNow = now;
    const common = commonRefusal(hello, this.cfg.build, this.cfg.me);
    if (common !== null) return common;
    this.expireHandshakes(now);
    let replaces: string | undefined;
    let silent = 0;
    const old = this.byPlayer.get(hello.player);
    if (old !== undefined) {
      silent = now - this.peers.get(old)!.heardAt;
      if (silent < this.room.duplicateSilentMs) {
        this.logDuplicate(hello.player, now, REFUSAL.DUPLICATE, silent, old);
        return { ok: false, reason: REFUSAL.DUPLICATE };
      }
      replaces = old;
    } else {
      // One player in two handshakes at once, two tabs before M4's lock (D-24): the first holds it.
      for (const [p, h] of this.handshakes) {
        if (p === peer || h.player !== hello.player) continue;
        this.logDuplicate(hello.player, now, REFUSAL.DUPLICATE, 0, p);
        return { ok: false, reason: REFUSAL.DUPLICATE };
      }
    }
    const t = this.current;
    let outside = false;
    if (t.started) {
      const roster = new Set(t.final.terriers.map((x) => x.id));
      outside = !this.inside(hello.player, roster);
      if (outside) {
        let outsideConnected = 0;
        for (const [player, p] of this.byPlayer) if (p !== replaces && !this.inside(player, roster)) outsideConnected++;
        let reserved = 0;
        for (const [p, h] of this.handshakes) if (p !== peer && h.outside) reserved++;
        const ok = admits({
          holdsState: true, outsideConnected, reserved, selfOutside: !this.inside(this.cfg.me, roster),
          freePlaces: freePlaces(t.final), spectatorsMax: this.room.spectatorsMax,
        });
        if (!ok) {
          // A duplicate is logged with the verdict it gets, so the log names the rule that refused it.
          if (replaces !== undefined) this.logDuplicate(hello.player, now, REFUSAL.SPECTATORS_FULL, silent, replaces);
          return { ok: false, reason: REFUSAL.SPECTATORS_FULL };
        }
      }
    }
    this.handshakes.set(peer, { player: hello.player, at: now, until: now + this.room.handshakeTimeoutMs, outside });
    if (replaces === undefined) return { ok: true, hello };
    this.logDuplicate(hello.player, now, REFUSAL.ACCEPTED, silent, replaces);
    return { ok: true, hello, replaces };
  }

  /** The handshake completed. If the peer's timeline outranks the one held, this side takes the
   *  winner's (roslambo D-12, Q-7, P7). */
  onPeerJoin(peer: string, hello: Hello, sent: Hello, now: number): void {
    this.lastNow = now;
    const metAt = this.handshakes.get(peer)?.at ?? now;
    this.handshakes.delete(peer);
    this.peers.set(peer, {
      player: hello.player, hello, heard: announced(hello), heardWhen: metAt, told: sent.timeline, metAt, joinedAt: now, role: hello.role, heardAt: now,
      oneWayMs: null, rttLast: null, live: hello.timelineKind === TIMELINE_KIND.LIVE, newestTick: NONE, peers: null, ticks: new Arrivals(),
      fwd: new Map(), invalid: 0, asks: 0, askedAt: -Infinity, answeredAt: -Infinity,
    });
    this.byPlayer.set(hello.player, peer);
    this.peersDirty = true;
    this.considerMerge(peer, now);
  }

  /** How old a peer's announced timeline is now, in ticks: the tick it gave, aged by the time since it
   *  came and the one-way delay before that; null for none (P7, M3 phase 4's fixes). Two pages weighing
   *  one pair of timelines this way see the same difference but for the link's asymmetry. */
  private ageOf(info: PeerInfo, now: number): number | null {
    const a = info.heard;
    if (a.timelineKind !== TIMELINE_KIND.LIVE) return null;
    return a.finalTick + (now - info.heardWhen + (info.oneWayMs ?? 0)) / this.cfg.net.tickMs;
  }

  /** A peer's announced timeline outranks the one held (outranks), each as old as it is now. */
  private outranksHeld(info: PeerInfo, now: number): boolean {
    const t = this.current;
    const age = this.ageOf(info, now);
    return t.started && age !== null && info.heard.timeline !== t.id && outranks(info.heard.timeline, age, t.id, t.clock(now), this.tieTicks);
  }

  /** P7's merge rule (roslambo D-12, Q-7), on the peer's latest announcement, its HELLO's or a later
   *  PEERS': a merge begins when it outranks the timeline held. Every page ranks two timelines as they
   *  stand at one moment (ageOf), so a page that adopted a better timeline and announces it in PEERS
   *  moves a peer that held its old one there too, announcements move only to better timelines, and the
   *  comparisons converge on the best one in each connected group (P7's peer side, M3 phase 4's fixes).
   *  While a merge is under way, its next ask weighs every announcement (askToMerge). A page without a
   *  timeline joins the best holder instead (askToJoin). */
  private considerMerge(peer: string, now: number): void {
    const info = this.peers.get(peer);
    if (info === undefined || this.byPlayer.get(info.player) !== peer || this.merging !== null) return;
    if (this.outranksHeld(info, now)) this.merge(now);
  }

  /** An admission's place goes (D-21). Idempotent. */
  onHandshakeFailed(peer: string): void {
    this.handshakes.delete(peer);
  }

  /** Its connection, its PEERS and its flood counts go; its player's state, the clock samples and the
   *  one-way delay, only while that player still maps to this connection, since a replaced
   *  connection's leave can come after its replacement joined (§4.4). */
  onPeerLeave(peer: string): void {
    this.handshakes.delete(peer);
    const info = this.peers.get(peer);
    if (info === undefined) return;
    this.peers.delete(peer);
    this.peersDirty = true;
    // ranOn stays whole: askToRejoin walks it by index, and passes over peers that have gone.
    for (const d of this.dupLog) if (d.oldPeer === peer && d.record.oldLeftAt === null) d.record.oldLeftAt = this.lastNow;
    if (this.byPlayer.get(info.player) !== peer) return;
    this.byPlayer.delete(info.player);
    for (const t of this.timelines()) t.forget(info.player);
  }

  /** A pong: the connection is alive (C-12). A round trip over the stall threshold is a freeze, not
   *  the network, and is no sample (M3 phase 3's answers); and a shorter freeze, or a retransmission,
   *  inflates one round trip, so the one-way delay is half the smaller of the last two (reviewer H6;
   *  a transport has one ping out to a peer at a time). */
  onRtt(peer: string, ms: number, now: number): void {
    this.lastNow = now;
    const info = this.peers.get(peer);
    if (info === undefined) return;
    info.heardAt = now;
    if (!(ms >= 0 && ms <= this.cfg.net.stallMs) || this.byPlayer.get(info.player) !== peer) return;
    const rtt = info.rttLast === null ? ms : Math.min(ms, info.rttLast);
    info.rttLast = ms;
    info.oneWayMs = rtt / 2;
    for (const t of this.timelines()) t.setOneWay(info.player, info.oneWayMs);
  }

  // ---- Messages (§4.10) ----

  onMessage(peer: string, bytes: Uint8Array, now: number): void {
    this.lastNow = now;
    const info = this.peers.get(peer);
    if (info === undefined) return; // not through the handshake: dropped
    info.heardAt = now;
    // A connection its player no longer maps to, replaced (C-12): its messages stop with it.
    if (this.byPlayer.get(info.player) !== peer) return;
    const m = decode(bytes, this.cfg.P, this.L);
    if (m === null) {
      this.invalid(peer, info);
      return;
    }
    switch (m.type) {
      case T.TICK:
        this.onTick(peer, info, m, bytes, now);
        break;
      case T.FWD:
        this.onFwd(peer, info, m, now);
        break;
      case T.PEERS:
        info.peers = new Set(m.players);
        info.role = m.role;
        // An origin's FWD count goes only once its window is empty, so a PEERS that drops an origin
        // and lists it again never resets its flood count (reviewer H4).
        this.pruneFwd(info, now);
        this.heardAnnouncement(peer, info, m, now);
        break;
      case T.AGAIN:
        this.againSeenNow = true;
        break;
      case T.STATE_REQ:
        this.onStateReq(peer, info, m, now);
        break;
      case T.STATE:
        this.onState(peer, info, m, now);
        break;
      default:
        break; // HELLO and REFUSE belong to the handshake
    }
  }

  /** A connection's own TICK: its input and vote are its player's, its bot entries only bots derived
   *  from it (the timeline's check), and only a direct TICK is a clock sample. More than
   *  floodTicksMax in the last floodMs, from a connection open that long, closes it. */
  private onTick(peer: string, info: PeerInfo, m: Tick, bytes: Uint8Array, now: number): void {
    const count = info.ticks.add(now, this.room.floodMs);
    if (count > this.room.floodTicksMax && now - info.joinedAt >= this.room.floodMs) {
      this.drop(peer);
      return;
    }
    info.live = true;
    // Another timeline's TICK is for its ticks: its inputs, JOINs and votes would land on this one's,
    // where its holders couldn't agree on them, and its tick says nothing of this clock (P7's peer side).
    if (this.elsewhere(info)) return;
    if (m.t > info.newestTick) info.newestTick = m.t;
    if (this.stallNow !== 'none') {
      const t = this.current;
      if (m.t > t.localTick + t.cfg.delay + t.cfg.window && !this.ranOn.includes(peer)) this.ranOn.push(peer);
    }
    this.current.onTick(info.player, m, now, true);
    // Relayed only while its sender keeps within half the flood limit, however young its connection:
    // a receiver counts a forwarder's FWDs for each origin against the forwarder, however they bunch
    // up on the way, so an honest forwarder is never closed over another's flood (reviewer H3). An
    // honest sender's TICKs are about a third of the limit. And only a TICK taken on the timeline held
    // here: a page without one can't say which timeline a TICK is for (P7's peer side).
    if (this.cfg.forwarding && this.current.started && count <= this.room.floodTicksMax / 2) this.forward(info.player, peer, bytes, now);
  }

  /** A FWD only for an origin with no direct connection here, from a connection whose latest PEERS
   *  lists it; never one speaking for this browser, its bots or any bot (an invalid message), and its
   *  floods counted per origin, apart from the forwarder's own TICKs. A connection speaks for at most
   *  peersMax origins in any floodMs, however often its PEERS lists new ones, so made-up origins can't
   *  grow what the timeline keeps for each sender without bound (reviewer H5); a FWD past that is
   *  dropped, never counted invalid, as churn in an honest room may bring one. */
  private onFwd(peer: string, info: PeerInfo, m: Fwd, now: number): void {
    const origin = m.origin;
    if (origin === this.cfg.me || isBot(origin)) {
      this.invalid(peer, info);
      return;
    }
    if (this.byPlayer.has(origin) || info.peers === null || !info.peers.has(origin)) return;
    let w = info.fwd.get(origin);
    if (w === undefined) {
      if (info.fwd.size >= this.L.peersMax) this.pruneFwd(info, now);
      if (info.fwd.size >= this.L.peersMax) return;
      w = new Arrivals();
      info.fwd.set(origin, w);
    }
    if (this.flooding(w, info, now)) {
      this.drop(peer);
      return;
    }
    // A forwarder relays only its own timeline's TICKs (forward), so one of another timeline relays
    // none of this one's.
    if (this.elsewhere(info)) return;
    this.current.onTick(origin, m.tick, now, false);
  }

  /** A peer whose latest announcement is a timeline other than the one held here (P7's peer side). */
  private elsewhere(info: PeerInfo): boolean {
    const a = info.heard;
    const t = this.current;
    return a.timelineKind === TIMELINE_KIND.LIVE && t.started && a.timeline !== t.id;
  }

  /** The origins whose FWDs from this connection all left the flood window: their counts are 0. */
  private pruneFwd(info: PeerInfo, now: number): void {
    for (const [origin, w] of info.fwd) if (w.newest < now - this.room.floodMs) info.fwd.delete(origin);
  }

  /** A PEERS' announcement: the peer's latest, weighed as its HELLO's was, on every PEERS, so a merge
   *  that found no holder to answer is tried again (P7's peer side). */
  private heardAnnouncement(peer: string, info: PeerInfo, m: Peers, now: number): void {
    info.heard = announced(m);
    info.heardWhen = now;
    if (m.timelineKind === TIMELINE_KIND.LIVE) info.live = true;
    this.considerMerge(peer, now);
  }

  /** At most one answer per connection per resyncRetryMs (§3.4); the rest go unanswered. None counts
   *  as invalid: an honest asker re-asks its first candidate when a resync fails or a repaired page
   *  diverges again, sooner than that, jitter on the way included (reviewers S3, H2). None while
   *  paused or resyncing, the timeline's rule, nor without a timeline. */
  private onStateReq(peer: string, info: PeerInfo, m: StateReq, now: number): void {
    if (now - info.answeredAt < this.room.resyncRetryMs) return;
    if (this.current.onStateReq(peer, m, now, info.player)) info.answeredAt = now;
  }

  /** Only a STATE this side asked that connection for; an unsolicited one is invalid. A merge takes
   *  the STATE of a connection it asked, unless it's of the timeline held: the winner's, or the one
   *  its holder has moved on to since, which an honest page does only for one that beats it. A
   *  joining or rejoining browser adopts one from a peer it asked, and a started timeline only its
   *  resync's (the timeline's checks, §3.4). */
  private onState(peer: string, info: PeerInfo, m: StateMsg, now: number): void {
    if (info.asks === 0) {
      this.invalid(peer, info);
      return;
    }
    info.asks--;
    info.live = true;
    const oneWay = info.oneWayMs ?? 0;
    const t = this.current;
    const g = this.merging;
    if (g !== null && g.asked.has(peer) && !(t.started && m.timeline === t.id)) {
      if (g.t.onState(peer, m, oneWay, now)) this.adopted(g.t, peer, now);
      return;
    }
    const r = this.rejoin;
    if (r !== null) {
      if (r.t.onState(peer, m, oneWay, now)) this.adopted(r.t, peer, now);
      return;
    }
    if (t.started) t.onState(peer, m, oneWay, now);
    else if (t.onState(peer, m, oneWay, now)) this.adopted(t, peer, now);
  }

  /** roslambo D-14: for each neighbour B that can't reach the TICK's origin A, the peer with the
   *  smallest player ID connected to both forwards it, inside a FWD, never forwarded again. A TICK
   *  too large for a FWD is skipped, so no honest forwarder is closed over it (M3 phase 3's answers).
   *  Only the timeline held here's: onTick takes no other's (P7's peer side). */
  private forward(origin: string, from: string, tick: Uint8Array, now: number): void {
    const theirs = this.peers.get(from)?.peers ?? null;
    if (theirs === null) return; // not known yet: a full mesh, as far as this side knows
    let fwd: Uint8Array | null = null;
    for (const [player, peer] of this.byPlayer) {
      if (peer === from) continue;
      const b = this.peers.get(peer)!;
      if (b.peers === null || b.peers.has(origin) || theirs.has(player)) continue;
      let forwarder = this.cfg.me;
      for (const [x, p] of this.byPlayer) {
        const xs = this.peers.get(p)!.peers;
        if (x < forwarder && xs !== null && xs.has(origin) && xs.has(player)) forwarder = x;
      }
      if (forwarder !== this.cfg.me) continue;
      fwd ??= encodeFwd(origin, tick);
      if (fwd.length > this.L.messageMaxBytes) return;
      // A FWD, as a TICK, goes only to a peer told of the timeline it's for: a PEERS first if not (P7).
      if (b.told !== this.current.id) {
        this.peersDirty = true;
        this.gossip(now);
      }
      this.link.send(peer, fwd);
    }
  }

  private flooding(w: Arrivals, info: PeerInfo, now: number): boolean {
    return w.add(now, this.room.floodMs) > this.room.floodTicksMax && now - info.joinedAt >= this.room.floodMs;
  }

  /** invalidMessagesMax of them close the connection (roslambo §9.3, §9.4). */
  private invalid(peer: string, info: PeerInfo): void {
    if (++info.invalid >= this.room.invalidMessagesMax) this.drop(peer);
  }

  /** Closes a connection that misbehaves; the transport refuses its peer ID from then on. */
  private drop(peer: string): void {
    this.dropped.push(peer);
    this.onPeerLeave(peer);
    this.link.drop?.(peer);
  }

  // ---- Each timer run ----

  advance(now: number): void {
    this.lastNow = now;
    if (this.openedAt < 0) this.openedAt = now;
    this.expireHandshakes(now);
    if (this.stallNow === 'deciding') this.decide(now);
    if (this.rejoin !== null) this.askToRejoin(now);
    else if (!this.current.started) this.askToJoin(now);
    if (this.merging !== null) this.askToMerge(now);
    const t = this.current;
    // No TICK on a link whose peer was told of another timeline, or none, in this side's HELLO or a
    // PEERS: a PEERS goes ahead of it, so no peer takes a TICK as another timeline's (P7's peer side).
    if (this.untold(t)) {
      this.peersDirty = true;
      this.gossip(now);
    }
    t.advance(now);
    if (t.started && this.stallNow === 'none' && this.rejoin === null) {
      this.tendPlayer(t);
      this.bots.tend(t, this.hostLeft);
    }
    if (this.settle !== null) this.settling(now);
    this.gossip(now);
  }

  /** §4.12's deciding: a peer whose clock ran on, or none for stateRequestRetryMs. */
  private decide(now: number): void {
    if (this.ranOn.length > 0) {
      this.rejoin = { t: this.newTimeline(), next: 0, at: -Infinity };
      this.stallNow = 'rejoining';
    } else if (now - this.stallAt >= this.room.stateRequestRetryMs) {
      this.reanchor(now);
    }
  }

  /** With no peer that ran on, the clock goes on from localTick and the page sends again, as every
   *  page does that stalled with it (§4.12). */
  private reanchor(now: number): void {
    this.rejoin = null;
    this.stallNow = 'none';
    this.ranOn = [];
    this.current.reanchor(now);
  }

  /** Without a timeline: a STATE_REQ every stateRequestRetryMs, rotating among the peers that hold
   *  one, best first by their latest announcements, as old as each is now (roslambo's askToJoin, P7). */
  private askToJoin(now: number): void {
    if (now - this.joinAsk.at < this.room.stateRequestRetryMs) return;
    const holders = [...this.byPlayer.values()].map((p) => [p, this.peers.get(p)!] as const).filter(([, info]) => info.live);
    if (holders.length === 0) return;
    const better = (a: PeerInfo, b: PeerInfo): boolean => {
      const [x, y] = [this.ageOf(a, now), this.ageOf(b, now)];
      if (x === null || a.heard.timeline === b.heard.timeline) return false;
      return y === null || outranks(a.heard.timeline, x, b.heard.timeline, y, this.tieTicks);
    };
    holders.sort(([pa, a], [pb, b]) => (better(a, b) ? -1 : better(b, a) ? 1 : pa < pb ? -1 : pa > pb ? 1 : 0));
    const [peer] = holders[this.joinAsk.next++ % holders.length]!;
    this.joinAsk.at = now;
    this.current.requestState(peer);
  }

  /** §4.12's rejoin: each peer whose clock ran on, once, in the order seen, every
   *  stateRequestRetryMs; with none left unasked and none adopted, a re-anchor. */
  private askToRejoin(now: number): void {
    const r = this.rejoin!;
    if (now - r.at < this.room.stateRequestRetryMs) return;
    while (r.next < this.ranOn.length) {
      const peer = this.ranOn[r.next++]!;
      if (!this.peers.has(peer)) continue;
      r.at = now;
      r.t.requestState(peer);
      return;
    }
    this.reanchor(now);
  }

  /** A merge (roslambo D-12, P7): a new timeline asks the winner's holders for a STATE, while the
   *  losing timeline runs on until one is adopted, where roslambo dropped it at once; so a winner
   *  nobody can supply strands nobody (reviewers S4, H1). */
  private merge(now: number): void {
    this.merging = { t: this.newTimeline(), asked: new Set(), at: -Infinity };
    this.askToMerge(now);
  }

  /** The merge's next ask, one every stateRequestRetryMs: of the connections not asked in it whose
   *  latest announcement outranks the timeline held, the best timeline's, then the smallest player
   *  ID's; with none left, it ends, and the page stays where it is. A peer answers one STATE_REQ per
   *  connection per resyncRetryMs (§4.10), so one asked sooner than that, by an earlier merge, a join
   *  or a resync, is asked once that has passed, rather than in vain (M3 phase 4's fixes, as H2's). */
  private askToMerge(now: number): void {
    const g = this.merging!;
    if (now - g.at < this.room.stateRequestRetryMs) return;
    let next: { peer: string; player: string; info: PeerInfo; age: number } | null = null;
    let waiting = false;
    for (const [player, peer] of this.byPlayer) {
      const info = this.peers.get(peer)!;
      if (g.asked.has(peer) || !this.outranksHeld(info, now)) continue;
      if (!this.mayAsk(info, now)) {
        waiting = true;
        continue;
      }
      const age = this.ageOf(info, now)!;
      const timeline = info.heard.timeline;
      const best = next === null || (timeline === next.info.heard.timeline ? player < next.player : outranks(timeline, age, next.info.heard.timeline, next.age, this.tieTicks));
      if (best) next = { peer, player, info, age };
    }
    if (next === null) {
      if (!waiting) this.merging = null;
      return;
    }
    g.asked.add(next.peer);
    g.at = now;
    g.t.requestState(next.peer);
  }

  /** Whether a STATE_REQ to this connection would be answered: none was sent it within resyncRetryMs,
   *  with its one-way delay on top for the jitter between the two requests' paths. */
  private mayAsk(info: PeerInfo, now: number): boolean {
    return now - info.askedAt >= this.room.resyncRetryMs + (info.oneWayMs ?? 0);
  }

  /** A STATE adopted from `from`: this timeline is held from now on (§4.6). A peer last told of
   *  another timeline, or none, hears of this one in a PEERS ahead of the first TICK or FWD this side
   *  sends it (untold, forward), and weighs it against its own; and once the rest is done here, each
   *  peer's latest announcement is weighed against it, a merge under way having ended (P7's peer
   *  side). */
  private adopted(t: Timeline, from: string, now: number): void {
    const first = !this.everHeld;
    this.current = t;
    this.rejoin = null;
    this.merging = null;
    this.stallNow = 'none';
    this.ranOn = [];
    this.everHeld = true;
    this.arrivedAt = now;
    this.leavePending = false;
    this.settle = { from, until: now + this.room.handshakeTimeoutMs };
    this.bots.reset(t);
    this.bots.adopt(t);
    const T = this.mine(t);
    if (this.hostLeft) {
      // A Leave pressed while a stall decided or a merge waited: no control taken, and the LEAVE goes
      // again in this timeline, since the old one's went with it, as leave() sends it (reviewer S7).
      this.wish = null;
      this.readyWant = null;
      this.switchWant = null;
      this.bots.removeAll(t);
      t.sending = T !== undefined;
      if (T !== undefined) t.queueEvent(this.cfg.me, { events: LEAVE });
    } else if (T !== undefined) {
      // In the roster: control at once, with no JOIN, from the terrier's stored previous input, or
      // the newest input of its own the state's records hold past it, which that becomes (D-10).
      t.sending = true;
      this.wish = { pack: T.pack, again: false, triedOther: true };
      this.joinSentAt = NONE;
      this.refusedWhy = null;
      if (first) this.returningNow = true;
      const n = t.newestInput(this.cfg.me);
      this.onControl?.(n !== undefined && n.tick > t.finalTick ? n.input & KEPT_BITS : T.prevInput);
    } else if (this.wish !== null) {
      // Pressed Play before: its pack again, as a new terrier, whose counters start from 0 (D-10).
      t.sending = true;
      this.joinSentAt = NONE;
      this.onControl?.(0);
    } else {
      t.sending = false;
      if (this.choice === 'watch') this.spectatorCheck();
    }
    for (const peer of [...this.peers.keys()]) this.considerMerge(peer, now);
  }

  /** After each advance (roslambo's order): the JOIN, the Ready, the switch and a LEAVE held back. */
  private tendPlayer(t: Timeline): void {
    const s = t.final;
    const T = this.mine(t);
    if (this.leavePending && this.joinSentAt !== t.localTick) {
      t.queueEvent(this.cfg.me, { events: LEAVE });
      this.leavePending = false;
    }
    if (this.wish !== null) this.joinOrGiveUp(t, s, T);
    if (this.readyWant !== null) this.keepReady(t, s, T);
    if (this.switchWant !== null) this.keepSwitch(t, s, T);
  }

  /** The event retry's tick: eventRetryTicks after the event's tick, n + 1 + d, is final. */
  private due(t: Timeline, sentAt: number): boolean {
    return t.finalTick > sentAt + t.cfg.delay + this.room.eventRetryTicks;
  }

  private inFlight(t: Timeline, bits: number): boolean {
    return (t.eventsInFlight(this.cfg.me) & bits) !== 0;
  }

  /** JOIN until the state shows the terrier; given up once a final tick shows the pack full or the
   *  countdown begun, a JOIN in flight getting until it's final here; Play again's takes the other
   *  pack first (D-12, §4.9). */
  private joinOrGiveUp(t: Timeline, s: Readonly<MatchState>, T: Terrier | undefined): void {
    const w = this.wish!;
    if (T !== undefined) {
      w.pack = T.pack;
      this.joinSentAt = NONE;
      this.refusedWhy = null;
      return;
    }
    // Not while a warm-up holds the final state back: the JOIN goes once the peers this side was
    // handshaking with are connected, so it reaches them on their connections (T6).
    if (t.warming) return;
    const flying = this.inFlight(t, JOIN);
    if (s.phase !== WARM_UP || packCount(s, w.pack) >= s.packSize) {
      if (flying) return;
      const o = other(w.pack);
      if (w.again && !w.triedOther && s.phase === WARM_UP && packCount(s, o) < s.packSize) {
        w.pack = o;
        w.triedOther = true;
        this.queueJoin(t);
        return;
      }
      this.giveUp(s.phase === WARM_UP ? 'full' : 'started');
      return;
    }
    if (!flying && (this.joinSentAt === NONE || this.due(t, this.joinSentAt))) this.queueJoin(t);
  }

  private queueJoin(t: Timeline): void {
    t.queueEvent(this.cfg.me, { events: JOIN, joinPack: this.wish!.pack, coat: this.cfg.coat, name: this.cfg.name });
    this.joinSentAt = t.localTick;
  }

  /** A JOIN given up: sending stops, and the browser watches, counted (§4.2, §4.5). */
  private giveUp(why: Refused): void {
    this.refusedWhy = why;
    this.wish = null;
    this.joinSentAt = NONE;
    this.current.sending = false;
    this.choice = 'watch';
    this.spectatorCheck();
  }

  /** roslambo's keepReady: re-sent until the state shows it. Votes can't say it landed, so only the
   *  state's own reasons end the wish: the Ready's expiry, or a new join (Q-15). */
  private keepReady(t: Timeline, s: Readonly<MatchState>, T: Terrier | undefined): void {
    const w = this.readyWant!;
    if (T === undefined || T.joinTick !== w.joinTick) {
      this.readyWant = null;
      return;
    }
    // A countdown here may be this peer's alone, until a resync undoes it.
    if (s.phase !== WARM_UP) return;
    if (T.readyUntil > s.tick === w.on) {
      if (w.on) w.until = T.readyUntil;
      return;
    }
    if (w.on && w.until > 0 && s.tick >= w.until) {
      this.readyWant = null; // it expired, as Ready does after a minute
      return;
    }
    if (!this.inFlight(t, READY | UNREADY) && this.due(t, w.sentAt)) {
      t.queueEvent(this.cfg.me, { events: w.on ? READY : UNREADY });
      w.sentAt = t.localTick;
    }
  }

  private keepSwitch(t: Timeline, s: Readonly<MatchState>, T: Terrier | undefined): void {
    const w = this.switchWant!;
    if (T === undefined || T.joinTick !== w.joinTick || T.pack === w.to) {
      this.switchWant = null;
      return;
    }
    const flying = this.inFlight(t, SWITCH);
    if (s.phase !== WARM_UP || packCount(s, w.to) >= s.packSize) {
      if (flying) return;
      this.switchWant = null;
      this.switchRefusedNow = true;
      return;
    }
    if (!flying && this.due(t, w.sentAt)) {
      t.queueEvent(this.cfg.me, { events: SWITCH, switchPack: w.to });
      w.sentAt = t.localTick;
    }
  }

  /** PEERS on each change, the role's, a peer's and the timeline's included, and every peersEveryMs
   *  (§4.5, §6.5): at most peersMax IDs, which the decoder takes, and the timeline held as it stands
   *  now (P7). */
  private gossip(now: number): void {
    const role = this.role();
    if (role !== this.lastRole) {
      this.lastRole = role;
      this.peersDirty = true;
    }
    if (this.peers.size === 0 || !(this.peersDirty || now - this.lastPeersSent >= this.room.peersEveryMs)) return;
    this.peersDirty = false;
    this.lastPeersSent = now;
    const players = [...this.byPlayer.keys()].sort().slice(0, this.L.peersMax);
    const a = this.announcement();
    for (const info of this.peers.values()) info.told = a.timeline;
    this.link.broadcast(encodePeers(players, role, a));
  }

  /** A TICK of t's is to go to a peer that was last told of another timeline, or none. A page that
   *  sends nothing announces a timeline it joined in the next PEERS that goes. */
  private untold(t: Timeline): boolean {
    if (!t.started || (!t.sending && t.bots.size === 0)) return false;
    for (const info of this.peers.values()) if (info.told !== t.id) return true;
    return false;
  }

  // ---- Helpers ----

  private wishToPlay(pack: Pack, again: boolean): void {
    this.wish = { pack, again, triedOther: !again };
    this.refusedWhy = null;
    this.joinSentAt = NONE;
    this.current.sending = true;
  }

  /** This browser's terrier in t's final state. */
  private mine(t: Timeline): Terrier | undefined {
    if (!t.started) return undefined;
    const at = findTerrier(t.final, this.cfg.me);
    return at < 0 ? undefined : t.final.terriers[at];
  }

  /** player, or a bot derived from it, in the roster (D-17, D-21). */
  private inside(player: string, roster: ReadonlySet<string>): boolean {
    return inRoster(player, roster, (host) => this.botsOf(host));
  }

  private botsOf(host: string): readonly string[] {
    let ids = this.botIdsOf.get(host);
    if (ids === undefined) {
      ids = botIds(host);
      this.botIdsOf.set(host, ids);
    }
    return ids;
  }

  /** Its own terrier it sends for, or a hosted bot, in the final roster (§4.7). */
  private controlsTerrier(): boolean {
    const t = this.current;
    for (const T of t.final.terriers) if ((T.id === this.cfg.me && t.sending) || t.bots.has(T.id)) return true;
    return false;
  }

  /** §4.5: outside the roster, with none of its bots in it, the announced spectators connected and
   *  itself over the cap set spectatorsFull. Waits for the state to be held. */
  private spectatorCheck(): void {
    const t = this.current;
    if (!t.started || this.inside(this.cfg.me, new Set(t.final.terriers.map((x) => x.id)))) return;
    let announced = 0;
    for (const peer of this.byPlayer.values()) if (this.peers.get(peer)!.role === ROLE.SPECTATOR) announced++;
    if (spectatorsOverCap(announced + 1, this.room.spectatorsMax)) this.spectatorsFullNow = true;
  }

  /** A newcomer's count of the room, while it meets it (Settling): a watcher checks again on each timer
   *  run, as each handshake and PEERS brings the room's spectators in, so it never stays a fifth by
   *  counting the part of the room it had met when the state came (reviewer S2). */
  private settling(now: number): void {
    const s = this.settle!;
    if (this.choice === 'watch' && !this.spectatorsFullNow) this.spectatorCheck();
    const listed = this.peers.get(s.from)?.peers ?? null;
    let met = listed !== null;
    if (listed !== null) for (const p of listed) if (p !== this.cfg.me && !this.byPlayer.has(p)) met = false;
    if (met || now >= s.until) this.settle = null;
  }

  /** The timelines this session keeps: the one held, a rejoin's and a merge's. */
  private timelines(): Timeline[] {
    const out = [this.current];
    if (this.rejoin !== null) out.push(this.rejoin.t);
    if (this.merging !== null) out.push(this.merging.t);
    return out;
  }

  private expireHandshakes(now: number): void {
    for (const [p, h] of this.handshakes) if (now >= h.until) this.handshakes.delete(p);
  }

  private logDuplicate(player: string, at: number, verdict: number, oldSilentMs: number, oldPeer: string): void {
    if (this.dupLog.length < DUPLICATES_MAX) this.dupLog.push({ record: { player, at, verdict, oldSilentMs, oldLeftAt: null }, oldPeer });
  }

  /** A timeline of this session's: its STATE_REQs counted against each connection, so a STATE no
   *  one asked for is invalid, the known one-way delays set, the controls this browser's. */
  private newTimeline(): Timeline {
    const tl: TimelineConfig = {
      ...this.cfg.net.timeline, P: this.cfg.P, me: this.cfg.me, wire: this.L,
      ...(this.cfg.mode !== undefined ? { mode: this.cfg.mode } : {}),
      ...(this.cfg.verify !== undefined ? { verify: this.cfg.verify } : {}),
    };
    const send = (peer: string, bytes: Uint8Array): void => {
      const info = this.peers.get(peer);
      if (info !== undefined && bytes[0] === T.STATE_REQ) {
        info.asks++;
        info.askedAt = this.lastNow;
      }
      this.link.send(peer, bytes);
    };
    const t = new Timeline(tl, {
      broadcast: (bytes) => this.link.broadcast(bytes),
      sendToPlayer: (player, bytes) => {
        const peer = this.byPlayer.get(player);
        if (peer === undefined) return false;
        send(peer, bytes);
        return true;
      },
      sendToPeer: send,
    });
    t.controls = this.sample;
    t.peersToHear = () => this.peersToHear();
    t.lastAsked = (player) => {
      const peer = this.byPlayer.get(player);
      return peer === undefined ? -Infinity : this.peers.get(peer)!.askedAt;
    };
    for (const [player, peer] of this.byPlayer) {
      const ms = this.peers.get(peer)!.oneWayMs;
      if (ms !== null) t.setOneWay(player, ms);
    }
    return t;
  }

  /** The peers a warm-up waits for (T6), each by when this side met it, its HELLO's coming: each
   *  connected player, and each whose handshake this side accepted and is still under way, until it
   *  joins, fails or times out. In an overlapping burst a co-joiner's inputs may be in no STATE yet,
   *  while its JOIN reaches the others before its handshake here completes. */
  private peersToHear(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [player, peer] of this.byPlayer) out.set(player, this.peers.get(peer)!.metAt);
    for (const h of this.handshakes.values()) if (!out.has(h.player)) out.set(h.player, h.at);
    return out;
  }
}
