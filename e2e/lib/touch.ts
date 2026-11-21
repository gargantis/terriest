// Touches for the specs (M4's design, research/m4/DESIGN.md, §1.62, §9.3's
// touch.spec.ts; PLAN D-29): fingers put down, moved and lifted through
// CDP's Input.dispatchTouchEvent, so several can be down at once, as two
// thumbs are, which Playwright's own touchscreen, a tap at a time, can't.
// Chromium only, the touch spec's engine, in a context made with hasTouch;
// the page sees each finger as a pointer of type touch. Each event lists
// every finger still down, as CDP takes them: a finger left out of a move
// is lifted, and the last one lifts with an empty end. New at M4.

import type { CDPSession, Page } from '@playwright/test';

export interface Point { readonly x: number; readonly y: number }

/** A finger as CDP's Input.TouchPoint gives it. */
export interface TouchPoint { readonly x: number; readonly y: number; readonly id: number; readonly radiusX: number; readonly radiusY: number; readonly force: number }

/** A thumb's contact, in CSS px. */
const CONTACT_RADIUS_PX = 8;

/** The touch points CDP takes for the fingers down, every one of them, in the order they went down. */
export function touchPoints(fingers: ReadonlyMap<number, Point>): TouchPoint[] {
  return [...fingers].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: CONTACT_RADIUS_PX, radiusY: CONTACT_RADIUS_PX, force: 1 }));
}

/** The steps from one point to another, `steps` of them, the last at `to`. */
export function path(from: Point, to: Point, steps: number): Point[] {
  const n = Math.max(1, Math.round(steps));
  return Array.from({ length: n }, (_, k) => ({ x: from.x + ((to.x - from.x) * (k + 1)) / n, y: from.y + ((to.y - from.y) * (k + 1)) / n }));
}

/** The page's touchscreen, by CDP: fingers down, moved and lifted, several at once. */
export class Fingers {
  private readonly cdp: CDPSession;
  private readonly down = new Map<number, Point>();
  private nextId = 1;

  private constructor(cdp: CDPSession) {
    this.cdp = cdp;
  }

  /** The touchscreen of a Chromium page, in a context made with hasTouch. */
  static async on(page: Page): Promise<Fingers> {
    return new Fingers(await page.context().newCDPSession(page));
  }

  /** A new finger down at `at`, held: its id for move() and up(). */
  async press(at: Point): Promise<number> {
    const id = this.nextId++;
    this.down.set(id, at);
    await this.send('touchStart');
    return id;
  }

  /** A finger moved to `to` in `steps` moves, each an event. */
  async move(id: number, to: Point, steps = 1): Promise<void> {
    const from = this.at(id);
    for (const p of path(from, to, steps)) {
      this.down.set(id, p);
      await this.send('touchMove');
    }
  }

  /** A finger lifted: the others stay down. */
  async lift(id: number): Promise<void> {
    this.at(id);
    this.down.delete(id);
    await this.send(this.down.size === 0 ? 'touchEnd' : 'touchMove');
  }

  /** A tap: down and up again. */
  async tap(at: Point): Promise<void> {
    await this.lift(await this.press(at));
  }

  /** Every finger lifted. */
  async liftAll(): Promise<void> {
    if (this.down.size === 0) return;
    this.down.clear();
    await this.send('touchEnd');
  }

  /** Where a finger is now. */
  at(id: number): Point {
    const p = this.down.get(id);
    if (p === undefined) throw new Error(`no finger ${id} is down`);
    return p;
  }

  async detach(): Promise<void> {
    await this.cdp.detach();
  }

  private async send(type: 'touchStart' | 'touchMove' | 'touchEnd'): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : touchPoints(this.down) });
  }
}

/** An element's box, by its data-test name: the control layer's parts are touch, touch-stick,
 *  touch-jump, touch-pounce, touch-bark and touch-view (src/input/touch.ts). */
export async function boxOf(page: Page, test: string): Promise<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }> {
  const box = await page.locator(`[data-test="${test}"]`).boundingBox();
  if (box === null) throw new Error(`[data-test="${test}"] isn't shown`);
  return box;
}

/** A point `fx` and `fy` of the way across an element's box: its centre by default. */
export async function pointIn(page: Page, test: string, fx = 0.5, fy = 0.5): Promise<Point> {
  const b = await boxOf(page, test);
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}
