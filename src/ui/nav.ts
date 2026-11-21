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
// New at M4.

import type { InputKind, UiCommand } from '../input/source';
import { browserClock, type Clock } from './clock';
import { isEnabled } from './dom';

export type PressSource = InputKind | 'pointer';

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
  private readonly buttons: () => readonly HTMLButtonElement[];
  private readonly guardMs: number;
  private readonly shownAtMs: number;
  private readonly onPress: ((atMs: number, source: PressSource, accepted: boolean) => void) | null;
  /** The nav's own click() is under way: the click it dispatches has been decided already. */
  private clicking = false;
  /** The last pointerdown on one of the buttons: where a pointer's press began. */
  private down: { readonly button: HTMLButtonElement; readonly atMs: number } | null = null;

  /** buttons: the screen's, in order, read again at each command, so buttons that come and go are
   *  followed; a hidden one is passed over. */
  constructor(buttons: () => readonly HTMLButtonElement[], o: NavOptions = {}) {
    this.buttons = buttons;
    this.guardMs = o.guardMs ?? 0;
    this.shownAtMs = o.shownAtMs ?? (o.clock ?? browserClock).now();
    this.onPress = o.onPress ?? null;
  }

  /** Q-17: up and left move the focus to the button before, down and right to the one after, round the
   *  ends, aria-disabled ones included; press activates the focused one unless it's aria-disabled or the
   *  guard takes it, and a repeat never does. */
  ui(c: UiCommand): void {
    switch (c.kind) {
      case 'up':
      case 'left':
        this.move(-1);
        break;
      case 'down':
      case 'right':
        this.move(1);
        break;
      case 'press':
        this.pressFocused(c);
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

  private list(): readonly HTMLButtonElement[] {
    return this.buttons().filter((b) => !b.hidden);
  }

  private focusedIn(list: readonly HTMLButtonElement[]): number {
    const active = list[0]?.ownerDocument.activeElement ?? null;
    return active === null ? -1 : list.indexOf(active as HTMLButtonElement);
  }

  private move(step: 1 | -1): void {
    const list = this.list();
    if (list.length === 0) return;
    const at = this.focusedIn(list);
    const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
    list[next]!.focus({ preventScroll: true });
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
  private decide(b: HTMLButtonElement, began: number, source: PressSource): boolean {
    const guarded = this.guardMs > 0 && began - this.shownAtMs < this.guardMs;
    const accepted = !guarded && isEnabled(b);
    this.onPress?.(began, source, accepted);
    return accepted;
  }

  private owner(target: EventTarget | null): HTMLButtonElement | null {
    if (target === null) return null;
    for (const b of this.buttons()) if (b === target || b.contains(target as Node)) return b;
    return null;
  }
}
