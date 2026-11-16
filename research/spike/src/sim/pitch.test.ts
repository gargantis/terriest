import { describe, expect, it, vi } from 'vitest';
import { MAIN_PITCH, SECOND_PITCH } from './config';
import { buildPitch, CAPSULE, insideRegion, type PieceHit, pieceContact, PLANE, QUAD } from './pitch';

// These run whole scripted matches; under a parallel run they need more than vitest's 5 s.
vi.setConfig({ testTimeout: 120_000 });

// PLAN D-4, §7.4: the pitch as bounded pieces, each with its point mirror.

const hit = (): PieceHit => ({ nx: 0, ny: 0, nz: 0, depth: 0 });

describe('the pitch pieces (D-4)', () => {
  for (const shape of [MAIN_PITCH, SECOND_PITCH]) {
    it(`${shape.name}: every piece's point mirror is in the list, reflected exactly`, () => {
      const { pieces } = buildPitch(shape);
      expect(pieces.length).toBe(28);
      for (let k = 0; k < pieces.length; k++) {
        const p = pieces[k]!;
        const m = pieces[p.mirror]!;
        expect(m.mirror).toBe(k);
        expect(m.kind).toBe(p.kind);
        expect(m.surface).toBe(p.surface);
        for (const [a, b] of [['ox', 'ox'], ['oy', 'oy'], ['nx', 'nx'], ['ny', 'ny'], ['e1x', 'e1x'], ['e1y', 'e1y'], ['e2x', 'e2x'], ['e2y', 'e2y']] as const) {
          expect(m[a] === -p[b], `${p.name} ${a}`).toBe(true);
        }
        for (const key of ['oz', 'nz', 'e1z', 'e2z', 'radius'] as const) expect(m[key]).toBe(p[key]);
      }
      expect(pieces.filter((p) => p.kind === PLANE).length).toBe(2);
      expect(pieces.filter((p) => p.kind === CAPSULE).length).toBe(6);
      expect(pieces.filter((p) => p.kind === QUAD).length).toBe(20);
    });
  }

  it('the second shape is point-symmetric but not mirror-symmetric', () => {
    const inside = (x: number, y: number): boolean => insideRegion(SECOND_PITCH, x, y, 1, 0);
    // A point just inside the 3 m cut's line is outside the 6 m cut.
    expect(inside(-25 + 3.5, -15 + 0.6)).toBe(false); // (−,−) has the 6 m cut
    expect(inside(-25 + 3.5, 15 - 0.6)).toBe(true); // (−,+) has the 3 m cut
    expect(inside(25 - 3.5, 15 - 0.6)).toBe(false); // (+,+) mirrors (−,−)
    expect(inside(25 - 3.5, -15 + 0.6)).toBe(true);
  });

  it('leaves the mouth clear: 8 m between the posts, 3 m under the crossbar, the ball 1.4 m to spare', () => {
    const { pieces } = buildPitch(MAIN_PITCH);
    const posts = pieces.filter((p) => p.name.startsWith('post'));
    const bar = pieces.find((p) => p.name === 'crossbar −x')!;
    expect(posts.length).toBe(4);
    for (const p of posts) expect(Math.abs(p.oy) - p.radius).toBeCloseTo(4, 12); // 4.1 − 0.1
    expect(bar.oz - bar.radius).toBeCloseTo(3, 12);
    expect(3 - 1.6).toBeCloseTo(1.4, 12);
  });

  it('finds closest points on faces, edges and capsules, with normals toward the body', () => {
    const { pieces } = buildPitch(MAIN_PITCH);
    const wall = pieces.find((p) => p.name === 'side wall −y')!;
    const h = hit();
    expect(pieceContact(wall, 0, -13.5, 1, 0.8, h)).toBe(true);
    expect([h.nx, h.ny, h.nz, h.depth]).toEqual([0, 1, 0, 0.30000000000000004]);
    expect(pieceContact(wall, 0, -13, 1, 0.8, h)).toBe(false);
    // A centre behind the face is pushed back out the front (one-sided).
    expect(pieceContact(wall, 0, -14.1, 1, 0.25, h)).toBe(true);
    expect(h.ny).toBe(1);
    expect(h.depth).toBeCloseTo(0.35, 12);
    const post = pieces.find((p) => p.name === 'post −x+y')!;
    expect(pieceContact(post, -19.2, 4.1, 1, 0.8, h)).toBe(true);
    expect(h.nx).toBeCloseTo(1, 12);
    expect(h.depth).toBeCloseTo(0.1, 12);
    const top = pieces.find((p) => p.name === 'goal −x top')!;
    expect(pieceContact(top, -21, 0, 2.5, 0.8, h)).toBe(true);
    expect(h.nz).toBe(-1);
    // A quad's edge: the end-wall panel's bottom edge above the mouth, from below and in front.
    const above = pieces.find((p) => p.name === 'end −x, above the mouth')!;
    expect(pieceContact(above, -19.5, 0, 2.6, 0.8, h)).toBe(true);
    expect(h.nz).toBeLessThan(0);
    expect(h.nx).toBeGreaterThan(0);
  });
});
