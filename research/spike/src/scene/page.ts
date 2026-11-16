// The spike's scene page (PLAN §17 M0, run 4 and run 6). It draws a
// SimSource's matches with three.js, advancing the source by the clock
// (performance.now), never once per frame, and drawing on animation frames,
// one tick behind the newest view, interpolated by the tick's fraction
// (§12). After a warm-up it measures the animation-frame intervals for a
// chosen number of seconds and shows roslambo's verdict (p95 <= 18 ms and
// max <= 50 ms), with the drawing counts, on the page and on
// window.spikeResult.
//
// URL parameters: quality=high|low (D-33; default high), seconds=N (the
// measured window, default 30), warmup=N (default 2), camera=spectator (high
// above one side, for looking the pitch over; default behind terrier 0). The model drawer is
// used when window.spikeTest.modelUrl is set before load (D-27's pre-load
// hook); until it has loaded, and if it fails, terriers are code-built.

import {
  AmbientLight, Color, DirectionalLight, HemisphereLight, Mesh, REVISION, Scene, WebGLRenderer, type Camera,
  type Material, type Object3D, type Texture,
} from 'three';
import { TICK_RATE, type DrawStats, type MatchView, type SimSource } from '../contract';
import { Ball, Shadows } from './ball';
import { BallCamera } from './camera';
import { CodeDrawer } from './code-drawer';
import { TERRIER_LAYER, textureBytes, type DrawerCounts, type TerrierDrawer } from './drawer';
import { MAX_MS, P95_MS, intervals, passes, spread, type Intervals, type Spread } from './frames';
import { interpolate, snapshot } from './interpolate';
import { SKY } from './look';
import type { ModelInfo } from './model-drawer';
import { buildPitch } from './pitch';

export type Quality = 'high' | 'low';

export interface ResourceEntry {
  name: string;
  initiatorType: string;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  durationMs: number;
}

export interface SpikeResult {
  state: 'starting' | 'warming' | 'measuring' | 'done' | 'failed';
  error: string;
  three: string;
  quality: Quality;
  drawer: 'code' | 'model';
  /** The measured window: its length, the frames in it and their intervals (ms). */
  seconds: number;
  frames: number;
  interval: Intervals;
  /** Main-thread time inside each frame callback, and per advance() call (ms). */
  work: Spread;
  advance: Spread;
  pass: boolean;
  verdict: 'PASS' | 'FAIL' | '';
  /** The source's tick, and the clock's own count since the start. */
  ticks: number;
  clock: { elapsedMs: number; expectedTicks: number; advancedTicks: number; droppedTicks: number; advanceCalls: number; maxTicksPerCall: number };
  draw: {
    /** The whole frame, from renderer.info, plus the drawer's bones and every texture's bytes. */
    frame: DrawStats & { lines: number };
    /** The terriers alone: the drawer's counts. */
    terriers: DrawStats;
    /** The terriers alone, as renderer.info counted a pass of TERRIER_LAYER. */
    terrierPass: { drawCalls: number; triangles: number };
    perTerrier: { triangles: number; bones: number; textureBytes: number; textureSize: string };
    counts: DrawerCounts | null;
    /** renderer.info.programs.length after the compile, at the window's start and end. */
    programs: { compiled: number; atStart: number; atEnd: number };
    /** renderer.info.memory at the window's start and end: nothing is uploaded in play. */
    memoryAtStart: { geometries: number; textures: number };
    memoryAtEnd: { geometries: number; textures: number };
  };
  model: { requested: boolean; url: string; state: 'none' | 'loading' | 'ready' | 'failed'; error: string; info: ModelInfo | null; importMs: number; compileMs: number; swapTick: number };
  csp: { directive: string; blocked: string }[];
  resources: ResourceEntry[];
  env: {
    userAgent: string; devicePixelRatio: number; pixelRatio: number; canvas: { width: number; height: number };
    renderer: string; antialias: boolean; samples: number; maxAnisotropy: number; hiddenDuringWindow: boolean;
  };
}

declare global {
  interface Window {
    /** Set before load by a test: the model to draw instead of code-built terriers. */
    spikeTest?: { modelUrl?: string };
    spikeResult?: SpikeResult;
  }
}

export interface PageOptions {
  root: HTMLElement;
  source: SimSource;
  quality: Quality;
  seconds: number;
  warmup: number;
  modelUrl: string;
  spectator: boolean;
}

export function pageOptions(root: HTMLElement, source: SimSource): PageOptions {
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number): number => {
    const v = Number(q.get(k) ?? '');
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    root, source,
    quality: q.get('quality') === 'low' ? 'low' : 'high',
    seconds: num('seconds', 30),
    warmup: num('warmup', 2),
    modelUrl: window.spikeTest?.modelUrl ?? '',
    spectator: q.get('camera') === 'spectator',
  };
}

/** Catch-up beyond this many ticks in one go is dropped, as after a stall (D-31's 2 s). */
const MAX_CATCH_UP = 120;

const EMPTY_SPREAD: Spread = { mean: 0, p95: 0, max: 0 };
const EMPTY_INTERVALS: Intervals = { p50: 0, p95: 0, p99: 0, max: 0 };

function sceneTextures(scene: Scene): Texture[] {
  const out = new Set<Texture>();
  scene.traverse((o) => {
    const m = (o as Mesh).material as Material | Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      const map = (mat as Material & { map?: Texture | null }).map;
      if (map) out.add(map);
    }
  });
  return [...out];
}

function bytesOf(textures: Texture[]): number {
  let n = 0;
  for (const t of textures) {
    const img = t.image as { width?: number; height?: number } | null;
    n += textureBytes(img?.width ?? 0, img?.height ?? 0, t.generateMipmaps);
  }
  return n;
}

function resources(): ResourceEntry[] {
  return performance.getEntriesByType('resource').map((e) => {
    const r = e as PerformanceResourceTiming;
    let name = r.name;
    try {
      const u = new URL(r.name);
      // The base name, by a regular expression: the dist audit reads a '/'
      // string literal as a root-absolute URL.
      name = u.protocol === 'blob:' ? 'blob:' : u.pathname.replace(/^.*\//, '');
    } catch {
      // keep it as it is
    }
    return { name, initiatorType: r.initiatorType, transferSize: r.transferSize, encodedBodySize: r.encodedBodySize, decodedBodySize: r.decodedBodySize, durationMs: r.duration };
  });
}

/** Draws every object once, culling off, so its buffers and textures are uploaded now. */
export function prewarm(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
  const culled: Object3D[] = [];
  scene.traverse((o) => {
    if (o.frustumCulled) {
      culled.push(o);
      o.frustumCulled = false;
    }
  });
  renderer.render(scene, camera);
  for (const o of culled) o.frustumCulled = true;
}

export async function runPage(o: PageOptions): Promise<void> {
  const result: SpikeResult = {
    state: 'starting', error: '', three: REVISION, quality: o.quality, drawer: 'code',
    seconds: o.seconds, frames: 0, interval: EMPTY_INTERVALS, work: EMPTY_SPREAD, advance: EMPTY_SPREAD,
    pass: false, verdict: '', ticks: 0,
    clock: { elapsedMs: 0, expectedTicks: 0, advancedTicks: 0, droppedTicks: 0, advanceCalls: 0, maxTicksPerCall: 0 },
    draw: {
      frame: { triangles: 0, drawCalls: 0, bones: 0, textures: 0, textureBytes: 0, geometries: 0, lines: 0 },
      terriers: { triangles: 0, drawCalls: 0, bones: 0, textures: 0, textureBytes: 0, geometries: 0 },
      terrierPass: { drawCalls: 0, triangles: 0 },
      perTerrier: { triangles: 0, bones: 0, textureBytes: 0, textureSize: '' },
      counts: null,
      programs: { compiled: 0, atStart: 0, atEnd: 0 },
      memoryAtStart: { geometries: 0, textures: 0 },
      memoryAtEnd: { geometries: 0, textures: 0 },
    },
    model: { requested: o.modelUrl !== '', url: o.modelUrl, state: o.modelUrl ? 'loading' : 'none', error: '', info: null, importMs: 0, compileMs: 0, swapTick: -1 },
    csp: [],
    resources: [],
    env: {
      userAgent: navigator.userAgent, devicePixelRatio, pixelRatio: 0, canvas: { width: 0, height: 0 },
      renderer: '', antialias: o.quality === 'high', samples: 0, maxAnisotropy: 0, hiddenDuringWindow: false,
    },
  };
  window.spikeResult = result;
  document.addEventListener('securitypolicyviolation', (e) => {
    result.csp.push({ directive: e.effectiveDirective || e.violatedDirective, blocked: e.blockedURI });
  });

  const root = o.root;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  const hud = document.createElement('pre');
  hud.dataset.test = 'verdict';
  hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;max-width:calc(100% - 32px);white-space:pre-wrap;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#fff;background:rgba(0,0,0,.55);border-radius:4px;pointer-events:none';
  const title = `terriest M0 spike: three r${REVISION}, ${TICK_RATE} ticks a second`;
  hud.textContent = `${title}\nstarting…`;
  root.replaceChildren(canvas, hud);

  const gl2 = canvas.getContext('webgl2', { antialias: o.quality === 'high', powerPreference: 'high-performance' });
  document.documentElement.dataset.webgl2 = gl2 ? 'yes' : 'no';
  if (!gl2) {
    result.state = 'failed';
    result.error = 'no WebGL 2';
    hud.textContent = `${title}\nThis page needs WebGL 2, which this browser doesn't offer.`;
    return;
  }

  // D-33: high caps the pixel ratio at 2 with MSAA; low caps it at 1 without.
  const renderer = new WebGLRenderer({ canvas, context: gl2, antialias: o.quality === 'high' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, o.quality === 'high' ? 2 : 1));
  renderer.setSize(innerWidth, innerHeight, false);
  const debug = gl2.getExtension('WEBGL_debug_renderer_info');
  result.env.renderer = String(gl2.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl2.RENDERER));
  result.env.samples = Number(gl2.getParameter(gl2.SAMPLES));
  result.env.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  canvas.addEventListener('webglcontextlost', () => {
    result.state = 'failed';
    result.error = 'WebGL context lost';
  });

  const scene = new Scene();
  scene.background = new Color(SKY);
  const sun = new DirectionalLight(0xfff3dd, 2.2);
  sun.position.set(-10, -6, 22);
  for (const light of [new HemisphereLight(0xffffff, 0x5f7f4f, 1.6).translateZ(10), new AmbientLight(0xffffff, 0.25), sun]) {
    // three tests lights against the camera's layers too: the terrier-only
    // counting pass must light the terriers as every frame does.
    light.layers.enable(TERRIER_LAYER);
    scene.add(light);
  }

  const low = o.quality === 'low';
  const pitch = buildPitch({ netSpacing: low ? 2 : 1, goalNetSpacing: low ? 0.5 : 0.25, anisotropy: low ? 1 : Math.min(8, result.env.maxAnisotropy) });
  scene.add(pitch.object);
  const source = o.source;
  const count = source.packSize * 2;
  const ball = new Ball(40, 28);
  scene.add(ball.object);
  const shadows = new Shadows(count);
  scene.add(shadows.mesh);
  let drawer: TerrierDrawer = new CodeDrawer(count);
  scene.add(drawer.object);
  const view = new BallCamera(innerWidth / innerHeight);
  const camera = view.camera;

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight, false);
    view.resize(innerWidth / innerHeight);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && result.state === 'measuring') result.env.hiddenDuringWindow = true;
  });

  // Nothing compiles in play (§12): every program the scene uses, now, and
  // one frame with culling off, so every geometry and texture is uploaded
  // before play rather than when it first comes into view.
  await renderer.compileAsync(scene, camera);
  prewarm(renderer, scene, camera);
  result.draw.programs.compiled = renderer.info.programs?.length ?? 0;

  // The clock (D-31's timers, not animation frames): ticks due since t0,
  // advanced in one call, keeping the two newest views for interpolation.
  const base = source.view().tick;
  let prev: MatchView = snapshot(source.view());
  let curr: MatchView = prev;
  let advanced = 0;
  let dropped = 0;
  const t0 = performance.now();
  const advanceCosts: number[] = [];
  const clockTicks = (now: number): number => ((now - t0) * TICK_RATE) / 1000 - dropped;
  const advanceTo = (now: number): void => {
    let k = Math.floor(clockTicks(now)) - advanced;
    if (k > MAX_CATCH_UP) {
      dropped += k - MAX_CATCH_UP;
      k = MAX_CATCH_UP;
    }
    if (k <= 0) return;
    const a0 = performance.now();
    if (k >= 2) {
      source.advance(k - 1);
      prev = snapshot(source.view());
    } else prev = curr;
    source.advance(1);
    curr = snapshot(source.view());
    advanced += k;
    result.clock.advanceCalls++;
    result.clock.maxTicksPerCall = Math.max(result.clock.maxTicksPerCall, k);
    if (result.state === 'measuring') advanceCosts.push(performance.now() - a0);
  };
  const timer = setInterval(() => advanceTo(performance.now()), 1000 / TICK_RATE / 2);

  // The model drawer, by dynamic import, swapped in once loaded and compiled.
  let ready = o.modelUrl === '';
  let pendingModel: TerrierDrawer | null = null;
  if (o.modelUrl) {
    void (async () => {
      try {
        const i0 = performance.now();
        const { loadModelDrawer } = await import('./model-drawer');
        result.model.importMs = performance.now() - i0;
        const { drawer: model, info } = await loadModelDrawer(o.modelUrl, count);
        result.model.info = info;
        const c0 = performance.now();
        await model.compile(renderer, camera, scene);
        result.model.compileMs = performance.now() - c0;
        pendingModel = model;
      } catch (e) {
        result.model.state = 'failed';
        result.model.error = e instanceof Error ? e.message : String(e);
        ready = true;
      }
    })();
  }

  const frameIntervals: number[] = [];
  const work: number[] = [];
  let windowStart = -1;
  let warmFrom = ready ? performance.now() : -1;
  let lastFrame = -1;
  let lastHud = 0;
  let hudDone = false;
  result.state = 'warming';

  const showHud = (now: number): void => {
    const lines = [title, `${drawer.kind === 'code' ? 'code-built' : 'model'} drawer, ${o.quality} quality, pixel ratio ${renderer.getPixelRatio()}`];
    if (result.state === 'done') {
      const i = result.interval;
      const f = (x: number): string => x.toFixed(1);
      lines.push(
        `Frame time: ${result.verdict} (p95 <= ${P95_MS} ms and max <= ${MAX_MS} ms, display at 60 Hz)`,
        `${result.frames} frames in ${o.seconds} s: interval p50 ${f(i.p50)}  p95 ${f(i.p95)}  p99 ${f(i.p99)}  max ${f(i.max)} ms`,
        `frame work mean ${f(result.work.mean)}  p95 ${f(result.work.p95)}  max ${f(result.work.max)} ms`,
        `ticks ${result.ticks} (clock ${result.clock.expectedTicks}, dropped ${result.clock.droppedTicks})`,
        `draw calls ${result.draw.frame.drawCalls}, triangles ${result.draw.frame.triangles}, lines ${result.draw.frame.lines}; terriers ${result.draw.terriers.drawCalls} calls, ${result.draw.perTerrier.triangles} triangles each`,
        `programs ${result.draw.programs.atStart} -> ${result.draw.programs.atEnd}`,
        result.env.renderer,
      );
    } else if (result.state === 'measuring') {
      lines.push(`measuring: ${((now - windowStart) / 1000).toFixed(0)} of ${o.seconds} s`);
    } else {
      lines.push(result.model.state === 'loading' ? 'loading the model…' : 'warming up…');
    }
    if (result.model.state === 'failed') lines.push(`model failed: ${result.model.error}`);
    hud.textContent = lines.join('\n');
  };

  const finish = (): void => {
    const iv = intervals(frameIntervals);
    result.frames = frameIntervals.length;
    result.interval = iv;
    result.work = spread(work);
    result.advance = spread(advanceCosts);
    result.pass = passes(iv, frameIntervals.length);
    result.verdict = result.pass ? 'PASS' : 'FAIL';
    const info = renderer.info;
    const counts = drawer.counts();
    const textures = sceneTextures(scene);
    result.draw.frame = {
      triangles: info.render.triangles, drawCalls: info.render.calls, lines: info.render.lines,
      bones: counts.bones, textures: info.memory.textures, textureBytes: bytesOf(textures), geometries: info.memory.geometries,
    };
    result.draw.terriers = {
      triangles: counts.triangles, drawCalls: counts.drawCalls, bones: counts.bones,
      textures: counts.textures, textureBytes: counts.textureBytes, geometries: counts.geometries,
    };
    result.draw.perTerrier = { triangles: counts.trianglesPerTerrier, bones: counts.bonesPerTerrier, textureBytes: counts.textureBytes, textureSize: counts.textureSize };
    result.draw.counts = counts;
    result.draw.programs.atEnd = info.programs?.length ?? 0;
    result.draw.memoryAtEnd = { geometries: info.memory.geometries, textures: info.memory.textures };
    // The terriers alone, counted by renderer.info: one pass of their layer.
    camera.layers.set(TERRIER_LAYER);
    renderer.render(scene, camera);
    result.draw.terrierPass = { drawCalls: info.render.calls, triangles: info.render.triangles };
    camera.layers.set(0);
    result.resources = resources();
    result.env.pixelRatio = renderer.getPixelRatio();
    result.env.canvas = { width: canvas.width, height: canvas.height };
    result.state = 'done';
  };

  const frame = (now: number): void => {
    const w0 = performance.now();
    if (pendingModel) {
      scene.remove(drawer.object);
      drawer.dispose();
      drawer = pendingModel;
      pendingModel = null;
      scene.add(drawer.object);
      result.drawer = 'model';
      result.model.state = 'ready';
      result.model.swapTick = curr.tick;
      ready = true;
    }
    if (ready && warmFrom < 0) warmFrom = w0;

    advanceTo(w0);
    const c = clockTicks(w0);
    const fraction = Math.min(1, Math.max(0, c - Math.floor(c)));
    const f = interpolate(prev, curr, prev.tick === curr.tick ? 1 : fraction);
    const dt = lastFrame < 0 ? 0 : (now - lastFrame) / 1000;
    drawer.draw(f);
    ball.draw(f, dt);
    shadows.draw(f);
    if (o.spectator) view.spectate(f);
    else view.update(f, 0, dt);
    // The net bulges where the last goal went in: pack 0 scores at +x.
    if (f.lastGoal) {
      const age = (f.time - f.lastGoal.tick) / TICK_RATE;
      const net = pitch.goalNets[f.lastGoal.pack === 0 ? 1 : 0];
      const other = pitch.goalNets[f.lastGoal.pack === 0 ? 0 : 1];
      other.scale.x = 1;
      net.scale.x = age < 0 || age > 1.5 ? 1 : 1 + (age < 0.12 ? 0.25 * (age / 0.12) : 0.25 * Math.exp(-(age - 0.12) / 0.3) * Math.cos((2 * Math.PI * (age - 0.12)) / 0.6));
    }
    renderer.render(scene, camera);

    if (result.state === 'warming' && warmFrom >= 0 && w0 - warmFrom >= o.warmup * 1000) {
      result.state = 'measuring';
      windowStart = now;
      result.draw.programs.atStart = renderer.info.programs?.length ?? 0;
      result.draw.memoryAtStart = { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
    } else if (result.state === 'measuring') {
      if (lastFrame >= 0) frameIntervals.push(now - lastFrame);
      work.push(performance.now() - w0);
      if (now - windowStart >= o.seconds * 1000) {
        // The clock and the source's tick, read together and then frozen.
        advanceTo(performance.now());
        const t = performance.now();
        result.clock.elapsedMs = t - t0;
        result.clock.expectedTicks = Math.floor(((t - t0) * TICK_RATE) / 1000);
        result.ticks = curr.tick - base;
        result.clock.advancedTicks = advanced;
        result.clock.droppedTicks = dropped;
        finish();
      }
    }
    if (result.state !== 'done') {
      result.ticks = curr.tick - base;
      result.clock.advancedTicks = advanced;
      result.clock.droppedTicks = dropped;
    }
    lastFrame = now;
    if (result.state === 'done') {
      if (!hudDone) showHud(now);
      hudDone = true;
    } else if (w0 - lastHud > 500) {
      showHud(now);
      lastHud = w0;
    }
    if (result.state === 'failed') clearInterval(timer);
    else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
