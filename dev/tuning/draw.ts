// The tuning page's views (design §9.2), on canvas 2D, since three stays in
// src/render (D-38): the plan (x–y), from the pitch's outline, halves and
// goals, with each terrier's collider, heading and drawn box, the ball
// shaded by its height and, optionally, the contact normals and the
// velocities; the side elevation (x–z) at true scale, which shows hops,
// lifts, pinches and slip-outs; and a close-up 8 m wide round the ball, in
// elevation along the line from the nearest terrier, for a push's contact
// angle and the drawn box against the ball (D-27's fit).

import { ballSlot, LUNGING, type MatchState, slotOf, type Terrier, ZOOMING } from '../../src/core/sim/state';
import { PACKS } from '../../src/render/palette';
import { BOX_SIDE_METRES } from './model';
import { labelOf, type Run } from './scenarios';

export interface ViewOptions {
  readonly normals: boolean;
  readonly velocities: boolean;
  /** The keyboard's terrier, outlined, and the close-up's subject. */
  readonly focus: string | null;
}

const css = (rgb: number, alpha = 1): string => `rgba(${(rgb >> 16) & 255}, ${(rgb >> 8) & 255}, ${rgb & 255}, ${alpha})`;
const BACKGROUND = '#10141c';
const LINES = 'rgba(232, 236, 241, 0.75)';
const FAINT = 'rgba(232, 236, 241, 0.25)';
const NORMAL = '#ffd84a';

/** The canvas's 2D context, its backing store sized to its CSS box at the
 *  device's pixel ratio, drawing in CSS pixels. */
function fit(canvas: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } {
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.fillStyle = BACKGROUND;
  g.fillRect(0, 0, w, h);
  return { g, w, h };
}

function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, Math.max(r, 0.5), 0, 2 * Math.PI);
}

const headingAngle = (T: Readonly<Terrier>): number => (T.heading / 4294967296) * 2 * Math.PI;

/** How a terrier's state shows: dimmed when it can't act, and a ring for a
 *  lunge, a slip or zoomies. */
function terrierStyle(T: Readonly<Terrier>): { fill: string; ring: string | null } {
  const down = T.tumble > 0 || T.sitting;
  const fill = css(PACKS[T.pack].colour, down ? 0.4 : 0.9);
  const ring = T.lunge > 0 || T.anim === LUNGING ? '#ffe066' : T.slipping ? '#ff5cf0' : T.anim === ZOOMING ? '#7dffb0' : null;
  return { fill, ring };
}

// --- The plan ---

export function drawPlan(canvas: HTMLCanvasElement, run: Run, o: ViewOptions): void {
  const { g, w, h } = fit(canvas);
  const { P, s } = run;
  const pitch = P.pitch;
  const hx = pitch.goalLineX;
  const hy = pitch.shape.widthMetres / 2;
  const depth = pitch.shape.goalDepthMetres;
  const k = Math.min(w / (2 * (hx + depth + 0.6)), h / (2 * (hy + 0.6)));
  const X = (x: number): number => w / 2 + x * k;
  const Y = (y: number): number => h / 2 - y * k;
  const poly = (pts: readonly (readonly [number, number])[]): void => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(X(x), Y(y)) : g.lineTo(X(x), Y(y))));
    g.closePath();
  };
  for (const half of pitch.halves) {
    poly(half.outline);
    g.fillStyle = css(PACKS[half.pack].colour, 0.12);
    g.fill();
  }
  for (const goal of pitch.goals) {
    poly(goal.floor);
    g.fillStyle = css(PACKS[goal.pack].colour, 0.3);
    g.fill();
    g.strokeStyle = FAINT;
    g.stroke();
    const my = goal.mouthWidth / 2 + pitch.shape.postRadiusMetres;
    for (const side of [-1, 1]) {
      circle(g, X(goal.lineX), Y(side * my), pitch.shape.postRadiusMetres * k);
      g.fillStyle = LINES;
      g.fill();
    }
  }
  poly(pitch.outline);
  g.strokeStyle = LINES;
  g.lineWidth = 1.5;
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = FAINT;
  g.beginPath();
  g.moveTo(X(0), Y(-hy));
  g.lineTo(X(0), Y(hy));
  g.stroke();
  // The kickoff spots of this pack size, as faint crosses.
  for (const pack of [0, 1] as const) {
    for (const [x, y] of P.kickoffSpots[pack][s.packSize] ?? []) {
      g.strokeStyle = css(PACKS[pack].colour, 0.6);
      g.beginPath();
      g.moveTo(X(x) - 3, Y(y) - 3);
      g.lineTo(X(x) + 3, Y(y) + 3);
      g.moveTo(X(x) - 3, Y(y) + 3);
      g.lineTo(X(x) + 3, Y(y) - 3);
      g.stroke();
    }
  }
  const r = P.terrierRadius;
  const half = run.config.terrierLengthMetres / 2;
  const side = BOX_SIDE_METRES / 2;
  for (const T of s.terriers) {
    const a = headingAngle(T);
    const c = Math.cos(a), sn = Math.sin(a);
    // The drawn terrier's box, its length along the heading (D-4).
    g.beginPath();
    for (const [u, v] of [[half, side], [-half, side], [-half, -side], [half, -side]] as const) g.lineTo(X(T.x + u * c - v * sn), Y(T.y + u * sn + v * c));
    g.closePath();
    g.setLineDash([3, 3]);
    g.strokeStyle = css(PACKS[T.pack].colour, 0.8);
    g.stroke();
    g.setLineDash([]);
    const style = terrierStyle(T);
    circle(g, X(T.x), Y(T.y), r * k);
    g.fillStyle = style.fill;
    g.fill();
    if (T.id === o.focus || style.ring) {
      g.lineWidth = 2;
      g.strokeStyle = T.id === o.focus ? '#ffffff' : style.ring!;
      g.stroke();
      g.lineWidth = 1;
    }
    g.strokeStyle = '#000000';
    g.beginPath();
    g.moveTo(X(T.x), Y(T.y));
    g.lineTo(X(T.x + r * c), Y(T.y + r * sn));
    g.stroke();
    if (T.tumble > 0) {
      g.strokeStyle = '#ff4d4d';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(X(T.x - r), Y(T.y - r));
      g.lineTo(X(T.x + r), Y(T.y + r));
      g.moveTo(X(T.x - r), Y(T.y + r));
      g.lineTo(X(T.x + r), Y(T.y - r));
      g.stroke();
      g.lineWidth = 1;
    }
    g.fillStyle = LINES;
    g.font = '10px system-ui, sans-serif';
    g.fillText(`${labelOf(T)}${T.sitting ? ' sits' : ''}`, X(T.x) + r * k + 2, Y(T.y) - r * k);
    if (o.velocities) arrow(g, X(T.x), Y(T.y), X(T.x + 0.25 * T.vx), Y(T.y + 0.25 * T.vy), css(PACKS[T.pack].colour));
  }
  // The ball, lighter the higher it is.
  const b = s.ball;
  const R = P.ballRadius;
  const up = Math.max(0, Math.min(1, (b.z - R) / Math.max(pitch.shape.heightMetres - 2 * R, 1e-9)));
  circle(g, X(b.x), Y(b.y), R * k);
  g.fillStyle = `hsl(42, 30%, ${Math.round(55 + 40 * up)}%)`;
  g.fill();
  g.strokeStyle = '#000000';
  g.stroke();
  if (b.z > R + 0.01) {
    g.fillStyle = '#000000';
    g.font = '10px system-ui, sans-serif';
    g.fillText(`${b.z.toFixed(2)} m`, X(b.x) - 14, Y(b.y) + 3);
  }
  if (o.velocities) arrow(g, X(b.x), Y(b.y), X(b.x + 0.25 * b.vx), Y(b.y + 0.25 * b.vy), '#ffffff');
  if (o.normals) normals(g, run, (x, y) => [X(x), Y(y)], k, 'plan');
}

function arrow(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, colour: string): void {
  if (Math.hypot(x1 - x0, y1 - y0) < 1) return;
  g.strokeStyle = colour;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.lineTo(x1 - 5 * Math.cos(a - 0.4), y1 - 5 * Math.sin(a - 0.4));
  g.moveTo(x1, y1);
  g.lineTo(x1 - 5 * Math.cos(a + 0.4), y1 - 5 * Math.sin(a + 0.4));
  g.stroke();
}

/** The last substep's contacts: at each, a short line along its normal,
 *  from the first body's surface; in plan the floor's are left out. */
function normals(g: CanvasRenderingContext2D, run: Run, at: (x: number, z: number) => [number, number], k: number, view: 'plan' | 'side'): void {
  const ph = run.sim.physics;
  const s = run.s;
  const bodies = run.sim.bodies;
  const ball = ballSlot(s.packSize);
  g.strokeStyle = NORMAL;
  for (let c = 0; c < ph.cnt; c++) {
    const i = ph.ci[c]!;
    const body = bodies[i];
    if (!body) continue;
    const nx = ph.cnx[c]!, ny = ph.cny[c]!, nz = ph.cnz[c]!;
    if (view === 'plan' && Math.abs(nz) > 0.999) continue;
    const r = i === ball ? run.P.ballRadius : run.P.terrierRadius;
    const px = body.x + r * nx, py = body.y + r * ny, pz = body.z + r * nz;
    const [x0, y0] = view === 'plan' ? at(px, py) : at(px, pz);
    const len = 0.4 * k;
    const [dx, dy] = view === 'plan' ? [nx, -ny] : [nx, -nz];
    g.beginPath();
    g.moveTo(x0 - dx * len, y0 - dy * len);
    g.lineTo(x0 + dx * len, y0 + dy * len);
    g.stroke();
    circle(g, x0, y0, 1.5);
    g.fillStyle = NORMAL;
    g.fill();
  }
}

// --- The side elevation ---

export function drawSide(canvas: HTMLCanvasElement, run: Run, o: ViewOptions): void {
  const { g, w, h } = fit(canvas);
  const { P, s } = run;
  const shape = P.pitch.shape;
  const hx = P.pitch.goalLineX;
  const H = shape.heightMetres;
  const depth = shape.goalDepthMetres;
  const k = Math.min(w / (2 * (hx + depth + 0.6)), h / (H + 0.8));
  const X = (x: number): number => w / 2 + x * k;
  const Z = (z: number): number => h - 0.4 * k - z * k;
  const line = (x0: number, z0: number, x1: number, z1: number, style: string, dash: number[] = []): void => {
    g.setLineDash(dash);
    g.strokeStyle = style;
    g.beginPath();
    g.moveTo(X(x0), Z(z0));
    g.lineTo(X(x1), Z(z1));
    g.stroke();
    g.setLineDash([]);
  };
  line(-hx, 0, hx, 0, LINES);
  line(-hx, H, hx, H, FAINT, [4, 4]);
  const MH = shape.mouthHeightMetres;
  const PR = shape.postRadiusMetres;
  for (const side of [-1, 1]) {
    line(side * hx, MH + 2 * PR, side * hx, H, LINES);
    line(side * hx, 0, side * hx, MH, FAINT, [2, 3]);
    circle(g, X(side * hx), Z(MH + PR), PR * k);
    g.fillStyle = LINES;
    g.fill();
    line(side * (hx + depth), 0, side * (hx + depth), MH, FAINT);
    line(side * hx, MH, side * (hx + depth), MH, FAINT);
    line(side * hx, 0, side * (hx + depth), 0, FAINT);
  }
  const r = P.terrierRadius;
  for (const T of s.terriers) {
    const style = terrierStyle(T);
    circle(g, X(T.x), Z(T.z), r * k);
    g.fillStyle = style.fill;
    g.fill();
    if (T.id === o.focus || style.ring) {
      g.strokeStyle = T.id === o.focus ? '#ffffff' : style.ring!;
      g.stroke();
    }
  }
  const b = s.ball;
  circle(g, X(b.x), Z(b.z), P.ballRadius * k);
  g.fillStyle = 'hsla(42, 30%, 75%, 0.85)';
  g.fill();
  g.strokeStyle = '#000000';
  g.stroke();
  if (o.normals) normals(g, run, (x, z) => [X(x), Z(z)], k, 'side');
}

// --- The close-up ---

/** The close-up's subject: the focused terrier, or the one nearest the ball. */
function subject(s: Readonly<MatchState>, focus: string | null): Readonly<Terrier> | undefined {
  const b = s.ball;
  const d2 = (T: Readonly<Terrier>): number => (T.x - b.x) ** 2 + (T.y - b.y) ** 2;
  return s.terriers.find((T) => T.id === focus) ?? [...s.terriers].sort((p, q) => d2(p) - d2(q))[0];
}

/** Draws the close-up and returns its readout: the subject's contact angle,
 *  and how far its drawn box clears the ball or enters it, in elevation. */
export function drawClose(canvas: HTMLCanvasElement, run: Run, o: ViewOptions): string {
  const { g, w, h } = fit(canvas);
  const { P, s } = run;
  const b = s.ball;
  const R = P.ballRadius;
  const r = P.terrierRadius;
  const half = run.config.terrierLengthMetres / 2;
  const T0 = subject(s, o.focus);
  let ux = 1, uy = 0;
  if (T0) {
    const dx = b.x - T0.x, dy = b.y - T0.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-9) {
      ux = dx / d;
      uy = dy / d;
    }
  }
  const k = Math.min(w / 8, h / 4.2);
  const X = (u: number): number => w / 2 + u * k;
  const Z = (z: number): number => h - 0.2 * k - z * k;
  g.strokeStyle = LINES;
  g.beginPath();
  g.moveTo(0, Z(0));
  g.lineTo(w, Z(0));
  g.stroke();
  circle(g, X(0), Z(b.z), R * k);
  g.fillStyle = 'hsla(42, 30%, 75%, 0.85)';
  g.fill();
  g.strokeStyle = '#000000';
  g.stroke();
  let note = T0 ? `along ${labelOf(T0)} to the ball` : 'no terrier';
  const ball = ballSlot(s.packSize);
  for (const T of s.terriers) {
    const along = (T.x - b.x) * ux + (T.y - b.y) * uy;
    const across = -(T.x - b.x) * uy + (T.y - b.y) * ux;
    if (Math.abs(along) > 4.5 || Math.abs(across) > 1.5) continue;
    const fade = 1 - Math.abs(across) / 2;
    const phi = headingAngle(T) - Math.atan2(uy, ux);
    const extent = half * Math.abs(Math.cos(phi)) + (BOX_SIDE_METRES / 2) * Math.abs(Math.sin(phi));
    // The box stands on the floor under the collider: from its foot up D-4's 0.5 m.
    const foot = T.z - r;
    g.setLineDash([3, 3]);
    g.strokeStyle = css(PACKS[T.pack].colour, fade);
    g.strokeRect(X(along - extent), Z(foot + BOX_SIDE_METRES), 2 * extent * k, BOX_SIDE_METRES * k);
    g.setLineDash([]);
    circle(g, X(along), Z(T.z), r * k);
    g.fillStyle = css(PACKS[T.pack].colour, 0.85 * fade);
    g.fill();
    if (T !== T0) continue;
    // The contact line, and the drawn box's nearest point to the ball's centre.
    const dz = b.z - T.z;
    const touching = run.sim.physics.cnt > 0 && contactWithBall(run, slotOf(T), ball);
    const angle = (Math.atan2(dz, -along) * 180) / Math.PI;
    const nx = Math.max(along - extent, Math.min(0, along + extent));
    const nz = Math.max(foot, Math.min(b.z, foot + BOX_SIDE_METRES));
    const clear = Math.hypot(nx, nz - b.z) - R;
    g.strokeStyle = touching ? NORMAL : FAINT;
    g.beginPath();
    g.moveTo(X(along), Z(T.z));
    g.lineTo(X(0), Z(b.z));
    g.stroke();
    note = `${labelOf(T)}: the line to the ball's centre ${angle.toFixed(1)}° up, ${(90 - angle).toFixed(1)}° from vertical${touching ? ', touching' : ''}; its drawn box ${clear >= 0 ? `clears the ball by ${(100 * clear).toFixed(1)} cm` : `enters the ball by ${(-100 * clear).toFixed(1)} cm`} in this plane`;
  }
  return note;
}

function contactWithBall(run: Run, slot: number, ball: number): boolean {
  const ph = run.sim.physics;
  for (let c = 0; c < ph.cnt; c++) if (ph.ci[c] === slot && ph.cj[c] === ball) return true;
  return false;
}
