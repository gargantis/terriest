import { describe, expect, it } from 'vitest';
import { config } from '../../config';
import { BOT_SLOTS } from '../bot/bot-id';
import { decodeState, encodeState as encodeMatchState } from '../sim/codec';
import { JOIN, LEAVE, READY, SWITCH, UNREADY } from '../sim/input';
import { everyone, join, newMatch, tick as step } from '../sim/match-testing';
import { defaultParams, simParams } from '../sim/params';
import { IN_PLAY, type MatchState } from '../sim/state';
import { Reader, Writer } from './bytes';
import {
  type BotEntry, decode, encodeAgain, encodeFwd, encodeHello, encodePeers, encodeRefuse, encodeState, encodeStateReq, encodeTick,
  type Hello, type InputRecord, KIND, NO_TICK, PROTOCOL_VERSION, REFUSAL, ROLE, type SenderInput, stateRecordsMax, type StateMsg, T,
  type Tick, TIMELINE_KIND, wireLimits, wireString, ZERO_HASH,
} from './messages';

// The wire protocol (PLAN §9, D-20; design §1.1, §1.2, §5): every message
// round-trips, a name that starts with U+FEFF among them (§5.8), the
// layouts of §5.1 and §5.3, what the encoders zero and leave out, and what
// §5.1 to §5.5 call invalid. fuzz.test.ts fuzzes the decoder and
// sizes.test.ts measures the messages.

const P = defaultParams;
const id = (k: number): string => (k + 1).toString(16).padStart(32, '0');
const hash = 'a1b2c3d4e5f60718';
const other = '0123456789abcdef';
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const u16At = (b: Uint8Array, at: number): number => new DataView(b.buffer, b.byteOffset).getUint16(at, true);
const u32At = (b: Uint8Array, at: number): number => new DataView(b.buffer, b.byteOffset).getUint32(at, true);
const hexAt = (b: Uint8Array, at: number, n: number): string => Array.from(b.subarray(at, at + n), (x) => x.toString(16).padStart(2, '0')).join('');
/** The bytes with one changed. */
const patched = (b: Uint8Array, at: number, v: number): Uint8Array => {
  const c = b.slice();
  c[at] = v;
  return c;
};

/** A history of 16 entries: the values, then zeros. */
const hist = (values: number[]): number[] => [...values, ...new Array<number>(16 - values.length).fill(0)];

/** A TICK's bytes up to its masks, as no encoder writes them: t 500, these
 *  flags and input, no vote, phase 0. */
const rawHead = (flags: number, input: number): Writer => new Writer().u8(T.TICK).u32(500).u8(flags).u16(input).u32(NO_TICK).hex(ZERO_HASH, 8).u16(0);

// Present at k = 0, 1, 2, 13 and 15: the first two the same as the next
// newer, the input then hist[0]; hist[13] equal to hist[2] but after an
// absent tick, so written; hist[15] after an absent one too.
const own: SenderInput = {
  input: 0x8123,
  present: 0b1010_0000_0000_0111,
  hist: [0x8123, 0x8123, 0x0042, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x0042, 0, 0x7fff],
  events: [
    { back: 0, events: JOIN | READY, joinPack: 1, coat: 7, name: '\ufeffRex' },
    { back: 3, events: UNREADY | SWITCH, switchPack: 0 },
    { back: 40, events: LEAVE }, // past the history: valid (§5.3)
  ],
};
const bot: BotEntry = {
  id: id(40), input: 0x0101, present: 0xffff, hist: new Array<number>(16).fill(0x0101),
  events: [{ back: 2, events: JOIN | READY, joinPack: 0, coat: 3, name: 'Bot 0029' }],
};
const quiet: BotEntry = { id: id(41), input: 5, present: 0, hist: hist([]), events: [] };
const tick: Omit<Tick, 'type'> = { t: 1234, own, voteTick: 1200, voteHash: hash, phase: 0.25, bots: [bot, quiet] };
const hostOnly: Omit<Tick, 'type'> = { t: 99, own: null, voteTick: 80, voteHash: other, phase: 0.5, bots: [bot] };

const hello: Omit<Hello, 'type'> = {
  protocol: PROTOCOL_VERSION, build: hash, player: id(3), role: ROLE.PLAYER, timeline: other, timelineKind: TIMELINE_KIND.LIVE,
  phase: IN_PLAY, finalTick: 99, hash, name: '\ufeffZoë',
};
const lone: Omit<Hello, 'type'> = {
  ...hello, role: ROLE.UNDECIDED, timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name: '',
};

/** A 2-a-side warm-up at tick 5 with two terriers, one named with a
 *  leading U+FEFF: its bytes and its roster. */
function warmUp(): { bytes: Uint8Array; s: MatchState; roster: string[] } {
  const m = newMatch(P, 2);
  step(m, [join(id(0), 0, READY, { coat: 1, name: '\ufeffAna' }), join(id(1), 1, 0, { coat: 2, name: 'Bo' })]);
  for (let k = 0; k < 4; k++) step(m, everyone(m.s));
  return { bytes: encodeMatchState(m.s), s: m.s, roster: m.s.terriers.map((x) => x.id) };
}

/** Records for ticks g + 1 … g + 3: the roster's members and two
 *  candidates, id(9) and id(10), whose IDs go in the table in that order. */
const records = (): InputRecord[][] => [
  [{ player: id(0), input: 0x1234, events: 0 }, { player: id(9), input: 0, events: JOIN, joinPack: 1, coat: 4, name: '\ufeffLate' }],
  [],
  [
    { player: id(9), input: 7, events: READY | SWITCH, switchPack: 0 },
    { player: id(1), input: 0xffff, events: LEAVE },
    { player: id(10), input: 1, events: UNREADY },
  ],
];

describe('bytes (design §1.1)', () => {
  it('writes little-endian and reads it back; a short read sets bad, and every read after it is zero', () => {
    const b = new Writer().u8(0xab).u16(0x1234).u32(0xdeadbeef).bytes(new Uint8Array([1, 2])).hex('00ff10', 3).done();
    expect(Array.from(b)).toEqual([0xab, 0x34, 0x12, 0xef, 0xbe, 0xad, 0xde, 1, 2, 0, 0xff, 0x10]);
    const r = new Reader(b);
    expect([r.u8(), r.u16(), r.u32()]).toEqual([0xab, 0x1234, 0xdeadbeef]);
    expect(Array.from(r.bytes(2))).toEqual([1, 2]);
    expect(r.remaining).toBe(3);
    expect(r.hex(3)).toBe('00ff10');
    expect(r.complete).toBe(true);
    expect([r.u8(), r.bad, r.remaining, r.complete]).toEqual([0, true, 0, false]);
    const short = new Reader(new Uint8Array([1, 2, 3]));
    expect(short.u32()).toBe(0);
    expect([short.bad, short.u8(), short.hex(1), short.bytes(1).length, short.string()]).toEqual([true, 0, '', 0, '']);
    // bytes(n) copies, and refuses more than remain, or a count that isn't one.
    const src = new Uint8Array([9, 8, 7]);
    const copy = new Reader(src).bytes(3);
    src[0] = 0;
    expect(copy[0]).toBe(9);
    for (const n of [4, -1, 1.5, NaN]) {
      const r2 = new Reader(src);
      expect([r2.bytes(n).length, r2.bad]).toEqual([0, true]);
    }
  });

  it('writes zeros for anything but 2·size hex digits, and reads hex in lower case', () => {
    for (const h of ['zz', '1', '123', '', '-1', ' 1']) expect(Array.from(new Writer().hex(h, 1).done())).toEqual([0]);
    expect(Array.from(new Writer().hex('0g00', 2).done())).toEqual([0, 0]);
    expect(new Reader(new Writer().hex('ABCDEF', 3).done()).hex(3)).toBe('abcdef');
  });

  it('reads a string as strict UTF-8, a leading U+FEFF kept, within the name limit', () => {
    // §0's measurement: ef bb bf 52 65 78 is U+FEFF and "Rex", 4 code units;
    // roslambo's decoder, without ignoreBOM, made it "Rex".
    const bom = new Uint8Array([6, 0xef, 0xbb, 0xbf, 0x52, 0x65, 0x78]);
    expect(new Reader(bom).string()).toBe('\ufeffRex');
    expect(new TextDecoder('utf-8', { fatal: true }).decode(bom.subarray(1))).toBe('Rex');
    for (const bad of [[1, 0xff], [2, 0xc3], [3, 0xed, 0xa0, 0x80], [2, 0xc0, 0x80], [4, 0xf4, 0x90, 0x80, 0x80]]) {
      const r = new Reader(new Uint8Array(bad));
      expect([r.string(), r.bad]).toEqual(['', true]);
    }
    const limit = config.displayNameMaxBytes;
    const at = (n: number): Reader => new Reader(new Uint8Array([n, ...new Array<number>(n).fill(0x61)]));
    expect(at(limit).string()).toBe('a'.repeat(limit));
    const over = at(limit + 1);
    expect([over.string(), over.bad]).toEqual(['', true]);
    expect(at(10).string(9)).toBe('');
  });

  it('writes a string as wireString writes it: a lone surrogate or more than 32 bytes as empty (§5.7)', () => {
    const written = (s: string): number[] => Array.from(new Writer().string(s).done());
    expect(written('\ufeffRex')).toEqual([6, 0xef, 0xbb, 0xbf, 0x52, 0x65, 0x78]);
    for (const s of ['lone \ud83d', '\udc36 lone', 'x'.repeat(33), 'é'.repeat(17)]) expect(written(s)).toEqual([0]);
    expect(written('é'.repeat(16)).length).toBe(33);
  });
});

describe('wireString (design §5.7)', () => {
  it('is the string when it is well-formed UTF-16 within the byte limit, else empty', () => {
    for (const s of ['', 'Rex', '\ufeff', '\ufeffRex', 'é'.repeat(16), '🐶'.repeat(8), 'x'.repeat(32), 'tab\there', '\u0000', '\u0085']) {
      expect(wireString(s)).toBe(s);
    }
    for (const s of ['x'.repeat(33), '🐶'.repeat(9), 'a\ud800b', '\udc00', 'end\ud83d', '\ud83d\ud83d']) expect(wireString(s)).toBe('');
    expect(wireString('abc', 2)).toBe('');
    expect(wireString(3 as unknown as string)).toBe('');
  });
});

describe('the messages (PLAN §9, design §5)', () => {
  it('numbers the types, roles, timeline kinds, refusals and event kinds as §5 does', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(T).toEqual({ HELLO: 0x01, REFUSE: 0x02, TICK: 0x10, FWD: 0x11, PEERS: 0x12, AGAIN: 0x13, STATE_REQ: 0x20, STATE: 0x21 });
    expect(ROLE).toEqual({ KEEPER: 1, PLAYER: 2, SPECTATOR: 3, UNDECIDED: 4 });
    expect(TIMELINE_KIND).toEqual({ NONE: 0, LIVE: 1 });
    expect(REFUSAL).toEqual({ ACCEPTED: 0, PROTOCOL: 1, BUILD: 2, DUPLICATE: 3, SPECTATORS_FULL: 4 });
    expect(KIND).toEqual({ JOIN: 1, LEAVE: 2, READY: 3, UNREADY: 4, SWITCH: 5 });
    expect([NO_TICK, ZERO_HASH]).toEqual([0xffffffff, '0'.repeat(16)]);
  });

  it('round-trips every message, names that start with U+FEFF among them (§5.8)', () => {
    const w = warmUp();
    const state = { timeline: hash, senderTick: w.s.tick + 40, phase: 0.75, g: w.s.tick, senderFinal: w.s.tick + 20, state: w.bytes, inputs: records() };
    const encoded = encodeState(state, w.roster);
    expect(encoded.kept).toBe(3);
    const cases: [Uint8Array, unknown][] = [
      [encodeHello(hello), { type: T.HELLO, ...hello }],
      [encodeHello(lone), { type: T.HELLO, ...lone }],
      ...[0, 1, 2, 3, 4].map((reason): [Uint8Array, unknown] => [encodeRefuse(reason), { type: T.REFUSE, reason }]),
      [encodeTick(tick), { type: T.TICK, ...tick }],
      [encodeTick(hostOnly), { type: T.TICK, ...hostOnly }],
      [encodeTick({ ...tick, own: { ...own, events: [] }, voteTick: NO_TICK, voteHash: ZERO_HASH, bots: [] }),
        { type: T.TICK, ...tick, own: { ...own, events: [] }, voteTick: NO_TICK, voteHash: ZERO_HASH, bots: [] }],
      [encodeFwd(id(7), encodeTick(tick)), { type: T.FWD, origin: id(7), tick: { type: T.TICK, ...tick } }],
      [encodePeers([id(1), id(2)], ROLE.SPECTATOR), { type: T.PEERS, players: [id(1), id(2)], role: ROLE.SPECTATOR }],
      [encodePeers([], ROLE.KEEPER), { type: T.PEERS, players: [], role: ROLE.KEEPER }],
      [encodeAgain(), { type: T.AGAIN }],
      [encodeStateReq(NO_TICK, ZERO_HASH), { type: T.STATE_REQ, tick: NO_TICK, want: ZERO_HASH }],
      [encodeStateReq(1234, hash), { type: T.STATE_REQ, tick: 1234, want: hash }],
      [encoded.bytes, {
        type: T.STATE, ...state, decoded: decodeState(w.bytes), roster: w.roster, others: [id(9), id(10)],
      }],
    ];
    for (const [bytes, want] of cases) expect(decode(bytes)).toEqual(want);
    // The state is decoded, and a copy: the message's buffer can be reused.
    const m = decode(encoded.bytes) as StateMsg;
    expect(m.decoded.terriers.map((x) => x.name)).toEqual(['\ufeffAna', 'Bo']);
    expect(m.state.buffer).not.toBe(encoded.bytes.buffer);
  });

  it('lays HELLO out as §5.1 says: 51 bytes and the name', () => {
    const b = encodeHello(hello);
    expect(b.length).toBe(51 + utf8(hello.name).length);
    expect([b[0], u16At(b, 1), hexAt(b, 3, 8), hexAt(b, 11, 16), b[27], hexAt(b, 28, 8), b[36], b[37], u32At(b, 38), hexAt(b, 42, 8), b[50]])
      .toEqual([T.HELLO, PROTOCOL_VERSION, hash, id(3), ROLE.PLAYER, other, TIMELINE_KIND.LIVE, IN_PLAY, 99, hash, 7]);
    expect(Array.from(b.subarray(51))).toEqual(Array.from(utf8('\ufeffZoë')));
  });

  it('lays TICK out as §5.3 says, writing only the present inputs that differ from the next newer', () => {
    const b = encodeTick({ ...tick, bots: [] });
    expect([b[0], u32At(b, 1), b[5], u16At(b, 6), u32At(b, 8), hexAt(b, 12, 8), u16At(b, 20), u16At(b, 22), u16At(b, 24)])
      .toEqual([T.TICK, 1234, 0, 0x8123, 1200, hash, 0x4000, 0b1010_0000_0000_0111, 0b11]);
    // hist[2], hist[13] and hist[15], k ascending.
    expect([u16At(b, 26), u16At(b, 28), u16At(b, 30)]).toEqual([0x0042, 0x0042, 0x7fff]);
    // Then 5 events: JOIN and READY at 0, UNREADY and SWITCH at 3, LEAVE at 40.
    expect(Array.from(b.subarray(32))).toEqual([
      5, 0, KIND.JOIN, 1, 7, ...[6, ...utf8('\ufeffRex')], 0, KIND.READY, 3, KIND.UNREADY, 3, KIND.SWITCH, 0, 40, KIND.LEAVE, 0,
    ]);
    // Bit 7 marks a TICK without the sender's own input (§5.3).
    const h = encodeTick(hostOnly);
    expect([h[5], u16At(h, 6), u16At(h, 22), u16At(h, 24), h[26], h[27]]).toEqual([0x80, 0, 0, 0, 0, 1]);
  });

  it('zeroes what a timeline of kind none, a TICK without its own input and a missing vote leave unused', () => {
    const none = decode(encodeHello({ ...lone, timeline: other, finalTick: 7, hash })) as Hello;
    expect([none.timeline, none.finalTick, none.hash]).toEqual([ZERO_HASH, 0, ZERO_HASH]);
    const noVote = decode(encodeTick({ ...tick, voteTick: NO_TICK, voteHash: hash })) as Tick;
    expect([noVote.voteTick, noVote.voteHash]).toEqual([NO_TICK, ZERO_HASH]);
    // A phase is clamped to 0..65535/65536, and NaN is 0.
    const phases = [-1, NaN, 1, 2, Infinity, 0.5].map((phase) => (decode(encodeTick({ ...hostOnly, phase })) as Tick).phase);
    expect(phases).toEqual([0, 0, 65535 / 65536, 65535 / 65536, 65535 / 65536, 0.5]);
  });

  it('leaves out the events no receiver could take: past 255 back, at a tick the history marks absent, or twice', () => {
    const x: SenderInput = {
      input: 1, present: 0b1, hist: hist([2]),
      events: [
        { back: 0, events: READY },
        { back: 2, events: UNREADY }, // present bit 1 clear: the sender has no input there
        { back: 256, events: LEAVE },
        { back: -1, events: LEAVE },
        { back: 1, events: LEAVE | READY },
        { back: 0, events: READY | JOIN, joinPack: 1, coat: 2, name: 'Ann' }, // READY at 0 again: only the JOIN rides
        { back: 17, events: SWITCH, switchPack: 1 }, // past the history: rides
        { back: 1, events: LEAVE }, // again: left out
      ],
    };
    const m = decode(encodeTick({ ...tick, own: x, bots: [{ ...x, id: id(50) }] })) as Tick;
    const want = [
      { back: 0, events: READY | JOIN, joinPack: 1, coat: 2, name: 'Ann' },
      { back: 1, events: LEAVE | READY },
      { back: 17, events: SWITCH, switchPack: 1 },
    ];
    expect(m.own?.events).toEqual(want);
    expect(m.bots[0]?.events).toEqual(want);
  });

  it('refuses the HELLOs §5.1 calls invalid', () => {
    const b = encodeHello(hello);
    expect(decode(b)).not.toBeNull();
    for (const [at, v] of [[27, 0], [27, 5], [36, 2], [37, 6]]) expect(decode(patched(b, at!, v!))).toBeNull();
    // Kind none with a non-zero timeline ID, tick or hash.
    const n = encodeHello(lone);
    expect(decode(n)).not.toBeNull();
    for (const at of [28, 35, 38, 41, 42, 49]) expect(decode(patched(n, at, 1))).toBeNull();
    // A name that isn't UTF-8, and one past the limit.
    expect(decode(patched(b, b.length - 1, 0xff))).toBeNull();
    const long = new Writer().u8(T.HELLO).bytes(b.subarray(1, 50)).u8(33).bytes(utf8('x'.repeat(33))).done();
    expect(decode(long)).toBeNull();
  });

  it('refuses REFUSE reasons past 4, and anything after a message', () => {
    expect(decode(new Uint8Array([T.REFUSE, 5]))).toBeNull();
    expect(decode(new Uint8Array([T.REFUSE]))).toBeNull();
    expect(decode(new Uint8Array([T.AGAIN, 0]))).toBeNull();
    expect(decode(new Uint8Array([0x14]))).toBeNull();
    expect(decode(new Uint8Array(0))).toBeNull();
    expect(decode('not bytes' as unknown as Uint8Array)).toBeNull();
  });

  it('refuses the TICKs §5.3 calls invalid', () => {
    const b = encodeTick(tick);
    expect(decode(b)).not.toBeNull();
    // Flags bits 0–6, and bit 7 with an input of the sender's own.
    for (const flags of [1, 0x40, 0x81]) expect(decode(patched(b, 5, flags))).toBeNull();
    expect(decode(patched(b, 5, 0x80))).toBeNull();
    // Bit 7 with a history or events.
    const h = encodeTick(hostOnly);
    for (const at of [22, 23, 24, 26]) expect(decode(patched(h, at, 1))).toBeNull();
    // A same bit whose present bit is clear (bit 3), or whose next newer
    // input is absent (bit 13, after the absent tick 12).
    expect(decode(patched(b, 24, 0b1011))).toBeNull();
    expect(decode(patched(b, 25, 0b0010_0000))).toBeNull();
    // An unknown event kind, and a name that isn't UTF-8.
    for (const kind of [0, 6, 0xff]) expect(decode(patched(b, 34, kind))).toBeNull();
    expect(decode(patched(b, 38, 0xff))).toBeNull();
    // A (back, kind) twice: LEAVE and READY at 0, the second made LEAVE.
    const twice = encodeTick({ ...tick, own: { ...own, events: [{ back: 0, events: LEAVE | READY }] }, bots: [] });
    expect(decode(twice)).not.toBeNull();
    expect(decode(patched(twice, 36, KIND.LEAVE))).toBeNull();
    // No vote with a non-zero hash.
    const noVote = encodeTick({ ...tick, voteTick: NO_TICK, voteHash: ZERO_HASH });
    expect(decode(noVote)).not.toBeNull();
    expect(decode(patched(noVote, 19, 1))).toBeNull();
  });

  it('refuses each of those TICKs by its own rule, its bytes otherwise consistent', () => {
    // Bit 7 with only an input: no history, events or bots.
    const hostless = rawHead(0x80, 0).u16(0).u16(0).u8(0).u8(0).done();
    expect(decode(hostless)).not.toBeNull();
    expect(decode(patched(hostless, 6, 1))).toBeNull();
    // Present at k = 0 and 2: both written, or k = 2's same bit set where
    // k = 1, its next newer, is absent, with only k = 0's written.
    expect(decode(rawHead(0, 1).u16(0b101).u16(0).u16(10).u16(11).u8(0).u8(0).done())).not.toBeNull();
    expect(decode(rawHead(0, 1).u16(0b101).u16(0b100).u16(10).u8(0).u8(0).done())).toBeNull();
    // A JOIN's name of 32 bytes rides, and of 33 doesn't.
    const named = (n: number): Uint8Array => {
      const name = utf8('x'.repeat(n));
      return rawHead(0, 1).u16(0).u16(0).u8(1).u8(0).u8(KIND.JOIN).u8(0).u8(0).u8(name.length).bytes(name).u8(0).done();
    };
    expect((decode(named(32)) as Tick).own?.events).toEqual([{ back: 0, events: JOIN, joinPack: 0, coat: 0, name: 'x'.repeat(32) }]);
    expect(decode(named(33))).toBeNull();
  });

  it('refuses more than BOT_SLOTS bot entries, and a bot ID twice', () => {
    const bots = (n: number): BotEntry[] => Array.from({ length: n }, (_, k) => ({ ...quiet, id: id(60 + k) }));
    expect((decode(encodeTick({ ...hostOnly, bots: bots(BOT_SLOTS) })) as Tick).bots).toHaveLength(BOT_SLOTS);
    expect(decode(encodeTick({ ...hostOnly, bots: bots(BOT_SLOTS + 1) }))).toBeNull();
    expect(decode(encodeTick({ ...hostOnly, bots: [quiet, bot, quiet] }))).toBeNull();
  });

  it("checks a TICK's masks against the history's length", () => {
    const L = { ...wireLimits(), inputHistory: 8 };
    const short: SenderInput = { input: 3, present: 0b1000_0001, hist: hist([3, 0, 0, 0, 0, 0, 0, 9]), events: [{ back: 20, events: READY }] };
    expect((decode(encodeTick({ ...tick, own: short, bots: [] }), P, L) as Tick).own).toEqual({ ...short, hist: [3, 0, 0, 0, 0, 0, 0, 9] });
    expect(decode(encodeTick({ ...tick, own: { ...short, present: 0b1_0000_0001 }, bots: [] }), P, L)).toBeNull();
    // Present bits 7 and 8 and same bit 8: only hist[7] is written, as a
    // history of 8 reads it, so the bit past it alone refuses it.
    expect(decode(rawHead(0, 1).u16(0x80).u16(0).u16(7).u8(0).u8(0).done(), P, L)).not.toBeNull();
    expect(decode(rawHead(0, 1).u16(0x180).u16(0x100).u16(7).u8(0).u8(0).done(), P, L)).toBeNull();
    // An encoder given the same limits writes only what they take.
    expect((decode(encodeTick({ ...tick, own: { ...short, present: 0b1_0000_0001 }, bots: [] }, L), P, L) as Tick).own?.present).toBe(0b1);
  });

  it('refuses PEERS over the cap, with an ID twice, or with a role outside 1–4; and writes each ID once', () => {
    const max = wireLimits().peersMax;
    expect(max).toBe(config.meshPlayersMax + config.spectatorsMax - 1);
    const ids = (n: number): string[] => Array.from({ length: n }, (_, k) => id(k));
    expect((decode(encodePeers(ids(max), ROLE.PLAYER)) as { players: string[] }).players).toEqual(ids(max));
    expect(decode(encodePeers(ids(max + 1), ROLE.PLAYER))).toBeNull();
    expect(decode(encodePeers([id(1), id(2), id(1)], ROLE.PLAYER))).toEqual({ type: T.PEERS, players: [id(1), id(2)], role: ROLE.PLAYER });
    const raw = new Writer().u8(T.PEERS).u8(2).hex(id(1), 16).hex(id(1), 16).u8(ROLE.PLAYER).done();
    expect(decode(raw)).toBeNull();
    for (const role of [0, 5]) expect(decode(encodePeers([id(1)], role))).toBeNull();
    expect(decode(new Uint8Array([T.PEERS, 0]))).toBeNull();
  });

  it('refuses a FWD with anything but one complete TICK inside', () => {
    const inner = encodeTick(tick);
    expect(decode(encodeFwd(id(7), inner))).not.toBeNull();
    expect(decode(encodeFwd(id(7), encodeHello(hello)))).toBeNull();
    expect(decode(encodeFwd(id(7), new Uint8Array([...inner, 0])))).toBeNull();
    expect(decode(encodeFwd(id(7), inner.subarray(0, inner.length - 1)))).toBeNull();
    expect(decode(encodeFwd(id(7), encodeFwd(id(8), inner)))).toBeNull();
    // A TICK's bytes behind another type byte.
    const hostless = encodeTick({ t: 9, own: null, voteTick: NO_TICK, voteHash: ZERO_HASH, phase: 0, bots: [] });
    expect(decode(encodeFwd(id(7), hostless))).not.toBeNull();
    expect(decode(encodeFwd(id(7), patched(hostless, 0, T.PEERS)))).toBeNull();
  });

  it('lays out a bot entry (§5.3), FWD, PEERS and STATE_REQ (§5.4) and STATE (§5.5) as their tables say', () => {
    const b = encodeTick({
      t: 7, own: null, voteTick: NO_TICK, voteHash: ZERO_HASH, phase: 0,
      bots: [{ id: id(40), input: 0xbeef, present: 0b11, hist: hist([0xbeef, 5]), events: [{ back: 1, events: SWITCH, switchPack: 1 }] }],
    });
    // The own part's 27 bytes, the bot count, then the entry: its ID, its input, its masks, hist[1], one SWITCH.
    expect([b[27], hexAt(b, 28, 16), u16At(b, 44), u16At(b, 46), u16At(b, 48), u16At(b, 50), b[52], b[53], b[54], b[55], b.length])
      .toEqual([1, id(40), 0xbeef, 0b11, 0b01, 5, 1, 1, KIND.SWITCH, 1, 56]);
    const f = encodeFwd(id(7), b);
    expect([f[0], hexAt(f, 1, 16), Array.from(f.subarray(17))]).toEqual([T.FWD, id(7), Array.from(b)]);
    const p = encodePeers([id(1), id(2)], ROLE.SPECTATOR);
    expect([p[0], p[1], hexAt(p, 2, 16), hexAt(p, 18, 16), p[34], p.length]).toEqual([T.PEERS, 2, id(1), id(2), ROLE.SPECTATOR, 35]);
    const q = encodeStateReq(0x01020304, hash);
    expect([q[0], u32At(q, 1), hexAt(q, 5, 8), q.length]).toEqual([T.STATE_REQ, 0x01020304, hash, 13]);
    // STATE: its header, the state, the table of one candidate, then one
    // record of a terrier's input and the candidate's JOIN.
    const w = warmUp();
    const g = w.s.tick;
    const n = w.bytes.length;
    const { bytes: s } = encodeState({
      timeline: hash, senderTick: g + 30, phase: 0.5, g, senderFinal: g + 10, state: w.bytes,
      inputs: [[{ player: id(1), input: 0x1234, events: 0 }, { player: id(9), input: 0x0042, events: JOIN, joinPack: 1, coat: 2, name: 'Zo' }]],
    }, w.roster);
    expect([s[0], hexAt(s, 1, 8), u32At(s, 9), u16At(s, 13), u32At(s, 15), u32At(s, 19), u16At(s, 23), Array.from(s.subarray(25, 25 + n))])
      .toEqual([T.STATE, hash, g + 30, 32768, g, g + 10, n, Array.from(w.bytes)]);
    const o = 25 + n;
    expect([s[o], hexAt(s, o + 1, 16), u16At(s, o + 17)]).toEqual([1, id(9), 1]);
    const r = o + 19;
    expect([s[r], s[r + 1], u16At(s, r + 2), s[r + 4], s[r + 5], u16At(s, r + 6), s[r + 8], s[r + 9], s[r + 10], s[r + 11], s[r + 12], hexAt(s, r + 13, 2), s.length])
      .toEqual([2, 1, 0x1234, 0, 2, 0x0042, 1, KIND.JOIN, 1, 2, 2, '5a6f', r + 15]);
  });

  it("decodes STATE's state with the simulation's parameters, and refuses one valid.ts refuses or at another tick than g", () => {
    const w = warmUp();
    const msg = (bytes: Uint8Array, g: number): Uint8Array =>
      encodeState({ timeline: hash, senderTick: g + 30, phase: 0, g, senderFinal: g + 10, state: bytes, inputs: [] }, w.roster).bytes;
    expect(decode(msg(w.bytes, w.s.tick))).not.toBeNull();
    expect(decode(msg(w.bytes, w.s.tick + 1))).toBeNull();
    expect(decode(msg(w.bytes, w.s.tick - 1))).toBeNull();
    expect(decode(msg(w.bytes.subarray(1), w.s.tick))).toBeNull();
    // Coat 2 is in a list of 8 but not of 2.
    expect(decode(msg(w.bytes, w.s.tick), simParams({ ...config, coatCount: 2 }))).toBeNull();
    const s = { ...w.s, terriers: w.s.terriers.map((x) => ({ ...x, coat: P.coatCount })) };
    expect(decode(msg(encodeMatchState(s), w.s.tick))).toBeNull();
  });

  it('builds the ID table from the records, in the order its IDs first appear, leaving out IDs that are not players', () => {
    const w = warmUp();
    const inputs: InputRecord[][] = [
      [{ player: id(20), input: 1, events: 0 }, { player: 'not an ID', input: 2, events: JOIN, joinPack: 0 }, { player: id(0), input: 3, events: 0 }],
      [{ player: id(21), input: 4, events: 0 }, { player: id(20), input: 5, events: 0 }, { player: id(21), input: 6, events: READY }],
    ];
    const { bytes, kept } = encodeState({ timeline: hash, senderTick: w.s.tick + 5, phase: 0, g: w.s.tick, senderFinal: w.s.tick, state: w.bytes, inputs }, w.roster);
    const m = decode(bytes) as StateMsg;
    expect([kept, m.roster, m.others]).toEqual([2, w.roster, [id(20), id(21)]]);
    // An ID's second input in a tick is left out: a record has one per ID.
    expect(m.inputs).toEqual([
      [{ player: id(20), input: 1, events: 0 }, { player: id(0), input: 3, events: 0 }],
      [{ player: id(21), input: 4, events: 0 }, { player: id(20), input: 5, events: 0 }],
    ]);
    // Indices: the roster's two, then the table's.
    const records = bytes.subarray(bytes.length - 18);
    expect([records[0], records[1], records[5], records[9], records[10], records[14]]).toEqual([2, 2, 0, 2, 3, 2]);
  });

  it("refuses a STATE input's unknown or repeated event kind, and a JOIN's name past 32 bytes", () => {
    const w = warmUp();
    // One record: terrier 0's input 0, then the event bytes given.
    const raw = (events: (w2: Writer) => Writer): Uint8Array =>
      events(new Writer().u8(T.STATE).hex(hash, 8).u32(w.s.tick + 20).u16(0).u32(w.s.tick).u32(w.s.tick)
        .u16(w.bytes.length).bytes(w.bytes).u8(0).u16(1).u8(1).u8(0).u16(0)).done();
    const kinds = (list: number[]): Uint8Array => raw((x) => list.reduce((y, k) => y.u8(k), x.u8(list.length)));
    expect((decode(kinds([KIND.READY])) as StateMsg).inputs).toEqual([[{ player: id(0), input: 0, events: READY }]]);
    for (const list of [[0], [6], [KIND.READY, KIND.READY], [KIND.LEAVE, KIND.UNREADY, KIND.LEAVE]]) expect(decode(kinds(list)), `${list}`).toBeNull();
    const named = (n: number): Uint8Array => raw((x) => x.u8(1).u8(KIND.JOIN).u8(1).u8(0).u8(n).bytes(utf8('x'.repeat(n))));
    expect((decode(named(32)) as StateMsg).inputs[0]![0]!.name).toBe('x'.repeat(32));
    expect(decode(named(33))).toBeNull();
  });

  it("keeps a STATE's records within its tick bounds, so an answer after the clock jumps back still lands (§5.5)", () => {
    expect([stateRecordsMax(100, 100, 100), stateRecordsMax(100, 120, 133), stateRecordsMax(0, 0, 282)]).toEqual([2, 35, 284]);
    // The sender's final tick before g or past its clock, or a clock too far past g: none.
    expect([stateRecordsMax(100, 99, 133), stateRecordsMax(100, 134, 133), stateRecordsMax(0, 0, 283)]).toEqual([-1, -1, -1]);
    const w = warmUp();
    const g = w.s.tick;
    // localTick g + 40, finalTick w ticks behind it, and records to localTick + d.
    const localTick = g + 40;
    const inputs: InputRecord[][] = Array.from({ length: localTick + 2 - g }, (_, k) => [{ player: id(0), input: k, events: 0 }]);
    const answer = (senderTick: number): { bytes: Uint8Array; kept: number } =>
      encodeState({ timeline: hash, senderTick, phase: 0.5, g, senderFinal: localTick - 12, state: w.bytes, inputs }, w.roster);
    // The clock 7 ticks back: 35 records, to the clock's tick + d, and it decodes.
    const back7 = answer(localTick - 7);
    expect(back7.kept).toBe(35);
    expect((decode(back7.bytes) as StateMsg).inputs).toEqual(inputs.slice(0, 35));
    // 13 back, behind the final tick: no records, and nobody takes it.
    const back13 = answer(localTick - 13);
    expect([back13.kept, decode(back13.bytes)]).toEqual([0, null]);
    // Its bounds are the limits it's given, as decode's are: at d = 3, one record more.
    const L3 = { ...wireLimits(), delay: 3 };
    const d3 = encodeState({ timeline: hash, senderTick: localTick, phase: 0, g, senderFinal: localTick - 12, state: w.bytes, inputs: [...inputs, []] }, w.roster, L3);
    expect([d3.kept, stateRecordsMax(g, localTick - 12, localTick, L3)]).toEqual([43, 43]);
    expect(decode(d3.bytes, P, L3)).not.toBeNull();
    expect(decode(d3.bytes)).toBeNull();
  });

  it('takes encodings no encoder writes to the message the encoder writes: decode is not byte-canonical (§5.8)', () => {
    // A history entry written out that equals the next newer, two bytes more than its same bit.
    const spelled = rawHead(0, 7).u16(0b1).u16(0).u16(7).u8(0).u8(0).done();
    const m = decode(spelled) as Tick;
    const canonical = encodeTick(m);
    expect([canonical.length, decode(canonical)]).toEqual([spelled.length - 2, m]);
    // A sender's events with their backs interleaved and kinds descending.
    const events = rawHead(0, 7).u16(0b111).u16(0b111).u8(3).u8(3).u8(KIND.UNREADY).u8(0).u8(KIND.LEAVE).u8(3).u8(KIND.READY).u8(0).done();
    const e = decode(events) as Tick;
    expect(e.own?.events).toEqual([{ back: 3, events: READY | UNREADY }, { back: 0, events: LEAVE }]);
    expect(decode(encodeTick(e))).toEqual(e);
    // A STATE input's kinds descending.
    const w = warmUp();
    const state = new Writer().u8(T.STATE).hex(hash, 8).u32(w.s.tick + 20).u16(0).u32(w.s.tick).u32(w.s.tick)
      .u16(w.bytes.length).bytes(w.bytes).u8(0).u16(1).u8(1).u8(0).u16(0).u8(2).u8(KIND.UNREADY).u8(KIND.READY).done();
    const s = decode(state) as StateMsg;
    expect(s.inputs).toEqual([[{ player: id(0), input: 0, events: READY | UNREADY }]]);
    const again = encodeState({ timeline: s.timeline, senderTick: s.senderTick, phase: s.phase, g: s.g, senderFinal: s.senderFinal, state: s.state, inputs: s.inputs }, s.roster);
    expect(decode(again.bytes)).toEqual(s);
  });

  it('reads its bounds from the configuration, and refuses a configuration the wire cannot carry', () => {
    expect(wireLimits()).toEqual({
      messageMaxBytes: config.messageMaxBytes, nameMaxBytes: config.displayNameMaxBytes, inputHistory: config.inputHistoryTicks,
      botsMax: BOT_SLOTS, peersMax: config.meshPlayersMax + config.spectatorsMax - 1,
      historyTicks: config.stateHistoryTicks, window: config.lateWindowTicks, delay: config.inputDelayTicks,
    });
    // Each bound from its own setting: eight values apart, the vote window a ninth it doesn't read.
    expect(wireLimits({
      ...config, messageMaxBytes: 15000, displayNameMaxBytes: 31, inputHistoryTicks: 15, meshPlayersMax: 7, spectatorsMax: 3,
      stateHistoryTicks: 200, lateWindowTicks: 11, voteWindowTicks: 13, inputDelayTicks: 3,
    })).toEqual({ messageMaxBytes: 15000, nameMaxBytes: 31, inputHistory: 15, botsMax: BOT_SLOTS, peersMax: 9, historyTicks: 200, window: 11, delay: 3 });
    expect(BOT_SLOTS).toBe(8);
    expect(() => wireLimits({ ...config, inputHistoryTicks: 17 })).toThrow(/16-bit masks/);
    expect(() => wireLimits({ ...config, displayNameMaxBytes: 256 })).toThrow(/a name: 256/);
    expect(() => wireLimits({ ...config, spectatorsMax: 250 })).toThrow(/PEERS' IDs: 257/);
  });
});
