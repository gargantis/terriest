import type { Page } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Gamepad, type PadLike } from '../../src/input/gamepad';
import type { GamepadInspection } from '../../src/input/source';
import { FakeClock } from '../../src/ui/clock-testing';
import { PAD, type PadStub, stubGamepad, waitForPad } from './gamepad';

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

  it("presses the standard mapping's buttons, D-29's numbers written out, which the page's own Gamepad must act on (specs-F1)", () => {
    expect(PAD).toEqual({ jump: 0, pounce: 2, bark: 3, prev: 4, view: 5, zoomies: 7, back: 8, start: 9, up: 12, down: 13, left: 14, right: 15 });
    const w = stubbed();
    const g = new Gamepad({ clock: new FakeClock(0), onUi: () => {}, onConnected: () => {}, pads: () => w.navigator.getGamepads() });
    for (const press of ['jump', 'pounce', 'bark', 'view'] as const) {
      w.terriestPadStub.set(PAD[press], 1);
      const s = g.read();
      expect([s.jump, s.pounce, s.bark, s.view], press).toEqual(['jump', 'pounce', 'bark', 'view'].map((x) => x === press));
      w.terriestPadStub.set(PAD[press], 0);
      g.read();
    }
    w.terriestPadStub.set(PAD.zoomies, 1);
    expect(g.read().zoomies).toBe(true);
  });
});

// The stub's waits (§9.1), on the monotonic clock as e2e/lib/page.ts' are: the machine's clock, which
// phase 1c measured a second ahead every 32 s, stepping ahead ends none early.
describe("the stub's waits (§9.1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A page whose pad has polled once more at each look; its waits move a fake monotonic clock, while the
   *  machine's steps a minute ahead each time it's read. */
  function polling(): Page {
    let polls = 0;
    let mono = 0;
    let wall = 1.8e12;
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    vi.spyOn(Date, 'now').mockImplementation(() => (wall += 60_000));
    const pad = (): GamepadInspection => ({ connected: true, polls: polls++, presses: {} });
    return {
      evaluate: async () => ({ gamepad: pad() }),
      waitForTimeout: async (ms: number) => {
        mono += ms;
      },
    } as unknown as Page;
  }

  it("go by the monotonic clock, and fail once it's past the deadline", async () => {
    const page = polling();
    expect((await waitForPad(page, (g) => g.polls >= 4, 'four polls', 1000)).polls).toBe(4);
    await expect(waitForPad(page, () => false, 'a press never made', 1000)).rejects.toThrow(/^a press never made: not seen within 1000 ms/);
  });
});
