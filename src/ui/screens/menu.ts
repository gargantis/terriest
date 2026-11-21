// The match menu (M4's design, research/m4/DESIGN.md, §1.43, §4.9, §5.4,
// §5.8; PLAN §11, Q-15, Q-17; L158, M4-Q7): a layer over the pitch, on
// Pre-match and Match alike, with Resume in Practice only, Settings from
// phase 2, and Leave. The pitch screen (pitch.ts) opens and closes it, by
// its hidden flag: on Escape or the gamepad's Back, on the HUD's Menu
// button, and in Practice when a stall or a hidden page paused play
// (Q-15); while it's open Practice is paused and nothing is held, and
// Q-17's nav works its buttons, the first, Resume in Practice, focused.
// Phase 1's (shell) is given settings: null, so it has no Settings; phase
// 2's settings builder adds the button and its panel. New at M4.

import { h } from '../dom';
import type { Layer } from '../layer';
import { addStyle } from '../style';
import css from './menu.css?inline';

export interface MenuHost {
  readonly practice: boolean;
  /** Resume pressed: the menu closes, and Practice carries on (Q-15). */
  resume(): void;
  /** Phase 2's in-match Settings panel; null: no Settings button. */
  readonly settings: (() => void) | null;
  leave(): void;
}

/** The menu layer's name, by which the pitch screen finds it among its layers (src/ui/layer.ts). */
export const MENU = 'menu';

export function matchMenu(host: MenuHost): Layer {
  addStyle(css);
  const button = (text: string, test: string, primary: boolean, act: () => void): HTMLButtonElement =>
    h('button', { type: 'button', class: primary ? 'primary' : 'secondary', 'data-test': test, onclick: act }, text);
  const buttons = [
    host.practice ? button('Resume', 'resume', true, () => host.resume()) : null,
    host.settings !== null ? button('Settings', 'menu-settings', false, host.settings) : null,
    button('Leave', 'leave', !host.practice, () => host.leave()),
  ].filter((b): b is HTMLButtonElement => b !== null);
  const el = h('div', { class: 'match-menu', role: 'dialog', 'aria-labelledby': 'match-menu-title', 'data-test': 'menu', hidden: true },
    h('div', { class: 'match-menu-panel' },
      h('h2', { id: 'match-menu-title' }, host.practice ? 'Paused' : 'Menu'),
      host.practice ? h('p', {}, 'Play, the clock and the terriers wait until you resume.') : null,
      h('div', { class: 'match-menu-buttons' }, ...buttons)));
  return {
    name: MENU,
    el,
    inspect: () => ({ shown: !el.hidden, buttons: buttons.map((b) => b.textContent) }),
  };
}
