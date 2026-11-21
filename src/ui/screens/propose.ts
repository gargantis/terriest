// Propose and Created (M4's design, research/m4/DESIGN.md, §1.43, §5.2,
// §5.5, §5.13; PLAN §11, L163, D-30): Propose, after the canary, picks the
// pack size (1–4, default 2) and the match length (1–10 minutes, default
// 3), from the configuration's ranges and defaults, as Practice's setup
// does; Create opens the match's room, proposes genesis and sets the
// fragment, the app's work, its button reading "Creating…" meanwhile.
// Created shows the link and the code (invite.ts), says to keep the page
// open until someone joins and how many have, and offers, at once, Play
// in either pack, Watch and Leave (L163). A screen wake lock is held while
// nobody has joined (D-30): the app's, by peers(). Both screens' controls
// are native, for the keyboard's own Tab and Enter; the gamepad's commands
// move among and press their buttons, and on Propose its left and right
// step a focused choice, as on Practice's setup (Q-17, L82, §4.9's pad
// parts, extended in phase 2b). roslambo's propose and created screens,
// with packs, Watch at once, and Share…. New at M4.

import type { MatchSettings, Pack } from '../../core/sim/index';
import type { Look } from '../../render/look';
import { h, setEnabled, setText } from '../dom';
import { ButtonNav, padOnly } from '../nav';
import { addStyle } from '../style';
import { invitePanel, inviteButtons, type InviteOptions } from './invite';
import css from './join.css?inline';
import { minutesText, practiceChoices, sizeText } from './practice';
import { packName, packSwatch, type Screen, screenStyles } from './screen';

export interface ProposeHost {
  /** Create: the app opens the room, proposes and moves to Created. */
  create(s: MatchSettings): void;
  home(): void;
}

/** "Play in the Blue pack": a pack by its look's name. */
export const playText = (look: Look, pack: Pack): string => `Play in the ${packName(look.packs[pack])} pack`;

/** A Play button for a pack, its swatch beside its words, hidden from a screen reader as each swatch is. */
export function playButton(look: Look, pack: Pack, act: () => void): HTMLButtonElement {
  const label = h('span', { class: 'play-label' }, playText(look, pack));
  const b = h('button', { type: 'button', class: 'secondary play', 'data-test': `play-${pack}`, onclick: act }, packSwatch(look.packs[pack]), label);
  return b;
}

export function proposeScreen(host: ProposeHost): Screen {
  screenStyles();
  const c = practiceChoices();
  const select = (values: readonly number[], at: number, text: (n: number) => string, test: string): HTMLSelectElement => {
    const sel = h('select', { 'data-test': test }, ...values.map((v) => h('option', { value: String(v) }, text(v))));
    sel.value = String(at);
    return sel;
  };
  const size = select(c.sizes, c.start.packSize, sizeText, 'pack-size');
  const minutes = select(c.minutes, c.start.matchMinutes, minutesText, 'match-length');
  let creating = false;
  const create = h('button', {
    type: 'button', class: 'primary', 'data-test': 'create',
    onclick: () => {
      if (creating) return;
      creating = true;
      setEnabled(create, false, 'Creating…');
      host.create({ packSize: Number(size.value), matchMinutes: Number(minutes.value) });
    },
  }, 'Create');
  const back = h('button', { type: 'button', class: 'secondary', 'data-test': 'back', onclick: () => host.home() }, 'Back');
  const nav = new ButtonNav(() => [size, minutes, create, back]);
  const el = h('section', { class: 'screen propose' },
    h('h1', {}, 'Propose a match'),
    h('p', { class: 'muted' }, 'Choose the pack size and the length. Then share the link or the code, and play or watch at once.'),
    h('label', { class: 'field' }, h('span', {}, 'Pack size'), size),
    h('label', { class: 'field' }, h('span', {}, 'Match length'), minutes),
    h('div', { class: 'row' }, create, back),
  );
  return { el, name: 'propose', ui: padOnly(nav) };
}

export interface CreatedHost {
  readonly matchId: string;
  readonly look: Look;
  readonly invite?: InviteOptions;
  /** The people who have joined: the room's connections. */
  peers(): number;
  play(pack: Pack): void;
  watch(): void;
  leave(): void;
}

export interface CreatedScreen extends Screen {
  readonly name: 'created';
  /** After each timer run: how many have joined. */
  update(): void;
}

/** How many have joined, as Created says it. */
export function joinedText(n: number): string {
  if (n === 0) return 'Nobody has joined yet.';
  return n === 1 ? '1 person has joined.' : `${n} people have joined.`;
}

export function createdScreen(host: CreatedHost): CreatedScreen {
  screenStyles();
  addStyle(css);
  const invite = invitePanel(host.matchId, host.invite);
  const status = h('p', { class: 'net-status', role: 'status', 'data-test': 'created-status' }, joinedText(0));
  const plays = ([0, 1] as const).map((p) => playButton(host.look, p, () => host.play(p)));
  const watch = h('button', { type: 'button', class: 'secondary', 'data-test': 'watch', onclick: () => host.watch() }, 'Watch');
  const leave = h('button', { type: 'button', class: 'secondary', 'data-test': 'created-leave', onclick: () => host.leave() }, 'Leave');
  const nav = new ButtonNav(() => [...inviteButtons(invite), ...plays, watch, leave]);
  const el = h('section', { class: 'screen created' },
    h('h1', {}, 'Share this match'),
    h('p', {}, 'Send the link, or read out the code. Keep this page open until someone joins: until then, the match exists only here.'),
    invite,
    status,
    h('div', { class: 'row' }, ...plays, watch, leave),
  );
  const update = (): void => setText(status, joinedText(host.peers()));
  update();
  return { el, name: 'created', update, ui: padOnly(nav) };
}
