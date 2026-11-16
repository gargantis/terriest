// The pitch as a list of bounded static pieces (PLAN D-4, §7.3), built from
// a PitchShape. Each piece is convex with a closest-point test, and each
// has its point mirror, (x, y, z) → (−x, −y, z), in the list: the floor and
// the overhead net are their own mirrors, and every other piece is built
// once and then reflected by negating x and y, so a mirrored body meets a
// bit-for-bit mirrored contact (D-5's mirror pairs, P8).
//
//   planes:   the floor and the overhead net;
//   quads:    the side walls, the four cut corners, the end-wall panels
//             beside and above each mouth, and each goal's back, side and
//             top netting;
//   capsules: the posts and crossbars, on the end-wall plane, leaving the
//             mouth clear by its configured width and height.

import type { PitchShape } from './config.ts';

export const PLANE = 0;
export const QUAD = 1;
export const CAPSULE = 2;

/** What a piece is made of: it sets the bounce, and whether it ends a lunge. */
export const FLOOR = 0;
export const WALL = 1; // walls, cut corners, end-wall panels
export const NET = 2; // the overhead net
export const FRAME = 3; // posts and crossbars
export const GOAL_NET = 4;

export interface Piece {
  readonly name: string;
  readonly kind: typeof PLANE | typeof QUAD | typeof CAPSULE;
  readonly surface: number;
  /** Index of this piece's point mirror in the list (itself for the planes). */
  mirror: number;
  // Plane and quad: a point o and the unit normal n, pointing into the pitch.
  readonly ox: number; readonly oy: number; readonly oz: number;
  readonly nx: number; readonly ny: number; readonly nz: number;
  // Quad: o is a corner and e1, e2 are its orthogonal edges.
  readonly e1x: number; readonly e1y: number; readonly e1z: number;
  readonly e2x: number; readonly e2y: number; readonly e2z: number;
  readonly inv1: number; readonly inv2: number; // 1/|e1|², 1/|e2|²
  // Capsule: the segment from o to o + e1, and its radius.
  readonly radius: number;
  // Bound box, for the cheap test before the closest point (D-5 step 3).
  readonly minX: number; readonly minY: number; readonly minZ: number;
  readonly maxX: number; readonly maxY: number; readonly maxZ: number;
}

export interface Pitch {
  readonly shape: PitchShape;
  readonly pieces: readonly Piece[];
  /** x of each goal line (the end walls' inner planes): ±length/2. */
  readonly goalLineX: number;
}

interface PieceSpec {
  name: string;
  kind: typeof PLANE | typeof QUAD | typeof CAPSULE;
  surface: number;
  o: readonly [number, number, number];
  n?: readonly [number, number, number];
  e1?: readonly [number, number, number];
  e2?: readonly [number, number, number];
  radius?: number;
}

const INF = Infinity;

function makePiece(s: PieceSpec): Piece {
  const [ox, oy, oz] = s.o;
  const [nx, ny, nz] = s.n ?? [0, 0, 0];
  const [e1x, e1y, e1z] = s.e1 ?? [0, 0, 0];
  const [e2x, e2y, e2z] = s.e2 ?? [0, 0, 0];
  const radius = s.radius ?? 0;
  let minX = -INF, minY = -INF, minZ = -INF, maxX = INF, maxY = INF, maxZ = INF;
  if (s.kind === QUAD) {
    const xs = [ox, ox + e1x, ox + e2x, ox + e1x + e2x];
    const ys = [oy, oy + e1y, oy + e2y, oy + e1y + e2y];
    const zs = [oz, oz + e1z, oz + e2z, oz + e1z + e2z];
    minX = Math.min(...xs); maxX = Math.max(...xs);
    minY = Math.min(...ys); maxY = Math.max(...ys);
    minZ = Math.min(...zs); maxZ = Math.max(...zs);
  } else if (s.kind === CAPSULE) {
    minX = Math.min(ox, ox + e1x) - radius; maxX = Math.max(ox, ox + e1x) + radius;
    minY = Math.min(oy, oy + e1y) - radius; maxY = Math.max(oy, oy + e1y) + radius;
    minZ = Math.min(oz, oz + e1z) - radius; maxZ = Math.max(oz, oz + e1z) + radius;
  }
  const l1 = e1x * e1x + e1y * e1y + e1z * e1z;
  const l2 = e2x * e2x + e2y * e2y + e2z * e2z;
  return {
    name: s.name, kind: s.kind, surface: s.surface, mirror: -1,
    ox, oy, oz, nx, ny, nz, e1x, e1y, e1z, e2x, e2y, e2z,
    inv1: l1 > 0 ? 1 / l1 : 0, inv2: l2 > 0 ? 1 / l2 : 0, radius,
    minX, minY, minZ, maxX, maxY, maxZ,
  };
}

/** The point mirror of a piece: x and y negated, exactly. */
function reflect(s: PieceSpec, name: string): PieceSpec {
  const r = (v: readonly [number, number, number]): [number, number, number] => [-v[0], -v[1], v[2]];
  return {
    name, kind: s.kind, surface: s.surface, o: r(s.o),
    ...(s.n ? { n: r(s.n) } : {}),
    ...(s.e1 ? { e1: r(s.e1) } : {}),
    ...(s.e2 ? { e2: r(s.e2) } : {}),
    ...(s.radius !== undefined ? { radius: s.radius } : {}),
  };
}

/** Builds the pieces from the shape. The −x end and the −y side are built
 *  here; every other piece is their reflection. */
export function buildPitch(shape: PitchShape): Pitch {
  const { length: L, width: W, height: H, cuts, mouthWidth: M, mouthHeight: MH, goalDepth: D, postRadius: PR } = shape;
  if (cuts[0] !== cuts[2] || cuts[1] !== cuts[3]) throw new Error(`${shape.name}: corner cuts are not point-symmetric`);
  const hx = L / 2;
  const hy = W / 2;
  const my = M / 2 + PR; // post axes
  const mz = MH + PR; // crossbar axis
  const gy = M / 2; // goal netting sides
  const s = Math.sqrt(0.5);
  const c0 = cuts[0]; // (−x, −y), and (+x, +y)
  const c3 = cuts[3]; // (−x, +y), and (+x, −y)
  const c1 = cuts[1]; // (+x, −y)

  const half: PieceSpec[] = [
    // The −y side wall, from the (−x,−y) cut to the (+x,−y) cut.
    { name: 'side wall −y', kind: QUAD, surface: WALL, o: [-hx + c0, -hy, 0], n: [0, 1, 0], e1: [L - c0 - c1, 0, 0], e2: [0, 0, H] },
    // The cut corners at the −x end.
    { name: 'corner −x−y', kind: QUAD, surface: WALL, o: [-hx, -hy + c0, 0], n: [s, s, 0], e1: [c0, -c0, 0], e2: [0, 0, H] },
    { name: 'corner −x+y', kind: QUAD, surface: WALL, o: [-hx, hy - c3, 0], n: [s, -s, 0], e1: [c3, c3, 0], e2: [0, 0, H] },
    // The −x end wall beside and above the mouth.
    { name: 'end −x, −y of the mouth', kind: QUAD, surface: WALL, o: [-hx, -hy + c0, 0], n: [1, 0, 0], e1: [0, hy - c0 - my, 0], e2: [0, 0, H] },
    { name: 'end −x, +y of the mouth', kind: QUAD, surface: WALL, o: [-hx, my, 0], n: [1, 0, 0], e1: [0, hy - c3 - my, 0], e2: [0, 0, H] },
    { name: 'end −x, above the mouth', kind: QUAD, surface: WALL, o: [-hx, -my, mz], n: [1, 0, 0], e1: [0, 2 * my, 0], e2: [0, 0, H - mz] },
    // The −x goal's netting: back, sides and top.
    { name: 'goal −x back', kind: QUAD, surface: GOAL_NET, o: [-hx - D, -gy, 0], n: [1, 0, 0], e1: [0, M, 0], e2: [0, 0, MH] },
    { name: 'goal −x side −y', kind: QUAD, surface: GOAL_NET, o: [-hx - D, -gy, 0], n: [0, 1, 0], e1: [D, 0, 0], e2: [0, 0, MH] },
    { name: 'goal −x side +y', kind: QUAD, surface: GOAL_NET, o: [-hx - D, gy, 0], n: [0, -1, 0], e1: [D, 0, 0], e2: [0, 0, MH] },
    { name: 'goal −x top', kind: QUAD, surface: GOAL_NET, o: [-hx - D, -gy, MH], n: [0, 0, -1], e1: [D, 0, 0], e2: [0, M, 0] },
    // The −x goal's frame.
    { name: 'post −x−y', kind: CAPSULE, surface: FRAME, o: [-hx, -my, 0], e1: [0, 0, mz], radius: PR },
    { name: 'post −x+y', kind: CAPSULE, surface: FRAME, o: [-hx, my, 0], e1: [0, 0, mz], radius: PR },
    { name: 'crossbar −x', kind: CAPSULE, surface: FRAME, o: [-hx, -my, mz], e1: [0, 2 * my, 0], radius: PR },
  ];

  const specs: PieceSpec[] = [
    { name: 'floor', kind: PLANE, surface: FLOOR, o: [0, 0, 0], n: [0, 0, 1] },
    { name: 'overhead net', kind: PLANE, surface: NET, o: [0, 0, H], n: [0, 0, -1] },
  ];
  for (const p of half) specs.push(p, reflect(p, `${p.name} (mirror)`));
  const pieces = specs.map(makePiece);
  pieces[0]!.mirror = 0;
  pieces[1]!.mirror = 1;
  for (let k = 2; k < pieces.length; k += 2) {
    pieces[k]!.mirror = k + 1;
    pieces[k + 1]!.mirror = k;
  }
  return { shape, pieces, goalLineX: hx };
}

/** Output of pieceContact: the unit normal from the piece toward the body,
 *  and the depth of the overlap (≥ 0 when in contact). */
export interface PieceHit { nx: number; ny: number; nz: number; depth: number }

/** The sphere (c, r) against a piece: true, with the normal and depth, when
 *  they touch or overlap. Faces of planes and quads are one-sided: a centre
 *  up to r behind a face is pushed back out the front. Quad edges, quad
 *  corners and capsules use the true closest point. */
export function pieceContact(p: Piece, cx: number, cy: number, cz: number, r: number, out: PieceHit): boolean {
  if (p.kind === PLANE) {
    const h = (cx - p.ox) * p.nx + (cy - p.oy) * p.ny + (cz - p.oz) * p.nz;
    if (h > r) return false;
    out.nx = p.nx; out.ny = p.ny; out.nz = p.nz; out.depth = r - h;
    return true;
  }
  // The cheap bound test.
  if (cx + r < p.minX || cx - r > p.maxX || cy + r < p.minY || cy - r > p.maxY || cz + r < p.minZ || cz - r > p.maxZ) return false;
  const dx = cx - p.ox;
  const dy = cy - p.oy;
  const dz = cz - p.oz;
  if (p.kind === QUAD) {
    const h = dx * p.nx + dy * p.ny + dz * p.nz;
    if (h > r || h < -r) return false;
    let u = (dx * p.e1x + dy * p.e1y + dz * p.e1z) * p.inv1;
    let w = (dx * p.e2x + dy * p.e2y + dz * p.e2z) * p.inv2;
    if (u >= 0 && u <= 1 && w >= 0 && w <= 1) {
      out.nx = p.nx; out.ny = p.ny; out.nz = p.nz; out.depth = r - h;
      return true;
    }
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    w = w < 0 ? 0 : w > 1 ? 1 : w;
    const qx = dx - (u * p.e1x + w * p.e2x);
    const qy = dy - (u * p.e1y + w * p.e2y);
    const qz = dz - (u * p.e1z + w * p.e2z);
    return toward(qx, qy, qz, r, p, out);
  }
  // Capsule: the closest point on the segment o → o + e1.
  let t = (dx * p.e1x + dy * p.e1y + dz * p.e1z) * p.inv1;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = dx - t * p.e1x;
  const qy = dy - t * p.e1y;
  const qz = dz - t * p.e1z;
  return toward(qx, qy, qz, r + p.radius, p, out);
}

/** The contact along (qx, qy, qz), from the closest point to the centre. */
function toward(qx: number, qy: number, qz: number, reach: number, p: Piece, out: PieceHit): boolean {
  const d2 = qx * qx + qy * qy + qz * qz;
  if (d2 > reach * reach) return false;
  const d = Math.sqrt(d2);
  if (d === 0) {
    // A centre exactly on the piece: the face normal, or +z for a capsule.
    if (p.kind === QUAD) { out.nx = p.nx; out.ny = p.ny; out.nz = p.nz; } else { out.nx = 0; out.ny = 0; out.nz = 1; }
    out.depth = reach;
    return true;
  }
  out.nx = qx / d; out.ny = qy / d; out.nz = qz / d; out.depth = reach - d;
  return true;
}

/** Whether a point is inside the space the pieces enclose: the pitch's floor
 *  plan under the overhead net, or a goal box under its top netting, with
 *  tol of slack. For the tests (§16's fuzz): a centre outside it has gone
 *  through a piece. */
export function insideRegion(shape: PitchShape, x: number, y: number, z: number, tol: number): boolean {
  const hx = shape.length / 2;
  const hy = shape.width / 2;
  if (z < -tol) return false;
  const ax = x < 0 ? -x : x;
  if (ax <= hx + tol) {
    if (y < -hy - tol || y > hy + tol || z > shape.height + tol) return false;
    const [c0, c1, c2, c3] = shape.cuts;
    // Each cut line: the distances from the corner along both walls sum to the cut.
    const m = tol * Math.sqrt(2);
    if (x + hx + (y + hy) < c0 - m) return false; // (−x,−y)
    if (hx - x + (y + hy) < c1 - m) return false; // (+x,−y)
    if (hx - x + (hy - y) < c2 - m) return false; // (+x,+y)
    if (x + hx + (hy - y) < c3 - m) return false; // (−x,+y)
    return true;
  }
  // Behind a goal line: only inside the goal box.
  const gy = shape.mouthWidth / 2;
  return ax <= hx + shape.goalDepth + tol && y >= -gy - tol && y <= gy + tol && z <= shape.mouthHeight + tol;
}

/** The deepest overlap of a sphere with any piece, the floor included. */
export function deepestOverlap(pitch: Pitch, x: number, y: number, z: number, r: number): { depth: number; piece: string } {
  const hit: PieceHit = { nx: 0, ny: 0, nz: 0, depth: 0 };
  let depth = 0;
  let piece = '';
  for (const p of pitch.pieces) {
    if (pieceContact(p, x, y, z, r, hit) && hit.depth > depth) {
      depth = hit.depth;
      piece = p.name;
    }
  }
  return { depth, piece };
}
