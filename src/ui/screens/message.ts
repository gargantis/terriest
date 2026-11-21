// The message screens (M4's design, research/m4/DESIGN.md, §1.43, §5.10,
// §5.13, §5.14; PLAN §11, D-21, D-23, D-24, D-30, Q-16, C-11, C-12; M4-Q31,
// M4-Q39): roslambo's messageScreen, one component for every message a
// match or the tab lock can end in, each with §5.10's heading and words,
// roslambo's where §5.10 says so, and its actions, in order. Each screen is
// an alert whose heading takes the focus on entry, its code in
// data-message for the hook and the specs (Inspection.message), and a
// detail line under its words where the app has one, such as the score so
// far when the players have left. What it can't hold, the notice "This
// match is full, so you're watching it", shows on Pre-match or Match, not
// here: WATCHING is its words. The app maps each status to its message
// (src/ui/app.ts) and hands each action its move. Q-17's nav works the
// buttons for the pad: its d-pad moves and Start presses; the keyboard's
// arrows move too, and its Enter is the browser's own activation, as on
// Home, since the keyboard keeps Enter's default on a screen of its own
// (src/input/keyboard.ts). Shown over the pitch instead, as the graphics'
// message is (§5.8), where the keyboard keeps Enter from the browser, the
// nav presses on the keyboard's Enter too (pressKeys). Padded by the safe
// area (§5.13). New at M4.

import type { UiCommand } from '../../input/source';
import type { Look } from '../../render/look';
import { h } from '../dom';
import { ButtonNav } from '../nav';
import { addStyle } from '../style';
import css from './message.css?inline';
import { packName, type Screen, screenStyles } from './screen';

export type MessageCode = 'canary' | 'build' | 'connect' | 'left' | 'spectators' | 'duplicate' | 'other-tab' | 'graphics';
export type MessageAction = 'practice' | 'home' | 'tryAgain' | 'useHere' | 'leave';

export interface MessageSpec {
  /** The screen's data-message, and Inspection.message. */
  readonly code: MessageCode;
  /** Its h1, focused on entry. */
  readonly heading: string;
  /** §5.10's explanation, a paragraph each. */
  readonly text: readonly string[];
  /** Its buttons, in order. */
  readonly actions: readonly MessageAction[];
}

/** §5.10's messages. */
export const MESSAGES: Readonly<Record<MessageCode, MessageSpec>> = {
  // Propose or Join with the canary failing (D-23, M4-Q31).
  canary: {
    code: 'canary',
    heading: 'This browser can’t play matches with others',
    text: ['It computes the game differently from other browsers, so a match with them would keep going wrong.', 'Practice still plays.'],
    actions: ['practice', 'home'],
  },
  // Refused for the build or the protocol (D-21).
  build: {
    code: 'build',
    heading: 'A different version',
    text: ['The other players are running another version of terriest. Everyone should reload the page, then join again.'],
    actions: ['home'],
  },
  // No timeline 20 s after opening (PLAN §8): roslambo's words.
  connect: {
    code: 'connect',
    heading: 'Couldn’t connect',
    text: [
      'Couldn’t connect to the other players. One of your networks may be blocking direct connections; try another network, or add a TURN server in Settings.',
      'The match may also have ended, or its proposer left before anyone joined.',
    ],
    actions: ['tryAgain', 'home'],
  },
  // Abandoned (Q-16): the score so far is the detail.
  left: {
    code: 'left',
    heading: 'The players have left',
    text: ['Every browser that played in this match has gone, so the match is over.'],
    actions: ['home'],
  },
  // A fifth spectator, or refused for the cap (C-11).
  spectators: {
    code: 'spectators',
    heading: 'This match has the most spectators it can take',
    text: ['A place opens when a spectator leaves, so try again in a while.'],
    actions: ['tryAgain', 'home'],
  },
  // Refused as a duplicate ID (C-12): roslambo's words.
  duplicate: {
    code: 'duplicate',
    heading: 'This match is open in another tab or window of this browser',
    text: ['Use that one, or close it and try again.'],
    actions: ['tryAgain', 'home'],
  },
  // Another tab holds the Web Lock (D-24): roslambo's words.
  'other-tab': {
    code: 'other-tab',
    heading: 'terriest is open in another tab',
    text: ['Only one tab plays at a time. Use that one, or play here instead.'],
    actions: ['useHere'],
  },
  // The context not back within lostGraphicsSeconds of the page being visible (D-30, C-36).
  graphics: {
    code: 'graphics',
    heading: 'The graphics stopped working',
    text: ['The match goes on for the others.', 'If the graphics come back, the pitch returns here.'],
    actions: ['leave'],
  },
};

/** The graphics message in Practice, which pauses until they're back rather than going on (D-30, Q-15). */
export const PRACTICE_GRAPHICS: MessageSpec = {
  ...MESSAGES.graphics,
  text: ['Practice is paused until the graphics come back, and then the pitch returns here.'],
};

/** The notice on Pre-match or Match for a JOIN given up for a full pack or a started match (D-12, §5.6):
 *  no screen of its own. */
export const WATCHING = 'This match is full, so you’re watching it.';

/** Each action's button. */
export const ACTION_TEXT: Readonly<Record<MessageAction, string>> = {
  practice: 'Practice', home: 'Home', tryAgain: 'Try again', useHere: 'Use here', leave: 'Leave',
};

/** Each action's button for the specs: data-test. */
export const ACTION_TEST: Readonly<Record<MessageAction, string>> = {
  practice: 'message-practice', home: 'message-home', tryAgain: 'message-try-again', useHere: 'message-use-here', leave: 'message-leave',
};

/** The left message's detail (Q-16): the scoreboard's score when the match ended, pack A's first. */
export function scoreSoFar(score: readonly [number, number], look: Look): string {
  return `The score so far: ${packName(look.packs[0])} ${score[0]}–${score[1]} ${packName(look.packs[1])}.`;
}

export interface MessageScreen extends Screen {
  readonly name: 'message';
  /** Its data-message: Inspection.message. */
  readonly code: MessageCode;
  ui(c: UiCommand): void;
}

/** How the screen takes the keyboard's Enter. */
export interface MessageOptions {
  /** The keyboard keeps Enter from the browser where it shows, as over the pitch, whose keyboard screen is
   *  a player's or a spectator's: the nav presses the focused button on it. Off: a screen of its own, where
   *  the browser's own activation does (src/input/keyboard.ts). */
  readonly pressKeys?: boolean;
}

/** role="alert"; one button per action in m.actions that act has a move for, each calling it, the first
 *  the primary; detail is a line under the text, such as 'left''s score so far. 'watching' is no screen:
 *  a notice on Pre-match or Match (WATCHING). */
export function messageScreen(
  m: MessageSpec, act: Readonly<Partial<Record<MessageAction, () => void>>>, detail?: string, o: MessageOptions = {},
): MessageScreen {
  screenStyles();
  addStyle(css);
  const buttons: HTMLButtonElement[] = [];
  for (const a of m.actions) {
    const move = act[a];
    if (move === undefined) continue;
    buttons.push(h('button', { type: 'button', class: buttons.length === 0 ? 'primary' : 'secondary', 'data-test': ACTION_TEST[a], onclick: () => move() }, ACTION_TEXT[a]));
  }
  const el = h('section', { class: 'screen message', role: 'alert', 'data-message': m.code, 'data-test': 'message' },
    h('h1', {}, m.heading),
    ...m.text.map((p) => h('p', {}, p)),
    detail === undefined || detail === '' ? null : h('p', { class: 'message-detail', 'data-test': 'message-detail' }, detail),
    buttons.length === 0 ? null : h('div', { class: 'row' }, ...buttons));
  const nav = new ButtonNav(() => buttons);
  return {
    el,
    name: 'message',
    code: m.code,
    ui(c: UiCommand): void {
      // The keyboard's Enter on a screen of its own: the browser presses the focused button itself, so the
      // nav doesn't too.
      if (c.kind === 'press' && c.source === 'keyboard' && o.pressKeys !== true) return;
      nav.ui(c);
    },
  };
}
