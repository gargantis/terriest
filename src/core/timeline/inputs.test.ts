import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { JOIN, LEAVE, READY, SWITCH, UNREADY } from '../sim';
import { InputStore, type PutResult, type Recorded } from './inputs';

// The input store (design §1.3, §2.2, §2.5, §2.12, §4.10, §5.6, §8.3): the
// merge under every arrival order, an event before its input included;
// marks never beating a record; newest unmoved by an older tick or by
// events alone; own records; and the ring's retirement, a write refused
// rather than evicting a needed tick.

const SPAN = 1024; // netSettings' inputSpan at A.4's values (design §2.12)
const id = (k: number): string => k.toString(16).padStart(32, '0');
const A = id(0xa);
const B = id(0xb);
const C = id(0xc);
const IDS = [A, B, C];

type Payload = Omit<Recorded, 'input'>;
const joinOf = (joinPack: number, coat: number, name: string): Payload => ({ events: JOIN, joinPack, coat, name });
const switchOf = (switchPack: number): Payload => ({ events: SWITCH, switchPack });

type Op =
  | { readonly kind: 'put'; readonly id: string; readonly t: number; readonly r: Recorded }
  | { readonly kind: 'events'; readonly id: string; readonly t: number; readonly e: Payload }
  | { readonly kind: 'mark'; readonly id: string; readonly t: number };

function apply(s: InputStore, op: Op): PutResult | boolean {
  if (op.kind === 'put') return s.put(op.id, op.t, op.r);
  if (op.kind === 'events') return s.putEvents(op.id, op.t, op.e);
  return s.markAbsent(op.id, op.t);
}

function filled(ops: readonly Op[], span = SPAN): InputStore {
  const s = new InputStore(span);
  for (const op of ops) apply(s, op);
  return s;
}

/** Everything the store says of these senders at these ticks. */
function dump(s: InputStore, ticks: readonly number[], ids: readonly string[] = IDS) {
  return {
    cells: ticks.flatMap((t) =>
      ids.map((i) => ({ t, id: i, record: s.get(i, t) ?? null, received: s.receivedInput(i, t) ?? null, absent: s.isAbsent(i, t) })),
    ),
    at: ticks.map((t) => {
      const m = s.at(t);
      return m === undefined ? null : [...m.keys()].sort();
    }),
    newest: ids.map((i) => s.newest(i) ?? null),
  };
}

// --- The merge rule, stated whole: what a set of writes leaves, whatever their order ---

const compareJoin = (a: Payload, b: Payload): number =>
  a.joinPack! - b.joinPack! || a.coat! - b.coat! || (a.name! < b.name! ? -1 : a.name! > b.name! ? 1 : 0);

/** What the writes for (i, t) leave: the smallest input, every event, and the payloads that sort first. */
function expectedCell(ops: readonly Op[], i: string, t: number) {
  const mine = ops.filter((o) => o.id === i && o.t === t);
  const puts = mine.flatMap((o) => (o.kind === 'put' ? [o.r] : []));
  const writes = mine.flatMap((o): Payload[] => (o.kind === 'put' ? [o.r] : o.kind === 'events' && o.e.events !== 0 ? [o.e] : []));
  if (writes.length === 0) return { t, id: i, record: null, received: null, absent: mine.some((o) => o.kind === 'mark') };
  const input = puts.length > 0 ? Math.min(...puts.map((r) => r.input)) : 0;
  const record: Recorded = { input, events: writes.reduce((a, p) => a | p.events, 0) };
  const join = writes.filter((p) => (p.events & JOIN) !== 0).sort(compareJoin)[0];
  if (join) Object.assign(record, { joinPack: join.joinPack, coat: join.coat, name: join.name });
  const sw = writes.filter((p) => (p.events & SWITCH) !== 0).sort((a, b) => a.switchPack! - b.switchPack!)[0];
  if (sw) record.switchPack = sw.switchPack!;
  return { t, id: i, record, received: puts.length > 0 ? input : null, absent: false };
}

function expectedDump(ops: readonly Op[], ticks: readonly number[], ids: readonly string[] = IDS) {
  const cells = ticks.flatMap((t) => ids.map((i) => expectedCell(ops, i, t)));
  return {
    cells,
    at: ticks.map((t) => {
      const present = cells.filter((c) => c.t === t && c.record !== null).map((c) => c.id);
      return present.length === 0 ? null : present.sort();
    }),
    newest: ids.map((i) => {
      const ticksPut = ops.flatMap((o) => (o.kind === 'put' && o.id === i ? [o.t] : []));
      if (ticksPut.length === 0) return null;
      const tick = Math.max(...ticksPut);
      return { tick, input: Math.min(...ops.flatMap((o) => (o.kind === 'put' && o.id === i && o.t === tick ? [o.r.input] : []))) };
    }),
  };
}

const TICKS = Array.from({ length: 10 }, (_, k) => k + 1);
const bits = fc.subarray([JOIN, LEAVE, READY, UNREADY, SWITCH]).map((b) => b.reduce((a, x) => a | x, 0));
/** Events as the wire carries them: each payload with its event (design §5.3). */
const payload: fc.Arbitrary<Payload> = fc
  .record({
    events: bits,
    joinPack: fc.constantFrom(0, 1, 7),
    coat: fc.integer({ min: 0, max: 3 }),
    name: fc.constantFrom('', 'Rex', '﻿Rex', 'Ace'),
    switchPack: fc.constantFrom(0, 1, 9),
  })
  .map(({ events, joinPack, coat, name, switchPack }) => ({
    events,
    ...((events & JOIN) !== 0 ? { joinPack, coat, name } : {}),
    ...((events & SWITCH) !== 0 ? { switchPack } : {}),
  }));
// Inputs that differ, and differ only in the bark bits or bit 15 (0x2000, 0x8000).
const input = fc.constantFrom(0, 1, 0x20, 0x1fff, 0x2001, 0x8001, 0xffff);
const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('put' as const), id: fc.constantFrom(...IDS), t: fc.constantFrom(...TICKS), r: fc.tuple(input, payload).map(([x, p]) => ({ ...p, input: x })) }),
  // Most of a TICK's writes are inputs alone: its own and its history's.
  fc.record({ kind: fc.constant('put' as const), id: fc.constantFrom(...IDS), t: fc.constantFrom(...TICKS), r: input.map((x) => ({ input: x, events: 0 })) }),
  fc.record({ kind: fc.constant('events' as const), id: fc.constantFrom(...IDS), t: fc.constantFrom(...TICKS), e: payload }),
  fc.record({ kind: fc.constant('mark' as const), id: fc.constantFrom(...IDS), t: fc.constantFrom(...TICKS) }),
);
/** Writes, and the same writes in another order, some repeated, as copies arrive again in later TICKs. */
const reordered = fc.array(fc.tuple(op, fc.nat(), fc.boolean()), { maxLength: 40 }).map((rows) => ({
  list: rows.map(([o]) => o),
  other: [...rows].sort((a, b) => a[1] - b[1]).flatMap(([o, , twice]) => (twice ? [o, o] : [o])),
}));

function* permutations<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let k = 0; k < items.length; k++) {
    const rest = [...items.slice(0, k), ...items.slice(k + 1)];
    for (const p of permutations(rest)) yield [items[k]!, ...p];
  }
}

describe('the input store: one sender’s copies of a tick merge order-free (design §1.3, §5.6, M3-Q11)', () => {
  it('leaves the same records, marks and newest inputs whatever order the writes arrive in', () => {
    fc.assert(
      fc.property(reordered, ({ list, other }) => {
        const want = expectedDump(list, TICKS);
        expect(dump(filled(list), TICKS)).toStrictEqual(want);
        expect(dump(filled(other), TICKS)).toStrictEqual(want);
      }),
      { numRuns: 300 },
    );
  });

  it('says what each write did: new, merged or same, and a mark only where nothing was', () => {
    fc.assert(
      fc.property(reordered, ({ list }) => {
        const s = new InputStore(SPAN);
        for (const o of list) {
          const before = { record: s.get(o.id, o.t), received: s.receivedInput(o.id, o.t), absent: s.isAbsent(o.id, o.t) };
          const result = apply(s, o);
          const after = { record: s.get(o.id, o.t), received: s.receivedInput(o.id, o.t), absent: s.isAbsent(o.id, o.t) };
          if (o.kind === 'mark') {
            expect(result).toBe(before.record === undefined && !before.absent);
            expect(after.absent).toBe(before.record === undefined);
          } else if (o.kind === 'events' && o.e.events === 0) {
            expect([result, after]).toStrictEqual(['same', before]);
          } else {
            const unchanged = before.record !== undefined && JSON.stringify(after) === JSON.stringify(before);
            expect(result).toBe(before.record === undefined ? 'new' : unchanged ? 'same' : 'merged');
            expect(after.absent).toBe(false);
          }
        }
      }),
    );
  });

  it('agrees in every order of an input, its history copy, its events and a mark', () => {
    // A TICK's own input for 7, a later TICK's history copy of it, its JOIN riding
    // further back than the history, a conflicting JOIN from another path, a
    // READY, and a mark from a TICK that said it had none.
    const writes: Op[] = [
      { kind: 'events', id: A, t: 7, e: joinOf(1, 2, 'Rex') },
      { kind: 'put', id: A, t: 7, r: { input: 0x25, events: 0 } },
      { kind: 'put', id: A, t: 7, r: { input: 0x25, events: 0 } },
      { kind: 'events', id: A, t: 7, e: { ...joinOf(0, 3, 'Ace'), events: JOIN | READY } },
      { kind: 'mark', id: A, t: 7 },
      { kind: 'events', id: A, t: 7, e: switchOf(1) },
    ];
    const want = { input: 0x25, events: JOIN | READY | SWITCH, joinPack: 0, coat: 3, name: 'Ace', switchPack: 1 };
    let orders = 0;
    for (const order of permutations(writes)) {
      const s = filled(order);
      expect(s.get(A, 7)).toStrictEqual(want);
      expect([s.receivedInput(A, 7), s.isAbsent(A, 7), s.newest(A)]).toStrictEqual([0x25, false, { tick: 7, input: 0x25 }]);
      orders++;
    }
    expect(orders).toBe(720);
  });

  it('keeps the JOIN that sorts first by pack, then coat, then name, and the smaller SWITCH pack', () => {
    const merged = (...es: Payload[]): Readonly<Recorded> | undefined => {
      const forward = filled(es.map((e): Op => ({ kind: 'events', id: B, t: 3, e })));
      const back = filled([...es].reverse().map((e): Op => ({ kind: 'events', id: B, t: 3, e })));
      expect(back.get(B, 3)).toStrictEqual(forward.get(B, 3));
      return forward.get(B, 3);
    };
    expect(merged(joinOf(1, 0, 'Ace'), joinOf(0, 5, 'Rex'))).toMatchObject({ joinPack: 0, coat: 5, name: 'Rex' });
    expect(merged(joinOf(0, 3, 'Ace'), joinOf(0, 2, 'Rex'))).toMatchObject({ joinPack: 0, coat: 2, name: 'Rex' });
    expect(merged(joinOf(0, 2, 'Rex'), joinOf(0, 2, 'Ace'))).toMatchObject({ name: 'Ace' });
    // By code units: U+FEFF sorts after 'R', so a name that starts with one sorts after "Rex".
    expect(merged(joinOf(0, 2, '﻿Rex'), joinOf(0, 2, 'Rex'))).toMatchObject({ name: 'Rex' });
    expect(merged(switchOf(1), switchOf(0))).toStrictEqual({ input: 0, events: SWITCH, switchPack: 0 });
    // A JOIN and a SWITCH keep their own packs (D-12), merged or not.
    expect(merged(joinOf(1, 0, ''), switchOf(0))).toStrictEqual({ input: 0, events: JOIN | SWITCH, joinPack: 1, coat: 0, name: '', switchPack: 0 });
  });

  it('keeps the smaller of two inputs for one record, so a forgery that slipped in decides nothing by arriving first', () => {
    for (const order of [
      [5, 9],
      [9, 5],
    ]) {
      const s = new InputStore(SPAN);
      expect(order.map((x) => s.put(C, 4, { input: x, events: 0 }))).toEqual(['new', order[0] === 9 ? 'merged' : 'same']);
      expect([s.get(C, 4)?.input, s.newest(C)]).toStrictEqual([5, { tick: 4, input: 5 }]);
    }
  });

  it('keeps a payload only with its event, and no field it doesn’t know', () => {
    const s = new InputStore(SPAN);
    s.put(A, 2, { input: 1, events: READY, joinPack: 1, coat: 2, name: 'Rex', switchPack: 0 });
    expect(s.get(A, 2)).toStrictEqual({ input: 1, events: READY });
    // A TickEvent's back rides along with its payload, and stays out.
    const event = { back: 9, events: JOIN, joinPack: 0, coat: 1, name: 'Ace' };
    s.putEvents(B, 2, event);
    expect(s.get(B, 2)).toStrictEqual({ input: 0, events: JOIN, joinPack: 0, coat: 1, name: 'Ace' });
    s.put(C, 2, { input: 3, events: SWITCH, switchPack: 1 }, true);
    expect(s.get(C, 2)).toStrictEqual({ input: 3, events: SWITCH, switchPack: 1 });
    // A record it holds, written back, is a copy of what it holds.
    s.put(A, 3, { input: 4, events: JOIN | SWITCH, joinPack: 1, coat: 0, name: 'Rex', switchPack: 0 });
    const held = s.get(A, 3)!;
    expect([s.put(A, 3, held), s.putEvents(A, 3, held), s.put(C, 2, s.get(C, 2)!, true)]).toEqual(['same', 'same', 'same']);
    expect(s.get(A, 3)).toBe(held);
  });
});

describe('records made by events alone (design §2.5)', () => {
  it('makes a record of input 0 for an event before its input, which the input completes', () => {
    for (const eventFirst of [true, false]) {
      const s = new InputStore(SPAN);
      const results: PutResult[] = [];
      const event = (): PutResult => s.putEvents(A, 30, { events: READY });
      const own = (): PutResult => s.put(A, 30, { input: 0x123, events: 0 });
      if (eventFirst) {
        results.push(event());
        // Known, so not predicted from newest; final with input 0 if nothing completes it.
        expect([s.get(A, 30), s.receivedInput(A, 30), s.newest(A), s.firstUnknown(A, 29, 30)]).toStrictEqual([
          { input: 0, events: READY },
          undefined,
          undefined,
          31,
        ]);
        expect([...s.at(30)!.keys()]).toEqual([A]);
        results.push(own());
      } else {
        results.push(own(), event());
      }
      expect(results).toEqual(['new', 'merged']);
      expect([s.get(A, 30), s.receivedInput(A, 30), s.newest(A)]).toStrictEqual([{ input: 0x123, events: READY }, 0x123, { tick: 30, input: 0x123 }]);
    }
  });

  it('is completed even by an input of 0, which only then counts as received and moves newest', () => {
    const s = new InputStore(SPAN);
    s.put(A, 10, { input: 7, events: 0 });
    s.putEvents(A, 12, { events: JOIN, joinPack: 0, coat: 0, name: '' });
    expect(s.newest(A)).toStrictEqual({ tick: 10, input: 7 });
    expect(s.put(A, 12, { input: 0, events: 0 })).toBe('merged');
    expect([s.receivedInput(A, 12), s.newest(A)]).toStrictEqual([0, { tick: 12, input: 0 }]);
    // Once complete, the same input again changes nothing.
    expect(s.put(A, 12, { input: 0, events: 0 })).toBe('same');
  });

  it('records nothing for an empty event, and merges a new event into a known record', () => {
    const s = new InputStore(SPAN);
    expect(s.putEvents(A, 5, { events: 0 })).toBe('same');
    expect([s.get(A, 5), s.at(5)]).toEqual([undefined, undefined]);
    s.put(A, 5, { input: 2, events: 0 });
    expect(s.putEvents(A, 5, { events: UNREADY })).toBe('merged');
    expect(s.putEvents(A, 5, { events: UNREADY })).toBe('same');
    expect(s.get(A, 5)).toStrictEqual({ input: 2, events: UNREADY });
  });
});

describe('marks: the ticks a sender said it has no input for (design §2.2)', () => {
  it('marks a tick once, and never one with a record', () => {
    const s = new InputStore(SPAN);
    expect([s.markAbsent(A, 8), s.markAbsent(A, 8), s.isAbsent(A, 8), s.isAbsent(B, 8)]).toEqual([true, false, true, false]);
    // A mark is no record: the tick has no inputs, and the sender isn't in them.
    expect([s.get(A, 8), s.at(8), s.receivedInput(A, 8)]).toEqual([undefined, undefined, undefined]);
    s.put(B, 8, { input: 1, events: 0 });
    expect([s.markAbsent(B, 8), s.isAbsent(B, 8)]).toEqual([false, false]);
  });

  it('gives way to a record in either order, which then makes the final input', () => {
    for (const markFirst of [true, false]) {
      const s = new InputStore(SPAN);
      const mark = (): boolean => s.markAbsent(C, 14);
      const put = (): PutResult => s.put(C, 14, { input: 4, events: 0 });
      const putEvents = (): PutResult => s.putEvents(C, 15, { events: READY });
      const markEvents = (): boolean => s.markAbsent(C, 15);
      if (markFirst) {
        expect([mark(), put(), markEvents(), putEvents()]).toEqual([true, 'new', true, 'new']);
      } else {
        expect([put(), mark(), putEvents(), markEvents()]).toEqual(['new', false, 'new', false]);
      }
      expect([s.isAbsent(C, 14), s.get(C, 14), s.isAbsent(C, 15), s.get(C, 15)]).toStrictEqual([
        false,
        { input: 4, events: 0 },
        false,
        { input: 0, events: READY },
      ]);
    }
  });

  it('counts a mark and a record as known to firstUnknown, which finds the gaps between them', () => {
    const s = new InputStore(SPAN);
    s.put(A, 101, { input: 1, events: 0 });
    s.markAbsent(A, 102);
    s.putEvents(A, 103, { events: READY });
    s.put(A, 105, { input: 1, events: 0 });
    s.markAbsent(B, 101);
    expect([s.firstUnknown(A, 100, 110), s.firstUnknown(A, 100, 103), s.firstUnknown(A, 104, 105), s.firstUnknown(B, 100, 101)]).toEqual([104, 104, 106, 102]);
    expect([s.firstUnknown(C, 100, 110), s.firstUnknown(A, 100, 100), s.firstUnknown(A, 103, 101)]).toEqual([101, 101, 102]);
  });

  it('finds the first unknown tick as a scan of every tick would', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 30 }), fc.constantFrom(...IDS), fc.integer({ min: -1, max: 11 }), fc.integer({ min: -1, max: 12 }), (ops, i, after, upTo) => {
        const s = filled(ops);
        let want = upTo + 1;
        for (let u = after + 1; u <= upTo; u++) {
          if (s.get(i, u) === undefined && !s.isAbsent(i, u)) {
            want = u;
            break;
          }
        }
        expect(s.firstUnknown(i, after, upTo)).toBe(want);
      }),
    );
  });
});

describe('newest: the input prediction repeats (D-11)', () => {
  it('moves only to a tick at or after its own, so a lost TICK filled from a later history leaves it at the newer input', () => {
    const s = new InputStore(SPAN);
    // TICK for 20, with its history.
    s.put(A, 20, { input: 0x220, events: 0 });
    for (let k = 0; k < 16; k++) s.put(A, 19 - k, { input: 0x200 + 19 - k, events: 0 });
    expect(s.newest(A)).toStrictEqual({ tick: 20, input: 0x220 });
    // TICK for 21 lost; TICK for 22 arrives, its own input first, then its history fills 21.
    s.put(A, 22, { input: 0x622, events: 0 });
    s.put(A, 21, { input: 0x421, events: 0 });
    expect(s.newest(A)).toStrictEqual({ tick: 22, input: 0x622 });
    // Events alone, at a later tick, don't move it either.
    s.putEvents(A, 23, { events: READY });
    expect(s.newest(A)).toStrictEqual({ tick: 22, input: 0x622 });
  });

  it('follows the record at its tick, and keeps a sender whose records are gone', () => {
    const s = new InputStore(8);
    s.put(B, 3, { input: 9, events: 0 });
    s.put(B, 3, { input: 4, events: 0 });
    expect(s.newest(B)).toStrictEqual({ tick: 3, input: 4 });
    s.retire(5);
    expect([s.get(B, 3), s.newest(B)]).toStrictEqual([undefined, { tick: 3, input: 4 }]);
    expect(s.newest(C)).toBeUndefined();
  });
});

describe('own records: this browser’s and its bots’ (design §4.10)', () => {
  it('replace whatever is stored, and nothing but their own writes and a STATE changes them', () => {
    const s = new InputStore(SPAN);
    // A forgery slipped in first: its input, its events and a payload.
    s.put(A, 40, { input: 0x1, events: JOIN | READY, joinPack: 1, coat: 7, name: 'Fake' });
    s.putEvents(A, 41, { events: LEAVE });
    s.markAbsent(A, 42);
    expect(s.put(A, 40, { input: 0x30, events: 0 }, true)).toBe('merged');
    expect(s.put(A, 41, { input: 0x31, events: READY }, true)).toBe('merged');
    expect(s.put(A, 42, { input: 0x32, events: 0 }, true)).toBe('new');
    expect([40, 41, 42].map((t) => s.get(A, t))).toStrictEqual([
      { input: 0x30, events: 0 },
      { input: 0x31, events: READY },
      { input: 0x32, events: 0 },
    ]);
    expect([s.receivedInput(A, 41), s.isAbsent(A, 42), s.newest(A)]).toStrictEqual([0x31, false, { tick: 42, input: 0x32 }]);
    // And one that slips in after: ignored.
    expect([
      s.put(A, 40, { input: 0, events: LEAVE }),
      s.putEvents(A, 40, joinOf(0, 0, 'Fake')),
      s.markAbsent(A, 40),
      s.put(A, 40, { input: 0x30, events: 0 }, true),
    ]).toEqual(['same', 'same', false, 'same']);
    expect(s.get(A, 40)).toStrictEqual({ input: 0x30, events: 0 });
    // Its own write again replaces it.
    expect(s.put(A, 40, { input: 0x33, events: 0 }, true)).toBe('merged');
    expect(s.get(A, 40)).toStrictEqual({ input: 0x33, events: 0 });
  });

  it('are kept whichever arrives first, an own record or another write for it', () => {
    const own: Recorded = { input: 0x7, events: READY };
    const forged: Op[] = [
      { kind: 'put', id: B, t: 9, r: { input: 0, events: LEAVE } },
      { kind: 'events', id: B, t: 9, e: switchOf(0) },
      { kind: 'mark', id: B, t: 9 },
    ];
    for (const order of permutations([...forged, null])) {
      const s = new InputStore(SPAN);
      for (const o of order) if (o === null) s.put(B, 9, own, true);
      else apply(s, o);
      expect(s.get(B, 9)).toStrictEqual(own);
    }
  });
});

describe('replace: a STATE’s final ticks (D-11, design §3.4)', () => {
  it('replaces a tick’s records exactly, its marks, partial and own records with them', () => {
    const s = new InputStore(SPAN);
    s.put(A, 50, { input: 1, events: 0 }, true);
    s.putEvents(B, 50, { events: READY });
    s.markAbsent(C, 50);
    expect(s.replace(50, [{ id: B, input: 6, events: JOIN, joinPack: 1, coat: 2, name: 'Rex' }])).toBe(true);
    expect(dump(s, [50])).toStrictEqual({
      cells: [
        { t: 50, id: A, record: null, received: null, absent: false },
        { t: 50, id: B, record: { input: 6, events: JOIN, joinPack: 1, coat: 2, name: 'Rex' }, received: 6, absent: false },
        { t: 50, id: C, record: null, received: null, absent: false },
      ],
      at: [[B]],
      newest: [{ tick: 50, input: 1 }, { tick: 50, input: 6 }, null],
    });
    // B was never own: another write merges into it.
    expect(s.put(B, 50, { input: 2, events: 0 })).toBe('merged');
    expect(s.replace(50, [])).toBe(true);
    expect(s.at(50)).toBeUndefined();
  });

  it('keeps an own sender own where the STATE keeps its record, so no other write lowers it (§4.10)', () => {
    const s = new InputStore(SPAN);
    s.put(A, 50, { input: 0x30, events: 0 }, true);
    expect([s.put(A, 50, { input: 0x01, events: 0 }), s.get(A, 50)]).toStrictEqual(['same', { input: 0x30, events: 0 }]);
    s.replace(50, [{ id: A, input: 0x30, events: 0 }, { id: B, input: 0x40, events: 0 }]);
    expect([s.put(A, 50, { input: 0x01, events: 0 }), s.putEvents(A, 50, { events: LEAVE }), s.get(A, 50)])
      .toStrictEqual(['same', 'same', { input: 0x30, events: 0 }]);
    // Its own writes still replace it; B, never own, merges by the smaller input.
    expect([s.put(A, 50, { input: 0x31, events: 0 }, true), s.get(A, 50)]).toStrictEqual(['merged', { input: 0x31, events: 0 }]);
    expect([s.put(B, 50, { input: 0x02, events: 0 }), s.get(B, 50)]).toStrictEqual(['merged', { input: 0x02, events: 0 }]);
    // A STATE that finalised it absent leaves no record, and nothing own:
    // events then an input make and complete a record as anyone's do.
    s.replace(50, []);
    expect([s.putEvents(A, 50, { events: READY }), s.put(A, 50, { input: 0x01, events: 0 }), s.get(A, 50)])
      .toStrictEqual(['new', 'merged', { input: 0x01, events: READY }]);
  });

  it('moves newest forward only, and merges a repeated ID order-free', () => {
    const s = new InputStore(SPAN);
    s.put(A, 60, { input: 3, events: 0 });
    s.replace(58, [{ id: A, input: 9, events: 0 }]);
    expect(s.newest(A)).toStrictEqual({ tick: 60, input: 3 });
    s.replace(61, [{ id: A, input: 4, events: 0 }]);
    expect(s.newest(A)).toStrictEqual({ tick: 61, input: 4 });
    const twice = [
      { id: B, input: 8, events: READY },
      { id: B, input: 5, events: JOIN, joinPack: 0, coat: 1, name: 'Ace' },
    ];
    s.replace(62, twice);
    const once = s.get(B, 62);
    s.replace(62, [...twice].reverse());
    expect([s.get(B, 62), once]).toStrictEqual([
      { input: 5, events: READY | JOIN, joinPack: 0, coat: 1, name: 'Ace' },
      { input: 5, events: READY | JOIN, joinPack: 0, coat: 1, name: 'Ace' },
    ]);
  });
});

describe('the ring: a slot is reused only once its tick is retired (design §2.12)', () => {
  it('refuses a write rather than evict a needed tick, and reuses the slot once that tick retires', () => {
    const s = new InputStore(8);
    s.put(A, 3, { input: 1, events: 0 });
    s.markAbsent(B, 3);
    expect([s.put(A, 11, { input: 2, events: 0 }), s.putEvents(A, 11, { events: READY }), s.markAbsent(A, 11), s.replace(11, [])]).toEqual([
      'refused',
      'refused',
      false,
      false,
    ]);
    expect([s.get(A, 3), s.isAbsent(B, 3), s.get(A, 11), s.firstUnknown(A, 10, 12)]).toStrictEqual([{ input: 1, events: 0 }, true, undefined, 11]);
    s.retire(3);
    // Retired: gone from every read, and refused as a write.
    expect([s.get(A, 3), s.isAbsent(B, 3), s.at(3), s.put(A, 3, { input: 1, events: 0 }), s.markAbsent(A, 2)]).toEqual([
      undefined,
      false,
      undefined,
      'refused',
      false,
    ]);
    expect(s.put(A, 11, { input: 2, events: 0 })).toBe('new');
    expect(s.get(A, 11)).toStrictEqual({ input: 2, events: 0 });
    expect(s.isAbsent(B, 11)).toBe(false); // the slot came back empty
  });

  it('keeps whichever needed tick took a slot first, a later one too: the timeline keeps its writes within the span', () => {
    const s = new InputStore(8);
    expect(s.put(A, 13, { input: 1, events: 0 })).toBe('new');
    expect(s.put(A, 5, { input: 1, events: 0 })).toBe('refused');
    s.retire(12);
    expect(s.put(A, 5, { input: 1, events: 0 })).toBe('refused'); // retired itself
    expect(s.get(A, 13)).toStrictEqual({ input: 1, events: 0 });
  });

  it('never moves the retired tick back', () => {
    const s = new InputStore(8);
    s.retire(20);
    s.retire(10);
    expect([s.put(A, 15, { input: 0, events: 0 }), s.put(A, 21, { input: 0, events: 0 })]).toEqual(['refused', 'new']);
    s.retire(Number.NaN);
    expect(s.get(A, 21)).toBeDefined();
  });

  it('holds every write it took until its tick retires, and refuses only a retired tick or a slot a needed tick holds', () => {
    const span = 8;
    type RingOp = Op | { readonly kind: 'retire'; readonly t: number } | { readonly kind: 'replace'; readonly t: number; readonly ids: readonly string[] };
    const tick = fc.integer({ min: 0, max: 40 });
    const ringOp: fc.Arbitrary<RingOp> = fc.oneof(
      { weight: 3, arbitrary: fc.record({ kind: fc.constant('put' as const), id: fc.constantFrom(...IDS), t: tick, r: fc.constant({ input: 1, events: 0 }) }) },
      { weight: 2, arbitrary: fc.record({ kind: fc.constant('events' as const), id: fc.constantFrom(...IDS), t: tick, e: fc.constant({ events: READY }) }) },
      { weight: 2, arbitrary: fc.record({ kind: fc.constant('mark' as const), id: fc.constantFrom(...IDS), t: tick }) },
      { weight: 1, arbitrary: fc.record({ kind: fc.constant('replace' as const), t: tick, ids: fc.subarray(IDS) }) },
      { weight: 1, arbitrary: fc.record({ kind: fc.constant('retire' as const), t: fc.integer({ min: -1, max: 40 }) }) },
    );
    fc.assert(
      fc.property(fc.array(ringOp, { maxLength: 80 }), (ops) => {
        const s = new InputStore(span);
        // What disagrees with the model, asserted once: an expect a cell would take seconds.
        const wrong: string[] = [];
        const check = (what: string, got: unknown, want: unknown): void => {
          if (got !== want) wrong.push(`${what}: ${String(got)}, not ${String(want)}`);
        };
        // The model: the tick each slot holds, and what each held tick has.
        let retired = -1;
        const held = new Map<number, number>();
        const records = new Set<string>();
        const marks = new Set<string>();
        const key = (t: number, i: string): string => `${t} ${i}`;
        const take = (t: number): boolean => {
          if (t <= retired) return false;
          const h = held.get(t % span);
          if (h !== undefined && h !== t && h > retired) return false;
          if (h !== t) {
            for (const i of IDS) {
              records.delete(key(h ?? -1, i));
              marks.delete(key(h ?? -1, i));
            }
            held.set(t % span, t);
          }
          return true;
        };
        ops.forEach((o, n) => {
          if (o.kind === 'retire') {
            s.retire(o.t);
            retired = Math.max(retired, o.t);
          } else if (o.kind === 'replace') {
            const ok = take(o.t);
            check(`op ${n} replace`, s.replace(o.t, o.ids.map((i) => ({ id: i, input: 1, events: 0 }))), ok);
            if (ok) {
              for (const i of IDS) {
                marks.delete(key(o.t, i));
                if (o.ids.includes(i)) records.add(key(o.t, i));
                else records.delete(key(o.t, i));
              }
            }
          } else if (o.kind === 'mark') {
            const ok = take(o.t);
            const fresh = ok && !records.has(key(o.t, o.id)) && !marks.has(key(o.t, o.id));
            check(`op ${n} mark`, s.markAbsent(o.id, o.t), fresh);
            if (fresh) marks.add(key(o.t, o.id));
          } else {
            const ok = take(o.t);
            check(`op ${n} ${o.kind} refused`, apply(s, o) === 'refused', !ok);
            if (ok) {
              records.add(key(o.t, o.id));
              marks.delete(key(o.t, o.id));
            }
          }
          // Every read agrees with the model: nothing needed was ever evicted.
          for (let t = 0; t <= 40; t++) {
            const live = t > retired && held.get(t % span) === t;
            for (const i of IDS) {
              check(`after op ${n}, record ${t}`, s.get(i, t) !== undefined, live && records.has(key(t, i)));
              check(`after op ${n}, mark ${t}`, s.isAbsent(i, t), live && marks.has(key(t, i)));
            }
          }
        });
        expect(wrong.slice(0, 5)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('refuses ticks that are no ticks, and reads nothing at them', () => {
    const s = new InputStore(8);
    for (const t of [-1, 1.5, Number.NaN, Infinity, 2 ** 53]) {
      expect([s.put(A, t, { input: 1, events: 0 }), s.putEvents(A, t, { events: READY }), s.markAbsent(A, t), s.replace(t, [])]).toEqual([
        'refused',
        'refused',
        false,
        false,
      ]);
      expect([s.get(A, t), s.at(t), s.isAbsent(A, t), s.receivedInput(A, t)]).toEqual([undefined, undefined, false, undefined]);
    }
    expect(s.newest(A)).toBeUndefined();
    // A u32 tick is one, if it ever reached the store.
    expect(s.put(A, 0xfffffffe, { input: 1, events: 0 })).toBe('new');
    expect(() => new InputStore(0)).toThrow(RangeError);
    expect(() => new InputStore(2.5)).toThrow(RangeError);
  });

  it('clears to a store with nothing in it and nothing retired', () => {
    const s = new InputStore(8);
    s.put(A, 4, { input: 1, events: 0 }, true);
    s.markAbsent(B, 4);
    s.retire(3);
    s.clear();
    expect(dump(s, [0, 3, 4], [A, B])).toStrictEqual(expectedDump([], [0, 3, 4], [A, B]));
    expect(s.put(A, 0, { input: 2, events: 0 })).toBe('new');
    // And the own record is gone with it: another write merges.
    expect([s.put(A, 4, { input: 5, events: 0 }), s.put(A, 4, { input: 3, events: 0 })]).toEqual(['new', 'merged']);
  });
});
