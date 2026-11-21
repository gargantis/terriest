import { describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { FRAME_BALL, FRAME_PITCH } from '../core/sim/input';
import { anchor, newAnchor, screenStep, stickStepOf } from './anchoring';

// Anchored steering (PLAN D-29, Q-19, C-24, L74, L75; M4's design §1.24,
// §4.5): ball view's steps and the yaw left out of them; chase view reading
// the screen only from neutral, at 45° and after a switch of view, and a
// smaller move turning the kept direction; the stick's hysteresis. §3.6's
// sweep through the rig and the real simulation is src/input/sweep.test.ts.

const STEPS = config.stickSteps;
const REREAD = (config.chaseRereadDegrees * STEPS) / 360;
const HYSTERESIS = config.stickHysteresisSteps;
const UNIT = (2 * Math.PI) / STEPS;
/** A key direction, k eighths of a turn counter-clockwise from screen up. */
const key = (k: number): { direction: number; stickStep: null } => ({ direction: (k * Math.PI) / 4, stickStep: null });
/** A stick at `steps` steps from screen up, its step quantised as the device would. */
const stick = (steps: number, prev: number | null = null): { direction: number; stickStep: number } => ({
  direction: steps * UNIT, stickStep: stickStepOf(steps * UNIT, prev, STEPS, HYSTERESIS),
});
const NONE = { direction: null, stickStep: null };
/** The pitch-frame step chase view reads for a screen angle under a yaw. */
const read = (yaw: number, angle: number): number => (((Math.round((yaw + angle) / UNIT)) % STEPS) + STEPS) % STEPS;

describe("a key direction's step", () => {
  it('is exact for each of the eight, counter-clockwise from screen up: W 0, A 8, S 16, D 24', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((k) => screenStep((k * Math.PI) / 4, STEPS))).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(screenStep(-Math.PI / 2, STEPS)).toBe(24);
    expect(screenStep(2 * Math.PI, STEPS)).toBe(0);
    expect(screenStep(0.49 * UNIT, STEPS)).toBe(0);
    expect(screenStep(0.51 * UNIT, STEPS)).toBe(1);
  });
});

describe("the stick's steps (D-10, L342)", () => {
  it('starts at the nearest step', () => {
    expect(stickStepOf(0.3 * UNIT, null, STEPS, HYSTERESIS)).toBe(0);
    expect(stickStepOf(5.6 * UNIT, null, STEPS, HYSTERESIS)).toBe(6);
    expect(stickStepOf(-0.6 * UNIT, null, STEPS, HYSTERESIS)).toBe(31);
  });

  it('keeps a step while the angle stays within half a step past its edges, so a wobble changes nothing', () => {
    let step: number | null = null;
    const seen: number[] = [];
    // Settled on 5, then wobbling across its edges, 4.5 and 5.5, by up to half a step past them.
    for (const at of [5.2, 5.6, 4.4, 5.95, 4.05, 5.9, 4.1]) {
      step = stickStepOf(at * UNIT, step, STEPS, HYSTERESIS);
      seen.push(step);
    }
    expect(seen).toEqual([5, 5, 5, 5, 5, 5, 5]);
    // Past that, the nearest step, which holds the same way from there.
    expect(stickStepOf(6.05 * UNIT, 5, STEPS, HYSTERESIS)).toBe(6);
    expect(stickStepOf(5.05 * UNIT, 6, STEPS, HYSTERESIS)).toBe(6);
    expect(stickStepOf(4.95 * UNIT, 6, STEPS, HYSTERESIS)).toBe(5);
    // With no hysteresis, the nearest step at once.
    expect(stickStepOf(5.6 * UNIT, 5, STEPS, 0)).toBe(6);
  });

  it('holds across the wrap from 31 to 0', () => {
    expect(stickStepOf(-0.1 * UNIT, 31, STEPS, HYSTERESIS)).toBe(31);
    expect(stickStepOf(0.05 * UNIT, 31, STEPS, HYSTERESIS)).toBe(0);
    expect(stickStepOf(-0.95 * UNIT, 0, STEPS, HYSTERESIS)).toBe(0);
    expect(stickStepOf(-1.05 * UNIT, 0, STEPS, HYSTERESIS)).toBe(31);
  });
});

describe('ball view (L74)', () => {
  it('sends the ball frame with the screen step: W at the ball, S away, A and D round it', () => {
    const a = newAnchor();
    const sent = [0, 2, 4, 6, 1, 3, 5, 7].map((k) => anchor('ball', key(k), 0.3, a, STEPS, REREAD));
    expect(sent).toEqual([0, 8, 16, 24, 4, 12, 20, 28].map((step) => ({ step, frame: FRAME_BALL })));
  });

  it("leaves the camera's yaw out of it, and takes a stick's step as the device quantised it", () => {
    for (const yaw of [0, 1.3, -2.9, 5.5]) expect(anchor('ball', key(2), yaw, newAnchor(), STEPS, REREAD)).toEqual({ step: 8, frame: FRAME_BALL });
    // The stick's step, 5, kept by its hysteresis though the angle is nearer 6.
    expect(anchor('ball', { direction: 5.9 * UNIT, stickStep: 5 }, 0, newAnchor(), STEPS, REREAD)).toEqual({ step: 5, frame: FRAME_BALL });
  });

  it('sends nothing with no direction held', () => {
    expect(anchor('ball', NONE, 0, newAnchor(), STEPS, REREAD)).toBeNull();
  });
});

describe('chase view (Q-19, C-24)', () => {
  it('reads the screen from neutral: the yaw plus the screen angle, on the pitch', () => {
    const a = newAnchor();
    expect(anchor('chase', key(0), 0.3, a, STEPS, REREAD)).toEqual({ step: read(0.3, 0), frame: FRAME_PITCH });
    expect(read(0.3, 0)).toBe(2);
    // Neutral, then A under another yaw: read again.
    expect(anchor('chase', NONE, 1, a, STEPS, REREAD)).toBeNull();
    expect(a.readStep).toBeNull();
    expect(anchor('chase', key(2), 1, a, STEPS, REREAD)).toEqual({ step: read(1, Math.PI / 2), frame: FRAME_PITCH });
    expect(read(1, Math.PI / 2)).toBe(13);
    // A stick let go and pushed again a step from where it was: read from neutral, not turned.
    const b = newAnchor();
    expect(anchor('chase', stick(0), 0.3, b, STEPS, REREAD)?.step).toBe(2);
    expect(anchor('chase', NONE, 1, b, STEPS, REREAD)).toBeNull();
    expect(anchor('chase', stick(1), 1, b, STEPS, REREAD)?.step).toBe(read(1, UNIT));
    expect(read(1, UNIT)).toBe(6);
  });

  it('keeps a held direction on the pitch while the camera swings, so the input repeats (L87, L342)', () => {
    const a = newAnchor();
    const sent = [0.3, 0.6, 1.2, 2.0, -1.0].map((yaw) => anchor('chase', key(0), yaw, a, STEPS, REREAD));
    expect(sent).toEqual(Array(5).fill({ step: 2, frame: FRAME_PITCH }));
  });

  it("reads again at every change of keys, 45° apart", () => {
    const a = newAnchor();
    expect(anchor('chase', key(0), 0.3, a, STEPS, REREAD)?.step).toBe(2);
    // W and A, under a yaw that has moved: 4 steps from the read, so the screen is read again.
    expect(anchor('chase', key(1), 1, a, STEPS, REREAD)?.step).toBe(read(1, Math.PI / 4));
    expect(read(1, Math.PI / 4)).toBe(9);
    expect(anchor('chase', key(2), -0.5, a, STEPS, REREAD)?.step).toBe(read(-0.5, Math.PI / 2));
  });

  it('turns the kept direction by the same steps for a smaller move of the stick, and reads again from 45°', () => {
    const a = newAnchor();
    expect(anchor('chase', stick(0), 0.3, a, STEPS, REREAD)?.step).toBe(2);
    // The camera swings to 1 rad; the stick moves 3 steps: the kept direction turns 3, the yaw unread.
    expect(anchor('chase', stick(3), 1, a, STEPS, REREAD)?.step).toBe(5);
    expect(read(1, 3 * UNIT)).toBe(8);
    // 4 steps from the read: the screen is read again, with the yaw now.
    expect(anchor('chase', stick(4), 1, a, STEPS, REREAD)?.step).toBe(read(1, 4 * UNIT));
    expect(read(1, 4 * UNIT)).toBe(9);
    // Back 3 from that read, under yet another yaw: turned, not read.
    expect(anchor('chase', stick(1), 2.5, a, STEPS, REREAD)?.step).toBe(6);
  });

  it('measures the move the short way round, across 31 and 0', () => {
    const a = newAnchor();
    expect(anchor('chase', stick(30), 0, a, STEPS, REREAD)?.step).toBe(30);
    // 30 to 1 is 3 steps through 0: turned.
    expect(anchor('chase', stick(1), 1, a, STEPS, REREAD)?.step).toBe(1);
    // 30 to 2 is 4: read.
    expect(anchor('chase', stick(2), 1, a, STEPS, REREAD)?.step).toBe(read(1, 2 * UNIT));
  });

  it('reads again after a switch of view (D-29)', () => {
    const a = newAnchor();
    expect(anchor('chase', stick(0), 0.3, a, STEPS, REREAD)?.step).toBe(2);
    a.reread = true;
    expect(anchor('chase', stick(0), 1, a, STEPS, REREAD)?.step).toBe(read(1, 0));
    expect(a.reread).toBe(false);
    // Then kept again.
    expect(anchor('chase', stick(0), 2, a, STEPS, REREAD)?.step).toBe(read(1, 0));
  });

  it('reads the screen when ball view hands over to it, a held direction and all', () => {
    const a = newAnchor();
    expect(anchor('chase', key(0), 0.3, a, STEPS, REREAD)?.step).toBe(2);
    expect(anchor('ball', key(0), 0.3, a, STEPS, REREAD)).toEqual({ step: 0, frame: FRAME_BALL });
    expect(anchor('chase', key(0), 1, a, STEPS, REREAD)).toEqual({ step: read(1, 0), frame: FRAME_PITCH });
  });
});

describe('the steering the controls send (D-7)', () => {
  it("refuses a configuration whose steering isn't anchored: the nose frame isn't offered", async () => {
    for (const steering of ['vehicle', 'screen-relative']) {
      vi.resetModules();
      vi.doMock('../config', async (original) => {
        const o = await original<typeof import('../config')>();
        return { ...o, config: { ...o.config, steering } };
      });
      const m = await import('./anchoring');
      for (const d of [key(0), NONE]) expect(() => m.anchor('ball', d, 0, m.newAnchor(), STEPS, REREAD), steering).toThrow(/anchored/);
      vi.doUnmock('../config');
    }
    vi.resetModules();
    const m = await import('./anchoring');
    expect(m.anchor('ball', key(0), 0, m.newAnchor(), STEPS, REREAD)).toEqual({ step: 0, frame: FRAME_BALL });
  });
});
