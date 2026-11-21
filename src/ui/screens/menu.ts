// The match menu (M4's design, research/m4/DESIGN.md, §1.43, §4.8, §4.9,
// §5.4, §5.8; PLAN §11, Q-15, Q-17; L158, M4-Q7): a layer over the pitch,
// on Pre-match and Match alike, with Resume in Practice only, Settings and
// Leave, in that order. The pitch screen (pitch.ts) opens and closes it, by
// its hidden flag: on Escape or the gamepad's Back, on the HUD's Menu
// button, and in Practice when a stall or a hidden page paused play
// (Q-15); while it's open Practice is paused and nothing is held (§4.8),
// and Q-17's nav works the buttons it shows, the first focused.
// Settings shows the Settings panel (settings.ts's settingsPanel) in the
// menu's place, over the pitch, which keeps drawing: the screen, the
// renderer and the game stay as they are and the menu stays open, so
// Practice stays paused and nothing is held while the panel shows (PLAN
// §11). The panel's Back closes the menu and returns to the match, as
// Resume does, and Escape or the pad's Back close the menu from the panel
// as from its buttons, from anywhere but a text field (§4.9). The panel is
// made at each Settings press, so it shows the settings in force, and goes
// when the menu shows its buttons again: at its Back, and at opened(),
// which the pitch screen calls as it opens the menu, so the menu always
// opens on its buttons, Resume or Settings first. New at M4; phase 2's
// settings builder added Settings and its panel.

import { h } from '../dom';
import type { Layer } from '../layer';
import { addStyle } from '../style';
import css from './menu.css?inline';
import { type SettingsHost, type SettingsPanel, settingsPanel } from './settings';

/** What the in-match Settings panel needs of the app: the stores, and whether the browser keeps them. */
export type MenuSettings = Omit<SettingsHost, 'back'>;

export interface MenuHost {
  readonly practice: boolean;
  /** Resume pressed, or the Settings panel's Back: the menu closes, the match shows again, and Practice
   *  carries on (Q-15, PLAN §11). */
  resume(): void;
  /** The in-match Settings panel's (§5.8, §6); null: no Settings button. */
  readonly settings: MenuSettings | null;
  leave(): void;
}

/** The menu layer's name, by which the pitch screen finds it among its layers (src/ui/layer.ts). */
export const MENU = 'menu';

export interface MenuLayer extends Layer {
  readonly el: HTMLElement;
  /** What the open menu shows: its buttons, or the Settings panel (Inspection.menu's 'menu' or 'settings'). */
  readonly panel: 'menu' | 'settings';
  /** The pitch screen is opening the menu: its buttons show, whatever showed when it last closed. */
  opened(): void;
  /** The Settings panel's subscription ends. */
  dispose(): void;
}

/** The match menu among a pitch screen's layers. */
export function isMenuLayer(l: Layer): l is MenuLayer {
  return l.name === MENU && typeof (l as Partial<MenuLayer>).opened === 'function';
}

let menus = 0;

export function matchMenu(host: MenuHost): MenuLayer {
  addStyle(css);
  const titleId = `match-menu-title-${++menus}`;
  const button = (text: string, test: string, primary: boolean, act: () => void): HTMLButtonElement =>
    h('button', { type: 'button', class: primary ? 'primary' : 'secondary', 'data-test': test, onclick: act }, text);
  const panelSettings = host.settings;
  const buttons = [
    host.practice ? button('Resume', 'resume', true, () => host.resume()) : null,
    panelSettings !== null ? button('Settings', 'menu-settings', false, () => toSettings(panelSettings)) : null,
    button('Leave', 'leave', !host.practice, () => host.leave()),
  ].filter((b): b is HTMLButtonElement => b !== null);
  const menuPanel = h('div', { class: 'match-menu-panel' },
    h('h2', { id: titleId }, host.practice ? 'Paused' : 'Menu'),
    host.practice ? h('p', {}, 'Play, the clock and the terriers wait until you resume.') : null,
    h('div', { class: 'match-menu-buttons' }, ...buttons));
  const el = h('div', { class: 'match-menu', role: 'dialog', 'aria-labelledby': titleId, 'data-test': 'menu', hidden: true }, menuPanel);

  /** The Settings panel while it shows in the menu's place. */
  let shown: SettingsPanel | null = null;

  /** The menu's buttons again, the panel gone. */
  function toButtons(): void {
    if (shown === null) return;
    shown.dispose();
    shown = null;
    el.replaceChildren(menuPanel);
    el.setAttribute('aria-labelledby', titleId);
  }

  /** The panel in the menu's place, its heading focused, so the nav moves among its buttons alone. */
  function toSettings(s: MenuSettings): void {
    if (shown !== null) return;
    const panel = settingsPanel({
      settings: s.settings, profile: s.profile, persistent: () => s.persistent(),
      back: () => {
        toButtons();
        host.resume();
      },
    });
    shown = panel;
    el.replaceChildren(panel.el);
    el.setAttribute('aria-labelledby', panel.headingId);
    panel.focus();
  }

  return {
    name: MENU,
    el,
    get panel() {
      return shown === null ? 'menu' : 'settings';
    },
    opened: toButtons,
    dispose: toButtons,
    inspect: () => ({ shown: !el.hidden, buttons: buttons.map((b) => b.textContent) }),
  };
}
