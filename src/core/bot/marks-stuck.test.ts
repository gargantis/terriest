import { describe, expect, it } from 'vitest';
import type { TickInput } from '../sim/input';
import { defaultParams } from '../sim/params';
import { NOTHING, park, pitchDir, place, placedMatch } from '../sim/scenes';
import { ENDED, KICKOFF_COUNTDOWN, type MatchState, START_COUNTDOWN, type Terrier } from '../sim/state';
import { makeSim, step } from '../sim/step';
import { stuckWatch, watchStuck } from './marks';

// §16's never-stuck mark (Q-9; design §8.6) can fail: the watch every mark
// uses reports a terrier that holds a direction and stays within 0.5 m of
// where its streak began for 5 s, once, and nothing else. A watch that
// never fired would pass the empty goal's and the regulation marks' "never
// stuck" (M2's review).

const P = defaultParams;
const LIMIT = 5 * P.config.ticksPerSecond; // §16's "for 5 s"
const HELD = pitchDir(8); // +y, toward pack A's side wall from the centre line

/** 1 a side in play, pack A's terrier at (0, 13.5), a quarter metre off the +y side wall. */
function atTheWall(): { s: MatchState; T: Terrier } {
  const s = placedMatch(P, 1);
  park(P, s, 1);
  place(P, s, 0, 0, 13.5);
  return { s, T: s.terriers[0]! };
}

/** The watch over a state that doesn't move, the terrier holding `input`, for
 *  `ticks` ticks; `change` alters the state before each tick's watch. */
function still(input: number, ticks: number, change: (s: MatchState, T: Terrier, t: number) => void = () => {}): { stuck: string[]; longest: number } {
  const { s, T } = atTheWall();
  const w = stuckWatch([T.id]);
  for (let t = 1; t <= ticks; t++) {
    s.tick = t;
    change(s, T, t);
    watchStuck(w, s, [input], P);
  }
  return { stuck: w.stuck, longest: w.longest[0]! };
}

describe('the never-stuck watch (§16, Q-9)', () => {
  it('reports a terrier that holds a direction within 0.5 m for 5 s, once, at the 300th tick of its streak', () => {
    const { s, T } = atTheWall();
    expect(still(HELD, 2 * LIMIT)).toEqual({ stuck: [`${T.id} at tick ${LIMIT}`], longest: 2 * LIMIT });
    // Through the real step: it runs into the wall, 0.25 m, and stays there.
    const sim = makeSim(P, 1);
    const w = stuckWatch([T.id]);
    const inputs: TickInput[] = [{ id: T.id, input: HELD, events: 0 }];
    for (let t = 1; t <= LIMIT + 60; t++) {
      step(sim, s, inputs);
      watchStuck(w, s, [HELD], P);
    }
    expect(T.y).toBeGreaterThan(13.7);
    expect(w.stuck).toEqual([`${T.id} at tick ${LIMIT}`]);
  });

  it('starts a streak over when the terrier leaves its 0.5 m circle, but not for a drift within it', () => {
    expect(still(HELD, 2 * LIMIT, (_s, T, t) => { if (t === 100) T.x += 0.49; }).stuck).toHaveLength(1);
    const moved = still(HELD, 2 * LIMIT, (_s, T, t) => { if (t === 100) T.x += 0.51; });
    expect(moved.stuck.map((x) => x.replace(/^\w+ /, ''))).toEqual([`at tick ${99 + LIMIT}`]);
    // Through the real step: back and forth along the wall, a second each way.
    const { s, T } = atTheWall();
    const sim = makeSim(P, 1);
    const w = stuckWatch([T.id]);
    for (let t = 1; t <= 3 * LIMIT; t++) {
      const input = pitchDir(Math.floor((t - 1) / 60) % 2 === 0 ? 0 : 16);
      step(sim, s, [{ id: T.id, input, events: 0 }]);
      watchStuck(w, s, [input], P);
    }
    expect(w.stuck).toEqual([]);
    expect(w.longest[0]).toBeLessThan(60);
  });

  it("doesn't report a terrier that holds nothing, is tumbled, lunging or sitting, or waits in a countdown or the end", () => {
    const cases: [string, number, (s: MatchState, T: Terrier) => void][] = [
      ['holding nothing', NOTHING, () => {}],
      ['tumbled', HELD, (_s, T) => { T.tumble = 1; }],
      ['lunging', HELD, (_s, T) => { T.lunge = 1; }],
      ['sitting', HELD, (_s, T) => { T.sitting = true; }],
      ['in the start countdown', HELD, (s) => { s.phase = START_COUNTDOWN; }],
      ['in a kickoff countdown', HELD, (s) => { s.phase = KICKOFF_COUNTDOWN; }],
      ['ended', HELD, (s) => { s.phase = ENDED; }],
    ];
    for (const [what, input, change] of cases) expect(still(input, 2 * LIMIT, change), what).toEqual({ stuck: [], longest: 0 });
    // A streak broken a tick before the mark starts over.
    const broken = still(HELD, 3 * LIMIT, (_s, T, t) => { T.tumble = t % (LIMIT - 1) === 0 ? 1 : 0; });
    expect(broken.stuck).toEqual([]);
    expect(broken.longest).toBe(LIMIT - 2);
  });
});
