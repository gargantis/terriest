// The barks (PLAN D-16, L98, L209, L327; M4's design, research/m4/DESIGN.md,
// §1.36, §2.5, M4-Q24): never in the state, so found in the inputs a
// timeline holds. A terrier barks at tick t when the inputs received for t
// and t − 1 are both known and their bark counts differ, never from a
// predicted input. The first input after a gap has no t − 1, so it only
// sets the baseline: a reload, a return or a join never barks, though its
// counter starts again at 0 (D-10's rebase). A host's own bots are found the
// same way, in the inputs it recorded for them; this viewer's own bark is
// the press's (pressed), so its own inputs are never read for one, and
// update() returns only the others'.
// Each pair is decided once, when both its inputs are known, so a hole that
// a later TICK's history fills, or a TICK that arrives out of order, is
// decided at the next look, and none is reported twice.
// A sender's inputs held when it's first seen, or after a reset for another
// timeline, only set the baseline, so nothing from an adopted state plays,
// as the sound's cues reset (§7); and a pair is looked at only while its
// tick is within a bark gap of its sender's newest input, the gap in which
// an honest sender barks once (L327): a page whose timer ran late still
// finds the bark, and one back from a hidden spell finds no backlog.
// latest() is each terrier's latest bark tick, the drawer's bark start
// (D-27); update()'s events are the sound's (§7). BarkTracker satisfies
// src/render/view.ts's BarkSource by its shape, since src/core imports
// nothing from src/render. New at M4. Three-free and pure.

import { derived } from '../../config';
import { barkCount } from '../sim/input';
import type { BarkEvent, BarkTimeline } from './bark-types';

/** What the tracker has seen of one sender's inputs. */
interface Sender {
  /** Its newest input's tick at the last look: the ticks after it are new. */
  newest: number;
  /** Ticks t at or before newest whose pair, t − 1 and t, had an input unknown then, ascending: looked at
   *  again while t is within the bark gap of the sender's newest. */
  open: number[];
}

/** D-16's barks: a bark at tick t for a sender when the inputs received for t and t − 1 are both known
 *  and their bark counts differ; the first input after a gap only sets the baseline (M4-Q24). */
export class BarkTracker {
  private readonly me: string;
  private readonly senders = new Map<string, Sender>();
  private readonly latestTick = new Map<string, number>();

  constructor(me: string) {
    this.me = me;
  }

  /** After each timer run: the barks newly found in the inputs received or recorded for the head's
   *  terriers but this viewer's, in tick order. */
  update(t: BarkTimeline): BarkEvent[] {
    const found: BarkEvent[] = [];
    const gap = derived.barkGapTicks;
    for (const T of t.head.terriers) {
      const id = T.id;
      if (id === this.me) continue;
      const newest = t.newestInput(id)?.tick;
      if (newest === undefined) continue;
      const s = this.senders.get(id);
      // First seen, or its ticks running back, another timeline's: the inputs held already, an adopted
      // state's among them, only set the baseline, so nothing from before plays (§7).
      if (s === undefined || newest < s.newest) {
        this.senders.set(id, { newest, open: [] });
        continue;
      }
      // Nothing new from it and no hole to look at again. A hole is looked at every time: one can fill
      // with no newer input, an older TICK arriving late.
      if (newest === s.newest && s.open.length === 0) continue;
      const from = Math.max(1, newest - gap);
      const open: number[] = [];
      const decide = (k: number): void => {
        const a = t.receivedInput(id, k - 1);
        const b = t.receivedInput(id, k);
        if (a === undefined || b === undefined) {
          open.push(k);
        } else if (barkCount(a) !== barkCount(b)) {
          found.push({ id, tick: k, own: false });
          this.raise(id, k);
        }
      };
      for (const k of s.open) if (k >= from) decide(k);
      for (let k = Math.max(s.newest + 1, from); k <= newest; k++) decide(k);
      s.open = open;
      s.newest = newest;
    }
    // Stable: a tick's barks stay in the head's order.
    found.sort((x, y) => x.tick - y.tick);
    return found;
  }

  /** Your own, at the press. */
  pressed(id: string, tick: number): void {
    this.raise(id, tick);
  }

  /** The latest bark's tick, found or pressed: the drawer's bark start. */
  latest(id: string): number | null {
    return this.latestTick.get(id) ?? null;
  }

  /** Another timeline: nothing seen is kept. */
  reset(): void {
    this.senders.clear();
    this.latestTick.clear();
  }

  private raise(id: string, tick: number): void {
    const had = this.latestTick.get(id);
    if (had === undefined || tick > had) this.latestTick.set(id, tick);
  }
}
