// The page's devices (M4's design, research/m4/DESIGN.md, §1.63, §4,
// §12's extension points; PLAN D-29, D-31): made once at start-up, so a
// device outlives every screen, and lent to each pitch screen's controls
// (src/input/controls.ts):
// - the keyboard (src/input/keyboard.ts), the page's one keydown listener,
//   which hands Q-17's keys to the app as UI commands and reads the play
//   keys only while the app says a player's pitch screen is up with no menu
//   open;
// - touch (src/input/touch.ts), whose control layer shows from the page's
//   first touch, on a player's pitch, the stick on the side Settings'
//   mirrored layout says, and which the touch layer puts over each pitch
//   (src/ui/layers/devices.ts);
// - the gamepad (src/input/gamepad.ts), polled by the sampler's reads, and
//   on its own timer while sampling() says nothing reads it, so its
//   presses work on every screen, Results and Home included; gamepad() is
//   its figures for the hook.
// Touch and the pad let go on the window's blur and on a hidden page, as the
// keyboard does by itself (D-29, D-31). used() is the controls' onUsed: a
// control used on a kind of device on a pitch screen, told to the host and
// to each layer watching, the control hints' (§4.7). The page's devices are
// also where the devices' layers over each pitch find them
// (currentDevices()), since a layer is made from the pitch's host alone.
// New at M4: the keyboard alone by the slice (1c), touch and the gamepad by
// phase 2's devices builder.

import { config } from '../config';
import { browserPads, Gamepad } from '../input/gamepad';
import { Keyboard, type KeyboardScreen } from '../input/keyboard';
import type { Control, Device, GamepadInspection, InputKind, UiCommand } from '../input/source';
import { TouchControls } from '../input/touch';
import type { Clock } from './clock';

/** What the devices need of the app. */
export interface DeviceHost {
  readonly clock: Clock;
  /** Settings' mirrored touch layout. */
  mirrored(): boolean;
  /** This page's input is being sampled: a player on a running pitch screen, no menu, not paused. */
  sampling(): boolean;
  /** Q-17's commands: the app hands them to the screen showing. */
  ui(c: UiCommand): void;
  /** A control was used on a kind of device on a pitch screen: the hints. */
  used(k: InputKind, c: Control): void;
  /** What the screen is, for the keys and the pad (src/input/keyboard.ts's KeyboardScreen). */
  uiActive(): KeyboardScreen;
}

export interface PageDevices {
  /** Every device, for each pitch screen's controls to add. */
  list(): readonly Device[];
  /** The page's pad, for the hook. */
  gamepad(): GamepadInspection | null;
  /** The controls' onUsed (§1.25): a control used on a kind of device, which the hints show (§4.7). */
  used?(k: InputKind, c: Control): void;
  dispose(): void;
}

/** What the devices' layers over each pitch read of the page's devices. */
export interface LayerDevices {
  /** The control layer, which the touch layer puts over each pitch. */
  readonly touch: TouchControls;
  /** fn on each control the controls report used; returns its removal. */
  onUsed(fn: (k: InputKind, c: Control) => void): () => void;
}

/** The page's devices made last and not yet disposed. */
let current: LayerDevices | null = null;

/** The page's devices, once pageDevices has made them: where each pitch's devices' layers find them. */
export function currentDevices(): LayerDevices | null {
  return current;
}

/** The page's devices on `target`, its window: the keyboard, touch and the gamepad. */
export function pageDevices(host: DeviceHost, target: Window = window): PageDevices & LayerDevices & { used(k: InputKind, c: Control): void } {
  const doc = target.document;
  const keyboard = new Keyboard(target, (c) => host.ui(c), () => host.uiActive());
  const touch = new TouchControls(doc.documentElement, {
    mirrored: () => host.mirrored(),
    edgeMarginPx: config.touchEdgeMarginCssPx,
    // The touch layer shows from it; the hints come with the controls' reads, as every kind's do.
    onFirstUse: () => {},
    active: () => host.uiActive() === 'pitch',
  });
  const pad = new Gamepad({
    clock: host.clock,
    onUi: (c) => host.ui(c),
    onConnected: () => {},
    uiActive: () => host.uiActive(),
    sampling: () => host.sampling(),
    hidden: () => doc.visibilityState === 'hidden',
    pads: () => browserPads(target.navigator),
  });
  pad.setOwnTimer(true);
  const letGo = (): void => {
    touch.release();
    pad.release();
  };
  // The window's own blur: an element's doesn't bubble to it.
  const blur = (e: Event): void => {
    if (e.target === target) letGo();
  };
  const visibility = (): void => {
    if (doc.visibilityState === 'hidden') letGo();
  };
  target.addEventListener('blur', blur);
  doc.addEventListener('visibilitychange', visibility);
  const watchers: ((k: InputKind, c: Control) => void)[] = [];
  const devices: readonly Device[] = [keyboard, touch, pad];
  const self: PageDevices & LayerDevices & { used(k: InputKind, c: Control): void } = {
    list: () => devices,
    gamepad: () => pad.inspect(),
    touch,
    used: (k, c) => {
      host.used(k, c);
      for (const fn of [...watchers]) fn(k, c);
    },
    onUsed: (fn) => {
      watchers.push(fn);
      return () => {
        const k = watchers.indexOf(fn);
        if (k >= 0) watchers.splice(k, 1);
      };
    },
    dispose: () => {
      target.removeEventListener('blur', blur);
      doc.removeEventListener('visibilitychange', visibility);
      keyboard.dispose();
      touch.dispose();
      pad.dispose();
      watchers.length = 0;
      if (current === self) current = null;
    },
  };
  current = self;
  return self;
}
