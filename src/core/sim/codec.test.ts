import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { canonicalRules, config, type MatchRules, NO_RULES, RULE_SETTINGS } from '../../config';
import { BOT_NAMES } from '../bot/bot-id';
import { CODEC_VERSION, decodeState, encodeState, hashState } from './codec';
import { bytesToHash, hash64, hashToBytes } from './hash';
import { KEPT_BITS } from './input';
import { defaultParams, paramsFor, type SimParams, simParams } from './params';
import {
  type AnimPhase, ballSlot, CELEBRATION, cleanName, cloneState, ENDED, findTerrier, genesis, IN_PLAY, isNameControl, KICKOFF_COUNTDOWN,
  type MatchState, nameAllowed, NEVER, newTerrier, type Pack, packCount, type Phase, slotOf, sortTerriers, STANDING, type Terrier, WARM_UP,
} from './state';
import { stateProblems } from './valid';

// The canonical bytes (A.1; design §1.6, §2.2), and what they rest on: the
// hash (design §1.2), the state's helpers and name rule (design §1.4), and
// valid.ts's structural checks (design §6.7). The property runs take about a
// second, so on a busy worker pool they get more than vitest's 5 s.
vi.setConfig({ testTimeout: 120_000 });

const P = defaultParams;
const id = (k: number): string => k.toString(16).padStart(32, '0');
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
/** Byte for byte: an expect on typed arrays costs about a millisecond a
 *  kilobyte, too slow for the loops below. */
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

// --- States: a fixed one, and any valid one ---

/** A 2-a-side match in play at tick 500, terrier 0 slipping off the ball. */
function base(): MatchState {
  const s = genesis({ packSize: 2, matchMinutes: 3 });
  for (let slot = 0; slot < 4; slot++) {
    const t = newTerrier(id(0xa0 + slot), `Terrier ${slot}`, (slot & 1) as Pack, slot, 10, P);
    t.spot = slot >> 1;
    t.x = slot - 1.5;
    s.terriers.push(t);
  }
  s.phase = IN_PLAY;
  s.phaseStart = 480;
  s.tick = 500;
  s.clock = 1000;
  const t0 = s.terriers[0]!;
  t0.slipping = true;
  t0.slipFrom = ballSlot(2);
  return s;
}

const u8 = fc.integer({ min: 0, max: 0xff });
const u16 = fc.integer({ min: 0, max: 0xffff });
const u32 = fc.oneof(fc.integer({ min: 0, max: 0xffffffff }), fc.constant(NEVER), fc.constant(0));
const i32 = fc.integer({ min: -0x80000000, max: 0x7fffffff });
const float = fc.oneof(
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.double({ min: -30, max: 30, noNaN: true }),
  fc.constantFrom(0, -0, 5e-324, -5e-324, Number.MAX_VALUE, -Number.MAX_VALUE),
);
const hexId = fc.uint8Array({ minLength: 16, maxLength: 16 }).map((b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''));
const NAMES = ['', 'Rex', ...BOT_NAMES, '\ufeffBOM first', 'Ünïcödé', '🐶 and 🐕\u200d🦺', 'x'.repeat(20), 'é'.repeat(16), '狗'.repeat(10)];
const name = fc.oneof(fc.constantFrom(...NAMES), fc.string({ unit: 'grapheme', maxLength: 6 }).filter((n) => nameAllowed(n, P)));

/** A terrier in a slot, whose slipped-from names the ball, another present
 *  slot, or nothing. Its ID is set with the others', unique. */
function terrier(slot: number, slots: readonly number[], packSize: number, tick: number, M: SimParams): fc.Arbitrary<Terrier> {
  const from = [ballSlot(packSize), ...slots.filter((k) => k !== slot)];
  return fc
    .record({
      x: float, y: float, z: float, vx: float, vy: float, vz: float, onFloor: fc.boolean(),
      id: fc.constant(''), name, pack: fc.constant((slot & 1) as Pack), spot: fc.constant(slot >> 1),
      coat: fc.integer({ min: 0, max: P.coatCount - 1 }),
      joinTick: fc.integer({ min: 0, max: tick }),
      readyUntil: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: tick + P.readyExpiryTicks })),
      lastInputTick: fc.integer({ min: 0, max: tick }),
      prevInput: fc.integer({ min: 0, max: KEPT_BITS }),
      heading: u32, overheadRef: u32,
      sitting: fc.boolean(), zoomLocked: fc.boolean(), ballOverhead: fc.boolean(), slipping: fc.boolean(), touchingBall: fc.boolean(),
      slipFrom: fc.constantFrom(-1, ...from),
      meter: fc.integer({ min: 0, max: M.meterFull }),
      pounceWait: fc.integer({ min: 0, max: M.pounceWaitTicks }),
      lunge: fc.integer({ min: 0, max: M.lungeTicks }),
      tumble: fc.integer({ min: 0, max: M.tumbleTicks }),
      guard: fc.integer({ min: 0, max: M.guardTicks }),
      touches: u16, goals: u8,
      anim: fc.integer({ min: 0, max: 7 }).map((a) => a as AnimPhase), animStart: u32, gait: u32,
      takeOffTick: u32, landingTick: u32, lastBallContactTick: u32, lastTerrierContactTick: u32, lastPushDir: u32, lastPushTick: u32,
      headingChange: i32,
    })
    .map((t) => ({ ...t, slipping: t.slipFrom !== -1 }));
}

/** Any match rules (C-59): each rule the build's own setting or another of its choices. */
const matchRules: fc.Arbitrary<MatchRules> = fc
  .tuple(...RULE_SETTINGS.map((k) => fc.option(fc.constantFrom(...config.matchRules[k].filter((v) => v !== config[k])), { nil: undefined })))
  .map((values) => canonicalRules(Object.fromEntries(RULE_SETTINGS.map((k, i) => [k, values[i]])), config));

/** Any valid state, the rules' checks of §6.7 included: in warm-up any
 *  roster, and from the start countdown on, both packs full; overtime only
 *  from the kickoff countdown on, with the clock in the match otherwise;
 *  the tick under 2^31, and the phase's start no later; scorers only in a
 *  celebration or the end; Ready within its expiry, and join and input
 *  ticks no later than the tick; and none or any match rules, the timers
 *  within the maxima of the match's own parameters (C-59). */
const state: fc.Arbitrary<MatchState> = fc
  .record({
    rules: fc.oneof(fc.constant(NO_RULES), matchRules),
    packSize: fc.integer({ min: 1, max: 4 }),
    phase: fc.integer({ min: 0, max: 5 }).map((p) => p as Phase),
    tick: fc.oneof(fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 0x7fffffff })),
    here: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
  })
  .chain(({ rules, packSize, phase, tick, here }) => {
    const slots = Array.from({ length: 2 * packSize }, (_, k) => k).filter((k) => phase !== WARM_UP || here[k]);
    const M = paramsFor(rules);
    return fc
      .record({
        phaseStart: fc.integer({ min: 0, max: tick }),
        overtime: phase >= KICKOFF_COUNTDOWN ? fc.boolean() : fc.constant(false),
        matchLengthTicks: fc.integer({ min: 1, max: 0xffffffff }),
        clock: u32,
        score: fc.tuple(u8, u8),
        lastGoalTick: u32, lastGoalPack: fc.constantFrom<Pack>(0, 1), ownGoal: fc.boolean(),
        scorers: phase === CELEBRATION || phase === ENDED ? fc.integer({ min: 0, max: (1 << slots.length) - 1 }) : fc.constant(0),
        ball: fc.record({
          x: float, y: float, z: float, vx: float, vy: float, vz: float, onFloor: fc.boolean(),
          lastHitTick: u32, lastHitStrength: float, lastHitDvx: float, lastHitDvy: float, lastHitDvz: float, lastContactTick: u32,
        }),
        terriers: fc.tuple(...slots.map((slot) => terrier(slot, slots, packSize, tick, M))),
        ids: fc.uniqueArray(hexId, { minLength: slots.length, maxLength: slots.length }),
      })
      .map(({ ids, clock, terriers, ...rest }): MatchState => ({
        ...rest, phase, tick, packSize, rules,
        clock: rest.overtime ? clock : clock % (rest.matchLengthTicks + 1),
        terriers: terriers.map((t, k) => ({ ...t, id: ids[k]! })),
      }));
  });

// --- A.1's layout ---

const AFTER_NAME = 125;
// Each field's offset from the end of a terrier's name.
const F = {
  pack: 0, spot: 1, coat: 2, joinTick: 3, readyUntil: 7, lastInputTick: 11, prevInput: 15, heading: 17, overheadRef: 21,
  x: 25, y: 33, z: 41, vx: 49, vy: 57, vz: 65, flags: 73, slipFrom: 74, meter: 75, pounceWait: 77, lunge: 79, tumble: 81, guard: 83,
  touches: 85, goals: 87, anim: 88, animStart: 89, gait: 93, takeOffTick: 97, landingTick: 101,
  lastBallContactTick: 105, lastTerrierContactTick: 109, lastPushDir: 113, lastPushTick: 117, headingChange: 121,
} as const;

/** Where terrier k's ID, and its fields after its name, start in an encoding. */
function terrierAt(bytes: Uint8Array, k: number): { start: number; after: number } {
  let o = 120;
  for (let j = 0; ; j++) {
    const start = o;
    const after = o + 17 + bytes[o + 16]!;
    if (j === k) return { start, after };
    o = after + AFTER_NAME;
  }
}

/** The state with its bytes changed: null if decodeState refuses them. */
function decodedAfter(s: MatchState, change: (bytes: Uint8Array, v: DataView) => void): MatchState | null {
  const bytes = encodeState(s);
  change(bytes, new DataView(bytes.buffer));
  expect(() => decodeState(bytes)).not.toThrow();
  return decodeState(bytes);
}

/** The state changed in memory, encoded and decoded: null if refused. */
function decodedWith(change: (s: MatchState) => void): MatchState | null {
  const s = base();
  change(s);
  return decodeState(encodeState(s));
}

describe('the codec (A.1, design §1.6)', () => {
  it('lays the bytes out as A.1 says, 120 of them and 142 a terrier plus its name', () => {
    const s = base();
    Object.assign(s, { phaseStart: 0x01020304, overtime: true, tick: 0x05060708, clock: 7, score: [3, 4], lastGoalTick: 9, lastGoalPack: 1, ownGoal: true, scorers: 5 });
    Object.assign(s.ball, { x: 1.5, y: -2.5, z: 0.8, vx: 3, vy: -0, vz: 4, onFloor: false, lastHitTick: 11, lastHitStrength: 2.5, lastHitDvx: 0.25, lastHitDvy: -0.5, lastHitDvz: 1, lastContactTick: 12 });
    const t = s.terriers[1]!;
    Object.assign(t, {
      name: 'Ünï', coat: 6, joinTick: 13, readyUntil: 14, lastInputTick: 15, prevInput: 0x1abc, heading: 0xfedcba98, overheadRef: 17,
      x: 1.25, y: 2.25, z: 3.25, vx: 4.25, vy: 5.25, vz: 6.25, onFloor: true, sitting: false, zoomLocked: true, ballOverhead: false,
      slipping: true, slipFrom: 2, touchingBall: true, meter: 300, pounceWait: 80, lunge: 17, tumble: 70, guard: 60, touches: 65535, goals: 255,
      anim: 6, animStart: 18, gait: 19, takeOffTick: 20, landingTick: 21, lastBallContactTick: 22, lastTerrierContactTick: 23,
      lastPushDir: 24, lastPushTick: 25, headingChange: -26,
    });
    const bytes = encodeState(s);
    const v = new DataView(bytes.buffer);
    // A match without rules: version 1's layout, as before the match rules (C-59).
    expect([v.getUint16(0, true), bytes[2], v.getUint32(3, true), bytes[7], v.getUint32(8, true), bytes[12]]).toEqual([1, IN_PLAY, 0x01020304, 1, 0x05060708, 2]);
    expect([v.getUint32(13, true), v.getUint32(17, true), bytes[21], bytes[22], v.getUint32(23, true), bytes[27], bytes[28], bytes[29]]).toEqual([3 * 3600, 7, 3, 4, 9, 1, 1, 5]);
    expect([30, 38, 46, 54, 62, 70].map((o) => v.getFloat64(o, true))).toEqual([1.5, -2.5, 0.8, 3, -0, 4]);
    expect([bytes[78], v.getUint32(79, true), v.getFloat64(83, true), v.getFloat64(91, true), v.getFloat64(99, true), v.getFloat64(107, true)]).toEqual([0, 11, 2.5, 0.25, -0.5, 1]);
    expect([v.getUint32(115, true), bytes[119]]).toEqual([12, 4]);
    const { start, after } = terrierAt(bytes, 1);
    expect(Array.from(bytes.subarray(start, start + 16), (b) => b.toString(16).padStart(2, '0')).join('')).toBe(t.id);
    expect(bytes.subarray(start + 17, after)).toEqual(utf8('Ünï'));
    expect(bytes[start + 16]).toBe(utf8('Ünï').length);
    const a = after;
    expect([bytes[a + F.pack], bytes[a + F.spot], bytes[a + F.coat]]).toEqual([1, 0, 6]);
    expect([F.joinTick, F.readyUntil, F.lastInputTick].map((o) => v.getUint32(a + o, true))).toEqual([13, 14, 15]);
    expect([v.getUint16(a + F.prevInput, true), v.getUint32(a + F.heading, true), v.getUint32(a + F.overheadRef, true)]).toEqual([0x1abc, 0xfedcba98, 17]);
    expect([F.x, F.y, F.z, F.vx, F.vy, F.vz].map((o) => v.getFloat64(a + o, true))).toEqual([1.25, 2.25, 3.25, 4.25, 5.25, 6.25]);
    expect([bytes[a + F.flags], bytes[a + F.slipFrom]]).toEqual([1 | 4 | 16 | 32, 3]);
    expect([F.meter, F.pounceWait, F.lunge, F.tumble, F.guard, F.touches].map((o) => v.getUint16(a + o, true))).toEqual([300, 80, 17, 70, 60, 65535]);
    expect([bytes[a + F.goals], bytes[a + F.anim]]).toEqual([255, 6]);
    const u32s = [F.animStart, F.gait, F.takeOffTick, F.landingTick, F.lastBallContactTick, F.lastTerrierContactTick, F.lastPushDir, F.lastPushTick];
    expect(u32s.map((o) => v.getUint32(a + o, true))).toEqual([18, 19, 20, 21, 22, 23, 24, 25]);
    expect(v.getInt32(a + F.headingChange, true)).toBe(-26);
    expect(terrierAt(bytes, 2).start).toBe(a + AFTER_NAME);
    // A.1's sizes: 30 + 89 + 1, then 142 a terrier plus its name.
    expect(encodeState(genesis({ packSize: 1, matchMinutes: 1 }))).toHaveLength(120);
    const full = genesis({ packSize: 4, matchMinutes: 1 });
    for (let slot = 0; slot < 8; slot++) {
      const u = newTerrier(id(slot + 1), 'n'.repeat(32), (slot & 1) as Pack, 0, 0, P);
      u.spot = slot >> 1;
      full.terriers.push(u);
    }
    expect(encodeState(full)).toHaveLength(1512);
  });

  it("lays a match with rules out in version 2: version 1's bytes with a byte a rule after the match length (C-59)", () => {
    const R = RULE_SETTINGS.length;
    const first = RULE_SETTINGS[0]!;
    const last = RULE_SETTINGS[R - 1]!;
    const plain = base();
    const ruled = base();
    const rules = canonicalRules({ [first]: config.matchRules[first][0], [last]: config.matchRules[last].at(-1) }, config);
    Object.assign(ruled, { rules });
    const a = encodeState(plain);
    const b = encodeState(ruled);
    expect(CODEC_VERSION).toBe(2);
    expect(b.length).toBe(a.length + R);
    expect([new DataView(b.buffer).getUint16(0, true), b[0], b[1]]).toEqual([2, 2, 0]);
    // The header to the match length as version 1's, then the rules: 0 for the build's own setting, else
    // 1 + the choice's index, then the rest as version 1's.
    expect(Array.from(b.subarray(2, 17))).toEqual(Array.from(a.subarray(2, 17)));
    expect(Array.from(b.subarray(17, 17 + R))).toEqual(RULE_SETTINGS.map((_, k) => (k === 0 ? 1 : k === R - 1 ? config.matchRules[last].length : 0)));
    expect(Array.from(b.subarray(17 + R))).toEqual(Array.from(a.subarray(17)));
    const back = decodeState(b)!;
    expect(back.rules).toEqual(rules);
    expect(back).toEqual(ruled);
    // A match without rules is never written in version 2, so a block of zeros is refused, and so are a
    // byte past its rule's choices and the choice that's the build's own setting, written as 0.
    const zeros = b.slice();
    zeros.fill(0, 17, 17 + R);
    expect(decodeState(zeros)).toBeNull();
    const past = b.slice();
    past[17] = config.matchRules[first].length + 1;
    expect(decodeState(past)).toBeNull();
    const own = b.slice();
    own[17] = 1 + (config.matchRules[first] as readonly number[]).indexOf(config[first]);
    expect(decodeState(own)).toBeNull();
    // Version 1's bytes read as version 2 are short or wrong, and version 3 is refused.
    const asTwo = a.slice();
    asTwo[0] = 2;
    expect(decodeState(asTwo)).toBeNull();
    const three = b.slice();
    three[0] = 3;
    expect(decodeState(three)).toBeNull();
    // A state built by hand with a rule at the build's own setting encodes but never decodes.
    const byHand = base();
    Object.assign(byHand, { rules: { [first]: config[first] } });
    expect(decodeState(encodeState(byHand))).toBeNull();
    // And its timers are checked against the match's own maxima: a tumble the defaults refuse, under a
    // longer tumble's rule, decodes.
    const longer = (config.matchRules.tumbleSeconds as readonly number[]).find((x) => x > config.tumbleSeconds)!;
    const slow = base();
    Object.assign(slow, { rules: canonicalRules({ tumbleSeconds: longer }, config) });
    slow.terriers[2]!.tumble = P.tumbleTicks + 1;
    expect(decodeState(encodeState(slow))?.terriers[2]!.tumble).toBe(P.tumbleTicks + 1);
    const plainSlow = base();
    plainSlow.terriers[2]!.tumble = P.tumbleTicks + 1;
    expect(decodeState(encodeState(plainSlow))).toBeNull();
  });

  it('round-trips any valid state byte for byte, −0 included', () => {
    fc.assert(
      fc.property(state, (s) => {
        expect(stateProblems(s)).toEqual([]);
        const bytes = encodeState(s);
        const back = decodeState(bytes);
        expect(back).toEqual(s); // toEqual tells −0 from +0
        expect(sameBytes(encodeState(back!), bytes)).toBe(true);
        expect(hashState(s)).toBe(hash64(bytes));
      }),
      { numRuns: 300 },
    );
    const s = base();
    const zeros: (keyof typeof s.ball)[] = ['x', 'y', 'vx', 'vy', 'vz', 'lastHitStrength', 'lastHitDvx', 'lastHitDvy', 'lastHitDvz'];
    for (const k of zeros) Object.assign(s.ball, { [k]: -0 });
    Object.assign(s.terriers[2]!, { x: -0, y: -0, vx: -0, vy: -0, vz: -0 });
    const back = decodeState(encodeState(s))!;
    for (const k of zeros) expect(Object.is(back.ball[k], -0), k).toBe(true);
    expect(Object.is(back.terriers[2]!.vy, -0)).toBe(true);
    expect(encodeState(back)).toEqual(encodeState(s));
    expect(hashState(back)).not.toBe(hashState(base()));
  });

  it('refuses to encode NaN, +Infinity and −Infinity: in a body, the hit strength and the hit change (D-1)', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const places: [string, (s: MatchState) => void][] = [
        ["a terrier's x", (s) => (s.terriers[3]!.x = bad)],
        ["a terrier's vz", (s) => (s.terriers[0]!.vz = bad)],
        ["the ball's y", (s) => (s.ball.y = bad)],
        ["the ball's vx", (s) => (s.ball.vx = bad)],
        ["the ball's hit strength", (s) => (s.ball.lastHitStrength = bad)],
        ["the ball's hit change in x", (s) => (s.ball.lastHitDvx = bad)],
        ["the ball's hit change in y", (s) => (s.ball.lastHitDvy = bad)],
        ["the ball's hit change in z", (s) => (s.ball.lastHitDvz = bad)],
      ];
      for (const [what, change] of places) {
        const s = base();
        change(s);
        expect(() => encodeState(s), `${what} = ${bad}`).toThrow(/not a finite float/);
        expect(() => hashState(s), `${what} = ${bad}`).toThrow(/not a finite float/);
        expect(stateProblems(s).join('\n'), what).toMatch(/not finite/);
      }
    }
    // A refusal leaves the shared buffer ready for the next state.
    expect(decodeState(encodeState(base()))).toEqual(base());
  });

  it('refuses to encode a field outside its type', () => {
    const refusals: [RegExp, (s: MatchState) => void][] = [
      [/the tick is 1.5, not a u32/, (s) => (s.tick = 1.5)],
      [/the phase start is -1, not a u32/, (s) => (s.phaseStart = -1)],
      [/the clock is 4294967296, not a u32/, (s) => (s.clock = 2 ** 32)],
      [/pack A's score is 256, not a u8/, (s) => (s.score[0] = 256)],
      [/overtime is undefined, not a boolean/, (s) => ((s as { overtime: unknown }).overtime = undefined)],
      [/terrier 1's heading change is 2147483648, not an i32/, (s) => (s.terriers[1]!.headingChange = 2 ** 31)],
      [/terrier 2's touches is 65536, not a u16/, (s) => (s.terriers[2]!.touches = 65536)],
      [/terrier 0's sitting flag is 1, not a boolean/, (s) => ((s.terriers[0] as { sitting: unknown }).sitting = 1)],
      [/terrier 0's slipped-from slot \+ 1 is -1, not a u8/, (s) => (s.terriers[0]!.slipFrom = -2)],
      [/terrier 3's ID is "A{32}", not 32 lower-case hex digits/, (s) => (s.terriers[3]!.id = 'A'.repeat(32))],
      [/terrier 1's name .* no lone surrogate/, (s) => (s.terriers[1]!.name = 'a\ud83d')],
      [/terrier 1's name .* no lone surrogate/, (s) => (s.terriers[1]!.name = '\udc36b')],
      [/terrier 2's name .* at most 255 bytes/, (s) => (s.terriers[2]!.name = '狗'.repeat(86))],
    ];
    for (const [message, change] of refusals) {
      const s = base();
      change(s);
      expect(() => encodeState(s), String(message)).toThrow(message);
    }
    // 255 bytes is the most a name's length byte holds.
    const s = base();
    s.terriers[2]!.name = '狗'.repeat(85);
    expect(encodeState(s)).toHaveLength(encodeState(base()).length - utf8('Terrier 2').length + 255);
  });

  it('refuses to encode match rules holding a key that names no rule, alone or beside a rule, which stateProblems reports too (C-59)', () => {
    const first = RULE_SETTINGS[0]!;
    const rule = config.matchRules[first].find((v) => !Object.is(v, config[first]))!;
    const cases: [string, MatchRules][] = [
      // Alone, the rules set nothing the codec carries: written in version 1's layout, it would hash as a
      // match without rules.
      ['alone', { spinTurnsPerSecond: 1 } as MatchRules],
      ['beside a rule', { [first]: rule, spinTurnsPerSecond: 1 } as MatchRules],
      // A setting of the configuration that's no rule is none, even at its own value.
      ['a setting that is no rule', { gravityMetresPerSecond2: config.gravityMetresPerSecond2 } as MatchRules],
    ];
    for (const [what, rules] of cases) {
      const s = base();
      Object.assign(s, { rules });
      expect(stateProblems(s).join('\n'), what).toMatch(/the match rules: \w+ is no match rule \(C-59\)/);
      expect(() => encodeState(s), what).toThrow(/^the match rule \w+ is \S+, not a rule of the configuration \(C-59\)/);
      expect(() => hashState(s), what).toThrow(/not a rule of the configuration \(C-59\)/);
    }
    // A refusal leaves the shared buffer ready for the next state, a match with rules among them.
    expect(decodeState(encodeState(base()))).toEqual(base());
    const ruled = base();
    Object.assign(ruled, { rules: canonicalRules({ [first]: rule }, config) });
    expect(decodeState(encodeState(ruled))).toEqual(ruled);
  });

  it('writes names as TextEncoder does, a leading U+FEFF kept', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 60 }), (n) => {
        fc.pre(utf8(n).length <= 255);
        const s = base();
        s.terriers[1]!.name = n;
        const bytes = encodeState(s);
        const { start, after } = terrierAt(bytes, 1);
        expect(sameBytes(bytes.subarray(start + 17, after), utf8(n))).toBe(true);
        // Only an allowed name decodes; then it's the same string.
        expect(decodeState(bytes)?.terriers[1]!.name ?? null).toBe(nameAllowed(n, P) ? n : null);
      }),
    );
    const s = base();
    s.terriers[0]!.name = '\ufeff\ufeffRex';
    expect(decodeState(encodeState(s))!.terriers[0]!.name).toBe('\ufeff\ufeffRex');
  });

  it('never throws on random bytes, truncations or bit flips, and re-encodes what it takes to the same bytes', () => {
    // A throw fails the property.
    const takes = (bytes: Uint8Array): void => {
      const s = decodeState(bytes);
      if (s && !sameBytes(encodeState(s), bytes)) expect.fail('a state it took re-encodes to other bytes');
    };
    fc.assert(fc.property(fc.uint8Array({ maxLength: 2000 }), takes));
    // From version 1, so the decoder reads on.
    fc.assert(fc.property(fc.uint8Array({ minLength: 2, maxLength: 2000 }), (b) => takes(new Uint8Array([1, 0, ...b.subarray(2)]))));
    const valid = encodeState(base());
    for (let n = 0; n < valid.length; n++) expect(decodeState(valid.subarray(0, n)), `${n} bytes`).toBeNull();
    for (let i = 0; i < valid.length * 8; i++) {
      const flipped = valid.slice();
      flipped[i >> 3]! ^= 1 << (i & 7);
      takes(flipped);
    }
    fc.assert(
      fc.property(state, fc.array(fc.tuple(fc.nat(), u8), { minLength: 1, maxLength: 4 }), (s, writes) => {
        const bytes = encodeState(s);
        for (const [at, value] of writes) bytes[at % bytes.length] = value;
        takes(bytes);
      }),
    );
    expect(decodeState(undefined as unknown as Uint8Array)).toBeNull();
    expect(decodeState([1, 0] as unknown as Uint8Array)).toBeNull();
  });

  it('refuses each invalid field', () => {
    expect(decodedAfter(base(), () => {})).toEqual(base());
    const s = base();
    const after = (k: number): number => terrierAt(encodeState(s), k).after;
    /** Terrier k slipping from a slot. */
    const slips = (b: Uint8Array, k: number, slot: number): void => {
      b[after(k) + F.slipFrom] = 1 + slot;
      b[after(k) + F.flags]! |= 16;
    };
    // Slipping from the ball, or from another terrier that's here, is fine.
    expect(decodedAfter(s, (b) => slips(b, 1, 2))!.terriers[1]!.slipFrom).toBe(2);
    expect(decodedAfter(s, (b) => slips(b, 3, 4))!.terriers[3]!.slipFrom).toBe(4);
    const refused: [string, (bytes: Uint8Array, v: DataView) => void][] = [
      ['version 2 without its rules', (b) => (b[0] = 2)],
      ['version 3', (b) => (b[0] = 3)],
      ['phase 6', (b) => (b[2] = 6)],
      ['an overtime byte of 2', (b) => (b[7] = 2)],
      ['an own-goal byte of 2', (b) => (b[28] = 2)],
      ["the ball's floor byte of 2", (b) => (b[78] = 2)],
      ['pack size 0', (b) => (b[12] = 0)],
      ['pack size 5', (b) => (b[12] = 5)],
      ['pack 2', (b) => (b[after(1) + F.pack] = 2)],
      ['a spot at the pack size', (b) => (b[after(3) + F.spot] = 2)],
      ['spots out of order', (b) => (b[after(0) + F.spot] = 1)],
      ['coat 8', (b) => (b[after(2) + F.coat] = 8)],
      ['flag bit 6', (b) => (b[after(1) + F.flags]! |= 64)],
      ['flag bit 7', (b) => (b[after(1) + F.flags]! |= 128)],
      ['slipped from its own slot', (b) => slips(b, 1, 1)],
      ['slipped from a slot past the ball', (b) => slips(b, 1, 5)],
      ['slipping without a slot', (b) => (b[after(0) + F.slipFrom] = 0)],
      ['a slot without slipping', (b) => (b[after(0) + F.flags]! &= ~16)],
      ['a lunge of 19', (b, v) => v.setUint16(after(2) + F.lunge, P.lungeTicks + 1, true)],
      ['a pounce wait of 91', (b, v) => v.setUint16(after(2) + F.pounceWait, P.pounceWaitTicks + 1, true)],
      ['a tumble of 91', (b, v) => v.setUint16(after(2) + F.tumble, P.tumbleTicks + 1, true)],
      ['a guard of 91', (b, v) => v.setUint16(after(2) + F.guard, P.guardTicks + 1, true)],
      ['a meter of 361', (b, v) => v.setUint16(after(2) + F.meter, P.meterFull + 1, true)],
      ['animation phase 8', (b) => (b[after(3) + F.anim] = 8)],
      ['a bark bit in the previous input', (b, v) => v.setUint16(after(3) + F.prevInput, 0x2000, true)],
      ["NaN in a terrier's x", (b, v) => v.setFloat64(after(1) + F.x, NaN, true)],
      ["+Infinity in a terrier's vz", (b, v) => v.setFloat64(after(1) + F.vz, Infinity, true)],
      ["−Infinity in the ball's vx", (b, v) => v.setFloat64(54, -Infinity, true)],
      ["NaN in the ball's hit strength", (b, v) => v.setFloat64(83, NaN, true)],
      ["NaN in the ball's hit change", (b, v) => v.setFloat64(107, NaN, true)],
      ['scorers past the list', (b) => (b[29] = 16)],
      ["the last goal's pack 2", (b) => (b[27] = 2)],
      ['a name that isn\'t UTF-8', (b) => (b[terrierAt(b, 0).start + 17] = 0xff)],
      ['a surrogate written as UTF-8', (b) => b.set([0xed, 0xa0, 0x80], terrierAt(b, 0).start + 17)],
      ['a name with a C1 control', (b) => b.set([0xc2, 0x85], terrierAt(b, 0).start + 17)],
      ['a name with a C0 control', (b) => (b[terrierAt(b, 0).start + 17] = 0x09)],
      ['a name with DEL', (b) => (b[terrierAt(b, 0).start + 17] = 0x7f)],
      ['more terriers than the bytes hold', (b) => (b[119] = 5)],
    ];
    for (const [what, change] of refused) expect(decodedAfter(s, change), what).toBeNull();
    expect(decodeState(new Uint8Array([...encodeState(s), 0])), 'a trailing byte').toBeNull();
    expect(decodeState(encodeState(s).subarray(0, -1)), 'a missing byte').toBeNull();
    // And in memory, through the encoder.
    const inMemory: [string, (s: MatchState) => void][] = [
      ['a duplicate ID', (s) => (s.terriers[3]!.id = s.terriers[1]!.id)],
      ['terriers out of order', (s) => s.terriers.reverse()],
      ['five terriers in two packs of two', (s) => s.terriers.push({ ...s.terriers[3]!, id: id(0xff), spot: 2 })],
      ['a match length of 0', (s) => (s.matchLengthTicks = 0)],
      ['a name of 21 characters', (s) => (s.terriers[0]!.name = 'x'.repeat(21))],
      ['a name of 33 bytes', (s) => (s.terriers[0]!.name = `${'é'.repeat(16)}x`)],
      ['a pack size outside the configuration', (s) => (s.packSize = 5)],
    ];
    for (const [what, change] of inMemory) expect(decodedWith(change), what).toBeNull();
    // A pack size the configuration allows decodes; a planted one can refuse it.
    expect(decodeState(encodeState(s), simParams({ ...config, packSizeMax: 1 }))).toBeNull();
  });

  it('gives different states different hashes', () => {
    const seen = new Map<string, string>();
    fc.assert(
      fc.property(state, (s) => {
        const key = Array.from(encodeState(s)).join(',');
        const h = hashState(s);
        expect(seen.get(h) ?? key).toBe(key);
        seen.set(h, key);
      }),
      { numRuns: 500 },
    );
    const s = base();
    const changes: ((s: MatchState) => void)[] = [
      (s) => s.tick++,
      (s) => (s.terriers[2]!.heading += 1),
      (s) => (s.ball.x = 1e-300),
      (s) => (s.ball.lastHitDvz = -0),
      (s) => (s.terriers[1]!.name = 'Terrier 9'),
      (s) => (s.terriers[3]!.touchingBall = true),
    ];
    const hashes = changes.map((change) => {
      const u = base();
      change(u);
      return hashState(u);
    });
    expect(new Set([hashState(s), ...hashes]).size).toBe(changes.length + 1);
  });

  it('returns a copy, which the next encoding never touches', () => {
    const a = encodeState(base());
    const s = base();
    s.tick = 7;
    const b = encodeState(s);
    expect(a).not.toEqual(b);
    expect(decodeState(a)).toEqual(base());
    a[8] = 99;
    expect(encodeState(base())[8]).not.toBe(99);
    // And it decodes from a view into a larger buffer, as a message's payload is.
    const bytes = encodeState(base());
    const message = new Uint8Array(bytes.length + 4);
    message.set(bytes, 3);
    expect(decodeState(message.subarray(3, 3 + bytes.length))).toEqual(base());
  });

  it('loses no byte on the call that grows its shared buffer', async () => {
    // Every state today's configuration allows fits the first buffer, 2,048
    // bytes; a planted 255-byte name limit lets 8 terriers past it.
    const Q = simParams({ ...config, displayNameMaxChars: 255, displayNameMaxBytes: 255 });
    const s = genesis({ packSize: 4, matchMinutes: 1 }, Q);
    for (let slot = 0; slot < 8; slot++) {
      const t = newTerrier(id(slot + 1), 'x'.repeat(255), (slot & 1) as Pack, 0, 0, Q);
      t.spot = slot >> 1;
      s.terriers.push(t);
    }
    expect(stateProblems(s, Q)).toEqual([]);
    /** A codec of its own, whose buffer hasn't grown: the module keeps it. */
    const fresh = async (): Promise<typeof import('./codec')> => {
      vi.resetModules();
      return import('./codec');
    };
    const bytes = (await fresh()).encodeState(s);
    expect(bytes).toHaveLength(120 + 8 * (142 + 255));
    expect(decodeState(bytes, Q)).toEqual(s);
    expect((await fresh()).hashState(s)).toBe(hash64(bytes));
  });
});

// --- The hash (design §1.2) ---

describe('hash64 (A.1, D-13)', () => {
  it("is MurmurHash3 x86-32 with seeds 0 and 0x9747B28C, as roslambo's and the spike's", () => {
    // The first halves are the published seed-0 vectors; the pairs are the
    // spike's hash.ts, recorded by a scratch script outside the repo.
    expect(hash64(new Uint8Array(0))).toBe('00000000ebb6c228');
    expect(hash64(utf8('a'))).toBe('3c2569b27fa09ea6');
    expect(hash64(utf8('test'))).toBe('ba6bd213704b81dc');
    expect(hash64(utf8('Hello, world!'))).toBe('c0363e4324884cba');
    expect(hash64(utf8('The quick brown fox jumps over the lazy dog'))).toBe('2e4ff7232fa826cd');
    expect(hash64(utf8('terriest'))).toBe('c14e720a0e2f48e9');
  });

  it('hashes a prefix with len, and converts to and from its 8 bytes', () => {
    const bytes = utf8('Hello, world!xyz');
    expect(hash64(bytes, 13)).toBe(hash64(utf8('Hello, world!')));
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), fc.nat({ max: 8 }), (b, offset) => {
        const h = hash64(b);
        expect(h).toMatch(/^[0-9a-f]{16}$/);
        const out = new Uint8Array(offset + 8);
        hashToBytes(h, out, offset);
        expect(bytesToHash(out, offset)).toBe(h);
      }),
    );
  });
});

// --- The state (design §1.4, §2) ---

describe('the state (design §1.4)', () => {
  it('starts a match at genesis in warm-up, with nobody in it and the ball on the centre spot', () => {
    const s = genesis({ packSize: 3, matchMinutes: 4 });
    expect(stateProblems(s)).toEqual([]);
    expect([s.phase, s.tick, s.packSize, s.matchLengthTicks, s.clock, s.overtime]).toEqual([WARM_UP, 0, 3, 4 * 3600, 4 * 3600, false]);
    expect([s.ball.x, s.ball.y, s.ball.z, s.ball.onFloor, s.ball.lastHitTick, s.ball.lastContactTick, s.lastGoalTick]).toEqual([0, 0, 0.8, true, NEVER, NEVER, NEVER]);
    expect(s.terriers).toEqual([]);
    for (const settings of [{ packSize: 0, matchMinutes: 3 }, { packSize: 5, matchMinutes: 3 }, { packSize: 1.5, matchMinutes: 3 }]) {
      expect(() => genesis(settings), JSON.stringify(settings)).toThrow(/pack size/);
    }
    for (const settings of [{ packSize: 2, matchMinutes: 0 }, { packSize: 2, matchMinutes: 11 }, { packSize: 2, matchMinutes: 2.5 }]) {
      expect(() => genesis(settings), JSON.stringify(settings)).toThrow(/minutes/);
    }
    expect(genesis({ packSize: 1, matchMinutes: 1 }, simParams({ ...config, terrierRadiusMetres: 0.3, ballRadiusMetres: 0.9 })).ball.z).toBe(0.9);
  });

  it('makes a terrier with every unset tick NEVER, a full meter and no slot slipped from', () => {
    const t = newTerrier(id(5), 'Rex', 1, 3, 42, P);
    expect([t.id, t.name, t.pack, t.spot, t.coat, t.joinTick, t.lastInputTick, t.readyUntil, t.prevInput]).toEqual([id(5), 'Rex', 1, 0, 3, 42, 42, 0, 0]);
    expect([t.takeOffTick, t.landingTick, t.lastBallContactTick, t.lastTerrierContactTick, t.lastPushTick, t.lastPushDir]).toEqual([NEVER, NEVER, NEVER, NEVER, NEVER, 0]);
    expect([t.meter, t.slipFrom, t.slipping, t.anim, t.animStart, t.z, t.onFloor]).toEqual([360, -1, false, STANDING, 42, 0.25, true]);
    const s = genesis({ packSize: 2, matchMinutes: 1 });
    s.terriers.push(t);
    s.tick = 42;
    expect(stateProblems(s)).toEqual([]);
  });

  it('clones deeply: changing a clone leaves the state alone', () => {
    const s = base();
    const bytes = encodeState(s);
    const c = cloneState(s);
    expect(c).toEqual(s);
    c.ball.x = 9;
    c.score[1] = 3;
    c.terriers[0]!.heading = 5;
    c.terriers.pop();
    expect(encodeState(s)).toEqual(bytes);
    expect(c.ball).not.toBe(s.ball);
  });

  it('finds terriers, counts packs and keeps the list in (spot, pack) order', () => {
    const s = base();
    expect(s.terriers.map(slotOf)).toEqual([0, 1, 2, 3]);
    expect(ballSlot(s.packSize)).toBe(4);
    expect(findTerrier(s, id(0xa2))).toBe(2);
    expect(findTerrier(s, id(0xff))).toBe(-1);
    expect([packCount(s, 0), packCount(s, 1)]).toEqual([2, 2]);
    s.terriers.splice(1, 1);
    expect([packCount(s, 0), packCount(s, 1)]).toEqual([2, 1]);
    fc.assert(
      fc.property(fc.shuffledSubarray([0, 1, 2, 3, 4, 5, 6, 7]), (slots) => {
        const u = genesis({ packSize: 4, matchMinutes: 1 });
        for (const slot of slots) {
          const t = newTerrier(id(slot + 1), '', (slot & 1) as Pack, 0, 0, P);
          t.spot = slot >> 1;
          u.terriers.push(t);
        }
        sortTerriers(u);
        expect(u.terriers.map(slotOf)).toEqual([...slots].sort((a, b) => a - b));
        expect(stateProblems(u)).toEqual([]);
      }),
    );
  });
});

describe('display names (C-17)', () => {
  it('names C0, DEL and C1 as the control units, and nothing else', () => {
    const wrong: string[] = [];
    for (let u = 0; u <= 0xffff; u++) if (isNameControl(u) !== (u <= 0x1f || (u >= 0x7f && u <= 0x9f))) wrong.push(`U+${u.toString(16)}`);
    expect(wrong).toEqual([]);
  });

  it('allows 20 code points and 32 bytes of UTF-8, with no control unit and no lone surrogate', () => {
    const allowed = ['', 'Rex', 'x'.repeat(20), 'é'.repeat(16), '🐶'.repeat(8), '\u00a0nbsp', '\ufeffbom', '狗'.repeat(10), 'a\u{1f415}\u200d\u{1f9ba}'];
    for (const n of allowed) {
      expect(nameAllowed(n, P), JSON.stringify(n)).toBe(true);
      expect(cleanName(n, P)).toBe(n);
    }
    const refused = [
      'x'.repeat(21), `${'é'.repeat(16)}x`, '🐶'.repeat(9), '狗'.repeat(11), 'tab\there', 'nul\u0000', 'del\u007f', 'c1\u0085', 'c1\u009f',
      'lone \ud83d', '\udc36 lone', '\ud83d\ud83d', 'end\ud800',
    ];
    for (const n of refused) {
      expect(nameAllowed(n, P), JSON.stringify(n)).toBe(false);
      expect(cleanName(n, P)).toBe('');
    }
    expect(cleanName(undefined, P)).toBe('');
    expect(nameAllowed(5 as unknown as string, P)).toBe(false);
    // The limits are the configuration's.
    expect(nameAllowed('x'.repeat(21), simParams({ ...config, displayNameMaxChars: 21 }))).toBe(true);
  });

  it('agrees with TextEncoder on the bytes and with the code points on the characters', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (n) => {
        const units = [...n].every((c) => !isNameControl(c.charCodeAt(0)));
        const fits = [...n].length <= P.nameMaxChars && utf8(n).length <= P.nameMaxBytes;
        expect(nameAllowed(n, P)).toBe(units && fits);
      }),
    );
  });
});
