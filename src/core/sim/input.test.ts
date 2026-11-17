import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  barkCount, canonicalInputs, encodeInput, FRAME_BALL, FRAME_NOSE, FRAME_PITCH, frameOf, heldDirection, isPlayerId, JOIN, jumpCount,
  KEPT_BITS, LEAVE, mirrorInput, pounceCount, READY, sameInputs, stepOf, SWITCH, type TickInput, UNREADY, ZOOMIES,
} from './input';

// A.2's u16 and the per-tick input (design §1.3, §5.1).

/** Everything the simulation reads of an input: the bark bits and bit 15 aside. */
const reads = (x: number): string => [stepOf(x), frameOf(x), heldDirection(x), (x & ZOOMIES) !== 0, jumpCount(x), pounceCount(x), x & KEPT_BITS].join();

// The loops below collect what's wrong and assert once: an expect a value
// would make each loop a second or more.
const hex = (x: number): string => `0x${x.toString(16)}`;

describe("A.2's input", () => {
  it('encodes and decodes every combination of its parts', () => {
    const wrong: string[] = [];
    for (const step of [undefined, ...Array.from({ length: 32 }, (_, k) => k)]) {
      for (let frame = 0; frame < 4; frame++) {
        for (const zoomies of [false, true]) {
          for (let jump = 0; jump < 4; jump++) {
            for (let pounce = 0; pounce < 4; pounce++) {
              for (let bark = 0; bark < 4; bark++) {
                const x = encodeInput({ ...(step === undefined ? {} : { step, frame }), zoomies, jump, pounce, bark });
                const got = [x >>> 15, heldDirection(x), stepOf(x), frameOf(x), (x & ZOOMIES) !== 0, jumpCount(x), pounceCount(x), barkCount(x)];
                // Bit 15 and above are 0 when sent; no step, no direction and frame 0.
                const want = [0, step !== undefined && frame !== 3, step ?? 0, step === undefined ? 0 : frame, zoomies, jump, pounce, bark];
                if (got.join() !== want.join()) wrong.push(`step ${step}, frame ${frame}: ${got.join()} for ${want.join()}`);
              }
            }
          }
        }
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    // Counters are taken mod 4, and the frame defaults to the pitch's.
    expect(encodeInput({ jump: 5, pounce: 6, bark: 7 })).toBe(encodeInput({ jump: 1, pounce: 2, bark: 3 }));
    expect(frameOf(encodeInput({ step: 3 }))).toBe(FRAME_PITCH);
    expect(encodeInput({})).toBe(0);
  });

  it('reads every u16, and bits 13–15 change nothing the simulation reads', () => {
    const wrong: string[] = [];
    for (let x = 0; x <= 0xffff; x++) {
      const inRange = stepOf(x) < 32 && frameOf(x) < 4 && jumpCount(x) < 4 && pounceCount(x) < 4 && barkCount(x) === ((x >>> 13) & 3);
      // x & KEPT_BITS is x with bits 13–15 cleared: every low part meets every high part.
      if (!inRange || reads(x & KEPT_BITS) !== reads(x)) wrong.push(hex(x));
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    // Frame 3 reads as no direction held, whatever bit 5 says.
    expect(heldDirection(encodeInput({ step: 4, frame: 3 }))).toBe(false);
    expect(heldDirection(0x20)).toBe(true);
  });

  it("mirrors a held pitch-frame step by 16 and leaves every other input alone (P8)", () => {
    const wrong: string[] = [];
    for (let x = 0; x <= 0xffff; x++) {
      const m = mirrorInput(x);
      const turned = heldDirection(x) && frameOf(x) === FRAME_PITCH;
      const ok = mirrorInput(m) === x && (turned ? stepOf(m) === (stepOf(x) + 16) % 32 && (m & ~0x1f) === (x & ~0x1f) : m === x);
      if (!ok) wrong.push(hex(x));
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(mirrorInput(encodeInput({ step: 3, zoomies: true, jump: 1 }))).toBe(encodeInput({ step: 19, zoomies: true, jump: 1 }));
    expect(mirrorInput(encodeInput({ step: 20 }))).toBe(encodeInput({ step: 4 }));
    for (const frame of [FRAME_BALL, FRAME_NOSE]) expect(mirrorInput(encodeInput({ step: 3, frame }))).toBe(encodeInput({ step: 3, frame }));
  });
});

// --- The per-tick input ---

const id = (k: number): string => k.toString(16).padStart(32, '0');
const POOL = [id(1), id(2), id(0xabc), 'f'.repeat(32), `8${'0'.repeat(30)}1`];
const BAD_IDS = ['', 'F'.repeat(32), '0'.repeat(31), '0'.repeat(33), `${'0'.repeat(31)}g`, ` ${'0'.repeat(31)}`, 'é'.repeat(32)];

/** A TickInput's content as text, −0 and NaN told apart, absent fields as such. */
const content = (x: TickInput): string =>
  [x.id, x.input, x.events, x.joinPack, x.coat, x.name, x.switchPack]
    .map((v) => (v === undefined ? '∅' : typeof v === 'string' ? JSON.stringify(v) : Object.is(v, -0) ? '-0' : String(v)))
    .join('|');

const number = fc.oneof(fc.integer({ min: 0, max: 0xffff }), fc.integer(), fc.double(), fc.constantFrom(0, -0, NaN, Infinity, -Infinity, 0x10000 + 5));
const byte = fc.oneof(fc.integer({ min: 0, max: 255 }), number);
const tickInput: fc.Arbitrary<TickInput> = fc.record(
  {
    id: fc.oneof({ weight: 6, arbitrary: fc.constantFrom(...POOL) }, { weight: 1, arbitrary: fc.constantFrom(...BAD_IDS) }),
    input: number,
    events: fc.oneof(fc.integer({ min: 0, max: 31 }), number),
    joinPack: byte,
    coat: byte,
    name: fc.oneof(fc.string({ maxLength: 4 }), fc.constantFrom('', 'Rex', '\u0000', '\ud800')),
    switchPack: byte,
  },
  { requiredKeys: ['id', 'input', 'events'] },
);
/** A list, a shuffle of it with some entries duplicated, by sort keys. */
const shuffled = fc
  .array(fc.tuple(tickInput, fc.nat(), fc.boolean()), { maxLength: 14 })
  .map((rows) => {
    const list = rows.map(([x]) => x);
    const other = [...rows].sort((a, b) => a[1] - b[1]).flatMap(([x, , twice]) => (twice ? [x, x] : [x]));
    return { list, other };
  });

describe('canonicalInputs (P4)', () => {
  it('gives one valid input an ID, in ID order, whatever order and duplicates they arrive in', () => {
    fc.assert(
      fc.property(shuffled, ({ list, other }) => {
        const a = canonicalInputs(list);
        const b = canonicalInputs(other);
        expect(a.map(content)).toEqual(b.map(content));
        const ids = a.map((x) => x.id);
        expect(ids.every(isPlayerId)).toBe(true);
        expect(ids).toEqual([...new Set(list.filter((x) => isPlayerId(x.id)).map((x) => x.id))].sort());
        expect(sameInputs(list, other)).toBe(true);
      }),
    );
  });

  it('keeps the copy whose content sorts first, field by field', () => {
    const at = id(7);
    const pick = (...copies: TickInput[]): string => {
      const forward = canonicalInputs(copies).map(content);
      const back = canonicalInputs([...copies].reverse()).map(content);
      expect(forward).toEqual(back);
      return forward.join('\n');
    };
    const base: TickInput = { id: at, input: 5, events: 0 };
    expect(pick(base, { ...base, input: 4 })).toBe(content({ ...base, input: 4 }));
    expect(pick(base, { ...base, events: JOIN })).toBe(content(base));
    expect(pick({ ...base, joinPack: 1 }, base)).toBe(content(base)); // absent first
    expect(pick({ ...base, coat: 3 }, { ...base, coat: 2 })).toBe(content({ ...base, coat: 2 }));
    expect(pick({ ...base, name: 'b' }, { ...base, name: 'a' })).toBe(content({ ...base, name: 'a' }));
    expect(pick({ ...base, switchPack: 1 }, { ...base, switchPack: 0 })).toBe(content({ ...base, switchPack: 0 }));
    // −0 before +0, and NaN after every number.
    expect(pick({ ...base, input: 0 }, { ...base, input: -0 })).toBe(content({ ...base, input: -0 }));
    expect(pick({ ...base, input: NaN }, { ...base, input: 9 })).toBe(content({ ...base, input: 9 }));
  });

  it('drops invalid IDs and never touches its input', () => {
    const list: TickInput[] = [...BAD_IDS, id(3)].map((x) => Object.freeze({ id: x, input: 1, events: 0 }));
    Object.freeze(list);
    const before = list.map(content);
    expect(canonicalInputs(list).map((x) => x.id)).toEqual([id(3)]);
    expect(list.map(content)).toEqual(before);
    expect(isPlayerId(42 as unknown as string)).toBe(false);
  });

  it('sets the length of the list it writes into, so a longer earlier call leaves nothing', () => {
    const out: TickInput[] = [];
    const many = POOL.map((x): TickInput => ({ id: x, input: 0, events: 0 }));
    expect(canonicalInputs(many, out)).toBe(out);
    expect(out).toHaveLength(POOL.length);
    canonicalInputs([many[2]!, { id: 'bad', input: 0, events: 0 }], out);
    expect(out).toEqual([many[2]]);
    canonicalInputs([], out);
    expect(out).toEqual([]);
    // It may canonicalise a list in place.
    const list = [many[3]!, many[0]!, many[3]!, { id: 'bad', input: 0, events: 0 }, many[1]!];
    expect(canonicalInputs(list, list).map((x) => x.id)).toEqual([many[0]!.id, many[1]!.id, many[3]!.id]);
    expect(list).toHaveLength(3);
  });

  it('keeps both packs of a JOIN and a SWITCH in one input (D-12)', () => {
    const both: TickInput = { id: id(9), input: 0, events: JOIN | SWITCH | READY, joinPack: 0, coat: 3, name: 'Rex', switchPack: 1 };
    const [kept] = canonicalInputs([both]);
    expect(kept).toEqual(both);
    expect([kept!.joinPack, kept!.switchPack]).toEqual([0, 1]);
    // And the two packs are told apart.
    expect(sameInputs([both], [{ ...both, joinPack: 1, switchPack: 0 }])).toBe(false);
    expect([JOIN, LEAVE, READY, UNREADY, SWITCH].reduce((a, b) => a | b)).toBe(31); // five bits, one each
  });
});

describe('sameInputs (D-11)', () => {
  it('tells apart lists that canonicalise to different inputs', () => {
    const a: TickInput = { id: id(1), input: 3, events: 0 };
    const b: TickInput = { id: id(2), input: 3, events: READY };
    expect(sameInputs([a, b], [b, a, a])).toBe(true);
    expect(sameInputs([a, b], [a])).toBe(false);
    expect(sameInputs([a], [{ ...a, input: 4 }])).toBe(false);
    expect(sameInputs([a], [{ ...a, name: '' }])).toBe(false);
    expect(sameInputs([a, { id: 'nope', input: 9, events: 0 }], [a])).toBe(true);
    expect(sameInputs([], [])).toBe(true);
  });
});
