// How the pitch screen composes what several builders make (M4's design,
// research/m4/DESIGN.md, §1.38, §12's extension points): each part over the
// pitch, the HUD, the overlay's marks, the menu, the sound, touch, the
// hints, the turn prompt and the networked notes, is a layer, made from the
// pitch screen's host and called each animation frame and after each timer
// run. Every name the host holds is a contract file's: Match
// (match-types.ts), Stage and MatchViewApi (src/render/stage-types.ts),
// ControlsApi (src/input/source.ts), SettingsSource and ProfileSource
// (src/storage/schema.ts), Look (src/render/look.ts), Announcement
// (inspect.ts). Types only.

import type { BarkEvent } from '../core/session/index';
import type { ControlsApi, UiCommand } from '../input/source';
import type { CameraMode, DrawnMatch, FrameOut, StageFrame } from '../render/frame';
import type { Look } from '../render/look';
import type { MatchViewApi, Stage } from '../render/stage-types';
import type { ProfileSource, Settings, SettingsSource } from '../storage/schema';
import type { Announcement } from './inspect';
import type { Match } from './match-types';

export interface PitchContext {
  readonly match: Match; readonly drawn: DrawnMatch | null; readonly out: FrameOut | null;
  /** What the stage drew: its drawer input's bark and celebration overlays among it. */
  readonly frame: StageFrame | null;
  /** The drawing clock's (M4's design §2.2). */
  readonly nowMs: number;
  readonly mode: CameraMode; readonly settings: Settings;
  /** The stage's onGraphics, as the pitch screen tracks it. */
  readonly graphics: 'ok' | 'restoring' | 'lost';
  /** In run(): the barks MatchView.run found in this timer run; empty in frame(). */
  readonly barks: readonly BarkEvent[];
}

export interface Layer {
  /** Its key in Inspection.layers: 'hud', 'overlay', 'menu', 'sound', 'touch', 'hints', 'turn', 'net'. */
  readonly name: string;
  /** Put over the pitch in the order given. */
  readonly el: HTMLElement | null;
  /** Each animation frame; text set only when it changes. */
  frame?(ctx: PitchContext): void;
  /** After each timer run. */
  run?(ctx: PitchContext): void;
  /** Your bark went into the input for `tick` (Controls' onBark): the sound plays it. */
  ownBark?(tick: number): void;
  /** A Q-17 command on the pitch with no menu or message open, offered to each layer in order before the
   *  screen's own use of it: true if the layer took it, as the HUD's follow choice takes a spectator's
   *  next and prev, the view key's and the shoulders' (§5.8, D-28). */
  ui?(c: UiCommand): boolean;
  dispose?(): void;
  /** Folded into Inspection.layers under its name. */
  inspect?(): unknown;
}

export type LayerFactory = (host: PitchHost) => Layer;

export interface PitchHost {
  readonly match: Match; readonly stage: Stage; readonly view: MatchViewApi;
  /** null for a spectator, and for the bench, whose sampler is the brain's. */
  readonly controls: ControlsApi | null;
  readonly settings: SettingsSource; readonly profile: ProfileSource; readonly look: Look;
  /** A spec set the hook: P11's head hash each frame. */
  readonly test: boolean;
  /** Into the app's announcements log, which outlives this screen. */
  announce(a: Announcement): void;
  openMenu(): void; closeMenu(): void; leave(): void; ui(c: UiCommand): void;
  /** A view switch or a spectator's follow. */
  setMode(m: CameraMode): void;
}
