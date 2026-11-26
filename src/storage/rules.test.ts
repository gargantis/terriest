import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { canonicalRules, config, type Config, type MatchRules, NO_RULES, RULE_SETTINGS, type RuleSetting, rulesProblem } from '../config';
import { MemoryStorage } from './kv';
import { keptRules, parseRules, RulesStore } from './rules';
import { RULES_KEY } from './schema';

// The match rules last chosen in this browser (C-59; PLAN §10, A.3): with
// nothing stored, or a record that doesn't read, every rule at its
// default; a stored rule kept only while it names a rule and holds one of
// that rule's choices but its default, so a match takes whatever the store
// hands it, in A.1's order, and a later build's choices drop a stored value
// they no longer offer and keep the rest; every change one write of the
// whole record, the defaults left out, one that changes nothing writing
// nothing; a refused write losing that write only, the rules in force for
// the page, persistent false until a later write lands; and storage whose
// read failed never written, the rules played from memory.

const RUN = 'runSpeedMetresPerSecond' satisfies RuleSetting;
const JUMP = 'jumpHeightMetres' satisfies RuleSetting;
const TUMBLE = 'tumbleSeconds' satisfies RuleSetting;
const BOUNCE = 'ballRestitution' satisfies RuleSetting;

const stored = (kv: MemoryStorage): unknown => JSON.parse(kv.data.get(RULES_KEY) ?? 'null');
/** A.3's record of `rules`, as the store writes it. */
const record = (rules: unknown): string => JSON.stringify({ v: 1, rules });
/** k's choices, the configuration's. */
const choices = (k: RuleSetting): readonly number[] => config.matchRules[k];
/** One of k's choices but its default: the first, or the n-th, from the end when negative. */
const other = (k: RuleSetting, n = 0): number => choices(k).filter((v) => !Object.is(v, config[k])).at(n)!;
/** Every rule at another of its choices than its default. */
const everyRule = (n = 0): MatchRules => Object.fromEntries(RULE_SETTINGS.map((k) => [k, other(k, n)]));
/** A later build: c, with k offering `list`. */
const offering = (k: RuleSetting, list: readonly number[], c: Config = config): Config =>
  ({ ...c, matchRules: { ...c.matchRules, [k]: list } }) as Config;

/** What a stored rule may hold that no match takes, each dropped and its rule played at its default (C-59). */
const UNTAKEN: readonly (readonly [what: string, value: (k: RuleSetting) => unknown])[] = [
  ['its default', (k) => config[k]],
  ['past its choices', (k) => Math.max(...choices(k)) + 1],
  ['between its two least choices', (k) => {
    const [a, b] = [...choices(k)].sort((x, y) => x - y);
    return (a! + b!) / 2;
  }],
  ["another rule's choice", (k) => RULE_SETTINGS.flatMap((j) => choices(j)).find((v) => !choices(k).includes(v))],
  ['a choice in words', (k) => String(other(k))],
  ['a choice in a list', (k) => [other(k)]],
  ['a choice in an object', (k) => ({ value: other(k) })],
  ['null', () => null],
  ['on', () => true],
];

/** Any rules a match takes (C-59): each rule absent or another of its choices than its default. */
const takenRules: fc.Arbitrary<MatchRules> = fc
  .tuple(...RULE_SETTINGS.map((k) => fc.option(fc.constantFrom(...choices(k).filter((v) => !Object.is(v, config[k]))), { nil: undefined })))
  .map((values) => {
    const rules: { [K in RuleSetting]?: number } = {};
    RULE_SETTINGS.forEach((k, i) => {
      const v = values[i];
      if (v !== undefined) rules[k] = v;
    });
    return canonicalRules(rules, config);
  });

describe('the match rules last chosen (C-59; PLAN §10, A.3)', () => {
  it('plays every rule at its default with nothing stored, and writes nothing to read it', () => {
    const kv = new MemoryStorage();
    const s = new RulesStore(kv);
    expect(s.get()).toBe(NO_RULES);
    expect(s.persistent).toBe(true);
    expect(kv.data.size).toBe(0);
    expect(parseRules(null)).toBe(NO_RULES);
  });

  it("reads a record that doesn't read as none, every rule at its default, and leaves it be until a change", () => {
    const rules = { [RUN]: other(RUN) };
    expect(parseRules(record(rules))).toEqual(rules); // the record each of these spoils
    for (const raw of [
      // Not JSON, or cut short; JSON, but no record.
      '', '{nope', record(rules).slice(0, -1), 'null', '7', '"terriest"', '[]', JSON.stringify([{ v: 1, rules }]),
      // No version, or another; no rules.
      JSON.stringify({ rules }), JSON.stringify({ v: 2, rules }), JSON.stringify({ v: '1', rules }), JSON.stringify({ v: 1 }),
      JSON.stringify({ v: 1, Rules: rules }),
      // Rules that aren't an object of them.
      ...[null, other(RUN), 'fast', true, [other(RUN)], [rules]].map((x) => record(x)),
    ]) {
      expect(parseRules(raw), raw).toBe(NO_RULES);
      const kv = new MemoryStorage();
      kv.data.set(RULES_KEY, raw);
      const s = new RulesStore(kv);
      expect(s.get(), raw).toBe(NO_RULES);
      expect([s.persistent, kv.data.get(RULES_KEY)], raw).toEqual([true, raw]);
      // The first change writes the whole record over it.
      s.set(rules);
      expect(kv.data.get(RULES_KEY), raw).toBe(record(rules));
    }
  });

  it("keeps a stored rule only while it holds one of its choices but its default, and drops the rest, in A.1's order", () => {
    for (const [what, value] of UNTAKEN) {
      for (const k of RULE_SETTINGS) {
        const raw = record({ [k]: value(k) });
        expect((JSON.parse(raw) as { rules: object }).rules, `${k}: ${what}`).toHaveProperty(k); // the case is in the record
        expect(parseRules(raw), `${k}: ${what}`).toBe(NO_RULES);
      }
    }
    // Numbers a record's JSON doesn't write, as a caller might hand set(): none is a choice.
    for (const v of [NaN, Infinity, -Infinity, -0]) expect(keptRules({ [RUN]: v }), String(v)).toBe(NO_RULES);
    // A key that names no rule, though it holds a rule's choice: a setting that isn't a rule, a rule's
    // name spelled otherwise, and a rule under another key, the prototype's included.
    for (const raw of [
      record({ bogus: other(RUN) }),
      record({ zoomiesRefillSeconds: config.zoomiesRefillSeconds / 2 }),
      record({ runSpeed: other(RUN), RunSpeedMetresPerSecond: other(RUN), [`${RUN} `]: other(RUN) }),
      record({ matchRules: { [RUN]: other(RUN) } }),
      `{"v":1,"rules":{"__proto__":{"${RUN}":${other(RUN)}}}}`,
    ]) {
      expect(parseRules(raw), raw).toBe(NO_RULES);
    }
    // All at once, the rules written in reverse beside a key that names none: every other rule holds
    // another of its choices, each kept, in A.1's order, and the rest one of the cases above.
    const entries = RULE_SETTINGS.map((k, i): [string, unknown] => [
      k, i % 2 === 0 ? other(k, -1) : UNTAKEN[Math.floor(i / 2) % UNTAKEN.length]![1](k),
    ]);
    const got = parseRules(record(Object.fromEntries([['bogus', other(RUN)], ...[...entries].reverse()])));
    const kept = RULE_SETTINGS.filter((_, i) => i % 2 === 0);
    expect(Object.keys(got)).toEqual(kept);
    expect(got).toEqual(Object.fromEntries(kept.map((k) => [k, other(k, -1)])));
    expect(Object.isFrozen(got)).toBe(true);
    expect(rulesProblem(got, config)).toBeNull(); // a match takes them as they are
  });

  it('drops a stored value a later build no longer offers, or has made its setting, and keeps the rest', () => {
    const both = { [RUN]: other(RUN), [JUMP]: other(JUMP) };
    const raw = record(both);
    expect(parseRules(raw)).toEqual(both);
    // Values, never places in the list: the same choices listed otherwise keep both.
    expect(parseRules(raw, offering(RUN, [...choices(RUN)].reverse()))).toEqual(both);
    // RUN's value no longer offered, or the setting itself now, which a rule never is (C-59): JUMP's kept.
    const fewer = offering(RUN, choices(RUN).filter((v) => v !== other(RUN)));
    const tuned: Config = { ...config, [RUN]: other(RUN) };
    for (const c of [fewer, tuned]) {
      const got = parseRules(raw, c);
      expect(got).toEqual({ [JUMP]: other(JUMP) });
      expect(rulesProblem(got, c)).toBeNull();
    }
    expect(parseRules(raw, offering(JUMP, choices(JUMP).filter((v) => v !== other(JUMP)), fewer))).toBe(NO_RULES);
    // A later build offering 0: a stored -0, which JSON keeps, isn't it, as a match compares by Object.is.
    const zero = offering(BOUNCE, [0, ...choices(BOUNCE)]);
    const bounce = (text: string): string => `{"v":1,"rules":{"${BOUNCE}":${text}}}`;
    expect(parseRules(bounce('-0'), zero)).toBe(NO_RULES);
    expect(Object.is(parseRules(bounce('0'), zero)[BOUNCE], 0)).toBe(true);
  });

  it('writes the whole record once a change, its defaults left out, and nothing for a change that changes nothing', () => {
    const kv = new MemoryStorage();
    const writes = vi.spyOn(kv, 'setItem');
    const s = new RulesStore(kv);
    // No change yet: none, a default spelled out, or a value its rule doesn't offer.
    s.set(NO_RULES);
    s.set({ [RUN]: config[RUN] });
    s.set({ [RUN]: Math.max(...choices(RUN)) + 1 });
    expect(writes).not.toHaveBeenCalled();
    expect(s.get()).toBe(NO_RULES);
    // Given in another order, beside a default and a value its rule doesn't offer: the two, in A.1's order.
    const two = { [RUN]: other(RUN), [TUMBLE]: other(TUMBLE) };
    s.set({ [TUMBLE]: other(TUMBLE), [JUMP]: config[JUMP], [BOUNCE]: Math.max(...choices(BOUNCE)) + 1, [RUN]: other(RUN) });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(kv.data.get(RULES_KEY)).toBe(record(two));
    expect(s.get()).toEqual(two);
    expect(Object.isFrozen(s.get())).toBe(true);
    // The same again, however written: nothing.
    s.set({ [TUMBLE]: other(TUMBLE), [RUN]: other(RUN) });
    s.set({ ...s.get(), [JUMP]: config[JUMP] });
    s.set(s.get());
    expect(writes).toHaveBeenCalledTimes(1);
    // One rule changed and one back at its default: the whole record again.
    s.set({ [RUN]: config[RUN], [TUMBLE]: other(TUMBLE, -1) });
    expect(writes).toHaveBeenCalledTimes(2);
    expect(stored(kv)).toEqual({ v: 1, rules: { [TUMBLE]: other(TUMBLE, -1) } });
    expect(s.persistent).toBe(true);
  });

  it('stores none as an empty record, every rule back at its default', () => {
    const kv = new MemoryStorage();
    const s = new RulesStore(kv);
    s.set(everyRule());
    expect(Object.keys((stored(kv) as { rules: object }).rules)).toEqual(RULE_SETTINGS);
    s.set(NO_RULES);
    expect(kv.data.get(RULES_KEY)).toBe(JSON.stringify({ v: 1, rules: {} }));
    expect(s.get()).toBe(NO_RULES);
    expect(s.persistent).toBe(true);
    expect(new RulesStore(kv).get()).toBe(NO_RULES);
  });

  it('reads back in a second store over the same storage, as the next visit does, what the first wrote', () => {
    const kv = new MemoryStorage();
    new RulesStore(kv).set(everyRule(-1));
    const next = new RulesStore(kv);
    expect(next.get()).toEqual(everyRule(-1));
    expect(Object.keys(next.get())).toEqual(RULE_SETTINGS);
    expect(next.persistent).toBe(true);
    next.set({ [JUMP]: other(JUMP) });
    expect(new RulesStore(kv).get()).toEqual({ [JUMP]: other(JUMP) });
  });

  it('loses a refused write only: the rules in force for the page, and persistent false until a later write lands', () => {
    const kv = new MemoryStorage();
    const s = new RulesStore(kv);
    s.set({ [RUN]: other(RUN) });
    const before = record({ [RUN]: other(RUN) });
    expect(kv.data.get(RULES_KEY)).toBe(before);
    // A write refused once, as by a page closed mid-write: the change in force, the record before it kept.
    kv.failNextWrite = true;
    s.set({ ...s.get(), [JUMP]: other(JUMP) });
    expect([s.get(), s.persistent, kv.data.get(RULES_KEY)]).toEqual([{ [RUN]: other(RUN), [JUMP]: other(JUMP) }, false, before]);
    s.set(s.get()); // no change, so no write to land
    expect(s.persistent).toBe(false);
    // Back to the rules the record holds, a change for the page, so a write, which lands.
    s.set({ [RUN]: other(RUN) });
    expect([s.persistent, kv.data.get(RULES_KEY)]).toEqual([true, before]);
    // Every write refused while the quota's full, then the next one landing the whole record.
    kv.full = true;
    s.set({ [JUMP]: other(JUMP) });
    expect([s.get(), s.persistent, kv.data.get(RULES_KEY)]).toEqual([{ [JUMP]: other(JUMP) }, false, before]);
    s.set({ [JUMP]: other(JUMP), [TUMBLE]: other(TUMBLE) });
    expect([s.get(), s.persistent, kv.data.get(RULES_KEY)]).toEqual([{ [JUMP]: other(JUMP), [TUMBLE]: other(TUMBLE) }, false, before]);
    kv.full = false;
    s.set({ [TUMBLE]: other(TUMBLE) });
    expect(s.persistent).toBe(true);
    expect(stored(kv)).toEqual({ v: 1, rules: { [TUMBLE]: other(TUMBLE) } });
    expect(new RulesStore(kv).get()).toEqual(s.get());
  });

  it('never writes to storage whose read failed, and plays from memory', () => {
    const kv = new MemoryStorage();
    const raw = record({ [RUN]: other(RUN) });
    kv.data.set(RULES_KEY, raw);
    kv.getItem = () => {
      throw new Error('the read is refused');
    };
    const writes = [vi.spyOn(kv, 'setItem'), vi.spyOn(kv, 'removeItem')];
    const s = new RulesStore(kv);
    expect(s.get()).toBe(NO_RULES);
    expect(s.persistent).toBe(false);
    s.set({ [JUMP]: other(JUMP) });
    s.set(NO_RULES);
    s.set({ [TUMBLE]: other(TUMBLE) });
    expect([s.get(), s.persistent]).toEqual([{ [TUMBLE]: other(TUMBLE) }, false]);
    for (const w of writes) expect(w).not.toHaveBeenCalled();
    expect([...kv.data]).toEqual([[RULES_KEY, raw]]);
    // Storage the browser blocks, its writes refused too, and none at all: the same, from memory.
    const blocked = new MemoryStorage();
    blocked.blocked = true;
    for (const none of [blocked, null]) {
      const t = new RulesStore(none);
      expect([t.get(), t.persistent]).toEqual([NO_RULES, false]);
      t.set({ [JUMP]: other(JUMP) });
      expect([t.get(), t.persistent]).toEqual([{ [JUMP]: other(JUMP) }, false]);
    }
  });

  it('hands a match only rules it takes, whatever a record holds, and reads back any rules it wrote', () => {
    const anything = fc.oneof(fc.jsonValue(), fc.double(), fc.constantFrom(...new Set(RULE_SETTINGS.flatMap((k) => choices(k)))));
    const given = fc.tuple(
      fc.record(Object.fromEntries(RULE_SETTINGS.map((k) => [k, fc.oneof(fc.constantFrom(...choices(k)), anything)])), { requiredKeys: [] }),
      fc.dictionary(fc.string(), anything),
    );
    fc.assert(
      fc.property(given, ([rules, extra]) => {
        const raw = record({ ...extra, ...rules });
        const got = parseRules(raw);
        expect(rulesProblem(got, config), raw).toBeNull();
        expect(Object.keys(got), raw).toEqual(RULE_SETTINGS.filter((k) => Object.hasOwn(got, k)));
        // A stored rule is kept exactly when a match would take it alone.
        const read = (JSON.parse(raw) as { rules: Readonly<Record<string, unknown>> }).rules;
        for (const k of RULE_SETTINGS) {
          const v = read[k];
          const takes = typeof v === 'number' && rulesProblem({ [k]: v }, config) === null;
          expect(got[k], `${raw}: ${k}`).toBe(takes ? v : undefined);
        }
      }),
    );
    fc.assert(
      fc.property(takenRules, (rules) => {
        const kv = new MemoryStorage();
        new RulesStore(kv).set(rules);
        const next = new RulesStore(kv).get();
        expect(next).toEqual(rules);
        expect(Object.keys(next)).toEqual(Object.keys(rules));
      }),
    );
  });
});
