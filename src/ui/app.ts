// The app (M4's design, research/m4/DESIGN.md, §1.41, §2.1, §2.8, §5.1–§5.13,
// §5.14, §6; PLAN §8, §11, D-12, D-17, D-22, D-23, D-24, D-30, D-33, Q-15,
// Q-17; M4-Q1, M4-Q2, M4-Q3, M4-Q8, M4-Q9, M4-Q30, M4-Q31, M4-Q38): the
// screens and the moves between them, one state machine, roslambo's App:
// - start-up (§5.1): the leave guard installed first, before any room, so
//   its beforeunload listener is the window's first (§1.49); the tab's Web
//   Lock asked for (D-24), and with it held, or without Web Locks, the
//   fragment routed to the first screen, else "terriest is open in another
//   tab" with Use here; the hook's inspect() and hashAt() added for a spec;
//   boot.started(); then, with the lock held and once that screen has been
//   painted, stage.prepare() behind it, so the compile never counts toward
//   the 20 s load timeout (M4-Q38), and while another tab holds the lock
//   prepare waits for Use here, so a page that can't play spends nothing;
//   the canary once start-up's prepare has finished, in a task of its own;
// - the fragment (§5.2): #join=<id> routes to Join, its room opened at once
//   (C-32), and anything else Home, leaving any match held; set with
//   location.replace, never by assigning location.hash and never through
//   the History API, so Back and Forward never walk old matches (D-38), and
//   the router ignores the hashchange its own replace fires; Practice
//   never sets it, so a reload goes Home and contacts no one (D-22);
// - Home, Practice's setup, Pre-match and Match (the pitch screen, M4-Q8),
//   Results and back, as phase 1 had them; Propose and Created, Join by
//   link or by code, the networked Pre-match and Match, and Play again's
//   derived room (D-12), the fragment its ID and no Join, since the press
//   is the choice; Leave and Home leave the match and clear the fragment;
// - the canary before Propose and Join (D-23): on demand if they come
//   before it has run; a browser that computes differently is told so and
//   opens no room, a #join= link's either (M4-Q31); Practice never asks it;
// - a returning page skips Join (L215, D-17, M4-Q2): its terrier, or a bot
//   of its own, in the held roster takes it straight to Pre-match or Match;
//   and the pitch screen follows the page's role, a player's or a
//   spectator's, made again when a JOIN given up leaves it watching, or the
//   other pack's Play makes it a player again (§5.6);
// - the tab lock lost to another tab's Use here: the match closed, its
//   terrier kept for the tab that takes over, and the same message here;
// - each networked match's status after a timer run routed to §5.10's
//   message, the match left (statusMessage): a build or protocol refusal
//   and no timeline 20 s after opening while none is held; a duplicate ID
//   once its refusal has outlasted a lingering connection's silence and a
//   handshake, so a killed tab reopened comes back by itself (C-12); a full
//   room's spectator whenever NetGame took it out, and the players gone
//   (Q-16), with the score so far; Try again opens the link again and Home
//   leaves; a room that can't open says so, with a reload's advice; a JOIN
//   given up stays the pitch's notice (M4-Q39);
// - a match left with no timeline held closed at once, with no LEAVE to
//   send, and one left in its grace waited for before its match's room
//   opens again, since Trystero hands back a room still open under an ID
//   (phase 2d's review);
// - Settings from Home, whose render quality applies at once behind Home
//   (§2.8, D-33): the first change makes a stage at the new quality, its
//   prepare() run behind the screen, and keeps the old one, so a change back
//   swaps to it, and so on, the page never holding more than two stages nor
//   making more than one a quality while it stays off the pitch; the unused
//   one is disposed once a pitch screen opens and its own prepare has
//   settled, never mid-compile;
// - on every change the old screen is disposed, the controls released, the
//   stage shown only for Pre-match and Match, the frame loop running only
//   then (M4-Q9), the leave guard active only then, Practice's too
//   (M4-Q30), the wake lock wanted on Created until someone joins, the
//   turn prompt's layer holding Pre-match's and Match's (§5.13, §1.48),
//   and the new screen's first focus target focused (Q-17);
// - the announcements log, one for each match opened, kept from its opening
//   until another opens, its arrival the first final tick the page's
//   timeline held (§1.40); and the match's timer figures and latched
//   lunges for the hook.
// What outlives a screen is the app's: the stage, the stores, the page's
// devices (src/ui/devices.ts), each match's log. Every room's relays and
// ICE are roomChoice's (src/ui/match.ts, §5.12, M4-Q3). The other phase-2
// builders' parts reach it through AppDeps: the message screens, the wake
// lock and the sound. New at M4, by the slice (1c); phase 2's net-screens
// adds the networked routes, the tab lock, the canary and the leave guard,
// and 2d's net-int the statuses' messages.

import type { RenderQuality } from '../config';
import { generateMatchId, matchIdFromHash } from '../core/match-id';
import { BarkTracker, type ConfirmedEnd, netSettings, REFUSAL, ROLE } from '../core/session/index';
import { defaultParams, findTerrier, LUNGING, type MatchSettings, type Pack } from '../core/sim/index';
import { Controls } from '../input/controls';
import type { KeyboardScreen } from '../input/keyboard';
import type { InputKind, UiCommand } from '../input/source';
import type { Boot } from '../main';
import { toRadians } from '../render/interpolate';
import { type Look, PLACEHOLDER_LOOK } from '../render/look';
import type { Stage } from '../render/stage-types';
import { MatchView } from '../render/view';
import type { ProfileStore } from '../storage/profile';
import type { Settings } from '../storage/schema';
import type { SettingsStore } from '../storage/settings';
import { holdTabLock } from '../storage/tab-lock';
import { canaryOk } from './canary';
import type { Clock, PageEvents } from './clock';
import { type DeviceHost, pageDevices, type PageDevices } from './devices';
import { h } from './dom';
import { type AnimationFrames, browserFrames, FrameLoop } from './frame-loop';
import type { TransportFactory } from './game';
import type { Announcement, AnnouncementLog, AudioInspection, Inspection, MatchInspection, TerriestTest } from './inspect';
import { PITCH_LAYERS } from './layers/index';
import { installLeaveGuard, type LeaveGuard } from './leave-guard';
import { arrivalOf, type NetMatch, openNetMatch, practiceMatch, type RoomChoice, roomChoice } from './match';
import type { Match, MatchStatus } from './match-types';
import type { WakeLockInspection } from './phone';
import { homeScreen } from './screens/home';
import type { InviteOptions } from './screens/invite';
import { type JoinScreen, joinScreen } from './screens/join';
import { type PitchScreen, pitchScreen, type PitchScreenHost } from './screens/pitch';
import { practiceScreen } from './screens/practice';
import { type CreatedScreen, createdScreen, proposeScreen } from './screens/propose';
import { resultsScreen } from './screens/results';
import { focusScreen, type Screen } from './screens/screen';
import { settingsScreen } from './screens/settings';

/** The page's fragment, as the router reads and sets it: window.location's, or a test's. */
export interface AppLocation {
  /** '#…', or '' for none. */
  hash(): string;
  /** location.replace(hash): the fragment set with no history entry (PLAN §11, D-38). */
  replace(hash: string): void;
  /** The page's address, for an invite's link. */
  href(): string;
  /** fn on each hashchange, with the new address's fragment; returns its removal. */
  onHashChange(fn: (hash: string) => void): () => void;
}

/** A URL's fragment, '#…', or '' for none. */
const fragmentOf = (url: string): string => {
  const k = url.indexOf('#');
  return k < 0 ? '' : url.slice(k);
};

/** A bare '#' is no fragment, as location.hash reads it. */
const plain = (hash: string): string => (hash === '#' ? '' : hash);

export const browserLocation: AppLocation = {
  hash: () => location.hash,
  replace: (hash) => location.replace(hash),
  href: () => location.href,
  onHashChange: (fn) => {
    const on = (e: HashChangeEvent): void => fn(fragmentOf(e.newURL));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  },
};

/** §5.10's messages, by their code: 'watching' is no screen but the pitch's notice (src/ui/layers/net.ts);
 *  'open', a room that couldn't open at all, phase 2d's review's. */
export type AppMessageCode = 'canary' | 'build' | 'connect' | 'left' | 'spectators' | 'duplicate' | 'other-tab' | 'graphics' | 'open';
/** A message's moves, each a button where its table row has it (§5.10). */
export type MessageMove = 'practice' | 'home' | 'tryAgain' | 'useHere' | 'leave';

/** What the app needs of the message screens, results-hud's src/ui/screens/message.ts (§5.10), declared
 *  here (§0): that module satisfies it, so src/main.ts passes it whole. */
export interface MessageScreens<S = unknown> {
  readonly MESSAGES: Readonly<Record<AppMessageCode, S>>;
  /** The graphics message in Practice, which pauses until they're back (D-30, Q-15). */
  readonly PRACTICE_GRAPHICS?: S;
  messageScreen(m: S, act: Readonly<Partial<Record<MessageMove, () => void>>>, detail?: string): Screen;
  /** The left message's detail (Q-16): the score so far, pack A's first. */
  scoreSoFar(score: readonly [number, number], look: Look): string;
}

/** The messages a networked match's status ends in (§5.10). */
export type StatusCode = 'build' | 'connect' | 'left' | 'spectators' | 'duplicate';

/** Each status message's moves, as §5.10's table gives them. */
export const STATUS_MOVES: Readonly<Record<StatusCode, readonly ('tryAgain' | 'home')[]>> = {
  build: ['home'], connect: ['tryAgain', 'home'], left: ['home'], spectators: ['tryAgain', 'home'], duplicate: ['tryAgain', 'home'],
};

/**
 * §5.10's message for a networked match's status after a timer run, or null while the match goes on.
 * A refusal, and the connection failure, only while no timeline is held, as roslambo's arena reads them:
 * a keeper holds its timeline from genesis, so a joiner it refuses, or that refuses it, never ends its
 * match (D-21). A build or protocol refusal says "A different version", and no timeline 20 s after the
 * room opened "Couldn't connect" (PLAN §8). A duplicate ID's refusal says its message only once it has
 * stood (duplicateStood: longer than duplicateSilentMs and a handshake), or the attempt has failed: before
 * then the room's next handshake replaces a connection that has gone silent, a killed tab's, so its
 * reopened page comes back by itself (C-12, D-21; phase 2d's review). A page NetGame took out of a full
 * room, by its own count or a peer's REFUSE 4, is told so whenever it happens (C-11, M3's §4.5); and an
 * abandoned match, every browser that controls a terrier gone from the start countdown on, says the
 * players have left (Q-16). A JOIN given up is the pitch's notice, never a message (M4-Q39).
 */
export function statusMessage(s: MatchStatus, held: boolean, duplicateStood: boolean): StatusCode | null {
  if (s.spectatorsFull) return 'spectators';
  if (!held) {
    if (s.refusal === REFUSAL.BUILD || s.refusal === REFUSAL.PROTOCOL) return 'build';
    if (s.refusal === REFUSAL.DUPLICATE && (duplicateStood || s.failed)) return 'duplicate';
    if (s.failed) return 'connect';
  }
  return s.abandoned ? 'left' : null;
}

export interface AppDeps {
  /** <main id="app">, made by src/main.ts on the normal page only (M4-Q1), holding #stage and #screen
   *  (appRoot()). */
  readonly root: HTMLElement;
  /** The page's stage, made at the stored quality before the landmark (§5.1): its canvas goes in #stage. */
  readonly stage: Stage;
  /** A new stage at a quality, for Settings' change from Home (§2.8): null without WebGL 2 now, when the
   *  old stage stays. */
  readonly makeStage: (quality: RenderQuality) => Stage | null;
  readonly profile: ProfileStore;
  readonly settings: SettingsStore;
  /** A spec's window.terriestTest, or null on a normal page, which never has it. */
  readonly test: TerriestTest | null;
  readonly build: string;
  readonly clock: Clock;
  readonly page: PageEvents;
  /** started() once the first screen shows (§5.1, M4-Q38). */
  readonly boot: Boot;
  /** The message screens, results-hud's module: src/main.ts passes it (§5.10). */
  readonly messages?: MessageScreens;
  /** The screen wake lock (devices' src/ui/phone.ts's WakeLock): wanted on Created until someone joins
   *  (§5.13, D-30), its figures, refusals and all, the hook's wakeLock (§0); Pre-match's and Match's is the
   *  turn prompt's layer's. */
  readonly wake?: { want(on: boolean): void; inspect(): WakeLockInspection };
  /** The page's sound (sound's src/ui/layers/sound.ts's audioOut()): its inspect() is the hook's audio. */
  readonly audio?: { inspect(): AudioInspection | null };
  /** Tests: the look (PLACEHOLDER_LOOK), the fragment, the devices and the animation frames. */
  readonly look?: Look;
  readonly location?: AppLocation;
  readonly devices?: (host: DeviceHost) => PageDevices;
  readonly frames?: AnimationFrames;
  /** Tests: the tab lock (holdTabLock's), the leave guard (installLeaveGuard on the window), the canary
   *  (canaryOk), every room's transport (Trystero's), npm run dev:local's relay, and the invite's link,
   *  clipboard and share. */
  readonly lock?: (steal: boolean, onLost: () => void) => Promise<boolean>;
  readonly guard?: LeaveGuard;
  readonly canary?: () => boolean;
  readonly transport?: TransportFactory;
  readonly devRelay?: () => Promise<string | null>;
  readonly invite?: InviteOptions;
}

/** The app's landmark (M4-Q1): <main id="app">, with the stage's box, #stage, and the screen's, #screen. */
export function appRoot(): HTMLElement {
  return h('main', { id: 'app' }, h('div', { id: 'stage', hidden: true }), h('div', { id: 'screen' }));
}

/** npm run dev:local's relay, loaded only under import.meta.env.DEV, so a build has neither the module nor
 *  its chunk (PLAN §15, M3's design §1.29). */
async function pageDevRelay(): Promise<string | null> {
  if (!import.meta.env.DEV) return null;
  return (await import('../net/dev-relay')).devRelay(location.hostname);
}

/** One match's announcements (§1.40), kept until another match opens. */
class Log {
  private readonly matchId: string | null;
  private arrivalTick: number | null = null;
  private readonly countdowns: number[] = [];
  private readonly goals: { tick: number; shownAtMs: number; withdrawnAtMs: number | null }[] = [];
  private results: { shownAtMs: number; presses: { atMs: number; source: InputKind | 'pointer'; accepted: boolean }[] } | null = null;
  private barksShown = 0;
  private celebrationsShown = 0;

  constructor(matchId: string | null) {
    this.matchId = matchId;
  }

  add(a: Announcement): void {
    switch (a.kind) {
      case 'arrival':
        this.arrivalTick ??= a.tick;
        break;
      case 'countdown':
        if (!this.countdowns.includes(a.phaseStart)) this.countdowns.push(a.phaseStart);
        break;
      case 'goal':
        if (!this.goals.some((g) => g.tick === a.tick && g.withdrawnAtMs === null)) this.goals.push({ tick: a.tick, shownAtMs: a.atMs, withdrawnAtMs: null });
        break;
      case 'goalWithdrawn':
        for (const g of this.goals) if (g.tick === a.tick && g.withdrawnAtMs === null) g.withdrawnAtMs = a.atMs;
        break;
      case 'results':
        this.results = { shownAtMs: a.atMs, presses: [] };
        break;
      case 'press':
        this.results?.presses.push({ atMs: a.atMs, source: a.source, accepted: a.accepted });
        break;
      case 'bark':
        this.barksShown++;
        break;
      case 'celebration':
        this.celebrationsShown++;
        break;
    }
  }

  get arrived(): boolean {
    return this.arrivalTick !== null;
  }

  snapshot(): AnnouncementLog {
    return {
      matchId: this.matchId, arrivalTick: this.arrivalTick, countdowns: [...this.countdowns],
      goals: this.goals.map((g) => ({ ...g })),
      results: this.results === null ? null : { shownAtMs: this.results.shownAtMs, presses: this.results.presses.map((p) => ({ ...p })) },
      barksShown: this.barksShown, celebrationsShown: this.celebrationsShown,
    };
  }
}

/** The match's timer runs as the app saw them, for the hook (§8.1, §8.4's run 4). */
interface TimerFigures {
  runs: number;
  gapMaxMs: number;
  gapsOverFreeze: number;
  gapsOverStall: number;
  lastAt: number | null;
}

const newTimer = (): TimerFigures => ({ runs: 0, gapMaxMs: 0, gapsOverFreeze: 0, gapsOverStall: 0, lastAt: null });

/** What a screen change says the new screen is, beside Screen itself. */
interface Shown {
  readonly pitch?: PitchScreen;
  /** A player's pitch screen's controls, over the page's devices. */
  readonly controls?: Controls | null;
  readonly join?: JoinScreen;
  readonly created?: CreatedScreen;
  /** A message screen's code: Inspection.message. */
  readonly message?: string;
}

export class App {
  private readonly d: AppDeps;
  private readonly look: Look;
  private readonly location: AppLocation;
  private readonly stageBox: HTMLElement;
  private readonly screenBox: HTMLElement;
  private readonly frames: AnimationFrames;
  private readonly devices: PageDevices;
  private readonly loop: FrameLoop;
  private readonly guard: LeaveGuard;
  private readonly lock: (steal: boolean, onLost: () => void) => Promise<boolean>;
  private readonly canary: () => boolean;
  /** A timer gap past d + w ticks is a freeze, past the stall's 2 s a stall (D-15, D-31). */
  private readonly freezeMs: number;
  private readonly stallGapMs: number;
  /** A duplicate ID's refusal stands once it has lasted a lingering connection's silence and a handshake
   *  (C-12, D-21), statusMessage's duplicateStood; and a left room's grace (§5.11). */
  private readonly duplicateHoldMs: number;
  private readonly leaveGraceMs: number;
  /** When the held match's duplicate refusal began, while it lasts. */
  private duplicateSince: number | null = null;
  /** Each networked match left in its grace, by its match ID, and when: opening that match again waits for
   *  its room to close first, since Trystero hands back a room still open under the same ID, whose
   *  messages then go to the match that left (phase 2d's review). */
  private readonly leaving = new Map<string, { readonly m: Match; readonly at: number }>();
  private stage: Stage;
  private quality: RenderQuality;
  /** The other quality's stage, kept while no pitch screen shows, so a change back swaps to it rather than
   *  making another: two stages at most, one a quality while the page stays off the pitch (§2.8, D-33).
   *  Settings offers high and low alone, so it's always the quality a change asks for. */
  private spare: Stage | null = null;
  /** The quality Settings chose while a pitch screen showed (phase 2's in-match panel): applied once it goes. */
  private pendingQuality: RenderQuality | null = null;
  /** Each stage's prepare() once started, its failure reported, and whether it has settled: a stage is
   *  disposed only once it has (§2.8). */
  private readonly preparing = new Map<Stage, { done: boolean; settled: Promise<void> }>();
  private prepareBegun = false;
  private screen: Screen | null = null;
  private pitch: PitchScreen | null = null;
  private joining: JoinScreen | null = null;
  private created: CreatedScreen | null = null;
  private messageCode: string | null = null;
  /** Each screen change counted, so a room that opens after the screen it was for has gone is closed. */
  private shows = 0;
  private controls: Controls | null = null;
  private match: Match | null = null;
  private stopListening: () => void = () => {};
  private log: Log | null = null;
  private timer: TimerFigures = newTimer();
  private lunges: { count: number; last: number | null } = { count: 0, last: null };
  /** P11's count from the pitch screens gone, so the hook's figure covers the page. */
  private mismatchesBefore = 0;
  private startedAt = 0;
  private preparedAt: number | null = null;
  /** A room on its way, Create's or Play again's: a second press waits for it. */
  private opening = false;
  /** This tab holds the game's Web Lock (D-24); Use here is taking it. */
  private lockHeld = false;
  private taking = false;
  /** The fragments this app set, whose hashchange is still to come: ignored when it does. */
  private readonly ownHashes: string[] = [];
  private canaryVerdict: boolean | null = null;
  private wakeWanted = false;

  constructor(d: AppDeps) {
    this.d = d;
    this.look = d.look ?? PLACEHOLDER_LOOK;
    this.location = d.location ?? browserLocation;
    // Before any room exists, so its beforeunload listener is the window's first, ahead of Trystero's (§1.49).
    this.guard = d.guard ?? installLeaveGuard(window);
    this.lock = d.lock ?? holdTabLock;
    this.canary = d.canary ?? canaryOk;
    this.stageBox = child(d.root, 'stage');
    this.screenBox = child(d.root, 'screen');
    this.frames = d.frames ?? browserFrames;
    const net = netSettings();
    this.freezeMs = (net.timeline.delay + net.timeline.window) * net.timeline.clock.tickMs;
    this.stallGapMs = net.stallMs;
    this.duplicateHoldMs = net.room.duplicateSilentMs + net.room.handshakeTimeoutMs;
    this.leaveGraceMs = net.room.leaveGraceMs;
    this.stage = d.stage;
    this.quality = d.settings.get().quality;
    this.mount(d.stage);
    this.devices = (d.devices ?? pageDevices)({
      clock: d.clock,
      mirrored: () => d.settings.get().mirrorTouch,
      sampling: () => this.pitch !== null && this.pitch.menu === 'closed' && this.pitch.graphics === 'ok' && this.controls !== null && this.match?.paused === false,
      ui: (c) => this.ui(c),
      used: () => {},
      uiActive: () => this.keyboardScreen(),
    });
    this.loop = new FrameLoop({
      frame: (nowMs) => this.pitch?.frame(nowMs),
      clock: d.clock,
      stage: { setScale: (s) => this.stage.setScale(s) },
      frames: this.frames,
      // The page's visibility, as the timeline's: a hidden page's frames aren't judged (D-31, §8.2).
      hidden: () => d.page.hidden(),
    });
    d.settings.subscribe((s) => this.settingsChanged(s));
    this.location.onHashChange((hash) => this.hashChanged(hash));
  }

  /** §5.1: the tab lock, the first screen, the hook, boot.started(), then prepare() behind the screen once
   *  it's been painted (M4-Q38), and only with the lock held. */
  async start(): Promise<void> {
    this.lockHeld = await this.lock(false, () => this.lockLost());
    if (this.lockHeld) this.route();
    else this.otherTab();
    const test = this.d.test;
    if (test !== null) {
      test.inspect = () => this.inspect();
      test.hashAt = (t) => this.hashAt(t);
    }
    this.startedAt = this.d.clock.now();
    this.d.boot.started();
    // The landmark was hidden until now, so the first screen takes its focus now (Q-17), after a style
    // read: WebKit's focus() can otherwise judge the screen by the style from before started().
    const first = this.screen;
    if (first !== null) {
      void first.el.ownerDocument.defaultView?.getComputedStyle(first.el).visibility;
      focusScreen(first);
    }
    if (this.lockHeld) this.prepareSoon(this.stage, true);
  }

  /** Q-17's commands, the keyboard's and the pad's: to the screen showing. */
  ui(c: UiCommand): void {
    this.screen?.ui?.(c);
  }

  /** What the screen is, for the keys (src/input/keyboard.ts): the graphics' message over the pitch, whose
   *  keys the browser keeps; the menu; a player's pitch screen, or a spectator's, and a player's while
   *  the graphics are lost, so no play key acts unseen (D-30); Results; or another screen. */
  keyboardScreen(): KeyboardScreen {
    const p = this.pitch;
    if (p !== null) {
      if (p.message !== null) return 'other';
      if (p.menu !== 'closed') return 'menu';
      return this.controls !== null && p.graphics === 'ok' ? 'pitch' : 'spectator';
    }
    return this.screen?.name === 'results' ? 'results' : 'other';
  }

  /** The hook's (§1.40). */
  inspect(): Inspection {
    const pitch = this.pitch;
    const shown = pitch?.inspect() ?? null;
    const frames = this.loop.inspect();
    const pitchMessage = pitch?.message ?? null;
    return {
      screen: pitchMessage !== null ? 'message' : this.screen?.name ?? 'home',
      message: pitchMessage ?? this.messageCode,
      menu: pitch?.menu ?? 'closed',
      render: this.stage.info(),
      match: this.match === null ? null : this.matchInspection(this.match),
      announcements: this.log?.snapshot() ?? null,
      controls: this.controls?.inspect() ?? null,
      view: shown?.view ?? null,
      gamepad: this.devices.gamepad(),
      layers: shown?.layers ?? {},
      audio: this.d.audio?.inspect() ?? null,
      wakeLock: this.d.wake?.inspect() ?? null,
      frames: { ...frames, headHashMismatches: this.mismatchesBefore + (shown?.headHashMismatches ?? 0) },
      startMs: { started: this.startedAt, prepared: this.preparedAt },
    };
  }

  /** The held timeline's final hash at t, '' if not held (P1, P2). */
  hashAt(t: number): string {
    return this.match?.session.timeline.hashAt(t) ?? '';
  }

  // --- The routes (§5.2) ---

  /** Start, Use here and each hashchange not of the app's own: #join=<id> to Join, unless that match is
   *  held already; anything else Home. Either way any other match held is left. Nothing while another tab
   *  holds the lock. */
  private route(): void {
    if (!this.lockHeld) return;
    const id = matchIdFromHash(this.location.hash());
    if (id !== null && this.match?.matchId === id) return;
    this.leaveMatch();
    if (id !== null) this.joinMatch(id);
    else this.home();
  }

  /** A hashchange: the app's own replace, ignored, or another's, routed (§5.2). */
  private hashChanged(hash: string): void {
    const k = this.ownHashes.indexOf(plain(hash));
    if (k >= 0) {
      this.ownHashes.splice(0, k + 1);
      return;
    }
    this.ownHashes.length = 0;
    this.route();
  }

  /** #join=<id>, or no fragment, by location.replace (§5.2): no history entry, and its hashchange ignored. */
  private setFragment(id: string | null): void {
    const next = id === null ? '' : `#join=${id}`;
    if (plain(this.location.hash()) === next) return;
    this.ownHashes.push(next);
    this.location.replace(next === '' ? '#' : next);
  }

  /** A match's fragment cleared, so a reload goes Home: Practice never sets one, nor clears another's. */
  private clearJoinFragment(): void {
    if (matchIdFromHash(this.location.hash()) !== null) this.setFragment(null);
  }

  private home(): void {
    this.clearJoinFragment();
    const { profile, settings } = this.d;
    this.show(homeScreen({
      profile, look: this.look,
      persistent: () => profile.persistent && settings.persistent,
      propose: () => this.propose(),
      join: (id) => this.joinByCode(id),
      practice: () => this.practiceSetup(),
      settings: () => this.settingsScreen(),
    }));
  }

  private practiceSetup(): void {
    this.show(practiceScreen({ start: (s) => this.startPractice(s), home: () => this.home() }));
  }

  /** Settings from Home; Back returns Home (§6). */
  private settingsScreen(): void {
    const settings = this.d.settings;
    const host = { settings, profile: this.d.profile, persistent: () => settings.persistent, back: () => this.home() };
    this.show(settingsScreen(host));
  }

  /** Practice's Start (Q-15, D-22): the person in pack A, bots in every other place, no room, no fragment. */
  private startPractice(s: MatchSettings): void {
    if (this.match !== null) return;
    const p = this.d.profile.get();
    const m = practiceMatch({ me: p.playerId, name: p.name, coat: p.coat, settings: s, build: this.d.build, clock: this.d.clock, page: this.d.page });
    this.hold(m);
    this.enterPitch(m);
  }

  // --- Matches with others (§5.5, §5.6) ---

  /** The canary's verdict (D-23): computed once, on demand when Propose or Join comes before start-up's
   *  run of it. */
  private canaryPasses(): boolean {
    this.canaryVerdict ??= this.canary();
    return this.canaryVerdict;
  }

  /** "This browser can't play matches with others", with Practice and Home; no room opened (M4-Q31). */
  private canaryMessage(): void {
    this.showMessage('canary', {
      practice: () => {
        this.clearJoinFragment();
        this.practiceSetup();
      },
      home: () => this.home(),
    });
  }

  /** Home's Propose a match: after the canary (D-23). */
  private propose(): void {
    if (!this.canaryPasses()) {
      this.canaryMessage();
      return;
    }
    this.show(proposeScreen({ create: (s) => void this.create(s), home: () => this.home() }));
  }

  /** Create (§5.5): the match ID generated, the room opened, genesis proposed, the fragment set, and
   *  Created. A room that opens once Propose has gone is closed; one that can't open says so, its Try
   *  again back to Propose, rather than leave Create reading "Creating…". */
  private async create(s: MatchSettings): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    const at = this.shows;
    const id = generateMatchId();
    let m: NetMatch | null = null;
    try {
      m = await this.openRoom(id);
    } catch (e) {
      notOpened(e);
    }
    this.opening = false;
    if (m === null) {
      if (this.shows === at && this.lockHeld) this.showMessage('open', { tryAgain: () => this.propose(), home: () => this.home() });
      return;
    }
    if (this.shows !== at || !this.lockHeld) {
      m.close();
      return;
    }
    m.propose(s);
    this.hold(m);
    this.setFragment(id);
    const created = createdScreen({
      matchId: id, look: this.look, invite: this.inviteOptions(), peers: () => m.status().peers,
      play: (p) => this.choose(m, p), watch: () => this.choose(m, null), leave: () => this.leave(),
    });
    this.show(created, { created });
  }

  /** Home's Join with a valid code: the fragment set to its link's, then Join (§5.2). */
  private joinByCode(id: string): void {
    this.leaveMatch();
    this.setFragment(id);
    this.joinMatch(id);
  }

  /** Join (§5.6): after the canary, the room opened at once, undecided (C-32), the screen reading
   *  "Connecting to the match…" until a timeline is held; a room that can't open says so, rather than
   *  leave Join connecting. */
  private joinMatch(id: string): void {
    if (!this.canaryPasses()) {
      this.canaryMessage();
      return;
    }
    const screen = joinScreen({
      matchId: id, look: this.look,
      play: (p) => this.chooseHeld(p), watch: () => this.chooseHeld(null), home: () => this.leave(),
    });
    this.show(screen, { join: screen });
    const at = this.shows;
    this.openRoom(id).then(
      (m) => {
        if (this.shows !== at || !this.lockHeld) {
          m.close();
          return;
        }
        this.hold(m);
        this.joinRan(m);
      },
      (e: unknown) => {
        notOpened(e);
        if (this.shows === at && this.lockHeld) this.showMessage('open', { tryAgain: () => this.joinMatch(id), home: () => this.home() });
      },
    );
  }

  /** The relays, TURN and ICE a room opens with now: roomChoice's, from Settings as they are (§5.12, §6,
   *  M4-Q3). */
  private async room(): Promise<RoomChoice> {
    const devRelay = await (this.d.devRelay ?? pageDevRelay)();
    return roomChoice(this.d.settings.get(), this.d.test, import.meta.env.DEV, devRelay);
  }

  /** A match's room, by roomChoice's relays and ICE (§5.12, M4-Q3), as this page's player, once a room this
   *  page left for the same match has closed. */
  private async openRoom(id: string): Promise<NetMatch> {
    if (this.leaving.has(id)) await this.leftClosed(id);
    const room = await this.room();
    const p = this.d.profile.get();
    return openNetMatch({
      matchId: id, me: p.playerId, name: p.name, coat: p.coat, build: this.d.build,
      relays: room.relays, extraRelays: room.extraRelays, turn: room.turn, ice: room.ice,
      clock: this.d.clock, page: this.d.page,
      ...(this.d.transport !== undefined ? { transport: this.d.transport } : {}),
    });
  }

  /** The invite's options: this page's address for the link, and a test's clipboard and share. */
  private inviteOptions(): InviteOptions {
    return { href: this.location.href(), ...this.d.invite };
  }

  /** Join's Play and Watch: only once the state is held (M4-Q2). */
  private chooseHeld(pack: Pack | null): void {
    const m = this.match;
    if (m === null || !m.session.timeline.started) return;
    this.choose(m, pack);
  }

  /** Play in a pack, or Watch: the choice made, and Pre-match (§5.2). */
  private choose(m: Match, pack: Pack | null): void {
    if (m !== this.match) return;
    if (pack === null) m.watch();
    else m.play(pack);
    this.enterPitch(m);
  }

  /** A page whose terrier, or a bot of its own, is in the held roster has returned (D-17, D-21). */
  private returned(m: Match): boolean {
    const t = m.session.timeline;
    if (!t.started) return false;
    if (m.status().returning || m.session.inRoster()) return true;
    return m.session.hostedBots().some((id) => findTerrier(t.final, id) >= 0);
  }

  /** A player's pitch screen, or a spectator's: the session's role (PLAN §8); Practice's person plays. */
  private plays(m: Match): boolean {
    return m.kind === 'practice' || m.session.role() === ROLE.PLAYER;
  }

  /** A match held from now: its log, its figures and its timer runs. */
  private hold(m: Match): void {
    this.dropMatch();
    this.match = m;
    this.log = new Log(m.matchId);
    this.timer = newTimer();
    this.lunges = { count: 0, last: null };
    this.duplicateSince = null;
    this.stopListening = m.subscribe({ run: () => this.ran(m) });
    this.arrival(m);
  }

  /** The pitch screen for m, a player's or a spectator's by its role: a MatchView with its BarkTracker, a
   *  player's Controls over the page's devices, and the layers (§1.38, §1.63). The controls' callbacks
   *  reach the screen, made after them. */
  private enterPitch(m: Match): void {
    const settings = this.d.settings;
    const playing = this.plays(m);
    const view = new MatchView(m, this.look, () => {
      const s = settings.get();
      return { calmCamera: s.calmCamera, names: s.names };
    }, new BarkTracker(m.me));
    let screen: PitchScreen | null = null;
    const controls = playing
      ? new Controls({
        view: () => screen?.viewMode() ?? 'ball',
        yaw: () => view.yaw,
        onView: () => screen?.switchView(),
        onBark: (tick) => screen?.ownBark(tick),
        // Each control's first use on each kind of device: the hints' (src/ui/layers/devices.ts, §4.7).
        onUsed: (kind, c) => this.devices.used?.(kind, c),
      })
      : null;
    if (controls !== null) for (const device of this.devices.list()) controls.add(device);
    const messages = this.d.messages;
    const host: PitchScreenHost = {
      match: m, stage: this.stage, view, controls, settings, profile: this.d.profile, look: this.look, test: this.d.test !== null,
      announce: (a) => this.log?.add(a),
      // The screen opens and closes its menu itself, and has set the view; the app reads both from it.
      openMenu: () => {},
      closeMenu: () => {},
      leave: () => this.leave(),
      ui: (c) => this.ui(c),
      setMode: () => {},
      results: (end) => this.results(end),
      page: this.d.page,
      invite: m.kind === 'net' ? this.inviteOptions() : null,
      ...(messages !== undefined ? {
        graphicsMessage: (leave: () => void) => messages.messageScreen(
          m.kind === 'practice' && messages.PRACTICE_GRAPHICS !== undefined ? messages.PRACTICE_GRAPHICS : messages.MESSAGES.graphics, { leave }),
      } : {}),
    };
    screen = pitchScreen(host, PITCH_LAYERS);
    this.show(screen, { pitch: screen, controls });
  }

  /** The end confirmed (D-14): Results, the match still held for its figures until Play again or Home. */
  private results(end: ConfirmedEnd): void {
    const m = this.match;
    if (m === null) return;
    this.show(resultsScreen({
      end, practice: m.kind === 'practice', me: m.me, look: this.look, clock: this.d.clock,
      againSeen: () => m.status().againSeen,
      summary: () => m.summary(),
      playAgain: () => this.playAgain(),
      home: () => this.leave(),
      announce: (a) => this.log?.add(a),
    }));
  }

  /** Play again (Q-15, D-12): the next match's Pre-match, its fragment the derived room's ID, with no Join,
   *  its room on Settings' relays and TURN as they are now, which apply from the next match (§6);
   *  Practice's contacts no one. */
  private playAgain(): void {
    const old = this.match;
    if (old === null || this.opening) return;
    this.opening = true;
    const again = old.kind === 'net' ? this.room().then((room) => (old as NetMatch).playAgain(room)) : old.playAgain();
    again.then(
      (next) => {
        this.opening = false;
        if (this.match !== old || !this.lockHeld) {
          next.close();
          return;
        }
        this.hold(next);
        if (next.matchId !== null) this.setFragment(next.matchId);
        this.enterPitch(next);
      },
      (e: unknown) => {
        this.opening = false;
        console.error('Play again failed:', e);
      },
    );
  }

  /** Leave on Pre-match, in the menu, on Created or Join, and Results' Home (§5.11): the match left, the
   *  fragment cleared, Home. */
  private leave(): void {
    this.leaveMatch();
    this.home();
  }

  /** Networked, LEAVE and the room closed after its grace, the match remembered meanwhile; or, holding no
   *  timeline, with no LEAVE to send, the room closed at once; Practice closed (D-22). */
  private leaveMatch(): void {
    const m = this.match;
    if (m === null) return;
    this.dropMatch();
    if (m.kind !== 'net' || m.matchId === null) {
      m.leave();
      return;
    }
    if (!m.session.timeline.started) {
      m.close();
      return;
    }
    m.leave();
    for (const [id, x] of this.leaving) if (x.m.status().closed) this.leaving.delete(id);
    this.leaving.set(m.matchId, { m, at: this.d.clock.now() });
  }

  /** A match of this ID left in its grace (leaveMatch): the rest of its grace waited out and the room
   *  closed, so it has left before another room opens under the ID; Trystero would otherwise hand back
   *  the room still open, its messages the left match's, and the new one would hear no one
   *  (players-1, screens-msg-F2). */
  private async leftClosed(id: string): Promise<void> {
    const left = this.leaving.get(id);
    if (left === undefined) return;
    this.leaving.delete(id);
    const rest = this.leaveGraceMs - (this.d.clock.now() - left.at);
    if (rest > 0 && !left.m.status().closed) await new Promise<void>((resolve) => this.d.clock.after(rest, resolve));
    left.m.close();
  }

  /** The match no longer held; its log stays until another opens (§1.40). */
  private dropMatch(): void {
    this.stopListening();
    this.stopListening = () => {};
    this.match = null;
  }

  // --- One game tab (D-24, §6) ---

  /** "terriest is open in another tab", with Use here. */
  private otherTab(): void {
    this.showMessage('other-tab', { useHere: () => this.useHere() });
  }

  /** Use here: the lock stolen from the other tab, then the fragment's route, and the compile if it hadn't
   *  begun. */
  private useHere(): void {
    if (this.taking || this.lockHeld) return;
    this.taking = true;
    void this.lock(true, () => this.lockLost()).then((held) => {
      this.taking = false;
      if (!held || this.lockHeld) return;
      this.lockHeld = true;
      this.route();
      if (!this.prepareBegun) this.prepareSoon(this.stage, true);
    });
  }

  /** Another tab took the lock: the match closed, with no LEAVE, so its terrier waits for the tab that
   *  took over, which the same link takes back (D-17); and the same message here. */
  private lockLost(): void {
    this.lockHeld = false;
    const m = this.match;
    if (m !== null) {
      this.dropMatch();
      m.close();
    }
    this.otherTab();
  }

  /** A message screen of results-hud's (§5.10), its code the hook's message. */
  private showMessage(code: Exclude<AppMessageCode, 'graphics'>, act: Readonly<Partial<Record<MessageMove, () => void>>>, detail?: string): void {
    const messages = this.d.messages;
    if (messages === undefined) throw new Error(`no message screens to say ${code} with: src/main.ts passes src/ui/screens/message.ts`);
    this.show(messages.messageScreen(messages.MESSAGES[code], act, detail), { message: code });
  }

  /** A networked match's status after a timer run (§5.10): when it ends in a message, the match is left,
   *  its LEAVE out if it has one to send, closed at once if it holds no timeline, and the message shows;
   *  the fragment stays the match's, so a reload, as "A different version" asks, opens the link again. A
   *  duplicate ID's refusal is timed from the first run that saw it, while no timeline is held. */
  private routeStatus(m: Match): boolean {
    const id = m.matchId;
    if (m.kind !== 'net' || id === null) return false;
    const s = m.status();
    const held = m.session.timeline.started;
    const now = this.d.clock.now();
    if (!held && s.refusal === REFUSAL.DUPLICATE) this.duplicateSince ??= now;
    else this.duplicateSince = null;
    const stood = this.duplicateSince !== null && now - this.duplicateSince >= this.duplicateHoldMs;
    const code = statusMessage(s, held, stood);
    if (code === null) return false;
    const score = m.scoreboard.score;
    this.leaveMatch();
    this.statusShown(code, id, score);
    return true;
  }

  /** A status's message, with §5.10's moves: Try again opens the match's link again, by Join (§5.6), and
   *  Home leaves it, the fragment cleared; the players-left one says the score so far (Q-16). */
  private statusShown(code: StatusCode, id: string, score: readonly [number, number] | null): void {
    const moves = { tryAgain: () => this.joinMatch(id), home: () => this.home() };
    const act: Partial<Record<MessageMove, () => void>> = {};
    for (const k of STATUS_MOVES[code]) act[k] = moves[k];
    const detail = code === 'left' && score !== null ? this.d.messages?.scoreSoFar(score, this.look) : undefined;
    this.showMessage(code, act, detail);
  }

  // --- After each timer run ---

  private ran(m: Match): void {
    const now = this.d.clock.now();
    const f = this.timer;
    if (f.lastAt !== null) {
      const gap = now - f.lastAt;
      f.gapMaxMs = Math.max(f.gapMaxMs, gap);
      if (gap > this.freezeMs) f.gapsOverFreeze++;
      if (gap > this.stallGapMs) f.gapsOverStall++;
    }
    f.lastAt = now;
    f.runs++;
    this.loop.timerRan(now, m.own());
    this.arrival(m);
    this.latchLunge(m);
    if (m !== this.match || this.routeStatus(m)) return;
    if (this.joining !== null) this.joinRan(m);
    else if (this.created !== null) {
      this.created.update();
      this.wakeFor();
    } else if (this.pitch !== null && this.plays(m) !== (this.controls !== null)) {
      // A JOIN given up leaves the page watching, and the other pack's Play makes it a player (§5.6).
      this.enterPitch(m);
    }
  }

  /** Join after a timer run: a returning page goes straight on, else the screen offers what's held. */
  private joinRan(m: Match): void {
    if (this.returned(m)) {
      if (!m.session.inRoster()) m.watch(); // its bots alone came back: it watches them
      this.enterPitch(m);
      return;
    }
    this.joining?.update(m);
  }

  /** The first tick this page's timeline held (§1.40): Practice's from genesis, a networked match's the
   *  final tick of the STATE it adopted, or 0 for its proposer (arrivalOf). */
  private arrival(m: Match): void {
    if (this.log === null || this.log.arrived) return;
    const tick = arrivalOf(m);
    if (tick >= 0) this.log.add({ kind: 'arrival', matchId: m.matchId, tick });
  }

  /** Each lunge your terrier begins in the head, counted once by its start (§9.1's latched transients). */
  private latchLunge(m: Match): void {
    const t = m.session.timeline;
    if (!t.started) return;
    const k = findTerrier(t.head, m.me);
    if (k < 0) return;
    const T = t.head.terriers[k]!;
    if (T.anim === LUNGING && T.animStart !== this.lunges.last) {
      this.lunges.count++;
      this.lunges.last = T.animStart;
    }
  }

  // --- The screens ---

  /** One screen for another (§5.2): the old disposed and its controls released, the stage shown only for
   *  Pre-match and Match, the frame loop and the leave guard with it, Created's wake lock, and the new
   *  screen's first focus target focused. */
  private show(next: Screen, o: Shown = {}): void {
    const old = this.screen;
    const oldPitch = this.pitch;
    const pitch = o.pitch ?? null;
    this.shows++;
    this.screen = next;
    this.pitch = pitch;
    this.joining = o.join ?? null;
    this.created = o.created ?? null;
    this.messageCode = o.message ?? null;
    if (oldPitch !== null && oldPitch !== pitch) this.mismatchesBefore += oldPitch.inspect().headHashMismatches;
    const oldControls = this.controls;
    this.controls = o.controls ?? null;
    if (oldControls !== null && oldControls !== this.controls) {
      oldControls.release();
      for (const device of this.devices.list()) oldControls.remove(device);
    }
    if (old !== next) old?.dispose?.();
    this.stageBox.hidden = pitch === null;
    this.d.root.classList.toggle('pitch', pitch !== null);
    this.screenBox.replaceChildren(next.el);
    if (pitch !== null) this.loop.start();
    else this.loop.stop();
    // Pre-match and Match ask before the page is left, Practice's too (M4-Q30).
    this.guard.set(pitch !== null);
    this.wakeFor();
    focusScreen(next);
    if (pitch !== null) this.dropSpare();
    else if (this.pendingQuality !== null) this.restage(this.pendingQuality);
  }

  /** The wake lock on Created until someone joins (§5.13, D-30): Pre-match's and Match's is the turn
   *  prompt's, a layer over every pitch, which reports its refusals (src/ui/phone.ts, §1.48). */
  private wakeFor(): void {
    const on = this.created !== null && this.match !== null && this.match.status().peers === 0;
    if (on === this.wakeWanted) return;
    this.wakeWanted = on;
    this.d.wake?.want(on);
  }

  // --- The stage (§2.1, §2.8) ---

  /** The stage's canvas in #stage: the image "The pitch", in the app's landmark (M1's, M4-Q1). */
  private mount(stage: Stage): void {
    const canvas = stage.canvas;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'The pitch');
    this.stageBox.replaceChildren(canvas);
  }

  /** prepare() once the screen showing has been painted: a frame, then a task after it (M4-Q38); start-up's
   *  then runs the canary, in a task of its own (§5.1's step 7). */
  private prepareSoon(stage: Stage, startup = false): void {
    if (startup) this.prepareBegun = true;
    this.frames.request(() => {
      this.d.clock.after(0, () => {
        if (stage === this.stage) this.prepare(stage, startup);
      });
    });
  }

  private prepare(stage: Stage, startup: boolean): void {
    if (this.preparing.has(stage)) return;
    const run = { done: false, settled: Promise.resolve() };
    run.settled = stage.prepare().then(
      () => {
        this.preparedAt ??= this.d.clock.now();
        if (startup) this.d.clock.after(0, () => void this.canaryPasses());
      },
      // Not a refusal the page expects: the page's own error, which the gate's guard fails (§9.1).
      (e: unknown) => console.error('The pitch could not be prepared:', e),
    ).then(() => {
      run.done = true;
    });
    this.preparing.set(stage, run);
  }

  /** Settings' quality: from Home at once, swapping the stage; while a pitch screen shows, once it goes. */
  private settingsChanged(s: Settings): void {
    if (s.quality === this.quality) {
      this.pendingQuality = null;
      return;
    }
    if (this.pitch !== null) this.pendingQuality = s.quality;
    else this.restage(s.quality);
  }

  /** A stage at the quality in place of the one drawing now (§2.8, D-33): the kept one, or else one made,
   *  the one it replaces kept in turn, so twenty changes make one stage; its canvas in #stage at once, and
   *  its prepare() behind the screen unless that has begun. */
  private restage(quality: RenderQuality): void {
    this.pendingQuality = null;
    const next = this.spare ?? this.d.makeStage(quality);
    if (next === null) return;
    this.spare = this.stage;
    this.stage = next;
    this.quality = quality;
    this.mount(next);
    if (!this.preparing.has(next)) this.prepareSoon(next);
  }

  /** A pitch screen has opened: the kept stage, unused there, disposed at once if its prepare() has
   *  settled or never began, and otherwise once it settles, never mid-compile, unless a change off the
   *  pitch has taken it back by then (§2.8). */
  private dropSpare(): void {
    const spare = this.spare;
    if (spare === null) return;
    const run = this.preparing.get(spare);
    if (run === undefined || run.done) {
      this.disposeSpare(spare);
      return;
    }
    void run.settled.then(() => {
      if (this.pitch !== null) this.disposeSpare(spare);
    });
  }

  private disposeSpare(stage: Stage): void {
    if (this.spare !== stage) return;
    this.spare = null;
    this.preparing.delete(stage);
    stage.dispose();
  }

  // --- The hook's match (§1.40) ---

  private matchInspection(m: Match): MatchInspection {
    const t = m.session.timeline;
    const H = t.head;
    const F = t.final;
    const started = t.started;
    const k = started ? findTerrier(H, m.me) : -1;
    const T = k >= 0 ? H.terriers[k]! : null;
    const board = m.scoreboard;
    const e = board.end;
    const st = t.stats;
    const f = this.timer;
    const status = m.status();
    return {
      kind: m.kind, me: m.me, matchId: m.matchId,
      started, paused: m.paused, inRoster: m.session.inRoster(), returning: status.returning, peers: status.peers, refusal: status.refusal,
      localTick: t.localTick, finalTick: t.finalTick, headTick: t.headTick,
      // The drawn head's, as the validated scripts time their holds (§9.1): the final state's lag w ticks.
      phase: H.phase, phaseStart: H.phaseStart, overtime: H.overtime, clock: H.clock,
      score: [board.score[0], board.score[1]],
      goals: board.goals.map((g) => ({ tick: g.tick, pack: g.pack, ownGoal: g.ownGoal, scorers: [...g.scorers] })),
      end: e === null ? null : { tick: e.tick, score: [e.score[0], e.score[1]], winner: e.winner, rows: e.rows.map((r) => ({ ...r })) },
      roster: started
        ? F.terriers.map((x) => ({
          id: x.id, name: x.name, pack: x.pack, spot: x.spot, coat: x.coat, sitting: x.sitting, lastInputTick: x.lastInputTick,
          goals: x.goals, touches: x.touches,
        }))
        : [],
      mine: T === null ? null : {
        x: T.x, y: T.y, z: T.z, heading: toRadians(T.heading), anim: T.anim, animStart: T.animStart, takeOffTick: T.takeOffTick,
        pounceWait: T.pounceWait, meter: T.meter / defaultParams.meterFull, lastInput: T.prevInput,
        lunges: this.lunges.count, lastLungeTick: this.lunges.last,
      },
      ball: started ? { x: H.ball.x, y: H.ball.y, z: H.ball.z } : { x: 0, y: 0, z: 0 },
      timer: { runs: f.runs, gapMaxMs: f.gapMaxMs, gapsOverFreeze: f.gapsOverFreeze, gapsOverStall: f.gapsOverStall },
      own: { ...m.own() },
      stats: {
        late: st.late, lateAbsent: st.lateAbsent, disagree: st.disagree, resyncs: st.resyncs, rollbacks: st.rollbacks,
        corrections: st.corrections, clockSamples: st.clockSamples, clockSamplesDropped: st.clockSamplesDropped, jumps: st.jumps,
      },
    };
  }
}

/** A room that couldn't open, §5.10's 'open' (phase 2d's review): Trystero's chunk not loaded, the page
 *  offline or outlived by a deploy, or a hook's relay this build refuses. The page says so on screen, so
 *  it's reported, never the page's own error, which the gate's guard fails (§0). */
function notOpened(e: unknown): void {
  console.warn('The match could not be opened:', e);
}

/** The element under root whose id is `id`: appRoot() makes both boxes. */
function child(root: HTMLElement, id: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[id="${id}"]`);
  if (el === null) throw new Error(`the app's landmark has no #${id}`);
  return el;
}
