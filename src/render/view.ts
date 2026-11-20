// One frame composed from the match the page holds (PLAN §12's "Each
// frame"; M4's design, research/m4/DESIGN.md, §1.16, §2.2, §2.5, §2.7,
// §3.1): the drawn match, the drawer's input with every bark and
// celebration as overlays, the camera's frame and the occluders' subject.
// The pitch screen calls it; the stage (src/render/scene.ts) draws what it
// returns. Phase 1's, by the stage builder:
// - interpolation between the timeline's prevHead and head at alpha(now),
//   the fraction spread over a catch-up (src/render/interpolate.ts);
// - the camera rig (src/render/camera-rig.ts), stepped in run() after each
//   timer run, once a head tick, and drawn by the bodies' spread fraction;
//   it snaps on a view's first tick, at a placement, at the terrier's
//   arrival or switch, and when the timeline held is another;
// - the drawing clock: the page clock less the time the source was paused,
//   so every fade, the ball's roll and the dust stand still with Practice's
//   pause (Q-15);
// - barks from its BarkSource (src/core/session/barks.ts's BarkTracker,
//   which the slice passes in): a received or recorded input's tick, never
//   a predicted one, and your own from the press, drawn at once (D-16,
//   D-27); and celebrations from the scoreboard's latched goals, for the
//   pack each counts for, from the goal's tick while the drawn match
//   celebrates it, withdrawn with it (D-14, C-4); both at weight 1 through
//   the blends' stub (src/render/blends.ts).
// Phase 3's motion builder adds the smoother, the blends' fades and the
// held head.
//
// What it keeps between frames is what D-27 and CLAUDE.md allow, as M4-Q35
// amends their list: the rig's yaw, each latched goal's latch time, each
// bark's start and when it was first seen, and the drawing clock's paused
// time; every animation, and how far through it is, comes from the state.
// It reads the timeline's heads and writes nothing to them (P11). New at
// M4. Three-free.

import { config } from '../config';
import type { BarkEvent, ConfirmedGoal, Correction } from '../core/session/index';
import { CELEBRATION, findTerrier, type MatchState, type Pack } from '../core/sim/state';
import { pitch } from '../core/sim/pitch';
import { Blends } from './blends';
import { CameraRig, rigInput, rigParams, spectatorCentreLimit } from './camera-rig';
import type { DrawerFrame, Overlay, TerrierFrame } from './drawer';
import type { CameraFrame, CameraMode, DrawnMatch, DrawnTerrier, StageFrame } from './frame';
import { interpolate, newDrawnMatch, placementBetween, spreadFraction } from './interpolate';
import type { Look } from './look';
import type { MatchViewApi } from './stage-types';

/** What the view reads of a match: Match (src/ui/match.ts) satisfies it. */
export interface ViewSource {
  readonly me: string;
  /** Practice's pause: the drawing clock stops (M4's design §2.2). */
  readonly paused: boolean;
  /** Read .timeline each time: a merge or a rejoin replaces it. */
  readonly session: { readonly timeline: ViewTimeline };
  readonly scoreboard: { readonly goals: readonly ConfirmedGoal[] };
}

/** What the view reads of a timeline: src/core/timeline/timeline.ts's Timeline satisfies it. */
export interface ViewTimeline {
  readonly started: boolean; readonly id: string; readonly paused: boolean;
  readonly head: Readonly<MatchState>; readonly prevHead: Readonly<MatchState>;
  readonly headTick: number; readonly localTick: number;
  alpha(now: number): number; clock(now: number): number;
  receivedInput(id: string, t: number): number | undefined;
  newestInput(id: string): { readonly tick: number; readonly input: number } | undefined;
}

/** The barks the view draws (D-16): src/core/session/barks.ts's BarkTracker, which the slice passes in. */
export interface BarkSource {
  /** After each timer run: the barks newly found in received inputs. */
  update(t: ViewTimeline): readonly BarkEvent[];
  /** Your own, at the press. */
  pressed(id: string, tick: number): void;
  /** The latest bark's tick: the drawer's bark start. */
  latest(id: string): number | null;
  /** Another timeline. */
  reset(): void;
}

export interface ViewSettings {
  readonly calmCamera: boolean;
  readonly names: boolean;
}

/** The view's camera frame: frame.ts's CameraFrame and the rig's setting, which the stage reports as
 *  render.camera.calm. */
export interface ViewCameraFrame extends CameraFrame {
  readonly calm: boolean;
}

/** How long a bark shows over its terrier and in its pose, from its start: the code-built pose's bark, a
 *  mouth open and a head toss (M4's design §2.5). */
const BARK_SHOWN_SECONDS = 0.4;
const BARK_TICKS = BARK_SHOWN_SECONDS * config.ticksPerSecond;

const NO_BARKS: readonly BarkEvent[] = Object.freeze([]);
const ORIGIN = Object.freeze({ x: 0, y: 0, z: 0 });

/** Whether two camera modes are the same view of the same body. */
function sameMode(a: CameraMode | null, b: CameraMode): boolean {
  if (a === null || a.kind !== b.kind) return false;
  if (a.kind === 'player' && b.kind === 'player') return a.view === b.view && a.terrier === b.terrier;
  if (a.kind === 'spectator' && b.kind === 'spectator') return a.follow === b.follow;
  return true;
}

/** A latched goal, and when the view first saw it latched, by the drawing clock. */
interface Latched {
  readonly tick: number;
  readonly pack: Pack;
  readonly atMs: number;
}

export class MatchView implements MatchViewApi {
  readonly look: Look;
  private readonly source: ViewSource;
  private readonly settings: () => ViewSettings;
  private readonly barks: BarkSource;
  private readonly rig = new CameraRig();
  private readonly blends = new Blends(config.animationBlendMs);
  private readonly out = newDrawnMatch();
  private modeValue: CameraMode;
  private drawnValue: DrawnMatch | null = null;
  /** The timeline last seen, and its ID: another, a merge's or a rejoin's, resets what's kept. */
  private timeline: ViewTimeline | null = null;
  private timelineId = '';
  /** The head tick the rig is at, and the mode it stepped under; −1: snap at the next chance. */
  private rigTick = -1;
  private rigMode: CameraMode | null = null;
  private corrections = 0;
  // The drawing clock (§2.2): the page clock less the time the source was paused.
  private lastPageMs: number | null = null;
  private pausedMs = 0;
  private pausedSince: number | null = null;
  private drawValue = 0;
  private lastFrameMs: number | null = null;
  // Barks and goals (§2.5).
  private own: { readonly tick: number; readonly start: number; readonly atMs: number } | null = null;
  private readonly barkSeen = new Map<string, { readonly tick: number; readonly atMs: number }>();
  private latched: readonly Latched[] = [];
  private shown: readonly string[] = [];

  constructor(source: ViewSource, look: Look, settings: () => ViewSettings, barks: BarkSource) {
    this.source = source;
    this.look = look;
    this.settings = settings;
    this.barks = barks;
    this.modeValue = { kind: 'player', view: 'ball', terrier: source.me };
    this.sync();
  }

  /** The screen sets it: a view switch, a spectator's follow (§3.4). A new one snaps the rig to its
   *  target at once: the view's first tick. */
  get mode(): CameraMode {
    return this.modeValue;
  }

  set mode(m: CameraMode) {
    if (sameMode(this.modeValue, m)) return;
    this.modeValue = m;
    const t = this.sync();
    if (t.started) this.snapTo(t.head, m);
    else this.rigTick = -1;
  }

  /** The last frame's drawn match. */
  get drawn(): DrawnMatch | null {
    return this.drawnValue;
  }

  /** The rig's yaw now, radians, at the drawn head's tick: what chase view's anchoring reads (D-29, Q-19). */
  get yaw(): number {
    return this.rig.yaw;
  }

  /** The drawing clock, ms (§2.2). */
  get drawMs(): number {
    return this.drawValue;
  }

  /** After each timer run: the rig advances over the ticks the head moved (§3.1); barks are found and
   *  latched goals noted for their celebrations (§2.5). Returns the barks found, which the pitch screen
   *  hands its layers, so the sound plays what the drawing shows and the tracker is read once. */
  run(pageNowMs: number): readonly BarkEvent[] {
    this.observe(pageNowMs);
    const t = this.sync();
    this.latch();
    if (!t.started) return NO_BARKS;
    const found = this.barks.update(t);
    for (const e of found) this.barkSeen.set(e.id, { tick: e.tick, atMs: this.drawValue });
    this.stepRig(t);
    return found;
  }

  /** A correction, for the smoother and the blends (phase 3): counted. */
  correct(_c: Readonly<Correction>, pageNowMs: number): void {
    this.observe(pageNowMs);
    this.corrections++;
  }

  /** Your own bark, in the input for `tick`: its start is the drawn time at the press, so it's drawn at
   *  once (D-27), though its input is for a tick ahead of the drawn one. */
  ownBark(tick: number, pageNowMs: number): void {
    this.observe(pageNowMs);
    this.barks.pressed(this.source.me, tick);
    const t = this.sync();
    const start = t.started ? t.headTick - 1 + t.alpha(pageNowMs) : tick;
    this.own = { tick, start, atMs: this.drawValue };
  }

  /** This frame's StageFrame and the drawn match it holds, its times the drawing clock's: the page clock
   *  less the time the source was paused. dtMs is the drawing clock's advance since the last frame, so 0
   *  while paused. */
  frame(pageNowMs: number, _pageDtMs: number): StageFrame {
    this.observe(pageNowMs);
    const nowMs = this.drawValue;
    const dtMs = this.lastFrameMs === null ? 0 : Math.max(0, nowMs - this.lastFrameMs);
    this.lastFrameMs = nowMs;
    const t = this.sync();
    const calm = this.settings().calmCamera;
    const mode = this.modeValue;
    if (!t.started) {
      this.drawnValue = null;
      const camera: ViewCameraFrame = { mode, yaw: this.rig.yaw, target: ORIGIN, subject: null, calm };
      return { match: null, drawer: null, camera, nowMs, dtMs, fadeTo: null };
    }
    const prev = t.prevHead;
    const head = t.head;
    if (this.rigTick < 0) this.snapTo(head, mode);
    const alpha = t.alpha(pageNowMs);
    const m = interpolate(prev, head, alpha, null, this.out);
    // The rig's yaw by the bodies' own fraction; a snap left prevYaw at the yaw.
    const f = head.tick <= prev.tick || placementBetween(prev, head) ? 1 : spreadFraction(prev, head, alpha);
    const terriers: TerrierFrame[] = [];
    const ids: string[] = [];
    for (const d of m.terriers) {
      terriers.push(this.terrierFrame(d, m, nowMs));
      ids.push(d.id);
    }
    for (const id of this.shown) if (!ids.includes(id)) this.blends.forget(id);
    this.shown = ids;
    const drawer: DrawerFrame = { time: m.time, tick: m.headTick - 1, fraction: m.fraction, terriers };
    const { camera, fadeTo } = this.cameraFrame(m, f, calm);
    this.drawnValue = m;
    return { match: m, drawer, camera, nowMs, dtMs, fadeTo };
  }

  inspect(): { mode: CameraMode; yaw: number; headTick: number; snaps: number; corrections: number; drawMs: number } {
    const t = this.source.session.timeline;
    return {
      mode: this.modeValue, yaw: this.rig.yaw, headTick: t.started ? t.headTick : 0,
      snaps: this.rig.snaps, corrections: this.corrections, drawMs: this.drawValue,
    };
  }

  // --- The clock and the timeline ---

  /** The drawing clock at page time pageNowMs: pauses are noticed at each call, so within a timer run. */
  private observe(pageNowMs: number): void {
    const now = this.lastPageMs === null ? pageNowMs : Math.max(this.lastPageMs, pageNowMs);
    this.lastPageMs = now;
    const paused = this.source.paused;
    if (paused && this.pausedSince === null) this.pausedSince = now;
    else if (!paused && this.pausedSince !== null) {
      this.pausedMs += now - this.pausedSince;
      this.pausedSince = null;
    }
    this.drawValue = (this.pausedSince ?? now) - this.pausedMs;
  }

  /** The timeline held: another drops the barks, the fades and the rig's place, to snap again. */
  private sync(): ViewTimeline {
    const t = this.source.session.timeline;
    if (t !== this.timeline || t.id !== this.timelineId) {
      if (this.timeline !== null) {
        this.barks.reset();
        this.blends.reset();
        this.own = null;
        this.barkSeen.clear();
      }
      this.timeline = t;
      this.timelineId = t.id;
      this.rigTick = -1;
    }
    return t;
  }

  /** The scoreboard's latched goals, each with when the view first saw it, by the drawing clock: a goal
   *  added starts its pack's celebration, and one withdrawn (C-4) takes it back. */
  private latch(): void {
    const goals = this.source.scoreboard.goals;
    const kept = this.latched;
    if (goals.length === kept.length && goals.every((g, k) => g.tick === kept[k]!.tick && g.pack === kept[k]!.pack)) return;
    this.latched = goals.map((g) => kept.find((x) => x.tick === g.tick && x.pack === g.pack) ?? { tick: g.tick, pack: g.pack, atMs: this.drawValue });
  }

  // --- The rig (§3.1) ---

  /** The followed body's x along the pitch, for the spectators' window, kept on the pitch. */
  private followX(s: Readonly<MatchState>, follow: string | null): number {
    const k = follow === null ? -1 : findTerrier(s, follow);
    const x = k < 0 ? s.ball.x : s.terriers[k]!.x;
    const limit = spectatorCentreLimit(pitch);
    return Math.max(-limit, Math.min(limit, x));
  }

  private snapTo(head: Readonly<MatchState>, m: CameraMode): void {
    if (m.kind === 'player') {
      const k = findTerrier(head, m.terrier);
      if (k >= 0) this.rig.snap(m.view, rigInput(head, head.terriers[k]!));
    } else if (m.kind === 'spectator') {
      this.rig.snapCentre(this.followX(head, m.follow));
    }
    this.rigTick = head.tick;
    this.rigMode = m;
  }

  /** Once a head tick: the rig steps over the ticks the head moved since the last run, toward targets
   *  between prevHead and head; held while the head is held. */
  private stepRig(t: ViewTimeline): void {
    const head = t.head;
    const prev = t.prevHead;
    const m = this.modeValue;
    if (this.rigTick < 0 || head.tick < this.rigTick || !sameMode(this.rigMode, m)) {
      this.snapTo(head, m);
      return;
    }
    if (head.tick === this.rigTick) return;
    const p = rigParams(this.settings().calmCamera);
    if (m.kind === 'player') {
      this.rig.advance(m.view, prev, head, m.terrier, p);
    } else if (m.kind === 'spectator') {
      const arrived = m.follow !== null && findTerrier(head, m.follow) >= 0 && findTerrier(prev, m.follow) < 0;
      if (placementBetween(prev, head) || arrived) this.rig.snapCentre(this.followX(head, m.follow));
      else this.rig.advanceCentre(this.followX(prev, m.follow), this.followX(head, m.follow), head.tick - prev.tick, p);
    }
    this.rigTick = head.tick;
  }

  // --- The frame's parts ---

  private terrierFrame(d: Readonly<DrawnTerrier>, m: Readonly<DrawnMatch>, nowMs: number): TerrierFrame {
    return {
      id: d.id, pack: d.pack, coat: d.coat, mine: d.id === this.source.me,
      x: d.x, y: d.y, z: d.z, vx: d.vx, vy: d.vy, vz: d.vz,
      heading: d.heading, headingChange: d.headingChange,
      layers: this.blends.layers(d, nowMs),
      gait: d.gait,
      takeOffTick: d.takeOffTick, landingTick: d.landingTick,
      lastBallContactTick: d.lastBallContactTick, lastTerrierContactTick: d.lastTerrierContactTick,
      lastPushDir: d.lastPushDir, lastPushTick: d.lastPushTick,
      bark: this.barkOverlay(d.id, m.time, nowMs),
      celebrate: this.celebration(d, m, nowMs),
    };
  }

  /** The terrier's latest bark, shown from its start for BARK_SHOWN_SECONDS: a received or recorded
   *  input's tick, or your own press's drawn time (D-27). */
  private barkOverlay(id: string, time: number, nowMs: number): Overlay | null {
    const latest = this.barks.latest(id);
    let start: number | null = null;
    let atMs = nowMs;
    if (latest !== null) {
      const own = this.own;
      if (own !== null && id === this.source.me && own.tick === latest) {
        start = own.start;
        atMs = own.atMs;
      } else {
        start = latest;
        const seen = this.barkSeen.get(id);
        if (seen !== undefined && seen.tick === latest) atMs = seen.atMs;
        else this.barkSeen.set(id, { tick: latest, atMs: nowMs });
      }
    }
    const active = start !== null && time >= start && time - start < BARK_TICKS;
    return this.blends.overlay(`bark ${id}`, active, start ?? 0, atMs, nowMs);
  }

  /** The celebration of the latched goal the drawn match celebrates, for the pack it counts for, from
   *  the goal's tick, so it shows part-way through (L208); it ends with the drawn celebration. */
  private celebration(d: Readonly<DrawnTerrier>, m: Readonly<DrawnMatch>, nowMs: number): Overlay | null {
    const g = m.phase === CELEBRATION ? this.latched.find((x) => x.tick === m.phaseStart) : undefined;
    const active = g !== undefined && g.pack === d.pack;
    return this.blends.overlay(`celebrate ${d.id}`, active, g?.tick ?? 0, g?.atMs ?? nowMs, nowMs);
  }

  /** The camera's frame, its yaw the rig's drawn by f, and what the occluders fade in front of: a
   *  player's terrier, or the spectator's followed body. */
  private cameraFrame(m: Readonly<DrawnMatch>, f: number, calm: boolean): { camera: ViewCameraFrame; fadeTo: { x: number; y: number; z: number } | null } {
    const mode = this.modeValue;
    const yaw = this.rig.drawn(f);
    const ball = { x: m.ball.x, y: m.ball.y, z: m.ball.z };
    if (mode.kind === 'player') {
      const T = m.terriers.find((d) => d.id === mode.terrier);
      if (T === undefined) return { camera: { mode, yaw, target: ball, subject: null, calm }, fadeTo: null };
      const subject = { x: T.x, y: T.y, z: T.z };
      return { camera: { mode, yaw, target: mode.view === 'ball' ? ball : subject, subject, calm }, fadeTo: subject };
    }
    if (mode.kind === 'spectator') {
      const T = mode.follow === null ? undefined : m.terriers.find((d) => d.id === mode.follow);
      const body = T === undefined ? ball : { x: T.x, y: T.y, z: T.z };
      const target = { x: this.rig.drawnCentre(f), y: body.y, z: body.z };
      return { camera: { mode, yaw, target, subject: null, calm }, fadeTo: body };
    }
    return { camera: { mode, yaw, target: ORIGIN, subject: null, calm }, fadeTo: null };
  }
}
