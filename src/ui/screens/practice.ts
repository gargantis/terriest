// Practice's setup (M4's design, research/m4/DESIGN.md, §1.43, §5.4; PLAN
// Q-15, D-22; L158, L164): the pack size and the match length, from the
// configuration's ranges and defaults, then Start, which goes to Pre-match
// with Practice's match made, or Back, Home. Native controls, so the
// browser's own keys work them; the gamepad's d-pad moves among the two
// choices, Start and Back, its left and right step a focused choice an
// option at a time, and its Start presses a button, as on Propose, so a pad
// player who comes here from Home's nav needs no mouse (L82, §4.4, §4.9's
// pad parts, extended in phase 2b). New at M4.

import { config } from '../../config';
import type { MatchSettings } from '../../core/sim/index';
import { h } from '../dom';
import { ButtonNav, padOnly } from '../nav';
import { type Screen, screenStyles } from './screen';

export interface PracticeHost {
  start(s: MatchSettings): void;
  home(): void;
  /** The match rules' row (C-59): without it the screen offers none. */
  readonly rules?: RulesEntry;
  /** The pack size and the length to show, as the Rules screen's Back returns with them; the defaults
   *  without. */
  readonly chosen?: MatchSettings;
}

/** What the setup screens need of the app for the match rules' row (C-59). */
export interface RulesEntry {
  /** The rules the match will play by, in a few words (rulesSummary). */
  summary(): string;
  /** Rules…: the Rules screen, whose Back returns with these choices. */
  open(chosen: MatchSettings): void;
}

/** The match rules' row (C-59): its summary, and Rules…, which opens the Rules screen with the setup's
 *  choices as they stand; marked as the screen's focus when the Rules screen's Back returns to it. */
export function rulesRow(entry: RulesEntry, chosen: () => MatchSettings, returning: boolean): { readonly row: HTMLElement; readonly button: HTMLButtonElement } {
  const button = h('button', {
    type: 'button', class: 'secondary', 'data-test': 'rules', 'aria-describedby': 'rules-summary', onclick: () => entry.open(chosen()),
    ...(returning ? { 'data-focus': '' } : {}),
  }, 'Rules…');
  const row = h('div', { class: 'field' },
    h('span', {}, 'Rules'),
    h('div', { class: 'row' }, h('span', { id: 'rules-summary', 'data-test': 'rules-summary' }, entry.summary()), button),
  );
  return { row, button };
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
  const at = host.chosen ?? c.start;
  const size = select(c.sizes, at.packSize, sizeText, 'pack-size');
  const minutes = select(c.minutes, at.matchMinutes, minutesText, 'match-length');
  const chosen = (): MatchSettings => ({ packSize: Number(size.value), matchMinutes: Number(minutes.value) });
  const go = h('button', { type: 'button', class: 'primary', 'data-test': 'start', onclick: () => host.start(chosen()) }, 'Start');
  const back = h('button', { type: 'button', class: 'secondary', 'data-test': 'back', onclick: () => host.home() }, 'Back');
  const rules = host.rules === undefined ? null : rulesRow(host.rules, chosen, host.chosen !== undefined);
  const nav = new ButtonNav(() => [size, minutes, ...(rules === null ? [] : [rules.button]), go, back]);
  const el = h('section', { class: 'screen practice' },
    h('h1', {}, 'Practice'),
    h('p', { class: 'muted' }, 'A match against bots in this browser, contacting no one: you play in the first pack, and bots take every other place.'),
    h('label', { class: 'field' }, h('span', {}, 'Pack size'), size),
    h('label', { class: 'field' }, h('span', {}, 'Match length'), minutes),
    ...(rules === null ? [] : [rules.row]),
    h('div', { class: 'row' }, go, back),
  );
  return { el, name: 'practice', ui: padOnly(nav) };
}
