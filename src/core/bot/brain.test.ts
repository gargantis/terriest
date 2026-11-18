import { describe, expect, it, vi } from 'vitest';
import { config, type Config } from '../../config';
import { hashState } from '../sim/codec';
import { barkCount, encodeInput, heldDirection, jumpCount, pounceCount, STEP_MASK, type TickInput, ZOOMIES } from '../sim/input';
import { angleDiff, datan2, fractionOfTurn, HALF_TURN } from '../sim/math';
import { defaultParams } from '../sim/params';
import { park, place, placeBall, placedMatch } from '../sim/scenes';
import {
  CELEBRATION, ENDED, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, NEVER, type Phase, START_COUNTDOWN, WARM_UP,
} from '../sim/state';
import { makeSim, step } from '../sim/step';
import { mirrorMismatches } from '../sim/testing';
import {
  type BotParams, botParams, type Brain, CHASE, DEFEND, defaultBotParams, FACE, FALL_BACK, IDLE, newBrain, SUPPORT, think, WANDER,
} from './brain';
import { stuckWatch, watchStuck } from './marks';

// The bot brain (PLAN D-39, Q-9, L142; design §8.2, §8.5): its roles, its
// reaction delay, its noise, its phases, its presses, barks and unstick
// rule, and that it's deterministic. The marks are in marks-*.test.ts.
vi.setConfig({ testTimeout: 120_000 });

const P = defaultParams;
const B = defaultBotParams;
/** No aim noise: the brain's decisions alone. */
const quiet: BotParams = { ...B, aimNoiseUnits: 0 };
const steps = (v: number): number | null => (heldDirection(v) ? v & STEP_MASK : null);

/** A placed match in play, with setup's positions. */
function placed(packSize: number, setup: (s: MatchState) => void, phase: Phase = IN_PLAY): MatchState {
  const s = placedMatch(P, packSize, { phase });
  setup(s);
  return s;
}

/** Every terrier a bot: steps s for ticks, and returns each tick's inputs. */
function play(s: MatchState, brains: readonly Brain[], ticks: number, each?: (t: number) => void): number[][] {
  const sim = makeSim(P, s.packSize);
  const seen: number[][] = [];
  for (let t = 0; t < ticks; t++) {
    const inputs = brains.map((b) => think(b, s));
    seen.push(inputs);
    const list: TickInput[] = brains.map((b, k) => ({ id: b.id, input: inputs[k]!, events: 0 }));
    step(sim, s, list);
    each?.(t);
  }
  return seen;
}

const brainsFor = (s: MatchState, params: BotParams = B): Brain[] => s.terriers.map((T) => newBrain(T.id, T.prevInput, P, params));

describe('roles in play (Q-9)', () => {
  it('chases, supports and defends by distance rank within the pack, ties to the lower slot', () => {
    const s = placed(4, (s) => {
      placeBall(P, s, 0, 0);
      // Pack A, list indices 0, 2, 4, 6, at 2, 4, 6 and 8 m from the ball.
      place(P, s, 0, -6, 0); place(P, s, 2, -2, 0); place(P, s, 4, -4, 2); place(P, s, 6, 0, -8);
      for (const k of [1, 3, 5, 7]) park(P, s, k);
    });
    const brains = brainsFor(s);
    for (const b of brains) think(b, s);
    expect([0, 2, 4, 6].map((k) => brains[k]!.role)).toEqual([DEFEND, CHASE, SUPPORT, DEFEND]);
    // Two at the same distance: the lower slot ranks first.
    place(P, s, 4, -2, 0.5);
    place(P, s, 2, -2, -0.5);
    const again = brainsFor(s);
    for (const b of again) think(b, s);
    expect([2, 4].map((k) => again[k]!.role)).toEqual([CHASE, SUPPORT]);
  });

  it("falls back when a rival is nearer the ball, and chases when it's only as near (L142)", () => {
    const setup = (rivalX: number) => (s: MatchState): void => {
      placeBall(P, s, 0, 0);
      place(P, s, 0, 3, 0); // pack A's, on the side it attacks
      place(P, s, 1, rivalX, 0.5);
    };
    const nearer = placed(1, setup(-2.5));
    const [a, b] = brainsFor(nearer);
    think(a!, nearer);
    think(b!, nearer);
    expect([a!.role, b!.role]).toEqual([FALL_BACK, CHASE]);
    // As near, by exact mirror: no rival is nearer, so both chase.
    const level = placed(1, (s) => {
      placeBall(P, s, 0, 0);
      place(P, s, 0, -3, 1);
      place(P, s, 1, 3, -1);
    });
    const [c, d] = brainsFor(level);
    think(c!, level);
    think(d!, level);
    expect([c!.role, d!.role]).toEqual([CHASE, CHASE]);
    // A rival that can't act, tumbled or sitting, isn't nearer.
    nearer.terriers[1]!.tumble = 40;
    const e = newBrain(nearer.terriers[0]!.id, 0, P);
    think(e, nearer);
    expect(e.role).toBe(CHASE);
  });

  it('falls back round the ball, never through it, to between the ball and its own goal, and clears it from there', () => {
    // Pack A's bot 3 m beyond the ball, a rival 2 m off it standing idle.
    const s = placed(1, (s) => {
      placeBall(P, s, 0, 0);
      place(P, s, 0, 3, 0);
      place(P, s, 1, 0, 2);
    });
    const bot = newBrain(s.terriers[0]!.id, 0, P);
    const sim = makeSim(P, 1);
    let goalSideAt = -1;
    let touchedBefore = false;
    for (let t = 1; t <= 240; t++) {
      const list: TickInput[] = [{ id: bot.id, input: think(bot, s), events: 0 }, { id: s.terriers[1]!.id, input: 0, events: 0 }];
      step(sim, s, list);
      const A = s.terriers[0]!;
      if (goalSideAt < 0 && A.x < s.ball.x - P.ballRadius) goalSideAt = t;
      if (goalSideAt < 0 && A.lastBallContactTick !== NEVER) touchedBefore = true;
    }
    expect(touchedBefore).toBe(false);
    expect(goalSideAt).toBeGreaterThan(0);
    expect(goalSideAt).toBeLessThan(90);
    // Then it meets the ball and sends it away from its own goal, at −x.
    expect(s.terriers[0]!.lastBallContactTick).not.toBe(NEVER);
    expect(s.ball.x).toBeGreaterThan(1);
  });

  it('meets the ball from Q while the rival is still nearer, and clears it away from its own goal (L142)', () => {
    // A rival stands idle beside the ball, nearer it than the bot ever is
    // before it meets the ball, so only FALL_BACK's meet can touch it.
    for (const [x, y, rx, ry] of [[3, 0, 0, 1.3], [3, -0.5, 0.3, 1.3], [4, 0.5, 0.3, -1.3]] as const) {
      const s = placed(1, (s) => {
        placeBall(P, s, 0, 0);
        place(P, s, 0, x, y);
        place(P, s, 1, rx, ry);
      });
      const bot = newBrain(s.terriers[0]!.id, 0, P, quiet);
      const sim = makeSim(P, 1);
      let touch = -1;
      let role = -1;
      for (let t = 1; t <= 240 && touch < 0; t++) {
        const v = think(bot, s);
        step(sim, s, [{ id: bot.id, input: v, events: 0 }, { id: s.terriers[1]!.id, input: 0, events: 0 }]);
        if (s.terriers[0]!.lastBallContactTick !== NEVER) {
          touch = t;
          role = bot.role;
        }
      }
      expect([touch > 0, role], `from (${x}, ${y})`).toEqual([true, FALL_BACK]);
      // Away from its own goal, at −x.
      for (let t = 0; t < 10; t++) step(sim, s, [{ id: bot.id, input: think(bot, s), events: 0 }, { id: s.terriers[1]!.id, input: 0, events: 0 }]);
      expect(s.ball.vx, `from (${x}, ${y})`).toBeGreaterThan(1);
    }
  });

  it('chases from the far side round the ball by a side waypoint, without touching it, then pushes it goalward', () => {
    // Pack A attacks +x; its bot starts between the ball and that goal.
    const s = placed(1, (s) => {
      placeBall(P, s, 0, 0);
      place(P, s, 0, 6, 0.3);
      park(P, s, 1);
    });
    const bot = newBrain(s.terriers[0]!.id, 0, P);
    const sim = makeSim(P, 1);
    let behindAt = -1;
    for (let t = 1; t <= 300; t++) {
      step(sim, s, [{ id: bot.id, input: think(bot, s), events: 0 }]);
      const A = s.terriers[0]!;
      if (behindAt < 0) {
        expect(A.lastBallContactTick, `touched at tick ${t}`).toBe(NEVER);
        if (A.x < s.ball.x - P.ballRadius) behindAt = t;
      }
    }
    expect(behindAt).toBeGreaterThan(0);
    expect(s.ball.x).toBeGreaterThan(5);
  });

  it('defends on the line from its own goal to the ball, defendMetres out, and a second 1.5 m to the side, at 3 and 4 a side, both packs (Q-9)', () => {
    for (const n of [3, 4]) {
      // By rank in each pack: a chaser and a supporter, standing still, then
      // the defenders, who alone act, so the ball stays put.
      const at = [[-2, 3], [-6, 0], [-10, 8], [-10, -5]] as const;
      const s = placed(n, (s) => {
        placeBall(P, s, 0, 3);
        for (let k = 0; k < n; k++) for (const pack of [0, 1] as const) place(P, s, 2 * k + pack, (pack === 0 ? 1 : -1) * at[k]![0], at[k]![1]);
      });
      const brains = brainsFor(s, quiet);
      const sim = makeSim(P, n);
      for (let t = 0; t < 300; t++) {
        const list = brains.map((b): TickInput => {
          const v = think(b, s);
          return { id: b.id, input: b.role === DEFEND ? v : 0, events: 0 };
        });
        step(sim, s, list);
      }
      for (const pack of [0, 1] as const) {
        const own = pack === 0 ? -P.pitch.goalLineX : P.pitch.goalLineX;
        const gl = Math.hypot(s.ball.x - own, s.ball.y);
        const [ux, uy] = [(s.ball.x - own) / gl, s.ball.y / gl];
        const [px, py] = [own + ux * B.defendMetres, uy * B.defendMetres];
        const defenders = s.terriers.filter((T, k) => T.pack === pack && brains[k]!.role === DEFEND);
        const off = defenders.map((T) => [T.x - px, T.y - py] as const).sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
        const what = `${n} a side, pack ${pack}`;
        expect(off, what).toHaveLength(n - 2);
        expect(Math.hypot(...off[0]!), what).toBeLessThan(0.5);
        if (n === 4) {
          const [ox, oy] = off[1]!;
          expect(Math.abs(ox * ux + oy * uy), what).toBeLessThan(0.5);
          expect(Math.abs(Math.hypot(ox, oy) - 1.5), what).toBeLessThan(0.5);
        }
      }
    }
  });

  it('holds nothing within 0.5 m of a support or defence target, and treats a short pack as any other state', () => {
    // Pack A's second, on its support point: 5 m behind the ball toward its own goal.
    const s = placed(2, (s) => {
      placeBall(P, s, 0, 0);
      place(P, s, 0, -2, 0);
      place(P, s, 2, -B.supportMetres - 0.2, 0.1);
      park(P, s, 1);
      park(P, s, 3);
    });
    const brains = brainsFor(s);
    const inputs = brains.map((b) => think(b, s));
    expect(brains[2]!.role).toBe(SUPPORT);
    expect(heldDirection(inputs[2]!)).toBe(false);
    expect(heldDirection(inputs[0]!)).toBe(true);
    // The empty-goal mark's state: pack B empty (design §2.3).
    const short = placedMatch(P, 1, { members: [1, 0] });
    const lone = newBrain(short.terriers[0]!.id, 0, P);
    expect(heldDirection(think(lone, short))).toBe(true);
    expect(lone.role).toBe(CHASE);
  });
});

describe('walls (M2 integration)', () => {
  it('scores alone from a ball resting on either end wall by a post, never going round into its own goal', () => {
    for (const [bx, by] of [[-19.2, 4.8], [-19.2, -4.8], [19.2, 4.8], [19.2, -4.8]] as const) {
      for (const [x, y] of [[0, 0], [-10, -10], [-10, 10]] as const) {
        // The empty-goal mark's state: pack B empty (design §2.3).
        const s = placedMatch(P, 1, { members: [1, 0] });
        placeBall(P, s, bx, by);
        place(P, s, 0, x, y);
        const id = s.terriers[0]!.id;
        const bot = newBrain(id, 0, P);
        const sim = makeSim(P, 1);
        const watch = stuckWatch([id]);
        let goal = -1;
        let deepest = 0;
        for (let t = 1; t <= 20 * 60 && goal < 0; t++) {
          const v = think(bot, s);
          step(sim, s, [{ id, input: v, events: 0 }]);
          watchStuck(watch, s, [v], P);
          deepest = Math.min(deepest, s.terriers[0]!.x + P.pitch.goalLineX);
          if (s.score[0] > 0) goal = t;
        }
        const what = `the ball at (${bx}, ${by}), the bot from (${x}, ${y})`;
        expect([goal > 0, s.score[1], watch.stuck], what).toEqual([true, 0, []]);
        expect(deepest, `${what}: its centre never past its own goal line`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('perception (Q-9, design §8.2)', () => {
  it('decides from what it saw 0.25 s ago: a change at tick T changes the decision at T + 15', () => {
    expect(B.reactionTicks).toBe(15);
    const s = placed(1, (s) => {
      placeBall(P, s, 5, 0);
      place(P, s, 0, -5, 0);
      park(P, s, 1);
    });
    const bot = newBrain(s.terriers[0]!.id, 0, P, quiet);
    const seen: (number | null)[] = [];
    for (let t = 0; t < 40; t++) {
      s.tick = t; // nothing stepped: the bot stays where it is
      if (t === 10) placeBall(P, s, -5, 8);
      seen.push(steps(think(bot, s)));
    }
    expect(seen[0]).toBe(0); // straight at the ball, along +x
    expect(seen.slice(0, 25).every((v) => v === seen[0])).toBe(true);
    expect(seen[25]).not.toBe(seen[0]);
    expect(seen.slice(25).every((v) => v === seen[25])).toBe(true);
    // A fresh brain acts at once, on what it sees.
    const fresh = newBrain(s.terriers[0]!.id, 0, P, quiet);
    expect(steps(think(fresh, s))).toBe(seen[25]);
  });

  it('judges a rolling ball by the velocity it saw, so it meets the ball where it is, not where it was', () => {
    // The ball rolls across in front of a bot standing behind its line.
    const s = placed(1, (s) => {
      placeBall(P, s, -4, -6, P.ballRadius, 0, 4);
      place(P, s, 0, -10, 0);
      park(P, s, 1);
    });
    const bot = newBrain(s.terriers[0]!.id, 0, P, quiet);
    const sim = makeSim(P, 1);
    for (let t = 0; t < 15; t++) {
      // The bot holds still for the reaction delay while the ball rolls on.
      think(bot, s);
      step(sim, s, [{ id: bot.id, input: 0, events: 0 }]);
    }
    const v = steps(think(bot, s));
    // It aims for the ball's place now, about 1 m on from where it was seen.
    const T = s.terriers[0]!;
    const now = datan2(s.ball.y - T.y, s.ball.x - T.x);
    expect(v).not.toBeNull();
    expect(Math.abs(angleDiff(now, (v! * 2 ** 27) >>> 0))).toBeLessThan(2 * 2 ** 27);
  });
});

describe('noise and mirrors (§16, D-39)', () => {
  it('keeps mirrored bots mirrored without aim noise, and its noise, seeded per bot, sets them apart within 2 s', () => {
    for (const packSize of [1, 2, 3, 4]) {
      for (const params of [quiet, B]) {
        const s = placedMatch(P, packSize, { seed: 5 });
        let first = -1;
        play(s, brainsFor(s, params), params === quiet ? 600 : 120, (t) => {
          if (first < 0 && mirrorMismatches(s, 1).length > 0) first = t;
        });
        if (params === quiet) expect(first, `${packSize} a side, no noise`).toBe(-1);
        else expect(first, `${packSize} a side, with noise`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('draws its aim noise afresh only every reaction delay, 15 ticks (design §8.2)', () => {
    // Straight behind the ball, its step is 0 give or take the noise: 31, 0 or 1.
    const s = placed(1, (s) => {
      placeBall(P, s, 0, 0);
      place(P, s, 0, -5, 0);
      park(P, s, 1);
    });
    const bot = newBrain(s.terriers[0]!.id, 0, P);
    const seen: (number | null)[] = [];
    for (let t = 0; t < B.stuckTicks - 15; t++) {
      s.tick = t; // nothing stepped, short of the unstick
      seen.push(steps(think(bot, s)));
    }
    const changes = seen.flatMap((v, t) => (t > 0 && v !== seen[t - 1] ? [t] : []));
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.filter((t) => t % B.reactionTicks !== 0)).toEqual([]);
  });

  it('is deterministic for a seed: the same ID and states give the same inputs', () => {
    const run = (): { inputs: number[][]; hash: string } => {
      const s = placedMatch(P, 2, { seed: 9 });
      const inputs = play(s, brainsFor(s), 900);
      return { inputs, hash: hashState(s) };
    };
    const a = run();
    const b = run();
    expect(b.hash).toBe(a.hash);
    expect(b.inputs).toEqual(a.inputs);
  });
});

describe('phases (D-39, design §8.2)', () => {
  it('turns on its spot to face the ball in the countdowns', () => {
    for (const phase of [START_COUNTDOWN, KICKOFF_COUNTDOWN] as const) {
      const s = placedMatch(P, 2, { phase, seed: 3 });
      for (const T of s.terriers) T.heading = (T.heading + HALF_TURN) >>> 0; // facing away
      const where = s.terriers.map((T) => [T.x, T.y]);
      const brains = brainsFor(s);
      play(s, brains, 40);
      for (const [k, T] of s.terriers.entries()) {
        expect(brains[k]!.role).toBe(FACE);
        expect([T.x, T.y]).toEqual(where[k]); // a countdown allows turning only
        // Facing the ball, to a step and the aim noise.
        const off = angleDiff(T.heading, datan2(s.ball.y - T.y, s.ball.x - T.x));
        expect(Math.abs(off)).toBeLessThanOrEqual(2 ** 26 + B.aimNoiseUnits);
      }
    }
  });

  it('wanders in warm-up, seeded, on the floor plan, with some zoomies and no pounces', () => {
    const s = placedMatch(P, 2, { phase: WARM_UP, seed: 4 });
    const brains = brainsFor(s);
    const pounces = s.terriers.map((T) => pounceCount(T.prevInput));
    const start = s.terriers.map((T) => [T.x, T.y]);
    const held = s.terriers.map(() => new Set<number>());
    let zoomies = 0;
    let far = s.terriers.map(() => 0);
    play(s, brains, 1200, () => {
      far = s.terriers.map((T, k) => Math.max(far[k]!, Math.hypot(T.x - start[k]![0]!, T.y - start[k]![1]!)));
    }).forEach((inputs) =>
      inputs.forEach((v, k) => {
        const st = steps(v);
        if (st !== null) held[k]!.add(st);
        if ((v & ZOOMIES) !== 0) zoomies++;
        expect(pounceCount(v)).toBe(pounces[k]);
      }),
    );
    for (const [k, b] of brains.entries()) {
      expect(b.role).toBe(WANDER);
      expect(held[k]!.size).toBeGreaterThanOrEqual(4);
      expect(far[k]).toBeGreaterThan(5);
    }
    expect(zoomies).toBeGreaterThan(0);
    // Warm-up's ball never moves (D-8).
    expect([s.ball.x, s.ball.y, s.ball.z]).toEqual([0, 0, P.ballRadius]);
  });

  it('holds nothing in a celebration and once the match has ended, and sends nothing while absent', () => {
    const s = placedMatch(P, 1, { phase: CELEBRATION, seed: 2 });
    const bot = newBrain(s.terriers[0]!.id, encodeInput({ jump: 2, pounce: 1 }), P);
    expect(heldDirection(think(bot, s))).toBe(false);
    expect(bot.role).toBe(IDLE);
    s.phase = ENDED;
    const v = think(bot, s);
    expect([heldDirection(v), jumpCount(v), pounceCount(v)]).toEqual([false, 2, 1]);
    // Absent: 0, and its counters start again from 0, as a JOIN's previous input does.
    const gone = { ...s, phase: IN_PLAY as Phase, terriers: [] };
    expect(think(bot, gone)).toBe(0);
    s.phase = IN_PLAY;
    const back = think(bot, s);
    expect([jumpCount(back), pounceCount(back)]).toEqual([0, 0]);
  });
});

describe('presses, barks and zoomies (D-10, L327, design §8.2)', () => {
  it('starts its counters from the stored previous input, and a press is one count', () => {
    // Behind the ball, lined up with the goal it attacks, at +x, and in reach.
    const s = placed(1, (s) => {
      placeBall(P, s, 0, 0);
      place(P, s, 0, -2.4, 0);
      s.terriers[0]!.heading = 0;
      park(P, s, 1);
    });
    const prev = encodeInput({ jump: 3, pounce: 3 });
    s.terriers[0]!.prevInput = prev;
    const bot = newBrain(s.terriers[0]!.id, prev, P, quiet);
    const first = think(bot, s);
    expect(jumpCount(first)).toBe(3);
    expect(pounceCount(first)).toBe(0); // 3 + 1, mod 4: a pounce
    const sim = makeSim(P, 1);
    step(sim, s, [{ id: bot.id, input: first, events: 0 }]);
    expect(s.terriers[0]!.lunge).toBeGreaterThan(0);
    // Lunging, then waiting: no more presses for the rest of the wait.
    for (let t = 0; t < 60; t++) {
      const v = think(bot, s);
      expect(pounceCount(v)).toBe(0);
      step(sim, s, [{ id: bot.id, input: v, events: 0 }]);
    }
  });

  it("pounces only when the shot is lined up with the goal's mouth", () => {
    const at = (x: number, y: number, heading: number, z = P.ballRadius): number => {
      const s = placed(1, (s) => {
        placeBall(P, s, 0, 0, z);
        place(P, s, 0, x, y);
        s.terriers[0]!.heading = heading >>> 0;
        park(P, s, 1);
      });
      return pounceCount(think(newBrain(s.terriers[0]!.id, 0, P, quiet), s));
    };
    expect(at(-2.4, 0, 0)).toBe(1);
    expect(at(-2.4, 0, datan2(0.9, 2.4))).toBe(0); // the lunge would glance off the ball's side
    expect(at(-2.4, 0, 0, 2.2)).toBe(0); // the ball too high
    expect(at(-4, 0, 0)).toBe(0); // the ball out of reach
    expect(at(2.4, 0, HALF_TURN)).toBe(0); // toward its own goal
  });

  it("judges the shot, not the heading: the contact's normal within 20° of the goal's centre, crossing the line inside the mouth", () => {
    /** The ball at (bx, 0); the bot 2.4 m behind it along `deg`, `miss` m off that line, heading along it. */
    const at = (bx: number, deg: number, miss = 0): number => {
      const h = fractionOfTurn(deg < 0 ? 360 + deg : deg, 360);
      const s = placed(1, (s) => {
        placeBall(P, s, bx, 0);
        const c = Math.cos((deg * Math.PI) / 180);
        const n = Math.sin((deg * Math.PI) / 180);
        place(P, s, 0, bx - 2.4 * c + miss * n, -2.4 * n - miss * c);
        s.terriers[0]!.heading = h;
        park(P, s, 1);
      });
      return pounceCount(think(newBrain(s.terriers[0]!.id, 0, P, quiet), s));
    };
    // 10° off the goal's centre from the centre spot: within the align
    // angle, but 3.5 m wide at the goal line, outside the mouth.
    expect(at(0, 10)).toBe(0);
    expect(at(0, 5)).toBe(1);
    // 25° off, 3 m out: inside the mouth, but outside the align angle.
    expect(at(17, 25)).toBe(0);
    expect(at(17, 15)).toBe(1);
    // Heading straight at the goal, 0.6 m off the ball's centre, 4 m out:
    // the lunge meets the ball 35° round its side, so the shot is 35° off.
    expect(at(16, 0, 0.6)).toBe(0);
    expect(at(16, 0)).toBe(1);
  });

  it('jumps at a ball in the air over it, only from the side away from the goal it attacks', () => {
    const s = placed(1, (s) => {
      placeBall(P, s, 0.5, 0, 2);
      place(P, s, 0, 0, 0);
      park(P, s, 1);
    });
    const v = think(newBrain(s.terriers[0]!.id, 0, P, quiet), s);
    expect(jumpCount(v)).toBe(1);
    // Its band: the ball's centre 1.5 to 2.5 m up, within 1.5 m across.
    const jumpAt = (bx: number, z: number): number => {
      const u = placed(1, (s) => {
        placeBall(P, s, bx, 0, z);
        place(P, s, 0, 0, 0);
        park(P, s, 1);
      });
      return jumpCount(think(newBrain(u.terriers[0]!.id, 0, P, quiet), u));
    };
    expect([jumpAt(0.5, 1.4), jumpAt(0.5, 1.6), jumpAt(0.5, 2.4), jumpAt(0.5, 2.6)]).toEqual([0, 1, 1, 0]);
    expect([jumpAt(1.4, 2), jumpAt(1.6, 2)]).toEqual([1, 0]);
    const ahead = placed(1, (s) => {
      placeBall(P, s, -0.5, 0, 2);
      place(P, s, 0, 0, 0);
      park(P, s, 1);
    });
    expect(jumpCount(think(newBrain(ahead.terriers[0]!.id, 0, P, quiet), ahead))).toBe(0);
  });

  it('barks about every 5 s, never within the bark gap, which follows the Bark setting', () => {
    const gaps = (c: Config, ticks: number): number[] => {
      const s = placedMatch(P, 1, { phase: CELEBRATION });
      const bot = newBrain(s.terriers[0]!.id, 0, P, botParams(c));
      const out: number[] = [];
      let last = -1;
      let count = barkCount(think(bot, s));
      for (let t = 1; t < ticks; t++) {
        s.tick = t;
        const n = barkCount(think(bot, s));
        if (n !== count) {
          expect(n).toBe((count + 1) & 3);
          if (last >= 0) out.push(t - last);
          last = t;
          count = n;
        }
      }
      return out;
    };
    const every = gaps(config, 36000);
    expect(every.length).toBeGreaterThan(100);
    expect(Math.min(...every)).toBeGreaterThanOrEqual(300 - 60);
    expect(Math.max(...every)).toBeLessThanOrEqual(300 + 60);
    const mean = every.reduce((a, b) => a + b, 0) / every.length;
    expect(Math.abs(mean - 300)).toBeLessThan(10);
    // At 2 barks a second the gap is 30 ticks: a bark every second comes 30–90 ticks after the last.
    const fast = gaps({ ...config, barkMaxPerSecond: 2, botBarkEverySeconds: 1 }, 6000);
    expect(Math.min(...fast)).toBeGreaterThanOrEqual(30);
    expect(Math.min(...fast)).toBeLessThan(40);
    expect(Math.max(...fast)).toBeLessThanOrEqual(90);
    const slow = gaps({ ...config, botBarkEverySeconds: 2 }, 6000);
    expect(Math.min(...slow)).toBeGreaterThanOrEqual(60);
  });

  it('zooms toward a target over 5 m away, in CHASE and FALL_BACK only', () => {
    // Lined up behind the ball: CHASE's target is the ball's centre.
    const chase = (d: number): number => {
      const s = placed(1, (s) => {
        placeBall(P, s, 0, 0);
        place(P, s, 0, -d, 0);
        park(P, s, 1);
      });
      const bot = newBrain(s.terriers[0]!.id, 0, P, quiet);
      const v = think(bot, s);
      expect(bot.role).toBe(CHASE);
      return v & ZOOMIES;
    };
    expect([chase(4), chase(6)]).toEqual([0, ZOOMIES]);
    // SUPPORT and DEFEND never zoom, however far their targets.
    const s = placed(3, (s) => {
      placeBall(P, s, 0, 0);
      place(P, s, 0, -2, 0); // CHASE
      place(P, s, 2, 12, 10); // SUPPORT, 17 m from its point
      place(P, s, 4, 14, -12); // DEFEND, 30 m from its point
      for (const k of [1, 3, 5]) park(P, s, k);
    });
    const brains = brainsFor(s, quiet);
    const inputs = brains.map((b) => think(b, s));
    expect([brains[2]!.role, brains[4]!.role]).toEqual([SUPPORT, DEFEND]);
    expect([inputs[2]! & ZOOMIES, inputs[4]! & ZOOMIES]).toEqual([0, 0]);
    expect([heldDirection(inputs[2]!), heldDirection(inputs[4]!)]).toEqual([true, true]);
  });

  it('zooms at a far target, releases a locked-out meter, and waits for half a meter to zoom again', () => {
    const s = placed(1, (s) => {
      placeBall(P, s, 15, 0);
      place(P, s, 0, -15, 0);
      park(P, s, 1);
    });
    const bot = newBrain(s.terriers[0]!.id, 0, P, quiet);
    expect(think(bot, s) & ZOOMIES).toBe(ZOOMIES);
    s.terriers[0]!.zoomLocked = true;
    s.terriers[0]!.meter = 0;
    expect(think(bot, s) & ZOOMIES).toBe(0);
    s.terriers[0]!.zoomLocked = false;
    s.terriers[0]!.meter = P.meterFull / 2 - 1;
    expect(think(bot, s) & ZOOMIES).toBe(0);
    s.terriers[0]!.meter = P.meterFull / 2;
    expect(think(bot, s) & ZOOMIES).toBe(ZOOMIES);
  });
});

describe('unstick (design §8.2)', () => {
  it('after 2 s held within 0.5 m it turns the other way, then each side in turn, with no jump', () => {
    expect(B.stuckTicks).toBe(120);
    const s = placed(1, (s) => {
      placeBall(P, s, 5, 0);
      place(P, s, 0, -5, 0);
      park(P, s, 1);
    });
    const bot = newBrain(s.terriers[0]!.id, 0, P, quiet);
    const seen: { step: number | null; jump: number }[] = [];
    for (let t = 0; t < 241; t++) {
      s.tick = t; // nothing stepped: it holds a direction and stays put …
      if (t === 225) place(P, s, 0, -3, 0); // … until moved out of its circle during an escape
      const v = think(bot, s);
      seen.push({ step: steps(v), jump: jumpCount(v) });
    }
    expect(seen.slice(0, 120).every((x) => x.step === 0)).toBe(true);
    expect(seen[120]!.step).toBe(16);
    expect(seen.slice(120, 150).every((x) => x.step === 16)).toBe(true);
    expect([seen[150]!.step, seen[180]!.step, seen[210]!.step]).toEqual([8, 24, 16]);
    // The escape runs its 30 ticks; free again, it goes back to the ball.
    expect(seen[239]!.step).toBe(16);
    expect(seen[240]!.step).toBe(0);
    // And it never jumps: in the air the drive can't act (design §8.2).
    expect(seen.every((x) => x.jump === 0)).toBe(true);
  });

  it('escapes on the floor: from 2 s stuck, the escape alone takes it out of its 0.5 m circle', () => {
    const s = placed(1, (s) => {
      placeBall(P, s, 5, 0);
      place(P, s, 0, -5, 0);
      park(P, s, 1);
    });
    const bot = newBrain(s.terriers[0]!.id, 0, P, quiet);
    for (let t = 0; t < B.stuckTicks; t++) {
      s.tick = t; // nothing stepped: it holds at the ball and stays put
      think(bot, s);
    }
    // The escape, stepped.
    s.tick = B.stuckTicks;
    const sim = makeSim(P, 1);
    const A = s.terriers[0]!;
    let airborne = 0;
    for (let t = 0; t < 30; t++) {
      const v = think(bot, s);
      if (t === 0) expect(steps(v)).toBe(16);
      step(sim, s, [{ id: bot.id, input: v, events: 0 }, { id: s.terriers[1]!.id, input: 0, events: 0 }]);
      if (!A.onFloor) airborne++;
    }
    expect(airborne).toBe(0);
    expect(Math.hypot(A.x + 5, A.y)).toBeGreaterThan(B.stuckMetres);
  });
});
