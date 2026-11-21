// The page's devices (M4's design, research/m4/DESIGN.md, §1.63, §4,
// §12's extension points; PLAN D-29): made once at start-up, so a device
// outlives every screen, and lent to each pitch screen's controls
// (src/input/controls.ts). Phase 1's is the keyboard alone
// (src/input/keyboard.ts), the page's one keydown listener: it hands Q-17's
// keys to the app as UI commands, and reads the play keys only while the
// app says a player's pitch screen is up with no menu open. Phase 2's
// devices builder adds touch and the gamepad, whose own timer runs while
// nothing samples this page's input (sampling()), and whose first use
// reports to the hints (used()). New at M4, by the slice (1c).

import { Keyboard, type KeyboardScreen } from '../input/keyboard';
import type { Control, Device, GamepadInspection, InputKind, UiCommand } from '../input/source';
import type { Clock } from './clock';

/** What the devices need of the app. */
export interface DeviceHost {
  readonly clock: Clock;
  /** Settings' mirrored touch layout (phase 2). */
  mirrored(): boolean;
  /** This page's input is being sampled: a player on a running pitch screen, no menu, not paused. */
  sampling(): boolean;
  /** Q-17's commands: the app hands them to the screen showing. */
  ui(c: UiCommand): void;
  /** A control was first used on a kind of device: the hints (phase 2). */
  used(k: InputKind, c: Control): void;
  /** What the screen is, for the keys (src/input/keyboard.ts's KeyboardScreen). */
  uiActive(): KeyboardScreen;
}

export interface PageDevices {
  /** Every device, for each pitch screen's controls to add. */
  list(): readonly Device[];
  /** The page's pad, for the hook: null in phase 1, which has none. */
  gamepad(): GamepadInspection | null;
  dispose(): void;
}

/** The page's devices on `target`, its window: in phase 1, the keyboard alone. */
export function pageDevices(host: DeviceHost, target: Window = window): PageDevices {
  const keyboard = new Keyboard(target, (c) => host.ui(c), () => host.uiActive());
  const devices: readonly Device[] = [keyboard];
  return {
    list: () => devices,
    gamepad: () => null,
    dispose: () => keyboard.dispose(),
  };
}
