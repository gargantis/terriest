// The gamepad (PLAN D-29, L79, L82, Q-17, C-6, C-34; M4's design,
// research/m4/DESIGN.md, §1.23, §4.1, §4.4, §4.8, §4.9): the browser's
// standard mapping, polled through navigator.getGamepads() each time a
// tick's input is sampled, on the timeline's timer, and on a timer of its
// own at gamepadPollHz while this page samples nothing, never on animation
// frames, so its input doesn't depend on the frame rate (C-6). A press is a
// rising edge between two polls, so each counts once however often the pad
// is read, which the specs' stub relies on (§1.62).
// - On a player's pitch screen with no menu open: the left stick runs, with
//   the stick's dead zone and steps, its step with half-step hysteresis
//   (src/input/anchoring.ts's stickStepOf); the bottom face button (0)
//   jumps, the left (2) pounces, the top (3) barks, the right shoulder (5)
//   switches the view, each press kept until the next read; the right
//   trigger (7) is zoomies past gamepadTriggerFraction of its travel.
// - Menus (Q-17): the d-pad (12–15) moves, Start (9) presses the focused
//   button, Back (8) opens and closes the menu, on every screen; on Results
//   the bottom face button presses too, and for a spectator the shoulders
//   (4, 5) cycle what it follows. The bottom button on the pitch only ever
//   jumps, so it never presses a focused Ready (C-34).
// A command found while the sampler reads goes to the screen once the
// sample is done, never from inside the timeline's run. Off a player's
// pitch screen, or on a hidden page, a read holds nothing (D-31), and
// release() lets go of what was pressed. inspect() is the pad's figures,
// at Inspection's top level, since the pad lives as long as the page
// (§1.40). New at M4.

import { config } from '../config';
import type { Clock } from '../ui/clock';
import { stickStepOf } from './anchoring';
import type { KeyboardScreen } from './keyboard';
import type { Device, DeviceState, GamepadInspection, UiCommand } from './source';

/** The standard mapping's buttons that M4 reads (D-29), by the W3C Gamepad's numbering, which no one
 *  tunes: what each does. */
export const PAD = {
  jump: 0, // the bottom face button; on Results, a press too
  pounce: 2, // the left face button
  bark: 3, // the top face button
  prev: 4, // the left shoulder: a spectator's follow, back
  view: 5, // the right shoulder: the view, or a spectator's follow, on
  zoomies: 7, // not a setting: the right trigger, the standard mapping's button 7
  back: 8, // the menu, opened and closed
  start: 9, // presses the focused button
  up: 12, // the d-pad
  down: 13,
  left: 14,
  right: 15,
} as const;

/** The standard mapping's buttons, the home button (16) last. */
const BUTTON_COUNT = 17;

const TURN = 2 * Math.PI;

/** A button as the pad reports it. */
export interface PadButtonLike { readonly pressed: boolean; readonly value: number }
/** A pad as navigator.getGamepads() reports one, as far as M4 reads it. */
export interface PadLike {
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly PadButtonLike[];
}

export interface GamepadOptions {
  readonly clock: Clock;
  /** Q-17's commands: the app hands them to the screen showing. */
  readonly onUi: (c: UiCommand) => void;
  /** A standard pad came or went. */
  readonly onConnected: (on: boolean) => void;
  /** What the screen is, as the keyboard reads it (src/input/keyboard.ts): a player's pitch with no menu,
   *  a spectator's, the menu, Results or another. A player's pitch, if absent. */
  readonly uiActive?: () => KeyboardScreen;
  /** This page's input is being sampled: the own timer leaves the polls to the sampler's reads while
   *  they come. Never, if absent. */
  readonly sampling?: () => boolean;
  /** The page is hidden: nothing held (D-31). */
  readonly hidden?: () => boolean;
  /** The pads: navigator.getGamepads()'s, by default. */
  readonly pads?: () => readonly (PadLike | null | undefined)[];
}

/** The pads navigator.getGamepads() reports; none where it can't, a permissions policy refusing it among
 *  them, which it reports by throwing. */
export function browserPads(nav: { getGamepads?: () => readonly (PadLike | null)[] } | undefined): readonly (PadLike | null)[] {
  try {
    return nav?.getGamepads?.() ?? [];
  } catch {
    return [];
  }
}

/** An axis as a number in [−1, 1]: 0 for one that's missing or not a number. */
const axis = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

export class Gamepad implements Device {
  readonly kind = 'gamepad' as const;
  private readonly o: GamepadOptions;
  private readonly periodMs: number;
  private connected = false;
  private polls = 0;
  private readonly counts: number[] = Array.from({ length: BUTTON_COUNT }, () => 0);
  /** Each button's state at the last poll: a press is a rising edge from it. */
  private prev: boolean[] = Array.from({ length: BUTTON_COUNT }, () => false);
  private direction: number | null = null;
  private step: number | null = null;
  private zoomies = false;
  private jump = false;
  private pounce = false;
  private bark = false;
  private view = false;
  /** The poll time of the first change since the last read. */
  private changedAt: number | null = null;
  private lastReadAt = -Infinity;
  private stopOwn: (() => void) | null = null;
  /** Commands found while the sampler read, for the screen once its sample is done. */
  private readonly queue: UiCommand[] = [];
  private cancelFlush: (() => void) | null = null;

  constructor(o: GamepadOptions) {
    this.o = o;
    this.periodMs = 1000 / config.gamepadPollHz;
  }

  /** The sampler's call (D-29): a poll, then what's held now and what was pressed and first changed since
   *  the last read. */
  read(): DeviceState {
    const now = this.o.clock.now();
    this.lastReadAt = now;
    this.poll(now, true);
    const state: DeviceState = {
      direction: this.direction, stickStep: this.step, zoomies: this.zoomies,
      jump: this.jump, pounce: this.pounce, bark: this.bark, view: this.view, changedAtMs: this.changedAt,
    };
    this.jump = this.pounce = this.bark = this.view = false;
    this.changedAt = null;
    return state;
  }

  /** The poll of its own, every 1 / gamepadPollHz s while on: it polls while this page samples no input
   *  (no pitch, a spectator, the menu, Practice paused), or while a sampler that should be reading hasn't
   *  for two periods, and leaves the polls to the sampler's reads otherwise (§4.4). */
  setOwnTimer(on: boolean): void {
    if (on === (this.stopOwn !== null)) return;
    if (on) {
      this.stopOwn = this.o.clock.every(this.periodMs, () => this.ownPoll());
    } else {
      this.stopOwn?.();
      this.stopOwn = null;
    }
  }

  /** Nothing pressed or held until the next poll shows it again (§4.8). */
  release(): void {
    this.jump = this.pounce = this.bark = this.view = false;
    this.direction = this.step = null;
    this.zoomies = false;
    this.changedAt = null;
  }

  dispose(): void {
    this.setOwnTimer(false);
    this.cancelFlush?.();
    this.cancelFlush = null;
    this.queue.length = 0;
    this.release();
  }

  inspect(): GamepadInspection {
    return { connected: this.connected, polls: this.polls, presses: Object.fromEntries(this.counts.map((n, i) => [String(i), n])) };
  }

  private ownPoll(): void {
    const now = this.o.clock.now();
    if ((this.o.sampling?.() ?? false) && now - this.lastReadAt < 2 * this.periodMs) return;
    this.poll(now, false);
  }

  /** One look at the pad: its rising edges, the commands they make, and what it holds for a player. */
  private poll(now: number, sampling: boolean): void {
    this.polls++;
    const pad = this.padNow();
    const on = pad !== null;
    if (on !== this.connected) {
      this.connected = on;
      this.o.onConnected(on);
    }
    const screen = this.o.uiActive?.() ?? 'pitch';
    const hidden = this.o.hidden?.() ?? false;
    const pressed = Array.from({ length: BUTTON_COUNT }, (_, i) => pad?.buttons[i]?.pressed === true);
    for (let i = 0; i < BUTTON_COUNT; i++) {
      if (pressed[i] && !this.prev[i]) {
        this.counts[i]!++;
        if (!hidden) this.edge(i, now, screen, sampling);
      }
    }
    this.prev = pressed;
    let direction: number | null = null;
    let step: number | null = null;
    let zoomies = false;
    if (pad !== null && screen === 'pitch' && !hidden) {
      const x = axis(pad.axes[0]);
      const y = axis(pad.axes[1]);
      // Screen y down, as the stick's axes report it: counter-clockwise from screen up.
      if (Math.hypot(x, y) > config.stickDeadZoneFraction) {
        const a = Math.atan2(-x, -y);
        direction = a < 0 ? a + TURN : Math.abs(a); // in [0, 2π), straight up 0, never −0
        step = stickStepOf(direction, this.step, config.stickSteps, config.stickHysteresisSteps);
      }
      zoomies = (pad.buttons[PAD.zoomies]?.value ?? 0) > config.gamepadTriggerFraction;
    }
    if (step !== this.step || zoomies !== this.zoomies) this.changedAt ??= now;
    this.direction = direction;
    this.step = step;
    this.zoomies = zoomies;
  }

  /** A button's rising edge: a play press on a player's pitch, and the command it makes on this screen. */
  private edge(i: number, now: number, screen: KeyboardScreen, sampling: boolean): void {
    if (screen === 'pitch') {
      if (i === PAD.jump) this.jump = true;
      else if (i === PAD.pounce) this.pounce = true;
      else if (i === PAD.bark) this.bark = true;
      else if (i === PAD.view) this.view = true;
      if (i === PAD.jump || i === PAD.pounce || i === PAD.bark || i === PAD.view) this.changedAt ??= now;
    }
    const kind = command(i, screen);
    if (kind === null) return;
    const c: UiCommand = { kind, pressedAt: now, source: 'gamepad', repeat: false };
    if (!sampling) {
      this.o.onUi(c);
      return;
    }
    this.queue.push(c);
    this.cancelFlush ??= this.o.clock.after(0, () => this.flush());
  }

  private flush(): void {
    this.cancelFlush = null;
    for (const c of this.queue.splice(0)) this.o.onUi(c);
  }

  /** The first connected pad with the standard mapping, the only one whose buttons M4 knows. */
  private padNow(): PadLike | null {
    const pads = this.o.pads?.() ?? browserPads(globalThis.navigator);
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') return p;
    return null;
  }
}

/** The command a button's press makes on a screen (Q-17), or null. */
function command(i: number, screen: KeyboardScreen): UiCommand['kind'] | null {
  switch (i) {
    case PAD.up: return 'up';
    case PAD.down: return 'down';
    case PAD.left: return 'left';
    case PAD.right: return 'right';
    case PAD.start: return 'press';
    case PAD.back: return 'menu';
    case PAD.jump: return screen === 'results' ? 'press' : null;
    case PAD.prev: return screen === 'spectator' ? 'prev' : null;
    case PAD.view: return screen === 'spectator' ? 'next' : null;
    default: return null;
  }
}
