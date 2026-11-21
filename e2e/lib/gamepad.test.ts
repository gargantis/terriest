import { describe, expect, it } from 'vitest';
import { Gamepad, type PadLike } from '../../src/input/gamepad';
import { FakeClock } from '../../src/ui/clock-testing';
import { PAD, type PadStub, stubGamepad } from './gamepad';

// The specs' gamepad stub (M4's design §1.62, §16): its init script stands
// alone, as Playwright sends its source to the page; navigator.getGamepads
// reports one pad of the standard mapping, which window.terriestPadStub
// moves; and the page's own Gamepad (src/input/gamepad.ts) reads it as it
// would a real pad, each press of the stub one rising edge.

interface StubbedWindow { readonly navigator: { getGamepads(): readonly (PadLike | null)[] }; readonly terriestPadStub: PadStub }

/** A window as the stub sees one, stubbed by the script's source alone, run the way a page would. */
function stubbed(): StubbedWindow {
  const w = { navigator: {} };
  // Playwright's way: the function's source, run with nothing round it.
  const script = new Function(`return (${stubGamepad.toString()})`)() as (w: object) => void;
  script(w);
  return w as unknown as StubbedWindow;
}

describe("the gamepad's stub (§1.62)", () => {
  it('reports one connected pad of the standard mapping, its 17 buttons and 4 axes at rest', () => {
    const w = stubbed();
    const pads = w.navigator.getGamepads();
    expect(pads).toHaveLength(4);
    expect(pads[0]).toMatchObject({ connected: true, mapping: 'standard', axes: [0, 0, 0, 0] });
    expect(pads[0]!.buttons).toHaveLength(17);
    expect(pads[0]!.buttons.every((b) => !b.pressed && b.value === 0)).toBe(true);
    expect(pads.slice(1)).toEqual([null, null, null]);
  });

  it("moves its buttons, its stick and its plug at the spec's word, and refuses what no pad does", () => {
    const w = stubbed();
    w.terriestPadStub.set(PAD.zoomies, 0.6);
    w.terriestPadStub.stick(-1, 0.5);
    expect(w.navigator.getGamepads()[0]!.buttons[PAD.zoomies]).toMatchObject({ pressed: true, value: 0.6 });
    expect(w.navigator.getGamepads()[0]!.axes.slice(0, 2)).toEqual([-1, 0.5]);
    w.terriestPadStub.connected(false);
    expect(w.navigator.getGamepads()[0]).toBeNull();
    expect(() => w.terriestPadStub.set(17, 1)).toThrow(RangeError);
    expect(() => w.terriestPadStub.stick(2, 0)).toThrow(RangeError);
  });

  it("is read by the page's own Gamepad, each press a rising edge counted once", () => {
    const w = stubbed();
    const clock = new FakeClock(0);
    const g = new Gamepad({ clock, onUi: () => {}, onConnected: () => {}, pads: () => w.navigator.getGamepads() });
    w.terriestPadStub.set(PAD.jump, 1);
    expect(g.read().jump).toBe(true);
    expect(g.read().jump).toBe(false);
    w.terriestPadStub.set(PAD.jump, 0);
    g.read();
    w.terriestPadStub.set(PAD.jump, 1);
    g.read();
    expect(g.inspect()).toMatchObject({ connected: true, polls: 4 });
    expect(g.inspect().presses[String(PAD.jump)]).toBe(2);
    w.terriestPadStub.stick(0, -1);
    expect(g.read().stickStep).toBe(0);
  });
});
