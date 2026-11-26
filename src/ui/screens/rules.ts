// The Rules screen (C-59; PLAN §11): the match rules this browser's
// Practice and the matches it proposes play by, from Practice's setup or
// Propose, whose Back returns there with the pack size and the length
// chosen. One select a rule, its choices from the configuration, its
// default marked, each stored as it changes (src/storage/rules.ts), and
// Reset to defaults, which sets every rule to its default; a status line,
// polite, saying what came of the last change: saved, or in use for this
// visit alone when the browser didn't keep it (PLAN §10). A match someone
// else proposed plays by theirs, which Pre-match lists. The controls are
// native, for the browser's own keys; the gamepad's d-pad moves among the
// selects and the buttons, and its left and right step a focused select a
// choice at a time, as on Practice's setup (padOnly). New with C-59.

import { config, type MatchRules, NO_RULES, RULE_SETTINGS, type RuleSetting } from '../../config';
import type { RulesSource } from '../../storage/schema';
import { h, setEnabled, setText } from '../dom';
import { ButtonNav, padOnly } from '../nav';
import { addStyle } from '../style';
import css from './rules.css?inline';
import { type Screen, screenStyles } from './screen';

/** How a rule reads: its name, a choice as the screen shows it, and what it does where its name alone
 *  doesn't say. */
interface RuleWords {
  readonly name: string;
  readonly text: (v: number) => string;
  readonly note?: string;
}

const each = (unit: string) => (v: number): string => `${v} ${unit}`;
/** The meter refills in the same proportion of its time as the configuration's (matchConfig). */
const refillRatio = config.zoomiesRefillSeconds / config.zoomiesFullSeconds;

/** Each rule's words, in the configuration's order (A.1's). */
export const RULE_WORDS: { readonly [K in RuleSetting]: RuleWords } = {
  runSpeedMetresPerSecond: { name: 'Run speed', text: each('m/s') },
  zoomiesSpeedMetresPerSecond: { name: 'Zoomies speed', text: each('m/s') },
  zoomiesFullSeconds: {
    name: 'Zoomies meter', text: (v) => `${v} s, refilling in ${v * refillRatio} s`,
    note: 'How long a full meter of zoomies lasts, and how long an empty one takes to fill.',
  },
  turnRateTurnsPerSecond: { name: 'Turn rate', text: (v) => `${v} ${v === 1 ? 'turn' : 'turns'} a second` },
  idleFrictionMetresPerSecond2: {
    name: 'Stopping', text: each('m/s²'),
    note: 'How fast a terrier slows with no direction held: lower slides further.',
  },
  jumpHeightMetres: { name: 'Jump height', text: each('m') },
  pounceSpeedMetresPerSecond: { name: 'Pounce speed', text: each('m/s') },
  pounceWaitSeconds: { name: 'Pounce wait', text: each('s'), note: 'How long after a pounce the next can start.' },
  bowlingSpeedMetresPerSecond: {
    name: 'Bowling speed', text: each('m/s'),
    note: 'A ball coming at a terrier at least this fast, by its speed toward it, tumbles it, unless that terrier is pouncing or touched the ball last.',
  },
  tumbleSeconds: { name: 'Tumble', text: each('s'), note: 'How long a tumbled terrier is down, getting up included.' },
  tumbleGuardSeconds: { name: 'Tumble guard', text: each('s'), note: 'How long after getting up a terrier can’t be tumbled again.' },
  ballRestitution: {
    name: 'Ball bounce', text: (v) => `${Math.round(v * 100)}%`,
    note: 'The share of its speed into the floor, a wall, the net overhead or the goal frame that the ball keeps as it bounces off; along them it keeps all of it.',
  },
  ballMassKg: { name: 'Ball weight', text: (v) => `${v / config.terrierMassKg} times a terrier’s` },
  rollingSlowdownMetresPerSecond2: { name: 'Ball slowdown', text: each('m/s²'), note: 'How fast a rolling ball slows: lower rolls further.' },
  kickoffCountdownSeconds: { name: 'Kickoff countdown', text: each('s'), note: 'Before every kickoff but the first.' },
};

/** A rule's value in a match: its own, or the configuration's default. */
export function ruleValue(rules: MatchRules, k: RuleSetting): number {
  return rules[k] ?? config[k];
}

/** The rules that differ from the defaults, as "Run speed 8 m/s", in A.1's order. */
export function changedRules(rules: MatchRules): string[] {
  const out: string[] = [];
  for (const k of RULE_SETTINGS) {
    const v = rules[k];
    if (v !== undefined && v !== config[k]) out.push(`${RULE_WORDS[k].name} ${RULE_WORDS[k].text(v)}`);
  }
  return out;
}

/** The rules in a few words, for the setup screens: "The defaults", or the changed ones, three at most
 *  by name and value, the rest counted; apart by semicolons, as Pre-match lists them, since a choice's
 *  words may hold a comma. */
export function rulesSummary(rules: MatchRules): string {
  const changed = changedRules(rules);
  if (changed.length === 0) return 'The defaults';
  if (changed.length <= 3) return changed.join('; ');
  return `${changed.slice(0, 2).join('; ')}; and ${changed.length - 2} more`;
}

export const SAVED = 'Saved.';
export const RESET = 'Every rule is at its default.';
/** Reset to defaults while there's nothing to reset: what it would do, said as why it can't (setEnabled). */
export const RESET_IDLE = 'Every rule at its default';
export const NOT_SAVED = 'In use for this visit: this browser isn’t keeping your rules.';

export interface RulesHost {
  readonly rules: RulesSource;
  /** Back: the setup screen it came from, with its choices (PLAN §11). */
  back(): void;
}

export function rulesScreen(host: RulesHost): Screen {
  screenStyles();
  addStyle(css);
  const store = host.rules;
  const message = h('p', { role: 'status', class: 'muted', 'data-test': 'rules-message' });
  const reset = h('button', { type: 'button', class: 'secondary', 'data-test': 'rules-reset' }, 'Reset to defaults');
  const selects = new Map<RuleSetting, HTMLSelectElement>();
  const fields: HTMLElement[] = [];
  for (const k of RULE_SETTINGS) {
    const words = RULE_WORDS[k];
    const choices = config.matchRules[k] as readonly number[];
    const note = words.note === undefined ? null : h('p', { id: `rule-note-${k}`, class: 'muted small rule-note' }, words.note);
    const sel = h('select', { 'data-test': `rule-${k}`, ...(note === null ? {} : { 'aria-describedby': note.id }) },
      ...choices.map((v) => h('option', { value: String(v) }, v === config[k] ? `${words.text(v)} (default)` : words.text(v))));
    sel.value = String(ruleValue(store.get(), k));
    sel.addEventListener('change', () => {
      store.set({ ...store.get(), [k]: Number(sel.value) });
      setText(message, store.persistent ? SAVED : NOT_SAVED);
      showReset();
    });
    selects.set(k, sel);
    fields.push(h('label', { class: 'field' }, h('span', {}, words.name), sel), ...(note === null ? [] : [note]));
  }
  /** Reset says why it can do nothing while every rule is at its default, as a button that can't act does. */
  const showReset = (): void => {
    const any = Object.keys(store.get()).length > 0;
    setEnabled(reset, any, any ? 'Reset to defaults' : RESET_IDLE);
  };
  reset.addEventListener('click', () => {
    if (Object.keys(store.get()).length === 0) return;
    store.set(NO_RULES);
    for (const [k, sel] of selects) sel.value = String(config[k]);
    setText(message, store.persistent ? RESET : NOT_SAVED);
    showReset();
  });
  showReset();
  const back = h('button', { type: 'button', class: 'secondary', 'data-test': 'back', onclick: () => host.back() }, 'Back');
  const nav = new ButtonNav(() => [...selects.values(), reset, back]);
  // A browser that isn't keeping the rules says so from the start, not only at the first change (PLAN §10).
  if (!store.persistent) setText(message, NOT_SAVED);
  const el = h('section', { class: 'screen rules' },
    h('h1', {}, 'Rules'),
    h('p', { class: 'muted' }, `How your matches play: Practice, and the matches you propose.${store.persistent ? ' This browser keeps your choices.' : ''} A match you join plays by the rules of the person who proposed it.`),
    h('div', { class: 'rules-list' }, ...fields),
    h('div', { class: 'row' }, reset, back),
    message,
  );
  return { el, name: 'rules', ui: padOnly(nav) };
}
