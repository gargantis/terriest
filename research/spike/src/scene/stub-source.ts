// A deterministic stand-in for the spike's simulation, so the scene can be
// built and measured before integration. It satisfies the contract and
// nothing more: no contacts are solved. The ball follows a scripted path
// with hops and floor bounces, the terriers chase it from their own side,
// and each terrier runs through every animation phase on a fixed schedule.
//
// It is deterministic in one engine: the same sequence of advance() calls
// gives the same views, and advance(3) equals three advance(1) calls. It
// uses Math.sin and friends, so it isn't bit-identical across engines;
// only src/sim has to be (PLAN D-1).

import { TICK_RATE, type AnimPhase, type BallView, type MatchView, type Pack, type SimSource, type TerrierView } from '../contract';

const TURN = 4294967296;
const DT = 1 / TICK_RATE;
const GRAVITY = 9.8;
const RUN = 6;
const ZOOM = 9;
const ACCEL = 15;
const IDLE_FRICTION = 8;
const TURN_PER_TICK = Math.round((2 * TURN) / TICK_RATE); // 2 turns a second
const TERRIER_R = 0.25;
const BALL_R = 0.8;
const STRIDE = 0.5; // metres run per gait cycle
const COATS = 8;

type Action = 'jump' | 'zoom' | 'lunge' | 'tumble' | 'sit';
const ACTIONS: readonly Action[] = ['zoom', 'jump', 'lunge', 'tumble', 'sit', 'jump', 'zoom'];

interface StubTerrier extends TerrierView {
  /** The phase that ends on its own at this tick (zooming, lunging, tumbled, gettingUp, sitting), or -1. */
  phaseEndTick: number;
  nextActionTick: number;
  actionIndex: number;
  wander: number;
}

/** A binary angle from a direction, for the stub only (render-side maths). */
function angleOf(y: number, x: number): number {
  const a = Math.atan2(y, x) / (2 * Math.PI);
  return Math.round((a < 0 ? a + 1 : a) * TURN) % TURN;
}

export class StubSource implements SimSource {
  readonly packSize: number;
  private tick = 0;
  private readonly terriers: StubTerrier[] = [];
  private readonly ball: BallView;
  private ballVz = 0;
  private lastGoal: { tick: number; pack: Pack } | null = null;

  constructor(packSize = 4) {
    if (!Number.isInteger(packSize) || packSize < 1 || packSize > 4) throw new Error(`pack size ${packSize} is outside 1-4`);
    this.packSize = packSize;
    // (spot, pack) order, as the canonical state lists them (PLAN A.1).
    for (let spot = 0; spot < packSize; spot++) {
      for (const pack of [0, 1] as const) {
        const i = spot * 2 + pack;
        const side = pack === 0 ? -1 : 1;
        const x = side * (8 + 2 * spot);
        const y = (spot % 2 === 0 ? 1 : -1) * (spot === 0 ? 0 : 2 + spot * 1.5);
        this.terriers.push({
          pack, spot, coat: (i * 3 + 1) % COATS,
          x, y, z: TERRIER_R, vx: 0, vy: 0, vz: 0,
          heading: angleOf(-y, -x), phase: 'standing', phaseStartTick: 0, gait: 0, lastBallContactTick: -1,
          phaseEndTick: -1,
          nextActionTick: 150 + 47 * i,
          actionIndex: i % ACTIONS.length,
          wander: 1.3 * i,
        });
      }
    }
    this.ball = { x: 0, y: 0, z: BALL_R, vx: 0, vy: 0, vz: 0, lastHitTick: -1, lastHitStrength: 0 };
    this.placeBall(0);
  }

  view(): MatchView {
    const v: MatchView = {
      tick: this.tick,
      terriers: this.terriers.map((t) => ({
        pack: t.pack, spot: t.spot, coat: t.coat,
        x: t.x, y: t.y, z: t.z, vx: t.vx, vy: t.vy, vz: t.vz,
        heading: t.heading, phase: t.phase, phaseStartTick: t.phaseStartTick, gait: t.gait,
        lastBallContactTick: t.lastBallContactTick,
      })),
      ball: { ...this.ball },
    };
    if (this.lastGoal) v.lastGoal = { ...this.lastGoal };
    return v;
  }

  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  /** The ball's horizontal path: a slow figure over most of the pitch. */
  private placeBall(tick: number): void {
    const t = tick * DT;
    const w1 = (2 * Math.PI) / 37;
    const w2 = (2 * Math.PI) / 23;
    this.ball.x = 14 * Math.sin(w1 * t);
    this.ball.y = 8 * Math.sin(w2 * t + 0.5);
    this.ball.vx = 14 * w1 * Math.cos(w1 * t);
    this.ball.vy = 8 * w2 * Math.cos(w2 * t + 0.5);
  }

  private step(): void {
    const tick = ++this.tick;
    const b = this.ball;
    this.placeBall(tick);

    // The ball's height: ballistic, a hop every 6 s, bouncing at 70% above
    // 0.3 m/s (as D-5's threshold), resting exactly on the floor below it.
    if (tick % 360 === 0) this.ballVz = 3.5;
    if (b.z > BALL_R || this.ballVz > 0) {
      this.ballVz -= GRAVITY * DT;
      b.z += this.ballVz * DT;
      if (b.z <= BALL_R) {
        const closing = -this.ballVz;
        b.z = BALL_R;
        if (closing > 0.3) {
          this.ballVz = 0.7 * closing;
          this.hit(tick, closing);
        } else this.ballVz = 0;
      }
    }
    b.vz = this.ballVz;

    // A goal every 25 s, alternating packs, for the net's bulge.
    if (tick % 1500 === 0) this.lastGoal = { tick, pack: ((tick / 1500) % 2) as Pack };

    for (const t of this.terriers) this.stepTerrier(t, tick);
    this.separate();
  }

  private hit(tick: number, strength: number): void {
    this.ball.lastHitTick = tick;
    this.ball.lastHitStrength = strength;
  }

  private setPhase(t: StubTerrier, phase: AnimPhase, tick: number, endTick = -1): void {
    if (t.phase !== phase) {
      t.phase = phase;
      t.phaseStartTick = tick;
    }
    t.phaseEndTick = endTick;
  }

  private stepTerrier(t: StubTerrier, tick: number): void {
    const b = this.ball;
    const onFloor = t.z <= TERRIER_R && t.vz <= 0;

    // Phases that end on their own.
    if (t.phaseEndTick >= 0 && tick >= t.phaseEndTick) {
      if (t.phase === 'tumbled') this.setPhase(t, 'gettingUp', tick, tick + 30);
      else this.setPhase(t, 'standing', tick);
    }

    // The schedule: one action every 4-6 s, from the floor only.
    if (tick >= t.nextActionTick && onFloor && (t.phase === 'standing' || t.phase === 'running')) {
      const action = ACTIONS[t.actionIndex % ACTIONS.length] ?? 'zoom';
      t.actionIndex++;
      t.nextActionTick = tick + 240 + 60 * ((t.spot * 7 + t.pack * 3 + t.actionIndex) % 3);
      if (action === 'jump') {
        t.vz = Math.sqrt(2 * GRAVITY * 1);
        t.z += t.vz * DT * 0.5;
        this.setPhase(t, 'airborne', tick);
      } else if (action === 'zoom') this.setPhase(t, 'zooming', tick, tick + 120);
      else if (action === 'lunge') {
        const h = (t.heading / TURN) * 2 * Math.PI;
        t.vx = 10 * Math.cos(h);
        t.vy = 10 * Math.sin(h);
        this.setPhase(t, 'lunging', tick, tick + 18);
      } else if (action === 'tumble') this.setPhase(t, 'tumbled', tick, tick + 60);
      else this.setPhase(t, 'sitting', tick, tick + 120);
    }

    // Where it wants to be: behind the ball from its own goal, spread by spot.
    const side = t.pack === 0 ? -1 : 1;
    const spread = (t.spot - (this.packSize - 1) / 2) * 1.6;
    const wobble = Math.sin(tick * DT * 0.7 + t.wander);
    const tx = b.x + side * (1.6 + 1.2 * t.spot + 0.6 * wobble);
    const ty = b.y + spread + 0.8 * Math.cos(tick * DT * 0.5 + t.wander);

    const drives = t.phase === 'standing' || t.phase === 'running' || t.phase === 'zooming';
    if (t.phase === 'airborne') {
      t.vz -= GRAVITY * DT;
    } else if (drives && onFloor) {
      const dx = tx - t.x;
      const dy = ty - t.y;
      const d = Math.hypot(dx, dy);
      const top = t.phase === 'zooming' ? ZOOM : RUN;
      const want = Math.min(top, d * 2.5);
      const wx = d > 1e-9 ? (dx / d) * want : 0;
      const wy = d > 1e-9 ? (dy / d) * want : 0;
      let ex = wx - t.vx;
      let ey = wy - t.vy;
      const e = Math.hypot(ex, ey);
      const most = ACCEL * DT;
      if (e > most) {
        ex = (ex / e) * most;
        ey = (ey / e) * most;
      }
      t.vx += ex;
      t.vy += ey;
    } else if (t.phase !== 'lunging') {
      // Idle friction: tumbled, getting up or sitting.
      const s = Math.hypot(t.vx, t.vy);
      const slower = Math.max(0, s - IDLE_FRICTION * DT);
      t.vx = s > 0 ? (t.vx / s) * slower : 0;
      t.vy = s > 0 ? (t.vy / s) * slower : 0;
    }

    t.x += t.vx * DT;
    t.y += t.vy * DT;
    t.z += t.vz * DT;
    if (t.z <= TERRIER_R) {
      t.z = TERRIER_R;
      if (t.vz < 0) t.vz = 0;
      if (t.phase === 'airborne') this.setPhase(t, 'standing', tick);
    }
    // Inside the walls and the cut corners (|x| + |y| <= 30), with room.
    const lim = 19.6 - TERRIER_R;
    t.x = Math.max(-lim, Math.min(lim, t.x));
    t.y = Math.max(-(13.6 - TERRIER_R), Math.min(13.6 - TERRIER_R, t.y));
    const over = Math.abs(t.x) + Math.abs(t.y) - (29.4 - TERRIER_R);
    if (over > 0) {
      t.x -= Math.sign(t.x) * over * 0.5;
      t.y -= Math.sign(t.y) * over * 0.5;
    }

    // Turning toward its motion at 2 turns a second, integer binary angles;
    // a lunge locks the heading (D-6), a tumble or a sit keeps it.
    const speed = Math.hypot(t.vx, t.vy);
    if (speed > 0.3 && (drives || t.phase === 'airborne')) {
      const want = angleOf(t.vy, t.vx);
      const diff = ((want - t.heading + TURN + TURN / 2) % TURN) - TURN / 2;
      const turn = Math.max(-TURN_PER_TICK, Math.min(TURN_PER_TICK, diff));
      t.heading = (t.heading + turn + TURN) % TURN;
    }

    // The gait advances by the distance run (D-9).
    if (onFloor) t.gait = (t.gait + Math.round(((speed * DT) / STRIDE) * TURN)) % TURN;

    if (t.phase === 'standing' && speed > 0.4) this.setPhase(t, 'running', tick);
    else if (t.phase === 'running' && speed < 0.25) this.setPhase(t, 'standing', tick);
  }

  /** Keeps terriers apart and out of the ball, and records ball contacts. */
  private separate(): void {
    const b = this.ball;
    const ts = this.terriers;
    for (let i = 0; i < ts.length; i++) {
      const a = ts[i]!;
      for (let j = i + 1; j < ts.length; j++) {
        const c = ts[j]!;
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = 2 * TERRIER_R;
        if (d < min && d > 1e-9) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          c.x += (dx / d) * push;
          c.y += (dy / d) * push;
        }
      }
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      const d = Math.hypot(dx, dy, dz);
      const min = TERRIER_R + BALL_R;
      if (d < min + 0.02) {
        if (a.lastBallContactTick !== this.tick && a.lastBallContactTick < this.tick - 30) {
          const closing = Math.max(0, -((a.vx - b.vx) * dx + (a.vy - b.vy) * dy) / Math.max(d, 1e-9));
          if (closing > 0.5) this.hit(this.tick, closing);
        }
        a.lastBallContactTick = this.tick;
        const h = Math.hypot(dx, dy);
        if (d < min && h > 1e-9) {
          // Out of the ball, horizontally, as a floor-bound stand-in for a contact.
          const need = Math.sqrt(Math.max(0, min * min - dz * dz));
          a.x = b.x + (dx / h) * need;
          a.y = b.y + (dy / h) * need;
        }
      }
    }
  }
}
