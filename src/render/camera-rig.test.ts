import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { config, derived } from '../config';
import { TURN } from '../core/sim/math';
import { defaultParams } from '../core/sim/params';
import { pitch } from '../core/sim/pitch';
import { park, place, placeBall, placedMatch, restScene, sceneInputs, sceneStart } from '../core/sim/scenes';
import { cloneState, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState } from '../core/sim/state';
import { makeSim, step } from '../core/sim/step';
import { newPlaced, placeCamera } from './camera';
import { CameraRig, type RigInput, rigParams, rigTarget, wrapAngle } from './camera-rig';
import type { ViewMode } from './frame';
import { spreadFraction } from './interpolate';

// The cameras' yaw (PLAN D-28, §16's cameras; M4's design §1.10, §3.1,
// §3.6, M4-Q13), stepped tick by tick as the timeline's timer steps it,
// never by the frame rate: ball view's cap and its lack of a jump, over a
// ball hopping over the terrier and one resting on terriers above it, at
// both settings; a terrier circling the ball keeping it in view at the
// phone's aspect; chase view's time constant and cap; the snaps; and a
// catch-up's k steps.

const P = defaultParams;
const TAU = 2 * Math.PI;
const SETTINGS = [false, true] as const;
const name = (calmer: boolean): string => (calmer ? 'the calmer camera' : 'the swing');

/** A 1-a-side state in play at `tick`, its first terrier at (x, y) heading `heading` radians, the ball at (bx, by). */
function state(tick: number, x: number, y: number, heading: number, bx: number, by: number): MatchState {
  const s = placedMatch(P, 1);
  s.tick = tick;
  const T = s.terriers[0]!;
  T.x = x;
  T.y = y;
  T.heading = Math.round(((((heading % TAU) + TAU) % TAU) / TAU) * TURN) >>> 0;
  s.ball.x = bx;
  s.ball.y = by;
  return s;
}

const input = (x: number, y: number, heading: number, ballX: number, ballY: number, overhead = false, ref = 0): RigInput => ({
  x, y, heading, ballOverhead: overhead, overheadRef: ref, ballX, ballY,
});

describe('the rig (D-28)', () => {
  it("reads the swing's and the calmer camera's settings", () => {
    expect(rigParams(false)).toEqual({
      chaseTimeConstantSeconds: config.chaseSwingTimeConstantSeconds, chaseMaxTurnsPerSecond: config.chaseSwingMaxTurnsPerSecond,
      ballViewMaxTurnsPerSecond: config.ballViewSwingMaxTurnsPerSecond, tickSeconds: derived.tickSeconds,
      spectatorFollowSeconds: config.spectatorFollowSeconds,
    });
    expect(rigParams(true)).toMatchObject({
      chaseTimeConstantSeconds: config.chaseCalmerTimeConstantSeconds, chaseMaxTurnsPerSecond: config.chaseCalmerMaxTurnsPerSecond,
      ballViewMaxTurnsPerSecond: config.ballViewCalmerMaxTurnsPerSecond,
    });
  });

  it("aims chase view at the heading, and ball view at the ball, or at the overhead reference while it's overhead (D-7)", () => {
    expect(rigTarget('chase', input(0, 0, 1, 5, 5), 0)).toBe(1);
    expect(rigTarget('ball', input(1, 1, 0, 1, 3), 0)).toBeCloseTo(Math.PI / 2, 15);
    expect(rigTarget('ball', input(1, 1, 0, 1, 3, true, 2.5), 0)).toBe(2.5);
    // Right on top of it with no flag, the line has no direction: the yaw holds.
    expect(rigTarget('ball', input(1, 1, 0, 1, 1), 0.7)).toBe(0.7);
  });

  for (const calmer of SETTINGS) {
    const p = rigParams(calmer);
    const cap = p.chaseMaxTurnsPerSecond * TAU * p.tickSeconds;

    it(`eases chase view toward a held heading with its time constant, never past its cap: ${name(calmer)}`, () => {
      // A quarter turn: every step under the cap, so the gap falls by e^(−Δt/τ) a tick, to 1/e after τ.
      const rig = new CameraRig();
      rig.snap('chase', input(0, 0, 0, 0, 0));
      const held = input(0, 0, Math.PI / 2, 0, 0);
      const ticks = Math.round(p.chaseTimeConstantSeconds / p.tickSeconds);
      for (let k = 0; k < ticks; k++) {
        const before = rig.yaw;
        rig.step('chase', held, p);
        expect(rig.yaw - before).toBeLessThanOrEqual(cap + 1e-12);
      }
      expect(Math.PI / 2 - rig.yaw).toBeCloseTo((Math.PI / 2) * Math.exp(-1), 9);
      // Nearly half a turn: capped at ω·Δt while the eased step would pass it, never overshooting.
      const far = new CameraRig();
      far.snap('chase', input(0, 0, 0, 0, 0));
      const behind = input(0, 0, Math.PI - 0.01, 0, 0);
      let capped = 0;
      for (let k = 0; k < 600; k++) {
        const before = far.yaw;
        far.step('chase', behind, p);
        const moved = far.yaw - before;
        expect(moved).toBeGreaterThanOrEqual(0);
        expect(moved).toBeLessThanOrEqual(cap + 1e-12);
        if (Math.abs(moved - cap) < 1e-12) capped++;
        expect(far.yaw).toBeLessThanOrEqual(Math.PI - 0.01 + 1e-12);
      }
      expect(capped).toBeGreaterThan(0);
      expect(far.yaw).toBeCloseTo(Math.PI - 0.01, 6);
    });
  }

  /** Steps the real simulation tick by tick from `s`, advancing a rig in ball view on each pair of heads,
   *  as the timeline's timer does; returns each tick's turn and how often the flag was set. */
  function ballViewTurns(s: MatchState, ticks: number, calmer: boolean, inputs: (s: MatchState, t: number) => ReturnType<typeof sceneInputs>): { turns: number[]; overhead: number; me: string } {
    const sim = makeSim(P, s.packSize);
    const me = s.terriers[0]!.id;
    const rig = new CameraRig();
    const T = s.terriers[0]!;
    rig.snap('ball', input(T.x, T.y, 0, s.ball.x, s.ball.y));
    const turns: number[] = [];
    let overhead = 0;
    for (let k = 0; k < ticks; k++) {
      const prev = cloneState(s);
      step(sim, s, inputs(s, s.tick + 1));
      rig.advance('ball', prev, s, me, rigParams(calmer));
      turns.push(Math.abs(wrapAngle(rig.yaw - rig.prevYaw)));
      if (s.terriers[0]!.ballOverhead) overhead++;
    }
    return { turns, overhead, me };
  }

  for (const calmer of SETTINGS) {
    const cap = rigParams(calmer).ballViewMaxTurnsPerSecond * TAU * derived.tickSeconds;

    it(`turns ball view no faster than its cap and never in a jump, for a ball hopping over the terrier at 5 m/s: ${name(calmer)}`, () => {
      // The ball from 3 m behind the terrier at 5 m/s, lobbed so it clears the terrier's head and lands
      // 3 m in front: the line to it turns half a turn, through the overhead flag.
      const s = placedMatch(P, 1);
      park(P, s, 1);
      place(P, s, 0, 0, 0);
      placeBall(P, s, -3, 0, P.ballRadius, 5, 0, 0.6 * config.gravityMetresPerSecond2);
      const { turns, overhead } = ballViewTurns(s, 120, calmer, () => []);
      expect(overhead, 'the ball passed over it').toBeGreaterThan(0);
      expect(Math.max(...turns)).toBeLessThanOrEqual(cap + 1e-12);
      // It did turn: at the cap through the pass, not left behind.
      expect(turns.filter((d) => d > cap - 1e-9).length).toBeGreaterThan(10);
    });

    it(`turns ball view no faster than its cap for a ball resting on terriers above it: ${name(calmer)}`, () => {
      for (const thetaDeg of [12, 30]) {
        const scene = restScene({ packSize: 1, thetaDeg, holding: 'ball frame' });
        const s = sceneStart(scene, P);
        const { turns } = ballViewTurns(s, 300, calmer, (st, t) => sceneInputs(scene, st, t));
        expect(Math.max(...turns), `${thetaDeg}°`).toBeLessThanOrEqual(cap + 1e-12);
      }
    });

    it(`keeps the ball in view for a terrier circling it at run speed from 3 m, at the phone's aspect: ${name(calmer)}`, () => {
      // D-28: 6 m/s round a 3 m circle is 0.32 turn/s, under either cap, so ball view keeps it centred.
      const aspect = 915 / 355; // the phone held sideways, in CSS px (M4's design §1.60)
      const rate = config.runSpeedMetresPerSecond / 3 / config.ticksPerSecond; // radians a tick
      expect((rate * config.ticksPerSecond) / TAU).toBeLessThan(rigParams(calmer).ballViewMaxTurnsPerSecond);
      const circling = (t: number): MatchState => {
        const a = rate * t;
        return state(t, 3 * Math.cos(a), 3 * Math.sin(a), a + Math.PI / 2, 0, 0);
      };
      const rig = new CameraRig();
      const first = circling(0);
      rig.snap('ball', input(first.terriers[0]!.x, first.terriers[0]!.y, 0, 0, 0));
      const camera = new PerspectiveCamera(config.cameraFovDegrees, aspect, 0.05, 200);
      const placed = newPlaced();
      let worst = 0;
      for (let t = 1; t <= 600; t++) {
        const head = circling(t);
        rig.advance('ball', circling(t - 1), head, head.terriers[0]!.id, rigParams(calmer));
        const T = head.terriers[0]!;
        placeCamera({ mode: { kind: 'player', view: 'ball', terrier: T.id }, yaw: rig.yaw, target: head.ball, subject: T }, pitch, aspect, placed);
        camera.position.copy(placed.position);
        camera.up.copy(placed.up);
        camera.lookAt(placed.lookAt);
        camera.updateMatrixWorld();
        worst = Math.max(worst, Math.abs(new Vector3(head.ball.x, head.ball.y, head.ball.z).project(camera).x));
      }
      expect(worst, 'the ball inside the half-field').toBeLessThan(0.05);
    });
  }
});

describe('the snaps (§3.1)', () => {
  const p = rigParams(false);

  it('jumps to its target on a snap, prevYaw with it, each counted', () => {
    const rig = new CameraRig();
    rig.snap('ball', input(0, 0, 0, 0, 5));
    expect([rig.yaw, rig.prevYaw, rig.snaps]).toEqual([Math.PI / 2, Math.PI / 2, 1]);
    rig.snap('chase', input(0, 0, -1, 0, 5));
    expect([rig.yaw, rig.snaps]).toEqual([-1, 2]);
  });

  it('snaps at a kickoff placement between the heads, and at an arrival or a switch, instead of stepping', () => {
    for (const view of ['ball', 'chase'] as const) {
      const prev = state(10, 0, 0, 0, 5, 0);
      const target = (s: MatchState): number => (view === 'chase' ? Math.PI : Math.atan2(0 - s.terriers[0]!.y, 0 - s.terriers[0]!.x));
      // Placed for a kickoff: a turn the cap would take many ticks over, made at once.
      const placed = state(13, 10, 0, Math.PI, 0, 0);
      placed.phase = KICKOFF_COUNTDOWN;
      placed.phaseStart = 12;
      const rig = new CameraRig();
      rig.snap(view, input(0, 0, 0, 5, 0));
      rig.advance(view, prev, placed, placed.terriers[0]!.id, p);
      expect(Math.abs(wrapAngle(rig.yaw - target(placed))), view).toBeLessThan(1e-9);
      expect([rig.prevYaw, rig.snaps]).toEqual([rig.yaw, 2]);
      // Arrived: not in prev.
      const empty = cloneState(prev);
      empty.terriers.splice(0, 1);
      const arrived = state(11, 10, 0, Math.PI, 0, 0);
      rig.advance(view, empty, arrived, arrived.terriers[0]!.id, p);
      expect(rig.snaps).toBe(3);
      // Switched: its slot changed.
      const moved = state(12, 10, 0, Math.PI, 0, 0);
      moved.terriers[0]!.spot = 1;
      rig.advance(view, arrived, moved, moved.terriers[0]!.id, p);
      expect(rig.snaps).toBe(4);
    }
  });

  it("holds while the head doesn't hold the terrier, and while the head hasn't moved", () => {
    const rig = new CameraRig();
    rig.snap('ball', input(0, 0, 0, 5, 5));
    const yaw = rig.yaw;
    const prev = state(10, 0, 0, 0, 5, 0);
    const gone = cloneState(prev);
    gone.tick = 11;
    gone.terriers.splice(0, 1);
    rig.advance('ball', prev, gone, prev.terriers[0]!.id, p);
    rig.advance('ball', prev, prev, prev.terriers[0]!.id, p);
    expect([rig.yaw, rig.prevYaw, rig.snaps]).toEqual([yaw, yaw, 1]);
  });
});

describe('a catch-up (M4-Q13, §3.6)', () => {
  const p = rigParams(false);
  // Each tick's state: a terrier running straight up the pitch at 6 m/s past a resting ball, turning
  // steadily, so a point between two heads at j / k is the state at that tick exactly.
  const run = (t: number): MatchState => state(t, -6 + 0.1 * t, -3, 0.02 * t, 2, 4);

  for (const view of ['ball', 'chase'] as ViewMode[]) {
    it(`steps k times between two heads k ticks apart, as k single steps would, and draws by the bodies' fraction: ${view} view`, () => {
      const once = new CameraRig();
      const each = new CameraRig();
      for (const rig of [once, each]) rig.snap(view, input(-6, -3, 0, 2, 4));
      once.advance(view, run(0), run(6), run(0).terriers[0]!.id, p);
      for (let t = 1; t <= 6; t++) each.advance(view, run(t - 1), run(t), run(0).terriers[0]!.id, p);
      // Equal but for the headings' rounding to binary angles in the states between.
      expect(once.yaw).toBeCloseTo(each.yaw, 8);
      expect(once.yaw).not.toBeCloseTo(once.prevYaw, 3);
      // prevYaw is the yaw at prev's tick, and a frame draws by f′ = (k − 1 + α) / k.
      for (const alpha of [0, 0.5, 1]) {
        const f = spreadFraction(run(0), run(6), alpha);
        expect(f).toBeCloseTo((5 + alpha) / 6, 15);
        expect(once.drawn(f), `α ${alpha}`).toBeCloseTo(once.prevYaw + (once.yaw - once.prevYaw) * f, 12);
      }
      expect(once.drawn(1)).toBeCloseTo(once.yaw, 15);
    });
  }

  it('snaps when a kickoff placement lies inside the catch-up', () => {
    const rig = new CameraRig();
    rig.snap('chase', input(-6, -3, 0, 2, 4));
    const head = run(6);
    head.phase = KICKOFF_COUNTDOWN;
    head.phaseStart = 3;
    rig.advance('chase', run(0), head, head.terriers[0]!.id, p);
    expect(rig.snaps).toBe(2);
    expect(rig.yaw).toBeCloseTo(0.02 * 6, 8);
    // The same six ticks without it step.
    const stepped = new CameraRig();
    stepped.snap('chase', input(-6, -3, 0, 2, 4));
    const play = run(6);
    play.phase = IN_PLAY;
    stepped.advance('chase', run(0), play, play.terriers[0]!.id, p);
    expect(stepped.snaps).toBe(1);
  });
});

describe("the spectators' window (L91)", () => {
  it('eases its centre toward the followed body, once a tick, with spectatorFollowSeconds; a catch-up as single steps', () => {
    const p = rigParams(false);
    const rig = new CameraRig();
    rig.snapCentre(0);
    const ticks = Math.round(p.spectatorFollowSeconds / p.tickSeconds);
    for (let k = 0; k < ticks; k++) rig.stepCentre(8, p);
    expect(8 - rig.centre).toBeCloseTo(8 * Math.exp(-1), 9);
    const once = new CameraRig();
    const each = new CameraRig();
    once.snapCentre(0);
    each.snapCentre(0);
    once.advanceCentre(0, 6, 6, p);
    for (let t = 1; t <= 6; t++) each.advanceCentre(t - 1, t, 1, p);
    expect(once.centre).toBeCloseTo(each.centre, 12);
    expect(once.prevCentre).toBe(0);
    expect(once.drawnCentre(0.5)).toBeCloseTo(once.centre / 2, 12);
  });
});
