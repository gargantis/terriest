import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { screenStep } from './anchoring';
import { isField, Keyboard, type KeyboardScreen, PLAY_CODES } from './keyboard';
import type { DeviceState, UiCommand } from './source';

// The keyboard (PLAN D-29, L77, Q-17, C-34; M4's design §1.21, §4.2, §4.8–
// §4.10): by event.code, repeats ignored, released on blur and while hidden;
// a press kept until the next read, so a tap shorter than a tick counts;
// Q-17's commands and whose each key's default is; fields and modifiers
// driving nothing. On Node's own EventTarget and Event, whose dispatch
// follows the DOM's, with a key event's fields set on the event.

/** A window as the keyboard uses one: its own events and its document's visibility. */
class FakeWindow extends EventTarget {
  readonly document = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });

  hide(): void {
    this.document.visibilityState = 'hidden';
    this.document.dispatchEvent(new Event('visibilitychange'));
  }

  show(): void {
    this.document.visibilityState = 'visible';
    this.document.dispatchEvent(new Event('visibilitychange'));
  }
}

interface KeyOptions {
  readonly at?: number;
  readonly repeat?: boolean;
  readonly key?: string;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly meta?: boolean;
  readonly shift?: boolean;
  /** Where it was typed, as a bubbled event's target; the window's own otherwise. */
  readonly target?: object;
}

/** A key event dispatched on the window, returned to read whether its default was prevented. */
function key(w: EventTarget, type: 'keydown' | 'keyup', code: string, o: KeyOptions = {}): Event {
  const e = new Event(type, { cancelable: true });
  Object.defineProperties(e, {
    code: { value: code }, key: { value: o.key ?? code }, repeat: { value: o.repeat ?? false },
    ctrlKey: { value: o.ctrl ?? false }, altKey: { value: o.alt ?? false }, metaKey: { value: o.meta ?? false },
    shiftKey: { value: o.shift ?? false }, timeStamp: { value: o.at ?? 0 },
    ...(o.target !== undefined ? { target: { value: o.target } } : {}),
  });
  w.dispatchEvent(e);
  return e;
}

const down = (w: EventTarget, code: string, o?: KeyOptions): Event => key(w, 'keydown', code, o);
const up = (w: EventTarget, code: string, o?: KeyOptions): Event => key(w, 'keyup', code, o);

/** A keyboard on a fake window, its screen set by the test, its commands kept. */
function keyboard(screen: KeyboardScreen = 'pitch'): { w: FakeWindow; k: Keyboard; ui: UiCommand[]; on: (s: KeyboardScreen) => void } {
  const w = new FakeWindow();
  const ui: UiCommand[] = [];
  let now = screen;
  const k = new Keyboard(w as unknown as Window, (c) => ui.push(c), () => now);
  return { w, k, ui, on: (s) => (now = s) };
}

/** The read's direction as A.2's screen step, or null. */
const stepOf = (s: DeviceState): number | null => (s.direction === null ? null : screenStep(s.direction, config.stickSteps));
const pressesOf = (s: DeviceState): string[] => (['jump', 'pounce', 'bark', 'view'] as const).filter((p) => s[p]);

describe('the keyboard (D-29, L77)', () => {
  it('lists the play set by event.code', () => {
    expect(PLAY_CODES).toEqual(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyQ', 'KeyC']);
  });

  it('gives eight directions by key position, screen-relative: W up, A left, S down, D right', () => {
    const cases: [readonly string[], number | null][] = [
      [['KeyW'], 0], [['KeyW', 'KeyA'], 4], [['KeyA'], 8], [['KeyA', 'KeyS'], 12], [['KeyS'], 16], [['KeyS', 'KeyD'], 20],
      [['KeyD'], 24], [['KeyD', 'KeyW'], 28], [['KeyW', 'KeyS'], null], [['KeyA', 'KeyD'], null], [[], null],
      [['KeyW', 'KeyA', 'KeyD'], 0], [['KeyW', 'KeyA', 'KeyS'], 8],
    ];
    for (const [codes, step] of cases) {
      const { w, k } = keyboard();
      for (const c of codes) down(w, c);
      const s = k.read();
      expect(stepOf(s), codes.join('+') || 'nothing').toBe(step);
      expect(s.stickStep).toBeNull();
    }
    // The direction is exact: W's 0 and A's quarter turn counter-clockwise.
    const { w, k } = keyboard();
    down(w, 'KeyA');
    expect(k.read().direction).toBe(Math.PI / 2);
  });

  it('reads the position, not the character: AZERTY plays on Z, Q, S and D', () => {
    const { w, k } = keyboard();
    down(w, 'KeyW', { key: 'z' });
    expect(stepOf(k.read())).toBe(0);
    down(w, 'KeyA', { key: 'q' });
    expect(stepOf(k.read())).toBe(4);
  });

  it('lets a key go on keyup, and holds zoomies on either Shift', () => {
    const { w, k } = keyboard();
    down(w, 'KeyD');
    down(w, 'ShiftRight');
    expect([stepOf(k.read()), k.read().zoomies]).toEqual([24, true]);
    up(w, 'ShiftRight');
    down(w, 'ShiftLeft');
    expect(k.read().zoomies).toBe(true);
    up(w, 'ShiftLeft');
    up(w, 'KeyD');
    const s = k.read();
    expect([stepOf(s), s.zoomies]).toEqual([null, false]);
  });

  it('presses on the first keydown, never a repeat, and keeps the press until the next read', () => {
    const { w, k } = keyboard();
    down(w, 'Space');
    down(w, 'Space', { repeat: true });
    expect(pressesOf(k.read())).toEqual(['jump']);
    down(w, 'Space', { repeat: true });
    expect(pressesOf(k.read()), 'a repeat presses nothing').toEqual([]);
    // A tap shorter than a tick: down and up between two reads still counts (D-10).
    down(w, 'KeyE');
    up(w, 'KeyE');
    down(w, 'KeyQ');
    up(w, 'KeyQ');
    down(w, 'KeyC');
    up(w, 'KeyC');
    expect(pressesOf(k.read())).toEqual(['pounce', 'bark', 'view']);
    expect(pressesOf(k.read())).toEqual([]);
    // Two presses before a read are one: the controls advance a counter once a tick (M4-Q25).
    up(w, 'Space');
    down(w, 'Space');
    up(w, 'Space');
    down(w, 'Space');
    expect(pressesOf(k.read())).toEqual(['jump']);
  });

  it('lets everything go on blur and while the page is hidden (D-29, D-31), a press waiting included', () => {
    const { w, k } = keyboard();
    down(w, 'KeyW');
    down(w, 'ShiftLeft');
    down(w, 'Space');
    w.dispatchEvent(new Event('blur'));
    let s = k.read();
    expect([stepOf(s), s.zoomies, pressesOf(s)]).toEqual([null, false, []]);
    down(w, 'KeyW');
    w.hide();
    expect(stepOf(k.read())).toBeNull();
    w.show();
    down(w, 'KeyW', { repeat: true });
    expect(stepOf(k.read()), "a key still held comes back with its next repeat").toBe(0);
    // An element's blur reaches the window only by capture, which the keyboard doesn't listen to; were
    // one dispatched there with its own target, it would leave the keys held.
    const blur = new Event('blur');
    Object.defineProperty(blur, 'target', { value: { tagName: 'BUTTON' } });
    w.dispatchEvent(blur);
    s = k.read();
    expect(stepOf(s)).toBe(0);
  });

  it('drives nothing with Ctrl, Alt or Meta held, and leaves those keys to the browser', () => {
    const { w, k, ui } = keyboard();
    for (const mod of [{ ctrl: true }, { alt: true }, { meta: true }]) {
      expect(down(w, 'KeyW', mod).defaultPrevented).toBe(false);
      expect(down(w, 'Space', mod).defaultPrevented).toBe(false);
      expect(down(w, 'Escape', mod).defaultPrevented).toBe(false);
    }
    const s = k.read();
    expect([stepOf(s), pressesOf(s), ui]).toEqual([null, [], []]);
    // Shift is zoomies, not a modifier that stops the keys.
    down(w, 'KeyW', { shift: true });
    expect(stepOf(k.read())).toBe(0);
    // A key let go with a modifier held still lets go.
    up(w, 'KeyW', { ctrl: true });
    expect(stepOf(k.read())).toBeNull();
    // Meta lets everything go: macOS sends no keyup for a key let go while it's held.
    down(w, 'KeyW');
    down(w, 'KeyE');
    down(w, 'MetaLeft', { meta: true });
    const m = k.read();
    expect([stepOf(m), pressesOf(m)]).toEqual([null, []]);
  });

  it('drives nothing from a key typed into a field, leaves it its keys, and still lets go there', () => {
    const texts = [{ tagName: 'INPUT', type: 'text' }, { tagName: 'INPUT' }, { tagName: 'INPUT', type: 'number' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }];
    const choices = [{ tagName: 'INPUT', type: 'checkbox' }, { tagName: 'INPUT', type: 'RADIO' }, { tagName: 'INPUT', type: 'range' }, { tagName: 'SELECT' }];
    for (const target of [...texts, ...choices]) {
      expect(isField(target as unknown as EventTarget), JSON.stringify(target)).toBe(true);
      for (const screen of ['pitch', 'menu'] as const) {
        const { w, k, ui } = keyboard(screen);
        for (const code of ['KeyW', 'Space', 'Enter', 'ArrowDown']) expect(down(w, code, { target }).defaultPrevented, `${code} ${screen}`).toBe(false);
        const s = k.read();
        expect([stepOf(s), pressesOf(s), ui], `${JSON.stringify(target)} ${screen}`).toEqual([null, [], []]);
      }
    }
    // Escape: kept by a field that takes text, where it may cancel an input method's composition; from a
    // choice, which never uses it, the menus' still, so the menu closes from a focused checkbox.
    for (const target of texts) {
      const { w, ui } = keyboard('menu');
      expect(down(w, 'Escape', { target }).defaultPrevented).toBe(false);
      expect(ui, JSON.stringify(target)).toEqual([]);
    }
    for (const target of choices) {
      const { w, ui } = keyboard('menu');
      expect(down(w, 'Escape', { target, at: 9 }).defaultPrevented).toBe(true);
      expect(ui, JSON.stringify(target)).toEqual([{ kind: 'menu', pressedAt: 9, source: 'keyboard', repeat: false }]);
    }
    for (const target of [{ tagName: 'BUTTON' }, { tagName: 'INPUT', type: 'submit' }, { tagName: 'INPUT', type: 'button' }, { tagName: 'BODY' }, null]) {
      expect(isField(target as unknown as EventTarget), JSON.stringify(target)).toBe(false);
    }
    // W held on the pitch, then let go while a field has the focus.
    const { w, k } = keyboard();
    down(w, 'KeyW');
    up(w, 'KeyW', { target: { tagName: 'INPUT', type: 'text' } });
    expect(stepOf(k.read())).toBeNull();
  });

  it("drives nothing off a player's pitch screen, and a read there lets go of what was held", () => {
    for (const screen of ['spectator', 'menu', 'results', 'other'] as const) {
      const { w, k } = keyboard(screen);
      for (const c of PLAY_CODES) down(w, c);
      const s = k.read();
      expect([stepOf(s), s.zoomies, pressesOf(s)], screen).toEqual([null, false, []]);
    }
    const { w, k, on } = keyboard();
    down(w, 'KeyW');
    down(w, 'KeyE');
    on('menu');
    let s = k.read();
    expect([stepOf(s), pressesOf(s)], 'the menu opened').toEqual([null, []]);
    on('pitch');
    expect(stepOf(k.read()), 'nothing held on its return').toBeNull();
    down(w, 'KeyW', { repeat: true });
    s = k.read();
    expect([stepOf(s), pressesOf(s)]).toEqual([0, []]);
    // Practice's menu samples nothing: a press made while it's open, unread, never acts once it closes.
    on('menu');
    down(w, 'Space');
    down(w, 'KeyQ');
    on('pitch');
    expect(pressesOf(k.read())).toEqual([]);
  });
});

describe("the menus' keys (Q-17, C-34)", () => {
  it('makes Escape, Enter and the arrows commands on every screen, with their time and repeat', () => {
    for (const screen of ['pitch', 'spectator', 'menu', 'results', 'other'] as const) {
      const { w, ui } = keyboard(screen);
      down(w, 'Escape', { at: 10 });
      down(w, 'Enter', { at: 20 });
      down(w, 'NumpadEnter', { at: 25 });
      down(w, 'ArrowUp', { at: 30 });
      down(w, 'ArrowDown', { at: 40, repeat: true });
      down(w, 'ArrowLeft', { at: 50 });
      down(w, 'ArrowRight', { at: 60 });
      expect(ui, screen).toEqual([
        { kind: 'menu', pressedAt: 10, source: 'keyboard', repeat: false },
        { kind: 'press', pressedAt: 20, source: 'keyboard', repeat: false },
        { kind: 'press', pressedAt: 25, source: 'keyboard', repeat: false },
        { kind: 'up', pressedAt: 30, source: 'keyboard', repeat: false },
        { kind: 'down', pressedAt: 40, source: 'keyboard', repeat: true },
        { kind: 'left', pressedAt: 50, source: 'keyboard', repeat: false },
        { kind: 'right', pressedAt: 60, source: 'keyboard', repeat: false },
      ]);
    }
  });

  it("presses with Space on Results, and cycles a spectator's follow with C", () => {
    const r = keyboard('results');
    down(r.w, 'Space', { at: 5 });
    down(r.w, 'Space', { at: 6, repeat: true });
    expect(r.ui).toEqual([
      { kind: 'press', pressedAt: 5, source: 'keyboard', repeat: false },
      { kind: 'press', pressedAt: 6, source: 'keyboard', repeat: true },
    ]);
    const s = keyboard('spectator');
    down(s.w, 'KeyC', { at: 7 });
    expect(s.ui).toEqual([{ kind: 'next', pressedAt: 7, source: 'keyboard', repeat: false }]);
    // Elsewhere Space and C are no command: a player's jump and view, and nothing off the pitch.
    for (const screen of ['pitch', 'menu', 'other'] as const) {
      const { w, ui } = keyboard(screen);
      down(w, 'Space');
      down(w, 'KeyC');
      expect(ui, screen).toEqual([]);
    }
  });

  it("keeps each key's default where the browser should act, and prevents it where the nav or the pitch does", () => {
    // Keydown's default prevented, by screen, for: a play key, Space, Enter, an arrow, Escape.
    const prevented = (screen: KeyboardScreen): boolean[] => {
      const { w } = keyboard(screen);
      return ['KeyW', 'Space', 'Enter', 'ArrowUp', 'Escape'].map((c) => down(w, c).defaultPrevented);
    };
    expect(prevented('pitch')).toEqual([true, true, true, true, true]);
    expect(prevented('spectator')).toEqual([true, true, true, true, true]);
    expect(prevented('menu')).toEqual([false, true, true, true, true]);
    expect(prevented('results')).toEqual([false, true, true, true, true]);
    expect(prevented('other'), "every other screen's buttons are the browser's").toEqual([false, false, false, false, false]);
    // A repeat of Space on the pitch is prevented too, so it never presses a focused button (C-34).
    const { w } = keyboard('pitch');
    expect(down(w, 'Space', { repeat: true }).defaultPrevented).toBe(true);
    // And at keyup, where a button's Space activates: on the pitch screens and the nav screens.
    const atKeyup = (screen: KeyboardScreen): boolean[] => {
      const k = keyboard(screen);
      return ['KeyW', 'Space', 'Enter', 'ArrowUp'].map((c) => up(k.w, c).defaultPrevented);
    };
    expect(atKeyup('pitch')).toEqual([true, true, true, false]);
    expect(atKeyup('spectator')).toEqual([true, true, true, false]);
    expect(atKeyup('menu')).toEqual([false, true, true, false]);
    expect(atKeyup('results')).toEqual([false, true, true, false]);
    expect(atKeyup('other')).toEqual([false, false, false, false]);
    // A key outside the play set and the menus' is the browser's everywhere.
    expect(down(keyboard('pitch').w, 'Tab').defaultPrevented).toBe(false);
    expect(down(keyboard('pitch').w, 'KeyF').defaultPrevented).toBe(false);
  });
});

describe('the key-to-screen figure (R-6)', () => {
  it("reports the event time of the first change a read shows, and none when nothing changed", () => {
    const { w, k } = keyboard();
    expect(k.read().changedAtMs).toBeNull();
    down(w, 'KeyW', { at: 100 });
    expect(k.read().changedAtMs).toBe(100);
    // Held on: no change.
    down(w, 'KeyW', { at: 150, repeat: true });
    expect(k.read().changedAtMs).toBeNull();
    // Two changes before a read: the first's time.
    down(w, 'KeyD', { at: 200 });
    down(w, 'ShiftLeft', { at: 250 });
    expect(k.read().changedAtMs).toBe(200);
    // A keyup that changes the direction; one that changes nothing.
    up(w, 'KeyD', { at: 300 });
    expect(k.read().changedAtMs).toBe(300);
    down(w, 'KeyS', { at: 310 });
    down(w, 'KeyA', { at: 320 });
    k.read();
    // W and S cancel; letting W go changes the direction to S's and A's.
    up(w, 'KeyW', { at: 330 });
    expect(k.read().changedAtMs).toBe(330);
    // A press changes the input; its repeat doesn't.
    down(w, 'KeyQ', { at: 400 });
    expect(k.read().changedAtMs).toBe(400);
    down(w, 'KeyQ', { at: 410, repeat: true });
    expect(k.read().changedAtMs).toBeNull();
    // A key off the play set changes nothing.
    down(w, 'KeyF', { at: 500 });
    expect(k.read().changedAtMs).toBeNull();
    // Released: the time goes with the presses.
    down(w, 'Space', { at: 600 });
    k.release();
    expect(k.read().changedAtMs).toBeNull();
    // Shift alone, no direction held: zoomies is in the input too, so its change has its time (R-6).
    down(w, 'ShiftLeft', { at: 700 });
    expect(k.read().changedAtMs).toBe(700);
    up(w, 'ShiftLeft', { at: 710 });
    expect(k.read().changedAtMs).toBe(710);
  });
});

describe('dispose', () => {
  it('takes its listeners off and lets go', () => {
    const { w, k, ui } = keyboard();
    down(w, 'KeyW');
    k.dispose();
    expect(stepOf(k.read())).toBeNull();
    down(w, 'KeyW');
    down(w, 'Space');
    expect(down(w, 'Escape').defaultPrevented).toBe(false);
    const s = k.read();
    expect([stepOf(s), pressesOf(s), ui]).toEqual([null, [], []]);
  });
});
