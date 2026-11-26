import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config, type MatchRules, NO_RULES, RULE_SETTINGS, type RuleSetting } from '../../config';
import type { UiCommand } from '../../input/source';
import { MemoryStorage } from '../../storage/kv';
import { RulesStore } from '../../storage/rules';
import { RULES_KEY, type StoredRules } from '../../storage/schema';
import { fake, FakeEvent, type FakeDocument, type FakeElement, installDom, only } from '../dom-testing';
import { changedRules, NOT_SAVED, RESET, RESET_IDLE, RULE_WORDS, ruleValue, rulesScreen, rulesSummary, SAVED } from './rules';
import type { Screen } from './screen';

// The Rules screen (C-59; PLAN §10, §11, A.3), on the DOM fake over the
// real store in memory: a select for each rule, in A.1's order, its
// choices the configuration's, its default marked, the stored choice
// chosen, else the default; each change stored at once, a rule back at its
// default dropped, the status line saying so, or that the change is in
// force for this visit alone where the browser doesn't keep it; whether
// the browser keeps the choices said from the start, by the intro and the
// status line; Reset to defaults, marked while every rule is at its
// default, setting each to it; Back; the gamepad's d-pad through every
// select, Reset and Back, its left and right stepping a focused select a
// choice at a time, each step stored, the keys left to the browser (L82);
// and the rules in words, for the setup screens' summary and Pre-match,
// the ball's bounce as a share of its speed, with its note.

/** A rule's choices, the configuration's. */
const choices = (k: RuleSetting): readonly number[] => config.matchRules[k];
/** The first of a rule's choices that isn't its default. */
const other = (k: RuleSetting): number => choices(k).find((v) => v !== config[k])!;
/** Rules from (rule, value) pairs. */
const rulesOf = (...pairs: (readonly [RuleSetting, number])[]): MatchRules => Object.fromEntries(pairs) as MatchRules;
/** A.3's record in the storage, or null with none. */
const storedIn = (kv: MemoryStorage): StoredRules | null => JSON.parse(kv.data.get(RULES_KEY) ?? 'null') as StoredRules | null;
/** A choice made on a select as a person makes one: its value, then its change. */
const choose = (sel: FakeElement, v: number): void => {
  sel.value = String(v);
  sel.dispatchEvent(new FakeEvent('change', { bubbles: true }));
};

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

interface Rig {
  readonly kv: MemoryStorage;
  readonly rules: RulesStore;
  readonly s: Screen;
  readonly el: FakeElement;
  readonly message: FakeElement;
  readonly reset: FakeElement;
  readonly went: string[];
  /** A rule's select. */
  select(k: RuleSetting): FakeElement;
}

/** The screen in the document, over a RulesStore whose storage holds A.3's record of `stored`, if given. */
function rig(stored?: MatchRules): Rig {
  const kv = new MemoryStorage();
  if (stored !== undefined) kv.data.set(RULES_KEY, JSON.stringify({ v: 1, rules: stored } satisfies StoredRules));
  const rules = new RulesStore(kv);
  const went: string[] = [];
  const s = rulesScreen({ rules, back: () => went.push('back') });
  const el = fake(s.el);
  dom.document.body.append(el);
  return {
    kv, rules, s, el, went,
    message: only(el, '[data-test="rules-message"]'),
    reset: only(el, 'button[data-test="rules-reset"]'),
    select: (k) => only(el, `select[data-test="rule-${k}"]`),
  };
}

describe('the Rules screen (C-59, PLAN §11)', () => {
  it("offers a select for each rule, in A.1's order, in its label and described by its note, its choices the configuration's with the default marked, and the default chosen while none is stored", () => {
    const r = rig();
    expect([r.s.name, only(r.el, 'h1').textContent]).toEqual(['rules', 'Rules']);
    expect(r.el.querySelectorAll('select').map((x) => x.getAttribute('data-test'))).toEqual(RULE_SETTINGS.map((k) => `rule-${k}`));
    for (const k of RULE_SETTINGS) {
      const sel = r.select(k);
      const options = sel.querySelectorAll('option');
      expect(options.map((o) => o.value), k).toEqual(choices(k).map(String));
      expect(options.map((o) => o.textContent), k).toEqual(choices(k).map((v) => `${RULE_WORDS[k].text(v)}${v === config[k] ? ' (default)' : ''}`));
      expect(options.filter((o) => o.textContent.endsWith(' (default)')).map((o) => o.value), k).toEqual([String(config[k])]);
      expect(sel.value, k).toBe(String(config[k]));
      // Its name in its label, and its note, where it has one, its description, so a screen reader hears both.
      expect([sel.parentNode?.tagName, sel.parentNode?.children[0]?.textContent], k).toEqual(['LABEL', RULE_WORDS[k].name]);
      const described = sel.getAttribute('aria-describedby');
      expect(described === null ? undefined : only(r.el, `[id="${described}"]`).textContent, k).toBe(RULE_WORDS[k].note);
    }
    // Nothing said yet, and Reset marked, since every rule is at its default.
    expect([r.message.textContent, r.message.getAttribute('role')]).toEqual(['', 'status']);
    expect([r.reset.textContent, r.reset.getAttribute('aria-disabled')]).toEqual([RESET_IDLE, 'true']);
  });

  it("says from the start whether this browser keeps the choices: the intro only while it does, and the status line already saying it doesn't where it doesn't (PLAN §10)", () => {
    const KEEPS = 'This browser keeps your choices.';
    /** The intro, the first paragraph, and the status line of a screen over `rules`, as it opens. */
    const opened = (rules: RulesStore): { readonly intro: string; readonly message: string } => {
      const el = fake(rulesScreen({ rules, back: () => {} }).el);
      return { intro: el.children.find((c) => c.localName === 'p')!.textContent, message: only(el, '[data-test="rules-message"]').textContent };
    };
    // Kept: the intro says so, and the status line says nothing yet.
    const kept = opened(new RulesStore(new MemoryStorage()));
    expect(kept.intro).toContain(KEEPS);
    expect(kept.message).toBe('');
    // Not kept, before any change: no storage; storage whose read is blocked; and a store whose last write
    // was refused, its change in force for this page alone.
    const blocked = new MemoryStorage();
    blocked.blocked = true;
    const full = new MemoryStorage();
    const refused = new RulesStore(full);
    full.full = true;
    const a = RULE_SETTINGS[0]!;
    refused.set(rulesOf([a, other(a)]));
    const stores: [string, RulesStore][] = [['no storage', new RulesStore(null)], ['a blocked read', new RulesStore(blocked)], ['a refused write', refused]];
    for (const [what, rules] of stores) {
      expect(rules.persistent, what).toBe(false);
      // The same intro, but for the words that would say the browser keeps them.
      expect(opened(rules), what).toEqual({ intro: kept.intro.replace(` ${KEEPS}`, ''), message: NOT_SAVED });
    }
    expect(kept.intro.replace(` ${KEEPS}`, '')).not.toMatch(/keep/i);
    // A write that succeeds again: kept, and the next screen says so again.
    full.full = false;
    refused.set(NO_RULES);
    expect([refused.persistent, opened(refused)]).toEqual([true, kept]);
  });

  it('shows the stored rules chosen, every other rule at its default, and Reset able to act', () => {
    const [a, b] = [RULE_SETTINGS[0]!, RULE_SETTINGS.at(-1)!];
    const r = rig(rulesOf([a, other(a)], [b, other(b)]));
    expect(RULE_SETTINGS.map((k) => r.select(k).value)).toEqual(RULE_SETTINGS.map((k) => String(k === a || k === b ? other(k) : config[k])));
    expect(r.reset.getAttribute('aria-disabled')).toBeNull();
  });

  it('stores each choice as it changes, one whole record, a rule back at its default dropped, and says so', () => {
    const r = rig();
    const [a, b] = [RULE_SETTINGS[1]!, RULE_SETTINGS[4]!];
    choose(r.select(a), other(a));
    expect([storedIn(r.kv), r.message.textContent, r.reset.getAttribute('aria-disabled')]).toEqual([{ v: 1, rules: rulesOf([a, other(a)]) }, SAVED, null]);
    choose(r.select(b), other(b));
    expect(storedIn(r.kv)).toEqual({ v: 1, rules: rulesOf([a, other(a)], [b, other(b)]) });
    choose(r.select(a), config[a]);
    expect([storedIn(r.kv), r.rules.get(), r.message.textContent]).toEqual([{ v: 1, rules: rulesOf([b, other(b)]) }, rulesOf([b, other(b)]), SAVED]);
    // The last one back at its default: none stored, and Reset marked again.
    choose(r.select(b), config[b]);
    expect([storedIn(r.kv), r.reset.getAttribute('aria-disabled')]).toEqual([{ v: 1, rules: {} }, 'true']);
  });

  it("says a change, a reset's too, is in force for this visit alone when the browser doesn't keep it, and saved once it does again (PLAN §10)", () => {
    const [a, b] = [RULE_SETTINGS[0]!, RULE_SETTINGS[2]!];
    const r = rig();
    r.kv.full = true;
    choose(r.select(a), other(a));
    expect([r.rules.get(), r.rules.persistent, storedIn(r.kv), r.message.textContent]).toEqual([rulesOf([a, other(a)]), false, null, NOT_SAVED]);
    r.kv.full = false;
    choose(r.select(b), other(b));
    const both: StoredRules = { v: 1, rules: rulesOf([a, other(a)], [b, other(b)]) };
    expect([storedIn(r.kv), r.message.textContent]).toEqual([both, SAVED]);
    // A reset the browser doesn't keep: the defaults for this visit, the record as it was.
    r.kv.full = true;
    r.reset.click();
    expect([r.rules.get(), storedIn(r.kv), r.message.textContent, r.select(a).value]).toEqual([NO_RULES, both, NOT_SAVED, String(config[a])]);
    // And a browser that keeps nothing, its storage missing or blocked, from the first change.
    const none = rulesScreen({ rules: new RulesStore(null), back: () => {} });
    choose(only(none.el, `select[data-test="rule-${a}"]`), other(a));
    expect(only(none.el, '[data-test="rules-message"]').textContent).toBe(NOT_SAVED);
  });

  it('sets every rule to its default by Reset to defaults, storing none and saying so, then marks it again, and a press with nothing to reset does nothing', () => {
    const r = rig();
    r.reset.click();
    expect([r.kv.data.has(RULES_KEY), r.message.textContent]).toEqual([false, '']);
    const [a, b] = [RULE_SETTINGS[0]!, RULE_SETTINGS.at(-1)!];
    choose(r.select(a), other(a));
    choose(r.select(b), other(b));
    expect([r.reset.textContent, r.reset.getAttribute('aria-disabled')]).toEqual(['Reset to defaults', null]);
    r.reset.click();
    expect([storedIn(r.kv), r.rules.get(), r.message.textContent]).toEqual([{ v: 1, rules: {} }, NO_RULES, RESET]);
    expect(RULE_SETTINGS.filter((k) => r.select(k).value !== String(config[k]))).toEqual([]);
    expect([r.reset.textContent, r.reset.getAttribute('aria-disabled')]).toEqual([RESET_IDLE, 'true']);
  });

  it('goes back to the setup it came from by Back', () => {
    const r = rig();
    only(r.el, 'button[data-test="back"]').click();
    expect(r.went).toEqual(['back']);
  });

  it("takes the gamepad's d-pad through every select, Reset and Back, its left and right stepping a focused select a choice at a time, each step stored, and leaves the keys to the browser (L82)", () => {
    const r = rig();
    const cmd = (kind: UiCommand['kind'], source: UiCommand['source'] = 'gamepad'): void => r.s.ui!({ kind, pressedAt: 0, source, repeat: false });
    const focused = (): string | null => dom.document.activeElement.getAttribute('data-test');
    const order: (string | null)[] = [];
    for (let n = 0; n < RULE_SETTINGS.length + 2; n++) {
      cmd('down');
      order.push(focused());
    }
    expect(order).toEqual([...RULE_SETTINGS.map((k) => `rule-${k}`), 'rules-reset', 'back']);
    cmd('down');
    expect(focused()).toBe(`rule-${RULE_SETTINGS[0]!}`); // round the end
    // A rule whose default has a choice either side, as the run speed's has.
    const inside = (k: RuleSetting): boolean => choices(k).indexOf(config[k]) > 0 && choices(k).indexOf(config[k]) < choices(k).length - 1;
    const i = RULE_SETTINGS.findIndex(inside);
    const k = RULE_SETTINGS[i]!;
    const list = choices(k);
    const at = list.indexOf(config[k]);
    for (let n = 0; n < i; n++) cmd('down');
    expect(focused()).toBe(`rule-${k}`);
    cmd('right');
    expect([r.select(k).value, storedIn(r.kv), r.message.textContent]).toEqual([String(list[at + 1]), { v: 1, rules: rulesOf([k, list[at + 1]!]) }, SAVED]);
    cmd('left'); // back at its default: dropped
    expect([r.select(k).value, storedIn(r.kv)]).toEqual([String(config[k]), { v: 1, rules: {} }]);
    for (let n = at; n >= 0; n--) cmd('left'); // one past the first choice: no further
    expect([r.select(k).value, storedIn(r.kv)]).toEqual([String(list[0]), { v: 1, rules: rulesOf([k, list[0]!]) }]);
    // The browser's own arrows change a focused select, never the nav too, and the pad's Start presses no select.
    cmd('right', 'keyboard');
    cmd('down', 'keyboard');
    cmd('press');
    expect([focused(), r.select(k).value]).toEqual([`rule-${k}`, String(list[0])]);
    // Down to Reset, which the pad's Start presses, and which then keeps the focus, marked.
    for (let n = i; n < RULE_SETTINGS.length; n++) cmd('down');
    expect(focused()).toBe('rules-reset');
    cmd('press');
    expect([r.select(k).value, storedIn(r.kv), r.message.textContent]).toEqual([String(config[k]), { v: 1, rules: {} }, RESET]);
    expect([focused(), r.reset.getAttribute('aria-disabled')]).toEqual(['rules-reset', 'true']);
    cmd('down');
    expect(focused()).toBe('back');
    cmd('press', 'keyboard'); // the browser's own Enter presses it there, never the nav too
    expect(r.went).toEqual([]);
    cmd('press');
    expect(r.went).toEqual(['back']);
  });
});

describe('the rules in words (C-59)', () => {
  it("words every rule, in A.1's order, and no other, each named apart, each choice told apart and read as a person says it", () => {
    expect(Object.keys(RULE_WORDS)).toEqual([...RULE_SETTINGS]);
    const names = RULE_SETTINGS.map((k) => RULE_WORDS[k].name);
    expect(new Set(names).size).toBe(names.length);
    for (const k of RULE_SETTINGS) {
      const texts = choices(k).map((v) => RULE_WORDS[k].text(v));
      expect(new Set(texts).size, k).toBe(texts.length);
      // No float's noise, such as a share of 0.7 as 70.00000000000001%.
      for (const t of texts) expect(t, k).not.toMatch(/\d\.\d{3}/);
    }
    expect(RULE_WORDS.turnRateTurnsPerSecond.text(1)).toBe('1 turn a second');
  });

  it("reads the ball's bounce as the percentage of its speed it keeps, each choice so on its select, which its note describes", () => {
    const k = 'ballRestitution';
    const r = rig();
    const sel = r.select(k);
    // Each option a whole percentage, the share it keeps, the default marked.
    const texts = sel.querySelectorAll('option').map((o) => o.textContent);
    expect(texts).toHaveLength(choices(k).length);
    choices(k).forEach((v, i) => {
      const m = /^(\d+)%( \(default\))?$/.exec(texts[i]!);
      expect(m, texts[i]).not.toBeNull();
      expect([Number(m![1]) / 100, m![2] !== undefined], texts[i]).toEqual([v, v === config[k]]);
    });
    // Its note, which says what the share is of, describes its select, so a screen reader hears it too.
    const note = RULE_WORDS[k].note;
    expect(note).toMatch(/speed/);
    const described = sel.getAttribute('aria-describedby');
    expect(described).not.toBeNull();
    expect(only(r.el, `[id="${described!}"]`).textContent).toBe(note);
  });

  it("reads a rule's value in a match, its own or its default, and lists the changed rules in A.1's order, each by name and value", () => {
    const [a, b, c] = [RULE_SETTINGS[0]!, RULE_SETTINGS[1]!, RULE_SETTINGS[2]!];
    expect(RULE_SETTINGS.map((k) => ruleValue(NO_RULES, k))).toEqual(RULE_SETTINGS.map((k) => config[k]));
    expect([ruleValue(rulesOf([a, other(a)]), a), ruleValue(rulesOf([a, other(a)]), b)]).toEqual([other(a), config[b]]);
    expect(changedRules(NO_RULES)).toEqual([]);
    // Given out of A.1's order, listed in it, and a rule at its default not among them.
    expect(changedRules(rulesOf([c, other(c)], [b, config[b]], [a, other(a)]))).toEqual([a, c].map((k) => `${RULE_WORDS[k].name} ${RULE_WORDS[k].text(other(k))}`));
    // As Pre-match and the setup screens show them, and e2e/rules.spec.ts reads them: the run speed in m/s,
    // and the zoomies meter with its refill, which keeps the configuration's proportion (matchConfig).
    const run = other('runSpeedMetresPerSecond');
    const meter = other('zoomiesFullSeconds');
    expect(changedRules(rulesOf(['zoomiesFullSeconds', meter], ['runSpeedMetresPerSecond', run]))).toEqual([
      `Run speed ${run} m/s`, `Zoomies meter ${meter} s, refilling in ${meter * (config.zoomiesRefillSeconds / config.zoomiesFullSeconds)} s`,
    ]);
  });

  it('sums the rules up for the setup screens: the defaults, up to three by name and value, and past three the first two and a count, apart by semicolons', () => {
    const first = (n: number): MatchRules => rulesOf(...RULE_SETTINGS.slice(0, n).map((k) => [k, other(k)] as const));
    const words = changedRules(first(RULE_SETTINGS.length));
    expect(words).toHaveLength(RULE_SETTINGS.length);
    expect(rulesSummary(NO_RULES)).toBe('The defaults');
    expect(rulesSummary(rulesOf([RULE_SETTINGS[0]!, config[RULE_SETTINGS[0]!]]))).toBe('The defaults'); // a rule at its default
    expect(rulesSummary(first(1))).toBe(words[0]);
    expect(rulesSummary(first(3))).toBe(words.slice(0, 3).join('; '));
    expect(rulesSummary(first(4))).toBe(`${words[0]}; ${words[1]}; and 2 more`);
    expect(rulesSummary(first(RULE_SETTINGS.length))).toBe(`${words[0]}; ${words[1]}; and ${RULE_SETTINGS.length - 2} more`);
    // The zoomies meter's words hold a comma, so the summary's rules stand apart by semicolons.
    const meter = config.matchRules.zoomiesFullSeconds[0];
    const run = other('runSpeedMetresPerSecond');
    expect(rulesSummary(rulesOf(['runSpeedMetresPerSecond', run], ['zoomiesFullSeconds', meter]))).toBe(
      `Run speed ${run} m/s; Zoomies meter ${meter} s, refilling in ${meter * (config.zoomiesRefillSeconds / config.zoomiesFullSeconds)} s`,
    );
  });
});
