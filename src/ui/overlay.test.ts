import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { personId } from '../core/bot/bot-id';
import type { DrawerFrame, TerrierFrame } from '../render/drawer';
import type { FrameOut, StageFrame } from '../render/frame';
import { cssDeclarations, fake, installDom, only } from './dom-testing';
import type { OverlayInspection } from './inspect';
import type { PitchContext } from './layer';
import { edgePoint, overlayLayer } from './overlay';
import { type Calls, FakeControls, FakeStage, FakeView, StateMatch, stateWith, testHost } from './pitch-testing';

// The marks over the pitch (M4's design §1.45, §2.5, §3.3, §9.2; D-28; L50,
// L52, L90), by the stage's ScreenPoint conventions: your terrier's mark
// over its drawn centre while it's in view; the off-screen ball's arrow on
// the canvas's edge, inset, turned the ball's way, clockwise from the right
// with y down as CSS's rotate() turns; a bark mark over each terrier the
// drawer input shows barking; each bark and each goal's celebration
// counted once into the app's log; and the marks on top of the HUD and
// Pre-match's panel, so neither hides them.

const ME = personId(7, 0);
const BOT = `${'b'.repeat(4)}${'0'.repeat(28)}`;

describe("the marks' place among the pitch screen's layers (§2.6, M4-Q10, L52, L90)", () => {
  const css = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8');
  const z = (file: string, selector: string): number => Number(cssDeclarations(css(file), selector)['z-index']);

  it("stay on top of the HUD and Pre-match's panel, both opaque, and under the menu and the pitch's preparing message", () => {
    const overlay = z('./overlay.css', '.overlay');
    // One stacking context: the pitch screen makes none of its own, so the layers' z-indexes compare.
    expect(cssDeclarations(css('./screens/pitch.css'), '.pitch-screen')['z-index']).toBeUndefined();
    expect(overlay).toBeGreaterThan(z('./hud.css', '.hud'));
    expect(overlay).toBeGreaterThan(z('./screens/pitch.css', '.prematch'));
    expect(overlay).toBeLessThan(z('./screens/menu.css', '.match-menu'));
    expect(overlay).toBeLessThan(z('./screens/pitch.css', '.pitch-preparing'));
    // Taking no pointer, so the HUD's and the panel's buttons under them still work.
    expect(cssDeclarations(css('./overlay.css'), '.overlay')['pointer-events']).toBe('none');
  });
});

describe('edgePoint (D-28)', () => {
  const W = 640;
  const H = 360;
  const I = 30;
  it('puts the arrow on the edge of the rectangle inset inside the canvas, along the way from its centre', () => {
    const close = (p: { x: number; y: number }, x: number, y: number): void => {
      expect(p.x).toBeCloseTo(x, 9);
      expect(p.y).toBeCloseTo(y, 9);
    };
    close(edgePoint(0, W, H, I), W - I, H / 2); // right
    close(edgePoint(Math.PI / 2, W, H, I), W / 2, H - I); // down: y grows downward
    close(edgePoint(Math.PI, W, H, I), I, H / 2); // left
    close(edgePoint(-Math.PI / 2, W, H, I), W / 2, I); // up
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * 2 * Math.PI - Math.PI;
      const p = edgePoint(a, W, H, I);
      const onSide = Math.abs(p.x - I) < 1e-9 || Math.abs(p.x - (W - I)) < 1e-9 || Math.abs(p.y - I) < 1e-9 || Math.abs(p.y - (H - I)) < 1e-9;
      expect(onSide, `${a}`).toBe(true);
      expect(p.x >= I - 1e-9 && p.x <= W - I + 1e-9 && p.y >= I - 1e-9 && p.y <= H - I + 1e-9, `${a}`).toBe(true);
      expect(Math.atan2(p.y - H / 2, p.x - W / 2)).toBeCloseTo(a, 9);
    }
  });
});

describe('the overlay layer', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installDom().restore;
  });
  afterEach(() => {
    restore();
  });

  const terrier = (id: string, bark: number | null, celebrate: number | null): TerrierFrame =>
    ({ id, bark: bark === null ? null : { start: bark, weight: 1 }, celebrate: celebrate === null ? null : { start: celebrate, weight: 1 } }) as unknown as TerrierFrame;

  function overlay(): { layer: ReturnType<typeof overlayLayer>; host: ReturnType<typeof testHost>; ctx: (ts: TerrierFrame[], out: FrameOut | null) => PitchContext } {
    const calls: Calls = [];
    const match = new StateMatch(ME, stateWith(1, 100, [{ id: ME, pack: 0 }, { id: BOT, pack: 1 }]));
    const view = new FakeView(calls, match);
    const host = testHost({ match, view, stage: new FakeStage(calls), controls: new FakeControls(calls) });
    const layer = overlayLayer(host);
    const ctx = (ts: TerrierFrame[], out: FrameOut | null): PitchContext => {
      const drawer: DrawerFrame = { time: 100, tick: 99, fraction: 1, terriers: ts };
      const frame = { match: null, drawer, camera: null, nowMs: 0, dtMs: 0, fadeTo: null } as unknown as StageFrame;
      return { match, drawn: null, out, frame, nowMs: 0, mode: view.mode, settings: host.settings.get(), graphics: 'ok', barks: [] };
    };
    return { layer, host, ctx };
  }
  const out = (ball: { x: number; y: number; inView: boolean; angle: number }, mine: boolean, bot: boolean): FrameOut => ({
    ball, yaw: 0, cssWidth: 640, cssHeight: 360,
    terriers: [{ id: ME, x: 100, y: 200, inView: mine, angle: 0 }, { id: BOT, x: 400, y: 150, inView: bot, angle: 0 }],
  });

  it('marks your terrier over its drawn centre while it is in view, and hides the arrow while the ball is', () => {
    const { layer, ctx } = overlay();
    const el = layer.el!;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    layer.frame!(ctx([terrier(ME, null, null), terrier(BOT, null, null)], out({ x: 320, y: 180, inView: true, angle: 0 }, true, true)));
    const mine = only(el, '.overlay-mine');
    expect(mine.hidden).toBe(false);
    expect(mine.style['transform']).toBe('translate(100.0px, 166.0px)');
    expect(only(el, '.overlay-arrow').hidden).toBe(true);
    expect(layer.inspect!()).toEqual({ mine: { shown: true, x: 100, y: 200 }, names: [], barks: [], away: [], arrow: { shown: false, angle: 0 } } satisfies OverlayInspection);
    layer.frame!(ctx([], out({ x: 320, y: 180, inView: true, angle: 0 }, false, true)));
    expect(mine.hidden).toBe(true);
  });

  it("puts the arrow on the canvas's edge, turned the ball's way, while the ball is out of view (L90)", () => {
    const { layer, ctx } = overlay();
    const angle = 2.5;
    layer.frame!(ctx([], out({ x: 0, y: 360, inView: false, angle }, true, true)));
    const arrow = only(layer.el!, '.overlay-arrow');
    const at = edgePoint(angle, 640, 360, 30);
    expect(arrow.hidden).toBe(false);
    expect(arrow.style['transform']).toBe(`translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) rotate(2.500rad)`);
    expect((layer.inspect!() as OverlayInspection).arrow).toEqual({ shown: true, angle });
  });

  it('marks each terrier the drawer shows barking, counting each bark and each celebration once (L50, §2.5)', () => {
    const { layer, host, ctx } = overlay();
    const seen = (): string[] => host.announced.map((a) => a.kind);
    const o = out({ x: 320, y: 180, inView: true, angle: 0 }, true, false);
    layer.frame!(ctx([terrier(ME, 99.5, null), terrier(BOT, 97, null)], o));
    layer.frame!(ctx([terrier(ME, 99.5, null), terrier(BOT, 97, null)], o)); // the same barks, still drawing
    expect(seen()).toEqual(['bark', 'bark']); // the bot's is counted though its mark is out of view
    expect((layer.inspect!() as OverlayInspection).barks).toEqual([ME]);
    const marks = fake(layer.el).querySelectorAll('.overlay-bark');
    expect(marks.filter((m) => !m.hidden)).toHaveLength(1);
    expect(marks.find((m) => !m.hidden)!.style['transform']).toBe('translate(100.0px, 144.0px)');
    layer.frame!(ctx([terrier(ME, null, 900), terrier(BOT, 140, 900)], out({ x: 320, y: 180, inView: true, angle: 0 }, true, true)));
    expect(seen()).toEqual(['bark', 'bark', 'celebration', 'bark']); // one celebration for the goal; the bot's next bark
    expect((layer.inspect!() as OverlayInspection).barks).toEqual([BOT]);
    layer.frame!(ctx([terrier(ME, null, 900)], null)); // nothing drawn: every mark hidden
    expect(fake(layer.el).querySelectorAll('.overlay-mark').every((m) => m.hidden)).toBe(true);
    expect(seen()).toHaveLength(4);
  });
});
