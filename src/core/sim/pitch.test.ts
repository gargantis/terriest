import { describe, expect, it } from 'vitest';
import { config } from '../../config';
import { buildPitch, CAPSULE, deepestOverlap, insideRegion, type PieceHit, pieceContact, pitch, PLANE, QUAD } from './pitch';
import { SECOND_SHAPE } from './testing';

// The pitch's contact tests (D-4, D-5 step 3; design §1.7): the M0 spike's
// pitch.test.ts closest-point cases, on M1's pieces. src/config.test.ts
// checks the pieces' point mirrors and the goal mouth (§7.4).

const hit = (): PieceHit => ({ nx: 0, ny: 0, nz: 0, depth: 0 });
const named = (name: string) => {
  const p = pitch.pieces.find((q) => q.name === name);
  if (!p) throw new Error(`no piece "${name}"`);
  return p;
};

describe('the pitch pieces (D-4)', () => {
  it('are two planes, twenty quads and six capsules on both shapes', () => {
    for (const shape of [config.pitch, SECOND_SHAPE]) {
      const { pieces } = buildPitch(shape);
      expect(pieces.length).toBe(28);
      expect(pieces.filter((p) => p.kind === PLANE).length).toBe(2);
      expect(pieces.filter((p) => p.kind === QUAD).length).toBe(20);
      expect(pieces.filter((p) => p.kind === CAPSULE).length).toBe(6);
    }
  });

  it('finds closest points on faces, edges and capsules, with normals toward the body', () => {
    const h = hit();
    const wall = named('side wall −y');
    expect(pieceContact(wall, 0, -13.5, 1, 0.8, h)).toBe(true);
    expect([h.nx, h.ny, h.nz, h.depth]).toEqual([0, 1, 0, 0.30000000000000004]);
    expect(pieceContact(wall, 0, -13, 1, 0.8, h)).toBe(false);
    // A centre behind the face is pushed back out the front (one-sided).
    expect(pieceContact(wall, 0, -14.1, 1, 0.25, h)).toBe(true);
    expect(h.ny).toBe(1);
    expect(h.depth).toBeCloseTo(0.35, 12);
    // A post: the closest point on its axis.
    expect(pieceContact(named('post −x+y'), -19.2, 4.1, 1, 0.8, h)).toBe(true);
    expect(h.nx).toBeCloseTo(1, 12);
    expect(h.depth).toBeCloseTo(0.1, 12);
    // The goal's top netting faces down.
    expect(pieceContact(named('goal −x top'), -21, 0, 2.5, 0.8, h)).toBe(true);
    expect(h.nz).toBe(-1);
    // A quad's edge: the end-wall panel's bottom edge above the mouth, from below and in front.
    expect(pieceContact(named('end −x, above the mouth'), -19.5, 0, 2.6, 0.8, h)).toBe(true);
    expect(h.nz).toBeLessThan(0);
    expect(h.nx).toBeGreaterThan(0);
    // The floor, a plane, reaches everywhere; the overhead net faces down.
    expect(pieceContact(named('floor'), 7, -3, 0.8, 0.8, h)).toBe(true);
    expect([h.nx, h.ny, h.nz, h.depth]).toEqual([0, 0, 1, 0]);
    expect(pieceContact(named('overhead net'), 0, 0, 5.5, 0.8, h)).toBe(true);
    expect(h.nz).toBe(-1);
    expect(h.depth).toBeCloseTo(0.3, 12);
  });

  it('gives a mirrored body the mirrored contact, bit for bit (P8)', () => {
    const a = hit();
    const b = hit();
    const points: [number, number, number, number][] = [[-19.5, 0.3, 2.6, 0.8], [3, -13.7, 0.25, 0.25], [-17.9, -12.3, 0.8, 0.8], [-20.7, 3.4, 1.1, 0.8]];
    let contacts = 0;
    for (const [x, y, z, r] of points) {
      for (const p of pitch.pieces) {
        const m = pitch.pieces[p.mirror]!;
        const touches = pieceContact(p, x, y, z, r, a);
        expect(pieceContact(m, -x, -y, z, r, b), p.name).toBe(touches);
        if (!touches) continue;
        contacts++;
        // P8 compares with ===, so +0 matches −0.
        const want = [-a.nx, -a.ny, a.nz, a.depth];
        expect([b.nx, b.ny, b.nz, b.depth].every((v, i) => v === want[i]), p.name).toBe(true);
      }
    }
    // The panel above the mouth, the top netting and the crossbar; the floor
    // twice; a cut corner; a side netting.
    expect(contacts).toBe(7);
  });

  it('finds the deepest overlap with any piece', () => {
    expect(deepestOverlap(pitch, 0, 0, 0.8, 0.8)).toEqual({ depth: 0, piece: '' });
    const d = deepestOverlap(pitch, 0, 13.5, 0.7, 0.8);
    expect(d.piece).toBe('side wall +y');
    expect(d.depth).toBeCloseTo(0.3, 12);
  });

  it('tells which points are inside the space the pieces enclose', () => {
    const shape = config.pitch;
    expect(insideRegion(shape, 0, 0, 1, 0)).toBe(true);
    expect(insideRegion(shape, 0, 14.1, 1, 0)).toBe(false);
    expect(insideRegion(shape, 0, 14.1, 1, 0.2)).toBe(true); // its slack
    expect(insideRegion(shape, 0, 0, 6.1, 0)).toBe(false);
    expect(insideRegion(shape, 19.5, 13.5, 1, 0)).toBe(false); // in the cut corner
    // Behind a goal line only inside the goal box.
    expect(insideRegion(shape, -21, 3.9, 1, 0)).toBe(true);
    expect(insideRegion(shape, -21, 4.1, 1, 0)).toBe(false);
    expect(insideRegion(shape, -21, 0, 3.1, 0)).toBe(false);
    expect(insideRegion(shape, -22.1, 0, 1, 0)).toBe(false);
  });

  it('makes the second shape point-symmetric but not mirror-symmetric', () => {
    const inside = (x: number, y: number): boolean => insideRegion(SECOND_SHAPE, x, y, 1, 0);
    // A point just inside the 3 m cut's line is outside the 6 m cut.
    expect(inside(-25 + 3.5, -15 + 0.6)).toBe(false); // (−,−) has the 6 m cut
    expect(inside(-25 + 3.5, 15 - 0.6)).toBe(true); // (−,+) has the 3 m cut
    expect(inside(25 - 3.5, 15 - 0.6)).toBe(false); // (+,+) mirrors (−,−)
    expect(inside(25 - 3.5, -15 + 0.6)).toBe(true);
  });
});
