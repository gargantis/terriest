// Settings (M4's design, research/m4/DESIGN.md, §1.33, §1.43, §2.8, §4.7,
// §4.9, §5.8, §6; PLAN §10, §11, A.3, D-29, D-33, M4-Q28): all of §6, as a
// screen from Home, whose Back returns Home, and as the panel the match
// menu shows over the pitch (src/ui/screens/menu.ts), whose Back returns to
// the match. The same controls in both, each stored as it changes, every
// change one write of the whole object (A.3):
// - the render quality, high or low: from Home the app re-creates the stage
//   at once behind it (§2.8); in a match it applies when the match ends or
//   is left, as the panel says (phase 3 brings the rebuild when the menu
//   closes);
// - sound, names over the other terriers, the calmer camera and the
//   mirrored touch layout apply at once, through the store's subscribers;
//   start in ball view from the next match, as the screen says;
// - each control shows the setting in force, so the calmer camera shows
//   the system's reduced-motion preference until the player chooses, and
//   follows it live while the screen shows, saying so (A.3);
// - the extra relays, one wss:// URL a line, and the player's own TURN
//   server, one, as roslambo's screen has it, checked as they're typed by
//   the store's own checks: what passes is stored at once, so nothing typed
//   is lost when the panel closes, and what fails says why beside its
//   field, marked invalid, and stores nothing; both apply from the next
//   match, as the screen says;
// - Show control hints again, which clears the profile's hints for all
//   three kinds (D-29, M4-Q28);
// - a status line, polite, saying what came of the last change: saved, in
//   use for this visit alone when the browser didn't keep it (PLAN §10), or
//   the problem, as the store words it.
// Every control is a native field, radio, checkbox or button, each field
// inside its label, so it works by keys as any page's does. On the pitch
// the keyboard leaves every key but Escape to a focused checkbox or radio
// and every key to a text field, so Escape and the gamepad's Back close
// the panel from all but a text field, and Q-17's nav moves among the
// panel's buttons (§4.9). roslambo's settings screen, with terriest's
// settings and checks as typed. New at M4 (phase 1's minimal screen);
// phase 2's settings builder completed it and added the panel.

import type { RenderQuality } from '../../config';
import type { Profile, ProfileSource, Settings, SettingsSource, StoredSettings, TurnServer } from '../../storage/schema';
import { RELAYS_MAX, relaysProblem, type TurnField, turnProblemAt } from '../../storage/settings';
import { h, setShown, setText } from '../dom';
import type { Layer } from '../layer';
import { addStyle } from '../style';
import { type Screen, screenStyles } from './screen';
import css from './settings.css?inline';

export interface SettingsHost {
  readonly settings: SettingsSource;
  /** Whose hints Show control hints again clears (D-29, M4-Q28). */
  readonly profile: ProfileSource;
  /** The browser kept the last change: the settings store's persistent (PLAN §10). */
  persistent(): boolean;
  /** Back: Home from the screen, the match from the panel (PLAN §11). */
  back(): void;
}

/** The in-match panel: Layer-shaped, shown by the match menu in its own place (menu.ts). */
export interface SettingsPanel extends Layer {
  readonly el: HTMLElement;
  /** Its heading's: the menu's dialog is labelled by it while the panel shows. */
  readonly headingId: string;
  /** Its heading takes the focus, as a screen's does on entry (Q-17). */
  focus(): void;
  /** Its subscription to the store ends. */
  dispose(): void;
}

/** What the status line says after a change the browser kept. */
export const SAVED = 'Saved.';
/** And after one it didn't (PLAN §10). */
export const NOT_SAVED = 'In use for this visit: this browser isn’t keeping your settings.';
/** After Show control hints again (D-29). */
export const HINTS_AGAIN = 'Each control’s hint shows again until you use it.';
/** When the settings that wait apply, said beside them (PLAN §11), and the calmer camera's rule (A.3). */
export const APPLIES = {
  ballView: 'Applies from the next match.',
  connections: 'Relays and your TURN server apply from the next match.',
  qualityInMatch: 'A new render quality applies when this match ends or you leave it.',
  calmCamera: 'Until you choose, it follows your system’s reduced-motion setting.',
} as const;

const QUALITIES: readonly { readonly value: RenderQuality; readonly label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low: a lower resolution and simpler effects, for a slower device' },
];

/** The relays a player typed: one a line, spaces and commas also parting them (roslambo's). */
export function relayList(text: string): string[] {
  return text.split(/[\s,]+/).filter((r) => r !== '');
}

const NO_HINTS: Profile['hints'] = Object.freeze({ keyboard: 0, touch: 0, gamepad: 0 });
const hintsCleared = (p: Profile): boolean => p.hints.keyboard === 0 && p.hints.touch === 0 && p.hints.gamepad === 0;

let ids = 0;
/** An id no other element on the page has, for the labels and descriptions that point at it. */
const uid = (what: string): string => `settings-${what}-${++ids}`;

/** A field marked invalid while its problem shows. */
function mark(field: HTMLElement, bad: boolean): void {
  if (bad) field.setAttribute('aria-invalid', 'true');
  else field.removeAttribute('aria-invalid');
}

/** A problem line beside its field: its text, or empty and hidden, so a description that points at it
 *  says nothing stale. */
function showProblem(line: HTMLElement, problem: string | null): void {
  setText(line, problem ?? '');
  setShown(line, problem !== null);
}

/** The controls the screen and the panel share, and the status line. */
interface Body {
  readonly form: HTMLFormElement;
  readonly message: HTMLElement;
  dispose(): void;
}

function settingsBody(host: SettingsHost, where: 'home' | 'match'): Body {
  const now = host.settings.get();
  const stored = host.settings.stored();
  const message = h('p', { role: 'status', class: 'muted', 'data-test': 'settings-message' });
  const say = (problem: string | null, kept: boolean): void => {
    message.className = problem === null ? 'muted' : 'error';
    setText(message, problem ?? (kept ? SAVED : NOT_SAVED));
  };
  const store = (change: Partial<StoredSettings>): void => {
    const problem = host.settings.set(change);
    say(problem, host.persistent());
  };
  const note = (text: string, test: string, under: boolean): HTMLParagraphElement =>
    h('p', { id: uid(test), class: under ? 'muted small settings-check-note' : 'muted small', 'data-test': test }, text);

  // --- The render quality ---
  const qualityNote = where === 'match' ? note(APPLIES.qualityInMatch, 'quality-note', false) : null;
  const qualities = QUALITIES.map((q) => {
    const radio = h('input', {
      type: 'radio', name: 'quality', value: q.value, checked: now.quality === q.value, 'data-test': `quality-${q.value}`,
      'aria-describedby': qualityNote?.id,
    });
    radio.addEventListener('change', () => {
      if (radio.checked) store({ quality: q.value });
    });
    return { value: q.value, radio, label: h('label', { class: 'check' }, radio, h('span', {}, q.label)) };
  });

  // --- The checks ---
  const check = (on: boolean, test: string, set: (on: boolean) => Partial<StoredSettings>, described: HTMLElement | null = null): HTMLInputElement => {
    const box = h('input', { type: 'checkbox', checked: on, 'data-test': test, 'aria-describedby': described?.id });
    box.addEventListener('change', () => store(set(box.checked)));
    return box;
  };
  const row = (box: HTMLInputElement, label: string): HTMLLabelElement => h('label', { class: 'check' }, box, h('span', {}, label));
  const ballViewNote = note(APPLIES.ballView, 'ball-view-note', true);
  const calmNote = note(APPLIES.calmCamera, 'calm-camera-note', true);
  setShown(calmNote, stored.calmCamera === null);
  const sound = check(now.sound, 'sound', (on) => ({ sound: on }));
  const names = check(now.names, 'names', (on) => ({ names: on }));
  const ballView = check(now.ballView, 'ball-view', (on) => ({ ballView: on }), ballViewNote);
  const calm = check(now.calmCamera, 'calm-camera', (on) => ({ calmCamera: on }), calmNote);
  const mirror = check(now.mirrorTouch, 'mirror-touch', (on) => ({ mirrorTouch: on }));

  // --- Show control hints again (D-29, M4-Q28) ---
  const hintsAgain = h('button', {
    type: 'button', class: 'secondary', 'data-test': 'hints-again',
    onclick: () => {
      host.profile.update((p) => (hintsCleared(p) ? null : { ...p, hints: NO_HINTS }));
      message.className = 'muted';
      setText(message, host.profile.persistent ? HINTS_AGAIN : NOT_SAVED);
    },
  }, 'Show control hints again');

  // --- The relays and the TURN server, checked as typed ---
  const connectionsNote = note(APPLIES.connections, 'connections-note', false);
  const relaysLine = h('p', { id: uid('relays-problem'), class: 'error small', 'data-test': 'relays-problem', hidden: true });
  const relays = h('textarea', {
    rows: 3, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', inputmode: 'url',
    // roslambo's words: a host here, even an example's, would fail the dist audit, which allows only
    // third-party.json's hosts (PLAN §15).
    placeholder: 'One wss:// address per line',
    'aria-describedby': `${connectionsNote.id} ${relaysLine.id}`, 'data-test': 'relays',
  });
  relays.value = stored.relays.join('\n');
  /** The relays as typed: stored when they pass, their problem shown beside them when they don't; the
   *  status line told when the field is left (`tell`). */
  const relaysTyped = (tell: boolean): void => {
    const list = relayList(relays.value);
    const problem = relaysProblem(list);
    mark(relays, problem !== null);
    showProblem(relaysLine, problem);
    const refused = problem ?? host.settings.set({ relays: list });
    if (tell) say(refused, host.persistent());
  };
  relays.addEventListener('input', () => relaysTyped(false));
  relays.addEventListener('change', () => relaysTyped(true));

  const first: TurnServer | undefined = stored.turn[0];
  const text = { type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' } as const;
  const turnUrl = h('input', { ...text, inputmode: 'url', placeholder: 'turns:turn.example.com:443', value: first?.urls ?? '', 'data-test': 'turn-url' });
  const turnUser = h('input', { ...text, value: first?.username ?? '', 'data-test': 'turn-user' });
  const turnCredential = h('input', { type: 'password', autocomplete: 'off', value: first?.credential ?? '', 'data-test': 'turn-credential' });
  const turnFields: readonly (readonly [TurnField, HTMLInputElement])[] = [['urls', turnUrl], ['username', turnUser], ['credential', turnCredential]];
  const turnLine = h('p', { id: uid('turn-problem'), class: 'error small', 'data-test': 'turn-problem', hidden: true });
  /** The TURN server as typed: none while all three are empty; else stored once it's complete, the
   *  field its first problem is in marked until then. */
  const turnTyped = (tell: boolean): void => {
    const t: TurnServer = { urls: turnUrl.value.trim(), username: turnUser.value, credential: turnCredential.value };
    const none = t.urls === '' && t.username === '' && t.credential === '';
    const at = none ? null : turnProblemAt(t);
    for (const [field, input] of turnFields) mark(input, at?.field === field);
    showProblem(turnLine, at?.problem ?? null);
    const refused = at?.problem ?? host.settings.set({ turn: none ? [] : [t] });
    if (tell) say(refused, host.persistent());
  };
  for (const [, input] of turnFields) {
    input.setAttribute('aria-describedby', `${connectionsNote.id} ${turnLine.id}`);
    input.addEventListener('input', () => turnTyped(false));
    input.addEventListener('change', () => turnTyped(true));
  }

  const form = h('form', { class: 'settings-form', onsubmit: (e: Event) => e.preventDefault() },
    h('fieldset', {}, h('legend', {}, 'Render quality'), ...qualities.map((q) => q.label), qualityNote),
    row(sound, 'Sound'),
    row(names, 'Names over the other terriers'),
    row(ballView, 'Start each match in ball view'), ballViewNote,
    row(calm, 'A calmer camera, which swings more gently, in both views'), calmNote,
    row(mirror, 'Mirrored touch controls, with the stick on the right'),
    h('div', { class: 'row' }, hintsAgain),
    h('fieldset', {}, h('legend', {}, 'Connections'), connectionsNote,
      h('label', { class: 'field' }, h('span', {}, `Extra relays beside the built-in ones: up to ${RELAYS_MAX}, one wss:// address a line`), relays),
      relaysLine,
      h('fieldset', {}, h('legend', {}, 'Your own TURN server, for networks that block direct connections'),
        h('label', { class: 'field' }, h('span', {}, 'URL'), turnUrl),
        h('label', { class: 'field' }, h('span', {}, 'User name'), turnUser),
        h('label', { class: 'field' }, h('span', {}, 'Credential'), turnCredential),
        turnLine)),
  );

  /** The settings in force, as the store tells them: the calmer camera's among them while it follows the
   *  system (A.3). The text fields keep what's typed. */
  const sync = (s: Settings): void => {
    for (const q of qualities) q.radio.checked = s.quality === q.value;
    sound.checked = s.sound;
    names.checked = s.names;
    ballView.checked = s.ballView;
    calm.checked = s.calmCamera;
    mirror.checked = s.mirrorTouch;
    setShown(calmNote, host.settings.stored().calmCamera === null);
  };
  const stop = host.settings.subscribe(sync);
  return { form, message, dispose: stop };
}

/** Settings from Home (§6): Back returns Home. */
export function settingsScreen(host: SettingsHost): Screen {
  screenStyles();
  addStyle(css);
  const body = settingsBody(host, 'home');
  const el = h('section', { class: 'screen settings' },
    h('h1', {}, 'Settings'),
    body.form,
    body.message,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'secondary', 'data-test': 'back', onclick: () => host.back() }, 'Back')),
  );
  return { el, name: 'settings', dispose: () => body.dispose() };
}

/** Settings in a match (§5.8, PLAN §11): the panel the menu shows over the pitch, its heading and Back at
 *  its top, in view as it scrolls; Back returns to the match. */
export function settingsPanel(host: SettingsHost): SettingsPanel {
  screenStyles();
  addStyle(css);
  const body = settingsBody(host, 'match');
  const headingId = uid('title');
  const heading = h('h2', { id: headingId }, 'Settings');
  heading.tabIndex = -1;
  const el = h('div', { class: 'settings-panel', 'data-test': 'settings-panel' },
    h('div', { class: 'settings-panel-head' },
      heading,
      h('button', { type: 'button', class: 'secondary', 'data-test': 'back', onclick: () => host.back() }, 'Back')),
    h('div', { class: 'settings-panel-body' }, body.form, body.message));
  return {
    name: 'settings',
    el,
    headingId,
    focus: () => heading.focus({ preventScroll: true }),
    dispose: () => body.dispose(),
  };
}
