// Home (M4's design, research/m4/DESIGN.md, §1.43, §5.3; PLAN §10, §11;
// L162): the display name, editable, fitted to 20 characters and 32 bytes
// by fitName (C-17) and stored on change; the coat, a radio group of the
// look's coats, each a swatch and its name, stored on change; Practice and
// Settings. When the browser won't keep the profile or the settings, Home
// says so (PLAN §10). roslambo's home screen, without its balance, ledger
// and unsettled rounds. Phase 1's (shell); phase 2's net-screens adds
// Propose a match and Join with a code. New at M4.

import { fitName, shownName } from '../../core/names';
import type { Look } from '../../render/look';
import type { ProfileSource } from '../../storage/schema';
import { h } from '../dom';
import { addStyle } from '../style';
import css from './home.css?inline';
import { coatSwatch, type Screen, screenStyles } from './screen';

export interface HomeHost {
  readonly profile: ProfileSource;
  readonly look: Look;
  /** The browser keeps the profile and the settings: both stores' persistent (PLAN §10). */
  persistent(): boolean;
  practice(): void;
  settings(): void;
}

/** What Home says when the browser won't keep what's typed (PLAN §10). */
export const NOT_KEPT = 'This browser isn’t keeping your name, coat and settings between visits.';

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

  const el = h('section', { class: 'screen home' },
    h('h1', {}, 'terriest'),
    h('p', { class: 'tagline' }, 'Two packs of terriers corral a giant rubber ball into goals.'),
    h('label', { class: 'field' }, h('span', {}, 'Display name'), name),
    h('fieldset', { class: 'coats' }, h('legend', {}, 'Coat'), ...coats),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'primary', 'data-test': 'practice', onclick: () => { saveName(); host.practice(); } }, 'Practice'),
      h('span', { class: 'muted small' }, 'A match against bots in this browser, contacting no one.')),
    notice,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'secondary', 'data-test': 'settings', onclick: () => { saveName(); host.settings(); } }, 'Settings')),
  );
  kept();
  return { el, name: 'home' };
}
