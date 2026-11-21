// Touch (PLAN D-29, D-30, L78, L169, L170; M4's design,
// research/m4/DESIGN.md, §1.22, §4.3, §4.5, §4.8): the control layer over
// the pitch, for players on a touch screen, shown from the first touch on
// the page (a pointerdown of type touch) and hidden by a mouse's.
// - The stick, on the left, or on the right mirrored: its base appears
//   where the thumb lands inside its area, the lower half of its side, at
//   least touchEdgeMarginCssPx from the side edge, inside the safe-area
//   insets, clear of Android's and Safari's edge-swipe Back. Its travel is
//   the base's radius: within stickDeadZoneFraction of it no direction;
//   past the rim zoomies, held until the thumb comes back inside it; its
//   angle screen-relative, counter-clockwise from screen up, its step with
//   half-step hysteresis (src/input/anchoring.ts's stickStepOf).
// - Jump and pounce, large, on the other side, bark and view, smaller,
//   above them: each a press at its pointerdown, kept until the next read,
//   so a tap shorter than a tick counts. Each tracks its own pointers with
//   pointer capture, roslambo's bindButton (src/ui/input.ts), so two thumbs
//   hold two at once and a thumb that slides off still lets its button go.
// - Mirrored trades the sides, never the text. The menu button is the
//   HUD's, in the top right corner both layouts leave free.
// TouchState is the state machine, pure and tested without a DOM;
// TouchControls is the DOM's thin wiring to it. A read off a player's pitch
// screen, or with the layer hidden, lets go of everything, as the keyboard
// does; the page's devices (src/ui/devices.ts) release it on blur and on a
// hidden page. New at M4.

import { config } from '../config';
import { h, setClass, setShown } from '../ui/dom';
import { addStyle } from '../ui/style';
import css from '../ui/touch.css?inline';
import { stickStepOf } from './anchoring';
import type { Device, DeviceState } from './source';

/** A box in CSS px, the viewport's: left and top inclusive, as getBoundingClientRect gives one. */
export interface Rect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

/** The stick's base's radius, its travel, in CSS px: a layout constant, as the buttons' sizes are. */
export const STICK_TRAVEL_PX = 56;

const TURN = 2 * Math.PI;

/** The stick's area (§4.3, D-29): the lower half of its side of the frame, the control layer's box inside
 *  the safe-area insets, the left side or, mirrored, the right, at least edgeMarginPx from that side's
 *  edge, so a thumb there never starts it. */
export function stickArea(frame: Rect, mirrored: boolean, edgeMarginPx: number): Rect {
  const middle = (frame.left + frame.right) / 2;
  const top = (frame.top + frame.bottom) / 2;
  return mirrored
    ? { left: middle, top, right: frame.right - edgeMarginPx, bottom: frame.bottom }
    : { left: frame.left + edgeMarginPx, top, right: middle, bottom: frame.bottom };
}

/** The point is in the box, its edges included. */
export function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** What the stick reads for a thumb (dx, dy) CSS px from its base, screen y down (§4.3): its angle in
 *  radians, counter-clockwise from screen up, in [0, 2π), or null within the dead zone; and whether the
 *  thumb is past the rim, which is zoomies (C-20). */
export function stickReading(dx: number, dy: number, travelPx: number, deadZoneFraction: number): { readonly angle: number | null; readonly beyond: boolean } {
  const r = Math.hypot(dx, dy);
  if (r <= deadZoneFraction * travelPx) return { angle: null, beyond: false };
  const a = Math.atan2(-dx, -dy);
  // In [0, 2π), straight up 0, never −0.
  return { angle: a < 0 ? a + TURN : Math.abs(a), beyond: r > travelPx };
}

export type TouchButton = 'jump' | 'pounce' | 'bark' | 'view';
export const TOUCH_BUTTONS: readonly TouchButton[] = ['jump', 'pounce', 'bark', 'view'];

export interface StickOptions {
  /** The base's radius, its travel, in CSS px. */
  readonly travelPx: number;
  readonly deadZoneFraction: number;
  /** A.2's steps a turn, and the hysteresis in steps (D-10). */
  readonly steps: number;
  readonly hysteresisSteps: number;
}

/** The touch layer's state, pure: the stick's thumb, each button's pointers, and what was pressed and
 *  first changed since the last read. Positions are CSS px in any one frame of reference. */
export class TouchState {
  private readonly o: StickOptions;
  private stickId: number | null = null;
  private baseAt: { readonly x: number; readonly y: number } | null = null;
  private thumbAt: { readonly x: number; readonly y: number } | null = null;
  private angle: number | null = null;
  private step: number | null = null;
  private beyond = false;
  private readonly holders: Record<TouchButton, number[]> = { jump: [], pounce: [], bark: [], view: [] };
  private pressed: Record<TouchButton, boolean> = { jump: false, pounce: false, bark: false, view: false };
  /** Every press since the state was made, for the hook. */
  readonly presses: Record<TouchButton, number> = { jump: 0, pounce: 0, bark: 0, view: 0 };
  /** Thumbs the stick's area didn't take: in the edge margin, or a second one while it holds one. */
  refused = 0;
  private changedAt: number | null = null;

  constructor(o: StickOptions) {
    this.o = o;
  }

  /** A thumb down at (x, y): the stick's base there if it lands in the area and the stick holds no other;
   *  true if the stick took it. It starts in the dead zone, so nothing changes yet. */
  stickDown(id: number, x: number, y: number, area: Rect): boolean {
    if (this.stickId !== null || !inside(area, x, y)) {
      this.refused++;
      return false;
    }
    this.stickId = id;
    this.baseAt = { x, y };
    this.thumbAt = { x, y };
    return true;
  }

  /** The stick's thumb at (x, y), at event time `at`: its direction, step and zoomies follow it. */
  stickMove(id: number, x: number, y: number, at: number): void {
    const base = this.baseAt;
    if (id !== this.stickId || base === null) return;
    this.thumbAt = { x, y };
    const r = stickReading(x - base.x, y - base.y, this.o.travelPx, this.o.deadZoneFraction);
    const step = r.angle === null ? null : stickStepOf(r.angle, this.step, this.o.steps, this.o.hysteresisSteps);
    if (step !== this.step || r.beyond !== this.beyond) this.changedAt ??= at;
    this.angle = r.angle;
    this.step = step;
    this.beyond = r.beyond;
  }

  /** The stick's thumb lifted or cancelled: no direction, no zoomies. */
  stickUp(id: number, at: number): void {
    if (id !== this.stickId) return;
    if (this.step !== null || this.beyond) this.changedAt ??= at;
    this.clearStick();
  }

  /** A pointer down on a button: a press, kept until the next read, and the button held while it is. */
  buttonDown(b: TouchButton, id: number, at: number): void {
    const holders = this.holders[b];
    if (holders.includes(id)) return;
    holders.push(id);
    this.pressed[b] = true;
    this.presses[b]++;
    this.changedAt ??= at;
  }

  /** A pointer lifted, cancelled or its capture lost: whichever button it held lets go. */
  buttonUp(id: number): void {
    for (const b of TOUCH_BUTTONS) {
      const k = this.holders[b].indexOf(id);
      if (k >= 0) this.holders[b].splice(k, 1);
    }
  }

  held(b: TouchButton): boolean {
    return this.holders[b].length > 0;
  }

  /** The stick's pointer, if it holds one. */
  get stickPointer(): number | null {
    return this.stickId;
  }

  /** Where the stick's base and thumb are, and what it reads, while a thumb holds it. */
  get stick(): { readonly base: { readonly x: number; readonly y: number } | null; readonly thumb: { readonly x: number; readonly y: number } | null; readonly step: number | null; readonly zoomies: boolean } {
    return { base: this.baseAt, thumb: this.thumbAt, step: this.step, zoomies: this.beyond };
  }

  /** Nothing held and no press waiting (§4.8): a thumb still down drives nothing until it's lifted. */
  release(): void {
    this.clearStick();
    for (const b of TOUCH_BUTTONS) this.holders[b].length = 0;
    this.pressed = { jump: false, pounce: false, bark: false, view: false };
    this.changedAt = null;
  }

  /** What's held now, and what was pressed and first changed since the last read. */
  read(): DeviceState {
    const p = this.pressed;
    const s: DeviceState = {
      direction: this.angle, stickStep: this.step, zoomies: this.beyond,
      jump: p.jump, pounce: p.pounce, bark: p.bark, view: p.view, changedAtMs: this.changedAt,
    };
    this.pressed = { jump: false, pounce: false, bark: false, view: false };
    this.changedAt = null;
    return s;
  }

  private clearStick(): void {
    this.stickId = null;
    this.baseAt = null;
    this.thumbAt = null;
    this.angle = null;
    this.step = null;
    this.beyond = false;
  }
}

/** What the touch layer reports for the hook: Inspection.layers.touch. */
export interface TouchInspection {
  /** The last pointer type a press on the page had: the layer shows from a touch, hides for a mouse. */
  readonly mode: 'touch' | 'mouse' | null;
  readonly shown: boolean;
  readonly mirrored: boolean;
  readonly stick: { readonly held: boolean; readonly base: { readonly x: number; readonly y: number } | null; readonly step: number | null; readonly zoomies: boolean };
  readonly held: readonly TouchButton[];
  readonly presses: Readonly<Record<TouchButton, number>>;
  /** Thumbs the stick's area refused: in the edge margin, or a second one. */
  readonly refused: number;
}

export interface TouchOptions {
  /** Settings' mirrored layout: the stick on the right (PLAN §11). */
  readonly mirrored: () => boolean;
  /** touchEdgeMarginCssPx: nothing starts nearer a side edge, inside the safe-area insets (D-29). */
  readonly edgeMarginPx: number;
  /** The first touch on the page. */
  readonly onFirstUse: () => void;
  /** A player's pitch screen with no menu open: off it, a read lets go of everything. Always, if absent. */
  readonly active?: () => boolean;
}

const NOTHING: DeviceState = Object.freeze({
  direction: null, stickStep: null, zoomies: false, jump: false, pounce: false, bark: false, view: false, changedAtMs: null,
});

/** The buttons' words, which never mirror. */
const LABELS: Readonly<Record<TouchButton, string>> = { jump: 'Jump', pounce: 'Pounce', bark: 'Bark', view: 'View' };

/** A pointer that drives the layer: a finger's or a pen's, never a mouse's, which hides it. */
const driving = (e: PointerEvent): boolean => e.pointerType === 'touch' || e.pointerType === 'pen';

export class TouchControls implements Device {
  readonly kind = 'touch' as const;
  /** The control layer: the stick, jump, pounce, bark and view, put over each pitch by the touch layer. */
  readonly el: HTMLElement;
  private readonly o: TouchOptions;
  private readonly frameEl: HTMLElement;
  private readonly area: HTMLElement;
  private readonly baseEl: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons: Readonly<Record<TouchButton, HTMLButtonElement>>;
  private readonly state: TouchState;
  private mode: 'touch' | 'mouse' | null = null;
  private wanted = false;
  /** The stick's area's box at its thumb's landing, for drawing the base and the knob inside it. */
  private areaBox: Rect | null = null;
  private readonly detach: () => void;

  /** host: the element whose presses tell the pointer's type, the page's root. */
  constructor(host: HTMLElement, o: TouchOptions) {
    addStyle(css);
    this.o = o;
    this.state = new TouchState({
      travelPx: STICK_TRAVEL_PX, deadZoneFraction: config.stickDeadZoneFraction, steps: config.stickSteps, hysteresisSteps: config.stickHysteresisSteps,
    });
    this.knob = h('div', { class: 'touch-stick-knob' });
    this.baseEl = h('div', { class: 'touch-stick-base' }, this.knob);
    // A gesture's surface, not a control a screen reader can work: the hints say what it does.
    this.area = h('div', { class: 'touch-stick', 'data-test': 'touch-stick', 'aria-hidden': 'true' }, this.baseEl);
    const button = (b: TouchButton): HTMLButtonElement =>
      h('button', { type: 'button', class: `touch-button touch-${b}`, 'data-test': `touch-${b}`, tabindex: '-1' }, LABELS[b]);
    this.buttons = { jump: button('jump'), pounce: button('pounce'), bark: button('bark'), view: button('view') };
    this.frameEl = h('div', { class: 'touch-safe' }, this.area,
      h('div', { class: 'touch-buttons' }, this.buttons.bark, this.buttons.view, this.buttons.pounce, this.buttons.jump));
    this.el = h('div', { class: 'touch', 'data-test': 'touch', hidden: true }, this.frameEl);
    this.el.style.setProperty('--touch-edge', `${o.edgeMarginPx}px`);
    this.el.style.setProperty('--stick-travel', `${STICK_TRAVEL_PX}px`);

    const offs: (() => void)[] = [];
    const on = (t: EventTarget, type: string, fn: (e: PointerEvent) => void, capture = false): void => {
      const l = fn as EventListener;
      t.addEventListener(type, l, capture);
      offs.push(() => t.removeEventListener(type, l, capture));
    };
    on(host, 'pointerdown', (e) => this.notePointer(e), true);
    on(this.area, 'pointerdown', (e) => this.stickDown(e));
    on(this.area, 'pointermove', (e) => this.stickMove(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(this.area, type, (e) => this.stickUp(e));
    for (const b of TOUCH_BUTTONS) {
      const el = this.buttons[b];
      on(el, 'pointerdown', (e) => this.buttonDown(b, e));
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(el, type, (e) => this.buttonUp(e));
    }
    // A long press's menu, and a selection, never come over the controls.
    on(this.el, 'contextmenu', (e) => e.preventDefault());
    this.detach = () => {
      for (const off of offs.splice(0)) off();
    };
  }

  /** Players on touch screens, on Pre-match and Match (§4.3): shown while wanted and the page's last
   *  press was a touch. Its layout follows Settings' mirrored choice each call. */
  setVisible(on: boolean): void {
    this.wanted = on;
    this.apply();
  }

  read(): DeviceState {
    if (this.el.hidden || !(this.o.active?.() ?? true)) {
      this.release();
      return NOTHING;
    }
    return this.state.read();
  }

  /** Blur, a hidden page, the menu, lost graphics: nothing stays held (§4.8). */
  release(): void {
    this.state.release();
    this.areaBox = null;
    this.drawStick();
    this.drawButtons();
  }

  dispose(): void {
    this.detach();
    this.release();
    this.el.remove();
  }

  inspect(): TouchInspection {
    const s = this.state.stick;
    return {
      mode: this.mode, shown: !this.el.hidden, mirrored: this.el.classList.contains('mirrored'),
      stick: { held: this.state.stickPointer !== null, base: s.base, step: s.step, zoomies: s.zoomies },
      held: TOUCH_BUTTONS.filter((b) => this.state.held(b)),
      presses: { ...this.state.presses },
      refused: this.state.refused,
    };
  }

  /** Shown or hidden, letting go of everything as it hides, and mirrored or not, each only on a change. */
  private apply(): void {
    const show = this.wanted && this.mode === 'touch';
    setClass(this.el, 'mirrored', this.o.mirrored());
    if (show !== this.el.hidden) return;
    setShown(this.el, show);
    if (!show) this.release();
  }

  /** Every press on the page: a touch shows the layer, from the first, and a mouse hides it. */
  private notePointer(e: PointerEvent): void {
    const was = this.mode;
    if (e.pointerType === 'touch') this.mode = 'touch';
    else if (e.pointerType === 'mouse') this.mode = 'mouse';
    else return;
    if (this.mode === was) return;
    if (this.mode === 'touch' && was === null) this.o.onFirstUse();
    this.apply();
  }

  private stickDown(e: PointerEvent): void {
    if (!driving(e)) return;
    e.preventDefault();
    const frame = this.frameEl.getBoundingClientRect();
    const area = stickArea(frame, this.el.classList.contains('mirrored'), this.o.edgeMarginPx);
    if (!this.state.stickDown(e.pointerId, e.clientX, e.clientY, area)) return;
    capture(this.area, e.pointerId);
    this.areaBox = this.area.getBoundingClientRect();
    this.drawStick();
  }

  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.state.stickPointer) return;
    this.state.stickMove(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    this.drawStick();
  }

  private stickUp(e: PointerEvent): void {
    if (e.pointerId !== this.state.stickPointer) return;
    this.state.stickUp(e.pointerId, e.timeStamp);
    this.areaBox = null;
    this.drawStick();
  }

  private buttonDown(b: TouchButton, e: PointerEvent): void {
    if (!driving(e)) return;
    // No focus, no mouse events after it, no selection: the press is the pointer's alone.
    e.preventDefault();
    capture(this.buttons[b], e.pointerId);
    this.state.buttonDown(b, e.pointerId, e.timeStamp);
    this.drawButtons();
  }

  private buttonUp(e: PointerEvent): void {
    this.state.buttonUp(e.pointerId);
    this.drawButtons();
  }

  /** The base where the thumb landed and the knob where it is, drawn inside the rim; at rest, the CSS's. */
  private drawStick(): void {
    const s = this.state.stick;
    const box = this.areaBox;
    setClass(this.area, 'zoomies', s.zoomies);
    if (s.base === null || s.thumb === null || box === null) {
      setClass(this.area, 'held', false);
      setTransform(this.baseEl, '');
      setTransform(this.knob, '');
      return;
    }
    setClass(this.area, 'held', true);
    const dx = s.thumb.x - s.base.x;
    const dy = s.thumb.y - s.base.y;
    const r = Math.hypot(dx, dy);
    const k = r > STICK_TRAVEL_PX ? STICK_TRAVEL_PX / r : 1;
    setTransform(this.baseEl, `translate(${s.base.x - box.left}px, ${s.base.y - box.top}px) translate(-50%, -50%)`);
    setTransform(this.knob, `translate(${dx * k}px, ${dy * k}px)`);
  }

  private drawButtons(): void {
    for (const b of TOUCH_BUTTONS) setClass(this.buttons[b], 'held', this.state.held(b));
  }
}

/** An inline transform, written only when it changes, as setText does for text. */
function setTransform(el: HTMLElement, t: string): void {
  if (el.style.transform !== t) el.style.transform = t;
}

/** Pointer capture, so the element hears its pointer wherever it goes (roslambo's bindButton); a pointer
 *  already gone, or a synthetic one, refuses it, and the press still counts. */
function capture(el: HTMLElement, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
    // Refused: the element still hears the pointer while it stays over it.
  }
}
