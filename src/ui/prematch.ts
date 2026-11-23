// Pre-match's panel (M4's design, research/m4/DESIGN.md, §1.42, §5.4,
// §5.7, §5.14; PLAN §11, §14, L146, L166, D-8, D-12, D-22, D-39, Q-15,
// Q-17, M4-Q8): what the pitch screen (src/ui/screens/pitch.ts) shows over
// the warming-up pitch, through the start countdown.
// - Each pack's list from the final state, rebuilt only when it changes
//   (roslambo's): each terrier's name (a bot's from the robot dogs' list,
//   D-39 and the owner's request of 2026-11-22), its coat's swatch and
//   name, and Ready, your row marked "you", and the free places; a bot's
//   swatch a robot's head, and " bot" heard after its name (bot-head.ts,
//   the owner, 2026-11-23).
// - Ready, a player's, focused from the screen's entry, aria-disabled and
//   saying why until it can act ("Getting the pitch ready…", "Joining…"),
//   then "Ready" or "Ready ✓", pressed again to cancel (L146), following the
//   press at once while its READY or UNREADY is on its way; Switch pack,
//   which the session refuses for a full pack, "The other pack is full";
//   Leave. A spectator has no Ready or Switch pack.
// - A networked match's Invite, the link and the code as Created shows
//   them (invite.ts), and each pack's Add a bot and Remove a bot, for
//   players and spectators alike: Add aria-disabled saying why where
//   canAddBot says no, Remove shown only while this browser hosts a bot
//   there (D-39, PLAN §14). Practice has neither: bots fill every place
//   (Q-15).
// - From the start countdown the roster is locked: Ready, Switch pack and
//   the bots' buttons are aria-disabled, saying so, and the focus stays
//   where it was (§1.42, §5.7).
// Its buttons are a nav's, Q-17's order: Ready, Switch pack, Leave, then
// Invite, the invite panel's own while it shows, and each pack's bots'.
// Moved out of the pitch screen by phase 2's net-screens, which adds the
// bots' buttons and Invite. New at M4.

import { shownName } from '../core/names';
import { findTerrier, type MatchState, type Pack, packCount, type Phase, READY, START_COUNTDOWN, UNREADY, WARM_UP } from '../core/sim/index';
import type { Look } from '../render/look';
import { h, isEnabled, setEnabled, setShown, setText } from './dom';
import type { Match } from './match-types';
import css from './prematch.css?inline';
import { botWord, terrierSwatch } from './screens/bot-head';
import { invitePanel, inviteButtons, type InviteOptions } from './screens/invite';
import { coatName, coatSwatch, packName, packSwatch, screenStyles } from './screens/screen';
import { addStyle } from './style';

/** Pre-match lasts through the start countdown (M4-Q8). */
export const isPreMatch = (phase: Phase): boolean => phase === WARM_UP || phase === START_COUNTDOWN;

/** A button's state: whether it acts, and what it reads, the reason when it can't. */
export interface ButtonState {
  readonly enabled: boolean;
  readonly text: string;
}

/** Ready (§1.42, §5.7, L146): waiting for the pitch, then "Joining…" until this player is in the final
 *  roster, "Starting…" once the start countdown has locked it, and otherwise "Ready" or "Ready ✓". `wish`
 *  is the last press's while its event is on its way, so the button follows the press at once. */
export function readyButton(o: {
  readonly pitchReady: boolean; readonly final: Readonly<MatchState> | null; readonly headPhase: Phase | null; readonly me: string;
  readonly wish: boolean | null;
}): ButtonState & { readonly on: boolean } {
  if (!o.pitchReady) return { enabled: false, on: false, text: 'Getting the pitch ready…' };
  const F = o.final;
  const k = F === null ? -1 : findTerrier(F, o.me);
  if (F === null || k < 0) return { enabled: false, on: false, text: 'Joining…' };
  if (F.phase !== WARM_UP || o.headPhase !== WARM_UP) return { enabled: false, on: true, text: 'Starting…' };
  const on = o.wish ?? F.terriers[k]!.readyUntil > F.tick;
  return { enabled: true, on, text: on ? 'Ready ✓' : 'Ready' };
}

/** Switch pack (D-12, D-22): once this player is in the final roster, until the start countdown. */
export function switchButton(final: Readonly<MatchState> | null, headPhase: Phase | null, me: string): ButtonState {
  if (final === null || findTerrier(final, me) < 0) return { enabled: false, text: 'Switch pack: joining…' };
  if (final.phase !== WARM_UP || headPhase !== WARM_UP) return { enabled: false, text: 'Switch pack: starting…' };
  return { enabled: true, text: 'Switch pack' };
}

/** Locked: the start countdown, in the final state or the drawn head, which counts down first. */
const locked = (final: Readonly<MatchState> | null, headPhase: Phase | null): boolean =>
  (final !== null && final.phase !== WARM_UP) || (headPhase !== null && headPhase !== WARM_UP);

/** "a Blue bot", "an Orange bot": a bot by its pack's name. */
function aBot(look: Look, pack: Pack): string {
  const name = packName(look.packs[pack]);
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name} bot`;
}

/** Add a bot to `pack` (D-39): where canAddBot says yes; else why not, the countdown's lock, a full pack,
 *  or no place for this browser's next bot (the joins on their way, or its most hosted). */
export function addBotButton(final: Readonly<MatchState> | null, headPhase: Phase | null, look: Look, pack: Pack, can: boolean): ButtonState {
  const text = `Add ${aBot(look, pack)}`;
  if (locked(final, headPhase)) return { enabled: false, text: `${text}: starting…` };
  if (final !== null && packCount(final, pack) >= final.packSize) return { enabled: false, text: `${text}: full` };
  return can ? { enabled: true, text } : { enabled: false, text: `${text}: no place` };
}

/** Remove a bot from `pack`: in warm-up alone, the roster locking it with the rest. */
export function removeBotButton(final: Readonly<MatchState> | null, headPhase: Phase | null, look: Look, pack: Pack): ButtonState {
  const text = `Remove ${aBot(look, pack)}`;
  return locked(final, headPhase) ? { enabled: false, text: `${text}: starting…` } : { enabled: true, text };
}

/** One terrier in its pack's list. */
export interface PackRow {
  readonly id: string;
  readonly name: string;
  readonly coat: number;
  readonly ready: boolean;
  readonly you: boolean;
}

/** A pack's list from the final state (§5.7): its terriers by spot, each named as the screens name it, ready
 *  by its Ready in warm-up and every one ready from the start countdown, which only an all-ready roster
 *  begins (D-8). */
export function packRows(F: Readonly<MatchState>, pack: Pack, me: string): PackRow[] {
  return F.terriers
    .filter((T) => T.pack === pack)
    .map((T) => ({ id: T.id, name: shownName(T.name, T.id), coat: T.coat, ready: F.phase !== WARM_UP || T.readyUntil > F.tick, you: T.id === me }));
}

const rowsKey = (rows: readonly PackRow[], size: number): string => `${size}|${rows.map((r) => `${r.id}/${r.name}/${r.coat}/${+r.ready}/${+r.you}`).join(',')}`;

export interface PrematchHost {
  readonly match: Match;
  readonly look: Look;
  /** A player's panel, with Ready and Switch pack; a spectator's has neither. */
  readonly playing: boolean;
  /** stage.ready() has settled: Ready waits for it, so a match never starts unseen. */
  pitchReady(): boolean;
  leave(): void;
  /** A networked match's Invite, with its link's options; Practice has none, nor the bots' buttons. */
  readonly invite: InviteOptions | null;
}

export interface PrematchPanel {
  readonly el: HTMLElement;
  /** Ready, which the screen focuses from its entry (data-focus) for a player. */
  readonly ready: HTMLButtonElement;
  /** Q-17's order: Ready, Switch pack, Leave, Invite, the invite panel's while it shows, each pack's bots'. */
  buttons(): readonly HTMLButtonElement[];
  /** The panel from the final state, its DOM touched only when what it shows changes. */
  update(): void;
}

export function prematchPanel(host: PrematchHost): PrematchPanel {
  screenStyles();
  addStyle(css);
  const { match, look, playing } = host;
  const me = match.me;
  const networked = host.invite !== null;
  /** The last Ready press's wish, while its event is on its way. */
  let wish: boolean | null = null;
  let key = '';
  let keyFinal: Readonly<MatchState> | null = null;

  const ready = h('button', { type: 'button', class: 'primary prematch-wide', 'data-test': 'ready', onclick: () => pressReady() }, 'Joining…');
  const switchPack = h('button', { type: 'button', class: 'secondary prematch-wide', 'data-test': 'switch-pack', onclick: () => pressSwitch() }, 'Switch pack');
  const leave = h('button', { type: 'button', class: 'secondary', 'data-test': 'prematch-leave', onclick: () => host.leave() }, 'Leave');
  const inviteToggle = h('button', {
    type: 'button', class: 'secondary', 'data-test': 'invite-button', 'aria-expanded': 'false', onclick: () => toggleInvite(),
  }, 'Invite');
  setShown(ready, playing);
  setShown(switchPack, playing);
  setShown(inviteToggle, networked);
  if (playing) ready.setAttribute('data-focus', '');
  const full = h('p', { class: 'notice', 'data-test': 'switch-refused', hidden: true }, 'The other pack is full.');
  const invite = host.invite === null || match.matchId === null ? null : invitePanel(match.matchId, host.invite);
  if (invite !== null) setShown(invite, false);

  const packs = ([0, 1] as const).map((p) => {
    const count = h('span', { class: 'prematch-count' });
    const list = h('ul', { 'data-test': `pack-${p}` });
    const add = h('button', { type: 'button', class: 'secondary', 'data-test': `add-bot-${p}`, onclick: () => pressAdd(p) }, 'Add a bot');
    const remove = h('button', { type: 'button', class: 'secondary', 'data-test': `remove-bot-${p}`, onclick: () => pressRemove(p) }, 'Remove a bot');
    setShown(add, networked);
    setShown(remove, false);
    const bots = h('div', { class: 'prematch-bots', hidden: !networked }, add, remove);
    const section = h('section', { class: `prematch-pack prematch-pack-${p}` },
      h('h2', {}, packSwatch(look.packs[p]), h('span', {}, `${packName(look.packs[p])} pack`), count), list, bots);
    return { section, list, count, add, remove, key: '' };
  });
  const el = h('div', { class: 'prematch', 'data-test': 'prematch' },
    // Its buttons first, so Ready shows at the panel's top however long the lists run below it.
    h('div', { class: 'prematch-buttons' }, ready, switchPack, leave, inviteToggle),
    full,
    invite,
    h('div', { class: 'prematch-packs' }, ...packs.map((x) => x.section)));

  const buttons = (): HTMLButtonElement[] => [
    ready, switchPack, leave, inviteToggle,
    ...(invite !== null && invite.hidden === false ? inviteButtons(invite) : []),
    ...packs.flatMap((x) => [x.add, x.remove]),
  ];

  function currentReady(): ButtonState & { readonly on: boolean } {
    const t = match.session.timeline;
    return readyButton({ pitchReady: host.pitchReady(), final: t.started ? t.final : null, headPhase: t.started ? t.head.phase : null, me, wish });
  }

  function pressReady(): void {
    if (!isEnabled(ready)) return;
    const on = !currentReady().on;
    match.ready(on);
    wish = on;
    update();
  }

  function pressSwitch(): void {
    if (!isEnabled(switchPack)) return;
    wish = null;
    match.switchPack();
    update();
  }

  function pressAdd(p: Pack): void {
    if (!isEnabled(packs[p]!.add)) return;
    match.addBot(p);
    update();
  }

  function pressRemove(p: Pack): void {
    if (!isEnabled(packs[p]!.remove)) return;
    match.removeBot(p);
    update();
  }

  function toggleInvite(): void {
    if (invite === null) return;
    const open = invite.hidden !== false;
    setShown(invite, open);
    inviteToggle.setAttribute('aria-expanded', String(open));
  }

  /** This browser's bots in `pack`, wanted: what a Remove would take out (the session's rule). */
  function hosting(p: Pack): boolean {
    return match.session.bots.hosted.some((b) => b.wanted && b.pack === p);
  }

  function update(): void {
    const t = match.session.timeline;
    if (wish !== null && (!t.started || (t.eventsInFlight(me) & (READY | UNREADY)) === 0)) wish = null;
    const F = t.started ? t.final : null;
    const headPhase = t.started ? t.head.phase : null;
    const refused = match.status().switchRefused;
    const bots = networked
      ? ([0, 1] as const).map((p) => `${+match.canAddBot(p)}${+hosting(p)}`).join('')
      : '';
    const next = t.started ? `${t.id}|${t.finalTick}|${headPhase}|${host.pitchReady()}|${wish}|${refused}|${bots}` : `|${host.pitchReady()}|${bots}`;
    if (next === key && F === keyFinal) return;
    key = next;
    keyFinal = F;
    const r = currentReady();
    setEnabled(ready, r.enabled, r.text);
    const s = switchButton(F, headPhase, me);
    setEnabled(switchPack, s.enabled, s.text);
    setShown(full, refused);
    for (const p of [0, 1] as const) {
      const x = packs[p]!;
      if (networked) {
        const a = addBotButton(F, headPhase, look, p, match.canAddBot(p));
        setEnabled(x.add, a.enabled, a.text);
        const has = hosting(p);
        if (!has && x.remove.ownerDocument.activeElement === x.remove) x.add.focus({ preventScroll: true });
        setShown(x.remove, has);
        const m = removeBotButton(F, headPhase, look, p);
        setEnabled(x.remove, m.enabled, m.text);
      }
      if (F === null) continue;
      const rows = packRows(F, p, me);
      const k = rowsKey(rows, F.packSize);
      if (k === x.key) continue;
      x.key = k;
      setText(x.count, `${rows.length} of ${F.packSize}`);
      x.list.replaceChildren(
        ...rows.map((row) => h('li', { class: row.you ? 'you' : '' },
          terrierSwatch(coatSwatch(look, row.coat), row.id), h('span', { class: 'name' }, row.name), botWord(row.id), coatName(look, row.coat),
          row.you ? h('span', { class: 'tag' }, 'you') : null,
          h('span', { class: 'ready' }, row.ready ? 'Ready ✓' : 'Not ready'))),
        ...Array.from({ length: Math.max(0, F.packSize - rows.length) }, () => h('li', { class: 'free' }, 'A free place')),
      );
    }
  }

  return { el, ready, buttons, update };
}
