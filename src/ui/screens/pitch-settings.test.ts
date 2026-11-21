import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { personId } from '../../core/bot/bot-id';
import type { ConfirmedEnd } from '../../core/session/index';
import type { UiCommand } from '../../input/source';
import { fake, type FakeDocument, FakeEvent, installDom, only } from '../dom-testing';
import { LAYERS } from '../layers/hud';
import { type Calls, FakeControls, FakeStage, FakeView, MemorySettings, stateWith, StateMatch, testHost } from '../pitch-testing';
import { pitchScreen } from './pitch';

// The match menu's Settings through the real pitch screen and the real
// layers/hud.ts (M4's design §5.8, §6; PLAN §11, Q-15, Q-17): the panel in
// the open menu's place, Inspection's menu reading 'settings', Practice
// still paused and nothing held; a change stored at once; Escape closing
// the menu and resuming; the menu reopening on its buttons, Resume
// focused; the panel's Back returning to the match; and the gamepad's
// d-pad reaching the panel's checks and radios, which the keys leave to the
// browser, its Start checking one (L82). The settings builder's composed
// test, adopted by phase 2a's Wire step.

const ME = personId(7, 0);
const key = (kind: UiCommand['kind']): UiCommand => ({ kind, pressedAt: 0, source: 'keyboard', repeat: false });
const pad = (kind: UiCommand['kind']): UiCommand => ({ kind, pressedAt: 0, source: 'gamepad', repeat: false });
let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

describe("the match menu's Settings panel through the pitch screen (§5.8, §6)", () => {
  it('opens in the menu, paused and released, stores a change, closes by Escape, reopens on its buttons, and its Back returns to the match', async () => {
    const calls: Calls = [];
    const match = new StateMatch(ME, stateWith(1, 100, [{ id: ME, pack: 0 }]));
    const view = new FakeView(calls, match);
    const stage = new FakeStage(calls);
    const controls = new FakeControls(calls);
    const settings = new MemorySettings();
    const host = { ...testHost({ match, view, stage, controls, settings }), results: (_e: ConfirmedEnd) => {} };
    const screen = pitchScreen(host, LAYERS);
    dom.document.body.append(fake(screen.el));
    await stage.finish();
    screen.ui(key('menu'));
    expect([screen.menu, [...match.reasons], controls.releases]).toEqual(['menu', ['menu'], 1]);
    const menu = only(screen.el, '[data-test="menu"]');
    expect(dom.document.activeElement).toBe(only(menu, 'button[data-test="resume"]'));
    screen.ui(key('down'));
    screen.ui(key('press')); // Settings
    expect([screen.menu, [...match.reasons], menu.shown]).toEqual(['settings', ['menu'], true]);
    const sound = only(menu, 'input[data-test="sound"]');
    sound.checked = false;
    sound.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(settings.stored().sound).toBe(false);
    screen.ui(key('menu')); // Escape
    expect([screen.menu, [...match.reasons], menu.shown]).toEqual(['closed', [], false]);
    screen.ui(key('menu'));
    expect([screen.menu, dom.document.activeElement]).toEqual(['menu', only(menu, 'button[data-test="resume"]')]);
    screen.ui(key('down'));
    screen.ui(key('press')); // Settings again, then its Back
    only(menu, 'button[data-test="back"]').click();
    expect([screen.menu, [...match.reasons], menu.shown]).toEqual(['closed', [], false]);
    screen.dispose();
  });

  it("takes the gamepad's d-pad through the panel's checks and radios as well as its buttons, its Start checking one, the keys' nav its buttons alone (L82)", async () => {
    const calls: Calls = [];
    const match = new StateMatch(ME, stateWith(1, 100, [{ id: ME, pack: 0 }]));
    const settings = new MemorySettings();
    const host = { ...testHost({ match, view: new FakeView(calls, match), stage: new FakeStage(calls), controls: new FakeControls(calls), settings }), results: (_e: ConfirmedEnd) => {} };
    const screen = pitchScreen(host, LAYERS);
    dom.document.body.append(fake(screen.el));
    screen.ui(pad('menu'));
    screen.ui(pad('down'));
    screen.ui(pad('press')); // Settings
    expect(screen.menu).toBe('settings');
    const focused = (): string | null => dom.document.activeElement.getAttribute('data-test');
    const order: string[] = [];
    for (let k = 0; k < 9; k++) {
      screen.ui(pad('down'));
      order.push(focused()!);
    }
    expect(order).toEqual(['back', 'quality-high', 'quality-low', 'sound', 'names', 'ball-view', 'calm-camera', 'mirror-touch', 'hints-again']);
    // Sound by the pad: off, as a click would leave it, stored at once.
    for (let k = 0; k < 5; k++) screen.ui(pad('up'));
    expect(focused()).toBe('sound');
    screen.ui(pad('press'));
    expect([settings.stored().sound, screen.menu]).toEqual([false, 'settings']);
    // The keys' nav: the panel's buttons alone, so an arrow never lands on a check, whose keys are the browser's.
    screen.ui(key('down'));
    expect(focused()).toBe('back');
    screen.ui(key('down'));
    expect(focused()).toBe('hints-again');
    screen.dispose();
  });
});
