import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { botIds, botName, personId } from '../../core/bot/bot-id';
import type { BarkEvent, ConfirmedEnd } from '../../core/session/index';
import { findTerrier, IN_PLAY, type MatchState, READY, START_COUNTDOWN, WARM_UP } from '../../core/sim/index';
import { TEST_BUILD } from '../../core/timeline/testing';
import type { UiCommand } from '../../input/source';
import { PLACEHOLDER_LOOK } from '../../render/look';
import { type BarkSource, MatchView } from '../../render/view';
import { FakeClock, fakePage } from '../clock-testing';
import { cssDeclarations, cssLength, fake, type FakeDocument, FakeEvent, heardText, installDom, only, shownText } from '../dom-testing';
import { hudLayer } from '../hud';
import type { Layer, LayerFactory, PitchContext, PitchHost } from '../layer';
import { practiceMatch } from '../match';
import {
  type Calls, FakeControls, FakeStage, FakeView, MemorySettings, stateWith, StateMatch, testHost, type TestHost,
} from '../pitch-testing';
import { matchMenu } from './menu';
import { isPreMatch, packRows, type PitchScreen, pitchScreen, type PitchScreenHost, readyButton, switchButton } from './pitch';
import { focusScreen } from './screen';

// The pitch screen (M4's design §1.43, §5.4, §5.7, §5.8, §4.8, §4.9, §2.7;
// PLAN Q-15, Q-17, P11; M4-Q7, M4-Q8), built against the contracts with
// fakes for the stage, the view and the controls (§12's 1b), on the
// screens' DOM fake: the pitch drawn only once the stage is ready, and
// Ready held till then; each frame's order and each timer run's, Results
// after the layers have seen the run that ended the match; Pre-match
// through the start countdown, Match from the first kickoff's play; Ready
// aria-disabled and focused, following the press at once, locked by the
// countdown with the focus kept; the menu's pause, release, nav and focus;
// a press on a focused button no nav holds, the HUD's Menu button's; a
// mouse press off the screen's controls keeping the focus where it was; what
// the layers reach the screen by, and the clock each part is handed; the
// sampler, the barks and the view switch; P11's hash under the hook;
// Pre-match's panel clear of the middle; and Practice itself through
// Pre-match into Match in virtual time.

const ME = personId(7, 0);
const BOT = `${'b'.repeat(4)}${'0'.repeat(28)}`;
/** Its name, as its host's JOIN gives it (the owner, 2026-11-22). */
const BOT_NAME = botName(BOT);
const key = (kind: UiCommand['kind'], repeat = false): UiCommand => ({ kind, pressedAt: 0, source: 'keyboard', repeat });

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

/** A layer that logs what the screen hands it. */
function spyLayer(calls: Calls, seen: PitchContext[], owned: number[] = []): LayerFactory {
  return (): Layer => ({
    name: 'spy',
    el: null,
    frame: (ctx) => {
      calls.push('layer.frame');
      seen.push(ctx);
    },
    run: (ctx) => {
      calls.push(`layer.run ${ctx.barks.length}`);
      seen.push(ctx);
    },
    ownBark: (tick) => owned.push(tick),
    dispose: () => calls.push('layer.dispose'),
    inspect: () => ({ spied: seen.length }),
  });
}

const menuLayer: LayerFactory = (h: PitchHost) => matchMenu({ practice: h.match.kind === 'practice', resume: () => h.closeMenu(), settings: null, leave: () => h.leave() });

interface Rig {
  readonly calls: Calls;
  readonly seen: PitchContext[];
  readonly owned: number[];
  readonly match: StateMatch;
  readonly view: FakeView;
  readonly stage: FakeStage;
  readonly controls: FakeControls;
  readonly host: TestHost & PitchScreenHost;
  readonly ended: ConfirmedEnd[];
  readonly screen: PitchScreen;
}

function rig(o: { state?: MatchState; test?: boolean; player?: boolean; settings?: MemorySettings; layers?: readonly LayerFactory[] } = {}): Rig {
  const calls: Calls = [];
  const seen: PitchContext[] = [];
  const owned: number[] = [];
  const match = new StateMatch(ME, o.state ?? stateWith(1, 100, [{ id: ME, pack: 0, name: 'Ada', coat: 2 }, { id: BOT, pack: 1, name: BOT_NAME }]));
  const view = new FakeView(calls, match);
  const stage = new FakeStage(calls);
  const controls = new FakeControls(calls);
  const ended: ConfirmedEnd[] = [];
  const base = testHost({ match, view, stage, controls: o.player === false ? null : controls, ...(o.settings ? { settings: o.settings } : {}), test: o.test ?? false });
  const host = { ...base, results: (end: ConfirmedEnd) => { calls.push('results'); ended.push(end); } };
  const screen = pitchScreen(host, o.layers ?? [spyLayer(calls, seen, owned), menuLayer]);
  dom.document.body.append(fake(screen.el));
  return { calls, seen, owned, match, view, stage, controls, host, ended, screen };
}

const button = (r: Rig, test: string): { el: ReturnType<typeof only>; text: string; disabled: boolean } => {
  const el = only(r.screen.el, `button[data-test="${test}"]`);
  return { el, text: el.textContent, disabled: el.getAttribute('aria-disabled') === 'true' };
};
const active = (): unknown => dom.document.activeElement;
const withPhase = (s: MatchState, phase: MatchState['phase'], tick = s.tick): MatchState => ({ ...s, phase, phaseStart: tick, tick });

describe("the pitch screen's rules (pure)", () => {
  const s = stateWith(2, 50, [{ id: ME, pack: 0 }, { id: BOT, pack: 1, name: BOT_NAME, coat: 5 }]);
  const ready = (o: Partial<Parameters<typeof readyButton>[0]> = {}): ReturnType<typeof readyButton> =>
    readyButton({ pitchReady: true, final: s, headPhase: WARM_UP, me: ME, wish: null, ...o });

  it('Ready waits for the pitch, then for the final roster, and is locked by the start countdown (§1.42, §5.7)', () => {
    expect(ready({ pitchReady: false })).toEqual({ enabled: false, on: false, text: 'Getting the pitch ready…' });
    expect(ready({ final: null })).toEqual({ enabled: false, on: false, text: 'Joining…' });
    expect(ready({ me: BOT.replace('b', 'c') })).toEqual({ enabled: false, on: false, text: 'Joining…' });
    expect(ready()).toEqual({ enabled: true, on: false, text: 'Ready' });
    expect(ready({ wish: true })).toEqual({ enabled: true, on: true, text: 'Ready ✓' });
    const readied = stateWith(2, 50, [{ id: ME, pack: 0 }]);
    readied.terriers[0]!.readyUntil = 51;
    expect(ready({ final: readied })).toEqual({ enabled: true, on: true, text: 'Ready ✓' });
    expect(ready({ final: readied, wish: false }).text).toBe('Ready'); // a cancel on its way
    readied.terriers[0]!.readyUntil = 50; // expired at this tick
    expect(ready({ final: readied }).on).toBe(false);
    expect(ready({ headPhase: START_COUNTDOWN })).toEqual({ enabled: false, on: true, text: 'Starting…' });
    expect(ready({ final: withPhase(s, START_COUNTDOWN) }).text).toBe('Starting…');
  });

  it('Switch pack waits for the final roster and is locked by the start countdown', () => {
    expect(switchButton(null, null, ME)).toEqual({ enabled: false, text: 'Switch pack: joining…' });
    expect(switchButton(s, WARM_UP, ME)).toEqual({ enabled: true, text: 'Switch pack' });
    expect(switchButton(s, START_COUNTDOWN, ME)).toEqual({ enabled: false, text: 'Switch pack: starting…' });
  });

  it("lists a pack's terriers by spot, named as the screens name them, ready from the countdown on (§5.7)", () => {
    const four = stateWith(2, 50, [{ id: BOT, pack: 1, name: BOT_NAME, coat: 5 }, { id: ME, pack: 0 }, { id: `${'d'.repeat(4)}${'0'.repeat(28)}`, pack: 0, name: 'Dee' }]);
    expect(packRows(four, 0, ME)).toEqual([
      { id: ME, name: `Player ${ME.slice(0, 4).toUpperCase()}`, coat: 0, ready: false, you: true },
      { id: `${'d'.repeat(4)}${'0'.repeat(28)}`, name: 'Dee', coat: 0, ready: false, you: false },
    ]);
    expect(packRows(four, 1, ME)).toEqual([{ id: BOT, name: BOT_NAME, coat: 5, ready: false, you: false }]);
    expect(packRows(withPhase(four, START_COUNTDOWN), 1, ME)[0]!.ready).toBe(true);
  });

  it('keeps Pre-match through the start countdown (M4-Q8)', () => {
    expect(([WARM_UP, START_COUNTDOWN, IN_PLAY] as const).map((p) => isPreMatch(p))).toEqual([true, true, false]);
  });
});

describe('the pitch screen (M4\'s design §1.43)', () => {
  it('says the pitch is getting ready and draws nothing till the stage is, holding Ready meanwhile', async () => {
    const r = rig();
    r.screen.frame(1000);
    expect(r.calls).toEqual([]);
    expect(shownText(r.screen.el as never)).toContain('Getting the pitch ready…');
    expect(button(r, 'ready')).toMatchObject({ text: 'Getting the pitch ready…', disabled: true });
    expect(r.screen.inspect().pitch).toBe('preparing');
    await r.stage.finish();
    expect(only(r.screen.el, '[data-test="pitch-preparing"]').hidden).toBe(true);
    expect(button(r, 'ready')).toMatchObject({ text: 'Ready', disabled: false });
    r.screen.frame(1016);
    r.screen.frame(1032);
    expect(r.calls).toEqual(['view.frame', 'stage.draw', 'controls.frameDrawn', 'layer.frame', 'view.frame', 'stage.draw', 'controls.frameDrawn', 'layer.frame']);
    expect(r.view.dts).toEqual([0, 16]);
    expect(r.controls.drawnTicks).toEqual([100, 100]); // the drawn time's tick
    expect(r.screen.inspect()).toMatchObject({ pitch: 'ready', frames: 2, layers: { spy: { spied: 2 } } });
    expect(r.screen.inspect().view).toEqual(r.view.inspect()); // the drawing clock's among them (§9.5)
    const ctx = r.seen[0]!;
    expect([ctx.match, ctx.out, ctx.frame, ctx.graphics, ctx.barks, ctx.drawn]).toEqual([r.match, r.stage.out, r.stage.drawn[0], 'ok', [], r.view.drawn]);
    r.screen.dispose();
  });

  it('draws anyway when the compile fails, and says so', async () => {
    const r = rig();
    await r.stage.fail();
    r.screen.frame(1000);
    expect(r.calls).toContain('stage.draw');
    expect(r.screen.inspect().pitch).toBe('failed');
    expect(button(r, 'ready').disabled).toBe(false);
    r.screen.dispose();
  });

  it("runs the view, then each layer with the barks it found, then its own moves: Results once, after the layers saw the end", async () => {
    const r = rig();
    await r.stage.finish();
    const barks: BarkEvent[] = [{ id: BOT, tick: 99, own: false }];
    r.view.barks = barks;
    r.match.run();
    expect(r.calls).toEqual(['view.run', 'layer.run 1']);
    expect(r.seen.at(-1)!.barks).toEqual(barks);
    const end: ConfirmedEnd = { tick: 200, score: [0, 1], winner: 1, rows: [] };
    r.match.board.end = end;
    r.match.run();
    r.match.run();
    expect(r.calls.slice(2)).toEqual(['view.run', 'layer.run 0', 'results', 'view.run', 'layer.run 0']);
    expect(r.ended).toEqual([end]);
    r.match.correction({ tick: 1, from: 1, before: r.match.state, after: r.match.state, repair: false });
    expect(r.calls.at(-1)).toBe('view.correct');
    r.screen.dispose();
  });

  it('is Pre-match through the start countdown and Match from the first kickoff\'s play, Ready locked meanwhile with the focus kept (M4-Q8)', async () => {
    const r = rig();
    await r.stage.finish();
    focusScreen(r.screen);
    const ready = button(r, 'ready').el;
    expect(active()).toBe(ready);
    expect(r.screen.name).toBe('prematch');
    r.match.head = withPhase(r.match.state, START_COUNTDOWN, 101); // the head counts down before the final does
    r.match.run();
    expect(button(r, 'ready')).toMatchObject({ text: 'Starting…', disabled: true });
    expect(button(r, 'switch-pack')).toMatchObject({ text: 'Switch pack: starting…', disabled: true });
    expect(active()).toBe(ready);
    expect(r.screen.name).toBe('prematch');
    r.match.state = withPhase(r.match.state, IN_PLAY, 400);
    r.match.run();
    expect(r.screen.name).toBe('match');
    expect(only(r.screen.el, '[data-test="prematch"]').shown).toBe(false);
    expect(only(r.screen.el, 'h1').textContent).toBe('Match');
    expect(active()).toBe(only(r.screen.el, 'h1')); // the focus leaves the hidden panel for the heading
    expect(r.screen.el.querySelector('[data-focus]')).toBeNull();
    r.screen.dispose();
  });

  it('enters straight at Match on a match under way, focusing its heading', () => {
    const r = rig({ state: withPhase(stateWith(1, 500, [{ id: ME, pack: 0 }]), IN_PLAY, 400) });
    expect(r.screen.name).toBe('match');
    focusScreen(r.screen);
    expect(active()).toBe(only(r.screen.el, 'h1'));
    r.screen.dispose();
  });

  it('keeps Ready focused and aria-disabled while it cannot act, presses it by the nav once it can, and follows the press at once (Q-17, L146)', async () => {
    const r = rig({ state: stateWith(1, 100, [{ id: BOT, pack: 1 }]) }); // the person not yet in the final roster
    focusScreen(r.screen);
    const ready = button(r, 'ready').el;
    expect(active()).toBe(ready);
    r.screen.ui(key('press'));
    ready.click();
    expect(r.match.readies).toEqual([]);
    await r.stage.finish();
    expect(button(r, 'ready')).toMatchObject({ text: 'Joining…', disabled: true });
    r.screen.ui(key('press'));
    expect(r.match.readies).toEqual([]);
    r.match.state = stateWith(1, 115, [{ id: ME, pack: 0 }, { id: BOT, pack: 1 }]); // the JOIN is final
    r.match.run();
    expect(button(r, 'ready')).toMatchObject({ text: 'Ready', disabled: false });
    expect(active()).toBe(ready); // the focus held on it
    r.screen.ui(key('press', true)); // a held Enter's repeat presses nothing
    expect(r.match.readies).toEqual([]);
    r.screen.ui(key('press'));
    expect(r.match.readies).toEqual([true]);
    expect(button(r, 'ready').text).toBe('Ready ✓'); // at once, its READY on its way
    r.screen.ui(key('press'));
    expect(r.match.readies).toEqual([true, false]); // pressed again, it cancels
    expect(button(r, 'ready').text).toBe('Ready');
    r.match.inFlight = 0; // both final: the state's Ready rules again
    const s = stateWith(1, 140, [{ id: ME, pack: 0 }, { id: BOT, pack: 1 }]);
    s.terriers[findTerrier(s, ME)]!.readyUntil = 9999;
    r.match.state = s;
    r.match.run();
    expect(button(r, 'ready').text).toBe('Ready ✓');
    ready.click();
    expect(r.match.readies).toEqual([true, false, false]);
    r.screen.dispose();
  });

  it("moves among Ready, Switch pack and Leave, and presses the one focused (Q-17)", async () => {
    const r = rig();
    await r.stage.finish();
    focusScreen(r.screen);
    r.screen.ui(key('down'));
    expect(active()).toBe(button(r, 'switch-pack').el);
    r.screen.ui(key('press'));
    expect(r.match.switches).toBe(1);
    r.screen.ui(key('right'));
    r.screen.ui(key('press'));
    expect(r.host.told).toEqual(['leave']);
    r.match.switchRefused = true;
    r.match.state = stateWith(1, 101, [{ id: ME, pack: 0 }, { id: BOT, pack: 1 }]);
    r.match.run();
    expect(shownText(only(r.screen.el, '[data-test="prematch"]'))).toContain('The other pack is full.');
    r.screen.dispose();
  });

  it('keeps the focus on Ready through a mouse press on the pitch or the panel, but lets a control take it (§4.9)', async () => {
    const r = rig();
    await r.stage.finish();
    focusScreen(r.screen);
    const mousedown = (on: ReturnType<typeof only>): boolean => on.dispatchEvent(new FakeEvent('mousedown', { bubbles: true, cancelable: true }));
    // The pitch itself, which the screen covers, and the panel's lists: the default, which would move the
    // focus to the page's body, kept from them.
    expect(mousedown(fake(r.screen.el))).toBe(false);
    expect(mousedown(only(r.screen.el, '[data-test="pack-0"]'))).toBe(false);
    expect(active()).toBe(button(r, 'ready').el);
    // A button's own, as a browser's.
    expect(mousedown(button(r, 'switch-pack').el)).toBe(true);
    r.screen.dispose();
    expect(mousedown(fake(r.screen.el))).toBe(true);
  });

  it("opens the menu on Escape, a stall or the HUD's button: pausing, releasing what's held, its first button focused; and closes it again (Q-15, M4-Q7)", async () => {
    const r = rig();
    await r.stage.finish();
    focusScreen(r.screen);
    const ready = button(r, 'ready').el;
    const menu = only(r.screen.el, '[data-test="menu"]');
    expect([menu.shown, r.screen.menu]).toEqual([false, 'closed']);
    r.screen.ui(key('menu'));
    expect([menu.shown, r.screen.menu, [...r.match.reasons], r.controls.releases]).toEqual([true, 'menu', ['menu'], 1]);
    expect(active()).toBe(only(menu, 'button[data-test="resume"]'));
    expect(r.host.told).toEqual(['openMenu']);
    r.screen.ui(key('menu', true)); // a held Escape's repeat changes nothing
    expect(r.screen.menu).toBe('menu');
    r.screen.ui(key('press')); // Resume
    expect([menu.shown, r.screen.menu, [...r.match.reasons]]).toEqual([false, 'closed', []]);
    expect(active()).toBe(ready); // the focus back where it was
    expect(r.host.told).toEqual(['openMenu', 'closeMenu']);
    r.match.stall('hidden'); // a hidden page paused Practice: the menu opens over it
    expect([r.screen.menu, [...r.match.reasons]]).toEqual(['menu', ['menu']]);
    r.screen.ui(key('menu'));
    expect(r.screen.menu).toBe('closed');
    r.screen.ui(key('menu'));
    r.screen.ui(key('down'));
    r.screen.ui(key('press')); // Leave, in the menu
    expect(r.host.told.at(-1)).toBe('leave');
    r.screen.dispose();
    expect([r.screen.menu, [...r.match.reasons]]).toEqual(['closed', []]); // nothing left paused
  });

  it('gives the focus back when the menu closes, or to the heading where what had it is gone', async () => {
    const r = rig();
    await r.stage.finish();
    focusScreen(r.screen);
    r.screen.ui(key('down')); // Switch pack
    const switchPack = button(r, 'switch-pack').el;
    expect(active()).toBe(switchPack);
    r.screen.openMenu();
    r.match.state = withPhase(r.match.state, IN_PLAY, 400); // a networked match plays on under the menu
    r.match.run();
    expect(r.screen.name).toBe('match');
    r.screen.closeMenu();
    expect(active()).toBe(only(r.screen.el, 'h1')); // Switch pack went with Pre-match's panel
    r.screen.openMenu();
    r.screen.closeMenu();
    expect(active()).toBe(only(r.screen.el, 'h1'));
    r.screen.dispose();
  });

  it("hands the controls the sampler and the rebase, draws your bark at once and tells each layer, and switches a player's view (§2.5, §3.4)", async () => {
    const settings = new MemorySettings();
    settings.set({ ballView: false });
    const r = rig({ settings });
    expect(r.view.mode).toEqual({ kind: 'player', view: 'chase', terrier: ME }); // start in ball view off
    expect(r.screen.viewMode()).toBe('chase');
    r.controls.input = 0x155;
    expect(r.match.sampler!(r.match.state, 100, 103)).toBe(0x155);
    r.match.rebaser!(0x2a);
    expect([r.controls.samples, r.controls.rebases]).toEqual([[103], [0x2a]]);
    r.screen.ownBark(104);
    expect([r.view.ownBarks, r.owned]).toEqual([[104], [104]]);
    r.screen.switchView();
    expect([r.view.mode, r.screen.viewMode(), r.controls.viewChanges]).toEqual([{ kind: 'player', view: 'ball', terrier: ME }, 'ball', 1]);
    expect(r.host.told).toEqual(['setMode ball']);
    r.screen.dispose();
    r.screen.ownBark(105);
    expect(r.view.ownBarks).toEqual([104]);
  });

  it("presses a focused button no nav holds, the HUD's Menu button, on Enter or Start: on Pre-match and on Match (§4.9)", async () => {
    const r = rig({ layers: [hudLayer, menuLayer] });
    await r.stage.finish();
    const button = only(r.screen.el, 'button[data-test="menu-button"]');
    button.focus();
    r.screen.ui(key('press', true)); // a held Enter's repeat presses nothing
    expect(r.screen.menu).toBe('closed');
    r.screen.ui(key('press'));
    expect([r.screen.menu, [...r.match.reasons], r.host.told]).toEqual(['menu', ['menu'], ['openMenu']]);
    r.screen.ui(key('press')); // Resume, the menu's first, focused: the menu's nav presses it
    expect([r.screen.menu, active()]).toEqual(['closed', button]);
    r.match.state = withPhase(r.match.state, IN_PLAY, 400);
    r.match.run();
    expect(r.screen.name).toBe('match');
    r.screen.ui({ ...key('press'), source: 'gamepad' }); // Start, on Match, where no nav holds a button
    expect(r.screen.menu).toBe('menu');
    r.screen.dispose();
  });

  it("lets its layers reach it: the menu, the app's log, the camera's mode, the commands and Leave (§1.38)", async () => {
    let lent: PitchHost | null = null;
    const grab: LayerFactory = (h) => {
      lent = h;
      return { name: 'grab', el: null };
    };
    const r = rig({ layers: [grab, menuLayer] });
    await r.stage.finish();
    const h = lent! as PitchHost;
    for (const [mine, theirs] of [[h.match, r.match], [h.view, r.view], [h.stage, r.stage], [h.controls, r.controls]] as const) expect(mine).toBe(theirs);
    h.openMenu();
    expect([r.screen.menu, [...r.match.reasons], r.controls.releases, r.host.told]).toEqual(['menu', ['menu'], 1, ['openMenu']]);
    h.closeMenu();
    expect([r.screen.menu, [...r.match.reasons], r.host.told.at(-1)]).toEqual(['closed', [], 'closeMenu']);
    h.announce({ kind: 'bark' });
    expect(r.host.announced).toEqual([{ kind: 'bark' }]);
    h.setMode({ kind: 'player', view: 'chase', terrier: ME });
    expect([r.view.mode, r.screen.viewMode(), r.controls.viewChanges, r.host.told.at(-1)]).toEqual([
      { kind: 'player', view: 'chase', terrier: ME }, 'chase', 1, 'setMode chase',
    ]);
    h.ui(key('menu')); // the screen's own way in, not the app's
    expect([r.screen.menu, r.host.told.includes('ui menu')]).toEqual(['menu', false]);
    h.leave();
    expect(r.host.told.at(-1)).toBe('leave');
    r.screen.dispose();
  });

  it("hands its layers the drawing clock and the view's mode, and each part the clock and tick it reads (§1.38, R-6)", async () => {
    const r = rig();
    await r.stage.finish();
    r.view.fraction = 0.25; // drawn a quarter of the way through the tick before the head's, 100
    r.view.lag = 300; // the drawing clock behind the page's, as after a pause
    r.screen.frame(2000);
    const ctx = r.seen.at(-1)!;
    expect([ctx.nowMs, ctx.mode]).toEqual([1700, r.view.mode]);
    // The key-to-screen figure: the frame's page time, the controls' events' clock, and the drawn time's tick.
    expect(r.controls.drawnAt).toEqual([[99, 2000]]);
    // The timer's run, your bark and a correction take the page clock's now.
    r.match.clock.advance(40);
    r.match.run();
    r.screen.ownBark(103);
    r.match.correction({ tick: 100, from: 99, before: r.match.state, after: r.match.state, repair: false });
    expect(r.view.times).toMatchObject({ run: [1040], ownBark: [1040], correct: [1040] });
    expect(r.seen.at(-1)!.nowMs).toBe(r.view.drawMs);
    r.screen.dispose();
  });

  it('shows a spectator the lists without Ready or Switch pack, from the ball', async () => {
    const r = rig({ player: false });
    await r.stage.finish();
    expect([button(r, 'ready').el.shown, button(r, 'switch-pack').el.shown, button(r, 'prematch-leave').el.shown]).toEqual([false, false, true]);
    expect(r.view.mode).toEqual({ kind: 'spectator', follow: null });
    expect(r.screen.viewMode()).toBe('ball');
    expect(r.match.sampler).toBeNull();
    focusScreen(r.screen);
    expect(active()).toBe(only(r.screen.el, 'h1'));
    r.screen.dispose();
  });

  it("lists each pack from the final state, its free places too, and rebuilds a list only when it changes (§5.7)", async () => {
    const two = (readyUntil: number): MatchState => {
      const s = stateWith(2, 100, [{ id: ME, pack: 0, name: 'Ada', coat: 2 }, { id: BOT, pack: 1, name: BOT_NAME, coat: 5 }]);
      s.terriers[findTerrier(s, BOT)]!.readyUntil = readyUntil;
      return s;
    };
    const r = rig({ state: two(0) });
    await r.stage.finish();
    const a = only(r.screen.el, '[data-test="pack-0"]');
    const b = only(r.screen.el, '[data-test="pack-1"]');
    // Each coat by its name beside its swatch, never its colour alone (§5.14).
    const coat = (k: number): string => PLACEHOLDER_LOOK.coats[k]!.name;
    expect(shownText(a)).toBe(`Ada${coat(2)}you` + 'Not ready' + 'A free place');
    expect(shownText(b)).toBe(`${BOT_NAME}${coat(5)}Not readyA free place`);
    expect(a.querySelectorAll('li.you')).toHaveLength(1);
    const before = a.children[0];
    r.match.state = two(9999);
    r.match.run();
    expect(shownText(b)).toBe(`${BOT_NAME}${coat(5)}Ready ✓A free place`);
    expect(a.children[0]).toBe(before); // pack A's list unchanged, not rebuilt
    expect(shownText(r.screen.el as never)).toContain('1 of 2');
    r.screen.dispose();
  });

  it("draws a bot's swatch as a robot's head and says \" bot\" after its name, a person's row as it was (the owner, 2026-11-23)", async () => {
    // Practice's first bot, a bot by its ID (isBot), beside Ada in pack A, and Bea in pack B.
    const bot = botIds(ME)[0]!;
    const name = botName(bot, ['Ada']);
    const BEA = personId(7, 1);
    const r = rig({ state: stateWith(2, 100, [{ id: ME, pack: 0, name: 'Ada', coat: 2 }, { id: bot, pack: 0, name, coat: 0 }, { id: BEA, pack: 1, name: 'Bea', coat: 4 }]) });
    await r.stage.finish();
    const coat = (k: number): string => PLACEHOLDER_LOOK.coats[k]!.name;
    const rows = [...only(r.screen.el, '[data-test="pack-0"]').children.slice(0, 2), only(r.screen.el, '[data-test="pack-1"]').children[0]!];
    expect(rows.map((li) => [only(li, '.swatch').className, only(li, '.swatch').querySelectorAll('svg').length])).toEqual([
      ['swatch coat', 0], ['swatch coat bot', 1], ['swatch coat', 0],
    ]);
    // Heard: " bot" right after the bot's name; seen: every row as it was.
    expect(rows.map((li) => li.children.map((c) => c.className))).toEqual([
      ['swatch coat', 'name', 'coat-name', 'tag', 'ready'], ['swatch coat bot', 'name', 'visually-hidden', 'coat-name', 'ready'], ['swatch coat', 'name', 'coat-name', 'ready'],
    ]);
    expect(rows.map((li) => heardText(li))).toEqual([`Ada${coat(2)}youNot ready`, `${name} bot${coat(0)}Not ready`, `Bea${coat(4)}Not ready`]);
    expect(rows.map((li) => shownText(li))).toEqual([`Ada${coat(2)}youNot ready`, `${name}${coat(0)}Not ready`, `Bea${coat(4)}Not ready`]);
    r.screen.dispose();
  });

  it("counts, with the hook, each frame whose drawing changed the head's hash (P11), and computes nothing without it", async () => {
    const hooked = rig({ test: true });
    await hooked.stage.finish();
    hooked.screen.frame(1000);
    hooked.view.onFrame = (head) => {
      head.ball.x += 1; // a drawing that writes to the state
    };
    hooked.screen.frame(1016);
    hooked.view.onFrame = null;
    hooked.screen.frame(1032);
    expect(hooked.screen.inspect().headHashMismatches).toBe(1);
    hooked.screen.dispose();
    const plain = rig();
    await plain.stage.finish();
    plain.view.onFrame = (head) => {
      head.ball.x += 1;
    };
    plain.screen.frame(1000);
    expect(plain.screen.inspect().headHashMismatches).toBe(0);
    plain.screen.dispose();
  });

  it('lets go of everything when disposed: its subscription, its layers, what the controls hold', async () => {
    const r = rig();
    await r.stage.finish();
    expect(r.match.subscribers).toBe(1);
    r.screen.dispose();
    expect([r.match.subscribers, r.calls.includes('layer.dispose'), r.controls.releases]).toEqual([0, true, 1]);
    r.screen.frame(2000);
    r.screen.ui(key('menu'));
    expect([r.calls.includes('view.frame'), r.screen.menu]).toEqual([false, 'closed']);
  });
});

describe("Pre-match's panel's place (§5.7, L52; a browser confirms it)", () => {
  const css = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8');
  /** Right of the middle by at least this, px: the widest mark over your terrier, its bark's, is under 80 px. */
  const CLEAR = 40;

  it("keeps right of the middle, where your terrier and its marks are drawn, and under the HUD's top bar, at the gate's size and a phone's", () => {
    const d = cssDeclarations(css('../prematch.css'), '.prematch');
    const bar = cssDeclarations(css('../hud.css'), '.hud-top');
    // The HUD's top bar is as tall as its Menu button, which every button's minimum height makes it.
    const below = cssLength(bar.top, 0) + cssLength(cssDeclarations(css('../screens.css'), 'button')['min-height'], 0);
    for (const [w, h] of [[640, 360], [667, 375], [915, 412], [1280, 720]] as const) {
      const left = w - cssLength(d.right, w) - cssLength(d.width, w);
      expect(left - w / 2, `${w} × ${h}`).toBeGreaterThanOrEqual(CLEAR);
      expect(cssLength(d.top, h), `${w} × ${h}`).toBeGreaterThanOrEqual(below);
    }
    expect(d.bottom).toBeUndefined();
  });
});

describe("the pitch screen over Practice (M4's design §5.4, §5.7)", () => {
  /** No barks: this test reads none. */
  const quiet: BarkSource = { update: () => [], pressed: () => {}, latest: () => null, reset: () => {} };

  it('holds Ready at Joining… until the person is in the final roster, readies, counts down on Pre-match and plays on Match', async () => {
    const clock = new FakeClock(1000);
    const match = practiceMatch({ me: ME, name: 'Ada', coat: 3, settings: { packSize: 1, matchMinutes: 1 }, build: TEST_BUILD, clock, page: fakePage() });
    const calls: Calls = [];
    const view = new MatchView(match, PLACEHOLDER_LOOK, () => ({ calmCamera: false, names: false }), quiet);
    const stage = new FakeStage(calls);
    const controls = new FakeControls(calls);
    const ended: ConfirmedEnd[] = [];
    const screen = pitchScreen({ ...testHost({ match, view, stage, controls }), results: (e) => ended.push(e) }, [menuLayer]);
    dom.document.body.append(fake(screen.el));
    await stage.finish();
    const ready = only(screen.el, 'button[data-test="ready"]');
    focusScreen(screen);
    expect([ready.textContent, ready.getAttribute('aria-disabled'), active() === ready]).toEqual(['Joining…', 'true', true]);
    const t = (): typeof match.session.timeline => match.session.timeline;
    clock.until(() => findTerrier(t().final, ME) >= 0, 1000);
    expect([ready.textContent, ready.getAttribute('aria-disabled')]).toEqual(['Ready', null]);
    expect(shownText(only(screen.el, '[data-test="pack-0"]'))).toContain('Ada');
    // Practice's bot, always ready, by the name its host gave it with the person's taken (the owner, 2026-11-22).
    const coats = PLACEHOLDER_LOOK.coats.map((c) => c.name).join('|');
    expect(shownText(only(screen.el, '[data-test="pack-1"]'))).toMatch(new RegExp(`^${botName(botIds(ME)[0]!, ['Ada'])}(${coats})Ready ✓$`));
    screen.ui({ kind: 'press', pressedAt: clock.now(), source: 'keyboard', repeat: false });
    expect(ready.textContent).toBe('Ready ✓');
    expect(t().eventsInFlight(ME) & READY).toBe(READY);
    clock.until(() => t().head.phase === START_COUNTDOWN, 1000);
    clock.advance(20);
    expect([screen.name, ready.textContent, ready.getAttribute('aria-disabled'), active() === ready]).toEqual(['prematch', 'Starting…', 'true', true]);
    screen.frame(clock.now());
    expect(stage.drawn.at(-1)?.match?.phase).toBe(START_COUNTDOWN);
    clock.until(() => screen.name === 'match', 6000);
    expect(t().head.phase).toBe(IN_PLAY);
    expect(controls.samples.length).toBeGreaterThan(300); // sampled once a sent tick throughout
    screen.ui({ kind: 'menu', pressedAt: clock.now(), source: 'keyboard', repeat: false });
    const at = t().localTick;
    clock.advance(1000);
    expect([match.paused, t().localTick]).toEqual([true, at]); // the menu pauses Practice
    screen.ui({ kind: 'press', pressedAt: clock.now(), source: 'keyboard', repeat: false }); // Resume
    clock.advance(1000);
    expect(t().localTick).toBe(at + 60);
    expect(ended).toEqual([]);
    screen.dispose();
    match.close();
  });
});
