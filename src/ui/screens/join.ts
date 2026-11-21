// Join (M4's design, research/m4/DESIGN.md, §1.43, §5.2, §5.6, §5.14; PLAN
// §8, D-12, D-17, C-32, M4-Q2), by a #join= link or a code typed on Home:
// the match's room is opened at once, as undecided, so opening a link
// counts as joining (C-32), and the screen reads "Connecting to the
// match…" until a timeline is held; its choices aren't offered before the
// state is known (M4-Q2). A page whose terrier, or a bot of its own, is in
// the roster has returned and skips Join, its terrier taken back at once
// (L215, D-17): the app's move, before this screen offers anything. Then
// each pack: its swatch, its free places and who's in it, each by name and
// coat; Play in either pack, the smaller suggested (the first on a tie), a
// full pack's marked aria-disabled and reading "full", every Play so once
// the start countdown has locked the roster; and Watch. Its controls are
// native, for the keyboard's own Tab and Enter; the gamepad's commands move
// among and press its buttons (Q-17, L82). A JOIN given up later is the
// pitch's to say (src/ui/layers/net.ts), and the refusals' messages the
// app's (§5.10). New at M4.

import { formatMatchId } from '../../core/match-id';
import { shownName } from '../../core/names';
import { type MatchState, type Pack, packCount, WARM_UP } from '../../core/sim/index';
import type { Look } from '../../render/look';
import { h, isEnabled, setShown, setText } from '../dom';
import type { Match } from '../match-types';
import { ButtonNav } from '../nav';
import { addStyle } from '../style';
import css from './join.css?inline';
import { padOnly, playButton, playText } from './propose';
import { coatName, coatSwatch, packName, packSwatch, type Screen, screenStyles } from './screen';

export interface JoinHost {
  readonly matchId: string;
  readonly look: Look;
  play(pack: Pack): void;
  watch(): void;
  /** Home: the room left, if it opened. */
  home(): void;
}

export interface JoinScreen extends Screen {
  readonly name: 'join';
  /** Once the room has opened, and after each of its timer runs: what the held state offers. */
  update(m: Match | null): void;
}

/** The pack Join suggests: the one with fewer terriers that has a place, the first on a tie; none when
 *  neither has one, or from the start countdown on. */
export function suggestedPack(F: Readonly<MatchState>): Pack | null {
  if (F.phase !== WARM_UP) return null;
  const free = ([0, 1] as const).filter((p) => packCount(F, p) < F.packSize);
  if (free.length === 0) return null;
  return free.length === 2 && packCount(F, 1) < packCount(F, 0) ? 1 : free[0]!;
}

/** A pack's Play: free in warm-up while the pack has a place, else saying why. */
export function playState(F: Readonly<MatchState>, look: Look, pack: Pack): { readonly enabled: boolean; readonly text: string } {
  if (F.phase !== WARM_UP) return { enabled: false, text: `${playText(look, pack)}: the match has started` };
  if (packCount(F, pack) >= F.packSize) return { enabled: false, text: `${playText(look, pack)}: full` };
  return { enabled: true, text: playText(look, pack) };
}

/** A Play button that acts, or one marked aria-disabled, never disabled, saying why, beside its swatch (§1.42). */
function setPlay(b: HTMLButtonElement, on: boolean, text: string): void {
  const label = b.querySelector<HTMLElement>('.play-label');
  if (label !== null) setText(label, text);
  if (on) b.removeAttribute('aria-disabled');
  else b.setAttribute('aria-disabled', 'true');
}

export function joinScreen(host: JoinHost): JoinScreen {
  screenStyles();
  addStyle(css);
  const look = host.look;
  const status = h('p', { class: 'net-status', role: 'status', 'data-test': 'join-status' }, 'Connecting to the match…');
  const plays = ([0, 1] as const).map((p) => playButton(look, p, () => {
    if (isEnabled(plays[p]!)) host.play(p);
  }));
  const watch = h('button', { type: 'button', class: 'secondary', 'data-test': 'watch', onclick: () => host.watch() }, 'Watch');
  const home = h('button', { type: 'button', class: 'secondary', 'data-test': 'join-home', onclick: () => host.home() }, 'Home');
  const packs = ([0, 1] as const).map((p) => {
    const count = h('span', { class: 'join-count' });
    const list = h('ul', { 'data-test': `join-pack-${p}` });
    const section = h('section', { class: 'join-pack' },
      h('h2', {}, packSwatch(look.packs[p]), h('span', {}, `${packName(look.packs[p])} pack`), count), list, plays[p]!);
    return { section, count, list, key: '' };
  });
  const offer = h('div', { class: 'join-packs', hidden: true }, ...packs.map((x) => x.section));
  setShown(watch, false);
  const nav = new ButtonNav(() => [...plays, watch, home]);
  const el = h('section', { class: 'screen join' },
    h('h1', {}, 'Join a match'),
    h('p', { class: 'join-code-row' }, h('span', { class: 'muted small' }, 'Code'), h('span', { class: 'join-code', 'data-test': 'join-code' }, formatMatchId(host.matchId))),
    status,
    offer,
    h('div', { class: 'row' }, watch, home),
  );

  function update(m: Match | null): void {
    const t = m?.session.timeline ?? null;
    if (t === null || !t.started) return;
    const F = t.final;
    setText(status, F.phase === WARM_UP ? 'Play in a pack, or watch.' : 'This match has started: you can watch it.');
    setShown(offer, true);
    setShown(watch, true);
    const suggested = suggestedPack(F);
    for (const p of [0, 1] as const) {
      const s = playState(F, look, p);
      const b = plays[p]!;
      setPlay(b, s.enabled, s.text);
      b.classList.toggle('primary', p === suggested);
      b.classList.toggle('secondary', p !== suggested);
      const x = packs[p]!;
      const rows = F.terriers.filter((T) => T.pack === p);
      const key = `${F.packSize}|${rows.map((T) => `${T.id}/${T.name}/${T.coat}`).join(',')}`;
      if (key === x.key) continue;
      x.key = key;
      setText(x.count, `${rows.length} of ${F.packSize}`);
      x.list.replaceChildren(
        ...rows.map((T) => h('li', {}, coatSwatch(look, T.coat), h('span', { class: 'name' }, shownName(T.name, T.id)), coatName(look, T.coat))),
        ...Array.from({ length: Math.max(0, F.packSize - rows.length) }, () => h('li', { class: 'free' }, 'A free place')),
      );
    }
  }

  return { el, name: 'join', update, ui: padOnly(nav) };
}
