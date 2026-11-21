import { describe, expect, it } from 'vitest';
import { config } from '../config';
import type { InputKind, UiCommand } from '../input/source';
import { FakeClock } from './clock-testing';
import { isEnabled, setEnabled } from './dom';
import { ButtonNav, type NavControl, padOnly, type PressSource } from './nav';

// Q-17's menus without a mouse (M4's design §1.46, §4.9, §9.2; M4-Q26), on
// buttons that keep only what the nav reads, so no DOM is needed: the
// arrows' and the d-pad's moves, past a button that's hidden or inside
// something hidden, each brought into view; a press of the focused button,
// never of an aria-disabled one, by key, pad or click, and never on a
// repeat; Results' guard for keys, the pad and a pointer, each press
// reported once; a pad-only nav, whose keys stay the browser's; and a
// select the pad's left and right step, an option at a time, with the
// events a person's choice fires, its keys the browser's (L82, phase 2b).

class Doc {
  activeElement: unknown = null;
  /** The window's Event, for the events a stepped select fires: none in a document without one. */
  readonly defaultView: { readonly Event?: typeof Event } | null;
  constructor(withEvents = true) {
    this.defaultView = withEvents ? { Event } : null;
  }
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
  /** What holds it: an element, which may be hidden, as Join's packs are while it connects, or the
   *  document, whose own hidden is the page's visibility. */
  parentNode: { tagName?: string; hidden: boolean; parentNode: null } | null = null;
  /** Each scrollIntoView's options. */
  readonly scrolled: unknown[] = [];
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
  scrollIntoView(o: unknown): void {
    this.scrolled.push(o);
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

/** A select as the nav reads it: its options, its value, its focus, and each event it's sent. */
class Select {
  readonly tagName = 'SELECT';
  hidden = false;
  parentNode = null;
  value: string;
  clicks = 0;
  /** Each event dispatched on it: its type, and whether it bubbles. */
  readonly events: string[] = [];
  readonly scrolled: unknown[] = [];
  readonly ownerDocument: Doc;
  private readonly options: { readonly value: string; readonly disabled: boolean }[];
  constructor(ownerDocument: Doc, values: readonly string[], value: string, disabled: readonly string[] = []) {
    this.ownerDocument = ownerDocument;
    this.options = values.map((v) => ({ value: v, disabled: disabled.includes(v) }));
    this.value = value;
  }
  querySelectorAll(selector: string): readonly { readonly value: string; readonly disabled: boolean }[] {
    if (selector !== 'option') throw new Error(`a select's fake reads only its options, not ${selector}`);
    return this.options;
  }
  getAttribute(): string | null {
    return null;
  }
  focus(): void {
    this.ownerDocument.activeElement = this;
  }
  scrollIntoView(o: unknown): void {
    this.scrolled.push(o);
  }
  contains(n: unknown): boolean {
    return n === this;
  }
  click(): void {
    this.clicks++;
  }
  dispatchEvent(e: Event): boolean {
    this.events.push(`${e.type}${e.bubbles ? ' bubbling' : ''}`);
    return true;
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

  it("passes over a button inside something hidden, which a browser won't focus, as Join's Play buttons are while it connects", () => {
    const { doc, buttons: [a, b, c] } = screen(3);
    const packs = { tagName: 'DIV', hidden: true, parentNode: null };
    b!.parentNode = packs;
    const nav = new ButtonNav(() => asButtons([a!, b!, c!]));
    nav.ui(cmd('down'));
    nav.ui(cmd('down'));
    expect(doc.activeElement).toBe(c);
    nav.ui(cmd('up'));
    expect(doc.activeElement).toBe(a);
    packs.hidden = false;
    nav.ui(cmd('down'));
    expect(doc.activeElement).toBe(b);
  });

  it("takes a button on a hidden page, whose document's own hidden is the page's visibility, as a hidden page opens Practice's menu on Resume (Q-15)", () => {
    const { doc, buttons: [resume, leave] } = screen(2);
    const page = { hidden: true, parentNode: null }; // the document of a hidden page: no element, no tag
    resume!.parentNode = page;
    leave!.parentNode = page;
    const nav = new ButtonNav(() => asButtons([resume!, leave!]));
    nav.focusFirst();
    expect(doc.activeElement).toBe(resume);
    nav.ui(cmd('down', 0, 'gamepad'));
    expect(doc.activeElement).toBe(leave);
  });

  it('brings the button it moves to into view, as little as it takes, so a short window never hides the focus (§5.14)', () => {
    const { buttons: [a, b] } = screen(2);
    const nav = new ButtonNav(() => asButtons([a!, b!]));
    nav.ui(cmd('down'));
    nav.ui(cmd('down'));
    nav.ui(cmd('up', 0, 'gamepad'));
    expect([a!.scrolled, b!.scrolled]).toEqual([[{ block: 'nearest' }, { block: 'nearest' }], [{ block: 'nearest' }]]);
  });

  it("leaves a pad-only screen's keys to the browser, and takes another device's commands (padOnly)", () => {
    const { doc, buttons: [a, b] } = screen(2);
    const ui = padOnly(new ButtonNav(() => asButtons([a!, b!])));
    ui(cmd('down'));
    expect(doc.activeElement).toBeNull();
    ui(cmd('down', 0, 'gamepad'));
    ui(cmd('press', 0, 'gamepad'));
    expect([doc.activeElement, a!.acted]).toEqual([a, 1]);
  });

  it("steps a focused select by the pad's left and right, an option at a time, none past either end, with a person's input and change; up and down move on", () => {
    const { doc, buttons: [start] } = screen(1);
    const size = new Select(doc, ['1', '2', '3', '4'], '2');
    const minutes = new Select(doc, ['1', '2', '3'], '3', ['2']);
    const nav = new ButtonNav(() => [size, minutes, start!] as unknown as readonly NavControl[]);
    nav.ui(cmd('down', 0, 'gamepad'));
    expect(doc.activeElement).toBe(size);
    nav.ui(cmd('right', 0, 'gamepad'));
    expect([size.value, size.events]).toEqual(['3', ['input bubbling', 'change bubbling']]);
    nav.ui(cmd('right', 0, 'gamepad'));
    nav.ui(cmd('right', 0, 'gamepad')); // the last option: no further, and nothing fired
    expect([size.value, size.events.length, doc.activeElement]).toEqual(['4', 4, size]);
    for (let k = 0; k < 4; k++) nav.ui(cmd('left', 0, 'gamepad'));
    expect([size.value, size.events.length]).toEqual(['1', 10]); // three steps down, the first option the end
    // Start presses no select: no click, no step, the focus kept.
    nav.ui(cmd('press', 0, 'gamepad'));
    expect([size.clicks, size.value, doc.activeElement]).toEqual([0, '1', size]);
    // Down to the next select, whose disabled option a step passes over; up and round the ends, as Q-17's.
    nav.ui(cmd('down', 0, 'gamepad'));
    nav.ui(cmd('left', 0, 'gamepad'));
    expect([doc.activeElement, minutes.value]).toEqual([minutes, '1']);
    nav.ui(cmd('down', 0, 'gamepad'));
    expect(doc.activeElement).toBe(start);
    nav.ui(cmd('right', 0, 'gamepad')); // on a button, left and right move as ever
    expect(doc.activeElement).toBe(size);
    nav.ui(cmd('up', 0, 'gamepad'));
    expect(doc.activeElement).toBe(start);
    nav.ui(cmd('press', 0, 'gamepad'));
    expect(start!.acted).toBe(1);
    expect([size.scrolled.length, minutes.scrolled.length]).toEqual([2, 1]); // each focus brought into view
  });

  it("leaves a focused select's keys to the browser, and fires nothing in a document whose window has no Event", () => {
    const doc = new Doc(false);
    const size = new Select(doc, ['1', '2', '3'], '2');
    const other = new Select(doc, ['1', '2'], '1');
    const nav = new ButtonNav(() => [size, other] as unknown as readonly NavControl[]);
    size.focus();
    for (const kind of ['left', 'right', 'up', 'down', 'press'] as const) {
      nav.ui(cmd(kind));
      expect([doc.activeElement, size.value, size.clicks], kind).toEqual([size, '2', 0]); // the browser's own keys act
    }
    nav.ui(cmd('right', 0, 'gamepad'));
    expect([size.value, size.events]).toEqual(['3', []]);
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
