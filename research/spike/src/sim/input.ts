// The 16-bit input (PLAN A.2, D-7, D-10). Every u16 is a valid input.
//   bits 0–4   direction step, 0–31, counter-clockwise from the frame's forward
//   bit 5      a direction is held
//   bits 6–7   frame: 0 pitch, 1 ball line, 2 nose; 3 reads as no direction held
//   bit 8      zoomies held
//   bits 9–10  jump press counter
//   bits 11–12 pounce press counter
//   bits 13–14 bark press counter (not read by the simulation)
//   bit 15     0 when sent; ignored when read

export const STEP_MASK = 0x1f;
export const HELD = 1 << 5;
export const FRAME_SHIFT = 6;
export const ZOOMIES = 1 << 8;
export const JUMP_SHIFT = 9;
export const POUNCE_SHIFT = 11;
export const BARK_SHIFT = 13;

export const FRAME_PITCH = 0;
export const FRAME_BALL = 1;
export const FRAME_NOSE = 2;

/** One step of the 32: 2^27 binary-angle units. */
export const STEP_UNITS = 134217728;

/** What the simulation keeps of an input: the bark bits and bit 15 cleared. */
export const KEPT_BITS = 0x1fff;

export interface InputParts {
  step?: number; // 0–31; omitted: no direction held
  frame?: number;
  zoomies?: boolean;
  jump?: number; // counters, taken mod 4
  pounce?: number;
  bark?: number;
}

export function encodeInput(p: InputParts): number {
  let v = 0;
  if (p.step !== undefined) v |= (p.step & STEP_MASK) | HELD | ((p.frame ?? FRAME_PITCH) & 3) << FRAME_SHIFT;
  if (p.zoomies) v |= ZOOMIES;
  v |= ((p.jump ?? 0) & 3) << JUMP_SHIFT;
  v |= ((p.pounce ?? 0) & 3) << POUNCE_SHIFT;
  v |= ((p.bark ?? 0) & 3) << BARK_SHIFT;
  return v;
}

export function frameOf(input: number): number {
  return (input >>> FRAME_SHIFT) & 3;
}

/** A direction is held: the bit is set and the frame is 0, 1 or 2. */
export function heldDirection(input: number): boolean {
  return (input & HELD) !== 0 && frameOf(input) !== 3;
}

export function jumpCount(input: number): number {
  return (input >>> JUMP_SHIFT) & 3;
}

export function pounceCount(input: number): number {
  return (input >>> POUNCE_SHIFT) & 3;
}

/** The input a mirrored terrier sends (P8): a pitch-frame direction turns a
 *  half turn, 16 steps; ball-line and nose directions are relative to
 *  mirrored references, so they stay. */
export function mirrorInput(input: number): number {
  if (!heldDirection(input) || frameOf(input) !== FRAME_PITCH) return input;
  return (input & ~STEP_MASK) | (((input & STEP_MASK) + 16) & STEP_MASK);
}
