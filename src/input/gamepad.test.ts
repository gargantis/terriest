import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { FakeClock } from '../ui/clock-testing';
import { browserPads, Gamepad, PAD, type PadLike } from './gamepad';
import type { KeyboardScreen } from './keyboard';
import type { UiCommand } from './source';

// The gamepad (PLAN D-29, L79, L82, Q-17, C-6, C-34; M4's design §1.23,
// §4.4, §4.8, §4.9): the standard mapping on a player's pitch; a press a
// rising edge between two polls, counted once however often the pad is
// read; the menus' commands on each screen, Results' bottom button and a
// spectator's shoulders among them, sent after the sample that found them;
// the timer of its own while nothing samples, in virtual time, never on
// animation frames; nothing held off the pitch or on a hidden page; the
// figures the hook reads.

const UNIT = (2 * Math.PI) / config.stickSteps;
const PERIOD = 1000 / config.gamepadPollHz;

/** A pad the test sets, as navigator.getGamepads() reports one. */
class FakePad implements PadLike {
  connected = true;
  mapping = 'standard';
  axes = [0, 0, 0, 0];
  buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));

  set(button: number, value: number): void {
    this.buttons[button] = { pressed: value > 0, value };
  }

  /** The left stick `r` of its travel at `steps` steps counter-clockwise from up, screen y down. */
  stick(steps: number, r = 1): void {
    this.axes[0] = -r * Math.sin(steps * UNIT);
    this.axes[1] = -r * Math.cos(steps * UNIT);
  }
}

function rig(o: { screen?: KeyboardScreen; sampling?: boolean } = {}) {
  const clock = new FakeClock(1000);
  const pad = new FakePad();
  const v = { screen: o.screen ?? ('pitch' as KeyboardScreen), sampling: o.sampling ?? false, hidden: false, pads: [pad] as (PadLike | null)[] };
  const ui: UiCommand[] = [];
  const connected: boolean[] = [];
  const g = new Gamepad({
    clock, onUi: (c) => ui.push(c), onConnected: (on) => connected.push(on),
    uiActive: () => v.screen, sampling: () => v.sampling, hidden: () => v.hidden, pads: () => v.pads,
  });
  return { clock, pad, v, ui, connected, g, kinds: () => ui.map((c) => c.kind) };
}

describe("the standard mapping on a player's pitch (D-29)", () => {
  it("runs on the left stick, counter-clockwise from screen up, with the stick's steps", () => {
    const r = rig();
    for (const steps of [0, 8, 16, 24, 5]) {
      r.pad.stick(steps);
      const s = r.g.read();
      expect(s.stickStep).toBe(steps);
      expect(s.direction).toBeCloseTo(steps * UNIT, 9);
    }
    r.pad.axes = [0, -1, 0, 0];
    expect(Object.is(r.g.read().direction, 0)).toBe(true);
  });

  it("has no direction within the stick's dead zone, its edge included", () => {
    const r = rig();
    // Straight up, so the edge is exact.
    r.pad.stick(0, config.stickDeadZoneFraction);
    expect(r.g.read()).toMatchObject({ direction: null, stickStep: null });
    r.pad.stick(3, config.stickDeadZoneFraction + 0.01);
    expect(r.g.read().stickStep).toBe(3);
  });

  it('keeps its step while the angle stays within half a step past its edges (§4.5)', () => {
    const r = rig();
    r.pad.stick(4);
    expect(r.g.read().stickStep).toBe(4);
    r.pad.stick(4.9);
    expect(r.g.read()).toMatchObject({ stickStep: 4, changedAtMs: null });
    r.pad.stick(5.1);
    expect(r.g.read().stickStep).toBe(5);
  });

  it('jumps, pounces, barks and switches the view on buttons 0, 2, 3 and 5, each kept until the next read', () => {
    const r = rig();
    for (const [button, press] of [[PAD.jump, 'jump'], [PAD.pounce, 'pounce'], [PAD.bark, 'bark'], [PAD.view, 'view']] as const) {
      r.pad.set(button, 1);
      const s = r.g.read();
      expect(s[press], press).toBe(true);
      expect([s.jump, s.pounce, s.bark, s.view].filter(Boolean)).toHaveLength(1);
      r.pad.set(button, 0);
    }
    expect(r.ui).toEqual([]);
  });

  it('is zoomies only with the right trigger past gamepadTriggerFraction of its travel', () => {
    const r = rig();
    r.pad.set(PAD.zoomies, config.gamepadTriggerFraction);
    expect(r.g.read().zoomies).toBe(false);
    r.pad.set(PAD.zoomies, config.gamepadTriggerFraction + 0.01);
    expect(r.g.read()).toMatchObject({ zoomies: true, changedAtMs: 1000 });
    r.pad.set(PAD.zoomies, 0);
    expect(r.g.read().zoomies).toBe(false);
  });

  it("reports the poll's time of the first change since the last read, for the key-to-screen figure (R-6)", () => {
    const r = rig();
    r.pad.stick(8);
    r.clock.advance(5);
    const s = r.g.read();
    expect(s.changedAtMs).toBe(1005);
    r.clock.advance(5);
    expect(r.g.read().changedAtMs).toBeNull();
  });

  it('reads only a connected pad of the standard mapping, the first one', () => {
    const r = rig();
    const other = new FakePad();
    other.mapping = '';
    other.set(PAD.jump, 1);
    r.v.pads = [null, other];
    expect(r.g.read().jump).toBe(false);
    expect(r.g.inspect().connected).toBe(false);
    r.pad.set(PAD.pounce, 1);
    r.v.pads = [other, r.pad];
    expect(r.g.read()).toMatchObject({ pounce: true, jump: false });
  });
});

describe('a press, a rising edge between two polls (§1.23, §16)', () => {
  it('counts once however often the pad is read while the button stays down', () => {
    const r = rig();
    r.pad.set(PAD.jump, 1);
    expect([r.g.read().jump, r.g.read().jump, r.g.read().jump]).toEqual([true, false, false]);
    expect(r.g.inspect().presses[String(PAD.jump)]).toBe(1);
    r.pad.set(PAD.jump, 0);
    r.g.read();
    r.pad.set(PAD.jump, 1);
    expect(r.g.read().jump).toBe(true);
    expect(r.g.inspect().presses[String(PAD.jump)]).toBe(2);
  });

  it("keeps a press its own timer saw until the next read, so a press between two reads counts", () => {
    const r = rig();
    r.g.setOwnTimer(true);
    r.pad.set(PAD.bark, 1);
    r.clock.advance(PERIOD);
    r.pad.set(PAD.bark, 0);
    r.clock.advance(PERIOD);
    expect(r.g.read().bark).toBe(true);
    expect(r.g.read().bark).toBe(false);
  });

  it('counts every button for the hook, on every screen, with its polls', () => {
    const r = rig({ screen: 'other' });
    r.pad.set(PAD.start, 1);
    r.g.read();
    r.g.read();
    const g = r.g.inspect();
    expect(g).toMatchObject({ connected: true, polls: 2 });
    expect(Object.keys(g.presses)).toHaveLength(17);
    expect(g.presses[String(PAD.start)]).toBe(1);
    expect(g.presses[String(PAD.back)]).toBe(0);
  });
});

describe("the menus' commands (Q-17, C-34)", () => {
  it('moves on the d-pad, presses on Start and opens or closes the menu on Back, on every screen', () => {
    for (const screen of ['pitch', 'menu', 'results', 'other'] as const) {
      const r = rig({ screen });
      r.g.setOwnTimer(true);
      for (const b of [PAD.up, PAD.down, PAD.left, PAD.right, PAD.start, PAD.back]) {
        r.pad.set(b, 1);
        r.clock.advance(PERIOD);
        r.pad.set(b, 0);
        r.clock.advance(PERIOD);
      }
      expect(r.kinds(), screen).toEqual(['up', 'down', 'left', 'right', 'press', 'menu']);
      expect(r.ui.every((c) => c.source === 'gamepad' && !c.repeat)).toBe(true);
      r.g.dispose();
    }
  });

  it('presses on the bottom button on Results, but only ever jumps with it on the pitch, so it never presses Ready', () => {
    const results = rig({ screen: 'results' });
    results.pad.set(PAD.jump, 1);
    results.g.read();
    results.clock.advance(0);
    expect(results.kinds()).toEqual(['press']);
    const pitch = rig();
    pitch.pad.set(PAD.jump, 1);
    expect(pitch.g.read().jump).toBe(true);
    pitch.clock.advance(0);
    expect(pitch.kinds()).toEqual([]);
  });

  it("cycles a spectator's follow on the shoulders, where a player's right shoulder switches the view", () => {
    const r = rig({ screen: 'spectator' });
    r.g.setOwnTimer(true);
    for (const b of [PAD.view, PAD.prev, PAD.view]) {
      r.pad.set(b, 1);
      r.clock.advance(PERIOD);
      r.pad.set(b, 0);
      r.clock.advance(PERIOD);
    }
    expect(r.kinds()).toEqual(['next', 'prev', 'next']);
    expect(r.g.read().view).toBe(false);
  });

  it("stamps each command with its poll's time, once however long the button is held", () => {
    const r = rig({ screen: 'menu' });
    r.g.setOwnTimer(true);
    r.pad.set(PAD.down, 1);
    r.clock.advance(10 * PERIOD);
    expect(r.ui).toEqual([{ kind: 'down', pressedAt: 1000 + PERIOD, source: 'gamepad', repeat: false }]);
  });

  it("hands a command the sampler's read found to the screen once the sample is done, never inside it", () => {
    const r = rig();
    r.pad.set(PAD.back, 1);
    r.g.read();
    expect(r.ui).toEqual([]);
    r.clock.advance(0);
    expect(r.ui).toEqual([{ kind: 'menu', pressedAt: 1000, source: 'gamepad', repeat: false }]);
  });

  it("hands a command its own timer found at once", () => {
    const r = rig({ screen: 'menu' });
    r.g.setOwnTimer(true);
    r.pad.set(PAD.back, 1);
    r.clock.advance(PERIOD);
    expect(r.kinds()).toEqual(['menu']);
  });
});

describe('its own timer, never animation frames (C-6, §4.4)', () => {
  it('polls at gamepadPollHz while this page samples nothing', () => {
    const r = rig({ screen: 'results' });
    r.g.setOwnTimer(true);
    // Half a period over the second, so a period's rounding can't drop its last poll.
    r.clock.advance(1000 + PERIOD / 2);
    expect(r.g.inspect().polls).toBe(config.gamepadPollHz);
  });

  it("leaves the polls to the sampler's reads while they come", () => {
    const r = rig({ sampling: true });
    let reads = 0;
    // The sampler's timer first, as the timeline's runs before the pad's own at the same instant.
    const stop = r.clock.every(PERIOD, () => {
      r.g.read();
      reads++;
    });
    r.g.setOwnTimer(true);
    r.clock.advance(1000);
    expect(reads).toBeGreaterThan(config.gamepadPollHz - 2);
    expect(r.g.inspect().polls).toBe(reads);
    stop();
  });

  it("polls again when a sampler that should read hasn't for two periods, as while a match joins", () => {
    const r = rig({ sampling: true });
    r.g.setOwnTimer(true);
    r.g.read();
    r.clock.advance(2 * PERIOD - 1);
    expect(r.g.inspect().polls).toBe(1);
    r.clock.advance(1000);
    expect(r.g.inspect().polls).toBeGreaterThan(config.gamepadPollHz - 4);
  });

  it('stops when set off, and on dispose', () => {
    const r = rig({ screen: 'other' });
    r.g.setOwnTimer(true);
    r.g.setOwnTimer(true);
    r.clock.advance(1000 + PERIOD / 2);
    r.g.setOwnTimer(false);
    r.clock.advance(1000);
    expect(r.g.inspect().polls).toBe(config.gamepadPollHz);
    r.g.setOwnTimer(true);
    r.g.dispose();
    expect(r.clock.pending).toBe(0);
  });
});

describe('nothing held off the pitch (D-29, D-31, §4.8)', () => {
  it("reads nothing held, and keeps no press, off a player's pitch screen", () => {
    const r = rig({ screen: 'menu' });
    r.pad.stick(8);
    r.pad.set(PAD.zoomies, 1);
    r.pad.set(PAD.pounce, 1);
    expect(r.g.read()).toMatchObject({ direction: null, stickStep: null, zoomies: false, pounce: false });
    r.v.screen = 'pitch';
    // Still down when the pitch comes back: held again, but no new press.
    expect(r.g.read()).toMatchObject({ stickStep: 8, zoomies: true, pounce: false });
  });

  it('reads nothing held on a hidden page, and makes no command', () => {
    const r = rig();
    r.v.hidden = true;
    r.pad.stick(16);
    r.pad.set(PAD.back, 1);
    expect(r.g.read()).toMatchObject({ direction: null, zoomies: false });
    r.clock.advance(0);
    expect(r.ui).toEqual([]);
  });

  it('lets go of what was pressed on release, the stick read again at the next poll', () => {
    const r = rig();
    r.g.setOwnTimer(true);
    r.pad.stick(4);
    r.pad.set(PAD.jump, 1);
    r.clock.advance(PERIOD);
    r.g.release();
    const s = r.g.read();
    expect(s).toMatchObject({ jump: false, stickStep: 4 });
  });
});

describe('the pad coming and going', () => {
  it('reports a standard pad connected from the first poll that sees it, and gone when it goes', () => {
    const r = rig();
    expect(r.g.inspect().connected).toBe(false);
    r.g.read();
    expect(r.connected).toEqual([true]);
    r.pad.connected = false;
    r.pad.set(PAD.jump, 1);
    expect(r.g.read().jump).toBe(false);
    expect(r.connected).toEqual([true, false]);
    expect(r.g.inspect().connected).toBe(false);
  });

  it("finds no pad where the browser can't give one, its refusal caught", () => {
    expect(browserPads(undefined)).toEqual([]);
    expect(browserPads({})).toEqual([]);
    expect(browserPads({ getGamepads: () => { throw new DOMException('blocked', 'SecurityError'); } })).toEqual([]);
    const pad = new FakePad();
    expect(browserPads({ getGamepads: () => [null, pad] })).toEqual([null, pad]);
  });
});
