import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { fake, type FakeElement, FakeEvent, installDom, only } from '../ui/dom-testing';
import { stickStepOf } from './anchoring';
import { inside, type Rect, STICK_TRAVEL_PX, stickArea, stickReading, TouchControls, TouchState } from './touch';

// Touch (PLAN D-29, L78, C-20; M4's design §1.22, §4.3, §4.5, §4.8): the
// stick's area, the lower half of its side clear of the edge margin, either
// side; its dead zone and rim, its angle counter-clockwise from screen up,
// its step with half-step hysteresis; zoomies held while the thumb is past
// the rim; the buttons' presses, each pointer its own, two at once, a tap
// shorter than a tick and a thumb sliding off. The state machine is pure;
// the DOM's wiring is checked thinly on src/ui/dom-testing.ts's DOM, with
// the boxes and pointer capture a browser would give.

const DZ = config.stickDeadZoneFraction;
const R = STICK_TRAVEL_PX;
const EDGE = config.touchEdgeMarginCssPx;
const UNIT = (2 * Math.PI) / config.stickSteps;
const FRAME: Rect = { left: 0, top: 0, right: 640, bottom: 360 };

const state = (): TouchState =>
  new TouchState({ travelPx: R, deadZoneFraction: DZ, steps: config.stickSteps, hysteresisSteps: config.stickHysteresisSteps });

/** A thumb `r` px from (x0, y0) at `angle`, counter-clockwise from screen up. */
const at = (x0: number, y0: number, angle: number, r: number): [number, number] => [x0 - r * Math.sin(angle), y0 - r * Math.cos(angle)];

describe("the stick's area (D-29, §4.3)", () => {
  it('is the lower half of the left side, from the edge margin to the middle', () => {
    expect(stickArea(FRAME, false, EDGE)).toEqual({ left: EDGE, top: 180, right: 320, bottom: 360 });
  });

  it('trades sides when mirrored, the margin from the right edge', () => {
    expect(stickArea(FRAME, true, EDGE)).toEqual({ left: 320, top: 180, right: 640 - EDGE, bottom: 360 });
  });

  it('keeps to the frame, which is inside the safe-area insets', () => {
    const frame: Rect = { left: 44, top: 0, right: 871, bottom: 391 };
    const a = stickArea(frame, false, EDGE);
    expect(a.left).toBe(44 + EDGE);
    expect(a.top).toBeCloseTo(195.5);
    expect(a.bottom).toBe(391);
  });

  it('takes a point on its edges, and none past them', () => {
    const a = stickArea(FRAME, false, EDGE);
    expect(inside(a, EDGE, 360)).toBe(true);
    expect(inside(a, EDGE - 0.5, 300)).toBe(false);
    expect(inside(a, 100, 179)).toBe(false);
    expect(inside(a, 321, 300)).toBe(false);
  });
});

describe("the stick's reading (§4.3)", () => {
  it('has no direction within the dead zone, its edge included', () => {
    expect(stickReading(0, -DZ * R, R, DZ)).toEqual({ angle: null, beyond: false });
    expect(stickReading(DZ * R * 0.7, DZ * R * 0.7, R, DZ).angle).toBeNull();
    expect(stickReading(0, -(DZ * R + 0.5), R, DZ).angle).toBe(0);
  });

  it('reads the angle counter-clockwise from screen up, screen y down: up 0, left a quarter, down a half', () => {
    expect(stickReading(0, -30, R, DZ).angle).toBe(0);
    expect(stickReading(-30, 0, R, DZ).angle).toBeCloseTo(Math.PI / 2);
    expect(stickReading(0, 30, R, DZ).angle).toBeCloseTo(Math.PI);
    expect(stickReading(30, 0, R, DZ).angle).toBeCloseTo((3 * Math.PI) / 2);
    expect(stickReading(-20, -20, R, DZ).angle).toBeCloseTo(Math.PI / 4);
  });

  it('is past the rim only beyond the travel', () => {
    expect(stickReading(0, -R, R, DZ).beyond).toBe(false);
    expect(stickReading(0, -(R + 0.5), R, DZ).beyond).toBe(true);
  });
});

describe('the stick (D-29, C-20)', () => {
  const area = stickArea(FRAME, false, EDGE);

  it('puts its base where the thumb lands in its area, reading nothing until the thumb leaves the dead zone', () => {
    const s = state();
    expect(s.stickDown(7, 100, 300, area)).toBe(true);
    expect(s.stick.base).toEqual({ x: 100, y: 300 });
    expect(s.read()).toMatchObject({ direction: null, stickStep: null, zoomies: false, changedAtMs: null });
    s.stickMove(7, ...at(100, 300, 0, DZ * R * 0.5), 10);
    expect(s.read().direction).toBeNull();
    s.stickMove(7, ...at(100, 300, 8 * UNIT, 30), 20);
    expect(s.read()).toMatchObject({ direction: expect.closeTo(8 * UNIT, 9), stickStep: 8, zoomies: false, changedAtMs: 20 });
  });

  it("refuses a thumb in the edge margin, or outside its area, and a second thumb while it holds one", () => {
    const s = state();
    expect(s.stickDown(1, EDGE - 1, 300, area)).toBe(false);
    expect(s.stickDown(1, 100, 100, area)).toBe(false);
    expect(s.stickPointer).toBeNull();
    expect(s.stickDown(2, 200, 300, area)).toBe(true);
    expect(s.stickDown(3, 150, 250, area)).toBe(false);
    expect(s.refused).toBe(3);
    s.stickMove(3, 150, 200, 5);
    expect(s.read().direction).toBeNull();
  });

  it('keeps its step while the angle stays within half a step past its edges, so a wobble changes nothing (§4.5)', () => {
    const s = state();
    s.stickDown(1, 100, 300, area);
    s.stickMove(1, ...at(100, 300, 4 * UNIT, 40), 1);
    expect(s.read().stickStep).toBe(4);
    // Past the step's edge, 4.5, but inside the hysteresis: still 4.
    s.stickMove(1, ...at(100, 300, 4.9 * UNIT, 40), 2);
    const kept = s.read();
    expect(kept.stickStep).toBe(stickStepOf(4.9 * UNIT, 4, config.stickSteps, config.stickHysteresisSteps));
    expect(kept.stickStep).toBe(4);
    expect(kept.changedAtMs).toBeNull();
    s.stickMove(1, ...at(100, 300, 5.1 * UNIT, 40), 3);
    expect(s.read()).toMatchObject({ stickStep: 5, changedAtMs: 3 });
    s.stickMove(1, ...at(100, 300, 4.1 * UNIT, 40), 4);
    expect(s.read().stickStep).toBe(5);
  });

  it('holds zoomies while the thumb is past the rim, and lets go as it comes back inside (C-20)', () => {
    const s = state();
    s.stickDown(1, 200, 300, area);
    s.stickMove(1, ...at(200, 300, 0, R + 4), 1);
    expect(s.read()).toMatchObject({ zoomies: true, stickStep: 0, changedAtMs: 1 });
    s.stickMove(1, ...at(200, 300, 2 * UNIT, R + 30), 2);
    expect(s.read()).toMatchObject({ zoomies: true, stickStep: 2 });
    s.stickMove(1, ...at(200, 300, 2 * UNIT, R - 4), 3);
    expect(s.read()).toMatchObject({ zoomies: false, stickStep: 2, changedAtMs: 3 });
  });

  it('reads nothing once its thumb lifts, the lift a change', () => {
    const s = state();
    s.stickDown(1, 200, 300, area);
    s.stickMove(1, ...at(200, 300, 16 * UNIT, R + 10), 1);
    s.read();
    s.stickUp(1, 9);
    expect(s.read()).toMatchObject({ direction: null, stickStep: null, zoomies: false, changedAtMs: 9 });
    expect(s.stick.base).toBeNull();
    expect(s.stickDown(2, 120, 320, area)).toBe(true);
  });
});

describe('the buttons (D-29, roslambo bindButton)', () => {
  it('presses each at its pointerdown, kept until the next read, two at once on two pointers', () => {
    const s = state();
    s.buttonDown('jump', 3, 40);
    s.buttonDown('pounce', 4, 41);
    expect(s.held('jump') && s.held('pounce')).toBe(true);
    expect(s.read()).toMatchObject({ jump: true, pounce: true, bark: false, view: false, changedAtMs: 40 });
    expect(s.read()).toMatchObject({ jump: false, pounce: false, changedAtMs: null });
    expect(s.held('jump') && s.held('pounce')).toBe(true);
    s.buttonUp(3);
    expect([s.held('jump'), s.held('pounce')]).toEqual([false, true]);
    expect(s.presses).toEqual({ jump: 1, pounce: 1, bark: 0, view: 0 });
  });

  it('counts a tap shorter than a tick: down and up before the read still press', () => {
    const s = state();
    s.buttonDown('bark', 5, 1);
    s.buttonUp(5);
    expect(s.held('bark')).toBe(false);
    expect(s.read().bark).toBe(true);
  });

  it("lets go of the button its pointer held wherever that pointer lifts, as a thumb that slides off does", () => {
    const s = state();
    s.buttonDown('view', 9, 1);
    // Captured, the pointer's lift comes to the button it went down on, wherever the thumb went.
    s.buttonUp(9);
    expect(s.held('view')).toBe(false);
  });

  it('holds a button two pointers press until both lift, each a press', () => {
    const s = state();
    s.buttonDown('jump', 1, 1);
    s.buttonDown('jump', 2, 2);
    s.buttonDown('jump', 2, 3);
    expect(s.presses.jump).toBe(2);
    s.buttonUp(1);
    expect(s.held('jump')).toBe(true);
    s.buttonUp(2);
    expect(s.held('jump')).toBe(false);
  });

  it('lets go of everything on release, the stick, the buttons and the presses waiting (§4.8)', () => {
    const s = state();
    s.stickDown(1, 100, 300, stickArea(FRAME, false, EDGE));
    s.stickMove(1, 100, 200, 1);
    s.buttonDown('jump', 2, 2);
    s.release();
    expect(s.read()).toMatchObject({ direction: null, stickStep: null, zoomies: false, jump: false, changedAtMs: null });
    expect(s.held('jump')).toBe(false);
    // The thumb still down drives nothing until it's lifted and put down again.
    s.stickMove(1, 100, 150, 3);
    expect(s.read().direction).toBeNull();
  });
});

// --- The DOM's wiring ---

let dom: ReturnType<typeof installDom>;
beforeEach(() => {
  dom = installDom();
});
afterEach(() => dom.restore());

interface Pointer {
  readonly id: number;
  readonly type?: 'touch' | 'mouse' | 'pen';
  readonly x?: number;
  readonly y?: number;
  readonly at?: number;
}

function pointer(target: FakeElement, type: string, p: Pointer): FakeEvent {
  const e = Object.assign(new FakeEvent(type, { bubbles: true, cancelable: true, timeStamp: p.at ?? 0 }), {
    pointerId: p.id, pointerType: p.type ?? 'touch', clientX: p.x ?? 0, clientY: p.y ?? 0,
  });
  target.dispatchEvent(e);
  return e;
}

/** Touch controls on the fake page, their boxes a 640 × 360 frame's, as a browser lays them out. */
function rig(o: { mirrored?: boolean; active?: boolean; host?: FakeElement } = {}): {
  t: TouchControls; host: FakeElement; area: FakeElement; button: (b: string) => FakeElement; captured: number[];
  first: number[]; set: (x: { mirrored?: boolean; active?: boolean }) => void;
} {
  let mirrored = o.mirrored ?? false;
  let active = o.active ?? true;
  const first: number[] = [];
  const host = o.host ?? dom.document.documentElement;
  const t = new TouchControls(host as unknown as HTMLElement, {
    mirrored: () => mirrored, edgeMarginPx: EDGE, onFirstUse: () => first.push(1), active: () => active,
  });
  const el = fake(t.el);
  dom.document.body.append(el);
  const captured: number[] = [];
  const box = (r: Rect) => () => ({ ...r, width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top });
  Object.assign(only(el, '.touch-safe'), { getBoundingClientRect: box(FRAME) });
  const area = only(el, '[data-test="touch-stick"]');
  Object.assign(area, { getBoundingClientRect: () => box(stickArea(FRAME, mirrored, EDGE))(), setPointerCapture: (id: number) => captured.push(id) });
  for (const b of ['jump', 'pounce', 'bark', 'view']) Object.assign(only(el, `[data-test="touch-${b}"]`), { setPointerCapture: (id: number) => captured.push(id) });
  return {
    t, host, area, captured, first, button: (b) => only(el, `[data-test="touch-${b}"]`),
    set: (x) => {
      mirrored = x.mirrored ?? mirrored;
      active = x.active ?? active;
    },
  };
}

describe('the control layer on the page (§4.3)', () => {
  it("shows from the page's first touch, on a player's pitch, and hides for a mouse", () => {
    const r = rig();
    r.t.setVisible(true);
    expect(r.t.el.hidden).toBe(true);
    pointer(r.host, 'pointerdown', { id: 1, type: 'touch' });
    expect(r.t.el.hidden).toBe(false);
    expect(r.first).toEqual([1]);
    pointer(r.host, 'pointerdown', { id: 2, type: 'mouse' });
    expect(r.t.el.hidden).toBe(true);
    pointer(r.host, 'pointerdown', { id: 3, type: 'touch' });
    expect(r.t.el.hidden).toBe(false);
    expect(r.first).toEqual([1]);
    r.t.setVisible(false);
    expect(r.t.el.hidden).toBe(true);
    expect(r.t.inspect()).toMatchObject({ mode: 'touch', shown: false });
  });

  it("drives the stick by a thumb's pointer, captured, its default prevented, the base drawn where it landed", () => {
    const r = rig();
    r.t.setVisible(true);
    pointer(r.host, 'pointerdown', { id: 1 });
    const down = pointer(r.area, 'pointerdown', { id: 5, x: 100, y: 300, at: 10 });
    expect(down.defaultPrevented).toBe(true);
    expect(r.captured).toEqual([5]);
    expect(r.area.classList.contains('held')).toBe(true);
    pointer(r.area, 'pointermove', { id: 5, ...xy(at(100, 300, 24 * UNIT, R + 8)), at: 20 });
    expect(r.t.read()).toMatchObject({ stickStep: 24, zoomies: true, changedAtMs: 20 });
    expect(r.area.classList.contains('zoomies')).toBe(true);
    expect(fake(r.area.children[0]).style.transform).toContain(`translate(${100 - EDGE}px, ${300 - 180}px)`);
    pointer(r.area, 'pointerup', { id: 5, at: 30 });
    expect(r.t.read()).toMatchObject({ direction: null, zoomies: false, changedAtMs: 30 });
    expect(r.area.classList.contains('held')).toBe(false);
  });

  it("refuses a thumb that lands in the edge margin, by the frame's box as the browser gives it", () => {
    const r = rig();
    r.t.setVisible(true);
    pointer(r.host, 'pointerdown', { id: 1 });
    pointer(r.area, 'pointerdown', { id: 5, x: EDGE - 4, y: 300 });
    pointer(r.area, 'pointermove', { id: 5, x: EDGE - 4, y: 200 });
    expect(r.t.read().direction).toBeNull();
    expect(r.t.inspect().refused).toBe(1);
    expect(r.captured).toEqual([]);
  });

  it('puts the stick on the right, mirrored, and takes a thumb there', () => {
    const r = rig({ mirrored: true });
    r.t.setVisible(true);
    pointer(r.host, 'pointerdown', { id: 1 });
    expect(r.t.el.classList.contains('mirrored')).toBe(true);
    pointer(r.area, 'pointerdown', { id: 5, x: 100, y: 300 });
    expect(r.t.inspect().stick.held).toBe(false);
    pointer(r.area, 'pointerdown', { id: 6, x: 500, y: 300 });
    expect(r.t.inspect().stick.held).toBe(true);
    r.set({ mirrored: false });
    r.t.setVisible(true);
    expect(r.t.el.classList.contains('mirrored')).toBe(false);
  });

  it("presses a button by a finger's pointer, held while it's down, never by a mouse's", () => {
    const r = rig();
    r.t.setVisible(true);
    pointer(r.host, 'pointerdown', { id: 1 });
    const jump = r.button('jump');
    expect(pointer(jump, 'pointerdown', { id: 8, at: 5 }).defaultPrevented).toBe(true);
    pointer(r.button('pounce'), 'pointerdown', { id: 9, at: 6 });
    expect(jump.classList.contains('held')).toBe(true);
    expect(r.t.read()).toMatchObject({ jump: true, pounce: true, changedAtMs: 5 });
    pointer(jump, 'lostpointercapture', { id: 8 });
    expect(jump.classList.contains('held')).toBe(false);
    expect(r.t.inspect().held).toEqual(['pounce']);
    pointer(r.button('bark'), 'pointerdown', { id: 10, type: 'mouse' });
    expect(r.t.read().bark).toBe(false);
  });

  it("never takes a mouse's press on a button or the stick, though its host didn't see the press first", () => {
    const apart = fake(dom.document.createElement('div'));
    const r = rig({ host: apart });
    r.t.setVisible(true);
    pointer(apart, 'pointerdown', { id: 1 });
    expect(r.t.el.hidden).toBe(false);
    pointer(r.button('bark'), 'pointerdown', { id: 2, type: 'mouse' });
    pointer(r.area, 'pointerdown', { id: 3, type: 'mouse', x: 100, y: 300 });
    expect(r.t.read().bark).toBe(false);
    expect(r.t.inspect().stick.held).toBe(false);
    pointer(r.button('bark'), 'pointerdown', { id: 4, type: 'pen' });
    expect(r.t.read().bark).toBe(true);
  });

  it("reads nothing off a player's pitch, or hidden, letting go of what was held", () => {
    const r = rig();
    r.t.setVisible(true);
    pointer(r.host, 'pointerdown', { id: 1 });
    pointer(r.button('jump'), 'pointerdown', { id: 8 });
    r.set({ active: false });
    expect(r.t.read().jump).toBe(false);
    expect(r.t.inspect().held).toEqual([]);
    r.set({ active: true });
    pointer(r.button('view'), 'pointerdown', { id: 9 });
    r.t.setVisible(false);
    r.t.setVisible(true);
    expect(r.t.read().view).toBe(false);
  });

  it('stops listening and leaves the page on dispose', () => {
    const r = rig();
    r.t.setVisible(true);
    r.t.dispose();
    pointer(r.host, 'pointerdown', { id: 1 });
    expect(r.t.inspect().mode).toBeNull();
    expect(r.t.el.isConnected).toBe(false);
  });
});

const xy = ([x, y]: [number, number]): { x: number; y: number } => ({ x, y });
