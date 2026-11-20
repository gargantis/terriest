# M4 design: rendering, input, screens and sound

**For:** PLAN.md §17, "M4 — Rendering, input, screens and sound", built from M3's tip (`m3-timeline-networking` at dbff249) once it has landed.
**Written:** 2026-11-20, by M4's architect, for the builders who implement it, and revised the same day after three reviews, of its completeness, of its feasibility and frame budget, and of its tests, gate and accessibility: every finding, what it changed and why, is in the Revision log at the end. Committed at M4's start as research/m4/DESIGN.md, as M3's was, with the owner's decisions of 2026-11-20 folded in: the gate (§0, §9.9, §12) and M4-Q33. Its §15 numbers its questions M4-Q1, M4-Q2 and so on, apart from PLAN's Q-numbers and M3's design's M3-Q numbers.
**The owner's priority:** a version they can play as soon as possible. So phase 1 (§12) ends with a playable Practice against the bots, drawn in 3D by the code-built drawer, on the keyboard, through a minimal set of screens, under `npm run dev` and in the built page, with its real-page test, and everything else follows.
**Read for it:** PLAN.md (§0; §1's Q-4, Q-9 to Q-12, Q-15 to Q-19; §2; C-2, C-6, C-7, C-9, C-24, C-28 to C-30, C-33 to C-40, C-51 to C-54; D-9, D-10, D-14, D-16, D-17, D-22 to D-39 with their M0–M3 amendments; §6 to §17; Appendix A); REQUIREMENTS.md (all of it, the screens, controls, cameras, look and sound, platform, performance and acceptance lines especially); research/m3/DESIGN.md (its header, §0, its module map's headings and §16's questions), research/corrections/REPORT.md (§1.9, §1.10, §2.1, §2.2, and PLAN's account of its §2.7), research/spike/REPORT.md (§5.3–§5.5, §6, §7); terriest's `src/ui/game.ts`, `src/ui/practice.ts`, `src/ui/clock.ts`, `src/core/session/index.ts`, `session.ts`, `scoreboard.ts`, `summary.ts`, `practice.ts`, `src/core/timeline/timeline.ts` (the drawn head, `alpha`, `Correction`, `receivedInput`), `src/nettest.ts`, `src/nettest-params.ts`, `src/main.ts`, `src/determinism.ts`, `src/render/**`, `src/core/sim/{index,state,input,params,pitch}.ts`, `src/core/bot/{setups,bot-id}.ts`, `src/core/match-id.ts`, `src/config.ts` and `src/config.test.ts`, `dev/tuning/{model,keyboard,draw,recording}.ts`, `eslint.config.mjs`, `scripts/eslint/config.test.mjs`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `playwright.dev-local.config.ts`, `e2e/lib/**`, every spec in `e2e/`, `index.html`, `public/boot.js`, `public/_headers`, `scripts/audit-dist.mjs`, `vendor/hermet/audit-dist.mjs`'s allowlist, `docs/acceptance.md`, `README.md`, `CLAUDE.md`; the M0 spike's `src/scene/**` (drawer, code drawer, terrier pose, model drawer, ball, look, camera, interpolate, the drawers' tests, and the page's compile pass) and `scripts/make-standin.mjs`; roslambo at 3809d3a's `src/ui/**` (app, dom, controls, input, game, screens), `src/render/**` (renderer, interpolate, layout, palette and its test), `src/storage/**`, `src/core/names.ts`, `src/frames.ts`, `src/bench/virtual-room.ts`, `src/main.ts`, and its `e2e/play.spec.ts`, `touch.spec.ts`, `frames.spec.ts` and `phone-proxy.spec.ts`; the installed Vite 8.3.6 and rolldown 1.2.16 type declarations (the chunking options, `CodeSplittingGroup.includeDependenciesRecursively` among them); and, for the revision, `src/core/bot/marks.ts`' `e2eMatch`, `src/net/setups-testing.ts`, `src/net/practice.test.ts`'s setup runs, `src/core/timeline/clock.ts`, `dev/corrections.vitest.config.ts`, `.github/workflows/check.yml`, `.gitignore`, three 0.187.0's `compileAsync`, and `@trystero-p2p/core`'s `room.mjs`, where Trystero adds its `beforeunload` listener.
**Measured for it:** nothing. Every cost below is an estimate from M0's, M3's and roslambo's measurements, and says so.

How to read it: a bare § number is this design's section, but §16 and §17, which are PLAN's tests and milestones unless the text says this design's, and §20 and §21, PLAN's too; PLAN's other sections are written as PLAN §n, and D-, Q-, C-, P- and A. numbers, and L-numbers, are always PLAN's. §0 is the rules every builder follows, §1 the module map, §2 to §11 the brief's items in order, §12 the build order in four phases, §13 the risks, §14 the owner's steps and §15 the questions for the plan; the Revision log closes it.

---

## 0. Rules every builder follows

- **Paths are PLAN §6's.** Drawing is `src/render/` (three only here, D-26), input `src/input/`, sound `src/audio/`, storage `src/storage/`, screens and glue `src/ui/`, the bench `src/bench/` with its page `src/frames.ts`, the look book `dev/look-book.html`. The lint and the goldens depend on the paths (CLAUDE.md).
- **D-38's boundaries hold, and M4 adds one (§1.55).** Only `src/render/**` imports three, and only from `three` and `three/addons/…`. `src/core/**` imports nothing outside `src/core` but `src/config.ts`. `src/input`, `src/audio`, `src/ui`, `src/storage`, `src/bench` and `dev/` never import three by specifier; they may import `src/render` modules, and those marked **three-free** below import no three at all, so Node tests and the tuning page load them cheaply. Only `src/storage/**` touches browser storage. Only `src/net/trystero.ts` imports Trystero, and only `src/ui/game.ts` loads it. From M4, the model drawer is loaded only by `import()` from `src/render/model-loader.ts`, and GLTFLoader and SkeletonUtils are imported only by it (§1.55).
- **Drawing reads, never writes (P11, D-27).** Nothing outside `src/core` writes a `MatchState`, calls `step`, or calls a timeline's mutators but through `NetGame`, `PracticeGame` and the `Match` adapter (§1.37). The drawing reads the timeline's `head`, `prevHead`, `headTick`, `alpha(now)` and `clock(now)`, and a `Correction`'s `before` and `after` only inside its callback, copying what it keeps.
- **What the drawing keeps** between frames is what D-27 and CLAUDE.md allow, as M4-Q35 amends their list: blend weights and the timings it is fading out (`blends.ts`), smoothing offsets (`smoothing.ts`) and each bark's start (`barks.ts`); and four things no animation's timing depends on: the camera rig's yaw, each viewer's own (D-28); the ball's drawn roll and the dust's puffs, drawing only (C-29); each latched goal's latch time, which fades its celebration in; and the drawing clock's paused time, which stops every fade while Practice is paused (§2.2). Every animation but barking, and how far through it is, comes from the state (§2.7).
- **No setting copies** (PLAN §7.4, CLAUDE.md). Every value §10 lists is added to `src/config.ts` in phase 1a, so no later builder touches the configuration but 2c's slow-frames, and only if M4-Q6 adopts its one setting. Code reads it from `config`, `derived` or `defaultParams` (radii from `defaultParams.ballRadius` and `terrierRadius`, never a local `BALL_R = 0.8`). A number is a setting when the owner tunes it: for the cameras, every number the feel page has a slider for (§3.2, §10, M4-Q34); a number that only keeps the maths or the layout valid, such as a clamp's limit or an edge inset, stays a drawing constant, as M1's camera keeps its elevation and field. The look's own constants (proportions, colours, the dither pattern, a sound's envelope) stay in their modules, as M1's pitch keeps its tints, but are never named like a setting: `src/config.test.ts` scans `src` and `dev` for a setting's name, or a `PORTED_NAMES` one, holding a literal. A builder that finds it needs a setting §10 lacks leaves the literal with `// M4 setting pending: <key>` on its line and names it in its report; the step's integration moves it into `src/config.ts`, the config test's maps, `dev/tuning/model.ts`'s `NOT_TUNED` and PLAN's A.4 or A.5, and greps for the marker before its commit. Run `npx vitest run src/config.test.ts` early.
- **Coats and bandanas by list index** (L44, D-27). Every module carries a coat as its index and a pack as 0 or 1; only a `Look` (§1.11) turns them into colours and patterns.
- **The test hook** (CLAUDE.md): a spec sets `window.terriestTest` before load; once started, the normal page adds `inspect()` and `hashAt()` to it (§1.40). Both observe only. Three fields a spec may set change what the page loads or contacts, each by the plan's leave: `modelUrl` (D-27), and `relay` and `ice` (a loopback relay alone, M4-Q3). A normal page never has the object.
- **Nothing in a test depends on the frame rate** (C-6). The timeline and the gamepad run on timers (D-31, D-29); the camera's yaw steps once a head tick on the timer, not once a frame (§3.1), so chase view's anchoring reads a yaw that frames don't move; specs read logical state through `inspect()`, polled at 50 ms and never on animation frames, time a held key in ticks the hook reports, check a drawing buffer by the governor's scale the hook reports (§9.1), and take their timeouts from measured runs. Every spec that plays draws at 640 × 360 and stored low quality, from phase 1.
- **New behaviour is tested through the real page and its controls** (L344). The only test pages are PLAN's (`#test=determinism`, `#test=net`, `#test=frames`), and none changes what a normal page does. A message the gate can't reach from the page has its Node test, and M4-Q39 records why.
- **The e2e guard** (§16's Everywhere): every spec imports `test` from `e2e/lib/guards.ts`; a spec that breaks something on purpose lists only the browser's own messages for it in `guard.allowedErrors`, never the page's; a `*.net.spec.ts` watches each page it opens and calls `expectEverywhere`. A refusal the page expects, a failed model load, Copy, Share, fullscreen, the orientation and wake locks, an AudioContext's `resume()`, is caught and reported through the hook, never logged as an error or left as an unhandled rejection.
- **File ownership** (§12). A builder edits only its files. In each step `PLAN.md`, `src/config.ts`, `src/config.test.ts`, `dev/tuning/model.ts`, `package.json`, `tsconfig.json`, `.gitignore`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `playwright.dev-local.config.ts`, `eslint.config.mjs`, `index.html`, `src/main.ts`, `src/ui/app.ts`, `src/core/session/index.ts` and `e2e/lib/page.ts` each have at most one owner, named in §12; a builder that needs a test helper beside `page.ts` writes a file of its own (`e2e/lib/gamepad.ts`, `touch.ts`, `standin.ts`). REQUIREMENTS.md is the owner's: M4 changes none of it (§15, M4-Q29's pack cue waits for the owner's pick).
- **Styles belong to the module that makes the DOM they style.** Each builder's DOM has a CSS file of its own beside its module (`src/ui/screens.css`, `hud.css`, `overlay.css`, `prematch.css`, `results.css`, `settings.css`, `touch.css`, …), imported with Vite's `?inline` and added once by `src/ui/style.ts`'s `addStyle(css)`, so no two builders share a stylesheet, and none ships as a file of its own (§11).
- **No builder imports a file another builder of the same step is writing.** Phase 1a writes every type two builders meet at (§12), and later steps import only files that exist when they start; where a later consumer needs less, it declares the narrow interface itself, as M3's did.
- **Parallel builders share one checkout.** Each keeps its files compiling, runs its own unit tests, `npx eslint <its files>` and `npx tsc --noEmit`, and stages only its own files.
- **Builds and end-to-end runs go one at a time.** Every `npm run build`, `npm run check` and Playwright run, a builder's or an integration's, runs under one machine-wide lock, `flock /tmp/terriest-e2e.lock <command>`: every run starts `vite preview` on the gate's port, 4339, with `strictPort`, and reads the one `dist/`, which a build rewrites, new chunk names and all, under a spec that's running. **The gate** (the owner's decision, 2026-11-20, Q-18's alternative): a commit needs `npm run check:commit` (lint, public-scan, typecheck and the unit tests) green, and every spec the commit adds or changes run by path; the full gate, `npm run check`, runs before each `/merge-to-main`, at the milestone's exit and before a deploy, under the lock.
- **Measurements run alone** (§8.4). A run whose figures decide something, the bench's, the slow-frame share, M4-Q19's workers trial and the gate's logged wall times, is made in a step with no other builder working, on a quiet machine as M3's load run was: each run starts once the 1-minute load has fallen under 1 and 8 more minutes have passed, with no gate, build or dev server running, and its file records the load before and after it.
- **roslambo, amorfus and hermet are read, never edited** (CLAUDE.md, PLAN §17). A port copies code into terriest's own file and says so in its header.
- **The repo is public:** no home path, user, account or machine name in any file, comment or test name (CLAUDE.md).

---

## 1. Module map

For each file: its purpose, what it exports (TypeScript signatures for everything another module calls), what it takes from the M0 spike, M2's tuning page or roslambo and what changes, and the plan items it implements. **New** or **changed**, and its owner, a builder of §12, are in each heading: **contracts**, **stage**, **terrier**, **controls**, **shell**, **setups** and **slice** in phase 1; **net-screens**, **results-hud**, **settings**, **devices** and **sound**, then **frames** and **devices-int**, then **slow-frames**, then **net-int**, in phase 2; **motion**, **effects**, **model**, **robust** and **budget** in phase 3; **look-book** and **feel**, then **measure**, then **settle**, in phase 4. Each phase ends with its integration: slice's, net-int's, budget's and settle's (§12).

### src/render (three allowed; three-free files marked)

#### 1.1 `src/render/frame.ts`: new (contracts), three-free

The types the view, the stage, the screens' layers, the smoother and the tests meet at. Types and one constant only.

```ts
import type { AnimPhase, Pack, Phase } from '../core/sim/index';
import type { DrawerFrame } from './drawer';

/** A body as drawn: interpolated, with D-16's offset added. Metres, z up; m/s. */
export interface DrawnBody { x: number; y: number; z: number; vx: number; vy: number; vz: number }

export interface DrawnBall extends DrawnBody {
  onFloor: boolean;
  lastHitTick: number;        // NEVER until hit (A.1)
  lastHitStrength: number;    // the hit's closing speed, m/s (D-9)
  lastHitDv: [number, number, number]; // the squash's axis (A.1, D-9's M2 note)
  lastContactTick: number;
}

export interface DrawnTerrier extends DrawnBody {
  id: string; name: string; pack: Pack; spot: number; coat: number;
  heading: number;            // radians counter-clockwise from +x, interpolated the short way
  headingChange: number;      // radians this tick (D-9's turning)
  anim: AnimPhase; animStart: number;  // D-9: from the nearer of the two states drawn between
  gait: number;               // fraction of a cycle, 0 to 1
  takeOffTick: number; landingTick: number;
  lastBallContactTick: number; lastTerrierContactTick: number;
  lastPushDir: number;        // radians; meaningless while lastPushTick is NEVER
  lastPushTick: number;
  sitting: boolean; ballOverhead: boolean;
  overheadRef: number;        // radians: the heading when ballOverhead set (D-7)
  meter: number;              // 0 to 1 of full (A.1's half-ticks over meterFull)
  pounceWait: number; lunge: number; tumble: number; guard: number; // ticks left
}

export interface DrawnMatch {
  time: number;               // the drawn time in ticks: headTick − 1 + fraction
  headTick: number;
  fraction: number;           // 0 to 1
  phase: Phase; phaseStart: number; overtime: boolean;
  clock: number;              // ticks left, or since overtime began (A.1)
  packSize: number;
  lastGoalTick: number; lastGoalPack: Pack; ownGoal: boolean;
  ball: DrawnBall;
  terriers: DrawnTerrier[];   // the head's (spot, pack) order
}

export type ViewMode = 'ball' | 'chase';
export type CameraMode =
  | { readonly kind: 'overview' }                                    // M1's: the whole empty pitch
  | { readonly kind: 'player'; readonly view: ViewMode; readonly terrier: string }
  | { readonly kind: 'spectator'; readonly follow: string | null };  // null: the ball (D-28, L91)

export interface CameraFrame {
  readonly mode: CameraMode;
  readonly yaw: number;       // radians: the rig's yaw, interpolated by the fraction (§3.1)
  readonly target: { readonly x: number; readonly y: number; readonly z: number };  // the drawn body it aims at or follows
  readonly subject: { readonly x: number; readonly y: number; readonly z: number } | null; // a player's drawn terrier
}

/** What the stage draws in one frame (§1.3); null match: the empty pitch from the overview camera. */
export interface StageFrame {
  readonly match: DrawnMatch | null;
  readonly drawer: DrawerFrame | null;
  readonly camera: CameraFrame;
  readonly nowMs: number;     // the drawing clock: the page clock less the time Practice was paused (§2.2)
  readonly dtMs: number;      // since the last frame by that clock, 0 while paused: the ball's roll and the dust only (§2.7)
  readonly fadeTo: { readonly x: number; readonly y: number; readonly z: number } | null; // the occluders fade between the camera and this (D-28, §2.6)
}

/** A goal's netting bulging round the ball (§2.6): effects.ts finds it in the drawn match, pitch.ts draws it. */
export interface Bulge { readonly pack: Pack; readonly weight: number; readonly x: number; readonly y: number; readonly z: number }

export interface ScreenPoint {
  readonly x: number; readonly y: number; // CSS px from the canvas's top left
  readonly inView: boolean;               // in front of the camera and inside the view, by a margin
  readonly angle: number;                 // radians from the view's centre, for the off-screen arrow (D-28)
}

/** What the stage reports of a frame, for the DOM overlay (§1.45) and the hook. */
export interface FrameOut {
  readonly ball: ScreenPoint;
  readonly terriers: readonly (ScreenPoint & { readonly id: string })[];
  readonly yaw: number;
  readonly cssWidth: number; readonly cssHeight: number;
}

/** A correction's shift of the drawn head's previous state, per body ID ('ball' for the ball), applied
 *  until the head next advances (§2.3): written by smoothing.ts, read by interpolate.ts. */
export type PrevShift = ReadonlyMap<string, { readonly dx: number; readonly dy: number; readonly dz: number; readonly dh: number }>;

export const NEVER_TICK = 0xffffffff; // not a setting: A.1's NEVER, for files that don't import the simulation
```

#### 1.2 `src/render/drawer.ts`: new (contracts)

D-27's one replaceable terrier drawer: the interface both drawers implement, their input and their counts. From the spike's `src/scene/drawer.ts`, with these changes: the pose's animation arrives as weighted layers from `blends.ts` (§2.4), so both drawers cross-fade alike; the bark and the celebration arrive as overlays with their starts (D-27's "the start of the terrier's latest bark" and "whether it celebrates, and from which confirmed tick"); the counts add the overlays drawing now and a latched count of those it has shown, for §16's "a bark and a goal's celebration play on it, checked through its counts", so a spec never has to catch a 0.4 s bark as it plays (§9.1).

```ts
import type { Camera, Object3D, Scene, WebGLRenderer } from 'three';
import type { AnimPhase, Pack } from '../core/sim/index';
import type { Look } from './look';

export interface AnimLayer { readonly anim: AnimPhase; readonly start: number; readonly weight: number }  // start: a tick
export interface Overlay { readonly start: number; readonly weight: number }  // start: a drawn time in ticks, may be fractional

/** One terrier for one frame (D-27): its drawn pose, its animation and overlays, its coat and pack. */
export interface TerrierFrame {
  readonly id: string; readonly pack: Pack; readonly coat: number; readonly mine: boolean;
  readonly x: number; readonly y: number; readonly z: number;
  readonly vx: number; readonly vy: number; readonly vz: number;
  readonly heading: number; readonly headingChange: number; // radians, radians a tick
  readonly layers: readonly AnimLayer[];   // weights sum to 1; the newest last
  readonly gait: number;                   // 0 to 1
  readonly takeOffTick: number; readonly landingTick: number;
  readonly lastBallContactTick: number; readonly lastTerrierContactTick: number;
  readonly lastPushDir: number; readonly lastPushTick: number;
  readonly bark: Overlay | null;           // the latest bark (D-16): a received input's tick, or the local press
  readonly celebrate: Overlay | null;      // its pack's confirmed goal (D-14): start is the goal's tick
}

export interface DrawerFrame {
  readonly time: number;                   // drawn time, ticks
  readonly tick: number; readonly fraction: number;
  readonly terriers: readonly TerrierFrame[];
}

export interface DrawerCounts {
  readonly kind: 'code' | 'model';
  readonly terriers: number;
  readonly trianglesPerTerrier: number; readonly triangles: number;
  readonly drawCalls: number;              // for every terrier drawn
  readonly bonesPerTerrier: number; readonly bones: number;
  readonly textures: number; readonly textureBytes: number; readonly textureSize: string; // the model's own (§12's M0 note)
  readonly geometries: number;
  readonly coatsPainted: readonly number[]; readonly packsPainted: readonly number[];
  readonly overlays: { readonly barking: number; readonly celebrating: number; readonly pushing: number };      // drawing now
  readonly overlaysShown: { readonly barking: number; readonly celebrating: number; readonly pushing: number }; // since it was made, each counted once as it starts
}

export interface TerrierDrawer {
  readonly kind: 'code' | 'model';
  readonly object: Object3D;               // on TERRIER_LAYER as well as the default layer
  draw(frame: DrawerFrame): void;
  counts(): DrawerCounts;
  /** Compiles its programs against the scene it joins, before it's shown (§12: nothing compiles in play). */
  compile(renderer: WebGLRenderer, camera: Camera, scene: Scene): Promise<void>;
  dispose(): void;
}

export type DrawerFactory = (look: Look, capacity: number) => TerrierDrawer;

export const TERRIER_LAYER = 1; // not a setting: three's layer for the counting pass
/** Seconds since a start, at a drawn time (ticks), never negative. */
export function secondsSince(time: number, start: number, ticksPerSecond: number): number;
/** Bytes of an RGBA8 texture of w × h, with its mipmaps if mipmapped (the spike's textureBytes). */
export function textureBytes(w: number, h: number, mipmaps: boolean): number;
```

#### 1.3 `src/render/stage-types.ts`: new (contracts), and `src/render/scene.ts`: changed (stage; robust in phase 3)

The stage: M1's `createPitchView` grown into the whole drawing (PLAN §12). It makes the page's one WebGL 2 context on a canvas of its own, the scene, its lights, the pitch, the ball, the shadows, the drawer and the cameras; it compiles every program a match can use and uploads every buffer before play, behind Home (§2.1); it draws a `StageFrame` and reports the projections the overlay needs. It keeps M1's fit (the canvas fills its box, redrawn at a new size or pixel ratio) and its counts.

The types below are `stage-types.ts`'s, written in phase 1a so that the screens' builder codes against them while the stage's builder writes `scene.ts`, which implements them and exports `createStage`. `RenderInfo` moves there from M1's `scene.ts`, which re-exports it. `MatchViewApi` is what the screens need of `MatchView` (§1.16).

```ts
// src/render/stage-types.ts (contracts): types only
import type { RenderQuality } from '../config';

export interface StageOptions {
  readonly quality: RenderQuality;
  readonly look: Look;
  readonly drawer: DrawerFactory;       // the code-built drawer's, passed by the app (§1.4)
  readonly capacity: number;            // terriers: 2 × config.packSizeMax
  readonly modelUrl: string;            // '' in the MVP: config.terrierModelUrl, or the hook's (D-27)
}

export interface RenderInfo {           // M1's fields, unchanged in name, then M4's
  frames: number; quality: RenderQuality; samples: number;
  /** The drawn ratio, min(devicePixelRatio, cap) × scale; width and height are round(cssWidth × pixelRatio)
   *  and round(cssHeight × pixelRatio), so a spec checks the buffer by the scale it reads, whatever the
   *  governor did (§9.1). */
  pixelRatio: number; width: number; height: number;
  calls: number; triangles: number; lines: number;
  programs: number; geometries: number; textures: number;
  firstFrame: ResourceCounts | null;    // what prepare() left: every later frame's counts must equal it (§12)
  cap: number;                          // the quality's pixelRatioMax (D-33)
  scale: number;                        // the governor's pixel-ratio scale, 1 at rest (§8.2)
  cssWidth: number; cssHeight: number;
  prepared: boolean; prepareMs: number | null;   // prepare()'s compile and upload, from its start (§2.1)
  drawer: DrawerCounts | null;          // the drawer drawing now
  model: { url: string; state: 'none' | 'loading' | 'compiling' | 'drawn' | 'failed'; ms: number | null; error: string | null };
  camera: { kind: CameraMode['kind']; view: ViewMode | null; calm: boolean; raised: boolean; yaw: number; x: number; y: number; z: number };
  lost: boolean; restores: number; rebuilds: number; rebuilding: boolean;   // D-30, D-33 (phase 3)
}
export interface ResourceCounts { readonly programs: number; readonly geometries: number; readonly textures: number }

export interface Stage {
  readonly canvas: HTMLCanvasElement;   // the app puts it in the page before prepare()
  /** Compiles every program a match can use, on a scene holding one of each, uploads every buffer and
   *  texture by one render with frustum culling off, and records firstFrame (§12, D-27's M0 note).
   *  Started once, behind Home's or the first screen's DOM, never while a match is drawn (§2.1). */
  prepare(): Promise<void>;
  /** prepare()'s promise: the pitch screen awaits it before its first frame. */
  ready(): Promise<void>;
  /** One frame: null draws the empty pitch from the overview camera (M1's). */
  draw(frame: StageFrame | null): FrameOut;
  info(): RenderInfo;
  /** Phase 3: starts the model drawer's load; code-built until it has loaded and compiled (L100). */
  setModel(url: string): void;
  /** Phase 3 (D-30): the context lost, and back. */
  onGraphics: ((state: 'lost' | 'restored') => void) | null;
  /** Phase 3 (D-33, M4-Q41): a new renderer on a new canvas, along the restored context's path, its
   *  programs compiled one material an animation frame while the old canvas draws on; resolves once the
   *  new canvas has taken its place. */
  rebuild(quality: RenderQuality): Promise<void>;
  /** The governor's pixel-ratio scale, 0.5 to 1 (§8.2). */
  setScale(scale: number): void;
  dispose(): void;
}

/** What the screens need of src/render/view.ts's MatchView (§1.16), which implements it. */
export interface MatchViewApi {
  mode: CameraMode;
  run(pageNowMs: number): readonly BarkEvent[];   // the barks this timer run found, for the layers (§1.38)
  correct(c: Readonly<Correction>, pageNowMs: number): void;
  ownBark(tick: number, pageNowMs: number): void;
  frame(pageNowMs: number, pageDtMs: number): StageFrame;
  readonly drawn: DrawnMatch | null;     // the last frame's drawn match
  readonly yaw: number;
  readonly drawMs: number;               // the drawing clock (§2.2)
  inspect(): { mode: CameraMode; yaw: number; headTick: number; snaps: number; corrections: number; drawMs: number };
}

// src/render/scene.ts (stage): implements Stage
/** The stage, or null when the browser offers no WebGL 2 (D-30). */
export function createStage(o: StageOptions): Stage | null;
```

Until phase 1c's `src/main.ts` replaces it, `scene.ts` keeps M1's `createPitchView` as a thin wrapper over `createStage`, drawing the overview each animation frame, so M1's page and specs run unchanged through phase 1b.

- **Ports:** M1's `scene.ts` (context, lights, fit, counts, the compile-then-cull-off first frame); the spike's `page.ts` scene assembly. **Changes:** the canvas is the stage's own, so `rebuild` can replace it; the drawer is injected, so the stage never imports a drawer's chunk statically but the code-built one the app passes; `draw` takes a frame instead of running its own loop, since the app's frame loop owns `requestAnimationFrame` (§1.47); the overview camera is M1's spectator fit, used while no match is drawn; `RenderInfo` reports the quality's cap and the governor's scale apart.
- **One of each** for the compile (PLAN §12): the code-built drawer's parts, both packs' bandanas and the pack cue if the look has one; each occluder, the walls, the overhead net, the goal frames and the ball, in its opaque and its dithered variant (§2.6, M4-Q11); the shadows; the dust pool and the netting's bulge (phase 3). Effect meshes and particle pools are made at `prepare`, never later.
- **Implements:** D-26, D-27's stage side, D-28's placement (through `camera.ts`), D-30's WebGL 2 check, D-33's pixel-ratio cap and MSAA, PLAN §12's "nothing compiles in play".

#### 1.4 `src/render/drawers/code.ts`: new (terrier), its own chunk

The code-built drawer, the MVP's default (D-27): rounded shapes, one `InstancedMesh` per part across all terriers, coats as instance colours plus a markings index, a bandana in the pack's colour and pattern.

```ts
export function createCodeDrawer(look: Look, capacity: number): TerrierDrawer;  // a DrawerFactory
export function terrierGeometries(shape: TerrierShape): Record<CodePart, BufferGeometry>;
export function triangleCount(g: BufferGeometry): number;
export type CodePart = 'body' | 'head' | 'snout' | 'face' | 'ear' | 'leg' | 'tail' | 'bandanaPlain' | 'bandanaStriped' | 'cue';
```

- **Ports:** the spike's `src/scene/code-drawer.ts`, line for line where it can. **Changes:** its shape and colours come from a `Look` (§1.11), so the look book draws several side by side; each terrier's pose is the weighted blend of its layers' poses (§2.4), with the bark and celebration overlays on top; the pack cue (Q-11, C-51) is a tenth instanced part when the look has one; a terrier drawn as `mine` gets nothing extra here, since its mark is the overlay's (§1.45); its counts add the overlays.
- **Its chunk:** `vite.config.ts` puts `src/render/drawers/`' files but `model.ts` in a chunk of its own by a `codeSplitting` group that doesn't pull in their dependencies (phase 3, §1.56), statically imported by the app, so the per-chunk plugin counts the drawer's own code as PLAN §12's line reads it (M3-Q19), never `src/config.ts`, the look or the simulation's params beside it.
- **Implements:** D-27, PLAN §12's terriers, L43, L97–L99.

#### 1.5 `src/render/drawers/pose.ts`: new (terrier), three-free maths, three's `Matrix4` for the parts

The code-built terrier's shape and procedural pose: every animation of L98 but barking and celebrating from the state's fields (D-9), with the drawn time.

```ts
export interface PoseParams { bob: number; pitch: number; pitchPivotX: number; pitchPivotZ: number; roll: number; stretch: number;
  headPitch: number; headYaw: number; neckBack: number; neckDown: number; earPitch: number; earSplay: number;
  legs: [number, number, number, number]; tailYaw: number; tailPitch: number; mouth: number; }
/** One animation phase's pose at `seconds` into it (the spike's poseParams, without the overlays). */
export function phasePose(anim: AnimPhase, seconds: number, t: TerrierFrame, shape: TerrierShape): PoseParams;
/** The layers blended by weight, then the overlays: pushing (pushPoseTicks after a ball or terrier
 *  contact), being pushed (lastPushTick, lastPushDir), landing (landingTick), turning (headingChange),
 *  barking and celebrating. */
export function terrierPose(t: TerrierFrame, time: number, shape: TerrierShape, out: PoseParams): PoseParams;
export function blendPoses(a: PoseParams, b: PoseParams, w: number, out: PoseParams): PoseParams;
export function poseParts(root: Matrix4, q: PoseParams, shape: TerrierShape, out: PartMatrices): void;
export function rootMatrix(out: Matrix4, t: { x: number; y: number; z: number; heading: number }, colliderRadius: number): Matrix4;
export interface PartMatrices { body: Matrix4; head: Matrix4; ears: [Matrix4, Matrix4]; legs: [Matrix4, Matrix4, Matrix4, Matrix4]; tail: Matrix4; bandana: Matrix4; cue: Matrix4 }
export function newPartMatrices(): PartMatrices;
```

- **Ports:** the spike's `src/scene/terrier-pose.ts`. **Changes:** `PUSH_TICKS` becomes `config.pushPoseTicks` (D-27's M2 note: A.4 at M4); the pushing pose also follows a terrier contact, and the pose adds being pushed, landing and turning, which the spike didn't draw (L98); the phases' timings come from `secondsSince(time, layer.start, …)` per layer; bark (a mouth open and a head toss over about 0.4 s) and celebration (hops and a tail wag over standing and running, L98) are overlays; the shape is the look's, as plain numbers.
- **Implements:** D-9, D-27's fit (the pushing pose), L98.

#### 1.6 `src/render/drawers/model.ts`: new (model, phase 3), its own dynamic chunk

The model drawer (D-27): GLTFLoader, one skeleton per terrier, an `AnimationMixer` whose actions' times and weights are set from the state's layers every frame and never advanced by its clock.

```ts
export interface ModelInfo { url: string; loadMs: number; setupMs: number; clips: string[]; missingClips: string[]; meshes: number;
  texture: { present: boolean; width: number; height: number; kind: string } }
/** Loads a model and builds a drawer for `capacity` terriers; throws on a model without a skinned mesh or a `fur` material. */
export function loadModelDrawer(url: string, look: Look, capacity: number): Promise<{ drawer: TerrierDrawer; info: ModelInfo }>;
export const MODEL_CLIPS: readonly string[]; // §2.4's convention: the 8 phases, then 'barking', 'celebrating', 'pushing'
```

- **Ports:** the spike's `src/scene/model-drawer.ts`. **Changes,** each D-27's M0 list: one skeleton per terrier (each clone's skinned meshes bound to the first one's skeleton, halving the bone textures); the markings mask, a channel of the `fur` texture, mixes the coat's fur and marking colours in a shader hook whose `customProgramCacheKey` is one constant, so every terrier's clone shares one program; the bandana's stripes from a hook on its UVs for the striped pack; two actions per clip, the clip and `clip.clone()`, so a correction's fade (§2.4) plays both timings at once; the counts add the overlays playing and the coats and packs painted.
- **Loaded only** by `import('./drawers/model')` from `src/render/model-loader.ts`, which `scene.ts`'s `setModel` asks (§1.63, §1.55's rule), so GLTFLoader and SkeletonUtils never reach the code-built path's chunks, though three's core carries the 10 kB of it only GLTFLoader uses (D-26's M0 note).
- **Implements:** D-27's model drawer and painting, L97, L100, L345.

#### 1.7 `src/render/ball.ts`: new (stage)

```ts
export class BallMesh {
  constructor(look: Look, detail: QualityDetail, radius: number);
  readonly object: Object3D;
  /** The drawn ball: squashed by its last hit's strength along its velocity change (A.1, D-9), and turned
   *  as if rolling from its drawn motion, by dtMs (drawing only, C-29). */
  draw(b: DrawnBall, time: number, dtMs: number): void;
  dispose(): void;
}
export function squashAmount(strength: number, ageSeconds: number): number;
export function squashMatrix(out: Matrix4, axis: Vector3, amount: number): Matrix4;
```

- **Ports:** the spike's `src/scene/ball.ts`. **Changes:** the squash's axis is the state's `lastHitDv` (M2 added it for this), not the spike's velocity difference across frames, which a rollback or a frame skip got wrong; the radius is `defaultParams.ballRadius`; its colours are the look's; its material carries the occluders' fade hook (§2.6).

#### 1.8 `src/render/shadows.ts`: new (stage)

```ts
export class Shadows { constructor(capacity: number); readonly mesh: InstancedMesh; draw(m: DrawnMatch): void; dispose(): void }
export function blobTexture(size?: number): DataTexture;
```
The spike's blob shadows, one instanced quad per terrier and one for the ball, fainter as a body rises (PLAN §12). Radii from `defaultParams`.

#### 1.9 `src/render/camera.ts`: changed (stage)

M1's overview fit (`spectatorCamera`, `framedPoints`, `fitSpectator`) stays, now the `overview` mode, its elevation, field and edge margin M1's drawing constants. New: the players' and spectators' placement for a frame.

```ts
export interface Placed { readonly position: Vector3; readonly lookAt: Vector3; readonly fovDegrees: number; readonly raised: boolean }
/** Where the camera goes for a frame (D-28, §3.2): behind and above the subject along the yaw, moved inside
 *  the pitch's region, the goals included, by cameraWallMarginMetres (L89); raised in the yaw's vertical
 *  plane toward ceilingAt when that leaves it nearer the subject than cameraNearestMetres, and aimed so the
 *  subject stays in view; the spectators' high above the near side, outside the walls. */
export function placeCamera(f: CameraFrame, p: Pitch, aspect: number, out: Placed): Placed;
/** A point moved inside the region the pitch's pieces bound (src/core/sim/pitch.ts: the walls, the cut
 *  corners, the overhead net, and each goal's back, side and top netting), by a margin: each piece's plane
 *  pushes it back to the margin on its inner side, in turn, until none does. Not the spike's box, whose
 *  x clamp of ±19.6 m put the camera in front of a terrier standing in a goal. */
export function insidePitch(v: Vector3, p: Pitch, margin: number): Vector3;
/** The highest a camera may sit at (x, y): under the overhead net, or under the goal's roof inside a goal,
 *  less the margin. */
export function ceilingAt(p: Pitch, x: number, y: number, margin: number): number;
```

#### 1.10 `src/render/camera-rig.ts`: new (stage), three-free

The cameras' yaw rules (D-28), stepped once a head tick on the timer, so chase view's anchoring reads a yaw independent of the frame rate (§3.1, M4-Q13).

```ts
export interface RigParams {                       // from config, by camera setting
  readonly chaseTimeConstantSeconds: number; readonly chaseMaxTurnsPerSecond: number;
  readonly ballViewMaxTurnsPerSecond: number; readonly tickSeconds: number;
}
export function rigParams(calmer: boolean): RigParams;
/** What one step reads of the viewer's terrier and the ball: a head's, or a point between two heads. */
export interface RigInput {
  readonly x: number; readonly y: number; readonly heading: number;
  readonly ballOverhead: boolean; readonly overheadRef: number;
  readonly ballX: number; readonly ballY: number;
}
export class CameraRig {
  /** Steps the yaw one tick toward its target: chase view eases toward the terrier's heading, capped;
   *  ball view follows the line to the ball at the cap, with no lag below it, and toward the overhead
   *  reference while the ball is overhead (D-28). */
  step(view: ViewMode, at: RigInput, p: RigParams): void;
  /** After a timer run that moved the drawn head on k ≥ 1 ticks: prevYaw becomes the yaw at prev's tick,
   *  then k steps toward targets read between prev and head at j / k, j = 1 to k (positions linearly,
   *  headings the short way), so the yaw at head's tick doesn't depend on how frames batched the ticks. */
  advance(view: ViewMode, prev: Readonly<MatchState>, head: Readonly<MatchState>, me: string, p: RigParams): void;
  /** A view's first tick, a terrier's arrival or a kickoff placement: the yaw jumps to its target. */
  snap(view: ViewMode, at: RigInput): void;
  readonly yaw: number;      // radians, at the drawn head's tick
  readonly prevYaw: number;  // at prev's tick: a frame draws lerp(prevYaw, yaw, f′), f′ the bodies' spread fraction (§2.2)
}
```

#### 1.11 `src/render/look.ts`: new (contracts), three-free

The look, defined apart from drawing (L44): what the look book varies and the owner picks (Q-11). The placeholder is the spike's.

```ts
export type Markings = 'none' | 'ears' | 'points' | 'saddle';
export interface Coat { readonly name: string; readonly fur: number; readonly marking: number; readonly markings: Markings }
export type Pattern = 'plain' | 'striped';
export interface PackLook { readonly name: string; readonly colour: number; readonly pattern: Pattern }
export type PackCue = 'none' | 'marker' | 'ring';     // Q-11, C-51: a shape cue that keeps a minimum size on screen
export type V3 = readonly [number, number, number];
export interface TerrierShape {                         // the spike's SHAPE, as plain numbers, metres
  readonly body: { readonly centre: V3; readonly radii: V3 }; readonly neck: V3;
  readonly head: { readonly centre: V3; readonly radius: number };
  readonly snout: { readonly centre: V3; readonly radii: V3 };
  readonly eyes: { readonly centre: V3; readonly radius: number }; readonly nose: { readonly centre: V3; readonly radius: number };
  readonly ear: { readonly pivot: V3; readonly radius: number; readonly height: number };
  readonly legs: { readonly radius: number; readonly length: number; readonly front: number; readonly back: number; readonly side: number; readonly top: number };
  readonly tail: { readonly pivot: V3; readonly radius: number; readonly length: number };
  readonly bandana: { readonly centre: V3; readonly radius: number; readonly tube: number; readonly tilt: number };
}
export interface Look {
  readonly name: string;
  readonly coats: readonly Coat[];                      // config.coatCount of them
  readonly packs: readonly [PackLook, PackLook];        // pack A (0) defends −x (D-4)
  readonly ball: { readonly colour: number; readonly band: number };
  readonly pitch: { readonly sky: number; readonly grass: number; readonly line: number; readonly wallPanel: number; readonly rope: number; readonly netting: number };
  readonly terrier: TerrierShape;
  readonly packCue: PackCue;
}
export const PLACEHOLDER_LOOK: Look;                    // the spike's look.ts and palette, 8 coats
/** A coat outside the list draws as coat 0, as D-12 treats a JOIN's (L44). */
export function coatOf(look: Look, index: number): Coat;
```

`src/render/palette.ts` (M1) keeps its exports, now read from `PLACEHOLDER_LOOK`, so the tuning page's `draw.ts` and M1's pitch keep compiling.

#### 1.12 `src/render/palette.test.ts`: new (terrier)

PLAN §12's palette test, roslambo's method (OKLab and the Machado dichromacy matrices at full severity, in linear RGB): each coat against both packs' colours and the grass, under protanopia, deuteranopia and tritanopia; pack A against pack B under each; each pack against both halves' floors (C-51). It runs on `PLACEHOLDER_LOOK` now, and on the owner's pick at M5 (PLAN §17's M5). Its maths, the conversions, the dichromacy matrices and the distance, live in `src/render/palette-check.ts`, three-free, which the test and the look book's model both import, so each sample shows the same verdict the gate would give it (§1.60); the test file itself is vitest's alone.

#### 1.13 `src/render/interpolate.ts`: new (stage), three-free

```ts
/** The drawn match between prev and head at fraction f (PLAN §12's "Each frame"): positions and
 *  velocities linearly, headings and gaits the short way, discrete fields from the nearer state; the
 *  fraction spread over the ticks between them when they're k > 1 apart; no interpolation across a
 *  kickoff placement anywhere between them (prev.tick < head.phaseStart ≤ head.tick, the head in a
 *  countdown), an arrival or a slot change (§2.2). prevShift: the correction's shift of prev,
 *  per body (smoothing.ts). */
export function interpolate(prev: Readonly<MatchState>, head: Readonly<MatchState>, f: number,
  prevShift: PrevShift | null, out: DrawnMatch): DrawnMatch;
export function lerpAngle(a: number, b: number, f: number): number;   // binary angles, the short way (roslambo's)
export function toRadians(binaryAngle: number): number;
export const placementBetween: (prev: Readonly<MatchState>, head: Readonly<MatchState>) => boolean;
```
Ports roslambo's `src/render/interpolate.ts` in 3D, and the spike's discrete-field rule.

#### 1.14 `src/render/smoothing.ts`: new (motion, phase 3), three-free

D-16's smoothing at M3's values (§2.3).

```ts
export interface SmoothingParams { readonly smoothingMs: number; readonly ownSmoothingMs: number; readonly heldHeadCarryTicks: number }
export class Smoother {
  constructor(me: string, p: SmoothingParams, pitch: Pitch, radii: { ball: number; terrier: number });
  /** A correction (D-16): offsets from before to after, bodies in contact in `after` sharing one decay, a
   *  group with this viewer's terrier and no remote terrier at ownSmoothingMs; a snap instead when their
   *  phase or its start differs (D-27's M3 note). */
  correct(c: Readonly<Correction>, nowMs: number): void;
  /** Adds the decayed offsets to the drawn match in place, each body's drawn position clamped inside the
   *  pitch's region by its radius, its offset shortened to fit (D-16: "clamped inside the pitch"); while
   *  the head is held behind the clock, carries the bodies on by their velocities (§2.3). nowMs is the
   *  drawing clock's (§2.2). */
  apply(m: DrawnMatch, behindTicks: number, nowMs: number): void;
  /** The shift to apply to prev until the head next advances: frame.ts's PrevShift. */
  readonly prevShift: PrevShift | null;
  headAdvanced(): void;        // the head moved on: prevShift ends
  reset(): void;               // a snap: offsets dropped (a kickoff, another timeline, a rebuild)
  inspect(): { bodies: number; largestMetres: number; clamped: number };
}
```

#### 1.15 `src/render/blends.ts`: new (motion, phase 3; a phase-1 stub by stage), three-free

The animations' cross-fades, for both drawers (D-27's "Corrections, for both drawers"; L208). Every time it reads is the drawing clock's (§2.2), which stands still while Practice is paused, so a fade stops with play (Q-15).

```ts
export class Blends {
  constructor(blendMs: number);
  /** This frame's layers for a terrier, by ID: its current (anim, animStart), and each one it has left
   *  within blendMs, fading out by the drawing clock, whether the state moved on or a correction moved,
   *  added or took it back. */
  layers(t: Readonly<DrawnTerrier>, nowMs: number): readonly AnimLayer[];
  /** An overlay's weight: in over blendMs from `shownAtMs`, out over blendMs once it ends. */
  overlay(key: string, active: boolean, start: number, shownAtMs: number, nowMs: number): Overlay | null;
  forget(id: string): void;    // a terrier gone from the drawn state
  reset(): void;
}
```
Phase 1's stub (by the **stage** builder) returns one layer of weight 1, and an overlay at weight 1 while it's active, so phase 1 draws every bark and celebration (§2.5), switching at once; the **motion** builder replaces its body in phase 3, keeping the signatures.

#### 1.16 `src/render/view.ts`: new (stage; motion in phase 3), three-free

The composition of one frame from the match the page holds: the drawn match, the drawer's input, the camera and the effects' inputs. The screens call it; the stage draws what it returns. Phase 1's (stage): interpolation, the rig, the drawing clock, and every bark and celebration as overlays at weight 1 (§2.5). Phase 3's (motion, its only other owner): the smoother, the blends' fades and the held head.

```ts
/** What the view reads of a match: Match (src/ui/match.ts) satisfies it. */
export interface ViewSource {
  readonly me: string;
  readonly paused: boolean;                      // Practice's pause: the drawing clock stops (§2.2)
  readonly session: { readonly timeline: ViewTimeline };
  readonly scoreboard: { readonly goals: readonly ConfirmedGoal[] };
}
export interface ViewTimeline {
  readonly started: boolean; readonly id: string; readonly paused: boolean;
  readonly head: Readonly<MatchState>; readonly prevHead: Readonly<MatchState>;
  readonly headTick: number; readonly localTick: number;
  alpha(now: number): number; clock(now: number): number;
  receivedInput(id: string, t: number): number | undefined;
  newestInput(id: string): { readonly tick: number; readonly input: number } | undefined;
}
/** The barks the view draws (D-16): src/core/session/barks.ts's BarkTracker, which the slice passes in (§1.36). */
export interface BarkSource {
  update(t: ViewTimeline): readonly BarkEvent[];   // after each timer run: the barks newly found in received inputs
  pressed(id: string, tick: number): void;         // your own, at the press
  latest(id: string): number | null;               // the latest bark's tick: the drawer's bark start
  reset(): void;                                   // another timeline
}
export interface ViewSettings { readonly calmCamera: boolean; readonly names: boolean }
export class MatchView implements MatchViewApi {   // stage-types.ts's (§1.3)
  constructor(source: ViewSource, look: Look, settings: () => ViewSettings, barks: BarkSource);
  mode: CameraMode;                       // the screen sets it: a view switch, a spectator's follow (§3)
  readonly drawn: DrawnMatch | null;      // the last frame's
  /** After each timer run: the rig advances over the ticks the head moved (§3.1); barks are found and
   *  latched goals noted for their celebrations (§2.5). Returns the barks found, which the pitch screen
   *  hands its layers in PitchContext.barks, so the sound plays what the drawing shows and the tracker
   *  is read once. */
  run(pageNowMs: number): readonly BarkEvent[];
  /** A correction, for the smoother and the blends (phase 3). */
  correct(c: Readonly<Correction>, pageNowMs: number): void;
  /** Your own bark, in the input for `tick`: its start is drawn at once (D-27). */
  ownBark(tick: number, pageNowMs: number): void;
  /** This frame's StageFrame and the drawn match it holds, its times the drawing clock's: the page
   *  clock less the time the source was paused. */
  frame(pageNowMs: number, pageDtMs: number): StageFrame;
  /** The rig's yaw now, radians: what chase view's anchoring reads (D-29, Q-19). */
  readonly yaw: number;
  readonly drawMs: number;
  inspect(): { mode: CameraMode; yaw: number; headTick: number; snaps: number; corrections: number; drawMs: number };
}
```

#### 1.17 `src/render/effects.ts` and `src/render/fade.ts`: new (stubs by stage in phase 1; effects in phase 3)

```ts
// src/render/effects.ts: what scene.ts calls (§1.63's extension point)
export interface Effects {
  readonly object: Object3D;                 // the dust pool, made at prepare
  draw(f: StageFrame): void;                 // the dust from the drawn match; the bulge, found there too, into the pitch's netting
  dispose(): void;
}
export function createEffects(scene: Scene, look: Look, detail: QualityDetail, capacity: number, pitch: DrawnPitch): Effects;
// internals, tested alone
export class Dust { constructor(capacity: number, detail: QualityDetail); readonly object: Object3D; draw(m: DrawnMatch, nowMs: number, dtMs: number): void; dispose(): void }
export function netBulge(m: DrawnMatch, blends: Blends, nowMs: number): Bulge | null;

// src/render/fade.ts: the occluders' screen-door fade (§2.6, M4-Q11), as PLAN §12's swap
/** An occluder material's two variants, made with it: the opaque one, unchanged, and a dithered one, a
 *  clone whose shader hook discards fragments in a 4 × 4 ordered-dither pattern inside the capsule round
 *  the line from the camera to the subject; distinct customProgramCacheKeys, so each compiles once, at prepare. */
export interface Faded<M extends Material> { readonly opaque: M; readonly dithered: M }
export function fadeVariants<M extends Material>(m: M): Faded<M>;
/** Each frame, before the render: the capsule's ends and radius; null, nothing fades. */
export function setFade(from: Vector3 | null, to: Vector3 | null, radius: number): void;
/** Whether an occluder's bounds cross the capsule this frame: it draws with its dithered variant only then. */
export function crossesFade(bounds: Box3 | Sphere): boolean;
export function fadesAt(p: Vector3, from: Vector3, to: Vector3, radius: number): boolean;   // the GLSL's test in TypeScript, for fade.test.ts
```
Dust behind zooming terriers, a fixed pool made at `prepare` (fewer puffs at low quality, D-33); the netting's bulge at a goal, from the predicted state at once and blended out if a correction takes the goal back (Q-7, D-16). The pitch's and the ball's materials take `fadeVariants` from phase 1, when the stub returns the material as both variants and `crossesFade` says never, so phase 3 changes neither `pitch.ts`'s nor `ball.ts`'s creation of them, and `prepare()`'s scene already holds a second object for each variant. An occluder draws with its dithered variant only in the frames it crosses the capsule, so no other frame runs a shader that can discard, which on a tile-based phone GPU such as the Pixel 8a's gives up its early depth tests (feasibility-F7). The tumble's roll and shake are the pose's (§1.5); the squash is the ball's (§1.7).

#### 1.18 `src/render/pitch.ts`: changed (stage in phase 1 for the look's colours and the fade's variants; effects in phase 3 for the swap and the bulge)

M1's pitch, its colours from the `Look`; its walls', overhead net's and goal frames' materials each made in two variants by `fadeVariants` (§1.17), the drawn pitch swapping a part to its dithered variant in the frames it crosses the fade's capsule; and in phase 3 a second hook, on each goal's netting, which displaces it round the ball at a goal (the bulge), with one constant `customProgramCacheKey`.

```ts
export function drawPitch(p: Pitch, detail: PitchDetail, look: Look): DrawnPitch;   // look added
export interface DrawnPitch {
  readonly object: Group;
  readonly variants: readonly Object3D[];   // one object for each occluder's other variant, for prepare()'s compile (§2.1)
  setFade(): void;                          // each frame, after fade.ts's setFade: each occluder on the variant it needs
  setBulge(b: Bulge | null): void;
  dispose(): void;
}
```

#### 1.19 `src/render/quality.ts`: changed (stage; slice removes `qualityFrom` in 1c)

`qualityFrom(location.search)` goes: the quality is the stored setting's from M4 (D-33, M4-Q4). `qualityDetail` stays, and gains the dust's pool size and the spheres' segments the low setting simplifies.

### src/input

#### 1.20 `src/input/source.ts`: new (contracts)

```ts
export type InputKind = 'keyboard' | 'touch' | 'gamepad';
export type Control = 'run' | 'zoomies' | 'jump' | 'pounce' | 'bark' | 'view';
/** One device's state, read once a sampled tick. */
export interface DeviceState {
  readonly direction: number | null;   // screen-relative radians, counter-clockwise from screen up; null: none
  readonly stickStep: number | null;   // a stick's step, 0 to 31, with half-step hysteresis; null for keys
  readonly zoomies: boolean;
  readonly jump: boolean; readonly pounce: boolean; readonly bark: boolean; readonly view: boolean; // pressed since the last read
  readonly changedAtMs: number | null; // the event time of the change this read first shows, for the key-to-screen figure
}
export interface Device {
  readonly kind: InputKind;
  read(): DeviceState;      // the gamepad polls here, on the timeline's timer (D-29)
  release(): void;          // blur, a hidden page, the menu, lost graphics: nothing stays held
  dispose(): void;
}
/** Q-17's keys and buttons outside the play set. */
export type UiCommand = { readonly kind: 'up' | 'down' | 'left' | 'right' | 'press' | 'menu' | 'next' | 'prev'; readonly pressedAt: number; readonly source: InputKind; readonly repeat: boolean };
export interface ControlsInspection {
  readonly devices: readonly InputKind[]; readonly view: ViewMode | null;
  readonly lastInput: number | null;                 // the last u16 sampled
  readonly base: number | null;                      // the last onControl's (D-10)
  readonly firstAfterBase: number | null;            // the first u16 sampled after it (page-F4)
  readonly presses: { readonly jump: number; readonly pounce: number; readonly bark: number; readonly view: number };
  readonly barksDropped: number;                     // within the bark gap (L327)
  /** Key to screen (R-6): ms from each event that changed the input to the first frame drawn at or past
   *  the tick that input is for, over this pitch screen. */
  readonly latencyMs: { readonly count: number; readonly p50: number | null; readonly p95: number | null };
  /** Each held direction's span as sampled: its step and frame, and the first and last tick it went into,
   *  which the specs check against their validated latitude (§9.1). */
  readonly holds: readonly { readonly step: number; readonly frame: number; readonly from: number; readonly to: number | null }[];
}
/** The pad's own figures, at Inspection's top level, since the pad lives as long as the page (§1.40). */
export interface GamepadInspection { readonly connected: boolean; readonly polls: number; readonly presses: Readonly<Record<string, number>> }
/** What the screens need of src/input/controls.ts's Controls (§1.25), which implements it. */
export interface ControlsApi {
  add(d: Device): void; remove(d: Device): void;
  sample(head: Readonly<MatchState>, headTick: number, tick: number): number;
  rebase(base: number): void;
  release(): void;
  viewChanged(): void;
  frameDrawn(tick: number, atMs: number): void;      // after each frame: the drawn time's tick, for latencyMs
  inspect(): ControlsInspection;
}
```

#### 1.21 `src/input/keyboard.ts`: new (controls)

```ts
export class Keyboard implements Device {
  readonly kind: 'keyboard';
  constructor(target: Window, onUi: (c: UiCommand) => void, uiActive: () => 'pitch' | 'spectator' | 'menu' | 'results' | 'other');
  read(): DeviceState; release(): void; dispose(): void;
}
export const PLAY_CODES: readonly string[];   // KeyW, KeyA, KeyS, KeyD, Space, ShiftLeft, ShiftRight, KeyE, KeyQ, KeyC
```
By `event.code` (L77), released on `blur` and a hidden page (D-29); a press counts on its first `keydown`, never on a repeat, and keeps that event's `timeStamp` for the key-to-screen figure (§1.25); a key typed into a field drives nothing. Escape, Enter and the arrows become `UiCommand`s, and so does Space on Results (Q-17); on the pitch screens Space's default is prevented, so it never presses a focused button (C-34). Ports the tuning page's `dev/tuning/keyboard.ts` and roslambo's `bindKeyboard`, with A.2's directions left to `anchoring.ts`.

#### 1.22 `src/input/touch.ts`: new (devices, phase 2)

```ts
export class TouchControls implements Device {
  readonly kind: 'touch';
  constructor(host: HTMLElement, o: { mirrored: () => boolean; edgeMarginPx: number; onFirstUse: () => void });
  readonly el: HTMLElement;          // the control layer: the stick, jump, pounce, bark and view
  setVisible(on: boolean): void;     // players on touch screens, on Pre-match and Match
  read(): DeviceState; release(): void; dispose(): void;
}
```
D-29's touch: a stick on the left (on the right mirrored), its base where the thumb lands inside its area, 0.2 dead zone, zoomies past its rim; jump and pounce on the right, smaller bark and view; each button tracks its own pointers with pointer capture (roslambo's `bindButton`); nothing starts within `touchEdgeMarginCssPx` of a side edge, inside the safe-area insets.

#### 1.23 `src/input/gamepad.ts`: new (devices, phase 2)

```ts
export class Gamepad implements Device {
  readonly kind: 'gamepad';
  constructor(o: { clock: Clock; onUi: (c: UiCommand) => void; onConnected: (on: boolean) => void });
  read(): DeviceState;                 // polls navigator.getGamepads(): the sampler's call (D-29)
  /** The 60 Hz poll of its own, while this page samples no input (no pitch, a spectator, the menu, Practice paused). */
  setOwnTimer(on: boolean): void;
  release(): void; dispose(): void;
  inspect(): GamepadInspection;        // source.ts's, at Inspection's top level: the pad lives as long as the page (§1.40)
}
```
The standard mapping (D-29): left stick runs, buttons 0 jump, 2 pounce, 3 bark, 5 view, the right trigger (button 7) zoomies past `gamepadTriggerFraction`; Start (9) presses, Back (8) the menu, the d-pad (12–15) moves, the shoulders (4, 5) cycle a spectator's follow, and on Results button 0 presses too (Q-17). A press is a rising edge between two polls, so each counts once however often the pad is read, which §16's stub relies on.

#### 1.24 `src/input/anchoring.ts`: new (controls), three-free

```ts
export interface Anchor {                       // chase view's last read (§4.5)
  readStep: number | null;                      // the pitch-frame step it sent from the last read; null: neutral last sample
  readDeviceStep: number;                       // the device's own step at that read
  reread: boolean;                              // viewChanged: read again at the next sample
}
export function newAnchor(): Anchor;
/** A.2's step and frame for a held direction (D-29, Q-19, C-24): ball view sends the ball frame with the
 *  screen step; chase view the pitch frame, re-reading the yaw from neutral, at a move of rereadSteps or
 *  more from the step last read, or after viewChanged; a smaller stick move turns the kept direction. */
export function anchor(view: ViewMode, d: Pick<DeviceState, 'direction' | 'stickStep'>, yaw: number, a: Anchor,
  steps: number, rereadSteps: number): { step: number; frame: number } | null;
/** A stick angle's step with half-step hysteresis (D-10). */
export function stickStepOf(angle: number, prev: number | null, steps: number, hysteresisSteps: number): number;
export function screenStep(angle: number, steps: number): number;   // a key direction's exact step
```

#### 1.25 `src/input/controls.ts`: new (controls)

The input source the match samples (D-10, D-29): the devices merged into one u16 for each sent tick.

```ts
export interface ControlsOptions {
  readonly view: () => ViewMode;           // this viewer's view now
  readonly yaw: () => number;              // MatchView.yaw: chase view's re-read (§3.1)
  readonly onView?: () => void;            // the view control was pressed
  readonly onUsed?: (kind: InputKind, c: Control) => void;   // the hints (§1.26)
  /** Your bark went into the input for `tick`: the pitch screen draws it at once (MatchView.ownBark) and
   *  tells each layer (Layer.ownBark), so the sound plays it too (§2.5). */
  readonly onBark?: (tick: number) => void;
}
export class Controls implements ControlsApi {   // source.ts's (§1.20)
  constructor(o: ControlsOptions);
  add(d: Device): void; remove(d: Device): void;
  /** The u16 for tick `tick`, the one being sent: sampled once a sent tick, on the timeline's timer (D-29). */
  sample(head: Readonly<MatchState>, headTick: number, tick: number): number;
  /** The session's onControl (D-10, M3's D-17): the counters start from the terrier's stored input. */
  rebase(base: number): void;
  release(): void;
  viewChanged(): void;                     // switching view re-reads the held direction (D-29)
  frameDrawn(tick: number, atMs: number): void;
  inspect(): ControlsInspection;
}
```
Each counter advances at most once a sampled tick (M4-Q25); a bark within `derived.barkGapTicks` of the last sent one is dropped (L327); a held direction's input repeats exactly, so prediction holds (D-10, L342). The rebase keeps the counters' bits from `base` and starts the bark counter at 0, since barks aren't in the state and peers' bark rule ignores the first input after a gap (§2.5, M4-Q24). A device reports the event time of each change it makes (`changedAtMs`), and the controls pair it with the tick its input is for, so `latencyMs` runs from the key, the touch or the pad's poll to the first frame drawn at or past that tick, the figure R-6 asks for.

#### 1.26 `src/input/hints.ts`: new (devices, phase 2), three-free

```ts
export const CONTROLS: readonly Control[];   // run, zoomies, jump, pounce, bark, view
export class HintTracker {
  constructor(used: Readonly<Record<InputKind, number>>, save: (used: Record<InputKind, number>) => void);
  use(kind: InputKind, c: Control): void;     // the profile remembers it (D-24, A.3)
  remaining(kind: InputKind): readonly Control[];
  reset(): void;                               // Settings' Show control hints again
}
```
A.3's `hints: { keyboard, touch, gamepad }` hold a bitmask of the six controls each kind has used (M4-Q28).

### src/audio

#### 1.27 `src/audio/audio.ts`: new (sound, phase 2)

```ts
export class AudioOut {
  constructor(target: Window, doc: Document);   // the AudioContext, made at start-up (D-32)
  /** Running, or waiting for a key or a tap (PLAN §13). */
  readonly state: 'running' | 'waiting' | 'none';
  setEnabled(on: boolean): void;   // Settings' sound: the master gain
  setPaused(on: boolean): void;    // Practice's menu (Q-15): the context suspends
  /** A cue SoundCues decided: counted in `decided` whatever the context's state; scheduled, and counted in
   *  `played`, only while the context runs, sound is on and Practice isn't paused. A cue decided while the
   *  context waits is dropped, never queued: a suspended context's time stands still, so every cue
   *  scheduled on it would sound at once when it resumes. */
  play(cue: Cue): void;
  inspect(): AudioInspection;   // src/ui/inspect.ts's (§1.40), whose CueKind is synth.ts's union, written there in phase 1a
}
```
One for the page, made when `src/ui/layers/sound.ts` is first imported, which is at start-up, since the layers' list is a static import of the app (§1.63): `export function audioOut(): AudioOut`. It resumes at each `keydown`, `click`, `pointerup` or `touchend` until it runs, and when the page is shown, each `resume()`'s promise caught, so a refusal is never a page error; with no Web Audio it's `none` and every call does nothing. The sound layer (`src/ui/layers/sound.ts`, name `sound`) owns the "Press a key or tap for sound" prompt, shown while sound is on and the context isn't running (D-32), and reports it as `audio.prompt`; the HUD has none.

#### 1.28 `src/audio/synth.ts`: new (sound)

The sounds, made in code (D-32): a bark (filtered noise with a falling pitch, its pitch and length a little different per terrier, seeded by the ID), a thump (a low sine and noise, louder and lower for a harder hit), a whoosh, a thud, the whistle (kickoff, goal and end, each its own pattern) and a chorus of barks. Each under 0.3 s but the whistles and the chorus (PLAN §13).

```ts
import type { CueKind } from '../ui/inspect';   // phase 1a's contract
export interface Cue { readonly kind: CueKind; readonly seed: number; readonly loudness: number /* 0 to 1 */ }
export function schedule(ctx: BaseAudioContext, out: AudioNode, cue: Cue, at: number): void;
```

#### 1.29 `src/audio/cues.ts`: new (sound), three-free

When each sound plays, given rollback (PLAN §13).

```ts
export class SoundCues {
  constructor(me: string, shiftTicks: number);   // config.soundShiftTicksMax
  /** After each timer run: bounces, pounces and tumbles first seen in the predicted head, keyed by kind,
   *  body and tick, none again within shiftTicks of one played; the kickoff whistle when play starts. */
  fromHead(head: Readonly<MatchState>): Cue[];
  /** Confirmed goals and the end, from the scoreboard's changes (D-14): a whistle and the chorus once
   *  per goal tick, the end whistle once. */
  fromScore(goalsAdded: readonly ConfirmedGoal[], endConfirmed: boolean): Cue[];
  /** Barks: remote ones from received inputs only (D-16), yours at the press. */
  fromBarks(barks: readonly BarkEvent[]): Cue[];
  reset(): void;   // another timeline
}
```

### src/storage

#### 1.30 `src/storage/schema.ts`: new (contracts), three-free

A.3's shapes, which the stores, the screens and the specs' storage seeding share.

```ts
export const PROFILE_KEY = 'terriest.v1.profile';
export const PROFILE_BACKUP_KEY = 'terriest.v1.profile.backup';
export const SETTINGS_KEY = 'terriest.v1.settings';
export interface Profile { readonly v: 1; readonly playerId: string; readonly name: string; readonly coat: number;
  readonly hints: { readonly keyboard: number; readonly touch: number; readonly gamepad: number } }
export interface TurnServer { readonly urls: string; readonly username: string; readonly credential: string }
export interface StoredSettings { readonly v: 1; readonly relays: readonly string[]; readonly turn: readonly TurnServer[];
  readonly names: boolean; readonly ballView: boolean; readonly calmCamera: boolean | null; readonly mirrorTouch: boolean;
  readonly sound: boolean; readonly quality: RenderQuality | null }
/** The settings in force: the nulls resolved by their default rules (A.3). */
export interface Settings extends Omit<StoredSettings, 'calmCamera' | 'quality'> { readonly calmCamera: boolean; readonly quality: RenderQuality }
export const DEFAULT_SETTINGS: StoredSettings;   // names off, ballView on, calmCamera null, mirrorTouch off, sound on, quality null (PLAN §11)
/** What the screens need of the stores (§1.32, §1.33), which implement these. */
export interface ProfileSource { readonly persistent: boolean; get(): Profile; update(change: (p: Profile) => Profile | null): boolean }
export interface SettingsSource { get(): Settings; stored(): StoredSettings; set(change: Partial<StoredSettings>): string | null;
  subscribe(fn: (s: Settings) => void): () => void }
```

#### 1.31 `src/storage/kv.ts`: new (shell)

roslambo's `kv.ts`, unchanged but for its comments: `browserStorage()`, `tryRead`, `tryWrite` (a failed write loses that write only, PLAN §10), `MemoryStorage` for tests and a browser without storage.

#### 1.32 `src/storage/profile.ts`: new (shell)

```ts
export class ProfileStore implements ProfileSource {
  constructor(kv?: KeyValue | null, makeId?: () => string);
  readonly persistent: boolean;           // false: a write failed, and Home says so (PLAN §10)
  get(): Profile;
  update(change: (p: Profile) => Profile | null): boolean;   // one setItem of the whole record
}
export function parseProfile(raw: string): Profile | null;
export function newPlayerId(): string;     // crypto.randomUUID(), 32 lowercase hex digits (D-25)
```
roslambo's, with terriest's fields: no balance or ledger; a coat drawn at random on the first visit and stored at once; a name fitted by `src/core/names.ts`; an unreadable record backed up verbatim before a fresh one (D-24).

#### 1.33 `src/storage/settings.ts`: new (shell); extended by settings in phase 2

```ts
export class SettingsStore implements SettingsSource {
  constructor(kv?: KeyValue | null, env?: { reducedMotion: () => boolean; qualityDefault: () => RenderQuality });
  get(): Settings;                        // the nulls resolved now, so a change of the system's preference still applies
  stored(): StoredSettings;
  set(change: Partial<StoredSettings>): string | null;   // null, or the first problem (a relay or TURN server, roslambo's checks)
  subscribe(fn: (s: Settings) => void): () => void;      // phase 2: settings apply at once (PLAN §11)
}
export function relayProblem(url: string): string | null;
export function turnProblem(t: TurnServer): string | null;
```

#### 1.34 `src/storage/tab-lock.ts`: new (net-screens, phase 2)

roslambo's Web Lock, named `terriest-game` (D-24): `holdTabLock(steal: boolean, onLost: () => void): Promise<boolean>`.

### src/core

#### 1.35 `src/core/names.ts`: new (shell)

```ts
/** A typed name fitted to C-17's rule: control units and lone surrogates dropped, trimmed, cut on a code
 *  point to displayNameMaxChars and displayNameMaxBytes, so cleanName never drops it (D-12's M2 note). */
export function fitName(input: string, P?: SimParams): string;
```
roslambo's `fitName`, on the simulation's `isNameControl` and `nameAllowed` (src/core/sim/state.ts), which its unit test checks: for any string, `nameAllowed(fitName(s))`.

#### 1.36 `src/core/session/barks.ts`: new (controls, phase 1), three-free; `src/core/session/bark-types.ts` and `src/core/session/index.ts`: new and changed (contracts in 1a; slice in 1c; net-screens in 2a)

```ts
// src/core/session/bark-types.ts (contracts): types only
export interface BarkEvent { readonly id: string; readonly tick: number; readonly own: boolean }
export interface BarkTimeline {
  receivedInput(id: string, t: number): number | undefined;
  newestInput(id: string): { readonly tick: number; readonly input: number } | undefined;
  readonly head: Readonly<MatchState>;
}
// src/core/session/barks.ts (controls)
/** D-16's barks: a bark at tick t for a sender when the inputs received for t and t − 1 are both known
 *  and their bark counts differ; the first input after a gap only sets the baseline (M4-Q24). */
export class BarkTracker {
  constructor(me: string);
  update(t: BarkTimeline): BarkEvent[];
  pressed(id: string, tick: number): void;   // your own, at the press
  latest(id: string): number | null;         // the latest bark's tick: the drawer's bark start
  reset(): void;
}
```
From phase 1, so the first playable slice already shows every bark: yours at the press, a host's own bots' from the inputs it recorded for them, and a remote terrier's from the inputs received (§2.5); sound plays the same events from phase 2. `BarkTracker` satisfies view.ts's `BarkSource` (§1.16) by its shape, since `src/core` imports nothing from `src/render`. `index.ts` gains in 1a the types M4's contracts meet, `type Correction`, `type Timeline`, `type TimelineStats`, `type BarkEvent` and `type BarkTimeline`; in 1c `BarkTracker`, which the slice wires into `MatchView`; and in 2a the values the networked screens read, `REFUSAL` and `ROLE`.

### src/ui

#### 1.37 `src/ui/match-types.ts`: new (contracts); `src/ui/match.ts`: new (shell; net-screens adds the networked adapter in phase 2)

One interface over `PracticeGame` and `NetGame`, which the screens, the view, the controls and the sound meet at. The types are `match-types.ts`'s, written in phase 1a; `match.ts` holds the adapters.

```ts
// src/ui/match-types.ts (contracts): types only
export type PauseReason = 'menu' | 'graphics';
export interface MatchStatus {
  readonly refusal: number | null; readonly failed: boolean; readonly abandoned: boolean;
  readonly refused: Refused | null; readonly switchRefused: boolean; readonly returning: boolean;
  readonly spectatorsFull: boolean; readonly leaving: boolean; readonly closed: boolean;
  readonly peers: number; readonly againSeen: boolean;
}
/** What a slow page skipped (§8.1): since the match opened, the local ticks moved, the TICKs sent, and the
 *  ticks a catch-up marked absent, for each of `senders`, its own terrier if it plays and each bot it hosts. */
export interface OwnFigures { readonly ticks: number; readonly sent: number; readonly skipped: number; readonly senders: number }
export interface Match {
  readonly kind: 'practice' | 'net';
  readonly me: string;
  readonly matchId: string | null;            // null in Practice, which never sets the fragment (D-22)
  readonly settings: MatchSettings;
  readonly session: Session;                  // read .timeline each time: a merge or a rejoin replaces it
  readonly scoreboard: Scoreboard;
  readonly clock: Clock;
  readonly paused: boolean;
  /** Timer runs, corrections, and Practice's own pauses (a stall or a hidden page, which open the menu). */
  subscribe(l: { run?: () => void; correction?: (c: Readonly<Correction>) => void; stalled?: (why: 'stall' | 'hidden') => void }): () => void;
  /** The sampler, called once a sent tick on the drawn head, with the tick its input is for, the
   *  timeline's local tick + d (§4.1); and its rebase at onControl (D-10). */
  setControls(sample: (head: Readonly<MatchState>, headTick: number, tick: number) => number, rebase: (base: number) => void): void;
  ready(on: boolean): void;
  switchPack(): void;                         // Practice: swap with the other pack's newest bot (D-22)
  canAddBot(pack: Pack): boolean; addBot(pack: Pack): boolean; removeBot(pack: Pack): boolean; // false in Practice
  play(pack: Pack): void; watch(): void;      // networked only; Practice plays in pack A from its start
  pause(why: PauseReason): void; resume(why: PauseReason): void;   // Practice: paused while any reason holds
  status(): MatchStatus;
  own(): OwnFigures;
  summary(): MatchNetSummary; stats(): TimelineStats;
  traffic(): Traffic | null;                   // networked only (game.ts's)
  leave(): void;                               // networked: LEAVE, the room closed leaveGraceMs later; Practice: closed
  playAgain(): Promise<Match>;                 // D-12, Q-15
  close(): void;
}
// src/ui/match.ts (shell; phase 2's networked adapters by net-screens)
export function practiceMatch(o: PracticeGameOptions): Match;
export function openNetMatch(o: NetGameOptions): Promise<Match>;   // phase 2
export function asMatch(game: NetGame, settings: MatchSettings): Match;  // phase 2: a game already open (Play again)
```
- **Pauses** (Q-15, D-30): Practice pauses while the menu is open or the graphics are lost, and resumes once neither holds; a stall's or a hidden page's pause from `PracticeGame.onPause` reaches `stalled`, and the screen opens the menu, which holds `menu`. While paused, the view's drawing clock stands still (§2.2). A networked match never pauses: both reasons only release the controls.
- **What a slow page skips** (`own()`): after each timer run the adapter adds the ticks the timeline's `localTick` moved and the TICKs its stats count sent. A run that moves k > `stallSendTicks` ticks sends the newest 3 and marks the rest absent for every sender at once (the timeline's `markSkipped`), so `skipped` counts ticks and `senders` says how many inputs each stood for. Practice sends every tick, so its `skipped` stays 0. The hook (§1.40) and the governor (§8.2) read it.
- **What it changes in M3's glue:** nothing but one option, `PracticeGameOptions.P?` and `B?`, for the feel page (§1.61, phase 4). NetGame, PracticeGame and the session are used as M3 built them; the scoreboard's changes are diffed by the screen after each run, since the glue's `onRun` follows `scoreboard.update`.

#### 1.38 `src/ui/layer.ts`: new (contracts)

How the pitch screen composes what several builders make (§12): each part over the pitch is a layer.

```ts
export interface PitchContext {
  readonly match: Match; readonly drawn: DrawnMatch | null; readonly out: FrameOut | null;
  readonly frame: StageFrame | null;        // what the stage drew: its drawer input's bark and celebration overlays among it
  readonly nowMs: number;                   // the drawing clock's (§2.2)
  readonly mode: CameraMode; readonly settings: Settings;
  readonly graphics: 'ok' | 'restoring' | 'lost';   // the stage's onGraphics, as the pitch screen tracks it (§5.8)
  readonly barks: readonly BarkEvent[];     // in run(): the barks MatchView.run found in this timer run (§2.5); empty in frame()
}
export interface Layer {
  readonly name: string;                // its key in Inspection.layers: 'hud', 'overlay', 'menu', 'sound', 'touch', 'hints', 'turn', 'net'
  readonly el: HTMLElement | null;      // put over the pitch in the order given
  frame?(ctx: PitchContext): void;      // each animation frame; text set only when it changes (setText)
  run?(ctx: PitchContext): void;        // after each timer run
  ownBark?(tick: number): void;         // your bark went into the input for `tick` (Controls' onBark): the sound plays it
  dispose?(): void;
  inspect?(): unknown;                  // folded into Inspection.layers under its name
}
export type LayerFactory = (host: PitchHost) => Layer;
/** Every name here is a contract file's: Match (match-types.ts), Stage and MatchViewApi
 *  (stage-types.ts), ControlsApi (source.ts), SettingsSource and ProfileSource (schema.ts),
 *  Announcement (inspect.ts). */
export interface PitchHost {
  readonly match: Match; readonly stage: Stage; readonly view: MatchViewApi;
  readonly controls: ControlsApi | null;          // null for a spectator, and for the bench, whose sampler is the brain's
  readonly settings: SettingsSource; readonly profile: ProfileSource; readonly look: Look;
  readonly test: boolean;                         // a spec set the hook: P11's head hash each frame (§2.7)
  /** Into the app's announcements log, which outlives this screen (§1.40). */
  announce(a: Announcement): void;
  openMenu(): void; closeMenu(): void; leave(): void; ui(c: UiCommand): void;
  setMode(m: CameraMode): void;                   // a view switch or a spectator's follow (§3.4)
}
```

#### 1.39 `src/ui/dom.ts`: new (shell)

roslambo's `h`, `setText` and `setClass`, unchanged: text always goes in as text nodes, never markup (L224). New: `setEnabled(button, on, why)`, which marks a button that can't act yet `aria-disabled` with its reason as its label, never `disabled`, so it keeps the focus Q-17 gives it (§1.42).

#### 1.40 `src/ui/inspect.ts`: new (contracts); `src/main.ts` re-exports its types

The hook's shapes (CLAUDE.md's test hook), which every spec reads. A part lives in it as long as what it reports: a pitch screen's controls and layers while that screen shows, the match, its announcements and the page's pad and sound across every screen.

```ts
export type ScreenName = 'home' | 'settings' | 'propose' | 'created' | 'practice' | 'join' | 'prematch' | 'match' | 'results' | 'message';
export interface Inspection {
  readonly screen: ScreenName;
  readonly message: string | null;          // the message screen's data-message code (§5.10)
  readonly menu: 'closed' | 'menu' | 'settings';
  readonly render: RenderInfo;
  readonly match: MatchInspection | null;   // the match held, whatever screen shows it
  readonly announcements: AnnouncementLog | null;   // the match held's, kept by the app across its screens
  readonly controls: ControlsInspection | null;     // a pitch screen's; null on every other screen
  readonly gamepad: GamepadInspection | null;       // the page's pad, on every screen, Results and Home included
  readonly layers: Readonly<Record<string, unknown>>;   // each pitch layer's inspect() by its name: hud, overlay, menu, sound, touch, hints, turn
  readonly audio: AudioInspection | null;   // the page's, on every screen; null before phase 2
  readonly frames: { readonly frames: number; readonly scale: number; readonly skipping: boolean; readonly actions: number;
    readonly log: readonly { readonly atMs: number; readonly scale: number; readonly skipping: boolean; readonly why: 'skipped' | 'gaps' | 'recovered' }[];
    readonly headHashMismatches: number };  // P11 in the page: frames whose drawing changed the head's hash
  readonly startMs: { readonly started: number; readonly prepared: number | null };  // since navigation: started() and prepare()'s end (§2.1)
}
export interface MatchInspection {
  readonly kind: 'practice' | 'net'; readonly me: string; readonly matchId: string | null;
  readonly started: boolean; readonly paused: boolean; readonly inRoster: boolean; readonly returning: boolean;
  readonly localTick: number; readonly finalTick: number; readonly headTick: number;
  readonly phase: number; readonly phaseStart: number; readonly overtime: boolean; readonly clock: number;
  readonly score: readonly [number, number];                    // the scoreboard's
  readonly goals: readonly { tick: number; pack: number; ownGoal: boolean; scorers: string[] }[];
  readonly end: { tick: number; score: [number, number]; winner: number | null; rows: ResultRow[] } | null;
  readonly roster: readonly { id: string; name: string; pack: number; spot: number; coat: number; sitting: boolean;
    lastInputTick: number; goals: number; touches: number }[];  // the final state's
  readonly mine: { x: number; y: number; z: number; heading: number; anim: number; animStart: number; takeOffTick: number;
    pounceWait: number; meter: number; lastInput: number;       // the drawn head's own terrier; lastInput its stored input
    lunges: number; lastLungeTick: number | null } | null;      // latched: lunges begun in the head since the match opened
  readonly ball: { x: number; y: number; z: number };           // the drawn head's
  readonly timer: { readonly runs: number; readonly gapMaxMs: number; readonly gapsOverFreeze: number; readonly gapsOverStall: number };
  readonly own: OwnFigures;                                     // §1.37, §8.1
  readonly stats: { late: number; lateAbsent: number; disagree: number; resyncs: number; rollbacks: number; corrections: number;
    clockSamples: number; clockSamplesDropped: number };        // the clock's two counters from phase 2b (§8.4)
}
/** What the screens announced for one match, kept by the app until another match opens (§9.4). */
export interface AnnouncementLog {
  readonly matchId: string | null; readonly arrivalTick: number | null;   // the first tick this page's timeline held
  readonly countdowns: readonly number[];          // each countdown's phaseStart, once shown (L103)
  readonly goals: readonly { readonly tick: number; readonly shownAtMs: number; readonly withdrawnAtMs: number | null }[];
  readonly results: { readonly shownAtMs: number;
    readonly presses: readonly { readonly atMs: number; readonly source: InputKind | 'pointer'; readonly accepted: boolean }[] } | null;
  readonly barksShown: number; readonly celebrationsShown: number;   // marks and overlays started, each counted once
}
export type Announcement =
  | { readonly kind: 'arrival'; readonly matchId: string | null; readonly tick: number }
  | { readonly kind: 'countdown'; readonly phaseStart: number }
  | { readonly kind: 'goal' | 'goalWithdrawn'; readonly tick: number; readonly atMs: number }
  | { readonly kind: 'results'; readonly atMs: number }
  | { readonly kind: 'press'; readonly atMs: number; readonly source: InputKind | 'pointer'; readonly accepted: boolean }
  | { readonly kind: 'bark' | 'celebration' };
export interface HudInspection {               // layers.hud
  readonly score: string; readonly clock: string; readonly countdown: string | null; readonly scorer: string | null;
  readonly meter: number | null; readonly pounceWait: number | null;   // a player's (L167)
  readonly graphics: 'ok' | 'restoring' | 'lost';
  readonly following: string | null;           // a spectator's: 'ball' or a terrier's ID
}
export interface OverlayInspection {           // layers.overlay
  readonly mine: { readonly shown: boolean; readonly x: number; readonly y: number } | null;
  readonly names: readonly { readonly id: string; readonly text: string; readonly shown: boolean }[];
  readonly barks: readonly string[]; readonly away: readonly string[];
  readonly arrow: { readonly shown: boolean; readonly angle: number };
}
export type CueKind = 'bark' | 'thump' | 'whoosh' | 'thud' | 'whistleKickoff' | 'whistleGoal' | 'whistleEnd' | 'chorus';  // synth.ts imports it
export interface AudioInspection {
  readonly state: 'running' | 'waiting' | 'none'; readonly enabled: boolean; readonly paused: boolean;
  readonly prompt: boolean;                               // "Press a key or tap for sound" shown, the sound layer's
  readonly decided: Readonly<Record<CueKind, number>>;    // every cue decided, whatever the context: what the specs assert
  readonly played: Readonly<Record<CueKind, number>>;     // those scheduled: the context running, sound on, not paused
}
/** window.terriestTest: set by a spec before load; never by a normal page. */
export interface TerriestTest {
  inspect?: () => Inspection;
  hashAt?: (t: number) => string;           // the held timeline's final hash at t, '' if not held (P1, P2 in the specs)
  net?: NetHook;                             // the #test=net page's (M3)
  modelUrl?: string;                         // D-27: the model drawer's URL, loaded as a shipped model's would be
  relay?: string; ice?: IceMode;             // M4-Q3: a loopback relay alone, for the gate's screens
}
```

#### 1.41 `src/ui/app.ts`: new (slice in phase 1; net-screens in 2a; net-int in 2d)

The screens and the moves between them (PLAN §11): one state machine, roslambo's `App`, changed as §5 says.

```ts
export interface AppDeps {
  readonly root: HTMLElement;          // <main id="app">, made by src/main.ts on the normal page only (M4-Q1)
  readonly stage: Stage; readonly profile: ProfileStore; readonly settings: SettingsStore;
  readonly test: TerriestTest | null; readonly build: string; readonly clock: Clock; readonly page: PageEvents;
  readonly boot: Boot;                 // started() once the first screen shows (§5.1, M4-Q38)
}
export class App {
  constructor(d: AppDeps);
  /** From phase 2 takes the tab lock; shows the first screen, the fragment's route or the other-tab
   *  message; calls boot.started(); then starts stage.prepare() behind it, unless another tab holds the
   *  lock, when prepare waits for Use here (§5.1). */
  start(): Promise<void>;
  inspect(): Inspection;
}
```
- **Ports:** roslambo's `src/ui/app.ts`. **Changes:** no ledger, background, rounds or witnesses; the fragment by `location.replace`, and the router ignores the `hashchange` its own replace fires (PLAN §11), where roslambo used `history.replaceState`, which D-38 bans; Practice, which never sets the fragment; the canary before Propose and Join (D-23); the leave guard (§1.49) and the tab lock (§1.34); the screens' focus rules of Q-17; the announcements log, one for each match ID, kept from the match's opening until another opens, so Results and a spec read what Pre-match and Match showed (§1.40); the stage re-created at once behind Home when Settings changes the render quality there (§2.8); and the page's devices and sound, made once at start-up and lent to each pitch screen (§1.63).

#### 1.42 `src/ui/screens/screen.ts`: new (shell)

roslambo's `Screen`: `{ el: HTMLElement; frame?(nowMs: number): void; dispose?(): void; ui?(c: UiCommand): void; readonly name: ScreenName }`. On each change the app focuses the screen's first focus target: its `h1`, or Ready on Pre-match and Play again on Results (Q-17).

**A button that can't act yet keeps the focus.** It's marked `aria-disabled="true"`, with a label that says why ("Joining…", "Starting…"), by `setEnabled` (§1.39), never `disabled`: a disabled button refuses the focus, so the app's focus on entry would land on the body, and the nav, which presses only the focused button, would press nothing once it enabled. ButtonNav (§1.46) and a click both ignore a marked button. So Ready is focused from Pre-match's entry, while Practice's person or a joining player isn't yet in the final roster, about 15 ticks, and Enter or Start presses it once it can act; and when the start countdown locks the roster, the focus stays where it was. A screen reader hears the reason, and Playwright's `toBeDisabled()` reads `aria-disabled` as it reads `disabled`.

#### 1.43 The screens: `src/ui/screens/*.ts`: new

Each exports one factory taking a host interface of callbacks, roslambo's pattern, so the app wires them and the screens import no app state:

| File | Exports | Owner |
|---|---|---|
| `home.ts` | `homeScreen(h: HomeHost): Screen`; `HomeHost { profile; propose(); join(id: string); practice(); settings() }` | shell (name, coat, Practice, Settings); net-screens adds Propose and Join with a code |
| `practice.ts` | `practiceScreen(h: { start(s: MatchSettings): void; home(): void }): Screen` | shell |
| `pitch.ts` | `pitchScreen(h: PitchHost, layers: readonly LayerFactory[]): Screen` (Pre-match and Match: §5.7, §5.8). It awaits `stage.ready()` before its first frame, saying "Getting the pitch ready…" until then; once an animation frame it calls `view.frame`, `stage.draw`, `controls.frameDrawn` and each layer's `frame`; after each timer run `view.run`, then each layer's `run`, and only then its own moves, to Match or Results, so a layer sees the run that ended the match, the end whistle's among them | shell in phase 1; net-screens in phase 2 (networked Pre-match and Match, `PitchContext.graphics`); robust in phase 3 (the rebuild when the menu closes) |
| `menu.ts` | `matchMenu(h: { practice: boolean; resume(): void; settings: (() => void) \| null; leave(): void }): Layer` (name `menu`) | shell: Resume in Practice, and Leave; phase 1 passes `settings: null`, so its menu has no Settings; settings adds the Settings button and its panel in 2a |
| `results.ts` | `resultsScreen(h: ResultsHost): Screen`; `ResultsHost { end: ConfirmedEnd; practice: boolean; me: string; againSeen(): boolean; summary(): MatchNetSummary; playAgain(): void; home(): void; clock: Clock; announce(a: Announcement): void }`, each press announced with its time since Results showed and whether the guard took it | shell; results-hud adds the networked rows and the readout |
| `propose.ts` | `proposeScreen(h)`, `createdScreen(h)` (link, code, Play in A or B, Watch, Leave) | net-screens |
| `join.ts` | `joinScreen(h)` (Connecting…, then the packs and Watch) | net-screens |
| `invite.ts` | `invitePanel(matchId: string): HTMLElement` | net-screens |
| `message.ts` | `messageScreen(m: MessageSpec): Screen`; `MESSAGES: Record<MessageCode, (…) => MessageSpec>` | results-hud |
| `readout.ts` | `summaryPanel(s: MatchNetSummary, t: TimelineStats): HTMLElement` (with Copy, M3-Q24; a refused clipboard write is caught, §5.9) | results-hud |
| `settings.ts` | `settingsScreen(h)`, `settingsPanel(h): Layer` | shell: a minimal screen with render quality, applied at once by re-creating the stage behind Home (§2.8), start in ball view, the calmer camera and Back; settings: all of §6 |

#### 1.44 `src/ui/hud.ts`: new (shell in phase 1; results-hud in phase 2)

`hudLayer(h: PitchHost): Layer` (name `hud`): the score in each pack's colour and pattern with your pack marked, the clock and overtime, the countdowns and "Go!", the scorer's name and "Goal taken back", a player's zoomies meter and pounce wait, a spectator's follow choice, and the graphics note from `PitchContext.graphics` (§5.8). It announces each countdown, goal and withdrawal to the app's log as it shows them (`host.announce`). Every piece of its text sits on an opaque backing in the look's colours, so axe judges its contrast against a known colour rather than reporting the canvas behind it as incomplete (§5.14).

**Phase 1's** (shell): the score, the clock, the countdowns and "Go!", and a player's zoomies meter and pounce wait (L167), since without them E and Shift look broken when D-10 drops a pounce in its wait or C-20 locks zoomies out on an empty meter. **Phase 2's** (results-hud) adds the scorer, "Goal taken back", the follow choice and the graphics note. The sound prompt is the sound layer's (§1.27), not the HUD's.

#### 1.45 `src/ui/overlay.ts`: new (shell in phase 1; effects in phase 3)

`overlayLayer(h: PitchHost): Layer` (name `overlay`): DOM marks positioned each frame from `FrameOut`, `aria-hidden`, since the HUD says the same (M4-Q10), each label on an opaque backing (§5.14). **Phase 1's** (shell): your terrier's mark, a chevron that needs no colour to see (L52); the off-screen ball's arrow at the canvas's edge, inside the safe area (D-28, L90), the one way to find the ball when chase view faces away from it; and a bark mark over every terrier the frame's drawer input shows barking (L50, §2.5), yours from the press and the bots' from their recorded inputs, each counted in the announcements' `barksShown`. **Phase 3's** (effects): names over the others when Settings says so, as text (L224), clipped at 12 characters as roslambo's labels are; the away mark over a terrier that sits (L167).

#### 1.46 `src/ui/nav.ts`: new (shell)

```ts
export class ButtonNav {
  constructor(buttons: () => readonly HTMLButtonElement[],
    o?: { guardMs?: number; shownAtMs?: number; clock?: Clock;
          onPress?: (atMs: number, source: InputKind | 'pointer', accepted: boolean) => void });
  /** Q-17: up, down, left and right move the focus among the buttons, aria-disabled ones included; press
   *  activates the focused one unless it's aria-disabled, and a repeat never does; on Results only a press
   *  that began guardMs after it showed, a pointer's included (M4-Q26); each press reported to onPress. */
  ui(c: UiCommand): void;
  focusFirst(): void;
}
```

#### 1.47 `src/ui/frame-loop.ts`: new (slice; frames adds the governor in phase 2b)

```ts
export class FrameLoop {
  constructor(o: { frame: (nowMs: number, dtMs: number) => void; clock: Clock; stage: Pick<Stage, 'setScale'> });
  start(): void; stop(): void;
  /** After each timer run: its time, and the match's own() figures (§1.37), for the governor (§8.2). */
  timerRan(nowMs: number, own: Readonly<OwnFigures> | null): void;
  inspect(): Inspection['frames'];
}
```
One `requestAnimationFrame` loop for the page, which runs only while a pitch screen shows. **Phase 1's** (slice) has the governor's last step alone: while the last timer gap passed `drawingLateTimerMs`, it draws every other animation frame, so a starved timer gets the thread back with no scale plumbing (R-3). **From phase 2b** (frames) the whole governor (§8.2): it lowers the stage's scale, then skips every other frame, when slow frames cost the page inputs or the timer its time, and steps back after 3 s with neither; each action logged in `frames.log`. Its steps are tested in virtual time with `clock-testing.ts`'s fakes (`src/ui/frame-loop.test.ts`).

#### 1.48 `src/ui/phone.ts`: new (devices, phase 2)

```ts
export function isPhone(): boolean;    // a coarse pointer and a shorter side under phoneShortSideCssPx (D-30)
export function turnPromptLayer(h: PitchHost): Layer;   // upright on Pre-match and Match, spectators too; Play full screen on Android
export class WakeLock { want(on: boolean): void }       // Pre-match, Match, and Propose until someone joins (D-30)
```
The wake lock, Play full screen's fullscreen request and its orientation lock each catch their refusal, which headless engines and many phones give, and report it through the turn prompt's `inspect()`, never as a console error or an unhandled rejection (§9.1's guard).

#### 1.49 `src/ui/leave-guard.ts`: new (net-screens, phase 2)

`installLeaveGuard(target: Window): { set(active: boolean): void }`: registered once at start-up, before any room exists, so its `beforeunload` listener is the window's first. While active (Pre-match and Match, Practice's too, M4-Q30), it calls `preventDefault()` and sets `returnValue`, which asks, and `stopImmediatePropagation()`, which keeps the event from every later listener on the same target. Trystero's is one: `@trystero-p2p/core`'s room.mjs adds it to the window with `addEventListener('beforeunload', …)`, and `stopPropagation()` would stop only other targets' listeners, not it. So Trystero doesn't leave the room while the player decides, and a page that goes leaves on `pagehide` (`src/net/trystero.ts`, M3-Q20, D-30). Tested on Node's own `EventTarget`, whose dispatch follows the DOM's, not on a hand-made fake, and through the real page, a connected page's prompt dismissed and its peers kept (§9.3's `room.net.spec.ts`).

#### 1.50 `src/ui/canary.ts`: new (net-screens, phase 2)

`canaryOk(): boolean`: `canaryHash()` once, compared with `CANARY_EXPECTED` from `src/canary-expected.ts` (§1.54); computed once start-up's `prepare()` has finished, so the two don't share a long task, and on demand if Propose or Join comes first (D-23). Practice never asks it.

#### 1.51 `src/ui/game.ts` and `src/ui/practice.ts`: unchanged but for `PracticeGameOptions.P?` and `B?` (feel, phase 4)

### Pages, bench, build, dev and tests

#### 1.52 `src/main.ts`: changed (slice in 1c; frames in 2b)

From 1c it re-exports `Inspection` and `TerriestTest` from `src/ui/inspect.ts` (e2e imports them from here), in place of M1's own. Routes `#test=determinism`, `#test=net` and, from phase 2b, `#test=frames` to their chunks, each with its own landmark and no `#app`. Otherwise, in this order (§5.1, M4-Q38): makes the stage (W without WebGL 2); makes `<main id="app">` holding `#stage` and `#screen`, on the normal page only, as M1 made `#pitch`, so a test page never shows a second main landmark; opens the stores; builds the App and awaits `app.start()`, which from phase 2 takes the tab lock, shows the first screen, calls `boot.started()` and starts `prepare()` behind it; and adds `inspect()` and `hashAt()` to a spec's hook.

#### 1.53 `src/frames.ts`, `src/bench/virtual-room.ts` and `src/bench/witness.ts`: new (frames, phase 2b)

The `#test=frames` page (PLAN §16's frame-time run, M3-Q14): the real pitch screen, stage and NetGame, over the networked `Match` adapter net-screens wrote in 2a, with seven virtual peers on the page.

```ts
// src/bench/virtual-room.ts
export interface VirtualRoomOptions {
  readonly peers: number; readonly seed: number; readonly latencyMs: readonly [number, number]; readonly jitterMs: number;
  readonly build: string; readonly capacityPerSecond: number | null;   // the shared delivery's (§8.3), null unbounded
  readonly holdAtMs: number | null; readonly holdMs: number;          // the forced repair (M3-Q14)
  /** false for the frame-time run: the peers vote the page's own final hash (M4-Q16). true for the forced
   *  repair: a real Session and timeline in a module Worker votes and answers STATE_REQ with a real STATE. */
  readonly witness: boolean;
}
/** A TransportFactory for NetGame.open. Seven virtual players, their TICKs encoded on the page from their
 *  brains on the page's drawn head; each due message delivered to the page in a task of its own, a
 *  MessageChannel post, as a data channel fires one event per message, so the burst after a hold is many
 *  tasks with frames between them, not one long one. Without a witness each TICK votes the page's own
 *  final hash for its newest final tick, as honest peers' agreeing votes would; with one, the witness's. */
export function virtualRoom(o: VirtualRoomOptions): TransportFactory & { report(): RoomReport };
export interface RoomReport {
  readonly calls: readonly { at: number; ms: number; kind: string }[];   // the page's own message and timer calls
  readonly backlog: readonly number[];                                    // the queue's every second, by link and summed
  readonly roomMs: { readonly total: number; readonly p95PerTick: number };   // the room's own work on the page: brains, encoding, delivery
  readonly witness: 'none' | 'worker';
}
// src/bench/witness.ts: the Worker's module, a Session over a MessagePort: the page's TICKs and the other
// players' come in by postMessage, and its TICKs and STATE go back to the room's queue for the page.
// src/frames.ts
export interface FrameReport { /* the verdict; frame intervals p50, p95, p99 and max; frame work; timer runs' cost and gaps;
  every sender's ticks sent and skipped (§1.37); the clock's samples taken and dropped and the kept samples' age; the repair's
  calls and the STATE's adoption alone; the room's own time; drawer counts and the model's state; programs, geometries and
  textures at start and end; the governor's actions; sample-to-screen latency; the time to Home and to prepared; the
  machine's load before and after (§8.4); pass */ }
export function run(boot: Boot): void;
```
- **Its parameters,** in its own fragment, as a test page may (M4-Q4): `seconds`, `quality`, `frameMs` (a busy wait in each frame, §8.1), `capacity`, `repair=1` (the witness and the hold, with `holdAt` and `hold`), and `model=<path>`, a same-origin relative path only, with no scheme, no `//` and no `..`, which the bench passes to `stage.setModel` before its measured window opens, judging frames only once the swap is done (R-8). A normal page takes none of them.
- **Its verdict** (L286) is given only for a run with no witness whose governor never acted (§8.2); a repair run reports its frame intervals beside its calls, and decides nothing by them.
- **The witness's Worker** is same-origin, a chunk of its own, so the CSP's `script-src 'self'` covers it; nothing imports it (§1.55), and only `repair=1` makes it.

#### 1.54 `src/canary-expected.ts` and `scripts/build-inputs.mjs`: new and changed (net-screens, phase 2a)

`src/canary-expected.ts` exports `CANARY_EXPECTED` from a define, `__TERRIEST_CANARY__`, which it declares itself and which `scripts/build-inputs.mjs`'s new `canaryOf(root)` reads from `src/core/sim/goldens.json` at build time; `vite.config.ts` and `vitest.config.ts` define it beside `__TERRIEST_BUILD_INPUTS__`. Only `src/ui/canary.ts` imports it, so no other config needs the define, and `src/build-info.ts` stays as M3 left it: `dev/corrections.vitest.config.ts` loads `build-info.ts` and defines only the build inputs, so a top-level read of an undefined canary there would throw at import (completeness-F24). The page's module holds the canary's hash alone, never the goldens (D-23, M4-Q5).

#### 1.55 `eslint.config.mjs` and `scripts/eslint/config.test.mjs`: changed (slice in 1c, for `dist-play/`'s ignore; model in phase 3)

The `terriest/lazy-imports` rule gains four targets, each with a fixture in the config test: `src/render/drawers/model.ts` only by `import()` from `src/render/model-loader.ts`; `three/addons/loaders/GLTFLoader.js` and `three/addons/utils/SkeletonUtils.js` only from `src/render/drawers/model.ts`; `src/frames.ts`, `src/determinism.ts` and `src/nettest.ts` only by `import()` from `src/main.ts`; and `src/bench/witness.ts` imported by nothing, since `src/bench/virtual-room.ts` names it only in a Worker's `new URL('./witness.ts', import.meta.url)` (§1.53).

#### 1.56 `vite.config.ts`: changed (net-screens in 2a for the define; budget in phase 3; look-book in phase 4 for the dev middleware)

`build.rolldownOptions.output.codeSplitting.groups`, in this order, since rolldown takes groups of one priority in turn and a module the first captures is no longer the others': `three` first, testing `node_modules/three/build/`; then `drawer-code`, testing `src/render/drawers/` but not `model.ts`, with `includeDependenciesRecursively: false`, so it holds the drawer's own code and not the modules it imports, `src/config.ts`, the look and the simulation's params, which rolldown 1.2.16 would capture by default; and with that off, as rolldown's documentation advises, `preserveEntrySignatures: 'allow-extension'` and `output.strictExecutionOrder: true`, whose cost to the chunks' sizes shows in the plugin's table. Then the chunk-budget plugin (§1.57); the canary's define; and in `serve` mode only, a middleware that answers `dev/standin.glb` with `makeStandin()`'s bytes, for the look book and the owner's bench run with the stand-in (§1.60, §8.4).

#### 1.57 `scripts/chunk-budget.mjs` and its test: new (budget, phase 3)

```js
/** A Vite plugin: in generateBundle, each chunk's and asset's size, minified and brotli at quality 11 by
 *  node:zlib, as M0 counted; the drawers' lines against config's budget; the build fails over one, and
 *  fails a group that holds a file outside its rule. */
export function chunkBudget(o: { budget: { downloadBytesPerWay: number }; log?: (line: string) => void }): Plugin;
export function lines(bundle): { name: string; bytes: number; brotli: number; files: string[] }[];   // for the test
```
It writes no file into `dist/`, where a manifest fails the dist audit (PLAN §12), and prints its table, which the gate's log keeps. **Each line holds only its own files:** in every build, `drawer-code`'s files must all be under `src/render/drawers/`, none of them `model.ts`, and `three`'s all under `node_modules/three/build/`, or the build fails naming the stray file; so a grouping that captured shared code fails the gate rather than flattering the drawer's line (feasibility-F6). The check runs in the build, not in a unit test, since the gate's unit stage runs before its build. Its test runs the plugin on synthetic bundles: a line over budget, and a group holding a stray file, each failing.

#### 1.58 `scripts/make-standin.mjs` and its test: new (model, phase 3)

The spike's generator, byte-identical each run, with M4's changes: the clips of §2.4's convention, `barking`, `celebrating` and `pushing` among them; a markings mask in the `fur` texture's alpha; UVs on the bandana for the stripes' hook; both primitives skinned to one skeleton. `makeStandin(): Uint8Array` and `readGlb(bytes)`. Never in `dist/` (CLAUDE.md, C-33).

#### 1.59 `index.html` and `public/boot.js`: changed (slice; devices in phase 2)

`src/main.ts` makes the app's landmark, `<main id="app">`, on the normal page only (M4-Q1), holding the stage's box `#stage` and the screen's `#screen`; `index.html` holds no `#app`, so a `#test=` page, which makes its own landmark, never shows two. Its inline style's `#pitch` rules become `#app`'s: hidden until `html[data-boot="started"]`, and `#stage canvas` filling the window. Phase 2 opts in to `viewport-fit=cover`, and the app pads its messages and frames the pitch inside the safe-area insets itself (D-30's M1 note). boot.js is unchanged: the loading message's `main` goes at `started()`.

#### 1.60 `dev/look-book.html` and `dev/look-book/*.ts`: new (look-book, phase 4)

Dev only, served by `npm run dev`, never built (PLAN §12, Q-11): samples of `Look` side by side, driven by live seeded scenes (a bot match, a push for the side view) and by a dropped recording (`dev/tuning/recording.ts`'s format), through the drawer interface; each sample at the phone's landscape 915 × 355 CSS px with terriers 5, 10 and 20 m from the camera, at both qualities, its counts against the budget and the palette's verdict beside it, by `src/render/palette-check.ts` (§1.12); the stand-in model checked the same way, from the dev server's `dev/standin.glb`. **A look of its own** (L15, PLAN §12): the samples are made to the rule that no name, term or look comes from the game in the pitch line, and the settle's review holds the screens' wording to it too (§12's 4c). `dev/look-book/model.ts`'s pure parts have a test in the gate, as the tuning page's model does.

#### 1.61 `dev/feel.html` and `dev/feel/*.ts`: new (feel, phase 4)

Dev only: Practice through the real screens, with sliders for the cameras' settings (§10), the five feel values Q-10 names for M4 (turn rate, acceleration, pounce, bowling speed, tumble guard), and the bots' two levers Q-9 names, `botReactionSeconds` and `botAimNoiseDegrees`, through `PracticeGameOptions.P?` and `B?`; and Copy settings by `dev/tuning/model.ts`'s snippets. A changed feel value is a simulation change, and a changed bot lever moves what Q-9's marks measure: Copy says beside its snippet that the goldens are emitted again, or the marks run again, or both (§3.5). The owner's tool for the attended steps (§14); the provisional settle doesn't need it.

#### 1.62 End-to-end: `e2e/lib/*.ts` changed and new; the specs (§9)

- `e2e/lib/page.ts` (changed: slice in 1c, devices-int in 2b, net-int in 2d, budget in 3b): `installHook(page, fields?)`; `seedStorage(page, { profile?, settings? })`, an init script that writes each of A.3's keys only when it's absent, so a reload reads what the page stored and never the seed again, the gate's low quality and a fixed player ID arriving as a player's stored choice would (M4-Q4); `smallViewport`, 640 × 360; `waitForScreen(page, name)`; `acceptLeavePrompt(page)`; `holdKey(page, code)` and `releaseWhen(page, predicate)`, which poll the hook every 50 ms, never on animation frames; and `mountDist`, answering by `e2e/lib/serve.mjs`'s MIME map, `.css` among it, in place of its own three types, so a stylesheet would never be served as `application/octet-stream` under `nosniff` (completeness-F6), though M4's styles ship inside its modules (§0).
- `e2e/lib/gamepad.ts` (new, devices): an init script stubbing `navigator.getGamepads` with one standard pad, and `press(page, button)`, which holds a button until `inspect().gamepad.presses` counts it, then lets go (§16); the pad's figures are at Inspection's top level, so it presses on Results and Home as on the pitch.
- `e2e/lib/touch.ts` (new, devices): the stick and the buttons by CDP touches.
- `e2e/lib/standin.ts` (new, model): routes `**/standin.glb` to `makeStandin()`'s bytes, optionally delayed or aborted, and sets `modelUrl: './standin.glb'` in the hook; `frames.run.ts` serves the bench's `model=` the same way.
- `e2e/lib/browsers.ts` (changed, net-int): `openAppPage(b, engine, base, relay, o)` for the screens, as `openNetPage` is for `#test=net`: the hook with `relay` and `ice: 'local'`, storage seeded, a 640 × 360 viewport, the page watched.

#### 1.63 The extension points: new (stage and shell in 1b, slice in 1c; filled by their later owners)

Files that exist only so that parallel builders never share one (§12's "Extension points"):

| File | Written by | Exports | Filled by |
|---|---|---|---|
| `src/render/effects.ts` | stage, 1b, a stub | §1.17's `createEffects(scene, look, detail, capacity, pitch): Effects`, drawing nothing | effects, phase 3 |
| `src/render/fade.ts` | stage, 1b, a stub | §1.17's `fadeVariants` (the material as both variants), `setFade`, `crossesFade` (never) and `fadesAt` | effects, phase 3 |
| `src/render/model-loader.ts` | stage, 1b, a stub that never loads; `scene.ts` asks `ready()` each frame from phase 1 and swaps in the drawer it returns | `createModelSlot(o: { look: Look; capacity: number; compile: (d: TerrierDrawer) => Promise<void> }): ModelSlot`; `ModelSlot { request(url: string): void; ready(): TerrierDrawer \| null; readonly state: RenderInfo['model']['state']; readonly ms: number \| null; readonly error: string \| null }` | model, phase 3 |
| `src/render/graphics.ts` | stage, 1b, a stub; the pitch screen wires `stage.onGraphics` to `PitchContext.graphics`, Practice's pause and the 5 s message from phase 2 (net-screens), so phase 3 only makes it fire | `watchContext(canvas: HTMLCanvasElement, on: (s: 'lost' \| 'restored') => void): () => void`; `rebuildRenderer(o: { quality: RenderQuality; old: HTMLCanvasElement; scene: Scene; nextFrame: () => Promise<void> }): Promise<{ canvas: HTMLCanvasElement; renderer: WebGLRenderer } \| null>`, compiling one material a frame (M4-Q41); the stub reports nothing and re-creates at once | robust, phase 3 |
| `src/ui/layers/index.ts` | slice, 1c | `pitchLayers(host: PitchHost): Layer[]`, composing the five files below in order | — |
| `src/ui/layers/{hud,net,devices,sound,effects}.ts` | slice, 1c: `hud.ts` with phase 1's HUD, overlay and menu, the other four empty | `LAYERS: readonly LayerFactory[]` | results-hud, net-screens, devices, sound (phase 2), effects (phase 3) |
| `src/ui/devices.ts` | slice, 1c | `pageDevices(host: DeviceHost): PageDevices`, made once at start-up, so the pad outlives every screen: `PageDevices { list(): readonly Device[]; gamepad(): GamepadInspection \| null; dispose(): void }`, the keyboard alone in phase 1; `DeviceHost { clock: Clock; mirrored(): boolean; sampling(): boolean; ui(c: UiCommand): void; used(k: InputKind, c: Control): void; uiActive(): 'pitch' \| 'spectator' \| 'menu' \| 'results' \| 'other' }`, `sampling()` true while this page's input is being sampled (a player on a running pitch screen, no menu, not paused), so the gamepad knows when to run its own timer | devices, phase 2 |
| `src/ui/screens/settings.ts` | shell, 1b, a minimal screen (render quality, start in ball view, the calmer camera) | §1.43's | settings, phase 2 |
| `src/ui/style.ts` | shell, 1b | `addStyle(css: string): void`, each CSS text added once, as one `<style>` | — |

#### 1.64 Records: `docs/acceptance.md`, `README.md`, `CLAUDE.md`, `PLAN.md`, `.github/workflows/check.yml`: changed

- **CLAUDE.md:** its boot-page bullet (M4-Q1 and M4-Q38: the landmark is the app's, made on the normal page only, and `started()` comes once the first screen shows, the compile behind it), its test-hook bullet (M4-Q3's two fields) and its drawing bullet (M4-Q35's list of what drawing keeps).
- **README.md:** Run gains `npm run play` (M4-Q40) and Practice; Test, the lock for builds and specs when sessions share the checkout; the "until M4" notes go from Run, Test and Privacy.
- **docs/acceptance.md:** the frame-time run's method and its log; the bench's figures; M4's checks by hand and their provisional settles (§14); each M5 device run's method with its pending row: the three devices by link and by code, playing to the end with each peer's readout copied from Results, the Pixel 8a's frame-time run at the quality phones start with (D-33), real touch, Firefox and Edge for Android each playing a Practice match and Firefox one networked match (L236), the gamepad, and real Safari if the device round names one (Q-12), as PLAN §17's M5 lists them; the review of every screen's and message's wording against L15, beside the look's pick; and the gate's wall time.
- **.github/workflows/check.yml:** M4-Q37's matrix, whose first run is the owner's next push.
- **PLAN.md:** M4's amendments, each marked M4.
- **Who writes what:** contracts adds A.4's and A.5's rows in 1a; slice the CLAUDE.md and README bullets phase 1 changes, in 1c; net-int the networked screens' notes, in 2d; settle the rest, in 4c.

---

## 2. The drawing (D-27, PLAN §12, L345)

### 2.1 The scene and the stage

- **What's in it** (PLAN §12): M1's pitch (grass with its procedural texture, each half and its goal in the colour and pattern of the pack that defends it, the halfway line and centre spot, padded walls, cut corners, the rope net), its lights; the ball (§1.7); a blob shadow under each terrier and the ball (§1.8); the terrier drawer's object (§1.2); from phase 3 the dust pool and the netting's bulge (§1.17). Metres, z up, the pitch's pieces from `src/core/sim/pitch.ts`, so the pitch drawn is the one played on (D-4).
- **One context, one canvas:** `createStage` makes the page's only WebGL 2 context, with MSAA as the quality says (D-33), `alpha: false`, `powerPreference: 'high-performance'`, as M1 does. No context means `null`, and `src/main.ts` calls `boot.noWebGL2()` (D-30). The canvas fills `#stage`, which fills the window on the pitch screens (D-30's desktop rule); every draw checks its CSS size and the pixel ratio, capped by the quality (`pixelRatioMax`) and scaled by the governor (§8.2), and resizes only on a change. `RenderInfo` reports the cap and the scale apart, so a spec checks the buffer by the scale it reads (§9.1).
- **Before play, behind Home** (PLAN §12): the app shows its first screen and calls `boot.started()` first, then starts `prepare()` behind it (§5.1, M4-Q38). `prepare()` builds every mesh, pool and material a match can use, at the current quality: the code-built drawer at full capacity with both bandanas and the pack cue, the ball, the shadows, the pitch, each occluder in its opaque and its dithered variant (§2.6), the bulge's hook, the dust. Every instanced part, shadow and dust puff is given instances for this, the drawer drawing a full-capacity frame of placeholder terriers, so no mesh is skipped for a count of 0. It runs `renderer.compileAsync(scene, camera)`, then one render with frustum culling off, so every geometry and texture is uploaded (D-27's M0 note), records `firstFrame`'s counts, and hides the placeholders. No match is running then, so its one long task starves no timeline: a `#join=` link opens its room at once, but its timeline starts only once a STATE is adopted. The pitch screen awaits `stage.ready()` before its first frame, saying "Getting the pitch ready…" in the rare case it hasn't finished; the hook reports `startMs` and `render.prepareMs`, which phase 1c measures in each engine, alone and with four pages at once, so the specs' start timeouts come from them (§9.1). A model that loads later goes the same way before it replaces the code-built terriers (§2.10); a rebuild or a restore, which can come mid-match, compiles one material an animation frame instead (§2.8, M4-Q41).
- **The frame loop is the app's** (§1.47): the pitch screen's `frame` asks `MatchView.frame` for a `StageFrame` (§1.16) and hands it to `stage.draw`, which places the camera, poses the ball, the shadows and the terriers, sets the fade and the bulge, renders, and returns the projections for the overlay. Off the pitch screens the loop stops and `#stage` is hidden, so Home, Settings, Propose, Join, Results and the messages draw nothing (M4-Q9). That's the difference from M1, whose page drew the empty pitch on every frame.
- **The overview camera** (M1's spectator fit) draws the empty pitch: `prepare()`'s first frame, and a pitch screen's view until its match's state arrives.

### 2.2 Each frame: the drawn state (PLAN §12's "Each frame")

The predicted state one tick behind the newest, interpolated by the tick's fraction, plus D-16's offsets:

1. **The two states:** `prev = timeline.prevHead`, `head = timeline.head`, `f = timeline.alpha(now)`. `alpha` is the clock's fraction past the head's tick, 1 while the head is held behind the clock, as during a spread (D-11's M3 note).
2. **`interpolate(prev, head, f, prevShift)`** (§1.13): positions and velocities linearly; headings, gaits, the overhead reference and the last push's direction the short way round (binary angles); discrete fields (the phase, a terrier's animation and its start, the ticks of its contacts and landings, the timers) from the nearer state, so a phase that starts at the head's tick shows from halfway through the tick before, as the spike does; the drawn time `head.tick − 1 + f`.
3. **Several ticks apart:** a timer run that moved the head on k > 1 ticks at once (a catch-up, or the end of a hold) leaves `prevHead` the head from before the run, k ticks back (the timeline's `expose`), so the fraction is spread over them, `f′ = (k − 1 + α) / k`, and the drawn time is still the head's tick less one plus α, the bodies moving on as if the k ticks were one; the rig's yaw is drawn by the same `f′` (§3.1); a hold's release beyond that is the smoother's (§2.3).
4. **No interpolation, the head drawn as it is,** when a kickoff placement lies anywhere between them, `prev.tick < head.phaseStart ≤ head.tick` with the head in a countdown, so a placement inside a k-tick jump is caught as one at the head's own tick is, and terriers never glide across the pitch to their spots (D-16: "dropped at a kickoff reset rather than smoothed across it"); and for each terrier that wasn't in `prev`, or whose spot or pack changed there (an arrival, a switch).
5. **The offsets,** from phase 3 (§2.3): `Smoother.apply(drawn, behind, now)`, where `behind = clock(now) − headTick − 1`, positive only while the head is held.
6. **The drawer's input** (§1.2): each drawn terrier with its layers and overlays from `Blends` (§2.4), its bark (§2.5) and its celebration (§2.5), and `mine` for this viewer's.
7. **The camera** (§3): the rig's yaw, interpolated between `prevYaw` and `yaw` by `f′`, aimed at the drawn poses (D-16: "cameras aim at the drawn poses").

**The drawing clock.** Every time the drawing keeps, a blend's fade, an overlay's fade in, a glide, a dust puff's age, the ball's roll, runs on the drawing clock, `MatchView.drawMs`: the page clock less the time the match was paused, advanced in a frame only while `Match.paused` is false. Practice paused for its menu stops the timeline's clock, so `alpha` stops, and the drawing clock stops with it: play, the clock, the animations and their fades stand still together (Q-15, L158), while the pitch keeps drawing under the menu. A networked match never pauses, so its drawing clock is the page's.

Practice has no remote inputs and no corrections, so phase 1, without the smoother, draws it exactly.

### 2.3 The glide (D-16 at M3's values, phase 3)

`smoothingMs` 200 and `ownSmoothingMs` 100 (A.4, M3 by measurement). M4 builds it from M3's `Correction` (`tick`, `from`, `before`, `after`, `repair`), which the timeline fires for every re-simulation that recomputes the drawn head's tick (D-16's M3 note), and which `Match.subscribe` fans out to the view. Every time below is the drawing clock's (§2.2).

- **The offset:** for each body in both states, by ID (the ball as `'ball'`), `before − after` in position and in heading (the short way), added to what's left of the body's offset, which then decays linearly to nothing over its glide from now: `offset(t) = offset₀ · max(0, 1 − (t − t₀) / T)`. Linear, so a correction glided over T moves the drawn body at most `size / T` faster than the simulation, which is the bound M3's rule 2 chose T by (research/corrections/REPORT.md §1.9). T is `ownSmoothingMs` for this viewer's terrier alone and `smoothingMs` for everything else.
- **Bodies in contact share one decay** (D-16): the contact groups are found in `after`, geometrically, from the bodies' centres, any two within the sum of their radii plus 1 cm, joined transitively. A group shares one offset vector and one decay, restarted at the correction, so a corrected push never draws the pusher inside the ball or apart from it: the ball's offset if the ball is in the group, else this viewer's terrier's if it is, else the members' mean. Its T is `ownSmoothingMs` when the group holds this viewer's terrier and no remote terrier, and `smoothingMs` otherwise (M4-Q15). So your own push of the ball glides at 100 ms, where its feel matters most, and every member stays within rule 2's limits: the ball's steady p95s at their intervals' upper ends, 0.217–0.248 m, are 2.2–2.5 m/s over 100 ms against rule 2's 3 m/s, and only the remote terriers' headings, 56.3–60°, need the 156–167 ms that 200 ms covers (research/corrections/REPORT.md §2.1–§2.2). A member whose own offset differed moves by the difference at once: that's the price of the rule, and for a push the members' corrections are nearly equal.
- **Before as well as after:** a correction recomputes the head's tick, and often the tick before it too, which `prevHead` still shows. So until the head next advances, `prev` is drawn shifted by each body's `after − before` (`prevShift`), and the drawn pose is continuous at the correction whatever the fraction (M4-Q15).
- **A snap, not a glide** (D-27's M3 note): a correction whose `before` and `after` differ in their phase or in the tick that phase started is drawn at once: every offset is dropped. That's most often a kickoff placement shown a tick early or late after a late Ready or input moved a countdown or a goal, which M3's measurement reported apart for this reason. Also dropped: when the timeline held is another (a merge or a rejoin adopts a STATE into a new timeline, which fires no correction, M3's glue); at a kickoff placement the head moves across (§2.2); and at a rebuild (D-30, D-33).
- **Clamped inside the pitch** (D-16: "The offset is clamped inside the pitch"): a body's drawn position, with its offset, is clamped inside the pitch's region (`src/core/sim/pitch.ts`'s pieces, the goals included) by the body's radius, its offset shortened to the clamped position, and the glide goes on from there. Nothing is dropped but at a snap.
- **A held head** (D-11's spread, at 14 steps a timer run: a 270-step repair holds it about 20 runs, a resync's 30 steps and a joiner's 42 about three): while `behind > 0`, each body is carried on from the head by its velocity for up to `heldHeadCarryTicks` (6, §10), the ball's height kept at or above its radius; when the head moves on, whatever separates the carried pose from the new one becomes an offset and glides, as a correction's does (M4-Q14). In Practice the clock pauses and nothing is carried.
- **Your own terrier's input** never corrects it in Practice; in a networked match its corrections are small (M3's p95 0.03–0.10 m and 12–29°), and glide over 100 ms.
- **The bench checks the values** (D-16's "M4 checks it with the bench's virtual peers", §8.4): the bench logs each correction's sizes as `correctionSizes` measures them, and the drawn bodies' speed beyond the simulation's while a glide runs, at 20–80 ms with 15 ms of jitter, against rule 2's limits, 3 m/s and 360° a second at the p95. The values stay unless that check fails; a failure goes to the owner with its figures (§14).

### 2.4 Animations from the state, with how far through them (D-9, L98, L345)

Every animation but barking, and how far through it is, is read from the state:

| Animation (L98) | From the state (D-9, A.1) |
|---|---|
| standing, running at any speed, zoomies, airborne, lunging (pouncing), tumbled, getting up, sitting | the animation phase and its start tick; running's and zooming's legs by the gait, a binary angle advanced by the distance run; running's amount by the speed |
| turning | the heading change this tick |
| jumping and landing | the take-off and landing ticks |
| pushing the ball or another terrier | the last ball contact tick and the last terrier contact tick: the pushing pose for `pushPoseTicks` after either, which keeps the head out of the ball (D-27's fit) |
| being pushed or bounced in any direction | the last push's direction and tick |
| the ball's squash and thump | its last hit's tick, strength and velocity change |
| the net's bulge | the last goal's tick and pack, and the ball's position |
| celebrating | the match's celebration phase and the last goal's pack, shown from the goal's confirmed tick (D-14, §2.5) |

- **Layers** (`Blends`, §1.15): each terrier's current `(anim, animStart)` is its newest layer; when either changes, the old one is kept as a fading layer for `animationBlendMs` (150 ms, §10), its weight falling linearly by the drawing clock (§2.2), the new one's rising, from phase 3; phase 1's stub switches at once. That's every change, the state's own (running into airborne) and a correction's: one a correction takes back blends out, one it adds blends in part-way through (its time is already `time − start` past its start), and one it moves blends to its new timing, the same animation at two starts (L208, D-27). A pose is never a function of the frame's time alone, so a rollback or a resync redraws it from the state: what the drawing keeps is only the fading layers' starts and weights.
- **The code-built pose** (§1.5) blends the layers' pose parameters by weight, then adds the overlays. **The model's** (§1.6) sets each layer's action, the clip or its clone for a second timing, its `time` from the layer's start (by the gait for running and zooming, looped for standing, held at its end for the rest, the spike's rule) and its `weight`, then `mixer.update(0)`.
- **Every animation plays in place** (L98): the drawers move and turn a terrier only by its drawn pose; the pose bends, tilts and bobs the parts about the collider's floor point.
- **The model's clip convention** (D-27's painting convention, extended, M4-Q22): one clip per animation phase, named as A.1's (`standing`, `running`, `zooming`, `airborne`, `lunging`, `tumbled`, `gettingUp`, `sitting`), and overlay clips `barking`, `celebrating` and `pushing`, each optional in a bought model, a missing one drawn as the code-built pose's fallback would, standing for a phase and nothing for an overlay; the stand-in carries all eleven (§1.58). `MODEL_CLIPS` names them, and the model drawer's info lists those missing.
- **The test** (PLAN §16): a correction that moves a pounce's start by 3 ticks moves no joint further in that frame than in the frames around it (`src/render/continuity.test.ts`, on the layers phase 3's `Blends` gives, written by the motion builder with it, §12).

### 2.5 Barks and celebrations (from phase 1)

- **Barks** (D-16, L98, L209): never in the state. `BarkTracker` (§1.36) finds a remote terrier's bark in the inputs received, never predicted ones: a bark at tick t when the inputs received for t and t − 1 are both known and their bark counts differ; the first input after a gap only sets the baseline, so a reload, a return or a join never barks (M4-Q24). A host's own bots are found the same way, from the inputs it recorded for them, so Practice's bots bark from phase 1. This viewer's own bark starts at its press, when the controls put it into an input (`Controls`'s `onBark`, `MatchView.ownBark`), so it's drawn at once, and from phase 2 heard at once (`Layer.ownBark`). The drawer gets the latest bark's start as an overlay: a mouth open and a head toss for about 0.4 s in the code-built pose, the `barking` clip on a model; and the DOM overlay (§1.45) shows the bark mark over the terrier, to everyone, since a page can't tell a muted device (L50). Phase 1 draws them at weight 1; phase 3's blends fade them in and out.
- **Celebrations** (D-14, Q-7): the scoreboard latches a goal once its tick is confirmed, about 0.4 s after it (w + v ticks). After each timer run the view diffs `scoreboard.goals`; a goal added starts the celebration of the pack it counts for, an overlay over standing and running (L98), its timing from the goal's tick, so it shows part-way through (L208), its weight rising over `animationBlendMs` from when it was latched once phase 3's blends run. It ends with the head's celebration. A goal withdrawn (C-4) takes its overlay back the same way. A browser that arrives during a celebration draws it from its arrival's latch, as the scoreboard latches it (M3's §3.5). The view composes them from phase 1, so the owner's first Practice celebrates its goals.
- **The whistles and the chorus** are the sound's (§7); the scorer's name and the score are the HUD's (§5.8).

### 2.6 Effects, occluders and marks

- **Effects** (PLAN §12; L101; phase 3): the ball squashes and thumps harder the harder it's hit (§1.7, §7); zoomies kick up dust from the drawn feet at each step of the gait, a pool of puffs that fade over half a second; a tumbled terrier rolls over and shakes itself off (the pose); a goal bulges the net, at once from the predicted state (Q-7), blended out if a correction takes the goal back (D-16). The dust is cosmetic: each puff keeps its birth time on the drawing clock, and a correction leaves puffs already made to fade.
- **Occluders fade** (D-28, L89, C-38; phase 3): a wall, the overhead net, a goal's frame or the ball between the camera and this viewer's terrier, or the spectator's followed body, turns see-through by PLAN §12's swap. Each occluder's material has two precompiled variants (§1.17): the opaque one, and a dithered one whose shader hook discards fragments in a 4 × 4 ordered-dither pattern inside a capsule round the line from the camera to the subject. An occluder draws with its dithered variant only in the frames it crosses the capsule. Both variants are opaque materials, so nothing toggles `transparent`, blends or sorts; both are compiled at `prepare`, so nothing compiles in play (M4-Q11); and the opaque one has no `discard`, so the walls and the net, which fill most of a player's view, keep a tile-based GPU's early depth tests in every other frame. The near wall and the net fade for the spectators' camera the same way. Phase 1 has no fade: in chase view the ball, a post or a crossbar can hide your terrier for a moment, which §14 tells the owner.
- **Marks** are DOM, over the canvas (§1.45, M4-Q10), positioned each frame from the stage's projections: from phase 1 your terrier's mark, a chevron that needs no colour to see (L52), the off-screen ball's arrow at the canvas's edge, pointing to it (D-28), and the bark mark over every barking terrier (L50); from phase 3 names over the others when Settings says so, as text (L224), clipped at 12 characters as roslambo's labels are, and the away mark over a terrier that sits (L167). DOM marks stay on top, so you can always find your terrier, and add nothing to the GPU's counts or its programs.

### 2.7 What drawing keeps between frames (D-27, CLAUDE.md, M4-Q35)

| Kept | Where | A rollback or a resync |
|---|---|---|
| Each body's offset, its start and its glide | `Smoother` | glides from where it's drawn; a snap drops it |
| `prev`'s shift until the head advances | `Smoother` | the correction's own |
| Each fading layer's animation, start tick and fade | `Blends` | cross-fades to the new timing |
| Each terrier's latest bark start | `BarkTracker`; your own press | unchanged: barks are received inputs |
| Each latched goal's latch time, for its overlay's weight | `MatchView` | a withdrawal blends it out |
| The drawing clock's paused time | `MatchView` | unchanged: the page's own |
| The rig's yaw | `CameraRig` | the viewer's own; aims at the drawn poses |
| The ball's drawn roll, the dust's puffs | `BallMesh`, `Dust` | cosmetic, drawing only (C-29) |

D-27 and CLAUDE.md list the first four: blends, smoothing offsets, the timings fading out and each bark's start. M4-Q35 adds the other four to the list; none times an animation, which still comes from the state with how far through it is. Nothing else is kept, and none of it feeds back: `src/render/view.test.ts` hashes the head before and after a frame is composed and drawn and finds it unchanged (P11), and in the page the hook counts any frame whose drawing changed the head's hash (§1.40's `headHashMismatches`, computed only when a spec set the hook).

### 2.8 Render quality (D-33)

High caps the pixel ratio at 2, with MSAA; low caps it at 1, without, and simplifies the effects: fewer ropes in the nets (M1), half the dust, and spheres of fewer segments for the ball (the terriers keep theirs, so the budget's triangle counts don't depend on the setting). MSAA is fixed when the context is made, so a change needs a new renderer on a new canvas:
- **From Home** (phase 1): Settings' change re-creates the stage at once, behind Home, and its `prepare()` runs again; no match runs, so its compile starves nothing. That's how phase 1 applies it, live, and how the specs set it through the real controls.
- **In a match** (phase 3, `Stage.rebuild`, M4-Q41): along the path a restored context takes (D-30), when the menu closes. three's `compileAsync` compiles every material it's given synchronously and, without `KHR_parallel_shader_compile`, blocks on the first link's status, while the timeline must keep running, so the rebuild compiles one material an animation frame, each on a one-object scene, the old canvas drawing on meanwhile; then the one-render upload, and the new canvas takes its place. A restored context compiles the same way. A networked match runs on throughout. Practice rebuilds with its menu's pause still held, saying "Getting the pitch ready…", and resumes once `rebuild()` resolves, so a long compile can't stall it into reopening the menu (D-22's M3 note: a resume measures from itself). `graphics.spec.ts` asserts no stall through each rebuild and logs its largest timer gap; the bench logs the same at 4× throttle, and the phone's at M5 (§8.4).
- **In phase 2,** before `rebuild` exists, the in-match panel's quality applies when the match closes, and says so.

The gate plays its matches at low, a real player's setting, set through Settings or stored before load (C-6, M4-Q4).

### 2.9 Coats, bandanas and the look (L43, L44, Q-11)

- A coat is its index in `look.coats` (`config.coatCount` of them, 8); a bot's is `botCoat(id, coatCount)`, seeded by its ID (D-39); a JOIN's outside the list takes coat 0 (D-12). The state, storage and messages carry only indices and packs; `coatOf(look, index)` and `look.packs[pack]` give colours and patterns, the bandana plain for one pack and striped for the other (L43).
- The code-built drawer paints a coat as instance colours, the markings index picking which parts take the marking colour (the spike's); the model drawer through `fur`'s colour and its texture's markings mask, and `bandana`'s colour and stripes (D-27).
- `PLACEHOLDER_LOOK` is the spike's eight coats and M1's pack colours until the owner picks from the look book (Q-11, §14); M5 builds the pick as the default, with the coat list fixed in `src/config.ts` (PLAN §17's M5), and the palette test runs on it then.
- The pack cue (Q-11, C-51) is a look book option, `marker` or `ring`, differing in shape between the packs and kept at a minimum size on screen; the look's default is `none` until the owner picks one, and REQUIREMENTS' L43 gains it only then (§2's row).

### 2.10 The two drawers and the stand-in (D-27, L97, L100, L252, C-33)

- **Code-built**, the default: always loaded, its chunk statically imported, drawing from `prepare()` on.
- **Model**, only when a model is named: `config.terrierModelUrl` is empty in the MVP (D-27: "a render setting, empty in the MVP"), and only the hook's `modelUrl` overrides it, so the test loads through the path a shipped model will take. `setModel(url)` imports the model drawer's chunk, loads the model, builds a drawer for the capacity, compiles it against the scene with the one-render upload, and swaps it in between two frames, disposing of nothing the code-built drawer needs to come back; until then, or if anything fails, the terriers stay code-built and nothing waits (L100). The info's `model.state` says where it is, `model.ms` how long it took, and `model.error` why it failed: the loader catches every failure, a refused request, a model without a `fur` material, a compile that throws, and reports it there alone, never as a console error or an unhandled rejection, which the guard would fail (§9.1).
- **The stand-in skinned model** is generated by `scripts/make-standin.mjs`, byte-identical each run, painted by the convention, with an embedded texture; never in `dist/`, which the dist audit fails on a `.glb` anyway; the specs make it in memory and serve it to the built page by request interception, under the shipped `_headers` for Practice (PLAN §16, C-33).

### 2.11 The drawing budget and the frame-time bench (C-2, L243, M3-Q14)

- **The budget,** PLAN §12's starting guesses, a ceiling until the Pixel 8a has run (C-2), all in `src/config.ts` (§10): a code-built terrier 2,000 triangles; a model 8,000 triangles, 32 bones and a 512 × 512 texture; 40 draw calls for 8 terriers; each way of drawing them 200 kB brotli, three not included. The page counts them through `renderer.info` and the drawer's own counts at both qualities, and the gate fails one over (§9); the build plugin counts the downloads and fails the build over one (§1.57). M0's counts sit under every figure: 1,516 triangles a code-built terrier, 9 draw calls for 8; the stand-in 2,220 triangles, 8 bones, 256 × 256.
- **The frame-time bench, `#test=frames`** (PLAN §16, §1.53): a whole 4-a-side match at the default 3 minutes, all eight terriers driven by the bot brain, this page's on its own head and seven virtual peers at 20–80 ms one way with 15 ms of jitter, each voting the page's own final hash, so the page's thread carries one timeline, as a real page's does (M4-Q16); measured from the moment all eight are in, through warm-up, the start countdown and play, to Results, with at least one goal, its celebration and a kickoff inside it; pass at p95 ≤ 18 ms and max ≤ 50 ms between animation frames, the display at 60 Hz (L286), in a run whose governor never acted (M4-Q17). With `model=` the stand-in draws the terriers, judged from its swap on (R-8). It shows its verdict on the page and in its report, beside the counts that say nothing compiled in play, the room's own time and the machine's load.
- **The forced repair, in the bench** (M3-Q14, D-11): with `repair=1`, a witness, a real Session and timeline in a module Worker, votes and answers STATE_REQ, and the virtual room holds every message to the page for 4,100 ms from 15 s into play, FIFO, as M3's cap check held them in Node, so the page loses its tallies to the witness and repairs from a STATE about 240 ticks back. The report times every call of the repair, the timer runs that step and the message call that adopts the STATE, and that adoption on its own, which was the cap check's worst call in 95 of 100 runs, while the page draws; in Chromium at 4× CPU throttle (outside the gate, §8.4) it's the browser's check of M3's 3.90 ms × 6.3 = 24.54 ms against 25 ms, whose margin was 0.46 ms. Its result goes to `docs/acceptance.md`; a worst call over 25 ms there goes to the owner with the cap's options, w + 1 = 13 being the floor (D-11). The frame intervals through it are reported and decide nothing.

---

## 3. The cameras (D-28, PLAN §12, Q-10, Q-19)

### 3.1 The rig: the yaw, once a head tick, on the timer

The yaw is the camera's heading on the pitch, radians counter-clockwise from +x, the direction the view looks. `CameraRig` (§1.10) keeps it, each viewer's own, and changes nothing in the match (L92).

- **When it steps:** `MatchView.run` is called after each timer run of the match (`Match.subscribe`'s `run`). When the drawn head has moved on k ticks since the last run, the rig sets `prevYaw` to its yaw at `prev`'s tick and steps k times with Δt = one tick, toward targets read between `prev` and `head` at j / k for j = 1 to k: this viewer's terrier's position and heading and the ball's position, positions linearly and headings the short way, as the bodies are drawn. So the yaw at the head's tick depends on the head's ticks, not on how frames batched them: anchoring in chase view reads a yaw no frame rate moves (§4.5), and the rig's unit tests step it tick by tick (§3.6, M4-Q13). A frame draws `lerp(prevYaw, yaw, f′)`, the short way, by the bodies' own spread fraction (§2.2), so the camera glides through a catch-up as the bodies do rather than jumping k − 1 steps. While the head is held, the rig holds too.
- **Chase view** (D-28): its yaw eases toward the terrier's heading with time constant τ, at most ω: each tick, `Δ = wrap(heading − yaw)`, `step = Δ · (1 − e^(−Δt/τ))`, clamped to `±ω·Δt`. τ and ω are `chaseSwingTimeConstantSeconds` and `chaseSwingMaxTurnsPerSecond`, 0.3 s and 1 turn/s, or with the calmer camera `chaseCalmerTimeConstantSeconds` and `chaseCalmerMaxTurnsPerSecond`, 0.6 s and 0.5 turn/s (A.5). A held, unmoved direction doesn't depend on either (L87), since anchoring keeps it on the pitch (§4.5).
- **Ball view** (D-28): its target is the horizontal line from the terrier to the ball (`Math.atan2` here is drawing's, PLAN §12's render-only maths), followed at up to ω, `ballViewSwingMaxTurnsPerSecond` 1 turn/s or `ballViewCalmerMaxTurnsPerSecond` 0.5, with no easing lag below the cap. While the state's `ballOverhead` flag is set, the line has no direction, so the target is the terrier's overhead reference (`overheadRef`, which the ball frame then steers by, D-7), turned toward at the cap and held; when the flag clears, the yaw turns toward the new line at the cap, never in a jump. Steering is unaffected: the ball frame reads the simulation's line, not the camera, and while the view lags the off-screen arrow points to the ball.
- **Snaps:** the yaw jumps to its target on a view's first tick, at a kickoff placement anywhere in the ticks the head moved (§2.2's test), at this viewer's terrier's arrival or switch, and when the timeline held is another; each counted in the view's `inspect()`.

### 3.2 Placement (`placeCamera`, §1.9)

- **Players' cameras** sit `cameraBehindMetres` (4.2) behind the terrier's floor point along the yaw and `cameraAboveMetres` (2.1) above it, with a vertical field of `cameraFovDegrees` (55°), the spike's (§10). Ball view looks at the drawn ball; chase view at a point `chaseLookAheadMetres` (2) ahead of the terrier along the yaw at the terrier's head height, so the terrier sits low in the view with the pitch ahead of it. The look's pitch is kept within ±60° of the horizontal, a drawing constant that keeps the aim valid.
- **Inside the pitch** (L89): `insidePitch` moves the camera inside the pitch's real region, its walls, cut corners and overhead net and each goal's back, side and top netting, by `cameraWallMarginMetres` (0.4), from `src/core/sim/pitch.ts`'s pieces, so a camera behind a terrier at a wall or in a goal comes closer rather than pass the wall or the netting. When that leaves it nearer the terrier than `cameraNearestMetres` (1.5) horizontally, as with a terrier whose back is to a wall, where the clamp would put a 4.2 m camera 0.15 m in front of its centre, or one in a goal 2 m deep, the camera rises in the yaw's vertical plane toward `ceilingAt`, under the net, or under the goal's 3 m roof inside it, less the margin, and looks down at the terrier, so it stays in view (`render.camera.raised`). A wall, the net or the ball between the camera and the terrier fades from phase 3 (§2.6).
- **Spectators** (L91, D-28): high above the near side of the pitch, outside the walls and above the net, at M1's 50° below the horizontal and 40° field, M1's drawing constants, framing a window `spectatorViewLengthMetres` (24 m) long, its centre easing toward the followed body along the pitch's length with time constant `spectatorFollowSeconds` (0.5 s) and clamped so the window stays on the pitch, and its aim following the body across. The near wall and the net fade where they're in the way. What to follow: the ball by default; a tap on a name in the HUD's list, the view key, which cycles the ball and then each terrier in roster order, or the shoulders, which go back and on (PLAN §11, §5.8).
- **The overview** (M1's fit): the whole empty pitch, for `prepare()` and before a match's state arrives.
- **Which numbers are settings** (M4-Q34, §0): every number the owner tunes with the swing on the feel page, the players' cameras' distance, height, field, wall margin, nearest distance and chase view's look-ahead, and the spectators' window and follow time (§10). The ±60° limit, M1's overview fit and its elevation and field, and the arrow's inset from the edge keep the maths and the layout valid, and stay drawing constants, as M1's camera keeps its own.

### 3.3 The off-screen arrow (D-28)

Every camera: when the ball's projected point isn't in view (behind the camera or outside the view by a margin), the overlay shows an arrow at the canvas's edge, inside the safe area, along the projection's angle from the centre (§2.6). The stage computes the projection each frame from the drawn ball.

### 3.4 Switching view (L73, L88)

A match starts in ball view unless Settings' "start in ball view" is off. The view control (C, the touch view button, the right shoulder) switches between ball and chase view for a player: the view's first tick snaps the yaw to its target, and the controls re-read the held direction (D-29). A spectator's view control cycles what it follows.

### 3.5 Tuning with the owner (Q-10)

The swing's values are A.5's starts, provisional, and the owner tunes them with the cameras at M4 (Q-10), with the turn rate, acceleration, pounce, bowling speed and tumble guard confirmed in ball and chase view. `dev/feel.html` (§1.61) is the owner's tool: Practice through the real screens, with a slider for each camera setting, for the five feel values, and for the bots' reaction delay and aim noise, Q-9's two levers, and Copy settings writing `src/config.ts`'s snippet and PLAN's rows as the tuning page's does. A change to a feel value is a simulation change: the goldens are emitted again on purpose and Q-9's marks run again (Q-10, CLAUDE.md); a change to a bot lever runs the marks again too. If the owner isn't free when M4's other exits are met, the swing is settled provisionally at its starts by §3.6's criteria, which they meet, and logged owner-pending (§14).

### 3.6 Tested without the frame rate

All in Node, stepping the rig and the simulation tick by tick (PLAN §16's cameras):
- `src/render/camera-rig.test.ts`: at both settings, ball view turns no faster than its cap and never in a jump, for a ball hopping over the terrier at 5 m/s and for one resting on terriers above it (M2's scenes, `src/core/sim/scenes.ts`); a terrier circling the ball at run speed from 3 m keeps it within the view's half-field at the phone's aspect (D-28's 0.32 turn/s against the cap); chase view's yaw converges on a held heading with its time constant and never passes ω; the snaps; and a 6-tick catch-up, whose yaw at the head's tick equals six single steps', whose drawn yaw moves by the bodies' spread fraction, and inside which a placement snaps it.
- `src/render/camera.test.ts` (M1's, extended): a player's camera stays inside the pitch behind a terrier with its back to each wall, in each cut corner, under the net and inside each goal, never nearer the terrier than `cameraNearestMetres` horizontally without rising, never above `ceilingAt`, and the terrier inside its view in each; the spectators' stays outside the walls and above the net; the off-screen arrow's angle points to a ball behind the camera.
- `src/input/sweep.test.ts` (§4.5): a stick swept 90° in 0.5 s, and in 1 s, through anchoring, the rig and the real simulation, turns the terrier within ±10% of Q-19's model, about 135° and 169° (124° and 135° calmer), and is pinned to the measured values once built, as `push.test.ts` holds its times within ±10% of their marks and pins them too, so a rig or anchoring bug that turns the terrier by the wrong amount fails the tolerance before it could become the pin.
- The fade's capsule test: a point on the line between the camera and the subject fades, one off it doesn't, and an occluder's bounds cross the capsule exactly when one of its points would (`src/render/fade.test.ts`, the shader hook's own maths in TypeScript beside its GLSL).
- End to end, only what doesn't depend on timing: the view switches on C and on the gamepad's shoulder; the camera stays inside the pitch through a Practice (`inspect().render.camera`); the arrow shows while the ball is behind the camera.

---

## 4. Input (PLAN §11, A.2, D-10, D-29)

### 4.1 One sample a sent tick

The session samples this browser's input once for each tick it sends (`session.controls`, M3), on the timeline's timer, never on an animation frame (D-31, D-29). `Match.setControls(sample, rebase)` wraps the sampler: `() => sample(t.head, t.headTick, t.localTick + d)` on the timeline held, so it reads the drawn head at that moment, as M3's scripted samplers do, and knows the tick the input is for. `Controls.sample` reads each device once (the gamepad polls there), merges them and returns A.2's u16:

- **The direction:** the device whose direction changed most recently, if it still holds one; else any device holding one. Touch and the gamepad send their stick's step; keys their exact direction.
- **Zoomies:** held on any device: Shift, the stick past its rim, the right trigger past `gamepadTriggerFraction` (§10).
- **Presses:** jump, pounce and bark each a 2-bit counter (A.2), advanced once if any device reported a press since the last sample: at most one step a sampled tick, so a burst of presses in one tick acts once, as the simulation would act on a counter that moved 2 or 3 (D-10's M2 note), and four presses never look like none (M4-Q25). A press shorter than a tick still counts: its device keeps it until the next read. A predicted input never repeats one: prediction repeats the counter's value, and the simulation acts only on a change (D-10).
- **Bark, at most one a second** (L327): a bark press within `derived.barkGapTicks` of the tick of the last bark sent is dropped and counted (`barksDropped`); the one sent starts this viewer's bark at once (`onBark`, §2.5).
- **View:** a player's press switches the view (§3.4); it never goes into the input. A spectator sends no input, so no sample reads its keys: its view key comes to the screen as a `UiCommand` (`next`), as the gamepad's shoulders do, and cycles what it follows.

A held, unmoved direction gives the same u16 tick after tick, so the timeline's prediction holds (D-10, L342).

### 4.2 Keyboard (D-29, L77)

By `event.code`, so other layouts play on the same keys (L77): W, A, S and D give eight directions, screen-relative: W up, A left, S down, D right, and their diagonals; Space jumps; either Shift is zoomies; E pounces; Q barks; C switches the view. A key held with Ctrl, Alt or Meta drives nothing, and Ctrl is never used (Ctrl+W closes the tab). Keys are released on `blur` and when the page is hidden (D-29). A key typed into a field drives nothing. Escape, Enter and the arrows are the menus' (§4.9). On Windows, the keyboard's control hint also says how to turn off the Sticky Keys shortcut (C-52).

### 4.3 Touch (D-29, L78)

The control layer over the pitch, on Pre-match and Match, for players on a touch screen: shown from the first touch (a `pointerdown` of type `touch`), hidden for a mouse.
- **The stick** on the left, or on the right with Settings' mirrored layout: its base appears where the thumb lands inside its area, the lower half of its side, at least `touchEdgeMarginCssPx` (32) from the side edge, inside the safe-area insets, clear of Android's and Safari's edge-swipe Back. Its travel is the base's radius: within `stickDeadZoneFraction` (0.2) of it, no direction; beyond the rim, zoomies, held until the thumb comes back inside it (C-20); its angle is screen-relative, its step quantised with half-step hysteresis (§4.5).
- **Buttons:** jump and pounce, large, on the other side; bark and view, smaller, above them. Each tracks its own pointers with pointer capture, so two thumbs hold two at once and a thumb that slides off still lets its button go (roslambo's `bindButton`).
- **The menu button** sits in the top corner both layouts leave free, the right one.
- **Mirrored** flips the layout, not the text: the stick and the buttons trade sides.

### 4.4 Gamepad (D-29, L79)

The standard mapping. Read each time a tick's input is sampled, on the timeline's timer; and while this page samples no input (a screen without a pitch, a spectator, the menu open, Practice paused) on its own 60 Hz timer (`gamepadPollHz`), never on animation frames, so its input doesn't depend on the frame rate (C-6). A press is a rising edge between two polls, so each counts once.
- **Play:** the left stick runs, with the stick's dead zone and steps; the bottom face button (0) jumps; the left face button (2) pounces; the right trigger (7) is zoomies; the top face button (3) barks; the right shoulder (5) switches the view.
- **Menus** (Q-17): the d-pad (12–15) moves between buttons; Start (9) presses the focused one; Back (8) opens the menu on Match and closes it again; on Results the bottom face button presses too; for a spectator the shoulders (4, 5) cycle what to follow.
- A gamepad press may not unlock the AudioContext, so the pitch says "Press a key or tap for sound" while sound is on and the context isn't running (D-32).

### 4.5 Anchoring (D-29, Q-19, C-24, L74, L75)

`anchor` (§1.24), on each sample with a direction held:
- **Ball view** sends the ball frame (A.2's frame 1) with the screen step: forward, up the screen, is the line to the ball, so W runs at it, S away, A and D circle it (L74). The simulation resolves it, the ball overhead included (D-7); the camera's yaw doesn't enter it.
- **Chase view** sends the pitch frame (frame 0). The direction is read from the screen, `step = round((yaw + θ) / (2π / 32)) mod 32`, where θ is the screen angle, when it starts from neutral, when the device's step has moved `chaseRereadDegrees` (45°, 4 steps) or more from the step last read, the circular difference, and after `viewChanged` (switching view re-reads, D-29). A smaller move turns the kept direction by the same angle: `step = readStep + (deviceStep − readDeviceStep) mod 32`. A key's directions are 4 steps apart, so every change of keys re-reads; a stick's small corrections turn the terrier with the stick, without the swing's spin (C-24).
- **The stick's steps:** `stickStepOf(angle, prev, 32, 0.5)`: the nearest step, kept while the angle stays within half a step past its edges (`stickHysteresisSteps`), so a wobble doesn't change the input (D-10, L342).
- **The vehicle-style nose frame** (D-7) isn't offered: `config.steering` is `anchored`, and `anchor` asserts it.
- **Tested:** `src/input/anchoring.test.ts`: chase view re-reads only from neutral, at 45° and on a switch of view; a smaller move turns the kept direction; ball view's steps; the hysteresis; and §3.6's sweep through the real simulation.

### 4.6 The rebase at onControl (D-10, D-17's M3 note, page-F4)

`session.onControl(base)` fires when this browser takes control of a terrier from an adopted state: a join, a return, a rejoin after a stall, a merge, with the terrier's stored previous input, or 0 for a new JOIN. `Controls.rebase(base)` starts the jump and pounce counters from `base`'s bits (A.2), the bark counter at 0 (barks aren't stored, and the bark rule's baseline skips it, §2.5), keeps what's held, and records `base` and the next sample (`firstAfterBase`) for the hook. So a page that reloads or rejoins presses nothing on its return. **Tested through the real page** in the three-engine match (§9.4): WebKit's player presses Space three times in the start countdown, where D-10 drops a jump but the input's counter still moves, so its terrier's stored input holds a jump counter of 3 without the press acting, and B's players still hold nothing as the validated setup has them (M4-Q36); then, in play, its page reloads. Once it has returned, its first input after the rebase has `base`'s jump and pounce counters, and in every page's head its terrier's take-off tick doesn't change across the return: a failed rebase, a counter back at 0 against the stored 3, would act a jump there and change it.

### 4.7 Control hints (D-29, L83)

For each kind of input, the first time it's used on a pitch screen, a panel lists its six controls, each line clearing once that control has been used; the panel goes once all six have. `HintTracker` keeps A.3's per-kind bitmask in the profile, so a cleared hint stays cleared after a reload, and Settings' "Show control hints again" clears all three (M4-Q28).

### 4.8 Releasing what's held

Every device releases on `blur`, when the page is hidden (D-29, D-31), when the menu or the Settings panel opens (PLAN §11), and while the graphics are lost (D-30). A networked page keeps sending while hidden, with nothing held (D-31).

### 4.9 Menus without a mouse (Q-17, C-34, L82)

`ButtonNav` (§1.46) takes the keyboard's and the gamepad's `UiCommand`s. On a screen with one, the keyboard prevents Enter's and Space's defaults, so a focused button is pressed once, by the nav, never also by the browser's own activation, and a held Enter never toggles Ready on and off:
- **Pre-match:** the arrows or the d-pad move between its buttons. Ready is focused from the screen's entry, marked `aria-disabled` and reading "Joining…" until the player is in the final roster (§1.42), so the focus is already on it when it can act; Enter or Start presses the focused one; a repeat never presses. Space only ever jumps there, its default prevented so it never presses a focused button.
- **The menu:** Escape or Back opens it on Match, and on Pre-match too (M4-Q7), and closes it again; in Practice, closing it resumes; the arrows or the d-pad move, Resume focused first in Practice; Enter or Start presses.
- **Results:** Play again focused first; the arrows or the d-pad move between Play again and Home; Enter, Space, Start or the bottom face button presses the focused one, but only a press that began at least `resultsPressGuardSeconds` (0.5 s) after Results appeared, so a jump held or mashed at the final whistle presses nothing. The guard applies to a pointer's press too (M4-Q26). Each press, a pointer's included, goes into the app's announcements log with its time since Results appeared and whether the guard took it (§1.40).

### 4.10 Who owns which key

One `keydown` listener on the window, the keyboard device's: play keys go to the controls when a pitch screen is up and no menu is open; Escape, Enter, the arrows and Results' Space go to the screen's `ui`; everything else is the browser's. Fields (the name, the code, the relays) take their own keys.

---

## 5. Screens and messages (PLAN §11, D-30, L160–L170)

One TypeScript module per screen, no framework (D-30, roslambo D-22), built with `h` (§1.39), each a `Screen` (§1.42). The app's one state machine (§1.41) moves between them. In the order a player meets them:

### 5.1 The boot page's hand-off (D-30, CLAUDE.md, M4-Q38)

One order, `src/main.ts`'s then `App.start()`'s:
1. `index.html` shows "Loading terriest…" with its `noscript`; `public/boot.js` runs its checks: `F` (opened from `file://`) or `S` (an insecure context) shows its message and defines no `window.terriestBoot`, so the module does nothing.
2. `src/main.ts`: `#test=determinism`, `#test=net` or `#test=frames` loads its own chunk and stops there.
3. Otherwise it makes the stage, the page's one WebGL 2 context; with no WebGL 2 it calls `boot.noWebGL2()` and stops (`W`), the stage's canvas never put in the page (`e2e/boot.spec.ts` counts none).
4. It makes `<main id="app">` with `#stage` and `#screen`, opens the stores (§6) and builds the App.
5. From phase 2 the App asks for the tab's Web Lock (`ifAvailable`). Held, or with no Web Locks in the browser: it routes the fragment (§5.2) to its first screen. Another tab holds it: the first screen is "terriest is open in another tab", with **Use here**, which steals it (D-24).
6. With that first screen in the page, it calls `boot.started()`, which takes the loading message down and sets `html[data-boot="started"]`, and adds `inspect()` and `hashAt()` to a spec's hook. A start that never comes shows `L` after 20 s, and the compile never counts toward it.
7. With the lock held, it starts `stage.prepare()` behind that screen (§2.1). While another tab holds the lock, prepare waits until Use here has taken it, so a page that can't play spends no CPU beside the tab that's playing. From phase 2, the canary runs once prepare has finished (§5.6).

So the page always shows one main landmark: the loading message's, then the app's (M4-Q1); a `#test=` page makes its own, and never `#app`.

### 5.2 The state machine and the fragment (PLAN §11, L232)

| From | Event | To |
|---|---|---|
| start, `hashchange` | the fragment is `#join=<id>` (a valid ID, `matchIdFromHash`) | Join (§5.6), the match's room opened at once: opening a link counts as joining (C-32) |
| start, `hashchange` | anything else, a bare `#` among them | Home |
| Home | Practice | Practice's setup |
| Practice's setup | Start | Pre-match, Practice's match made (`practiceMatch`) |
| Home | Propose a match | Propose |
| Propose | Create | Created, its match proposed (genesis) and its room opened, the fragment `#join=<id>` |
| Created | Play in A or B | Pre-match as a player |
| Created | Watch | Pre-match as a spectator |
| Home | Join, with a valid code | Join, by setting the fragment to `#join=<id>` |
| Join | the state shows this page in the roster | Pre-match or Match: a returning player skips Join (L215, D-17) |
| Join | Play in a pack / Watch | Pre-match |
| Pre-match | the first kickoff's play begins | Match (M4-Q8) |
| Match | the end is confirmed (`scoreboard.end`) | Results |
| Results | Play again | Pre-match of the next match: Practice's again (Q-15), or the derived room's (D-12), the fragment its ID |
| Pre-match, Match, Results | Leave, Home | Home, the match left and the fragment cleared |
| Home | Settings | Settings; Back returns Home |
| any match screen | a refusal, a failure, abandoned (§5.10) | the message, with its actions |

- **The fragment** is set with `location.replace('#join=<id>')` and cleared with `location.replace('#')`, never by assigning `location.hash`, which would add history entries that Back and Forward would walk through, re-opening ended matches and contacting the relays; no History API (D-38, PLAN §11). The router remembers the fragment it set and ignores the `hashchange` its own replace fires. Practice never sets it, so a reload goes Home and contacts no one (D-22).
- **On every change** the old screen is disposed, the controls released (§4.8), the new screen focused (§1.42), and the stage shown only for Pre-match and Match. What outlives a screen is the app's: the stage, the stores, the page's devices and sound, and each match's announcements log (§1.40), so a spec reads on Results what Match showed.

### 5.3 Home (PLAN §11, L162)

The display name, editable, fitted to 20 characters and 32 bytes by `fitName` (C-17) and stored on change; the coat, a radio group of the look's coats, each a swatch and its name, stored on change; **Propose a match**; **Join** with a code field (lowercase, dashes, spaces and Crockford's look-alikes accepted, L190); **Practice**; **Settings**. A code that isn't one says so ("That code isn't valid. Check it and try again: it has 21 characters.", roslambo's) and contacts nothing. When the browser won't keep the profile, Home says so: "This browser isn't keeping your name, coat and settings between visits" (PLAN §10). Opening a `#join=` link skips Home (L162). Phase 1's Home has the name, the coat, Practice and Settings, whose screen then holds the render quality, applied at once by re-creating the stage behind Home (§2.8), start in ball view and the calmer camera; phase 2 adds Propose and Join, and the rest of Settings.

### 5.4 Practice (Q-15, D-22, L158, L164)

- **The setup screen:** pack size (1–4, default 2) and match length (1–10 minutes, default 3), from `config`'s ranges and defaults; **Start**; **Back**.
- **Its match:** `practiceMatch` (§1.37) starts a `PracticeGame` at once: the player in pack A, bots in every other place, each always ready (Q-15, C-41). No room, no peer connection, no fragment: P10.
- **Pre-match** (§5.7) has no Add a bot, Remove a bot or Invite; **Switch pack** swaps the player with the other pack's newest bot (D-22). Ready is focused from the screen's entry, marked `aria-disabled` and reading "Joining…" until the player is in the final roster, about 15 ticks after the start, since a Ready before the JOIN is final is dropped (D-22's M3 note, §1.42).
- **The menu** has **Resume** and **Leave** in phase 1, and **Settings** between them from phase 2; opening it pauses play, the clock, animations and sound, the drawing clock with them (§2.2), and Resume, or closing it by Escape or Back, carries on (Q-15). Hiding the tab, or a stall of over 2 s, opens it, already paused (`PracticeGame.onPause`). Losing the graphics pauses Practice until they're back (§5.8, D-30).
- **Play again** on Results starts a new Practice with the same settings and contacts no one (Q-15).

### 5.5 Propose (PLAN §11, L163)

Pack size (1–4, default 2) and match length (1–10, default 3); **Create**, after the canary (§5.6): it generates the match ID, opens the room (`openNetMatch`, with Settings' extra relays and TURN), proposes genesis, and sets the fragment. **Created** shows the link, with **Copy link** and, where `navigator.share` exists, **Share…**; the code in groups of four with **Copy code** (L190); "Keep this page open until someone joins" and how many have; then **Play in pack A**, **Play in pack B**, **Watch** and **Leave**, at once (L163). A screen wake lock is held until someone joins (D-30).

### 5.6 Join, by link and by code (L135–L139, D-17, D-21, D-23, C-32)

- **The canary first** (D-23): `canaryOk()` (§1.50). A browser that computes differently gets no networked match: Propose and Join show "This browser can't play matches with others", saying that it computes the game differently and that Practice still plays, with **Practice** and **Home**, and open no room.
- **Connecting:** the room opens at once, as undecided (PLAN §8); the screen reads "Connecting to the match…" until a timeline is held. Its choices aren't offered before the state is known (M4-Q2).
- **The state held:** a page whose player ID, or a bot derived from it, is in the roster has returned (`status().returning`): it skips Join to Pre-match or Match, its terrier taken back at once (L215, D-17). Otherwise the screen shows each pack with its free places and who's in it, **Play in pack A** and **Play in pack B**, the smaller suggested (the first on a tie), a full pack's marked `aria-disabled` with "Full", and **Watch**.
- **Refusals** (D-12, D-21): a JOIN given up (`status().refused`) offers the other pack if it has room, and otherwise watches with "This match is full, so you're watching it"; a fifth spectator, or a page a peer refused for the cap, gets "This match has the most spectators it can take"; a build or protocol refusal "A different version"; no timeline 20 s after opening, the connection failure (§5.10).
- **Watch on return** (page-F5, M4-Q2): a returning page skips Join and takes its terrier back, so the screens never let it choose Watch, and its terrier is never sat out by that. Before the start countdown, a returning player who wants to watch presses Leave, whose LEAVE removes its terrier, then opens the link again and presses Watch on Join. From the start countdown on, the state ignores LEAVE (D-8's M2 note), so its terrier stays in the roster and reopening the link takes it back: a returning player can't watch that match, which M4-Q2 records for the plan.

### 5.7 Pre-match (PLAN §11, L166, Q-17)

The pitch, with the terriers warming up (D-8: every control, and pounces tumble rivals), drawn from the viewer's camera (§3). Over it:
- **Each pack's list,** in the pack's colour and pattern: each terrier's name (a bot's "Bot" and four hex digits, D-39), coat swatch and Ready, your row marked "you".
- **Ready,** focused from the screen's entry for a player, marked `aria-disabled` and reading "Joining…" until the player is in the final roster (§1.42); pressed again it cancels (L146), and the button says which: "Ready" or "Ready ✓". **Switch pack** (refused by the session for a full pack: "The other pack is full"). **Add a bot** and **Remove a bot** for each pack, for players and spectators alike, Add marked `aria-disabled` where `canAddBot` says no and Remove shown only while this browser hosts a bot there (D-39, PLAN §14). **Leave**. **Invite**: the link and the code, as Created shows them.
- **The start countdown** (D-8, L148): when both packs are full and every player is ready, the terriers go to their spots and the countdown shows over the pitch; Ready, Switch and the bots' buttons are marked `aria-disabled`, reading why, since the roster is locked, and the focus stays where it was. Play begins when it reaches 0, and the screen is Match (M4-Q8).
- **On a touch screen** the stick and buttons; on a phone held upright the turn prompt (§5.13). A spectator sees the lists and the bots' buttons, and no play controls.
- The lists follow the final state, rebuilt only when their content changes (roslambo's).

### 5.8 Match (PLAN §11, L167, L202, L103)

The pitch, from the viewer's camera, and the HUD (`hud.ts`, §1.44), all text set only when it changes, each piece on an opaque backing (§5.14):
- **The score,** each pack's in its colour and pattern, your pack marked; the scoreboard's, so a goal counts on screen only once its tick is confirmed (D-14).
- **The clock**, m:ss, counting down; in overtime "Overtime" and its time counting up from 0:00 (D-8, L111).
- **The countdown** before each kickoff, its seconds over the pitch, from the head's phase and its start, and "Go!" as play begins.
- **A goal,** at its confirmed tick: the score, the whistle and the chorus (§7), the scorer's name over the pitch, "Goal: <names>", or "Own goal" when nobody is credited, for the celebration's length (L110, C-26); and the celebrating pack's overlay (§2.5). A goal a repair takes back (C-4) is taken off the score and announced as "Goal taken back".
- **Away marks** over each terrier that sits because its player, or its bot's host, is away (L167, D-16): the overlay's, from phase 3.
- **A player's** zoomies meter and pounce wait, from the drawn head's own terrier, from phase 1; on a touch screen the stick and buttons.
- **A spectator's** choice of what to follow: **Ball** and a button for each terrier's name, the view key and the shoulders cycling them (L167, D-28).
- **The menu button** (☰, "Menu"): **Resume** in Practice only, **Settings** from phase 2 (a panel over the pitch, which keeps drawing; its Back returns to the match, never disposing the screen, the renderer or the game; held inputs released while it's open, PLAN §11), **Leave**.
- **"Press a key or tap for sound"**, the sound layer's own (§1.27), while sound is on and the AudioContext isn't running (D-32).
- **"Graphics were lost; restoring"** while the WebGL context is lost; if it isn't back within `lostGraphicsSeconds` (5 s) of the page being visible, the plain message "The graphics stopped working" with **Leave**, the match going on for the others, the terrier and its vote kept, held inputs released, Practice paused until they're back (D-30, C-36). A context that comes back later still rebuilds the drawing (D-30), and the pitch returns in place of the message.
- Everything sound tells shows here too: each kickoff's countdown and "Go!", each goal, and the end (L103).

### 5.9 Results and Play again (PLAN §11, L153, L154, D-12, Q-17, C-50, M3-Q24)

From the confirmed end (`scoreboard.end`, D-14): the final score and the winner; a table of each terrier's name, pack, goals and touches, "a shared goal counts for each sharer" said under it (C-26); the Terriest, or Terriests when level (D-8); **Play again**, focused first, and **Home**. Play again reads "Join the next match" once an AGAIN has arrived (roslambo's). Q-17's guard applies (§4.9). Below them, **Network figures** (`readout.ts`, M3-Q24): the match summary's late inputs against the inputs received, rollbacks, resyncs, and the correction sizes' p50, p95 and max, a repair's apart, with **Copy**, so M5's runs can log each peer's from a normal page (PLAN §17's M5); a refused clipboard write says "Couldn't copy: select the figures instead" and selects them, and is never a page error. Practice's shows its own (no late input or resync).
- **Play again** (D-12, C-42): networked, `match.playAgain()` opens the derived room's match, which proposes there only if no AGAIN reached this room, with this match's pack and bots; the fragment becomes the new ID and the screen its Pre-match, with no Join, since the press is the choice. In Practice, a new Practice (Q-15).
- **A browser that arrives on Results** (C-50) adopts the end from a peer and shows the same Results (D-17's M3 note).

### 5.10 Messages (PLAN §11, D-23, D-30, Q-16, C-11)

Each a screen with a heading, an explanation, its actions and a code in `data-message` for the specs (roslambo's `messageScreen`); its heading focused; `role="alert"`.

| Code | When | Heading, and what it says | Actions | Through the page |
|---|---|---|---|---|
| (boot) `F`, `S`, `W`, `L` | boot.js and the module (D-30) | unchanged: M1's, in `public/boot.js` | — | `boot.spec.ts` |
| `canary` | Propose or Join with the canary failing (D-23) | "This browser can't play matches with others": it computes the game differently from other browsers, so a match with them would keep going wrong; Practice still plays | Practice, Home | `screens.spec.ts` |
| `build` | refused for the build or the protocol | "A different version": the other players are running another version of terriest; everyone should reload, then join again | Home | `room.net.spec.ts` |
| `connect` | no timeline 20 s after opening (`status().failed`, PLAN §8) | "Couldn't connect", roslambo's wording: a network may be blocking direct connections; try another network, or add a TURN server in Settings; the match may have ended, or its proposer left before anyone joined | Try again, Home | `screens.spec.ts`, Chromium |
| `watching` | a JOIN given up for a full pack or a started match | a notice on Pre-match or Match rather than a screen: "This match is full, so you're watching it" | — | Node only (M4-Q39) |
| `left` | `status().abandoned` (Q-16) | "The players have left", with the score so far | Home | Node only (M4-Q39) |
| `spectators` | a fifth spectator, or refused for the cap (C-11) | "This match has the most spectators it can take" | Try again, Home | `watchers.net.spec.ts` |
| `duplicate` | refused as a duplicate ID | "This match is open in another tab or window of this browser" | Try again, Home | Node only (M4-Q39) |
| `other-tab` | another tab holds the Web Lock (D-24) | "terriest is open in another tab": only one tab plays at a time | Use here | `screens.spec.ts` |
| `graphics` | the context not back within 5 s (D-30) | "The graphics stopped working": the match goes on for the others | Leave | `graphics.spec.ts`, `room.net.spec.ts` |

The three in Node only can't be reached from a page in the gate at a reasonable cost or at all (M4-Q39): `left` needs every browser that controls a terrier gone from the start countdown on and 30 s of silence after (`src/net/abandoned.test.ts` plays the rule); `duplicate` comes only from a connection lingering under the same player ID (C-12), which one browser's tab lock rules out (`src/net/spectators.test.ts` and `joining.test.ts`); and `watching` needs two JOINs for a pack's last place in one tick, a race no spec can time (`src/net/joining.test.ts`). The app's mapping of each status to its message is `src/ui/app.test.ts`'s, and every message shares one component, which the reachable ones and axe cover.

### 5.11 Leaving (D-30, M3-Q20)

- **Leave** on Pre-match and in the menu: networked, `match.leave()` sends LEAVE for the player and its bots and closes the room `leaveGraceMs` later (0.4 s), so its LEAVE goes out; Practice closes; the fragment is cleared and Home shows. From the start countdown on, the state ignores LEAVE and the terrier sits (D-8's M2 note).
- **The leave prompt:** during Pre-match and Match the guard asks before the page is left (`beforeunload`). Registered at start-up, before any room, it's the window's first listener, and while it asks it stops the event at once (`stopImmediatePropagation`), so Trystero's own listener on the same window never runs and a page that stays keeps its peers; one that goes leaves on `pagehide` (M3-Q20, §1.49). Chrome on Android shows it once the page has had a touch; iOS Safari doesn't (D-30). `room.net.spec.ts` dismisses it on a connected player's page and checks that its peers stay and still take its TICKs, then accepts it on a watcher's page and checks that the others see it leave; every other spec that reloads or leaves accepts it (§9).

### 5.12 The gate's relay (M4-Q3)

A built page's screens use the curated relays plus Settings' extra ones (`relays: null`), as roslambo's do. The gate contacts no public host, so its screens' specs set `window.terriestTest.relay` before load to the local relay, a `ws:` URL on the loopback, and `ice: 'local'` for the specially launched engines (e2e/lib/browsers.ts); the app then opens every room with exactly that relay. A spec that runs in each engine and opens a room, `screens.spec.ts`'s connection failure, starts a local relay of its own for it and lists it in `guard.allowed`, with `ice: 'none'`, so even its failure contacts nothing public (§9.3). The app accepts only a URL `acceptedRelay` (src/nettest-params.ts, M3) takes, the loopback's or a curated one, so no link or page can send a visitor to a relay `third-party.json` doesn't list (§20's M3 note). Under `npm run dev:local`, the dev relay is the screens' only relay, as PLAN §15 says, loaded only under `import.meta.env.DEV`.

### 5.13 Phones (D-30, L170)

- **A phone** is a coarse-pointer screen whose shorter side is under `phoneShortSideCssPx` (600). Held upright, Pre-match and Match show "Turn your phone sideways to play", spectators included; if it stays upright, the prompt adds that rotation lock may be on, and on Android offers **Play full screen**, which enters fullscreen and locks the orientation to landscape. The other screens work upright as usual.
- **Sideways,** the stick and buttons sit over the pitch (L170); the layout keeps inside the safe-area insets: phase 2 adds `viewport-fit=cover` to `index.html` and pads the messages, the HUD and the control layer by `env(safe-area-inset-*)`.
- **A screen wake lock** is held during Pre-match and Match, and on Created until someone joins, where the browser offers one, requested again at each `visibilitychange` to visible (D-30). Its refusal, and Play full screen's, are caught and quiet (§1.48): the page plays on without them.

### 5.14 Accessibility

- One main landmark (§5.1); each screen's heading an `h1`, focused on entry unless Q-17 names a button; every control a native button, input or radio with its label; the canvas an image named "The pitch" (M1), inside the landmark; the marks over it `aria-hidden`, since they repeat what the HUD says.
- A button that can't act yet is `aria-disabled` with a label saying why, never `disabled`, so the focus Q-17 names holds and a screen reader hears the reason (§1.42).
- The HUD's score, goals, countdowns and the end in a polite live region, so a screen reader hears them; Results a table with headers.
- **Contrast over the pitch:** every piece of HUD text, overlay label and control hint sits on an opaque backing in the look's colours. axe can't judge text over a canvas, and reports it as incomplete, not as a violation, which `expectAxeClean` doesn't read; on an opaque backing its contrast is axe's to check like any page's.
- No colour alone: the packs differ in pattern (L43); your terrier's mark is a shape (L52); Ready says ✓; a coat's swatch has its name.
- The calmer camera follows `prefers-reduced-motion` until the player chooses (PLAN §11, A.3), which `screens.spec.ts` checks with the media emulated.
- **axe** runs on every kind of screen, in the engines §9.6 lists for each: most in each engine, and Created, Join, the networked Pre-match and the touch layer where their spec runs.

---

## 6. Settings and the profile (PLAN §10, A.3, D-24, D-25)

Only `src/storage/**` touches storage (D-38); everything else goes through its two stores and the tab lock.

- **The profile,** `terriest.v1.profile`, A.3's `{ v: 1, playerId, name, coat, hints: { keyboard, touch, gamepad } }`:
  - `playerId`: `crypto.randomUUID()` as 32 lowercase hex digits, once per browser (D-25), kept apart from Trystero's per-load `selfId` (L347); M4's screens take it, where M3's `#test=net` page took `personId(seed, k)` (D-25's M3 note);
  - `name`: fitted by `fitName` (§1.35), empty until typed; peers show a nameless player's terrier by "Player" and four hex digits of its ID, roslambo's rule;
  - `coat`: drawn at random on the first visit and stored at once (PLAN §10), an index in the coat list;
  - `hints`: per kind, a bitmask of the six controls used (§4.7, M4-Q28).
  - An unreadable record is copied verbatim to `terriest.v1.profile.backup` before a fresh one is made (D-24).
- **The settings,** `terriest.v1.settings`, A.3's `{ v: 1, relays, turn, names, ballView, calmCamera, mirrorTouch, sound, quality }`, defaults PLAN §11's: no extra relays, no TURN, names over terriers off, start in ball view on, calmer camera `null`, mirrored layout off, sound on, render quality `null`. `calmCamera` and `quality` stay `null` until the player chooses, following their rules meanwhile: `prefers-reduced-motion` for the calmer camera, and `renderQualityDefault`, high, for the quality (whether phones start at low waits for their measurements, D-33). Every change writes the whole object (A.3).
  - **Checked as typed:** relays as `wss://` URLs without credentials, at most 10 (roslambo's `relayProblem`); a TURN server's `turn:` or `turns:` URL with its user name and credential (`turnProblem`). A setting that fails says why and isn't stored.
  - **When they apply** (PLAN §11): everything at once but the relays, TURN and render quality. Names over terriers, the calmer camera, the mirrored layout and sound reach the screen through `SettingsStore.subscribe`; start in ball view applies from the next match's start; render quality applies at once from Home, by re-creating the stage (phase 1), and in a match when the menu closes, by the rebuild (phase 3; in phase 2, when the match closes), §2.8 (D-33); relays and TURN apply from the next match.
  - **Show control hints again** clears the profile's hints for all three kinds (D-29).
- **Where Settings is:** a screen from Home (Back returns Home); in a match, a panel over the pitch from the menu (§5.8).
- **A failed write** loses that write only (roslambo's `tryWrite`); the store then says it isn't persistent, and Home says so (PLAN §10). A browser that blocks storage plays from memory.
- **One game tab** (D-24): a Web Lock named `terriest-game` covers the whole app, Practice and watching included; a second tab shows the `other-tab` message with **Use here**, which steals the lock, and the first tab, hearing it lost, closes its match and shows the same message (roslambo's).
- **Nothing about matches** is stored (PLAN §10, L216). Safari may delete all of this after 7 days without a visit (C-14), which the README says.
- **The specs seed storage** with an init script that writes each key before the page's scripts run, and only when it's absent, so a reload reads what the page stored and not the seed again (`seedStorage`, §1.62): a fixed player ID, so a setup's bots are the validated ones (PLAN §16's setups over 25 seeds), and `quality: 'low'`, a player's real choice, for the gate's matches (C-6, D-33, M4-Q4).

---

## 7. Sound (D-32, PLAN §13)

- **One AudioContext,** made at start-up (`AudioOut`, §1.27), resumed at each `keydown`, `click`, `pointerup` or `touchend` until it runs, and again when the page is shown, each `resume()`'s promise caught. A gamepad press may not count, so while sound is on and the context isn't running, the pitch says "Press a key or tap for sound", the sound layer's prompt. A master gain follows Settings' sound; Practice's menu suspends the context, so sound stops with play (Q-15). Without Web Audio the page plays no sound and shows no prompt.
- **The sounds** (D-32), synthesised (§1.28), no files, so the dist audit's allowlist is enough: barks, a filtered noise burst with a falling pitch, a little different per terrier by its ID; the ball's bounces, a low thump, louder for harder hits (the hit's strength); pounces, a whoosh; tumbles, a thud; a whistle at each kickoff and at the end; a goal, a whistle and a chorus of barks (C-53).
- **When each plays, given rollback** (PLAN §13), decided by `SoundCues` (§1.29) after each timer run, since the head moves there, not once a frame:
  - **Bounces, pounces and tumbles** from the predicted head, when their event first appears there: the ball's `lastHitTick` changing (a thump, its loudness the hit's strength at that first sighting), a terrier's animation entering `lunging` (a whoosh) or `tumbled` (a thud), each keyed by its kind, its body and its tick. One of the same kind and body that a re-simulation moves by up to `soundShiftTicksMax` (3) ticks doesn't play again; one a correction removes has already played and is left to finish, each under 0.3 s.
  - **The kickoff whistle** when play starts: the head's phase becoming `in play`, keyed by its start, which ticks final seconds before fixed, so no correction moves it.
  - **A goal's whistle and chorus** at its confirmed tick, once per goal tick, from the scoreboard's goals added (D-14).
  - **The end whistle** at the confirmed end, with Results.
  - **Barks** (D-16, L209): a remote terrier's and a hosted bot's from `BarkTracker`'s events, found in received and recorded inputs, never predicted ones, which `MatchView.run` hands the layers as `PitchContext.barks` (§2.5); your own at the press, from `Layer.ownBark`, as the drawing shows it.
  - Another timeline (a merge or a rejoin) resets the cues, so nothing replays from the adopted state.
- **Decided and played** (feasibility-F9): every cue `SoundCues` decides is counted in `audio.decided`, whatever the context's state; `AudioOut` schedules it, and counts it in `audio.played`, only while the context runs, sound is on and Practice isn't paused, and drops it otherwise rather than queue it: a suspended context's time stands still, so every cue scheduled on it would sound at once when it resumed. Playwright's headless engines start a context suspended until a trusted input, and CI's runner may have no sound device, so the specs assert `decided`, and only a Chromium spec checks that a key brings the context to running and takes the prompt down (§9.3).
- **Everything sound tells also shows on screen** (L103): §5.8's countdown and "Go!", the goal's announcement, Results.
- **Tested** (PLAN §16, vitest, no Web Audio): `src/audio/cues.test.ts`: a bounce re-simulated one tick later sounds once; one moved 4 ticks sounds twice; a predicted end that a correction turns into overtime blows no end whistle; remote barks only from received inputs, never predicted ones; a goal's whistle once however often the scoreboard is read; `src/audio/audio.test.ts`, on a fake context: decided counted whatever its state, scheduled only while running, on and unpaused, a refused `resume()` never thrown; `src/core/session/barks.test.ts`: the baseline after a gap, a reload's first input, a host's own bots; `src/input/controls.test.ts`: the sender keeps to one bark a second (L327). In the page, `audio.decided` counts each cue, so the specs see a whistle at each kickoff and goal without hearing it.

---

## 8. Performance and the main thread

### 8.1 What a slow frame costs, and how M4 measures it

The timeline runs on a 4 ms timer (D-31), on the main thread, which drawing shares. When a frame blocks the thread, the timer's next run comes late and moves the clock k ticks at once. A networked page then sends only its newest `stallSendTicks` (3) ticks' inputs and marks the rest absent (A.4's Timer stall, roslambo D-11's fix for sleeping timers) for every sender it sends for, its own terrier and each bot it hosts alike (the timeline's `markSkipped`), and an absent input means no direction (D-10). So a slow page weakens its own bots as well as its player: the proposer in §9.4 hosts the scoring bot. If each frame blocks the timer for its whole length, a run after a 67 ms frame (15 frames a second) moves 4 ticks and skips 1, 25%; at 10 frames a second 6 and 3, 50%; at 5, 12 and 9, 75%. By arithmetic, then, any page whose frames block for more than about 50 ms skips more than a tenth: what's unknown is how long the engines' and the phone's frames really block with the governor acting (§8.2), not what a block costs. In M3's model, at 10 frames a second about 42% of a player's own ticks went unsent, and at 30 every tick was sent (PLAN §17's "From M3"). Practice sends every tick through a catch-up (`practiceSettings`, D-22), so it loses none.

**The trade, if more were sent** (M4-Q6). A rule that sends every input of a catch-up of up to K ticks sends its oldest K − 1 ticks late, with d + w + 1 − K ticks to its late boundary instead of d + w; and an input in time for some peers and late for others splits them, which is why the newest-3 rule exists. By C-55's formulas, the reach is (that slack × 16.7 ms, less 16.7 ms of deadband and 20 ms of jitter) one way without loss, and a third of it with one resend:

| K | The oldest input's slack | Reach without loss | With one resend |
|---|---|---|---|
| 1, an input sent on time | 14 ticks | 196.7 ms | 65.6 ms |
| 3, today's newest-3 rule's oldest | 12 | 163.3 | 54.4 |
| 4 | 11 | 146.7 | 48.9 |
| 5 | 10 | 130.0 | 43.3 |
| 7, half of d + w | 8 | 96.7 | 32.2 |

M4-Q6 proposes K = 5 if the measurement asks for it: a catch-up of up to 5 ticks, after a frame of up to 83 ms, sends every input, and a longer one the newest 3. Its oldest input still reaches 130 ms one way without loss, past M3's loss-free 80 ms profiles, and 43.3 ms with a resend, past the 30 ms lossy profiles M3 measured clean (C-55).

**M4 measures it with real frames, before the networked specs land** (phase 2c, M3's lesson), on a quiet machine (§8.4):
- **The hook** reports, for the match held, its timer runs, their largest gap, the gaps over a freeze (d + w ticks, 233⅓ ms) and over a stall (2 s), and `own`: the ticks moved, sent and skipped, and the senders each stood for (§1.37, §1.40). Every whole-match spec logs them; the Practice and screens-match specs assert no stall; and from phase 1 the first Practice spec logs each engine's largest gap, so the governor's thresholds start from measured gaps.
- **The bench** reports the same over its 3 minutes, at each engine's and each setting's frame rate (§8.4), and with `frameMs=<n>` holds each frame by a busy wait, as M3's harness held its pages, so every sender's skipped share can be read at 33, 50, 67 and 100 ms with real drawing; run 6 also plays it in the three engines at once at 640 × 360 and low quality with the governor acting, as the screens' match will draw.
- **The decision** (slow-frames, 2c): if a page in that gate-like run skips more than 10% of any sender's inputs, M4-Q6's K = 5 is adopted: a change to `src/core/timeline/timeline.ts`, with `stallSendAllTicks` 5 added to `src/config.ts` and A.4's Timer stall row, re-tested by M3's freeze, hidden-page and stall tests and a new one, moving the build hash, which is fine before the first release. Otherwise nothing in the timeline changes.
- **The setup under it:** whichever rule stands, §9.4's setup is played again over the network simulator with the proposer's timers paced at 50 and 100 ms, so its bot plays with the inputs a slow proposer skips (§9.2), before the screens' match fixes its timeout.

### 8.2 Drawing gives way (PLAN §17's "From M3": "keep the timeline and its messages a guaranteed share of the main thread, degrading drawing first")

`FrameLoop`'s governor (§1.47), from phase 2b; phase 1's frame loop has its last step alone:
- **It watches what slow frames cost, not the frames:** over each second of the page clock, two shares, the ticks this page skipped of those it moved, over every sender it sends for (`own`, §1.37), and the time spent in timer gaps longer than `drawingLateTimerMs` (50 ms, three ticks). If either passes `drawingLateShare` (10%), drawing gives way one step: the stage's pixel-ratio scale falls by a quarter of its cap (`setScale`, a cheaper fill, no new context, so no quality change, D-33), down to 0.5; at 0.5, the loop draws every other animation frame. After `drawingRecoverSeconds` (3 s) with neither, it steps back the other way. A count of late timer runs would barely move for the frames that cost the most: at 250 runs a second, one 500 ms frame a second is about 1 late run in 126, yet 27 of that second's 60 ticks go unsent, and half the second is a late gap. Practice skips nothing, so there the gaps alone decide, which keeps it clear of its 2 s stall.
- **It never touches the timeline:** the timer's period, its catch-ups and what it sends are M3's, as M4-Q6 leaves them; drawing only does less, so more of the thread is the timer's.
- **The frame's own work stays small:** the HUD and the lists set text only when it changes; the overlay writes transforms only; the canary (50–60 ms on a phone, an estimate) runs once after start-up's `prepare()`, before any match, never in one.
- **Its thresholds come from real targets:** the bench's runs on the owner's GPU and, at M5, the phone's set them, never a gate spec. A gate spec that sees a gap over the freeze gets a closer look at what it draws or a smaller scene, never lower thresholds, which would tune players' drawing to the gate's machine (R-3).
- **The bench's verdict** requires the governor never to have acted: L286's frame times are judged at full resolution, the run never changing quality (D-33), and its report counts the governor's actions (M4-Q17).
- **Tested in virtual time** (`src/ui/frame-loop.test.ts`, with `clock-testing.ts`'s fakes): steady 40 ms frames give nothing way; 67 ms frames in a networked match step down within a second; a 500 ms frame every second steps down; 3 s with neither steps back; in Practice the gaps alone step it.

### 8.3 The bench's room (`src/bench/virtual-room.ts`, §1.53)

roslambo's `VirtualRoom`, with terriest's changes:
- **Seven virtual players,** each with the bot brain on the page's own drawn head (a bench may read its page), joining with JOIN and READY in their TICKs as roslambo's did, at latencies spread over 20–80 ms one way with 15 ms of jitter, each link FIFO, as Trystero's reliable channel is. Their brains and their encoding are the room's own work on the page, timed apart from the page's (`roomMs`), an estimated 0.1–0.3 ms a tick; if its p95 passes 1 ms a tick, the brains move into the witness's Worker too.
- **No witness in the frame-time run** (M4-Q16): each player's TICK votes the page's own final hash for its newest final tick, read from the page's timeline, as honest peers' agreeing votes would, so the page tallies as a real page does and its thread carries one timeline, as a real page's does. A witness on the page's thread would add a second timeline's steps there, about 0.6–1.2 ms a tick on the desktop by M3's load run and roughly four times that at 4× throttle, and a vsync it made the page miss can't be timed back out of a frame interval.
- **The witness, for the forced repair only** (`repair=1`): a real Session and timeline in a dedicated module Worker (`new Worker(new URL('./witness.ts', import.meta.url), { type: 'module' })`, same-origin, so the CSP's `script-src 'self'` covers it), which takes the page's TICKs and the other players' by `postMessage`, votes, and answers the page's STATE_REQ with a real STATE, its messages joining the room's queue for the page. So the page can lose its tallies and repair from a real STATE while its own thread does only a real page's work.
- **One shared delivery** (PLAN §17's "From M3": "a virtual-time room whose messages pass through one shared delivery server reproduces a capacity failure"): every message to the page passes through one queue, in order at its arrival time, each delivered in a task of its own (a MessageChannel post), as a data channel fires one event per message with frames between them; with `capacity=<n>`, at most n a second, so a run can reproduce a path that falls behind; the report gives the queue's backlog every second, by link and summed, from before the countdown on (the load run's lesson).
- **The hold** for the forced repair (§2.11): from `holdAtMs`, every message to the page waits `holdMs` (4,100), FIFO behind it; at the hold's end about 1,700 TICKs fall due, and go one a task, never in one long callback.

### 8.4 The runs outside the gate (PLAN §16, M3-Q14, D-15, D-16, D-31)

`e2e/frames.run.ts` with `playwright.frames.config.ts`, named `.run.ts` so the gate never runs it, as M3's load run is; each run appends a JSON line to a file named by `TERRIEST_FRAMES_OUT`, and refuses without it, so nothing lands in the repo by accident; `docs/acceptance.md` takes the figures. **On a quiet machine,** as M3's load run: each run starts once the 1-minute load has fallen under 1 and 8 more minutes have passed, with no builder, gate, build or dev server running, and its line records the load before and after it; a run made otherwise decides nothing. Steps that run alone make them (§12): 2c's slow-frames runs 4 and 6, and 4b's measure the rest.
1. **The frame-time run (L286):** `#test=frames`, no witness, 4 a side, 3 minutes, in each engine headless on C-6's GPU path, with the code-built drawer and again with the stand-in (`model=`, served by interception as `e2e/lib/standin.ts` serves it); and by hand on the owner's GPU in Chrome, Edge and Firefox, the stand-in from the dev server's `dev/standin.glb` under `npm run dev` (§14): the verdict, p95 ≤ 18 ms and max ≤ 50 ms, at 60 Hz, with the time to Home and to prepared beside it (§2.1).
2. **The CPU figures** at the Pixel 8a's size in Chromium at 1× and 4× CPU throttle: the timer run's cost, and the frame's own work excluding draw submission. Its frame intervals there are SwiftShader's, which throttling doesn't slow, so they aren't logged as a phone proxy (PLAN §16).
3. **The forced repair** (M3-Q14), `repair=1`, the witness in its Worker, at 4× throttle, 20 runs with a fresh page each: every call of the repair and the STATE's adoption on its own, against M3's 25 ms; the frame intervals through it, reported, deciding nothing; and the largest timer gap through a quality rebuild (§2.8).
4. **The timers' cadence with real frames** (D-15, D-31's "a risk for M4"): each engine's timer gaps while drawing, at both qualities, WebKit's especially, against the freeze's 233 ms and the stall's 2 s; and the clock's samples, taken and dropped by the freeze rule (the timeline's `clockSamples` and `clockSamplesDropped`, §1.40), with the kept samples' age, from each message's due time to its handling, against D-15's M3 figures: 26–28% dropped in Chromium, 13–92% in WebKit and at most 8% in Firefox at frames of 150–200 ms, and a median age of 559 ms at 250 ms frames.
5. **The glide's check** (D-16): §2.3's figures against rule 2's limits.
6. **The slow-frame share** (§8.1): every sender's skipped share at `frameMs` of 33, 50, 67 and 100, and in the three engines at once at 640 × 360 and low quality with the governor acting; M4-Q6's decision from it.
7. **Key to screen** (R-6): the bench's sample-to-screen latency, p50 and p95, beside the Practice specs' key-to-screen figures (`controls.latencyMs`), for the owner's Q-10 judgment.

### 8.5 The chunk budget (PLAN §12, §17's "From M3", M3-Q19)

At M3's exit, minified and brotli at quality 11: the page's own module 556,951 and 114,959 B (three's core most of it, with M1's scene), the `#test=net` page's 106,573 and 32,067, Trystero's 77,808 and 24,638, the simulation the test pages share 60,883 and 19,321, the determinism page's 12,268 and 3,532. At M4 the normal page holds the screens, the session, the timeline, the protocol and the simulation (Practice needs them), so:
- **The chunks,** by `codeSplitting` groups (§1.56): `three` (three's core, about 119 kB brotli by M0's measure), `drawer-code` (the code-built drawer's own files under `src/render/drawers/`, about 6–10 kB, an estimate), the entry, the game's chunk of M3-Q19, holding everything else the normal page runs (an estimate of 60–80 kB brotli: M3's shared simulation's 19 kB, the session and its parts about 25 kB, screens, input, audio, storage, their inlined styles and the drawing's own about 20–30 kB), and the dynamic ones: `drawer-model` (about 13 kB with GLTFLoader, M0), Trystero's (25 kB), `nettest`, `determinism`, `frames` and the bench's `witness` Worker. The simulation the test pages shared joins the entry, since the normal page imports it statically now.
- **The lines** the plugin prints and enforces (§1.57): the code-built way, `drawer-code` alone; the model way, `drawer-model` and any shipped model file, none in the MVP; each at most `budgetDownloadBytesPerWay` (200 kB), three not included (PLAN §12); and each group's files checked against its rule, so no line counts code it doesn't own. three's core, the game's chunk, Trystero's and the test pages' are printed beside them, so a commit's growth shows in its build's log, and decide nothing: PLAN gives them no figure (M4-Q32).
- **In the page,** Resource Timing shows that each way loads only its own chunks and assets: the code-built path never requests `drawer-model` or a `.glb`; the model path requests both (§9.3). A normal page still never requests a test page's chunk or Trystero's before a networked match (§9.3's `nettest.spec.ts`).

---

## 9. Tests (PLAN §16, §17's M4 entry)

### 9.1 How M4's tests are written

- **Through the real page and its controls** (L344): every behaviour a player meets is played by keys, the stubbed gamepad, emulated touch or clicks on the real screens, against the built `dist/` (`vite preview`, or the strict server with `dist/_headers` where §16 asks); no spec drives the session or the drawing directly, and the only test pages are PLAN's. A message the gate can't reach from a page has its Node test, as M4-Q39 records (§5.10).
- **Never on the frame rate** (C-6): the specs read logical state through `inspect()` and act on it, polling the hook every 50 ms, never on animation frames; no sleep stands in for a game event; each whole match's timeout comes from its measured runs, and a timeout prints the score, the clock and the hook's timer figures. A check of the drawing buffer reads the governor's scale from the hook: `cap` equals the quality's, and `width = round(cssWidth × min(devicePixelRatio, cap) × scale)`, so the governor's acting never fails it, and each spec logs the governor's actions (`frames.log`).
- **The gate's settings** (C-6, D-33): every spec that plays, Practice or a networked match, the controls' runs and the bench's smokes included, at a 640 × 360 viewport and stored low quality, from phase 1: a real window size and a real setting, which quarters software GL's fill against Playwright's 1280 × 720 (R-1, R-3); each spec asserts WebGL 2 first (`expectWebGL2`).
- **Every match is 1 minute and decisive by setup** (PLAN §16), by scripts the page can play exactly and Node has played whole over the latitude the page has (M4-Q36):
  - **Seed 7:** the profile is seeded with `personId(7, k)`, so each spec plays seed 7's setup, as M3's specs did.
  - **Holds start in the countdown:** a direction the setup holds is pressed at the first poll that shows a countdown, the start's or a kickoff's. In a countdown a held direction only turns the terrier on its spot (L118, D-8), its turn done in under 0.25 s at 2 turns a second, so the state at play's first tick doesn't depend on when in the countdown the key went down, and the hold acts from that tick as the validated setup's does. It's released at the first poll that shows 60 ticks of play, so only the release can be late, by the poll and an evaluate: up to 60 ticks is the latitude validated.
  - **Ready at a fixed tick:** each page presses Ready at the first poll at or past a fixed local tick: 600 for the whole matches; for the runs through the controls, the first of 600, 1,200, 1,800 and 2,400 at least 120 ticks after its warm-up script ends. Every tick from it to 60 later is validated.
  - **Presses that don't act:** WebKit's three jumps before its reload go in the start countdown, each while the hook shows at least a second of it left, since a press acts d ticks after its sample, and Chromium's closing Space starts once the head shows the end; D-10 drops a jump in a countdown, and the ended state takes no input (D-8's M2 note), so the setup's inputs stay the validated ones.
  - **The directions:** Practice holds A, step 8, sideways in ball view, the validated `SIDEWAYS` (`src/core/bot/setups.ts`); D would be step 24, which nothing validated. The three-engine setup's A player holds S, step 16, `BACK`.
  - **The views:** a spec holds a direction in play only in ball view; a run that switches view on Pre-match switches back before Ready, and asserts `render.camera.view` is `ball`.
  - **Validated in Node before the spec lands** (§9.2): Practice's by `setups` in phase 1, over Practice's own timeline; the three-engine one's by `slow-frames` in phase 2c, over the network simulator, under the rule §8.1 decides; each loop a file of its own (CLAUDE.md). A run that isn't decisive moves the anchor or the hold's length to a latitude that is, and the spec follows; no run is dropped.
  - **The spec checks what it played:** the hook's `controls.holds` and the Ready tick are logged and asserted inside the validated latitude, so a machine slow enough to leave it fails with that message rather than with an overtime; phase 1c measures each engine's latencies, and a latency past half its latitude widens the latitude, validated again first.
  - An overtime fails a spec at once.
- **The guard** on every page: no console error, WebGL's included, and no request outside the servers the spec loads from and its local relay; a deliberate break lists only the browser's own messages (`allowedErrors`); every leave prompt accepted but where `room.net.spec.ts` dismisses one. A refusal the page expects, a failed model load, Copy, Share, fullscreen, the orientation and wake locks, `resume()`, is caught and reported through the hook, never logged, and the stand-in's abort asserts no page error (§2.10).
- **What's transient is latched:** the hook reports what outlives the moment, so no check rests on polling a 0.3 s lunge or a 0.4 s bark as it happens: `mine.lunges` and `lastLungeTick`, `pounceWait`'s 1.5 s, the drawer's `overlaysShown`, the announcements' `barksShown`, `celebrationsShown` and Results' presses with their times, and `audio.decided`. A spec that compares final hashes compares only ticks still in the 256-tick history, where `hashAt` answers.
- **Storage** is seeded once per context, by an init script that writes a key only when it's absent (§1.62); a check of first use runs in a fresh context.
- **One build and one run at a time** (§0): every build and Playwright run under the machine-wide lock.

### 9.2 Unit tests (vitest, in the gate)

| File | Checks | Plan |
|---|---|---|
| `src/render/interpolate.test.ts` | the lerp and the short way round; the fraction spread over k ticks after a catch-up, the drawn time a tick behind the clock; no lerp across a placement, an arrival or a slot change, a placement inside a 6-tick catch-up included; the discrete fields from the nearer state | §12's each frame, D-16 |
| `src/render/smoothing.test.ts` | an offset glides to nothing linearly over its T, 100 ms for your terrier and 200 for the rest; bodies in contact in `after` share one offset and decay, so a pusher drawn against the ball stays against it, a group of your terrier and the ball at 100 ms and one with a remote terrier at 200; `prev`'s shift keeps the drawn pose continuous at any fraction; a correction across a phase's start, another timeline, or a placement snaps; a drawn position that would leave the pitch clamped inside it by the body's radius, its offset shortened and glided from there; a held head carried by its velocities, up to 6 ticks, then glided | D-16, D-27's M3 note, M4-Q14, M4-Q15 |
| `src/render/blends.test.ts` | a phase change and a correction's move both cross-fade over 150 ms; one taken back fades out, one added blends in part-way through; the weights sum to 1; every time on the drawing clock, so nothing moves while it's stopped | D-27, L208, Q-15 |
| `src/render/drawers/pose.test.ts` | each phase's pose at its start and end; the overlays, the bark's and the celebration's among them | D-27, L98 |
| `src/render/continuity.test.ts` | a correction that moves a pounce's start by 3 ticks moves no joint further in that frame than in the frames around it, on the layers phase 3's `Blends` gives (motion) | PLAN §16, D-27 |
| `src/render/drawers/code.test.ts` | the spike's: the box of L310, the fit at contacts from 31.6° to 90° with the pushing pose for `pushPoseTicks` and without it, under the budget's 2,000 triangles and 40 calls, every coat and both packs painted, the counts' overlays drawing and shown; with the look book's other shapes, the fit | D-27, §12, L310 |
| `src/render/palette.test.ts` | coats against both packs and the grass, packs against each other and both floors, under three dichromacies, by `palette-check.ts` | §12, C-51 |
| `src/render/camera-rig.test.ts`, `camera.test.ts`, `fade.test.ts` | §3.6 | D-28, PLAN §16's cameras |
| `src/render/view.test.ts` | composing and drawing a frame leaves the head's hash unchanged, on states from M2's scenes and a bot match (P11); a bark from a received input and from the press, none from a predicted one; the celebration overlay from a latched goal, withdrawn with it; the drawing clock still while the source is paused | P11, D-14, D-16, Q-15 |
| `src/render/ball.test.ts`, `shadows.test.ts` | the squash's volume, its cap and its settling (the spike's); its axis the state's hit change | §12 |
| `src/input/anchoring.test.ts`, `sweep.test.ts` | §4.5; the 90° sweep in 0.5 s and 1 s within ±10% of Q-19's model at both camera settings, then pinned | D-29, Q-19, C-24 |
| `src/input/controls.test.ts` | the press counters, at most one step a tick; a tap shorter than a tick counts; the rebase; the bark gap (L327); the view press; the devices merged; the holds' spans and the key-to-screen figure from a device's event times | D-10, D-29, L327, R-6 |
| `src/input/keyboard.test.ts`, `gamepad.test.ts`, `touch.test.ts` | by `event.code`, repeats ignored, released on blur and hidden; the pad's rising edges, mapping and timer; the stick's dead zone, rim and edge margin (jsdom-free: their state machines are pure, the DOM wiring thin) | D-29 |
| `src/input/hints.test.ts` | the bitmask per kind, cleared and reset | D-29, L83 |
| `src/audio/cues.test.ts`, `audio.test.ts`, `src/core/session/barks.test.ts` | §7's | PLAN §13, D-16 |
| `src/storage/profile.test.ts`, `settings.test.ts`, `kv.test.ts`, `tab-lock.test.ts` | A.3's shapes; the nulls follow their rules until chosen; an unreadable profile backed up; a failed write loses that write only; relay and TURN checks; the lock, with a fake `navigator.locks` | PLAN §16's storage, D-24 |
| `src/core/names.test.ts` | `nameAllowed(fitName(s))` for any string (fast-check), and roslambo's cases | C-17 |
| `src/ui/nav.test.ts` | Q-17's moves, presses and repeats; an `aria-disabled` button focusable and never pressed, by key, pad or click; Results' guard for keys, pad and pointer, each press reported | Q-17 |
| `src/ui/match.test.ts` | the adapter over `PracticeGame` in virtual time (`clock-testing.ts`): pause reasons compose; Play again; the sampler's tick; `own()` over a catch-up | Q-15, D-22, §8.1 |
| `src/ui/app.test.ts` | the start-up order with fakes (§5.1), prepare held while another tab has the lock; the fragment's routes; each status to its message; the announcements log kept across Pre-match, Match and Results, one per match ID | §11, D-24, M4-Q38 |
| `src/ui/frame-loop.test.ts` | §8.2's steps in virtual time, phase 1's every-other-frame fallback first | §17's "From M3" |
| `src/ui/leave-guard.test.ts` | on Node's own `EventTarget`: registered first and active, it stops the event with `stopImmediatePropagation`, so a later listener on the same target never hears it; inactive, the later listener does | M3-Q20 |
| `src/ui/canary.test.ts` | the define is goldens.json's canary; a mismatch says no | D-23 |
| `scripts/chunk-budget.test.mjs`, `scripts/make-standin.test.mjs` | the plugin's lines, its failure over budget and on a group holding a stray file, on synthetic bundles; the stand-in byte-identical, its clips, bones, skins and texture | §12, D-27 |
| `scripts/eslint/config.test.mjs` | §1.55's targets, each with a fixture that fails and one that passes | D-38 |
| `src/config.test.ts`, `dev/tuning/model.test.ts` | §10's rows and `NOT_TUNED` | PLAN §7.4 |
| `dev/look-book/model.test.ts` | the samples' looks valid, each coat count, the budget counts table | Q-11 |
| `src/net/practice-spec-whole-1.test.ts` to `-5` (setups, phase 1) | seed 7's Practice played whole over Practice's own timeline, the person holding A from each countdown and releasing it 60 + e ticks into play, with Ready at every tick from 600 to 660 and e at 0, at 60, and drawn for each kickoff from a seeded generator: 183 matches, each ending at 0:00 with the bot's pack ahead; and the person's state at play's first tick the same whether its hold began at the countdown's first tick, its middle or 30 ticks before its end | §16's Practice, M4-Q36 |
| `src/net/practice-spec-goal-1.test.ts` to `-4` (setups) | seed 7 to the bot's first confirmed goal, A held as above, with Ready at every tick of each controls-run anchor's band, 600–660, 1,200–1,260, 1,800–1,860 and 2,400–2,460, e drawn for each run: 244 runs | the same |
| `src/net/screens-setup-1.test.ts` to `-7` (slow-frames, phase 2c) | §9.4's setup for seed 7 over the network simulator, by `setups-testing.ts` extended with the specs' scripts: Chromium's player holding S from each countdown to 60 + e ticks of play, WebKit's three jumps in the start countdown, Ready at 600, 630 and 660 with e at 0, at 60 and drawn, the reload away 0.5, 2 or 5 s by turns; and with the proposer's timers paced at 50 and 100 ms, Ready at 600 and 660, e drawn: 13 matches, each ending at 0:00 with pack A ahead | §16's three-engine match, M4-Q6, M4-Q36 |

### 9.3 End-to-end specs (Playwright, in the gate)

Times are estimates in software GL on the development machine at 640 × 360 and low quality, from M3's runs and the setups' measured lengths.

| Spec | Engines | What it plays and checks | Plan | Est. |
|---|---|---|---|---|
| `e2e/practice.spec.ts`: the whole match | Chromium | §9.5: 1 a side against one bot, through Home, Practice's setup, Pre-match, Match and Results on the keyboard, the stand-in drawing the terriers from phase 3, then Play again to Pre-match, then Leave; nothing contacted; nothing compiles in play | L238, L283, P10, §16's Practice, the stand-in | 165 s |
| `e2e/practice.spec.ts`: through the controls | each engine | §9.5: every control on the keyboard and from phase 2 on the stubbed gamepad, the hints and Show control hints again, your mark, the arrow, the bark marks, from phase 3 names, the menu by Escape and Back, a hidden page, a reload going Home, to the first confirmed goal; Firefox and WebKit with the stand-in under `dist/_headers` through the goal's celebration (phase 3) | L73–L83, Q-15, Q-17, L52, D-29, L284 | 75–90 s each |
| `e2e/match.screens.net.spec.ts` | net | §9.4 | L280–L282, L344, §16's three-engine match, page-F4 | 200 s |
| `e2e/watchers.net.spec.ts` | net | Chromium, one browser with six contexts: a proposer at pack size 2 plays in A on a networked Pre-match; Add a bot, Remove a bot (the button gone and the roster back), Add again; Invite shown; axe on that Pre-match; four watchers open the link and Watch; a fifth is shown "This match has the most spectators it can take" with Try again, axe; one watcher's Leave goes Home with the fragment cleared, and the others' peer counts fall | D-39, C-11, L166, PLAN §11 | 45 s |
| `e2e/match.net.spec.ts` | net | M3's, unchanged (M4-Q20) | P1, P2, P9 | 145 s (M3's) |
| `e2e/practice-net.spec.ts` | Chromium | M3's, unchanged: Practice through `#test=net` to the first goal, contacting nothing | P10 | M3's |
| `e2e/room.net.spec.ts` | net | Chromium, Firefox and WebKit over the local relay, a pack-size-2 room: Chromium's player and a bot in A, Firefox's and WebKit's in B. From phase 2d: a page whose bundle is rewritten by interception is refused for its build, with its message; on Pre-match, Firefox's leave prompt dismissed after a key press there (`page.once('dialog', d => d.dismiss())`, then `page.close({ runBeforeUnload: true })`): the page stays open, and seconds later every page still counts the others as peers and takes Firefox's TICKs; then a Chromium watcher's page has its prompt accepted, and the others see it leave. From phase 3 (robust), the players press Ready and play, and each player's page loses its context in turn by `WEBGL_lose_context`, never restored: its message with Leave after 5 s, axe, while the other pages still take its inputs and votes, their stats' received inputs and agreeing tallies rising | §16's mismatch and lost context in each engine, D-30, M3-Q20 | 110 s |
| `e2e/standin.spec.ts` | Chromium | the stand-in delayed 5 s: code-built first, swapped mid-match, `headHashMismatches` 0 across the swap and every final hash still in the history unchanged; refused with `route.abort`: code-built through the first goal, `render.model` failed with its error, only the browser's failed-request message allowed and no page error; every coat and both packs painted on Practice's Pre-match at 4 a side, over as many starts as that takes (one, with a seeded ID whose bots' coats cover the rest), its budget counts at both qualities; a bark and a celebration played on it (its counts' `overlaysShown`); Resource Timing: the model's chunk and `.glb` requested, and on the code-built path never | D-27, §12, L252, C-33 | 100 s |
| `e2e/graphics.spec.ts` | each engine | in Practice: `WEBGL_lose_context` mid-match, the clock stopped until the context is back, restored within 5 s, the pitch drawing again with the drawer's counts as before; lost again, never restored, the plain message after 5 s, axe, Practice paused; the render quality changed in the menu's Settings, the rebuild when it closes with Practice paused through it, the new setting's counts, and no stall through each rebuild, its largest timer gap logged | D-30, D-33, Q-15, C-36, M4-Q41 | 40 s each |
| `e2e/screens.spec.ts` | each engine | axe on Home, Settings, Practice's setup, Propose, Practice's Pre-match, Match with its menu and the Settings panel; Home's name and coat stored and kept after a reload; Settings' checks; start in ball view off, sound off and the calmer camera on from Home's Settings, then a short Practice: chase view from its start (`render.camera.view`), the calmer rig (`render.camera.calm`), a bark decided and none played; with `prefers-reduced-motion` emulated, the calmer camera on until chosen; Switch pack and back on Practice's Pre-match; Join with a bad code contacting nothing; the canary: the page's expected hash rewritten by interception, Propose and Join say why and open no room, Practice reaches its start countdown; a second page in the same context shows the other-tab message, Use here moves the game there, and the first shows the message. Chromium only: the sound prompt before any key and gone after one, the context running; and the connection failure, with a local relay started for it, the hook's `relay` set and `ice: 'none'`, a match ID nobody proposed, its message after 20 s, axe | D-23, D-24, D-30, PLAN §10, §11, L169 | 90 s each, +40 s |
| `e2e/touch.spec.ts` | Chromium | the stick by CDP touches, its rim for zoomies, jump and pounce held at once, a finger sliding off; the bark and view buttons; a touch inside the edge margin doesn't move the stick; the six touch hints clearing; axe on the control layer with its hints panel showing; a phone upright (412 × 915, `hasTouch`) shows the turn prompt on Pre-match, axe on it, and sideways (915 × 412) clears it; the mirrored layout puts the stick on the right | D-29, D-30, L169, L170, L284 | 45 s |
| `e2e/frames.spec.ts` | Chromium | `#test=frames&seconds=5`: the bench plays and reports, eight terriers in, no error; and `repair=1` with a hold 1 s in, the witness's Worker answering its STATE_REQ (M4-Q18) | §16's bench | 40 s |
| `e2e/pitch.spec.ts` | each engine | one Practice Pre-match at 4 a side: pack A's near half bluer and pack B's far half redder, from the player's ball view (no overview draws on Home now, M4-Q9); nothing compiled after `firstFrame`; the one landmark, the pitch a named image, axe; the canvas filling the window at two sizes, by §9.1's scale rule; the frame rate reported, not judged; and the quality set through Home's Settings at both: the cap, MSAA, the nets' ropes, and from phase 3 the code-built budget for 8 terriers, triangles a terrier ≤ 2,000 and draw calls ≤ 40 | M1's, D-33, §12's budget | 40 s |
| `e2e/smoke.spec.ts`, `determinism.spec.ts`, `nettest.spec.ts`, `boot.spec.ts` | each engine | adapted: the page served three ways reaching Practice's Pre-match and drawing; the page's module holding the canary's hash and no golden (M4-Q5); a normal page's scripts, its entry's static imports included, and no test page's or Trystero's; boot's insecure-context test through `mountDist`'s MIME map, and its `file://` test still showing F with only the engines' own refusals of the module | M1–M3's, L232 | +35 s an engine |

### 9.4 The three-engine match through the screens (`e2e/match.screens.net.spec.ts`)

PLAN §16's, through `e2e/lib/browsers.ts`'s engines and the local relay, each page with the hook's `relay` and `ice: 'local'` (M4-Q3), stored low quality and a 640 × 360 viewport, and a profile seeded with `personId(7, k)` and a name:
1. **Chromium proposes:** Home, Propose a match, pack size 2, 1 minute, Create; reads the link and the code from Created; Play in pack A; on Pre-match, Add a bot to pack A.
2. **Firefox joins by link** (`page.goto(link)`): Connecting…, then Play in pack B. **WebKit by typed code:** Home, the code typed in lower case, Join, then Play in pack B.
3. **Warm-up:** every player moves its terrier from the keyboard (W held for 30 ticks), and the hook shows each terrier moved.
4. **Ready** by Enter on Chromium and Firefox, Ready focused since Pre-match's entry, and by the stubbed gamepad's Start on WebKit (Q-17), each at the first poll at or past its local tick 600 (§9.1). The start countdown begins, and WebKit's player presses Space three times in it, each while the hook shows at least a second of it left, so that even with its d ticks of delay no press reaches play.
5. **In play:** from each countdown Chromium's player holds S (back, in ball view), released at the first poll after 60 ticks of play; B's players hold nothing; so A's bot scores against a pack that doesn't defend (Q-9).
6. **Mid-match** (from the keeper's hook, never a sleep): a fourth page, Chromium, opens the link and presses Watch once play shows under 50 s on the clock, and follows the ball, then the next by the view key (C), then by the pad's right shoulder and back by its left, then a terrier by tapping its name in the HUD's list, `layers.hud.following` and `render.camera` following each; WebKit's page reloads once it's under 35 s (the leave prompt accepted), skips Join, and takes its terrier back.
7. **The end:** Chromium's player holds Space from the first poll that shows the head's end, through the final whistle, and mashes it as Results appear, each press going into the announcements log; every press within 0.5 s of Results was dropped there, and Results' buttons stayed unpressed. Then, once the log shows 0.5 s passed, Play again by Enter on Chromium and by the gamepad's Start on WebKit, both reaching the next match's Pre-match.
- **It checks:** the terriers and the ball moved; from the app's announcements log, which outlives its screens, every page showed what it could have since its arrival, the first tick its timeline held: each countdown whose first tick came after it, and each goal latched since, a goal under way at the arrival required unless the arrival came in the last 141 of its celebration's 204 ticks (d + w + 1 + 6 + 120), as M3's spec rules (page-F3); every page's Results showed the same score, rows and Terriest; A scored and the score wasn't level at 0:00; one hash at a common final tick (`hashAt`); the spectator's page saw the same match (L281); WebKit's page returned (`returning`), its first input after the rebase holding the base's counters and its terrier's take-off tick unchanged across the return in every page (page-F4); nothing compiled from the start countdown to Results on the pages that didn't reload or join mid-match (`renderer.info`'s three counts); the holds and Ready ticks inside their latitude (§9.1); axe on Created, on Firefox's and WebKit's Join, and on every page's Results; `expectEverywhere` on all four pages.
- **Its timeout** comes from the Node runs of its setup (§9.2), their slowest end, and the screens' setup, about 200 s in all, measured in phase 2d before it's fixed.

### 9.5 Practice through the screens (`e2e/practice.spec.ts`)

As M4 ends; it grows by phase: the keyboard, the menu, the HUD's meter and pounce wait, your mark, the arrow, the bark marks and the whole match in phase 1; the gamepad, the hints, Show control hints again, the readout and Copy in phase 2; the stand-in, names and away marks in phase 3 (§12).

- **The whole match, Chromium** (PLAN §16's Practice): the profile seeded with `personId(7, 0)`, `countPeerConnections` before load, at 640 × 360 and stored low quality, and from phase 3 the stand-in served by interception to the page on the strict server with `dist/_headers` applied unchanged (PLAN §16: Practice needs no relay, so the shipped policy is tested as it is). Home, Practice, 1 a side, 1 minute, Start; Ready focused from Pre-match's entry; the stand-in drawn (`render.model.state === 'drawn'`) before tick 600, or the spec fails saying so; Ready by Enter at the first poll at or past tick 600; from each countdown A held, released at the first poll after 60 ticks of play (§9.1). Once the second goal has latched, Escape opens the menu in its celebration, and the clock stops (the hook's local tick and the drawing clock unchanged over 30 ticks' worth of time); Enter presses Resume. Once the fourth has latched, Escape opens it and Escape closes it, and the clock runs on. To Results, the bot's pack ahead; the network figures shown; Copy pressed, the clipboard granted in Chromium and the copied text the summary's; Play again to a new Pre-match; Leave to Home. **Nothing contacted:** the guard saw only the page's origin, no WebSocket, no `RTCPeerConnection` made (and none on Home), Trystero's chunk never requested (L238, P10). **Nothing compiled in play** from the start countdown to Results. The hook's timer saw no stall; its largest gap, the governor's actions and the key-to-screen latency are logged.
- **Through the controls, in each engine:** at 640 × 360 and low quality, in a fresh context, so every hint shows. On Pre-match each of W, A, S, D, Space, Shift, E, Q and C is used once, the hook showing the terrier move, jump (`takeOffTick`), zoom (`anim`), pounce (`pounceWait` and `lunges`), bark (the overlay's bark mark and the drawer's `overlaysShown.barking`) and the view switch (`render.camera.view`), the keyboard's hints clearing control by control; in chase view S is held until the ball is behind the camera and the arrow shows (`layers.overlay.arrow`), then C again, back to ball view. From phase 2, the gamepad stub's stick, buttons 0, 2, 3 and 5 (twice, back to ball view) and the trigger likewise, its hints too. Your terrier's mark shown; from phase 3, names over the others after Settings' names is turned on from the menu's panel. `render.camera.view` asserted `ball`; Ready by Enter in phase 1, by the pad's Start from phase 2, at the first anchor at least 120 ticks after the script (§9.1); A held from the countdown as above; play to the first confirmed goal. The menu by Escape, and from phase 2 by the pad's Back, which closes it too; Resume by Enter or Start; a hidden page (`visibilitychange`, emulated) opens the menu; a reload goes Home, and the hints stay cleared. From phase 2, Settings' Show control hints again from Home, and a new Practice's Pre-match shows the keyboard's hints again. Firefox and WebKit play it with the stand-in under `dist/_headers` on the strict server, through the first goal's celebration (PLAN §16), and check its counts.

### 9.6 Accessibility

axe with its default rules, a violation failing the spec:

| Screen | Where, and in which engines |
|---|---|
| Home, Settings, Practice's setup, Propose, Practice's Pre-match, Match, the menu and the Settings panel | `screens.spec.ts`, each engine |
| Created; Join | the screens' match: Created in Chromium, Join in Firefox and WebKit |
| A networked Pre-match with Add a bot, Remove a bot and Invite | `watchers.net.spec.ts`, Chromium |
| Results | the screens' match, each engine |
| The messages | `graphics` in each engine (`graphics.spec.ts`); `spectators` and `connect` in Chromium; they share one component |
| The touch control layer with its hints panel; the turn prompt | `touch.spec.ts`, Chromium |
| The boot failures | `boot.spec.ts`, each engine (M1's) |

Beyond axe, the specs check the focus Q-17 names: Ready first on Pre-match from its entry, while it reads "Joining…" and once it can act; Resume first in Practice's menu; Play again first on Results. Text over the pitch sits on opaque backings, so axe's contrast checks reach it (§5.14).

### 9.7 Off the gate

- **The bench's runs** (§8.4), by `e2e/frames.run.ts` and `playwright.frames.config.ts`, writing to `TERRIEST_FRAMES_OUT`, each on a quiet machine.
- **The look book and the feel page** (§1.60, §1.61): dev only; their models' tests are in the gate.
- **Practice under `npm run dev`:** `e2e/dev-practice.run.ts`, matched by `playwright.dev-local.config.ts`'s pattern beside `dev-local.run.ts`, plays Practice through the screens to its first goal on the dev server, so phase 1's exit sees the dev path too.
- **The owner's checks by hand** (§14).

### 9.8 §17's M4 exits, and §16's M4 items, where each is met

| Exit or item | Met by |
|---|---|
| A full match playable by link and by code over the local relay, through every screen | `match.screens.net.spec.ts`; the owner's match through `npm run dev:local` (§14) |
| The stand-in plays the Practice match in the gate | `practice.spec.ts`'s whole match; `standin.spec.ts` |
| Your desktop checks pass | §14: the owner, or provisionally in the headless engines on C-6's GPU path |
| The chase-view swing tuned, the feel values confirmed (Q-10) | §3.5, §14 |
| The bots' level accepted (Q-9) | §14 |
| The look picked (Q-11) | §14 |
| The network summary on Results with Copy (M3-Q24) | `readout.ts`; `practice.spec.ts`'s whole match |
| The rebase on return through the real page (page-F4) | `match.screens.net.spec.ts`, §4.6 |
| Watch on return (page-F5) | decided by M4-Q2; `match.screens.net.spec.ts`'s reload skips Join |
| The snap across a phase's start | `smoothing.test.ts` |
| The chunk budget (M3-Q19) | `chunk-budget.mjs` in every build, its groups checked; `standin.spec.ts`'s Resource Timing |
| The canary wired to Propose and Join | `screens.spec.ts`; `determinism.spec.ts`'s module check |
| The timers' cadence with real frames | the hook's timer figures in every whole-match spec; the bench's run 4, with the clock's samples |
| The forced repair in throttled Chromium | the bench's run 3, its witness in a Worker |
| The leave prompt before the room | `leave-guard.test.ts` on Node's `EventTarget`; `room.net.spec.ts`'s prompt dismissed on a connected page |
| The load run's lessons | §8: the governor on what slow frames cost, the bench's shared delivery and backlog, the slow-frame share measured and M4-Q6 decided before the networked specs |
| The frame-time run in `docs/acceptance.md` | the bench's run 1, with the stand-in too; the owner's and the provisional settle |
| The device runs and the manual checks in `docs/acceptance.md` | 4c: M4's checks and each M5 device run's method with its pending row (§1.64) |
| Every control on a keyboard, a touch screen and a gamepad (L284) | `practice.spec.ts` (keyboard and pad), `touch.spec.ts` (all six touch controls) |
| Interpolation, smoothing, P11, palette, pose continuity, cameras, anchoring, barks, sound | §9.2 |
| Touch, gamepad, Practice, the stand-in, hints, marks, the phone, boot, a lost context in each engine, nothing compiles, subpath, mismatch, canary, Everywhere | §9.3 |

### 9.9 The gate's cost, and keeping it reasonable

- **Today:** about 8.6 minutes (513.0 and 519.3 s at M3's exit): the unit stage about 4 minutes, CPU-bound, the end-to-end stage 4.0 minutes, of which the networked match is 2.4.
- **M4's growth, estimated row by row,** one worker as now:

| Stage | What it adds | Est. |
|---|---|---|
| Lint, public-scan, typecheck | more code | about 1 min |
| Unit | M3's 228–253 s; M4's own files, 10–20 s of test time; the setups' Node runs, about 60 s of test time for Practice's and 290 s for the screens' 13 matches under the gate's load, spread over its workers | about 4.5–5 min |
| Build | the plugin's brotli, 2–5 s | about 0.5 min |
| Chromium | the whole Practice 165 s, the controls 75, graphics 40, screens 130, touch 45, frames 40, the stand-in 100, pitch 40, the adapted smoke, determinism, nettest and boot about 70, M3's practice-net 25 | about 12 min |
| Firefox | the controls with the stand-in 85, graphics 40, screens 90, pitch 40, the adapted 70 | about 5.5 min |
| WebKit | the same, slower | about 6 min |
| net | the screens' match 200, watchers 45, M3's match 145, room 110 | about 8.3 min |

  So **about 37–39 minutes** with one worker, against 8.6: higher than the first estimate, whose rows didn't sum to its total, and with this revision's specs and Node runs added. Phase 1 alone adds about 9–10 minutes (the whole Practice, the three runs through the controls, the adapted specs, Practice's setup files), phase 2 about 13 (the screens' match, the watchers and the room, screens.spec, touch, the bench's smokes, the screens' setup files), phase 3 about 6 (graphics, the stand-in, the networked lost contexts, the budget's counts).
- **Without weakening a check:**
  1. **Fewer page loads,** already in the estimate: pitch.spec's five loads in two tests; the controls, hints, marks, names, the gamepad and the menu in one Practice per engine; the stand-in inside Firefox's and WebKit's; the build mismatch, the leave prompt and the networked lost contexts in one room.
  2. **Software GL's fill:** 640 × 360 and low quality for every spec that plays.
  3. **Workers** (M4-Q19): the three engines' projects with 3 workers, the `net` project's specs after them one at a time, since each launches several engines and their timers must not starve (the load run's lesson); `npm run e2e` becomes two Playwright runs, in that order. Measured in phase 2d: adopted only if every spec stays green in three consecutive gate runs, each alone on a quiet machine; the end-to-end stage is then about 16–17 minutes, the three engines' 23–24 minutes of specs over 3 workers and the `net` project's 8.3 after them, and the gate **about 23–25 minutes**.
  4. **The owner's options,** none weakening a check: Q-18's alternative, the full gate only before `/merge-to-main` and at milestones, with lint, typecheck and the unit tests before each commit, **adopted by the owner on 2026-11-20** (`npm run check:commit`, with public-scan beside them); and retiring M3's `#test=net` match once the screens' match asserts everything it does, its 2.4 minutes saved (M4-Q20).
- **CI** (M4-Q37): the hosted runner has 4 vCPUs and hasn't yet run M3's gate; its unit stage alone, about 2,400–2,600 s of test time on vitest's 3 workers there, would take about 14 minutes, and three Playwright workers each drawing in software there invite the stall R-3 names. So `.github/workflows/check.yml` becomes a matrix that keeps every check: a build job, with lint, public-scan and typecheck, uploading `dist/` as an artifact; the unit stage in 3 vitest shards (`--shard=i/3`); one end-to-end job for each Playwright project, under `xvfb-run` at one worker, from the artifact; the arm64 unit job sharded the same way; and the check green only when every job is. The local gate stays one `npm run check`, under the lock.
- Nothing is cut: no engine, seed, setup or spec.

---

## 10. Config additions (PLAN §7.4, A.4, A.5)

`src/config.ts` already holds most of what M4 reads: the cameras' swing (A.5), the stick's steps, hysteresis and dead zone and chase view's re-read (A.4's Stick), the touch edge margin, the smoothing, the timer, the phone's size, Results' press guard, the lost graphics' 5 s, the render qualities, the sound's 3-tick shift, the coat count and the bots' reaction and aim noise. Phase 1a adds the rest, all at once, so no later builder touches the configuration (§0) but 2c's, if M4-Q6 adopts its one setting:

| Key | Value | Source | Row | `NOT_TUNED`'s reason |
|---|---|---|---|---|
| `pushPoseTicks` | 8 | M0's `PUSH_TICKS`, which D-27's M2 note sends to A.4 at M4 | A.4, Pushing pose | drawing's pushing pose (D-27), M4 |
| `animationBlendMs` | 150 | new: a starting value, the owner may change it (M4-Q12) | A.4, Animation blends | drawing's blends (D-27, L208), M4 |
| `heldHeadCarryTicks` | 6 | new (M4-Q14) | A.4, A held head | drawing's held head (D-16), M4 |
| `gamepadPollHz` | 60 | D-29's 60 Hz timer | A.4, Gamepad | the gamepad's (D-29), M4 |
| `gamepadTriggerFraction` | 0.5 | new: the right trigger held past half its travel | A.4, Gamepad | the gamepad's (D-29), M4 |
| `drawingLateTimerMs` | 50 | new (§8.2): a timer gap longer than this is late | A.4, Drawing gives way | the page's main-thread share (§8.2), M4 |
| `drawingLateShare` | 0.1 | new: of a second's ticks skipped, or of its time in late gaps | A.4, Drawing gives way | the same |
| `drawingScaleStep` | 0.25 | new | A.4, Drawing gives way | the same |
| `drawingScaleMin` | 0.5 | new | A.4, Drawing gives way | the same |
| `drawingRecoverSeconds` | 3 | new | A.4, Drawing gives way | the same |
| `budgetCodeTrianglesPerTerrier` | 2000 | PLAN §12's starting guesses | A.4, Drawing budget | the drawing budget (§12, C-2), checked in the page and the build |
| `budgetModelTrianglesPerTerrier` | 8000 | the same | A.4, Drawing budget | the same |
| `budgetModelBonesPerTerrier` | 32 | the same | A.4, Drawing budget | the same |
| `budgetModelTexturePx` | 512 | the same | A.4, Drawing budget | the same |
| `budgetDrawCalls` | 40 | the same, for 8 terriers | A.4, Drawing budget | the same |
| `budgetDownloadBytesPerWay` | 200000 | the same, brotli, three not included | A.4, Drawing budget | the same |
| `terrierModelUrl` | `''` | D-27: "a render setting, empty in the MVP" | A.4, Terrier model | the model drawer's (D-27), empty in the MVP |
| `cameraBehindMetres` | 4.2 | the spike's camera | A.5, Players' cameras | a camera's (D-28), tuned at M4 on the feel page |
| `cameraAboveMetres` | 2.1 | the spike's camera | A.5, Players' cameras | the same |
| `cameraFovDegrees` | 55 | the spike's camera | A.5, Players' cameras | the same |
| `cameraWallMarginMetres` | 0.4 | the spike's camera | A.5, Players' cameras | the same |
| `cameraNearestMetres` | 1.5 | new (§3.2): nearer the terrier than this, the camera rises | A.5, Players' cameras | the same |
| `chaseLookAheadMetres` | 2 | the spike's camera | A.5, Players' cameras | the same |
| `spectatorViewLengthMetres` | 24 | new | A.5, Spectators' camera | the spectators' camera (D-28), M4 |
| `spectatorFollowSeconds` | 0.5 | new | A.5, Spectators' camera | the same |
| `stallSendAllTicks`, only if M4-Q6 adopts it in 2c | 5 | M4-Q6 (§8.1) | A.4, Timer stall | the timeline's sending after a catch-up (D-10, D-31), M4, beside `stallSendTicks` |

**PLAN's rows,** each marked M4, worded so `src/config.test.ts`'s `numbersIn` reads exactly the numbers its map gives: its rules strip §-numbers and the Q-, D-, C-, P-, L- and M-references, read a percentage as a fraction, and read "one", "twice" and "half" as numbers, so no row says "one" for a thing. A row never cites `research/m4/DESIGN.md` by path, whose `m4` would read as a 4; it says "M4's design".

| Table | Row | Value | Map in `src/config.test.ts` |
|---|---|---|---|
| A.4 | Pushing pose | the code-built terrier draws its pushing pose for 8 ticks after a contact with the ball or a terrier, so its head stays out of the ball (M0's, D-27; M4) | `{ keys: ['pushPoseTicks'] }` |
| A.4 | Animation blends | an animation fades into the next over 150 ms, and so does an animation a correction moves, adds or takes back; an overlay fades in and out alike (D-27, L208; M4) | `{ keys: ['animationBlendMs'] }` |
| A.4 | A held head | while a spread holds the drawn head, its bodies are drawn carried on by their velocities for up to 6 ticks, then glided (D-16; M4) | `{ keys: ['heldHeadCarryTicks'] }` |
| A.4 | Gamepad | read at each sampled tick, and on a 60 Hz timer of its own while none is sampled; the right trigger counts as held past half its travel (D-29; M4) | `{ keys: ['gamepadPollHz', 'gamepadTriggerFraction'] }` |
| A.4 | Drawing gives way | drawing gives way when, over a second, more than 10% of the ticks this page sends for were skipped, or more than 10% of the second passed in timer gaps longer than 50 ms: the pixel ratio falls by 0.25 of its cap, to 0.5 at least, and then every other frame is skipped; it steps back after 3 s with neither (M4's design §8.2; M4) | `{ keys: ['drawingLateShare', 'drawingLateTimerMs', 'drawingScaleStep', 'drawingScaleMin', 'drawingRecoverSeconds'], numbers: (c) => [c.drawingLateShare, c.drawingLateShare, c.drawingLateTimerMs, c.drawingScaleStep, c.drawingScaleMin, c.drawingRecoverSeconds] }` |
| A.4 | Drawing budget | a code-built terrier at most 2,000 triangles; a model at most 8,000 triangles, 32 bones and a 512 × 512 texture; at most 40 draw calls for eight terriers; each way of drawing them at most 200 kB brotli, three not included (§12's starting guesses, a ceiling until the phone has run, C-2; M4) | `numbers: (c) => [c.budgetCodeTrianglesPerTerrier, c.budgetModelTrianglesPerTerrier, c.budgetModelBonesPerTerrier, c.budgetModelTexturePx, c.budgetModelTexturePx, c.budgetDrawCalls, c.budgetDownloadBytesPerWay / 1000]` |
| A.4 | Terrier model | none: terriers are built in code; a model named here would load through the model drawer, as the tests' stand-in does (L97, D-27; M4) | `{ keys: ['terrierModelUrl'], numbers: () => [], holds: (c, v) => c.terrierModelUrl === '' && v.startsWith('none') }` |
| A.5 | Players' cameras | 4.2 m behind the terrier and 2.1 m above its floor point, a 55° vertical field of view, kept 0.4 m inside the walls, the goals and under the net, and raised when that leaves it nearer than 1.5 m to the terrier; chase view looks 2 m ahead of it (D-28; tuned at M4 with the swing, Q-10) | `{ keys: ['cameraBehindMetres', 'cameraAboveMetres', 'cameraFovDegrees', 'cameraWallMarginMetres', 'cameraNearestMetres', 'chaseLookAheadMetres'] }` |
| A.5 | Spectators' camera | high above the near side, framing 24 m of the pitch's length round the ball or the terrier followed, easing after it with a 0.5 s time constant (D-28, L91; tuned at M4) | `{ keys: ['spectatorViewLengthMetres', 'spectatorFollowSeconds'] }` |

If M4-Q6 adopts K = 5, 2c rewords A.4's Timer stall row to say that after a shorter gap "a networked page sends every tick's input for a catch-up of up to 5 ticks, and only its newest 3 for a longer one (M3, M4)", with its map in step, and §7.4's check gains `stallSendAllTicks` as a whole number from `stallSendTicks` to d + w.

- **One configuration check more** (PLAN §7.4), with a planted bad value: a player's camera fits the pitch: `cameraAboveMetres + cameraWallMarginMetres` under the walls' and net's `heightMetres` and under the goal's mouth height, 3 m, so a camera at its height fits inside a goal too; `cameraBehindMetres` under half the pitch's width less the margin; and `cameraNearestMetres` under `cameraBehindMetres` and under the goal's depth less the margin, so `insidePitch` and the rise always have room (`src/config.test.ts`).
- **How the scan accepts them:** each is read from `config` where it's used, never copied: `src/render` reads `config.pushPoseTicks`, the camera keys, the budget's figures (the drawers' tests and the page's counts) and `config.terrierModelUrl`; `src/input` the gamepad's and the stick's; `src/ui/frame-loop.ts` the drawing's; `scripts/chunk-budget.mjs` gets `budgetDownloadBytesPerWay` from `vite.config.ts`, which imports `src/config.ts`. `src/config.test.ts` scans `src` and `dev` for a declaration named like any of these, unit aside, holding a literal (§0); `scripts/` isn't scanned, and the plugin takes the figure as an option. Constants of the look (proportions, colours, a sound's envelope, the dither's matrix) and the drawing constants §3.2 names aren't settings, and are named so the scan never mistakes them: no `blend…Ms`, no `camera…`, no `budget…` outside `src/config.ts`.
- **`dev/tuning/model.ts`:** every key in `NOT_TUNED` with its reason, since neither `simParams` nor `botParams` reads one, which its test checks. The feel page's model (phase 4) offers sliders for the camera keys, the swing's, the five feel values' and the bots' two levers, and adds `ROWS` entries for the cameras' rows so its Copy settings writes them (§1.61).
- **REQUIREMENTS** gains nothing: the chase-view swing's TBD in its Configuration table waits for the owner's sign-off, as M2's values do (§2's Q-10 row, §14).

---

## 11. Dependencies

None. M4 runs no `npm install`:
- **three 0.187.0** (MIT, exact, D-26) already carries GLTFLoader, SkeletonUtils and BufferGeometryUtils under `three/addons/…`; `@types/three` 0.187.0 types them; its notice already ships (`scripts/expected-licenses.json` has had three since M1). The dist audit's `ignoredPaths: ['/']`, for `LoaderUtils.extractUrlBase`'s separator, was written for GLTFLoader's arrival (D-37's M1 note), and M0's audit of the model drawer's chunk found nothing else (C-9).
- **`@axe-core/playwright`** ^4.10 (4.14.0 in the lockfile) has been a dev dependency since M1, for D-30's checks; M4's screens use it as they are.
- **fast-check, vitest, Playwright 1.64.1, ws** as pinned; hermet's local relay for the networked specs (D-37).
- **No new file type ships:** JS and HTML. M4's styles are CSS files in `src/ui/`, each imported with Vite's `?inline` by the module that owns it and added once at start-up (§0), so they ship inside the JS, which the dist audit scans, and the boot page's `file://` and insecure-context tests meet no stylesheet of their own to refuse; no `.svg` (C-54: the audit doesn't read one, so icons are inline DOM or CSS), no `.glb` (the stand-in stays in the tests, C-33), no font (the system's), no sound file (D-32). `third-party.json` is unchanged: M4 contacts nothing new.
- **If a builder finds it needs a package**, it stops and says so: the integration adds it with `npm install --before=<the date a week ago>` (CLAUDE.md), adds its notice to `scripts/expected-licenses.json` if it ships, and runs the dist audit; a package that holds a host or ships a new file type needs the plan's amendment first.

---

## 12. Build order

Four phases, each ending by landing on main through `/merge-to-main` with the full gate green (the owner's gate decision of 2026-11-20, §0), each step's commits having passed `npm run check:commit` and their specs, the lint clean, its own tests and the earlier phases' passing, and its gate time noted in its commit message. Phase 1 is the playable Practice; each later phase is playable at its end too. A phase's steps run in order; a step with several builders gives each files no other builder of that step touches, and an integration step, or a step's single builder, owns the wiring and the specs that need everything at once. **Builds and Playwright runs,** any builder's, go one at a time under the machine-wide lock, and **measurements** run in steps of their own, with no other builder working (§0, §8.4).

### Extension points

So that parallel builders never share a file, the step that first needs a composition writes it with empty slots for later builders, each slot a file of its own:
- **The pitch's layers:** `src/ui/layers/index.ts` (slice, 1c) composes `src/ui/layers/{hud,net,devices,sound,effects}.ts`, each exporting `LAYERS: readonly LayerFactory[]`; 1c writes `hud.ts` with phase 1's HUD, overlay and menu, and the other four empty. A later builder fills its own file.
- **The devices:** `src/ui/devices.ts` (slice, 1c): `pageDevices(host)`, made once at start-up, the keyboard alone in phase 1; the devices builder adds touch and the gamepad in phase 2.
- **The stage's parts:** `scene.ts` (stage, 1b) calls four modules it writes as stubs with their final signatures (§1.17, §1.63): `src/render/effects.ts` (`createEffects`, drawing nothing), `src/render/fade.ts` (`fadeVariants`, returning the material as both variants, `setFade`, `crossesFade`, never, and `fadesAt`), `src/render/model-loader.ts` (`createModelSlot(o): ModelSlot`, with `request(url)`, `ready(): TerrierDrawer | null`, `state`, `ms` and `error`, never loading in phase 1), and `src/render/graphics.ts` (`watchContext(canvas, on)`, reporting nothing, and `rebuildRenderer(o)`, re-creating at once). Phase 3's effects builder owns the first two, the model and robust builders one each.
- **The barks:** `view.ts` (stage, 1b) takes a `BarkSource` it declares itself (§1.16); the controls builder writes `BarkTracker` in 1b against 1a's `bark-types.ts`, and the slice wires one into the other in 1c.
- **The Settings screen:** `src/ui/screens/settings.ts` (shell, 1b) is a minimal screen (render quality, start in ball view, the calmer camera and Back); the settings builder completes it in phase 2.

### Phase 1: the playable Practice slice

**1a, contracts (one builder, short).** Writes every type the phase's parallel builders meet at, exactly as §1 gives them, and every setting:
- `src/config.ts` (§10's keys), `src/config.test.ts` (the A4 and A5 maps, the camera's check), `dev/tuning/model.ts` (`NOT_TUNED`), `PLAN.md` (§10's A.4 and A.5 rows only);
- `src/render/frame.ts`, `drawer.ts`, `stage-types.ts`, `look.ts`, and `palette.ts` reading `PLACEHOLDER_LOOK`;
- `src/input/source.ts`, `src/storage/schema.ts`, `src/ui/match-types.ts`, `src/ui/layer.ts`, `src/ui/inspect.ts`;
- `src/core/session/bark-types.ts`, and `src/core/session/index.ts`'s type re-exports: `Correction`, `Timeline`, `TimelineStats`, `BarkEvent` and `BarkTimeline` (§1.36).
- **Exit:** `npm run check` green with nothing yet using the new files; `npx vitest run src/config.test.ts dev/tuning/model.test.ts` green.

**1b, five builders in parallel**, each importing only 1a's files and M3's:

| Builder | Files | Needs | Its tests |
|---|---|---|---|
| **stage** | `src/render/scene.ts` (the stage, with M1's `createPitchView` kept as a wrapper), `ball.ts`, `shadows.ts`, `camera.ts` (the real region, the rise), `camera-rig.ts` (k steps a run), `interpolate.ts`, `view.ts` (phase 1's: interpolation, the rig, the drawing clock, the barks from its `BarkSource` and the celebrations from latched goals, at weight 1), `blends.ts` (the stub), `effects.ts`, `fade.ts`, `model-loader.ts` and `graphics.ts` (the stubs), `quality.ts` (its detail; `qualityFrom` stays until 1c), `pitch.ts` (the look's colours, the occluders' variants) | frame, drawer, stage-types, look, bark-types; the simulation | `ball`, `shadows`, `camera`, `camera-rig`, `interpolate`, `view` (P11, the clock, barks, celebrations), `pitch` (M1's, adapted) |
| **terrier** | `src/render/drawers/code.ts`, `drawers/pose.ts` (with the bark and celebration overlays), `src/render/palette-check.ts` (three-free), `src/render/palette.test.ts` | drawer, look; `config.pushPoseTicks` | `code`, `pose`, `palette` |
| **controls** | `src/input/keyboard.ts`, `anchoring.ts`, `controls.ts` (with the holds and the key-to-screen figure), `src/core/session/barks.ts` (`BarkTracker`) | source, bark-types; the simulation's input codec | `keyboard`, `anchoring`, `controls`, `barks` |
| **shell** | `src/ui/dom.ts`, `style.ts`, `nav.ts`, `match.ts` (`practiceMatch`, `own()`), `hud.ts` (the score, the clock, the countdowns and "Go!", the meter and the pounce wait), `overlay.ts` (your mark, the arrow, the bark marks), `src/ui/screens/{screen,home,practice,pitch,menu,results,settings}.ts` (the menu with Resume and Leave; Settings' minimal screen), the CSS files of its modules, `src/storage/{kv,profile,settings}.ts`, `src/core/names.ts` | match-types, layer, schema, stage-types, source, inspect; M3's glue | `nav` (aria-disabled, the guard), `match` (virtual time, `own()`), `profile`, `settings`, `kv`, `names`; the screens' pure parts (the clock's text, the results' rows) |
| **setups** | `src/core/bot/setups.ts` (the specs' scripts, added beside M3's: a direction held from each countdown and released e ticks after 60 of play, and presses in a countdown), `src/net/practice-spec-whole-1.test.ts` to `-5` and `practice-spec-goal-1.test.ts` to `-4` (§9.2) | M3's `PracticeSession` and scripts | those files: seed 7 over the latitudes of §9.1, each run decisive |

- Each keeps its files compiling, runs its tests, `npx eslint <its files>` and `npx tsc --noEmit`, and stages its files alone. The shell builds the pitch screen against `Stage`, `MatchViewApi` and `ControlsApi` with fakes in its tests.

**1c, slice (one builder): the integration.**
- **Files:** `src/main.ts` (the start-up order, `#app` on the normal page only), `src/ui/app.ts` (Home, Practice's setup, Pre-match, Match, Results and back; Settings' minimal screen, its quality applied by re-creating the stage; the announcements log), `src/ui/app.test.ts`, `src/ui/frame-loop.ts` (phase 1's fallback: every other frame while the last gap passed `drawingLateTimerMs`), `src/ui/devices.ts` (`pageDevices`, the keyboard alone), `src/ui/layers/*.ts`, `src/core/session/index.ts` (`BarkTracker`'s re-export), `src/render/quality.ts` (`qualityFrom` removed: the stored setting), `index.html` (the `#app` rules), `e2e/lib/page.ts`, `e2e/practice.spec.ts`, `e2e/dev-practice.run.ts` and `playwright.dev-local.config.ts`'s `testMatch`, widened to `/dev-[a-z-]+\.run\.ts$/` so phase 4's run file needs no other edit, `e2e/pitch.spec.ts`, `smoke.spec.ts`, `determinism.spec.ts`, `nettest.spec.ts` and `boot.spec.ts` (§9.3's adaptations), `src/input/sweep.test.ts`, `package.json` (`npm run play`, M4-Q40), `.gitignore` (`dist-play/`, so public-scan, which reads what git tracks or would add, never sees it) and `eslint.config.mjs` (`baseConfig({ ignores: ['dist-play/**'] })`, as hermet's base skips `dist/`), and CLAUDE.md's and the README's bullets that M4-Q1, M4-Q3, M4-Q38 and M4-Q40 change, with how to play Practice and the README's Sticky Keys section pointed to.
- **Wiring:** `createStage` with `createCodeDrawer`; the stores; the App; the pitch screen with the stage, `MatchView` over the Practice `Match` with a `BarkTracker`, `Controls` with the keyboard, and the layers; `inspect()` and `hashAt()` on a spec's hook; the code-built drawer's chunk statically imported.
- **Measured before the specs' timeouts are fixed:** page start and `prepare()` in each engine, alone and with four pages at once (`startMs`, `render.prepareMs`), from which the specs' start timeouts come; each engine's hold-release and Ready latencies against §9.1's latitudes, a latitude any of them passes half of widened in setups' files, and validated again, by the slice before the specs land; and each engine's largest timer gap in the first Practice spec, logged for phase 2's governor.
- **Exit:**
  - `npm run check` green;
  - `e2e/practice.spec.ts`: the whole match in Chromium (code-built until phase 3), and through the controls on the keyboard in each engine to the first confirmed goal, with nothing compiled in play and no stall;
  - `e2e/dev-practice.run.ts` green against `npm run dev`;
  - the owner can play it through `npm run play` (§14).

### Phase 2: matches with others, the devices, sound and the bench

**2a, five builders in parallel:**

| Builder | Files | Needs |
|---|---|---|
| **net-screens** | `src/ui/app.ts` (networked routes, the fragment, the canary's gate, the leave guard, the tab lock and its step in the start-up (§5.1), Settings' route), `src/ui/match.ts` (`openNetMatch`, `asMatch`), `src/ui/screens/{home,propose,join,invite,pitch}.ts` (pitch's networked Pre-match and Match, and `PitchContext.graphics` from `stage.onGraphics`, wired to Practice's pause and the 5 s message), `src/ui/layers/net.ts` and `src/ui/prematch.ts` (the lists, Ready, Switch, the bots, Invite), `src/ui/leave-guard.ts`, `src/ui/canary.ts`, `src/canary-expected.ts`, `src/storage/tab-lock.ts`, `scripts/build-inputs.mjs` (`canaryOf`), `vite.config.ts` and `vitest.config.ts` (the canary's define), `src/core/session/index.ts` (`REFUSAL`, `ROLE`), their unit tests and CSS | phase 1; NetGame |
| **results-hud** | `src/ui/hud.ts` (§5.8's whole HUD: the scorer, "Goal taken back", the follow choice, the graphics note), `src/ui/layers/hud.ts`, `src/ui/screens/{results,readout,message}.ts` (the presses announced, Copy's refusal caught), their tests and CSS | phase 1 |
| **settings** | `src/storage/settings.ts` (subscribe and the checks), `src/ui/screens/{settings,menu}.ts` (the screen, the panel, the menu's Settings; the in-match quality applying when the match closes until phase 3), applying them at once through `subscribe`, their tests and CSS | phase 1 |
| **devices** | `src/input/{gamepad,touch,hints}.ts`, `src/ui/devices.ts`, `src/ui/layers/devices.ts` (the touch layer, the hints, the turn prompt), `src/ui/phone.ts` (its refusals caught), `src/ui/touch.css`, `index.html` (`viewport-fit=cover`), `e2e/lib/gamepad.ts`, `e2e/lib/touch.ts`, their tests | phase 1 |
| **sound** | `src/audio/{audio,synth,cues}.ts`, `src/ui/layers/sound.ts` (the cues after each run, from the head, the scoreboard's changes and `PitchContext.barks`; your bark from `Layer.ownBark`; the prompt), their tests | phase 1 |

**2b, two builders in parallel:**

| Builder | Files | Needs |
|---|---|---|
| **frames** | `src/bench/virtual-room.ts` (votes echoed, a task a message, the room's own time, the hold), `src/bench/witness.ts` (the Worker), `src/frames.ts` (its parameters, `model=` among them), `src/main.ts` (its route), `src/ui/frame-loop.ts` (the whole governor, §8.2) and `frame-loop.test.ts`, `src/core/timeline/timeline.ts` (the clock's two counters in its stats, and nothing else), `tsconfig.json` (`playwright.frames.config.ts` in its `include`), `e2e/frames.spec.ts`, `e2e/frames.run.ts`, `playwright.frames.config.ts`, their tests | 2a's networked `Match` and pitch screen |
| **devices-int** | `e2e/practice.spec.ts` (the gamepad, the hints and Show control hints again, the menu by Back, the readout and Copy), `e2e/touch.spec.ts`, `e2e/lib/page.ts` | 2a |

**2c, slow-frames (one builder, alone on the machine):** runs 4 and 6 (§8.4) by the quiet-machine rule; M4-Q6's decision from run 6, and if it adopts K = 5, the timeline's change and its tests, with `src/config.ts`, `src/config.test.ts`, `dev/tuning/model.ts` and A.4's Timer stall row; `src/net/setups-testing.ts` extended with the specs' scripts and the proposer's pace, and `src/net/screens-setup-1.test.ts` to `-7` (§9.2), all passing before 2d writes the match spec; the figures into `docs/acceptance.md`.

**2d, net-int (one builder):** the networked screens end to end: `src/ui/app.ts` (the messages' routing to results-hud's `message.ts`, and any wiring the others' modules need), `e2e/lib/browsers.ts` (`openAppPage`), `e2e/lib/page.ts`, `e2e/match.screens.net.spec.ts`, `e2e/watchers.net.spec.ts`, `e2e/room.net.spec.ts` (the build mismatch and the leave prompt), `e2e/screens.spec.ts`, `e2e/determinism.spec.ts` (the canary in the page's module), `e2e/nettest.spec.ts`; then M4-Q19's trial, three consecutive gate runs each alone on a quiet machine, and, if every spec stays green, the split of `npm run e2e` (`package.json`, `playwright.config.ts`); the README's and CLAUDE.md's notes on the networked screens.
- **Exit:** `npm run check` green; §9.4's match through the screens green in three engines with the spectator and the reload; the bench's smokes green; M4-Q6 decided from real frames, and §9.4's setup validated under the rule that stands; the owner can play a match with others through `npm run dev:local` (§14).

### Phase 3: the drawing's fidelity, the model and the budget

**3a, five builders in parallel:**

| Builder | Files | Needs |
|---|---|---|
| **motion** | `src/render/{smoothing,blends,view}.ts` (corrections, holds, the layers' and the overlays' fades), their tests, `src/render/continuity.test.ts` | phase 2 |
| **effects** | `src/render/effects.ts` (dust, the bulge), `src/render/fade.ts` (the dithered variants, the capsule, `crossesFade`), `src/render/pitch.ts` (the swap, the bulge's hook), `src/ui/overlay.ts` (names, away marks), `src/ui/layers/effects.ts`, `src/render/fade.test.ts`, their tests | phase 1's stage |
| **model** | `src/render/drawers/model.ts`, `src/render/model-loader.ts` (its failures caught and reported), `scripts/make-standin.mjs`, `eslint.config.mjs` and `scripts/eslint/config.test.mjs` (§1.55), `e2e/lib/standin.ts`, `e2e/standin.spec.ts`, `e2e/practice.spec.ts` (the stand-in in the whole match and in Firefox's and WebKit's runs, under `dist/_headers`), their tests | phase 2 |
| **robust** | `src/render/graphics.ts` (losing and restoring the context, the rebuild a material a frame), `src/render/scene.ts` (their glue), `src/ui/screens/pitch.ts` (the rebuild when the menu closes, Practice's pause held through it), `e2e/graphics.spec.ts`, `e2e/room.net.spec.ts` (each engine's lost context) | phase 2 |
| **budget** | `scripts/chunk-budget.mjs` and its test, `vite.config.ts` (`codeSplitting`'s groups, the plugin), `e2e/pitch.spec.ts` (the code-built budget at both qualities, 8 terriers) | phase 2 |

**3b, the integration (the budget builder, last):** runs everything together, fixes the glue in the files it's given by the others' reports, adds the overlay's names and away marks to `e2e/practice.spec.ts`'s run through the controls, after the model builder's changes to it, owns `e2e/lib/page.ts`, and runs the gate.
- **Exit:** `npm run check` green; the stand-in plays the Practice match in the gate (§17's exit); the snap across a phase's start, the glide, pose continuity and P11 in their tests; nothing compiles in play in the Practice and the screens' match; the chunk budget enforced in every build, each group holding only its own files.

### Phase 4: the look book, the feel page, the measurements and the records

**4a, two builders in parallel:**
- **look-book:** `dev/look-book.html`, `dev/look-book/*.ts` and its model's test, `vite.config.ts` (the dev middleware for `dev/standin.glb`); two or three sample looks beside the placeholder, made to L15's rule, with the pack cue's options (Q-11), each with `palette-check.ts`'s verdict.
- **feel:** `dev/feel.html`, `dev/feel/*.ts` and its model's test, `src/ui/practice.ts` (`P?`, `B?`), `dev/tuning/model.ts` (the cameras' and the bots' `ROWS`).

**4b, measure (one builder, alone on a quiet machine):** §8.4's runs 1, 2, 3, 5 and 7, headless on C-6's GPU path, the throttled ones in Chromium, each started by the quiet-machine rule; `e2e/dev-local-screens.run.ts`, the provisional settle of the owner's match between desktop browsers through `npm run dev:local` (§14); their figures into `docs/acceptance.md`.

**4c, settle (one builder):** the provisional settles of §14 still open, each logged owner-pending; `docs/acceptance.md` (the frame-time run's method and its log, each M5 device run's method with its pending row, M4's checks by hand, the review of every screen's and message's wording against L15 beside the look's pick, the gate's wall time in two consecutive runs alone on the machine); `.github/workflows/check.yml` as M4-Q37's matrix, whose first run is the owner's next push; PLAN.md's M4 amendments, each marked M4 and citing its evidence, with the answers to §15's questions where they apply; the README in M4's state; this design kept as `research/m4/DESIGN.md`, as M2's and M3's were.
- **Exit:** §17's M4 exits met or provisionally settled; `npm run check` green twice in a row, logged.

---

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | **WebGL in three engines under Playwright and on CI** (C-6): the gate draws in software, 5–26 frames a second for a busy scene, worse with three engines at once (10–15); Firefox draws only with a display; WebKit's GL work blocks the page's JavaScript for 23 ms or more a frame. From M4 every spec's page draws, where M3's networked pages drew nothing. CI's runner drew all three at M1, but hasn't yet run a networked match (M3's first push waits) or a drawn one. | Low quality, a real setting, and a 640 × 360 viewport for every spec that plays (§9.1); `expectWebGL2` first, so a run without a display fails at once; phase 1's fallback and phase 2's governor (§8.2); the GPU path opt-in for local runs (C-6); on CI, M4-Q37's matrix, each engine's specs on a runner of their own. C-6's rule stands: if the runner can't hold the drawn matches, a `check:ci` labelled partial leaves out exactly those specs, and the local gate stays the definition of done. |
| R-2 | **A test that depends on the frame rate after all**, through a camera, a hint, a mark's position, a buffer's size or a count read at a frame. | The rig steps on head ticks, not frames (§3.1); specs act on the hook's logical state, polled at 50 ms, and never sleep for a game event (§9.1); a buffer is checked by the scale the hook reports; transients are latched (§9.1); every timing rule (blends, glides, cameras, anchoring, cues, the governor) has its own Node test in ticks or virtual time (§9.2); a spec's timeout comes from its measured runs. |
| R-3 | **Timers starved in the gate:** WebKit's timer gaps reached 1.76 s with frames of 250 ms (D-31's M3 note). Past 2 s Practice pauses for a stall and a networked page rejoins, which would fail a spec, or worse pass one by luck. | 640 × 360 and low quality for every spec that plays, from phase 1; phase 1's frame loop draws every other frame while the last gap passed 50 ms, and phase 2's governor gives way on what slow frames cost (§8.2); the hook reports every match's timer gaps, and the specs assert no stall and log the worst. The governor's thresholds come from the bench on real targets, never from a gate spec: a spec that sees a gap over the freeze gets a closer look or a smaller scene, never thresholds tuned to the gate's machine. |
| R-4 | **three's bundle and the chunk budget:** three's core is one module, about 119 kB brotli, which rolldown can't split, and carries GLTFLoader's 10 kB on the code-built path too (D-26's M0 note); the entry grows by the screens, the session and the simulation, an estimated 60–80 kB brotli; and a `codeSplitting` group pulls in its modules' dependencies unless told not to. | The drawers' lines are far under 200 kB each; the groups are ordered and the drawers' takes no dependencies, and the build fails a group holding a stray file (§1.56, §1.57); the plugin prints every chunk's size at every build, so a growth shows in the build log of the commit that caused it; three stays imported by name from `three` and `three/addons/…` (D-38), so tree-shaking drops the rest; a budget for the game's chunk is the owner's call (M4-Q32). |
| R-5 | **The phone unmeasured until M5** (Q-4, C-2): its GPU with eight animated terriers and its CPU with the timeline, the drawing and the canary on one thread. | The budget stays a ceiling (C-2); the bench's CPU figures at the Pixel 8a's size at 4× throttle (§8.4); the low setting and the governor as cheaper paths; occluders dither only while they're in the way (§2.6); the look book at the phone's 915 × 355 with the budget's counts beside each sample (Q-11); the frame-time run's method written into `docs/acceptance.md`, ready for the phone; whether phones start at low is the owner's, with the measurements (D-33). |
| R-6 | **Input latency against d = 2:** your input waits up to a tick for its sample, acts d = 2 ticks after it (33 ms), is drawn up to a tick behind the newest predicted state, then on the next animation frame and the compositor's: about 75–110 ms from key to screen at 60 Hz, an estimate, and a long frame's catch-up adds its length. | Nothing buffers beyond that: the sample is taken when its TICK is sent; the drawn state is `prevHead → head` by the clock's fraction; your bark and its mark show at the press; your own push of the ball glides at 100 ms (§2.3). The hook measures key to screen, p50 and p95, and the bench sample to screen (§8.4), for the owner's judgment in phase 1's Practice (Q-10, §14). d itself is M3's measured choice (D-16), not M4's. |
| R-7 | **The main thread's share:** a slow frame delays the timer, and a networked page then skips its own inputs and its bots': 25% at 15 frames a second and 50% at 10, if each frame blocks for its length (§8.1). | §8.1 measures it with real frames in phase 2c, on a quiet machine, before the networked specs land; §8.2's governor; M4-Q6's change if the measurement asks for it; §9.4's setup played in Node with a slow proposer under the rule that stands. |
| R-8 | **Skinned models' cost:** a clone and a mixer per terrier, bone textures per skinned mesh (16 for 8 two-primitive stand-ins), `mixer.update` per terrier per frame; a real model at the guesses has 3.6 times the stand-in's triangles and 4 times its bones (§12). | One skeleton per terrier (D-27's M0 note: halves the bone textures); the actions' times set, never advanced; the budget's counts on the stand-in in the gate; the bench's `model=`, which times the stand-in in the frame-time run headless and on the owner's GPU under `npm run dev` (§8.4), and on the phone at M5 through Playwright over CDP to Chrome by adb's port forwarding, which can intercept the same way. |
| R-9 | **Audio's autoplay rules:** a context created before a gesture starts suspended; a gamepad press may not unlock it; engines differ; CI may have no sound device. | Resumed at each key, click, pointer-up and touch-end, and when the page is shown, each `resume()` caught; the prompt says so (D-32); a cue decided while the context waits is dropped, not queued; `decided` and `played` counted apart, the specs asserting `decided`, and only a Chromium spec the context running (§7); a page without Web Audio plays silently. |
| R-10 | **A canvas game's accessibility:** the play itself is visual. | Every screen is DOM with native controls and an `h1`; the score, the goals, the countdowns and the end in a live region; everything sound tells is shown (L103); no colour-only cue; menus without a mouse (Q-17), the focus kept by `aria-disabled`; text over the pitch on opaque backings, so axe judges it; the calmer camera by `prefers-reduced-motion`; axe on every kind of screen (§9.6). A player who can't see the pitch can't play it: accepted, as for any action game. |
| R-11 | **The leave prompt:** engines show `beforeunload`'s dialog only after a user activation, and differ; and Trystero's listener sits on the same window as the guard's. | The guard stops the event with `stopImmediatePropagation`, which a same-target listener can't escape, tested on Node's own `EventTarget`; `room.net.spec.ts` dismisses the prompt on a connected page after a key press there and checks its peers stay, then accepts one; every other spec accepts every dialog (`acceptLeavePrompt`) and presses a key before a reload, as a player would have. |
| R-12 | **Parallel end-to-end workers flake** (M4-Q19). | Adopted only after three consecutive green gates, each alone on a quiet machine, the `net` project's specs always alone; CI runs each project in a job of its own anyway (M4-Q37). |
| R-13 | **The gate's growth,** to about 37–39 minutes at one worker. | §9.9's measures; M4-Q19's workers; Q-18's alternative, adopted by the owner on 2026-11-20, so the full gate runs only at merges, milestones and deploys; M4-Q20; CI's matrix. |
| R-14 | **Builders in one checkout,** several at once. | §12's contracts first, the extension points, one owner per shared file per step, builds and Playwright runs under one machine-wide lock, and measurements in steps of their own (§0). |
| R-15 | **The look book's contexts:** browsers cap live WebGL contexts at about 16. | One context, each sample drawn into its own viewport by scissor (§1.60). |
| R-16 | **A setup the page can't hit exactly:** keys land a poll late, and the bots' aim noise is keyed by tick, so a spec's Ready tick or a release a few ticks late changes the match it plays, and an overtime fails the spec. | Holds pressed in the countdown, Ready at fixed ticks, the presses that remain where D-10 drops them, and seed 7 played whole in Node over every latitude the page has (§9.1, §9.2); the specs assert their own holds and Ready ticks inside it, and phase 1c measures the latencies first. |
| R-17 | **The owner's play test meets the builders:** a `vite preview` the owner leaves running holds the gate's port against every session's `npm run check`, and `npm run dev` reloads on a builder's edit or a branch switch. | `npm run play`: a build of the checkout into `dist-play/`, served on its own port, 4340 (M4-Q40). |

---

## 14. Owner-only and attended steps (PLAN §17)

**External actions:** M4 needs none. It pushes nothing (terriest, hermet), changes no sibling, deploys nothing and runs no relay check; each stays the owner's go-ahead (PLAN §17). What M3 left the owner stays theirs and holds up nothing here: landing and pushing M3, C-55's choice of w, C-56's port to roslambo, and Q-20. M4-Q37's CI matrix runs first at the owner's next push.

**What the owner can play once phase 1 lands** (on its branch, or on `main` once it has landed): run `npm run play` in WSL2 and open http://localhost:4340/ in Chrome, Edge or Firefox on Windows (WSL2's forwarding, as for M0's run 6). It builds the checkout as it stands into `dist-play/` and serves that copy on a port of its own, so a builder's later edit or branch switch can't reload the match under the owner, and a session's `npm run check`, whose preview needs port 4339, isn't blocked by it (M4-Q40). `npm run dev` stays for a quick look when no other session is working; it may reload the page once on its first load (`docs/acceptance.md`'s M3 steps). Then press **Practice**, pick 1 to 4 a side and a length, **Start**, warm up, press **Ready** (or Enter), and play to Results on the keyboard: W, A, S and D run, Space jumps, Shift is zoomies, E pounces, Q barks, C switches between ball and chase view, Escape opens the menu, which pauses. On Windows, Shift pressed five times opens the Sticky Keys prompt, which takes the focus and releases every key: the README's "Windows: the Sticky Keys shortcut" says how to turn it off (C-52).
- **Phase 1 has:** the drawn pitch, ball and code-built terriers, their animations from the state, with the barks' and the celebrations' overlays; both cameras, the swing at A.5's starts; your terrier's mark, the off-screen ball's arrow and a bark mark over every barking terrier; the score, the clock, the countdowns, and your zoomies meter and pounce wait.
- **Phase 1 lacks:** sound (phase 2); the gamepad and touch (phase 2); the fade of a wall, the ball or a goal's frame between the camera and your terrier, so in chase view the ball or a post can hide it for a moment (phase 3); the cross-fades between animations, which switch at once (phase 3); names over the others and the away marks (phase 3); and the look, still the spike's placeholder (phase 4's look book).
- That's enough to judge the bots' level (Q-9) and the feel in both views (Q-10) on the keyboard, and either report it or wait for the feel page (phase 4). The Practice spec's log carries the key-to-screen latency in each engine, for comparison with what the owner feels (R-6).

**The attended steps** (§16's M4 checks by hand, §17's exits). None holds up the work: each still open when M4's other exits are met is settled provisionally by Claude as §17 says, logged owner-pending in `docs/acceptance.md`, and must land before M5's deploy.

| Step | How the owner makes it | Provisional settle, if the owner isn't free |
|---|---|---|
| **Practice against the bots** in each desktop browser, with the keyboard and a gamepad if there is one; accept their level or name a change to the reaction delay or aim noise (Q-9) | as above, then report; or the feel page's two bot sliders; a change to the brain's values re-runs the marks (Q-9), which also pass at reactions of 0.15 and 0.35 s and noise of 5° and 15° (§16's M2 note) | the level as the marks set it: A.4's values, which meet every mark (§17's rule) |
| **The cameras:** the chase-view swing tuned, and the turn rate, acceleration, pounce, bowling speed and tumble guard confirmed in ball and chase view (Q-10) | `dev/feel.html` under `npm run dev`: sliders, Practice, Copy settings; a changed feel value re-emits the goldens and re-runs Q-9's marks | the starts of A.5 and the Configuration table, by §3.6's criteria, which they meet |
| **A match between three desktop browsers** through `npm run dev:local`, through the screens: one proposes, the others join by link and by code, each plays to Results | `npm run dev:local`, then Chrome, Edge and Firefox at the address it prints; `docs/acceptance.md` gives the steps | `e2e/dev-local-screens.run.ts`: headless Chromium, Firefox and WebKit on C-6's GPU path through `npm run dev:local`, `ice: 'none'` by the hook so nothing public is contacted (§12's 4b) |
| **M3's desktop connection,** still pending: two desktop browsers on the `#test=net` page through `npm run dev:local` | as `docs/acceptance.md` gives it; or the M4 match above, which covers it, since it runs the same path through the screens (M4-Q33, the owner's agreement of 2026-11-20) | already settled provisionally at M3 |
| **The frame bench on the owner's GPU** (L286): `#test=frames`, 4 a side for 3 minutes, in Chrome, Edge and Firefox, at high and low quality, the display at 60 Hz, and once with the stand-in | `npm run play`'s copy at `#test=frames`, and under `npm run dev` at `#test=frames&model=dev/standin.glb`; read the verdict line, the intervals and the renderer, as M0's run 6 | headless Chromium and Firefox on C-6's GPU path, as M0's run 6 was settled (§8.4's run 1) |
| **The look** (Q-11): the terriers, coats, pack colours and patterns, the ball, the pitch, and whether a pack cue | `dev/look-book.html` under `npm run dev`; name a sample, or a mix | Claude's pick from the look book, by the palette's verdict and the budget's counts at the phone's size, made to L15's rule; M5 builds it as the default (PLAN §17) |

Each is logged with its date and commit when it's made; a late answer costs re-emitted goldens, re-run marks and a re-counted budget (PLAN §17).

---

## 15. Questions for the plan

Each with this design's proposal, which the build follows unless the orchestrator or the owner says otherwise; numbered apart from PLAN's Q-numbers.

1. **M4-Q1. One main landmark, now the app's.** CLAUDE.md's boot-page bullet says the page's landmark is "the message's, then the pitch's, which holds the canvas as an image named 'The pitch'". From M4 most screens have no pitch.
   - *Proposal:* `<main id="app">` replaces `#pitch`, made by `src/main.ts` on the normal page only, as M1 made `#pitch`, so a `#test=` page, which makes its own, never shows two; it holds the stage's box and the screen, hidden until `started` as `#pitch` was; the canvas, still the image "The pitch", shown only on Pre-match and Match. CLAUDE.md's bullet and `e2e/lib/page.ts`'s helpers change with it in phase 1c.
2. **M4-Q2. Watch on return** (page-F5, D-17's M3 note).
   - *Proposal:* Join offers its choices only once the state is held, and a page whose ID or bots are in the roster skips Join (L215), so the screens never let a returning page choose Watch, and its terrier is never sat out by it. Before the start countdown, a returning player who wants to watch presses Leave, whose LEAVE removes its terrier, and then opens the link and presses Watch. From the start countdown on, the state ignores LEAVE (D-8's M2 note), so the terrier stays in the roster and reopening the link takes it back: a player who returns then can't watch that match. The session's rule stays as M3 built it, and page-F5's amendment records this.
3. **M4-Q3. The gate's relay for the screens.** The gate contacts no public host (§16), but a normal page's screens use the curated relays.
   - *Proposal:* `window.terriestTest.relay`, accepted only when `acceptedRelay` takes it (a loopback `ws:` URL, or a curated one), and `ice`, both set by a spec before load; the app then opens every room with exactly that relay. Like `modelUrl` (D-27), it changes what a page contacts only toward this machine; a normal page never has the hook (CLAUDE.md's test-hook bullet gains the two fields). An each-engine spec that opens a room, the connection failure's, starts a local relay of its own for it.
4. **M4-Q4. The render quality's source.** M1's `?quality=` stood in "until Settings arrive at M4".
   - *Proposal:* it retires: the quality is the stored setting's (A.3), and the gate's specs set `quality: 'low'` through Home's Settings or in storage before load, written once per context and only when absent, a player's real choice (C-6, D-33). The bench's page takes `quality=` in its own fragment, as a test page may.
5. **M4-Q5. The canary in the page's module.** `e2e/determinism.spec.ts` asserts that the page's module doesn't hold the canary's hash, but M4 wires the canary to Propose and Join (D-23).
   - *Proposal:* a build-time define, `__TERRIEST_CANARY__`, from `goldens.json`'s canary, declared and read in a module of its own, `src/canary-expected.ts`, which only `src/ui/canary.ts` imports, so no config that loads `src/build-info.ts` needs it; the module holds that hash and nothing else of the goldens; the spec's check becomes "the module holds the canary's hash and no other golden hash or run name", and the determinism chunk still holds its own (§17's "From M3").
6. **M4-Q6. `stallSendTicks` under slow frames** (§8.1).
   - *Proposal:* measure first, in phase 2c, with real frames and on a quiet machine, before the networked specs land, counting every sender a page sends for, its own terrier and each bot it hosts, since a catch-up marks them all absent. If a page in the gate-like run (three engines at once, 640 × 360, low quality, the governor acting) skips more than 10% of any sender's inputs, a catch-up of up to K = 5 ticks sends every input, and a longer one the newest 3. The trade, by C-55's formulas: the oldest input goes 4 ticks late with 10 ticks of slack, so it reaches 130 ms one way without loss and 43.3 ms with one resend, against 163.3 and 54.4 ms for the newest-3 rule's oldest and 196.7 and 65.6 ms for an input sent on time (§8.1's table). It's a timeline change, with `stallSendAllTicks` in A.4's Timer stall row, re-tested by M3's freeze, hidden-page and stall tests and a new one, and it moves the build hash. Otherwise nothing changes. Either way §9.4's setup is played again in Node with the proposer's timers paced at 50 and 100 ms.
7. **M4-Q7. The menu on Pre-match.** Q-17 has Escape and Back open the menu on Match; Pre-match has its Leave on screen, but no way to Settings.
   - *Proposal:* the same menu, Settings and Leave (and Resume in Practice), opens on Pre-match too.
8. **M4-Q8. Where Pre-match ends.** PLAN §11 puts the start countdown on Pre-match and each kickoff's countdown on Match.
   - *Proposal:* Pre-match lasts through the start countdown, its buttons marked unavailable once the roster locks; Match begins as the first kickoff's play does.
9. **M4-Q9. Drawing off the pitch screens.** M1's page drew the empty pitch on every frame.
   - *Proposal:* the stage draws only on Pre-match and Match; Home, Settings, Propose, Join, Results and the messages draw nothing, which saves a phone's battery and keeps those screens' axe runs to the DOM. Results are a screen of their own. M1's pitch spec reads the pitch from Practice's Pre-match instead (§9.3).
10. **M4-Q10. Marks and names over the pitch.** PLAN §12 lists the bark mark with the effects, and L52's mark and names don't say how.
    - *Proposal:* DOM, positioned each frame from the stage's projections: names as text (L224), always on top so your terrier can always be found, no program or texture for the budget, and `aria-hidden` since the HUD says the same. Your mark, the off-screen ball's arrow and the bark marks from phase 1; names and away marks from phase 3.
11. **M4-Q11. What the occluders' faded material is.** PLAN §12: "A faded surface swaps to its precompiled faded material, so nothing toggles `transparent` in play."
    - *Proposal:* PLAN's swap, with a screen-door faded material: each occluder's material and a clone whose shader hook discards fragments in a 4 × 4 ordered dither inside a capsule round the line from the camera to the subject, both opaque, both compiled at `prepare`, the dithered one drawn only in the frames the occluder crosses the capsule (§2.6). No blending or sorting, the same see-through look at the gate's low quality, and no `discard` in the programs that draw the walls and the net in every other frame, which a tile-based phone GPU would pay for. PLAN §12's sentence stands; its amendment says what the faded material is.
12. **M4-Q12. The blends' length.** D-27 and L208 ask for cross-fades but give no time.
    - *Proposal:* one setting, `animationBlendMs`, 150 ms, for every animation's fade into the next, a correction's move, a celebration's and a bark's overlay, a setting like any other (§10), its feel the owner's to judge with the look.
13. **M4-Q13. When the camera's yaw moves.** D-28 gives the cameras' rules per second; Q-19's re-read reads "the camera's yaw at that moment".
    - *Proposal:* the yaw steps once a head tick on the timer, k times toward targets read between the two heads after a k-tick catch-up, and frames interpolate it by the bodies' own fraction, so anchoring in chase view reads a yaw no frame rate moves, and the cameras' tests and §16's sweep run in ticks (§3.1).
14. **M4-Q14. A head held by the spread** (D-11): up to about 20 timer runs, longer when timers are slow.
    - *Proposal:* draw its bodies carried on by their velocities for up to `heldHeadCarryTicks` (6), then glide whatever separates them from the head when it moves on (§2.3).
15. **M4-Q15. "Bodies in contact share one offset decay"** (D-16) leaves open which offset a group takes and how long it glides, and a correction recomputes the tick `prevHead` shows too.
    - *Proposal:* contact found geometrically in `after`; the group's offset is the ball's if it's in the group, else your terrier's, else the mean; its glide `ownSmoothingMs` when the group holds your terrier and no remote terrier, `smoothingMs` otherwise, each member then within rule 2's limits; `prev` drawn shifted by each body's correction until the head advances; and a drawn position clamped inside the pitch, its offset shortened, as D-16 says (§2.3).
16. **M4-Q16. The bench's virtual peers and a forced repair** (M3-Q14): roslambo's virtual peers had no timeline, so no vote could beat the page and no STATE answer its request.
    - *Proposal:* the frame-time run has no witness: the virtual peers' TICKs vote the page's own final hash, as honest peers' would, so the page's thread carries one timeline, as a real page's does. The forced repair's run has one: a real `Session` and timeline in a dedicated module Worker, which votes and answers STATE_REQ, so the page can repair from a real STATE while its own thread does only a real page's work; that run's frame intervals are reported and decide nothing (§8.3).
17. **M4-Q17. Drawing gives way, and the frame-time verdict.** PLAN §17's "From M3" asks drawing to degrade first; D-33 says the frame-time run never changes quality.
    - *Proposal:* §8.2's governor watches what slow frames cost, the ticks a page skips and the time its timer spends in late gaps, and lowers the pixel ratio, then skips frames, never the quality; its thresholds come from real targets, never a gate spec; the frame-time run's verdict counts only if it never acted, and the report says how often it did.
18. **M4-Q18. The bench in the gate.** §16 puts the bench's runs outside the gate.
    - *Proposal:* those stay outside; two short smokes of `#test=frames` in Chromium run in the gate (about 40 s), the second with `repair=1` so the witness's Worker is exercised too, so the bench can't rot between milestones, as roslambo's frames spec ran in its gate.
19. **M4-Q19. Workers for the end-to-end stage** (§9.9).
    - *Proposal:* the three engines' projects with 3 workers, then the `net` project alone, as two Playwright runs in `npm run e2e`; adopted in phase 2d only after three consecutive green gates, each alone on a quiet machine, taking the gate from about 38 to about 24 minutes; otherwise one worker, as now. CI splits the same stages into jobs (M4-Q37).
20. **M4-Q20. M3's `#test=net` match beside the screens' match.**
    - *Proposal:* both stay in the gate through M4, since they check different paths (scripts over the network test page, the real controls over the screens). Once the screens' match asserts everything M3's does (its countdown window, the goals since arrival, the return's last input), the owner may retire M3's and save its 2.4 minutes.
21. **M4-Q21. Recorded matches as fixtures.** PLAN §6 lists `e2e/fixtures/` with recorded matches for the look book, but `parseRecording` refuses one recorded before a setting today's configuration has, so every config addition, M4's own among them, would break a committed recording.
    - *Proposal:* the look book drives its samples from live seeded scenes (a bot match, a push) and accepts a dropped recording file; none is committed, and PLAN §6's line is amended.
22. **M4-Q22. The model's clips.** D-27's painting convention names materials, not clips; the spike's stand-in had one clip per animation phase.
    - *Proposal:* the eight phases' clips by A.1's names, and three overlays, `barking`, `celebrating` and `pushing`, each optional in a model and drawn without when missing; the stand-in carries all eleven, so the gate checks a bark and a celebration on it (§2.4). The model's URL, "a render setting", is `config.terrierModelUrl`, empty.
23. **M4-Q23. The lint for the drawers' and the test pages' chunks** (D-38).
    - *Proposal:* `terriest/lazy-imports` gains §1.55's targets, each with a fixture, and D-38 is amended to list them.
24. **M4-Q24. When a remote bark plays** (D-16: "when that input's bark count changes"), given gaps: a reload, a return or a join would otherwise bark at its first input.
    - *Proposal:* a bark at tick t when the inputs received for t and t − 1 are both known and their counts differ; the first after a gap only sets the baseline (§2.5).
25. **M4-Q25. Presses within one tick.** A.2's 2-bit counters can't tell four presses from none, and the simulation acts once for a counter that moved 2 or 3 (D-10's M2 note).
    - *Proposal:* a counter advances at most once a sampled tick; more presses in that tick are dropped, which is what the simulation would make of them anyway.
26. **M4-Q26. Results' press guard and the pointer.** Q-17 names Enter, Space, Start and the bottom face button.
    - *Proposal:* the 0.5 s guard applies to every activation of Results' buttons, a tap included, so a tap meant for the pitch at the final whistle presses nothing either.
27. **M4-Q27. The spectators' camera.** D-28 says "high above one side … following the ball or the chosen terrier", and gives no framing.
    - *Proposal:* M1's elevation and field, framing 24 m of the pitch's length round what it follows, easing after it with a 0.5 s time constant (§10's A.5 row), the near wall and the net fading where in the way.
28. **M4-Q28. The hints' record.** A.3's `hints: { keyboard, touch, gamepad }` doesn't say whether it marks a kind finished or each control used; L83 clears each hint as its control is used, and §16 has them stay cleared after a reload.
    - *Proposal:* a bitmask of the six controls per kind; "Show control hints again" clears all three.
29. **M4-Q29. The pack cue** (Q-11, C-51).
    - *Proposal:* the look book offers `marker` and `ring`; the default stays `none` until the owner picks one; REQUIREMENTS' L43 changes only then, by §2's waiting row.
30. **M4-Q30. The leave prompt in Practice.** D-30 asks during Pre-match and Match without naming Practice.
    - *Proposal:* Practice asks too: leaving loses the match just as surely.
31. **M4-Q31. A `#join=` link with a failing canary.** C-32 counts opening a link as joining, but D-23 gives such a browser no networked match.
    - *Proposal:* the Join screen says why and opens no room, so a browser that can't play contacts nothing; it offers Practice and Home.
32. **M4-Q32. The other chunks' budget.** PLAN §12 sets figures only for each way of drawing the terriers.
    - *Proposal:* the plugin prints three's, the game's, Trystero's and the test pages' sizes with their changes, and enforces only the drawers' lines and each group's files; a figure for the game's chunk, if wanted, is the owner's.
33. **M4-Q33. M3's pending desktop check.** It's two browsers on the `#test=net` page through `npm run dev:local`; M4's is three browsers through the screens on the same path.
    - *Proposal:* the owner may make M4's alone and log it against both; otherwise both stay as written.
    - *Settled by the owner, 2026-11-20:* yes. The owner's M4 desktop check, three browsers through the screens over `npm run dev:local`, is logged against M3's pending check too.
34. **M4-Q34. The cameras' placement as settings.** D-28 fixes the swings and the clamp, not the camera's distance, height or field, and the spike kept them as constants.
    - *Proposal:* a number is a setting when the owner tunes it with the swing on the feel page: A.5's Players' cameras row holds the distance, the height, the field, the wall margin, the nearest distance before the camera rises, and chase view's look-ahead (§10); the spectators' row their window and follow time. The ±60° limit, M1's overview fit and the arrow's inset stay drawing constants, since they only keep the maths and the layout valid (§3.2).
35. **M4-Q35. What drawing keeps.** D-27, PLAN §6 and CLAUDE.md's drawing bullet say drawing "keeps only blends, smoothing offsets, the timings it is fading out and each bark's start".
    - *Proposal:* the list gains four things no animation's timing depends on: the camera rig's yaw, each viewer's own (D-28); the ball's drawn roll and the dust's puffs, which C-29 already makes drawing's alone; each latched goal's latch time, which fades its celebration in; and the drawing clock's paused time, which stops the fades with Practice's pause (§2.2, §2.7). D-27, PLAN §6 and CLAUDE.md are amended to say so.
36. **M4-Q36. The specs' scripts, and what validates them.** PLAN §16's setups hold a direction "for the first second after each kickoff" and press Ready at a tick the M3 specs fixed; a page's keys land a poll late, and the bots' aim noise is keyed by tick, so the matches the screens' specs play aren't the ones M2 and M3 validated.
    - *Proposal:* each spec's direction is pressed in the countdown, where it only turns the terrier on its spot (L118), and released at the first poll after 60 ticks of play; Ready is pressed at the first poll at or past a fixed tick; the only other presses go where D-10 drops them; Practice holds A, the validated sideways step; and seed 7's setups are played whole in Node over every latitude that leaves the page, before each spec lands, which also asserts its own holds and Ready ticks inside them (§9.1, §9.2). PLAN §16's setup paragraphs are amended to say so.
37. **M4-Q37. CI as a matrix of jobs.** The hosted runner's 4 vCPUs would take about 14 minutes for M4's unit stage alone, and three Playwright workers there each draw in software.
    - *Proposal:* `.github/workflows/check.yml` runs the same checks in jobs: a build job with lint, public-scan and typecheck, uploading `dist/`; the unit stage in 3 vitest shards; one end-to-end job for each Playwright project at one worker under `xvfb-run`, from the artifact; the arm64 unit job sharded the same way; the check green only when every job is. The local gate stays `npm run check`; PLAN §15's CI paragraph is amended; its first run is the owner's next push.
38. **M4-Q38. When the app has started.** CLAUDE.md says the module calls `started()` "after its first frame"; PLAN §12 compiles "at startup, behind Home".
    - *Proposal:* the module calls `started()` once its first screen shows, Home, Join's "Connecting…" or the other-tab message, then starts the compile behind it; with another tab holding the lock, the compile waits for Use here. So the 20 s load timeout never counts the compile, and the time to Home doesn't grow with every program a match can use (§5.1). CLAUDE.md's boot bullet is amended.
39. **M4-Q39. Messages the gate can't reach from a page.** CLAUDE.md asks a real-page test for new behaviour.
    - *Proposal:* three messages are tested in Node and by the app's routing test only, with the reasons §5.10 gives: "The players have left" needs every controlling browser gone from the start countdown on and 30 s after; "open in another tab or window" needs a connection lingering under the same ID, which one browser's tab lock rules out; and "you're watching it" needs two JOINs for a pack's last place in one tick. Every other message is played through the page.
40. **M4-Q40. The owner's play path.** `npx vite preview` binds the gate's port, 4339, with `strictPort`, so while it runs every session's `npm run check` fails at its end-to-end stage; and `npm run dev` reloads on another session's edit.
    - *Proposal:* `npm run play`: `vite build --outDir dist-play && vite preview --outDir dist-play --port 4340 --strictPort`, `dist-play/` gitignored and skipped by the lint, so the owner plays a copy of the checkout as built, on a port of its own (§14); the README's Run says so.
41. **M4-Q41. A rebuild mid-match.** D-33 rebuilds the drawing when the menu closes, "and the match runs on"; three's `compileAsync` compiles every material synchronously, and without `KHR_parallel_shader_compile` blocks on the first link's status.
    - *Proposal:* a rebuild and a restore compile one material an animation frame, the old canvas drawing on until the new one is ready; a networked match runs on throughout; Practice keeps its menu's pause through the rebuild and resumes once it's done, so a long compile can't stall it (§2.8). D-33's sentence is amended for Practice.

---

## Revision log

Three critics reviewed the first draft: completeness, feasibility and the frame budget, and tests, the gate and accessibility. Each finding was checked against the sources named in its evidence, and every one held. None is rejected; where the fix taken differs from the one suggested, the note says why. The changes are folded into the sections they touch.

| Finding | Outcome | Note |
|---|---|---|
| completeness-F1 | Accepted, and widened | Phase 1 now has your terrier's mark, the off-screen ball's arrow, the HUD's zoomies meter and pounce wait, and every bark's mark and celebration: `BarkTracker` moves to phase 1 (§1.36), and the view composes barks and celebrations from the start (§1.16, §2.5, §1.44, §1.45). The fade, names and away marks stay in phase 3, and §14 now lists what phase 1 has and lacks. |
| completeness-F2 | Accepted | Checked in `src/core/bot/setups.ts` and `dev/tuning/keyboard.ts`: A gives step 8, the validated `SIDEWAYS`, and D gives 24. Practice now holds A; the controls run switches back to ball view before Ready and asserts it; WebKit's three presses move into the start countdown, where D-10 drops them but the counters still move, so page-F4's check keeps its teeth (§4.6, §9.1, §9.4, §9.5). |
| completeness-F3 | Accepted | A button that can't act yet is `aria-disabled` with its reason, never `disabled`, so Ready keeps the entry focus (§1.42, §1.39, §4.9, §5.7); `nav.test.ts` and both whole-match specs check it. |
| completeness-F4 | Accepted, but for three messages | Added through the real page: Switch pack, Settings' start in ball view, sound, the calmer camera and reduced motion (`screens.spec.ts`); Show control hints again and Escape closing the menu (`practice.spec.ts`); Remove a bot, a networked Pre-match's Leave and spectators-full (`watchers.net.spec.ts`); Use here (`screens.spec.ts`); the spectator's follow cycling (`match.screens.net.spec.ts`); touch's bark and view (`touch.spec.ts`). "The players have left", "duplicate" and "watching" can't be reached from a page in the gate; M4-Q39 records why, and their Node tests (§5.10). |
| completeness-F5 | Accepted | `numbersIn` reads "one" as 1: the row now says "and so does an animation a correction moves…"; every new row was checked for "one", "twice" and "half", and against a path whose `m4` would read as 4 (§10). |
| completeness-F6 | Accepted | `mountDist` takes `serve.mjs`'s MIME map (§1.62), and M4's styles ship inside their modules by `?inline`, so no stylesheet reaches `mountDist` or the `file://` test at all (§0, §11). |
| completeness-F7 | Accepted | The drawn position is clamped inside the pitch, its offset shortened, as D-16 says (§1.14, §2.3, §9.2). |
| completeness-F8 | Accepted | The look book's samples are made to L15's rule, and 4c reviews every screen's and message's wording against it, logged beside the pick (§1.60, §12, §1.64, §14). |
| completeness-F9 | Accepted | 4c writes each M5 device run's method with its pending row (§1.64, §9.8, §12). |
| completeness-F10 | Accepted | Pose continuity is `src/render/continuity.test.ts`, the motion builder's in 3a, in phase 3's exit; the readout and Copy check is devices-int's in 2b (§2.4, §9.2, §12). |
| completeness-F11 | Accepted | 1a adds `index.ts`'s type re-exports and `bark-types.ts`; 1c adds `BarkTracker`, 2a only `REFUSAL` and `ROLE` (§1.36, §12). |
| completeness-F12 | Accepted | Phase 1 applies a quality change from Home by re-creating the stage; phase 1's menu has Resume and Leave only; phase 2's in-match change applies when the match closes; phase 3 rebuilds when the menu closes (§2.8, §1.43, §5.4, §6). |
| completeness-F13 | Accepted | pitch.spec reads pack A's near half against pack B's far half from the player's ball view, and checks the code-built budget for 8 terriers at both qualities (§9.3). |
| completeness-F14 | Accepted | The announcements log carries each page's arrival tick; countdowns after it and page-F3's goal rule are what a late or reloaded page must have shown (§1.40, §9.4). |
| completeness-F15 | Accepted | One order: the stage, `#app`, the stores, the App, the lock, the first screen, `started()`, then `prepare()`, held while another tab has the lock (§5.1, §1.41, §1.52, M4-Q38). |
| completeness-F16 | Accepted | M4-Q35 adds the rig's yaw, the cosmetic roll and dust, the latch times and the drawing clock's paused time to D-27's and CLAUDE.md's list (§0, §2.7). |
| completeness-F17 | Accepted | A drawing clock that stands still while `Match.paused` drives every fade, glide, dust puff and the ball's roll (§2.2, §1.1, §1.15, §1.16). |
| completeness-F18 | Accepted | The timeline counts the clock's samples taken and dropped (2b, no rule changed), and run 4 and the bench report them with the kept samples' age (§8.4, §1.40, §1.53). |
| completeness-F19 | Accepted, by another step | Run 6 belongs to 2c, a single builder alone on the machine, after the bench exists (2b) and before 2d writes the networked specs (§12). |
| completeness-F20 | Accepted | `room.net.spec.ts` loses each player page's context in turn, Chromium's, Firefox's and WebKit's, never restored, while the others still take its inputs and votes (§9.3). |
| completeness-F21 | Accepted | The feel page gains `botReactionSeconds` and `botAimNoiseDegrees`, a change re-running Q-9's marks (§1.61, §3.5, §14). |
| completeness-F22 | Accepted | M4-Q2 is restated: watching on return is offered only before the start countdown, by Leave and then Watch (§5.6). |
| completeness-F23 | Accepted | The rule: a number is a setting when the owner tunes it with the swing; `cameraNearestMetres` and `chaseLookAheadMetres` join A.5's row; the ±60° limit and M1's fit stay drawing constants (§0, §3.2, §10, M4-Q34). |
| completeness-F24 | Accepted, by its second option | The canary's hash lives in `src/canary-expected.ts`, which only `canary.ts` imports, so `build-info.ts` and `dev/corrections.vitest.config.ts` stay as they are (§1.54). |
| feasibility-F1 | Accepted | The frame-time run has no witness, the peers echoing the page's own vote; the forced repair's witness runs in a module Worker, and only its run carries one (§8.3, §1.53, §2.11, M4-Q16). |
| feasibility-F2 | Accepted | `npm run play` builds into `dist-play/` and serves it on 4340 (M4-Q40, §14). |
| feasibility-F3 | Accepted, with seed 7 alone in the paced runs | `own()` counts every sender; §8.1 states the trade by C-55's formulas, and M4-Q6 proposes K = 5, decided in 2c before the networked specs. The paced proposer runs play seed 7, the seed the spec plays, at two Ready ticks each, rather than R-7's 13 seeds, which would add about ten minutes of test time for seeds no spec plays (§9.2). |
| feasibility-F4 | Accepted | `#test=frames&model=` takes a same-origin relative path; the runs and the owner's bench time the stand-in (§1.53, §8.4, §14, R-8). |
| feasibility-F5 | Accepted | The governor watches the share of ticks skipped and the time in gaps over 50 ms; tested with a 500 ms frame every second (§8.2, §10). |
| feasibility-F6 | Accepted, the check moved into the build | Groups ordered, `drawer-code` without recursion and with rolldown's two companion options; the plugin fails the build on a group holding a stray file, since the gate's unit stage runs before its build and has no bundle to read (§1.56, §1.57). |
| feasibility-F7 | Accepted | The dither is PLAN §12's swap: two precompiled variants, the dithered one only while the occluder crosses the capsule (§1.17, §1.18, §2.6, M4-Q11). |
| feasibility-F8 | Accepted | 640 × 360 and low quality for every spec that plays from phase 1; phase 1's frame loop skips every other frame after a late gap; the largest gap logged per engine (§1.47, §9.1, §12). |
| feasibility-F9 | Accepted | `decided` and `played` counted apart, cues dropped while the context waits, `resume()` caught; a Chromium spec checks the context running (§1.27, §7). |
| feasibility-F10 | Accepted, asserting the stall rather than the freeze | A rebuild or restore compiles a material a frame; Practice keeps its pause through it (M4-Q41). graphics.spec asserts no stall and logs the largest gap: in software GL one program's compile can pass the 233 ms freeze, so asserting it would tie the spec to the machine's speed; the bench measures it on real targets (§2.8). |
| feasibility-F11 | Accepted | `insidePitch` works on the pitch's pieces, goals included; nearer than 1.5 m the camera rises toward `ceilingAt`; `camera.test.ts` and the configuration check cover walls, corners and goals (§1.9, §3.2, §3.6, §10). |
| feasibility-F12 | Accepted | The rig steps k times toward targets between the heads and draws by the bodies' fraction; a placement is `prev.tick < head.phaseStart ≤ head.tick`; both tested with a 6-tick catch-up (§1.10, §1.13, §2.2, §3.1, §3.6). |
| feasibility-F13 | Accepted | A group with your terrier and no remote one glides at 100 ms; the hook and the bench measure key to screen (§2.3, §1.20, §1.25, §8.4, R-6). |
| feasibility-F14 | Accepted | The compile runs behind Home, as PLAN §12 says, and the hook reports the time to Home and to prepared (§2.1, M4-Q38). |
| feasibility-F15 | Accepted | Each due message is delivered in a task of its own; the room's time is reported apart (§8.3, §1.53). |
| feasibility-F16 | Accepted | Ready at fixed ticks (600; the controls run at an anchor of 600 to 2,400), holds from the countdown, all validated in Node over their latitudes (§9.1, §9.2). |
| feasibility-F17 | Accepted | `RenderInfo` reports the cap and the scale apart; specs check the buffer by the scale; the governor is tested in virtual time (§1.3, §9.1, §8.2). |
| tests-decisive-setups-unvalidated | Accepted, by another design of the latitude | Rather than Ready at every 37th tick to 3,600, the specs press Ready at fixed ticks and hold from the countdown, so the latitude left is narrow and is validated tick by tick: Practice's whole matches and first goals over its timeline (setups, phase 1), the three-engine match over the network simulator (slow-frames, 2c) (§9.1, §9.2, M4-Q36). |
| tests-parallel-e2e-collide | Accepted | Every build and Playwright run goes under one machine-wide `flock` (§0, §12, R-14). |
| tests-measure-not-quiet | Accepted | Measurements run in steps of their own (2c, 2d's trial, 4b), each run by M3's quiet-machine rule with the load recorded (§0, §8.4, §12). |
| tests-leave-guard-same-target | Accepted | `stopImmediatePropagation`, tested on Node's `EventTarget` and through the real page, a connected player's prompt dismissed and its peers kept (§1.49, §5.11, §9.3). |
| tests-ready-focus-disabled | Accepted | As completeness-F3. |
| tests-inspection-lifetime | Accepted | An app-level announcements log per match ID; the pad's figures at Inspection's top level; `Layer.name`; arrival rules as page-F3's (§1.38, §1.40, §9.4). |
| tests-governor-frame-rate | Accepted | As feasibility-F17, plus 640 × 360 for every spec that plays and thresholds never lowered for the gate (§8.2, §9.1, R-3). |
| tests-gate-estimate-ci | Accepted | Re-summed row by row: about 37–39 minutes at one worker with this revision's additions, about 23–25 with M4-Q19's workers; phase 1c measures start-up and `prepare()` per engine; CI becomes a matrix (§9.9, M4-Q37). |
| tests-frames-same-phase | Accepted | The frames builder moves to 2b, after net-screens' `match.ts` and `pitch.ts` exist (§12). |
| tests-config-row-one | Accepted | As completeness-F5. |
| tests-mountdist-css | Accepted | As completeness-F6; boot.spec joins 1c's adapted specs (§9.3, §12). |
| tests-test-pages-two-mains | Accepted | `src/main.ts` makes `#app` on the normal page only; `index.html` holds none (§1.52, §1.59, §5.1, M4-Q1). |
| tests-seed-storage-reload | Accepted | `seedStorage` writes a key only when it's absent; first-use checks run in a fresh context (§1.62, §6, §9.1). |
| tests-transients-polled | Accepted | Lunges, overlays shown, barks and celebrations shown, Results' presses and decided cues are latched; hash comparisons stay inside the history (§1.2, §1.40, §9.1, §9.3). |
| tests-layer-interfaces | Accepted, all eight | `PitchContext.frame` and `graphics`, `Layer.name` and `ownBark`, `PitchHost.announce`; the sound prompt is the sound layer's alone; `view.ts` is motion's alone in phase 3; the session's types in 1a; the palette maths in `palette-check.ts` (§1.12, §1.16, §1.27, §1.36, §1.38, §1.44). |
| tests-unowned-files | Accepted | Each builder's CSS file of its own; `tsconfig.json` in frames' list; the dev-local config's pattern widened in 1c; `e2e/lib/page.ts` owned by one builder in each step (§0, §12). |
| tests-a11y-real-page-gaps | Accepted | The tab lock through two pages, reduced motion emulated, the sound prompt before and after a key, axe on the touch layer, the hints panel, the turn prompt and the networked Pre-match; opaque backings for text over the pitch; §5.14 reworded, §9.6 says which engines see which screens. |
| tests-guard-relay-silent-failures | Accepted | The connection failure starts its own local relay with `ice: 'none'`; the model loader, Copy, Share, fullscreen, the locks and `resume()` catch their refusals; the stand-in's abort asserts no page error (§5.12, §2.10, §1.48, §9.1). |
| tests-sweep-pin-unbounded | Accepted | The sweep must fall within ±10% of Q-19's model before it's pinned (§3.6, §9.2). |
