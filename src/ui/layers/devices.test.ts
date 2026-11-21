import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../config';
import { CONTROLS } from '../../input/hints';
import type { Control, InputKind } from '../../input/source';
import { TouchControls, type TouchInspection } from '../../input/touch';
import type { LayerDevices } from '../devices';
import { cssDeclarations, cssLength, fake, type FakeElement, FakeEvent, installDom, only, shownText } from '../dom-testing';
import type { Layer, PitchHost } from '../layer';
import { FakeControls, FakeStage, FakeView, MemoryProfile, StateMatch, stateWith, testHost } from '../pitch-testing';
import type { TurnInspection } from '../phone';
import { deviceLayers, type HintsInspection, LAYERS, onWindows } from './devices';

// The devices' layers over the pitch (PLAN D-29, D-30, L83, C-52; M4's
// design §1.63, §4.3, §4.7, M4-Q28): the page's touch control layer over
// each pitch, a player's alone, the newest screen's to show or hide; the
// control hints, each kind's panel from its first use on the pitch, a line
// clearing as its control is used, gone after the sixth, kept in the
// profile so a cleared line stays cleared and Show control hints again
// brings them back, the Sticky Keys line on Windows; and the turn prompt.

const ME = 'a'.repeat(32);
let dom: ReturnType<typeof installDom>;
beforeEach(() => {
  dom = installDom();
});
afterEach(() => dom.restore());

/** The page's devices as the layers find them: a touch control layer and the controls' uses. */
function pageDevicesFake(): LayerDevices & { use(k: InputKind, c: Control): void; touchDown(): void; mirror(on: boolean): void; readonly touch: TouchControls; watchers(): number } {
  const watchers: ((k: InputKind, c: Control) => void)[] = [];
  let mirrored = false;
  const touch = new TouchControls(dom.document.documentElement as unknown as HTMLElement, { mirrored: () => mirrored, edgeMarginPx: config.touchEdgeMarginCssPx, onFirstUse: () => {} });
  return {
    touch,
    mirror: (on) => {
      mirrored = on;
    },
    onUsed: (fn) => {
      watchers.push(fn);
      return () => watchers.splice(watchers.indexOf(fn), 1);
    },
    use: (k, c) => {
      for (const fn of [...watchers]) fn(k, c);
    },
    touchDown: () => {
      fake(dom.document.documentElement).dispatchEvent(Object.assign(new FakeEvent('pointerdown', { bubbles: true }), { pointerType: 'touch', pointerId: 1 }));
    },
    watchers: () => watchers.length,
  };
}

/** A pitch's host, a player's or a spectator's, on a profile the test may share between screens. */
function host(o: { player?: boolean; profile?: MemoryProfile } = {}): PitchHost {
  const match = new StateMatch(ME, stateWith(1, 100, [{ id: ME, pack: 0 }]));
  const h = testHost({ match, view: new FakeView([], match), stage: new FakeStage([]), controls: o.player === false ? null : new FakeControls([]) });
  return o.profile === undefined ? h : { ...h, profile: o.profile };
}

/** The layers for a host, their elements over a pitch screen's, as pitchScreen puts them. */
function screen(devices: LayerDevices | null, h: PitchHost, windows = false): { layers: Layer[]; el: FakeElement; by: (name: string) => Layer } {
  const el = fake(dom.document.createElement('section'));
  dom.document.body.append(el);
  const layers = deviceLayers(() => devices, { windows: () => windows }).map((f) => f(h));
  for (const l of layers) if (l.el !== null) el.append(fake(l.el));
  return { layers, el, by: (name) => layers.find((l) => l.name === name)! };
}

const hintsOf = (s: ReturnType<typeof screen>): HintsInspection => s.by('hints').inspect!() as HintsInspection;
const panel = (s: ReturnType<typeof screen>): FakeElement => only(s.el, '[data-test="hints"]');
const run = (s: ReturnType<typeof screen>): void => {
  for (const l of s.layers) l.run?.({} as never);
};

describe("the devices' layers (§1.63)", () => {
  it('are touch, the hints and the turn prompt, in that order, the page\'s found as each screen is made', () => {
    const d = pageDevicesFake();
    expect(screen(d, host()).layers.map((l) => l.name)).toEqual(['touch', 'hints', 'turn']);
    expect(LAYERS).toHaveLength(3);
  });

  it('make no touch layer, and hint nothing, without the page\'s devices', () => {
    const s = screen(null, host());
    expect(s.by('touch').el).toBeNull();
    expect(panel(s).hidden).toBe(true);
  });

  it("show no turn prompt where the page has no window, as in Node", () => {
    const s = screen(null, host());
    expect((s.by('turn').inspect!() as TurnInspection).shown).toBe(false);
  });
});

describe('the touch layer (D-29, §4.3)', () => {
  it("puts the page's control layer over the pitch, shown for a player once the page has had a touch", () => {
    const d = pageDevicesFake();
    const s = screen(d, host());
    const touch = s.by('touch');
    expect(touch.el).toBe(d.touch.el);
    expect(d.touch.el.hidden).toBe(true);
    d.touchDown();
    expect(d.touch.el.hidden).toBe(false);
    expect((touch.inspect!() as TouchInspection).shown).toBe(true);
  });

  it("follows Settings' mirrored layout at each frame", () => {
    const d = pageDevicesFake();
    d.touchDown();
    const s = screen(d, host());
    d.mirror(true);
    expect(d.touch.el.classList.contains('mirrored')).toBe(false);
    s.by('touch').frame!({} as never);
    expect(d.touch.el.classList.contains('mirrored')).toBe(true);
  });

  it('shows none to a spectator, who plays no controls', () => {
    const d = pageDevicesFake();
    d.touchDown();
    screen(d, host({ player: false }));
    expect(d.touch.el.hidden).toBe(true);
  });

  it("leaves the control layer to the newest screen: an older one going hides nothing, the newest's going hides it", () => {
    const d = pageDevicesFake();
    d.touchDown();
    const old = screen(d, host());
    const next = screen(d, host());
    expect(fake(d.touch.el).parentNode).toBe(next.el);
    old.by('touch').dispose!();
    expect(d.touch.el.hidden).toBe(false);
    next.by('touch').dispose!();
    expect(d.touch.el.hidden).toBe(true);
  });
});

describe('the control hints (D-29, L83, M4-Q28)', () => {
  it('show nothing until a kind is used on the pitch', () => {
    const d = pageDevicesFake();
    const s = screen(d, host());
    expect(panel(s).hidden).toBe(true);
    expect(hintsOf(s)).toMatchObject({ shown: null, lines: [] });
  });

  it("show a kind's six controls from its first use, that use's line cleared, each line clearing as used", () => {
    const d = pageDevicesFake();
    const s = screen(d, host());
    d.use('keyboard', 'run');
    expect(panel(s).hidden).toBe(false);
    expect(only(panel(s), 'h2').textContent).toBe('Keyboard controls');
    expect(hintsOf(s)).toMatchObject({ shown: 'keyboard', lines: ['zoomies', 'jump', 'pounce', 'bark', 'view'] });
    expect(panel(s).querySelectorAll('li').map((li) => shownText(li))).toEqual([
      'Shift: zoomies', 'Space: jump', 'E: pounce', 'Q: bark', 'C: switch view',
    ]);
    d.use('keyboard', 'bark');
    expect(hintsOf(s).lines).toEqual(['zoomies', 'jump', 'pounce', 'view']);
    for (const c of CONTROLS) d.use('keyboard', c);
    expect(panel(s).hidden).toBe(true);
    expect(hintsOf(s).shown).toBeNull();
  });

  it("keep each kind's record in the profile, so a cleared line stays cleared on the next screen and after a reload", () => {
    const d = pageDevicesFake();
    const profile = new MemoryProfile(ME);
    const first = screen(d, host({ profile }));
    d.use('touch', 'jump');
    d.use('touch', 'pounce');
    expect(profile.get().hints).toEqual({ keyboard: 0, touch: 0b1100, gamepad: 0 });
    first.by('hints').dispose!();
    const next = screen(d, host({ profile }));
    expect(panel(next).hidden).toBe(true);
    d.use('touch', 'run');
    expect(hintsOf(next)).toMatchObject({ shown: 'touch', lines: ['zoomies', 'bark', 'view'] });
  });

  it('show no panel for a kind that has used all six, whatever it does', () => {
    const d = pageDevicesFake();
    const profile = new MemoryProfile(ME);
    profile.value = { ...profile.value, hints: { keyboard: 0x3f, touch: 0, gamepad: 0 } };
    const s = screen(d, host({ profile }));
    d.use('keyboard', 'jump');
    expect(panel(s).hidden).toBe(true);
  });

  it('show the kind used last that has lines left', () => {
    const d = pageDevicesFake();
    const s = screen(d, host());
    d.use('keyboard', 'run');
    d.use('gamepad', 'jump');
    expect(hintsOf(s)).toMatchObject({ shown: 'gamepad', seen: ['keyboard', 'gamepad'] });
    expect(only(panel(s), 'h2').textContent).toBe('Gamepad controls');
    d.use('keyboard', 'view');
    expect(hintsOf(s).shown).toBe('keyboard');
    for (const c of CONTROLS) d.use('keyboard', c);
    expect(hintsOf(s)).toMatchObject({ shown: 'gamepad', lines: ['run', 'zoomies', 'pounce', 'bark', 'view'] });
  });

  it("come back after Settings' Show control hints again clears the profile, read again at the next run", () => {
    const d = pageDevicesFake();
    const profile = new MemoryProfile(ME);
    const s = screen(d, host({ profile }));
    for (const c of CONTROLS) d.use('keyboard', c);
    expect(panel(s).hidden).toBe(true);
    profile.value = { ...profile.value, hints: { keyboard: 0, touch: 0, gamepad: 0 } };
    run(s);
    expect(hintsOf(s)).toMatchObject({ shown: 'keyboard', lines: CONTROLS });
    d.use('keyboard', 'zoomies');
    expect(hintsOf(s).lines).toEqual(['run', 'jump', 'pounce', 'bark', 'view']);
    expect(profile.get().hints.keyboard).toBe(0b10);
  });

  it("say how to turn off the Sticky Keys shortcut on the keyboard's panel, on Windows only (C-52)", () => {
    const d = pageDevicesFake();
    const windows = screen(d, host(), true);
    d.use('keyboard', 'run');
    expect(only(panel(windows), '[data-test="hints-sticky"]').hidden).toBe(false);
    expect(hintsOf(windows).sticky).toBe(true);
    windows.layers.forEach((l) => l.dispose?.());
    d.use('gamepad', 'run');
    const elsewhere = screen(d, host(), false);
    d.use('keyboard', 'run');
    expect(only(panel(elsewhere), '[data-test="hints-sticky"]').hidden).toBe(true);
    const pad = screen(d, host(), true);
    d.use('gamepad', 'zoomies');
    expect(hintsOf(pad)).toMatchObject({ shown: 'gamepad', sticky: false });
    expect(only(panel(pad), '[data-test="hints-sticky"]').hidden).toBe(true);
  });

  it("hint nothing on a spectator's screen, which has no controls", () => {
    const d = pageDevicesFake();
    const s = screen(d, host({ player: false }));
    d.use('keyboard', 'run');
    expect(panel(s).hidden).toBe(true);
  });

  it('stop hearing the controls when the screen goes', () => {
    const d = pageDevicesFake();
    const s = screen(d, host());
    expect(d.watchers()).toBe(1);
    s.by('hints').dispose!();
    expect(d.watchers()).toBe(0);
  });
});

describe('Windows, for the Sticky Keys line (C-52)', () => {
  it("goes by the browser's platform where it reports one, else its user agent", () => {
    expect(onWindows({ userAgentData: { platform: 'Windows' }, userAgent: '' })).toBe(true);
    expect(onWindows({ userAgentData: { platform: 'macOS' }, userAgent: 'Windows' })).toBe(false);
    expect(onWindows({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(true);
    expect(onWindows({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe(false);
    expect(onWindows(undefined)).toBe(false);
  });
});

describe("the layers' places over the pitch (§4.3, §5.13, §5.14)", () => {
  const css = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8');
  const z = (file: string, selector: string): number => Number(cssDeclarations(css(file), selector)['z-index']);

  it("stacks the controls over Pre-match's panel and the bark marks, under the HUD and its Menu button, the hints over the controls", () => {
    const touch = z('../touch.css', '.touch');
    expect(touch).toBeGreaterThan(Math.max(z('../prematch.css', '.prematch'), z('../overlay.css', '.overlay-bark')));
    expect(touch).toBeLessThan(z('../hud.css', '.hud'));
    expect(z('../touch.css', '.hints')).toBeGreaterThan(touch);
    expect(z('../touch.css', '.hints')).toBeLessThan(z('../hud.css', '.hud'));
  });

  it('puts the turn prompt over your mark, the arrow and "Getting the pitch ready…", under the menu', () => {
    const turn = z('../touch.css', '.turn');
    expect(turn).toBeGreaterThan(Math.max(z('../overlay.css', '.overlay-mine'), z('../screens/pitch.css', '.pitch-preparing')));
    expect(turn).toBeLessThan(z('../screens/menu.css', '.match-menu'));
  });

  it("keeps the hints' heading clear of the sound's prompt and the HUD's graphics note while either shows (D-32, §4.7)", () => {
    const t = css('../touch.css');
    /** A one-line note's bottom, as index.html's body sets lines (16px/1.5): its top, line, padding and border. */
    const bottom = (d: Readonly<Record<string, string>>): number =>
      cssLength(d.top, 360) + cssLength(d['font-size'] ?? '16px', 360) * 1.5 + 2 * cssLength(d.padding!.split(' ')[0], 360) + 2 * cssLength(d.border!.split(' ')[0], 360);
    const prompt = cssDeclarations(css('./sound.css'), '.sound-prompt');
    const note = cssDeclarations(css('../hud.css'), '.hud-graphics');
    const hints = (selector: string): number => cssLength(cssDeclarations(t, selector).top, 360);
    expect(hints('.hints')).toBe(cssLength(prompt.top, 360)); // where the prompt is: moved only while it shows
    expect(hints('.pitch-screen:has(> .sound-prompt:not([hidden])) > .hints')).toBeGreaterThanOrEqual(bottom(prompt));
    expect(hints('.pitch-screen:has(.hud-graphics:not([hidden])) > .hints')).toBeGreaterThanOrEqual(bottom({ ...note, border: '1px' }));
    // The note's rule comes later, so it wins when both show.
    expect(t.indexOf('.pitch-screen:has(.hud-graphics')).toBeGreaterThan(t.indexOf('.pitch-screen:has(> .sound-prompt'));
  });

  it("ends Pre-match's panel above the touch buttons, and above the mirrored stick's area, while the controls show, at the gate's size and a phone's", () => {
    const t = css('../touch.css');
    const p = css('../prematch.css');
    const panel = cssDeclarations(p, '.prematch');
    const shown = cssDeclarations(p, '.pitch-screen:has(> .touch:not([hidden])) .prematch');
    const mirrored = cssDeclarations(p, '.pitch-screen:has(> .touch.mirrored:not([hidden])) .prematch');
    const buttons = cssDeclarations(t, '.touch-buttons');
    // The buttons' top, from the bottom: Jump's row, the gap, then Bark's.
    const rise = cssLength(buttons.bottom, 0) + cssLength(cssDeclarations(t, '.touch-jump').height, 0) + cssLength(buttons.gap, 0)
      + cssLength(cssDeclarations(t, '.touch-bark').height, 0);
    for (const [w, h] of [[640, 360], [667, 375], [915, 412], [1280, 720]] as const) {
      const top = cssLength(panel.top, h);
      expect(top + cssLength(shown['max-height'], h), `${w} × ${h}`).toBeLessThanOrEqual(h - rise);
      expect(top + cssLength(mirrored['max-height'], h), `${w} × ${h}, mirrored`).toBeLessThanOrEqual(h / 2);
      expect(top + cssLength(panel['max-height'], h), `${w} × ${h}, no touch`).toBeLessThanOrEqual(h);
    }
    // Inside the safe area, as the HUD is: each inset is 0 at the gate's sizes, and its own term on a phone.
    for (const side of ['top', 'right']) expect(panel[side]).toContain(`env(safe-area-inset-${side}, 0px)`);
    expect(cssLength('calc(50% - 64px - env(safe-area-inset-top, 0px))', 360)).toBe(116);
  });

  it("lays out the stick's area as stickArea() reads it, inside the safe area, and trades sides mirrored", () => {
    const t = css('../touch.css');
    expect(cssDeclarations(t, '.touch-stick')).toMatchObject({ top: '50%', bottom: '0', left: 'var(--touch-edge)', width: 'calc(50% - var(--touch-edge))' });
    expect(cssDeclarations(t, '.touch.mirrored .touch-stick')).toMatchObject({ left: 'auto', right: 'var(--touch-edge)' });
    expect(cssDeclarations(t, '.touch-buttons').right).toBe('var(--touch-edge)');
    expect(cssDeclarations(t, '.touch.mirrored .touch-buttons')).toMatchObject({ right: 'auto', left: 'var(--touch-edge)' });
    const inset = cssDeclarations(t, '.touch-safe').inset!;
    for (const side of ['top', 'right', 'bottom', 'left']) expect(inset).toContain(`env(safe-area-inset-${side}`);
    // Only the stick's area and the buttons take a pointer.
    expect(cssDeclarations(t, '.touch')['pointer-events']).toBe('none');
    expect(cssDeclarations(t, '.touch-stick')['pointer-events']).toBe('auto');
    expect(cssDeclarations(t, '.touch-button')['pointer-events']).toBe('auto');
  });
});
