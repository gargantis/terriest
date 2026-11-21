// Home (M4's design, research/m4/DESIGN.md, §1.43, §5.2, §5.3; PLAN §10,
// §11; L162, L190): the display name, editable, fitted to 20 characters
// and 32 bytes by fitName (C-17) and stored on change; the coat, a radio
// group of the look's coats, each a swatch and its name, stored on change;
// Propose a match; Join with a code, which takes lowercase, dashes, spaces
// and Crockford's look-alikes (L190), and says so of a code that isn't
// one, contacting nothing; Practice; and Settings. When the browser won't
// keep the profile or the settings, Home says so (PLAN §10). Opening a
// #join= link skips it (L162). Its controls are native, for the keyboard's
// own Tab and Enter, the code's Enter submitting its form; the gamepad's
// commands move among and press its buttons (Q-17, L82). roslambo's home
// screen, without its balance, ledger and unsettled rounds. Phase 1's
// (shell) had the name, the coat, Practice and Settings; phase 2's
// net-screens adds Propose a match and Join, each shown when its host
// offers it. New at M4.

import { normalizeMatchId } from '../../core/match-id';
import { fitName, shownName } from '../../core/names';
import type { Look } from '../../render/look';
import type { ProfileSource } from '../../storage/schema';
import { h, setShown, setText } from '../dom';
import { ButtonNav } from '../nav';
import { addStyle } from '../style';
import css from './home.css?inline';
import { padOnly } from './propose';
import { coatSwatch, type Screen, screenStyles } from './screen';

export interface HomeHost {
  readonly profile: ProfileSource;
  readonly look: Look;
  /** The browser keeps the profile and the settings: both stores' persistent (PLAN §10). */
  persistent(): boolean;
  /** Propose a match: the app checks the canary first (D-23). */
  propose?(): void;
  /** A valid code's match ID, as normalizeMatchId writes it. */
  join?(id: string): void;
  practice(): void;
  settings(): void;
}

/** What Home says when the browser won't keep what's typed (PLAN §10). */
export const NOT_KEPT = 'This browser isn’t keeping your name, coat and settings between visits.';

/** What Home says of a code that isn't one (roslambo's): nothing is contacted. */
export const NOT_A_CODE = 'That code isn’t valid. Check it and try again: it has 21 characters.';

/** The coat to check: the profile's, or coat 0 for one outside the list, as it's drawn (D-12). */
export function checkedCoat(look: Look, coat: number): number {
  return Number.isInteger(coat) && coat >= 0 && coat < look.coats.length ? coat : 0;
}

export function homeScreen(host: HomeHost): Screen {
  screenStyles();
  addStyle(css);
  const p = host.profile.get();
  const notice = h('p', { class: 'notice', 'data-test': 'not-kept', hidden: true }, NOT_KEPT);
  const kept = (): void => {
    notice.hidden = host.persistent();
  };

  const name = h('input', {
    type: 'text', value: p.name, maxlength: 40, autocomplete: 'nickname', spellcheck: 'false',
    placeholder: `Optional: without one, you appear as ${shownName('', p.playerId)}`, 'data-test': 'name',
  });
  const saveName = (): void => {
    const fitted = fitName(name.value);
    if (name.value !== fitted) name.value = fitted;
    host.profile.update((x) => (x.name === fitted ? null : { ...x, name: fitted }));
    kept();
  };
  name.addEventListener('change', saveName);

  const checked = checkedCoat(host.look, p.coat);
  const coats = host.look.coats.map((c, k) => {
    const radio = h('input', { type: 'radio', name: 'coat', value: String(k), checked: k === checked, 'data-test': `coat-${k}` });
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      host.profile.update((x) => (x.coat === k ? null : { ...x, coat: k }));
      kept();
    });
    return h('label', { class: 'check coat-choice' }, radio, coatSwatch(host.look, k), h('span', {}, c.name));
  });

  // Propose a match, and Join with a code: the networked choices, where the host offers them.
  const propose = host.propose;
  const proposeButton = propose === undefined ? null : h('button', {
    type: 'button', class: 'primary', 'data-test': 'propose', onclick: () => { saveName(); propose(); },
  }, 'Propose a match');
  const join = host.join;
  const code = h('input', {
    type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'K7QM-2XDP-4TR8-WHZN-3VBC-7',
    'data-test': 'code',
  });
  const codeError = h('p', { class: 'error', role: 'alert', 'data-test': 'code-error', hidden: true });
  const joinButton = h('button', { type: 'submit', class: 'secondary', 'data-test': 'join' }, 'Join');
  const joinForm = join === undefined ? null : h('form', {
    class: 'join-form', novalidate: true,
    onsubmit: (e: Event) => {
      e.preventDefault();
      saveName();
      const id = normalizeMatchId(code.value);
      if (id === null) {
        setText(codeError, NOT_A_CODE);
        setShown(codeError, true);
        return;
      }
      setShown(codeError, false);
      join(id);
    },
  },
  h('div', { class: 'join-row' }, h('label', { class: 'field' }, h('span', {}, 'Join with a code'), code), joinButton),
  codeError);

  const practice = h('button', { type: 'button', class: 'secondary', 'data-test': 'practice', onclick: () => { saveName(); host.practice(); } }, 'Practice');
  const settings = h('button', { type: 'button', class: 'secondary', 'data-test': 'settings', onclick: () => { saveName(); host.settings(); } }, 'Settings');
  const nav = new ButtonNav(() => [proposeButton, joinForm === null ? null : joinButton, practice, settings].filter((b): b is HTMLButtonElement => b !== null));

  const el = h('section', { class: 'screen home' },
    h('h1', {}, 'terriest'),
    h('p', { class: 'tagline' }, 'Two packs of terriers corral a giant rubber ball into goals.'),
    h('label', { class: 'field' }, h('span', {}, 'Display name'), name),
    h('fieldset', { class: 'coats' }, h('legend', {}, 'Coat'), ...coats),
    proposeButton === null ? null : h('div', { class: 'row' },
      proposeButton, h('span', { class: 'muted small' }, 'Make a match, then share its link or code with the other players.')),
    joinForm,
    h('div', { class: 'row' },
      practice,
      h('span', { class: 'muted small' }, 'A match against bots in this browser, contacting no one.')),
    notice,
    h('div', { class: 'row' }, settings),
  );
  kept();
  return { el, name: 'home', ui: padOnly(nav) };
}
