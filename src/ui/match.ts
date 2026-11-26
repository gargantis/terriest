// The Match adapters (M4's design, research/m4/DESIGN.md, §1.37, §4.1,
// §5.12, §8.1; PLAN D-12, D-22, Q-15, D-30, P10, M4-Q3): one interface over
// M3's glue (src/ui/match-types.ts), which the screens, the view, the
// controls and the sound meet at. Phase 1's is Practice's, over M3's
// PracticeGame unchanged:
// - its session is PracticeGame.practice.session, its scoreboard and clock
//   the game's;
// - it pauses while any reason holds, the menu's or lost graphics', and
//   resumes once none does (Q-15, D-30); a stall's or a hidden page's own
//   pause reaches the subscribers' stalled, and the screen opens the menu,
//   which then holds it;
// - the sampler is called once a sent tick on the drawn head, with the tick
//   its input is for, the timeline's local tick + d (§4.1);
// - own(): after each timer run, before the subscribers hear it, the local
//   ticks moved, the TICKs sent and the ticks a catch-up marked absent, for
//   every sender the page sends for (§8.1); Practice sends every tick of a
//   catch-up (D-22), so its skipped stays 0;
// - Play again closes it and starts a new Practice with the same options,
//   contacting no one, as M3's PracticeGame.again does (Q-15).
// It opens no room and sets no fragment (D-22, P10). Phase 2's networked
// adapter (net-screens) is the same interface over M3's NetGame, unchanged:
// - its session, scoreboard and status the game's: the refusals, the
//   connection failure, the abandoned match, the switch refused, the return
//   (D-17), the spectators' cap, whether it's leaving or closed, the peers
//   and an AGAIN seen; and the final tick it took its timeline at, the
//   hook's arrival (§1.40);
// - it never pauses: a menu or lost graphics only release the controls;
// - the sampler on the timeline the session holds at each sent tick, as
//   M3's #test=net page samples, and its rebase at onControl (D-10); a
//   base handed before the screens make the Controls, as a return's on
//   Join is, kept for them, the input keeping its counters until then
//   (§4.6, page-F4, from phase 2d);
// - own() as Practice's, over a catch-up that sends only its newest
//   stallSendTicks, so its skipped counts the rest for every sender it
//   sends for, its terrier and each bot it hosts (§8.1);
// - propose, play and watch, Ready, Switch pack and the bots; Leave, its
//   LEAVE out in the TICKs that follow and the room closed leaveGraceMs
//   later; Play again, the derived room's match (D-12, C-42).
// roomChoice picks every room's relays and ICE (§5.12, M4-Q3): a spec's
// hook's relay alone, when this build takes it (src/nettest-params.ts's
// acceptedRelay); else npm run dev:local's relay alone; else the curated
// relays with Settings' extra ones, and Settings' TURN servers. New at M4.

import { config } from '../config';
import { type Correction, type MatchNetSummary, REFUSAL, type Scoreboard, type Session, type TimelineStats } from '../core/session/index';
import { defaultParams, encodeInput, jumpCount, type MatchSettings, matchSettingsOf, type MatchState, type Pack, pounceCount } from '../core/sim/index';
import type { IceMode } from '../net/transport';
import { acceptedRelay } from '../nettest-params';
import type { Settings } from '../storage/schema';
import { browserClock, type Clock } from './clock';
import { NetGame, type NetGameOptions, type Traffic } from './game';
import type { TerriestTest } from './inspect';
import type { Match, MatchStatus, OwnFigures, PauseReason } from './match-types';
import { PracticeGame, type PracticeGameOptions } from './practice';

type Listener = Parameters<Match['subscribe']>[0];

/** What own() reads of the timeline held: src/core/timeline/timeline.ts's Timeline satisfies it. */
export interface OwnTimeline {
  /** A timeline is held: started, or adopted from a STATE. */
  readonly started: boolean;
  readonly localTick: number;
  readonly stats: { readonly sent: number };
  /** This page plays: it sends its own input (PLAN §8). */
  readonly sending: boolean;
  /** The bots it hosts, each a sender. */
  readonly bots: { readonly size: number };
}

/** A slow page's figures (§8.1), counted after each timer run on the timeline held: the ticks its local
 *  tick moved, the TICKs sent, and, while it sends for anyone, the ticks a catch-up marked absent, the
 *  ticks moved less those sent, for every sender at once, so `senders` says how many inputs each
 *  stood for. Another timeline, a merge's or a rejoin's, starts from where it stands, and so does one
 *  that has only now started: a joiner's local tick jumps to its adopted STATE's, which skipped
 *  nothing. */
export class OwnTally {
  private ticks = 0;
  private sent = 0;
  private skipped = 0;
  private senders = 0;
  private held: OwnTimeline | null = null;
  private counting = false;
  private local = 0;
  private sentBefore = 0;

  ran(t: OwnTimeline): void {
    const senders = (t.sending ? 1 : 0) + t.bots.size;
    if (t !== this.held || !this.counting) {
      this.held = t;
      this.counting = t.started;
      this.local = t.localTick;
      this.sentBefore = t.stats.sent;
      this.senders = senders;
      return;
    }
    const moved = t.localTick - this.local;
    const sent = t.stats.sent - this.sentBefore;
    this.local = t.localTick;
    this.sentBefore = t.stats.sent;
    this.senders = senders;
    this.ticks += moved;
    this.sent += sent;
    if (senders > 0 && moved > sent) this.skipped += moved - sent;
  }

  figures(): OwnFigures {
    return { ticks: this.ticks, sent: this.sent, skipped: this.skipped, senders: this.senders };
  }
}

/** A copy of a timeline's stats, so a reader never holds the live object. */
function copied(s: Readonly<TimelineStats>): TimelineStats {
  return { ...s, lateBy: [...s.lateBy], resyncMs: [...s.resyncMs], log: s.log.map(([t, e]): [number, string] => [t, e]) };
}

class PracticeMatch implements Match {
  readonly kind = 'practice';
  readonly me: string;
  readonly matchId = null;
  readonly settings: MatchSettings;
  readonly clock: Clock;
  private readonly options: PracticeGameOptions;
  private readonly game: PracticeGame;
  private readonly listeners = new Set<Listener>();
  private readonly reasons = new Set<PauseReason>();
  private readonly tally = new OwnTally();
  private closedNow = false;

  constructor(o: PracticeGameOptions) {
    this.options = o;
    this.me = o.me;
    this.settings = o.settings;
    this.clock = o.clock ?? browserClock;
    this.game = new PracticeGame({
      ...o,
      onPause: (why) => {
        o.onPause?.(why);
        for (const l of [...this.listeners]) l.stalled?.(why);
      },
    });
    this.game.onRun = () => this.ran();
    this.game.onCorrection = (c) => {
      for (const l of [...this.listeners]) l.correction?.(c);
    };
    this.tally.ran(this.session.timeline);
  }

  /** PracticeGame.practice.session: Practice's never changes, but it's read each time, as a Match's is. */
  get session(): Session {
    return this.game.practice.session;
  }

  get scoreboard(): Scoreboard {
    return this.game.scoreboard;
  }

  /** While the menu, lost graphics, a stall or a hidden page holds it: the clock and the drawing stop. */
  get paused(): boolean {
    return this.game.paused;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  setControls(sample: (head: Readonly<MatchState>, headTick: number, tick: number) => number, rebase: (base: number) => void): void {
    const s = this.session;
    const d = this.game.practice.cfg.net.timeline.delay;
    this.game.controls = () => {
      const t = s.timeline;
      return sample(t.head, t.headTick, t.localTick + d);
    };
    // Practice adopts no state, so it never hands one (D-10); wired as a networked match's is.
    s.onControl = rebase;
  }

  ready(on: boolean): void {
    this.game.ready(on);
  }

  /** Swaps the person with the other pack's newest bot (D-22); nothing while it can't, a swap or a Ready
   *  on its way among the reasons (src/core/session/practice.ts). */
  switchPack(): void {
    this.game.switchPack();
  }

  canAddBot(_pack: Pack): boolean {
    return false;
  }

  addBot(_pack: Pack): boolean {
    return false;
  }

  removeBot(_pack: Pack): boolean {
    return false;
  }

  /** Practice plays in pack A from its start (Q-15). */
  play(_pack: Pack): void {}

  watch(): void {}

  pause(why: PauseReason): void {
    if (this.closedNow) return;
    this.reasons.add(why);
    this.game.pause();
  }

  resume(why: PauseReason): void {
    this.reasons.delete(why);
    if (this.reasons.size === 0 && !this.closedNow) this.game.resume();
  }

  status(): MatchStatus {
    const closed = this.closedNow;
    return {
      refusal: null, failed: false, abandoned: false, refused: null, switchRefused: false, returning: false,
      spectatorsFull: false, leaving: closed, closed, peers: 0, againSeen: false,
    };
  }

  own(): OwnFigures {
    return this.tally.figures();
  }

  summary(): MatchNetSummary {
    return this.game.summary();
  }

  stats(): TimelineStats {
    return copied(this.session.timeline.stats);
  }

  traffic(): Traffic | null {
    return null;
  }

  /** Practice has no one to tell: it closes (D-22). */
  leave(): void {
    this.close();
  }

  /** A new Practice with the same options, contacting no one (Q-15); this one closes. */
  playAgain(): Promise<Match> {
    this.close();
    return Promise.resolve(practiceMatch(this.options));
  }

  close(): void {
    if (this.closedNow) return;
    this.closedNow = true;
    this.game.close();
  }

  private ran(): void {
    this.tally.ran(this.session.timeline);
    for (const l of [...this.listeners]) l.run?.();
  }
}

/** Practice, started now: the person in pack A and bots in every other place (Q-15, D-22). */
export function practiceMatch(o: PracticeGameOptions): Match {
  return new PracticeMatch(o);
}

// ---- The networked match (phase 2) ----

/** A networked Match, with what the app reads of NetGame beside the interface. */
export interface NetMatch extends Match {
  readonly kind: 'net';
  readonly matchId: string;
  /** The final tick at which this page took the timeline it holds, the hook's arrival (§1.40): 0 for the
   *  proposer, an adopted STATE's for a joiner, a rejoin or a merge; −1 before it holds one. */
  readonly arrivedTick: number;
  /** Genesis, now, as the keeper (§5.5). */
  propose(s: MatchSettings): void;
  traffic(): Traffic;
  /** The derived room's match (D-12), on `room`'s relays, TURN and ICE when given, as Settings has them
   *  now, since they apply from the next match (§6); else on this room's. */
  playAgain(room?: RoomChoice): Promise<NetMatch>;
}

/** What a room opens with beside its match ID and Play again's choice: Play again's room the same, but for
 *  the room's relays, TURN and ICE. */
type RoomOptions = Omit<NetGameOptions, 'matchId' | 'again'>;

/** A copy of a room's traffic, so a reader never holds the live counts. */
function copiedTraffic(t: Traffic): Traffic {
  const byType: Record<number, Traffic['byType'][number]> = {};
  for (const [k, v] of Object.entries(t.byType)) byType[Number(k)] = { ...v };
  return { sent: t.sent, received: t.received, sentBytes: t.sentBytes, receivedBytes: t.receivedBytes, byType };
}

/** The settings a held timeline was proposed with: its pack size, its length and its rules. */
function settingsOf(s: Readonly<MatchState>): MatchSettings {
  return matchSettingsOf(s, defaultParams);
}

class NetMatchImpl implements NetMatch {
  readonly kind = 'net';
  readonly me: string;
  readonly matchId: string;
  readonly clock: Clock;
  private readonly game: NetGame;
  private given: MatchSettings;
  private readonly listeners = new Set<Listener>();
  private readonly tally = new OwnTally();
  /** The options its room opened with, for Play again's on new relays; null for a game opened elsewhere. */
  private readonly opened: RoomOptions | null;
  /** The session's onControl base no Controls has taken yet, and the rebase of the Controls sampling. */
  private pendingBase: number | null = null;
  private rebaseTo: ((base: number) => void) | null = null;

  constructor(game: NetGame, settings: MatchSettings, clock: Clock, opened: RoomOptions | null = null) {
    this.game = game;
    this.opened = opened;
    this.me = game.session.cfg.me;
    this.matchId = game.matchId;
    this.given = settings;
    this.clock = clock;
    game.onRun = () => this.ran();
    game.onCorrection = (c: Correction) => {
      for (const l of [...this.listeners]) l.correction?.(c);
    };
    // A return through the screens adopts the STATE, and takes control, on Join, before the screens make a
    // pitch screen's Controls: its base waits for them, and until they sample, the input keeps the base's
    // counters with nothing held, so the returning terrier presses nothing (§4.6, page-F4).
    game.onControl = (base) => {
      if (this.rebaseTo !== null) this.rebaseTo(base);
      else this.pendingBase = base;
    };
    game.controls = () => {
      const base = this.pendingBase;
      return base === null ? 0 : encodeInput({ jump: jumpCount(base), pounce: pounceCount(base) });
    };
    this.tally.ran(game.session.timeline);
  }

  /** Read each time: a merge or a rejoin replaces its timeline, never the session. */
  get session(): Session {
    return this.game.session;
  }

  get scoreboard(): Scoreboard {
    return this.game.scoreboard;
  }

  /** The held state's once a timeline is held; until then the proposal's, or the defaults. */
  get settings(): MatchSettings {
    const t = this.game.session.timeline;
    return t.started ? settingsOf(t.final) : this.given;
  }

  /** A networked match never pauses (Q-15, D-30). */
  get paused(): boolean {
    return false;
  }

  get arrivedTick(): number {
    return this.game.arrivedTick;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  /** On the timeline the session holds as it stands at each sent tick, as M3's #test=net page samples; a
   *  base onControl handed before these Controls is theirs at once (§4.6). */
  setControls(sample: (head: Readonly<MatchState>, headTick: number, tick: number) => number, rebase: (base: number) => void): void {
    const s = this.game.session;
    const d = s.cfg.net.timeline.delay;
    this.game.controls = () => {
      const t = s.timeline;
      return sample(t.head, t.headTick, t.localTick + d);
    };
    this.rebaseTo = rebase;
    const pending = this.pendingBase;
    this.pendingBase = null;
    if (pending !== null) rebase(pending);
  }

  propose(settings: MatchSettings): void {
    this.given = settings;
    this.game.propose(settings);
  }

  ready(on: boolean): void {
    this.game.ready(on);
  }

  switchPack(): void {
    this.game.switchPack();
  }

  canAddBot(pack: Pack): boolean {
    return this.game.canAddBot(pack);
  }

  addBot(pack: Pack): boolean {
    return this.game.addBot(pack);
  }

  removeBot(pack: Pack): boolean {
    return this.game.removeBot(pack);
  }

  play(pack: Pack): void {
    this.game.play(pack);
  }

  watch(): void {
    this.game.watch();
  }

  /** Nothing pauses: the screen releases what's held itself (D-30). */
  pause(_why: PauseReason): void {}

  resume(_why: PauseReason): void {}

  status(): MatchStatus {
    const g = this.game;
    const s = g.session;
    const refusal = g.refusal();
    return {
      refusal, failed: g.failed(), abandoned: g.abandoned(), refused: s.refused, switchRefused: s.switchRefused, returning: s.returning,
      spectatorsFull: s.spectatorsFull || refusal === REFUSAL.SPECTATORS_FULL, leaving: g.leaving, closed: g.closed,
      peers: g.peers(), againSeen: s.againSeen,
    };
  }

  own(): OwnFigures {
    return this.tally.figures();
  }

  summary(): MatchNetSummary {
    return this.game.summary();
  }

  stats(): TimelineStats {
    return this.game.stats();
  }

  traffic(): Traffic {
    return copiedTraffic(this.game.traffic);
  }

  /** LEAVE for the player and its bots, in the TICKs the timer goes on sending, then the room closes
   *  leaveGraceMs later (§5.11). */
  leave(): void {
    this.game.leave();
  }

  /** The derived room's match (D-12, C-42): AGAIN here, and there genesis with this match's settings only
   *  if no AGAIN reached this room, this match's pack and bots coming along; this room closes
   *  leaveGraceMs later. Its room opens on `room`'s relays, TURN and ICE when given, Settings' now (§6),
   *  and this room's otherwise, or when this match's room opened elsewhere (asMatch). */
  async playAgain(room?: RoomChoice): Promise<NetMatch> {
    const settings = this.settings;
    const o: RoomOptions | null = room !== undefined && this.opened !== null ? { ...this.opened, ...room } : this.opened;
    const next = await (o !== null ? this.game.playAgain(o) : this.game.playAgain());
    return new NetMatchImpl(next, settings, this.clock, o);
  }

  close(): void {
    this.game.close();
  }

  private ran(): void {
    this.tally.ran(this.game.session.timeline);
    for (const l of [...this.listeners]) l.run?.();
  }
}

/** The settings a joiner's match reports until it holds a timeline: the configuration's defaults. */
const JOINING: MatchSettings = { packSize: config.packSizeDefault, matchMinutes: config.matchLengthDefaultMinutes };

/** A match's room opened now (NetGame.open), undecided until the app proposes, plays or watches (PLAN §8). */
export async function openNetMatch(o: NetGameOptions): Promise<NetMatch> {
  const game = await NetGame.open(o);
  // Play again's room takes these but for its own match ID and choice, which NetGame.playAgain sets.
  return new NetMatchImpl(game, JOINING, o.clock ?? browserClock, o);
}

/** A game already open, its timer running on `clock`, NetGame's own: Play again's, or the bench's
 *  (§1.53). It takes the game's onRun and onCorrection, and its controls and onControl (§4.6). */
export function asMatch(game: NetGame, settings: MatchSettings, clock: Clock = browserClock): NetMatch {
  return new NetMatchImpl(game, settings, clock);
}

/** The first final tick this page's timeline held (§1.40's arrivalTick): Practice's from genesis, 0; a
 *  networked match's NetGame.arrivedTick; −1 before one. */
export function arrivalOf(m: Match): number {
  if (m instanceof NetMatchImpl) return m.arrivedTick;
  return m.session.timeline.started ? 0 : -1;
}

// ---- Every room's relays and ICE (§5.12, M4-Q3) ----

/** What a networked match's room opens with, NetGameOptions' relays, ICE and TURN. */
export interface RoomChoice {
  /** null: the curated relays and extraRelays; otherwise exactly these. */
  readonly relays: readonly string[] | null;
  readonly extraRelays: readonly string[];
  readonly turn: readonly RTCIceServer[];
  readonly ice: IceMode;
}

const ICE_MODES: readonly IceMode[] = ['default', 'none', 'local'];

/** A spec's hook's relay that this build doesn't take: the page opens no room with it, and says so. */
export class RefusedRelay extends Error {}

/** The room's relays and ICE (§5.12, M4-Q3): a spec's hook's relay alone, which a build takes only when
 *  acceptedRelay does (a ws: relay on the loopback, or a curated one), with the hook's ICE, local by
 *  default, and no TURN, so the gate contacts nothing else; else under npm run dev:local its relay
 *  alone, the screens' only relay (PLAN §15), with Settings' TURN; else the curated relays with
 *  Settings' extra ones and its TURN servers, as roslambo's rooms open. dev: a dev build
 *  (import.meta.env.DEV); devRelay: npm run dev:local's, src/net/dev-relay.ts's, or null. Throws
 *  RefusedRelay for a hook's relay this build doesn't take. */
export function roomChoice(
  settings: Pick<Settings, 'relays' | 'turn'>, test: Pick<TerriestTest, 'relay' | 'ice'> | null, dev: boolean, devRelay: string | null,
): RoomChoice {
  const turn = settings.turn.map((t): RTCIceServer => ({ urls: t.urls, username: t.username, credential: t.credential }));
  const relay = test?.relay;
  if (typeof relay === 'string') {
    if (!acceptedRelay(relay, dev)) throw new RefusedRelay(`this build takes no relay ${relay}: only third-party.json's, or a ws: relay on this machine`);
    const ice = ICE_MODES.find((m) => m === test?.ice) ?? 'local';
    return { relays: [relay], extraRelays: [], turn: [], ice };
  }
  if (dev && devRelay !== null) return { relays: [devRelay], extraRelays: [], turn, ice: 'default' };
  return { relays: null, extraRelays: [...settings.relays], turn, ice: 'default' };
}
