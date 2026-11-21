// Settings from Home (M4's design, research/m4/DESIGN.md, §1.43, §1.63,
// §2.8, §5.3, §6; PLAN §10, §11, A.3, D-33): phase 1's minimal screen, the
// render quality, start in ball view and the calmer camera, each stored as
// it changes. Each control shows the setting in force, so a null one shows
// the rule it follows, and choosing stores the choice (A.3). The app hears
// each change through SettingsSource.subscribe: the quality applies at once
// by re-creating the stage behind Home (§2.8), ball view from the next
// match's start, the calmer camera at once. A change the browser didn't
// keep is in force for this visit alone, and the screen says so (PLAN
// §10). Back returns Home. Phase 2's
// settings builder adds the rest of §6 and the in-match panel
// (settingsPanel). New at M4.

import type { RenderQuality } from '../../config';
import type { SettingsSource } from '../../storage/schema';
import { h, setText } from '../dom';
import { type Screen, screenStyles } from './screen';

export interface SettingsHost {
  readonly settings: SettingsSource;
  /** The browser kept the last change: the settings store's persistent (PLAN §10). */
  persistent(): boolean;
  back(): void;
}

/** What the screen says after a change the browser didn't keep (PLAN §10). */
export const NOT_SAVED = 'In use for this visit: this browser isn’t keeping your settings.';

const QUALITIES: readonly { readonly value: RenderQuality; readonly label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low: a lower resolution and simpler effects, for a slower device' },
];

export function settingsScreen(host: SettingsHost): Screen {
  screenStyles();
  const s = host.settings.get();
  const message = h('p', { role: 'status', class: 'muted', 'data-test': 'settings-message' });
  const store = (change: Parameters<SettingsSource['set']>[0]): void => {
    const problem = host.settings.set(change);
    message.className = problem === null ? 'muted' : 'error';
    setText(message, problem ?? (host.persistent() ? 'Saved.' : NOT_SAVED));
  };

  const qualities = QUALITIES.map((q) => {
    const radio = h('input', { type: 'radio', name: 'quality', value: q.value, checked: s.quality === q.value, 'data-test': `quality-${q.value}` });
    radio.addEventListener('change', () => {
      if (radio.checked) store({ quality: q.value });
    });
    return h('label', { class: 'check' }, radio, h('span', {}, q.label));
  });
  const check = (on: boolean, label: string, test: string, set: (on: boolean) => void): HTMLLabelElement => {
    const box = h('input', { type: 'checkbox', checked: on, 'data-test': test });
    box.addEventListener('change', () => set(box.checked));
    return h('label', { class: 'check' }, box, h('span', {}, label));
  };

  const el = h('section', { class: 'screen settings' },
    h('h1', {}, 'Settings'),
    h('fieldset', {}, h('legend', {}, 'Render quality'), ...qualities),
    check(s.ballView, 'Start each match in ball view', 'ball-view', (on) => store({ ballView: on })),
    check(s.calmCamera, 'A calmer camera, which swings more gently, in both views', 'calm-camera', (on) => store({ calmCamera: on })),
    h('p', { class: 'muted small' }, 'Until you choose, the calmer camera follows your system’s reduced-motion setting.'),
    message,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'secondary', 'data-test': 'back', onclick: () => host.back() }, 'Back')),
  );
  return { el, name: 'settings' };
}
