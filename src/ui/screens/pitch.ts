// The pitch screen (M4's design, research/m4/DESIGN.md, §1.38, §1.43, §2.2,
// §2.7, §4.8, §4.9, §5.4, §5.7, §5.8; PLAN §11, Q-15, Q-17, D-27, D-28,
// D-30, P11; M4-Q7, M4-Q8, M4-Q9): Pre-match and Match, one screen whose
// name moves from 'prematch' to 'match' as the first kickoff's play begins
// (M4-Q8), so Pre-match lasts through the start countdown. Built against
// the contracts alone, the Stage, MatchViewApi and ControlsApi its host
// holds, so the app wires the real ones:
// - it says "Getting the pitch ready…" until stage.ready() resolves, and
//   draws nothing before it; Ready waits for it too, so a match never
//   starts unseen;
// - each animation frame: view.frame, stage.draw, controls.frameDrawn and
//   each layer's frame, in that order; with the test hook, the head's hash
//   before and after, so a frame whose drawing changed it is counted (P11);
// - after each timer run: view.run, each layer's run with the barks it
//   found, and only then its own moves, to Match or Results, so a layer
//   sees the run that ended the match (§1.43);
// - Pre-match's panel, src/ui/prematch.ts's: the lists, Ready, Switch pack
//   and Leave, and a networked match's Invite and bots' buttons; from the
//   start countdown the roster is locked, and its buttons say so, the focus
//   staying where it was (§1.42, §5.7);
// - the match menu, the layer named 'menu' (menu.ts), opened and closed on
//   Escape or the pad's Back, on Pre-match too (M4-Q7), on the HUD's Menu
//   button, and when a stall or a hidden page paused Practice (Q-15):
//   while it's open Practice is paused, nothing is held (§4.8) and Q-17's
//   nav works its buttons, the first focused, or its Settings panel's in
//   their place (§5.8, §6), the menu then reading 'settings', the pad's
//   d-pad reaching the panel's checks and radios too (L82); it always
//   opens on its buttons; closing it resumes and gives the focus back;
// - the graphics (§5.8, D-30, C-36): stage.onGraphics as PitchContext's
//   graphics, 'restoring' from a lost context, a context lost before the
//   screen was made included, as the stage keeps it, the HUD's "Graphics
//   were lost; restoring", held inputs released and Practice paused until
//   it's back; and once lostGraphicsSeconds have passed with the page
//   visible, 'lost', the plain message with Leave over the pitch and every
//   layer, the match going on for the others; a context that comes back
//   puts the pitch back in place of the message;
// - a spectator's view and follow: the ball's from the start; the view key
//   and the shoulders ('next', 'prev') go to the layers first, where the
//   HUD's follow choice moves it along its buttons, the ball and each
//   terrier by pack and spot (D-28, L91);
// - Enter or Start on a focused button of its own that no nav holds, a
//   layer's such as the HUD's Menu button, presses it once, since the
//   keyboard keeps Enter's default from it on the pitch (§4.9); and a
//   mouse press on the pitch, or anywhere on the screen but a control,
//   keeps the focus where it was, so Enter still presses Ready;
// - the layers, made from a host of the screen's own, so their menu, ui
//   and camera calls reach it, and put over the pitch in the order given.
// The app's openMenu, closeMenu and setMode are told after the screen has
// acted, so it can follow (Inspection.menu, the devices); ui isn't passed
// on, since the app's ui is the screen's way in. Phase 1's (shell); phase
// 2's net-screens adds the networked Pre-match, the graphics and the
// spectator's follow; phase 3's robust builder the rebuild when the menu
// closes. New at M4.

import { config } from '../../config';
import type { BarkEvent, ConfirmedEnd } from '../../core/session/index';
import { hashState } from '../../core/sim/index';
import type { UiCommand } from '../../input/source';
import type { CameraMode, FrameOut, StageFrame, ViewMode } from '../../render/frame';
import type { MatchViewApi } from '../../render/stage-types';
import type { PageEvents } from '../clock';
import { h, isEnabled, setShown, setText } from '../dom';
import type { Inspection } from '../inspect';
import type { Layer, LayerFactory, PitchContext, PitchHost } from '../layer';
import { ButtonNav, type NavControl } from '../nav';
import { isPreMatch, prematchPanel } from '../prematch';
import { addStyle } from '../style';
import type { InviteOptions } from './invite';
import { isMenuLayer } from './menu';
import css from './pitch.css?inline';
import { focusScreen, type Screen, screenStyles } from './screen';

export { type ButtonState, isPreMatch, type PackRow, packRows, readyButton, switchButton } from '../prematch';

/** What the pitch screen needs of the message screens, results-hud's src/ui/screens/message.ts (§5.10),
 *  declared here (§0): the graphics message's screen, with its Leave. */
export type GraphicsMessage = (leave: () => void) => Screen;

/** What the pitch screen needs of the app beyond what its layers get. */
export interface PitchScreenHost extends PitchHost {
  /** The end is confirmed (scoreboard.end, D-14): the app shows Results. Called once, after the timer
   *  run's layers have run. */
  results(end: ConfirmedEnd): void;
  /** The page's visibility: the lost graphics' 5 s count only while it's visible (D-30). Always visible
   *  without it. */
  readonly page?: PageEvents;
  /** The plain message once the graphics have been lost for lostGraphicsSeconds (§5.8, §5.10). */
  readonly graphicsMessage?: GraphicsMessage;
  /** A networked match's Invite, with its link's options; none in Practice, nor the bots' buttons. */
  readonly invite?: InviteOptions | null;
}

export type MenuState = Inspection['menu'];

/** PitchContext's graphics (§5.8): drawn, lost and waiting to be restored, or lost past lostGraphicsSeconds. */
export type GraphicsState = PitchContext['graphics'];

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
  readonly graphics: GraphicsState;
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
  /** stage.onGraphics, as the screen tracks it (§5.8). */
  readonly graphics: GraphicsState;
  /** The message over the pitch: 'graphics' once the graphics have been lost for lostGraphicsSeconds. */
  readonly message: 'graphics' | null;
  inspect(): PitchInspection;
}

const NO_BARKS: readonly BarkEvent[] = Object.freeze([]);

/** What a press on the pitch screen may focus: its controls, by tag; a press anywhere else keeps the focus. */
const CONTROLS: ReadonlySet<string> = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'A']);

/** The page always visible, for a host without one. */
const SHOWN: PageEvents = { hidden: () => false, onVisibility: () => () => {} };

export function pitchScreen(host: PitchScreenHost, factories: readonly LayerFactory[]): PitchScreen {
  screenStyles();
  addStyle(css);
  const { match, stage, view, controls, look } = host;
  const me = match.me;
  const clock = match.clock;
  const page = host.page ?? SHOWN;
  const playing = controls !== null;

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
  /** What had the focus when the menu opened. */
  let focusBefore: Element | null = null;
  // The graphics (§5.8): their state, and the lost context's visible time left before the message.
  let graphics: GraphicsState = 'ok';
  let lostLeftMs = 0;
  let lostArmedAt = 0;
  let stopLostTimer: (() => void) | null = null;
  let message: { readonly screen: Screen; readonly cover: HTMLElement } | null = null;

  // --- The DOM ---
  const heading = h('h1', { class: 'visually-hidden' }, 'Pre-match');
  const preparing = h('p', { class: 'pitch-preparing', role: 'status', 'data-test': 'pitch-preparing' }, 'Getting the pitch ready…');
  const panel = prematchPanel({
    match, look, playing, pitchReady: () => pitch !== 'preparing', leave: () => host.leave(), invite: host.invite ?? null,
  });
  const ready = panel.ready;
  const el = h('section', { class: 'pitch-screen', 'data-test': 'pitch-screen' }, heading, preparing, panel.el);

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
  const menuLayer = layers.find(isMenuLayer) ?? null;
  if (menuLayer?.el) setShown(menuLayer.el, false);

  // --- Q-17's navs: Pre-match's buttons, and the menu's: its buttons for the keys, and for the pad the
  // Settings panel's checks and radios too, whose keys the keyboard leaves to the browser (L82, §4.4) ---
  const prematchNav = new ButtonNav(() => panel.buttons(), { clock });
  const detachPrematch = prematchNav.attach(panel.el);
  const menuOf = (selector: string) => (): NavControl[] => (menuLayer?.el ? Array.from(menuLayer.el.querySelectorAll<NavControl>(selector)) : []);
  const menuNav = new ButtonNav(menuOf('button'), { clock });
  const menuPadNav = new ButtonNav(menuOf('button, input[type="checkbox"], input[type="radio"]'), { clock });
  const detachMenu = menuLayer?.el ? menuNav.attach(menuLayer.el) : () => {};

  // --- What the screen does ---
  const context = (frame: StageFrame | null, out: FrameOut | null, barks: readonly BarkEvent[]): PitchContext => ({
    match, drawn: view.drawn, out, frame, nowMs: view.drawMs, mode: view.mode, settings: host.settings.get(), graphics, barks,
  });

  /** The first kickoff's play has begun: the screen is Match, Pre-match's panel gone (M4-Q8). */
  function toMatch(): void {
    name = 'match';
    const active = el.ownerDocument.activeElement;
    const hadFocus = active !== null && panel.el.contains(active);
    setShown(panel.el, false);
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
    if (name === 'prematch') panel.update();
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
    // Its buttons, whatever it showed when Escape last closed it: Resume first, or Settings (§5.8).
    menuLayer?.opened();
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
    if (back === null || doc.activeElement !== back) focusFallback();
    host.closeMenu();
  }

  /** Ready on a player's Pre-match, else the heading. */
  function focusFallback(): void {
    const fallback = name === 'prematch' && playing ? ready : heading;
    if (fallback === heading) heading.tabIndex = -1;
    fallback.focus({ preventScroll: true });
  }

  // --- The graphics (§5.8, D-30) ---

  /** The message's count runs while the context is lost and the page visible (D-30). */
  function armLost(): void {
    if (graphics !== 'restoring' || stopLostTimer !== null || page.hidden()) return;
    lostArmedAt = clock.now();
    stopLostTimer = clock.after(lostLeftMs, () => {
      stopLostTimer = null;
      lostLeftMs = 0;
      showLost();
    });
  }

  function disarmLost(): void {
    if (stopLostTimer === null) return;
    stopLostTimer();
    stopLostTimer = null;
    lostLeftMs = Math.max(0, lostLeftMs - (clock.now() - lostArmedAt));
  }

  function graphicsChanged(state: 'lost' | 'restored'): void {
    if (disposed) return;
    if (state === 'lost') {
      if (graphics !== 'ok') return;
      graphics = 'restoring';
      lostLeftMs = config.lostGraphicsSeconds * 1000;
      // Held inputs released, as for a hidden page; Practice paused until they're back; a networked
      // match plays on, its terrier and its vote kept.
      controls?.release();
      match.pause('graphics');
      armLost();
      return;
    }
    if (graphics === 'ok') return;
    disarmLost();
    graphics = 'ok';
    hideLost();
    match.resume('graphics');
  }

  /** The plain message over the pitch and every layer, with Leave (§5.8, §5.10). */
  function showLost(): void {
    if (disposed || graphics !== 'restoring') return;
    graphics = 'lost';
    const screen = host.graphicsMessage?.(() => host.leave()) ?? null;
    if (screen === null) return;
    const cover = h('div', { class: 'pitch-message' }, screen.el);
    el.append(cover);
    message = { screen, cover };
    focusScreen(screen);
  }

  /** The pitch back in place of the message, the focus with it. */
  function hideLost(): void {
    const m = message;
    if (m === null) return;
    message = null;
    const active = el.ownerDocument.activeElement;
    const hadFocus = active === null || active === el.ownerDocument.body || m.cover.contains(active);
    m.cover.remove();
    m.screen.dispose?.();
    if (hadFocus) focusFallback();
  }

  // --- The keys ---

  function ui(c: UiCommand): void {
    if (disposed) return;
    if (message !== null) {
      message.screen.ui?.(c);
      return;
    }
    if (c.kind === 'menu') {
      if (c.repeat) return;
      if (menu === 'closed') openMenu();
      else closeMenu();
      return;
    }
    if (menu !== 'closed') {
      (c.source === 'keyboard' ? menuNav : menuPadNav).ui(c);
      return;
    }
    // A layer's own command first: the HUD's follow choice takes a spectator's next and prev, the view
    // key's and the shoulders' (§5.8, D-28); a player's do nothing here.
    for (const l of layers) if (l.ui?.(c) === true) return;
    if (c.kind === 'next' || c.kind === 'prev') return;
    // The focus on one of the screen's own buttons outside Pre-match's nav, a layer's such as the HUD's
    // Menu button: on the pitch the keyboard keeps Enter's default from it (§4.9), so the screen presses
    // it, once, unless it can't act yet.
    const focused = focusedButton();
    if (c.kind === 'press' && focused !== null && !panel.buttons().includes(focused)) {
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
  const onGraphics = (state: 'lost' | 'restored'): void => graphicsChanged(state);
  stage.onGraphics = onGraphics;
  const stopVisibility = page.onVisibility(() => {
    if (page.hidden()) disarmLost();
    else armLost();
  });
  // A context lost before this screen was made, on Home, on Results or between a role's two screens, was
  // told to nobody, but the stage keeps it (§5.8, D-30).
  if (stage.info().lost) graphicsChanged('lost');
  const prepared = (state: 'ready' | 'failed'): void => {
    if (disposed) return;
    pitch = state;
    setShown(preparing, false);
    panel.update();
  };
  stage.ready().then(() => prepared('ready'), () => prepared('failed'));
  el.addEventListener('mousedown', keepFocus);
  {
    const t = match.session.timeline;
    if (t.started && !isPreMatch(t.head.phase)) toMatch();
    else panel.update();
  }

  return {
    el,
    get name() {
      return name;
    },
    get menu() {
      // 'settings' while the menu shows its Settings panel (Inspection.menu).
      return menu === 'closed' ? 'closed' : (menuLayer?.panel ?? 'menu');
    },
    get graphics() {
      return graphics;
    },
    get message() {
      return message !== null ? 'graphics' : null;
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
      return { layers: out, headHashMismatches: mismatches, pitch, frames, view: view.inspect(), graphics };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      stopVisibility();
      if (stage.onGraphics === onGraphics) stage.onGraphics = null;
      disarmLost();
      message?.screen.dispose?.();
      el.removeEventListener('mousedown', keepFocus);
      detachPrematch();
      detachMenu();
      for (const l of layers) l.dispose?.();
      controls?.release();
      // A menu left open, or the graphics' pause, would leave Practice paused for whatever comes next.
      if (menu !== 'closed') {
        menu = 'closed';
        match.resume('menu');
      }
      if (graphics !== 'ok') {
        graphics = 'ok';
        match.resume('graphics');
      }
    },
  };
}
