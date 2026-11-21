import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { Fingers, path, touchPoints } from './touch';

// The specs' touches (M4's design §1.62): CDP's touch events as Fingers
// sends them, each start and move listing every finger down, so two thumbs
// hold two controls at once; a finger lifts only as the last one down, by an
// empty end, since Chromium lifts none of several alone, and liftAll lifts
// them together.

/** A page whose CDP session records what it's sent. */
function page(): { page: Page; sent: { type: string; ids: number[]; at: [number, number][] }[] } {
  const sent: { type: string; ids: number[]; at: [number, number][] }[] = [];
  const cdp = {
    send: async (method: string, params: { type: string; touchPoints: { id: number; x: number; y: number }[] }) => {
      expect(method).toBe('Input.dispatchTouchEvent');
      sent.push({ type: params.type, ids: params.touchPoints.map((p) => p.id), at: params.touchPoints.map((p) => [p.x, p.y]) });
    },
    detach: async () => {},
  };
  return { page: { context: () => ({ newCDPSession: async () => cdp }) } as unknown as Page, sent };
}

describe('CDP touches (§1.62)', () => {
  it('lists every finger down, in the order they went down, as a thumb\'s contact', () => {
    const points = touchPoints(new Map([[2, { x: 10, y: 20 }], [5, { x: 30, y: 40 }]]));
    expect(points).toEqual([
      { x: 10, y: 20, id: 2, radiusX: 8, radiusY: 8, force: 1 },
      { x: 30, y: 40, id: 5, radiusX: 8, radiusY: 8, force: 1 },
    ]);
  });

  it('moves in even steps, the last at the end', () => {
    expect(path({ x: 0, y: 0 }, { x: 30, y: -60 }, 3)).toEqual([{ x: 10, y: -20 }, { x: 20, y: -40 }, { x: 30, y: -60 }]);
    expect(path({ x: 5, y: 5 }, { x: 6, y: 7 }, 0)).toEqual([{ x: 6, y: 7 }]);
  });

  it('holds two fingers at once, refuses to lift one while the other stays, and lifts both together', async () => {
    const p = page();
    const f = await Fingers.on(p.page);
    const stick = await f.press({ x: 100, y: 300 });
    const jump = await f.press({ x: 580, y: 300 });
    await f.move(stick, { x: 100, y: 240 }, 2);
    // A move without a finger lifts nothing in Chromium, so lift() never sends one.
    await expect(f.lift(jump)).rejects.toThrow(/can't lift alone while 1 more/);
    await f.liftAll();
    expect(p.sent).toEqual([
      { type: 'touchStart', ids: [stick], at: [[100, 300]] },
      { type: 'touchStart', ids: [stick, jump], at: [[100, 300], [580, 300]] },
      { type: 'touchMove', ids: [stick, jump], at: [[100, 270], [580, 300]] },
      { type: 'touchMove', ids: [stick, jump], at: [[100, 240], [580, 300]] },
      { type: 'touchEnd', ids: [], at: [] },
    ]);
    await expect(f.lift(stick)).rejects.toThrow(/no finger/);
  });

  it('lifts the last finger down by an empty end, as one slides off its button', async () => {
    const p = page();
    const f = await Fingers.on(p.page);
    const jump = await f.press({ x: 580, y: 300 });
    await f.move(jump, { x: 500, y: 200 });
    await f.lift(jump);
    expect(p.sent).toEqual([
      { type: 'touchStart', ids: [jump], at: [[580, 300]] },
      { type: 'touchMove', ids: [jump], at: [[500, 200]] },
      { type: 'touchEnd', ids: [], at: [] },
    ]);
  });

  it('taps, and lifts every finger at once', async () => {
    const p = page();
    const f = await Fingers.on(p.page);
    await f.tap({ x: 1, y: 2 });
    await f.press({ x: 3, y: 4 });
    await f.press({ x: 5, y: 6 });
    await f.liftAll();
    await f.liftAll();
    expect(p.sent.map((e) => e.type)).toEqual(['touchStart', 'touchEnd', 'touchStart', 'touchStart', 'touchEnd']);
  });
});
