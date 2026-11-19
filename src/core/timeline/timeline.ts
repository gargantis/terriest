// The timeline: rollback lockstep with majority votes (PLAN D-10, D-11,
// D-13 to D-16, D-22, D-31; M3's design, research/m3/DESIGN.md, §1.7, §2,
// §3.1–§3.4, §3.6).
//
// Tick t is final at local tick t + w: the inputs that have arrived for it
// by then are its inputs, and a sender with none is absent. Every TICK
// carries the sender's input for tick n + d, its inputs for the 16 ticks
// before, its events until they're final, the same for each bot it hosts,
// and its vote: the hash of its newest final state. Votes for g are tallied
// at local tick g + w + v, and late votes still count. A browser on the
// losing side fetches the winner's STATE and re-finalises from it.
//
// roslambo's src/core/timeline/timeline.ts, on phase 1's parts (inputs.ts,
// history.ts, votes.ts, clock.ts), with terriest's changes:
// - the predicted chain is kept tick by tick and re-simulated only from the
//   earliest tick whose base or inputs changed (D-11, §2.7), where roslambo
//   replayed its whole window every tick, as mode 'fullReplay' still does;
// - a predicted final is reused when its inputs held (§2.6), and a changed
//   base's steps are spread at spreadCap a tick, the drawn head held
//   meanwhile, never F and never moved back (§2.8);
// - silent terriers are predicted absent, a TICK's clear present bits are
//   marks, and the simulation takes inputs masked to KEPT_BITS (§2.2);
// - the late boundary is on the clock outside a warm-up, and every write
//   keeps to the stores' windows (§2.8, §2.12);
// - own votes are booked whatever repairing says, none is sent and no STATE
//   served while a resync is outstanding, and a STATE_REQ is answered only
//   for the tick and hash it names (§3.1, §3.4, §3.6);
// - D-12's payloads, and a LEAVE a STATE wiped out moves to the next own
//   input (M3 phase 1's answers);
// - pause and reanchor (D-22, §4.12), the correction observer (§2.11) and
//   the verify mode (§2.7).
// Pure: no DOM, timers or clocks. The caller passes `now` (ms, monotonic)
// and routes messages in.

import { config } from '../../config';
import { botIds } from '../bot/bot-id';
import {
  type BotEntry, encodeState as encodeStateMessage, encodeStateReq, encodeTick, type EventPayload, type InputRecord, NO_TICK,
  type SenderInput, type StateMsg, type StateReq, stateRecordsMax, type Tick, type TickEvent, wireLimits, type WireLimits, wireString,
  ZERO_HASH,
} from '../protocol/messages';
import type { TimelineSettings } from '../session/settings';
import {
  canonicalInputs, cloneState, decodeState, encodeState, genesis, hash64, hashState, JOIN, KEPT_BITS, LEAVE, makeSim,
  type MatchSettings, type MatchState, READY, sameInputs, type Sim, type SimParams, step, SWITCH, type TickInput, UNREADY,
} from '../sim';
import { TickClock } from './clock';
import { FinalHistory } from './history';
import { InputStore, type PutResult, type Recorded } from './inputs';
import { VoteBook } from './votes';

/** settings.ts's TimelineSettings: d, w and v (A.4), the 256-tick state history, the TICK's 16-tick
 *  history, the stores' span, the spread's cap (42), the joiner's warm-up, the resync's retry,
 *  stallSendTicks (Infinity in Practice, D-22) and the clock's settings. */
export interface TimelineConfig extends TimelineSettings {
  readonly P: SimParams;
  readonly me: string; // this browser's player ID
  readonly mode?: 'incremental' | 'fullReplay'; // D-11: "the full replay is one flag away"
  /** Tests: 0 or absent, off; 1, after every advance; n, after every nth advance that moved the clock
   *  and every one that adopted a STATE or stepped a changed base (§2.7). */
  readonly verify?: number;
  /** The wire's limits, the session's decode's: by default wireLimits() with this timeline's d, w,
   *  history and TICK history, so a changed configuration's TICKs and STATEs decode where its own
   *  limits decode them (M3 phase 1's note). */
  readonly wire?: WireLimits;
}

export interface TimelineOut {
  broadcast(bytes: Uint8Array): void;
  /** To one player's peer; false with no direct connection. */
  sendToPlayer(player: string, bytes: Uint8Array): boolean;
  /** To one connection, by transport peer ID. */
  sendToPeer(peer: string, bytes: Uint8Array): void;
}

/** A re-simulation that recomputed the drawn head's tick (D-16, §2.11): the measurement's, the match
 *  summary's and M4's input. Fired for every one, whether or not anything moved. before and after
 *  are the timeline's own objects, unchanged during the call: copy what's kept. */
export interface Correction {
  readonly tick: number; // the drawn head's tick before the change
  readonly from: number; // the earliest tick re-simulated
  readonly before: Readonly<MatchState>; // that tick's state as drawn
  readonly after: Readonly<MatchState>; // and as recomputed
  readonly repair: boolean; // the base came from a STATE: a resync or a late-vote repair
}

export interface TimelineStats {
  sent: number;
  received: number;
  late: number; // TICK inputs at or before the late boundary here
  lateBy: number[]; // lateBy[k]: inputs k + 1 ticks late, the last bin open-ended (D-16's count against w)
  lateAbsent: number; // (sender, tick) finalised absent here whose input came later
  agree: number;
  disagree: number;
  split: number;
  resyncs: number;
  resyncMs: number[];
  resyncFailed: number;
  lateVoteFlips: number;
  statesSent: number;
  statesTruncated: number; // D-18: a STATE that dropped input ticks
  statesRefused: number; // STATE_REQs not answered (§3.4)
  steps: number;
  maxStepsPerAdvance: number;
  spreadTicks: number; // advances that ended with the chain behind: a spread (§2.8)
  holds: number; // advances whose clock moved while the drawn head didn't
  reusedFinals: number;
  steppedFinals: number;
  rollbacks: number; // re-simulations that replaced an existing entry
  corrections: number;
  verifyMismatches: number;
  jumps: number;
  rateAdj: number;
  medianOffset: number;
  warmMs: number;
  joinedAt: number;
  log: [number, string][]; // [local tick, event], the first 300
}

/** A predicted tick: the state after stepping it, its own object, and the canonical inputs the step
 *  took (§2.1). Never written once entered, but by F taking it over at a reuse (§2.9). */
interface Entry {
  readonly tick: number;
  readonly state: MatchState;
  readonly used: readonly TickInput[];
}

/** An own event sent for the input at tick t, riding in every TICK until t is final (§2.4). */
interface SentEvent extends EventPayload {
  readonly t: number;
}

/** One local sender's events: this browser's player's, or a hosted bot's. */
interface Outbox {
  pending: EventPayload; // for its next input
  sent: SentEvent[];
}

interface Resync {
  readonly g: number;
  readonly hash: string;
  readonly candidates: readonly string[];
  next: number;
  askedAt: number;
  readonly divergedAt: number;
}

/** A STATE adopted, its re-finalisation not caught up yet (§3.4's steps 3 and 4). */
interface Repair {
  readonly g: number;
  readonly divergedAt: number;
}

interface Warm {
  readonly expect: readonly string[];
  readonly until: number;
  readonly from: number;
}

const EVENT_BITS = JOIN | LEAVE | READY | UNREADY | SWITCH; // not a setting: sim/input.ts's event bits, the wire's kinds
const U8 = 0xff; // not a setting: a payload byte on the wire
const U16 = 0xffff; // not a setting: A.2's input on the wire
const BACK_MAX = 0xff; // not a setting: TICK's u8 back (§2.4)
const LOG_MAX = 300; // not a setting: the log keeps its first entries
const ABSENT = -1; // not a setting: a predicted value of no input

/** A record as the simulation takes it: its input masked to A.1's kept bits, so a bark or bit 15
 *  never changes what the step sees (§2.2, M3-Q12); its payloads as the store keeps them. */
function tickInput(id: string, r: Readonly<Recorded>): TickInput {
  const x: { -readonly [K in keyof TickInput]: TickInput[K] } = { id, input: r.input & KEPT_BITS, events: r.events };
  if (r.joinPack !== undefined) x.joinPack = r.joinPack;
  if (r.coat !== undefined) x.coat = r.coat;
  if (r.name !== undefined) x.name = r.name;
  if (r.switchPack !== undefined) x.switchPack = r.switchPack;
  return x;
}

/** id's index in a canonical list, sorted by ID with `<`, or −1. */
function indexIn(used: readonly TickInput[], id: string): number {
  let lo = 0;
  let hi = used.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (used[mid]!.id < id) lo = mid + 1;
    else hi = mid;
  }
  return lo < used.length && used[lo]!.id === id ? lo : -1;
}

/** Whether a step would take r as it took x: masked input, events and payloads, field by field, as
 *  sameInputs compares one TickInput (§2.7). The values are wire bytes and masked integers. */
function sameAs(x: TickInput, r: Readonly<Recorded>): boolean {
  return (
    x.input === (r.input & KEPT_BITS) && x.events === r.events && x.joinPack === r.joinPack && x.coat === r.coat &&
    x.name === r.name && x.switchPack === r.switchPack
  );
}

/** A local sender's events as the wire carries them: the known kinds, each payload byte as its u8,
 *  a name as wireString gives it, and only under its event's bit. So a sender records its own
 *  events exactly as every receiver decodes them (§2.4, §5.7). */
function onWire(e: EventPayload, nameMax: number): EventPayload {
  const events = e.events & EVENT_BITS;
  const x: EventPayload = { events };
  if ((events & JOIN) !== 0) {
    x.joinPack = (e.joinPack ?? 0) & U8;
    x.coat = (e.coat ?? 0) & U8;
    x.name = wireString(e.name ?? '', nameMax);
  }
  if ((events & SWITCH) !== 0) x.switchPack = (e.switchPack ?? 0) & U8;
  return x;
}

/** e's events, keeping only `events`, with their payloads. */
function withEvents(e: EventPayload, events: number): EventPayload {
  const x: EventPayload = { events };
  if ((events & JOIN) !== 0) {
    if (e.joinPack !== undefined) x.joinPack = e.joinPack;
    if (e.coat !== undefined) x.coat = e.coat;
    if (e.name !== undefined) x.name = e.name;
  }
  if ((events & SWITCH) !== 0 && e.switchPack !== undefined) x.switchPack = e.switchPack;
  return x;
}

function recorded(input: number, e: EventPayload): Recorded {
  return { input, ...withEvents(e, e.events) };
}

const byPlayer = (a: InputRecord, b: InputRecord): number => (a.player < b.player ? -1 : a.player > b.player ? 1 : 0);

export class Timeline {
  readonly cfg: TimelineConfig;
  readonly stats: TimelineStats;
  /** A player or a candidate: it sends its own input (PLAN §8). */
  sending = false;
  /** This browser's u16, sampled once a sent tick. */
  controls: () => number = () => 0;
  /** Hosted bots' inputs, sampled once a sent tick (D-39, §4.8). */
  readonly bots = new Map<string, () => number>();
  onCorrection: ((c: Correction) => void) | null = null;

  private readonly out: TimelineOut;
  private readonly P: SimParams;
  private readonly L: WireLimits;
  private readonly fullReplay: boolean;
  private readonly verifyEvery: number;
  private readonly ticks: TickClock;
  private readonly store: InputStore;
  private readonly finals: FinalHistory;
  private readonly book: VoteBook;
  /** The predicted chain, a ring by tick: entries (finalTick, validTo] are valid (§2.1). */
  private readonly chain: (Entry | null)[];
  /** One Sim per pack size steps F and every predicted clone (§0). */
  private readonly sims: (Sim | undefined)[] = [];
  private idValue = ZERO_HASH;
  private isStarted = false;
  private local = 0;
  private finalAt = 0;
  /** The final state, stepped in place (§2.1). */
  private F: MatchState;
  /** The last tick whose entry is valid; never below finalTick (§2.1). */
  private validTo = 0;
  /** The earliest tick touched since the drawn head last moved (§2.11), and whether a STATE did it. */
  private touchedFrom = Infinity;
  private touchedByState = false;
  private headState: MatchState;
  private prevHeadState: MatchState;
  private headAt = 0;
  /** The recomputed state at the head's tick, kept when finalisation passed it while the head held. */
  private headRecomputed: MatchState | null = null;
  private agreed = 0;
  private lastTallied = 0;
  private resync: Resync | null = null;
  private repair: Repair | null = null;
  /** The last work left the chain short of its target: a spread (§2.8). */
  private behind = false;
  private repairedFrom = 0;
  private confirmed = true;
  private quietUntil = 0;
  /** A tally with no counted vote confirms only a tick after this one: a joiner's joinedAt − w, since
   *  the votes for earlier ticks may have gone out before it held the timeline (§3.1, §3.4). */
  private trustAfter = -Infinity;
  private warm: Warm | null = null;
  private readonly outbox = new Map<string, Outbox>(); // by local sender: me, or a hosted bot
  private readonly botIdsOf = new Map<string, ReadonlySet<string>>(); // host → the IDs its bots may have
  private readonly oneWayMs = new Map<string, number>();
  private readonly firstHeard = new Map<string, number>();
  private readonly lastHeard = new Map<string, number>();
  /** Every ID with a record here: finalisation checks whose newest tick it reached (§2.6). */
  private readonly senders = new Set<string>();
  /** By final tick: the roster's terriers finalised absent there (§9.3's lateAbsent). */
  private readonly absentAt = new Map<number, string[]>();
  /** The peers this browser asked for a STATE to join from (§4.10). */
  private readonly asked = new Set<string>();
  private movedAdvances = 0;
  /** A STATE adopted or a changed base stepped since the last verify (§2.7). */
  private verifyDue = false;
  /** This work verifies: its reused finals as they're taken, its chain at its end (§2.7). */
  private verifying = false;

  constructor(cfg: TimelineConfig, out: TimelineOut) {
    if (!(Number.isInteger(cfg.spreadCap) && cfg.spreadCap >= 1)) throw new RangeError(`a spread of ${cfg.spreadCap} steps a tick makes no progress (D-11)`);
    this.cfg = cfg;
    this.out = out;
    this.P = cfg.P;
    this.L =
      cfg.wire ??
      wireLimits({
        ...config,
        inputDelayTicks: cfg.delay,
        lateWindowTicks: cfg.window,
        stateHistoryTicks: cfg.history,
        inputHistoryTicks: cfg.inputHistory,
      });
    this.fullReplay = cfg.mode === 'fullReplay';
    this.verifyEvery = cfg.verify ?? 0;
    this.ticks = new TickClock({ ...cfg.clock, delay: cfg.delay, window: cfg.window });
    this.store = new InputStore(cfg.inputSpan);
    this.finals = new FinalHistory(cfg.history);
    this.book = new VoteBook(cfg.inputSpan);
    this.chain = new Array<Entry | null>(cfg.inputSpan).fill(null);
    // A placeholder until start or a STATE: no terrier, never stepped.
    this.F = genesis({ packSize: this.P.packSizeMin, matchMinutes: this.P.matchMinutesMin }, this.P);
    this.headState = cloneState(this.F);
    this.prevHeadState = this.headState;
    this.stats = {
      sent: 0, received: 0, late: 0, lateBy: new Array<number>(Math.max(1, cfg.inputHistory)).fill(0), lateAbsent: 0,
      agree: 0, disagree: 0, split: 0, resyncs: 0, resyncMs: [], resyncFailed: 0, lateVoteFlips: 0,
      statesSent: 0, statesTruncated: 0, statesRefused: 0,
      steps: 0, maxStepsPerAdvance: 0, spreadTicks: 0, holds: 0,
      reusedFinals: 0, steppedFinals: 0, rollbacks: 0, corrections: 0, verifyMismatches: 0,
      jumps: 0, rateAdj: 0, medianOffset: 0, warmMs: 0, joinedAt: 0, log: [],
    };
  }

  // ---- What others read ----

  /** The timeline's ID (roslambo D-12). */
  get id(): string {
    return this.idValue;
  }

  get started(): boolean {
    return this.isStarted;
  }

  get localTick(): number {
    return this.local;
  }

  get finalTick(): number {
    return this.finalAt;
  }

  /** The newest final state. */
  get final(): Readonly<MatchState> {
    return this.F;
  }

  /** The drawn head and the one drawn before it (§2.8): objects the timeline doesn't write while they
   *  are these, never F; held while a spread's chain is behind the tick they show. */
  get head(): Readonly<MatchState> {
    return this.headState;
  }

  get prevHead(): Readonly<MatchState> {
    return this.prevHeadState;
  }

  get headTick(): number {
    return this.headAt;
  }

  /** The newest tick whose tally agreed, or had no other vote (D-14). */
  get agreedTo(): number {
    return this.agreed;
  }

  /** A resync outstanding, a spread or a warm-up under way (§2.8). */
  get repairing(): boolean {
    return this.resync !== null || this.repair !== null || this.behind || this.warm !== null;
  }

  /** False while a resync is outstanding, or paused (§3.4, §4.12). */
  get answering(): boolean {
    return this.isStarted && this.resync === null && !this.ticks.paused;
  }

  get paused(): boolean {
    return this.ticks.paused;
  }

  isConfirmed(t: number): boolean {
    return this.isStarted && this.agreed >= t && !this.repairing;
  }

  /** '' past finalTick or outside the history. */
  hashAt(t: number): string {
    return t > this.finalAt ? '' : this.finals.hash(t);
  }

  rosterAt(t: number): readonly string[] {
    return t > this.finalAt ? [] : this.finals.roster(t);
  }

  /** The input actually received for (id, t), bark bits and all; never a predicted one (D-16). */
  receivedInput(id: string, t: number): number | undefined {
    return this.store.receivedInput(id, t);
  }

  newestInput(id: string): { readonly tick: number; readonly input: number } | undefined {
    return this.store.newest(id);
  }

  /** The local time a TICK from id last arrived, direct or forwarded. */
  heardAt(id: string): number | undefined {
    return this.lastHeard.get(id);
  }

  // ---- The clock (D-15, D-22, §2.13) ----

  clock(now: number): number {
    return this.isStarted ? this.ticks.read(now) : 0;
  }

  /** How far into the head tick, 0..1; 1 while the head is held behind the clock. */
  alpha(now: number): number {
    const a = this.clock(now) - this.headAt;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  pause(now: number): void {
    this.ticks.pause(now);
  }

  resume(now: number): void {
    this.ticks.resume(now);
  }

  /** After a stall with no peer that ran on (§4.12): the clock goes on from localTick, skipping the
   *  gap, and runs again if paused. */
  reanchor(now: number): void {
    this.ticks.set(now, this.local);
    if (this.ticks.paused) this.ticks.resume(now);
  }

  setOneWay(player: string, ms: number): void {
    this.oneWayMs.set(player, ms);
  }

  /** A player whose connection went: its clock samples and its one-way delay (§4.4). */
  forget(player: string): void {
    this.ticks.forget(player);
    this.oneWayMs.delete(player);
  }

  // ---- Lifecycle ----

  /** The first peer of a match: tick 0 is genesis, now (§4.2). A timeline holds one match. */
  start(now: number, settings: MatchSettings, id: string): void {
    if (this.isStarted) throw new Error('this timeline has started: a timeline holds one match');
    this.idValue = id;
    this.F = genesis(settings, this.P);
    this.ticks.set(now, 0);
    this.isStarted = true;
    this.storeFinal(0);
    this.headState = cloneState(this.F);
    this.prevHeadState = this.headState;
  }

  /** Events for `who`'s next input: this browser's player, or one of its bots. A later payload of a
   *  kind replaces an earlier one still waiting. */
  queueEvent(who: string, e: EventPayload): void {
    const p = this.outboxOf(who).pending;
    const x = onWire(e, this.L.nameMaxBytes);
    p.events |= x.events;
    if ((x.events & JOIN) !== 0) {
      p.joinPack = x.joinPack!;
      p.coat = x.coat!;
      p.name = x.name!;
    }
    if ((x.events & SWITCH) !== 0) p.switchPack = x.switchPack!;
  }

  /** The event bits of `who`'s own events not yet final here: waiting for its next input, or riding
   *  in its TICKs until their tick is final (§2.4), wherever a catch-up or a STATE put them. So
   *  BotHost keeps a bot hosted until its JOIN or LEAVE is final here (§4.8). */
  eventsInFlight(who: string): number {
    const o = this.outbox.get(who);
    if (o === undefined) return 0;
    let bits = o.pending.events;
    for (const e of o.sent) if (e.t > this.finalAt) bits |= e.events;
    return bits;
  }

  /** Asks a peer for its newest final state, to join its timeline. */
  requestState(peer: string): void {
    this.asked.add(peer);
    this.out.sendToPeer(peer, encodeStateReq(NO_TICK, ZERO_HASH));
  }

  // ---- One local tick (§2.3) ----

  advance(now: number): void {
    if (!this.isStarted || this.ticks.paused) return;
    const warm = this.warm;
    if (warm !== null && (now >= warm.until || warm.expect.every((id) => this.firstHeard.has(id)))) {
      this.stats.warmMs = now - warm.from;
      this.warm = null;
      this.note(`warm in ${Math.round(this.stats.warmMs)} ms`);
    }
    const target = Math.floor(this.ticks.read(now));
    const moved = target - this.local;
    const { delay: d, stallSendTicks } = this.cfg;
    while (this.local < target) {
      this.local++;
      // After a catch-up, only the newest ticks' inputs go: older ones would reach peers near the
      // end of their late window, in time for some and not others (A.4's Timer stall, D-10).
      if (this.local > target - stallSendTicks) this.send(this.local, now);
      else this.markSkipped(this.local + d);
    }
    if (moved > 0) this.movedAdvances++;
    this.work(now, this.cfg.spreadCap * Math.max(1, moved), moved > 0);
    if (this.ticks.rebalance(now) !== null) {
      const s = this.ticks.stats;
      if (s.jumps > this.stats.jumps) this.note(`jump ${s.medianOffset.toFixed(1)}`);
      this.stats.jumps = s.jumps;
      this.stats.rateAdj = s.rateAdj;
      this.stats.medianOffset = s.medianOffset;
    }
    if (this.resync !== null && now - this.resync.askedAt >= this.cfg.resyncRetryMs) this.askNext(now);
  }

  /** Finalisation, the tally, prediction and the drawn head, under one budget of steps (§2.3, §2.8). */
  private work(now: number, budget: number, moved: boolean): void {
    const w = this.cfg.window;
    const every = this.verifyEvery;
    this.verifying = every === 1 || (every > 1 && (this.verifyDue || (moved && this.movedAdvances % every === 0)));
    let steps = 0;
    // During a joiner's warm-up, finalisation is held (roslambo M0).
    if (this.warm === null) steps += this.finaliseToward(this.local - w, budget);
    this.tallyTo(Math.min(this.local - w - this.cfg.voteWindow, this.finalAt), now);
    // ≥, since tick 0 is final before localTick reaches w.
    if (this.finalAt >= this.local - w || this.warm !== null) {
      // The full replay recomputes the whole window from F every time (D-11), once the last
      // recomputation is through: a window longer than the budget still gets there.
      if (this.fullReplay && !this.behind) this.validTo = this.finalAt;
      steps += this.predictToward(this.local, budget - steps);
    }
    this.behind = (this.warm === null && this.finalAt < this.local - w) || this.validTo < this.local;
    this.stats.steps += steps;
    if (steps > this.stats.maxStepsPerAdvance) this.stats.maxStepsPerAdvance = steps;
    if (this.behind) this.stats.spreadTicks++;
    this.expose(moved);
    if (this.repair !== null && !this.behind) this.completeRepair(now);
    // Outside a repair, whose chain is still short of the head (§2.7).
    if ((this.verifying || (every > 0 && this.verifyDue)) && !this.repairing) {
      this.verifyChain();
      this.verifyDue = false;
    }
  }

  // ---- Sending (§2.4) ----

  /** One TICK for tick n + d: this browser's input if it plays, its bots', and its vote. */
  private send(n: number, now: number): void {
    if (!this.sending && this.bots.size === 0) return;
    const t = n + this.cfg.delay;
    const own = this.sending ? this.ownInput(this.cfg.me, this.controls, t) : null;
    const bots: BotEntry[] = [];
    for (const [id, sample] of this.bots) bots.push({ id, ...this.ownInput(id, sample, t) });
    for (const id of this.outbox.keys()) if (id !== this.cfg.me && !this.bots.has(id)) this.outbox.delete(id);
    // A vote only when not repairing: a browser that lost a tally stops telling others its losing
    // hashes until it holds the winner's (§3.1, §3.6).
    const f = this.finalAt;
    const vote = !this.repairing && this.votesFor(f);
    const m: Omit<Tick, 'type'> = {
      t, own, voteTick: vote ? f : NO_TICK, voteHash: vote ? this.finals.hash(f) : ZERO_HASH,
      phase: this.ticks.read(now) - n, // the encoder floors it below 1 (§5.3)
      bots,
    };
    this.out.broadcast(encodeTick(m, this.L));
    this.stats.sent++;
  }

  /** A local sender's input for tick t, recorded as it goes on the wire: its u16, its present inputs
   *  of the 16 ticks before, and its events until they're final (§2.4). */
  private ownInput(id: string, sample: () => number, t: number): SenderInput {
    const o = this.outboxOf(id);
    const input = sample() & U16;
    const p = o.pending;
    o.pending = { events: 0 };
    this.recordOwn(id, t, recorded(input, p));
    if (p.events !== 0) o.sent.push({ t, ...p });
    const f = this.finalAt;
    o.sent = o.sent.filter((e) => e.t > f && t - e.t <= BACK_MAX);
    let present = 0;
    const hist: number[] = [];
    for (let k = 0; k < this.L.inputHistory; k++) {
      const v = this.store.receivedInput(id, t - 1 - k);
      if (v !== undefined) present |= 1 << k;
      hist.push(v ?? 0);
    }
    const events: TickEvent[] = o.sent.map((e) => ({ back: t - e.t, ...withEvents(e, e.events) }));
    return { input, present, hist, events };
  }

  /** The ticks a catch-up skips: absent for good for this browser and its bots (§2.4). */
  private markSkipped(t: number): void {
    if (this.sending) this.mark(this.cfg.me, t);
    for (const id of this.bots.keys()) this.mark(id, t);
  }

  private outboxOf(who: string): Outbox {
    let o = this.outbox.get(who);
    if (o === undefined) {
      o = { pending: { events: 0 }, sent: [] };
      this.outbox.set(who, o);
    }
    return o;
  }

  /** The IDs `host`'s bots may have (roslambo Q-23). */
  private botsOf(host: string): ReadonlySet<string> {
    let ids = this.botIdsOf.get(host);
    if (ids === undefined) {
      ids = new Set(botIds(host));
      this.botIdsOf.set(host, ids);
    }
    return ids;
  }

  // ---- Receiving a TICK (§2.5) ----

  /** A TICK from `origin`, a player ID, after the session has attributed it (§4.10): its input, its
   *  bots' (only IDs that derive from it), and its vote. direct: from the origin's own connection,
   *  not a FWD; only a direct TICK is a clock sample. */
  onTick(origin: string, m: Tick, now: number, direct: boolean): void {
    const mine = this.botsOf(this.cfg.me);
    // Nobody speaks for this browser or its bots (§4.10).
    if (origin === this.cfg.me || mine.has(origin)) return;
    this.stats.received++;
    if (!this.isStarted) return;
    const clock = Math.floor(this.ticks.read(now));
    const w = this.cfg.window;
    // The late boundary (§2.8): on the clock, as every other peer finalised on time, but during a
    // joiner's warm-up, whose purpose is to take the inputs in flight (roslambo M0).
    const lo = this.warm !== null ? this.finalAt : Math.max(this.finalAt, clock - w);
    // "Ahead" of the clock, not of a stale localTick (roslambo §9.3, 2026-10-25).
    const hi = clock + 2 * w + this.cfg.delay;
    if (m.own !== null) this.take(origin, m.t, m.own, lo, hi, now);
    const theirs = this.botsOf(origin);
    for (const b of m.bots) if (theirs.has(b.id) && !mine.has(b.id)) this.take(b.id, m.t, b, lo, hi, now);
    if (m.voteTick !== NO_TICK) this.bookVote(origin, m.voteTick, m.voteHash, now);
    this.heard(origin, now);
    this.ticks.heard(origin, now);
    if (direct) this.ticks.sample(origin, m.t, m.phase, this.oneWayMs.get(origin) ?? 0, now);
  }

  /** One sender's input from a TICK: for tick t, its history, then its events, so an event finds its
   *  tick's record first (§2.5); each write only inside (lo, hi]. */
  private take(id: string, t: number, x: SenderInput, lo: number, hi: number, now: number): void {
    const before = this.predictedValue(id);
    this.senders.add(id);
    if (t <= lo) this.late(id, t, lo, true);
    else if (t <= hi) this.write(id, t, x.input);
    for (let k = 0; k < this.L.inputHistory; k++) {
      const u = t - 1 - k;
      const present = (x.present & (1 << k)) !== 0;
      if (u <= lo) {
        if (present) this.late(id, u, lo, false);
      } else if (u <= hi) {
        if (present) this.write(id, u, x.hist[k] ?? 0);
        else this.mark(id, u);
      }
    }
    for (const e of x.events) {
      const u = t - e.back;
      if (u > lo && u <= hi) this.afterRecord(id, u, this.store.putEvents(id, u, e));
    }
    this.heard(id, now);
    if (this.predictedValue(id) !== before) this.touchUnknown(id);
  }

  /** An input for (id, u) at or before the late boundary: a TICK's own counts as late, by how many
   *  ticks (D-16), and any that names a tick finalised absent here counts once in lateAbsent (§9.3). */
  private late(id: string, u: number, lo: number, own: boolean): void {
    if (own) {
      this.stats.late++;
      const bins = this.stats.lateBy;
      bins[Math.min(lo - u, bins.length - 1)]!++;
      this.note(`late ${id.slice(-2)} t${u} by ${lo - u + 1}`);
    }
    const absent = this.absentAt.get(u);
    const k = absent === undefined ? -1 : absent.indexOf(id);
    if (k >= 0) {
      absent!.splice(k, 1);
      this.stats.lateAbsent++;
    }
  }

  private heard(id: string, now: number): void {
    if (!this.firstHeard.has(id)) this.firstHeard.set(id, now);
    this.lastHeard.set(id, now);
  }

  // ---- The stores, and what each write invalidates (§2.7) ----

  /** The value id's unknown ticks are predicted with: its newest input, masked, while that's for a
   *  tick after finalTick; else absent (D-11's silent terriers). */
  private predictedValue(id: string): number {
    const n = this.store.newest(id);
    return n !== undefined && n.tick > this.finalAt ? n.input & KEPT_BITS : ABSENT;
  }

  private write(id: string, u: number, input: number): void {
    this.afterRecord(id, u, this.store.put(id, u, { input, events: 0 }));
  }

  /** This browser's or a bot's own record, which replaces whatever is stored (§4.10). */
  private recordOwn(id: string, t: number, r: Recorded): void {
    const before = this.predictedValue(id);
    this.senders.add(id);
    const res = this.store.put(id, t, r, true);
    if (res === 'refused') this.note(`own input refused t${t}`);
    this.afterRecord(id, t, res);
    if (this.predictedValue(id) !== before) this.touchUnknown(id);
  }

  private mark(id: string, u: number): void {
    if (!this.store.markAbsent(id, u) || u <= this.finalAt || u > this.validTo) return;
    // A mark changes a prediction only where it predicted the sender from its newest input.
    const e = this.entryAt(u);
    if (e === null || indexIn(e.used, id) >= 0) this.touch(u);
  }

  /** A record written at u: touched unless the step at u already took it as it is now, the common
   *  case of a held input (§2.7). */
  private afterRecord(id: string, u: number, res: PutResult): void {
    if ((res !== 'new' && res !== 'merged') || u <= this.finalAt || u > this.validTo) return;
    const e = this.entryAt(u);
    const r = this.store.get(id, u);
    if (e !== null && r !== undefined) {
      const k = indexIn(e.used, id);
      if (k >= 0 && sameAs(e.used[k]!, r)) return;
    }
    this.touch(u);
  }

  /** The value id's unknown ticks are predicted with changed: from the first tick after finalTick
   *  with neither a record nor a mark for it (§2.7). */
  private touchUnknown(id: string): void {
    this.touch(this.store.firstUnknown(id, this.finalAt, this.validTo));
  }

  /** Entries from u on must be recomputed (§2.7). */
  private touch(u: number): void {
    if (u > this.validTo) return;
    const from = Math.max(u, this.finalAt + 1);
    this.validTo = from - 1;
    if (from < this.touchedFrom) this.touchedFrom = from;
  }

  private entryAt(u: number): Entry | null {
    const e = this.chain[u % this.chain.length];
    return e !== null && e !== undefined && e.tick === u ? e : null;
  }

  private simFor(packSize: number): Sim {
    let sim = this.sims[packSize];
    if (sim === undefined) {
      sim = makeSim(this.P, packSize);
      this.sims[packSize] = sim;
    }
    return sim;
  }

  // ---- The simulation's inputs (§2.2) ----

  /** Every record at t, masked; a sender without one is absent (D-10). Marks never reach a final. */
  private finalInputs(t: number): TickInput[] {
    const out: TickInput[] = [];
    const records = this.store.at(t);
    if (records !== undefined) for (const [id, r] of records) out.push(tickInput(id, r));
    return canonicalInputs(out, out);
  }

  /** Every record at u, and each terrier of the base with none: absent where its sender said so, its
   *  newest input with no events while that's for a tick after finalTick, else absent (D-11). The
   *  newest input repeats its press counters as they were, so no press acts twice (D-10). */
  private predictedInputs(u: number, base: Readonly<MatchState>): TickInput[] {
    const out: TickInput[] = [];
    const records = this.store.at(u);
    if (records !== undefined) for (const [id, r] of records) out.push(tickInput(id, r));
    for (const T of base.terriers) {
      if (records?.has(T.id) === true || this.store.isAbsent(T.id, u)) continue;
      const n = this.store.newest(T.id);
      if (n !== undefined && n.tick > this.finalAt) out.push({ id: T.id, input: n.input & KEPT_BITS, events: 0 });
    }
    return canonicalInputs(out, out);
  }

  // ---- Finalisation, and reusing a prediction (§2.6) ----

  private finaliseToward(target: number, budget: number): number {
    let steps = 0;
    const H = this.cfg.history;
    while (this.finalAt < target && steps < budget) {
      const t = this.finalAt + 1;
      const ins = this.finalInputs(t);
      this.noteAbsent(t);
      const e = t <= this.validTo ? this.entryAt(t) : null;
      const same = e !== null && sameInputs(ins, e.used);
      // The base changed: every later entry was computed from another state (D-11).
      if (e !== null && !same) {
        this.touch(t);
        this.verifyDue = true;
      }
      if (same && !this.fullReplay) {
        if (this.verifying) this.verifyReuse(t, ins, e.state);
        // F steps in place, so it never takes an object the drawn head holds (§2.8).
        const s = e.state;
        this.F = s === this.headState || s === this.prevHeadState ? cloneState(s) : s;
        this.stats.reusedFinals++;
      } else {
        step(this.simFor(this.F.packSize), this.F, ins);
        steps++;
        this.stats.steppedFinals++;
      }
      this.chain[t % this.chain.length] = null;
      this.finalAt = t;
      if (this.validTo < t) this.validTo = t;
      this.storeFinal(t);
      if (t === this.headAt && this.touchedFrom <= t) this.headRecomputed = cloneState(this.F);
      // A sender whose newest tick is now final is predicted absent from here on (§2.6).
      for (const id of this.senders) if (this.store.newest(id)?.tick === t) this.touch(this.store.firstUnknown(id, t, this.validTo));
      this.store.retire(t - H);
      this.book.retire(t - H);
      this.absentAt.delete(t - H);
    }
    return steps;
  }

  /** The roster's terriers with no record at t, before t is stepped: lateAbsent's candidates (§9.3). */
  private noteAbsent(t: number): void {
    let absent: string[] | null = null;
    for (const T of this.F.terriers) {
      if (this.store.get(T.id, t) !== undefined) continue;
      (absent ??= []).push(T.id);
    }
    if (absent !== null) this.absentAt.set(t, absent);
  }

  /** Bytes, hash and roster into the history; this browser's vote, replacing any (§3.1). */
  private storeFinal(t: number): void {
    const bytes = encodeState(this.F);
    const hash = hash64(bytes);
    this.finals.put(t, bytes, hash, this.F.terriers.map((T) => T.id));
    if (this.votesFor(t)) this.book.add(t, this.cfg.me, hash);
  }

  // ---- Prediction and re-simulation (§2.7) ----

  private predictToward(target: number, budget: number): number {
    let steps = 0;
    let replaced = false;
    const room = this.chain.length;
    const sim = this.simFor(this.F.packSize);
    // The ring holds every tick the stores' windows can; past it a prediction waits.
    while (this.validTo < target && steps < budget && this.validTo + 1 - this.finalAt < room) {
      const u = this.validTo + 1;
      const base = u - 1 === this.finalAt ? this.F : this.entryAt(u - 1)!.state;
      const used = this.predictedInputs(u, base);
      const s = cloneState(base);
      step(sim, s, used);
      const k = u % room;
      if (this.chain[k]?.tick === u) replaced = true;
      this.chain[k] = { tick: u, state: s, used };
      this.validTo = u;
      steps++;
    }
    if (replaced) this.stats.rollbacks++;
    return steps;
  }

  // ---- The drawn head (§2.8) and corrections (§2.11) ----

  /** The state at u, never F: u's entry, or a clone of F at the final tick. */
  private stateAt(u: number): MatchState {
    return u > this.finalAt ? this.entryAt(u)!.state : cloneState(this.F);
  }

  /** The recomputed state at the head's tick H, for a correction. */
  private recomputedAt(H: number): Readonly<MatchState> {
    if (H > this.finalAt) return this.entryAt(H)!.state;
    if (H === this.finalAt) return this.F;
    const bytes = this.finals.bytes(H);
    return this.headRecomputed ?? (bytes === null ? null : decodeState(bytes, this.P)) ?? this.F;
  }

  /** Moves the drawn head only once the recomputed chain reaches the tick it shows, so a spread never
   *  moves it back (§2.8), and reports a correction when that recomputed it (§2.11). */
  private expose(moved: boolean): void {
    const H = this.headAt;
    const recomputed = this.touchedFrom <= H;
    if (this.validTo > H || (this.validTo === H && recomputed)) {
      const head = this.stateAt(this.validTo);
      const c: Correction | null = recomputed
        ? { tick: H, from: this.touchedFrom, before: this.headState, after: this.validTo === H ? head : this.recomputedAt(H), repair: this.touchedByState }
        : null;
      if (this.validTo > H) {
        this.prevHeadState = this.headState;
        this.headAt = this.validTo;
      }
      this.headState = head;
      this.touchedFrom = Infinity;
      this.touchedByState = false;
      this.headRecomputed = null;
      if (c !== null) {
        this.stats.corrections++;
        this.onCorrection?.(c);
      }
    } else if (moved) {
      this.stats.holds++;
    }
  }

  // ---- Votes and the tally (§3.1, §3.2) ----

  /** Confirmed (a joiner after its first agreeing tally or a resync), past its quiet ticks, and in
   *  control of a terrier in its own roster at t: one vote however many (§3.1). */
  private votesFor(t: number): boolean {
    if (!this.confirmed || t <= this.quietUntil) return false;
    const roster = this.finals.roster(t);
    if (this.sending && roster.includes(this.cfg.me)) return true;
    for (const id of roster) if (this.bots.has(id)) return true;
    return false;
  }

  /** Whether a voter's vote counts at g: it, or a bot derived from it, is in my roster there (D-13). */
  private counter(g: number): (voter: string) => boolean {
    const roster = new Set(this.finals.roster(g));
    return (voter) => {
      if (roster.has(voter)) return true;
      for (const b of this.botsOf(voter)) if (roster.has(b)) return true;
      return false;
    };
  }

  /** Another's vote, under its player ID, only for a tick in §2.12's window. */
  private bookVote(voter: string, g: number, hash: string, now: number): void {
    const top = Math.floor(this.ticks.read(now)) + this.cfg.window;
    if (!(g > this.finalAt - this.cfg.history && g <= top)) return;
    if (this.book.add(g, voter, hash) && g <= this.lastTallied) this.lateVote(g, now);
  }

  private tallyTo(target: number, now: number): void {
    while (this.lastTallied < target) {
      const g = ++this.lastTallied;
      const mine = this.hashAt(g);
      const r = this.book.tally(g, mine, this.counter(g));
      if (r === null) {
        // No counted vote: a lone peer, Practice or a match of spectators trusts itself. A joiner
        // does only for a tick whose votes all went out after it held the timeline, so one that
        // missed them still votes only once a tally agrees or a resync lands (§3.1, §3.4).
        if (mine !== '') {
          if (g > this.trustAfter) this.confirmed = true;
          this.agreed = g;
        }
        continue;
      }
      if (r.split) this.stats.split++;
      if (r.agree) {
        this.stats.agree++;
        this.confirmed = true;
        this.agreed = g;
      } else {
        this.stats.disagree++;
        this.note(`disagree ${g}`);
        if (this.resync === null) this.beginResync(g, r.win, now);
      }
    }
  }

  /** A vote that arrives after its tick's tally still counts (roslambo M0), but not during a repair
   *  or for a tick before the last repair's. */
  private lateVote(g: number, now: number): void {
    if (this.repairing || g < this.repairedFrom) return;
    const r = this.book.tally(g, this.hashAt(g), this.counter(g));
    if (r !== null && !r.agree) {
      this.stats.lateVoteFlips++;
      this.note(`late vote flips ${g}`);
      this.beginResync(g, r.win, now);
    }
  }

  // ---- The STATE resync (§3.4) ----

  private beginResync(g: number, hash: string, now: number): void {
    this.resync = { g, hash, candidates: this.book.voters(g, hash, this.cfg.me), next: 0, askedAt: -Infinity, divergedAt: now };
    this.askNext(now);
  }

  /** The winner's voters by ID, one every resyncRetryMs, each reached directly; with none left, the
   *  next tally that disagrees tries again. */
  private askNext(now: number): void {
    const r = this.resync!;
    const req = encodeStateReq(r.g, r.hash);
    while (r.next < r.candidates.length) {
      if (this.out.sendToPlayer(r.candidates[r.next++]!, req)) {
        r.askedAt = now;
        return;
      }
    }
    this.stats.resyncFailed++;
    this.note(`resync failed ${r.g}`);
    this.resync = null;
  }

  /** A STATE_REQ: answered only for (NO_TICK, zero), the newest final state, or a final tick the
   *  history holds with the hash asked for, and never while a resync is outstanding (§3.4). */
  onStateReq(peer: string, m: StateReq, now: number): boolean {
    if (!this.answering) return this.refuse();
    let g: number;
    if (m.tick === NO_TICK) {
      g = this.finalAt;
      if (m.want !== ZERO_HASH && this.finals.hash(g) !== m.want) return this.refuse();
    } else {
      g = m.tick;
      if (!(g <= this.finalAt && this.finals.has(g) && (m.want === ZERO_HASH || this.finals.hash(g) === m.want))) return this.refuse();
    }
    const state = this.finals.bytes(g);
    // The clock, not localTick: a page whose timers sleep has a stale localTick (roslambo 2026-10-25).
    const clock = this.ticks.read(now);
    const senderTick = Math.floor(clock);
    // −1 where a clock that jumped back puts the ticks outside §5.5's bounds: no receiver takes it.
    const most = stateRecordsMax(g, this.finalAt, senderTick, this.L);
    if (state === null || most < 0) return this.refuse();
    const inputs: InputRecord[][] = [];
    const last = Math.min(this.local + this.cfg.delay, g + most);
    for (let t = g + 1; t <= last; t++) inputs.push(this.recordsAt(t));
    const { bytes, kept } = encodeStateMessage(
      { timeline: this.idValue, senderTick, phase: clock - senderTick, g, senderFinal: this.finalAt, state, inputs },
      this.finals.roster(g),
      this.L,
    );
    if (kept < inputs.length) {
      this.stats.statesTruncated++;
      this.note(`STATE for ${g} kept ${kept} of ${inputs.length}`);
    }
    this.stats.statesSent++;
    this.out.sendToPeer(peer, bytes);
    return true;
  }

  private refuse(): false {
    this.stats.statesRefused++;
    return false;
  }

  /** Tick t's records for a STATE, by ID. After the final tick, none that events alone made: their
   *  input 0 isn't one anybody sent, and their events ride in their origin's TICKs (parts-T6). */
  private recordsAt(t: number): InputRecord[] {
    const out: InputRecord[] = [];
    const records = this.store.at(t);
    if (records === undefined) return out;
    for (const [player, r] of records) {
      if (t > this.finalAt && this.store.receivedInput(player, t) === undefined) continue;
      out.push({ player, input: r.input, ...withEvents(r, r.events) });
    }
    return out.sort(byPlayer);
  }

  /** A STATE: adopted when joining, from a peer asked, or a solicited repair: this timeline's, at the
   *  tick asked, hashing to the winner. True if taken (§3.4, §4.10). */
  onState(peer: string, m: StateMsg, oneWayMs: number, now: number): boolean {
    if (!this.isStarted) {
      if (!this.asked.has(peer)) return false;
      this.adoptJoining(m, oneWayMs, now);
      return true;
    }
    const r = this.resync;
    if (r === null || m.timeline !== this.idValue || m.g !== r.g || m.decoded.packSize !== this.F.packSize) return false;
    if (hash64(m.state) !== r.hash) return false;
    this.adoptRepair(m, r, now);
    return true;
  }

  /** roslambo's joining: the clock from the sender's and the one-way delay, finalisation held until
   *  every sender active in the STATE has been heard from or warmupMs has passed, and no vote until a
   *  tally agrees (§3.4). */
  private adoptJoining(m: StateMsg, oneWayMs: number, now: number): void {
    this.idValue = m.timeline;
    this.F = cloneState(m.decoded);
    this.finalAt = m.g;
    this.validTo = m.g;
    const bytes = m.state.slice();
    this.finals.put(m.g, bytes, hash64(bytes), this.F.terriers.map((T) => T.id));
    this.importInputs(m);
    this.ticks.set(now, m.senderTick + m.phase + oneWayMs / this.cfg.clock.tickMs);
    this.isStarted = true;
    const target = Math.max(m.g, Math.floor(this.ticks.read(now)));
    this.local = target;
    this.quietUntil = target;
    this.trustAfter = target - this.cfg.window;
    this.lastTallied = Math.max(this.finalAt, target - this.cfg.window - this.cfg.voteWindow);
    this.stats.joinedAt = target;
    // A host back from a reload hears nothing from its own bots (roslambo).
    const mine = this.botsOf(this.cfg.me);
    const expect = new Set<string>();
    for (const records of m.inputs) for (const x of records) if (x.player !== this.cfg.me && !mine.has(x.player)) expect.add(x.player);
    this.confirmed = false;
    this.warm = expect.size > 0 ? { expect: [...expect].sort(), until: now + this.cfg.warmupMs, from: now } : null;
    this.headState = cloneState(this.F);
    this.prevHeadState = this.headState;
    this.headAt = m.g;
    this.verifyDue = true;
    this.note(`joined at ${m.g}`);
    this.work(now, this.cfg.spreadCap, false);
  }

  /** §3.4's taking: F and the history at g, nothing of the losing lineage after it, the inputs
   *  imported, and the re-finalisation under the spread's budget. The own votes it books replace the
   *  stale ones (§3.1). */
  private adoptRepair(m: StateMsg, r: Resync, now: number): void {
    this.resync = null;
    this.repair = { g: m.g, divergedAt: r.divergedAt };
    this.F = cloneState(m.decoded);
    this.finalAt = m.g;
    const bytes = m.state.slice();
    this.finals.dropAfter(m.g);
    this.finals.put(m.g, bytes, r.hash, this.F.terriers.map((T) => T.id));
    if (this.votesFor(m.g)) this.book.add(m.g, this.cfg.me, r.hash);
    for (const t of this.absentAt.keys()) if (t > m.g) this.absentAt.delete(t);
    this.importInputs(m);
    this.moveWipedLeaves(m);
    // A changed base: every entry after g goes (§2.7).
    this.validTo = m.g;
    if (m.g + 1 < this.touchedFrom) this.touchedFrom = m.g + 1;
    this.touchedByState = true;
    this.headRecomputed = null;
    this.verifyDue = true;
    this.note(`STATE ${m.g}`);
    this.work(now, this.cfg.spreadCap, false);
  }

  /** Inputs up to the sender's final tick replace this browser's exactly, absences included; after
   *  it they're added (roslambo). */
  private importInputs(m: StateMsg): void {
    m.inputs.forEach((records, i) => {
      const t = m.g + 1 + i;
      for (const x of records) this.senders.add(x.player);
      if (t <= m.senderFinal) this.store.replace(t, records.map((x) => ({ id: x.player, ...recorded(x.input, x) })));
      else for (const x of records) this.store.put(x.player, t, recorded(x.input, x));
    });
  }

  /** Own events at ticks a STATE replaced keep only what its record there carries, so this browser's
   *  TICKs say what its store holds. JOIN, READY, UNREADY and SWITCH come back by the session's retry;
   *  a LEAVE doesn't, so one the STATE wiped out moves to the sender's next input (M3 phase 1's
   *  answers). */
  private moveWipedLeaves(m: StateMsg): void {
    const last = Math.min(m.senderFinal, m.g + m.inputs.length);
    for (const [who, o] of this.outbox) {
      const kept: SentEvent[] = [];
      for (const e of o.sent) {
        if (e.t <= m.g || e.t > last) {
          kept.push(e);
          continue;
        }
        const r = this.store.get(who, e.t);
        const events = r === undefined ? 0 : e.events & r.events;
        if ((e.events & ~events & LEAVE) !== 0) o.pending.events |= LEAVE;
        if (events !== 0) kept.push({ t: e.t, ...withEvents(r!, events) });
      }
      o.sent = kept;
    }
  }

  /** §3.4's step 4: once caught up. */
  private completeRepair(now: number): void {
    const r = this.repair!;
    this.repair = null;
    this.repairedFrom = r.g;
    this.confirmed = true;
    if (r.g > this.agreed) this.agreed = r.g;
    this.stats.resyncs++;
    this.stats.resyncMs.push(now - r.divergedAt);
    this.note(`resync ${r.g} in ${Math.round(now - r.divergedAt)} ms`);
  }

  // ---- Tests' checks (§2.7) ----

  /** A reused final against F stepped with the final inputs. */
  private verifyReuse(t: number, ins: readonly TickInput[], reused: Readonly<MatchState>): void {
    const s = cloneState(this.F);
    step(this.simFor(s.packSize), s, ins);
    if (hashState(s) !== hashState(reused)) {
      this.stats.verifyMismatches++;
      this.note(`verify: reused final ${t}`);
    }
  }

  /** The window recomputed from F with the inputs prediction would use now, against every entry. */
  private verifyChain(): void {
    const sim = this.simFor(this.F.packSize);
    let base: MatchState = this.F;
    for (let u = this.finalAt + 1; u <= this.validTo; u++) {
      const e = this.entryAt(u);
      const used = this.predictedInputs(u, base);
      const s = cloneState(base);
      step(sim, s, used);
      if (e === null || !sameInputs(used, e.used) || hashState(s) !== hashState(e.state)) {
        this.stats.verifyMismatches++;
        this.note(`verify: entry ${u}`);
      }
      base = s;
    }
  }

  private note(e: string): void {
    if (this.stats.log.length < LOG_MAX) this.stats.log.push([this.local, e]);
  }
}
