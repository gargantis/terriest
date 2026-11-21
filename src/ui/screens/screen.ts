// What every screen is (M4's design, research/m4/DESIGN.md, §1.42, §5,
// §5.14; PLAN D-30, Q-17): roslambo's Screen, with the screen's name for the
// hook and the UI commands of Q-17 (src/input/source.ts). The app shows one
// at a time, disposes of the last and focuses the new one's first focus
// target: the element it marks data-focus, Ready on Pre-match and Play
// again on Results, else its h1 (focusScreen). The shared styles are
// screens.css's, added once. New at M4.

import type { UiCommand } from '../../input/source';
import type { Look, PackLook } from '../../render/look';
import { coatOf } from '../../render/look';
import { cssColour, h } from '../dom';
import type { ScreenName } from '../inspect';
import baseCss from '../screens.css?inline';
import { addStyle } from '../style';

export interface Screen {
  readonly el: HTMLElement;
  /** Inspection.screen: the pitch screen's moves from 'prematch' to 'match'. */
  readonly name: ScreenName;
  /** Each animation frame, while the app's frame loop runs. */
  frame?(nowMs: number): void;
  dispose?(): void;
  /** Q-17's commands, the keyboard's and the gamepad's. */
  ui?(c: UiCommand): void;
}

/** The screens' shared styles: each screen adds them as it builds its DOM. */
export function screenStyles(): void {
  addStyle(baseCss);
}

/** The screen's first focus target, focused without scrolling: its element marked data-focus, else its
 *  h1, which takes the focus without joining the tab order. */
export function focusScreen(s: Pick<Screen, 'el'>): void {
  const marked = s.el.querySelector<HTMLElement>('[data-focus]');
  const target = marked ?? s.el.querySelector<HTMLElement>('h1');
  if (target === null) return;
  if (marked === null) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

/** A coat's swatch, hidden from a screen reader: the coat's name beside it says which (coatName). */
export function coatSwatch(look: Look, coat: number): HTMLElement {
  const c = coatOf(look, coat);
  const el = h('span', { class: 'swatch coat', 'aria-hidden': 'true' });
  el.style.setProperty('--fur', cssColour(c.fur));
  el.style.setProperty('--marking', cssColour(c.markings === 'none' ? c.fur : c.marking));
  return el;
}

/** A coat's name, shown beside its swatch, so no coat is told by colour alone (§5.14), as Home's coat
 *  choice shows it; coat 0's for one outside the list, as it's drawn (D-12). */
export function coatName(look: Look, coat: number): HTMLElement {
  return h('span', { class: 'coat-name' }, coatOf(look, coat).name);
}

/** A pack's swatch, in its colour and its pattern (L43). */
export function packSwatch(p: PackLook): HTMLElement {
  const el = h('span', { class: `swatch pack ${p.pattern}`, 'aria-hidden': 'true' });
  el.style.setProperty('--c', cssColour(p.colour));
  return el;
}

/** A pack's name on the screens: the look's, as a word ("Blue"). */
export function packName(p: PackLook): string {
  return p.name.length === 0 ? p.name : `${p.name[0]!.toUpperCase()}${p.name.slice(1)}`;
}
