// The test hook's shapes (M4's design, research/m4/DESIGN.md, §1.40;
// CLAUDE.md's test hook), which every spec reads through
// window.terriestTest: a spec sets the object before load, and once
// started a normal page adds inspect() and hashAt() to it; a normal page
// never has it. Its fields observe only, but three a spec may set, which
// change what the page loads or contacts, each by the plan's leave:
// modelUrl (D-27), and relay and ice, a loopback relay alone (M4-Q3). A
// part lives in it as long as what it reports: a pitch screen's controls
// and layers while that screen shows; the match, its announcements, and the
// page's pad and sound across every screen. src/main.ts re-exports
// Inspection and TerriestTest from here once it builds the app, in place of
// M1's own. Types only.

import type { ResultRow } from '../core/session/index';
import type { ControlsInspection, GamepadInspection, InputKind } from '../input/source';
import type { IceMode } from '../net/transport';
import type { NetHook } from '../nettest-params';
import type { MatchViewApi, RenderInfo } from '../render/stage-types';
import type { OwnFigures } from './match-types';
import type { WakeLockInspection } from './phone';

export type ScreenName = 'home' | 'settings' | 'propose' | 'created' | 'practice' | 'join' | 'prematch' | 'match' | 'results' | 'message';

export interface Inspection {
  readonly screen: ScreenName;
  /** The message screen's data-message code. */
  readonly message: string | null;
  readonly menu: 'closed' | 'menu' | 'settings';
  readonly render: RenderInfo;
  /** The match held, whatever screen shows it. */
  readonly match: MatchInspection | null;
  /** The match held's, kept by the app across its screens. */
  readonly announcements: AnnouncementLog | null;
  /** A pitch screen's; null on every other screen. */
  readonly controls: ControlsInspection | null;
  /** A pitch screen's view's, its drawing clock among them, which stands still while Practice is paused
   *  (M4's design §2.2, §9.5); null on every other screen. */
  readonly view: ReturnType<MatchViewApi['inspect']> | null;
  /** The page's pad, on every screen, Results and Home included. */
  readonly gamepad: GamepadInspection | null;
  /** Each pitch layer's inspect() by its name: hud, overlay, menu, sound, touch, hints, turn. */
  readonly layers: Readonly<Record<string, unknown>>;
  /** The page's, on every screen; null before phase 2. */
  readonly audio: AudioInspection | null;
  /** The app's screen wake lock, Created's until someone joins, on every screen, its refusals among it
   *  (M4's design §0, §5.13); null where the page has none. Pre-match's and Match's is layers.turn's. */
  readonly wakeLock: WakeLockInspection | null;
  readonly frames: {
    readonly frames: number; readonly scale: number; readonly skipping: boolean; readonly actions: number;
    readonly log: readonly { readonly atMs: number; readonly scale: number; readonly skipping: boolean; readonly why: 'skipped' | 'gaps' | 'recovered' }[];
    /** P11 in the page: frames whose drawing changed the head's hash. */
    readonly headHashMismatches: number;
  };
  /** Since navigation: started() and prepare()'s end (M4's design §2.1). */
  readonly startMs: { readonly started: number; readonly prepared: number | null };
}

export interface MatchInspection {
  readonly kind: 'practice' | 'net'; readonly me: string; readonly matchId: string | null;
  readonly started: boolean; readonly paused: boolean; readonly inRoster: boolean; readonly returning: boolean;
  /** The room's connections, status().peers; 0 in Practice (M4's design §9.3, from phase 2d). */
  readonly peers: number;
  /** status().refusal: with no peer connected, the last REFUSE reason received, or SPECTATORS_FULL once out
   *  of a full room; else null (PLAN §9, from phase 2d's review). */
  readonly refusal: number | null;
  readonly localTick: number; readonly finalTick: number; readonly headTick: number;
  readonly phase: number; readonly phaseStart: number; readonly overtime: boolean; readonly clock: number;
  /** The scoreboard's. */
  readonly score: readonly [number, number];
  readonly goals: readonly { tick: number; pack: number; ownGoal: boolean; scorers: string[] }[];
  readonly end: { tick: number; score: [number, number]; winner: number | null; rows: ResultRow[] } | null;
  /** The final state's. */
  readonly roster: readonly {
    id: string; name: string; pack: number; spot: number; coat: number; sitting: boolean; lastInputTick: number; goals: number; touches: number;
  }[];
  /** The drawn head's own terrier, lastInput its stored input; lunges latched: begun in the head since the match opened. */
  readonly mine: {
    x: number; y: number; z: number; heading: number; anim: number; animStart: number; takeOffTick: number;
    pounceWait: number; meter: number; lastInput: number;
    lunges: number; lastLungeTick: number | null;
  } | null;
  /** The drawn head's. */
  readonly ball: { x: number; y: number; z: number };
  readonly timer: { readonly runs: number; readonly gapMaxMs: number; readonly gapsOverFreeze: number; readonly gapsOverStall: number };
  /** M4's design §1.37, §8.1. */
  readonly own: OwnFigures;
  /** The clock's two counters from phase 2b, and its jumps from phase 2d (§8.1's late messages). */
  readonly stats: {
    late: number; lateAbsent: number; disagree: number; resyncs: number; rollbacks: number; corrections: number;
    clockSamples: number; clockSamplesDropped: number; jumps: number;
  };
}

/** What the screens announced for one match, kept by the app until another match opens. */
export interface AnnouncementLog {
  readonly matchId: string | null;
  /** The first tick this page's timeline held. */
  readonly arrivalTick: number | null;
  /** Each countdown's phaseStart, once shown (L103). */
  readonly countdowns: readonly number[];
  readonly goals: readonly { readonly tick: number; readonly shownAtMs: number; readonly withdrawnAtMs: number | null }[];
  readonly results: {
    readonly shownAtMs: number;
    readonly presses: readonly { readonly atMs: number; readonly source: InputKind | 'pointer'; readonly accepted: boolean }[];
  } | null;
  /** Marks and overlays started, each counted once. */
  readonly barksShown: number; readonly celebrationsShown: number;
}

export type Announcement =
  | { readonly kind: 'arrival'; readonly matchId: string | null; readonly tick: number }
  | { readonly kind: 'countdown'; readonly phaseStart: number }
  | { readonly kind: 'goal' | 'goalWithdrawn'; readonly tick: number; readonly atMs: number }
  | { readonly kind: 'results'; readonly atMs: number }
  | { readonly kind: 'press'; readonly atMs: number; readonly source: InputKind | 'pointer'; readonly accepted: boolean }
  | { readonly kind: 'bark' | 'celebration' };

/** layers.hud */
export interface HudInspection {
  readonly score: string; readonly clock: string; readonly countdown: string | null; readonly scorer: string | null;
  /** A player's (L167). */
  readonly meter: number | null; readonly pounceWait: number | null;
  readonly graphics: 'ok' | 'restoring' | 'lost';
  /** A spectator's: 'ball' or a terrier's ID. */
  readonly following: string | null;
}

/** layers.overlay */
export interface OverlayInspection {
  readonly mine: { readonly shown: boolean; readonly x: number; readonly y: number } | null;
  readonly names: readonly { readonly id: string; readonly text: string; readonly shown: boolean }[];
  readonly barks: readonly string[]; readonly away: readonly string[];
  readonly arrow: { readonly shown: boolean; readonly angle: number };
  /** Where the stage drew the ball's centre, CSS px from the canvas's top left, and whether in view: the arrow's
   *  input, so a spec reads what's drawn there (C-57); null without a frame. */
  readonly ball: { readonly x: number; readonly y: number; readonly inView: boolean } | null;
}

/** The cues src/audio/synth.ts plays, which it imports from here. */
export type CueKind = 'bark' | 'thump' | 'whoosh' | 'thud' | 'whistleKickoff' | 'whistleGoal' | 'whistleEnd' | 'chorus';

export interface AudioInspection {
  readonly state: 'running' | 'waiting' | 'none'; readonly enabled: boolean; readonly paused: boolean;
  /** "Press a key or tap for sound" shown: the sound layer's. */
  readonly prompt: boolean;
  /** Every cue decided, whatever the context: what the specs assert. */
  readonly decided: Readonly<Record<CueKind, number>>;
  /** Those scheduled: the context running, sound on, not paused. */
  readonly played: Readonly<Record<CueKind, number>>;
}

/** window.terriestTest: set by a spec before load; never by a normal page. */
export interface TerriestTest {
  inspect?: () => Inspection;
  /** The held timeline's final hash at t, '' if not held (P1, P2 in the specs). */
  hashAt?: (t: number) => string;
  /** The #test=net page's (M3). */
  net?: NetHook;
  /** D-27: the model drawer's URL, loaded as a shipped model's would be. */
  modelUrl?: string;
  /** M4-Q3: a loopback relay alone, for the gate's screens. */
  relay?: string; ice?: IceMode;
}
