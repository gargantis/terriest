// The input's types (M4's design, research/m4/DESIGN.md, §1.20, §4; PLAN
// §11, A.2, D-10, D-29): a device, read once a sampled tick on the
// timeline's timer, never on an animation frame; Q-17's commands for the
// menus; what the controls report to the hook; and what the screens need
// of src/input/controls.ts's Controls, which merges the devices into A.2's
// u16 for each sent tick. Types only.

import type { MatchState } from '../core/sim/index';
import type { ViewMode } from '../render/frame';

export type InputKind = 'keyboard' | 'touch' | 'gamepad';
export type Control = 'run' | 'zoomies' | 'jump' | 'pounce' | 'bark' | 'view';

/** One device's state, read once a sampled tick. */
export interface DeviceState {
  /** Screen-relative radians, counter-clockwise from screen up; null: none. */
  readonly direction: number | null;
  /** A stick's step, 0 to 31, with half-step hysteresis; null for keys. */
  readonly stickStep: number | null;
  readonly zoomies: boolean;
  /** Pressed since the last read. */
  readonly jump: boolean; readonly pounce: boolean; readonly bark: boolean; readonly view: boolean;
  /** The event time of the change this read first shows, for the key-to-screen figure. */
  readonly changedAtMs: number | null;
}

export interface Device {
  readonly kind: InputKind;
  /** The gamepad polls here, on the timeline's timer (D-29). */
  read(): DeviceState;
  /** Blur, a hidden page, the menu, lost graphics: nothing stays held. */
  release(): void;
  dispose(): void;
}

/** Q-17's keys and buttons outside the play set. */
export type UiCommand = {
  readonly kind: 'up' | 'down' | 'left' | 'right' | 'press' | 'menu' | 'next' | 'prev';
  readonly pressedAt: number;
  readonly source: InputKind;
  readonly repeat: boolean;
};

export interface ControlsInspection {
  readonly devices: readonly InputKind[]; readonly view: ViewMode | null;
  /** The last u16 sampled. */
  readonly lastInput: number | null;
  /** The last onControl's (D-10). */
  readonly base: number | null;
  /** The first u16 sampled after it. */
  readonly firstAfterBase: number | null;
  readonly presses: { readonly jump: number; readonly pounce: number; readonly bark: number; readonly view: number };
  /** Within the bark gap (L327). */
  readonly barksDropped: number;
  /** Key to screen: ms from each event that changed the input to the first frame drawn at or past the tick
   *  that input is for, over this pitch screen. */
  readonly latencyMs: { readonly count: number; readonly p50: number | null; readonly p95: number | null };
  /** Each held direction's span as sampled: its step and frame, and the first and last tick it went into,
   *  which the specs check against their validated latitude (M4's design §9.1). */
  readonly holds: readonly { readonly step: number; readonly frame: number; readonly from: number; readonly to: number | null }[];
}

/** The pad's own figures, at Inspection's top level, since the pad lives as long as the page. */
export interface GamepadInspection { readonly connected: boolean; readonly polls: number; readonly presses: Readonly<Record<string, number>> }

/** What the screens need of src/input/controls.ts's Controls, which implements it. */
export interface ControlsApi {
  add(d: Device): void; remove(d: Device): void;
  /** The u16 for tick `tick`, the one being sent: sampled once a sent tick, on the timeline's timer. */
  sample(head: Readonly<MatchState>, headTick: number, tick: number): number;
  /** The session's onControl (D-10): the counters start from the terrier's stored input. */
  rebase(base: number): void;
  release(): void;
  /** Switching view re-reads the held direction (D-29). */
  viewChanged(): void;
  /** After each frame: the drawn time's tick, for latencyMs. */
  frameDrawn(tick: number, atMs: number): void;
  inspect(): ControlsInspection;
}
