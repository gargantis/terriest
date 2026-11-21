// The stage: the page's whole drawing (PLAN §12, D-26, D-27, D-30, D-33;
// M4's design, research/m4/DESIGN.md, §1.3, §2.1, §2.8). It makes the
// page's one WebGL 2 context on a canvas of its own, at the render
// quality's MSAA and pixel-ratio cap, and the scene: M1's lights and pitch
// (src/render/pitch.ts) in the look's colours, the ball (ball.ts), the blob
// shadows (shadows.ts), the terrier drawer the app passes in, so the stage
// imports no drawer's chunk itself, the effects (effects.ts, phase 3) and
// the camera. Before play, behind Home, prepare() compiles every program a
// match can use on a scene holding one of each, the drawer at full
// capacity with both packs' bandanas, the ball, the shadows, the pitch and
// each occluder's other variant, then uploads every buffer and texture by
// one render with frustum culling off, and records firstFrame: nothing
// compiles in play (PLAN §12, D-27's M0 note). draw() takes the view's
// StageFrame (src/render/view.ts), as the app's frame loop owns
// requestAnimationFrame: it places the camera (camera.ts), poses the ball,
// the shadows and the terriers, sets the fade, renders, and returns the
// projections the DOM overlay needs. A null frame draws the empty pitch
// from M1's overview camera. The canvas fills its box: each draw checks its
// CSS size and pixel ratio, min(devicePixelRatio, cap) × the governor's
// scale, and resizes only on a change, the drawing buffer round(CSS size ×
// that ratio), so a spec checks the buffer by the scale it reads (§9.1).
//
// From M1's scene.ts: the context, the lights, the fit, the counts and the
// compile-then-cull-off first frame. M1's createPitchView stays below as a
// thin wrapper over the stage, drawing the overview each animation frame,
// so M1's page (src/main.ts) and its specs run unchanged until phase 1c's
// app replaces it. Phase 3 fills the effects, the fade, the model slot
// (model-loader.ts) and the lost context and rebuild (graphics.ts), whose
// stubs this calls with their final signatures.

import {
  AmbientLight, Color, DirectionalLight, Group, HemisphereLight, type InstancedMesh, type Object3D, PerspectiveCamera, Scene, Vector3,
  type WebGLRenderer,
} from 'three';
import { config, type RenderQuality } from '../config';
import { defaultParams } from '../core/sim/params';
import { pitch } from '../core/sim/pitch';
import { NEVER, STANDING } from '../core/sim/state';
import { BallMesh } from './ball';
import { newPlaced, placeCamera, project } from './camera';
import { type DrawerCounts, type DrawerFactory, type DrawerFrame, TERRIER_LAYER, type TerrierDrawer, type TerrierFrame } from './drawer';
import { createEffects, type Effects } from './effects';
import { setFade } from './fade';
import type { CameraFrame, DrawnMatch, DrawnTerrier, FrameOut, ScreenPoint, StageFrame } from './frame';
import { createRenderer, type MadeRenderer, rebuildRenderer, watchContext } from './graphics';
import { newDrawnMatch } from './interpolate';
import { type Look, PLACEHOLDER_LOOK } from './look';
import { createModelSlot, type ModelSlot } from './model-loader';
import { type DrawnPitch, drawPitch } from './pitch';
import { type QualityDetail, qualityDetail } from './quality';
import { Shadows } from './shadows';
import type { RenderInfo, ResourceCounts, Stage, StageOptions } from './stage-types';
import type { ViewCameraFrame } from './view';

export type { RenderInfo, ResourceCounts } from './stage-types';

/** The occluders fade inside this distance of the line from the camera to its subject (§2.6, phase 3). */
const FADE_RADIUS_METRES = 0.5;
const ORIGIN = Object.freeze({ x: 0, y: 0, z: 0 });
const OVERVIEW: CameraFrame = Object.freeze({ mode: Object.freeze({ kind: 'overview' as const }), yaw: 0, target: ORIGIN, subject: null });
const NO_TERRIERS: DrawerFrame = Object.freeze({ time: 0, tick: 0, fraction: 0, terriers: Object.freeze([]) });

/** prepare()'s terriers, one of each the drawer can draw: the capacity's worth, both packs, every coat. */
function placeholderTerrier(k: number, look: Look): DrawnTerrier {
  return {
    x: -6 + 1.5 * (k >> 1), y: k % 2 === 0 ? -2 : 2, z: defaultParams.terrierRadius, vx: 0, vy: 0, vz: 0,
    id: `placeholder ${k}`, name: '', pack: k % 2 === 0 ? 0 : 1, spot: k >> 1, coat: k % look.coats.length,
    heading: 0, headingChange: 0, anim: STANDING, animStart: 0, gait: 0,
    takeOffTick: NEVER, landingTick: NEVER, lastBallContactTick: NEVER, lastTerrierContactTick: NEVER,
    lastPushDir: 0, lastPushTick: NEVER, sitting: false, ballOverhead: false, overheadRef: 0,
    meter: 1, pounceWait: 0, lunge: 0, tumble: 0, guard: 0,
  };
}

function placeholderFrame(d: DrawnTerrier): TerrierFrame {
  return {
    id: d.id, pack: d.pack, coat: d.coat, mine: false, x: d.x, y: d.y, z: d.z, vx: 0, vy: 0, vz: 0,
    heading: d.heading, headingChange: 0, layers: [{ anim: STANDING, start: 0, weight: 1 }], gait: 0,
    takeOffTick: NEVER, landingTick: NEVER, lastBallContactTick: NEVER, lastTerrierContactTick: NEVER,
    lastPushDir: 0, lastPushTick: NEVER, bark: null, celebrate: null,
  };
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** The stage (§1.3): createStage's, and createPitchView's on M1's canvas. */
class Drawing implements Stage {
  onGraphics: ((state: 'lost' | 'restored') => void) | null = null;
  private canvasValue: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private samples: number;
  private quality: RenderQuality;
  private detail: QualityDetail;
  private readonly look: Look;
  private readonly ownsCanvas: boolean;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera();
  private readonly placed = newPlaced();
  private pitchDrawn: DrawnPitch;
  private ball: BallMesh;
  private readonly shadows: Shadows;
  private readonly codeDrawer: TerrierDrawer;
  private drawer: TerrierDrawer;
  private readonly effects: Effects;
  private readonly model: ModelSlot;
  private modelUrl: string;
  private readonly placeholders: DrawnMatch;
  private readonly fadeFrom = new Vector3();
  private readonly fadeTo = new Vector3();
  private unwatch: () => void;
  // The fit.
  private cssWidth = 0;
  private cssHeight = 0;
  private ratio = 0;
  private scale = 1;
  // The counts.
  private frames = 0;
  private firstFrame: ResourceCounts | null = null;
  private prepared = false;
  private prepareMs: number | null = null;
  private preparing: Promise<void> | null = null;
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (e: unknown) => void;
  private cameraInfo: RenderInfo['camera'] = { kind: 'overview', view: null, calm: false, turnCap: null, raised: false, yaw: 0, x: 0, y: 0, z: 0 };
  private nowMs = 0;
  private lost = false;
  private restores = 0;
  private rebuilds = 0;
  private rebuilding = false;
  private disposed = false;

  constructor(o: StageOptions, canvas: HTMLCanvasElement, made: MadeRenderer, ownsCanvas: boolean) {
    this.canvasValue = canvas;
    this.renderer = made.renderer;
    this.samples = made.samples;
    this.quality = o.quality;
    this.detail = qualityDetail(o.quality);
    this.look = o.look;
    this.ownsCanvas = ownsCanvas;
    this.modelUrl = o.modelUrl;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // ready() may never be awaited: its rejection is prepare()'s to report.
    this.readyPromise.catch(() => {});

    const scene = this.scene;
    scene.background = new Color(o.look.pitch.sky);
    const sky = new HemisphereLight(0xffffff, 0x5f7f4f, 1.6);
    sky.position.set(0, 0, 1);
    const sun = new DirectionalLight(0xfff3dd, 2.2);
    sun.position.set(-10, -6, 22);
    for (const light of [sky, new AmbientLight(0xffffff, 0.25), sun]) {
      // three tests lights against the camera's layers too: a pass of the terriers' layer alone
      // lights them as every frame does.
      light.layers.enable(TERRIER_LAYER);
      scene.add(light);
    }
    this.camera.up.set(0, 0, 1);
    this.pitchDrawn = this.makePitch();
    this.ball = new BallMesh(o.look, this.detail, defaultParams.ballRadius);
    this.shadows = new Shadows(o.capacity);
    this.codeDrawer = o.drawer(o.look, o.capacity);
    this.drawer = this.codeDrawer;
    scene.add(this.pitchDrawn.object, this.ball.object, this.shadows.mesh, this.drawer.object);
    this.ball.object.visible = false;
    this.effects = createEffects(scene, o.look, this.detail, o.capacity, this.pitchDrawn);
    this.model = createModelSlot({ look: o.look, capacity: o.capacity, compile: (d) => d.compile(this.renderer, this.camera, this.scene) });
    this.placeholders = newDrawnMatch();
    this.placeholders.terriers = Array.from({ length: o.capacity }, (_, k) => placeholderTerrier(k, o.look));
    this.placeholders.ball.x = 3;
    this.placeholders.ball.z = defaultParams.ballRadius;
    this.unwatch = this.watch(canvas);
  }

  get canvas(): HTMLCanvasElement {
    return this.canvasValue;
  }

  prepare(): Promise<void> {
    this.preparing ??= this.compileAndUpload().then(
      () => this.resolveReady(),
      (e: unknown) => {
        this.rejectReady(e);
        throw e;
      },
    );
    return this.preparing;
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  draw(frame: StageFrame | null): FrameOut {
    this.fit();
    this.swapModel();
    const match = frame?.match ?? null;
    if (frame !== null) this.nowMs = frame.nowMs;
    const shown = match !== null && frame !== null ? frame : null;
    placeCamera(shown?.camera ?? OVERVIEW, pitch, this.cssWidth / this.cssHeight, this.placed);
    this.applyCamera();
    // The fade's capsule, from the camera to its subject: before the ball and the pitch take their variants.
    const to = shown?.fadeTo ?? null;
    if (to === null) setFade(null, null, 0);
    else setFade(this.fadeFrom.copy(this.placed.position), this.fadeTo.set(to.x, to.y, to.z), FADE_RADIUS_METRES);
    if (shown !== null && match !== null) {
      this.ball.object.visible = true;
      this.ball.draw(match.ball, match.time, shown.dtMs);
      this.shadows.draw(match);
      this.drawer.draw(shown.drawer ?? NO_TERRIERS);
    } else {
      this.ball.object.visible = false;
      this.shadows.clear();
      this.drawer.draw(NO_TERRIERS);
    }
    this.pitchDrawn.setFade();
    this.effects.draw(shown ?? { match: null, drawer: null, camera: OVERVIEW, nowMs: this.nowMs, dtMs: 0, fadeTo: null });
    // A rebuild under way draws nothing on the old renderer, which never compiled the new parts.
    if (!this.rebuilding) this.renderer.render(this.scene, this.camera);
    this.frames++;
    const camera = shown?.camera ?? OVERVIEW;
    const mode = camera.mode;
    const viewCamera = camera as Partial<ViewCameraFrame>;
    this.cameraInfo = {
      kind: mode.kind, view: mode.kind === 'player' ? mode.view : null, calm: viewCamera.calm === true, turnCap: viewCamera.turnCap ?? null,
      raised: this.placed.raised, yaw: camera.yaw, x: this.placed.position.x, y: this.placed.position.y, z: this.placed.position.z,
    };
    return this.projections(match, camera.yaw);
  }

  info(): RenderInfo {
    const r = this.renderer.info;
    return {
      frames: this.frames, quality: this.quality, samples: this.samples,
      pixelRatio: this.ratio, width: this.canvasValue.width, height: this.canvasValue.height,
      calls: r.render.calls, triangles: r.render.triangles, lines: r.render.lines,
      ...this.counts(),
      firstFrame: this.firstFrame,
      cap: this.detail.pixelRatioMax, scale: this.scale,
      cssWidth: this.cssWidth, cssHeight: this.cssHeight,
      prepared: this.prepared, prepareMs: this.prepareMs,
      drawer: this.drawer.counts(),
      model: { url: this.modelUrl, state: this.model.state, ms: this.model.ms, error: this.model.error },
      camera: { ...this.cameraInfo },
      lost: this.lost, restores: this.restores, rebuilds: this.rebuilds, rebuilding: this.rebuilding,
    };
  }

  setModel(url: string): void {
    this.modelUrl = url;
    this.model.request(url);
  }

  /** Phase 1's rebuild, through graphics.ts's stub: the quality's own parts made again (the nets' ropes,
   *  the ball's sphere), a new renderer on a new canvas with every program compiled at once, the
   *  one-render upload, and the new canvas in the old one's place, its attributes copied. Frames draw
   *  nothing meanwhile, since the old renderer never compiled the new parts. Without a new renderer the
   *  old one and its parts stay, and it rejects. Phase 3's robust builder compiles a material a frame
   *  while the old canvas draws on (M4-Q41). */
  async rebuild(quality: RenderQuality): Promise<void> {
    if (this.rebuilding || this.disposed) return;
    this.rebuilding = true;
    const oldDetail = this.detail;
    const oldPitch = this.pitchDrawn;
    const oldBall = this.ball;
    this.detail = qualityDetail(quality);
    this.pitchDrawn = this.makePitch();
    this.ball = new BallMesh(this.look, this.detail, defaultParams.ballRadius);
    this.ball.object.visible = oldBall.object.visible;
    this.scene.remove(oldPitch.object, oldBall.object);
    this.scene.add(this.pitchDrawn.object, this.ball.object);
    let made: Awaited<ReturnType<typeof rebuildRenderer>> = null;
    try {
      made = await rebuildRenderer({ quality, old: this.canvasValue, scene: this.scene, nextFrame });
    } finally {
      if (made === null) {
        this.scene.remove(this.pitchDrawn.object, this.ball.object);
        this.pitchDrawn.dispose();
        this.ball.dispose();
        this.detail = oldDetail;
        this.pitchDrawn = oldPitch;
        this.ball = oldBall;
        this.scene.add(oldPitch.object, oldBall.object);
        this.rebuilding = false;
      }
    }
    if (made === null) throw new Error('the browser made no WebGL 2 context for the new renderer');
    const old = this.canvasValue;
    for (const a of Array.from(old.attributes)) made.canvas.setAttribute(a.name, a.value);
    old.replaceWith(made.canvas);
    this.unwatch();
    this.renderer.dispose();
    this.renderer = made.renderer;
    const gl = made.renderer.getContext();
    this.samples = Number(gl.getParameter(gl.SAMPLES));
    this.canvasValue = made.canvas;
    this.unwatch = this.watch(made.canvas);
    this.quality = quality;
    this.ratio = 0;
    this.fit();
    this.upload();
    this.firstFrame = this.counts();
    this.rebuilds++;
    oldPitch.dispose();
    oldBall.dispose();
    this.rebuilding = false;
  }

  setScale(scale: number): void {
    this.scale = Math.min(1, Math.max(config.drawingScaleMin, scale));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unwatch();
    if (this.drawer !== this.codeDrawer) this.drawer.dispose();
    this.codeDrawer.dispose();
    this.effects.dispose();
    this.shadows.dispose();
    this.ball.dispose();
    this.pitchDrawn.dispose();
    this.renderer.dispose();
    if (this.ownsCanvas) this.canvasValue.remove();
  }

  // --- Its parts ---

  private makePitch(): DrawnPitch {
    const anisotropy = Math.min(this.detail.anisotropyMax, this.renderer.capabilities.getMaxAnisotropy());
    return drawPitch(pitch, { ...this.detail, anisotropy }, this.look);
  }

  private watch(canvas: HTMLCanvasElement): () => void {
    return watchContext(canvas, (s) => {
      this.lost = s === 'lost';
      if (s === 'restored') this.restores++;
      this.onGraphics?.(s);
    });
  }

  private counts(): ResourceCounts {
    const r = this.renderer.info;
    return { programs: r.programs?.length ?? 0, geometries: r.memory.geometries, textures: r.memory.textures };
  }

  /** The canvas's CSS size and the drawn ratio, min(devicePixelRatio, cap) × scale; the drawing buffer
   *  round(CSS size × ratio), set only on a change (§2.1, §9.1). */
  private fit(): void {
    const w = Math.max(1, this.canvasValue.clientWidth);
    const h = Math.max(1, this.canvasValue.clientHeight);
    const ratio = Math.min(devicePixelRatio, this.detail.pixelRatioMax) * this.scale;
    if (w === this.cssWidth && h === this.cssHeight && ratio === this.ratio) return;
    this.cssWidth = w;
    this.cssHeight = h;
    this.ratio = ratio;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.max(1, Math.round(w * ratio)), Math.max(1, Math.round(h * ratio)), false);
  }

  private applyCamera(): void {
    const c = this.camera;
    const p = this.placed;
    c.fov = p.fovDegrees;
    c.near = p.near;
    c.far = p.far;
    c.aspect = this.cssWidth / this.cssHeight;
    c.position.copy(p.position);
    c.up.copy(p.up);
    c.lookAt(p.lookAt);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }

  /** The model's drawer, once loaded and compiled, swapped in between two frames; the code-built one is
   *  kept, to come back to (L100). */
  private swapModel(): void {
    const next = this.model.ready();
    if (next === null || next === this.drawer) return;
    this.scene.remove(this.drawer.object);
    this.drawer = next;
    this.scene.add(next.object);
  }

  /** Every program a match can use, compiled on a scene holding one of each, then every buffer and
   *  texture uploaded by one render with culling off (§2.1). */
  private async compileAndUpload(): Promise<void> {
    const t0 = performance.now();
    this.fit();
    this.showPlaceholders(true);
    placeCamera(OVERVIEW, pitch, this.cssWidth / this.cssHeight, this.placed);
    this.applyCamera();
    await this.drawer.compile(this.renderer, this.camera, this.scene);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.upload();
    this.firstFrame = this.counts();
    this.showPlaceholders(false);
    this.prepared = true;
    this.prepareMs = performance.now() - t0;
    if (this.modelUrl !== '') this.setModel(this.modelUrl);
  }

  /** prepare()'s one of each: a full-capacity frame of placeholder terriers, the ball and every shadow;
   *  or none of them, the empty pitch. */
  private showPlaceholders(on: boolean): void {
    const m = this.placeholders;
    if (on) {
      this.drawer.draw({ time: 0, tick: 0, fraction: 0, terriers: m.terriers.map(placeholderFrame) });
      this.ball.draw(m.ball, 0, 0);
      this.ball.object.visible = true;
      this.shadows.draw(m);
    } else {
      this.drawer.draw(NO_TERRIERS);
      this.ball.object.visible = false;
      this.shadows.clear();
    }
  }

  /** One render with culling off, every object shown and every instanced mesh at its full count, so
   *  every geometry and texture is uploaded now, not when it first comes into view (D-27's M0 note). */
  private upload(): void {
    const hidden: Object3D[] = [];
    const culled: Object3D[] = [];
    const counts: [InstancedMesh, number][] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
      const im = o as InstancedMesh;
      if (im.isInstancedMesh === true) {
        counts.push([im, im.count]);
        im.count = im.instanceMatrix.count;
      }
    });
    this.renderer.render(this.scene, this.camera);
    for (const o of hidden) o.visible = false;
    for (const o of culled) o.frustumCulled = true;
    for (const [im, count] of counts) im.count = count;
  }

  /** Where the ball and each terrier show on the canvas, for the overlay and the arrow (§3.3); for the
   *  empty pitch, the centre spot where the ball rests at a kickoff. */
  private projections(m: DrawnMatch | null, yaw: number): FrameOut {
    const w = this.cssWidth;
    const h = this.cssHeight;
    const c = this.camera;
    const ball: ScreenPoint = m === null ? project(c, 0, 0, defaultParams.ballRadius, w, h) : project(c, m.ball.x, m.ball.y, m.ball.z, w, h);
    const terriers = m === null ? [] : m.terriers.map((t) => ({ ...project(c, t.x, t.y, t.z, w, h), id: t.id }));
    return { ball, terriers, yaw, cssWidth: w, cssHeight: h };
  }
}

/** The stage, or null when the browser offers no WebGL 2 (D-30). Its canvas is its own: the app puts it
 *  in the page before prepare(). */
export function createStage(o: StageOptions): Stage | null {
  const canvas = document.createElement('canvas');
  const made = createRenderer(canvas, o.quality);
  return made === null ? null : new Drawing(o, canvas, made, true);
}

// --- M1's page, until phase 1c (src/main.ts) ---

const NO_COUNTS: DrawerCounts = Object.freeze({
  kind: 'code', terriers: 0, trianglesPerTerrier: 0, triangles: 0, drawCalls: 0, bonesPerTerrier: 0, bones: 0,
  textures: 0, textureBytes: 0, textureSize: '', geometries: 0, coatsPainted: Object.freeze([]), packsPainted: Object.freeze([]),
  overlays: Object.freeze({ barking: 0, celebrating: 0, pushing: 0 }), overlaysShown: Object.freeze({ barking: 0, celebrating: 0, pushing: 0 }),
});

/** M1's page draws no terriers. */
const noTerriers: DrawerFactory = () => {
  const object = new Group();
  object.name = 'no terriers';
  return {
    kind: 'code', object,
    draw(): void {},
    counts: () => NO_COUNTS,
    compile: () => Promise.resolve(),
    dispose(): void {
      object.removeFromParent();
    },
  };
};

export interface PitchView {
  /** Compiles, uploads and draws the first frame, then draws on every animation frame. */
  start(): Promise<void>;
  info(): RenderInfo;
}

/** M1's empty pitch on `canvas`, as the stage draws it from the overview camera, or null if the browser
 *  offers no WebGL 2 (D-30). The canvas must be in the page before start(). */
export function createPitchView(canvas: HTMLCanvasElement, quality: RenderQuality): PitchView | null {
  const made = createRenderer(canvas, quality);
  if (made === null) return null;
  const stage = new Drawing(
    { quality, look: PLACEHOLDER_LOOK, drawer: noTerriers, capacity: 2 * config.packSizeMax, modelUrl: '' }, canvas, made, false,
  );
  return {
    async start() {
      await stage.prepare();
      stage.draw(null);
      const loop = (): void => {
        stage.draw(null);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
    info: () => stage.info(),
  };
}
