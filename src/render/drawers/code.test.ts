import { type BufferGeometry, Color, type InstancedMesh, Matrix4, type MeshLambertMaterial, type Object3D, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { config } from '../../config';
import type { BarkEvent } from '../../core/session/index';
import { defaultParams } from '../../core/sim/params';
import { dribbleScene, sceneInputs, sceneStart } from '../../core/sim/scenes';
import {
  AIRBORNE, type AnimPhase, cloneState, GETTING_UP, LUNGING, type MatchState, NEVER, RUNNING, SITTING, STANDING, TUMBLED, ZOOMING,
} from '../../core/sim/state';
import { makeSim, step } from '../../core/sim/step';
import { type DrawerFrame, TERRIER_LAYER, type TerrierDrawer, type TerrierFrame } from '../drawer';
import { type Look, PLACEHOLDER_LOOK, type TerrierShape } from '../look';
import { type BarkSource, MatchView, type ViewTimeline } from '../view';
import { createCodeDrawer, terrierGeometries, triangleCount } from './code';
import { newPartMatrices, newPoseParams, poseParts, pushingWeight, rootMatrix, terrierPose } from './pose';

// The code-built drawer (M4's design §1.4, §2.11, §9.2; D-27, L310), in
// Node, as three's maths and geometry need no GPU: the spike's box of L310;
// the fit, no part inside a touching ball wherever one can meet the
// terrier, all round, from 31.6° to 90° on the floor and from −90° to 90°
// in the air, with the pushing pose held for config.pushPoseTicks and
// without it, in every phase and under every overlay, for the placeholder's
// shape and a chunkier sample's, as the look book's will be, and as the
// view draws a sustained push, at every fraction; the drawing budget's
// triangles and draw calls (config's budget settings); every coat and both
// packs painted, by index; the counts' overlays, drawing now and shown;
// and the pack cue.

const R_T = defaultParams.terrierRadius;
const R_B = defaultParams.ballRadius;
const TPS = config.ticksPerSecond;
const TIME = 6000;
const CAPACITY = 2 * config.packSizeMax;

function frame(over: Partial<TerrierFrame> = {}): TerrierFrame {
  return {
    id: 'terrier', pack: 0, coat: 0, mine: false, x: 0, y: 0, z: R_T, vx: 0, vy: 0, vz: 0,
    heading: 0, headingChange: 0, layers: [{ anim: STANDING, start: TIME, weight: 1 }], gait: 0,
    takeOffTick: NEVER, landingTick: NEVER, lastBallContactTick: NEVER, lastTerrierContactTick: NEVER,
    lastPushDir: 0, lastPushTick: NEVER, bark: null, celebrate: null, ...over,
  };
}

const drawerFrame = (terriers: readonly TerrierFrame[], time = TIME): DrawerFrame => ({ time, tick: Math.floor(time), fraction: time % 1, terriers });

// --- The posed terrier's vertices, in its own frame ---

interface Vertex { readonly p: Vector3; readonly part: string }

/** Every vertex of every part, for a terrier posed at the drawn time, its floor point the origin. */
function vertices(shape: TerrierShape, t: TerrierFrame, time = TIME): Vertex[] {
  const g = terrierGeometries(shape);
  const m = newPartMatrices();
  poseParts(new Matrix4(), terrierPose(t, time, shape, newPoseParams()), shape, m);
  const parts: [string, BufferGeometry, Matrix4[]][] = [
    ['body', g.body, [m.body]], ['head', g.head, [m.head]], ['snout', g.snout, [m.head]], ['jaw', g.snout, [m.jaw]], ['face', g.face, [m.head]],
    ['ear', g.ear, m.ears], ['leg', g.leg, m.legs], ['tail', g.tail, [m.tail]], ['bandana', g.bandanaPlain, [m.bandana]],
  ];
  const out: Vertex[] = [];
  for (const [part, geom, mats] of parts) {
    const pos = geom.getAttribute('position');
    for (const mat of mats) for (let i = 0; i < pos.count; i++) out.push({ p: new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat), part });
  }
  return out;
}

/** Where a ball touching the collider sits: `degrees` above the horizontal from the collider's centre, `azimuth`
 *  degrees round from the heading. */
function touching(degrees: number, azimuth: number): Vector3 {
  const a = (degrees * Math.PI) / 180;
  const b = (azimuth * Math.PI) / 180;
  const d = R_T + R_B;
  return new Vector3(d * Math.cos(a) * Math.cos(b), d * Math.cos(a) * Math.sin(b), R_T + d * Math.sin(a));
}

// D-4: a terrier on the floor touching a ball on the floor meets it 31.6° above the horizontal; higher contacts up to a
// ball on top of it, from every side. In the air, airborne or lunging, a ball meets it anywhere: level with it, as a
// jump meets one (L57), or below it.
const FLOOR_ELEVATIONS = [31.6, 35, 40, 45, 50, 55, 60, 70, 80, 90];
const AIR_ELEVATIONS = Array.from({ length: 37 }, (_, k) => 5 * k - 90);
type Ball = { readonly at: Vector3; readonly where: string };
const around = (elevations: readonly number[]): Ball[] =>
  elevations.flatMap((deg) => Array.from({ length: 24 }, (_, k) => ({ at: touching(deg, k * 15 - 180), where: `${deg}° up, ${k * 15 - 180}° round` })));
const FLOOR_BALLS = around(FLOOR_ELEVATIONS);
const AIR_BALLS = around(AIR_ELEVATIONS);
const COLLIDER = new Vector3(0, 0, R_T);

/** How far the posed terrier keeps out of a ball touching its collider anywhere among `balls`, metres (negative:
 *  inside it), and where. Only a vertex outside the collider can reach a ball that touches it. */
function clearance(shape: TerrierShape, t: TerrierFrame, time = TIME, balls: readonly Ball[] = FLOOR_BALLS): { metres: number; where: string } {
  const out = vertices(shape, t, time).filter((v) => v.p.distanceTo(COLLIDER) > R_T);
  let metres = Infinity;
  let where = 'nothing outside the collider';
  for (const b of balls) {
    for (const v of out) {
      const d = v.p.distanceTo(b.at) - R_B;
      if (d < metres) {
        metres = d;
        where = `the ${v.part}, ${b.where}`;
      }
    }
  }
  return { metres, where };
}

// The look book's samples (phase 4) join this list; a chunkier one stands in for them now.
const CHUNKY: TerrierShape = {
  ...PLACEHOLDER_LOOK.terrier,
  body: { centre: [-0.03, 0, 0.195], radii: [0.19, 0.12, 0.1] },
  neck: [0.1, 0, 0.29],
  head: { centre: [0.04, 0, 0.055], radius: 0.115 },
  legs: { ...PLACEHOLDER_LOOK.terrier.legs, length: 0.16, top: 0.16 },
  tail: { ...PLACEHOLDER_LOOK.terrier.tail, pivot: [-0.19, 0, 0.235] },
  bandana: { ...PLACEHOLDER_LOOK.terrier.bandana, centre: [0.075, 0, 0.27], radius: 0.082 },
};
const SHAPES: readonly [string, TerrierShape][] = [['the placeholder', PLACEHOLDER_LOOK.terrier], ['a chunkier sample', CHUNKY]];

const layer = (anim: AnimPhase, secondsAgo: number) => [{ anim, start: TIME - secondsAgo * TPS, weight: 1 }];

/** Every phase, a jump's both ways, at several times into it and, running and zooming, through the gait; with where a
 *  ball can meet it, on the floor or in the air. */
function* poses(): Generator<[string, Partial<TerrierFrame>, readonly Ball[]]> {
  const phases: [string, AnimPhase, Partial<TerrierFrame>][] = [
    ['standing', STANDING, {}], ['running', RUNNING, { vx: defaultParams.runSpeed }], ['zooming', ZOOMING, { vx: defaultParams.zoomiesSpeed }],
    ['rising', AIRBORNE, { vz: defaultParams.jumpSpeed }], ['falling', AIRBORNE, { vz: -defaultParams.jumpSpeed }], ['lunging', LUNGING, {}],
    ['tumbled', TUMBLED, {}], ['getting up', GETTING_UP, {}], ['sitting', SITTING, {}],
  ];
  for (const [name, anim, over] of phases) {
    for (const ago of [0, 0.1, 0.3, 0.6]) {
      const gaits = anim === RUNNING || anim === ZOOMING ? [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875] : [0];
      const balls = anim === AIRBORNE || anim === LUNGING ? AIR_BALLS : FLOOR_BALLS;
      for (const gait of gaits) yield [`${name} ${ago} s in, gait ${gait}`, { ...over, gait, layers: layer(anim, ago) }, balls];
    }
  }
}

/** The overlays a contact can come with: a bark, a celebration, a landing, a push from any side, a turn, and all. */
const OVERLAYS: readonly [string, Partial<TerrierFrame>][] = [
  ['nothing else', {}],
  ['a bark', { bark: { start: TIME - 6, weight: 1 } }],
  ['a celebration', { celebrate: { start: TIME - 12.6, weight: 1 } }],
  ['a landing', { landingTick: TIME - 5 }],
  ['a push from in front', { lastPushTick: TIME - 6, lastPushDir: Math.PI }],
  ['a push from behind', { lastPushTick: TIME - 6, lastPushDir: 0 }],
  ['a push from the side', { lastPushTick: TIME - 6, lastPushDir: Math.PI / 2 }],
  ['a turn', { headingChange: (2 * Math.PI * config.turnRateTurnsPerSecond) / TPS }],
  ['all of them', {
    bark: { start: TIME - 6, weight: 1 }, celebrate: { start: TIME - 12.6, weight: 1 }, landingTick: TIME - 5,
    lastPushTick: TIME - 1, lastPushDir: Math.PI * 0.75, headingChange: -0.2,
  }],
];

describe("the code-built terrier's shape (L310, D-4)", () => {
  it("fits L310's box round its collider while standing: 0.6 m long, 0.5 m wide and high, 0.3 m at the shoulder", () => {
    const v = vertices(PLACEHOLDER_LOOK.terrier, frame()).map((x) => x.p);
    const max = (f: (p: Vector3) => number): number => Math.max(...v.map(f));
    const min = (f: (p: Vector3) => number): number => Math.min(...v.map(f));
    const half = config.terrierLengthMetres / 2;
    // The spike's 5 mm for the nose's tip.
    expect(max((p) => p.x)).toBeLessThanOrEqual(half + 0.005);
    expect(min((p) => p.x)).toBeGreaterThanOrEqual(-half);
    expect(max((p) => Math.abs(p.y))).toBeLessThanOrEqual(R_T);
    expect(max((p) => p.z)).toBeLessThanOrEqual(2 * R_T);
    expect(min((p) => p.z)).toBeGreaterThanOrEqual(-0.001);
    const body = PLACEHOLDER_LOOK.terrier.body;
    expect(Math.abs(body.centre[2] + body.radii[2] - config.terrierShoulderHeightMetres)).toBeLessThanOrEqual(0.015);
  });
});

describe('the fit: no part of the drawn terrier inside a touching ball (D-27)', () => {
  for (const [name, shape] of SHAPES) {
    it(`keeps out of a ball touching it wherever one can, 31.6° to 90° on the floor and −90° to 90° in the air, in every phase and under every overlay, while its pushing pose holds: ${name}`, () => {
      let worst = { metres: Infinity, where: '' };
      for (const [what, pose, balls] of poses()) {
        for (const [overlay, over] of OVERLAYS) {
          for (const ago of [0, config.pushPoseTicks]) {
            const c = clearance(shape, frame({ ...pose, ...over, lastBallContactTick: TIME - ago }), TIME, balls);
            if (c.metres < worst.metres) worst = { metres: c.metres, where: `${what}, with ${overlay}, ${ago} ticks after the contact: ${c.where}` };
          }
        }
      }
      expect(worst.metres, `${(worst.metres * 100).toFixed(2)} cm clear at ${worst.where}`).toBeGreaterThanOrEqual(0);
    }, 60_000); // its own timeout: 4–5.5 s a shape in a loaded unit stage, past vitest's 5 s
  }

  it('would put its head in the ball without the pushing pose, which is why it holds one', () => {
    for (const [name, shape] of SHAPES) {
      for (const contact of [NEVER, TIME - config.pushPoseTicks - (config.animationBlendMs / 1000) * TPS]) {
        const c = clearance(shape, frame({ lastBallContactTick: contact }));
        expect(c.metres, `${name}: ${c.where}`).toBeLessThan(-0.03);
        expect(c.where).toMatch(/^the (head|snout|jaw|face), 31.6° up/);
      }
    }
  });

  it("finds a sample whose head is too far forward, as the look book's samples will be checked", () => {
    const forward: TerrierShape = { ...CHUNKY, head: { centre: [0.12, 0, 0.055], radius: 0.115 } };
    const c = clearance(forward, frame({ layers: layer(RUNNING, 0), vx: defaultParams.runSpeed, gait: 0.125, lastBallContactTick: TIME, lastPushTick: TIME - 6, lastPushDir: Math.PI / 2 }));
    expect(c.metres).toBeLessThan(0);
    expect(c.where).toMatch(/^the head/);
  });
});

describe('the pushing pose as the view draws a push held tick after tick (D-27, §2.2)', () => {
  /** Two heads set by hand, drawn at the fraction the test sets. */
  class Heads implements ViewTimeline {
    started = true;
    id = 'aaaaaaaaaaaaaaaa';
    paused = false;
    fraction = 0;
    prevHead: MatchState;
    head: MatchState;
    constructor(s: MatchState) {
      this.prevHead = s;
      this.head = s;
    }
    get headTick(): number {
      return this.head.tick;
    }
    get localTick(): number {
      return this.head.tick;
    }
    alpha(): number {
      return this.fraction;
    }
    clock(): number {
      return this.head.tick + this.fraction;
    }
    receivedInput(): number | undefined {
      return undefined;
    }
    newestInput(): undefined {
      return undefined;
    }
  }
  const noBarks: BarkSource = { update: (): readonly BarkEvent[] => [], pressed: () => {}, latest: () => null, reset: () => {} };
  const g = terrierGeometries(PLACEHOLDER_LOOK.terrier);

  /** How far every part of the drawn terrier keeps out of the drawn ball, metres. */
  function apart(t: TerrierFrame, time: number, ball: { x: number; y: number; z: number }): number {
    const shape = PLACEHOLDER_LOOK.terrier;
    const m = newPartMatrices();
    poseParts(rootMatrix(new Matrix4(), t, R_T), terrierPose(t, time, shape, newPoseParams()), shape, m);
    const parts: [BufferGeometry, Matrix4[]][] = [
      [g.body, [m.body]], [g.head, [m.head]], [g.snout, [m.head, m.jaw]], [g.face, [m.head]], [g.ear, m.ears], [g.leg, m.legs],
      [g.tail, [m.tail]], [g.bandanaPlain, [m.bandana]],
    ];
    const c = new Vector3(ball.x, ball.y, ball.z);
    let best = Infinity;
    for (const [geom, mats] of parts) {
      const pos = geom.getAttribute('position');
      for (const mat of mats) for (let i = 0; i < pos.count; i++) best = Math.min(best, new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat).distanceTo(c) - R_B);
    }
    return best;
  }

  for (const k of [1, 2]) {
    it(`holds it whole in every frame, at every fraction, with heads ${k} tick${k > 1 ? 's' : ''} apart, keeps the fit, and counts the push once`, () => {
      // A terrier dribbling the ball, touching it every tick (M2's scene): the head's contact tick is after the
      // drawn time from the fraction's half on, and at every fraction across a catch-up (§2.2).
      const scene = dribbleScene('ball', false);
      const s = sceneStart(scene, defaultParams);
      const sim = makeSim(defaultParams, scene.packSize);
      step(sim, s, sceneInputs(scene, s, s.tick + 1));
      const t = new Heads(cloneState(s));
      const me = s.terriers[0]!.id;
      const view = new MatchView({ me, paused: false, session: { timeline: t }, scoreboard: { goals: [] } }, PLACEHOLDER_LOOK, () => ({ calmCamera: false, names: false }), noBarks);
      const drawer = createCodeDrawer(PLACEHOLDER_LOOK, 2);
      let without = 0;
      let worst = Infinity;
      for (let run = 0; run < 60; run++) {
        const prev = cloneState(s);
        for (let j = 0; j < k; j++) step(sim, s, sceneInputs(scene, s, s.tick + 1));
        t.prevHead = prev;
        t.head = cloneState(s);
        view.run(run * 16);
        for (const f of [0, 0.25, 0.5, 0.75, 0.99]) {
          t.fraction = f;
          const frame = view.frame(run * 16, 16);
          const T = frame.drawer!.terriers.find((x) => x.id === me)!;
          drawer.draw(frame.drawer!);
          if (pushingWeight(T, frame.drawer!.time) < 1) without++;
          worst = Math.min(worst, apart(T, frame.drawer!.time, frame.match!.ball));
        }
      }
      expect(without, 'frames drawn without the whole pose').toBe(0);
      expect(worst, `${(worst * 100).toFixed(2)} cm clear of the drawn ball`).toBeGreaterThanOrEqual(0);
      expect(drawer.counts().overlaysShown.pushing, 'one push, held').toBe(1);
      drawer.dispose();
    });
  }
});

// --- The drawer ---

const looks = (packCue: Look['packCue']): Look => ({ ...PLACEHOLDER_LOOK, name: `cue ${packCue}`, packCue });

/** Eight terriers, both packs, each its own coat. */
const EIGHT = Array.from({ length: CAPACITY }, (_, i) => frame({ id: `t${i}`, pack: (i & 1) as 0 | 1, coat: i, x: i, y: -i }));

function parts(d: TerrierDrawer): Record<string, InstancedMesh> {
  const out: Record<string, InstancedMesh> = {};
  d.object.traverse((o: Object3D) => {
    if ((o as InstancedMesh).isInstancedMesh === true) out[o.name] = o as InstancedMesh;
  });
  return out;
}

const colourAt = (m: InstancedMesh, i: number): number => {
  const c = new Color();
  m.getColorAt(i, c);
  return c.getHex();
};

describe("the drawer's budget and painting (§2.11, D-27, L43, L44)", () => {
  it("draws eight terriers within config's budget, 2,000 triangles a terrier and 40 draw calls, with each pack cue or none", () => {
    for (const cue of ['none', 'marker', 'ring'] as const) {
      const d = createCodeDrawer(looks(cue), CAPACITY);
      d.draw(drawerFrame(EIGHT));
      const c = d.counts();
      expect(c.kind).toBe('code');
      expect(c.terriers).toBe(8);
      expect(c.trianglesPerTerrier, cue).toBeLessThanOrEqual(config.budgetCodeTrianglesPerTerrier);
      expect(c.triangles).toBe(8 * c.trianglesPerTerrier);
      expect(c.drawCalls, cue).toBeLessThanOrEqual(config.budgetDrawCalls);
      // The spike's nine instanced parts, and the cue's.
      expect(c.drawCalls).toBe(cue === 'none' ? 9 : 10);
      expect(c.geometries).toBe(cue === 'none' ? 9 : 10);
      expect([c.bones, c.textures, c.textureBytes, c.textureSize]).toEqual([0, 0, 0, '']);
      d.dispose();
    }
  });

  it('counts triangles as the geometries hold them, the jaw a second snout and the bandana the larger of its two', () => {
    const g = terrierGeometries(PLACEHOLDER_LOOK.terrier);
    expect(triangleCount(g.bandanaStriped)).toBe(triangleCount(g.bandanaPlain));
    expect(g.cue).toBeNull();
    const each = triangleCount(g.body) + triangleCount(g.head) + 2 * triangleCount(g.snout) + triangleCount(g.face) +
      2 * triangleCount(g.ear) + 4 * triangleCount(g.leg) + triangleCount(g.tail) + triangleCount(g.bandanaPlain);
    const d = createCodeDrawer(PLACEHOLDER_LOOK, CAPACITY);
    expect(d.counts().trianglesPerTerrier).toBe(each);
    d.dispose();
  });

  it('paints every coat and both packs by index, each part from its coat, each bandana in its pack\'s colour and pattern', () => {
    const look = PLACEHOLDER_LOOK;
    const d = createCodeDrawer(look, CAPACITY);
    d.draw(drawerFrame(EIGHT));
    expect(d.counts().coatsPainted).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(d.counts().packsPainted).toEqual([0, 1]);
    const M = parts(d);
    for (const [i, t] of EIGHT.entries()) {
      const coat = look.coats[t.coat]!;
      const marked = (part: string): number => (coat.markings === part ? coat.marking : coat.fur);
      expect(colourAt(M['terrier-body']!, i), `${coat.name}'s body`).toBe(new Color(marked('saddle')).getHex());
      expect(colourAt(M['terrier-ears']!, 2 * i), `${coat.name}'s ears`).toBe(new Color(coat.markings === 'none' || coat.markings === 'saddle' ? coat.fur : coat.marking).getHex());
      expect(colourAt(M['terrier-legs']!, 4 * i + 3), `${coat.name}'s legs`).toBe(new Color(marked('points')).getHex());
      expect(colourAt(M['terrier-snout']!, 2 * i + 1), `${coat.name}'s jaw`).toBe(colourAt(M['terrier-snout']!, 2 * i));
    }
    // Pack A plain, pack B striped (L43), four of each, in its colour.
    expect([M['terrier-bandana-plain']!.count, M['terrier-bandana-striped']!.count]).toEqual([4, 4]);
    for (let k = 0; k < 4; k++) {
      expect(colourAt(M['terrier-bandana-plain']!, k)).toBe(new Color(look.packs[0].colour).getHex());
      expect(colourAt(M['terrier-bandana-striped']!, k)).toBe(new Color(look.packs[1].colour).getHex());
    }
    d.dispose();
  });

  it('paints a coat outside the list as coat 0, and counts the coats and packs of the frame drawn last', () => {
    const d = createCodeDrawer(PLACEHOLDER_LOOK, CAPACITY);
    d.draw(drawerFrame([frame({ coat: config.coatCount, pack: 1 }), frame({ id: 'b', coat: 3 })]));
    expect(d.counts().coatsPainted).toEqual([0, 3]);
    expect(colourAt(parts(d)['terrier-head']!, 0)).toBe(new Color(PLACEHOLDER_LOOK.coats[0]!.fur).getHex());
    // prepare()'s full frame of placeholders, then an empty one, as the stage draws them: nothing left behind.
    d.draw(drawerFrame(EIGHT));
    d.draw(drawerFrame([]));
    const c = d.counts();
    expect([c.terriers, c.coatsPainted, c.packsPainted, c.drawCalls]).toEqual([0, [], [], 0]);
    d.dispose();
  });

  it('puts every part on the terriers\' layer, never culled, its instance colours made before its first frame', () => {
    const d = createCodeDrawer(looks('marker'), CAPACITY);
    const M = parts(d);
    expect(Object.keys(M).sort()).toEqual([
      'terrier-bandana-plain', 'terrier-bandana-striped', 'terrier-body', 'terrier-cue', 'terrier-ears', 'terrier-face', 'terrier-head',
      'terrier-legs', 'terrier-snout', 'terrier-tail',
    ]);
    for (const [name, m] of Object.entries(M)) {
      expect(m.layers.isEnabled(TERRIER_LAYER), name).toBe(true);
      expect(m.frustumCulled, name).toBe(false);
      // So the program prepare() compiles is the one each frame draws with (PLAN §12: nothing compiles in play).
      expect(m.instanceColor !== null, name).toBe(name !== 'terrier-face');
    }
    const perTerrier = { 'terrier-snout': 2, 'terrier-ears': 2, 'terrier-legs': 4 } as Record<string, number>;
    for (const [name, m] of Object.entries(M)) expect(m.instanceMatrix.count, name).toBe(CAPACITY * (perTerrier[name] ?? 1));
    d.draw(drawerFrame(EIGHT.slice(0, 3)));
    expect([M['terrier-snout']!.count, M['terrier-ears']!.count, M['terrier-legs']!.count, M['terrier-cue']!.count]).toEqual([6, 6, 12, 3]);
    d.dispose();
  });

  it("draws each part at its pose's matrix, the jaw the snout's second instance, hung open while it barks", () => {
    const d = createCodeDrawer(PLACEHOLDER_LOOK, CAPACITY);
    const t = frame({ x: 3, y: -1, heading: 0.7, bark: { start: TIME - 6, weight: 1 } });
    d.draw(drawerFrame([frame({ id: 'other' }), t]));
    const want = newPartMatrices();
    const shape = PLACEHOLDER_LOOK.terrier;
    poseParts(rootMatrix(new Matrix4(), t, R_T), terrierPose(t, TIME, shape, newPoseParams()), shape, want);
    const at = (name: string, i: number): Matrix4 => {
      const m = new Matrix4();
      parts(d)[name]!.getMatrixAt(i, m);
      return m;
    };
    // An instance matrix holds 32-bit floats.
    const same = (a: Matrix4, b: Matrix4): boolean => a.elements.every((v, k) => Math.abs(v - b.elements[k]!) < 1e-6);
    expect(same(at('terrier-head', 1), want.head)).toBe(true);
    expect(same(at('terrier-snout', 2), want.head)).toBe(true);
    expect(same(at('terrier-snout', 3), want.jaw)).toBe(true);
    expect(same(want.jaw, want.head), 'the jaw open, apart from the snout').toBe(false);
    expect(same(at('terrier-legs', 4 + 3), want.legs[3])).toBe(true);
    d.dispose();
  });

  it('draws no more terriers than its capacity', () => {
    const d = createCodeDrawer(PLACEHOLDER_LOOK, 2);
    d.draw(drawerFrame(EIGHT));
    expect(d.counts().terriers).toBe(2);
    expect(parts(d)['terrier-legs']!.count).toBe(8);
    d.dispose();
  });
});

describe("the counts' overlays: drawing now, and shown since the drawer was made (§1.2, §9.1)", () => {
  it('counts a bark once by its start, however many frames it plays in, and the next by its own', () => {
    const d = createCodeDrawer(PLACEHOLDER_LOOK, CAPACITY);
    const barking = (start: number | null): TerrierFrame => frame({ bark: start === null ? null : { start, weight: 1 } });
    for (const time of [TIME, TIME + 1, TIME + 2]) d.draw(drawerFrame([barking(TIME - 1)], time));
    expect(d.counts().overlays.barking).toBe(1);
    expect(d.counts().overlaysShown.barking).toBe(1);
    d.draw(drawerFrame([barking(null)], TIME + 30));
    expect(d.counts().overlays.barking).toBe(0);
    d.draw(drawerFrame([barking(TIME + 60)], TIME + 61));
    expect(d.counts().overlaysShown.barking).toBe(2);
    // A bark not yet started at the drawn time isn't shown.
    d.draw(drawerFrame([barking(TIME + 200)], TIME + 100));
    expect(d.counts().overlays.barking).toBe(0);
    expect(d.counts().overlaysShown.barking).toBe(2);
    d.dispose();
  });

  it("counts a bark and a celebration once by their starts though a frame a tick back shows them again, and again at those starts in the stage's next match, its ticks from 0 again; and a showing the pose hides a while once", () => {
    const d = createCodeDrawer(PLACEHOLDER_LOOK, CAPACITY);
    const bark = { start: 18, weight: 1 };
    const cheer = { start: 900, weight: 1 };
    // One match: the bark over three frames, the celebration over two. Each is over in a frame that hands it
    // none and shown again in one a tick back, as a stall or a clock jump draws it: the same showing.
    for (const time of [18.4, 19, 20]) d.draw(drawerFrame([frame({ bark })], time));
    d.draw(drawerFrame([frame()], 42));
    d.draw(drawerFrame([frame({ bark })], 41));
    for (const time of [900.5, 901]) d.draw(drawerFrame([frame({ celebrate: cheer })], time));
    d.draw(drawerFrame([frame()], 1020));
    d.draw(drawerFrame([frame({ celebrate: cheer })], 1019));
    d.draw(drawerFrame([frame()], 1100));
    expect(d.counts().overlaysShown).toMatchObject({ barking: 1, celebrating: 1 });
    // The next match on the stage, from its own tick 0, the stage drawing no terriers first: the same terrier's
    // bark and celebration at the same starts.
    d.draw(drawerFrame([], 0));
    for (const time of [0.5, 10]) d.draw(drawerFrame([frame()], time));
    for (const time of [18.6, 19.5]) d.draw(drawerFrame([frame({ bark })], time));
    d.draw(drawerFrame([frame({ celebrate: cheer })], 900.2));
    expect(d.counts().overlaysShown).toMatchObject({ barking: 2, celebrating: 2 });
    // Still handed while a tumble hides it, then shown again: the same showing.
    d.draw(drawerFrame([frame({ celebrate: cheer, layers: [{ anim: TUMBLED, start: 900, weight: 1 }] })], 901));
    expect(d.counts().overlays.celebrating).toBe(0);
    d.draw(drawerFrame([frame({ celebrate: cheer })], 902));
    expect(d.counts().overlaysShown).toMatchObject({ barking: 2, celebrating: 2 });
    d.dispose();
  });

  it('counts a celebration only where the pose shows it, over standing or running', () => {
    const d = createCodeDrawer(PLACEHOLDER_LOOK, CAPACITY);
    const cheer = { start: TIME - 10, weight: 1 };
    d.draw(drawerFrame([frame({ id: 'a', celebrate: cheer }), frame({ id: 'b', celebrate: cheer, layers: layer(TUMBLED, 0.5) })]));
    expect(d.counts().overlays.celebrating).toBe(1);
    expect(d.counts().overlaysShown.celebrating).toBe(1);
    d.draw(drawerFrame([frame({ id: 'a', celebrate: cheer }), frame({ id: 'b', celebrate: cheer, layers: layer(STANDING, 0) })], TIME + 1));
    expect(d.counts().overlays.celebrating).toBe(2);
    expect(d.counts().overlaysShown.celebrating).toBe(2);
    d.dispose();
  });

  it('counts each push once as it begins, from a contact with the ball or a terrier', () => {
    const d = createCodeDrawer(PLACEHOLDER_LOOK, CAPACITY);
    for (let k = 0; k < 5; k++) d.draw(drawerFrame([frame({ lastBallContactTick: TIME + k })], TIME + k));
    expect(d.counts().overlays.pushing).toBe(1);
    expect(d.counts().overlaysShown.pushing).toBe(1);
    d.draw(drawerFrame([frame({ lastBallContactTick: TIME + 4 })], TIME + 40));
    expect(d.counts().overlays.pushing).toBe(0);
    d.draw(drawerFrame([frame({ lastTerrierContactTick: TIME + 50 })], TIME + 50));
    expect(d.counts().overlaysShown.pushing).toBe(2);
    d.dispose();
  });

  it("counts nothing for prepare()'s placeholders, which carry no overlay or contact", () => {
    const d = createCodeDrawer(PLACEHOLDER_LOOK, CAPACITY);
    d.draw(drawerFrame(EIGHT, 0));
    d.draw(drawerFrame([], 0));
    expect(d.counts().overlaysShown).toEqual({ barking: 0, celebrating: 0, pushing: 0 });
    d.dispose();
  });
});

describe('the pack cue (Q-11, C-51)', () => {
  const cueMatrix = (d: TerrierDrawer, i: number): Matrix4 => {
    const m = new Matrix4();
    parts(d)['terrier-cue']!.getMatrixAt(i, m);
    return m;
  };

  it("stands a marker over each terrier's head, upright for pack A and turned over for pack B, in its pack's colour", () => {
    const d = createCodeDrawer(looks('marker'), CAPACITY);
    d.draw(drawerFrame([frame({ x: 2, y: 3, z: R_T + 1 }), frame({ id: 'b', pack: 1, x: -1 })]));
    // An instance matrix holds 32-bit floats.
    const a = new Vector3().setFromMatrixPosition(cueMatrix(d, 0));
    expect(a.distanceTo(new Vector3(2, 3, 1 + 0.72))).toBeLessThan(1e-6);
    // Its z axis: up for pack A, down for pack B; a rotation, never a mirror, so its faces still face out.
    expect(cueMatrix(d, 0).elements[10]).toBe(1);
    expect(cueMatrix(d, 1).elements[10]).toBeCloseTo(-1, 6);
    expect(cueMatrix(d, 1).determinant()).toBeCloseTo(1, 6);
    expect(colourAt(parts(d)['terrier-cue']!, 1)).toBe(new Color(PLACEHOLDER_LOOK.packs[1].colour).getHex());
    d.dispose();
  });

  it('lays a ring round each terrier on the floor, even in the air', () => {
    const d = createCodeDrawer(looks('ring'), CAPACITY);
    d.draw(drawerFrame([frame({ x: 2, y: 3, z: R_T + 1 })]));
    const p = new Vector3().setFromMatrixPosition(cueMatrix(d, 0));
    expect([p.x, p.y]).toEqual([2, 3]);
    expect(p.z).toBeGreaterThan(0);
    expect(p.z).toBeLessThan(0.05);
    d.dispose();
  });

  it('grows a far cue in its vertex hook, squaring a turned-over ring, under one constant program key each', () => {
    const shader = (): { vertexShader: string } => ({ vertexShader: 'void main() {\n#include <begin_vertex>\n#include <project_vertex>\n}' });
    for (const cue of ['marker', 'ring'] as const) {
      const d = createCodeDrawer(looks(cue), CAPACITY);
      const material = parts(d)['terrier-cue']!.material as MeshLambertMaterial;
      const s = shader();
      material.onBeforeCompile(s as never, undefined as never);
      expect(s.vertexShader).not.toContain('#include <project_vertex>');
      expect(s.vertexShader).toContain('terriestCueGrowth');
      expect(s.vertexShader).toContain('gl_Position = projectionMatrix * mvPosition;');
      expect(s.vertexShader.includes('terriestCueEdge'), cue).toBe(cue === 'ring');
      expect(material.customProgramCacheKey()).toBe(`terriest cue ${cue}`);
      d.dispose();
    }
  });
});

describe("the drawer's life", () => {
  it('compiles its programs against the scene it joins, and disposes of everything it made', async () => {
    const d = createCodeDrawer(looks('ring'), CAPACITY);
    const compileAsync = vi.fn(() => Promise.resolve());
    const camera = {} as never;
    const scene = {} as never;
    await d.compile({ compileAsync } as never, camera, scene);
    expect(compileAsync).toHaveBeenCalledWith(d.object, camera, scene);
    const disposed: string[] = [];
    for (const m of Object.values(parts(d))) {
      m.geometry.addEventListener('dispose', () => disposed.push(`${m.name} geometry`));
      (m.material as MeshLambertMaterial).addEventListener('dispose', () => disposed.push(`${m.name} material`));
    }
    const parent = { remove: vi.fn() };
    d.object.parent = parent as never;
    d.dispose();
    expect(disposed.filter((s) => s.endsWith('geometry'))).toHaveLength(10);
    expect(new Set(disposed.filter((s) => s.endsWith('material')))).toHaveLength(10);
    expect(parent.remove).toHaveBeenCalledWith(d.object);
  });
});
