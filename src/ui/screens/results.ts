// Results (M4's design, research/m4/DESIGN.md, §1.43, §4.9, §5.9; PLAN §11,
// D-8, D-12, D-14, Q-15, Q-17, C-26, C-50; L153, L154, M3-Q24, M4-Q26): the
// confirmed end, its final score and winner; a table of each terrier's
// name, pack, goals and touches, saying under it that a shared goal counts
// for each sharer (C-26); the Terriest, or Terriests when level (D-8); Play
// again, focused first, which in a match with others reads "Join the next
// match" once an AGAIN has arrived (roslambo's), and Home; and below them
// all, the Network figures with Copy (readout.ts, M3-Q24): a match with
// others' rows, its late inputs, resyncs and repairs among them, or
// Practice's own. Q-17's nav works the three buttons, with its guard: only a
// press that began resultsPressGuardSeconds after Results showed acts, a
// pointer's included (M4-Q26), and every press goes into the app's
// announcements log with its time since Results showed and whether it
// acted. The final score and the outcome are a polite live region, filled
// just after the screen shows, so a screen reader hears the end while the
// focus is on Play again (§5.14). roslambo's results screen, without its
// balances. Phase 1's by the shell; phase 2's results-hud adds the figures.
// New at M4.

import { config } from '../../config';
import { shownName } from '../../core/names';
import type { ConfirmedEnd, MatchNetSummary, ResultRow } from '../../core/session/index';
import type { Pack } from '../../core/sim/index';
import type { UiCommand } from '../../input/source';
import type { Look } from '../../render/look';
import type { Clock } from '../clock';
import { h, setText } from '../dom';
import type { Announcement } from '../inspect';
import { ButtonNav } from '../nav';
import { addStyle } from '../style';
import { type CopyEnv, summaryPanel } from './readout';
import css from './results.css?inline';
import { coatName, coatSwatch, packName, packSwatch, type Screen, screenStyles } from './screen';

export interface ResultsHost {
  readonly end: ConfirmedEnd;
  readonly practice: boolean;
  readonly me: string;
  readonly look: Look;
  readonly clock: Clock;
  /** An AGAIN reached this room: Play again joins the next match (D-12). */
  againSeen(): boolean;
  /** The match's network figures, read once as Results shows (M3-Q24). */
  summary(): MatchNetSummary;
  playAgain(): void;
  home(): void;
  announce(a: Announcement): void;
  /** Tests: where Copy writes and how it selects; the page's clipboard and selection without it. */
  readonly copy?: CopyEnv;
}

/** How often Play again's label looks for an AGAIN: the app's frame loop runs only on the pitch screens. */
const AGAIN_LOOK_MS = 250;
/** A live region is heard when its text changes, not when it comes into the page: the end's is filled this
 *  long after Results shows (§5.14). */
const SAID_AFTER_MS = 150;

/** One terrier's row, by pack, then as the end lists them, its spot. */
export interface ResultLine {
  readonly id: string;
  readonly name: string;
  readonly coat: number;
  readonly pack: Pack;
  readonly packName: string;
  readonly goals: number;
  readonly touches: number;
  readonly terriest: boolean;
  readonly you: boolean;
  readonly bot: boolean;
}

export function resultLines(end: ConfirmedEnd, look: Look, me: string): ResultLine[] {
  const line = (r: ResultRow): ResultLine => ({
    id: r.id, name: shownName(r.name, r.id), coat: r.coat, pack: r.pack, packName: packName(look.packs[r.pack]),
    goals: r.goals, touches: r.touches, terriest: r.terriest, you: r.id === me, bot: r.bot,
  });
  return [...end.rows.filter((r) => r.pack === 0), ...end.rows.filter((r) => r.pack === 1)].map(line);
}

/** The final score, pack A's first: "Blue 3–1 Orange". */
export function scoreText(end: ConfirmedEnd, look: Look): string {
  return `${packName(look.packs[0])} ${end.score[0]}–${end.score[1]} ${packName(look.packs[1])}`;
}

/** Who won, and whether that's the viewer's pack: a spectator's has no second sentence. */
export function outcomeText(end: ConfirmedEnd, look: Look, me: string): string {
  if (end.winner === null) return 'The packs finished level.';
  const won = `${packName(look.packs[end.winner])} pack wins.`;
  const mine = end.rows.find((r) => r.id === me);
  if (mine === undefined) return won;
  return `${won} ${mine.pack === end.winner ? 'Your pack won.' : 'Your pack lost.'}`;
}

/** "The Terriest: Ada.", or "The Terriests: Ada and Bot 1A2B." when level (D-8). */
export function terriestText(end: ConfirmedEnd): string {
  const names = end.rows.filter((r) => r.terriest).map((r) => shownName(r.name, r.id));
  if (names.length === 0) return '';
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`;
  return `${names.length === 1 ? 'The Terriest' : 'The Terriests'}: ${list}.`;
}

export const againText = (seen: boolean): string => (seen ? 'Join the next match' : 'Play again');

export function resultsScreen(host: ResultsHost): Screen {
  screenStyles();
  addStyle(css);
  const shownAt = host.clock.now();
  const { end, look } = host;
  const rows = resultLines(end, look, host.me).map((r) =>
    h('tr', { class: r.you ? 'you' : '' },
      h('th', { scope: 'row', class: 'name' },
        coatSwatch(look, r.coat), h('span', {}, r.name), coatName(look, r.coat),
        r.you ? h('span', { class: 'tag' }, 'you') : null,
        r.terriest ? h('span', { class: 'tag' }, 'Terriest') : null),
      h('td', {}, h('span', { class: 'pack-cell' }, packSwatch(look.packs[r.pack]), r.packName)),
      h('td', { class: 'num' }, String(r.goals)),
      h('td', { class: 'num' }, String(r.touches))));
  // The end, heard once it's filled (§5.14): the final score and who won.
  const finalScore = h('p', { class: 'final-score', 'data-test': 'final-score' });
  const outcome = h('p', { 'data-test': 'outcome' });
  const said = h('div', { class: 'results-said', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-test': 'results-said' }, finalScore, outcome);
  const again = h('button', { type: 'button', class: 'primary', 'data-test': 'again', 'data-focus': '', onclick: () => host.playAgain() }, againText(host.againSeen()));
  const home = h('button', { type: 'button', class: 'secondary', 'data-test': 'home', onclick: () => host.home() }, 'Home');
  // The figures as they stand when Results shows (M3-Q24): a match with others', or Practice's own.
  const figures = summaryPanel(host.summary(), host.copy === undefined ? { practice: host.practice } : { practice: host.practice, env: host.copy });
  // The buttons right under the end, so Play again, focused first, shows however long the table runs below
  // it, as Pre-match's buttons head its panel (Q-17, §5.9); the figures below everything else.
  const el = h('section', { class: 'screen results' },
    h('h1', {}, 'Results'),
    said,
    h('div', { class: 'row' }, again, home),
    host.practice ? h('p', { class: 'muted small' }, 'Play again starts another Practice with the same pack size and length.') : null,
    h('p', { 'data-test': 'terriest' }, terriestText(end)),
    h('table', { 'data-test': 'results' },
      h('caption', { class: 'visually-hidden' }, 'Each terrier’s goals and touches'),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Terrier'), h('th', { scope: 'col' }, 'Pack'),
        h('th', { scope: 'col', class: 'num' }, 'Goals'), h('th', { scope: 'col', class: 'num' }, 'Touches'))),
      h('tbody', {}, ...rows)),
    h('p', { class: 'muted small' }, 'A shared goal counts for each terrier that shared it.'),
    figures.el,
  );

  // Copy among them, so the keys and the pad reach it too: the keyboard keeps Enter's and Space's
  // defaults from Results' buttons, so only the nav presses them (§4.9).
  const nav = new ButtonNav(() => [again, home, figures.copy], {
    guardMs: config.resultsPressGuardSeconds * 1000,
    shownAtMs: shownAt,
    clock: host.clock,
    onPress: (atMs, source, accepted) => host.announce({ kind: 'press', atMs: atMs - shownAt, source, accepted }),
  });
  const detach = nav.attach(el);
  host.announce({ kind: 'results', atMs: shownAt });
  const refreshAgain = (): void => setText(again, againText(host.againSeen()));
  const stopLooking = host.practice ? () => {} : host.clock.every(AGAIN_LOOK_MS, refreshAgain);
  const stopSaying = host.clock.after(SAID_AFTER_MS, () => {
    setText(finalScore, scoreText(end, look));
    setText(outcome, outcomeText(end, look, host.me));
  });
  return {
    el,
    name: 'results',
    ui: (c: UiCommand) => nav.ui(c),
    dispose: () => {
      stopLooking();
      stopSaying();
      detach();
    },
  };
}
