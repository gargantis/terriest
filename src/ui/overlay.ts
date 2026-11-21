// The marks over the pitch (M4's design, research/m4/DESIGN.md, §1.45, §2.5,
// §2.6, §3.3, §5.14; PLAN §12, D-28; L50, L52, L90, M4-Q10): DOM over the
// canvas, placed each frame from the stage's projections (FrameOut),
// aria-hidden, since the HUD says the same. Phase 1's (shell):
// - your terrier's mark, a chevron above it that needs no colour to see
//   (L52);
// - the off-screen ball's arrow at the canvas's edge, inset from it, below
//   the HUD's top bar at the top, and pointing the way to the ball: the one
//   way to find it when chase view faces away from it (D-28, L90);
// - a bark mark over every terrier the frame's drawer input shows barking
//   (L50, §2.5): yours from the press, the bots' from their recorded inputs,
//   each bark counted once in the app's log (barksShown), as each goal's
//   celebration the drawer input starts is (celebrationsShown).
// Your mark and the arrow stack over the HUD and Pre-match's panel, so
// they always show (L52, L90); the bark marks under them, so a bark never
// hides the countdown, "Go!", the score, the clock or a button (§5.8,
// L103): overlay.css. What it reports is read back from the marks' own
// hidden flags.
// The stage's conventions (src/render/camera.ts's project): x and y are CSS
// px from the canvas's top left, a terrier's point its drawn centre; angle
// is the way from the canvas's centre, clockwise from the right, as CSS's
// rotate() turns, y down; a point behind the camera sits on the canvas's
// edge and is never in view. Only transforms and hidden flags are written.
// Phase 3's effects builder adds the names over the others and the away
// marks. New at M4.

import { h, setShown } from './dom';
import type { OverlayInspection } from './inspect';
import type { Layer, PitchContext, PitchHost } from './layer';
import css from './overlay.css?inline';
import { addStyle } from './style';

// Drawing constants, which keep the layout valid (M4's design §3.2): how far above a terrier's drawn
// centre its marks sit, and the arrow's inset from the canvas's edge, and from its top below the HUD's
// top bar, 8 px down and a button's 44 px tall, by half the arrow and a gap, so the arrow never covers
// the score or the clock (hud.css, L103).
const MARK_RISE_PX = 34;
const BARK_RISE_PX = 56;
export const ARROW_INSET_PX = 30;
export const ARROW_TOP_INSET_PX = 72;

/** Where the off-screen arrow sits: from the canvas's centre along `angle` to the edge of the rectangle
 *  `inset` inside it, `top` inside it at the top (D-28). */
export function edgePoint(angle: number, width: number, height: number, inset: number, top = inset): { x: number; y: number } {
  const cx = width / 2;
  const cy = height / 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const rx = Math.max(0, cx - inset);
  const ry = Math.max(0, cy - (dy < 0 ? top : inset));
  const reach = Math.min(Math.abs(dx) < 1e-9 ? Infinity : rx / Math.abs(dx), Math.abs(dy) < 1e-9 ? Infinity : ry / Math.abs(dy));
  return { x: cx + dx * reach, y: cy + dy * reach };
}

/** A bark counted once: its terrier and its start, the tick of a received or recorded input, or the drawn
 *  time of your own press. */
const barkKey = (id: string, start: number): string => `${id} ${start}`;

export function overlayLayer(host: PitchHost): Layer {
  addStyle(css);
  const me = host.match.me;
  const mine = h('div', { class: 'overlay-mark overlay-mine', hidden: true }, h('span', { class: 'overlay-chevron' }));
  const arrow = h('div', { class: 'overlay-mark overlay-arrow', hidden: true }, h('span', { class: 'overlay-arrow-shape' }));
  const el = h('div', { class: 'overlay', 'aria-hidden': 'true', 'data-test': 'overlay' }, mine, arrow);
  const barkMarks = new Map<string, HTMLElement>();
  const written = new Map<HTMLElement, string>();
  const barksCounted = new Set<string>();
  const celebrationsCounted = new Set<number>();
  let state: OverlayInspection = { mine: null, names: [], barks: [], away: [], arrow: { shown: false, angle: 0 } };

  const place = (mark: HTMLElement, x: number, y: number, turn: number | null): void => {
    const t = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${turn === null ? '' : ` rotate(${turn.toFixed(3)}rad)`}`;
    if (written.get(mark) === t) return;
    written.set(mark, t);
    mark.style.transform = t;
  };
  const barkMark = (id: string): HTMLElement => {
    let mark = barkMarks.get(id);
    if (mark === undefined) {
      mark = h('div', { class: 'overlay-mark overlay-bark', hidden: true }, h('span', { class: 'overlay-bark-bubble' }, 'Woof!'));
      barkMarks.set(id, mark);
      el.append(mark);
    }
    return mark;
  };

  return {
    name: 'overlay',
    el,
    frame(ctx: PitchContext): void {
      // What the drawer input shows, counted whatever is on screen: the pose barks and celebrates too.
      const barking: string[] = [];
      for (const t of ctx.frame?.drawer?.terriers ?? []) {
        if (t.bark !== null) {
          barking.push(t.id);
          const key = barkKey(t.id, t.bark.start);
          if (!barksCounted.has(key)) {
            barksCounted.add(key);
            host.announce({ kind: 'bark' });
          }
        }
        if (t.celebrate !== null && !celebrationsCounted.has(t.celebrate.start)) {
          celebrationsCounted.add(t.celebrate.start);
          host.announce({ kind: 'celebration' });
        }
      }
      const out = ctx.out;
      if (out === null) {
        setShown(mine, false);
        setShown(arrow, false);
        for (const mark of barkMarks.values()) setShown(mark, false);
        state = { mine: null, names: [], barks: [], away: [], arrow: { shown: false, angle: 0 } };
        return;
      }
      const own = out.terriers.find((t) => t.id === me) ?? null;
      setShown(mine, own !== null && own.inView);
      if (own !== null && own.inView) place(mine, own.x, own.y - MARK_RISE_PX, null);
      const away = !out.ball.inView;
      setShown(arrow, away);
      if (away) {
        const at = edgePoint(out.ball.angle, out.cssWidth, out.cssHeight, ARROW_INSET_PX, ARROW_TOP_INSET_PX);
        place(arrow, at.x, at.y, out.ball.angle);
      }
      const shown: string[] = [];
      for (const id of barking) {
        const p = out.terriers.find((t) => t.id === id);
        if (p === undefined || !p.inView) continue;
        const mark = barkMark(id);
        setShown(mark, true);
        place(mark, p.x, p.y - BARK_RISE_PX, null);
        shown.push(id);
      }
      for (const [id, mark] of barkMarks) if (!shown.includes(id)) setShown(mark, false);
      // What the marks show, read back from their own hidden flags, so the hook reports the page's DOM.
      state = {
        mine: own === null ? null : { shown: !mine.hidden, x: own.x, y: own.y },
        names: [], barks: [...barkMarks].filter(([, mark]) => !mark.hidden).map(([id]) => id), away: [],
        arrow: { shown: !arrow.hidden, angle: out.ball.angle },
      };
    },
    inspect: (): OverlayInspection => state,
  };
}
