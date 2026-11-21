// Anchored steering (PLAN D-7, D-29, Q-19, C-24, L74, L75; M4's design,
// research/m4/DESIGN.md, §1.24, §4.5): what a held direction sends, as A.2's
// step and frame.
// - Ball view sends the ball frame (A.2's frame 1) with the screen step:
//   forward, up the screen, is the line to the ball, so W runs at it, S
//   away, and A and D circle it (L74). The camera's yaw doesn't enter it.
// - Chase view sends the pitch frame (frame 0), read from the screen with
//   the camera's yaw, step = round((yaw + θ) / (2π / steps)) mod steps,
//   when the direction starts from neutral, when the device's step has
//   moved chaseRereadDegrees or more from the step last read, the short way
//   round, and after viewChanged. A smaller move turns the kept direction by
//   the same steps, so a stick's small corrections turn the terrier with the
//   stick, without the camera's swing (C-24). A key's directions are 45°
//   apart, so every change of keys reads the screen again.
// - A stick's angle is quantised with half-step hysteresis (D-10, L342): the
//   nearest step, kept while the angle stays within stickHysteresisSteps
//   past its edges, so a wobble doesn't change the input and prediction
//   holds.
// Angles are screen-relative radians counter-clockwise from screen up, as
// source.ts's DeviceState gives them; the yaw is the rig's, counter-
// clockwise from +x, the way the view looks (src/render/camera-rig.ts), so
// screen up is the yaw on the pitch. Steps are A.2's, which a configuration
// check holds stickSteps to. Vehicle-style steering's nose frame (D-7)
// isn't offered: anchor() asserts config.steering is anchored. New at M4.
// Three-free.

import { config } from '../config';
import { FRAME_BALL, FRAME_PITCH } from '../core/sim/input';
import type { ViewMode } from '../render/frame';
import type { DeviceState } from './source';

const TURN = 2 * Math.PI;

/** Chase view's last read (§4.5). */
export interface Anchor {
  /** The pitch-frame step it sent from the last read; null: neutral at the last sample, so the next
   *  direction reads the screen. */
  readStep: number | null;
  /** The device's own step at that read. */
  readDeviceStep: number;
  /** viewChanged: read again at the next sample (D-29). */
  reread: boolean;
}

export function newAnchor(): Anchor {
  return { readStep: null, readDeviceStep: 0, reread: false };
}

/** n mod m, in [0, m). */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** How many steps apart two steps are, the short way round. */
function stepsApart(a: number, b: number, steps: number): number {
  const d = mod(a - b, steps);
  return Math.min(d, steps - d);
}

/** A key direction's exact step: its angle's nearest step, counter-clockwise from screen up. */
export function screenStep(angle: number, steps: number): number {
  return mod(Math.round(angle / (TURN / steps)), steps);
}

/** A stick angle's step with half-step hysteresis (D-10): the nearest step, but prev is kept while the
 *  angle stays within hysteresisSteps past prev's edges, which are half a step from its middle. */
export function stickStepOf(angle: number, prev: number | null, steps: number, hysteresisSteps: number): number {
  const at = angle / (TURN / steps);
  const nearest = mod(Math.round(at), steps);
  if (prev === null) return nearest;
  const off = Math.abs(mod(at - prev + steps / 2, steps) - steps / 2);
  return off <= 0.5 + hysteresisSteps ? prev : nearest;
}

/** A.2's step and frame for a held direction (D-29, Q-19, C-24): ball view sends the ball frame with the
 *  screen step; chase view the pitch frame, reading the yaw from neutral, at a move of rereadSteps or
 *  more from the step last read, or after viewChanged; a smaller move turns the kept direction. Null,
 *  with the anchor cleared, when no direction is held. A device's step is its stick's, or its key
 *  direction's exact one. */
export function anchor(
  view: ViewMode, d: Pick<DeviceState, 'direction' | 'stickStep'>, yaw: number, a: Anchor, steps: number, rereadSteps: number,
): { step: number; frame: number } | null {
  if (config.steering !== 'anchored') throw new Error(`the controls send anchored steering only, not ${config.steering} (D-7, D-29)`);
  if (d.direction === null) {
    a.readStep = null;
    a.reread = false;
    return null;
  }
  const deviceStep = d.stickStep ?? screenStep(d.direction, steps);
  if (view === 'ball') {
    // Nothing kept for chase view: switching to it reads the screen.
    a.readStep = null;
    a.reread = false;
    return { step: deviceStep, frame: FRAME_BALL };
  }
  if (a.readStep === null || a.reread || stepsApart(deviceStep, a.readDeviceStep, steps) >= rereadSteps) {
    a.readStep = screenStep(yaw + d.direction, steps);
    a.readDeviceStep = deviceStep;
    a.reread = false;
    return { step: a.readStep, frame: FRAME_PITCH };
  }
  return { step: mod(a.readStep + deviceStep - a.readDeviceStep, steps), frame: FRAME_PITCH };
}
