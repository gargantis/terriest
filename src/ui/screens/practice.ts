// Practice's setup (M4's design, research/m4/DESIGN.md, §1.43, §5.4; PLAN
// Q-15, D-22; L158, L164): the pack size and the match length, from the
// configuration's ranges and defaults, then Start, which goes to Pre-match
// with Practice's match made, or Back, Home. Native controls, so the
// browser's own keys work them (Q-17 names no nav here). New at M4.

import { config } from '../../config';
import type { MatchSettings } from '../../core/sim/index';
import { h } from '../dom';
import { type Screen, screenStyles } from './screen';

export interface PracticeHost {
  start(s: MatchSettings): void;
  home(): void;
}

/** The choices, from the configuration: pack sizes and lengths in minutes, each range whole, and the
 *  defaults the screen starts at (PLAN §11's Practice row, D-8). */
export function practiceChoices(): { readonly sizes: readonly number[]; readonly minutes: readonly number[]; readonly start: MatchSettings } {
  const range = (lo: number, hi: number): number[] => Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  return {
    sizes: range(config.packSizeMin, config.packSizeMax),
    minutes: range(config.matchLengthMinMinutes, config.matchLengthMaxMinutes),
    start: { packSize: config.packSizeDefault, matchMinutes: config.matchLengthDefaultMinutes },
  };
}

export const sizeText = (n: number): string => `${n} a side`;
export const minutesText = (n: number): string => (n === 1 ? '1 minute' : `${n} minutes`);

export function practiceScreen(host: PracticeHost): Screen {
  screenStyles();
  const c = practiceChoices();
  const select = (values: readonly number[], at: number, text: (n: number) => string, test: string): HTMLSelectElement => {
    const sel = h('select', { 'data-test': test }, ...values.map((v) => h('option', { value: String(v) }, text(v))));
    sel.value = String(at);
    return sel;
  };
  const size = select(c.sizes, c.start.packSize, sizeText, 'pack-size');
  const minutes = select(c.minutes, c.start.matchMinutes, minutesText, 'match-length');
  const start = (): void => host.start({ packSize: Number(size.value), matchMinutes: Number(minutes.value) });
  const el = h('section', { class: 'screen practice' },
    h('h1', {}, 'Practice'),
    h('p', { class: 'muted' }, 'A match against bots in this browser, contacting no one: you play in the first pack, and bots take every other place.'),
    h('label', { class: 'field' }, h('span', {}, 'Pack size'), size),
    h('label', { class: 'field' }, h('span', {}, 'Match length'), minutes),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'primary', 'data-test': 'start', onclick: start }, 'Start'),
      h('button', { type: 'button', class: 'secondary', 'data-test': 'back', onclick: () => host.home() }, 'Back')),
  );
  return { el, name: 'practice' };
}
