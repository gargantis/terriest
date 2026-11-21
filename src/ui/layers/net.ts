// The networked match's notes over the pitch (M4's design,
// research/m4/DESIGN.md, §1.63, §5.6–§5.8, §5.10, §5.14; PLAN D-12, M4-Q39):
// a JOIN given up, for a full pack or a started match (status().refused),
// leaves the page watching, and the notice says "This match is full, so
// you're watching it", a polite live region; while the other pack still has
// a place in warm-up, it says so instead and offers that pack's Play, which
// plays there and the app makes the pitch screen a player's again (§5.6).
// Practice has no notes: its layer is empty. Its notice is on an opaque
// backing, clear of Pre-match's panel on the right and of the countdown in
// the middle, inside the safe area, and below the sound's prompt and the
// HUD's graphics note while either shows (§5.13, §5.14). The two JOINs for
// a pack's last place in one tick that refuse one are a race no spec can
// time, so the notice is tested in Node (M4-Q39). New at M4, by phase 2's
// net-screens.

import { type Pack, packCount, WARM_UP } from '../../core/sim/index';
import { h, setShown, setText } from '../dom';
import type { Layer, LayerFactory, PitchHost } from '../layer';
import { WATCHING } from '../screens/message';
import { playText } from '../screens/propose';
import { addStyle } from '../style';
import css from './net.css?inline';

/** The notice for a JOIN given up (§5.10's watching, D-12): the message screens' words for it. */
export const WATCHING_TEXT = WATCHING;

/** The notice for a JOIN given up while the other pack has a place, above its Play (§5.6): the match isn't
 *  full, so it says what is. */
export const OFFER_TEXT = 'The pack you chose filled first, so you’re watching for now. The other pack has a place.';

/** What layers.net reports. */
export interface NetNotesInspection {
  readonly watching: boolean;
  /** The pack a refused page may play in instead, while it has a place. */
  readonly offer: Pack | null;
}

/** The networked notes: none in Practice. */
export function netLayer(host: PitchHost): Layer {
  const m = host.match;
  if (m.kind !== 'net') return { name: 'net', el: null, inspect: (): NetNotesInspection => ({ watching: false, offer: null }) };
  addStyle(css);
  let watching = false;
  let offer: Pack | null = null;
  const said = h('p', {}, WATCHING_TEXT);
  const play = h('button', {
    type: 'button', class: 'secondary', 'data-test': 'play-other',
    onclick: () => {
      if (offer !== null) m.play(offer);
    },
  }, '');
  setShown(play, false);
  const el = h('div', { class: 'net-notes', role: 'status', 'data-test': 'watching', hidden: true }, said, play);

  /** At once, and after each timer run: watching once a JOIN is given up, until this page plays again. */
  const run = (): void => {
    const t = m.session.timeline;
    const refused = m.status().refused;
    watching = refused !== null && t.started && !m.session.inRoster();
    offer = null;
    if (watching && refused === 'full' && t.final.phase === WARM_UP) {
      const F = t.final;
      offer = ([0, 1] as const).find((p) => packCount(F, p) < F.packSize) ?? null;
    }
    setShown(el, watching);
    setShown(play, offer !== null);
    setText(said, offer === null ? WATCHING_TEXT : OFFER_TEXT);
    if (offer !== null) setText(play, playText(host.look, offer));
  };

  run();
  return {
    name: 'net',
    el,
    run,
    inspect: (): NetNotesInspection => ({ watching, offer }),
  };
}

export const LAYERS: readonly LayerFactory[] = [netLayer];
