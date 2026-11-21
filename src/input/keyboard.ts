// The keyboard (PLAN D-29, L77, Q-17, C-34, C-52; M4's design,
// research/m4/DESIGN.md, §1.21, §4.1, §4.2, §4.8–§4.10): the page's one
// keydown listener, by event.code, so other layouts play on the same keys
// (L77). On a pitch screen, a player's with no menu open:
// - W, A, S and D give eight directions, screen-relative: W up, A left, S
//   down, D right, and their diagonals; either Shift is zoomies;
// - Space jumps, E pounces, Q barks and C switches the view, each a press
//   on its first keydown, never a repeat, kept until the next read, so a
//   tap shorter than a tick still counts (D-10).
// Escape, Enter and the arrows become Q-17's UiCommands on every screen, and
// so do Space on Results and a spectator's C, which cycles what it follows.
// Defaults: the pitch screens prevent the play keys', so Space never presses
// a focused button (C-34); they, the menu and Results, the screens with a
// ButtonNav, also prevent the commands' keys', and Space's and Enter's at
// keyup too, where a button activates, so the nav presses a focused button
// once and the browser never does too (§4.9); every other screen keeps
// every default, the browser's own activation included, so a screen there
// leaves 'press' to the browser. A key held with Ctrl, Alt or Meta drives
// nothing, so Ctrl is never used (Ctrl+W closes the tab), and Meta lets go
// of everything, since macOS sends no keyup for a key let go while it's
// held; a key typed into a field (an input, a textarea, a select or an
// editable element) drives nothing, its keys its own, but for Escape from a
// field that takes no text, a checkbox, a radio, a range or a select, none
// of which uses it, so the menu still closes from one. Everything is
// released on blur, Windows' Sticky Keys prompt's after five Shifts among
// them (C-52), and while the page is hidden (D-29, D-31), and whenever
// it's read off the pitch, so a menu or a screen change leaves nothing
// held; a key still held comes back with its next repeat. Each read reports
// the event time of the first change it shows, for the key-to-screen figure
// (R-6, src/input/controls.ts).
// Ports the tuning page's dev/tuning/keyboard.ts and roslambo's
// bindKeyboard (src/ui/input.ts), with A.2's directions left to
// src/input/anchoring.ts and the press counters to the controls. New at M4.

import type { Device, DeviceState, UiCommand } from './source';

/** The play set (D-29), by event.code. */
export const PLAY_CODES: readonly string[] = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyQ', 'KeyC'];

/** What the screen is, for the keys: a player's pitch screen with no menu open, a spectator's, the
 *  menu (over the pitch), Results, or any other screen. */
export type KeyboardScreen = 'pitch' | 'spectator' | 'menu' | 'results' | 'other';

/** Q-17's keys on every screen. */
const UI_KEYS: ReadonlyMap<string, UiCommand['kind']> = new Map([
  ['Escape', 'menu'], ['Enter', 'press'], ['NumpadEnter', 'press'], ['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'],
  ['ArrowRight', 'right'],
]);

/** The keys held for a direction or zoomies; the rest are presses. */
const HELD_CODES: readonly string[] = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'];

/** The eighth of a turn counter-clockwise from screen up for x = D − A and y = W − S, by
 *  3 · (x + 1) + (y + 1); null: none, A and D or W and S cancelling. */
const EIGHTHS: readonly (number | null)[] = [3, 2, 1, 4, null, 0, 5, 6, 7];
const EIGHTH = Math.PI / 4;

/** Inputs pressed like a button, which keep no keys. */
const BUTTON_INPUTS: readonly string[] = ['button', 'submit', 'reset', 'image'];
/** Inputs that take no text: they keep their keys, Space and the arrows, but none uses Escape. */
const CHOICE_INPUTS: readonly string[] = ['checkbox', 'radio', 'range', 'color', 'file'];

/** A field, read by its shape so the check needs no DOM classes: 'text' for one that takes typed text, a
 *  textarea, an editable element or a text-like input, where Escape may cancel an input method's
 *  composition; 'choice' for a select or an input that takes none; null for anything else. */
function fieldOf(target: EventTarget | null): 'text' | 'choice' | null {
  if (target === null || typeof target !== 'object') return null;
  const el = target as { readonly tagName?: unknown; readonly type?: unknown; readonly isContentEditable?: unknown };
  if (el.isContentEditable === true || el.tagName === 'TEXTAREA') return 'text';
  if (el.tagName === 'SELECT') return 'choice';
  if (el.tagName !== 'INPUT') return null;
  const type = String(el.type).toLowerCase();
  return BUTTON_INPUTS.includes(type) ? null : CHOICE_INPUTS.includes(type) ? 'choice' : 'text';
}

/** A key typed into a field drives nothing (D-29): an input, a textarea, a select or an editable element. */
export function isField(target: EventTarget | null): boolean {
  return fieldOf(target) !== null;
}

export class Keyboard implements Device {
  readonly kind = 'keyboard' as const;
  private readonly onUi: (c: UiCommand) => void;
  private readonly uiActive: () => KeyboardScreen;
  private readonly held = new Set<string>();
  private jump = false;
  private pounce = false;
  private bark = false;
  private view = false;
  /** The event time of the first change since the last read. */
  private changedAt: number | null = null;
  private readonly detach: () => void;

  constructor(target: Window, onUi: (c: UiCommand) => void, uiActive: () => KeyboardScreen) {
    this.onUi = onUi;
    this.uiActive = uiActive;
    const down = (e: KeyboardEvent): void => this.keydown(e);
    const up = (e: KeyboardEvent): void => this.keyup(e);
    // The window's own blur: an element's doesn't bubble to it.
    const blur = (e: Event): void => {
      if (e.target === target) this.release();
    };
    const doc = target.document;
    const visibility = (): void => {
      if (doc.visibilityState === 'hidden') this.release();
    };
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    doc.addEventListener('visibilitychange', visibility);
    this.detach = () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
      doc.removeEventListener('visibilitychange', visibility);
    };
  }

  /** What's held now, and what was pressed and first changed since the last read. Off a player's pitch
   *  screen it releases everything and reads as nothing held. */
  read(): DeviceState {
    if (this.uiActive() !== 'pitch') this.release();
    const state: DeviceState = {
      direction: this.direction(), stickStep: null, zoomies: this.zoomies(),
      jump: this.jump, pounce: this.pounce, bark: this.bark, view: this.view, changedAtMs: this.changedAt,
    };
    this.jump = this.pounce = this.bark = this.view = false;
    this.changedAt = null;
    return state;
  }

  /** Nothing held, and no press waiting (D-29). */
  release(): void {
    this.held.clear();
    this.jump = this.pounce = this.bark = this.view = false;
    this.changedAt = null;
  }

  dispose(): void {
    this.detach();
    this.release();
  }

  private keydown(e: KeyboardEvent): void {
    if (e.metaKey) {
      // macOS sends no keyup for a key let go while Meta is held, so nothing stays held through it.
      this.release();
      return;
    }
    const field = fieldOf(e.target);
    if (e.ctrlKey || e.altKey || (field !== null && !(field === 'choice' && e.code === 'Escape'))) return;
    const ui = this.uiActive();
    const nav = ui !== 'other';
    const command = UI_KEYS.get(e.code) ?? (e.code === 'Space' && ui === 'results' ? 'press' : e.code === 'KeyC' && ui === 'spectator' ? 'next' : undefined);
    if (command !== undefined) {
      if (nav) e.preventDefault();
      this.onUi({ kind: command, pressedAt: e.timeStamp, source: 'keyboard', repeat: e.repeat });
      return;
    }
    if (!PLAY_CODES.includes(e.code)) return;
    if (ui === 'pitch' || ui === 'spectator' || (nav && e.code === 'Space')) e.preventDefault();
    if (ui !== 'pitch') return;
    const before = this.heldNow();
    if (HELD_CODES.includes(e.code)) this.held.add(e.code);
    let pressed = false;
    if (!e.repeat) {
      if (e.code === 'Space') pressed = this.jump = true;
      else if (e.code === 'KeyE') pressed = this.pounce = true;
      else if (e.code === 'KeyQ') pressed = this.bark = true;
      else if (e.code === 'KeyC') pressed = this.view = true;
    }
    if (pressed || this.heldNow() !== before) this.changedAt ??= e.timeStamp;
  }

  private keyup(e: KeyboardEvent): void {
    // Always: a key let go in a field, or with a modifier held, still lets go.
    const before = this.heldNow();
    this.held.delete(e.code);
    if (this.heldNow() !== before) this.changedAt ??= e.timeStamp;
    if (isField(e.target)) return;
    const ui = this.uiActive();
    const nav = ui !== 'other';
    const activates = e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter';
    if (((ui === 'pitch' || ui === 'spectator') && PLAY_CODES.includes(e.code)) || (nav && activates)) e.preventDefault();
  }

  /** The direction held, in radians counter-clockwise from screen up, or null. */
  private direction(): number | null {
    const eighth = this.eighth();
    return eighth === null ? null : eighth * EIGHTH;
  }

  private eighth(): number | null {
    const x = this.has('KeyD') - this.has('KeyA');
    const y = this.has('KeyW') - this.has('KeyS');
    return EIGHTHS[3 * (x + 1) + (y + 1)] ?? null;
  }

  private zoomies(): boolean {
    return this.held.has('ShiftLeft') || this.held.has('ShiftRight');
  }

  /** The direction and zoomies as one number, to tell whether an event changed them. */
  private heldNow(): number {
    return 2 * (this.eighth() ?? EIGHTHS.length) + (this.zoomies() ? 1 : 0);
  }

  private has(code: string): number {
    return this.held.has(code) ? 1 : 0;
  }
}
