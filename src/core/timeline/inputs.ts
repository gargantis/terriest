// The inputs known for each tick, by sender (PLAN D-11, D-12, P4; M3's
// design, research/m3/DESIGN.md, §1.3, §2.2, §2.5, §2.12, §4.10, §5.6):
// each sender's record of its input and roster events, the ticks a sender
// said it has no input for, and the newest-tick input each sender has sent,
// which prediction repeats (D-11).
// roslambo's slots, slotTick and lastButtons (src/core/timeline/timeline.ts),
// changed:
// - a record carries D-12's payloads, and only under their events' bits;
// - one sender's copies of a tick merge order-free, where roslambo's last
//   writer won: events OR-ed, of two JOIN or two SWITCH payloads the one
//   that sorts first (§5.6), and of two inputs the smaller (§0);
// - newest keeps its tick, so a history fill of an older tick never moves it;
// - the marks (§2.2), and records made by events alone (§2.5), which have no
//   form on the wire: a STATE leaves them out after its sender's final tick,
//   where receivedInput is undefined, since a receiver would take their
//   input 0 as sent and the smaller input would win (§3.4);
// - this browser's own records replace whatever is stored, and only a STATE
//   changes them after; one it keeps stays own (§4.10);
// - a ring that never evicts a needed tick, where roslambo's slot() cleared
//   any slot holding another tick (§2.12).

import { JOIN, SWITCH } from '../sim';

/** One sender's input for one tick with its events: TickInput without the ID. Structurally
 *  messages.ts's EventPayload with the input, declared here so this file needs nothing from it. */
export interface Recorded {
  input: number;
  events: number;
  joinPack?: number;
  coat?: number;
  name?: string;
  switchPack?: number;
}

/** 'merged': a record that existed changed, or was completed (§2.7 reads it). */
export type PutResult = 'new' | 'merged' | 'same' | 'refused';

type Payload = Omit<Recorded, 'input'>;

const EMPTY = -1; // not a setting: a slot that holds no tick, and no tick retired

interface Slot {
  tick: number;
  readonly records: Map<string, Recorded>;
  /** The senders whose record events alone made: input 0 until an input completes it (§2.5). */
  readonly partial: Set<string>;
  /** This browser's own senders, itself and its bots (§4.10). */
  readonly owned: Set<string>;
  /** The senders that said they have no input here and have no record (§2.2). */
  readonly marks: Set<string>;
}

/** A tick, as the wire's u32 and the timeline's counters hold one. */
const isTick = (t: number): boolean => Number.isSafeInteger(t) && t >= 0;

const negativeZero = (v: number): boolean => v === 0 && 1 / v < 0;

/** sim/input.ts's order on an optional number: absent first, then ascending, −0 before +0, NaN
 *  last, so two copies compare equal only when nothing tells them apart. */
function compareNumbers(a: number | undefined, b: number | undefined): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1;
  if (a < b) return -1;
  if (a > b) return 1;
  if (a === b) return negativeZero(a) === negativeZero(b) ? 0 : negativeZero(a) ? -1 : 1;
  return a === a ? -1 : b === b ? 1 : 0; // NaN last
}

/** Absent first, then by UTF-16 code units: `<`, never localeCompare (D-38). */
function compareStrings(a: string | undefined, b: string | undefined): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** JOIN's payload by (pack, coat, name), as §5.6 and M3-Q11 order it. */
const compareJoin = (a: Payload, b: Payload): number =>
  compareNumbers(a.joinPack, b.joinPack) || compareNumbers(a.coat, b.coat) || compareStrings(a.name, b.name);
const compareSwitch = (a: Payload, b: Payload): number => compareNumbers(a.switchPack, b.switchPack);

/** Field by field, in TickInput's order. */
const compareRecords = (a: Readonly<Recorded>, b: Readonly<Recorded>): number =>
  compareNumbers(a.input, b.input) || compareNumbers(a.events, b.events) || compareJoin(a, b) || compareSwitch(a, b);

const smaller = (a: number, b: number): number => (compareNumbers(b, a) < 0 ? b : a);

/** A record of the store's own: each payload copied from its source, so a stray field (a
 *  TickEvent's back, a pack without its event) never reaches a comparison or the simulation. */
function make(input: number, events: number, join: Payload | null, sw: Payload | null): Recorded {
  const r: Recorded = { input, events };
  if (join) {
    if (join.joinPack !== undefined) r.joinPack = join.joinPack;
    if (join.coat !== undefined) r.coat = join.coat;
    if (join.name !== undefined) r.name = join.name;
  }
  if (sw && sw.switchPack !== undefined) r.switchPack = sw.switchPack;
  return r;
}

const has = (e: Payload, bit: number): boolean => (e.events & bit) !== 0;

const fresh = (input: number, e: Payload): Recorded => make(input, e.events, has(e, JOIN) ? e : null, has(e, SWITCH) ? e : null);

/** Whose payload a merge keeps for an event: the copy that has it, or of two, the one that
 *  sorts first, a on a tie (§5.6). */
function pick(a: Payload, e: Payload, bit: number, compare: (x: Payload, y: Payload) => number): Payload | null {
  if (has(e, bit) && (!has(a, bit) || compare(e, a) < 0)) return e;
  return has(a, bit) ? a : null;
}

/** Whether a merge keeps a's payload: none was picked, or the one picked equals a's. */
const keeps = (a: Payload, p: Payload | null, compare: (x: Payload, y: Payload) => number): boolean => p === null || compare(p, a) === 0;

/** a with e's events and payloads merged in and the given input; null if nothing changes, found
 *  without making a record, since most writes are copies of what's held. */
function merge(a: Readonly<Recorded>, input: number, e: Payload): Recorded | null {
  const events = a.events | e.events;
  const join = pick(a, e, JOIN, compareJoin);
  const sw = pick(a, e, SWITCH, compareSwitch);
  const same = compareNumbers(input, a.input) === 0 && compareNumbers(events, a.events) === 0;
  if (same && keeps(a, join, compareJoin) && keeps(a, sw, compareSwitch)) return null;
  return make(input, events, join, sw);
}

export class InputStore {
  private readonly span: number;
  private readonly slots: Slot[];
  private readonly newestOf = new Map<string, { readonly tick: number; readonly input: number }>();
  /** Ticks at or before it are no longer needed (§2.12). */
  private retired = EMPTY;

  /** span: ticks kept, a power of two (netSettings' inputSpan, 1024), past the window §2.12 bounds. */
  constructor(span: number) {
    if (!Number.isSafeInteger(span) || span < 1) throw new RangeError(`an input store spans a whole number of ticks, not ${span}`);
    this.span = span;
    this.slots = Array.from({ length: span }, (): Slot => ({ tick: EMPTY, records: new Map(), partial: new Set(), owned: new Set(), marks: new Set() }));
  }

  get(id: string, t: number): Readonly<Recorded> | undefined {
    return this.slotOf(t)?.records.get(id);
  }

  /** The input received for (id, t), bark bits and all: undefined with no record, or with one
   *  events alone made (§2.5), whose input 0 nobody sent (D-16's received inputs). */
  receivedInput(id: string, t: number): number | undefined {
    const s = this.slotOf(t);
    return s === undefined || s.partial.has(id) ? undefined : s.records.get(id)?.input;
  }

  /** No record, and the sender said it has none for t: a clear present bit in its TICK (§2.2). */
  isAbsent(id: string, t: number): boolean {
    return this.slotOf(t)?.marks.has(id) ?? false;
  }

  /** Tick t's records, or undefined; callers canonicalise. A live view: later writes show in it. */
  at(t: number): ReadonlyMap<string, Readonly<Recorded>> | undefined {
    const s = this.slotOf(t);
    return s !== undefined && s.records.size > 0 ? s.records : undefined;
  }

  /** A record, unless one exists: then its events are OR-ed in, and a JOIN or SWITCH payload that
   *  differs keeps the one that sorts first, field by field (§5.6), so the result never depends on
   *  arrival order; of two inputs the smaller stays, for the same reason. An input for a record that
   *  events alone made sets its input. own: this browser's or one of its bots', which replaces
   *  whatever is stored (§4.10), and which no write but its own changes after ('same').
   *  Clears a mark. Updates newest(id) when t is at or after its tick (D-11). */
  put(id: string, t: number, r: Recorded, own = false): PutResult {
    const s = this.claim(t);
    if (s === undefined) return 'refused';
    const had = s.records.get(id);
    if (had !== undefined && !own && s.owned.has(id)) return 'same';
    const partial = had !== undefined && s.partial.has(id);
    let next: Recorded | null;
    if (had === undefined || own) {
      next = fresh(r.input, r);
      if (had !== undefined && !partial && compareRecords(next, had) === 0) next = null;
    } else {
      next = merge(had, partial ? r.input : smaller(had.input, r.input), r);
    }
    if (next !== null) s.records.set(id, next);
    s.marks.delete(id);
    if (own) s.owned.add(id);
    const completed = s.partial.delete(id);
    this.raise(id, t, (next ?? had)!.input);
    return had === undefined ? 'new' : next !== null || completed ? 'merged' : 'same';
  }

  /** Events for (id, t): merged into its record, or a record of input 0 that events alone made, which a
   *  later put completes and which never moves newest (§2.5). No events record nothing ('same'). */
  putEvents(id: string, t: number, e: Omit<Recorded, 'input'>): PutResult {
    if (e.events === 0) return 'same';
    const s = this.claim(t);
    if (s === undefined) return 'refused';
    const had = s.records.get(id);
    if (had === undefined) {
      s.records.set(id, fresh(0, e));
      s.partial.add(id);
      s.marks.delete(id);
      return 'new';
    }
    if (s.owned.has(id)) return 'same';
    const next = merge(had, had.input, e);
    if (next === null) return 'same';
    s.records.set(id, next);
    return 'merged';
  }

  /** The sender has no input for t; ignored where a record exists. True if newly marked. */
  markAbsent(id: string, t: number): boolean {
    const s = this.claim(t);
    if (s === undefined || s.records.has(id) || s.marks.has(id)) return false;
    s.marks.add(id);
    return true;
  }

  /** Replaces tick t's records exactly, its marks cleared: a STATE's final ticks (D-11). Its records
   *  are complete, and move newest forward, never back. A sender that was own here and has a record
   *  in it stays own, so no later write but its own changes it (§4.10); one it leaves out is absent,
   *  and no longer own. False, with nothing changed, for a tick the store refuses (§2.12). */
  replace(t: number, records: readonly (Recorded & { readonly id: string })[]): boolean {
    const s = this.claim(t);
    if (s === undefined) return false;
    const own = records.filter((r) => s.owned.has(r.id)).map((r) => r.id);
    s.records.clear();
    s.partial.clear();
    s.owned.clear();
    s.marks.clear();
    for (const r of records) {
      const had = s.records.get(r.id);
      s.records.set(r.id, had === undefined ? fresh(r.input, r) : (merge(had, smaller(had.input, r.input), r) ?? had));
    }
    for (const id of own) s.owned.add(id);
    for (const [id, r] of s.records) this.raise(id, t, r.input);
    return true;
  }

  /** The input of the newest tick received from id, which prediction repeats (D-11). */
  newest(id: string): { readonly tick: number; readonly input: number } | undefined {
    return this.newestOf.get(id);
  }

  /** The first tick in (after, upTo] with neither a record nor a mark for id; upTo + 1 if none.
   *  It stops within span ticks: no more ticks than that hold anything. */
  firstUnknown(id: string, after: number, upTo: number): number {
    for (let u = after + 1; u <= upTo; u++) {
      const s = this.slotOf(u);
      if (s === undefined || (!s.records.has(id) && !s.marks.has(id))) return u;
    }
    return upTo + 1;
  }

  /** Ticks at or before t are no longer needed, so their slots may be reused. A write for a tick
   *  whose slot still holds a needed one is refused (§2.12). Never moves back. */
  retire(t: number): void {
    if (t > this.retired) this.retired = t;
  }

  clear(): void {
    for (const s of this.slots) {
      s.tick = EMPTY;
      s.records.clear();
      s.partial.clear();
      s.owned.clear();
      s.marks.clear();
    }
    this.newestOf.clear();
    this.retired = EMPTY;
  }

  /** t's slot, if it holds t and t is still needed. */
  private slotOf(t: number): Slot | undefined {
    if (!isTick(t) || t <= this.retired) return undefined;
    const s = this.slots[t % this.span]!;
    return s.tick === t ? s : undefined;
  }

  /** t's slot for a write: its own, or a free one, which holds no tick or a retired one. None for a
   *  retired tick, or where the slot holds another needed tick, which it never evicts (§2.12): the
   *  timeline's windows keep every write within span ticks of the others, so that never happens to
   *  a write it makes. */
  private claim(t: number): Slot | undefined {
    if (!isTick(t) || t <= this.retired) return undefined;
    const s = this.slots[t % this.span]!;
    if (s.tick === t) return s;
    if (s.tick > this.retired) return undefined;
    s.tick = t;
    s.records.clear();
    s.partial.clear();
    s.owned.clear();
    s.marks.clear();
    return s;
  }

  /** newest(id) after a complete record at t with this input (D-11). */
  private raise(id: string, t: number, input: number): void {
    const n = this.newestOf.get(id);
    if (n === undefined || t > n.tick || (t === n.tick && compareNumbers(input, n.input) !== 0)) this.newestOf.set(id, { tick: t, input });
  }
}
