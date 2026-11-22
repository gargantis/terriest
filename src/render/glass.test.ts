import type { ShaderMaterial } from 'three';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { insideFloorPlan, pitch, WALL } from '../core/sim/pitch';
import { lineFadeUniforms } from './fade';
import { glassGeometry, glassMaterial, insideOf, outerDrawn, type PanePlane, railGeometry, wallPlanes } from './glass';
import { PLACEHOLDER_LOOK } from './look';

// The glass walls (C-57), without a GPU: the 28 panes over the simulation's
// wall pieces, each vertex carrying its pane's plane, so the vertex shader,
// which keeps a pane in the inner draw when the camera is inside its plane
// and in the outer draw when it's outside (insideOf, the shader's own
// reckoning), decides a pane alike at every vertex; which panes each draw
// keeps for a camera inside, outside a side wall, outside a corner and
// behind a goal; the outer draw skipped while the camera is inside every
// pane's plane; and the rail along the walls' top.

const geometry = glassGeometry(pitch);
const walls = pitch.pieces.filter((q) => q.surface === WALL);

interface Pane {
  /** Its wall piece's name. */
  readonly piece: string;
  readonly plane: PanePlane;
  /** Its length along the wall, metres. */
  readonly length: number;
}

/** The geometry's panes, six vertices each, every vertex's plane checked against its pane's first. */
function panes(): Pane[] {
  const p = geometry.getAttribute('position');
  const n = geometry.getAttribute('normal');
  const plane = geometry.getAttribute('plane');
  const pane = geometry.getAttribute('pane');
  const out: Pane[] = [];
  for (let first = 0; first < p.count; first += 6) {
    const at = (i: number): PanePlane => ({ nx: n.getX(i), ny: n.getY(i), nz: n.getZ(i), offset: plane.getX(i) });
    for (let i = first + 1; i < first + 6; i++) {
      expect(at(i), `pane ${first / 6}, vertex ${i - first}`).toEqual(at(first));
      expect(pane.getY(i), `pane ${first / 6}, vertex ${i - first}`).toBe(pane.getY(first));
    }
    // Its centre, and the wall piece it lies on.
    const c = [0, 1, 2].map((k) => [0, 1, 2, 3, 4, 5].reduce((s, i) => s + p.getComponent(first + i, k), 0) / 6) as [number, number, number];
    const on = walls.filter((q) => {
      const [dx, dy, dz] = [c[0] - q.ox, c[1] - q.oy, c[2] - q.oz];
      const u = (dx * q.e1x + dy * q.e1y + dz * q.e1z) * q.inv1;
      const w = (dx * q.e2x + dy * q.e2y + dz * q.e2z) * q.inv2;
      return Math.abs(dx * q.nx + dy * q.ny + dz * q.nz) < 1e-5 && u > 0 && u < 1 && w > 0 && w < 1;
    });
    expect(on, `pane ${first / 6}'s piece`).toHaveLength(1);
    const q = on[0]!;
    expect(at(first).nx, q.name).toBeCloseTo(q.nx, 6);
    expect(at(first).ny, q.name).toBeCloseTo(q.ny, 6);
    expect(at(first).offset, q.name).toBeCloseTo(q.ox * q.nx + q.oy * q.ny + q.oz * q.nz, 4);
    out.push({ piece: q.name, plane: at(first), length: pane.getY(first) });
  }
  return out;
}

/** The panes each draw keeps for a camera at (x, y, z), by their pieces' names, as the vertex shader keeps them. */
function split(x: number, y: number, z: number, all = panes()): { inner: string[]; outer: string[] } {
  return {
    inner: all.filter((q) => insideOf(q.plane, x, y, z) >= 0).map((q) => q.piece),
    outer: all.filter((q) => insideOf(q.plane, x, y, z) < 0).map((q) => q.piece),
  };
}

const planes = wallPlanes(pitch);
const outerFor = (x: number, y: number, z: number): boolean => outerDrawn(planes, new Vector3(x, y, z));
const count = (names: readonly string[], piece: string): number => names.filter((n) => n === piece).length;

describe('the glass (C-57)', () => {
  it('splits the wall pieces into 28 panes of about 4 m: the side walls 8 of 4 m, the corners 5.66 m, the end walls 5.9 m beside each mouth and 2 of 4.1 m above it', () => {
    const all = panes();
    expect(all).toHaveLength(28);
    expect(geometry.getAttribute('position').count).toBe(28 * 6);
    const lengths = (match: RegExp): number[] => all.filter((q) => match.test(q.piece)).map((q) => Math.round(q.length * 100) / 100);
    expect(lengths(/^side wall/)).toEqual(Array(16).fill(4));
    expect(lengths(/^corner/)).toEqual(Array(4).fill(5.66));
    expect(lengths(/of the mouth$/)).toEqual(Array(4).fill(5.9));
    expect(lengths(/above the mouth$/)).toEqual(Array(4).fill(4.1));
    // Each pane's vertices are at its ends, along it, for the posts at every joint.
    const along = geometry.getAttribute('pane');
    for (let i = 0; i < along.count; i++) expect([0, along.getY(i)], `vertex ${i}`).toContain(along.getX(i));
  });

  it('keeps every pane in the inner draw and none in the outer with the camera inside the walls', () => {
    for (const [x, y, z] of [[0, 0, 2.1], [-15, 12, 0.4], [19.5, -9.5, 5.6], [0, -13.9, 3]]) {
      const s = split(x!, y!, z!);
      expect([s.inner.length, s.outer], `${x}, ${y}, ${z}`).toEqual([28, []]);
    }
  });

  it("keeps a side wall's panes in the outer draw, and the rest in the inner, with the camera outside it", () => {
    const s = split(0, -16, 2.1);
    expect(s.outer).toEqual(Array(8).fill('side wall −y'));
    expect(s.inner).toHaveLength(20);
    expect(count(s.inner, 'side wall +y')).toBe(8);
  });

  it("keeps a corner's pane alone in the outer draw with the camera outside its cut, inside both walls beside it", () => {
    const s = split(-19, -13, 2.1);
    expect(s.outer).toEqual(['corner −x−y']);
    expect(s.inner).toHaveLength(27);
    // Outside the corner and the side wall beside it: both.
    expect(split(-19, -15, 2.1).outer.sort()).toEqual(['corner −x−y', ...Array(8).fill('side wall −y')].sort());
  });

  it("keeps the end wall's panes beside and above the mouth in the outer draw with the camera behind a goal", () => {
    const s = split(-24, 0, 2.1);
    expect(s.outer.sort()).toEqual(['end −x, +y of the mouth', 'end −x, above the mouth', 'end −x, above the mouth', 'end −x, −y of the mouth'].sort());
    expect(s.inner).toHaveLength(24);
    // In the goal's mouth, just behind the line: the same panes, from inside the goal.
    expect(split(-20.5, 1, 1.5).outer).toHaveLength(4);
  });

  it("skips the outer draw while the camera is inside every pane's plane, and draws it once it's outside any", () => {
    // Over the pitch and around it: the outer draw drawn exactly where some pane is the outer draw's, or within a
    // centimetre of being so, as the shader decides in float32.
    const all = panes();
    let inside = 0;
    for (let x = -30; x <= 30; x += 0.75) {
      for (let y = -22; y <= 22; y += 0.75) {
        for (const z of [0.4, 2.1, 5.6]) {
          const outer = split(x, y, z, all).outer.length;
          const near = all.some((q) => insideOf(q.plane, x, y, z) < 0.01);
          expect(outerFor(x, y, z), `${x}, ${y}, ${z}`).toBe(outer > 0 || near);
          if (!outerFor(x, y, z)) {
            inside++;
            expect(insideFloorPlan(pitch.shape, x, y), `${x}, ${y}: skipped off the floor plan`).toBe(true);
          }
        }
      }
    }
    expect(inside).toBeGreaterThan(1000);
    expect([outerFor(0, -13.995, 2.1), outerFor(0, -13.98, 2.1)]).toEqual([true, false]);
  });

  it('draws its two draws with one shader, the outer squashed to the kick band and its line', () => {
    const fade = lineFadeUniforms();
    const [inner, outer] = [glassMaterial(PLACEHOLDER_LOOK, false, fade), glassMaterial(PLACEHOLDER_LOOK, true, fade)] as ShaderMaterial[];
    expect(outer!.vertexShader).toBe(inner!.vertexShader);
    expect(outer!.fragmentShader).toBe(inner!.fragmentShader);
    expect([inner!.uniforms['outer']!.value, outer!.uniforms['outer']!.value]).toEqual([0, 1]);
    expect(outer!.uniforms['outerTop']!.value).toBeCloseTo(0.51, 9);
    expect(outer!.uniforms['bandTop']!.value).toBe(0.45);
    // See-through, both sides, writing no depth.
    for (const m of [inner!, outer!]) expect([m.transparent, m.depthWrite, m.side]).toEqual([true, false, 2]);
    inner!.dispose();
    outer!.dispose();
  });
});

describe('the rail (C-57)', () => {
  it('runs along every wall top, from 0.1 m below it to 0.03 m above, 9 cm thick across its wall', () => {
    const g = railGeometry(pitch, PLACEHOLDER_LOOK);
    const p = g.getAttribute('position');
    const top = pitch.shape.heightMetres;
    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = 0; i < p.count; i++) {
      lowest = Math.min(lowest, p.getZ(i));
      highest = Math.max(highest, p.getZ(i));
      // Within half its thickness of some wall's plane.
      const off = Math.min(...planes.map((q) => Math.abs(insideOf(q, p.getX(i), p.getY(i), 0))));
      expect(off, `vertex ${i}`).toBeLessThan(0.045 + 1e-6);
    }
    expect(lowest).toBeCloseTo(top - 0.1, 5);
    expect(highest).toBeCloseTo(top + 0.03, 5);
    g.dispose();
  });
});
