import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { BOT_SLOTS } from '../bot/bot-id';
import { decodeState, encodeState as encodeMatchState } from '../sim/codec';
import { JOIN, LEAVE, READY, SWITCH, type TickInput, UNREADY } from '../sim/input';
import { everyone, join, newMatch, noisyInputs, tick as step } from '../sim/match-testing';
import { defaultParams } from '../sim/params';
import { IN_PLAY, type MatchState } from '../sim/state';
import { stateProblems } from '../sim/valid';
import { Writer } from './bytes';
import {
  type BotEntry, decode, encodeAgain, encodeFwd, encodeHello, encodePeers, encodeRefuse, encodeState, encodeStateReq, encodeTick,
  type EventPayload, type Hello, type InputRecord, type Message, NO_TICK, NO_TIMELINE, type Peers, ROLE, type SenderInput, type StateMsg, T,
  type Tick, type TickEvent, TIMELINE_KIND, wireLimits, wireString, ZERO_HASH,
} from './messages';

// The decoder's fuzz tests (D-20; design §5.6, §5.8): any bytes decode or
// are refused, never throwing; every valid encoding cut short or extended is
// refused; every byte of one changed decodes to something that re-encodes
// to the same message; random messages round-trip; a TICK's events are
// checked against its history and a STATE against its bounds and table;
// decoded TICKs step the simulation validly; and a message over the limit
// is refused unread.
vi.setConfig({ testTimeout: 120_000 });

const P = defaultParams;
const L = wireLimits();
const H = L.inputHistory;
/** STATE's largest senderTick − g (§5.5). */
const REACH = L.historyTicks + 2 * L.window + L.delay;

const id = (k: number): string => (k + 1).toString(16).padStart(32, '0');
const hash = 'a1b2c3d4e5f60718';

// --- Values ---

const anyU8 = fc.integer({ min: 0, max: 0xff });
const anyU16 = fc.integer({ min: 0, max: 0xffff });
const anyU32 = fc.oneof(fc.integer({ min: 0, max: 0xffffffff }), fc.constantFrom(0, 1, 0xfffffffe, NO_TICK));
const anyHex = (n: number): fc.Arbitrary<string> =>
  fc.uint8Array({ minLength: n, maxLength: n }).map((b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''));
const anyId = anyHex(16);
const anyHash = anyHex(8);
const anyPhase = anyU16.map((k) => k / 65536);
/** Names the wire carries: ones C-17 allows, ones it refuses, and U+FEFF first. */
const NAMES = [
  '', 'Rex', '\ufeffRex', '\ufeff', 'é'.repeat(16), '🐶'.repeat(8), 'x'.repeat(32), 'x'.repeat(21), 'tab\there', 'nul\u0000',
  'c1\u0085', '🐶 and 🐕\u200d🦺', 'Bot 1A2B',
];
const anyName = fc.oneof(
  fc.constantFrom(...NAMES),
  fc.string({ unit: 'binary', maxLength: 8 }), // at most 32 bytes, never a lone surrogate
  fc.string({ unit: 'binary', maxLength: 7 }).map((s) => `\ufeff${s}`),
).filter((s) => wireString(s) === s);

interface Payload { joinPack: number; coat: number; name: string; switchPack: number }
// Any byte, but often a pack and a coat that land, so the steps below join and switch.
const anyPack = fc.oneof(fc.constantFrom(0, 1), anyU8);
const anyCoat = fc.oneof(fc.integer({ min: 0, max: P.coatCount - 1 }), anyU8);
const anyPayload: fc.Arbitrary<Payload> = fc.record({ joinPack: anyPack, coat: anyCoat, name: anyName, switchPack: anyPack });

/** Gives e JOIN's payload when it has JOIN, and SWITCH's with SWITCH. */
function addPayload(e: EventPayload, p: Payload): void {
  if ((e.events & JOIN) !== 0) {
    e.joinPack = p.joinPack;
    e.coat = p.coat;
    e.name = p.name;
  }
  if ((e.events & SWITCH) !== 0) e.switchPack = p.switchPack;
}
const tickEvent = (back: number, events: number, p: Payload): TickEvent => {
  const e: TickEvent = { back, events };
  addPayload(e, p);
  return e;
};
const recordInput = (player: string, input: number, events: number, p: Payload): InputRecord => {
  const x: InputRecord = { player, input, events };
  addPayload(x, p);
  return x;
};

/** A sender's events: distinct backs it may name (0, a tick its history
 *  has, or one past the history), each with some kinds and their payloads.
 *  Event bits 1 to 31 are every non-empty set of the five. */
function anyEvents(present: number): fc.Arbitrary<TickEvent[]> {
  const held = Array.from({ length: H }, (_, k) => k + 1).filter((back) => (present & (1 << (back - 1))) !== 0);
  const backs = [fc.constant(0), fc.integer({ min: H + 1, max: 255 }), ...(held.length > 0 ? [fc.constantFrom(...held)] : [])];
  return fc
    .uniqueArray(fc.record({ back: fc.oneof(...backs), bits: fc.integer({ min: 1, max: 31 }), p: anyPayload }), { selector: (e) => e.back, maxLength: 6 })
    .map((list) => list.map(({ back, bits, p }) => tickEvent(back, bits, p)));
}

/** A sender's input and history, 0 where absent, often the same as the
 *  next newer so the same mask is used. */
const anySender: fc.Arbitrary<SenderInput> = fc
  .record({
    input: anyU16, present: fc.oneof(anyU16, fc.constantFrom(0, 0xffff)),
    values: fc.array(anyU16, { minLength: H, maxLength: H }), same: fc.array(fc.boolean(), { minLength: H, maxLength: H }),
  })
  .chain(({ input, present, values, same }) => {
    const hist: number[] = [];
    let newer: number | null = input;
    for (let k = 0; k < H; k++) {
      if ((present & (1 << k)) === 0) {
        hist.push(0);
        newer = null;
        continue;
      }
      const v: number = same[k] && newer !== null ? newer : values[k]!;
      hist.push(v);
      newer = v;
    }
    return anyEvents(present).map((events) => ({ input, present, hist, events }));
  });

const anyTick: fc.Arbitrary<Omit<Tick, 'type'>> = fc
  .record({
    t: anyU32, own: fc.option(anySender, { nil: null, freq: 5 }),
    vote: fc.option(fc.tuple(fc.integer({ min: 0, max: NO_TICK - 1 }), anyHash), { nil: null }),
    phase: anyPhase, bots: fc.uniqueArray(fc.tuple(anyId, anySender), { selector: ([b]) => b, maxLength: BOT_SLOTS }),
  })
  .map(({ t, own, vote, phase, bots }) => ({
    t, own, voteTick: vote ? vote[0] : NO_TICK, voteHash: vote ? vote[1] : ZERO_HASH, phase,
    bots: bots.map(([b, x]): BotEntry => ({ id: b, ...x })),
  }));

const anyHello: fc.Arbitrary<Omit<Hello, 'type'>> = fc
  .record({
    protocol: anyU16, build: anyHash, player: anyId, role: fc.integer({ min: 1, max: 4 }), live: fc.boolean(), timeline: anyHash,
    phase: fc.integer({ min: 0, max: 5 }), finalTick: anyU32, hash: anyHash, name: anyName,
  })
  .map(({ live, timeline, finalTick, hash: h, ...rest }) =>
    live
      ? { ...rest, timeline, timelineKind: TIMELINE_KIND.LIVE, finalTick, hash: h }
      : { ...rest, timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, finalTick: 0, hash: ZERO_HASH });

/** PEERS of any IDs and role, and any announcement, live or none (P7). */
const anyPeers: fc.Arbitrary<Omit<Peers, 'type'>> = fc
  .record({
    players: fc.uniqueArray(anyId, { maxLength: L.peersMax }), role: fc.integer({ min: 1, max: 4 }), live: fc.boolean(), timeline: anyHash,
    finalTick: anyU32, hash: anyHash,
  })
  .map(({ live, timeline, finalTick, hash: h, ...rest }) =>
    live ? { ...rest, timeline, timelineKind: TIMELINE_KIND.LIVE, finalTick, hash: h } : { ...rest, ...NO_TIMELINE });

// --- States for STATE ---

interface Held {
  readonly bytes: Uint8Array;
  readonly tick: number;
  readonly roster: readonly string[];
}
const held = (s: MatchState): Held => ({ bytes: encodeMatchState(s), tick: s.tick, roster: s.terriers.map((x) => x.id) });

/** A warm-up: some joiners, named in NAMES' ways, then some ticks. */
function warm(packSize: number, joiners: number, after: number): MatchState {
  const m = newMatch(P, packSize);
  step(m, Array.from({ length: joiners }, (_, k) => join(id(k), k & 1, 0, { coat: k, name: NAMES[k % NAMES.length]! })));
  for (let k = 0; k < after; k++) step(m, everyone(m.s));
  return m.s;
}

/** Both packs full and ready at tick 1, then on into play. */
function playing(packSize: number): MatchState {
  const m = newMatch(P, packSize);
  step(m, Array.from({ length: 2 * packSize }, (_, k) => join(id(k), k & 1, READY, { coat: k, name: NAMES[(k + 1) % NAMES.length]! })));
  for (let n = 0; m.s.phase !== IN_PLAY && n < 1000; n++) step(m, everyone(m.s));
  expect(m.s.phase).toBe(IN_PLAY);
  return m.s;
}

const POOL: readonly Held[] = [held(warm(1, 0, 0)), held(warm(2, 3, 7)), held(warm(4, 5, 2)), held(playing(1)), held(playing(2))];
const THREE = POOL[1]!; // three terriers, at tick 8

/** A STATE's fields, the roster to encode it with, and the message decode gives. */
interface StateCase {
  readonly value: Omit<StateMsg, 'type' | 'decoded' | 'roster' | 'others'>;
  readonly roster: readonly string[];
  readonly want: StateMsg;
}

/** The decoded message the fields make: the table is the IDs outside the
 *  roster, in the order they first appear. */
function expected(value: StateCase['value'], s: Held): StateMsg {
  const others: string[] = [];
  for (const record of value.inputs) for (const x of record) if (!s.roster.includes(x.player) && !others.includes(x.player)) others.push(x.player);
  return { type: T.STATE, ...value, decoded: decodeState(s.bytes)!, roster: [...s.roster], others };
}

const anyRecordInput = (player: string): fc.Arbitrary<InputRecord> =>
  fc.record({ input: anyU16, bits: fc.integer({ min: 0, max: 31 }), p: anyPayload }).map(({ input, bits, p }) => recordInput(player, input, bits, p));

/** STATEs inside the bounds, from the pool's states, with the members and
 *  up to six others mixed in each tick's record. */
const anyState: fc.Arbitrary<StateCase> = fc
  .record({ s: fc.constantFrom(...POOL), ahead: fc.integer({ min: 0, max: REACH }), timeline: anyHash, phase: anyPhase, extra: fc.uniqueArray(anyId, { maxLength: 6 }) })
  .chain(({ s, ahead, timeline, phase, extra }) => {
    const players = [...s.roster, ...extra.filter((p) => !s.roster.includes(p))];
    const record = fc.shuffledSubarray(players).chain((ids) => fc.tuple(...ids.map(anyRecordInput)));
    return fc
      .record({ final: fc.integer({ min: 0, max: ahead }), inputs: fc.array(record, { maxLength: Math.min(ahead + L.delay, 12) }) })
      .map(({ final, inputs }): StateCase => {
        const value = { timeline, senderTick: s.tick + ahead, phase, g: s.tick, senderFinal: s.tick + final, state: s.bytes, inputs };
        return { value, roster: s.roster, want: expected(value, s) };
      });
  });

// --- Valid encodings, one or two of each type ---

const rich: Omit<Tick, 'type'> = {
  t: 4321, voteTick: 4300, voteHash: hash, phase: 0.375,
  own: {
    input: 0x1a2b, present: 0b0110_0000_1000_0011, hist: [0x1a2b, 7, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 9, 9, 0],
    events: [{ back: 0, events: JOIN | READY, joinPack: 1, coat: 200, name: '\ufeffRex' }, { back: 2, events: SWITCH | LEAVE, switchPack: 0 }, { back: 30, events: UNREADY }],
  },
  bots: [
    { id: id(30), input: 3, present: 0xffff, hist: new Array<number>(16).fill(3), events: [{ back: 5, events: JOIN, joinPack: 0, coat: 1, name: 'Bot 001F' }] },
    { id: id(31), input: 0x8000, present: 0, hist: new Array<number>(16).fill(0), events: [] },
  ],
};
const hostOnly: Omit<Tick, 'type'> = { ...rich, own: null, voteTick: NO_TICK, voteHash: ZERO_HASH };
const hello: Omit<Hello, 'type'> = {
  protocol: 1, build: hash, player: id(3), role: ROLE.PLAYER, timeline: hash, timelineKind: TIMELINE_KIND.LIVE, phase: 3, finalTick: 99, hash, name: '\ufeffZoë',
};
const stateCase = (s: Held, inputs: InputRecord[][]): Uint8Array =>
  encodeState({ timeline: hash, senderTick: s.tick + 30, phase: 0.5, g: s.tick, senderFinal: s.tick + 10, state: s.bytes, inputs }, s.roster).bytes;
const STATE_INPUTS: InputRecord[][] = [
  [{ player: id(0), input: 0x0102, events: 0 }, { player: id(20), input: 9, events: JOIN | READY, joinPack: 0, coat: 5, name: '\ufeffNew' }],
  [],
  [{ player: id(21), input: 0xffff, events: SWITCH | UNREADY, switchPack: 1 }, { player: id(20), input: 9, events: 0 }, { player: id(2), input: 1, events: LEAVE }],
];

const ENCODINGS: readonly (readonly [string, Uint8Array])[] = [
  ['HELLO', encodeHello(hello)],
  ['HELLO of no timeline', encodeHello({ ...hello, timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, finalTick: 0, hash: ZERO_HASH, name: '' })],
  ['REFUSE', encodeRefuse(4)],
  ['TICK', encodeTick(rich)],
  ['TICK without its own input', encodeTick(hostOnly)],
  ['FWD', encodeFwd(id(7), encodeTick(rich))],
  ['PEERS', encodePeers([id(1), id(2), id(3)], ROLE.SPECTATOR, { timeline: '0123456789abcdef', timelineKind: TIMELINE_KIND.LIVE, finalTick: 4321, hash })],
  ['PEERS of no timeline', encodePeers([id(1)], ROLE.UNDECIDED)],
  ['AGAIN', encodeAgain()],
  ['STATE_REQ', encodeStateReq(1234, hash)],
  ['STATE in warm-up', stateCase(THREE, STATE_INPUTS)],
  ['STATE in play', stateCase(POOL[4]!, [[{ player: id(1), input: 5, events: READY }], [{ player: id(40), input: 6, events: 0 }]])],
];

const tickFields = (m: Tick): Omit<Tick, 'type'> => ({ t: m.t, own: m.own, voteTick: m.voteTick, voteHash: m.voteHash, phase: m.phase, bots: m.bots });

/** A decoded message encoded again. */
function reencode(m: Message): Uint8Array {
  switch (m.type) {
    case T.HELLO:
      return encodeHello({
        protocol: m.protocol, build: m.build, player: m.player, role: m.role, timeline: m.timeline, timelineKind: m.timelineKind,
        phase: m.phase, finalTick: m.finalTick, hash: m.hash, name: m.name,
      });
    case T.REFUSE:
      return encodeRefuse(m.reason);
    case T.TICK:
      return encodeTick(tickFields(m));
    case T.FWD:
      return encodeFwd(m.origin, encodeTick(tickFields(m.tick)));
    case T.PEERS:
      return encodePeers(m.players, m.role, { timeline: m.timeline, timelineKind: m.timelineKind, finalTick: m.finalTick, hash: m.hash });
    case T.AGAIN:
      return encodeAgain();
    case T.STATE_REQ:
      return encodeStateReq(m.tick, m.want);
    case T.STATE: {
      const { bytes, kept } = encodeState({ timeline: m.timeline, senderTick: m.senderTick, phase: m.phase, g: m.g, senderFinal: m.senderFinal, state: m.state, inputs: m.inputs }, m.roster);
      if (kept !== m.inputs.length) expect.fail(`a STATE of ${m.inputs.length} records re-encodes with ${kept}`);
      return bytes;
    }
  }
}

/** A message as JSON, typed arrays as arrays and the decoded state left
 *  out, since it is decodeState's of the bytes: a fast check before
 *  toEqual, which costs about a millisecond a kilobyte of typed array. */
const text = (m: Message | null): string => JSON.stringify(m, (k, v: unknown) => (k === 'decoded' ? undefined : v instanceof Uint8Array ? Array.from(v) : v));

// --- Raw messages, as no encoder writes them ---

interface Raw {
  readonly input?: number;
  readonly present?: number;
  readonly same?: number;
  readonly values?: readonly number[];
  readonly events?: readonly (readonly [back: number, kind: number])[]; // payload-free kinds
}

/** A TICK with these flags, its own fields as given, and these bots. */
function rawTick(own: Raw, bots: readonly (Raw & { readonly id: string })[] = [], flags = 0): Uint8Array {
  const w = new Writer().u8(T.TICK).u32(500).u8(flags).u16(own.input ?? 0).u32(NO_TICK).hex(ZERO_HASH, 8).u16(0);
  const sender = (x: Raw): void => {
    w.u16(x.present ?? 0).u16(x.same ?? 0);
    for (const v of x.values ?? []) w.u16(v);
    const events = x.events ?? [];
    w.u8(events.length);
    for (const [back, kind] of events) w.u8(back).u8(kind);
  };
  sender(own);
  w.u8(bots.length);
  for (const b of bots) {
    w.hex(b.id, 16).u16(b.input ?? 0);
    sender(b);
  }
  return w.done();
}

/** A STATE of s with this ID table and records of these indices, each input 0 with no events. */
function rawState(s: Held, table: readonly string[], records: readonly (readonly number[])[]): Uint8Array {
  const w = new Writer().u8(T.STATE).hex(hash, 8).u32(s.tick + 20).u16(0).u32(s.tick).u32(s.tick).u16(s.bytes.length).bytes(s.bytes).u8(table.length);
  for (const p of table) w.hex(p, 16);
  w.u16(records.length);
  for (const r of records) {
    w.u8(r.length);
    for (const i of r) w.u8(i).u16(0).u8(0);
  }
  return w.done();
}

/** What a TICK says of tick t − back for each sender in it: the input it
 *  has there with that tick's events, or an input of 0 made by events alone
 *  (design §2.5); nothing for a sender with neither. */
function inputsAt(m: Tick, sender: string, back: number): TickInput[] {
  const out: TickInput[] = [];
  const add = (who: string, x: SenderInput): void => {
    const has = back === 0 || (back <= H && (x.present & (1 << (back - 1))) !== 0);
    const e = x.events.find((v) => v.back === back);
    if (!has && e === undefined) return;
    const input: { -readonly [K in keyof TickInput]: TickInput[K] } = { id: who, input: back === 0 ? x.input : has ? x.hist[back - 1]! : 0, events: e?.events ?? 0 };
    if (e?.joinPack !== undefined) input.joinPack = e.joinPack;
    if (e?.coat !== undefined) input.coat = e.coat;
    if (e?.name !== undefined) input.name = e.name;
    if (e?.switchPack !== undefined) input.switchPack = e.switchPack;
    out.push(input);
  };
  if (m.own) add(sender, m.own);
  for (const b of m.bots) add(b.id, b);
  return out;
}

describe('the decoder, fuzzed (design §5.8)', () => {
  it('never throws on arbitrary bytes, mostly short, up to 16,000', () => {
    const types = Object.values(T);
    const bytes = fc.oneof(
      { weight: 6, arbitrary: fc.tuple(fc.constantFrom(...types), fc.uint8Array({ maxLength: 80 })).map(([t, rest]) => new Uint8Array([t, ...rest])) },
      { weight: 3, arbitrary: fc.uint8Array({ maxLength: 40 }) },
      { weight: 1, arbitrary: fc.uint8Array({ maxLength: L.messageMaxBytes }) },
    );
    fc.assert(fc.property(bytes, (b) => {
      decode(b);
    }), { numRuns: 6000 });
  });

  it('refuses every valid encoding cut short at each length, or with a byte after it', () => {
    for (const [what, b] of ENCODINGS) {
      expect(decode(b), what).not.toBeNull();
      for (let n = 0; n < b.length; n++) if (decode(b.subarray(0, n)) !== null) expect.fail(`${what} cut to ${n} bytes decodes`);
      expect(decode(new Uint8Array([...b, 0])), what).toBeNull();
    }
  });

  it('decodes each valid encoding with any byte made 0, 0xFF or a bit flipped, without throwing, to a message that re-encodes to itself', () => {
    for (const [what, b] of ENCODINGS) {
      let decoded = 0;
      let refused = 0;
      for (let at = 0; at < b.length; at++) {
        const was = b[at]!;
        const values = [0, 0xff, ...Array.from({ length: 8 }, (_, k) => was ^ (1 << k))];
        for (const v of values) {
          if (v === was) continue;
          const c = b.slice();
          c[at] = v;
          let m: Message | null;
          try {
            m = decode(c);
          } catch (e) {
            return expect.fail(`${what} with byte ${at} made ${v} throws: ${String(e)}`);
          }
          if (m === null) {
            refused++;
            continue;
          }
          decoded++;
          // Bounded: at most a constant times its length (§5.6).
          if (text(m).length > 40 * c.length + 200) expect.fail(`${what} with byte ${at} made ${v} decodes to ${text(m).length} characters`);
          const again = decode(reencode(m));
          if (text(again) !== text(m)) expect(again, `${what} with byte ${at} made ${v}`).toEqual(m);
        }
      }
      // Both happen for every type with a payload, so neither half is
      // vacuous; AGAIN's one byte changed is never a message.
      if (b.length > 1) expect([decoded > 0, refused > 0], what).toEqual([true, true]);
    }
  });

  it('round-trips random TICKs, HELLOs and PEERS: any u16, pack and coat byte, and well-formed name, U+FEFF first among them', () => {
    fc.assert(fc.property(anyTick, (v) => {
      expect(decode(encodeTick(v))).toEqual({ type: T.TICK, ...v });
    }), { numRuns: 1000 });
    fc.assert(fc.property(anyHello, (v) => {
      expect(decode(encodeHello(v))).toEqual({ type: T.HELLO, ...v });
    }), { numRuns: 1000 });
    fc.assert(fc.property(anyPeers, (v) => {
      expect(decode(encodePeers(v.players, v.role, v))).toEqual({ type: T.PEERS, ...v });
    }), { numRuns: 500 });
  });

  it("round-trips random STATEs, their records mixing the state's terriers and the ID table's", () => {
    let tables = 0;
    let mixed = 0;
    fc.assert(fc.property(anyState, ({ value, roster, want }) => {
      const { bytes, kept } = encodeState(value, roster);
      expect(kept).toBe(value.inputs.length);
      const m = decode(bytes);
      if (text(m) !== text(want)) expect(m).toEqual(want);
      if (want.others.length > 0) tables++;
      if (want.others.length > 0 && want.inputs.some((r) => r.some((x) => roster.includes(x.player)))) mixed++;
    }), { numRuns: 300 });
    expect(tables).toBeGreaterThan(80);
    expect(mixed).toBeGreaterThan(60);
  });

  it("refuses a TICK's event at a tick its history marks absent, or for the own input of a TICK without one; past the history it's valid", () => {
    const own: Raw = { input: 1, present: 0b101, values: [10, 20] }; // inputs at t − 1 and t − 3
    const valid = (events: Raw['events']): boolean => decode(rawTick({ ...own, ...(events ? { events } : {}) })) !== null;
    expect(valid([])).toBe(true);
    for (const back of [0, 1, 3, H + 1, 255]) expect(valid([[back, 3]]), `back ${back}`).toBe(true);
    for (const back of [2, 4, H]) expect(valid([[back, 3]]), `back ${back}`).toBe(false);
    // The same in a bot entry.
    const bot = { id: id(9), input: 2, present: 0b1, values: [7] };
    expect(decode(rawTick(own, [{ ...bot, events: [[1, 3]] }]))).not.toBeNull();
    expect(decode(rawTick(own, [{ ...bot, events: [[2, 3]] }]))).toBeNull();
    expect(decode(rawTick({}, [{ ...bot, events: [[H + 1, 3]] }], 0x80))).not.toBeNull();
    // A TICK without its own input carries no event of its own, at any back.
    expect(decode(rawTick({}, [bot], 0x80))).not.toBeNull();
    for (const back of [0, 1, H + 1]) expect(decode(rawTick({ events: [[back, 3]] }, [bot], 0x80)), `back ${back}`).toBeNull();
    // Any mask and back: valid exactly when the back is 0, past the history, or a present tick.
    fc.assert(fc.property(anyU16, fc.integer({ min: 0, max: 255 }), (present, back) => {
      const values = Array.from({ length: H }, (_, k) => k).filter((k) => (present & (1 << k)) !== 0);
      const ok = decode(rawTick({ input: 1, present, values, events: [[back, 3]] })) !== null;
      return ok === (back === 0 || back > H || (present & (1 << (back - 1))) !== 0);
    }), { numRuns: 2000 });
  });

  it('refuses STATEs outside the tick bounds', () => {
    const g = THREE.tick;
    const msg = (senderTick: number, senderFinal: number, records = 0): Uint8Array =>
      encodeState({ timeline: hash, senderTick, phase: 0, g, senderFinal, state: THREE.bytes, inputs: new Array<InputRecord[]>(records).fill([]) }, THREE.roster).bytes;
    expect(decode(msg(g, g))).not.toBeNull();
    expect(decode(msg(g + REACH, g + REACH, REACH + L.delay))).not.toBeNull(); // at every bound
    expect(decode(msg(g + 5, g - 1))).toBeNull(); // the sender's final tick before g
    expect(decode(msg(g + 5, g + 6))).toBeNull(); // or after its clock
    expect(decode(msg(g + REACH + 1, g))).toBeNull(); // a clock past g by more than the history and 2w + d
    expect(decode(msg(g + 5, g, 5 + L.delay))).not.toBeNull();
    // Records past the clock and d: the encoder keeps none of them, and
    // written anyway, with an empty record more, they're refused.
    expect(msg(g + 5, g, 5 + L.delay + 1)).toEqual(msg(g + 5, g, 5 + L.delay));
    const full = msg(g + 5, g, 5 + L.delay);
    const count = 26 + THREE.bytes.length; // the record count's u16, after the header, the state and the empty table
    expect(full[count]).toBe(5 + L.delay);
    const over = new Uint8Array([...full, 0]);
    over[count] = 5 + L.delay + 1;
    expect(decode(over)).toBeNull();
    over[count] = 5 + L.delay;
    expect(decode(over)).toBeNull(); // the empty record more, unclaimed, trails
  });

  it('refuses STATEs with a bad index or table', () => {
    const [a, b] = [id(50), id(51)];
    const R = THREE.roster.length;
    expect(R).toBe(3);
    expect(decode(rawState(THREE, [a, b], [[0, R], [R + 1, 1]]))).not.toBeNull();
    expect(decode(rawState(THREE, [a, b], [[0, R], [R + 1, R + 2]]))).toBeNull(); // past the terriers and the table
    expect(decode(rawState(THREE, [a, a], [[R, R + 1]]))).toBeNull(); // a table ID twice
    expect(decode(rawState(THREE, [THREE.roster[1]!], [[R]]))).toBeNull(); // one of the state's terriers
    expect(decode(rawState(THREE, [a], [[0, R, 0]]))).toBeNull(); // an index twice in a record
    expect(decode(rawState(THREE, [a], [[0, R], [0, R]]))).not.toBeNull(); // in two records, fine
    expect(decode(rawState(THREE, [a], [[0, 1, 2, R, 0]]))).toBeNull(); // more inputs than the terriers and the table hold
    // A table the encoder doesn't write: an entry no record uses, or one first used before an earlier one.
    expect(decode(rawState(THREE, [a, b], [[R]]))).toBeNull();
    expect(decode(rawState(THREE, [a, b], [[R + 1, R]]))).toBeNull();
    expect(decode(rawState(THREE, [a, b], [[R + 1], [R]]))).toBeNull();
  });

  it('steps decoded TICKs from random warm-up states: step never throws, and the state stays valid (D-12)', () => {
    let joined = 0;
    fc.assert(fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 0, max: 0xffffffff }), fc.uniqueArray(anyId, { minLength: 1, maxLength: 8 }), anyTick,
      (packSize, seed, ids, v) => {
        const m = newMatch(P, packSize);
        step(m, ids.filter((_, k) => ((seed >>> k) & 1) !== 0).map((p, k) => join(p, k & 1, 0, { coat: k })));
        for (let k = 0; k < 8; k++) step(m, noisyInputs(seed, ids, NAMES, m.s.tick + 1));
        const decoded = decode(encodeTick(v));
        if (decoded?.type !== T.TICK) return expect.fail('a TICK value does not decode');
        const sender = ids[seed % ids.length]!;
        const backs = new Set<number>(Array.from({ length: H + 1 }, (_, k) => k));
        for (const x of [decoded.own, ...decoded.bots]) for (const e of x?.events ?? []) backs.add(e.back);
        for (const back of [...backs].sort((x, y) => y - x)) {
          const before = m.s.terriers.length;
          step(m, inputsAt(decoded, sender, back));
          if (m.s.terriers.length > before) joined++;
          const problems = stateProblems(m.s, P);
          if (problems.length > 0) expect(problems).toEqual([]);
        }
      }), { numRuns: 300 });
    expect(joined).toBeGreaterThan(100);
  });

  it('refuses a message over messageMaxBytes before reading any of it', () => {
    const read: (string | symbol)[] = [];
    const big = new Proxy(new Uint8Array(L.messageMaxBytes + 1), {
      get(target, key) {
        read.push(key);
        return Reflect.get(target, key) as unknown;
      },
    });
    expect(decode(big)).toBeNull();
    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((k) => k !== 'length')).toEqual([]);
    // The limit is WireLimits': at a message's length it decodes, under it not.
    const b = ENCODINGS.find(([what]) => what === 'STATE in warm-up')![1];
    expect(decode(b, P, { ...L, messageMaxBytes: b.length })).not.toBeNull();
    expect(decode(b, P, { ...L, messageMaxBytes: b.length - 1 })).toBeNull();
  });
});
