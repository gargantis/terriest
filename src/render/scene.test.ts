import { BoxGeometry, Group, InstancedMesh, MeshBasicMaterial, type Object3D, type Scene } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import type { DrawerFrame, TerrierDrawer } from './drawer';
import { PLACEHOLDER_LOOK } from './look';
import { qualityDetail } from './quality';
import { sceneStart, WALL_SCRUM } from '../core/sim/scenes';
import { defaultParams } from '../core/sim/params';
import { MatchView, type ViewTimeline } from './view';

// The stage's glue (M4's design §1.3, §2.1, §9.1), in Node over a fake
// renderer, since drawing itself is phase 1c's end-to-end spec's: prepare()
// compiles and then uploads by one render with every object shown, culling
// off and every instanced mesh at its full count, records firstFrame and
// hides its placeholders; a null frame draws the empty pitch; a match's
// frame reaches the ball, the shadows and the drawer; the buffer is
// round(CSS size × min(devicePixelRatio, cap) × scale); a disposed stage
// gives its context back, its watch removed first; and M1's
// createPitchView keeps its shape.

interface Rendered {
  readonly shown: string[];
  readonly instanced: Record<string, number>;
  readonly culled: number;
}

/** What the fake renderer saw: each render's shown objects, by name. */
const renders: Rendered[] = [];
const compiles: Scene[] = [];
const sizes: [number, number][] = [];
/** The scene's compile, held until the test lets it go; null: done at once. */
let holdCompile: Promise<void> | null = null;
/** What became of the contexts: each renderer's dispose and forced loss, and each watch's removal, in order. */
const ends: string[] = [];
/** Whether the fake's context is already lost, as a GPU reset would leave it. */
let lostAlready = false;

function fakeRenderer(): unknown {
  return {
    info: { render: { calls: 3, triangles: 900, lines: 50 }, memory: { geometries: 11, textures: 2 }, programs: [{}, {}, {}] },
    capabilities: { getMaxAnisotropy: () => 4 },
    setPixelRatio: (r: number) => expect(r).toBe(1),
    setSize: (w: number, h: number, style: boolean) => {
      expect(style).toBe(false);
      sizes.push([w, h]);
    },
    compileAsync: (scene: Scene) => {
      compiles.push(scene);
      return (holdCompile ?? Promise.resolve()).then(() => scene);
    },
    render: (scene: Scene) => {
      const shown: string[] = [];
      const instanced: Record<string, number> = {};
      let culled = 0;
      const walk = (o: Object3D): void => {
        if (!o.visible) return;
        if (o.name !== '') shown.push(o.name);
        if (o.frustumCulled && (o as { isMesh?: boolean }).isMesh === true) culled++;
        if ((o as InstancedMesh).isInstancedMesh === true) instanced[o.name] = (o as InstancedMesh).count;
        for (const c of o.children) walk(c);
      };
      walk(scene);
      renders.push({ shown, instanced, culled });
    },
    getContext: () => ({ SAMPLES: 0, getParameter: () => 0, isContextLost: () => lostAlready }),
    dispose: () => ends.push('dispose'),
    forceContextLoss: () => ends.push('lose'),
  };
}

vi.mock('./graphics', async (original) => ({
  ...(await original<typeof import('./graphics')>()),
  createRenderer: () => ({ renderer: fakeRenderer(), samples: 4 }),
  watchContext: () => () => ends.push('unwatch'),
}));

const { createPitchView, createStage } = await import('./scene');

/** A canvas of a CSS size, as far as the stage reads one. */
function canvas(width: number, height: number): HTMLCanvasElement {
  return { clientWidth: width, clientHeight: height, width: 0, height: 0, remove: vi.fn() } as unknown as HTMLCanvasElement;
}

/** A drawer that records its frames, its object one group holding an instanced part that draws none
 *  until a frame asks, as a real drawer's parts do. */
function recordingDrawer(frames: DrawerFrame[]): TerrierDrawer {
  const object = new Group();
  object.name = 'terriers';
  const part = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 8);
  part.name = 'parts';
  part.count = 0;
  object.add(part);
  return {
    kind: 'code', object,
    draw: (f) => frames.push(f),
    counts: () => ({ kind: 'code', terriers: frames.at(-1)?.terriers.length ?? 0 }) as ReturnType<TerrierDrawer['counts']>,
    compile: () => Promise.resolve(),
    dispose: () => object.removeFromParent(),
  };
}

beforeEach(() => {
  renders.length = 0;
  compiles.length = 0;
  sizes.length = 0;
  ends.length = 0;
  lostAlready = false;
  holdCompile = null;
  vi.stubGlobal('devicePixelRatio', 3);
  vi.stubGlobal('requestAnimationFrame', () => 0);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("M1's createPitchView, over the stage", () => {
  it('compiles, uploads by one render with every object shown, then draws the empty pitch, its figures as M1 read them', async () => {
    const c = canvas(640, 360);
    const view = createPitchView(c, 'high')!;
    await view.start();
    expect(compiles).toHaveLength(1);
    expect(renders).toHaveLength(2);
    const [upload, first] = [renders[0]!, renders[1]!];
    // The upload: the ball, its variant, the pitch's variants and every shadow, nothing culled.
    for (const name of ['ball', 'ball, dithered', 'walls, dithered', 'goal frames, dithered', 'overhead net, dithered']) {
      expect(upload.shown, name).toContain(name);
    }
    expect(upload.instanced['blob shadows']).toBe(2 * config.packSizeMax + 1);
    expect(upload.culled).toBe(0);
    // The empty pitch after it: no ball, no shadows, no variants, culling back on.
    expect(first.shown).not.toContain('ball');
    expect(first.shown.filter((n) => n.endsWith('dithered'))).toEqual([]);
    expect(first.instanced['blob shadows']).toBe(0);
    expect(first.culled).toBeGreaterThan(0);
    const info = view.info();
    expect(info).toMatchObject({
      frames: 1, quality: 'high', samples: 4, pixelRatio: 2, calls: 3, triangles: 900, lines: 50, programs: 3, geometries: 11, textures: 2,
      firstFrame: { programs: 3, geometries: 11, textures: 2 }, cap: 2, scale: 1, cssWidth: 640, cssHeight: 360, prepared: true,
      camera: { kind: 'overview', view: null, follow: null, calm: false, raised: false },
    });
    expect(sizes).toEqual([[1280, 720]]);
  });
});

describe('the stage (§1.3)', () => {
  const made: HTMLCanvasElement[] = [];
  beforeEach(() => {
    made.length = 0;
    vi.stubGlobal('document', { createElement: () => (made.push(canvas(641, 361)), made.at(-1)) });
  });

  it("draws a match's frame from the view: the ball, the shadows, the drawer's terriers and the camera, the projections for the overlay", async () => {
    const frames: DrawerFrame[] = [];
    const stage = createStage({ quality: 'low', look: PLACEHOLDER_LOOK, drawer: () => recordingDrawer(frames), capacity: 8, modelUrl: '' })!;
    expect(stage.canvas).toBe(made[0]);
    let readied = false;
    void stage.ready().then(() => (readied = true));
    await stage.prepare();
    expect(readied).toBe(true);
    // prepare() drew a full-capacity frame of placeholders, both packs, then none, itself, before any
    // frame; its upload drew every instanced part at its full count, then put them back.
    expect(frames[0]!.terriers.map((t) => t.pack)).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
    expect(frames.at(-1)!.terriers).toEqual([]);
    expect(renders).toHaveLength(1);
    expect(renders[0]!.instanced.parts).toBe(8);
    expect(stage.info().prepareMs).not.toBeNull();
    stage.draw(null);
    expect(renders.at(-1)!.instanced.parts).toBe(0);

    const s = sceneStart(WALL_SCRUM, defaultParams);
    const t: ViewTimeline = {
      started: true, id: 'a'.repeat(16), paused: false, head: s, prevHead: s, headTick: s.tick, localTick: s.tick,
      alpha: () => 0.5, clock: () => s.tick + 0.5, receivedInput: () => undefined, newestInput: () => undefined,
    };
    const barks = { update: () => [], pressed: () => {}, latest: () => null, reset: () => {} };
    const view = new MatchView({ me: s.terriers[0]!.id, paused: false, session: { timeline: t }, scoreboard: { goals: [] } }, PLACEHOLDER_LOOK, () => ({ calmCamera: true, names: false }), barks);
    view.run(0);
    const out = stage.draw(view.frame(0, 16));
    expect(frames.at(-1)!.terriers).toHaveLength(8);
    expect(renders.at(-1)!.shown).toContain('ball');
    expect(renders.at(-1)!.instanced['blob shadows']).toBe(9);
    expect(out.terriers.map((p) => p.id)).toEqual(s.terriers.map((T) => T.id));
    expect([out.cssWidth, out.cssHeight]).toEqual([641, 361]);
    expect(out.ball.inView).toBe(true);
    expect(stage.info().camera).toMatchObject({ kind: 'player', view: 'ball', follow: null, calm: true });
    // A spectator's camera, what it drew following: the ball, then a terrier (§9.4).
    view.mode = { kind: 'spectator', follow: null };
    stage.draw(view.frame(16, 16));
    expect(stage.info().camera).toMatchObject({ kind: 'spectator', view: null, follow: 'ball' });
    view.mode = { kind: 'spectator', follow: s.terriers[3]!.id };
    stage.draw(view.frame(32, 16));
    expect(stage.info().camera).toMatchObject({ kind: 'spectator', follow: s.terriers[3]!.id });
    // The low quality's cap of 1, at 641 × 361 CSS px.
    expect(sizes.at(-1)).toEqual([641, 361]);
    // The governor's scale: the buffer round(CSS size × min(devicePixelRatio, cap) × scale), clamped to 0.5.
    stage.setScale(0.75);
    stage.draw(null);
    // The empty pitch after a match's frame, as Play again's next Pre-match draws before its state: no ball,
    // no shadows, no terriers.
    expect(renders.at(-1)!.shown).not.toContain('ball');
    expect([renders.at(-1)!.instanced['blob shadows'], renders.at(-1)!.instanced.parts, frames.at(-1)!.terriers.length]).toEqual([0, 0, 0]);
    expect(stage.info().camera).toMatchObject({ kind: 'overview', follow: null, turnCap: null });
    expect(sizes.at(-1)).toEqual([Math.round(641 * 0.75), Math.round(361 * 0.75)]);
    expect(stage.info()).toMatchObject({ pixelRatio: 0.75, scale: 0.75, cap: qualityDetail('low').pixelRatioMax });
    stage.setScale(0.1);
    expect(stage.info().scale).toBe(config.drawingScaleMin);
    stage.dispose();
    expect(made[0]!.remove).toHaveBeenCalled();
  });

  it("resolves ready() only once the compile and the upload's render are done, so the pitch screen never draws before (§2.1)", async () => {
    let release!: () => void;
    holdCompile = new Promise<void>((resolve) => {
      release = resolve;
    });
    const frames: DrawerFrame[] = [];
    const stage = createStage({ quality: 'low', look: PLACEHOLDER_LOOK, drawer: () => recordingDrawer(frames), capacity: 8, modelUrl: '' })!;
    let readied = false;
    void stage.ready().then(() => (readied = true));
    const prepared = stage.prepare();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([readied, compiles.length, renders.length, stage.info().prepared]).toEqual([false, 1, 0, false]);
    release();
    await prepared;
    expect([readied, renders.length, stage.info().prepared]).toEqual([true, 1, true]);
    stage.dispose();
  });

  it("gives its context back when disposed, its watch removed first, so the canvas left holds no live context (§2.8)", async () => {
    const stage = createStage({ quality: 'high', look: PLACEHOLDER_LOOK, drawer: () => recordingDrawer([]), capacity: 8, modelUrl: '' })!;
    await stage.prepare();
    stage.dispose();
    // Lost after the watch went, so a phase-3 watcher never reports it as the context's own loss.
    expect(ends).toEqual(['unwatch', 'dispose', 'lose']);
    stage.dispose();
    expect(ends).toHaveLength(3);
    // A context a GPU reset already lost isn't lost again.
    ends.length = 0;
    lostAlready = true;
    createStage({ quality: 'low', look: PLACEHOLDER_LOOK, drawer: () => recordingDrawer([]), capacity: 8, modelUrl: '' })!.dispose();
    expect(ends).toEqual(['unwatch', 'dispose']);
  });
});
