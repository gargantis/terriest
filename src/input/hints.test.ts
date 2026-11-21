import { describe, expect, it } from 'vitest';
import { controlBit, CONTROLS, HintTracker, INPUT_KINDS } from './hints';
import type { InputKind } from './source';

// The control hints' record (PLAN D-29, L83, A.3; M4's design §1.26, §4.7,
// M4-Q28): a bitmask of the six controls per kind of input, each control's
// bit its place in CONTROLS, so the profile's six bits are these; a use
// saved once, and only for its own kind; the controls still to use, in the
// panel's order; Show control hints again clearing all three.

type Masks = Record<InputKind, number>;
const NONE: Masks = { keyboard: 0, touch: 0, gamepad: 0 };

function tracker(used: Masks = NONE): { t: HintTracker; saves: Masks[] } {
  const saves: Masks[] = [];
  return { t: new HintTracker(used, (u) => saves.push(u)), saves };
}

describe('the bitmask per kind (M4-Q28)', () => {
  it("gives each of the six controls its place's bit, in the panel's order, the profile's 0x3f", () => {
    expect(CONTROLS).toEqual(['run', 'zoomies', 'jump', 'pounce', 'bark', 'view']);
    expect(CONTROLS.map(controlBit)).toEqual([1, 2, 4, 8, 16, 32]);
    expect(CONTROLS.reduce((m, c) => m | controlBit(c), 0)).toBe(0x3f);
    expect(INPUT_KINDS).toEqual(['keyboard', 'touch', 'gamepad']);
  });

  it("marks a control used on its own kind alone, and saves the record once, at its first use", () => {
    const { t, saves } = tracker();
    t.use('touch', 'pounce');
    expect(t.used()).toEqual({ keyboard: 0, touch: controlBit('pounce'), gamepad: 0 });
    expect(saves).toEqual([{ keyboard: 0, touch: 8, gamepad: 0 }]);
    t.use('touch', 'pounce');
    expect(saves).toHaveLength(1);
    t.use('gamepad', 'run');
    expect(saves.at(-1)).toEqual({ keyboard: 0, touch: 8, gamepad: 1 });
    expect(t.remaining('keyboard')).toEqual(CONTROLS);
  });

  it("lists the controls a kind hasn't used, in the panel's order, and none once all six have", () => {
    const { t } = tracker();
    for (const c of ['view', 'run', 'bark'] as const) t.use('keyboard', c);
    expect(t.remaining('keyboard')).toEqual(['zoomies', 'jump', 'pounce']);
    for (const c of CONTROLS) t.use('keyboard', c);
    expect(t.remaining('keyboard')).toEqual([]);
    expect(t.used().keyboard).toBe(0x3f);
  });

  it("starts from the profile's record, a cleared hint staying cleared after a reload", () => {
    const { t, saves } = tracker({ keyboard: 0x3f, touch: 0b000101, gamepad: 0 });
    expect(t.remaining('keyboard')).toEqual([]);
    expect(t.remaining('touch')).toEqual(['zoomies', 'pounce', 'bark', 'view']);
    t.use('keyboard', 'run');
    expect(saves).toEqual([]);
  });

  it("keeps the six bits of a record that isn't one, as the profile does", () => {
    const { t } = tracker({ keyboard: 0x7f, touch: -1, gamepad: 2.5 });
    expect(t.used()).toEqual({ keyboard: 0x3f, touch: 0, gamepad: 0 });
  });

  it("hands out copies: a caller's change never reaches the tracker", () => {
    const { t } = tracker();
    const u = t.used();
    u.keyboard = 0x3f;
    expect(t.remaining('keyboard')).toEqual(CONTROLS);
  });
});

describe('Show control hints again (D-29, M4-Q28)', () => {
  it('clears all three kinds and saves the cleared record', () => {
    const { t, saves } = tracker({ keyboard: 0x3f, touch: 0x3f, gamepad: 0b11 });
    t.reset();
    expect(saves).toEqual([NONE]);
    for (const k of INPUT_KINDS) expect(t.remaining(k)).toEqual(CONTROLS);
  });

  it("reads the profile again without saving, as another screen's reset leaves it", () => {
    const { t, saves } = tracker({ keyboard: 0x3f, touch: 0, gamepad: 0 });
    t.sync(NONE);
    expect(t.remaining('keyboard')).toEqual(CONTROLS);
    expect(saves).toEqual([]);
    t.use('keyboard', 'jump');
    expect(saves).toEqual([{ keyboard: 4, touch: 0, gamepad: 0 }]);
  });
});
