// The canonical bytes (PLAN A.1, D-13; design §1.6, §2.2): the hash input
// and M3's STATE payload. One encoding a state, little-endian, floats as
// f64 with −0 kept. encodeState refuses a float that isn't finite and a
// field outside its type (D-1), and checks nothing else, so a test-only
// state, such as a short pack in play, still encodes and hashes.
// decodeState is total: malformed, inconsistent or trailing bytes give
// null, never an exception (§9's decoders, D-20), and so does a state
// stateProblems reports (valid.ts). So a state stateProblems passes
// round-trips byte for byte, and one it reports encodes but never decodes.
// The M0 spike's codec.ts for the encoder and its shared buffer, and
// roslambo's codec.ts for decoding, its IDs and names and its strict UTF-8
// decoder. Names are written as UTF-8 by hand, into the shared buffer, so
// hashing allocates nothing: TextEncoder.encodeInto returns a new object,
// and writes at an offset only through a new view.

import { config, type MatchRules, NO_RULES, RULE_SETTINGS } from '../../config';
import { hash64 } from './hash';
import { isPlayerId } from './input';
import { defaultParams, type SimParams } from './params';
import type { AnimPhase, MatchState, Pack, Phase, Terrier } from './state';
import { stateProblems } from './valid';

/** The codec's version (A.1): 2 from the match rules (C-59). A match at the build's own settings is
 *  written in version 1's layout, byte for byte as before them, so its hash is too; one with match rules
 *  in version 2's, which adds their block after the match length. */
export const CODEC_VERSION = 2; // not a setting
const PLAIN = 1; // not a setting: the layout without match rules
const WITH_RULES = 2; // not a setting: the layout with them

// A.1's sizes in bytes, each marked for the configuration scan.
const FIXED = 30 + 89 + 1; // not a setting: the header, the ball and n
const RULES = RULE_SETTINGS.length; // not a setting: version 2's block, a byte a rule
const TERRIER = 142; // not a setting: a terrier's bytes, its name's aside
const NAME_MAX = 255; // not a setting: a name's u8 length
const AFTER_NAME = 125; // not a setting: a terrier's bytes after its ID and its name

// --- Encoding, into one shared buffer ---

let buf = new Uint8Array(2048);
let view = new DataView(buf.buffer);
let at = 0; // the write position
let index = -1; // not a setting: the terrier being written, for an error; −1 for the match and the ball

/** Room for more bytes at the write position. */
function room(more: number): void {
  if (at + more <= buf.length) return;
  const next = new Uint8Array(Math.max(at + more, 2 * buf.length));
  next.set(buf.subarray(0, at));
  buf = next;
  view = new DataView(next.buffer);
}

function fail(what: string, value: unknown, type: string): never {
  const owner = index < 0 ? '' : `terrier ${index}'s `;
  throw new Error(`${owner}${what} is ${typeof value === 'string' ? JSON.stringify(value) : String(value)}, not ${type} (A.1, D-1)`);
}

function u8(x: number, what: string): void {
  if (!(Number.isInteger(x) && x >= 0 && x <= 0xff)) fail(what, x, 'a u8');
  buf[at++] = x;
}

function u16(x: number, what: string): void {
  if (!(Number.isInteger(x) && x >= 0 && x <= 0xffff)) fail(what, x, 'a u16');
  view.setUint16(at, x, true);
  at += 2;
}

function u32(x: number, what: string): void {
  if (!(Number.isInteger(x) && x >= 0 && x <= 0xffffffff)) fail(what, x, 'a u32');
  view.setUint32(at, x, true);
  at += 4;
}

function i32(x: number, what: string): void {
  if (!(Number.isInteger(x) && x >= -0x80000000 && x <= 0x7fffffff)) fail(what, x, 'an i32');
  view.setInt32(at, x, true);
  at += 4;
}

function f64(x: number, what: string): void {
  if (!Number.isFinite(x)) fail(what, x, 'a finite float');
  view.setFloat64(at, x, true);
  at += 8;
}

function bool(b: boolean, what: string): void {
  if (b !== true && b !== false) fail(what, b, 'a boolean');
  buf[at++] = b ? 1 : 0;
}

/** A flag's bit, for the flags byte. */
function bit(b: boolean, what: string, value: number): number {
  if (b !== true && b !== false) fail(what, b, 'a boolean');
  return b ? value : 0;
}

const nibble = (c: number): number => (c <= 57 ? c - 48 : c - 87); // '0'–'9', 'a'–'f'

/** 32 hex digits as 16 bytes. */
function playerId(id: string): void {
  if (!isPlayerId(id)) fail('ID', id, '32 lower-case hex digits');
  for (let i = 0; i < 16; i++) buf[at + i] = (nibble(id.charCodeAt(2 * i)) << 4) | nibble(id.charCodeAt(2 * i + 1));
  at += 16;
}

/** A name as its UTF-8 length, then its UTF-8. A lone surrogate has no
 *  UTF-8, which TextEncoder would write as U+FFFD, so it's refused. */
function name(s: string): void {
  if (typeof s !== 'string') fail('name', s, 'a string');
  const start = at++;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) {
      const low = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (c > 0xdbff || low < 0xdc00 || low > 0xdfff) fail('name', s, 'well-formed UTF-16, with no lone surrogate');
      c = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00);
      i++;
    }
    const n = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (at - start - 1 + n > NAME_MAX) fail('name', s, `at most ${NAME_MAX} bytes of UTF-8`);
    if (n === 1) {
      buf[at] = c;
    } else if (n === 2) {
      buf[at] = 0xc0 | (c >> 6);
      buf[at + 1] = 0x80 | (c & 0x3f);
    } else if (n === 3) {
      buf[at] = 0xe0 | (c >> 12);
      buf[at + 1] = 0x80 | ((c >> 6) & 0x3f);
      buf[at + 2] = 0x80 | (c & 0x3f);
    } else {
      buf[at] = 0xf0 | (c >> 18);
      buf[at + 1] = 0x80 | ((c >> 12) & 0x3f);
      buf[at + 2] = 0x80 | ((c >> 6) & 0x3f);
      buf[at + 3] = 0x80 | (c & 0x3f);
    }
    at += n;
  }
  buf[start] = at - start - 1;
}

/** Bits 0–5: on the floor, sitting, zoomies locked out, ball overhead,
 *  slipping, touching the ball; 6–7 zero (A.1). */
function flags(t: Readonly<Terrier>): number {
  return (
    bit(t.onFloor, 'floor flag', 1) | bit(t.sitting, 'sitting flag', 2) | bit(t.zoomLocked, 'zoomies lockout', 4) |
    bit(t.ballOverhead, 'ball-overhead flag', 8) | bit(t.slipping, 'slipping flag', 16) | bit(t.touchingBall, 'touching flag', 32)
  );
}

/** The index of v in a rule's choices, or −1: by Object.is, so −0 is no choice. */
function choiceIndex(choices: readonly number[], v: number): number {
  for (let i = 0; i < choices.length; i++) if (Object.is(choices[i], v)) return i;
  return -1;
}

/** Whether a match has rules: any rule set (C-59). */
function hasRules(r: MatchRules): boolean {
  if (typeof r !== 'object' || r === null) fail('the match rules', r, 'an object of rules');
  for (let k = 0; k < RULES; k++) if (r[RULE_SETTINGS[k]!] !== undefined) return true;
  return false;
}

/** Version 2's block of match rules (C-59), a byte each in A.1's order: 0 for the build's own setting,
 *  else 1 + the index of the rule's value in its choices. */
function rules(r: MatchRules): void {
  for (let k = 0; k < RULES; k++) {
    const key = RULE_SETTINGS[k]!;
    const v = r[key];
    if (v === undefined) {
      buf[at++] = 0;
      continue;
    }
    const i = choiceIndex(config.matchRules[key], v);
    if (i < 0) fail(`the rule ${key}`, v, 'one of its choices (C-59)');
    buf[at++] = i + 1;
  }
}

/** Writes s into the shared buffer from 0 and returns its length. */
function write(s: Readonly<MatchState>): number {
  at = 0;
  index = -1;
  room(FIXED + RULES);
  const withRules = hasRules(s.rules);
  u16(withRules ? WITH_RULES : PLAIN, 'the codec version');
  u8(s.phase, 'the phase');
  u32(s.phaseStart, 'the phase start');
  bool(s.overtime, 'overtime');
  u32(s.tick, 'the tick');
  u8(s.packSize, 'the pack size');
  u32(s.matchLengthTicks, 'the match length');
  if (withRules) rules(s.rules);
  u32(s.clock, 'the clock');
  u8(s.score[0], "pack A's score");
  u8(s.score[1], "pack B's score");
  u32(s.lastGoalTick, 'the last goal tick');
  u8(s.lastGoalPack, "the last goal's pack");
  bool(s.ownGoal, 'the own-goal flag');
  u8(s.scorers, 'the scorers');
  const b = s.ball;
  f64(b.x, "the ball's x");
  f64(b.y, "the ball's y");
  f64(b.z, "the ball's z");
  f64(b.vx, "the ball's vx");
  f64(b.vy, "the ball's vy");
  f64(b.vz, "the ball's vz");
  bool(b.onFloor, "the ball's floor flag");
  u32(b.lastHitTick, "the ball's last hit tick");
  f64(b.lastHitStrength, "the ball's hit strength");
  f64(b.lastHitDvx, "the ball's hit change in x");
  f64(b.lastHitDvy, "the ball's hit change in y");
  f64(b.lastHitDvz, "the ball's hit change in z");
  u32(b.lastContactTick, "the ball's last contact tick");
  const list = s.terriers;
  u8(list.length, 'the number of terriers');
  for (let k = 0; k < list.length; k++) {
    const t = list[k]!;
    index = k;
    room(TERRIER + NAME_MAX);
    playerId(t.id);
    name(t.name);
    u8(t.pack, 'pack');
    u8(t.spot, 'spot');
    u8(t.coat, 'coat');
    u32(t.joinTick, 'join tick');
    u32(t.readyUntil, 'ready-until tick');
    u32(t.lastInputTick, 'last input tick');
    u16(t.prevInput, 'previous input');
    u32(t.heading, 'heading');
    u32(t.overheadRef, 'overhead reference');
    f64(t.x, 'x');
    f64(t.y, 'y');
    f64(t.z, 'z');
    f64(t.vx, 'vx');
    f64(t.vy, 'vy');
    f64(t.vz, 'vz');
    u8(flags(t), 'flags');
    u8(t.slipFrom + 1, 'slipped-from slot + 1');
    u16(t.meter, 'zoomies meter');
    u16(t.pounceWait, 'pounce wait');
    u16(t.lunge, 'lunge');
    u16(t.tumble, 'tumble');
    u16(t.guard, 'guard');
    u16(t.touches, 'touches');
    u8(t.goals, 'goals');
    u8(t.anim, 'animation phase');
    u32(t.animStart, 'animation start');
    u32(t.gait, 'gait');
    u32(t.takeOffTick, 'take-off tick');
    u32(t.landingTick, 'landing tick');
    u32(t.lastBallContactTick, 'last ball contact tick');
    u32(t.lastTerrierContactTick, 'last terrier contact tick');
    u32(t.lastPushDir, 'last push direction');
    u32(t.lastPushTick, 'last push tick');
    i32(t.headingChange, 'heading change');
  }
  index = -1;
  return at;
}

/** A copy of s's canonical bytes. Throws on a float that isn't finite
 *  (NaN, ±Infinity) or a field out of its type (D-1), and applies no
 *  stateProblems check: a state those checks pass decodes from the copy,
 *  and one they report doesn't. */
export function encodeState(s: Readonly<MatchState>): Uint8Array {
  const len = write(s); // first: a write that needs more room replaces buf
  return buf.slice(0, len);
}

/** hash64 of s's canonical bytes, over the shared buffer: no allocation. */
export function hashState(s: Readonly<MatchState>): string {
  const len = write(s); // first, as in encodeState
  return hash64(buf, len);
}

// --- Decoding ---

// Strict, and keeping a leading U+FEFF, which a name may start with: the
// default would drop it as a byte-order mark.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const HEX = '0123456789abcdef';

/** The state these bytes encode, or null. Total: malformed, inconsistent or
 *  trailing bytes give null, never an exception (§9's decoders), and so
 *  does a state stateProblems reports, which checks it under the match's
 *  own parameters: its rules over P's base (C-59). */
export function decodeState(bytes: Uint8Array, P: SimParams = defaultParams): MatchState | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < FIXED) return null;
  const len = bytes.length;
  const v = new DataView(bytes.buffer, bytes.byteOffset, len);
  let o = 0;
  let bad = false;
  const r8 = (): number => bytes[o++]!;
  const r16 = (): number => {
    const x = v.getUint16(o, true);
    o += 2;
    return x;
  };
  const r32 = (): number => {
    const x = v.getUint32(o, true);
    o += 4;
    return x;
  };
  const ri32 = (): number => {
    const x = v.getInt32(o, true);
    o += 4;
    return x;
  };
  const rf64 = (): number => {
    const x = v.getFloat64(o, true);
    o += 8;
    return x;
  };
  const rbool = (): boolean => {
    const x = bytes[o++]!;
    if (x > 1) bad = true;
    return x === 1;
  };

  // Read in A.1's order: an object literal's values are evaluated in order.
  const version = r16();
  if (version !== PLAIN && version !== WITH_RULES) return null;
  if (version === WITH_RULES && len < FIXED + RULES) return null;
  const phase = r8() as Phase;
  const phaseStart = r32();
  const overtime = rbool();
  const tick = r32();
  const packSize = r8();
  const matchLengthTicks = r32();
  // Version 2's match rules: each byte 0 or 1 + one of its rule's choices, and one at least set, since a
  // match without rules is written in version 1 (C-59); stateProblems refuses a rule that's the base's
  // own setting, which is written as 0.
  let given: Record<string, number> | null = null;
  for (let k = 0; version === WITH_RULES && k < RULES; k++) {
    const x = r8();
    if (x === 0) continue;
    const key = RULE_SETTINGS[k]!;
    const choices = config.matchRules[key];
    if (x > choices.length) return null;
    given ??= {};
    given[key] = choices[x - 1]!;
  }
  if (version === WITH_RULES && given === null) return null;
  const rules: MatchRules = given === null ? NO_RULES : Object.freeze(given);
  const clock = r32();
  const score: [number, number] = [r8(), r8()];
  const lastGoalTick = r32();
  const lastGoalPack = r8() as Pack;
  const ownGoal = rbool();
  const scorers = r8();
  const ball = {
    x: rf64(), y: rf64(), z: rf64(), vx: rf64(), vy: rf64(), vz: rf64(),
    onFloor: rbool(),
    lastHitTick: r32(), lastHitStrength: rf64(),
    lastHitDvx: rf64(), lastHitDvy: rf64(), lastHitDvz: rf64(),
    lastContactTick: r32(),
  };
  const n = r8();
  const terriers: Terrier[] = [];
  for (let k = 0; k < n; k++) {
    if (len - o < 17) return null;
    let id = '';
    for (let i = 0; i < 16; i++) {
      const x = bytes[o + i]!;
      id += HEX[x >> 4]! + HEX[x & 15]!;
    }
    o += 16;
    const nameLength = r8();
    if (len - o < nameLength + AFTER_NAME) return null;
    let name: string;
    try {
      name = utf8.decode(bytes.subarray(o, o + nameLength));
    } catch {
      return null;
    }
    o += nameLength;
    const pack = r8() as Pack;
    const spot = r8();
    const coat = r8();
    const joinTick = r32();
    const readyUntil = r32();
    const lastInputTick = r32();
    const prevInput = r16();
    const heading = r32();
    const overheadRef = r32();
    const x = rf64(), y = rf64(), z = rf64(), vx = rf64(), vy = rf64(), vz = rf64();
    const f = r8();
    if (f > 63) return null; // bits 6–7 set
    const slipFrom = r8() - 1;
    terriers.push({
      x, y, z, vx, vy, vz, onFloor: (f & 1) !== 0,
      id, name, pack, spot, coat,
      joinTick, readyUntil, lastInputTick, prevInput,
      heading, overheadRef,
      sitting: (f & 2) !== 0, zoomLocked: (f & 4) !== 0, ballOverhead: (f & 8) !== 0, slipping: (f & 16) !== 0, touchingBall: (f & 32) !== 0,
      slipFrom,
      meter: r16(), pounceWait: r16(), lunge: r16(), tumble: r16(), guard: r16(),
      touches: r16(), goals: r8(),
      anim: r8() as AnimPhase, animStart: r32(), gait: r32(),
      takeOffTick: r32(), landingTick: r32(),
      lastBallContactTick: r32(), lastTerrierContactTick: r32(),
      lastPushDir: r32(), lastPushTick: r32(),
      headingChange: ri32(),
    });
  }
  if (bad || o !== len) return null;
  const s: MatchState = {
    phase, phaseStart, overtime, tick, packSize, matchLengthTicks, rules, clock, score,
    lastGoalTick, lastGoalPack, ownGoal, scorers, ball, terriers,
  };
  // Checked under the match's own parameters, its rules' over P's base (C-59).
  try {
    return stateProblems(s, P).length === 0 ? s : null;
  } catch {
    return null;
  }
}
