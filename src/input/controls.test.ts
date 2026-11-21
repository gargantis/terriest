import { describe, expect, it } from 'vitest';
import { config, derived } from '../config';
import { barkCount, encodeInput, FRAME_BALL, FRAME_PITCH, frameOf, heldDirection, jumpCount, pounceCount, stepOf, ZOOMIES } from '../core/sim/input';
import { genesis } from '../core/sim/state';
import type { ViewMode } from '../render/frame';
import { stickStepOf } from './anchoring';
import { Controls, type ControlsOptions } from './controls';
import { Keyboard, type KeyboardScreen } from './keyboard';
import type { Control, Device, DeviceState, InputKind } from './source';

// The input source the match samples (PLAN D-10, D-29, A.2, L327, L342,
// R-6; M4's design §1.25, §4.1, §4.6, M4-Q24, M4-Q25): the press counters,
// at most one step a sampled tick; a tap shorter than a tick, through the
// keyboard; the rebase; the bark gap; the view press; the devices merged; a
// held direction's input repeating exactly; the holds' spans and the
// key-to-screen figure from a device's event times.

const HEAD = genesis({ packSize: 1, matchMinutes: 1 });
const UNIT = (2 * Math.PI) / config.stickSteps;
const GAP = derived.barkGapTicks;

type Press = 'jump' | 'pounce' | 'bark' | 'view';

/** A device the test sets: what it holds, and presses kept until its next read, as a device keeps them. */
class FakeDevice implements Device {
  readonly kind: InputKind;
  direction: number | null = null;
  stickStep: number | null = null;
  zoomies = false;
  private pressed = new Set<Press>();
  private changedAt: number | null = null;
  reads = 0;
  releases = 0;

  constructor(kind: InputKind) {
    this.kind = kind;
  }

  /** A stick at `steps` steps from screen up, quantised as the device would; null lets go. */
  stick(steps: number | null, atMs?: number): void {
    this.direction = steps === null ? null : steps * UNIT;
    this.stickStep = steps === null ? null : stickStepOf(steps * UNIT, null, config.stickSteps, config.stickHysteresisSteps);
    if (atMs !== undefined) this.changedAt ??= atMs;
  }

  press(p: Press, atMs?: number): void {
    this.pressed.add(p);
    if (atMs !== undefined) this.changedAt ??= atMs;
  }

  read(): DeviceState {
    this.reads++;
    const s: DeviceState = {
      direction: this.direction, stickStep: this.stickStep, zoomies: this.zoomies,
      jump: this.pressed.has('jump'), pounce: this.pressed.has('pounce'), bark: this.pressed.has('bark'), view: this.pressed.has('view'),
      changedAtMs: this.changedAt,
    };
    this.pressed = new Set();
    this.changedAt = null;
    return s;
  }

  release(): void {
    this.releases++;
    this.direction = this.stickStep = null;
    this.zoomies = false;
    this.pressed = new Set();
    this.changedAt = null;
  }

  dispose(): void {}
}

/** Controls over the given devices, the view and the yaw set by the test, the callbacks kept. */
function controls(o: Partial<ControlsOptions> = {}, ...devices: Device[]) {
  const s = { view: 'ball' as ViewMode, yaw: 0, views: 0, barks: [] as number[], used: [] as [InputKind, Control][] };
  const c = new Controls({
    view: () => s.view, yaw: () => s.yaw,
    onView: () => s.views++, onBark: (t) => s.barks.push(t), onUsed: (k, u) => s.used.push([k, u]),
    ...o,
  });
  for (const d of devices) c.add(d);
  return { c, s, sample: (tick: number): number => c.sample(HEAD, tick, tick) };
}

describe('the press counters (D-10, M4-Q25)', () => {
  it('advance once for each sampled tick with a press, whatever the devices reported, wrapping at 4', () => {
    const pad = new FakeDevice('gamepad');
    const touch = new FakeDevice('touch');
    const { c, sample } = controls({}, pad, touch);
    expect(jumpCount(sample(1))).toBe(0);
    pad.press('jump');
    expect(jumpCount(sample(2))).toBe(1);
    expect(jumpCount(sample(3)), 'kept, not pressed again').toBe(1);
    // Two devices pressing in one tick: one step.
    pad.press('jump');
    touch.press('jump');
    touch.press('pounce');
    const v = sample(4);
    expect([jumpCount(v), pounceCount(v)]).toEqual([2, 1]);
    pad.press('jump');
    expect(jumpCount(sample(5))).toBe(3);
    pad.press('jump');
    expect(jumpCount(sample(6)), 'round to 0').toBe(0);
    expect(c.inspect().presses).toEqual({ jump: 4, pounce: 1, bark: 0, view: 0 });
  });

  it('count a tap shorter than a tick, through the keyboard: down and up between two samples', () => {
    const w = Object.assign(new EventTarget(), { document: Object.assign(new EventTarget(), { visibilityState: 'visible' }) });
    const screen: KeyboardScreen = 'pitch';
    const keys = new Keyboard(w as unknown as Window, () => {}, () => screen);
    const { sample } = controls({}, keys);
    const key = (type: string, code: string): void => {
      const e = new Event(type, { cancelable: true });
      Object.defineProperties(e, { code: { value: code }, repeat: { value: false }, timeStamp: { value: 0 } });
      w.dispatchEvent(e);
    };
    expect(jumpCount(sample(1))).toBe(0);
    key('keydown', 'Space');
    key('keyup', 'Space');
    key('keydown', 'KeyE');
    key('keyup', 'KeyE');
    const v = sample(2);
    expect([jumpCount(v), pounceCount(v)]).toEqual([1, 1]);
    expect(jumpCount(sample(3))).toBe(1);
  });
});

describe('the rebase at onControl (D-10, §4.6)', () => {
  it("starts jump and pounce from the stored input and the bark at 0, keeps what's held, and presses nothing", () => {
    const pad = new FakeDevice('gamepad');
    const { c, sample } = controls({}, pad);
    for (let t = 1; t <= 3; t++) {
      pad.press('jump');
      pad.press('bark');
      sample(t * GAP);
    }
    pad.stick(8);
    const before = sample(4 * GAP);
    expect([jumpCount(before), barkCount(before)]).toEqual([3, 3]);
    // A rejoin's stored input: jump counter 1, pounce 2, its bark bits cleared as the state keeps them.
    const base = encodeInput({ step: 3, frame: FRAME_BALL, jump: 1, pounce: 2 });
    c.rebase(base);
    expect(c.inspect().base).toBe(base);
    expect(c.inspect().firstAfterBase).toBeNull();
    const first = sample(4 * GAP + 1);
    expect([jumpCount(first), pounceCount(first), barkCount(first)]).toEqual([1, 2, 0]);
    expect([stepOf(first), frameOf(first)], 'what was held, held still').toEqual([8, FRAME_BALL]);
    expect(c.inspect().firstAfterBase).toBe(first);
    // The next samples press from there.
    pad.press('jump');
    const next = sample(4 * GAP + 2);
    expect([jumpCount(next), pounceCount(next)]).toEqual([2, 2]);
    expect(c.inspect().firstAfterBase).toBe(first);
    // A JOIN's base, 0.
    c.rebase(0);
    expect([jumpCount(sample(4 * GAP + 3)), pounceCount(sample(4 * GAP + 4))]).toEqual([0, 0]);
  });

  it('acts no press kept from before it at the first sample, which a rejoining page made, but still switches the view', () => {
    const pad = new FakeDevice('gamepad');
    const { c, s, sample } = controls({ onView: () => (s.view = s.view === 'ball' ? 'chase' : 'ball') }, pad);
    sample(1);
    // Pressed while the page rejoined, with no sample to take them.
    pad.press('jump');
    pad.press('pounce');
    pad.press('bark');
    pad.press('view');
    const base = encodeInput({ jump: 3, pounce: 1 });
    c.rebase(base);
    const first = sample(500);
    expect([jumpCount(first), pounceCount(first), barkCount(first)]).toEqual([3, 1, 0]);
    expect(c.inspect().firstAfterBase).toBe(first);
    expect(s.barks, 'no bark drawn here alone, which peers would take as their baseline').toEqual([]);
    expect(c.inspect().presses).toEqual({ jump: 0, pounce: 0, bark: 0, view: 1 });
    expect(s.view, 'the view switched').toBe('chase');
    // A press after it acts.
    pad.press('jump');
    pad.press('bark');
    const next = sample(501);
    expect([jumpCount(next), pounceCount(next), barkCount(next)]).toEqual([0, 1, 1]);
    expect(s.barks).toEqual([501]);
  });
});

describe('the bark gap (L327)', () => {
  it('sends one bark a second, drops and counts the rest, and tells onBark of each sent', () => {
    const pad = new FakeDevice('gamepad');
    const { c, s, sample } = controls({}, pad);
    const barkAt = (t: number): number => {
      pad.press('bark');
      return barkCount(sample(t));
    };
    expect(barkAt(100)).toBe(1);
    expect(barkAt(130)).toBe(1);
    expect(barkAt(100 + GAP - 1)).toBe(1);
    expect(barkAt(100 + GAP)).toBe(2);
    expect(s.barks).toEqual([100, 100 + GAP]);
    expect(c.inspect().barksDropped).toBe(2);
    expect(c.inspect().presses.bark).toBe(2);
    // Another timeline's ticks start again: the gap with them.
    expect(barkAt(5)).toBe(3);
    expect(s.barks).toEqual([100, 100 + GAP, 5]);
  });
});

describe('the view press (§3.4, §4.1)', () => {
  it('switches the view through onView, never into the input, and the switch is read in the same input', () => {
    const pad = new FakeDevice('gamepad');
    const { c, s, sample } = controls({ onView: () => (s.view = s.view === 'ball' ? 'chase' : 'ball') }, pad);
    pad.stick(0);
    s.yaw = 1;
    const ball = sample(1);
    expect([stepOf(ball), frameOf(ball)]).toEqual([0, FRAME_BALL]);
    pad.press('view');
    const chase = sample(2);
    expect([stepOf(chase), frameOf(chase)], "chase view's read of the yaw, at once").toEqual([5, FRAME_PITCH]);
    expect(chase & ~0x1f & ~(3 << 6), 'nothing else moved').toBe(ball & ~0x1f & ~(3 << 6));
    expect(c.inspect().presses.view).toBe(1);
    expect(c.inspect().view).toBe('chase');
  });

  it('reads the held direction again after viewChanged, and when the view changed under it', () => {
    const pad = new FakeDevice('gamepad');
    const { c, s, sample } = controls({}, pad);
    s.view = 'chase';
    s.yaw = 0.3;
    pad.stick(0);
    expect(stepOf(sample(1))).toBe(2);
    s.yaw = 1;
    expect(stepOf(sample(2)), 'kept on the pitch').toBe(2);
    c.viewChanged();
    expect(stepOf(sample(3))).toBe(5);
    // To ball view and back without a call: read again too.
    s.view = 'ball';
    sample(4);
    s.view = 'chase';
    s.yaw = 2;
    expect(stepOf(sample(5))).toBe(10);
  });
});

describe('chase view through the controls (Q-19, C-24)', () => {
  it("turns the kept direction for a stick moved less than chaseRereadDegrees, and reads the yaw from there", () => {
    const pad = new FakeDevice('gamepad');
    const { s, sample } = controls({}, pad);
    s.view = 'chase';
    s.yaw = 0.3;
    pad.stick(0);
    expect(stepOf(sample(1))).toBe(2);
    // The camera swings; the stick moves 3 steps, 33.75°: turned with it, the yaw unread.
    s.yaw = 1;
    pad.stick(3);
    expect(stepOf(sample(2))).toBe(5);
    // 4 steps from the read, the setting's 45°: the screen read again under the yaw now.
    expect((config.chaseRereadDegrees * config.stickSteps) / 360).toBe(4);
    pad.stick(4);
    expect(stepOf(sample(3))).toBe(9);
  });
});

describe('the devices merged (§4.1)', () => {
  it("steers by the device whose direction changed last while it holds one, and zoomies from any", () => {
    const keys = new FakeDevice('keyboard');
    const pad = new FakeDevice('gamepad');
    const { sample } = controls({}, keys, pad);
    keys.direction = 0;
    expect(stepOf(sample(1))).toBe(0);
    pad.stick(24);
    expect(stepOf(sample(2)), 'the stick moved last').toBe(24);
    keys.direction = Math.PI / 2;
    expect(stepOf(sample(3)), 'then the keys').toBe(8);
    keys.direction = null;
    expect(stepOf(sample(4)), 'the keys let go: the stick still held').toBe(24);
    pad.zoomies = true;
    expect(sample(5) & ZOOMIES).toBe(ZOOMIES);
    pad.stick(null);
    const v = sample(6);
    expect([heldDirection(v), v & ZOOMIES]).toEqual([false, ZOOMIES]);
    pad.zoomies = false;
    expect(sample(7)).toBe(0);
    // Zoomies held on the first device alone, the last one read holding none.
    keys.zoomies = true;
    expect(sample(8)).toBe(ZOOMIES);
  });

  it('reads the screen again in chase view when another device takes over', () => {
    const keys = new FakeDevice('keyboard');
    const pad = new FakeDevice('gamepad');
    const { s, sample } = controls({}, keys, pad);
    s.view = 'chase';
    s.yaw = 0.3;
    keys.direction = 0;
    expect(stepOf(sample(1))).toBe(2);
    s.yaw = 1;
    // The stick, 1 step from the keys' read: another device, so read, not turned.
    pad.stick(1);
    expect(stepOf(sample(2))).toBe(6);
  });

  it('a removed device steers no more', () => {
    const keys = new FakeDevice('keyboard');
    const pad = new FakeDevice('gamepad');
    const { c, sample } = controls({}, keys, pad);
    keys.direction = 0;
    pad.stick(24);
    expect(stepOf(sample(1))).toBe(24);
    c.remove(pad);
    expect(stepOf(sample(2))).toBe(0);
    expect(c.inspect().devices).toEqual(['keyboard']);
    c.add(keys);
    expect(c.inspect().devices, 'added once').toEqual(['keyboard']);
  });
});

describe('prediction holds (D-10, L342)', () => {
  it('gives a held, unmoved direction the same input tick after tick, in either view while the camera swings', () => {
    for (const view of ['ball', 'chase'] as const) {
      const pad = new FakeDevice('gamepad');
      const { s, sample } = controls({}, pad);
      s.view = view;
      pad.stick(6);
      pad.zoomies = true;
      const inputs = new Set<number>();
      for (let t = 1; t <= 120; t++) {
        s.yaw = Math.sin(t / 10) * 2;
        inputs.add(sample(t));
      }
      expect(inputs.size, view).toBe(1);
    }
  });
});

describe("the hook's figures", () => {
  it("keeps each held direction's span as sampled: its step, its frame and the first and last tick it went into", () => {
    const pad = new FakeDevice('gamepad');
    const { c, s, sample } = controls({}, pad);
    sample(9);
    pad.stick(8);
    for (let t = 10; t <= 19; t++) sample(t);
    pad.stick(24);
    for (let t = 20; t <= 24; t++) sample(t);
    pad.stick(null);
    sample(25);
    s.view = 'chase';
    pad.stick(0);
    sample(30);
    expect(c.inspect().holds).toEqual([
      { step: 8, frame: FRAME_BALL, from: 10, to: 19 },
      { step: 24, frame: FRAME_BALL, from: 20, to: 24 },
      { step: 0, frame: FRAME_PITCH, from: 30, to: null },
    ]);
    expect(c.inspect().lastInput).toBe(encodeInput({ step: 0, frame: FRAME_PITCH }));
  });

  it('times key to screen from the event that changed the input to the first frame drawn at or past its tick (R-6)', () => {
    const pad = new FakeDevice('gamepad');
    const keys = new FakeDevice('keyboard');
    const { c, s, sample } = controls({}, pad, keys);
    expect(c.inspect().latencyMs).toEqual({ count: 0, p50: null, p95: null });
    pad.stick(8, 1000);
    sample(50);
    c.frameDrawn(49, 1030);
    expect(c.inspect().latencyMs.count, 'not yet at its tick').toBe(0);
    c.frameDrawn(50, 1040);
    c.frameDrawn(51, 1060);
    expect(c.inspect().latencyMs).toEqual({ count: 1, p50: 40, p95: 40 });
    // A press, and changes on two devices for one tick: from the first of them.
    pad.press('jump', 2000);
    sample(60);
    pad.stick(16, 2100);
    pad.zoomies = true;
    keys.press('pounce', 2090);
    sample(61);
    c.frameDrawn(62, 2170);
    expect(c.inspect().latencyMs).toEqual({ count: 3, p50: 80, p95: 170 });
    // A change that left the input as it was gives none: a bark inside the gap after one sent.
    pad.press('bark', 3000);
    sample(100);
    pad.press('bark', 3100);
    sample(101);
    c.frameDrawn(101, 3200);
    expect(c.inspect().latencyMs.count, "the sent bark's, not the dropped one's").toBe(4);
    // And none from an input that changed with no event behind it: chase view's read of the yaw.
    s.view = 'chase';
    s.yaw = 1;
    expect(frameOf(sample(102))).toBe(FRAME_PITCH);
    c.frameDrawn(110, 4000);
    expect(c.inspect().latencyMs).toEqual({ count: 4, p50: 80, p95: 200 });
  });

  it('lets every device go on release, and drops the inputs waiting for a frame', () => {
    const pad = new FakeDevice('gamepad');
    const keys = new FakeDevice('keyboard');
    const { c, sample } = controls({}, pad, keys);
    pad.stick(8, 1000);
    sample(10);
    c.release();
    expect([pad.releases, keys.releases]).toEqual([1, 1]);
    c.frameDrawn(20, 9000);
    expect(c.inspect().latencyMs.count).toBe(0);
    expect(heldDirection(sample(11))).toBe(false);
    expect(c.inspect().holds).toEqual([{ step: 8, frame: FRAME_BALL, from: 10, to: 10 }]);
  });

  it('tells onUsed of run and zoomies as they start and of each press, by kind', () => {
    const pad = new FakeDevice('gamepad');
    const keys = new FakeDevice('keyboard');
    const { s, sample } = controls({}, pad, keys);
    pad.stick(4);
    sample(1);
    pad.stick(5);
    sample(2);
    keys.zoomies = true;
    keys.press('jump');
    pad.press('bark');
    sample(3);
    sample(4);
    pad.stick(null);
    sample(5);
    pad.stick(2);
    pad.press('view');
    keys.press('pounce');
    sample(6);
    // In the order the devices were added, and each device's in the order of its controls.
    expect(s.used).toEqual([
      ['gamepad', 'run'],
      ['gamepad', 'bark'], ['keyboard', 'zoomies'], ['keyboard', 'jump'],
      ['gamepad', 'run'], ['gamepad', 'view'], ['keyboard', 'pounce'],
    ]);
  });

  it('reports its devices and the view of the last sample', () => {
    const { c, s, sample } = controls({}, new FakeDevice('keyboard'), new FakeDevice('touch'));
    expect(c.inspect()).toMatchObject({ devices: ['keyboard', 'touch'], view: null, lastInput: null, base: null, firstAfterBase: null });
    s.view = 'chase';
    sample(1);
    expect(c.inspect()).toMatchObject({ view: 'chase', lastInput: 0 });
  });
});
