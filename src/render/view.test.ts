import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { scriptSampler } from '../core/bot/setups';
import type { BarkEvent, ConfirmedGoal } from '../core/session/index';
import { PracticeSession } from '../core/session/practice';
import { Scoreboard } from '../core/session/scoreboard';
import { netSettings } from '../core/session/settings';
import { hashState } from '../core/sim/codec';
import { barkCount, encodeInput } from '../core/sim/input';
import { defaultParams } from '../core/sim/params';
import { pitch } from '../core/sim/pitch';
import {
  CORNER_SCRUM, dribbleScene, NETTING_SHOTS, nettingScene, pinchScene, pushScene, restScene, type Scene, sceneInputs, sceneStart, SQUEEZE,
  WALL_SCRUM,
} from '../core/sim/scenes';
import { CELEBRATION, cloneState, findTerrier, KICKOFF_COUNTDOWN, type MatchState } from '../core/sim/state';
import { makeSim, step } from '../core/sim/step';
import { TEST_BUILD } from '../core/timeline/testing';
import { LocalTransport } from '../net/local';
import { BallMesh } from './ball';
import { newPlaced, placeCamera } from './camera';
import { spectatorCentreLimit, wrapAngle } from './camera-rig';
import type { StageFrame } from './frame';
import { PLACEHOLDER_LOOK } from './look';
import { qualityDetail } from './quality';
import { Shadows } from './shadows';
import { type BarkSource, MatchView, type ViewCameraFrame, type ViewSettings, type ViewSource, type ViewTimeline } from './view';

// One frame composed from the match the page holds (PLAN §12, P11, D-14,
// D-16, Q-15; M4's design §1.16, §2.2, §2.5, §2.7, §3.1): composing and
// drawing a frame leaves the head's hash unchanged, on states from M2's
// scenes and through a bot match in Practice; the drawing clock stands still
// while the source is paused; a bark from a received input and from the
// press, none from an input not yet received; a celebration from a latched
// goal, withdrawn with it; and the rig's yaw moving with the timer's runs,
// never the frames, by the calmer camera's setting when it's on, and drawn
// across a catch-up by the bodies' spread fraction.

const P = defaultParams;
const SETTINGS: ViewSettings = { calmCamera: false, names: false };

/** D-16's rule, as src/core/session/barks.ts's BarkTracker keeps it, written here so this test needs no
 *  other builder's file: a bark at t when the inputs received for t and t − 1 are both known and their
 *  bark counts differ; your own at the press. */
class ReceivedBarks implements BarkSource {
  readonly pressedAt: [string, number][] = [];
  resets = 0;
  private readonly me: string;
  private readonly checked = new Map<string, number>();
  private readonly latestTick = new Map<string, number>();

  constructor(me: string) {
    this.me = me;
  }

  update(t: ViewTimeline): readonly BarkEvent[] {
    const found: BarkEvent[] = [];
    for (const T of t.head.terriers) {
      if (T.id === this.me) continue;
      const newest = t.newestInput(T.id)?.tick;
      if (newest === undefined) continue;
      for (let k = (this.checked.get(T.id) ?? newest) + 1; k <= newest; k++) {
        const a = t.receivedInput(T.id, k - 1);
        const b = t.receivedInput(T.id, k);
        if (a !== undefined && b !== undefined && barkCount(a) !== barkCount(b)) {
          this.latestTick.set(T.id, k);
          found.push({ id: T.id, tick: k, own: false });
        }
      }
      this.checked.set(T.id, newest);
    }
    return found;
  }

  pressed(id: string, tick: number): void {
    this.pressedAt.push([id, tick]);
    this.latestTick.set(id, tick);
  }

  latest(id: string): number | null {
    return this.latestTick.get(id) ?? null;
  }

  reset(): void {
    this.resets++;
    this.checked.clear();
    this.latestTick.clear();
  }
}

/** A timeline's two heads, set by hand, with the inputs received so far. */
class Heads implements ViewTimeline {
  started = true;
  id = 'aaaaaaaaaaaaaaaa';
  paused = false;
  prevHead: MatchState;
  head: MatchState;
  fraction = 0.5;
  readonly inputs = new Map<string, Map<number, number>>();

  constructor(s: MatchState) {
    this.head = s;
    this.prevHead = s;
  }

  get headTick(): number {
    return this.head.tick;
  }

  get localTick(): number {
    return this.head.tick;
  }

  alpha(): number {
    return this.fraction;
  }

  clock(): number {
    return this.head.tick + this.fraction;
  }

  receivedInput(id: string, t: number): number | undefined {
    return this.inputs.get(id)?.get(t);
  }

  newestInput(id: string): { tick: number; input: number } | undefined {
    const m = this.inputs.get(id);
    if (m === undefined || m.size === 0) return undefined;
    const tick = Math.max(...m.keys());
    return { tick, input: m.get(tick)! };
  }

  receive(id: string, t: number, input: number): void {
    const m = this.inputs.get(id) ?? new Map<number, number>();
    m.set(t, input);
    this.inputs.set(id, m);
  }

  /** The head moves on to s, the old one becoming prevHead. */
  moveTo(s: MatchState): void {
    this.prevHead = this.head;
    this.head = s;
  }
}

/** A source over a timeline of heads, its scoreboard's goals set by hand. */
function sourceOf(t: ViewTimeline, me: string): ViewSource & { paused: boolean; goals: ConfirmedGoal[]; session: { timeline: ViewTimeline } } {
  const goals: ConfirmedGoal[] = [];
  return { me, paused: false, goals, session: { timeline: t }, scoreboard: { goals } };
}

const goal = (tick: number, pack: 0 | 1): ConfirmedGoal => ({ tick, pack, ownGoal: false, scorers: [], score: [0, 1] });

/** What the stage does with a frame that runs without a GPU: the ball, the shadows and the camera. */
function drawParts(f: StageFrame, ball: BallMesh, shadows: Shadows): void {
  if (f.match === null) return;
  ball.draw(f.match.ball, f.match.time, f.dtMs);
  shadows.draw(f.match);
  placeCamera(f.camera, pitch, 16 / 9, newPlaced());
}

describe('P11: composing and drawing a frame leaves the head as it was (§2.7)', () => {
  const scenes: Scene[] = [
    WALL_SCRUM, CORNER_SCRUM, SQUEEZE, pushScene('round', 3, 'ball'), restScene({ packSize: 2, thetaDeg: 20, holding: 'ball frame' }),
    nettingScene(NETTING_SHOTS[4]!), pinchScene(4), dribbleScene('ball', true),
  ];

  it("on states from M2's scenes, at every fraction, each tick and across a catch-up", () => {
    for (const scene of scenes) {
      const s = sceneStart(scene, P);
      const sim = makeSim(P, scene.packSize);
      const t = new Heads(cloneState(s));
      const view = new MatchView(sourceOf(t, s.terriers[0]!.id), PLACEHOLDER_LOOK, () => SETTINGS, new ReceivedBarks(s.terriers[0]!.id));
      const ball = new BallMesh(PLACEHOLDER_LOOK, qualityDetail('low'), P.ballRadius);
      const shadows = new Shadows(8);
      let now = 0;
      for (let tick = 1; tick <= 90; tick++) {
        step(sim, s, sceneInputs(scene, s, s.tick + 1));
        // Every third tick, a 3-tick catch-up: the head moves on by three at once.
        if (tick % 3 !== 0 && tick < 60) continue;
        t.moveTo(cloneState(s));
        const before = [hashState(t.head), hashState(t.prevHead)];
        now += 16;
        view.run(now);
        for (const f of [0, 0.5, 1]) {
          t.fraction = f;
          drawParts(view.frame(now, 16), ball, shadows);
        }
        if (tick === 45) view.mode = { kind: 'player', view: 'chase', terrier: s.terriers[0]!.id };
        if (tick === 75) view.mode = { kind: 'spectator', follow: null };
        expect([hashState(t.head), hashState(t.prevHead)], `${scene.name}, tick ${tick}`).toEqual(before);
      }
      expect(view.drawn?.headTick, scene.name).toBe(t.head.tick);
    }
  });

  it("through a bot match in Practice, to its first goal's celebration: barks shown from recorded inputs and the press, the scorers' pack celebrating", () => {
    const NET = netSettings();
    const me = personId(7, 0);
    const p = new PracticeSession(
      { P, B: defaultBotParams, net: NET, me, name: 'P0', coat: 0, settings: { packSize: 1, matchMinutes: 1 }, build: TEST_BUILD },
      new LocalTransport(),
    );
    const sample = scriptSampler('sideways', me, 0, P, defaultBotParams);
    p.controls = () => sample(p.session.timeline.head, p.session.timeline.headTick);
    p.start(0, '9ac71ce09ac71ce0');
    const board = new Scoreboard(P);
    const source: ViewSource = { me, get paused() { return p.paused; }, session: { get timeline() { return p.session.timeline; } }, scoreboard: board };
    const barks = new ReceivedBarks(me);
    const view = new MatchView(source, PLACEHOLDER_LOOK, () => SETTINGS, barks);
    const ball = new BallMesh(PLACEHOLDER_LOOK, qualityDetail('low'), P.ballRadius);
    const shadows = new Shadows(2);
    let now = 0;
    let ready = false;
    let latchedAt = -1;
    let frames = 0;
    let botBarkFrames = 0;
    let ownBarkShown = false;
    let celebrating = 0;
    let wrongCelebrations = 0;
    const found: BarkEvent[] = [];
    while (now < 60_000 && (latchedAt < 0 || now < latchedAt + 2000)) {
      now += NET.timerMs;
      p.advance(now);
      const t = p.session.timeline;
      board.update(t);
      found.push(...view.run(now));
      if (!ready && findTerrier(t.final, me) >= 0) {
        p.ready(true);
        ready = true;
      }
      if (latchedAt < 0 && board.goals.length > 0) latchedAt = now;
      // Your own bark, pressed once early on, into the input two ticks ahead.
      if (now === 2000) view.ownBark(t.localTick + NET.timeline.delay, now);
      if (now % 16 !== 0) continue;
      const before = [hashState(t.head), hashState(t.prevHead), t.headTick];
      const f = view.frame(now, 16);
      drawParts(f, ball, shadows);
      expect([hashState(t.head), hashState(t.prevHead), t.headTick], `at ${now} ms`).toEqual(before);
      frames++;
      for (const T of f.drawer?.terriers ?? []) {
        if (T.id === me && T.bark !== null && now >= 2000 && now < 2100) ownBarkShown = true;
        if (T.id !== me && T.bark !== null) botBarkFrames++;
        if (T.celebrate !== null) {
          if (T.pack === board.goals[0]?.pack && T.celebrate.start === board.goals[0].tick && T.celebrate.weight === 1) celebrating++;
          else wrongCelebrations++;
        }
      }
    }
    const botBarks = found.filter((e) => !e.own).length;
    expect(frames).toBeGreaterThan(500);
    expect(latchedAt, "the bot's goal latched").toBeGreaterThan(0);
    expect(board.goals[0]!.pack).toBe(1);
    expect(celebrating, "the bot's pack celebrated, from the goal's tick").toBeGreaterThan(50);
    expect(wrongCelebrations).toBe(0);
    expect(botBarks, 'the bot barked, found in the inputs recorded for it').toBeGreaterThan(0);
    expect(botBarkFrames).toBeGreaterThan(0);
    expect(ownBarkShown, 'your bark drawn at the press').toBe(true);
    expect(barks.pressedAt).toEqual([[me, expect.any(Number) as number]]);
  });
});

describe('the drawing clock (§2.2, Q-15)', () => {
  it('runs with the page clock, stands still while the source is paused, and goes on from there', () => {
    const s = sceneStart(SQUEEZE, P);
    const t = new Heads(s);
    const source = sourceOf(t, s.terriers[0]!.id);
    const view = new MatchView(source, PLACEHOLDER_LOOK, () => SETTINGS, new ReceivedBarks(source.me));
    const at = (ms: number): [number, number, number] => {
      const f = view.frame(ms, 16);
      return [view.drawMs, f.nowMs, f.dtMs];
    };
    expect(at(1000)).toEqual([1000, 1000, 0]);
    expect(at(1100)).toEqual([1100, 1100, 100]);
    source.paused = true;
    view.run(1150);
    expect(at(1200)).toEqual([1150, 1150, 50]);
    expect(at(1300)).toEqual([1150, 1150, 0]);
    view.run(1400);
    expect(at(1450)).toEqual([1150, 1150, 0]);
    source.paused = false;
    view.run(1500);
    expect(at(1516)).toEqual([1166, 1166, 16]);
    expect(view.inspect().drawMs).toBe(1166);
    // A page time that runs backwards never moves it back.
    expect(at(1400)[0]).toBe(1166);
  });
});

describe('barks (D-16, D-27, L209)', () => {
  const s = sceneStart(SQUEEZE, P);
  const me = s.terriers[0]!.id;
  const them = s.terriers[1]!.id;
  const withBark = (n: number): number => encodeInput({ bark: n });

  it("draws a remote terrier's bark from its received input, at its tick, and none while it isn't received", () => {
    const t = new Heads(cloneState(s));
    const view = new MatchView(sourceOf(t, me), PLACEHOLDER_LOOK, () => SETTINGS, new ReceivedBarks(me));
    const barkOf = (): unknown => view.frame(0, 16).drawer!.terriers.find((T) => T.id === them)!.bark;
    for (let k = 0; k <= 10; k++) t.receive(them, k, withBark(0));
    const at = (tick: number): MatchState => Object.assign(cloneState(s), { tick });
    t.moveTo(at(11));
    t.moveTo(at(12));
    // Ticks 11 and 12 not received: predicted, and a prediction never barks.
    expect(view.run(0)).toEqual([]);
    expect(barkOf()).toBeNull();
    t.receive(them, 11, withBark(1));
    t.receive(them, 12, withBark(1));
    expect(view.run(0)).toEqual([{ id: them, tick: 11, own: false }]);
    // Drawn at 11.5: shown from its tick, at weight 1.
    expect(barkOf()).toEqual({ start: 11, weight: 1 });
    t.fraction = 0;
    t.moveTo(at(11));
    expect(barkOf(), 'not before its tick').toBeNull();
    // Shown for 0.4 s of drawn time from its tick, 24 ticks, and gone then.
    t.moveTo(at(11 + 24));
    t.fraction = 0.99;
    expect(barkOf(), 'still there just short of 0.4 s on').toEqual({ start: 11, weight: 1 });
    t.moveTo(at(11 + 25));
    t.fraction = 0;
    expect(barkOf(), 'gone 0.4 s on').toBeNull();
  });

  it('draws your own bark at once from the press, though its input is for a tick ahead', () => {
    const t = new Heads(Object.assign(cloneState(s), { tick: 40 }));
    const barks = new ReceivedBarks(me);
    const view = new MatchView(sourceOf(t, me), PLACEHOLDER_LOOK, () => SETTINGS, barks);
    t.fraction = 0.25;
    view.run(100);
    expect(view.frame(100, 16).drawer!.terriers.find((T) => T.id === me)!.bark).toBeNull();
    view.ownBark(42, 105);
    expect(barks.pressedAt).toEqual([[me, 42]]);
    const mine = view.frame(110, 16).drawer!.terriers.find((T) => T.id === me)!;
    expect(mine.bark).toEqual({ start: 39.25, weight: 1 });
    expect(mine.mine).toBe(true);
  });

  it('drops the barks it holds when the timeline held is another', () => {
    const t = new Heads(cloneState(s));
    const barks = new ReceivedBarks(me);
    const source = sourceOf(t, me);
    const view = new MatchView(source, PLACEHOLDER_LOOK, () => SETTINGS, barks);
    view.run(0);
    const other = new Heads(cloneState(s));
    other.id = 'bbbbbbbbbbbbbbbb';
    source.session.timeline = other;
    view.run(4);
    expect(barks.resets).toBe(1);
  });
});

describe('celebrations (D-14, C-4, L208)', () => {
  const s = Object.assign(sceneStart(pushScene('round', 2, 'ball'), P), { tick: 80, phase: CELEBRATION, phaseStart: 60 } as const);
  const me = s.terriers[0]!.id;

  it("celebrates a latched goal over its pack's terriers from the goal's tick, while the drawn match celebrates it, and withdraws it with it", () => {
    const t = new Heads(cloneState(s));
    const source = sourceOf(t, me);
    const view = new MatchView(source, PLACEHOLDER_LOOK, () => SETTINGS, new ReceivedBarks(me));
    const celebrations = (): (string | null)[] =>
      view.frame(0, 16).drawer!.terriers.map((T) => (T.celebrate === null ? null : `${T.pack} from ${T.celebrate.start} at ${T.celebrate.weight}`));
    view.run(0);
    expect(celebrations(), 'not latched yet').toEqual([null, null, null, null]);
    source.goals.push(goal(60, 1));
    view.run(0);
    expect(celebrations()).toEqual(s.terriers.map((T) => (T.pack === 1 ? '1 from 60 at 1' : null)));
    // Withdrawn (C-4): gone, though the head still celebrates.
    source.goals.length = 0;
    view.run(0);
    expect(celebrations()).toEqual([null, null, null, null]);
    // Another goal's latch doesn't celebrate this celebration.
    source.goals.push(goal(30, 0));
    view.run(0);
    expect(celebrations()).toEqual([null, null, null, null]);
    // Once the celebration ends at the kickoff, nothing.
    source.goals.push(goal(60, 1));
    t.moveTo(Object.assign(cloneState(s), { tick: 81, phase: KICKOFF_COUNTDOWN, phaseStart: 81 }));
    view.run(0);
    t.fraction = 0.9;
    expect(celebrations()).toEqual([null, null, null, null]);
  });
});

describe('the camera (§3.1, §3.2)', () => {
  const s = sceneStart(dribbleScene('ball', false), P);
  const me = s.terriers[0]!.id;
  const moved = (tick: number, x: number): MatchState => {
    const n = cloneState(s);
    n.tick = tick;
    n.terriers[0]!.x = x;
    n.ball.x = x + 1;
    n.ball.y = (tick - s.tick) * 0.5;
    return n;
  };

  it("steps the rig's yaw on the timer's runs, never the frames, and draws it by the bodies' fraction", () => {
    const t = new Heads(cloneState(s));
    const view = new MatchView(sourceOf(t, me), PLACEHOLDER_LOOK, () => SETTINGS, new ReceivedBarks(me));
    view.run(0);
    const yaw = view.yaw;
    t.moveTo(moved(s.tick + 1, s.terriers[0]!.x));
    for (let k = 0; k < 20; k++) {
      t.fraction = k / 20;
      view.frame(k, 16);
    }
    expect(view.yaw, 'frames move nothing').toBe(yaw);
    view.run(20);
    expect(view.yaw).not.toBe(yaw);
    t.fraction = 0;
    const drawnAt0 = view.frame(21, 16).camera.yaw;
    t.fraction = 1;
    expect(drawnAt0).toBeCloseTo(yaw, 12);
    expect(view.frame(22, 16).camera.yaw).toBeCloseTo(view.yaw, 12);
  });

  it("draws the yaw across a catch-up by the bodies' spread fraction, as it draws them (§2.2, §3.1)", () => {
    const t = new Heads(cloneState(s));
    const view = new MatchView(sourceOf(t, me), PLACEHOLDER_LOOK, () => SETTINGS, new ReceivedBarks(me));
    view.run(0);
    const before = view.yaw; // the rig's yaw at prev's tick
    // Six ticks in one run, the ball gone off to the side: the yaw turns toward it, and the terrier moves on.
    const n = cloneState(s);
    n.tick = s.tick + 6;
    n.terriers[0]!.x += 1.2;
    n.ball.x = n.terriers[0]!.x + 1;
    n.ball.y = 3;
    t.moveTo(n);
    view.run(16);
    const after = view.yaw;
    expect(Math.abs(wrapAngle(after - before)), 'the yaw turned').toBeGreaterThan(0.1);
    for (const alpha of [0, 0.5]) {
      t.fraction = alpha;
      const f = view.frame(20, 16);
      const spread = (5 + alpha) / 6; // f′ = (k − 1 + α) / k
      expect(f.camera.yaw, `α ${alpha}`).toBeCloseTo(wrapAngle(before + wrapAngle(after - before) * spread), 9);
      expect(f.match!.terriers[0]!.x, `α ${alpha}`).toBeCloseTo(s.terriers[0]!.x + 1.2 * spread, 9);
    }
  });

  it("steps the rig by the calmer camera's setting as it reads it, and reports the cap it turned by (D-28, §9.3)", () => {
    const tick = (turnsPerSecond: number): number => (2 * Math.PI * turnsPerSecond) / config.ticksPerSecond;
    const turning = (calm: boolean): { largest: number; caps: Set<number | null> } => {
      const t = new Heads(cloneState(s));
      const view = new MatchView(sourceOf(t, me), PLACEHOLDER_LOOK, () => ({ calmCamera: calm, names: false }), new ReceivedBarks(me));
      view.run(0);
      let yaw = view.yaw;
      let largest = 0;
      const caps = new Set<number | null>();
      // The ball behind the terrier: ball view turns round to it at its cap, the same states either way.
      for (let k = 1; k <= 20; k++) {
        const n = cloneState(s);
        n.tick = s.tick + k;
        n.ball.x = s.terriers[0]!.x - 5;
        n.ball.y = s.terriers[0]!.y + 0.1;
        t.moveTo(n);
        view.run(16 * k);
        largest = Math.max(largest, Math.abs(wrapAngle(view.yaw - yaw)));
        yaw = view.yaw;
        caps.add((view.frame(16 * k, 16).camera as ViewCameraFrame).turnCap);
      }
      return { largest, caps };
    };
    const calm = turning(true);
    const swing = turning(false);
    expect(calm.largest).toBeCloseTo(tick(config.ballViewCalmerMaxTurnsPerSecond), 9);
    expect(swing.largest).toBeCloseTo(tick(config.ballViewSwingMaxTurnsPerSecond), 9);
    expect(swing.largest).toBeGreaterThan(calm.largest);
    expect([...calm.caps]).toEqual([config.ballViewCalmerMaxTurnsPerSecond]);
    expect([...swing.caps]).toEqual([config.ballViewSwingMaxTurnsPerSecond]);
  });

  it('snaps on a view of its own, a timeline of its own and a placement, counting each', () => {
    const t = new Heads(cloneState(s));
    const source = sourceOf(t, me);
    const view = new MatchView(source, PLACEHOLDER_LOOK, () => SETTINGS, new ReceivedBarks(me));
    view.run(0);
    expect(view.inspect().snaps).toBe(1);
    view.mode = { kind: 'player', view: 'chase', terrier: me };
    expect(view.inspect().snaps).toBe(2);
    view.mode = { kind: 'player', view: 'chase', terrier: me };
    expect(view.inspect().snaps, 'the same view again').toBe(2);
    const other = new Heads(cloneState(s));
    other.id = 'cccccccccccccccc';
    source.session.timeline = other;
    view.run(4);
    expect(view.inspect().snaps).toBe(3);
    other.moveTo(Object.assign(moved(s.tick + 2, -10), { phase: KICKOFF_COUNTDOWN, phaseStart: s.tick + 1 }));
    view.run(8);
    expect(view.inspect().snaps).toBe(4);
    expect(view.inspect()).toMatchObject({ mode: { kind: 'player', view: 'chase', terrier: me }, headTick: s.tick + 2, corrections: 0 });
  });

  it("frames a player's terrier and its target, the spectators' window and the overview, with the rig's setting", () => {
    let calm = true;
    const t = new Heads(cloneState(s));
    const view = new MatchView(sourceOf(t, me), PLACEHOLDER_LOOK, () => ({ calmCamera: calm, names: false }), new ReceivedBarks(me));
    view.run(0);
    t.fraction = 1;
    const ballView = view.frame(0, 16);
    const T = ballView.match!.terriers[0]!;
    expect(ballView.camera).toMatchObject({ mode: { kind: 'player', view: 'ball', terrier: me }, subject: { x: T.x, y: T.y, z: T.z }, calm: true });
    expect(ballView.camera.target).toEqual({ x: ballView.match!.ball.x, y: ballView.match!.ball.y, z: ballView.match!.ball.z });
    expect(ballView.fadeTo).toEqual({ x: T.x, y: T.y, z: T.z });
    calm = false;
    view.mode = { kind: 'player', view: 'chase', terrier: me };
    const chase = view.frame(1, 16);
    expect((chase.camera as ViewCameraFrame).calm).toBe(false);
    expect(chase.camera.target).toEqual(chase.camera.subject);
    view.mode = { kind: 'spectator', follow: null };
    const watching = view.frame(2, 16);
    expect(watching.camera.subject).toBeNull();
    expect(watching.fadeTo).toEqual({ x: watching.match!.ball.x, y: watching.match!.ball.y, z: watching.match!.ball.z });
    // The window's centre, snapped to the ball at the follow's first tick, and kept on the pitch.
    const limit = spectatorCentreLimit(pitch);
    expect(watching.match!.ball.x).toBeLessThan(-limit);
    expect(watching.camera.target.x).toBe(-limit);
    // A player whose terrier the match doesn't hold watches the ball.
    view.mode = { kind: 'player', view: 'ball', terrier: 'f'.repeat(32) };
    expect(view.frame(3, 16).camera.subject).toBeNull();
    // Before the match's state arrives: no match, the empty pitch.
    t.started = false;
    const empty = view.frame(4, 16);
    expect([empty.match, empty.drawer, empty.fadeTo, view.drawn]).toEqual([null, null, null, null]);
  });
});
