// D-5's contact solver, one substep at a time, over body slots (PLAN D-3,
// D-4, D-5 as M0 amended it, C-3, C-21, A.4; design §1.8, §4). Its steps:
//   1. forces: the drive or idle friction (D-6), gravity, the ball's rolling slowdown;
//   2. integrate: semi-implicit Euler, velocity then position;
//   3. detect: every pair of bodies, and every body against the pieces
//      behind a cheap bound test, into one list in a fixed,
//      mirror-symmetric order;
//   4. floor as support: a body touching the floor and not moving up sits at
//      z = radius exactly with no vertical speed, unless it's the ball closing
//      faster than the threshold, which bounces (0.7); terriers never bounce;
//   5. impulses: accumulated, clamped normal impulses by Gauss–Seidel over
//      mirror pairs, forward and back sweeps, restitution as a target
//      separating speed, no friction;
//   6. positions: in the same mirror pairs, without touching velocities;
//   7. slip-out: M0's rule, a 42° cone with the slipping flag;
//   8. touches, tumbles and the goal test are step.ts's, from the contact
//      list this module leaves.
// The M0 spike's research/spike/src/sim/physics.ts, ported line for line, in
// its order and arithmetic (design §4.1). What changed is structural only
// (design §4.2): bodies are read by slot, and a slot may be empty, null, in
// a warm-up pack that isn't full or a test's short pack; empty slots are
// written where scratch is kept by slot, and skipped everywhere else; the
// drive reads the Sim's intents, not terrier fields; the fixed warm-up ball
// (ballFixed); values come from SimParams; the bounce and push counters;
// the rejected slip-out rules' branches are gone; and the piece tests'
// first lines read the body in place (touch), for speed alone.
// Exact operations only (D-1).
//
// Mirror pairs. Slots are terriers in (spot, pack) order, A1, B1, A2, B2 …,
// then the ball, so a terrier's point mirror is slot ^ 1 and the ball's is
// itself. A contact's mirror joins the mirrors of its bodies (or of its body
// and its piece). The contact list is a list of slots, each a contact and its
// mirror, or one contact that is its own mirror: A1 against B1, the ball
// against the floor. Both contacts of a slot are computed from the same
// velocities (or positions) and applied together, so a mirrored state's
// impulses are exact mirror images and stay so, and a sum over mirrored
// partners cancels exactly. A slot holds one contact when its mirror isn't
// touching, which happens only off mirror, or when the mirror's body slot
// is empty.
//
// The floor is a piece like any other in the list (D-4). Step 4 supports
// and bounces bodies on it before the impulses, so its own contacts in
// steps 5 and 6 have no restitution: they only keep other contacts from
// pressing a body into it.

import { datan2, dir } from './math';
import type { SimParams } from './params';
import { FLOOR, GOAL_NET, type PieceHit, pieceContact, type Pitch, PLANE } from './pitch';
import type { Body, Terrier } from './state';

// Template kinds, and the contact lists' first size: codes, not settings.
const PAIR = 0;
const PIECE = 1; // not a setting: a template's kind
const CAPACITY = 64; // not a setting: contacts before the lists grow
/** The broad phase's slack, m. It changes no contact, only which tests run. */
const MARGIN = 0.01; // not a setting

/** Counters for tests, the goldens and the metrics. Step writes them and
 *  never reads them. */
export interface SolverStats {
  substeps: number;
  contacts: number; // summed over substeps
  floorContacts: number; // of those, against the floor
  maxContacts: number;
  slipOuts: number; // terrier-substeps a slip-out fired on
  floorBounces: number; // substeps in which support() bounced the ball off the floor
  pieceBounces: number; // ball–piece contacts other than the floor, closing above the threshold (prepare)
  pushes: number; // substeps with a terrier–ball contact whose impulse is positive after the solve (step.ts)
}

export function newStats(): SolverStats {
  return { substeps: 0, contacts: 0, floorContacts: 0, maxContacts: 0, slipOuts: 0, floorBounces: 0, pieceBounces: 0, pushes: 0 };
}

/** This tick's intents, by terrier slot: set in step 4, read in steps 5 and
 *  7. Scratch, not state (A.1). */
export interface Intents {
  readonly driveOn: Uint8Array;
  readonly zooming: Uint8Array;
  readonly targetVx: Float64Array;
  readonly targetVy: Float64Array;
}

export class Physics {
  /** Body slots: 2 × pack size terriers, then the ball. */
  readonly slots: number;
  /** The ball's slot, 2 × pack size. */
  readonly ball: number;
  readonly stats: SolverStats = newStats();
  private readonly P: SimParams;
  private readonly pitch: Pitch;
  /** One substep, from the configuration's substeps a tick (D-3). */
  private readonly dt: number;
  private readonly radius: Float64Array;
  private readonly invMass: Float64Array;
  private fixed = false;
  // Each body's velocity at the start of the substep, for restitution.
  private readonly v0x: Float64Array;
  private readonly v0y: Float64Array;
  private readonly v0z: Float64Array;
  // Slot templates, in the fixed order: for each body, its pairs with the
  // later bodies, then its pieces; a template stands for a contact and its
  // mirror, and a mirror already covered is left out.
  private readonly tKind: Uint8Array;
  private readonly tA: Int32Array;
  private readonly tB: Int32Array;
  private readonly tMA: Int32Array; // the mirror's body, or −1 if self-mirror
  private readonly tMB: Int32Array;
  // On a body's first template for a piece other than the floor and the
  // net: the index after its last, so the broad phase can skip them all.
  private readonly tSkip: Int32Array;
  /** The ball's first template: all of its templates are pieces, and last,
   *  so the fixed ball's are left out by stopping here (design §4.2). */
  private readonly ballTemplates: number;
  // This substep's contacts, in slot order; read by step.ts.
  cnt = 0;
  ci: Int32Array; // first body's slot
  cj: Int32Array; // second body's slot, or −1 for a piece
  cp: Int32Array; // the piece, or −1
  cnx: Float64Array; // unit normal from ci toward cj, or from ci into the piece
  cny: Float64Array;
  cnz: Float64Array;
  closing: Float64Array; // closing speed at the start of the substep
  private ctarget: Float64Array;
  private cmeff: Float64Array;
  clambda: Float64Array; // accumulated normal impulse
  private nslots = 0;
  private slotStart: Int32Array;
  private slotLen: Uint8Array;
  private readonly hit: PieceHit = { nx: 0, ny: 0, nz: 0, depth: 0 };
  private readonly hit2: PieceHit = { nx: 0, ny: 0, nz: 0, depth: 0 };
  private readonly d2 = new Float64Array(2);
  // Slip-out scratch: per body slot, the summed horizontal offset of the
  // bodies above it within the cone, and which body it slips from.
  private readonly sx: Float64Array;
  private readonly sy: Float64Array;
  private readonly sfrom: Int32Array;
  private readonly sfire: Uint8Array;
  // The broad phase: per body slot, whether it can reach any piece but the
  // floor and the overhead net this substep. A body clear of the walls, the
  // cut corners and the end-wall plane (posts included) by more than its
  // reach can't, so its other piece tests are skipped: the same contacts,
  // cheaper. 0 for an empty slot.
  private readonly near: Uint8Array;
  private readonly clearX: Float64Array; // per slot: |x| below this is clear
  private readonly clearY: Float64Array;
  private readonly clearCut: Float64Array; // the corner-line sum above the cut
  private readonly hx: number;
  private readonly hy: number;
  private readonly c0: number;
  private readonly c1: number;
  private readonly c2: number;
  private readonly c3: number;

  constructor(P: SimParams, packSize: number) {
    this.P = P;
    this.pitch = P.pitch;
    this.dt = P.dt;
    const terriers = 2 * packSize;
    const n = terriers + 1;
    this.slots = n;
    this.ball = terriers;
    this.radius = new Float64Array(n);
    this.invMass = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const isBall = k === terriers;
      this.radius[k] = isBall ? P.ballRadius : P.terrierRadius;
      this.invMass[k] = isBall ? P.ballInvMass : P.terrierInvMass;
    }
    this.v0x = new Float64Array(n);
    this.v0y = new Float64Array(n);
    this.v0z = new Float64Array(n);
    this.sx = new Float64Array(n);
    this.sy = new Float64Array(n);
    this.sfrom = new Int32Array(n);
    this.sfire = new Uint8Array(n);
    this.near = new Uint8Array(n);
    this.clearX = new Float64Array(n);
    this.clearY = new Float64Array(n);
    this.clearCut = new Float64Array(n);
    const shape = this.pitch.shape;
    for (let k = 0; k < n; k++) {
      const r = this.radius[k]!;
      this.clearX[k] = shape.lengthMetres / 2 - r - shape.postRadiusMetres - MARGIN;
      this.clearY[k] = shape.widthMetres / 2 - r - MARGIN;
      this.clearCut[k] = (r + MARGIN) * Math.sqrt(2);
    }
    this.hx = shape.lengthMetres / 2;
    this.hy = shape.widthMetres / 2;
    const cuts = shape.cornerCutsMetres;
    this.c0 = cuts[0];
    this.c1 = cuts[1];
    this.c2 = cuts[2];
    this.c3 = cuts[3];
    const mirror = (k: number): number => (k === terriers ? k : k ^ 1);
    const kind: number[] = [], A: number[] = [], B: number[] = [], MA: number[] = [], MB: number[] = [];
    const pieces = this.pitch.pieces;
    const np = pieces.length;
    let ballTemplates = -1;
    for (let i = 0; i < n; i++) {
      if (i === terriers) ballTemplates = kind.length;
      for (let j = i + 1; j < n; j++) {
        let mi = mirror(i), mj = mirror(j);
        if (mi > mj) { const t = mi; mi = mj; mj = t; }
        if (mi < i || (mi === i && mj < j)) continue; // covered as an earlier pair's mirror
        const self = mi === i && mj === j;
        kind.push(PAIR); A.push(i); B.push(j); MA.push(self ? -1 : mi); MB.push(self ? -1 : mj);
      }
      for (let p = 0; p < np; p++) {
        const mi = mirror(i), mp = pieces[p]!.mirror;
        if (mi < i || (mi === i && mp < p)) continue;
        const self = mi === i && mp === p;
        kind.push(PIECE); A.push(i); B.push(p); MA.push(self ? -1 : mi); MB.push(self ? -1 : mp);
      }
    }
    this.ballTemplates = ballTemplates;
    this.tKind = Uint8Array.from(kind);
    this.tA = Int32Array.from(A);
    this.tB = Int32Array.from(B);
    this.tMA = Int32Array.from(MA);
    this.tMB = Int32Array.from(MB);
    this.tSkip = new Int32Array(kind.length).fill(-1);
    for (let s = 0; s < kind.length; s++) {
      if (kind[s] !== PIECE || B[s]! < 2 || (s > 0 && kind[s - 1] === PIECE && B[s - 1]! >= 2 && A[s - 1] === A[s])) continue;
      let e = s;
      while (e < kind.length && kind[e] === PIECE && B[e]! >= 2 && A[e] === A[s]) e++;
      this.tSkip[s] = e;
    }
    const cap = CAPACITY;
    this.ci = new Int32Array(cap); this.cj = new Int32Array(cap); this.cp = new Int32Array(cap);
    this.cnx = new Float64Array(cap); this.cny = new Float64Array(cap); this.cnz = new Float64Array(cap);
    this.closing = new Float64Array(cap); this.ctarget = new Float64Array(cap);
    this.cmeff = new Float64Array(cap); this.clambda = new Float64Array(cap);
    this.slotStart = new Int32Array(cap); this.slotLen = new Uint8Array(cap);
  }

  /** In warm-up the ball is fixed on the centre spot and never moves (D-8):
   *  no piece contacts, the floor's included; no forces, integration or
   *  support; and an inverse mass of 0 in its contacts with terriers, so it
   *  gains only ±0 from every impulse and every move (design §4.2). Setting
   *  it writes the ball's inverse mass, 0 or 1/m, so nothing carries from
   *  another state's call. */
  get ballFixed(): boolean {
    return this.fixed;
  }

  set ballFixed(fixed: boolean) {
    this.fixed = fixed;
    this.invMass[this.ball] = fixed ? 0 : this.P.ballInvMass;
  }

  private grow(): void {
    const cap = this.ci.length * 2;
    const g32 = (a: Int32Array): Int32Array => { const b = new Int32Array(cap); b.set(a); return b; };
    const g64 = (a: Float64Array): Float64Array => { const b = new Float64Array(cap); b.set(a); return b; };
    const g8 = (a: Uint8Array): Uint8Array => { const b = new Uint8Array(cap); b.set(a); return b; };
    this.ci = g32(this.ci); this.cj = g32(this.cj); this.cp = g32(this.cp);
    this.cnx = g64(this.cnx); this.cny = g64(this.cny); this.cnz = g64(this.cnz);
    this.closing = g64(this.closing); this.ctarget = g64(this.ctarget);
    this.cmeff = g64(this.cmeff); this.clambda = g64(this.clambda);
    this.slotStart = g32(this.slotStart); this.slotLen = g8(this.slotLen);
  }

  /** Steps 1 and 2: forces, then semi-implicit Euler. Also records each
   *  body's velocity at the start of the substep, for restitution: the fixed
   *  ball's too, which is 0. */
  forcesAndIntegrate(bodies: readonly (Body | null)[], terriers: readonly (Terrier | null)[], intents: Intents): void {
    const P = this.P;
    const n = this.slots;
    const dt = this.dt;
    for (let k = 0; k < n; k++) {
      const b = bodies[k];
      if (!b) continue;
      this.v0x[k] = b.vx; this.v0y[k] = b.vy; this.v0z[k] = b.vz;
    }
    const g = P.gravityDt;
    for (let k = 0; k < n - 1; k++) {
      const t = terriers[k];
      if (!t) continue;
      if (t.onFloor && t.lunge === 0) {
        if (intents.driveOn[k] === 1) this.drive(k, t, bodies, intents);
        else slow(t, P.idleFrictionDt);
      }
      t.vz -= g;
    }
    const ball = bodies[n - 1]!;
    if (!this.fixed) {
      if (ball.onFloor) slow(ball, P.rollingSlowdownDt);
      ball.vz -= g;
    }
    for (let k = 0; k < n; k++) {
      const b = bodies[k];
      if (!b || (k === n - 1 && this.fixed)) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
    }
  }

  /** D-6's drive: the horizontal velocity moves toward the target by at most
   *  accel × dt. A slipping terrier's drive is held off toward the body it
   *  slips from (D-5 step 7's flag), when that slot isn't empty: vacate
   *  keeps every slipFrom naming a present body, so the test is a backstop
   *  (design §4.2). */
  private drive(k: number, t: Terrier, bodies: readonly (Body | null)[], intents: Intents): void {
    let dx = intents.targetVx[k]! - t.vx;
    let dy = intents.targetVy[k]! - t.vy;
    const cap = this.P.driveCapDt;
    const d2 = dx * dx + dy * dy;
    if (d2 > cap * cap) {
      const f = cap / Math.sqrt(d2);
      dx *= f;
      dy *= f;
    }
    if (t.slipping && t.slipFrom >= 0) {
      const above = bodies[t.slipFrom];
      if (above) {
        const ux = above.x - t.x;
        const uy = above.y - t.y;
        const u2 = ux * ux + uy * uy;
        const along = dx * ux + dy * uy;
        if (u2 > 0 && along > 0) {
          const f = along / u2;
          dx -= f * ux;
          dy -= f * uy;
        }
      }
    }
    t.vx += dx;
    t.vy += dy;
  }

  /** Step 3: detect, into slots in the fixed mirror-symmetric order. */
  detect(bodies: readonly (Body | null)[]): void {
    this.cnt = 0;
    this.nslots = 0;
    const c0 = this.c0, c1 = this.c1, c2 = this.c2, c3 = this.c3;
    const hx = this.hx;
    const hy = this.hy;
    for (let k = 0; k < this.slots; k++) {
      const b = bodies[k];
      if (!b) {
        this.near[k] = 0;
        continue;
      }
      const ax = b.x < 0 ? -b.x : b.x;
      const ay = b.y < 0 ? -b.y : b.y;
      const cut = this.clearCut[k]!;
      this.near[k] = ax >= this.clearX[k]! || ay >= this.clearY[k]! ||
        b.x + hx + (b.y + hy) - c0 <= cut || hx - b.x + (b.y + hy) - c1 <= cut ||
        hx - b.x + (hy - b.y) - c2 <= cut || b.x + hx + (hy - b.y) - c3 <= cut ? 1 : 0;
    }
    // The fixed ball's templates, all pieces and all last, are left out.
    const T = this.fixed ? this.ballTemplates : this.tKind.length;
    for (let s = 0; s < T; s++) {
      const start = this.cnt;
      const kind = this.tKind[s]!;
      if (kind === PAIR) {
        this.pair(bodies, this.tA[s]!, this.tB[s]!);
        if (this.tMA[s]! >= 0) this.pair(bodies, this.tMA[s]!, this.tMB[s]!);
      } else {
        const p = this.tB[s]!;
        const a = this.tA[s]!;
        const ma = this.tMA[s]!;
        // Pieces 0 and 1 are the floor and the overhead net: always tested.
        // The rest only for a body near them; if neither is, skip them all.
        const skip = this.tSkip[s]!;
        if (skip >= 0 && this.near[a] === 0 && (ma < 0 || this.near[ma] === 0)) {
          s = skip - 1;
          continue;
        }
        if (p < 2 || this.near[a] === 1) this.piece(bodies, a, p);
        if (ma >= 0 && (p < 2 || this.near[ma] === 1)) this.piece(bodies, ma, this.tMB[s]!);
      }
      if (this.cnt > start) {
        this.slotStart[this.nslots] = start;
        this.slotLen[this.nslots] = this.cnt - start;
        this.nslots++;
      }
    }
    const st = this.stats;
    st.substeps++;
    st.contacts += this.cnt;
    for (let c = 0; c < this.cnt; c++) if (this.cp[c] === 0) st.floorContacts++;
    if (this.cnt > st.maxContacts) st.maxContacts = this.cnt;
  }

  private add(i: number, j: number, p: number, nx: number, ny: number, nz: number): void {
    if (this.cnt + 2 > this.ci.length) this.grow();
    const c = this.cnt++;
    this.ci[c] = i; this.cj[c] = j; this.cp[c] = p;
    this.cnx[c] = nx; this.cny[c] = ny; this.cnz[c] = nz;
    this.clambda[c] = 0;
  }

  private pair(bodies: readonly (Body | null)[], i: number, j: number): void {
    const a = bodies[i], b = bodies[j];
    if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const rs = this.radius[i]! + this.radius[j]!;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > rs * rs) return;
    const d = Math.sqrt(d2);
    // Coincident centres take +z as their normal (D-5 step 3).
    if (d === 0) this.add(i, j, -1, 0, 0, 1);
    else this.add(i, j, -1, dx / d, dy / d, dz / d);
  }

  private piece(bodies: readonly (Body | null)[], i: number, p: number): void {
    if (p === 0 && !this.P.floorInSolve) return; // the floor is piece 0
    const b = bodies[i];
    if (!b) return;
    const h = this.hit;
    if (!this.touch(p, b, i, h)) return;
    // Stored pointing from the body into the piece, so (v_j − v_i)·n is the
    // separating speed for pairs and pieces alike, with a piece at rest.
    this.add(i, -1, p, -h.nx, -h.ny, -h.nz);
  }

  /** pieceContact for the body in slot i against piece p. A plane and the
   *  bound test, which settle most calls, are pieceContact's own lines,
   *  here so that no float crosses a call: V8 boxes a float passed to a
   *  function it doesn't inline, which on the wall scrum cost 5–8% of a
   *  step. The same expressions give the same bits; the rest is
   *  pieceContact's. */
  private touch(p: number, b: Body, i: number, out: PieceHit): boolean {
    const piece = this.pitch.pieces[p]!;
    const cx = b.x, cy = b.y, cz = b.z;
    const r = this.radius[i]!;
    if (piece.kind === PLANE) {
      const h = (cx - piece.ox) * piece.nx + (cy - piece.oy) * piece.ny + (cz - piece.oz) * piece.nz;
      if (h > r) return false;
      out.nx = piece.nx; out.ny = piece.ny; out.nz = piece.nz; out.depth = r - h;
      return true;
    }
    if (cx + r < piece.minX || cx - r > piece.maxX || cy + r < piece.minY || cy - r > piece.maxY || cz + r < piece.minZ || cz - r > piece.maxZ) return false;
    return pieceContact(piece, cx, cy, cz, r, out);
  }

  /** Step 4: the floor as support. Sets onFloor, and returns the ball's
   *  closing speed if it bounced this substep, or 0. The fixed ball is
   *  left alone. */
  support(bodies: readonly (Body | null)[]): number {
    const P = this.P;
    const n = this.slots;
    let bounce = 0;
    for (let k = 0; k < n; k++) {
      const b = bodies[k];
      if (!b || (k === n - 1 && this.fixed)) continue;
      const r = this.radius[k]!;
      if (b.z <= r && b.vz <= 0) {
        if (k === n - 1 && -b.vz > P.restitutionThreshold) {
          bounce = -b.vz;
          b.vz = bounce * P.ballSurface;
          b.z = r;
          b.onFloor = false;
        } else {
          b.z = r;
          b.vz = 0;
          b.onFloor = true;
        }
      } else {
        b.onFloor = false;
      }
    }
    if (bounce > 0) this.stats.floorBounces++;
    return bounce;
  }

  /** Sets each contact's restitution target and effective mass, from the
   *  velocities at the start of the substep. Call after support(). */
  prepare(): void {
    const P = this.P;
    const ballK = this.ball;
    for (let c = 0; c < this.cnt; c++) {
      const i = this.ci[c]!, j = this.cj[c]!;
      const nx = this.cnx[c]!, ny = this.cny[c]!, nz = this.cnz[c]!;
      let closing: number;
      let e: number;
      let wj = 0;
      if (j >= 0) {
        closing = (this.v0x[i]! - this.v0x[j]!) * nx + (this.v0y[i]! - this.v0y[j]!) * ny + (this.v0z[i]! - this.v0z[j]!) * nz;
        e = i === ballK || j === ballK ? P.terrierBall : P.terrierRestitution;
        wj = this.invMass[j]!;
      } else {
        closing = this.v0x[i]! * nx + this.v0y[i]! * ny + this.v0z[i]! * nz;
        const surface = this.pitch.pieces[this.cp[c]!]!.surface;
        if (surface === FLOOR) e = 0; // step 4 did the floor's bounce
        else if (i === ballK) {
          e = surface === GOAL_NET ? P.ballGoalNet : P.ballSurface;
          if (closing > P.restitutionThreshold) this.stats.pieceBounces++;
        } else e = P.terrierRestitution;
      }
      this.closing[c] = closing;
      this.ctarget[c] = closing > P.restitutionThreshold ? e * closing : 0;
      this.cmeff[c] = 1 / (this.invMass[i]! + wj);
    }
  }

  /** Step 5: accumulated, clamped normal impulses, Gauss–Seidel over slots,
   *  each iteration a forward sweep and a back sweep. */
  solve(bodies: readonly (Body | null)[]): void {
    const iters = this.P.iterations;
    const ns = this.nslots;
    for (let it = 0; it < iters; it++) {
      for (let s = 0; s < ns; s++) this.solveSlot(bodies, s);
      for (let s = ns - 1; s >= 0; s--) this.solveSlot(bodies, s);
    }
  }

  private solveSlot(bodies: readonly (Body | null)[], s: number): void {
    const c = this.slotStart[s]!;
    if (this.slotLen[s] === 1) {
      this.applyImpulse(bodies, c, this.impulseStep(bodies, c));
    } else {
      // Both from the same velocities, then both applied.
      const d0 = this.impulseStep(bodies, c);
      const d1 = this.impulseStep(bodies, c + 1);
      this.applyImpulse(bodies, c, d0);
      this.applyImpulse(bodies, c + 1, d1);
    }
  }

  /** The change in contact c's accumulated impulse that brings its
   *  separating speed to its target, clamped so the total never pulls. */
  private impulseStep(bodies: readonly (Body | null)[], c: number): number {
    const i = this.ci[c]!, j = this.cj[c]!;
    const a = bodies[i]!;
    const nx = this.cnx[c]!, ny = this.cny[c]!, nz = this.cnz[c]!;
    let vrel: number;
    if (j >= 0) {
      const b = bodies[j]!;
      vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
    } else {
      vrel = -(a.vx * nx + a.vy * ny + a.vz * nz);
    }
    const old = this.clambda[c]!;
    let next = old + this.cmeff[c]! * (this.ctarget[c]! - vrel);
    if (next < 0) next = 0;
    this.clambda[c] = next;
    return next - old;
  }

  private applyImpulse(bodies: readonly (Body | null)[], c: number, d: number): void {
    if (d === 0) return;
    const i = this.ci[c]!, j = this.cj[c]!;
    const px = d * this.cnx[c]!, py = d * this.cny[c]!, pz = d * this.cnz[c]!;
    const a = bodies[i]!;
    const wi = this.invMass[i]!;
    a.vx -= px * wi; a.vy -= py * wi; a.vz -= pz * wi;
    if (j >= 0) {
      const b = bodies[j]!;
      const wj = this.invMass[j]!;
      b.vx += px * wj; b.vy += py * wj; b.vz += pz * wj;
    }
  }

  /** Step 6: position passes over the same slots, from current positions,
   *  moving bodies apart by mass-weighted fractions of each overlap. */
  positions(bodies: readonly (Body | null)[]): void {
    const passes = this.P.positionPasses;
    const ns = this.nslots;
    for (let pass = 0; pass < passes; pass++) {
      for (let s = 0; s < ns; s++) {
        const c = this.slotStart[s]!;
        if (this.slotLen[s] === 1) {
          if (this.overlap(bodies, c, this.hit)) this.move(bodies, c, this.hit);
        } else {
          const o0 = this.overlap(bodies, c, this.hit);
          const o1 = this.overlap(bodies, c + 1, this.hit2);
          if (o0) this.move(bodies, c, this.hit);
          if (o1) this.move(bodies, c + 1, this.hit2);
        }
      }
    }
  }

  /** Contact c's overlap from current positions: the normal from ci toward
   *  cj (or into the piece) and the depth. False when they're apart. */
  private overlap(bodies: readonly (Body | null)[], c: number, out: PieceHit): boolean {
    const i = this.ci[c]!, j = this.cj[c]!;
    const a = bodies[i]!;
    if (j >= 0) {
      const b = bodies[j]!;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const rs = this.radius[i]! + this.radius[j]!;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rs * rs) return false;
      const d = Math.sqrt(d2);
      if (d === 0) { out.nx = 0; out.ny = 0; out.nz = 1; } else { out.nx = dx / d; out.ny = dy / d; out.nz = dz / d; }
      out.depth = rs - d;
      return true;
    }
    if (!this.touch(this.cp[c]!, a, i, out)) return false;
    if (!(out.depth > 0)) return false;
    out.nx = -out.nx; out.ny = -out.ny; out.nz = -out.nz;
    return true;
  }

  private move(bodies: readonly (Body | null)[], c: number, o: PieceHit): void {
    const i = this.ci[c]!, j = this.cj[c]!;
    const a = bodies[i]!;
    const wi = this.invMass[i]!;
    if (j >= 0) {
      const b = bodies[j]!;
      const wj = this.invMass[j]!;
      const fi = (o.depth * wi) / (wi + wj);
      const fj = (o.depth * wj) / (wi + wj);
      a.x -= o.nx * fi; a.y -= o.ny * fi; a.z -= o.nz * fi;
      b.x += o.nx * fj; b.y += o.ny * fj; b.z += o.nz * fj;
    } else {
      a.x -= o.nx * o.depth; a.y -= o.ny * o.depth; a.z -= o.nz * o.depth;
    }
  }

  /** Step 7, M0's rule: a ball or terrier resting above a terrier within the
   *  42° cone doesn't stay up. Decided from the positions after step 6, all
   *  found before any is applied: each such terrier on the floor has its
   *  speed away from the combined horizontal offset of the bodies above it
   *  raised to at least the slip speed, or along its heading if exactly
   *  centred, and its slipping flag stores the body it slips from, the ball
   *  if the ball is above it. A ball below a terrier is an ordinary contact.
   *  Returns how many fired. */
  slipOut(bodies: readonly (Body | null)[], terriers: readonly (Terrier | null)[]): number {
    const P = this.P;
    const cosCone = P.slipCos;
    const speed = P.slipSpeed;
    const ballK = this.ball;
    this.sx.fill(0);
    this.sy.fill(0);
    this.sfrom.fill(-1);
    this.sfire.fill(0);
    for (let c = 0; c < this.cnt; c++) {
      const j = this.cj[c]!;
      if (j < 0) continue;
      const i = this.ci[c]!;
      const a = bodies[i]!, b = bodies[j]!;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 === 0) continue;
      const d = Math.sqrt(d2);
      let lower = -1, upper = -1, ox = 0, oy = 0;
      if (dz > 0 && dz / d > cosCone && i !== ballK) { lower = i; upper = j; ox = dx; oy = dy; }
      else if (dz < 0 && -dz / d > cosCone && j !== ballK) { lower = j; upper = i; ox = -dx; oy = -dy; }
      if (lower < 0 || !bodies[lower]!.onFloor) continue;
      this.sx[lower] = this.sx[lower]! + ox;
      this.sy[lower] = this.sy[lower]! + oy;
      this.sfire[lower] = 1;
      // It slips from the ball if the ball is above it, else the first found.
      if (this.sfrom[lower]! < 0 || upper === ballK) this.sfrom[lower] = upper;
    }
    let fired = 0;
    const d = this.d2;
    for (let k = 0; k < ballK; k++) {
      if (this.sfire[k] === 0) continue;
      const t = terriers[k]!;
      let ux = -this.sx[k]!, uy = -this.sy[k]!;
      const u2 = ux * ux + uy * uy;
      if (u2 === 0) {
        dir(t.heading, d);
        ux = d[0]!; uy = d[1]!;
      } else {
        const len = Math.sqrt(u2);
        ux /= len; uy /= len;
      }
      const out = t.vx * ux + t.vy * uy;
      if (out < speed) {
        const add = speed - out;
        t.vx += add * ux;
        t.vy += add * uy;
      }
      t.slipping = true;
      t.slipFrom = this.sfrom[k]!;
      fired++;
    }
    this.stats.slipOuts += fired;
    return fired;
  }

  /** The direction of the push body k received from contact c, if any, as a
   *  binary angle; −1 when it was purely vertical. */
  pushDirection(c: number, k: number): number {
    const sign = this.ci[c] === k ? -1 : 1;
    const px = sign * this.cnx[c]!, py = sign * this.cny[c]!;
    if (px === 0 && py === 0) return -1;
    return datan2(py, px);
  }

  /** The surface distance between the bodies in two slots, from current positions. */
  gap(bodies: readonly (Body | null)[], i: number, j: number): number {
    const a = bodies[i]!, b = bodies[j]!;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - this.radius[i]! - this.radius[j]!;
  }

  /** Contact c's piece's surface, or −1 for a pair. */
  pieceSurface(c: number): number {
    const p = this.cp[c]!;
    return p < 0 ? -1 : this.pitch.pieces[p]!.surface;
  }
}

/** Reduces a body's horizontal speed by dv, to exactly 0. */
function slow(b: Body, dv: number): void {
  const sp2 = b.vx * b.vx + b.vy * b.vy;
  if (sp2 === 0) return;
  const sp = Math.sqrt(sp2);
  if (sp <= dv) {
    b.vx = 0;
    b.vy = 0;
    return;
  }
  const f = (sp - dv) / sp;
  b.vx *= f;
  b.vy *= f;
}
