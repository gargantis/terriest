// Menus without a mouse (M4's design, research/m4/DESIGN.md, §1.46, §4.9;
// PLAN Q-17, C-34; L82, M4-Q26): the keyboard's and the gamepad's UI
// commands move the focus among a screen's buttons and press the focused
// one, and a pointer's press passes the same rules, through attach(). A
// button that can't act yet is aria-disabled, never disabled (src/ui/dom.ts's
// setEnabled), so it keeps the focus its screen gave it: the nav moves onto
// it and never presses it, by key, pad or click. A repeat never presses.
// With a guard, as Results has, only a press that began guardMs after the
// screen showed acts, a pointer's included, so a jump held or mashed at the
// final whistle presses nothing; every press is reported with its time, its
// source and whether it acted, for the app's announcements log (§1.40).
// A button that's hidden, or inside something hidden, is passed over, as a
// browser won't focus it; one the nav moves to is brought into view, its
// window's or its panel's scroll, so a short window never hides the focus
// (§5.14). Settings' pad nav holds its checkboxes and radios too, each
// pressed as a pointer would press it (padOnly, L82); Practice's setup's,
// Propose's and from C-59 the Rules screen's hold their selects, whose value the d-pad's left and right step
// an option at a time, up and down still moving on, and whose keys stay the
// browser's (§4.9's pad parts, extended for L82 in phase 2b). New at M4.

import type { InputKind, UiCommand } from '../input/source';
import { browserClock, type Clock } from './clock';
import { isEnabled } from './dom';

export type PressSource = InputKind | 'pointer';

/** What a nav moves among: buttons and Settings' checkboxes and radios, which it presses, and selects,
 *  which the pad's left and right step (L82). */
export type NavControl = HTMLButtonElement | HTMLInputElement | HTMLSelectElement;

/** A select's value one option along, none past either end, as the browser's own arrows step a closed one,
 *  with the input and change a person's choice fires, from the element's own window, where it has one
 *  (L82). */
function stepSelect(sel: HTMLSelectElement, by: 1 | -1): void {
  const options = Array.from(sel.querySelectorAll('option')).filter((o) => !o.disabled);
  const at = options.findIndex((o) => o.value === sel.value);
  const next = at < 0 ? undefined : options[at + by];
  if (next === undefined) return;
  sel.value = next.value;
  const EventOf = (sel.ownerDocument.defaultView as { readonly Event?: typeof Event } | null)?.Event;
  if (EventOf === undefined) return;
  sel.dispatchEvent(new EventOf('input', { bubbles: true }));
  sel.dispatchEvent(new EventOf('change', { bubbles: true }));
}

/** Shown: neither it nor an element holding it hidden, as setShown hides them; a browser focuses no other.
 *  Elements only: the document's own hidden is the page's visibility, and a hidden page still opens
 *  Practice's menu on its buttons (Q-15). */
function shown(el: Element): boolean {
  if ((el as HTMLElement).hidden) return false;
  for (let n = el.parentNode; n !== null && 'tagName' in n; n = n.parentNode) if ((n as HTMLElement).hidden) return false;
  return true;
}

export interface NavOptions {
  /** Only a press that began at least this long after shownAtMs acts (Q-17's guard, M4-Q26). */
  readonly guardMs?: number;
  /** When the screen showed, the clock's: its now() when the nav is made, by default. */
  readonly shownAtMs?: number;
  readonly clock?: Clock;
  /** Each press: when it began, by the page clock, its source, and whether it acted. */
  readonly onPress?: (atMs: number, source: PressSource, accepted: boolean) => void;
}

export class ButtonNav {
  private readonly buttons: () => readonly NavControl[];
  private readonly guardMs: number;
  private readonly shownAtMs: number;
  private readonly onPress: ((atMs: number, source: PressSource, accepted: boolean) => void) | null;
  /** The nav's own click() is under way: the click it dispatches has been decided already. */
  private clicking = false;
  /** The last pointerdown on one of the buttons: where a pointer's press began. */
  private down: { readonly button: NavControl; readonly atMs: number } | null = null;

  /** buttons: the screen's, in order, read again at each command, so buttons that come and go are
   *  followed; a hidden one, or one inside something hidden, is passed over. */
  constructor(buttons: () => readonly NavControl[], o: NavOptions = {}) {
    this.buttons = buttons;
    this.guardMs = o.guardMs ?? 0;
    this.shownAtMs = o.shownAtMs ?? (o.clock ?? browserClock).now();
    this.onPress = o.onPress ?? null;
  }

  /** Q-17: up and left move the focus to the button before, down and right to the one after, round the
   *  ends, aria-disabled ones included; press activates the focused one unless it's aria-disabled or the
   *  guard takes it, and a repeat never does. On a focused select, left and right step its value instead,
   *  and press does nothing; and the keyboard's commands do nothing there, its keys the browser's (§4.9). */
  ui(c: UiCommand): void {
    const select = this.focusedSelect();
    if (select !== null && c.source === 'keyboard') return;
    switch (c.kind) {
      case 'up':
        this.move(-1);
        break;
      case 'left':
        if (select !== null) stepSelect(select, -1);
        else this.move(-1);
        break;
      case 'down':
        this.move(1);
        break;
      case 'right':
        if (select !== null) stepSelect(select, 1);
        else this.move(1);
        break;
      case 'press':
        if (select === null) this.pressFocused(c);
        break;
      default:
        break;
    }
  }

  /** The first button takes the focus: Ready on Pre-match, Resume in Practice's menu, Play again on
   *  Results (Q-17). */
  focusFirst(): void {
    this.list()[0]?.focus({ preventScroll: true });
  }

  /** A pointer's press of the buttons under root, and any other click on them, by the same rules: one on
   *  an aria-disabled button, or one the guard takes, never reaches the button's own listeners. A
   *  pointer's press began at its pointerdown. Returns the listeners' removal. */
  attach(root: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>): () => void {
    const down = (e: Event): void => {
      const b = this.owner(e.target);
      this.down = b === null ? null : { button: b, atMs: e.timeStamp };
    };
    const click = (e: Event): void => {
      if (this.clicking) return;
      const b = this.owner(e.target);
      if (b === null) return;
      const began = this.down !== null && this.down.button === b ? this.down.atMs : e.timeStamp;
      this.down = null;
      if (this.decide(b, began, 'pointer')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    root.addEventListener('pointerdown', down, true);
    root.addEventListener('click', click, true);
    return () => {
      root.removeEventListener('pointerdown', down, true);
      root.removeEventListener('click', click, true);
    };
  }

  private list(): readonly NavControl[] {
    return this.buttons().filter(shown);
  }

  private focusedIn(list: readonly NavControl[]): number {
    const active = list[0]?.ownerDocument.activeElement ?? null;
    return active === null ? -1 : list.indexOf(active as NavControl);
  }

  /** The focused control, if it's one of the nav's selects. */
  private focusedSelect(): HTMLSelectElement | null {
    const list = this.list();
    const f = list[this.focusedIn(list)];
    return f !== undefined && f.tagName === 'SELECT' ? (f as HTMLSelectElement) : null;
  }

  /** The focus to the next button, or the one before, brought into view as little as it takes: the
   *  window's scroll on a long screen, Results' Copy at its foot, or a panel's, Settings' over the pitch. */
  private move(step: 1 | -1): void {
    const list = this.list();
    if (list.length === 0) return;
    const at = this.focusedIn(list);
    const next = list[at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length]!;
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest' });
  }

  private pressFocused(c: UiCommand): void {
    if (c.repeat) return;
    const list = this.list();
    const b = list[this.focusedIn(list)];
    if (b === undefined) return;
    if (!this.decide(b, c.pressedAt, c.source)) return;
    this.clicking = true;
    try {
      b.click();
    } finally {
      this.clicking = false;
    }
  }

  /** Whether a press that began at `began` acts, reported either way. */
  private decide(b: NavControl, began: number, source: PressSource): boolean {
    const guarded = this.guardMs > 0 && began - this.shownAtMs < this.guardMs;
    const accepted = !guarded && isEnabled(b);
    this.onPress?.(began, source, accepted);
    return accepted;
  }

  private owner(target: EventTarget | null): NavControl | null {
    if (target === null) return null;
    for (const b of this.buttons()) if (b === target || b.contains(target as Node)) return b;
    return null;
  }
}

/** The gamepad's commands to a screen whose keys the browser keeps: the keyboard's Enter already presses the
 *  focused button there, by the browser's own activation, and its Tab moves among every control, so only
 *  another device's are the nav's (§4.9, L82). */
export function padOnly(nav: ButtonNav): (c: UiCommand) => void {
  return (c) => {
    if (c.source !== 'keyboard') nav.ui(c);
  };
}
