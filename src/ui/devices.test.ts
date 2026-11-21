import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { PAD, type PadLike } from '../input/gamepad';
import type { KeyboardScreen } from '../input/keyboard';
import type { Control, InputKind, UiCommand } from '../input/source';
import type { TouchControls } from '../input/touch';
import { FakeClock } from './clock-testing';
import { currentDevices, pageDevices } from './devices';
import { fake, FakeEvent, FakeNode, installDom, only } from './dom-testing';

// The page's devices (PLAN D-29, D-31; M4's design §1.63, §4): the keyboard,
// touch and the gamepad, made once; the pad's own timer while nothing
// samples, its polls left to the sampler's reads while they come; Q-17's
// commands to the app from the keys and the pad alike; the controls' uses
// to the host and each layer watching; touch and the pad let go on blur and
// on a hidden page; the touch layer's side from Settings' mirrored choice;
// and the devices found by the layers until they're disposed.

const PERIOD = 1000 / config.gamepadPollHz;

let dom: ReturnType<typeof installDom>;
/** Every rig's devices, disposed after each test, a failed one's too. */
const made: { dispose(): void }[] = [];
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  for (const d of made.splice(0)) d.dispose();
  dom.restore();
});

class Pad implements PadLike {
  connected = true;
  mapping = 'standard';
  axes = [0, 0, 0, 0];
  buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));

  set(button: number, value: number): void {
    this.buttons[button] = { pressed: value > 0, value };
  }
}

function rig() {
  const doc = Object.assign(dom.document, { visibilityState: 'visible' as DocumentVisibilityState });
  const pad = new Pad();
  const target = Object.assign(new FakeNode(doc), { document: doc, navigator: { getGamepads: () => [pad] } });
  const clock = new FakeClock(1000);
  const v = { screen: 'pitch' as KeyboardScreen, sampling: false, mirrored: false };
  const ui: UiCommand[] = [];
  const used: [InputKind, Control][] = [];
  const devices = pageDevices({
    clock, mirrored: () => v.mirrored, sampling: () => v.sampling, ui: (c) => ui.push(c), used: (k, c) => used.push([k, c]), uiActive: () => v.screen,
  }, target as unknown as Window);
  made.push(devices);
  const device = (kind: InputKind) => devices.list().find((d) => d.kind === kind)!;
  return { doc, pad, target, clock, v, ui, used, devices, device };
}

const pointer = (target: unknown, type: string, id: number, pointerType = 'touch'): void => {
  fake(target).dispatchEvent(Object.assign(new FakeEvent(type, { bubbles: true, cancelable: true }), { pointerId: id, pointerType, clientX: 0, clientY: 0 }));
};

describe("the page's devices (§1.63)", () => {
  it('are the keyboard, touch and the gamepad, the pad reporting for the hook on every screen', () => {
    const r = rig();
    expect(r.devices.list().map((d) => d.kind)).toEqual(['keyboard', 'touch', 'gamepad']);
    expect(r.devices.gamepad()).toMatchObject({ connected: false, polls: 0 });
    r.v.screen = 'other';
    r.clock.advance(PERIOD);
    expect(r.devices.gamepad()).toMatchObject({ connected: true, polls: 1 });
    r.devices.dispose();
  });

  it("run the pad on its own timer while nothing samples, and leave its polls to the sampler's reads while they come", () => {
    const r = rig();
    r.v.screen = 'results';
    r.clock.advance(1000 + PERIOD / 2);
    expect(r.devices.gamepad()!.polls).toBe(config.gamepadPollHz);
    r.v.screen = 'pitch';
    r.v.sampling = true;
    const pad = r.device('gamepad');
    pad.read();
    let reads = 0;
    const stop = r.clock.every(PERIOD, () => {
      pad.read();
      reads++;
    });
    const before = r.devices.gamepad()!.polls;
    r.clock.advance(1000);
    expect(r.devices.gamepad()!.polls - before).toBe(reads);
    stop();
    r.devices.dispose();
  });

  it("hand Q-17's commands to the app from the keys and the pad alike", () => {
    const r = rig();
    r.v.screen = 'menu';
    const key = Object.assign(new FakeEvent('keydown', { cancelable: true }), { code: 'Escape', repeat: false, ctrlKey: false, altKey: false, metaKey: false });
    r.target.dispatchEvent(key);
    r.pad.set(PAD.start, 1);
    r.clock.advance(PERIOD);
    expect(r.ui.map((c) => [c.kind, c.source])).toEqual([['menu', 'keyboard'], ['press', 'gamepad']]);
    r.devices.dispose();
  });

  it("tell the host and each layer watching of each control the controls report used, until a watcher stops", () => {
    const r = rig();
    const heard: string[] = [];
    const stop = r.devices.onUsed((k, c) => heard.push(`${k} ${c}`));
    r.devices.used('touch', 'jump');
    stop();
    r.devices.used('gamepad', 'run');
    expect(heard).toEqual(['touch jump']);
    expect(r.used).toEqual([['touch', 'jump'], ['gamepad', 'run']]);
    r.devices.dispose();
  });

  it('let go of touch and the pad on the window\'s blur and on a hidden page, as the keyboard does', () => {
    const r = rig();
    const touch = r.device('touch') as TouchControls;
    touch.setVisible(true);
    pointer(r.doc.documentElement, 'pointerdown', 1);
    pointer(only(fake(touch.el), '[data-test="touch-jump"]'), 'pointerdown', 2);
    r.pad.set(PAD.bark, 1);
    r.clock.advance(PERIOD);
    r.target.dispatchEvent(new FakeEvent('blur'));
    expect(touch.read().jump).toBe(false);
    expect(r.device('gamepad').read().bark).toBe(false);
    pointer(only(fake(touch.el), '[data-test="touch-view"]'), 'pointerdown', 3);
    // A press the pad's own poll kept, nothing sampling, as a page about to be hidden has.
    r.pad.set(PAD.pounce, 1);
    r.clock.advance(PERIOD);
    r.doc.visibilityState = 'hidden';
    r.doc.dispatchEvent(new FakeEvent('visibilitychange'));
    expect(touch.inspect().held).toEqual([]);
    expect(r.device('gamepad').read().pounce).toBe(false);
    r.doc.visibilityState = 'visible';
    expect(touch.read().view).toBe(false);
    r.devices.dispose();
  });

  it("hold nothing on the pad while the page is hidden, the stick held through it, and send no command, as a networked page samples on (D-31)", () => {
    const r = rig();
    r.pad.axes = [-1, 0, 0, 0]; // the stick held left
    expect(r.device('gamepad').read().direction).not.toBeNull();
    r.doc.visibilityState = 'hidden';
    r.doc.dispatchEvent(new FakeEvent('visibilitychange'));
    r.v.sampling = true; // a networked page goes on sending while hidden
    expect(r.device('gamepad').read()).toMatchObject({ direction: null, stickStep: null, zoomies: false });
    r.pad.set(PAD.back, 1);
    expect(r.device('gamepad').read().direction).toBeNull();
    r.clock.advance(PERIOD);
    expect(r.ui).toEqual([]);
    r.doc.visibilityState = 'visible';
    r.pad.set(PAD.back, 0);
    expect(r.device('gamepad').read().direction).not.toBeNull();
  });

  it("read touch only on a player's pitch, its side Settings' mirrored layout", () => {
    const r = rig();
    const touch = r.devices.touch;
    touch.setVisible(true);
    pointer(r.doc.documentElement, 'pointerdown', 1);
    pointer(only(fake(touch.el), '[data-test="touch-pounce"]'), 'pointerdown', 2);
    r.v.screen = 'menu';
    expect(touch.read().pounce).toBe(false);
    r.v.mirrored = true;
    touch.setVisible(true);
    expect(touch.el.classList.contains('mirrored')).toBe(true);
    expect(touch.el.style.getPropertyValue('--touch-edge')).toBe(`${config.touchEdgeMarginCssPx}px`);
    r.devices.dispose();
  });

  it("are the layers' until disposed, when every listener and timer goes", () => {
    const r = rig();
    expect(currentDevices()).toBe(r.devices);
    r.devices.dispose();
    expect(currentDevices()).toBeNull();
    expect(r.clock.pending).toBe(0);
    r.v.screen = 'menu';
    r.target.dispatchEvent(Object.assign(new FakeEvent('keydown', { cancelable: true }), { code: 'Escape', repeat: false, ctrlKey: false, altKey: false, metaKey: false }));
    pointer(r.doc.documentElement, 'pointerdown', 1);
    expect(r.ui).toEqual([]);
    expect(r.devices.touch.inspect().mode).toBeNull();
  });

  it('keep the newest made as the layers\', an older one going leaving it', () => {
    const a = rig();
    const b = rig();
    expect(currentDevices()).toBe(b.devices);
    a.devices.dispose();
    expect(currentDevices()).toBe(b.devices);
    b.devices.dispose();
  });
});
