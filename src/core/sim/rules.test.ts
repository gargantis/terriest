import { describe, expect, it, vi } from 'vitest';
import { config, type PitchShape } from '../../config';
import { decodeState, encodeState, hashState } from './codec';
import { encodeInput, FRAME_PITCH } from './input';
import { everyone, startedMatch, ticks } from './match-testing';
import { HALF_TURN, QUARTER_TURN } from './math';
import { defaultParams, type SimParams, simParams } from './params';
import { advanceClock, bowled, placeKickoff, removeTerrier, scoreGoal, terriest, vacate, winner } from './rules';
import { park, place, placeBall, placedMatch, touchReach } from './scenes';
import {
  CELEBRATION, ENDED, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, NEVER, type Phase, SITTING, slotOf, STANDING, START_COUNTDOWN, WARM_UP,
} from './state';
import { makeSim, step } from './step';
import { bodyBits, run, scenario, SECOND_SHAPE } from './testing';
import { stateProblems } from './valid';

// The match rules (PLAN D-8, §16 "Rules"; design §6): goals at the frame and
// the netting on both shapes, credit and own goals, the clock, overtime and
// the end, the Terriest, what each phase allows, bowling, touches and the
// kickoff placement. The events and arrivals are events.test.ts's.
vi.setConfig({ testTimeout: 120_000 });

const P = defaultParams;
const pitch = (st: number, zoomies = false, jump = 0, pounce = 0): number => encodeInput({ step: st, frame: FRAME_PITCH, zoomies, jump, pounce });

// --- Goal tests at the posts, the crossbar and the netting (design §6.8) ---

/** What a shot did: the pieces it met by name, before and during the
 *  celebration; the substep its centre first passed the goal line by R, and
 *  the substep the goal was scored; the score, and how many times it rose. */
interface Shot {
  met: string[];
  metCelebrating: string[];
  firstPast: number;
  goalAt: number;
  score: [number, number];
  rises: number;
  passedLine: boolean;
  backInFront: boolean;
}

/** A ball sent from (x, y, z) at (vx, vy, vz) toward the +x goal, or its
 *  point mirror toward the −x goal, with both terriers parked, for `ticks`. */
function shoot(Q: SimParams, end: 1 | -1, b: readonly [number, number, number, number, number, number], n: number): Shot {
  const s = placedMatch(Q, 1);
  park(Q, s, 0);
  park(Q, s, 1);
  placeBall(Q, s, end * b[0], end * b[1], b[2], end * b[3], end * b[4], b[5]);
  const sim = makeSim(Q, 1);
  const line = Q.pitch.goalLineX + Q.ballRadius;
  const met = new Set<string>();
  const metCelebrating = new Set<string>();
  const shot: Shot = { met: [], metCelebrating: [], firstPast: -1, goalAt: -1, score: [0, 0], rises: 0, passedLine: false, backInFront: false };
  let sub = 0;
  let goals = 0;
  sim.probe = (st) => {
    sub++;
    for (let c = 0; c < sim.physics.cnt; c++) {
      const p = sim.physics.cp[c]!;
      if (p <= 0) continue; // a pair, or the floor
      const name = Q.pitch.pieces[p]!.name;
      met.add(name);
      if (st.phase === CELEBRATION) metCelebrating.add(name);
    }
    const x = end * st.ball.x;
    if (shot.firstPast < 0 && x > line) shot.firstPast = sub;
    if (x > Q.pitch.goalLineX) shot.passedLine = true;
    if (shot.goalAt < 0 && st.phase === CELEBRATION) shot.goalAt = sub;
    if (st.score[0] + st.score[1] > goals) {
      shot.rises++;
      goals = st.score[0] + st.score[1];
    }
  };
  for (let t = 1; t <= n; t++) step(sim, s, everyone(s));
  shot.met = [...met].sort();
  shot.metCelebrating = [...metCelebrating].sort();
  shot.score = [s.score[0], s.score[1]];
  shot.backInFront = end * s.ball.x < Q.pitch.goalLineX - 2;
  return shot;
}

describe('goal tests at the posts, the crossbar and the netting, on both shapes (D-8; design §6.8)', () => {
  for (const [shapeName, shape] of [['main', config.pitch], ['second', SECOND_SHAPE]] as [string, PitchShape][]) {
    const Q = simParams({ ...config, pitch: shape });
    const hx = shape.lengthMetres / 2;
    const post = shape.mouthWidthMetres / 2 + shape.postRadiusMetres; // the posts' axes
    const bar = shape.mouthHeightMetres + shape.postRadiusMetres; // the crossbar's
    const side = shape.mouthWidthMetres / 2; // the side netting
    const R = Q.ballRadius;
    for (const end of [1, -1] as const) {
      // Pieces by the end they're at, pack B's goal at +x: the names use U+2212 for minus.
      const x = end > 0 ? '+x' : '−x';
      const y = (sign: number): string => (sign * end > 0 ? '+y' : '−y');
      const attacking = end > 0 ? 0 : 1;

      it(`${shapeName} pitch, the ${x} goal: onto each post rolling and in the air, onto the crossbar and over it, the ball bounces out and doesn't score`, () => {
        const shots: [string, readonly [number, number, number, number, number, number], string][] = [
          ['the +y post, rolling', [hx - 3, post, R, 5, 0, 0], `post ${x}${y(1)}`],
          ['the −y post, rolling', [hx - 3, -post, R, 5, 0, 0], `post ${x}${y(-1)}`],
          ['the +y post, in the air', [hx - 1.5, post, 2, 6, 0, 0], `post ${x}${y(1)}`],
          ['the −y post, in the air', [hx - 1.5, -post, 2, 6, 0, 0], `post ${x}${y(-1)}`],
          ['the crossbar, in the air', [hx - 1.5, 0, bar + 0.1, 6, 0, 0], `crossbar ${x}`],
          ['over the crossbar, against the end wall above the mouth', [hx - 2, 0, 4.6, 6, 0, 0], `end ${x}, above the mouth`],
        ];
        for (const [what, b, piece] of shots) {
          const r = shoot(Q, end, b, 240);
          expect(r.met, what).toContain(piece);
          expect(r.score, what).toEqual([0, 0]);
          expect(r.passedLine, `${what}: its centre never passes the goal line`).toBe(false);
          expect(r.backInFront, `${what}: it bounces back onto the pitch`).toBe(true);
        }
      });

      it(`${shapeName} pitch, the ${x} goal: into the back, each side and the top netting, it scores once, in the substep its centre first passes the line by R`, () => {
        const shots: [string, readonly [number, number, number, number, number, number], string][] = [
          ['the back netting, rolling', [hx - 3, 0, R, 6, 0, 0], `goal ${x} back`],
          ['the +y side netting', [hx - 2, side - R - 1.4, R, 4, 1.5, 0], `goal ${x} side ${y(1)}`],
          ['the −y side netting', [hx - 2, -(side - R - 1.4), R, 4, -1.5, 0], `goal ${x} side ${y(-1)}`],
          ['the top netting, from under the crossbar', [hx - 0.4, 0, 1.7, 2, 0, 3.2], `goal ${x} top`],
        ];
        for (const [what, b, piece] of shots) {
          const r = shoot(Q, end, b, 300);
          expect(r.met, what).toContain(piece);
          expect(r.firstPast, what).toBeGreaterThan(0);
          expect(r.goalAt, `${what}: the goal's substep`).toBe(r.firstPast);
          expect(r.rises, `${what}: one goal`).toBe(1);
          expect(r.score[attacking], what).toBe(1);
          // The celebration (and the kickoff after it) counts no second goal
          // while the ball meets the netting.
          expect(r.metCelebrating.some((name) => name.startsWith(`goal ${x}`)), `${what}: it meets the netting in the celebration`).toBe(true);
        }
      });
    }
  }
});

// --- Credit, own goals and the scorers (D-8, C-26, L108) ---

describe('credit and own goals (D-8; design §6.8)', () => {
  /** 2 a side in play: list indices 0 A1, 1 B1, 2 A2, 3 B2. */
  const credited = (touch: readonly number[], at: readonly number[], pack: 0 | 1): MatchState => {
    const s = placedMatch(P, 2);
    s.ball.lastContactTick = 10;
    for (let j = 0; j < touch.length; j++) s.terriers[touch[j]!]!.lastBallContactTick = at[j]!;
    scoreGoal(makeSim(P, 2), s, pack, 12);
    return s;
  };

  it('credits every attacker whose touch was the latest, each counting a goal, and records the scorers', () => {
    const s = credited([0, 2], [10, 10], 0);
    expect([s.scorers, s.ownGoal, s.score, s.lastGoalTick, s.lastGoalPack]).toEqual([0b0101, false, [1, 0], 12, 0]);
    expect(s.terriers.map((t) => t.goals)).toEqual([1, 0, 1, 0]);
    expect([s.phase, s.phaseStart]).toEqual([CELEBRATION, 12]);
    // A defender's touch in the same tick shares nothing.
    const d = credited([0, 1], [10, 10], 0);
    expect([d.scorers, d.ownGoal, d.terriers.map((t) => t.goals)]).toEqual([0b0001, false, [1, 0, 0, 0]]);
  });

  it("counts an own goal for the attacking pack and credits nobody: a defender's latest touch, or no touch at all (L108)", () => {
    const own = credited([0, 1], [9, 10], 0); // A1 earlier, B1 last: B1 sent it into its own goal
    expect([own.scorers, own.ownGoal, own.score, own.terriers.map((t) => t.goals)]).toEqual([0, true, [1, 0], [0, 0, 0, 0]]);
    const untouched = placedMatch(P, 1);
    scoreGoal(makeSim(P, 1), untouched, 1, 3);
    expect([untouched.scorers, untouched.ownGoal, untouched.score, untouched.lastGoalPack]).toEqual([0, true, [0, 1], 1]);
  });

  it('saturates the score and the goals at 255 (A.1)', () => {
    const s = credited([0], [10], 0);
    s.score[0] = 255;
    s.terriers[0]!.goals = 255;
    s.phase = IN_PLAY;
    scoreGoal(makeSim(P, 2), s, 0, 20);
    expect([s.score[0], s.terriers[0]!.goals, s.lastGoalTick]).toEqual([255, 255, 20]);
  });

  it('credits two pushers who touch the ball in the tick it goes in, through step', () => {
    const sc = scenario(2, {}, (s, Q) => {
      const R = Q.ballRadius;
      const line = Q.pitch.goalLineX + R;
      park(Q, s, 1);
      park(Q, s, 3);
      // The ball a millimetre short of a goal in the +x mouth, moving in;
      // A1 and A2 behind it, 0.4 m either side, overlapping it by a
      // millimetre and moving with it.
      placeBall(Q, s, line - 0.001, 0, R, 2, 0, 0);
      const reach = touchReach(Q) - 0.001;
      for (const [k, side] of [[0, 0.4], [2, -0.4]] as const) {
        place(Q, s, k, line - 0.001 - Math.sqrt(reach * reach - side * side), side);
        s.terriers[k]!.vx = 2;
      }
    });
    run(sc, 1);
    const s = sc.s;
    expect([s.phase, s.score, s.ownGoal]).toEqual([CELEBRATION, [1, 0], false]);
    expect(s.terriers[0]!.lastBallContactTick).toBe(1);
    expect(s.terriers[2]!.lastBallContactTick).toBe(1);
    expect([s.scorers, s.terriers.map((t) => t.goals)]).toEqual([0b0101, [1, 0, 1, 0]]);
    // The scorers clear at the next placement; the goal's tick, pack and
    // own-goal flag stay, for the net's bulge (D-9).
    run(sc, P.celebrationTicks);
    expect([s.phase, s.scorers, s.lastGoalTick, s.lastGoalPack, s.ownGoal]).toEqual([KICKOFF_COUNTDOWN, 0, 1, 0, false]);
  });
});

// --- The clock, overtime and the end (D-8; design §6.6) ---

/** 1 a side placed in play on a 1-minute clock, the ball parked in a corner
 *  unless placed, so nothing scores by itself. */
function clocked(clock: number, score: readonly [number, number] = [0, 0]): ReturnType<typeof scenario> {
  const sc = scenario(1, {}, (s, Q) => placeBall(Q, s, -12, -9), { matchMinutes: 1 });
  sc.s.clock = clock;
  sc.s.score = [score[0], score[1]];
  return sc;
}

/** The ball a millimetre short of the +x goal, rolling in: a goal for pack A
 *  in the first substep of the next tick. */
function intoGoal(s: MatchState, Q: SimParams = P): void {
  placeBall(Q, s, Q.pitch.goalLineX + Q.ballRadius - 0.001, 0, Q.ballRadius, 3, 0, 0);
}

describe('the clock, overtime and the end (D-8; design §6.6)', () => {
  it('counts down exactly the ticks played from genesis, and goes to the overtime kickoff level at 0:00', () => {
    const m = startedMatch(P, 1, 1);
    expect([m.s.phase, m.s.phaseStart, m.s.clock]).toEqual([START_COUNTDOWN, 1, 3600]);
    ticks(m, P.startCountdownTicks - 1);
    // The countdown's ticks aren't played.
    expect([m.s.tick, m.s.phase, m.s.clock]).toEqual([300, START_COUNTDOWN, 3600]);
    ticks(m, 1);
    expect([m.s.phase, m.s.phaseStart, m.s.clock]).toEqual([IN_PLAY, 301, 3599]);
    ticks(m, 3598);
    expect([m.s.tick, m.s.phase, m.s.clock]).toEqual([3899, IN_PLAY, 1]);
    ticks(m, 1);
    expect([m.s.phase, m.s.phaseStart, m.s.clock, m.s.overtime, m.s.score]).toEqual([KICKOFF_COUNTDOWN, 3900, 0, true, [0, 0]]);
    // The overtime kickoff placed them on their spots.
    expect(m.s.terriers.map((t) => [t.x, t.y])).toEqual([[-10, 0], [10, -0]]);
    // In overtime the clock counts up, from the first tick of play.
    ticks(m, P.kickoffCountdownTicks);
    expect([m.s.phase, m.s.clock]).toEqual([IN_PLAY, 1]);
    ticks(m, 59);
    expect(m.s.clock).toBe(60);
  });

  it('stops from a goal until the next kickoff countdown ends', () => {
    const sc = clocked(3600);
    intoGoal(sc.s);
    run(sc, 1);
    expect([sc.s.phase, sc.s.clock]).toEqual([CELEBRATION, 3599]); // the goal's tick began in play
    const clocks: number[] = [];
    for (let k = 0; k < P.celebrationTicks + P.kickoffCountdownTicks - 1; k++) {
      run(sc, 1);
      clocks.push(sc.s.clock);
    }
    expect(clocks.every((c) => c === 3599)).toBe(true);
    expect(sc.s.phase).toBe(KICKOFF_COUNTDOWN);
    run(sc, 1);
    expect([sc.s.phase, sc.s.clock]).toEqual([IN_PLAY, 3598]);
  });

  it('ends at 0:00 with a pack ahead, and ENDED is terminal', () => {
    const sc = clocked(3, [2, 1]);
    run(sc, 2);
    expect([sc.s.phase, sc.s.clock, winner(sc.s)]).toEqual([IN_PLAY, 1, null]);
    run(sc, 1);
    expect([sc.s.phase, sc.s.phaseStart, sc.s.clock, sc.s.overtime, winner(sc.s)]).toEqual([ENDED, 3, 0, false, 0]);
    // Later ticks only advance the tick: the final state stays for Results (C-50).
    const end = hashState({ ...sc.s, tick: 0 });
    run(sc, 100, (k) => pitch(k * 8, true, 1, 1));
    expect(sc.s.tick).toBe(103);
    expect(hashState({ ...sc.s, tick: 0 })).toBe(end);
    expect(winner({ ...sc.s, score: [1, 2] })).toBe(1);
    expect(winner({ ...sc.s, score: [1, 1] })).toBeNull();
  });

  it('gives a goal in the tick that brings the clock to 0 its celebration, whose end decides (L107)', () => {
    // Ahead after it: the end, at the celebration's end.
    const ahead = clocked(1);
    intoGoal(ahead.s);
    run(ahead, 1);
    expect([ahead.s.phase, ahead.s.clock, ahead.s.score]).toEqual([CELEBRATION, 0, [1, 0]]);
    run(ahead, P.celebrationTicks - 1);
    expect(ahead.s.phase).toBe(CELEBRATION);
    run(ahead, 1);
    expect([ahead.s.phase, ahead.s.phaseStart, ahead.s.overtime, winner(ahead.s)]).toEqual([ENDED, 1 + P.celebrationTicks, false, 0]);
    // Level after it: the overtime kickoff, the clock at 0.
    const level = clocked(1, [0, 1]);
    intoGoal(level.s);
    run(level, 1 + P.celebrationTicks);
    expect([level.s.phase, level.s.phaseStart, level.s.overtime, level.s.clock, level.s.score]).toEqual([KICKOFF_COUNTDOWN, 1 + P.celebrationTicks, true, 0, [1, 1]]);
    expect([level.s.ball.x, level.s.terriers[0]!.x, level.s.scorers]).toEqual([0, -10, 0]);
  });

  it("ends at the overtime goal's celebration: the next goal wins", () => {
    const sc = clocked(0, [1, 1]);
    sc.s.overtime = true;
    sc.s.clock = 500;
    run(sc, 1);
    expect([sc.s.clock, sc.s.phase]).toEqual([501, IN_PLAY]);
    // A goal nobody touched is an own goal, which counts for the attacking
    // pack, and wins it as well as any.
    intoGoal(sc.s);
    run(sc, 1);
    expect([sc.s.phase, sc.s.score, sc.s.clock]).toEqual([CELEBRATION, [2, 1], 502]);
    // A1 runs with zoomies through the celebration, and on into the end.
    const held = (k: number): number => (k === 0 ? pitch(4, true) : 0);
    run(sc, P.celebrationTicks - 1, held);
    expect(sc.s.phase).toBe(CELEBRATION);
    const bodies = bodyBits(sc.s);
    const meters = sc.s.terriers.map((t) => t.meter);
    run(sc, 1, held);
    expect([sc.s.phase, sc.s.phaseStart, winner(sc.s)]).toEqual([ENDED, 2 + P.celebrationTicks, 0]);
    // The tick that ends it moves nothing: the final state is the
    // celebration's last (design §6.6, C-50).
    expect(bodyBits(sc.s)).toBe(bodies);
    expect(sc.s.terriers.map((t) => t.meter)).toEqual(meters);
  });

  it("stands a terrier placed for the overtime kickoff though it held a direction in that tick: the placement clears the tick's intents (design §6.4)", () => {
    const sc = clocked(1);
    const A = sc.s.terriers[0]!;
    const animStart = A.animStart;
    run(sc, 1, (k) => (k === 0 ? pitch(4, true) : 0));
    expect([sc.s.phase, sc.s.overtime, A.x, A.vx]).toEqual([KICKOFF_COUNTDOWN, true, -10, 0]);
    expect([A.anim, A.animStart, sc.sim.intents.driveOn[0], sc.sim.intents.zooming[0]]).toEqual([STANDING, animStart, 0, 0]);
  });

  it('counts only in a tick that began in play, saturates in overtime, and never goes below 0', () => {
    const s = placedMatch(P, 1, { matchMinutes: 1 });
    const sim = makeSim(P, 1);
    s.clock = 10;
    expect(advanceClock(sim, s, 1, false)).toBe(false);
    expect(s.clock).toBe(10);
    s.overtime = true;
    s.clock = 0xfffffffe;
    advanceClock(sim, s, 2, true);
    advanceClock(sim, s, 3, true);
    expect(s.clock).toBe(0xffffffff);
    // A state in play at 0:00 outside overtime, which no match reaches, ends at once.
    const zero = placedMatch(P, 1, { matchMinutes: 1 });
    zero.clock = 0;
    zero.score = [0, 1];
    expect(advanceClock(sim, zero, 5, true)).toBe(false);
    expect([zero.clock, zero.phase, winner(zero)]).toEqual([0, ENDED, 1]);
  });
});

// --- The Terriest (D-8, L112) ---

describe('the Terriest (D-8)', () => {
  const by = (counts: readonly [number, number][]): number[] => {
    const s = placedMatch(P, 2);
    counts.forEach(([goals, touches], k) => Object.assign(s.terriers[k]!, { goals, touches }));
    return terriest(s);
  };

  it('is the most goals, then the most touches; terriers still level share it', () => {
    expect(by([[1, 5], [2, 0], [0, 40], [1, 9]])).toEqual([1]);
    expect(by([[2, 5], [2, 9], [0, 40], [1, 9]])).toEqual([1]);
    expect(by([[2, 9], [1, 3], [2, 9], [0, 0]])).toEqual([0, 2]);
    expect(by([[0, 0], [0, 0], [0, 0], [0, 0]])).toEqual([0, 1, 2, 3]);
    expect(terriest(placedMatch(P, 1, { members: [0, 0] }))).toEqual([]);
  });

  it('credits nobody for an own goal (L112)', () => {
    const sc = scenario(1, {}, (s, Q) => {
      placeBall(Q, s, -15, 0.5);
      place(Q, s, 0, -13.5, 0.5); // A1 runs it into its own goal
      park(Q, s, 1);
    });
    run(sc, 300, (k) => (k === 0 ? pitch(16) : 0));
    expect([sc.s.score, sc.s.ownGoal]).toEqual([[0, 1], true]);
    // A1 touched it, B1 never did: the touches decide, not the goal.
    expect(sc.s.terriers.map((t) => [t.goals, t.touches])).toEqual([[0, 1], [0, 0]]);
    expect(terriest(sc.s)).toEqual([0]);
  });
});

// --- What each phase allows (D-8; design §6.10) ---

interface Allowed {
  run: boolean; zoomies: boolean; turn: boolean; jump: boolean; pounce: boolean;
  pounceTumbles: boolean; bowling: boolean; touches: boolean; goals: boolean;
  ballMoves: boolean; // a ball given a velocity moves: not fixed or frozen
  frozen: boolean; // nothing but the tick changes, whatever is held and pressed
  met: boolean; // the lunge, the bowling ball and the touch made their contacts, so the rules above were tested
}

/** 1 a side placed in a phase, A1 at (−5, 0) facing +x, B1 parked and the
 *  ball parked out of the way, then setup; n ticks with A1's input. */
function probe(phase: Phase, setup: (s: MatchState, Q: SimParams) => void, n: number, input: (t: number) => number | null = () => 0): ReturnType<typeof scenario> {
  const sc = scenario(1, {}, (s, Q) => {
    place(Q, s, 0, -5, 0);
    s.terriers[0]!.heading = 0;
    park(Q, s, 1);
    if (phase !== START_COUNTDOWN && phase !== KICKOFF_COUNTDOWN) placeBall(Q, s, 12, 9);
    setup(s, Q);
  }, { phase });
  run(sc, n, (k, t) => (k === 0 ? input(t) : 0));
  return sc;
}

function allowedIn(phase: Phase): Allowed {
  type Run = ReturnType<typeof scenario>;
  const A = (sc: Run): MatchState['terriers'][number] => sc.s.terriers[0]!;
  const B = (sc: Run): MatchState['terriers'][number] => sc.s.terriers[1]!;
  const ran = probe(phase, () => {}, 20, () => pitch(4));
  const zoom = probe(phase, () => {}, 1, () => pitch(0, true));
  const turned = probe(phase, () => {}, 5, () => pitch(8));
  const jumped = probe(phase, () => {}, 2, (t) => encodeInput({ jump: t }));
  const pounced = probe(phase, () => {}, 2, (t) => encodeInput({ pounce: t }));
  // A1 lunging at 10 m/s into B1, standing 0.6 m ahead of it.
  const lunge = probe(phase, (s, Q) => {
    place(Q, s, 1, -4.4, 0);
    Object.assign(s.terriers[0]!, { lunge: Q.lungeTicks, vx: Q.pounceSpeed });
  }, 3);
  // The ball at 5 m/s into B1, already overlapping it.
  const bowl = probe(phase, (s, Q) => {
    place(Q, s, 1, 4, 0);
    placeBall(Q, s, 4 - touchReach(Q) + 0.002, 0, Q.ballRadius, 5, 0, 0);
  }, 2);
  // The ball at 3 m/s into A1, overlapping it: too slow to bowl.
  const touch = probe(phase, (s, Q) => placeBall(Q, s, -5 + touchReach(Q) - 0.002, 0, Q.ballRadius, -3, 0, 0), 2);
  const goal = probe(phase, (s, Q) => intoGoal(s, Q), 2);
  const moving = probe(phase, (s, Q) => placeBall(Q, s, 5, 5, Q.ballRadius, 3, 0, 0), 10);
  // Holding, zooming and pressing, with the ball given a velocity.
  const still = scenario(1, {}, (s, Q) => placeBall(Q, s, 5, 5, Q.ballRadius, 3, 0, 0), { phase });
  const before = hashState({ ...still.s, tick: 0 });
  run(still, 10, (_k, t) => pitch(t, true, t, t));
  return {
    run: Math.hypot(A(ran).vx, A(ran).vy) > 0,
    zoomies: zoom.sim.intents.zooming[0] === 1,
    turn: A(turned).heading !== 0,
    jump: A(jumped).takeOffTick !== NEVER,
    pounce: A(pounced).lunge > 0,
    pounceTumbles: B(lunge).tumble > 0,
    bowling: B(bowl).tumble > 0,
    touches: A(touch).touches > 0,
    goals: goal.s.score[0] > 0,
    ballMoves: moving.s.ball.x !== 5,
    frozen: hashState({ ...still.s, tick: 0 }) === before,
    met: B(lunge).lastTerrierContactTick !== NEVER && B(bowl).lastBallContactTick !== NEVER && A(touch).lastBallContactTick !== NEVER,
  };
}

describe('what each phase allows (D-8; design §6.10)', () => {
  // The table's rows; the ball column is ballMoves and frozen: fixed in
  // warm-up, physical from the countdowns on, frozen once ended.
  const no: Allowed = {
    run: false, zoomies: false, turn: false, jump: false, pounce: false, pounceTumbles: false, bowling: false, touches: false, goals: false,
    ballMoves: true, frozen: false, met: true,
  };
  const table: [string, Phase, Allowed][] = [
    ['warm-up', WARM_UP, { ...no, run: true, zoomies: true, turn: true, jump: true, pounce: true, pounceTumbles: true, ballMoves: false }],
    ['the start countdown', START_COUNTDOWN, { ...no, turn: true }],
    ['a kickoff countdown', KICKOFF_COUNTDOWN, { ...no, turn: true }],
    ['play', IN_PLAY, { ...no, run: true, zoomies: true, turn: true, jump: true, pounce: true, pounceTumbles: true, bowling: true, touches: true, goals: true }],
    ['a celebration', CELEBRATION, { ...no, run: true, zoomies: true, turn: true }],
    ['the end', ENDED, { ...no, ballMoves: false, frozen: true, met: false }],
  ];
  for (const [name, phase, want] of table) {
    it(`in ${name}`, () => expect(allowedIn(phase)).toEqual(want));
  }

  it("holds the ball at rest through a countdown, takes the held directions from the first tick of play, and drops the presses (D-8, D-10)", () => {
    const sc = scenario(1, {}, undefined, { phase: KICKOFF_COUNTDOWN });
    // Everyone holds at the ball with zoomies, pressing every tick.
    run(sc, P.kickoffCountdownTicks - 1, (_k, t) => pitch(0, true, t, t));
    const A = sc.s.terriers[0]!;
    const b = sc.s.ball;
    expect([A.x, A.vx, A.takeOffTick, A.lunge, sc.s.phase]).toEqual([-10, 0, NEVER, 0, KICKOFF_COUNTDOWN]);
    expect([b.x, b.y, b.z, b.vx, b.vy, b.vz]).toEqual([0, 0, P.ballRadius, 0, 0, 0]);
    // The same counters: the last press was taken in the countdown, and dropped.
    const last = P.kickoffCountdownTicks - 1;
    run(sc, 1, (k) => (k === 0 ? pitch(0, true, last, last) : 0));
    expect(sc.s.phase).toBe(IN_PLAY);
    expect(A.vx).toBeGreaterThan(0);
    expect(sc.sim.intents.zooming[0]).toBe(1);
  });
});

// --- Q-8's bowling rule and its exceptions (design §6.9) ---

describe("Q-8's bowling rule", () => {
  /** B1 at (2, 0) and the ball at the origin with this velocity. */
  const at = (vx: number, vy: number, change: (s: MatchState) => void = () => {}): boolean => {
    const s = placedMatch(P, 1);
    place(P, s, 1, 2, 0);
    placeBall(P, s, 0, 0, P.ballRadius, vx, vy, 0);
    change(s);
    return bowled(P, s, s.terriers[1]!);
  };

  it('bowls at 4 m/s or more along the line from the ball to the terrier, read before the contact settles', () => {
    expect(at(4, 0)).toBe(true);
    expect(at(3.999, 0)).toBe(false);
    expect(at(5, 7)).toBe(true); // across the line doesn't count, along it does
    expect(at(3.9, 9)).toBe(false);
    expect(at(0, 9)).toBe(false);
    expect(at(-6, 0)).toBe(false); // going away
    // A horizontal offset of 0, a ball dropped on its head, reads as 0.
    expect(at(0, 0, (s) => { placeBall(P, s, 2, 0, 1.5, 0, 0, -9); })).toBe(false);
  });

  it('never bowls a lunging, tumbled or guarded terrier, or the last to touch the ball', () => {
    expect(at(6, 0, (s) => { s.terriers[1]!.lunge = 5; })).toBe(false);
    expect(at(6, 0, (s) => { s.terriers[1]!.tumble = 5; })).toBe(false);
    expect(at(6, 0, (s) => { s.terriers[1]!.guard = 5; })).toBe(false);
    expect(at(6, 0, (s) => { s.terriers[1]!.lastBallContactTick = 7; s.ball.lastContactTick = 7; })).toBe(false);
    // Its touch an earlier tick than the ball's last: bowled.
    expect(at(6, 0, (s) => { s.terriers[1]!.lastBallContactTick = 6; s.ball.lastContactTick = 7; })).toBe(true);
    // Neither has touched anything: NEVER matching NEVER isn't the last touch.
    expect(at(6, 0)).toBe(true);
  });

  it('tumbles a terrier in play, through step, and never in a celebration', () => {
    for (const [phase, tumbles] of [[IN_PLAY, true], [CELEBRATION, false]] as const) {
      const sc = scenario(1, { rollingSlowdownMetresPerSecond2: 0 }, (s, Q) => {
        park(Q, s, 0);
        placeBall(Q, s, -4, 0, Q.ballRadius, 5, 0, 0);
        place(Q, s, 1, 0, 0);
      }, { phase });
      run(sc, 50);
      expect(sc.s.terriers[1]!.lastBallContactTick, `phase ${phase}`).not.toBe(NEVER);
      expect(sc.s.terriers[1]!.tumble > 0 || sc.s.terriers[1]!.guard > 0, `phase ${phase}`).toBe(tumbles);
    }
  });
});

// --- Touches (design §6.9) ---

describe('touches (D-8; design §6.9)', () => {
  it('counts every contact episode in play, from sitting and tumbled terriers too', () => {
    for (const state of ['sitting', 'tumbled'] as const) {
      const sc = scenario(1, { rollingSlowdownMetresPerSecond2: 0 }, (s, Q) => {
        park(Q, s, 0);
        place(Q, s, 1, 0, 0);
        if (state === 'sitting') Object.assign(s.terriers[1]!, { sitting: true });
        else Object.assign(s.terriers[1]!, { tumble: Q.tumbleTicks });
        placeBall(Q, s, -3, 0, Q.ballRadius, 3, 0, 0); // under the bowling speed
      });
      // B1 absent, so a sitting one stays sitting; the ball reaches it in
      // about 0.7 s.
      run(sc, 90, (k) => (k === 1 ? null : 0));
      const B = sc.s.terriers[1]!;
      expect(B.touches, state).toBe(1);
      expect(B.touchingBall || B.lastBallContactTick !== NEVER, state).toBe(true);
      if (state === 'sitting') expect(B.sitting).toBe(true);
    }
  });
});

// --- The kickoff placement (D-8; design §6.4) ---

describe('the kickoff placement (D-8; design §6.4)', () => {
  it('ranks spots by ID, places every terrier at rest facing the ball with its timers reset, and keeps the history', () => {
    const s = placedMatch(P, 2, { seed: 9 });
    const sim = makeSim(P, 2);
    // Out of place and mid-action: spots swapped against the ranks, moving,
    // lunging, tumbled, out of zoomies, slipping, touching, with a history.
    s.terriers.forEach((t, k) => {
      Object.assign(t, {
        x: k, y: -k, z: 1.25, vx: 3, vy: -2, vz: 1, onFloor: false, heading: QUARTER_TURN, overheadRef: HALF_TURN, ballOverhead: true,
        zoomLocked: true, meter: 0, pounceWait: 30, lunge: 4, tumble: 20, guard: 30, touchingBall: true, headingChange: -5,
        prevInput: 0x123, touches: 7 + k, goals: k, lastBallContactTick: 50, lastTerrierContactTick: 51, takeOffTick: 52, landingTick: 53,
        lastPushDir: 99, lastPushTick: 54, anim: 4, animStart: 40, gait: 77, sitting: k === 3,
      });
    });
    Object.assign(s.terriers[0]!, { slipping: true, slipFrom: 4 });
    s.terriers.reverse(); // and out of (spot, pack) order
    for (const t of s.terriers) t.spot = 1 - t.spot;
    Object.assign(s.ball, { x: 5, y: 3, z: 2, vx: 1, vy: 1, vz: 1, onFloor: false });
    s.scorers = 0b1010;
    // And the tick's intents as step 4 leaves them for running, zooming terriers.
    for (const a of [sim.intents.driveOn, sim.intents.zooming, sim.intents.targetVx, sim.intents.targetVy]) a.fill(1);
    const ids = s.terriers.map((t) => t.id);
    placeKickoff(sim, s, 60);
    expect(s.terriers.map(slotOf)).toEqual([0, 1, 2, 3]);
    for (let k = 0; k < 4; k++) {
      const t = s.terriers[k]!;
      const mates = ids.filter((id) => s.terriers.find((u) => u.id === id)!.pack === t.pack).sort();
      expect(t.spot, `rank of ${k}`).toBe(mates.indexOf(t.id));
      const spot = P.kickoffSpots[t.pack][2]![t.spot]!;
      expect([t.x, t.y, t.z, t.vx, t.vy, t.vz, t.onFloor]).toEqual([spot[0], spot[1], P.terrierRadius, 0, 0, 0, true]);
      expect([t.overheadRef, t.ballOverhead, t.slipping, t.slipFrom, t.zoomLocked, t.meter]).toEqual([t.heading, false, false, -1, false, P.meterFull]);
      expect([t.pounceWait, t.lunge, t.tumble, t.guard, t.touchingBall, t.headingChange]).toEqual([0, 0, 0, 0, false, 0]);
      // Kept: the previous input, the counts and the animation history (D-10, D-16).
      expect([t.prevInput, t.lastBallContactTick, t.lastTerrierContactTick, t.takeOffTick, t.landingTick, t.lastPushDir, t.lastPushTick, t.gait])
        .toEqual([0x123, 50, 51, 52, 53, 99, 54, 77]);
      expect([t.sitting, t.anim, t.animStart]).toEqual(t.sitting ? [true, SITTING, 60] : [false, STANDING, 60]);
    }
    expect(s.terriers.filter((t) => t.sitting)).toHaveLength(1);
    expect([s.ball.x, s.ball.y, s.ball.z, s.ball.vx, s.ball.vy, s.ball.vz, s.ball.onFloor]).toEqual([0, 0, P.ballRadius, 0, 0, 0, true]);
    expect(s.scorers).toBe(0);
    expect([...sim.intents.driveOn, ...sim.intents.zooming, ...sim.intents.targetVx, ...sim.intents.targetVy]).toEqual(new Array(16).fill(0));
    // A terrier already standing keeps its animation's start.
    const again = s.terriers.find((t) => !t.sitting)!;
    placeKickoff(sim, s, 90);
    expect(again.animStart).toBe(60);
  });

  it('places a mirrored kickoff exactly mirrored, and resets a slip that named any slot', () => {
    const s = placedMatch(P, 4, { phase: KICKOFF_COUNTDOWN, seed: 3 });
    for (let k = 0; k < 8; k += 2) {
      const A = s.terriers[k]!, B = s.terriers[k + 1]!;
      expect([B.x, B.y, B.heading]).toEqual([-A.x, -A.y, (A.heading + HALF_TURN) >>> 0]);
    }
    // A vacated slot clears a slip that named it, and only that.
    Object.assign(s.terriers[0]!, { slipping: true, slipFrom: 3 });
    Object.assign(s.terriers[2]!, { slipping: true, slipFrom: 8 });
    vacate(s, 3);
    expect([s.terriers[0]!.slipping, s.terriers[0]!.slipFrom, s.terriers[2]!.slipFrom]).toEqual([false, -1, 8]);
  });

  it('removes a terrier with its slot vacated and the scorers kept naming their terriers', () => {
    const s = placedMatch(P, 2, { phase: WARM_UP });
    Object.assign(s.terriers[0]!, { slipping: true, slipFrom: 1 });
    Object.assign(s.terriers[3]!, { slipping: true, slipFrom: 2 });
    s.scorers = 0b1010; // B1 and B2
    const ids = s.terriers.map((t) => t.id);
    removeTerrier(s, 1);
    expect(s.terriers.map((t) => t.id)).toEqual([ids[0], ids[2], ids[3]]);
    expect([s.terriers[0]!.slipping, s.terriers[0]!.slipFrom, s.terriers[2]!.slipFrom]).toEqual([false, -1, 2]);
    expect(s.scorers).toBe(0b100); // B2, now list index 2
  });
});

// --- What the rules keep in every valid state (design §6.7) ---

describe("valid.ts's checks from the rules (design §6.7)", () => {
  /** The problems a change makes, and whether the decoder still takes the state. */
  const after = (phase: Phase, change: (s: MatchState) => void, opts: { matchMinutes?: number; members?: [number, number] } = { matchMinutes: 1 }): [string[], boolean] => {
    const s = placedMatch(P, 2, { phase, ...opts });
    s.tick = 500;
    change(s);
    return [stateProblems(s), decodeState(encodeState(s)) !== null];
  };

  it('allows overtime only from the kickoff countdown on', () => {
    for (const phase of [WARM_UP, START_COUNTDOWN] as const) {
      const [problems, decodes] = after(phase, (s) => { s.overtime = true; });
      expect(problems, `phase ${phase}`).toEqual([`overtime in phase ${phase}, before any kickoff countdown (D-8)`]);
      expect(decodes).toBe(false);
    }
    for (const phase of [KICKOFF_COUNTDOWN, IN_PLAY, CELEBRATION, ENDED] as const) {
      expect(after(phase, (s) => { s.overtime = true; s.clock = 0xffffffff; }), `phase ${phase}`).toEqual([[], true]);
    }
  });

  it("keeps the clock within the match outside overtime; a placed test state's 2^31 ticks included", () => {
    expect(after(IN_PLAY, (s) => { s.clock = 3600; })).toEqual([[], true]);
    const [problems, decodes] = after(IN_PLAY, (s) => { s.clock = 3601; });
    expect([problems, decodes]).toEqual([['the clock, 3601, is past the match length, 3600, outside overtime'], false]);
    expect(after(IN_PLAY, () => {}, {})).toEqual([[], true]);
  });

  it('keeps both packs full from the start countdown on, and finds nothing else wrong in a short pack', () => {
    expect(after(WARM_UP, () => {}, { members: [2, 1] })).toEqual([[], true]);
    for (const phase of [START_COUNTDOWN, KICKOFF_COUNTDOWN, IN_PLAY, CELEBRATION, ENDED] as const) {
      expect(after(phase, () => {}, { members: [2, 1] }), `phase ${phase}`).toEqual([['pack 1 has 1 of 2 terriers: from the start countdown on, both packs are full'], false]);
    }
    expect(after(IN_PLAY, () => {}, { members: [0, 2] })[0]).toEqual(['pack 0 has 0 of 2 terriers: from the start countdown on, both packs are full']);
  });

  it('keeps the tick under 2^31, the phase begun by it, and the scorers to a celebration or the end', () => {
    expect(after(IN_PLAY, (s) => { s.tick = 0x7fffffff; })).toEqual([[], true]);
    expect(after(IN_PLAY, (s) => { s.tick = 0x80000000; })).toEqual([
      ['the tick, 2147483648, is 2^31 or more: no match reaches it, and later ticks would leave a u32 (A.1)'], false,
    ]);
    // A countdown that began at a later tick would wait on it.
    expect(after(KICKOFF_COUNTDOWN, (s) => { s.phaseStart = 500; })).toEqual([[], true]);
    expect(after(KICKOFF_COUNTDOWN, (s) => { s.phaseStart = 501; })).toEqual([['the phase started at tick 501, after the tick, 500'], false]);
    for (const phase of [CELEBRATION, ENDED] as const) expect(after(phase, (s) => { s.scorers = 0b101; }), `phase ${phase}`).toEqual([[], true]);
    for (const phase of [WARM_UP, START_COUNTDOWN, KICKOFF_COUNTDOWN, IN_PLAY] as const) {
      expect(after(phase, (s) => { s.scorers = 0b101; }), `phase ${phase}`).toEqual([['the scorers, 5, outside a celebration or the end'], false]);
    }
  });

  it("keeps a terrier's join and last input at most the tick, so none is spared its sitting or removal (D-16)", () => {
    expect(after(IN_PLAY, (s) => { Object.assign(s.terriers[2]!, { joinTick: 500, lastInputTick: 500 }); })).toEqual([[], true]);
    for (const field of ['joinTick', 'lastInputTick'] as const) {
      expect(after(IN_PLAY, (s) => { s.terriers[2]![field] = 501; }), field).toEqual([['terrier 2 joined or was last heard from after the tick, 500'], false]);
    }
  });

  it('keeps a Ready within its expiry from the tick', () => {
    expect(after(WARM_UP, (s) => { s.terriers[1]!.readyUntil = 500 + P.readyExpiryTicks; })).toEqual([[], true]);
    const [problems, decodes] = after(WARM_UP, (s) => { s.terriers[1]!.readyUntil = 501 + P.readyExpiryTicks; });
    expect([problems, decodes]).toEqual([[`terrier 1 is ready until tick ${501 + P.readyExpiryTicks}, past the tick plus the Ready expiry`], false]);
  });
});
