// One networked match in this tab (M3's design, research/m3/DESIGN.md,
// §1.24, §4.5, §4.9, §4.12, §8.5; PLAN D-17, D-21, D-31, Q-16, §8): the
// session, its transport and its timer, the stall and visibility rules, the
// scoreboard, the match summary, the traffic by type, and what M4's screens
// and the #test=net page read. roslambo's src/ui/game.ts, with the design's
// changes:
// - no ledger, saves or witnesses;
// - the timer and the page's visibility through Clock and PageEvents
//   (src/ui/clock.ts), so the Node tests run it in virtual time (C-6);
// - the stall checked on every timer run, and at once when the page shows
//   again, not only then: a gap over stallMs between runs is handed to
//   session.stalled(now), which rejoins from a peer whose clock ran on or
//   re-anchors (§4.12, A.4's Timer stall). A hidden page's timer keeps
//   running, as often as the browser lets it, so it keeps sending (D-31);
//   its input sources release what they held (D-29);
// - a fifth spectator, or a page a peer refused with REFUSE 4, leaves the
//   room: its pending bots' JOINs stop, and it closes leaveGraceMs later
//   (§4.5);
// - Play again (§4.9): AGAIN in this room, the next room's NetGame, which
//   proposes only if no AGAIN reached this one, under an ID that ranks the
//   presses by their tick, and this room closed leaveGraceMs later;
// - after each timer run the scoreboard is updated with the timeline held,
//   and the summary follows every timeline object the match passes through,
//   a rejoin's and a merge's, so it covers the whole match (M3-Q24); onRun
//   then lets the #test=net page press Ready at its tick (§7.2);
// - the session's link counts each message by its type byte, for the load
//   run's traffic (§8.5).
// Trystero is loaded only here, with import(), when a networked match opens
// (L238, design §0, §1.36): a normal page, the determinism page and Practice
// never load it.

import { defaultBotParams } from '../core/bot/brain';
import { nextMatchId } from '../core/match-id';
import { REFUSAL } from '../core/protocol/messages';
import type { Link, RoomPeer } from '../core/session/room-peer';
import { againTimelineId } from '../core/session/roster';
import { Scoreboard } from '../core/session/scoreboard';
import { type AgainChoice, Session } from '../core/session/session';
import { netSettings, type NetSettings } from '../core/session/settings';
import { type MatchNetSummary, SummaryBuilder } from '../core/session/summary';
import { defaultParams, findTerrier, type MatchSettings, type Pack } from '../core/sim/index';
import type { Correction, Timeline, TimelineStats } from '../core/timeline/timeline';
import { CURATED_RELAYS } from '../net/room-config';
import type { IceMode, Transport, TransportOptions } from '../net/transport';
import { browserClock, browserPage, type Clock, type PageEvents } from './clock';

/** Makes the room's transport for the session's room peer: Trystero's by default, or a test's. It's
 *  handed what Trystero's would be, the match ID among it. */
export type TransportFactory = (peer: RoomPeer, now: () => number, o: TransportOptions) => Promise<Transport>;

export interface NetGameOptions {
  readonly matchId: string;
  readonly me: string;
  readonly name: string;
  readonly coat: number;
  readonly build: string;
  /** null: the curated relays, plus extraRelays; otherwise exactly these, never none. */
  readonly relays: readonly string[] | null;
  readonly extraRelays?: readonly string[];
  readonly turn?: readonly RTCIceServer[];
  readonly ice: IceMode;
  readonly net?: NetSettings;
  readonly clock?: Clock;
  readonly page?: PageEvents;
  /** Tests: a transport other than Trystero's. */
  readonly transport?: TransportFactory;
  readonly again?: AgainChoice;
  readonly verify?: number;
}

/** Messages and bytes one way and the other. */
export interface TrafficCount {
  sent: number;
  received: number;
  sentBytes: number;
  receivedBytes: number;
}

/** The session's messages, by type byte (§8.5): a send is one message, a broadcast one for each
 *  connection it goes out on. The handshake and the transport's pings are the transport's own. */
export interface Traffic extends TrafficCount {
  readonly byType: Record<number, TrafficCount>;
}

const P = defaultParams;
const B = defaultBotParams;
const NO_TYPE = -1; // not a setting: an empty message's type
const TICK_COSTS_KEPT = 50_000; // not a setting: the log's bound, roslambo's
const PROPOSE_ID_BYTES = 8; // not a setting: a timeline ID's 8 random bytes (roslambo D-12)
const AGAIN_RANDOM_BYTES = 4; // not a setting: againTimelineId's 4 (§4.9)

const noop = (): void => {};

/** A fresh proposal's timeline ID: 8 random bytes in 16 lowercase hex digits, never all zero, which
 *  means none. */
function randomTimelineId(): string {
  const b = new Uint8Array(PROPOSE_ID_BYTES);
  crypto.getRandomValues(b);
  if (b.every((x) => x === 0)) b[PROPOSE_ID_BYTES - 1] = 1;
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** The room Trystero holds for the match: its chunk loads here, when a networked match opens. */
const trysteroRoom: TransportFactory = async (peer, now, o) => (await import('../net/trystero')).openRoom(o, peer, now);

function counted(traffic: Traffic, bytes: Uint8Array, copies: number, sent: boolean): void {
  if (copies <= 0) return;
  const type = bytes.length > 0 ? bytes[0]! : NO_TYPE;
  const row = (traffic.byType[type] ??= { sent: 0, received: 0, sentBytes: 0, receivedBytes: 0 });
  for (const r of [traffic, row]) {
    if (sent) {
      r.sent += copies;
      r.sentBytes += copies * bytes.length;
    } else {
      r.received += copies;
      r.receivedBytes += copies * bytes.length;
    }
  }
}

/** A copy of one timeline's stats. */
function copied(s: Readonly<TimelineStats>): TimelineStats {
  return { ...s, lateBy: [...s.lateBy], resyncMs: [...s.resyncMs], log: s.log.map(([t, e]): [number, string] => [t, e]) };
}

/** Two timelines' stats as one, b the later: the counts summed, the late bins bin by bin, the worst
 *  advance the larger, and the clock's state and the arrival's the later's. */
function combined(a: Readonly<TimelineStats>, b: Readonly<TimelineStats>): TimelineStats {
  const lateBy = Array.from({ length: Math.max(a.lateBy.length, b.lateBy.length) }, (_, k) => (a.lateBy[k] ?? 0) + (b.lateBy[k] ?? 0));
  return {
    sent: a.sent + b.sent,
    received: a.received + b.received,
    receivedInputs: a.receivedInputs + b.receivedInputs,
    late: a.late + b.late,
    lateBy,
    lateAbsent: a.lateAbsent + b.lateAbsent,
    agree: a.agree + b.agree,
    disagree: a.disagree + b.disagree,
    split: a.split + b.split,
    resyncs: a.resyncs + b.resyncs,
    resyncMs: [...a.resyncMs, ...b.resyncMs],
    resyncFailed: a.resyncFailed + b.resyncFailed,
    lateVoteFlips: a.lateVoteFlips + b.lateVoteFlips,
    statesSent: a.statesSent + b.statesSent,
    statesTruncated: a.statesTruncated + b.statesTruncated,
    statesRefused: a.statesRefused + b.statesRefused,
    steps: a.steps + b.steps,
    maxStepsPerAdvance: Math.max(a.maxStepsPerAdvance, b.maxStepsPerAdvance),
    spreadTicks: a.spreadTicks + b.spreadTicks,
    holds: a.holds + b.holds,
    reusedFinals: a.reusedFinals + b.reusedFinals,
    steppedFinals: a.steppedFinals + b.steppedFinals,
    rollbacks: a.rollbacks + b.rollbacks,
    corrections: a.corrections + b.corrections,
    verifyMismatches: a.verifyMismatches + b.verifyMismatches,
    jumps: a.jumps + b.jumps,
    rateAdj: b.rateAdj,
    medianOffset: b.medianOffset,
    warmMs: b.warmMs,
    joinedAt: b.joinedAt,
    log: [...a.log, ...b.log].map(([t, e]): [number, string] => [t, e]),
  };
}

export class NetGame {
  readonly matchId: string;
  readonly session: Session;
  readonly scoreboard = new Scoreboard(P);
  readonly traffic: Traffic = { sent: 0, received: 0, sentBytes: 0, receivedBytes: 0, byType: {} };
  /** ms per timer run that moved the clock: the load run's CPU figure, the first 50,000. */
  readonly tickCosts: number[] = [];
  /** Each correction of every timeline the match passes through, once the summary has its sizes:
   *  M4's drawing (D-16). */
  onCorrection: ((c: Correction) => void) | null = null;
  /** After each timer run's advance: where the #test=net page presses Ready at its tick, as the
   *  loopback's replay of its setup does (design §7.2, §8.1), and M4's screens look again. */
  onRun: (() => void) | null = null;

  private readonly options: NetGameOptions;
  private readonly net: NetSettings;
  private readonly clock: Clock;
  private readonly page: PageEvents;
  private readonly sizes: SummaryBuilder;
  private transportValue: Transport | null = null;
  /** The timeline whose corrections the summary takes, and the stats of those held before it. */
  private held: Timeline;
  private past: TimelineStats | null = null;
  private arrived: number | null = null;
  private lastRun = 0;
  private stopTimer: () => void = noop;
  private stopVisibility: () => void = noop;
  private cancelClose: () => void = noop;
  private isLeaving = false;
  private isClosed = false;
  private leftFull = false;
  private againPressed = false;

  /** The session's link: the transport, each message counted. */
  private readonly link: Link = {
    send: (peer, bytes) => {
      const t = this.transportValue;
      if (t === null) return;
      counted(this.traffic, bytes, 1, true);
      t.send(peer, bytes);
    },
    broadcast: (bytes) => {
      const t = this.transportValue;
      if (t === null) return;
      counted(this.traffic, bytes, t.peerCount(), true);
      t.broadcast(bytes);
    },
    drop: (peer) => this.transportValue?.drop?.(peer),
  };

  /** What the transport drives: the session, each message counted. This glue's timer advances the
   *  session, never a transport's (D-31). */
  private readonly peer: RoomPeer = {
    hello: () => this.session.hello(),
    checkHello: (hello, now, peer) => this.session.checkHello(hello, now, peer),
    onPeerJoin: (peer, hello, sent, now) => this.session.onPeerJoin(peer, hello, sent, now),
    onHandshakeFailed: (peer) => this.session.onHandshakeFailed(peer),
    onPeerLeave: (peer) => this.session.onPeerLeave(peer),
    onRtt: (peer, ms, now) => this.session.onRtt(peer, ms, now),
    onMessage: (peer, bytes, now) => {
      if (this.isClosed) return;
      counted(this.traffic, bytes, 1, false);
      this.session.onMessage(peer, bytes, now);
    },
    advance: noop,
  };

  private readonly now = (): number => this.clock.now();

  private constructor(o: NetGameOptions, net: NetSettings) {
    this.options = o;
    this.matchId = o.matchId;
    this.net = net;
    this.clock = o.clock ?? browserClock;
    this.page = o.page ?? browserPage;
    this.sizes = new SummaryBuilder(o.me);
    this.session = new Session(
      {
        P, B, net, me: o.me, name: o.name, coat: o.coat, build: o.build, forwarding: true,
        ...(o.verify !== undefined ? { verify: o.verify } : {}),
        ...(o.again !== undefined ? { again: o.again } : {}),
      },
      this.link,
    );
    this.held = this.session.timeline;
    this.held.onCorrection = (c) => this.corrected(c);
  }

  /** One match's room: the session, the transport (Trystero's, loaded now, or the options'), and the
   *  timer, every timerMs of the clock. */
  static async open(o: NetGameOptions): Promise<NetGame> {
    const net = o.net ?? netSettings();
    const relays = o.relays !== null ? [...o.relays] : [...new Set([...CURATED_RELAYS, ...(o.extraRelays ?? [])])];
    if (relays.length === 0) throw new Error('a networked match needs a signalling relay (PLAN D-18)');
    const game = new NetGame(o, net);
    const room: TransportOptions = {
      matchId: o.matchId, relays, ice: o.ice, ...(o.turn !== undefined ? { turn: o.turn } : {}), settings: net.transport,
    };
    game.transportValue = await (o.transport ?? trysteroRoom)(game.peer, game.now, room);
    // The timer's start is its run zero: a page frozen before its first run stalled too.
    game.lastRun = game.clock.now();
    game.stopTimer = game.clock.every(net.timerMs, () => game.run());
    // Shown again: the stall is checked at once, as roslambo's was, not at the next timer run.
    game.stopVisibility = game.page.onVisibility(() => {
      if (!game.page.hidden()) game.run();
    });
    return game;
  }

  // ---- What the screens and the #test=net page read ----

  /** On its way out of the room, by leave(), a full room or Play again, or out: it closes leaveGraceMs
   *  after the way out began. */
  get leaving(): boolean {
    return this.isLeaving || this.isClosed;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** The room's connections. */
  peers(): number {
    return this.transport.peerCount();
  }

  /** The last refusal the transport received, a REFUSE reason (PLAN §9). */
  get refusedBy(): number | null {
    return this.transport.refusedBy;
  }

  /** The final tick at which this page took the timeline it holds: 0 for its proposer, a STATE's for a
   *  joiner, a rejoin or a merge; −1 before it holds one. */
  get arrivedTick(): number {
    this.follow();
    return this.arrived ?? -1;
  }

  /** The stats of every timeline the match passed through, as one (combined). */
  stats(): TimelineStats {
    this.follow();
    return this.past === null ? copied(this.held.stats) : combined(this.past, this.held.stats);
  }

  /** The match's network summary (design §1.16, M3-Q24), over every timeline it passed through. */
  summary(): MatchNetSummary {
    return this.sizes.summary(this.stats());
  }

  /** Not a keeper, and no timeline connectionFailureMs after the room opened (PLAN §8). */
  failed(): boolean {
    return this.session.failed(this.clock.now());
  }

  /** The reason the screens show: SPECTATORS_FULL once this page left a full room (§4.5), whether its
   *  own count or a peer's REFUSE 4 said so; else, once no peer accepted it, the last refusal
   *  received (roslambo); else null. */
  refusal(): number | null {
    if (this.leftFull) return REFUSAL.SPECTATORS_FULL;
    const t = this.transport;
    return t.peerCount() === 0 ? t.refusedBy : null;
  }

  /** Q-16 (§4.7). */
  abandoned(): boolean {
    return this.session.abandoned(this.clock.now());
  }

  // ---- What the player does ----

  /** Genesis, now, as the keeper, under a fresh 8-byte timeline ID (§4.2). */
  propose(settings: MatchSettings): void {
    this.proposeAs(settings, randomTimelineId());
  }

  play(pack: Pack): void {
    this.session.play(pack);
  }

  /** A spectator: a fifth leaves the room (§4.5). */
  watch(): void {
    this.session.watch();
    this.checkFull();
  }

  ready(on: boolean): void {
    this.session.ready(on);
  }

  switchPack(): void {
    this.session.switchPack();
  }

  canAddBot(pack: Pack): boolean {
    return this.session.canAddBot(pack);
  }

  addBot(pack: Pack): boolean {
    return this.session.addBot(pack);
  }

  removeBot(pack: Pack): boolean {
    return this.session.removeBot(pack);
  }

  /** This browser's own input, sampled once a sent tick. */
  set controls(sample: () => number) {
    this.session.controls = sample;
  }

  /** The session's, passed through (§4.6): where the input source starts its press counters. */
  get onControl(): ((base: number) => void) | null {
    return this.session.onControl;
  }

  set onControl(f: ((base: number) => void) | null) {
    this.session.onControl = f;
  }

  /** LEAVE for the player and its bots, which ride in the TICKs the timer goes on sending, then the
   *  room closes leaveGraceMs later (§4.2). */
  leave(): void {
    if (this.isLeaving || this.isClosed) return;
    this.isLeaving = true;
    this.session.leave();
    this.closeLater();
  }

  /** The timer, the visibility listener and the room. */
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.stopTimer();
    this.stopVisibility();
    this.cancelClose();
    void this.transport.leave().catch(noop);
  }

  /** Play again (D-12, C-42, §4.9): AGAIN in this room, then the next room's NetGame, nextMatchId's,
   *  with this match's choices: the player's pack, or watching, and its bots'. It proposes genesis
   *  there with this match's settings only if no AGAIN reached this room, and otherwise joins the match
   *  the AGAIN's sender proposed. Its timeline ID starts with this timeline's tick at the press, so of
   *  presses that each propose, the earliest wins the merge on every page (againTimelineId). This room
   *  closes leaveGraceMs after the AGAIN, so it goes out. The options are this match's by default. */
  async playAgain(o: Omit<NetGameOptions, 'matchId' | 'again'> = this.options): Promise<NetGame> {
    if (this.againPressed) throw new Error('Play again was pressed already');
    if (this.isLeaving || this.isClosed) throw new Error('Play again from a match this page has left');
    const t = this.session.timeline;
    if (!t.started) throw new Error('Play again follows a match: this page holds none');
    const pressTick = t.clock(this.clock.now());
    const random = new Uint8Array(AGAIN_RANDOM_BYTES);
    crypto.getRandomValues(random);
    const s = t.final;
    const settings: MatchSettings = { packSize: s.packSize, matchMinutes: s.matchLengthTicks / P.ticksPerMinute };
    const choice = this.againChoice();
    this.againPressed = true;
    const matchId = await nextMatchId(this.matchId);
    if (this.isLeaving || this.isClosed) throw new Error('this match was left before Play again opened the next');
    this.session.announceAgain();
    this.isLeaving = true;
    this.closeLater();
    const againSeen = this.session.againSeen;
    const next = await NetGame.open({ ...o, matchId, again: { ...choice, againSeen } });
    if (!againSeen) next.proposeAs(settings, againTimelineId(pressTick, random));
    return next;
  }

  // ---- The timer ----

  /** One timer run: the timeline held followed, a gap over stallMs since the last run a stall (§4.12),
   *  the session's advance, the scoreboard, the run's cost, the spectator cap (§4.5), and onRun. A
   *  timeline is replaced only as a message's STATE is adopted, never inside an advance. */
  private run(): void {
    if (this.isClosed) return;
    const now = this.clock.now();
    const gap = now - this.lastRun;
    this.lastRun = now;
    this.follow();
    if (gap > this.net.stallMs) this.session.stalled(now);
    const t = this.session.timeline;
    const before = t.localTick;
    this.session.advance(now);
    this.scoreboard.update(t);
    if (t.localTick !== before && this.tickCosts.length < TICK_COSTS_KEPT) this.tickCosts.push(this.clock.now() - now);
    this.checkFull();
    this.onRun?.();
  }

  /** A fifth spectator, or a page a peer refused for the cap, leaves the room, its pending bots' JOINs
   *  stopped by the session's leave (§4.5). */
  private checkFull(): void {
    if (this.isLeaving || this.isClosed) return;
    if (!this.session.spectatorsFull && this.transport.refusedBy !== REFUSAL.SPECTATORS_FULL) return;
    this.leftFull = true;
    this.leave();
  }

  private closeLater(): void {
    this.cancelClose = this.clock.after(this.net.room.leaveGraceMs, () => this.close());
  }

  private proposeAs(settings: MatchSettings, timelineId: string): void {
    this.session.propose(this.clock.now(), settings, timelineId);
    this.follow();
  }

  /** The timeline the session holds now: a rejoin or a merge replaces it as a STATE is adopted (design
   *  §1.14), and the summary then takes the new one's corrections, keeping the old one's stats beside
   *  them. Each timer run follows it before its advance, where a timeline's corrections come from, so
   *  none is missed: a STATE adopted into a new timeline recomputes no drawn head. */
  private follow(): void {
    const t = this.session.timeline;
    if (t !== this.held) {
      this.held.onCorrection = null;
      this.past = this.past === null ? copied(this.held.stats) : combined(this.past, this.held.stats);
      this.held = t;
      this.arrived = null;
      t.onCorrection = (c) => this.corrected(c);
    }
    if (this.arrived === null && t.started) this.arrived = t.finalTick;
  }

  private corrected(c: Correction): void {
    this.sizes.add(c);
    this.onCorrection?.(c);
  }

  /** This match's choices for the next (D-12): the player's pack in the final roster, or null if it
   *  watched; its wanted bots' packs, as the roster shows them. */
  private againChoice(): Omit<AgainChoice, 'againSeen'> {
    const s = this.session.timeline.final;
    const at = findTerrier(s, this.options.me);
    const pack = at >= 0 ? s.terriers[at]!.pack : null;
    const bots = this.session.bots.hosted
      .filter((b) => b.wanted)
      .map((b) => {
        const k = findTerrier(s, b.id);
        return { pack: k >= 0 ? s.terriers[k]!.pack : b.pack };
      });
    return { pack, bots };
  }

  private get transport(): Transport {
    const t = this.transportValue;
    if (t === null) throw new Error('the room is still opening');
    return t;
  }
}
