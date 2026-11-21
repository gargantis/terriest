import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { personId } from '../../core/bot/bot-id';
import { Keyboard, type KeyboardScreen } from '../../input/keyboard';
import type { UiCommand } from '../../input/source';
import { MemoryStorage } from '../../storage/kv';
import { ProfileStore } from '../../storage/profile';
import { type SettingsEnv, SettingsStore } from '../../storage/settings';
import { FakeClock } from '../clock-testing';
import { fake, type FakeDocument, FakeEvent, type FakeElement, installDom, only } from '../dom-testing';
import { ButtonNav } from '../nav';
import { isMenuLayer, matchMenu, MENU, type MenuHost, type MenuLayer, type MenuSettings } from './menu';

// The match menu's Settings (M4's design §1.43, §4.8, §4.9, §5.8; PLAN
// §11, Q-17, M4-Q7), with the pitch screen's part played as pitch.ts plays
// it, Q-17's nav over the buttons the menu's layer holds, opened() as the
// menu opens and the hidden flag: Settings between Resume and Leave, and
// none without the panel's stores; the panel in the menu's place, its
// heading focused and naming the dialog, so the nav moves among the panel's
// buttons alone; its Back returning to the match as Resume does; the menu
// opening on its buttons again however it was closed; the panel's changes
// stored at once, the settings in force shown afresh at each press, and its
// subscription ended with the layer; and from each of the panel's controls
// but its text fields, Escape the menu's command, which closes it.

const ME = personId(7, 0);
const PRESS = (kind: UiCommand['kind'], at = 0): UiCommand => ({ kind, pressedAt: at, source: 'keyboard', repeat: false });

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

/** An env whose system preference the test changes, telling the store's watch as a browser would. */
function system(): { readonly env: SettingsEnv; set(on: boolean): void } {
  const reduced = { on: false };
  const fns: (() => void)[] = [];
  return {
    env: {
      reducedMotion: () => reduced.on, qualityDefault: () => 'high',
      watchReducedMotion: (fn) => {
        fns.push(fn);
        return () => {};
      },
    },
    set(on) {
      reduced.on = on;
      for (const fn of fns) fn();
    },
  };
}

interface Rig {
  readonly menu: MenuLayer;
  readonly el: FakeElement;
  readonly settings: SettingsStore;
  readonly sys: ReturnType<typeof system>;
  readonly acts: string[];
  /** The pitch screen's nav over the menu layer's buttons, as pitch.ts makes it. */
  readonly nav: ButtonNav;
  /** pitch.ts's openMenu and closeMenu, as far as the menu's layer sees them. */
  open(): void;
  close(): void;
}

function rig(o: { practice?: boolean; settings?: boolean } = {}): Rig {
  const sys = system();
  const settings = new SettingsStore(new MemoryStorage(), sys.env);
  const panel: MenuSettings = { settings, profile: new ProfileStore(new MemoryStorage(), () => ME, () => 0), persistent: () => settings.persistent };
  const acts: string[] = [];
  let el: FakeElement | null = null;
  const host: MenuHost = {
    practice: o.practice ?? true,
    resume: () => {
      acts.push('resume');
      el!.hidden = true; // the pitch screen's closeMenu
    },
    settings: o.settings === false ? null : panel,
    leave: () => acts.push('leave'),
  };
  const menu = matchMenu(host);
  el = fake(menu.el);
  dom.document.body.append(el);
  const nav = new ButtonNav(() => Array.from(menu.el.querySelectorAll<HTMLButtonElement>('button')), { clock: new FakeClock() });
  return {
    menu, el, settings, sys, acts, nav,
    open: () => {
      menu.opened();
      el.hidden = false;
      nav.focusFirst();
    },
    close: () => {
      el.hidden = true;
    },
  };
}

const focused = (): string | null => {
  const a = dom.document.activeElement;
  return a.getAttribute('data-test') ?? `${a.tagName} ${a.textContent}`;
};
const buttonsIn = (el: FakeElement): (string | null)[] => el.querySelectorAll('button').map((b) => b.getAttribute('data-test'));

describe("the match menu's Settings (§5.8, PLAN §11)", () => {
  it('puts Settings between Resume and Leave, and none without the panel\'s stores', () => {
    expect(buttonsIn(rig({ practice: true }).el)).toEqual(['resume', 'menu-settings', 'leave']);
    const net = rig({ practice: false });
    expect(buttonsIn(net.el)).toEqual(['menu-settings', 'leave']);
    expect(net.el.querySelectorAll('button').map((b) => b.className)).toEqual(['secondary', 'primary']);
    expect(buttonsIn(rig({ settings: false }).el)).toEqual(['resume', 'leave']);
    const r = rig();
    expect([r.menu.name, r.menu.panel, r.el.getAttribute('role'), r.el.hidden]).toEqual([MENU, 'menu', 'dialog', true]);
    expect(r.menu.inspect!()).toEqual({ shown: false, buttons: ['Resume', 'Settings', 'Leave'] });
  });

  it("shows the panel in the menu's place, its heading focused and naming the dialog, so the nav moves among its buttons alone", () => {
    const r = rig();
    r.open();
    expect(focused()).toBe('resume');
    r.nav.ui(PRESS('down'));
    expect(focused()).toBe('menu-settings');
    r.nav.ui(PRESS('press'));
    expect(r.menu.panel).toBe('settings');
    const panel = only(r.el, '[data-test="settings-panel"]');
    const heading = only(panel, 'h2');
    expect([dom.document.activeElement, r.el.getAttribute('aria-labelledby')]).toEqual([heading, heading.id]);
    expect([r.el.children.length, buttonsIn(r.el)]).toEqual([1, ['back', 'hints-again']]);
    expect(r.el.hidden).toBe(false); // the menu still open: Practice paused and nothing held (§4.8)
    expect(r.acts).toEqual([]);
    r.nav.ui(PRESS('down'));
    expect(focused()).toBe('back');
    r.nav.ui(PRESS('down'));
    expect(focused()).toBe('hints-again');
    r.nav.ui(PRESS('up'));
    r.nav.ui(PRESS('press'));
    // Back returns to the match, as Resume does, and the menu is its buttons again.
    expect([r.acts, r.el.hidden, r.menu.panel, buttonsIn(r.el)]).toEqual([['resume'], true, 'menu', ['resume', 'menu-settings', 'leave']]);
    expect(r.el.getAttribute('aria-labelledby')).toBe(only(r.el, 'h2').id);
    expect(only(r.el, 'h2').textContent).toBe('Paused');
  });

  it('opens on its buttons however it was closed with the panel showing, Escape or Back on the pad', () => {
    const r = rig();
    r.open();
    only(r.el, 'button[data-test="menu-settings"]').click();
    expect(r.menu.panel).toBe('settings');
    r.close(); // Escape, or the pad's Back: the pitch screen hides the menu, the panel in it
    r.open();
    expect([r.menu.panel, focused(), buttonsIn(r.el)]).toEqual(['menu', 'resume', ['resume', 'menu-settings', 'leave']]);
    const net = rig({ practice: false });
    net.open();
    only(net.el, 'button[data-test="menu-settings"]').click();
    net.close();
    net.open();
    expect(focused()).toBe('menu-settings');
  });

  it('stores what the panel changes at once, shows the settings in force afresh at each press, and goes with the layer', () => {
    const r = rig();
    r.open();
    only(r.el, 'button[data-test="menu-settings"]').click();
    const sound = only(r.el, 'input[data-test="sound"]');
    expect(sound.checked).toBe(true);
    sound.checked = false;
    sound.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(r.settings.stored().sound).toBe(false);
    only(r.el, 'button[data-test="back"]').click();
    expect(r.settings.set({ sound: true, names: true })).toBeNull(); // changed meanwhile
    r.open();
    only(r.el, 'button[data-test="menu-settings"]').click();
    expect(['sound', 'names'].map((t) => only(r.el, `input[data-test="${t}"]`).checked)).toEqual([true, true]);
    // The panel follows the store while it shows, and hears nothing once the layer has gone.
    const calm = only(r.el, 'input[data-test="calm-camera"]');
    r.sys.set(true);
    expect(calm.checked).toBe(true);
    r.menu.dispose();
    r.sys.set(false);
    expect(calm.checked).toBe(true);
  });

  it('takes Escape from its checks, radios and buttons as the menu\'s command, which closes it, and leaves it to its text fields', () => {
    const r = rig();
    r.open();
    only(r.el, 'button[data-test="menu-settings"]').click();
    const w = Object.assign(new EventTarget(), { document: Object.assign(new EventTarget(), { visibilityState: 'visible' }) });
    const ui: UiCommand[] = [];
    const screen: KeyboardScreen = 'menu';
    const keyboard = new Keyboard(w as unknown as Window, (c) => ui.push(c), () => screen);
    const escape = (target: FakeElement): string[] => {
      ui.length = 0;
      const e = new Event('keydown', { cancelable: true });
      // The control as the keyboard reads a target: its tag, and an input's type.
      const as = { tagName: target.tagName, type: target.getAttribute('type') ?? '', isContentEditable: false };
      Object.defineProperties(e, { code: { value: 'Escape' }, key: { value: 'Escape' }, repeat: { value: false }, target: { value: as } });
      w.dispatchEvent(e);
      return ui.map((c) => c.kind);
    };
    const closes = ['quality-high', 'quality-low', 'sound', 'names', 'ball-view', 'calm-camera', 'mirror-touch', 'hints-again', 'back'];
    const keeps = ['relays', 'turn-url', 'turn-user', 'turn-credential'];
    const controls = r.el.querySelectorAll('input').concat(r.el.querySelectorAll('textarea'), r.el.querySelectorAll('button'));
    expect(controls.map((c) => c.getAttribute('data-test')).sort()).toEqual([...closes, ...keeps].sort());
    for (const t of closes) expect(escape(only(r.el, `[data-test="${t}"]`)), t).toEqual(['menu']);
    for (const t of keeps) expect(escape(only(r.el, `[data-test="${t}"]`)), t).toEqual([]);
    keyboard.dispose();
  });

  it('is found among the layers by its name and its opened()', () => {
    const r = rig();
    expect(isMenuLayer(r.menu)).toBe(true);
    expect(isMenuLayer({ name: MENU, el: null })).toBe(false);
    expect(isMenuLayer({ ...r.menu, name: 'hud' })).toBe(false);
  });
});
