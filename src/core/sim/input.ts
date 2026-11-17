// A.2's u16 input, and the per-tick input the simulation takes, with its
// roster events (PLAN A.2, D-7, D-10, D-12, P4; design §1.3, §5.1). Every
// u16 is a valid input; step masks each to 16 bits as it reads it.
//   bits 0–4   direction step, 0–31, counter-clockwise from the frame's forward
//   bit 5      a direction is held
//   bits 6–7   frame: 0 pitch, 1 ball line, 2 nose; 3 reads as no direction held
//   bit 8      zoomies held
//   bits 9–10  jump press counter
//   bits 11–12 pounce press counter
//   bits 13–14 bark press counter, never read by the simulation
//   bit 15     0 when sent; ignored when read
// The spike's input.ts, with roslambo's PlayerInput shape (its rules.ts):
// its buttons become A.2's input, JOIN carries a pack and a coat, and SWITCH
// is new, with a pack of its own. The codes are marked for the
// configuration scan (src/config.test.ts).

export const STEP_MASK = 0x1f; // not a setting
export const HELD = 0x20; // not a setting
export const FRAME_SHIFT = 6; // not a setting
export const ZOOMIES = 0x100; // not a setting
export const JUMP_SHIFT = 9; // not a setting
export const POUNCE_SHIFT = 11; // not a setting
export const BARK_SHIFT = 13; // not a setting

export const FRAME_PITCH = 0; // not a setting
export const FRAME_BALL = 1; // not a setting
export const FRAME_NOSE = 2; // not a setting

/** One of A.2's 32 steps: 2^27 binary-angle units. */
export const STEP_UNITS = 134217728; // not a setting
/** What the state keeps of an input, bits 0–12: the bark bits and bit 15 cleared (D-10). */
export const KEPT_BITS = 0x1fff; // not a setting

export interface InputParts {
  step?: number; // 0–31; absent: no direction held
  frame?: number; // FRAME_PITCH by default
  zoomies?: boolean;
  jump?: number; // press counters, taken mod 4
  pounce?: number;
  bark?: number;
}

export function encodeInput(p: InputParts): number {
  let v = 0;
  if (p.step !== undefined) v |= (p.step & STEP_MASK) | HELD | (((p.frame ?? FRAME_PITCH) & 3) << FRAME_SHIFT);
  if (p.zoomies) v |= ZOOMIES;
  v |= ((p.jump ?? 0) & 3) << JUMP_SHIFT;
  v |= ((p.pounce ?? 0) & 3) << POUNCE_SHIFT;
  v |= ((p.bark ?? 0) & 3) << BARK_SHIFT;
  return v;
}

export function frameOf(input: number): number {
  return (input >>> FRAME_SHIFT) & 3;
}

/** A direction is held: bit 5 set and the frame 0, 1 or 2. */
export function heldDirection(input: number): boolean {
  return (input & HELD) !== 0 && frameOf(input) !== 3;
}

export function stepOf(input: number): number {
  return input & STEP_MASK;
}

export function jumpCount(input: number): number {
  return (input >>> JUMP_SHIFT) & 3;
}

export function pounceCount(input: number): number {
  return (input >>> POUNCE_SHIFT) & 3;
}

/** M3 and M4 read it, for remote barks (D-16); the simulation never does (D-10). */
export function barkCount(input: number): number {
  return (input >>> BARK_SHIFT) & 3;
}

/** The input a mirrored terrier sends (P8): a held pitch-frame step turns a
 *  half turn, 16 steps; ball-line and nose steps are relative to mirrored
 *  references, so they stay. */
export function mirrorInput(input: number): number {
  if (!heldDirection(input) || frameOf(input) !== FRAME_PITCH) return input;
  return (input & ~STEP_MASK) | (((input & STEP_MASK) + 16) & STEP_MASK);
}

// --- Roster events (D-12), as bits of TickInput.events ---

export const JOIN = 1; // not a setting
export const LEAVE = 2; // not a setting
export const READY = 4; // not a setting
export const UNREADY = 8; // not a setting
export const SWITCH = 16; // not a setting

/** One browser's or bot's final (or predicted) input for one tick. An
 *  absent ID has no entry. JOIN and SWITCH carry packs of their own, as
 *  their wire events do (§9): a player who switches before the state shows
 *  its JOIN sends both in one tick (D-12, design §6.1). */
export interface TickInput {
  readonly id: string; // a player ID, 32 lower-case hex digits; a bot's is version 8 (D-39)
  readonly input: number; // A.2's u16, masked to 16 bits when read; every value is valid
  readonly events: number; // JOIN | LEAVE | READY | UNREADY | SWITCH
  readonly joinPack?: number; // JOIN's pack byte; only 0 and 1 are valid
  readonly coat?: number; // JOIN's coat byte; outside the list reads as coat 0
  readonly name?: string; // JOIN's display name
  readonly switchPack?: number; // SWITCH's pack byte; only 0 and 1 are valid
}

/** A player ID: 32 lower-case hex digits (D-25). */
export function isPlayerId(id: string): boolean {
  if (typeof id !== 'string' || id.length !== 32) return false;
  for (let i = 0; i < 32; i++) {
    const c = id.charCodeAt(i);
    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false; // 0–9, a–f
  }
  return true;
}

const negativeZero = (v: number): boolean => v === 0 && 1 / v < 0;

/** A total order on an optional number: absent first, then ascending, −0
 *  before +0, and NaN last. Two copies compare equal only when nothing can
 *  tell them apart. */
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

/** Two copies of one ID by content, field by field in TickInput's order. */
function compareContent(a: TickInput, b: TickInput): number {
  return (
    compareNumbers(a.input, b.input) ||
    compareNumbers(a.events, b.events) ||
    compareNumbers(a.joinPack, b.joinPack) ||
    compareNumbers(a.coat, b.coat) ||
    compareStrings(a.name, b.name) ||
    compareNumbers(a.switchPack, b.switchPack)
  );
}

/** The valid inputs, one per ID, in ID order, written into out, whose length
 *  it sets, so nothing from an earlier call stays. A duplicated ID keeps the
 *  copy whose content sorts first, field by field in TickInput's order, so
 *  the result never depends on the order the inputs arrived in (P4): roslambo
 *  kept the first to arrive. An insertion sort in place: no allocation, and
 *  out may be inputs itself. */
export function canonicalInputs(inputs: readonly TickInput[], out: TickInput[] = []): TickInput[] {
  let n = 0;
  for (let k = 0; k < inputs.length; k++) {
    const x = inputs[k]!;
    if (!isPlayerId(x.id)) continue;
    // Where x's ID goes among the n kept so far: they never reach past index k.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (out[mid]!.id < x.id) lo = mid + 1;
      else hi = mid;
    }
    if (lo < n && out[lo]!.id === x.id) {
      if (compareContent(x, out[lo]!) < 0) out[lo] = x;
      continue;
    }
    for (let j = n; j > lo; j--) out[j] = out[j - 1]!;
    out[lo] = x;
    n++;
  }
  out.length = n;
  return out;
}

/** Whether two lists canonicalise equal, field by field: M3's "the inputs
 *  it would now use differ" (D-11). */
export function sameInputs(a: readonly TickInput[], b: readonly TickInput[]): boolean {
  const x = canonicalInputs(a, []);
  const y = canonicalInputs(b, []);
  if (x.length !== y.length) return false;
  for (let k = 0; k < x.length; k++) if (x[k]!.id !== y[k]!.id || compareContent(x[k]!, y[k]!) !== 0) return false;
  return true;
}
