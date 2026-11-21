// §16's end-to-end setups' scripts (M3's design §1.12, §7.2): the inputs a
// scripted person holds, and the samplers the #test=net page, the loopback's
// replays of the setups and the load run drive a page's own terrier with.
// Moved out of marks.ts, whose matches run the same code, so the page
// imports neither the marks nor their size. From M4, the specs' scripts
// too, which the Node replays of the screens' setups play (M4's design
// §9.1, §9.2). Exact operations and arrays only, as all of src/core/bot
// (D-39).

import { encodeInput, FRAME_BALL, jumpCount, pounceCount } from '../sim/input';
import type { SimParams } from '../sim/params';
import { IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, START_COUNTDOWN } from '../sim/state';
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

// M4's specs (M4's design, research/m4/DESIGN.md, §9.1, M4-Q36): a spec
// plays through the real page's keys at its polls of the hook, so it presses
// a setup's direction in each countdown, where a direction only turns the
// terrier on its spot (L118, D-8), and lets it go at the first poll that
// shows a second of play, which the poll and an evaluate make e ticks late;
// its only other presses go where D-10 drops them. These replay that in
// Node over the latitudes a page leaves: where in the countdown the hold
// begins, and e.

/** Where in each countdown a spec's hold begins: the ticks into it, given its length. */
export type HoldFrom = (countdownTicks: number) => number;

/** What one of M4's specs presses (M4's design §9.1). */
export interface SpecScript {
  /** A direction pressed at the first sample whose head shows a countdown, the start's or a kickoff's,
   *  `from(n)` ticks into it, n its length (at its first tick if `from` is absent), and let go at the
   *  first that shows a second of play and `late(k)` ticks more, k the countdown's number, the start's
   *  0 and each kickoff's one more. Held in between whatever the phase, as a key the spec hasn't let go
   *  of yet: through a goal that comes sooner, to the next play's release. */
  readonly hold?: { readonly input: number; readonly late: (kickoff: number) => number; readonly from?: HoldFrom };
  /** Jump presses, one a sample at most, at the first samples at or past these ticks into the start
   *  countdown that show at least a second of it left, where D-10 drops them and the counter still
   *  moves (M4's design §4.6, §9.4). */
  readonly jumps?: readonly number[];
}

/** The page's own input on one of M4's specs, sampled once a sent tick on the timeline's head as it
 *  stands then, its press counters starting from base's (D-10). Throws on a press that couldn't leave
 *  a second of the start countdown. */
export function specSampler(script: SpecScript, base: number, P: SimParams): (head: Readonly<MatchState>) => number {
  const second = HOLD_SECONDS * P.config.ticksPerSecond;
  const hold = script.hold;
  const jumps = script.jumps ?? [];
  for (const at of jumps) {
    if (!(at >= 0 && at <= P.startCountdownTicks - second)) {
      throw new Error(`a jump ${at} ticks into the start countdown leaves less than a second of it (M4's design §9.1)`);
    }
  }
  let down = false;
  let kickoff = -1; // the countdowns seen, less one
  let countdown = -1; // the last one's first tick
  let pressed = 0;
  return (s) => {
    const into = s.tick - s.phaseStart;
    const start = s.phase === START_COUNTDOWN;
    if (start || s.phase === KICKOFF_COUNTDOWN) {
      if (s.phaseStart !== countdown) {
        countdown = s.phaseStart;
        kickoff++;
      }
      const from = hold?.from?.(start ? P.startCountdownTicks : P.kickoffCountdownTicks) ?? 0;
      if (hold !== undefined && into >= from) down = true;
    } else if (down && s.phase === IN_PLAY && into >= second + hold!.late(kickoff)) {
      down = false;
    }
    if (start && pressed < jumps.length && into >= jumps[pressed]! && P.startCountdownTicks - into >= second) pressed++;
    return (down ? hold!.input : 0) | encodeInput({ jump: jumpCount(base) + pressed, pounce: pounceCount(base) });
  };
}
