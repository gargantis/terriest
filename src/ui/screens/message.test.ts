import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InputKind, UiCommand } from '../../input/source';
import { PLACEHOLDER_LOOK } from '../../render/look';
import { cssDeclarations, fake, type FakeDocument, installDom, only } from '../dom-testing';
import {
  ACTION_TEST, ACTION_TEXT, type MessageAction, type MessageCode, MESSAGES, messageScreen, PRACTICE_GRAPHICS, scoreSoFar, WATCHING,
} from './message';
import { focusScreen } from './screen';

// The message screens (M4's design §1.43, §5.10, §5.13, §5.14, §9.2; PLAN
// D-21, D-23, D-24, D-30, Q-16, C-11, C-12; M4-Q39): each code's heading,
// words and actions as §5.10 has them, roslambo's where it says so; one
// component for them all: an alert with its code in data-message, its
// heading focused on entry, its words a paragraph each and the detail under
// them, a button for each action given a move, in order, the first the
// primary; Q-17's nav for the pad, with the keyboard's Enter left to the
// browser's own activation; and its padding by the safe area. The three
// messages the gate can't reach from a page (M4-Q39) are pinned here and
// share the component the reachable ones' specs and axe cover.

describe("§5.10's messages", () => {
  it("gives each code its heading, its words and its actions, roslambo's words where §5.10 says so", () => {
    const table = Object.fromEntries(Object.entries(MESSAGES).map(([k, m]) => [k, { code: m.code, heading: m.heading, text: m.text, actions: m.actions }]));
    expect(table).toEqual({
      canary: {
        code: 'canary', heading: 'This browser can’t play matches with others',
        text: ['It computes the game differently from other browsers, so a match with them would keep going wrong.', 'Practice still plays.'],
        actions: ['practice', 'home'],
      },
      build: {
        code: 'build', heading: 'A different version',
        text: ['The other players are running another version of terriest. Everyone should reload the page, then join again.'],
        actions: ['home'],
      },
      connect: {
        code: 'connect', heading: 'Couldn’t connect',
        text: [
          'Couldn’t connect to the other players. One of your networks may be blocking direct connections; try another network, or add a TURN server in Settings.',
          'The match may also have ended, or its proposer left before anyone joined.',
        ],
        actions: ['tryAgain', 'home'],
      },
      left: {
        code: 'left', heading: 'The players have left',
        text: ['Every browser that played in this match has gone, so the match is over.'],
        actions: ['home'],
      },
      spectators: {
        code: 'spectators', heading: 'This match has the most spectators it can take',
        text: ['A place opens when a spectator leaves, so try again in a while.'],
        actions: ['tryAgain', 'home'],
      },
      duplicate: {
        code: 'duplicate', heading: 'This match is open in another tab or window of this browser',
        text: ['Use that one, or close it and try again.'],
        actions: ['tryAgain', 'home'],
      },
      'other-tab': {
        code: 'other-tab', heading: 'terriest is open in another tab',
        text: ['Only one tab plays at a time. Use that one, or play here instead.'],
        actions: ['useHere'],
      },
      graphics: {
        code: 'graphics', heading: 'The graphics stopped working',
        text: ['The match goes on for the others.', 'If the graphics come back, the pitch returns here.'],
        actions: ['leave'],
      },
      // A room that couldn't open, from Create or Join: nothing about other players or TURN, and a reload's
      // advice (phase 2d's review).
      open: {
        code: 'open', heading: 'Couldn’t open the match',
        text: [
          'This page couldn’t start its connection to the match. Check that you’re online, then try again.',
          'If it still won’t open, reload the page: terriest may have been updated since this page loaded.',
        ],
        actions: ['tryAgain', 'home'],
      },
    });
    expect(ACTION_TEXT).toEqual({ practice: 'Practice', home: 'Home', tryAgain: 'Try again', useHere: 'Use here', leave: 'Leave' });
  });

  it('keeps Practice’s graphics message paused rather than going on, the watching notice for Pre-match and Match, and the score so far', () => {
    expect({ ...PRACTICE_GRAPHICS, text: [] }).toEqual({ ...MESSAGES.graphics, text: [] });
    expect(PRACTICE_GRAPHICS.text).toEqual(['Practice is paused until the graphics come back, and then the pitch returns here.']);
    expect(WATCHING).toBe('This match is full, so you’re watching it.');
    expect((Object.keys(MESSAGES) as string[]).includes('watching')).toBe(false);
    expect(scoreSoFar([2, 1], PLACEHOLDER_LOOK)).toBe('The score so far: Blue 2–1 Orange.');
  });
});

describe('the message screen (§5.10, §5.14, Q-17)', () => {
  let dom: { readonly document: FakeDocument; restore(): void };
  beforeEach(() => {
    dom = installDom();
  });
  afterEach(() => {
    dom.restore();
  });

  function show(m: (typeof MESSAGES)[MessageCode], act: Partial<Record<MessageAction, () => void>>, detail?: string): {
    screen: ReturnType<typeof messageScreen>; el: ReturnType<typeof fake>;
  } {
    const screen = detail === undefined ? messageScreen(m, act) : messageScreen(m, act, detail);
    dom.document.body.append(fake(screen.el));
    return { screen, el: fake(screen.el) };
  }
  const cmd = (kind: UiCommand['kind'], source: InputKind, repeat = false): UiCommand => ({ kind, pressedAt: 0, source, repeat });

  it('is an alert with its code in data-message, its heading focused on entry, its words a paragraph each and the detail under them', () => {
    const acts: string[] = [];
    const { screen, el } = show(MESSAGES.left, { home: () => acts.push('home') }, scoreSoFar([2, 1], PLACEHOLDER_LOOK));
    expect([screen.name, screen.code, el.tagName, el.getAttribute('role'), el.getAttribute('data-message')]).toEqual(['message', 'left', 'SECTION', 'alert', 'left']);
    focusScreen(screen);
    expect(dom.document.activeElement).toBe(only(el, 'h1'));
    expect(only(el, 'h1').textContent).toBe('The players have left');
    expect(el.querySelectorAll('p').map((p) => p.textContent)).toEqual([...MESSAGES.left.text, 'The score so far: Blue 2–1 Orange.']);
    expect(only(el, 'p[data-test="message-detail"]').textContent).toBe('The score so far: Blue 2–1 Orange.');
    only(el, 'button[data-test="message-home"]').click();
    expect(acts).toEqual(['home']);
    // No detail, or an empty one: no line for it.
    expect(show(MESSAGES.build, { home: () => {} }).el.querySelectorAll('[data-test="message-detail"]').length).toBe(0);
    expect(show(MESSAGES.build, { home: () => {} }, '').el.querySelectorAll('[data-test="message-detail"]').length).toBe(0);
  });

  it('makes a button for each action given a move, in its order, the first the primary, each calling its own', () => {
    const acts: string[] = [];
    const { el } = show(MESSAGES.connect, { home: () => acts.push('home'), tryAgain: () => acts.push('tryAgain') });
    const buttons = el.querySelectorAll('button');
    expect(buttons.map((b) => [b.textContent, b.className, b.getAttribute('data-test'), b.getAttribute('type')])).toEqual([
      ['Try again', 'primary', ACTION_TEST.tryAgain, 'button'], ['Home', 'secondary', ACTION_TEST.home, 'button'],
    ]);
    buttons[1]!.click();
    buttons[0]!.click();
    expect(acts).toEqual(['home', 'tryAgain']);
    // An action the app gives no move has no button: the first left is the primary.
    const one = show(MESSAGES.connect, { home: () => {} }).el.querySelectorAll('button');
    expect(one.map((b) => [b.textContent, b.className])).toEqual([['Home', 'primary']]);
    expect(show(MESSAGES.build, {}).el.querySelectorAll('button, div.row').length).toBe(0);
  });

  it("works its buttons from the pad, the d-pad moving and Start pressing, a repeat never; the keyboard's arrows move, and its Enter is the browser's own", () => {
    const acts: string[] = [];
    const { screen, el } = show(MESSAGES.canary, { practice: () => acts.push('practice'), home: () => acts.push('home') });
    focusScreen(screen);
    screen.ui(cmd('press', 'gamepad')); // the heading focused: no button to press
    screen.ui(cmd('down', 'gamepad'));
    expect(dom.document.activeElement).toBe(only(el, 'button[data-test="message-practice"]'));
    screen.ui(cmd('press', 'gamepad', true));
    screen.ui(cmd('press', 'keyboard')); // Enter: the browser activates the focused button itself here
    expect(acts).toEqual([]);
    screen.ui(cmd('press', 'gamepad'));
    screen.ui(cmd('right', 'keyboard'));
    expect(dom.document.activeElement).toBe(only(el, 'button[data-test="message-home"]'));
    screen.ui(cmd('press', 'gamepad'));
    expect(acts).toEqual(['practice', 'home']);
    screen.ui(cmd('menu', 'gamepad')); // Back: nothing here
    expect(acts).toEqual(['practice', 'home']);
  });

  it("presses on the keyboard's Enter too where it shows over the pitch, whose keyboard keeps Enter from the browser (§5.8)", () => {
    const acts: string[] = [];
    const over = messageScreen(MESSAGES.graphics, { leave: () => acts.push('leave') }, undefined, { pressKeys: true });
    dom.document.body.append(fake(over.el));
    focusScreen(over);
    over.ui(cmd('down', 'keyboard'));
    expect(dom.document.activeElement).toBe(only(fake(over.el), 'button[data-test="message-leave"]'));
    over.ui(cmd('press', 'keyboard', true)); // a held Enter's repeat: never
    expect(acts).toEqual([]);
    over.ui(cmd('press', 'keyboard'));
    expect(acts).toEqual(['leave']);
  });

  it("shows every message with the one component: its code, its heading and its buttons in order", () => {
    for (const code of Object.keys(MESSAGES) as MessageCode[]) {
      const m = MESSAGES[code];
      const { screen, el } = show(m, Object.fromEntries(m.actions.map((a) => [a, () => {}])));
      expect([screen.code, el.getAttribute('data-message'), el.getAttribute('role'), only(el, 'h1').textContent], code).toEqual([code, code, 'alert', m.heading]);
      expect(el.querySelectorAll('button').map((b) => b.textContent), code).toEqual(m.actions.map((a) => ACTION_TEXT[a]));
    }
  });

  it('pads itself by the safe area, from phase 2 the page drawing under a notch (§5.13)', () => {
    const d = cssDeclarations(readFileSync(new URL('./message.css', import.meta.url), 'utf8'), '.screen.message');
    expect(d).toEqual({
      'padding-top': 'max(24px, env(safe-area-inset-top, 0px))', 'padding-right': 'max(16px, env(safe-area-inset-right, 0px))',
      'padding-bottom': 'max(32px, env(safe-area-inset-bottom, 0px))', 'padding-left': 'max(16px, env(safe-area-inset-left, 0px))',
    });
  });
});
