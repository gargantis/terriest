import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { angleDiff, TURN } from '../core/sim/math';
import { defaultParams } from '../core/sim/params';
import { place, placeBall, placedMatch } from '../core/sim/scenes';
import { cloneState } from '../core/sim/state';
import { makeSim, step } from '../core/sim/step';
import { CameraRig, rigInput, rigParams } from '../render/camera-rig';
import { stickStepOf } from './anchoring';
import { Controls } from './controls';
import type { Device, DeviceState } from './source';

// Chase view's re-read, swept (PLAN Q-19, C-24, D-28, D-29, §16's
// anchoring; M4's design §3.6, §4.5, M4-Q13): a stick swept 90° in 0.5 s,
// and in 1 s, through the controls and their anchoring, the camera rig
// stepped once a tick on the drawn head, and the real simulation, each
// input acting d ticks after its sample as the timeline has it. Each re-read
// at 45° takes the yaw as it is mid-swing, so the terrier turns further
// than the stick did: Q-19's model (research/audit/REPORT.md §9) has about
// 135° and 169°, and 124° and 135° with the calmer camera. The stick ends a
// third of a step past screen left, as a real stick lands either side of
// it: exactly there, 8 steps, the hysteresis keeps step 7, the second
// re-read never comes, and the terrier turns the stick's own 90°. Each turn
// is held within ±10% of the model, and pinned to the tenth of a degree
// measured here, so a rig or anchoring change that moves it sets the pin
// again on purpose, as src/core/sim/push.test.ts holds and pins its times.

const P = defaultParams;
const TPS = config.ticksPerSecond;
const UNIT = (2 * Math.PI) / config.stickSteps;
/** Screen left, and a third of a step past it. */
const LEFT = Math.PI / 2 + UNIT / 3;

/** A stick held at a screen angle, radians counter-clockwise from screen up, stepped with the hysteresis the
 *  devices use (D-10). */
class Stick implements Device {
  readonly kind = 'gamepad' as const;
  angle = 0;
  private stepNow: number | null = null;

  read(): DeviceState {
    this.stepNow = stickStepOf(this.angle, this.stepNow, config.stickSteps, config.stickHysteresisSteps);
    return { direction: this.angle, stickStep: this.stepNow, zoomies: false, jump: false, pounce: false, bark: false, view: false, changedAtMs: null };
  }

  release(): void {}
  dispose(): void {}
}

/** Degrees the terrier turned from the sweep's start until it and the camera have settled: a second
 *  straight on, the stick swept `to` radians to the left over `seconds`, then held there for 4 s. */
function sweptTurn(seconds: number, calmer: boolean, to = LEFT): number {
  const s = placedMatch(P, 1, { members: [1, 0] });
  place(P, s, 0, -12, -8);
  const T = s.terriers[0]!;
  T.heading = 0; // along +x, the stick's screen up once the camera is behind
  placeBall(P, s, 15, 10); // out of the way
  const sim = makeSim(P, 1);
  const rig = new CameraRig();
  rig.snap('chase', rigInput(s, T));
  const stick = new Stick();
  const controls = new Controls({ view: () => 'chase', yaw: () => rig.yaw });
  controls.add(stick);
  const p = rigParams(calmer);
  const d = config.inputDelayTicks;
  const hold = TPS;
  const sweep = Math.round(seconds * TPS);
  const end = hold + sweep + 4 * TPS;
  // The inputs sampled for each tick, the first d at the start, as a page's first samples are.
  const sent = new Map<number, number>();
  for (let t = 1; t <= d; t++) sent.set(s.tick + t, controls.sample(s, s.tick, s.tick + t));
  let turned = 0;
  let atSweep = 0;
  let last = T.heading;
  const start = s.tick;
  for (let k = 0; k < end; k++) {
    if (k === hold) atSweep = turned;
    stick.angle = k < hold ? 0 : k < hold + sweep ? ((k - hold) / sweep) * to : to;
    const n = s.tick;
    sent.set(n + d, controls.sample(s, n, n + d));
    const prev = cloneState(s);
    step(sim, s, [{ id: T.id, input: sent.get(n + 1)!, events: 0 }]);
    rig.advance('chase', prev, s, T.id, p);
    const h = s.terriers[0]!.heading;
    turned += angleDiff(last, h);
    last = h;
    expect(s.tick).toBe(start + k + 1);
  }
  return ((turned - atSweep) / TURN) * 360;
}

/** Q-19's model: the turn for each sweep and camera setting, degrees. */
const MODEL: readonly { readonly seconds: number; readonly calmer: boolean; readonly model: number; readonly pinned: string }[] = [
  { seconds: 0.5, calmer: false, model: 135, pinned: '135.0' },
  { seconds: 1, calmer: false, model: 169, pinned: '157.5' },
  { seconds: 0.5, calmer: true, model: 124, pinned: '112.5' },
  { seconds: 1, calmer: true, model: 135, pinned: '135.0' },
];

describe("chase view's re-read, swept (Q-19, §3.6)", () => {
  for (const c of MODEL) {
    const camera = c.calmer ? 'the calmer camera' : 'the swing';
    it(`turns the terrier ${c.model}° ± 10% for a 90° sweep in ${c.seconds} s under ${camera}, pinned at ${c.pinned}°`, () => {
      const turned = sweptTurn(c.seconds, c.calmer);
      const said = `${turned.toFixed(1)}° for a 90° sweep in ${c.seconds} s under ${camera}`;
      expect(turned, said).toBeGreaterThanOrEqual(c.model * 0.9);
      expect(turned, said).toBeLessThanOrEqual(c.model * 1.1);
      expect(turned.toFixed(1), said).toBe(c.pinned);
    });
  }

  it('turns the terrier by exactly the stick\'s steps for a sweep under 45°, which never re-reads, under either camera (C-24)', () => {
    // 3.2 steps: past step 3's hysteresis, short of the 4-step re-read, so the kept direction turns 3 steps.
    expect(3.2).toBeLessThan((config.chaseRereadDegrees / 360) * config.stickSteps);
    for (const calmer of [false, true]) {
      for (const seconds of [0.5, 1]) expect(sweptTurn(seconds, calmer, 3.2 * UNIT)).toBeCloseTo((3 * 360) / config.stickSteps, 6);
    }
  });
});
