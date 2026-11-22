// The stage's types (M4's design, research/m4/DESIGN.md, §1.3, §1.16, §2.1):
// what src/render/scene.ts's createStage implements, M1's createPitchView
// grown into the whole drawing, and what the screens need of
// src/render/view.ts's MatchView. Written apart from both, so the screens
// code against them while the stage is built. The stage makes the page's
// one WebGL 2 context on a canvas of its own; compiles every program a match
// can use and uploads every buffer before play, behind Home, so nothing
// compiles in play (PLAN §12); draws a StageFrame; and reports the
// projections the DOM overlay needs. RenderInfo is M1's (scene.ts's) with
// M4's fields after it. Types only.

import type { RenderQuality } from '../config';
import type { BarkEvent, Correction } from '../core/session/index';
import type { DrawerCounts, DrawerFactory } from './drawer';
import type { CameraMode, DrawnMatch, FrameOut, StageFrame, ViewMode } from './frame';
import type { Look } from './look';

export interface StageOptions {
  readonly quality: RenderQuality;
  readonly look: Look;
  /** The code-built drawer's, passed by the app, so the stage imports no drawer's chunk itself. */
  readonly drawer: DrawerFactory;
  /** Terriers: 2 × config.packSizeMax. */
  readonly capacity: number;
  /** '' in the MVP: config.terrierModelUrl, or the hook's (D-27). */
  readonly modelUrl: string;
}

/** The renderer's figures, for the end-to-end tests: M1's fields, unchanged in name, then M4's. */
export interface RenderInfo {
  frames: number; quality: RenderQuality; samples: number;
  /** The drawn ratio, min(devicePixelRatio, cap) × scale; width and height are round(cssWidth × pixelRatio)
   *  and round(cssHeight × pixelRatio), so a spec checks the buffer by the scale it reads, whatever the
   *  governor did (M4's design §9.1). */
  pixelRatio: number; width: number; height: number;
  calls: number; triangles: number; lines: number;
  programs: number; geometries: number; textures: number;
  /** What prepare() left: every later frame's counts must equal it (PLAN §12). */
  firstFrame: ResourceCounts | null;
  /** The quality's pixelRatioMax (D-33). */
  cap: number;
  /** The governor's pixel-ratio scale, 1 at rest (M4's design §8.2). */
  scale: number;
  cssWidth: number; cssHeight: number;
  /** prepare()'s compile and upload, from its start (M4's design §2.1). */
  prepared: boolean; prepareMs: number | null;
  /** The drawer drawing now. */
  drawer: DrawerCounts | null;
  model: { url: string; state: 'none' | 'loading' | 'compiling' | 'drawn' | 'failed'; ms: number | null; error: string | null };
  /** calm: the calmer camera's setting as the view read it; turnCap: the cap, turns a second, the rig's last step
   *  turned a player's view by, the swing's or the calmer camera's (D-28), null before one and for the spectators
   *  and the overview, so a spec reads what the rig used (M4's design §9.3); follow: what a spectator's camera
   *  drew following, 'ball' or a terrier's ID, null for the others (§9.4, from phase 2d); yaw, the rig's, and x, y
   *  and z, where the camera drawn sat, metres, so a spec reads a player's camera outside the walls at its
   *  height (C-57). */
  camera: {
    kind: CameraMode['kind']; view: ViewMode | null; follow: string | null; calm: boolean; turnCap: number | null;
    yaw: number; x: number; y: number; z: number;
  };
  /** The context lost and restored, and the renderer rebuilt (D-30, D-33). */
  lost: boolean; restores: number; rebuilds: number; rebuilding: boolean;
  /** The glass walls (C-57): outer, whether the last frame drew the glass's outer draw, the near panes' kick band
   *  seen from outside, which draws only while the camera is outside some wall's plane; outside, those walls, by
   *  the simulation's names, whose panes the outer draw kept and the inner draw dropped. */
  glass: { outer: boolean; outside: readonly string[] };
  /** The goals' netting (C-57): each face the last frame drew less than whole, by the simulation's name, with how
   *  much of it showed, 0 for none: a face the camera was outside of, from beyond its goal's line. */
  netting: readonly { readonly name: string; readonly shown: number }[];
}

export interface ResourceCounts {
  readonly programs: number;
  readonly geometries: number;
  readonly textures: number;
}

export interface Stage {
  /** The app puts it in the page before prepare(). */
  readonly canvas: HTMLCanvasElement;
  /** Compiles every program a match can use, on a scene holding one of each, uploads every buffer and
   *  texture by one render with frustum culling off, and records firstFrame (PLAN §12, D-27's M0 note).
   *  Started once, behind Home's or the first screen's DOM, never while a match is drawn. */
  prepare(): Promise<void>;
  /** prepare()'s promise: the pitch screen awaits it before its first frame. */
  ready(): Promise<void>;
  /** One frame: null draws the empty pitch from the overview camera (M1's). */
  draw(frame: StageFrame | null): FrameOut;
  info(): RenderInfo;
  /** Starts the model drawer's load; the terriers stay code-built until it has loaded and compiled (L100). */
  setModel(url: string): void;
  /** The context lost, and back (D-30). */
  onGraphics: ((state: 'lost' | 'restored') => void) | null;
  /** A new renderer on a new canvas, along the restored context's path, its programs compiled one material
   *  an animation frame while the old canvas draws on; resolves once the new canvas has taken its place
   *  (D-33, M4-Q41). */
  rebuild(quality: RenderQuality): Promise<void>;
  /** The governor's pixel-ratio scale, 0.5 to 1 (M4's design §8.2). */
  setScale(scale: number): void;
  dispose(): void;
}

/** What the screens need of src/render/view.ts's MatchView, which implements it. */
export interface MatchViewApi {
  /** The screen sets it: a view switch, a spectator's follow. */
  mode: CameraMode;
  /** After each timer run: the barks this run found, for the layers. */
  run(pageNowMs: number): readonly BarkEvent[];
  correct(c: Readonly<Correction>, pageNowMs: number): void;
  /** Your own bark, in the input for `tick`: drawn at once (D-27). */
  ownBark(tick: number, pageNowMs: number): void;
  frame(pageNowMs: number, pageDtMs: number): StageFrame;
  /** The last frame's drawn match. */
  readonly drawn: DrawnMatch | null;
  /** The rig's yaw now, radians: what chase view's anchoring reads (D-29, Q-19). */
  readonly yaw: number;
  /** The drawing clock (M4's design §2.2). */
  readonly drawMs: number;
  inspect(): { mode: CameraMode; yaw: number; headTick: number; snaps: number; corrections: number; drawMs: number };
}
