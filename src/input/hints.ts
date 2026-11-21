// The control hints' record (PLAN D-29, L83, A.3; M4's design,
// research/m4/DESIGN.md, §1.26, §4.7, M4-Q28): for each kind of input, a
// bitmask of the six controls it has used, kept in the profile, so a hint
// once cleared stays cleared after a reload, and Settings' "Show control
// hints again" clears all three. Each control's bit is its place in
// CONTROLS, so the profile's six bits (src/storage/profile.ts) are these.
// The panel that shows them is src/ui/layers/devices.ts's. New at M4.
// Three-free.

import type { Control, InputKind } from './source';

/** The six controls, in the panel's order: each one's bit is its place here (M4-Q28). */
export const CONTROLS: readonly Control[] = ['run', 'zoomies', 'jump', 'pounce', 'bark', 'view'];

/** The three kinds of input, each with its own hints (D-29). */
export const INPUT_KINDS: readonly InputKind[] = ['keyboard', 'touch', 'gamepad'];

/** Every control's bit: a kind that has used all six shows no hint. */
const EVERY_CONTROL = (1 << CONTROLS.length) - 1;

/** A control's bit in a kind's mask. */
export function controlBit(c: Control): number {
  return 1 << CONTROLS.indexOf(c);
}

/** A kind's mask as the tracker keeps it: a whole number's six control bits, 0 for anything else. */
const maskOf = (x: unknown): number => (Number.isInteger(x) && (x as number) >= 0 ? (x as number) & EVERY_CONTROL : 0);

const masksOf = (used: Readonly<Record<InputKind, number>>): Record<InputKind, number> => ({
  keyboard: maskOf(used.keyboard), touch: maskOf(used.touch), gamepad: maskOf(used.gamepad),
});

export class HintTracker {
  private masks: Record<InputKind, number>;
  private readonly save: (used: Record<InputKind, number>) => void;

  /** used: the profile's masks; save: stores a changed record, one write of all three (PLAN §10). */
  constructor(used: Readonly<Record<InputKind, number>>, save: (used: Record<InputKind, number>) => void) {
    this.masks = masksOf(used);
    this.save = save;
  }

  /** A control used on a kind of device: remembered, and saved if it's new (D-24, A.3). */
  use(kind: InputKind, c: Control): void {
    const bit = controlBit(c);
    if ((this.masks[kind] & bit) !== 0) return;
    this.masks = { ...this.masks, [kind]: this.masks[kind] | bit };
    this.save(this.used());
  }

  /** The controls a kind hasn't used yet, in CONTROLS' order: its hint's lines. */
  remaining(kind: InputKind): readonly Control[] {
    const mask = this.masks[kind];
    return CONTROLS.filter((c) => (mask & controlBit(c)) === 0);
  }

  /** Settings' "Show control hints again": all three kinds cleared, and saved (D-29, M4-Q28). */
  reset(): void {
    this.masks = { keyboard: 0, touch: 0, gamepad: 0 };
    this.save(this.used());
  }

  /** The profile's masks read again, as another screen may have changed them, Settings' reset among
   *  them: nothing saved. */
  sync(used: Readonly<Record<InputKind, number>>): void {
    this.masks = masksOf(used);
  }

  /** Each kind's mask now: a copy. */
  used(): Record<InputKind, number> {
    return { ...this.masks };
  }
}
