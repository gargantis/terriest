// The frame-time bench's room (M4's design, research/m4/DESIGN.md, §1.53,
// §2.11, §8.3; PLAN §16's frame-time run, §17's "From M3"; M3-Q14, M4-Q16,
// M4-Q18): a TransportFactory for NetGame.open, so the #test=frames page
// (src/frames.ts) plays the real NetGame, session and timeline against
// seven virtual players on the page itself. roslambo's VirtualRoom, with
// terriest's changes:
// - each virtual player's input is the bot brain's on the page's own drawn
//   head, once a head tick (a bench may read its page), sent in a real TICK
//   for each of the page's local ticks, with its 16 ticks of history; it
//   joins its pack with JOIN in its TICKs, again while the page's final
//   state lacks it, and READY two seconds after the state shows it, again
//   while it isn't ready in warm-up, as roslambo's peers did;
// - its links: one way 20–80 ms, spread by the seed, with 15 ms of jitter,
//   each link FIFO, as Trystero's reliable channel is; their packs alternate
//   from B, the page's A. A TICK is sent when the player's clock, the
//   page's, reaches its tick, at a phase of its own timer's, so one the room
//   makes late, its thread held by the page, was still sent on time and
//   comes as a backlog, as a real peer's would; with a witness the room
//   makes each a few ticks ahead, so the witness has it in time whatever
//   holds the page's thread;
// - one shared delivery: every message to the page waits in one queue,
//   in order of its arrival time, and is delivered in a task of its own, a
//   MessageChannel post, as a data channel fires one event a message, so a
//   burst is many tasks with frames between them, never one long one; with
//   a capacity, at most that many a second, so a run can reproduce a path
//   that falls behind (the load run's lesson). The queue's backlog, the
//   messages due and not yet delivered, is kept every second, by link and
//   summed, from the room's start, before the countdown. With the bench's
//   frames held (frameMs, §8.1), each task delivers every message due:
//   Chromium then runs about one task between two held frames, so a task a
//   message would deliver about one message a frame, the joins would never
//   land and the page's clock would follow samples seconds old (phase 2b's
//   review, bench-F1);
// - no witness in the frame-time run (M4-Q16): each TICK votes the page's
//   own final hash for its sender's newest final tick, as honest peers'
//   agreeing votes would, so the page's thread carries one timeline, as a
//   real page's does;
// - for the forced repair (repair=1) a witness: one of the seven is a real
//   Session and timeline in a module Worker (src/bench/witness.ts, its own
//   chunk, same-origin, which nothing imports), which takes the page's
//   TICKs and the others' by postMessage and plays its terrier with the
//   brain on its own head; the others then vote its final hashes. The page
//   asks one of them for a STATE when it loses a tally: the room hands each
//   STATE_REQ to the witness, and its STATE comes back on the connection
//   the page asked, as the witness's own join asks reach the page. So the
//   page repairs from a real STATE while its thread does a real page's
//   work (§8.3);
// - the hold (§2.11): armed holdAtMs into play, it begins once the room is
//   calm, nothing overdue to the page and neither the page nor the witness
//   in a transient for CALM_MS, or CALM_WITHIN_MS after arming whatever,
//   the report saying which, so the repair starts from a settled page and
//   witness (phase 2b's review, bench-F2); then every message to the page
//   waits until holdMs from the hold's start, FIFO, as M3's cap check held
//   them in Node (dev/corrections.measure.ts), so the page finalises its
//   peers' inputs absent, tallies alone, and repairs from about 240 ticks
//   back once the late votes come: about 1,700 TICKs fall due as it ends,
//   every link's in the order they were sent, each a task of its own, so
//   the first votes for the first ticks the hold parted come before any
//   input recent enough to re-simulate the page's chain, which would set
//   late votes aside while it spreads; and the page's TICKs reach the
//   witness without their votes during it, as the witness's reach the page
//   without theirs before it, so neither's transient decides the other's
//   tallies. The witness's hashes rule the votes from the hold's start to
//   the page's first completed resync after it, and the page's own again
//   from then, so a later transient of the witness's can't cascade into
//   the page's (bench-F2);
// - its report: the page's message calls, and the timer runs src/frames.ts
//   times, from the hold to a second after the repair, with their steps,
//   a STATE's with its ticks; the backlog; the room's own time on the page, its brains, encoding and
//   delivery, apart from the page's (an estimated 0.1–0.3 ms a tick); the
//   age of each TICK the page's clock took as a sample, from its due time
//   to its handling (§8.4's run 4); and the witness's STATEs.
// Nothing here contacts anything: the relays NetGame passes go unused.

import { config } from '../config';
import { defaultBotParams } from '../core/bot/brain';
import { personId } from '../core/bot/bot-id';
import { scriptSampler } from '../core/bot/setups';
import {
  decode, encodeTick, type Hello, NO_TICK, NO_TIMELINE, PROTOCOL_VERSION, ROLE, type StateReq, T, type Tick, type TickEvent, wireLimits, ZERO_HASH,
} from '../core/protocol/messages';
import type { RoomPeer } from '../core/session/room-peer';
import { netSettings } from '../core/session/settings';
import { defaultParams, findTerrier, IN_PLAY, JOIN, type MatchState, type Pack, READY, WARM_UP } from '../core/sim/index';
import type { Timeline, TimelineStats } from '../core/timeline/timeline';
import { mulberry32 } from '../net/loopback';
import type { Transport, TransportOptions } from '../net/transport';
import { browserClock, type Clock } from '../ui/clock';
import type { TransportFactory } from '../ui/game';

const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const L = wireLimits();
const D = NET.timeline.delay;
const W = NET.timeline.window;
const U16 = 0xffff; // not a setting: A.2's input on the wire
/** An event rides in its sender's TICKs this many ticks, twice its way to final, then goes again if the
 *  page's final state still lacks it. */
const EVENT_TICKS = 2 * (D + W); // not a setting: the room's re-send
/** A virtual player readies this long after the page's final state shows it, as roslambo's did. */
const READY_AFTER_TICKS = 120; // not a setting: roslambo's bench
const SECOND_MS = 1000; // not a setting: the backlog's period
/** With a witness, a virtual player's TICK is made this many ticks before it's due to be sent, so a stall
 *  of the page's thread shorter than that, a long frame's, never delays its reaching the witness's Worker:
 *  its link still delivers it to each side when it's due, as an independent peer's would come. */
const LEAD_TICKS = 6; // not a setting: the room's lead, 100 ms
/** The virtual players join staggered, at the page's local ticks JOIN_FIRST + JOIN_EVERY × k, roslambo's. */
const JOIN_FIRST = 20; // not a setting: roslambo's bench
const JOIN_EVERY = 10; // not a setting: roslambo's bench
/** The hold begins once neither the page nor the witness has been in a transient, a disagreeing tally or a
 *  resync, for CALM_MS, and nothing to the page has been overdue a tick; or CALM_WITHIN_MS after it was due
 *  to, calm or not (bench-F2). */
const CALM_MS = 2000; // not a setting: the bench's method
const CALM_WITHIN_MS = 15_000; // not a setting: the bench's method
/** With a witness, the hold starts this long after it's decided, so no TICK made ahead before then is held. */
const HOLD_LEAD_MS = (LEAD_TICKS + 1) * NET.tickMs; // not a setting: the room's lead and a tick
/** The repair's calls are kept until this long after it completes, and the kept calls at most. */
const AROUND_MS = 1000; // not a setting: the report's window
const CALLS_KEPT = 50_000; // not a setting: the report's bound
const PER_TICK_KEPT = 200_000; // not a setting: the report's bound, a whole match's samples and more
/** The witness's final hashes kept, by tick: as many as a TICK's vote can name. */
const FINALS_KEPT = 2 * NET.timeline.history; // not a setting
/** The page's connection to the witness's, as the witness's session names it. */
export const PAGE_PEER = 'page'; // not a setting: a connection's name
/** The type bytes' names (T). */
const KINDS: Readonly<Record<number, string>> = Object.fromEntries(Object.entries(T).map(([name, code]) => [code, name]));

/** What the room reads of the page's timeline. */
export type PageTimeline = Pick<Timeline, 'started' | 'localTick' | 'finalTick' | 'head' | 'headTick' | 'final' | 'clock' | 'hashAt' | 'stats' | 'repairing'>;

export interface VirtualRoomOptions {
  /** The virtual players: 2 × packSize − 1 fills both packs with the page. */
  readonly peers: number;
  readonly seed: number;
  /** One way, the range the links are spread over. */
  readonly latencyMs: readonly [number, number];
  readonly jitterMs: number;
  readonly build: string;
  /** The shared delivery's messages a second; null: unbounded. */
  readonly capacityPerSecond: number | null;
  /** The forced repair (M3-Q14): how far into play the hold starts, null for none, and how long it holds. */
  readonly holdAtMs: number | null;
  readonly holdMs: number;
  /** false for the frame-time run: the peers vote the page's own final hash (M4-Q16). true for the forced
   *  repair: a real Session and timeline in a module Worker votes and answers STATE_REQ with a real STATE. */
  readonly witness: boolean;
  /** Each delivery's task delivers every message due, not one: the bench's held frames alone (§8.1). */
  readonly drain?: boolean;
  /** Tests: the page clock and its timers (browserClock), its time origin (performance.timeOrigin), a task
   *  of its own for each delivery (a MessageChannel post), and the witness's Worker (src/bench/witness.ts's). */
  readonly clock?: Clock;
  readonly origin?: number;
  readonly task?: (fn: () => void) => void;
  readonly worker?: () => WitnessPort;
}

/** To the witness's Worker (src/bench/witness.ts). */
export type ToWitness =
  | {
    readonly kind: 'init'; readonly me: string; readonly name: string; readonly coat: number; readonly pack: Pack; readonly build: string;
    readonly readyAfterTicks: number;
    /** The other virtual players' connections, already open: their HELLOs and round trips. */
    readonly peers: readonly { readonly peer: string; readonly hello: Hello; readonly rttMs: number }[];
  }
  /** The page's connection, once the page's side of the handshake is done. */
  | { readonly kind: 'join'; readonly peer: string; readonly hello: Hello; readonly rttMs: number }
  /** A message for the witness from a connection, due at dueAt, FIFO on that connection; an answer to it
   *  goes out as if from replyAs, the connection the page asked, when given. dueAt is on the shared origin,
   *  the page's clock plus its time origin, so a Worker that takes it late still hands it on when due. */
  | { readonly kind: 'message'; readonly from: string; readonly bytes: Uint8Array; readonly dueAt: number; readonly replyAs: string | null }
  | { readonly kind: 'close' };

/** From it. */
export type FromWitness =
  | { readonly kind: 'hello'; readonly hello: Hello }
  /** as: the connection the page asked, for an answer; state: a STATE's tick and its sender's, read there;
   *  at: when it was sent, on the shared origin, so a page busy when the post comes takes it as late as a
   *  real peer's message would come, not that and its link's delay on top. */
  | {
    readonly kind: 'send'; readonly to: string; readonly bytes: Uint8Array; readonly as: string | null; readonly at: number;
    readonly state?: { readonly g: number; readonly senderTick: number };
  }
  | { readonly kind: 'broadcast'; readonly bytes: Uint8Array; readonly at: number }
  /** Its final ticks' hashes since the last, oldest first. */
  | { readonly kind: 'finals'; readonly finals: readonly (readonly [number, string])[] }
  /** Its timeline's figures, every second, for the report. */
  | { readonly kind: 'figures'; readonly figures: WitnessFigures }
  | { readonly kind: 'error'; readonly message: string };

/** The witness's timeline as it reports itself (src/bench/witness.ts). */
export interface WitnessFigures {
  readonly localTick: number;
  readonly finalTick: number;
  readonly stats: Pick<TimelineStats, 'late' | 'lateAbsent' | 'agree' | 'disagree' | 'resyncs' | 'resyncFailed' | 'jumps' | 'medianOffset' | 'joinedAt' | 'warmMs' | 'statesSent' | 'statesRefused'>;
  /** Its log's first entries, [local tick, event]. */
  readonly log: readonly (readonly [number, string])[];
}

/** What the room needs of the witness's Worker: a Worker satisfies it. */
export interface WitnessPort {
  postMessage(m: ToWitness): void;
  onmessage: ((e: MessageEvent<FromWitness>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  terminate(): void;
}

/** One of the page's calls the report keeps: a message's, by its type, or a timer run's. */
export interface RoomCall {
  readonly at: number;
  readonly ms: number;
  readonly kind: string;
  /** Steps of the simulation the call took (the timeline's). */
  readonly steps: number;
  /** A STATE from the witness: its tick and its sender's, as the report's states have them. */
  readonly state?: { readonly g: number; readonly senderTick: number };
}

/** The queue's backlog at a second: messages due and not delivered, by link (the peers' order) and summed. */
export interface Backlog {
  readonly atMs: number;
  readonly byLink: readonly number[];
  readonly total: number;
}

export interface Spread {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export interface RoomReport {
  /** The page's message and timer calls from the hold to AROUND_MS after the repair completed. */
  readonly calls: readonly RoomCall[];
  /** Every second from the room's start (§8.3). */
  readonly backlog: readonly Backlog[];
  /** The room's own work on the page, apart from the page's: brains, encoding and delivery (§8.3). */
  readonly roomMs: { readonly total: number; readonly p95PerTick: number; readonly maxPerTick: number };
  readonly witness: 'none' | 'worker';
  /** Why the witness's Worker failed, if it did, and its timeline's latest figures. */
  readonly witnessError: string | null;
  readonly witnessFigures: WitnessFigures | null;
  /** STATEs the witness sent the page: how many, and each one's tick and its sender's tick, with when; and
   *  the STATE_REQs the page sent, each with when, the connection it asked and the tick it named. */
  readonly witnessStates: number;
  readonly states: readonly { readonly atMs: number; readonly g: number; readonly senderTick: number }[];
  readonly asks: readonly { readonly atMs: number; readonly to: string; readonly g: number }[];
  readonly peers: readonly { readonly id: string; readonly pack: Pack; readonly latencyMs: number; readonly witness: boolean }[];
  readonly delivered: { readonly total: number; readonly byKind: Readonly<Record<string, number>> };
  /** The page's message calls, every one: their time each. */
  readonly messageMs: Spread;
  /** The hold, on the page clock: when it began and when it was to end, the page's resyncs before it, when it
   *  was due to begin (armedMs) and whether it began calm or at CALM_WITHIN_MS (bench-F2), and when the page's
   *  first resync after it completed, ending the witness's rule over the votes; null without one. */
  readonly hold: {
    readonly fromMs: number; readonly toMs: number; readonly resyncsBefore: number; readonly armedMs: number; readonly calm: boolean;
    readonly repairedMs: number | null;
  } | null;
  /** Each TICK the page's clock took as a sample, from its due time to its handling (§8.4's run 4): over the
   *  window asked, else the whole run. */
  readonly keptSampleAgeMs: Spread;
}

/** NetGame's TransportFactory, with what the bench reads and tells it. */
export interface VirtualRoom extends TransportFactory {
  /** The page's timeline, read each time: the room sends nothing until it's given. */
  attach(timeline: () => PageTimeline): void;
  /** A timer run of the page's, as src/frames.ts times it: kept with the repair's calls. */
  timerCall(atMs: number, ms: number, steps: number): void;
  /** Its figures; the kept samples' age over [fromMs, toMs) when a window is given. */
  report(window?: { readonly fromMs: number; readonly toMs: number }): RoomReport;
  /** The witness's progress and the hold's, from counters alone: the hold's start once it has begun, and the
   *  page's completed resyncs then. */
  peek(): { readonly witnessStates: number; readonly witnessError: string | null; readonly holdFromMs: number | null; readonly resyncsAtHold: number | null };
}

interface Link {
  readonly k: number;
  readonly id: string;
  /** The page's connection to it. */
  readonly peer: string;
  readonly pack: Pack;
  readonly coat: number;
  readonly name: string;
  readonly latency: number;
  /** Its timer's phase in a tick, at which it sends. */
  readonly phase: number;
  /** The witness's Worker plays it. */
  readonly witness: boolean;
  /** The page's local tick it starts sending at. */
  readonly joinAt: number;
  joined: boolean;
  next: number;
  sample: ((head: Readonly<MatchState>, headTick: number) => number) | null;
  readonly inputs: Map<number, number>;
  join: number;
  ready: number;
  inAt: number;
  /** FIFO: the due time of its last message to the page. */
  lastAt: number;
}

interface Due {
  readonly due: number;
  readonly link: Link;
  /** The page's connection it's delivered on: its link's, or the one the page asked for an answer. */
  readonly peer: string;
  readonly bytes: Uint8Array;
  /** An answer to this goes out as if from this connection. */
  readonly replyAs: string | null;
  /** A STATE's ticks, for its call's record. */
  readonly state?: RoomCall['state'];
}

const spread = (xs: readonly number[]): Spread => {
  if (xs.length === 0) return { count: 0, p50: 0, p95: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(s.length * q))]!;
  return { count: s.length, p50: at(0.5), p95: at(0.95), max: s[s.length - 1]! };
};

/** A delivery's task: one MessageChannel post at a time, as a data channel fires one event a message. */
function channelTask(): (fn: () => void) => void {
  const channel = new MessageChannel();
  let next: (() => void) | null = null;
  channel.port1.onmessage = () => {
    const fn = next;
    next = null;
    fn?.();
  };
  return (fn) => {
    next = fn;
    channel.port2.postMessage(0);
  };
}

/** The witness's module Worker: same-origin, its own chunk, so the CSP's script-src 'self' covers it. */
const witnessWorker = (): WitnessPort => new Worker(new URL('./witness.ts', import.meta.url), { type: 'module' });

/** A TICK without its vote; any other message as it is. */
function withoutVote(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== T.TICK) return bytes;
  const m = decode(bytes, P, L) as Tick | null;
  if (m === null || m.voteTick === NO_TICK) return bytes;
  return encodeTick({ t: m.t, own: m.own, voteTick: NO_TICK, voteHash: ZERO_HASH, phase: m.phase, bots: m.bots }, L);
}

/** A virtual player's HELLO: no timeline of its own, a player's role. */
function helloOf(l: Link, build: string): Hello {
  return { type: T.HELLO, protocol: PROTOCOL_VERSION, build, player: l.id, role: ROLE.PLAYER, ...NO_TIMELINE, phase: 0, name: l.name };
}

class Room {
  readonly links: Link[] = [];
  private readonly o: VirtualRoomOptions;
  private readonly clock: Clock;
  private readonly task: (fn: () => void) => void;
  private readonly rand: () => number;
  private readonly capacityGapMs: number;
  private page: RoomPeer | null = null;
  private timeline: (() => PageTimeline) | null = null;
  private stop: () => void = () => {};
  private worker: WitnessPort | null = null;
  private witnessLink: Link | null = null;
  private witnessError: string | null = null;
  private witnessFigures: WitnessFigures | null = null;
  private witnessStates = 0;
  private readonly states: { atMs: number; g: number; senderTick: number }[] = [];
  private readonly asks: { atMs: number; to: string; g: number }[] = [];
  private readonly origin: number;
  private readonly finals = new Map<number, string>();
  private newestFinal = -1;
  private readonly queue: Due[] = [];
  private posted = false;
  private nextFreeAt = -Infinity;
  private wakeAt: number | null = null;
  private stopWake: () => void = () => {};
  private replyAs: string | null = null;
  private readonly dropped = new Set<string>();
  private startedAt = 0;
  private nextBacklogAt = 0;
  private nextPingAt = 0;
  private holdArmAt: number | null = null;
  private holdFrom: number | null = null;
  private holdCalm = false;
  private holdBegun = false;
  private resyncsAtHold = 0;
  private repairedAt: number | null = null;
  private callsUntil = -Infinity;
  /** The page's and the witness's transients, a disagreeing tally or a resync, by their counts, and when each
   *  count last moved (the witness's from its figures, a second apart). */
  private pageTransients = 0;
  private pageTransientAt = -Infinity;
  private witnessTransients = 0;
  private witnessTransientAt = -Infinity;
  private readonly calls: RoomCall[] = [];
  private readonly backlog: Backlog[] = [];
  private readonly messageMs: number[] = [];
  private readonly sampleAges: number[] = [];
  private readonly sampleAt: number[] = [];
  private readonly perTick: number[] = [];
  private roomTotal = 0;
  private carryMs = 0;
  private lastTick = -1;
  private delivered = 0;
  private readonly byKind: Record<string, number> = {};
  private closed = false;

  constructor(o: VirtualRoomOptions) {
    this.o = o;
    this.clock = o.clock ?? browserClock;
    this.origin = o.origin ?? performance.timeOrigin;
    this.task = o.task ?? channelTask();
    this.rand = mulberry32(o.seed);
    this.capacityGapMs = o.capacityPerSecond === null ? 0 : SECOND_MS / o.capacityPerSecond;
    const [lo, hi] = o.latencyMs;
    for (let k = 1; k <= o.peers; k++) {
      this.links.push({
        k, id: personId(o.seed, k), peer: `virtual-${k}`, pack: (k % 2) as Pack, coat: k % config.coatCount, name: `Peer ${k + 1}`,
        latency: lo + this.rand() * (hi - lo), phase: this.rand() * (NET.timerMs / NET.tickMs), witness: o.witness && k === 1,
        joinAt: JOIN_FIRST + JOIN_EVERY * k, joined: false, next: 0, sample: null, inputs: new Map(), join: -1, ready: -1, inAt: -1,
        lastAt: -Infinity,
      });
    }
  }

  // --- The transport (NetGame.open's) ---

  bind(page: RoomPeer): Transport {
    this.page = page;
    const now = this.clock.now();
    this.startedAt = now;
    this.nextBacklogAt = now + SECOND_MS;
    this.nextPingAt = now + NET.transport.pingEveryMs;
    for (const l of this.links) if (!l.witness) this.handshake(l, helloOf(l, this.o.build), now);
    const w = this.links.find((l) => l.witness);
    if (w !== undefined) this.startWitness(w);
    this.stop = this.clock.every(NET.timerMs, () => this.step());
    return {
      get refusedBy() {
        return null;
      },
      send: (peer, bytes) => this.fromPage(peer, bytes),
      broadcast: (bytes) => this.fromPage(null, bytes),
      drop: (peer) => {
        this.dropped.add(peer);
      },
      peerCount: () => this.links.filter((l) => l.joined && !this.dropped.has(l.peer)).length,
      leave: () => {
        this.close();
        return Promise.resolve();
      },
    };
  }

  attach(timeline: () => PageTimeline): void {
    this.timeline = timeline;
  }

  timerCall(atMs: number, ms: number, steps: number): void {
    if (atMs <= this.callsUntil && this.calls.length < CALLS_KEPT) this.calls.push({ at: atMs, ms, kind: 'timer', steps });
  }

  peek(): { readonly witnessStates: number; readonly witnessError: string | null; readonly holdFromMs: number | null; readonly resyncsAtHold: number | null } {
    return {
      witnessStates: this.witnessStates, witnessError: this.witnessError, holdFromMs: this.holdBegun ? this.holdFrom : null,
      resyncsAtHold: this.holdBegun ? this.resyncsAtHold : null,
    };
  }

  report(window?: { readonly fromMs: number; readonly toMs: number }): RoomReport {
    const holdMs = this.o.holdMs;
    const ages = window === undefined ? this.sampleAges : this.sampleAges.filter((_, k) => this.sampleAt[k]! >= window.fromMs && this.sampleAt[k]! < window.toMs);
    return {
      calls: this.calls.map((c) => ({ ...c })),
      backlog: this.backlog.map((b) => ({ ...b, byLink: [...b.byLink] })),
      roomMs: { total: this.roomTotal, p95PerTick: spread(this.perTick).p95, maxPerTick: spread(this.perTick).max },
      witness: this.o.witness ? 'worker' : 'none',
      witnessError: this.witnessError,
      witnessFigures: this.witnessFigures,
      witnessStates: this.witnessStates,
      states: this.states.map((x) => ({ ...x })),
      asks: this.asks.map((x) => ({ ...x })),
      peers: this.links.map((l) => ({ id: l.id, pack: l.pack, latencyMs: l.latency, witness: l.witness })),
      delivered: { total: this.delivered, byKind: { ...this.byKind } },
      messageMs: spread(this.messageMs),
      hold: this.holdFrom === null || this.holdArmAt === null || !this.holdBegun ? null : {
        fromMs: this.holdFrom, toMs: this.holdFrom + holdMs, resyncsBefore: this.resyncsAtHold, armedMs: this.holdArmAt, calm: this.holdCalm,
        repairedMs: this.repairedAt,
      },
      keptSampleAgeMs: spread(ages),
    };
  }

  // --- The handshakes and round trips ---

  private rtt(l: Link): number {
    return 2 * l.latency + this.o.jitterMs;
  }

  /** The page's side of a virtual player's handshake, as a transport's two rounds end (§4.3). */
  private handshake(l: Link, hello: Hello, now: number): Hello | null {
    const page = this.page!;
    const v = page.checkHello(hello, now, l.peer);
    if (!v.ok) {
      console.error(`the bench's page refused ${l.name}: reason ${v.reason}`);
      return null;
    }
    const sent = page.hello();
    page.onPeerJoin(l.peer, v.hello, sent, now);
    page.onRtt(l.peer, this.rtt(l), now);
    l.joined = true;
    return sent;
  }

  // --- The witness (repair=1) ---

  private startWitness(w: Link): void {
    this.witnessLink = w;
    let port: WitnessPort;
    try {
      port = (this.o.worker ?? witnessWorker)();
    } catch (e) {
      this.witnessError = e instanceof Error ? e.message : String(e);
      console.error(`The bench's witness didn't start: ${this.witnessError}`);
      return;
    }
    this.worker = port;
    port.onmessage = (e) => this.fromWitness(e.data);
    port.onerror = (e) => {
      this.witnessError = e.message || 'the witness’s Worker failed';
      console.error(`The bench's witness failed: ${this.witnessError}`);
    };
    const others = this.links.filter((l) => !l.witness).map((l) => ({ peer: l.peer, hello: helloOf(l, this.o.build), rttMs: this.rtt(l) }));
    port.postMessage({ kind: 'init', me: w.id, name: w.name, coat: w.coat, pack: w.pack, build: this.o.build, readyAfterTicks: READY_AFTER_TICKS, peers: others });
  }

  private fromWitness(m: FromWitness): void {
    const w = this.witnessLink;
    if (w === null || this.closed) return;
    const now = this.clock.now();
    switch (m.kind) {
      case 'hello': {
        const sent = this.handshake(w, m.hello, now);
        if (sent !== null) this.worker?.postMessage({ kind: 'join', peer: PAGE_PEER, hello: sent, rttMs: this.rtt(w) });
        break;
      }
      case 'send': {
        const sentAt = Math.min(now, m.at - this.origin);
        if (m.to === PAGE_PEER) {
          if (m.bytes[0] === T.STATE) {
            this.witnessStates++;
            if (m.state !== undefined) this.states.push({ atMs: sentAt, ...m.state });
          }
          this.toPage(w, this.unvoted(m.bytes, sentAt), sentAt, m.as ?? w.peer, null, m.state);
        } else if (m.bytes[0] === T.STATE_REQ) {
          // Its join's ask of a virtual player: the page answers as if it were that player.
          this.toPage(w, m.bytes, sentAt, w.peer, m.to);
        }
        break;
      }
      case 'broadcast': {
        const sentAt = Math.min(now, m.at - this.origin);
        this.toPage(w, this.unvoted(m.bytes, sentAt), sentAt, w.peer, null);
        break;
      }
      case 'finals':
        for (const [tick, hash] of m.finals) {
          this.finals.set(tick, hash);
          if (tick > this.newestFinal) this.newestFinal = tick;
        }
        for (const tick of this.finals.keys()) if (this.finals.size > FINALS_KEPT) this.finals.delete(tick);
        break;
      case 'figures': {
        this.witnessFigures = m.figures;
        const s = m.figures.stats;
        const transients = s.disagree + s.resyncs + s.resyncFailed;
        if (transients !== this.witnessTransients) {
          this.witnessTransients = transients;
          this.witnessTransientAt = now;
        }
        break;
      }
      case 'error':
        this.witnessError = m.message;
        console.error(`The bench's witness failed: ${m.message}`);
        break;
    }
  }

  /** A TICK of the witness's, sent outside its rule over the votes, without its vote: until the hold the page's
   *  tallies are its own and the six's, as in the frame-time run, so a transient of the witness's, a vote it
   *  sends on time from its Worker while the six's wait out a stall of the page's thread, can't tie the page's
   *  and win (M4-Q16). From the hold's start it votes, as the six then vote its hashes, until the page's
   *  repair has completed; then the page's tallies are its own and the six's again (bench-F2). */
  private unvoted(bytes: Uint8Array, sentAt: number): Uint8Array {
    return this.witnessRules(sentAt) ? bytes : withoutVote(bytes);
  }

  /** Whether the witness's hashes rule the votes of what's sent at sentAt: from the hold's start until the
   *  page's first resync after it completed; never without a witness (§2.11, bench-F2). */
  private witnessRules(sentAt: number): boolean {
    return this.witnessLink !== null && this.holdFrom !== null && sentAt >= this.holdFrom && (this.repairedAt === null || sentAt < this.repairedAt);
  }

  /** In the hold, a TICK of the page's reaches the witness without its vote: the page is the side the hold
   *  wrongs on purpose, its lineage parted, so its votes then can't make the witness lose its tallies, start a
   *  resync of its own and refuse the page's STATE_REQ as the hold ends (§2.11). */
  private pageVoted(bytes: Uint8Array, now: number): Uint8Array {
    const h = this.holdFrom;
    return h !== null && now >= h && now < h + this.o.holdMs ? withoutVote(bytes) : bytes;
  }

  /** To the witness, due the link's latency and jitter after sentAt, FIFO on its connection there. */
  private toWitness(from: string, l: Link, bytes: Uint8Array, sentAt: number, replyAs: string | null): void {
    if (this.worker === null) return;
    const dueAt = this.origin + sentAt + l.latency + this.rand() * this.o.jitterMs;
    this.worker.postMessage({ kind: 'message', from, bytes, dueAt, replyAs });
  }

  // --- The page's messages ---

  /** The page's send (to a connection) or broadcast (null): only the witness hears it; a STATE_REQ to a
   *  virtual player is the witness's to answer, as that player. */
  private fromPage(peer: string | null, bytes: Uint8Array): void {
    const w = this.witnessLink;
    if (w === null || this.worker === null || this.closed) return;
    const now = this.clock.now();
    if (peer !== null && bytes[0] === T.STATE_REQ && this.asks.length < CALLS_KEPT) {
      const m = decode(bytes, P, L) as StateReq | null;
      if (m !== null) this.asks.push({ atMs: now, to: peer, g: m.tick });
    }
    if (peer === null) this.toWitness(PAGE_PEER, w, this.pageVoted(bytes, now), now, null);
    else if (peer === w.peer) this.toWitness(this.replyAs ?? PAGE_PEER, w, this.pageVoted(bytes, now), now, null);
    else if (bytes[0] === T.STATE_REQ) this.toWitness(PAGE_PEER, w, bytes, now, peer);
  }

  /** A message to the page on link l, sent at sentAt: its arrival the link's latency and jitter later; one sent
   *  in the hold, at its end, every link's in the order sent; and never before the link's last (FIFO). A STATE
   *  carries its ticks to its call's record. */
  private toPage(l: Link, bytes: Uint8Array, sentAt: number, peer: string, replyAs: string | null, state?: RoomCall['state']): void {
    let due = sentAt + l.latency + this.rand() * this.o.jitterMs;
    const hold = this.holdFrom;
    if (hold !== null && sentAt >= hold && sentAt < hold + this.o.holdMs) due = Math.max(due, hold + this.o.holdMs);
    due = Math.max(due, l.lastAt);
    l.lastAt = due;
    const q = this.queue;
    let lo = 0;
    let hi = q.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (q[mid]!.due <= due) lo = mid + 1;
      else hi = mid;
    }
    q.splice(lo, 0, { due, link: l, peer, bytes, replyAs, ...(state === undefined ? {} : { state }) });
  }

  /** The next due message, in a task of its own, unless one is posted already; the capacity's gap
   *  between deliveries kept. One not due yet, or held by the capacity, wakes the delivery when it can go. */
  private kick(): void {
    if (this.posted || this.closed || this.queue.length === 0) return;
    const now = this.clock.now();
    const at = Math.max(this.queue[0]!.due, this.nextFreeAt);
    if (at > now) {
      this.wake(at, now);
      return;
    }
    this.posted = true;
    this.task(() => this.deliverOne());
  }

  /** One timer at a time for the delivery's next wake, moved earlier when a message is due sooner. */
  private wake(at: number, now: number): void {
    if (this.wakeAt !== null && this.wakeAt <= at) return;
    this.stopWake();
    this.wakeAt = at;
    this.stopWake = this.clock.after(at - now, () => {
      this.wakeAt = null;
      this.stopWake = () => {};
      this.kick();
    });
  }

  /** The task's delivery: the next message due, or with drain every message due (§8.1). */
  private deliverOne(): void {
    this.posted = false;
    if (this.closed) return;
    for (let first = true; first || this.o.drain === true; first = false) {
      const start = this.clock.now();
      const m = this.queue[0];
      if (m === undefined || m.due > start || start < this.nextFreeAt) break;
      this.queue.shift();
      if (this.capacityGapMs > 0) this.nextFreeAt = Math.max(start, this.nextFreeAt) + this.capacityGapMs;
      // A message on a connection the page dropped goes nowhere; an answer the witness sends as another
      // player goes on that player's, whatever became of the witness's own (bench-F5).
      if (!this.dropped.has(m.peer)) this.deliver(m, start);
    }
    this.kick();
  }

  /** One message to the page, timed: the page's handling, and the room's own part around it, which counts
   *  in the room's time a tick as its timer's does (§8.3, bench-F7). */
  private deliver(m: Due, start: number): void {
    const kind = KINDS[m.bytes[0] ?? -1] ?? 'other';
    const t = this.timeline?.() ?? null;
    const samples = t?.stats.clockSamples ?? 0;
    const steps = t?.stats.steps ?? 0;
    this.replyAs = m.replyAs;
    const at = this.clock.now();
    try {
      this.page!.onMessage(m.peer, m.bytes, at);
    } finally {
      this.replyAs = null;
    }
    const ms = this.clock.now() - at;
    this.delivered++;
    this.byKind[kind] = (this.byKind[kind] ?? 0) + 1;
    if (this.messageMs.length < PER_TICK_KEPT) this.messageMs.push(ms);
    const took = (t?.stats.steps ?? 0) - steps;
    if (at <= this.callsUntil && this.calls.length < CALLS_KEPT) {
      this.calls.push({ at, ms, kind, steps: took, ...(m.state === undefined ? {} : { state: m.state }) });
    }
    if (t !== null && t.stats.clockSamples > samples && this.sampleAges.length < PER_TICK_KEPT) {
      this.sampleAges.push(at - m.due);
      this.sampleAt.push(at);
    }
    const own = this.clock.now() - start - ms;
    this.roomTotal += own;
    this.carryMs += own;
  }

  /** Messages to the page due a tick ago or longer and not yet delivered. */
  private overdue(now: number): number {
    let n = 0;
    while (n < this.queue.length && this.queue[n]!.due <= now - NET.tickMs) n++;
    return n;
  }

  // --- The room's timer ---

  private step(): void {
    if (this.closed) return;
    const start = this.clock.now();
    const t = this.timeline?.() ?? null;
    if (t !== null && t.started) {
      this.watchHold(t, start);
      for (const l of this.links) if (!l.witness && l.joined && !this.dropped.has(l.peer)) this.emitFor(l, t, start);
    }
    if (start >= this.nextBacklogAt) {
      this.nextBacklogAt += SECOND_MS * Math.max(1, Math.floor((start - this.nextBacklogAt) / SECOND_MS) + 1);
      const byLink = this.links.map((l) => this.queue.filter((m) => m.link === l && m.due <= start).length);
      this.backlog.push({ atMs: start - this.startedAt, byLink, total: byLink.reduce((a, b) => a + b, 0) });
    }
    if (start >= this.nextPingAt) {
      this.nextPingAt = start + NET.transport.pingEveryMs;
      for (const l of this.links) if (l.joined && !this.dropped.has(l.peer)) this.page!.onRtt(l.peer, this.rtt(l), start);
    }
    this.kick();
    const ms = this.clock.now() - start;
    this.roomTotal += ms;
    // The room's time a page tick: this run's, with any before it since the last tick, over the ticks moved.
    const tick = t !== null && t.started ? t.localTick : -1;
    this.carryMs += ms;
    if (tick > this.lastTick && this.lastTick >= 0) {
      const moved = tick - this.lastTick;
      for (let k = 0; k < moved && this.perTick.length < PER_TICK_KEPT; k++) this.perTick.push(this.carryMs / moved);
      this.carryMs = 0;
    }
    if (tick >= 0) this.lastTick = tick;
  }

  /** The hold, armed holdAtMs after the page's head first shows play and begun once the room is calm: nothing
   *  to the page overdue, the page not repairing, and neither the page nor the witness in a transient for
   *  CALM_MS; or CALM_WITHIN_MS after arming, calm or not (bench-F2). Every TICK sent from its start is held,
   *  those made ahead of it too, so with a witness it starts HOLD_LEAD_MS after it's decided. From its start,
   *  the repair's calls are kept to AROUND_MS after the page's next completed resync, which ends the witness's
   *  rule over the votes. */
  private watchHold(t: PageTimeline, now: number): void {
    const at = this.o.holdAtMs;
    if (at === null) return;
    const transients = t.stats.disagree + t.stats.resyncs + t.stats.resyncFailed;
    if (transients !== this.pageTransients) {
      this.pageTransients = transients;
      this.pageTransientAt = now;
    }
    if (this.holdArmAt === null && t.head.phase === IN_PLAY) this.holdArmAt = now + at;
    if (this.holdFrom === null) {
      if (this.holdArmAt === null || now < this.holdArmAt) return;
      const calm = this.overdue(now) === 0 && !t.repairing && now - this.pageTransientAt >= CALM_MS && now - this.witnessTransientAt >= CALM_MS;
      if (!calm && now - this.holdArmAt < CALM_WITHIN_MS) return;
      this.holdCalm = calm;
      this.holdFrom = now + (this.witnessLink === null ? 0 : HOLD_LEAD_MS);
    }
    if (now < this.holdFrom) return;
    if (!this.holdBegun) {
      this.holdBegun = true;
      this.resyncsAtHold = t.stats.resyncs;
      this.callsUntil = Infinity;
    }
    if (this.repairedAt === null && t.stats.resyncs > this.resyncsAtHold) {
      this.repairedAt = now;
      this.callsUntil = now + AROUND_MS;
    }
  }

  /** Each of the page's local ticks from its join tick on, a TICK from l: made when the page's clock reaches
   *  it, or with a witness LEAD_TICKS ahead. */
  private emitFor(l: Link, t: PageTimeline, now: number): void {
    if (t.localTick < l.joinAt) return;
    if (l.next === 0) l.next = Math.max(l.joinAt, t.localTick);
    const lead = this.witnessLink === null ? 0 : LEAD_TICKS;
    while (l.next <= t.localTick + lead) this.emit(l, l.next++, t, now);
  }

  /** l's TICK for local tick n: its brain's input on the page's drawn head, its events, its vote, sent when
   *  its clock, the page's, reads n and its phase, ahead of now or behind it, and to the witness too. */
  private emit(l: Link, n: number, t: PageTimeline, now: number): void {
    const tick = n + D;
    l.sample ??= scriptSampler('brain', l.id, 0, P, B);
    const input = l.sample(t.head, t.headTick) & U16;
    l.inputs.set(tick, input);
    l.inputs.delete(tick - 2 * L.inputHistory);
    let present = 0;
    const hist: number[] = [];
    for (let k = 0; k < L.inputHistory; k++) {
      const v = l.inputs.get(tick - 1 - k);
      if (v !== undefined) present |= 1 << k;
      hist.push(v ?? 0);
    }
    const events = this.events(l, t, n, tick);
    // Sent when the page's clock reads n and its phase: ahead of now for one made early, behind it for one
    // made late, its thread held.
    const sentAt = now + (n + l.phase - t.clock(now)) * NET.tickMs;
    // Its vote, for its newest final tick, or the newest final known now for one made ahead: the page's own
    // final hash (M4-Q16); with a witness, for a TICK sent from the hold's start until the page's repair, the
    // witness's, so the page loses its tallies to it, and before and after that the page's (bench-F2).
    const witnessed = this.witnessRules(sentAt);
    const g = Math.min(n - W, witnessed ? this.newestFinal : t.finalTick);
    const hash = g < 0 ? '' : witnessed ? (this.finals.get(g) ?? '') : t.hashAt(g);
    const phase = l.phase;
    const bytes = encodeTick({
      t: tick, own: { input, present, hist, events }, voteTick: hash === '' ? NO_TICK : g, voteHash: hash === '' ? ZERO_HASH : hash, phase, bots: [],
    }, L);
    this.toPage(l, bytes, sentAt, l.peer, null);
    if (this.witnessLink !== null) this.toWitness(l.peer, l, bytes, sentAt, null);
  }

  /** JOIN while the page's final state lacks l, again every EVENT_TICKS; READY_AFTER_TICKS after it shows l,
   *  while l isn't ready in warm-up, likewise. */
  private events(l: Link, t: PageTimeline, n: number, tick: number): TickEvent[] {
    const F = t.final;
    const at = findTerrier(F, l.id);
    if (at < 0 && (l.join < 0 || tick - l.join > EVENT_TICKS)) l.join = tick;
    if (at >= 0) {
      if (l.inAt < 0) l.inAt = n;
      const ready = F.terriers[at]!.readyUntil > F.tick;
      if (F.phase === WARM_UP && !ready && n - l.inAt >= READY_AFTER_TICKS && (l.ready < 0 || tick - l.ready > EVENT_TICKS)) l.ready = tick;
    }
    const events: TickEvent[] = [];
    if (l.join >= 0 && tick - l.join <= EVENT_TICKS) events.push({ back: tick - l.join, events: JOIN, joinPack: l.pack, coat: l.coat, name: l.name });
    if (l.ready >= 0 && tick - l.ready <= EVENT_TICKS) events.push({ back: tick - l.ready, events: READY });
    return events;
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stop();
    this.stopWake();
    this.queue.length = 0;
    const w = this.worker;
    this.worker = null;
    if (w !== null) {
      w.postMessage({ kind: 'close' });
      w.terminate();
    }
  }
}

/** The bench's room (§1.53): seven virtual players on the page, and with `witness` a real one in a Worker. */
export function virtualRoom(o: VirtualRoomOptions): VirtualRoom {
  const room = new Room(o);
  const factory = (peer: RoomPeer, _now: () => number, _o: TransportOptions): Promise<Transport> => Promise.resolve(room.bind(peer));
  return Object.assign(factory, {
    attach: (timeline: () => PageTimeline) => room.attach(timeline),
    timerCall: (atMs: number, ms: number, steps: number) => room.timerCall(atMs, ms, steps),
    report: (window?: { readonly fromMs: number; readonly toMs: number }) => room.report(window),
    peek: () => room.peek(),
  });
}
