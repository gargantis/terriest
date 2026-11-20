// The barks' types (M4's design, research/m4/DESIGN.md, §1.36, §2.5; PLAN
// D-16, L98, L209), which the drawing, the sound and the bark tracker meet
// at. A bark is never in the state: a remote terrier's is found in the
// inputs received for it, never predicted ones, a hosted bot's in the
// inputs recorded for it, and this viewer's own at the press. M4's
// src/core/session/barks.ts finds them as BarkEvents from a BarkTimeline,
// which src/core/timeline/timeline.ts's Timeline satisfies by its shape.
// New at M4. Types only.

import type { MatchState } from '../sim/index';

/** A bark: whose terrier, and the tick of the input that carried it. */
export interface BarkEvent {
  readonly id: string;
  readonly tick: number;
  /** This viewer's own, at the press. */
  readonly own: boolean;
}

/** What the bark tracker reads of a timeline. */
export interface BarkTimeline {
  /** The input received or recorded for a sender at tick t, if any. */
  receivedInput(id: string, t: number): number | undefined;
  newestInput(id: string): { readonly tick: number; readonly input: number } | undefined;
  readonly head: Readonly<MatchState>;
}
