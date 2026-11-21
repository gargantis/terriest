import { describe, expect, it } from 'vitest';
import { config } from '../config';
import type { InputKind, UiCommand } from '../input/source';
import { FakeClock } from './clock-testing';
import { isEnabled, setEnabled } from './dom';
import { ButtonNav, type PressSource } from './nav';

// Q-17's menus without a mouse (M4's design §1.46, §4.9, §9.2; M4-Q26), on
// buttons that keep only what the nav reads, so no DOM is needed: the
// arrows' and the d-pad's moves; a press of the focused button, never of an
// aria-disabled one, by key, pad or click, and never on a repeat; and
// Results' guard for keys, the pad and a pointer, each press reported once.

class Doc {
  activeElement: unknown = null;
}

class FakeEvent {
  stopped = false;
  prevented = false;
  readonly target: unknown;
  readonly timeStamp: number;
  constructor(target: unknown, timeStamp: number) {
    this.target = target;
    this.timeStamp = timeStamp;
  }
  preventDefault(): void {
    this.prevented = true;
  }
  stopImmediatePropagation(): void {
    this.stopped = true;
  }
}

/** The screen's element the nav attaches to: capture listeners only, as the nav adds. */
class Root {
  listeners: { type: string; fn: (e: Event) => void; capture: boolean }[] = [];
  addEventListener(type: string, fn: (e: Event) => void, capture?: boolean): void {
    this.listeners.push({ type, fn, capture: capture === true });
  }
  removeEventListener(type: string, fn: (e: Event) => void, capture?: boolean): void {
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn && l.capture === (capture === true)));
  }
  /** An event down to its target: whether it got there, past the capture listeners. */
  dispatch(type: string, target: unknown, timeStamp: number): boolean {
    const e = new FakeEvent(target, timeStamp);
    for (const l of this.listeners) {
      if (l.type !== type || !l.capture) continue;
      l.fn(e as unknown as Event);
      if (e.stopped) return false;
    }
    return true;
  }
}

class Button {
  hidden = false;
  textContent = '';
  acted = 0;
  private readonly attrs = new Map<string, string>();
  readonly ownerDocument: Doc;
  private readonly root: Root;
  private readonly clock: FakeClock;
  constructor(ownerDocument: Doc, root: Root, clock: FakeClock) {
    this.ownerDocument = ownerDocument;
    this.root = root;
    this.clock = clock;
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
  focus(): void {
    this.ownerDocument.activeElement = this;
  }
  contains(n: unknown): boolean {
    return n === this;
  }
  /** As HTMLElement.click(): a click through the root, then the button's own listener. */
  click(): void {
    if (this.root.dispatch('click', this, this.clock.now())) this.acted++;
  }
  /** A pointer's press: down at one time, the browser's click at its release. */
  pointer(downAt: number, upAt: number): void {
    this.root.dispatch('pointerdown', this, downAt);
    if (this.root.dispatch('click', this, upAt)) this.acted++;
  }
}

function screen(n: number, clock = new FakeClock(1000)): { doc: Doc; root: Root; buttons: Button[]; clock: FakeClock } {
  const doc = new Doc();
  const root = new Root();
  return { doc, root, clock, buttons: Array.from({ length: n }, () => new Button(doc, root, clock)) };
}

const asButtons = (bs: readonly Button[]): readonly HTMLButtonElement[] => bs as unknown as readonly HTMLButtonElement[];
const cmd = (kind: UiCommand['kind'], pressedAt = 0, source: InputKind = 'keyboard', repeat = false): UiCommand => ({ kind, pressedAt, source, repeat });

describe('ButtonNav (Q-17)', () => {
  it('moves the focus among the buttons round the ends, aria-disabled ones included, passing over hidden ones', () => {
    const { doc, buttons: [a, b, c, d] } = screen(4);
    const nav = new ButtonNav(() => asButtons([a!, b!, c!, d!]));
    d!.hidden = true;
    setEnabled(b as unknown as HTMLElement, false, 'Joining…');
    nav.ui(cmd('down'));
    expect(doc.activeElement).toBe(a);
    nav.ui(cmd('down'));
    expect(doc.activeElement).toBe(b); // aria-disabled, and focused
    nav.ui(cmd('right'));
    expect(doc.activeElement).toBe(c);
    nav.ui(cmd('down'));
    expect(doc.activeElement).toBe(a); // round the end, past the hidden one
    nav.ui(cmd('up'));
    expect(doc.activeElement).toBe(c);
    nav.ui(cmd('left'));
    expect(doc.activeElement).toBe(b);
    doc.activeElement = null;
    nav.ui(cmd('up'));
    expect(doc.activeElement).toBe(c); // from nowhere, up starts at the end
    nav.ui(cmd('menu'));
    nav.ui(cmd('next'));
    expect(doc.activeElement).toBe(c);
    nav.focusFirst();
    expect(doc.activeElement).toBe(a);
  });

  it('presses the focused button once a press, never an aria-disabled one, never on a repeat', () => {
    const { doc, buttons: [a, b] } = screen(2);
    const nav = new ButtonNav(() => asButtons([a!, b!]));
    nav.ui(cmd('press'));
    expect([a!.acted, b!.acted]).toEqual([0, 0]); // nothing focused
    a!.focus();
    nav.ui(cmd('press'));
    nav.ui(cmd('press', 0, 'keyboard', true));
    nav.ui(cmd('press', 0, 'gamepad', true));
    expect(a!.acted).toBe(1);
    setEnabled(b as unknown as HTMLElement, false, 'Joining…');
    expect([b!.textContent, b!.getAttribute('aria-disabled'), isEnabled(b!)]).toEqual(['Joining…', 'true', false]);
    nav.ui(cmd('down'));
    expect(doc.activeElement).toBe(b);
    nav.ui(cmd('press'));
    nav.ui(cmd('press', 0, 'gamepad'));
    expect(b!.acted).toBe(0);
    setEnabled(b as unknown as HTMLElement, true, 'Ready');
    expect([b!.textContent, b!.getAttribute('aria-disabled')]).toEqual(['Ready', null]);
    nav.ui(cmd('press', 0, 'gamepad'));
    expect(b!.acted).toBe(1); // the focus held on it: the press acts once it can
  });

  it("keeps a click on an aria-disabled button from it, and lets one on an enabled button through (attach)", () => {
    const { root, buttons: [a, b] } = screen(2);
    const nav = new ButtonNav(() => asButtons([a!, b!]));
    const detach = nav.attach(root);
    setEnabled(a as unknown as HTMLElement, false, 'Starting…');
    a!.pointer(5, 6);
    b!.pointer(5, 6);
    expect([a!.acted, b!.acted]).toEqual([0, 1]);
    detach();
    expect(root.listeners).toEqual([]);
  });

  it("guards Results: only a press that began 0.5 s after it showed acts, by key, pad or pointer, each reported once (M4-Q26)", () => {
    const clock = new FakeClock(1000);
    const { root, buttons: [again, home] } = screen(2, clock);
    const presses: [number, PressSource, boolean][] = [];
    const guardMs = config.resultsPressGuardSeconds * 1000;
    expect(guardMs).toBe(500);
    const nav = new ButtonNav(() => asButtons([again!, home!]), { guardMs, clock, onPress: (at, source, ok) => presses.push([at, source, ok]) });
    nav.attach(root);
    nav.focusFirst();
    nav.ui(cmd('press', 1100)); // a key mashed at the final whistle
    nav.ui(cmd('press', 1499, 'gamepad'));
    again!.pointer(1400, 1600); // a tap that began inside the guard, and let go after it
    nav.ui(cmd('press', 1700, 'keyboard', true)); // a key held through it repeats: never a press
    expect(again!.acted).toBe(0);
    nav.ui(cmd('press', 1500)); // the guard's end: it acts
    expect(again!.acted).toBe(1);
    home!.pointer(1700, 1750);
    nav.ui(cmd('right', 1800, 'gamepad'));
    nav.ui(cmd('press', 1800, 'gamepad'));
    expect([again!.acted, home!.acted]).toEqual([1, 2]);
    expect(presses).toEqual([
      [1100, 'keyboard', false],
      [1499, 'gamepad', false],
      [1400, 'pointer', false],
      [1500, 'keyboard', true],
      [1700, 'pointer', true],
      [1800, 'gamepad', true],
    ]);
  });

  it('shows at its clock\'s now unless told when, and has no guard unless given one', () => {
    const clock = new FakeClock(5000);
    const { buttons: [a] } = screen(1, clock);
    const reported: boolean[] = [];
    const guarded = new ButtonNav(() => asButtons([a!]), { guardMs: 500, clock, onPress: (_t, _s, ok) => reported.push(ok) });
    const told = new ButtonNav(() => asButtons([a!]), { guardMs: 500, shownAtMs: 0, onPress: (_t, _s, ok) => reported.push(ok) });
    const open = new ButtonNav(() => asButtons([a!]), { onPress: (_t, _s, ok) => reported.push(ok) });
    a!.focus();
    guarded.ui(cmd('press', 5400));
    told.ui(cmd('press', 5400));
    open.ui(cmd('press', -1e9)); // no guard: whenever it began
    expect(reported).toEqual([false, true, true]);
    expect(a!.acted).toBe(2);
  });
});
