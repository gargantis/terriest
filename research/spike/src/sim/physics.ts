// The contact solver of PLAN D-5, one substep at a time, in its steps:
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
//   7. slip-out: the rule chosen in the configuration;
//   8. touches and the goal test are the caller's (step.ts), from the
//      contact list this module leaves.
// Exact operations only (D-1).
//
// Mirror pairs. Bodies are terriers in (spot, pack) order, A1, B1, A2, B2 …,
// then the ball, so a body's point mirror is index ^ 1 and the ball's is
// itself. A contact's mirror joins the mirrors of its bodies (or of its
// body and its piece). The contact list is a list of slots, each a contact
// and its mirror, or one contact that is its own mirror: A1 against B1, the
// ball against the floor. Both contacts of a slot are computed from the same
// velocities (or positions) and applied together, so a mirrored state's
// impulses are exact mirror images and stay so, and a sum over mirrored
// partners cancels exactly. A slot holds one contact when its mirror isn't
// touching, which happens only off mirror.
//
// The floor is a piece like any other in the list (D-4). Step 4 supports
// and bounces bodies on it before the impulses, so its own contacts in
// steps 5 and 6 have no restitution: they only keep other contacts from
// pressing a body into it.

import { datan2, dir } from './angle.ts';
import { checkSolver, type SimConfig, substepDt } from './config.ts';
import { FLOOR, GOAL_NET, type PieceHit, pieceContact, type Pitch } from './pitch.ts';
import type { Body, Terrier } from './state.ts';

const PAIR = 0;
const PIECE = 1;

/** Counters for the cost runs and the reports (run 3). */
export interface SolverStats {
  substeps: number;
  contacts: number; // summed over substeps
  floorContacts: number; // of those, against the floor
  maxContacts: number;
  slipOuts: number; // terrier-substeps a slip-out fired on
}

export function newStats(): SolverStats {
  return { substeps: 0, contacts: 0, floorContacts: 0, maxContacts: 0, slipOuts: 0 };
}

export class Physics {
  readonly n: number; // bodies: terriers, then the ball
  readonly ball: number; // the ball's index
  private readonly C: SimConfig;
  /** One substep, from the configuration's substeps a tick (D-3). */
  private readonly dt: number;
  private readonly pitch: Pitch;
  private readonly radius: Float64Array;
  private readonly invMass: Float64Array;
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
  // This substep's contacts, in slot order.
  cnt = 0;
  ci: Int32Array; // first body
  cj: Int32Array; // second body, or −1 for a piece
  cp: Int32Array; // the piece, or −1
  cnx: Float64Array; // unit normal from ci toward cj, or from ci into the piece
  cny: Float64Array;
  cnz: Float64Array;
  closing: Float64Array; // closing speed at the start of the substep
  private ctarget: Float64Array;
  private cmeff: Float64Array;
  clambda: Float64Array; // accumulated normal impulse
  private cnoBounce: Uint8Array; // within the slip-out cone, under restitution0
  nslots = 0;
  private slotStart: Int32Array;
  private slotLen: Uint8Array;
  private readonly hit: PieceHit = { nx: 0, ny: 0, nz: 0, depth: 0 };
  private readonly hit2: PieceHit = { nx: 0, ny: 0, nz: 0, depth: 0 };
  private readonly d2 = new Float64Array(2);
  // Slip-out scratch: per terrier, the summed horizontal offset of the
  // bodies above it within the cone, and which body it slips from.
  private readonly sx: Float64Array;
  private readonly sy: Float64Array;
  private readonly sfrom: Int32Array;
  private readonly sfire: Uint8Array;
  // The broad phase: per body, whether it can reach any piece but the floor
  // and the overhead net this substep. A body clear of the walls, the cut
  // corners and the end-wall plane (posts included) by more than its reach
  // can't, so its other piece tests are skipped: the same contacts, cheaper.
  private readonly near: Uint8Array;
  private readonly clearX: Float64Array; // per body: |x| below this is clear
  private readonly clearY: Float64Array;
  private readonly clearCut: Float64Array; // the corner-line sum above the cut
  readonly stats: SolverStats = newStats();

  constructor(C: SimConfig, pitch: Pitch, terriers: number) {
    checkSolver(C);
    this.C = C;
    this.dt = substepDt(C);
    this.pitch = pitch;
    const n = terriers + 1;
    this.n = n;
    this.ball = terriers;
    this.radius = new Float64Array(n);
    this.invMass = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const isBall = k === terriers;
      this.radius[k] = isBall ? C.ballRadius : C.terrierRadius;
      this.invMass[k] = 1 / (isBall ? C.ballMass : C.terrierMass);
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
    const shape = pitch.shape;
    const MARGIN = 0.01;
    for (let k = 0; k < n; k++) {
      const r = this.radius[k]!;
      this.clearX[k] = shape.length / 2 - r - shape.postRadius - MARGIN;
      this.clearY[k] = shape.width / 2 - r - MARGIN;
      this.clearCut[k] = (r + MARGIN) * Math.sqrt(2);
    }
    const mirror = (k: number): number => (k === terriers ? k : k ^ 1);
    const kind: number[] = [], A: number[] = [], B: number[] = [], MA: number[] = [], MB: number[] = [];
    const P = pitch.pieces.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let mi = mirror(i), mj = mirror(j);
        if (mi > mj) { const t = mi; mi = mj; mj = t; }
        if (mi < i || (mi === i && mj < j)) continue; // covered as an earlier pair's mirror
        const self = mi === i && mj === j;
        kind.push(PAIR); A.push(i); B.push(j); MA.push(self ? -1 : mi); MB.push(self ? -1 : mj);
      }
      for (let p = 0; p < P; p++) {
        const mi = mirror(i), mp = pitch.pieces[p]!.mirror;
        if (mi < i || (mi === i && mp < p)) continue;
        const self = mi === i && mp === p;
        kind.push(PIECE); A.push(i); B.push(p); MA.push(self ? -1 : mi); MB.push(self ? -1 : mp);
      }
    }
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
    const cap = 64;
    this.ci = new Int32Array(cap); this.cj = new Int32Array(cap); this.cp = new Int32Array(cap);
    this.cnx = new Float64Array(cap); this.cny = new Float64Array(cap); this.cnz = new Float64Array(cap);
    this.closing = new Float64Array(cap); this.ctarget = new Float64Array(cap);
    this.cmeff = new Float64Array(cap); this.clambda = new Float64Array(cap);
    this.cnoBounce = new Uint8Array(cap);
    this.slotStart = new Int32Array(cap); this.slotLen = new Uint8Array(cap);
  }

  /** How many slot templates the fixed order has (for reports). */
  get templates(): number {
    return this.tKind.length;
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
    this.cnoBounce = g8(this.cnoBounce);
    this.slotStart = g32(this.slotStart); this.slotLen = g8(this.slotLen);
  }

  /** Steps 1 and 2: forces, then semi-implicit Euler. Also snapshots each
   *  body's velocity at the start of the substep, for restitution. */
  forcesAndIntegrate(bodies: readonly Body[], terriers: readonly Terrier[]): void {
    const C = this.C;
    const n = this.n;
    const dt = this.dt;
    for (let k = 0; k < n; k++) {
      const b = bodies[k]!;
      this.v0x[k] = b.vx; this.v0y[k] = b.vy; this.v0z[k] = b.vz;
    }
    const g = C.gravity * dt;
    for (let k = 0; k < n - 1; k++) {
      const t = terriers[k]!;
      if (t.onFloor && t.lunge === 0) {
        if (t.driveOn) {
          if (C.drive) this.drive(t, bodies);
        } else if (C.friction) {
          slow(t, C.idleFriction * dt);
        }
      }
      t.vz -= g;
    }
    const ball = bodies[n - 1]!;
    if (ball.onFloor && C.rolling) slow(ball, C.rollingSlowdown * dt);
    ball.vz -= g;
    for (let k = 0; k < n; k++) {
      const b = bodies[k]!;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
    }
  }

  /** D-6's drive: the horizontal velocity moves toward the target by at most
   *  accel × dt. A slipping terrier's drive is held off toward the body it
   *  slips from (D-5 step 7's flag). */
  private drive(t: Terrier, bodies: readonly Body[]): void {
    let dx = t.targetVx - t.vx;
    let dy = t.targetVy - t.vy;
    const cap = this.C.accel * this.dt;
    const d2 = dx * dx + dy * dy;
    if (d2 > cap * cap) {
      const f = cap / Math.sqrt(d2);
      dx *= f;
      dy *= f;
    }
    if (t.slipping && t.slipFrom >= 0) {
      const above = bodies[t.slipFrom]!;
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
    t.vx += dx;
    t.vy += dy;
  }

  /** Step 3: detect, into slots in the fixed mirror-symmetric order. */
  detect(bodies: readonly Body[]): void {
    this.cnt = 0;
    this.nslots = 0;
    const [c0, c1, c2, c3] = this.pitch.shape.cuts;
    const hx = this.pitch.shape.length / 2;
    const hy = this.pitch.shape.width / 2;
    for (let k = 0; k < this.n; k++) {
      const b = bodies[k]!;
      const ax = b.x < 0 ? -b.x : b.x;
      const ay = b.y < 0 ? -b.y : b.y;
      const cut = this.clearCut[k]!;
      this.near[k] = ax >= this.clearX[k]! || ay >= this.clearY[k]! ||
        b.x + hx + (b.y + hy) - c0 <= cut || hx - b.x + (b.y + hy) - c1 <= cut ||
        hx - b.x + (hy - b.y) - c2 <= cut || b.x + hx + (hy - b.y) - c3 <= cut ? 1 : 0;
    }
    const T = this.tKind.length;
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

  private pair(bodies: readonly Body[], i: number, j: number): void {
    const a = bodies[i]!, b = bodies[j]!;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const rs = this.radius[i]! + this.radius[j]!;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > rs * rs) return;
    const d = Math.sqrt(d2);
    // Coincident centres take +z as their normal (D-5 step 3).
    if (d === 0) this.add(i, j, -1, 0, 0, 1);
    else this.add(i, j, -1, dx / d, dy / d, dz / d);
  }

  private piece(bodies: readonly Body[], i: number, p: number): void {
    if (p === 0 && !this.C.floorInSolve) return; // the floor is piece 0
    const b = bodies[i]!;
    const h = this.hit;
    if (!pieceContact(this.pitch.pieces[p]!, b.x, b.y, b.z, this.radius[i]!, h)) return;
    // Stored pointing from the body into the piece, so (v_j − v_i)·n is the
    // separating speed for pairs and pieces alike, with a piece at rest.
    this.add(i, -1, p, -h.nx, -h.ny, -h.nz);
  }

  /** Step 4: the floor as support. Sets onFloor, and returns the ball's
   *  closing speed if it bounced this substep, or 0. */
  support(bodies: readonly Body[]): number {
    const C = this.C;
    const n = this.n;
    let bounce = 0;
    for (let k = 0; k < n; k++) {
      const b = bodies[k]!;
      const r = this.radius[k]!;
      if (b.z <= r && b.vz <= 0) {
        if (k === n - 1 && -b.vz > C.restitutionThreshold) {
          bounce = -b.vz;
          b.vz = bounce * C.ballSurface;
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
    return bounce;
  }

  /** Sets each contact's restitution target and effective mass, from the
   *  velocities at the start of the substep. Call after support(). */
  prepare(): void {
    const C = this.C;
    const ballK = this.n - 1;
    const slip = C.slipOut;
    for (let c = 0; c < this.cnt; c++) {
      const i = this.ci[c]!, j = this.cj[c]!;
      const nx = this.cnx[c]!, ny = this.cny[c]!, nz = this.cnz[c]!;
      let closing: number;
      let e: number;
      let wj = 0;
      let noBounce = 0;
      if (j >= 0) {
        closing = (this.v0x[i]! - this.v0x[j]!) * nx + (this.v0y[i]! - this.v0y[j]!) * ny + (this.v0z[i]! - this.v0z[j]!) * nz;
        e = i === ballK || j === ballK ? C.terrierBall : C.terrierTerrier;
        wj = this.invMass[j]!;
        if (slip.restitution0) {
          // A body above a terrier within the cone: j above terrier i, or i above terrier j.
          if ((nz > slip.cosCone && i !== ballK) || (-nz > slip.cosCone && j !== ballK)) { e = 0; noBounce = 1; }
        }
      } else {
        closing = this.v0x[i]! * nx + this.v0y[i]! * ny + this.v0z[i]! * nz;
        const surface = this.pitch.pieces[this.cp[c]!]!.surface;
        if (surface === FLOOR) e = 0; // step 4 did the floor's bounce
        else if (i === ballK) e = surface === GOAL_NET ? C.ballGoalNet : C.ballSurface;
        else e = C.terrierSurface;
      }
      this.closing[c] = closing;
      this.ctarget[c] = closing > C.restitutionThreshold ? e * closing : 0;
      this.cmeff[c] = 1 / (this.invMass[i]! + wj);
      this.cnoBounce[c] = noBounce;
    }
  }

  /** Step 5: accumulated, clamped normal impulses, Gauss–Seidel over slots,
   *  each iteration a forward sweep and a back sweep. */
  solve(bodies: readonly Body[]): void {
    const iters = this.C.iterations;
    const ns = this.nslots;
    for (let it = 0; it < iters; it++) {
      for (let s = 0; s < ns; s++) this.solveSlot(bodies, s);
      for (let s = ns - 1; s >= 0; s--) this.solveSlot(bodies, s);
    }
  }

  private solveSlot(bodies: readonly Body[], s: number): void {
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
  private impulseStep(bodies: readonly Body[], c: number): number {
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

  private applyImpulse(bodies: readonly Body[], c: number, d: number): void {
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
  positions(bodies: readonly Body[]): void {
    const passes = this.C.positionPasses;
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
  private overlap(bodies: readonly Body[], c: number, out: PieceHit): boolean {
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
    if (!pieceContact(this.pitch.pieces[this.cp[c]!]!, a.x, a.y, a.z, this.radius[i]!, out)) return false;
    if (!(out.depth > 0)) return false;
    out.nx = -out.nx; out.ny = -out.ny; out.nz = -out.nz;
    return true;
  }

  private move(bodies: readonly Body[], c: number, o: PieceHit): void {
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

  /** Step 7: a ball or terrier resting above a terrier within the rule's
   *  cone doesn't stay up. Decided from the positions after step 6, all
   *  found before any is applied: each such terrier on the floor moves out
   *  sideways at the rule's speed, away from the combined horizontal offset
   *  of the bodies above it, or along its heading if exactly centred. A
   *  ball below a terrier is an ordinary contact. Returns how many fired. */
  slipOut(bodies: readonly Body[], terriers: readonly Terrier[]): number {
    const rule = this.C.slipOut;
    if (rule.speed <= 0) return 0;
    const n = this.n;
    const ballK = n - 1;
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
      if (dz > 0 && dz / d > rule.cosCone && i !== ballK) { lower = i; upper = j; ox = dx; oy = dy; }
      else if (dz < 0 && -dz / d > rule.cosCone && j !== ballK) { lower = j; upper = i; ox = -dx; oy = -dy; }
      if (lower < 0 || !bodies[lower]!.onFloor) continue;
      this.sx[lower] = this.sx[lower]! + ox;
      this.sy[lower] = this.sy[lower]! + oy;
      this.sfire[lower] = 1;
      // It slips from the ball if the ball is above it, else the first found.
      if (this.sfrom[lower]! < 0 || upper === ballK) this.sfrom[lower] = upper;
    }
    let fired = 0;
    const d = this.d2;
    for (let k = 0; k < n - 1; k++) {
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
      if (out < rule.speed) {
        const add = rule.speed - out;
        t.vx += add * ux;
        t.vy += add * uy;
      }
      if (rule.flag) {
        t.slipping = true;
        t.slipFrom = this.sfrom[k]!;
      }
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

  /** Whether body k is in contact c (as either side). */
  involves(c: number, k: number): boolean {
    return this.ci[c] === k || this.cj[c] === k;
  }

  /** The surface distance between two bodies, from current positions. */
  gap(bodies: readonly Body[], i: number, j: number): number {
    const a = bodies[i]!, b = bodies[j]!;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - this.radius[i]! - this.radius[j]!;
  }

  /** Whether contact c was within the slip-out cone under restitution0. */
  noBounce(c: number): boolean {
    return this.cnoBounce[c] === 1;
  }

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

