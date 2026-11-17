// The pitch as a list of bounded static pieces (PLAN D-4, §7.3), built from
// the configuration's pitch shape: M0's buildPitch, and from M2 its contact
// tests, pieceContact and insideRegion (design §1.7). Each piece is convex,
// and each has its point mirror, (x, y, z) → (−x, −y, z), in the list: the
// floor and the overhead net are their own, and every other piece is built
// once and reflected by negating x and y, so a mirrored body meets a
// bit-for-bit mirrored contact (D-5's mirror pairs, P8).
//
//   planes:   the floor and the overhead net;
//   quads:    the side walls, the four cut corners, the end-wall panels
//             beside and above each mouth, and each goal's back, side and
//             top netting;
//   capsules: the posts and crossbars, on the end-wall plane, leaving the
//             mouth clear by its configured width and height.
//
// The page draws these pieces, so the pitch it draws is the one played on.
// Metres, z up; the centre spot is the origin, and pack A defends the goal
// at −x (D-4).

import { config, type PitchShape } from '../../config';

// The pieces' kinds and surfaces are codes, each line marked for the
// configuration check (src/config.test.ts), which reads a top-level whole
// number here as a possible copy of a setting.
export const PLANE = 0;
export const QUAD = 1; // not a setting
export const CAPSULE = 2; // not a setting
export type PieceKind = typeof PLANE | typeof QUAD | typeof CAPSULE;

/** What a piece is made of: it sets the bounce (D-5) and the look (§12). */
export const FLOOR = 0;
export const WALL = 1; // side walls, cut corners, end-wall panels; not a setting
export const NET = 2; // the overhead net; not a setting
export const FRAME = 3; // posts and crossbars; not a setting
export const GOAL_NET = 4; // each goal's back, side and top netting; not a setting
export type Surface = typeof FLOOR | typeof WALL | typeof NET | typeof FRAME | typeof GOAL_NET;

/** Pack A, 0, defends the goal at −x; pack B, 1, the goal at +x (D-4). */
export type Pack = 0 | 1;
/** A point on the floor plan, (x, y). */
export type Point = readonly [x: number, y: number];

export interface Piece {
  readonly name: string;
  readonly kind: PieceKind;
  readonly surface: Surface;
  /** Index of this piece's point mirror in the list; a plane's is its own. */
  readonly mirror: number;
  // Plane and quad: a point o and the unit normal n, pointing into the
  // pitch. Faces are one-sided. A capsule's n is 0.
  readonly ox: number; readonly oy: number; readonly oz: number;
  readonly nx: number; readonly ny: number; readonly nz: number;
  // Quad: o is a corner and e1, e2 its two edges, at right angles, so its
  // corners are o, o + e1, o + e1 + e2 and o + e2. Capsule: the segment
  // from o to o + e1. A plane's are 0.
  readonly e1x: number; readonly e1y: number; readonly e1z: number;
  readonly e2x: number; readonly e2y: number; readonly e2z: number;
  /** 1/|e1|² and 1/|e2|², for M2's closest-point tests; 0 for a zero edge. */
  readonly inv1: number; readonly inv2: number;
  /** A capsule's radius; 0 for the others. */
  readonly radius: number;
  /** The bound box, for the cheap test before the closest point (D-5
   *  step 3); a plane's is infinite. */
  readonly minX: number; readonly minY: number; readonly minZ: number;
  readonly maxX: number; readonly maxY: number; readonly maxZ: number;
}

/** A pack's half of the floor, which carries its colour (L68). */
export interface Half {
  readonly pack: Pack;
  /** Counter-clockwise from above. The halves meet on the halfway line, x = 0. */
  readonly outline: readonly Point[];
}

/** A goal, by the pack that defends it and whose colour it carries (L68). */
export interface Goal {
  readonly pack: Pack;
  /** The goal line's x, on the end wall's inner plane, across the mouth. */
  readonly lineX: number;
  /** The clear mouth: between the posts, centred on y = 0, and under the crossbar. */
  readonly mouthWidth: number;
  readonly mouthHeight: number;
  readonly depth: number;
  /** Its posts, crossbar and netting: indices into Pitch.pieces. */
  readonly pieces: readonly number[];
  /** The floor inside it, counter-clockwise from above. */
  readonly floor: readonly Point[];
}

export interface Pitch {
  readonly shape: PitchShape;
  readonly pieces: readonly Piece[];
  /** Pack B's goal line, the +x end wall's inner plane: length/2. Pack A's is at −goalLineX. */
  readonly goalLineX: number;
  /** The floor plan inside the walls and cut corners, counter-clockwise
   *  from above: the floor's and the overhead net's drawn extent. */
  readonly outline: readonly Point[];
  /** By pack. */
  readonly halves: readonly [Half, Half];
  /** By pack: the goal each pack defends. */
  readonly goals: readonly [Goal, Goal];
}

type Vec = readonly [number, number, number];

interface PieceSpec {
  readonly name: string;
  readonly kind: PieceKind;
  readonly surface: Surface;
  readonly o: Vec;
  readonly n?: Vec;
  readonly e1?: Vec;
  readonly e2?: Vec;
  readonly radius?: number;
}

const ZERO: Vec = [0, 0, 0];

function makePiece(s: PieceSpec, mirror: number): Piece {
  const [ox, oy, oz] = s.o;
  const [nx, ny, nz] = s.n ?? ZERO;
  const [e1x, e1y, e1z] = s.e1 ?? ZERO;
  const [e2x, e2y, e2z] = s.e2 ?? ZERO;
  const radius = s.radius ?? 0;
  let minX = -Infinity, minY = -Infinity, minZ = -Infinity, maxX = Infinity, maxY = Infinity, maxZ = Infinity;
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
  return Object.freeze({
    name: s.name, kind: s.kind, surface: s.surface, mirror,
    ox, oy, oz, nx, ny, nz, e1x, e1y, e1z, e2x, e2y, e2z,
    inv1: l1 > 0 ? 1 / l1 : 0, inv2: l2 > 0 ? 1 / l2 : 0, radius,
    minX, minY, minZ, maxX, maxY, maxZ,
  });
}

/** The point mirror of a piece, x and y negated exactly, named for the
 *  other end and side. */
function reflect(s: PieceSpec): PieceSpec {
  const r = (v: Vec): Vec => [-v[0], -v[1], v[2]];
  return {
    name: s.name.replace(/([−+])([xy])/g, (_, sign: string, axis: string) => `${sign === '−' ? '+' : '−'}${axis}`),
    kind: s.kind, surface: s.surface, o: r(s.o),
    ...(s.n ? { n: r(s.n) } : {}),
    ...(s.e1 ? { e1: r(s.e1) } : {}),
    ...(s.e2 ? { e2: r(s.e2) } : {}),
    ...(s.radius !== undefined ? { radius: s.radius } : {}),
  };
}

function freeze<T>(value: T): T {
  Object.freeze(value);
  return value;
}
const points = (list: readonly Point[]): readonly Point[] => freeze(list.map((p) => freeze(p)));
const mirrorPoints = (list: readonly Point[]): readonly Point[] => points(list.map(([x, y]): Point => [-x, -y]));

/** Builds the pieces from a shape. The −x end and the −y side are built
 *  here; every other piece is their reflection. Throws on a shape that
 *  isn't point-symmetric or can't hold its goal mouths. */
export function buildPitch(shape: PitchShape): Pitch {
  const {
    lengthMetres: L, widthMetres: W, heightMetres: H, cornerCutsMetres: cuts,
    mouthWidthMetres: M, mouthHeightMetres: MH, goalDepthMetres: D, postRadiusMetres: PR,
  } = shape;
  const [c0, c1, c2, c3] = cuts;
  if (c0 !== c2 || c1 !== c3) throw new Error(`the corner cuts ${cuts.join(', ')} are not point-symmetric (D-4)`);
  const hx = L / 2;
  const hy = W / 2;
  const my = M / 2 + PR; // post axes
  const mz = MH + PR; // crossbar axis
  const gy = M / 2; // goal netting sides
  if (!(L > 0 && W > 0 && H > 0 && M > 0 && MH > 0 && D > 0 && PR > 0 && c0 > 0 && c1 > 0)) {
    throw new Error('every length of the pitch must be positive');
  }
  if (!(c0 < hx && c1 < hx && my + PR <= hy - Math.max(c0, c1) && mz + PR <= H)) {
    throw new Error('the cut corners and the goal mouths do not fit the walls');
  }
  const s = Math.sqrt(0.5);

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
  for (const p of half) specs.push(p, reflect(p));
  // The planes are their own mirrors; each built piece and its reflection
  // sit side by side.
  const pieces = freeze(specs.map((spec, k) => makePiece(spec, k < 2 ? k : k % 2 === 0 ? k + 1 : k - 1)));

  // The floor plan from the start of the −y side wall, pack A's half, and
  // the floor of pack A's goal. Pack B's are their point mirrors, as is the
  // outline's second half.
  const quarter: Point[] = [[-hx + c0, -hy], [hx - c1, -hy], [hx, -hy + c1], [hx, hy - c2]];
  const halfA = points([[-hx + c0, -hy], [0, -hy], [0, hy], [-hx + c3, hy], [-hx, hy - c3], [-hx, -hy + c0]]);
  const goalFloorA = points([[-hx - D, -gy], [-hx, -gy], [-hx, gy], [-hx - D, gy]]);
  const goal = (pack: Pack, lineX: number, floor: readonly Point[]): Goal =>
    freeze<Goal>({
      pack, lineX, mouthWidth: M, mouthHeight: MH, depth: D, floor,
      pieces: freeze(pieces.flatMap((p, k) => ((p.surface === FRAME || p.surface === GOAL_NET) && (pack === 0 ? p.ox < 0 : p.ox > 0) ? [k] : []))),
    });

  return freeze<Pitch>({
    shape,
    pieces,
    goalLineX: hx,
    outline: points([...quarter, ...mirrorPoints(quarter)]),
    halves: freeze<readonly [Half, Half]>([freeze<Half>({ pack: 0, outline: halfA }), freeze<Half>({ pack: 1, outline: mirrorPoints(halfA) })]),
    goals: freeze<readonly [Goal, Goal]>([goal(0, -hx, goalFloorA), goal(1, hx, mirrorPoints(goalFloorA))]),
  });
}

/** Whether (x, y) is on the floor plan, inside the walls and cut corners
 *  and in front of both goal lines, at least `margin` from each. */
export function insideFloorPlan(shape: PitchShape, x: number, y: number, margin = 0): boolean {
  const hx = shape.lengthMetres / 2;
  const hy = shape.widthMetres / 2;
  if (x < margin - hx || x > hx - margin || y < margin - hy || y > hy - margin) return false;
  // On a cut's line, the distances from its corner along both walls sum to
  // the cut; a point inside by m is m·√2 more.
  const [c0, c1, c2, c3] = shape.cornerCutsMetres;
  const m = margin * Math.sqrt(2);
  return (
    x + hx + (y + hy) >= c0 + m && // (−x,−y)
    hx - x + (y + hy) >= c1 + m && // (+x,−y)
    hx - x + (hy - y) >= c2 + m && // (+x,+y)
    x + hx + (hy - y) >= c3 + m // (−x,+y)
  );
}

// --- Contact tests (D-5 step 3; design §1.7): the M0 spike's pitch.ts ---

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
  const hx = shape.lengthMetres / 2;
  const hy = shape.widthMetres / 2;
  if (z < -tol) return false;
  const ax = x < 0 ? -x : x;
  if (ax <= hx + tol) {
    if (y < -hy - tol || y > hy + tol || z > shape.heightMetres + tol) return false;
    const cuts = shape.cornerCutsMetres;
    // Each cut line: the distances from the corner along both walls sum to the cut.
    const m = tol * Math.sqrt(2);
    if (x + hx + (y + hy) < cuts[0] - m) return false; // (−x,−y)
    if (hx - x + (y + hy) < cuts[1] - m) return false; // (+x,−y)
    if (hx - x + (hy - y) < cuts[2] - m) return false; // (+x,+y)
    if (x + hx + (hy - y) < cuts[3] - m) return false; // (−x,+y)
    return true;
  }
  // Behind a goal line: only inside the goal box.
  const gy = shape.mouthWidthMetres / 2;
  return ax <= hx + shape.goalDepthMetres + tol && y >= -gy - tol && y <= gy + tol && z <= shape.mouthHeightMetres + tol;
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

/** The pitch of the configuration. */
export const pitch: Pitch = buildPitch(config.pitch);
