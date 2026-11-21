// The pitch screen (M4's design, research/m4/DESIGN.md, §1.38, §1.43, §2.2,
// §2.7, §4.8, §4.9, §5.4, §5.7, §5.8; PLAN §11, Q-15, Q-17, D-27, P11;
// M4-Q7, M4-Q8, M4-Q9): Pre-match and Match, one screen whose name moves
// from 'prematch' to 'match' as the first kickoff's play begins (M4-Q8), so
// Pre-match lasts through the start countdown. Built against the contracts
// alone, the Stage, MatchViewApi and ControlsApi its host holds, so the
// slice wires the real ones:
// - it says "Getting the pitch ready…" until stage.ready() resolves, and
//   draws nothing before it; Ready waits for it too, so a match never
//   starts unseen;
// - each animation frame: view.frame, stage.draw, controls.frameDrawn and
//   each layer's frame, in that order; with the test hook, the head's hash
//   before and after, so a frame whose drawing changed it is counted (P11);
// - after each timer run: view.run, each layer's run with the barks it
//   found, and only then its own moves, to Match or Results, so a layer
//   sees the run that ended the match (§1.43);
// - Pre-match's panel: each pack's list from the final state, rebuilt only
//   when it changes (roslambo's); Ready, focused from the screen's entry,
//   aria-disabled and saying why until it can act, "Ready" or "Ready ✓",
//   pressed again to cancel (L146), following the press at once while its
//   READY or UNREADY is on its way; Switch pack; Leave; each terrier's coat
//   by its name beside its swatch (§5.14). From the start
//   countdown the roster is locked, and Ready and Switch pack say so, the
//   focus staying where it was (§1.42, §5.7);
// - the match menu, the layer named 'menu' (menu.ts), opened and closed on
//   Escape or the pad's Back, on Pre-match too (M4-Q7), on the HUD's Menu
//   button, and when a stall or a hidden page paused Practice (Q-15):
//   while it's open Practice is paused, nothing is held (§4.8) and Q-17's
//   nav works its buttons, the first focused; closing it resumes and gives
//   the focus back;
// - Enter or Start on a focused button of its own that no nav holds, a
//   layer's such as the HUD's Menu button, presses it once, since the
//   keyboard keeps Enter's default from it on the pitch (§4.9); and a
//   mouse press on the pitch, or anywhere on the screen but a control,
//   keeps the focus where it was, so Enter still presses Ready;
// - the layers, made from a host of the screen's own, so their menu, ui
//   and camera calls reach it, and put over the pitch in the order given.
// The app's openMenu, closeMenu and setMode are told after the screen has
// acted, so it can follow (Inspection.menu, the devices); ui isn't passed
// on, since the app's ui is the screen's way in. Phase 2's net-screens adds
// the networked Pre-match (the bots' buttons, Invite) and PitchContext's
// graphics; phase 3's robust builder the rebuild when the menu closes.
// New at M4.

import { shownName } from '../../core/names';
import type { BarkEvent, ConfirmedEnd } from '../../core/session/index';
import { findTerrier, hashState, type MatchState, type Pack, type Phase, READY, START_COUNTDOWN, UNREADY, WARM_UP } from '../../core/sim/index';
import type { UiCommand } from '../../input/source';
import type { CameraMode, FrameOut, StageFrame, ViewMode } from '../../render/frame';
import type { MatchViewApi } from '../../render/stage-types';
import { h, isEnabled, setEnabled, setShown, setText } from '../dom';
import type { Inspection } from '../inspect';
import type { Layer, LayerFactory, PitchContext, PitchHost } from '../layer';
import { ButtonNav } from '../nav';
import { addStyle } from '../style';
import { MENU } from './menu';
import css from './pitch.css?inline';
import { coatName, coatSwatch, packName, packSwatch, type Screen, screenStyles } from './screen';

/** What the pitch screen needs of the app beyond what its layers get. */
export interface PitchScreenHost extends PitchHost {
  /** The end is confirmed (scoreboard.end, D-14): the app shows Results. Called once, after the timer
   *  run's layers have run. */
  results(end: ConfirmedEnd): void;
}

export type MenuState = Inspection['menu'];

/** What the screen reports for the hook (§1.40). */
export interface PitchInspection {
  /** Each layer's inspect(), by its name: Inspection.layers. */
  readonly layers: Readonly<Record<string, unknown>>;
  /** P11 in the page: frames whose drawing changed the head's hash, counted only with the hook (§2.7). */
  readonly headHashMismatches: number;
  /** stage.ready(): still waiting, resolved, or refused (then drawn anyway). */
  readonly pitch: 'preparing' | 'ready' | 'failed';
  /** Frames drawn. */
  readonly frames: number;
  /** The view's own figures, the drawing clock among them (§1.40, §9.5). */
  readonly view: ReturnType<MatchViewApi['inspect']>;
}

export interface PitchScreen extends Screen {
  readonly name: 'prematch' | 'match';
  readonly menu: MenuState;
  frame(nowMs: number): void;
  ui(c: UiCommand): void;
  dispose(): void;
  openMenu(): void;
  closeMenu(): void;
  /** Controls' onBark: your bark went into the input for `tick`, drawn at once and told to each layer (§2.5). */
  ownBark(tick: number): void;
  /** Controls' onView: the view control was pressed, so a player's view switches (§3.4). */
  switchView(): void;
  /** Controls' view: this viewer's view now; ball for a spectator. */
  viewMode(): ViewMode;
  inspect(): PitchInspection;
}

const NO_BARKS: readonly BarkEvent[] = Object.freeze([]);

/** What a press on the pitch screen may focus: its controls, by tag; a press anywhere else keeps the focus. */
const CONTROLS: ReadonlySet<string> = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'A']);

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

export function pitchScreen(host: PitchScreenHost, factories: readonly LayerFactory[]): PitchScreen {
  screenStyles();
  addStyle(css);
  const { match, stage, view, controls, look } = host;
  const me = match.me;
  const clock = match.clock;

  let disposed = false;
  let pitch: PitchInspection['pitch'] = 'preparing';
  let name: 'prematch' | 'match' = 'prematch';
  let menu: MenuState = 'closed';
  let ended = false;
  let lastFrameMs: number | null = null;
  let lastFrame: StageFrame | null = null;
  let lastOut: FrameOut | null = null;
  let frames = 0;
  let mismatches = 0;
  /** The last Ready press's wish, while its event is on its way. */
  let wish: boolean | null = null;
  let panelKey = '';
  let panelFinal: Readonly<MatchState> | null = null;
  /** What had the focus when the menu opened. */
  let focusBefore: Element | null = null;

  // --- The DOM ---
  const heading = h('h1', { class: 'visually-hidden' }, 'Pre-match');
  const preparing = h('p', { class: 'pitch-preparing', role: 'status', 'data-test': 'pitch-preparing' }, 'Getting the pitch ready…');
  const ready = h('button', { type: 'button', class: 'primary', 'data-test': 'ready', onclick: () => pressReady() }, 'Joining…');
  const switchPack = h('button', { type: 'button', class: 'secondary', 'data-test': 'switch-pack', onclick: () => pressSwitch() }, 'Switch pack');
  const leave = h('button', { type: 'button', class: 'secondary', 'data-test': 'prematch-leave', onclick: () => host.leave() }, 'Leave');
  const playing = controls !== null;
  setShown(ready, playing);
  setShown(switchPack, playing);
  if (playing) ready.setAttribute('data-focus', '');
  const full = h('p', { class: 'notice', 'data-test': 'switch-refused', hidden: true }, 'The other pack is full.');
  const lists = ([0, 1] as const).map((p) => {
    const count = h('span', { class: 'prematch-count' });
    const list = h('ul', { 'data-test': `pack-${p}` });
    const section = h('section', { class: `prematch-pack prematch-pack-${p}` },
      h('h2', {}, packSwatch(look.packs[p]), h('span', {}, `${packName(look.packs[p])} pack`), count), list);
    return { section, list, count, key: '' };
  });
  // Its buttons first, so Ready shows at the panel's top however long the lists run below it.
  const panel = h('div', { class: 'prematch', 'data-test': 'prematch' },
    h('div', { class: 'prematch-buttons' }, ready, switchPack, leave),
    full,
    h('div', { class: 'prematch-packs' }, ...lists.map((l) => l.section)));
  const el = h('section', { class: 'pitch-screen', 'data-test': 'pitch-screen' }, heading, preparing, panel);

  // --- The layers, over the pitch in their order ---
  const layerHost: PitchHost = {
    match, stage, view, controls, settings: host.settings, profile: host.profile, look, test: host.test,
    announce: (a) => host.announce(a),
    openMenu: () => openMenu(),
    closeMenu: () => closeMenu(),
    leave: () => host.leave(),
    ui: (c) => ui(c),
    setMode: (m) => setMode(m),
  };
  const layers: Layer[] = factories.map((f) => f(layerHost));
  for (const l of layers) if (l.el !== null) el.append(l.el);
  const menuLayer = layers.find((l) => l.name === MENU) ?? null;
  if (menuLayer?.el) setShown(menuLayer.el, false);

  // --- Q-17's navs: Pre-match's buttons, and the menu's ---
  const prematchButtons: readonly HTMLButtonElement[] = [ready, switchPack, leave];
  const prematchNav = new ButtonNav(() => prematchButtons, { clock });
  const detachPrematch = prematchNav.attach(panel);
  const menuButtons = (): HTMLButtonElement[] => (menuLayer?.el ? Array.from(menuLayer.el.querySelectorAll<HTMLButtonElement>('button')) : []);
  const menuNav = new ButtonNav(menuButtons, { clock });
  const detachMenu = menuLayer?.el ? menuNav.attach(menuLayer.el) : () => {};

  // --- What the screen does ---
  const context = (frame: StageFrame | null, out: FrameOut | null, barks: readonly BarkEvent[]): PitchContext => ({
    match, drawn: view.drawn, out, frame, nowMs: view.drawMs, mode: view.mode, settings: host.settings.get(), graphics: 'ok', barks,
  });

  function pressReady(): void {
    if (disposed || !isEnabled(ready)) return;
    const on = !currentReady().on;
    match.ready(on);
    wish = on;
    updatePanel();
  }

  function pressSwitch(): void {
    if (disposed || !isEnabled(switchPack)) return;
    wish = null;
    match.switchPack();
    updatePanel();
  }

  function currentReady(): ButtonState & { readonly on: boolean } {
    const t = match.session.timeline;
    const F = t.started ? t.final : null;
    return readyButton({ pitchReady: pitch !== 'preparing', final: F, headPhase: t.started ? t.head.phase : null, me, wish });
  }

  /** Pre-match's panel, from the final state, its DOM touched only when what it shows changes: the final
   *  state steps in place, so its tick says when, and a repair replaces it, so its object does too. */
  function updatePanel(): void {
    if (name !== 'prematch') return;
    const t = match.session.timeline;
    if (wish !== null && (!t.started || (t.eventsInFlight(me) & (READY | UNREADY)) === 0)) wish = null;
    const F = t.started ? t.final : null;
    const refused = match.status().switchRefused;
    const key = t.started ? `${t.id}|${t.finalTick}|${t.head.phase}|${pitch}|${wish}|${refused}` : `|${pitch}`;
    if (key === panelKey && F === panelFinal) return;
    panelKey = key;
    panelFinal = F;
    const r = currentReady();
    setEnabled(ready, r.enabled, r.text);
    const s = switchButton(F, t.started ? t.head.phase : null, me);
    setEnabled(switchPack, s.enabled, s.text);
    setShown(full, refused);
    if (F === null) return;
    for (const p of [0, 1] as const) {
      const rows = packRows(F, p, me);
      const l = lists[p]!;
      const k = rowsKey(rows, F.packSize);
      if (k === l.key) continue;
      l.key = k;
      setText(l.count, `${rows.length} of ${F.packSize}`);
      l.list.replaceChildren(
        ...rows.map((r) => h('li', { class: r.you ? 'you' : '' },
          coatSwatch(look, r.coat), h('span', { class: 'name' }, r.name), coatName(look, r.coat),
          r.you ? h('span', { class: 'tag' }, 'you') : null,
          h('span', { class: 'ready' }, r.ready ? 'Ready ✓' : 'Not ready'))),
        ...Array.from({ length: Math.max(0, F.packSize - rows.length) }, () => h('li', { class: 'free' }, 'A free place')),
      );
    }
  }

  /** The first kickoff's play has begun: the screen is Match, Pre-match's panel gone (M4-Q8). */
  function toMatch(): void {
    name = 'match';
    const active = el.ownerDocument.activeElement;
    const hadFocus = active !== null && panel.contains(active);
    setShown(panel, false);
    ready.removeAttribute('data-focus');
    setText(heading, 'Match');
    if (hadFocus) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }

  /** After each timer run: the view, then each layer, then the screen's own moves (§1.43). */
  function ran(): void {
    if (disposed) return;
    const barks = view.run(clock.now());
    const ctx = context(lastFrame, lastOut, barks);
    for (const l of layers) l.run?.(ctx);
    if (disposed) return; // a layer left
    const t = match.session.timeline;
    updatePanel();
    if (name === 'prematch' && t.started && !isPreMatch(t.head.phase)) toMatch();
    const end = match.scoreboard.end;
    if (end !== null && !ended) {
      ended = true;
      host.results(end);
    }
  }

  function frame(nowMs: number): void {
    if (disposed || pitch === 'preparing') return;
    const dt = lastFrameMs === null ? 0 : Math.max(0, nowMs - lastFrameMs);
    lastFrameMs = nowMs;
    const t = match.session.timeline;
    const before = host.test && t.started ? hashState(t.head) : null;
    const sf = view.frame(nowMs, dt);
    const out = stage.draw(sf);
    if (before !== null && hashState(t.head) !== before) mismatches++;
    frames++;
    lastFrame = sf;
    lastOut = out;
    if (sf.match !== null) controls?.frameDrawn(Math.floor(sf.match.time), nowMs);
    const ctx = context(sf, out, NO_BARKS);
    for (const l of layers) l.frame?.(ctx);
  }

  function openMenu(): void {
    if (disposed || menu !== 'closed') return;
    focusBefore = el.ownerDocument.activeElement;
    menu = 'menu';
    if (menuLayer?.el) setShown(menuLayer.el, true);
    match.pause('menu');
    controls?.release();
    menuNav.focusFirst();
    host.openMenu();
  }

  /** The focus back where it was when the menu opened; else, where that can't take it, Ready on
   *  Pre-match or the heading, so it's never left on the hidden menu. */
  function closeMenu(): void {
    if (disposed || menu === 'closed') return;
    menu = 'closed';
    if (menuLayer?.el) setShown(menuLayer.el, false);
    match.resume('menu');
    const doc = el.ownerDocument;
    const back = focusBefore !== null && focusBefore !== doc.body && el.contains(focusBefore) ? (focusBefore as HTMLElement) : null;
    focusBefore = null;
    back?.focus({ preventScroll: true });
    if (back === null || doc.activeElement !== back) {
      const fallback = name === 'prematch' && playing ? ready : heading;
      if (fallback === heading) heading.tabIndex = -1;
      fallback.focus({ preventScroll: true });
    }
    host.closeMenu();
  }

  function ui(c: UiCommand): void {
    if (disposed) return;
    if (c.kind === 'menu') {
      if (c.repeat) return;
      if (menu === 'closed') openMenu();
      else closeMenu();
      return;
    }
    if (menu !== 'closed') {
      menuNav.ui(c);
      return;
    }
    // The focus on one of the screen's own buttons outside Pre-match's nav, a layer's such as the HUD's
    // Menu button: on the pitch the keyboard keeps Enter's default from it (§4.9), so the screen presses
    // it, once, unless it can't act yet.
    const focused = focusedButton();
    if (c.kind === 'press' && focused !== null && !prematchButtons.includes(focused)) {
      if (!c.repeat && isEnabled(focused)) focused.click();
      return;
    }
    if (name === 'prematch') prematchNav.ui(c);
  }

  /** The button inside the screen that has the focus, if one does. */
  function focusedButton(): HTMLButtonElement | null {
    const a = el.ownerDocument.activeElement;
    return a !== null && a.tagName === 'BUTTON' && el.contains(a) ? (a as HTMLButtonElement) : null;
  }

  /** A press on the pitch, or on anything of the screen's but a control, leaves the focus where it was,
   *  Ready or the menu's button, so Enter still presses what Q-17 focused (§4.9): the mouse's default would
   *  move it to the page's body. A control takes it as usual. */
  function keepFocus(e: Event): void {
    for (let n = e.target as Element | null; n !== null && n !== el; n = n.parentNode as Element | null) {
      if (CONTROLS.has(n.tagName)) return;
    }
    e.preventDefault();
  }

  function setMode(m: CameraMode): void {
    if (disposed) return;
    view.mode = m;
    controls?.viewChanged();
    host.setMode(m);
  }

  // --- Wiring ---
  if (controls !== null) {
    match.setControls((head, headTick, tick) => controls.sample(head, headTick, tick), (base) => controls.rebase(base));
  }
  const ballView = host.settings.get().ballView;
  view.mode = playing ? { kind: 'player', view: ballView ? 'ball' : 'chase', terrier: me } : { kind: 'spectator', follow: null };
  const unsubscribe = match.subscribe({
    run: ran,
    correction: (c) => view.correct(c, clock.now()),
    stalled: () => openMenu(),
  });
  const prepared = (state: 'ready' | 'failed'): void => {
    if (disposed) return;
    pitch = state;
    setShown(preparing, false);
    updatePanel();
  };
  stage.ready().then(() => prepared('ready'), () => prepared('failed'));
  el.addEventListener('mousedown', keepFocus);
  {
    const t = match.session.timeline;
    if (t.started && !isPreMatch(t.head.phase)) toMatch();
    updatePanel();
  }

  return {
    el,
    get name() {
      return name;
    },
    get menu() {
      return menu;
    },
    frame,
    ui,
    openMenu,
    closeMenu,
    ownBark(tick: number): void {
      if (disposed) return;
      view.ownBark(tick, clock.now());
      for (const l of layers) l.ownBark?.(tick);
    },
    switchView(): void {
      const m = view.mode;
      if (m.kind === 'player') setMode({ kind: 'player', view: m.view === 'ball' ? 'chase' : 'ball', terrier: m.terrier });
    },
    viewMode(): ViewMode {
      const m = view.mode;
      return m.kind === 'player' ? m.view : 'ball';
    },
    inspect(): PitchInspection {
      const out: Record<string, unknown> = {};
      for (const l of layers) if (l.inspect !== undefined) out[l.name] = l.inspect();
      return { layers: out, headHashMismatches: mismatches, pitch, frames, view: view.inspect() };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      el.removeEventListener('mousedown', keepFocus);
      detachPrematch();
      detachMenu();
      for (const l of layers) l.dispose?.();
      controls?.release();
      // A menu left open would leave Practice paused for whatever comes next.
      if (menu !== 'closed') {
        menu = 'closed';
        match.resume('menu');
      }
    },
  };
}
