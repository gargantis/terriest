// The app (M4's design, research/m4/DESIGN.md, §1.41, §2.1, §2.8, §5.1–§5.4,
// §5.7–§5.9, §5.11, §5.14; PLAN §11, D-22, D-30, D-33, Q-15, Q-17; M4-Q1,
// M4-Q8, M4-Q9, M4-Q38): the screens and the moves between them, one state
// machine, roslambo's App, as phase 1 has it:
// - start-up (§5.1): the fragment routed to the first screen, Home; the
//   hook's inspect() and hashAt() added for a spec; boot.started(); then,
//   once Home has been painted, stage.prepare() behind it, so the compile
//   never counts toward the 20 s load timeout (M4-Q38);
// - Home, Practice's setup, Pre-match and Match (the pitch screen, M4-Q8),
//   Results and back: Play again starts another Practice with the same
//   settings, contacting no one (Q-15); Leave and Home leave the match;
// - Settings' minimal screen from Home, whose render quality applies at
//   once by re-creating the stage behind Home, its prepare() run again;
//   the old stage is disposed once its own prepare has settled, never
//   mid-compile (§2.8, D-33);
// - the fragment (§5.2): every route goes Home in phase 1, a #join= link's
//   among them until phase 2's Join, and Practice never sets it, so a
//   reload goes Home and contacts no one (D-22);
// - on every change the old screen is disposed, the controls released, the
//   stage shown only for Pre-match and Match, the frame loop running only
//   then (M4-Q9), and the new screen's first focus target focused: Ready,
//   Play again or the heading (Q-17);
// - the announcements log, one for each match opened, kept from its opening
//   until another opens, so Results and a spec read what Pre-match and
//   Match showed (§1.40); and the match's timer figures and latched lunges
//   for the hook.
// What outlives a screen is the app's: the stage, the stores, the page's
// devices (src/ui/devices.ts) and each match's log. Phase 2's net-screens
// adds the networked routes, the tab lock, the canary and the leave guard,
// and net-int the messages' routing. New at M4, by the slice (1c).

import type { RenderQuality } from '../config';
import { BarkTracker, type ConfirmedEnd, netSettings } from '../core/session/index';
import { defaultParams, findTerrier, LUNGING, type MatchSettings } from '../core/sim/index';
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
import type { Clock, PageEvents } from './clock';
import { type DeviceHost, pageDevices, type PageDevices } from './devices';
import { h } from './dom';
import { type AnimationFrames, browserFrames, FrameLoop } from './frame-loop';
import type { Announcement, AnnouncementLog, Inspection, MatchInspection, TerriestTest } from './inspect';
import { PITCH_LAYERS } from './layers/index';
import { practiceMatch } from './match';
import type { Match } from './match-types';
import { homeScreen } from './screens/home';
import { type PitchScreen, pitchScreen, type PitchScreenHost } from './screens/pitch';
import { practiceScreen } from './screens/practice';
import { resultsScreen } from './screens/results';
import { focusScreen, type Screen } from './screens/screen';
import { settingsScreen } from './screens/settings';

/** The page's fragment, as the router reads it: window.location's, or a test's. */
export interface AppLocation {
  /** '#…', or '' for none. */
  hash(): string;
  /** fn on each hashchange; returns its removal. */
  onHashChange(fn: () => void): () => void;
}

export const browserLocation: AppLocation = {
  hash: () => location.hash,
  onHashChange: (fn) => {
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  },
};

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
  /** Tests: the look (PLACEHOLDER_LOOK), the fragment, the devices and the animation frames. */
  readonly look?: Look;
  readonly location?: AppLocation;
  readonly devices?: (host: DeviceHost) => PageDevices;
  readonly frames?: AnimationFrames;
}

/** The app's landmark (M4-Q1): <main id="app">, with the stage's box, #stage, and the screen's, #screen. */
export function appRoot(): HTMLElement {
  return h('main', { id: 'app' }, h('div', { id: 'stage', hidden: true }), h('div', { id: 'screen' }));
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

export class App {
  private readonly d: AppDeps;
  private readonly look: Look;
  private readonly stageBox: HTMLElement;
  private readonly screenBox: HTMLElement;
  private readonly frames: AnimationFrames;
  private readonly devices: PageDevices;
  private readonly loop: FrameLoop;
  /** A timer gap past d + w ticks is a freeze, past the stall's 2 s a stall (D-15, D-31). */
  private readonly freezeMs: number;
  private readonly stallGapMs: number;
  private stage: Stage;
  private quality: RenderQuality;
  /** The quality Settings chose while a pitch screen showed (phase 2's in-match panel): applied once it goes. */
  private pendingQuality: RenderQuality | null = null;
  /** The stage's prepare() once started, its failure reported: a stage is disposed only once it settles. */
  private readonly preparing = new Map<Stage, Promise<void>>();
  private screen: Screen | null = null;
  private pitch: PitchScreen | null = null;
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
  /** Play again on its way: a second press waits for it. */
  private opening = false;

  constructor(d: AppDeps) {
    this.d = d;
    this.look = d.look ?? PLACEHOLDER_LOOK;
    this.stageBox = child(d.root, 'stage');
    this.screenBox = child(d.root, 'screen');
    this.frames = d.frames ?? browserFrames;
    const net = netSettings();
    this.freezeMs = (net.timeline.delay + net.timeline.window) * net.timeline.clock.tickMs;
    this.stallGapMs = net.stallMs;
    this.stage = d.stage;
    this.quality = d.settings.get().quality;
    this.mount(d.stage);
    this.devices = (d.devices ?? pageDevices)({
      clock: d.clock,
      mirrored: () => d.settings.get().mirrorTouch,
      sampling: () => this.pitch !== null && this.pitch.menu === 'closed' && this.controls !== null && this.match?.paused === false,
      ui: (c) => this.ui(c),
      used: () => {},
      uiActive: () => this.keyboardScreen(),
    });
    this.loop = new FrameLoop({
      frame: (nowMs) => this.pitch?.frame(nowMs),
      clock: d.clock,
      stage: { setScale: (s) => this.stage.setScale(s) },
      frames: this.frames,
    });
    d.settings.subscribe((s) => this.settingsChanged(s));
    (d.location ?? browserLocation).onHashChange(() => this.route());
  }

  /** §5.1: the first screen, the hook, boot.started(), then prepare() behind the screen once it's been
   *  painted (M4-Q38). From phase 2, the tab lock first. */
  async start(): Promise<void> {
    this.route();
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
    this.prepareSoon(this.stage);
  }

  /** Q-17's commands, the keyboard's: to the screen showing. Home, Practice's setup and Settings take
   *  none, and leave Enter to the browser's own activation. */
  ui(c: UiCommand): void {
    this.screen?.ui?.(c);
  }

  /** What the screen is, for the keys (src/input/keyboard.ts): the menu over the pitch, a player's pitch
   *  screen, a spectator's (phase 2), Results, or another screen. */
  keyboardScreen(): KeyboardScreen {
    const p = this.pitch;
    if (p !== null) return p.menu !== 'closed' ? 'menu' : this.controls !== null ? 'pitch' : 'spectator';
    return this.screen?.name === 'results' ? 'results' : 'other';
  }

  /** The hook's (§1.40). */
  inspect(): Inspection {
    const pitch = this.pitch;
    const shown = pitch?.inspect() ?? null;
    const frames = this.loop.inspect();
    return {
      screen: this.screen?.name ?? 'home',
      message: null,
      menu: pitch?.menu ?? 'closed',
      render: this.stage.info(),
      match: this.match === null ? null : this.matchInspection(this.match),
      announcements: this.log?.snapshot() ?? null,
      controls: this.controls?.inspect() ?? null,
      view: shown?.view ?? null,
      gamepad: this.devices.gamepad(),
      layers: shown?.layers ?? {},
      audio: null,
      frames: { ...frames, headHashMismatches: this.mismatchesBefore + (shown?.headHashMismatches ?? 0) },
      startMs: { started: this.startedAt, prepared: this.preparedAt },
    };
  }

  /** The held timeline's final hash at t, '' if not held (P1, P2). */
  hashAt(t: number): string {
    return this.match?.session.timeline.hashAt(t) ?? '';
  }

  // --- The routes (§5.2) ---

  /** Start and each hashchange: in phase 1 every fragment goes Home, leaving any match; phase 2's
   *  net-screens routes #join=<id> to Join. */
  private route(): void {
    this.leaveMatch();
    this.home();
  }

  private home(): void {
    const { profile, settings } = this.d;
    this.show(homeScreen({
      profile, look: this.look,
      persistent: () => profile.persistent && settings.persistent,
      practice: () => this.show(practiceScreen({ start: (s) => this.startPractice(s), home: () => this.home() }), null),
      settings: () => this.show(settingsScreen({ settings, persistent: () => settings.persistent, back: () => this.home() }), null),
    }), null);
  }

  /** Practice's Start (Q-15, D-22): the person in pack A, bots in every other place, no room, no fragment. */
  private startPractice(s: MatchSettings): void {
    if (this.match !== null) return;
    const p = this.d.profile.get();
    this.openMatch(practiceMatch({
      me: p.playerId, name: p.name, coat: p.coat, settings: s, build: this.d.build, clock: this.d.clock, page: this.d.page,
    }));
  }

  /** A match held from now: its log, its figures, and its Pre-match. */
  private openMatch(m: Match): void {
    this.dropMatch();
    this.match = m;
    this.log = new Log(m.matchId);
    this.timer = newTimer();
    this.lunges = { count: 0, last: null };
    this.stopListening = m.subscribe({ run: () => this.ran(m) });
    this.arrival(m);
    this.prematch(m);
  }

  /** The pitch screen for m: a MatchView with its BarkTracker, a Controls over the page's devices, and the
   *  layers (§1.38, §1.63). The controls' callbacks reach the screen, made after them. */
  private prematch(m: Match): void {
    const settings = this.d.settings;
    const view = new MatchView(m, this.look, () => {
      const s = settings.get();
      return { calmCamera: s.calmCamera, names: s.names };
    }, new BarkTracker(m.me));
    let screen: PitchScreen | null = null;
    const controls = new Controls({
      view: () => screen?.viewMode() ?? 'ball',
      yaw: () => view.yaw,
      onView: () => screen?.switchView(),
      onBark: (tick) => screen?.ownBark(tick),
    });
    for (const device of this.devices.list()) controls.add(device);
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
    };
    screen = pitchScreen(host, PITCH_LAYERS);
    this.controls = controls;
    this.show(screen, screen);
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
    }), null);
  }

  /** Play again (Q-15, D-12): the next match's Pre-match; Practice's contacts no one. */
  private playAgain(): void {
    const old = this.match;
    if (old === null || this.opening) return;
    this.opening = true;
    old.playAgain().then(
      (next) => {
        this.opening = false;
        if (this.match === old) this.openMatch(next);
        else next.close();
      },
      (e: unknown) => {
        this.opening = false;
        console.error('Play again failed:', e);
      },
    );
  }

  /** Leave on Pre-match or in the menu, and Results' Home (§5.11): the match left, Home. */
  private leave(): void {
    this.leaveMatch();
    this.home();
  }

  /** Networked, LEAVE and the room closed after its grace; Practice closed (D-22). */
  private leaveMatch(): void {
    const m = this.match;
    if (m === null) return;
    this.dropMatch();
    m.leave();
  }

  /** The match no longer held; its log stays until another opens (§1.40). */
  private dropMatch(): void {
    this.stopListening();
    this.stopListening = () => {};
    this.match = null;
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
  }

  /** The first tick this page's timeline held (§1.40): Practice's from genesis. Phase 2's networked
   *  adapter gives an adopted STATE's. */
  private arrival(m: Match): void {
    const t = m.session.timeline;
    if (this.log === null || this.log.arrived || !t.started) return;
    this.log.add({ kind: 'arrival', matchId: m.matchId, tick: m.kind === 'practice' ? 0 : t.finalTick });
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
   *  Pre-match and Match, the frame loop with it, and the new screen's first focus target focused. */
  private show(next: Screen, pitch: PitchScreen | null): void {
    const old = this.screen;
    const oldPitch = this.pitch;
    this.screen = next;
    this.pitch = pitch;
    if (oldPitch !== null && oldPitch !== pitch) {
      this.mismatchesBefore += oldPitch.inspect().headHashMismatches;
      const controls = this.controls;
      this.controls = null;
      if (controls !== null) {
        controls.release();
        for (const device of this.devices.list()) controls.remove(device);
      }
    }
    if (old !== next) old?.dispose?.();
    this.stageBox.hidden = pitch === null;
    this.d.root.classList.toggle('pitch', pitch !== null);
    this.screenBox.replaceChildren(next.el);
    if (pitch !== null) this.loop.start();
    else this.loop.stop();
    focusScreen(next);
    if (pitch === null && this.pendingQuality !== null) this.restage(this.pendingQuality);
  }

  // --- The stage (§2.1, §2.8) ---

  /** The stage's canvas in #stage: the image "The pitch", in the app's landmark (M1's, M4-Q1). */
  private mount(stage: Stage): void {
    const canvas = stage.canvas;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'The pitch');
    this.stageBox.replaceChildren(canvas);
  }

  /** prepare() once the screen showing has been painted: a frame, then a task after it (M4-Q38). */
  private prepareSoon(stage: Stage): void {
    this.frames.request(() => {
      this.d.clock.after(0, () => {
        if (stage === this.stage) this.prepare(stage);
      });
    });
  }

  private prepare(stage: Stage): void {
    if (this.preparing.has(stage)) return;
    this.preparing.set(stage, stage.prepare().then(
      () => {
        this.preparedAt ??= this.d.clock.now();
      },
      // Not a refusal the page expects: the page's own error, which the gate's guard fails (§9.1).
      (e: unknown) => console.error('The pitch could not be prepared:', e),
    ));
  }

  /** Settings' quality: from Home at once, re-creating the stage; while a pitch screen shows, once it goes. */
  private settingsChanged(s: Settings): void {
    if (s.quality === this.quality) {
      this.pendingQuality = null;
      return;
    }
    if (this.pitch !== null) this.pendingQuality = s.quality;
    else this.restage(s.quality);
  }

  /** A new stage at the quality, its canvas in #stage at once and its prepare() behind the screen; the old
   *  one disposed once its own prepare has settled, never mid-compile, or at once if it never began. */
  private restage(quality: RenderQuality): void {
    this.pendingQuality = null;
    const next = this.d.makeStage(quality);
    if (next === null) return;
    const old = this.stage;
    this.stage = next;
    this.quality = quality;
    this.mount(next);
    this.prepareSoon(next);
    const settling = this.preparing.get(old);
    this.preparing.delete(old);
    if (settling === undefined) old.dispose();
    else void settling.then(() => old.dispose());
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
    return {
      kind: m.kind, me: m.me, matchId: m.matchId,
      started, paused: m.paused, inRoster: m.session.inRoster(), returning: m.status().returning,
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
      // The clock's two counters come with phase 2b's timeline (§8.4).
      stats: {
        late: st.late, lateAbsent: st.lateAbsent, disagree: st.disagree, resyncs: st.resyncs, rollbacks: st.rollbacks,
        corrections: st.corrections, clockSamples: 0, clockSamplesDropped: 0,
      },
    };
  }
}

/** The element under root whose id is `id`: appRoot() makes both boxes. */
function child(root: HTMLElement, id: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[id="${id}"]`);
  if (el === null) throw new Error(`the app's landmark has no #${id}`);
  return el;
}
