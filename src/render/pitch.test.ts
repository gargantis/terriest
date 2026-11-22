import { describe, expect, it } from 'vitest';
import { type BufferGeometry, Color, type LineSegments, type Material, type Mesh, type ShaderMaterial, Vector3 } from 'three';
import { GOAL_NET, insideFloorPlan, pitch, type Point } from '../core/sim/pitch';
import { setFade } from './fade';
import { type Face, nettingShown } from './goal-fade';
import { type Look, PLACEHOLDER_LOOK } from './look';
import { drawPitch } from './pitch';
import { Shadows } from './shadows';

// The empty pitch as drawn from the simulation's pieces (PLAN §12, D-4,
// L68), checked on its geometry, without a GPU: M1's, with M4's look
// (M4's design §1.11, §1.18), its parts apart, each occluder's other
// variant (§2.6), and from C-57 the glass walls, the ground beyond them and
// the goals giving way: their parts and draws, the transparent things'
// order and the netting's faces.
const detail = { ropeSpacingMetres: 1, nettingSpacingMetres: 0.25, anisotropy: 1 };
const drawn = drawPitch(pitch, detail, PLACEHOLDER_LOOK);
const PACKS = PLACEHOLDER_LOOK.packs;
const part = (name: string, d = drawn): BufferGeometry => (d.object.getObjectByName(name) as Mesh).geometry;
const materialOf = (name: string, d = drawn): Material => (d.object.getObjectByName(name) as Mesh).material as Material;
/** The pitch's parts that draw, by name, for a camera at (x, y, z). */
const shownFor = (x: number, y: number, z: number, d = drawn): string[] => {
  d.setFade(new Vector3(x, y, z));
  return d.object.children.filter((o) => o.visible).map((o) => o.name);
};

interface Triangle {
  area: number;
  /** The centre's x. */
  x: number;
  colour: string;
}

function triangles(g: BufferGeometry): Triangle[] {
  const p = g.getAttribute('position');
  const c = g.getAttribute('color');
  const out: Triangle[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const [ax, ay, bx, by, cx, cy] = [p.getX(i), p.getY(i), p.getX(i + 1), p.getY(i + 1), p.getX(i + 2), p.getY(i + 2)];
    out.push({
      area: ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2,
      x: (ax + bx + cx) / 3,
      colour: [c.getX(i), c.getY(i), c.getZ(i)].map((v) => v.toFixed(5)).join(' '),
    });
  }
  return out;
}

/** Each vertex colour of a part, as hex. */
function colours(g: BufferGeometry): Set<string> {
  const c = g.getAttribute('color');
  const out = new Set<string>();
  for (let i = 0; i < c.count; i++) out.add(new Color(c.getX(i), c.getY(i), c.getZ(i)).getHexString());
  return out;
}

/** A part's mean vertex colour over its vertices with x on one side of the halfway line. */
function meanColour(g: BufferGeometry, side: -1 | 1): [number, number, number] {
  const p = g.getAttribute('position');
  const c = g.getAttribute('color');
  let [red, green, blue, n] = [0, 0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    if (Math.sign(p.getX(i)) !== side) continue;
    red += c.getX(i);
    green += c.getY(i);
    blue += c.getZ(i);
    n++;
  }
  return [red / n, green / n, blue / n];
}

const shoelace = (points: readonly Point[]): number =>
  points.reduce((s, [x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length]!;
    return s + (x * ny - nx * y) / 2;
  }, 0);

describe('the drawn pitch', () => {
  it("covers the floor plan and both goals' floors, once, facing up", () => {
    const floor = triangles(part('floor'));
    const expected = shoelace(pitch.outline) + shoelace(pitch.goals[0].floor) + shoelace(pitch.goals[1].floor);
    // Counter-clockwise from above, so every area is positive: none face down.
    expect(Math.min(...floor.map((t) => t.area))).toBeGreaterThan(0);
    expect(floor.reduce((s, t) => s + t.area, 0)).toBeCloseTo(expected, 6);
  });

  it('gives each half the pattern of the pack that defends it (L68)', () => {
    expect(PACKS.map((p) => p.pattern)).toEqual(['plain', 'striped']);
    const floor = triangles(part('floor'));
    // Pack A's half, plain: one colour.
    expect(new Set(floor.filter((t) => t.x < 0).map((t) => t.colour)).size).toBe(1);
    // Pack B's, striped: two colours, alternating in 2 m bands across the pitch.
    const b = floor.filter((t) => t.x > 0);
    const byBand = new Map<number, Set<string>>();
    for (const t of b) byBand.set(Math.floor(t.x / 2), (byBand.get(Math.floor(t.x / 2)) ?? new Set()).add(t.colour));
    expect(new Set(b.map((t) => t.colour)).size).toBe(2);
    for (const [band, colours] of byBand) {
      expect(colours.size, `band ${band}`).toBe(1);
      expect(byBand.get(band + 1)?.has([...colours][0]!) ?? false, `bands ${band} and ${band + 1}`).toBe(false);
    }
  });

  it("keeps the overhead ropes over the floor plan, at the net's height", () => {
    const p = part('overhead net').getAttribute('position');
    let ropes = 0;
    for (let i = 0; i < p.count; i++) {
      expect(p.getZ(i)).toBe(pitch.shape.heightMetres);
      ropes++;
      expect(insideFloorPlan(pitch.shape, p.getX(i), p.getY(i), -1e-9), `${p.getX(i)}, ${p.getY(i)}`).toBe(true);
    }
    // Ropes 1 m apart, half a metre off the centre lines: 40 across the length and 28 along it, two ends each.
    expect(ropes).toBe((40 + 28) * 2);
    // The goals' netting is a part of its own, none of it at the net's height.
    const n = part('goal netting').getAttribute('position');
    for (let i = 0; i < n.count; i++) expect(n.getZ(i)).toBeLessThanOrEqual(pitch.shape.mouthHeightMetres);
  });

  it("draws in eight parts with the camera inside every pane's plane, and a ninth, the glass's outer draw, outside one (C-57)", () => {
    const inside = ['floor', 'markings', 'ground', 'rail', 'glass, inner', 'goal frames', 'overhead net', 'goal netting'];
    // Before any frame, none: a frame decides.
    const fresh = drawPitch(pitch, detail, PLACEHOLDER_LOOK);
    expect([fresh.object.children.filter((o) => o.visible).map((o) => o.name), fresh.outerGlass]).toEqual([inside, false]);
    fresh.dispose();
    // A player's camera on the pitch, and the overview's place, above the net beyond the near side wall.
    expect(shownFor(-5, 3, 2.1)).toEqual(inside);
    expect(drawn.outerGlass).toBe(false);
    expect(shownFor(0, -28.3, 33.1)).toEqual([...inside, 'glass, outer']);
    expect(drawn.outerGlass).toBe(true);
    // Behind a goal, and beside one beyond its line: outside the end wall's plane.
    expect(shownFor(-24, 0, 2.1)).toEqual([...inside, 'glass, outer']);
    expect(shownFor(21, -6, 2.1)).toEqual([...inside, 'glass, outer']);
    // Within a centimetre of a pane's plane, where the shader's float32 may take the camera as outside, it draws.
    expect(shownFor(0, -13.995, 2.1)).toEqual([...inside, 'glass, outer']);
    expect(shownFor(0, -13.98, 2.1)).toEqual(inside);
    // No padded walls: nothing opaque stands where the walls are.
    expect(drawn.object.getObjectByName('walls')).toBeUndefined();
  });

  it("counts: the glass's 28 panes in 56 triangles, the rail's 168 and the ground's 856, on 8 geometries (C-57)", () => {
    const triangles = (name: string): number => part(name).getAttribute('position').count / 3;
    expect(triangles('glass, inner')).toBe(56);
    // Both of the glass's draws are one geometry and one program: two materials of one shader, its draw a uniform.
    expect(part('glass, outer')).toBe(part('glass, inner'));
    const [inner, outer] = [materialOf('glass, inner'), materialOf('glass, outer')] as ShaderMaterial[];
    expect([outer!.vertexShader, outer!.fragmentShader]).toEqual([inner!.vertexShader, inner!.fragmentShader]);
    expect([inner!.uniforms['outer']!.value, outer!.uniforms['outer']!.value]).toEqual([0, 1]);
    // The rail: 12 wall pieces' tops, the side walls' split at the halfway line, 6 quads each.
    expect(triangles('rail')).toBe(14 * 12);
    // The ground: the apron round the footprint's 16 corners (4 + 16 + 2 − 2), the outfield round it (64 + 4 + 2 − 2),
    // and 6 rings of 64 segments.
    expect(triangles('ground')).toBe(20 + 68 + 6 * 64 * 2);
    const geometries = new Set<BufferGeometry>();
    drawn.object.traverse((o) => {
      if ((o as Mesh).geometry !== undefined) geometries.add((o as Mesh).geometry);
    });
    expect(geometries.size).toBe(8);
  });
});

describe("the transparent things' order (C-57)", () => {
  it('draws the inner glass first, then the goal frames, the netting, the blob shadows, and the outer glass last', () => {
    const shadows = new Shadows(8);
    const order = (name: string): number => drawn.object.getObjectByName(name)!.renderOrder;
    expect([order('glass, inner'), order('goal frames'), order('goal frames, dithered'), order('goal netting'), shadows.mesh.renderOrder, order('glass, outer')])
      .toEqual([-3, -2, -2, -1, 1, 2]);
    shadows.dispose();
    // Each of them transparent; the glass and the netting write no depth, and the frames still do, so what's behind a
    // solid post stays hidden. The opaque parts stay opaque, at 0.
    for (const name of ['glass, inner', 'glass, outer', 'goal frames', 'goal netting']) expect(materialOf(name).transparent, name).toBe(true);
    expect(['glass, inner', 'glass, outer', 'goal frames', 'goal netting'].map((n) => materialOf(n).depthWrite)).toEqual([false, false, true, false]);
    for (const name of ['floor', 'markings', 'ground', 'rail', 'overhead net']) {
      expect([materialOf(name).transparent, order(name)], name).toEqual([false, 0]);
    }
  });
});

describe("the goals' netting faces (C-57)", () => {
  /** Each goal's faces, as the netting's vertices carry them, with how many vertices carry each. */
  function faces(): Map<string, { face: Face; side: number; vertices: number }> {
    const g = part('goal netting');
    const p = g.getAttribute('position');
    const f = g.getAttribute('face');
    const out = new Map<string, { face: Face; side: number; vertices: number }>();
    for (let i = 0; i < p.count; i++) {
      const face: Face = [f.getX(i), f.getY(i), f.getZ(i), f.getW(i)];
      const side = Math.sign(p.getX(i));
      const key = `${side} ${face.join(' ')}`;
      out.set(key, { face, side, vertices: (out.get(key)?.vertices ?? 0) + 1 });
    }
    return out;
  }

  it("carries each netting line's face, the simulation's piece's plane, at both its ends", () => {
    const all = [...faces().values()];
    // Each goal's back, two sides and top.
    expect(all).toHaveLength(2 * 4);
    const pieces = pitch.pieces.filter((q) => q.surface === GOAL_NET);
    for (const q of pieces) {
      const offset = q.ox * q.nx + q.oy * q.ny + q.oz * q.nz;
      expect(all.some((a) => a.side === Math.sign(q.ox) && a.face.every((v, k) => Math.abs(v - [q.nx, q.ny, q.nz, offset][k]!) < 1e-6)), q.name).toBe(true);
    }
    for (const a of all) expect(a.vertices % 2, a.face.join(' ')).toBe(0);
  });

  it("drops the faces the camera is outside of once it's beyond the goal line, and keeps every face in front of it", () => {
    const shown = (x: number, y: number, z: number): string[] =>
      [...faces().values()].filter((a) => nettingShown(a.face, a.side, pitch.goalLineX, x, y, z) > 0.5).map((a) => `${a.side < 0 ? '−x' : '+x'} ${name(a.face)}`).sort();
    const name = (f: Face): string => (f[0] !== 0 ? 'back' : f[2] !== 0 ? 'top' : f[1] > 0 ? 'side −y' : 'side +y');
    const every = ['−x back', '−x side −y', '−x side +y', '−x top', '+x back', '+x side −y', '+x side +y', '+x top'].sort();
    // In front of both goal lines, wherever the camera is, behind a goal's line or not: every face.
    for (const [x, y, z] of [[0, 0, 2.1], [-19.6, 0, 2.1], [19, -6, 5.6], [-19.9, -12, 0.4]]) expect(shown(x!, y!, z!), `${x}, ${y}, ${z}`).toEqual(every);
    // Behind the −x goal's back: its back goes, the rest stays.
    expect(shown(-24, 0, 2.1)).toEqual(every.filter((f) => f !== '−x back'));
    // Beside the +x goal beyond its line, outside its −y side: that side goes.
    expect(shown(21, -6, 2.1)).toEqual(every.filter((f) => f !== '+x side −y'));
    // Above the −x goal's top, beyond its line: the top goes; and behind and above it, the back as well.
    expect(shown(-21, 0, 4)).toEqual(every.filter((f) => f !== '−x top'));
    expect(shown(-23, 0, 4)).toEqual(every.filter((f) => f !== '−x top' && f !== '−x back'));
    // Inside the goal, outside none of its faces: every face.
    expect(shown(-21, 0, 2)).toEqual(every);
    // It fades over the first half metre past the line and the first half metre outside the face, not at once.
    const back = [...faces().values()].find((a) => a.side < 0 && a.face[0] !== 0)!;
    expect(nettingShown(back.face, back.side, pitch.goalLineX, -22.25, 0, 2.1)).toBeCloseTo(0.5, 6);
    expect(nettingShown(back.face, back.side, pitch.goalLineX, -24, 0, 2.1)).toBe(0);
  });
});

describe("the pitch in a look's colours (M4)", () => {
  // Pack A green and striped, pack B purple and plain; every pitch colour its own.
  const look: Look = {
    ...PLACEHOLDER_LOOK,
    name: 'test',
    packs: [{ name: 'green', colour: 0x22aa44, pattern: 'striped' }, { name: 'purple', colour: 0x8844cc, pattern: 'plain' }],
    pitch: { sky: 0x000001, grass: 0x406030, line: 0xffff00, wallPanel: 0x123456, rope: 0x654321, netting: 0xabcdef, apron: 0x998877, outfield: 0x335511 },
  };
  const other = drawPitch(pitch, detail, look);

  it("tints each half and its goal by its pack's colour and pattern", () => {
    const floor = triangles(part('floor', other));
    expect(new Set(floor.filter((t) => t.x < 0).map((t) => t.colour)).size, "pack A's striped half").toBe(2);
    expect(new Set(floor.filter((t) => t.x > 0).map((t) => t.colour)).size, "pack B's plain half").toBe(1);
    const [a, b] = [meanColour(part('floor', other), -1), meanColour(part('floor', other), 1)];
    expect(a[1] - b[1], 'the green pack\'s half the greener').toBeGreaterThan(0.01);
    expect(b[2] - a[2], 'the purple pack\'s half the bluer').toBeGreaterThan(0.01);
  });

  it("draws the lines and the ropes in the look's colours, the netting tinted by its pack", () => {
    expect([...colours(part('markings', other))]).toEqual(['ffff00']);
    expect([...colours(part('overhead net', other))]).toEqual(['654321']);
    const netting = [meanColour(part('goal netting', other), -1), meanColour(part('goal netting', other), 1)];
    expect(netting[0]![1] - netting[1]![1], "pack A's goal the greener").toBeGreaterThan(0.01);
    // And nothing of the placeholder's in it.
    for (const name of ['markings', 'overhead net']) {
      expect(colours(part(name, other)).has(new Color(PLACEHOLDER_LOOK.pitch.wallPanel).getHexString()), name).toBe(false);
    }
  });

  it("draws the glass in the look's panel colour, its band and rail in each half's pack colour, and the ground in its apron, outfield and sky (C-57)", () => {
    const uniform = (name: string, key: string): string => ((materialOf(name, other) as ShaderMaterial).uniforms[key]!.value as Color).getHexString();
    const hex = (a: number, b: number, t: number): string => new Color(a).lerp(new Color(b), t).getHexString();
    for (const draw of ['glass, inner', 'glass, outer']) {
      // The tint, the panel colour with half the sky; the sheen, the posts and the line, it with white.
      expect(['tint', 'sheen', 'postColour', 'lineColour'].map((k) => uniform(draw, k)), draw)
        .toEqual([hex(0x123456, 0x000001, 0.5), hex(0x123456, 0xffffff, 0.6), hex(0x123456, 0xffffff, 0.75), hex(0x123456, 0xffffff, 0.9)]);
      // The kick band: pack A's half, at −x, in its green; pack B's in its purple; each with a fifth white.
      expect([uniform(draw, 'bandA'), uniform(draw, 'bandB')], draw).toEqual([hex(0x22aa44, 0xffffff, 0.2), hex(0x8844cc, 0xffffff, 0.2)]);
    }
    // The rail: each half's pack colour with 15% white, its underside shaded.
    const rail = part('rail', other);
    const railColours = (side: -1 | 1): Set<string> => {
      const p = rail.getAttribute('position');
      const c = rail.getAttribute('color');
      const out = new Set<string>();
      for (let i = 0; i < p.count; i += 3) {
        if (Math.sign(p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) === side) out.add(new Color(c.getX(i), c.getY(i), c.getZ(i)).getHexString());
      }
      return out;
    };
    expect(railColours(-1).has(hex(0x22aa44, 0xffffff, 0.15)), "pack A's half's rail").toBe(true);
    expect(railColours(1).has(hex(0x8844cc, 0xffffff, 0.15)), "pack B's half's rail").toBe(true);
    expect(railColours(-1).has(hex(0x8844cc, 0xffffff, 0.15)), "pack B's colour on pack A's half").toBe(false);
    // The ground: the apron, the outfield, and the sky at its edge, each the look's.
    const ground = colours(part('ground', other));
    for (const c of [0x998877, 0x335511, 0x000001]) expect(ground.has(new Color(c).getHexString()), c.toString(16)).toBe(true);
    for (const c of [PLACEHOLDER_LOOK.pitch.apron, PLACEHOLDER_LOOK.pitch.outfield]) expect(ground.has(new Color(c).getHexString())).toBe(false);
  });
});

describe("the occluders' variants (M4's design §2.6, M4-Q11)", () => {
  it('holds one hidden object for each occluder\'s other variant, on its geometry, for prepare()\'s compile', () => {
    // The goal frames and the overhead net: from C-57 the walls are glass, and no occluder.
    expect(drawn.variants.map((v) => v.name)).toEqual(['goal frames, dithered', 'overhead net, dithered']);
    for (const v of drawn.variants) {
      const of = drawn.object.getObjectByName(v.name.replace(', dithered', '')) as Mesh | LineSegments;
      expect(v.visible, v.name).toBe(false);
      expect(v.parent, v.name).toBe(drawn.object);
      expect((v as Mesh).geometry, v.name).toBe(of.geometry);
    }
  });

  it('keeps every occluder on its opaque variant while nothing crosses the fade (phase 1)', () => {
    drawn.setFade(new Vector3(0, 0, 2));
    drawn.setBulge(null);
    for (const v of drawn.variants) {
      const of = drawn.object.getObjectByName(v.name.replace(', dithered', '')) as Mesh;
      // Phase 1's fadeVariants gives the material as both.
      expect(of.material, v.name).toBe((v as Mesh).material);
    }
  });
});

describe("the line fade, from the fade's capsule (C-57)", () => {
  it("hands the glass's two draws, the goal frames' fade and the netting one set of uniforms, the capsule's each frame", () => {
    const d = drawPitch(pitch, detail, PLACEHOLDER_LOOK);
    const inner = (materialOf('glass, inner', d) as ShaderMaterial).uniforms;
    const outer = (materialOf('glass, outer', d) as ShaderMaterial).uniforms;
    const netting = (materialOf('goal netting', d) as ShaderMaterial).uniforms;
    // The frames' fade is three's Lambert, hooked: its uniforms join at the compile.
    const frames = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <opaque_fragment>' };
    materialOf('goal frames', d).onBeforeCompile(frames as never, null as never);
    for (const key of ['lineFadeOn', 'lineFadeFrom', 'lineFadeTo', 'lineFadeRadii', 'lineFadeBeyond']) {
      expect([outer[key], netting[key], frames.uniforms[key]], key).toEqual([inner[key], inner[key], inner[key]]);
      expect(outer[key], key).toBe(inner[key]);
      expect(netting[key], key).toBe(inner[key]);
      expect(frames.uniforms[key], key).toBe(inner[key]);
    }
    setFade(new Vector3(1, 2, 3), new Vector3(4, 5, 0.25), 0.5);
    d.setFade(new Vector3(1, 2, 3));
    expect([inner['lineFadeOn']!.value, (inner['lineFadeFrom']!.value as Vector3).toArray(), (inner['lineFadeTo']!.value as Vector3).toArray()])
      .toEqual([1, [1, 2, 3], [4, 5, 0.25]]);
    // No subject, as the overview has none: no line, nothing clear round it.
    setFade(null, null, 0);
    d.setFade(new Vector3(0, -28.3, 33.1));
    expect(inner['lineFadeOn']!.value).toBe(0);
    d.dispose();
  });
});
