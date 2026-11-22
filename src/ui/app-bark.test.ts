import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCodeDrawer } from '../render/drawers/code';
import { type AppRig, appRig, ME } from './app-testing';
import { type FakeDocument, type FakeElement, installDom, only } from './dom-testing';
import type { Inspection } from './inspect';

// A bark in each of two Practices on one stage, through the real App and
// the real code-built drawer (M4's design §1.2, §9.1's latched counts):
// the page keeps one stage, and the stage one drawer, for its life
// (src/render/scene.ts), while every Practice's ticks count from 0, so
// e2e/practice.spec.ts's Practice after its reload and its hints-again
// Practice can press Q at the same local tick, the person's bark then
// starting at the same drawn tick in both. Each bark is acted, its hint's
// use told and its mark counted in its match's log, and the drawer counts
// it as it starts showing, the second though the first started at the
// same tick.

let dom: { readonly document: FakeDocument; restore(): void };
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  dom.restore();
});

const settle = async (): Promise<void> => {
  for (let k = 0; k < 5; k++) await Promise.resolve();
};
const look = (r: AppRig): Inspection => r.test.inspect!();
const screenEl = (r: AppRig): FakeElement => only(r.root, '[id="screen"]');
const button = (r: AppRig, test: string): FakeElement => only(screenEl(r), `button[data-test="${test}"]`);

/** Virtual time a millisecond at a time, an animation frame every 16 ms, until cond, at most ms. */
function playUntil(r: AppRig, cond: () => boolean, ms: number): void {
  for (let t = 1; t <= ms && !cond(); t++) {
    r.clock.advance(1);
    if (t % 16 === 0) r.frames.run();
  }
  if (!cond()) throw new Error(`not reached within ${ms} ms of virtual time`);
}

interface Barked {
  /** The person's bark's start, as the stage was handed it. */
  readonly start: number | undefined;
  /** Every terrier the stage was handed barking, from the press to a second after it. */
  readonly barkers: readonly string[];
  readonly before: Inspection;
  readonly after: Inspection;
}

/** Home's Practice, 1 a side for 1 minute, Start; Q pressed once the person is in the final roster at
 *  local tick `at`; then a second of frames. The hook before the press and after those frames. */
async function barkIn(r: AppRig, at: number): Promise<Barked> {
  button(r, 'practice').click();
  only(screenEl(r), 'select[data-test="pack-size"]').value = '1';
  only(screenEl(r), 'select[data-test="match-length"]').value = '1';
  button(r, 'start').click();
  await settle();
  playUntil(r, () => look(r).match!.inRoster && look(r).match!.localTick >= at, 2000);
  const before = look(r);
  const from = r.stages[0]!.drawn.length;
  r.device.bark = true;
  playUntil(r, () => look(r).controls!.presses.bark === 1, 100);
  playUntil(r, () => look(r).match!.localTick >= at + 60, 2000);
  const barking = r.stages[0]!.drawn.slice(from).flatMap((f) => f?.drawer?.terriers ?? []).filter((t) => t.bark !== null);
  return { start: barking.find((t) => t.id === ME)?.bark?.start, barkers: [...new Set(barking.map((t) => t.id))], before, after: look(r) };
}

describe("a bark in another Practice on the page's stage (§9.1, e2e/practice.spec.ts's hints again)", () => {
  it("is counted by the drawer as it starts showing, though the last Practice's started at the same tick", async () => {
    const r = appRig({ doc: dom.document, drawer: createCodeDrawer });
    await r.app.start();
    r.frames.run();
    r.clock.advance(0);
    await r.stages[0]!.finish();
    await settle();
    const first = await barkIn(r, 18);
    button(r, 'prematch-leave').click();
    expect(look(r).screen).toBe('home');
    const second = await barkIn(r, 18);
    // The same person's bark at the same drawn start, each Practice's ticks counting from 0, on one stage.
    expect(r.stages.length).toBe(1);
    expect(first.start).toBeTypeOf('number');
    expect(second.start).toBe(first.start);
    // Each bark acted, its hint's use told, and its mark counted in its match's log; no other terrier barking.
    expect(r.used).toEqual(['keyboard bark', 'keyboard bark']);
    for (const b of [first, second]) {
      expect(b.after.controls!.presses.bark).toBe(1);
      expect(b.after.announcements!.barksShown).toBeGreaterThan(b.before.announcements!.barksShown);
      expect(b.barkers).toEqual([ME]);
    }
    // And the drawer's count of it in each, once: what the spec's `barked` waits for.
    expect(first.after.render.drawer!.overlaysShown.barking).toBe(first.before.render.drawer!.overlaysShown.barking + 1);
    expect(second.after.render.drawer!.overlaysShown.barking).toBe(second.before.render.drawer!.overlaysShown.barking + 1);
  });
});
