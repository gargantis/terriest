import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { personId } from '../../core/bot/bot-id';
import { MemoryStorage } from '../../storage/kv';
import { ProfileStore } from '../../storage/profile';
import { DEFAULT_SETTINGS, PROFILE_KEY, SETTINGS_KEY, type StoredSettings } from '../../storage/schema';
import { type SettingsEnv, SettingsStore } from '../../storage/settings';
import type { UiCommand } from '../../input/source';
import { cssDeclarations, cssLength, fake, FakeEvent, type FakeDocument, type FakeElement, installDom, only } from '../dom-testing';
import { APPLIES, HINTS_AGAIN, NOT_SAVED, relayList, SAVED, type SettingsHost, settingsPanel, settingsScreen } from './settings';

// Settings (M4's design §1.43, §2.8, §4.7, §5.8, §6, §9.2; PLAN §10, §11,
// A.3, D-29, M4-Q28), on the real stores over memory: every setting of §6
// on the screen from Home and on the in-match panel, each showing the
// setting in force and stored as it changes, the status line saying what
// came of it; when the settings that wait apply, said beside them; the
// calmer camera following the system live until chosen; the relays and the
// TURN server checked as they're typed, what passes stored at once and what
// fails said beside its field and stored nowhere; Show control hints again
// clearing all three kinds; Back; the gamepad's d-pad and Start through
// every control but the text fields, the keyboard's keys left to the
// browser; the subscription ended with the screen; and the panel's heading,
// Back and scrolling box, a control scrolled to kept clear of its head.

const ME = personId(7, 0);
const fire = (el: FakeElement, type: 'input' | 'change'): boolean => el.dispatchEvent(new FakeEvent(type, { bubbles: true }));
/** Typed into a field: its value, and an input event, as each keystroke gives. */
const type = (el: FakeElement, text: string): void => {
  el.value = text;
  fire(el, 'input');
};
/** A check or a radio as a click leaves it: checked or not, and a change event. */
const tick = (el: FakeElement, on: boolean): void => {
  el.checked = on;
  fire(el, 'change');
};
const storedIn = (kv: MemoryStorage): StoredSettings => JSON.parse(kv.data.get(SETTINGS_KEY) ?? 'null') as StoredSettings;

/** An env whose system preference the test changes, telling the store's watch as a browser would. */
function system(): { readonly env: SettingsEnv; set(on: boolean): void } {
  const reduced = { on: false };
  const fns: (() => void)[] = [];
  return {
    env: {
      reducedMotion: () => reduced.on,
      qualityDefault: () => 'high',
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
  readonly kv: MemoryStorage;
  readonly settings: SettingsStore;
  readonly profileKv: MemoryStorage;
  readonly profile: ProfileStore;
  readonly sys: ReturnType<typeof system>;
  readonly host: SettingsHost;
  readonly went: string[];
}

function rig(seed: Partial<StoredSettings> = {}): Rig {
  const kv = new MemoryStorage();
  kv.data.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...seed }));
  const sys = system();
  const settings = new SettingsStore(kv, sys.env);
  const profileKv = new MemoryStorage();
  const profile = new ProfileStore(profileKv, () => ME, () => 3);
  const went: string[] = [];
  return { kv, settings, profileKv, profile, sys, went, host: { settings, profile, persistent: () => settings.persistent, back: () => went.push('back') } };
}

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

/** The screen from Home, in the document. */
function screen(r: Rig): FakeElement {
  const s = settingsScreen(r.host);
  expect(s.name).toBe('settings');
  dom.document.body.append(fake(s.el));
  return fake(s.el);
}

const CHECKS = ['sound', 'names', 'ball-view', 'calm-camera', 'mirror-touch'] as const;

describe('Settings from Home (§6, PLAN §11)', () => {
  it('offers every setting of §6, each in its label, showing the settings in force', () => {
    const turn = { urls: 'turns:turn.example.org:443', username: 'ada', credential: 'secret' };
    const r = rig({ relays: ['wss://a.example.org', 'wss://b.example.org'], turn: [turn], names: true, sound: false, mirrorTouch: true });
    const el = screen(r);
    expect(only(el, 'h1').textContent).toBe('Settings');
    expect([only(el, '[data-test="quality-high"]').checked, only(el, '[data-test="quality-low"]').checked]).toEqual([true, false]);
    expect(CHECKS.map((t) => only(el, `input[data-test="${t}"]`).checked)).toEqual([false, true, true, false, true]);
    for (const t of CHECKS) {
      const box = only(el, `input[data-test="${t}"]`);
      expect([box.getAttribute('type'), box.parentNode?.tagName], t).toEqual(['checkbox', 'LABEL']);
    }
    expect(only(el, 'textarea[data-test="relays"]').value).toBe('wss://a.example.org\nwss://b.example.org');
    expect(['turn-url', 'turn-user', 'turn-credential'].map((t) => only(el, `input[data-test="${t}"]`).value)).toEqual(['turns:turn.example.org:443', 'ada', 'secret']);
    expect(only(el, 'input[data-test="turn-credential"]').getAttribute('type')).toBe('password');
    for (const t of ['relays', 'turn-url', 'turn-user', 'turn-credential']) expect(only(el, `[data-test="${t}"]`).parentNode?.tagName, t).toBe('LABEL');
    expect(only(el, 'button[data-test="hints-again"]').textContent).toBe('Show control hints again');
    expect(only(el, 'button[data-test="back"]').textContent).toBe('Back');
    // The order the screen reads in: the quality, the checks, the hints, then the connections.
    const order = el.querySelectorAll('[data-test]').map((x) => x.getAttribute('data-test'));
    expect(order.filter((t) => ['quality-high', 'sound', 'mirror-touch', 'hints-again', 'relays', 'turn-credential', 'settings-message', 'back'].includes(t!)))
      .toEqual(['quality-high', 'sound', 'mirror-touch', 'hints-again', 'relays', 'turn-credential', 'settings-message', 'back']);
  });

  it('stores each check and the quality as it changes, one whole object, and says so', () => {
    const r = rig();
    const el = screen(r);
    const message = only(el, '[data-test="settings-message"]');
    expect(message.textContent).toBe('');
    const want: Partial<StoredSettings>[] = [
      { sound: false }, { names: true }, { ballView: false }, { calmCamera: true }, { mirrorTouch: true }, { quality: 'low' }, { quality: 'high' },
    ];
    const controls = ['sound', 'names', 'ball-view', 'calm-camera', 'mirror-touch', 'quality-low', 'quality-high'];
    let expected: StoredSettings = r.settings.stored();
    controls.forEach((t, k) => {
      const c = only(el, `input[data-test="${t}"]`);
      tick(c, t.startsWith('quality') ? true : !c.checked);
      expected = { ...expected, ...want[k] };
      expect(storedIn(r.kv), t).toEqual(expected);
      expect([message.textContent, message.className], t).toEqual([SAVED, 'muted']);
    });
    expect(r.settings.stored()).toEqual(expected);
  });

  it('says a change is in force for this visit alone when the browser didn\'t keep it (PLAN §10)', () => {
    const r = rig();
    const el = screen(r);
    r.kv.full = true;
    tick(only(el, 'input[data-test="sound"]'), false);
    const message = only(el, '[data-test="settings-message"]');
    expect([r.settings.get().sound, message.textContent, message.className]).toEqual([false, NOT_SAVED, 'muted']);
    r.kv.full = false;
    tick(only(el, 'input[data-test="names"]'), true);
    expect(message.textContent).toBe(SAVED);
  });

  it('says beside each setting that waits when it applies, and the quality applies at once from Home', () => {
    const el = screen(rig());
    const said = (t: string): string | null => only(el, `[data-test="${t}"]`).textContent;
    expect([said('ball-view-note'), said('connections-note')]).toEqual([APPLIES.ballView, APPLIES.connections]);
    expect(el.querySelectorAll('[data-test="quality-note"]')).toHaveLength(0);
    // Each note is the description of what it's about, so a screen reader hears it there.
    const describedBy = (t: string): string[] => (only(el, `[data-test="${t}"]`).getAttribute('aria-describedby') ?? '').split(' ');
    expect(describedBy('ball-view')).toEqual([only(el, '[data-test="ball-view-note"]').id]);
    for (const t of ['relays', 'turn-url', 'turn-user', 'turn-credential']) expect(describedBy(t)[0], t).toBe(only(el, '[data-test="connections-note"]').id);
  });

  it("follows the system's reduced-motion setting with the calmer camera, live, until the player chooses, and says so", () => {
    const r = rig();
    const el = screen(r);
    const calm = only(el, 'input[data-test="calm-camera"]');
    const note = only(el, '[data-test="calm-camera-note"]');
    expect([calm.checked, note.hidden, note.textContent, calm.getAttribute('aria-describedby')]).toEqual([false, false, APPLIES.calmCamera, note.id]);
    r.sys.set(true);
    expect([calm.checked, r.settings.stored().calmCamera]).toEqual([true, null]);
    r.sys.set(false);
    expect(calm.checked).toBe(false);
    tick(calm, false); // chosen: off, as it was
    expect([r.settings.stored().calmCamera, note.hidden]).toEqual([false, true]);
    r.sys.set(true);
    expect(calm.checked).toBe(false);
  });

  it('checks the relays as they\'re typed: what passes is stored at once, what fails is said beside them and stored nowhere', () => {
    const r = rig();
    const el = screen(r);
    const relays = only(el, 'textarea[data-test="relays"]');
    const line = only(el, '[data-test="relays-problem"]');
    const message = only(el, '[data-test="settings-message"]');
    const state = (): unknown => [r.settings.stored().relays, line.hidden, line.textContent, relays.getAttribute('aria-invalid')];
    type(relays, 'wss://a.example.org');
    expect(state()).toEqual([['wss://a.example.org'], true, '', null]);
    expect(message.textContent).toBe(''); // told when the field is left, not at each keystroke
    type(relays, 'wss://a.example.org\nws://b.example.org');
    expect(state()).toEqual([['wss://a.example.org'], false, '“ws://b.example.org” must start with wss://.', 'true']);
    expect(relays.getAttribute('aria-describedby')?.split(' ')[1]).toBe(line.id);
    fire(relays, 'change');
    expect([message.textContent, message.className]).toEqual(['“ws://b.example.org” must start with wss://.', 'error']);
    expect(storedIn(r.kv).relays).toEqual(['wss://a.example.org']);
    type(relays, 'wss://a.example.org, wss://b.example.org\n\n');
    expect(state()).toEqual([['wss://a.example.org', 'wss://b.example.org'], true, '', null]);
    fire(relays, 'change');
    expect([message.textContent, message.className]).toEqual([SAVED, 'muted']);
    type(relays, Array.from({ length: 11 }, (_, k) => `wss://r${k}.example.org`).join('\n'));
    expect(state()).toEqual([['wss://a.example.org', 'wss://b.example.org'], false, 'At most 10 extra relays.', 'true']);
    type(relays, 'wss://me:pw@c.example.org');
    expect(line.textContent).toBe('“wss://me:pw@c.example.org” mustn’t contain a user name or password.');
    type(relays, '  ');
    expect(state()).toEqual([[], true, '', null]);
    expect(storedIn(r.kv).relays).toEqual([]);
  });

  it("checks the TURN server as it's typed: none while it's empty, stored once complete, the field at fault marked till then", () => {
    const r = rig();
    const el = screen(r);
    const [url, user, credential] = ['turn-url', 'turn-user', 'turn-credential'].map((t) => only(el, `input[data-test="${t}"]`)) as [FakeElement, FakeElement, FakeElement];
    const line = only(el, '[data-test="turn-problem"]');
    const message = only(el, '[data-test="settings-message"]');
    const marked = (): (string | null)[] => [url, user, credential].map((f) => f.getAttribute('aria-invalid'));
    type(url, 'turns:turn.example.org:443');
    expect([r.settings.stored().turn, line.textContent, marked()]).toEqual([[], 'A TURN server needs its user name and credential.', [null, 'true', null]]);
    fire(url, 'change');
    expect([message.textContent, message.className]).toEqual(['A TURN server needs its user name and credential.', 'error']);
    type(user, 'ada');
    expect(marked()).toEqual([null, null, 'true']);
    type(credential, 'secret');
    const ada = { urls: 'turns:turn.example.org:443', username: 'ada', credential: 'secret' };
    expect([r.settings.stored().turn, line.hidden, line.textContent, marked()]).toEqual([[ada], true, '', [null, null, null]]);
    fire(credential, 'change');
    expect([message.textContent, storedIn(r.kv).turn]).toEqual([SAVED, [ada]]);
    type(url, 'stun:stun.example.org');
    expect([r.settings.stored().turn, line.textContent, marked()]).toEqual([
      [ada], 'A TURN URL starts with turn: or turns:, for example turns:turn.example.com:443.', ['true', null, null],
    ]);
    type(url, '  turn:t.example.org:3478 ');
    expect(r.settings.stored().turn).toEqual([{ ...ada, urls: 'turn:t.example.org:3478' }]);
    for (const f of [url, user, credential]) type(f, '');
    expect([r.settings.stored().turn, line.hidden, marked()]).toEqual([[], true, [null, null, null]]);
    for (const f of [url, user, credential]) expect(f.getAttribute('aria-describedby')?.split(' ')[1]).toBe(line.id);
  });

  it("clears every kind's control hints with Show control hints again, through the profile (D-29, M4-Q28)", () => {
    const r = rig();
    r.profile.update((p) => ({ ...p, hints: { keyboard: 63, touch: 5, gamepad: 1 } }));
    const el = screen(r);
    const message = only(el, '[data-test="settings-message"]');
    only(el, 'button[data-test="hints-again"]').click();
    expect(r.profile.get().hints).toEqual({ keyboard: 0, touch: 0, gamepad: 0 });
    expect((JSON.parse(r.profileKv.data.get(PROFILE_KEY)!) as { hints: unknown }).hints).toEqual({ keyboard: 0, touch: 0, gamepad: 0 });
    expect([message.textContent, message.className]).toEqual([HINTS_AGAIN, 'muted']);
    // Kept for this visit alone when the browser won't keep the profile.
    r.profile.update((p) => ({ ...p, hints: { keyboard: 0, touch: 63, gamepad: 0 } }));
    r.profileKv.full = true;
    only(el, 'button[data-test="hints-again"]').click();
    expect([r.profile.get().hints.touch, message.textContent]).toEqual([0, NOT_SAVED]);
  });

  it('goes Home by Back, and its disposal ends what it hears of the store', () => {
    const r = rig();
    const s = settingsScreen(r.host);
    dom.document.body.append(fake(s.el));
    only(s.el, 'button[data-test="back"]').click();
    expect(r.went).toEqual(['back']);
    s.dispose!();
    r.sys.set(true);
    expect(only(s.el, 'input[data-test="calm-camera"]').checked).toBe(false);
  });

  it("takes the gamepad's d-pad through every control but the text fields, Back last, its Start pressing, checking or picking, and leaves the keys to the browser (L82, §4.4)", () => {
    const r = rig();
    const s = settingsScreen(r.host);
    dom.document.body.append(fake(s.el));
    const cmd = (kind: UiCommand['kind'], source: UiCommand['source'] = 'gamepad'): void => s.ui!({ kind, pressedAt: 0, source, repeat: false });
    const focused = (): string | null => dom.document.activeElement.getAttribute('data-test');
    const order: string[] = [];
    for (let k = 0; k < 9; k++) {
      cmd('down');
      order.push(focused()!);
    }
    expect(order).toEqual(['quality-high', 'quality-low', ...CHECKS, 'hints-again', 'back']);
    cmd('down');
    expect(focused()).toBe('quality-high'); // round the end
    // Start on a radio picks it, and on a check toggles it, each stored as a pointer's click would.
    cmd('down');
    cmd('press');
    expect([r.settings.stored().quality, only(s.el, '[data-test="settings-message"]').textContent]).toEqual(['low', SAVED]);
    cmd('down');
    cmd('press');
    expect(r.settings.get().sound).toBe(false);
    cmd('press');
    expect(r.settings.get().sound).toBe(true);
    // The keyboard's arrows and Enter are the browser's here: its Tab and Space work the form natively.
    cmd('down', 'keyboard');
    expect(focused()).toBe('sound');
    cmd('up');
    cmd('up');
    cmd('up');
    expect(focused()).toBe('back');
    cmd('press');
    expect(r.went).toEqual(['back']);
  });

  it('reads the relays one a line, as roslambo did, spaces and commas parting them too', () => {
    expect(relayList(' wss://a.example.org\r\nwss://b.example.org,wss://c.example.org  wss://d.example.org,\n')).toEqual([
      'wss://a.example.org', 'wss://b.example.org', 'wss://c.example.org', 'wss://d.example.org',
    ]);
    expect(relayList('')).toEqual([]);
  });
});

describe("Settings' panel in a match (§5.8, PLAN §11)", () => {
  it('has the same settings, its heading and Back at its top, and says the quality waits for the match to end (§2.8)', () => {
    const r = rig();
    const panel = settingsPanel(r.host);
    const el = fake(panel.el);
    dom.document.body.append(el);
    expect([panel.name, el.getAttribute('data-test')]).toEqual(['settings', 'settings-panel']);
    const heading = only(el, 'h2');
    expect([heading.textContent, heading.id]).toEqual(['Settings', panel.headingId]);
    // Back first among its buttons, at its top, so the nav and the eye reach it at once.
    expect(el.querySelectorAll('button').map((b) => b.getAttribute('data-test'))).toEqual(['back', 'hints-again']);
    expect(only(el, '.settings-panel-head').children.map((c) => c.tagName)).toEqual(['H2', 'BUTTON']);
    for (const t of [...CHECKS, 'quality-high', 'quality-low', 'relays', 'turn-url', 'turn-user', 'turn-credential', 'settings-message']) only(el, `[data-test="${t}"]`);
    const note = only(el, '[data-test="quality-note"]');
    expect(note.textContent).toBe(APPLIES.qualityInMatch);
    for (const q of ['high', 'low']) expect(only(el, `[data-test="quality-${q}"]`).getAttribute('aria-describedby')).toBe(note.id);
    tick(only(el, 'input[data-test="quality-low"]'), true);
    expect([r.settings.stored().quality, only(el, '[data-test="settings-message"]').textContent]).toEqual(['low', SAVED]);
    panel.focus();
    expect(dom.document.activeElement).toBe(heading);
    only(el, 'button[data-test="back"]').click();
    expect(r.went).toEqual(['back']);
  });

  it('gives each of its fields and descriptions an id of its own, so two panels never share one', () => {
    const r = rig();
    const ids = [settingsPanel(r.host), settingsPanel(r.host), settingsScreen(r.host)].flatMap((p) => fake(p.el).querySelectorAll('[id]').map((x) => x.id));
    expect(ids.length).toBeGreaterThan(9);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Settings' look (§5.13, §5.14)", () => {
  const css = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8');

  it('scrolls the panel inside the window, its heading and Back kept in view, and the menu inside the safe area', () => {
    const panel = cssDeclarations(css('./settings.css'), '.settings-panel');
    expect([panel['max-height'], panel['overflow-y']]).toEqual(['100%', 'auto']);
    const head = cssDeclarations(css('./settings.css'), '.settings-panel-head');
    expect([head['position'], head['top'], head['background']]).toEqual(['sticky', '0', 'var(--bg)']);
    const menu = cssDeclarations(css('./menu.css'), '.match-menu');
    expect([menu['display'], menu['align-items'], menu['z-index']]).toEqual(['flex', 'center', '40']);
    for (const side of ['top', 'right', 'bottom', 'left']) expect(menu['padding'], side).toContain(`max(16px, env(safe-area-inset-${side}))`);
    const buttons = cssDeclarations(css('./menu.css'), '.match-menu-panel');
    expect([buttons['max-height'], buttons['overflow-y']]).toEqual(['100%', 'auto']);
    // A control the nav or Tab scrolls to stays clear of the sticky head: its padding twice, Back's height
    // at least, and its border (§5.14).
    const button = cssDeclarations(css('../screens.css'), 'button');
    const pad = cssLength(head['padding']!.split(' ')[0], 0);
    expect(cssLength(panel['scroll-padding']!.split(' ')[0], 0)).toBeGreaterThanOrEqual(2 * pad + cssLength(button['min-height'], 0) + 1);
  });

  it("styles the relays' and the credential's fields as the text fields are, 16 px so a phone doesn't zoom", () => {
    const text = cssDeclarations(css('../screens.css'), 'input[type="text"]');
    for (const field of ['.settings-form textarea', '.settings-form input[type="password"]']) {
      const own = cssDeclarations(css('./settings.css'), field);
      for (const p of ['font', 'font-size', 'color', 'background', 'border', 'border-radius', 'padding', 'width', 'min-height']) expect(own[p], `${field} ${p}`).toBe(text[p]);
    }
    expect(text['font-size']).toBe('16px');
    expect(cssDeclarations(css('./settings.css'), '.settings-form [aria-invalid="true"]')['border-color']).toBe('var(--error)');
  });
});
