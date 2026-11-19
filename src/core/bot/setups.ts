// §16's end-to-end setups' scripts (M3's design §1.12, §7.2): the inputs a
// scripted person holds, and the samplers the #test=net page, the loopback's
// replays of the setups and the load run drive a page's own terrier with.
// Moved out of marks.ts, whose matches run the same code, so the page
// imports neither the marks nor their size. Exact operations and arrays
// only, as all of src/core/bot (D-39).

import { encodeInput, FRAME_BALL, jumpCount, pounceCount } from '../sim/input';
import type { SimParams } from '../sim/params';
import { IN_PLAY, type MatchState } from '../sim/state';
import { type BotParams, newBrain, think } from './brain';

const HOLD_SECONDS = 1; // not a setting: §16's end-to-end setups, "the first second after each kickoff"
const BACK = 16; // not a setting: A.2's step, back along the ball line
const SIDEWAYS = 8; // not a setting: A.2's step, sideways from the ball line

/** A.2 inputs of §16's setups: back, and sideways, in ball view. */
export const BACK_IN_BALL_VIEW = encodeInput({ step: BACK, frame: FRAME_BALL });
export const SIDEWAYS_IN_BALL_VIEW = encodeInput({ step: SIDEWAYS, frame: FRAME_BALL });

/** A person's u16 (design §8.6, M2): `held` for the first second of play
 *  after each kickoff, then nothing, present every tick (§16). */
export function heldFirstSecond(held: number, P: SimParams): (s: Readonly<MatchState>) => number {
  return (s) => (s.phase === IN_PLAY && s.tick - s.phaseStart < HOLD_SECONDS * P.config.ticksPerSecond ? held : 0);
}

/** The page's own input (design §7.2): none; back, the three-engine
 *  setup's pack A person; sideways, the Practice setup's; or the brain. */
export type ScriptName = 'none' | 'back' | 'sideways' | 'brain';

/** The page's own input for a script, sampled once a sent tick on the
 *  timeline's head as it stands then, headTick with it. Its press counters
 *  start from base, the terrier's stored previous input (D-10), so its first
 *  input presses nothing: a person's scripts hold base's counters, and
 *  'brain' starts its brain from base and thinks once per head tick, as a
 *  hosted bot does (design §1.11), so a catch-up's ticks and a held head
 *  neither press twice nor shorten its reaction. */
export function scriptSampler(name: ScriptName, me: string, base: number, P: SimParams, B: BotParams): (head: Readonly<MatchState>, headTick: number) => number {
  if (name === 'brain') {
    const brain = newBrain(me, base, P, B);
    let thought = -1; // the head tick it last thought on: none yet
    let input = 0;
    return (head, headTick) => {
      if (headTick !== thought) {
        input = think(brain, head);
        thought = headTick;
      }
      return input;
    };
  }
  const counters = encodeInput({ jump: jumpCount(base), pounce: pounceCount(base) });
  if (name === 'none') return () => counters;
  const person = heldFirstSecond(name === 'back' ? BACK_IN_BALL_VIEW : SIDEWAYS_IN_BALL_VIEW, P);
  return (head) => person(head) | counters;
}
