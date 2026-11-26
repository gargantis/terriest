// The match rules last chosen in this browser (C-59; PLAN §10, A.3): what
// Practice and the matches this browser proposes play by, under a key of
// their own, every change one write of the whole record, a change that
// changes nothing writing nothing. Only the choices that differ from the
// build's settings are kept, each as its value, never its place in the
// list, so a later build that changes a rule's choices keeps those still
// offered: a stored rule that isn't one of its choices now, or names no
// rule, is dropped, and its rule plays at its default. A record that
// doesn't read is none: every rule at its default. Like the settings
// (src/storage/settings.ts), a refused write keeps the change for this
// page alone, persistent false until a later write succeeds.

import { config, type Config, type MatchRules, NO_RULES, RULE_SETTINGS, sameRules } from '../config';
import { browserStorage, type KeyValue, tryWrite } from './kv';
import { RULES_KEY, type RulesSource, type StoredRules } from './schema';

/** The rules a stored record holds over c, each one of its choices and none c's own setting; NO_RULES
 *  for a record that doesn't read. */
export function parseRules(raw: string | null, c: Config = config): MatchRules {
  if (raw === null) return NO_RULES;
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch {
    return NO_RULES;
  }
  if (typeof x !== 'object' || x === null || (x as Record<string, unknown>)['v'] !== 1) return NO_RULES;
  const given = (x as Record<string, unknown>)['rules'];
  if (typeof given !== 'object' || given === null || Array.isArray(given)) return NO_RULES;
  return keptRules(given as Record<string, unknown>, c);
}

/** Of `given`, the rules a match can take over c: each a rule setting whose value is one of its
 *  choices and not c's own, in A.1's order. */
export function keptRules(given: Readonly<Record<string, unknown>>, c: Config = config): MatchRules {
  const out: Record<string, number> = {};
  for (const k of RULE_SETTINGS) {
    const v = given[k];
    if (typeof v !== 'number' || Object.is(v, c[k])) continue;
    if ((c.matchRules[k] as readonly number[]).some((x) => Object.is(x, v))) out[k] = v;
  }
  return Object.keys(out).length === 0 ? NO_RULES : Object.freeze(out);
}

export class RulesStore implements RulesSource {
  /** null: no storage, or storage whose read failed, which is never written over. */
  private readonly kv: KeyValue | null;
  private value: MatchRules;
  private keptNow: boolean;

  constructor(kv: KeyValue | null = browserStorage()) {
    let raw: string | null = null;
    let read = kv !== null;
    try {
      raw = kv === null ? null : kv.getItem(RULES_KEY);
    } catch {
      read = false;
    }
    this.kv = read ? kv : null;
    this.value = parseRules(raw);
    this.keptNow = read;
  }

  /** The browser keeps the rules in force: false without storage or with its read failing, and from a
   *  failed write until a later one succeeds (PLAN §10). */
  get persistent(): boolean {
    return this.keptNow;
  }

  get(): MatchRules {
    return this.value;
  }

  /** The rules, each one of its choices, those at the build's settings dropped (keptRules), stored by one
   *  write of the whole record; one that changes nothing writes nothing. */
  set(rules: MatchRules): void {
    const next = keptRules(rules as Readonly<Record<string, unknown>>);
    if (sameRules(next, this.value)) return;
    this.value = next;
    const record: StoredRules = { v: 1, rules: next };
    this.keptNow = tryWrite(this.kv, RULES_KEY, JSON.stringify(record));
  }
}
