import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../config';
import { personId } from '../../core/bot/bot-id';
import type { MatchSettings } from '../../core/sim/index';
import { PLACEHOLDER_LOOK } from '../../render/look';
import type { Settings, SettingsSource, StoredSettings } from '../../storage/schema';
import { cssDeclarations, fake, FakeEvent, type FakeDocument, installDom, only, shownText } from '../dom-testing';
import { addStyle } from '../style';
import { MemoryProfile, MemorySettings } from '../pitch-testing';
import { checkedCoat, homeScreen, NOT_KEPT } from './home';
import { matchMenu } from './menu';
import { minutesText, practiceChoices, practiceScreen, sizeText } from './practice';
import { coatSwatch, focusScreen, packName } from './screen';
import { NOT_SAVED, settingsScreen } from './settings';

// The screens' parts (M4's design §1.42, §1.43, §5.3, §5.4, §5.8, §6, §9.2;
// PLAN §10, §11, C-17): the shared helpers; Home's name, fitted and stored
// on change, its coat stored on change, and its notice when the browser
// won't keep them; Practice's choices from the configuration, made by the
// pad's d-pad too, its left and right stepping a focused one (L82); Settings'
// minimal screen storing each choice, the rules' defaults shown until one
// is made; and the menu's buttons for Practice and a networked match.

const LOOK = PLACEHOLDER_LOOK;
const ME = personId(7, 0);
const change = (el: { dispatchEvent(e: FakeEvent): boolean }): boolean => el.dispatchEvent(new FakeEvent('change', { bubbles: true }));

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

describe("the screens' shared parts", () => {
  it('adds each stylesheet once, as one style element, and none for an empty one (§0, §1.63)', () => {
    addStyle('.a { color: red; }');
    addStyle('.a { color: red; }');
    addStyle('.b { color: blue; }');
    addStyle('');
    expect(dom.document.head.children.map((el) => [el.tagName, el.textContent])).toEqual([['STYLE', '.a { color: red; }'], ['STYLE', '.b { color: blue; }']]);
  });

  it('names a pack by its look, capitalised, and draws a coat by its fur and markings', () => {
    expect([packName(LOOK.packs[0]), packName(LOOK.packs[1]), packName({ name: '', colour: 0, pattern: 'plain' })]).toEqual(['Blue', 'Orange', '']);
    const plain = fake(coatSwatch(LOOK, 0)); // white: no markings, its fur across both parts
    expect([plain.style.getPropertyValue('--fur'), plain.style.getPropertyValue('--marking'), plain.getAttribute('aria-hidden')]).toEqual(['#f2efe6', '#f2efe6', 'true']);
    const marked = fake(coatSwatch(LOOK, 2));
    expect([marked.style.getPropertyValue('--fur'), marked.style.getPropertyValue('--marking')]).toEqual(['#2d2b2e', '#a8764a']);
    expect(fake(coatSwatch(LOOK, 99)).style.getPropertyValue('--fur')).toBe('#f2efe6'); // outside the list: coat 0 (D-12)
  });

  it("keeps each screen's column inside the safe-area insets, which the page draws under from phase 2 (§5.13)", () => {
    const css = readFileSync(new URL('../screens.css', import.meta.url), 'utf8');
    expect(cssDeclarations(css, '.screen')['padding']?.replace(/\s+/g, ' ')).toBe(
      'max(24px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) max(32px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px))',
    );
  });

  it('focuses the element a screen marks data-focus, else its heading, which joins no tab order (§1.42)', () => {
    const marked = { el: dom.document.createElement('section') as unknown as HTMLElement };
    const h1 = dom.document.createElement('h1');
    const button = dom.document.createElement('button');
    button.setAttribute('data-focus', '');
    fake(marked.el).append(h1, button);
    dom.document.body.append(fake(marked.el));
    const win = dom.document.defaultView;
    win.scrollTo(0, 276); // as Home is left, scrolled down to its Settings at 640 × 360
    win.scrolls.length = 0;
    focusScreen(marked);
    expect(dom.document.activeElement).toBe(button);
    // The page at its top first, then the button Q-17 names brought into view (§5.14).
    expect([win.scrollY, win.scrolls]).toEqual([0, [{ to: [0, 0] }, { intoView: button, block: 'nearest' }]]);
    button.removeAttribute('data-focus');
    win.scrollTo(0, 148);
    win.scrolls.length = 0;
    focusScreen(marked);
    expect([dom.document.activeElement, h1.tabIndex]).toEqual([h1, -1]);
    expect([win.scrollY, win.scrolls]).toEqual([0, [{ to: [0, 0] }]]);
  });
});

describe('Home (§5.3)', () => {
  function home(persistent = true): { el: ReturnType<typeof fake>; profile: MemoryProfile; went: string[] } {
    const profile = new MemoryProfile(ME);
    profile.value = { ...profile.value, name: 'Ada', coat: 5 };
    const went: string[] = [];
    const screen = homeScreen({ profile, look: LOOK, persistent: () => persistent, practice: () => went.push('practice'), settings: () => went.push('settings') });
    expect(screen.name).toBe('home');
    dom.document.body.append(fake(screen.el));
    return { el: fake(screen.el), profile, went };
  }

  it('fits the typed name to C-17 and stores it on change, and Practice stores it first', () => {
    const { el, profile, went } = home();
    const name = only(el, 'input[data-test="name"]');
    expect(name.value).toBe('Ada');
    expect(name.getAttribute('placeholder')).toBe(`Optional: without one, you appear as Player ${ME.slice(0, 4).toUpperCase()}`);
    name.value = '  Bea\u0000 Lovelace-Byron the Second ';
    change(name);
    expect([name.value, profile.value.name]).toEqual(['Bea Lovelace-Byron t', 'Bea Lovelace-Byron t']);
    name.value = 'Cy';
    only(el, 'button[data-test="practice"]').click();
    expect([profile.value.name, went]).toEqual(['Cy', ['practice']]);
    only(el, 'button[data-test="settings"]').click();
    expect(went).toEqual(['practice', 'settings']);
  });

  it("checks the profile's coat among the look's, each with its name, and stores another on change", () => {
    const { el, profile } = home();
    const radios = el.querySelectorAll('input[type="radio"]');
    expect(radios).toHaveLength(LOOK.coats.length);
    expect(radios.map((r) => r.checked)).toEqual(LOOK.coats.map((_, k) => k === 5));
    expect(shownText(only(el, 'fieldset'))).toBe(`Coat${LOOK.coats.map((c) => c.name).join('')}`);
    radios[2]!.checked = true;
    change(radios[2]!);
    expect(profile.value.coat).toBe(2);
    expect([checkedCoat(LOOK, 7), checkedCoat(LOOK, LOOK.coats.length), checkedCoat(LOOK, -1), checkedCoat(LOOK, 1.5)]).toEqual([7, 0, 0, 0]);
  });

  it("says when the browser won't keep the name, coat and settings (PLAN §10)", () => {
    expect(only(home(true).el, '[data-test="not-kept"]').hidden).toBe(true);
    const kept = only(home(false).el, '[data-test="not-kept"]');
    expect([kept.hidden, kept.textContent]).toEqual([false, NOT_KEPT]);
  });

  it('says so too once a write fails, a name\'s or a coat\'s, though it was kept before', () => {
    for (const what of ['name', 'coat'] as const) {
      const profile = new MemoryProfile(ME);
      // A store whose write is refused: the change is in force, and persistent falls (src/storage/profile.ts).
      const update = profile.update.bind(profile);
      profile.update = (change) => {
        profile.persistent = false;
        return update(change);
      };
      const screen = homeScreen({ profile, look: LOOK, persistent: () => profile.persistent, practice: () => {}, settings: () => {} });
      const el = fake(screen.el);
      const notice = only(el, '[data-test="not-kept"]');
      expect(notice.hidden, what).toBe(true);
      if (what === 'name') {
        const name = only(el, 'input[data-test="name"]');
        name.value = 'Bea';
        change(name);
      } else {
        const radio = only(el, 'input[data-test="coat-3"]');
        radio.checked = true;
        change(radio);
      }
      expect(notice.hidden, what).toBe(false);
    }
  });
});

describe("Practice's setup (§5.4)", () => {
  it("offers the configuration's pack sizes and lengths, starting at its defaults", () => {
    const c = practiceChoices();
    expect(c.sizes).toEqual([1, 2, 3, 4].filter((n) => n >= config.packSizeMin && n <= config.packSizeMax));
    expect(c.minutes[0]).toBe(config.matchLengthMinMinutes);
    expect(c.minutes.at(-1)).toBe(config.matchLengthMaxMinutes);
    expect(c.start).toEqual({ packSize: config.packSizeDefault, matchMinutes: config.matchLengthDefaultMinutes });
    expect([sizeText(2), minutesText(1), minutesText(3)]).toEqual(['2 a side', '1 minute', '3 minutes']);
  });

  it('starts Practice with what is chosen, or goes back Home', () => {
    const started: MatchSettings[] = [];
    const went: string[] = [];
    const screen = practiceScreen({ start: (s) => started.push(s), home: () => went.push('home') });
    const el = fake(screen.el);
    expect(only(el, 'select[data-test="pack-size"]').value).toBe(String(config.packSizeDefault));
    only(el, 'select[data-test="pack-size"]').value = '1';
    only(el, 'select[data-test="match-length"]').value = '1';
    only(el, 'button[data-test="start"]').click();
    only(el, 'button[data-test="back"]').click();
    expect([started, went]).toEqual([[{ packSize: 1, matchMinutes: 1 }], ['home']]);
  });

  it("takes the gamepad's d-pad among its choices, Start and Back, its left and right stepping a focused choice, so a pad player who came from Home chooses and goes on (L82), the keys left to the browser", () => {
    const started: MatchSettings[] = [];
    const went: string[] = [];
    const screen = practiceScreen({ start: (s) => started.push(s), home: () => went.push('home') });
    dom.document.body.append(fake(screen.el));
    const cmd = (kind: 'down' | 'up' | 'left' | 'right' | 'press', source: 'gamepad' | 'keyboard' = 'gamepad'): void =>
      screen.ui!({ kind, pressedAt: 0, source, repeat: false });
    const focused = (): string | null => dom.document.activeElement.getAttribute('data-test');
    const value = (test: string): string => only(fake(screen.el), `select[data-test="${test}"]`).value;
    cmd('down');
    expect(focused()).toBe('pack-size');
    for (let k = config.packSizeDefault; k >= config.packSizeMin; k--) cmd('left'); // one past the first size: no further
    expect(value('pack-size')).toBe(String(config.packSizeMin));
    cmd('right', 'keyboard'); // the browser's own arrows change a focused select, never the nav too
    expect([focused(), value('pack-size')]).toEqual(['pack-size', String(config.packSizeMin)]);
    cmd('down');
    expect(focused()).toBe('match-length');
    cmd('right');
    expect(value('match-length')).toBe(String(config.matchLengthDefaultMinutes + 1));
    for (let k = config.matchLengthDefaultMinutes + 1; k > config.matchLengthMinMinutes; k--) cmd('left');
    expect(value('match-length')).toBe(String(config.matchLengthMinMinutes));
    cmd('down');
    expect(focused()).toBe('start');
    cmd('down');
    expect(focused()).toBe('back');
    cmd('press', 'keyboard'); // the browser's own Enter presses it there, never the nav too
    expect(went).toEqual([]);
    cmd('up');
    cmd('press');
    expect(started).toEqual([{ packSize: config.packSizeMin, matchMinutes: config.matchLengthMinMinutes }]);
    cmd('down');
    cmd('press');
    expect(went).toEqual(['home']);
  });
});

describe("Settings' minimal screen (§1.43, §6)", () => {
  it('shows the settings in force, the rules\' choices until one is made, and stores each change', () => {
    const settings = new MemorySettings();
    const went: string[] = [];
    const el = fake(settingsScreen({ settings, profile: new MemoryProfile(ME), persistent: () => true, back: () => went.push('back') }).el);
    const high = only(el, 'input[data-test="quality-high"]');
    const low = only(el, 'input[data-test="quality-low"]');
    expect([high.checked, low.checked, settings.stored().quality]).toEqual([true, false, null]); // the default, still unchosen
    low.checked = true;
    change(low);
    expect(settings.stored().quality).toBe('low');
    const ball = only(el, 'input[data-test="ball-view"]');
    const calm = only(el, 'input[data-test="calm-camera"]');
    expect([ball.checked, calm.checked]).toEqual([true, false]);
    ball.checked = false;
    change(ball);
    calm.checked = true;
    change(calm);
    expect([settings.stored().ballView, settings.stored().calmCamera]).toEqual([false, true]);
    expect(only(el, '[data-test="settings-message"]').textContent).toBe('Saved.');
    only(el, 'button[data-test="back"]').click();
    expect(went).toEqual(['back']);
  });

  it('says a change that fails, as the store words it', () => {
    const refusing: SettingsSource = {
      persistent: true,
      get: (): Settings => ({ ...new MemorySettings().get() }),
      stored: (): StoredSettings => new MemorySettings().stored(),
      set: () => 'The render quality is high or low.',
      subscribe: () => () => {},
    };
    const el = fake(settingsScreen({ settings: refusing, profile: new MemoryProfile(ME), persistent: () => true, back: () => {} }).el);
    const low = only(el, 'input[data-test="quality-low"]');
    low.checked = true;
    change(low);
    const message = only(el, '[data-test="settings-message"]');
    expect([message.textContent, message.className]).toEqual(['The render quality is high or low.', 'error']);
  });
});

describe("Settings' screen when the browser keeps nothing (PLAN §10)", () => {
  it('says a change is in force for this visit alone, not saved, when the write is refused', () => {
    const settings = new MemorySettings();
    let kept = true;
    const set = settings.set.bind(settings);
    settings.set = (change) => {
      kept = false; // the store's write refused: the change in force, persistent false
      return set(change);
    };
    const el = fake(settingsScreen({ settings, profile: new MemoryProfile(ME), persistent: () => kept, back: () => {} }).el);
    const low = only(el, 'input[data-test="quality-low"]');
    low.checked = true;
    change(low);
    const message = only(el, '[data-test="settings-message"]');
    expect([settings.stored().quality, message.textContent, message.className]).toEqual(['low', NOT_SAVED, 'muted']);
  });
});

describe('the match menu (§5.8, M4-Q7)', () => {
  it("has Resume and Leave in Practice without the Settings panel's stores, and Settings and Leave in a networked match with them", () => {
    const acts: string[] = [];
    const practice = matchMenu({ practice: true, resume: () => acts.push('resume'), settings: null, leave: () => acts.push('leave') });
    const el = fake(practice.el);
    expect([practice.name, el.hidden, el.getAttribute('role')]).toEqual(['menu', true, 'dialog']);
    expect(el.querySelectorAll('button').map((b) => b.textContent)).toEqual(['Resume', 'Leave']);
    only(el, 'button[data-test="resume"]').click();
    only(el, 'button[data-test="leave"]').click();
    expect(acts).toEqual(['resume', 'leave']);
    const net = matchMenu({
      practice: false, resume: () => {}, settings: { settings: new MemorySettings(), profile: new MemoryProfile(ME), persistent: () => true }, leave: () => {},
    });
    expect(fake(net.el).querySelectorAll('button').map((b) => b.textContent)).toEqual(['Settings', 'Leave']);
    expect(net.inspect!()).toEqual({ shown: false, buttons: ['Settings', 'Leave'] });
  });
});
