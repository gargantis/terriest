// The tuning page's scenarios (design §9.3), built on src/core/sim/scenes.ts
// and cases.ts, so the page runs the scenes the tests and the metrics run:
// kickoffs and bot matches, C-18's pushes, the slip-out cases (C-21), the
// dribbles, simultaneous hits, bowling (Q-8, C-5), shots into the goal's
// netting (C-48), the touches the re-arm gap counts, the tumble guard,
// C-47's drift, the golden runs, and a recording played back. Each run
// steps the real simulation and the bot brain, with the measures the
// readouts and dev/tuning.metrics.ts read. DOM-free, so the model test and
// the metrics run it in Node.

import type { Config } from '../../src/config';
import { botCoat, botIds, botName } from '../../src/core/bot/bot-id';
import { type BotParams, botParams, type Brain, newBrain, think } from '../../src/core/bot/brain';
import { hostOf } from '../../src/core/bot/marks';
import { ballOnTerriers, DOWN_METRES, dribble, kickoffPinch, pushTime } from '../../src/core/sim/cases';
import { decodeState, hashState } from '../../src/core/sim/codec';
import { encodeInput, FRAME_BALL, FRAME_PITCH, frameOf, heldDirection, JOIN, READY, stepOf, type TickInput } from '../../src/core/sim/input';
import { datan2, dir, fractionOfTurn, HALF_TURN, QUARTER_TURN } from '../../src/core/sim/math';
import { simParams, type SimParams } from '../../src/core/sim/params';
import {
  ballDir, chasey, CORNER_SCRUM, dribbleScene, NOTHING, park, pinchScene, pitchDir, place, placeBall, placedMatch, pushScene, type RestCase,
  RESTING_BALL, restScene, ROLLING_BALL, type Scene, sceneInputs, sceneStart, SQUEEZE, touchReach, WALL_SCRUM,
} from '../../src/core/sim/scenes';
import { CANARY_SCRIPT, GOLDEN_SCRIPTS, type ScriptSpec, scriptTickInputs } from '../../src/core/sim/scripts';
import { CELEBRATION, genesis, KICKOFF_COUNTDOWN, type MatchState, slotOf, type Terrier } from '../../src/core/sim/state';
import { makeSim, type Sim, step } from '../../src/core/sim/step';
import { mirrorMismatches } from '../../src/core/sim/testing';
import { fromHex, type Recording } from './recording';

// --- Runs ---

/** A figure a run measures as it goes, for the readouts and the metrics. */
export interface Measure {
  readonly label: string;
  /** After every substep, from the state as the substep left it. */
  substep?(s: Readonly<MatchState>, run: Run): void;
  /** After every tick, with the inputs step was given. */
  tick?(s: Readonly<MatchState>, run: Run, inputs: readonly TickInput[]): void;
  /** Whether it has its figure: the metrics stop a run once all have. */
  done(): boolean;
  result(): Readonly<Record<string, number | boolean | string | null>>;
  text(): string;
}

/** A scenario's first state, everyone's inputs, its measures and its bots. */
export interface Setup {
  readonly s: MatchState;
  /** Tick t's inputs into out, from s, the state before the tick. */
  readonly inputs: (t: number, s: Readonly<MatchState>, out: TickInput[]) => void;
  readonly measures?: readonly Measure[];
  readonly brains?: readonly Brain[];
}

export interface Scenario {
  readonly id: string; // stable: the fragment names it
  readonly group: string;
  readonly label: string;
  /** The keyboard drives A1 from the start. */
  readonly keyboard?: boolean;
  /** Settings the scenario plays under instead of the page's: the hits'
   *  forces off, as hits.test.ts has them. */
  readonly over?: (c: Config) => Partial<Config>;
  readonly setup: (P: SimParams, B: BotParams, seed: number) => Setup;
  /** cases.ts's figure for the scene, as the gate's tests compute it, at the
   *  page's configuration. */
  readonly reference?: (c: Config) => string;
  /** The most ticks the metrics and the headless check run it for. */
  readonly length: number;
}

/** The keyboard's input for one terrier, in place of its scripted one. */
export interface Drive {
  readonly id: string;
  readonly input: number;
}

/** One run of a scenario: the real Sim and state, stepped tick by tick. */
export class Run {
  readonly scenario: Scenario;
  /** What it plays under: the page's configuration with the scenario's own changes. */
  readonly config: Config;
  readonly P: SimParams;
  readonly B: BotParams;
  readonly seed: number;
  readonly sim: Sim;
  readonly s: MatchState;
  readonly start: number; // the first state's tick
  readonly measures: readonly Measure[];
  readonly brains: readonly Brain[];
  /** The last substep's contacts. */
  contacts = 0;
  /** The last step's milliseconds, when the run has a clock. */
  stepMs = 0;
  private readonly inputsOf: Setup['inputs'];
  private readonly list: TickInput[] = [];
  private readonly now: (() => number) | undefined;

  constructor(scenario: Scenario, base: Config, seed: number, now?: () => number) {
    this.scenario = scenario;
    this.config = scenario.over ? { ...base, ...scenario.over(base) } : base;
    this.P = simParams(this.config);
    this.B = botParams(this.config);
    this.seed = seed;
    const setup = scenario.setup(this.P, this.B, seed);
    this.s = setup.s;
    this.start = setup.s.tick;
    this.inputsOf = setup.inputs;
    this.measures = setup.measures ?? [];
    this.brains = setup.brains ?? [];
    this.now = now;
    this.sim = makeSim(this.P, this.s.packSize);
    this.sim.probe = (st) => {
      this.contacts = this.sim.physics.cnt;
      for (const m of this.measures) m.substep?.(st, this);
    };
  }

  /** Ticks run so far. */
  get ticks(): number {
    return this.s.tick - this.start;
  }

  /** Every measure has its figure, or the scenario's length is run. */
  get done(): boolean {
    return this.ticks >= this.scenario.length || (this.measures.length > 0 && this.measures.every((m) => m.done()));
  }

  /** Steps a tick: everyone's inputs, the keyboard's in place of its
   *  terrier's. Returns the inputs step was given, until the next tick. */
  tick(drive: Drive | null = null): readonly TickInput[] {
    const list = this.list;
    list.length = 0;
    this.inputsOf(this.s.tick + 1, this.s, list);
    if (drive) {
      const k = list.findIndex((x) => x.id === drive.id);
      if (k >= 0) list[k] = { ...list[k]!, input: drive.input };
      else list.push({ id: drive.id, input: drive.input, events: 0 });
    }
    const t0 = this.now?.() ?? 0;
    step(this.sim, this.s, list);
    if (this.now) this.stepMs = this.now() - t0;
    for (const m of this.measures) m.tick?.(this.s, this, list);
    return list;
  }

  /** Runs to the scenario's length, or until every measure is done. */
  finish(): this {
    while (!this.done) this.tick();
    return this;
  }
}

/** A terrier's label by its slot: pack A's spot 0 is A1. */
export const labelOf = (T: Readonly<Terrier>): string => `${T.pack === 0 ? 'A' : 'B'}${T.spot + 1}`;

export function terrierByLabel(s: Readonly<MatchState>, label: string): Readonly<Terrier> | undefined {
  return s.terriers.find((T) => labelOf(T) === label);
}

/** Every measure's figures, keyed by its label. */
export function results(run: Run): Record<string, Readonly<Record<string, number | boolean | string | null>>> {
  return Object.fromEntries(run.measures.map((m) => [m.label, m.result()]));
}

// --- Measures ---

const hspeed = (b: { vx: number; vy: number }): number => Math.sqrt(b.vx * b.vx + b.vy * b.vy);
const fixed = (n: number | null, digits: number, unit = ''): string => (n === null ? '…' : `${n.toFixed(digits)}${unit}`);
const perSecond = (P: SimParams): number => P.config.ticksPerSecond * P.substeps;

/** A terrier–ball contact in the substep's list, by the terrier's slot. */
function touchingBall(run: Run, slot: number): boolean {
  const ph = run.sim.physics;
  for (let c = 0; c < ph.cnt; c++) if (ph.ci[c] === slot && ph.cj[c] === ph.ball) return true;
  return false;
}

function terrier(s: Readonly<MatchState>, id: string): Readonly<Terrier> | undefined {
  return s.terriers.find((T) => T.id === id);
}

/** §16's push time: from rest, until the ball reaches 95% of run speed,
 *  by the substep, as cases.ts's pushTime. */
export function pushTo95(P: SimParams): Measure {
  let sub = 0;
  let reached: number | null = null;
  let top = 0;
  return {
    label: 'time to 95% of run speed',
    substep(s) {
      sub++;
      if (reached !== null) return;
      const v = hspeed(s.ball);
      if (v > top) top = v;
      if (v >= 0.95 * P.runSpeed) reached = sub / perSecond(P);
    },
    done: () => reached !== null,
    result: () => ({ seconds: reached, top }),
    text: () => (reached === null ? `not yet (top ${top.toFixed(2)} m/s)` : `${reached.toFixed(3)} s`),
  };
}

/** The ball's landing on terriers and its time down to within 1 cm of its
 *  resting height, as cases.ts's Watch, and P8 when the scene is mirrored. */
export function downTime(P: SimParams, mirrored: boolean): Measure {
  const R = P.ballRadius;
  const reach = R + P.terrierRadius;
  let sub = 0;
  let landed = -1;
  let down = -1;
  let apex = 0;
  let prevZ = Infinity;
  let prevVz = 0;
  let mirror: string | null = null;
  return {
    label: 'down from a landing on terriers',
    substep(s) {
      sub++;
      const b = s.ball;
      apex = Math.max(apex, b.z);
      if (landed < 0) {
        if (prevZ > R + 1e-6 && prevVz < 0) {
          for (const t of s.terriers) {
            const dx = b.x - t.x, dy = b.y - t.y, dz = b.z - t.z;
            if (dz > 0 && dx * dx + dy * dy + dz * dz <= reach * reach * (1 + 1e-9)) {
              landed = sub;
              break;
            }
          }
        }
      } else if (down < 0 && b.z <= R + DOWN_METRES) {
        down = sub;
      }
      prevZ = b.z;
      prevVz = b.vz;
      if (mirrored && mirror === null) {
        const m = mirrorMismatches(s, 1);
        if (m.length > 0) mirror = `substep ${sub}: ${m[0]}`;
      }
    },
    done: () => down >= 0 && sub > down + perSecond(P),
    result: () => ({
      landed: landed < 0 ? null : landed / perSecond(P),
      down: landed < 0 || down < 0 ? null : (down - landed) / perSecond(P),
      apex, mirror,
    }),
    text: () => {
      if (landed < 0) return `not landed yet (apex ${apex.toFixed(2)} m)`;
      const m = mirrored ? (mirror === null ? ', mirrored' : `, NOT mirrored: ${mirror}`) : '';
      return down < 0 ? `landed, still up${m}` : `${((down - landed) / perSecond(P)).toFixed(3)} s after landing${m}`;
    },
  };
}

/** The ball's hops onto a dribbler: the contact angles from vertical while
 *  the ball is above its centre, as cases.ts's dribble, and its touches. */
export function hopAngles(P: SimParams, id: string): Measure {
  const reach = P.ballRadius + P.terrierRadius;
  let low = 180;
  let high = 0;
  let touches = 0;
  return {
    label: 'hops onto the dribbler',
    substep(s) {
      const t = terrier(s, id);
      if (!t) return;
      touches = t.touches;
      const b = s.ball;
      const dx = b.x - t.x, dy = b.y - t.y, dz = b.z - t.z;
      const h = Math.sqrt(dx * dx + dy * dy);
      if (h * h + dz * dz <= reach * reach * (1 + 1e-9) && dz > 0) {
        const a = (datan2(h, dz) * 360) / 4294967296; // degrees from vertical
        low = Math.min(low, a);
        high = Math.max(high, a);
      }
    },
    done: () => false,
    result: () => ({ lowest: low <= high ? low : null, highest: low <= high ? high : null, touches }),
    text: () => (low <= high ? `lowest ${low.toFixed(2)}° from vertical, highest ${high.toFixed(2)}°; ${touches} touches` : `no hop yet; ${touches} touches`),
  };
}

/** The ball's horizontal speed after a number of ticks: the hits' figure. */
export function ballSpeedAfter(ticks: number): Measure {
  let speed: number | null = null;
  return {
    label: `the ball's speed after ${ticks} ticks`,
    tick(s, run) {
      if (speed === null && run.ticks >= ticks) speed = hspeed(s.ball);
    },
    done: () => speed !== null,
    result: () => ({ speed }),
    text: () => fixed(speed, 3, ' m/s'),
  };
}

/** A goal's ball against the netting (§9.6): its centre's least distance out
 *  from the goal, its x for the +x goal, from the goal to the celebration's
 *  end, by the substep. Wholly behind the line needs it more than R behind. */
export function nettingRebound(P: SimParams): Measure {
  const line = P.pitch.goalLineX;
  const R = P.ballRadius;
  let goal = false;
  let over = false;
  let least = Infinity;
  return {
    label: 'back out of the netting',
    substep(s) {
      if (over) return;
      if (s.phase === CELEBRATION) {
        goal = true;
        least = Math.min(least, Math.abs(s.ball.x));
      } else if (goal) {
        over = true;
      }
    },
    done: () => over,
    result: () => ({ goal, leastX: goal ? least : null, wholly: goal && least > line + R, centreIn: goal && least > line, outBy: goal ? line + R - least : null }),
    text: () => {
      if (!goal) return 'no goal yet';
      const by = line + R - least;
      const where = by < 0 ? `wholly behind the line, ${(-by).toFixed(2)} m to spare` : least > line ? `its centre in, but ${by.toFixed(2)} m of it out` : `${(line - least).toFixed(2)} m back out onto the pitch`;
      return `least |x| ${least.toFixed(2)} m: ${where}${over ? '' : ' (so far)'}`;
    },
  };
}

/** Whether a terrier is tumbled, and the ball's horizontal speed toward it
 *  in the substep before their first contact: bowling's test (Q-8). */
export function bowledOver(P: SimParams, id: string): Measure {
  const reach = P.ballRadius + P.terrierRadius;
  let approach: number | null = null;
  let last = 0;
  let tumbledAt: number | null = null;
  return {
    label: 'bowled',
    substep(s, run) {
      const T = terrier(s, id);
      if (!T) return;
      const b = s.ball;
      const hx = T.x - b.x, hy = T.y - b.y, dz = T.z - b.z;
      const h = Math.sqrt(hx * hx + hy * hy);
      if (approach === null) {
        if (hx * hx + hy * hy + dz * dz <= reach * reach * (1 + 1e-9)) approach = last;
        else last = h > 0 ? (b.vx * hx + b.vy * hy) / h : 0;
      }
      if (tumbledAt === null && T.tumble > 0) tumbledAt = run.ticks;
    },
    done: () => tumbledAt !== null,
    result: () => ({ tumbled: tumbledAt !== null, approach }),
    text: () => `${tumbledAt === null ? 'not tumbled' : `tumbled at tick ${tumbledAt}`}; the ball came at it at ${fixed(approach, 2, ' m/s')} (bowling: ${P.bowlingSpeed} m/s)`,
  };
}

/** The ball's horizontal speed as it leaves a terrier after their first
 *  contact: C-5's leaving speeds. */
export function leavingSpeed(id: string): Measure {
  let touched = false;
  let speed: number | null = null;
  return {
    label: 'leaving speed',
    substep(s, run) {
      if (speed !== null) return;
      const T = terrier(s, id);
      if (!T) return;
      const now = touchingBall(run, slotOf(T));
      if (now) touched = true;
      else if (touched) speed = hspeed(s.ball);
    },
    done: () => speed !== null,
    result: () => ({ speed }),
    text: () => (speed === null ? (touched ? 'in contact' : 'not touched yet') : `${speed.toFixed(2)} m/s`),
  };
}

/** A terrier's touches: each contact episode, re-armed at the gap (D-8). */
export function touchCount(id: string): Measure {
  let touches = 0;
  return {
    label: 'touches',
    tick(s) {
      touches = terrier(s, id)?.touches ?? touches;
    },
    done: () => false,
    result: () => ({ touches }),
    text: () => String(touches),
  };
}

/** A terrier's touches when the ball, back off a wall, first meets it: the
 *  re-arm gap's second case (§9.6), which should be its second touch. */
export function reboundTouches(id: string): Measure {
  let bounced = false;
  let touches: number | null = null;
  let vy0: number | null = null;
  return {
    label: 'touches at the rebound',
    substep(s, run) {
      if (touches !== null) return;
      const T = terrier(s, id);
      if (!T) return;
      const vy = s.ball.vy;
      if (vy0 === null && vy !== 0) vy0 = vy;
      if (!bounced && vy0 !== null && vy * vy0 < 0) bounced = true;
      else if (bounced && touchingBall(run, slotOf(T))) touches = T.touches;
    },
    done: () => touches !== null,
    result: () => ({ touches }),
    text: () => (touches === null ? (bounced ? 'back off the wall' : 'on its way to the wall') : `${touches} when the rebound met it`),
  };
}

/** A terrier's share of time tumbled, and its shortest time up between a
 *  get-up and its next tumble, which the guard should keep at least the
 *  guard's length (Q-10's tumble guard). */
export function tumbleShare(P: SimParams, id: string): Measure {
  let ticks = 0;
  let down = 0;
  let tumbles = 0;
  let upFrom = -1;
  let shortest = Infinity;
  let was = false;
  return {
    label: 'time tumbled',
    tick(s) {
      const T = terrier(s, id);
      if (!T) return;
      ticks++;
      const now = T.tumble > 0;
      if (now) down++;
      if (now && !was) {
        tumbles++;
        if (upFrom >= 0) shortest = Math.min(shortest, ticks - upFrom);
      }
      if (!now && was) upFrom = ticks;
      was = now;
    },
    done: () => false,
    result: () => ({ share: ticks > 0 ? down / ticks : null, tumbles, shortestUp: Number.isFinite(shortest) ? shortest / P.config.ticksPerSecond : null }),
    text: () => `${ticks > 0 ? ((100 * down) / ticks).toFixed(0) : 0}% of the time, ${tumbles} tumbles; up at least ${Number.isFinite(shortest) ? `${(shortest / P.config.ticksPerSecond).toFixed(2)} s` : '…'} between (guard ${(P.guardTicks / P.config.ticksPerSecond).toFixed(2)} s)`,
  };
}

/** How far a rolling ball goes before it stops (A.5: a 3 m/s ball rolls 9 m). */
export function rollDistance(): Measure {
  let x0: number | null = null;
  let y0 = 0;
  let metres: number | null = null;
  return {
    label: 'roll',
    substep(s) {
      const b = s.ball;
      if (x0 === null) {
        x0 = b.x;
        y0 = b.y;
      }
      if (metres === null && b.vx === 0 && b.vy === 0) metres = Math.hypot(b.x - x0, b.y - y0);
    },
    done: () => metres !== null,
    result: () => ({ metres }),
    text: () => (metres === null ? 'rolling' : `stopped after ${metres.toFixed(3)} m`),
  };
}

/** Two terriers meeting head-on: their closing speed before, and their
 *  separating speed after the substep that meets (the terrier bounce). */
export function headOn(a: string, b: string): Measure {
  let closing = 0;
  let separating: number | null = null;
  return {
    label: 'head-on',
    substep(s, run) {
      if (separating !== null) return;
      const A = terrier(s, a), B = terrier(s, b);
      if (!A || !B) return;
      const ph = run.sim.physics;
      let met = false;
      for (let c = 0; c < ph.cnt; c++) {
        const i = ph.ci[c]!, j = ph.cj[c]!;
        if ((i === slotOf(A) && j === slotOf(B)) || (i === slotOf(B) && j === slotOf(A))) met = true;
      }
      const rel = B.vx - A.vx; // B is on A's +x side
      if (met) separating = rel;
      else closing = -rel;
    },
    done: () => separating !== null,
    result: () => ({ closing, separating, ratio: separating === null || closing === 0 ? null : separating / closing }),
    text: () => (separating === null ? `closing at ${closing.toFixed(2)} m/s` : `closing ${closing.toFixed(2)} m/s, separating ${separating.toFixed(2)} m/s: ${(separating / closing).toFixed(3)} of it`),
  };
}

/** The time from rest to run speed (REQUIREMENTS' Acceleration: 0.4 s). */
export function toRunSpeed(P: SimParams, id: string): Measure {
  let sub = 0;
  let seconds: number | null = null;
  return {
    label: 'run speed from rest',
    substep(s) {
      sub++;
      const T = terrier(s, id);
      if (seconds === null && T && hspeed(T) >= P.runSpeed - 1e-9) seconds = sub / perSecond(P);
    },
    done: () => seconds !== null,
    result: () => ({ seconds }),
    text: () => fixed(seconds, 3, ' s'),
  };
}

/** A pusher moving an idle terrier from rest: the idle one's acceleration
 *  from 0.25 s to 0.75 s (D-6: 3.5 m/s² at 15 against 8). */
export function pushedAcceleration(P: SimParams, id: string): Measure {
  let sub = 0;
  let v1: number | null = null;
  let a: number | null = null;
  const from = Math.round(0.25 * perSecond(P));
  const to = Math.round(0.75 * perSecond(P));
  return {
    label: "the pushed terrier's acceleration",
    substep(s) {
      sub++;
      const T = terrier(s, id);
      if (!T) return;
      if (sub === from) v1 = hspeed(T);
      if (sub === to && v1 !== null) a = (hspeed(T) - v1) / ((to - from) / perSecond(P));
    },
    done: () => a !== null,
    result: () => ({ acceleration: a }),
    text: () => fixed(a, 2, ' m/s²'),
  };
}

/** C-47: while a terrier holds sideways in ball view, how far it drifts
 *  from the ball each lap it circles it (D-7 accepts about 0.3 m a lap). */
export function lapDrift(id: string): Measure {
  let swept = 0;
  let angle = 0;
  let from = 0;
  let active = false;
  const laps: number[] = [];
  return {
    label: 'drift a lap, sideways in ball view',
    tick(s, _run, inputs) {
      const T = terrier(s, id);
      const x = inputs.find((i) => i.id === id);
      const sideways = T && x && heldDirection(x.input) && frameOf(x.input) === FRAME_BALL && (stepOf(x.input) === 8 || stepOf(x.input) === 24);
      if (!T || !sideways) {
        active = false;
        return;
      }
      const dx = T.x - s.ball.x, dy = T.y - s.ball.y;
      const a = Math.atan2(dy, dx);
      const d = Math.hypot(dx, dy);
      if (!active) {
        active = true;
        swept = 0;
        angle = a;
        from = d;
        return;
      }
      let da = a - angle;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      swept += da;
      angle = a;
      if (Math.abs(swept) >= 2 * Math.PI) {
        laps.push(d - from);
        swept = 0;
        from = d;
      }
    },
    done: () => laps.length >= 3,
    result: () => ({ laps: laps.length, last: laps.at(-1) ?? null, mean: laps.length > 0 ? laps.reduce((p, q) => p + q, 0) / laps.length : null }),
    text: () => (laps.length === 0 ? (active ? 'circling' : 'hold A or D in ball view to circle the ball') : `out by ${laps.map((x) => x.toFixed(3)).join(', ')} m, lap by lap`),
  };
}

// --- Inputs ---

type Inputs = Setup['inputs'];

/** A scene's members' inputs, handed over reversed (P4). */
const fromScene = (scene: Scene): Inputs => (t, s, out) => void sceneInputs(scene, s, t, out);

/** Every member present, holding nothing. */
const everyoneIdle: Inputs = (_t, s, out) => {
  for (const T of s.terriers) out.push({ id: T.id, input: NOTHING, events: 0 });
};

/** Each member's input by its list index in the first state, absent for null. */
function byIndex(s: Readonly<MatchState>, input: (k: number, t: number, s: Readonly<MatchState>) => number | null): Inputs {
  const ids = s.terriers.map((T) => T.id);
  return (t, st, out) => {
    for (let k = ids.length - 1; k >= 0; k--) {
      const v = input(k, t, st);
      if (v !== null) out.push({ id: ids[k]!, input: v, events: 0 });
    }
  };
}

/** A placed match's terriers become bots of the seed's host, as the marks'
 *  are: their IDs, names and coats, in the list's (spot, pack) order. */
function asBots(P: SimParams, B: BotParams, s: MatchState, seed: number): Brain[] {
  const ids = botIds(hostOf(seed));
  s.terriers.forEach((T, k) => {
    T.id = ids[k]!;
    T.name = botName(T.id);
    T.coat = botCoat(T.id, P.coatCount);
  });
  return s.terriers.map((T) => newBrain(T.id, T.prevInput, P, B));
}

const botInputs = (brains: readonly Brain[]): Inputs => (_t, s, out) => {
  for (const b of brains) out.push({ id: b.id, input: think(b, s), events: 0 });
};

/** A bot match's host re-sends its bots' READY inside the minute's expiry,
 *  as the regulation mark's does (src/core/bot/marks.ts). */
const READY_EVERY_SECONDS = 50;

/** A genesis match of bots, as the regulation mark plays one: each bot's
 *  JOIN and READY at tick 1, its READY again every 50 s (§16, design §8.5). */
function botMatchSetup(P: SimParams, B: BotParams, seed: number, packSize: number): Setup {
  const s = genesis({ packSize, matchMinutes: P.config.matchLengthDefaultMinutes }, P);
  const ids = botIds(hostOf(seed)).slice(0, 2 * packSize);
  const brains = ids.map((id) => newBrain(id, 0, P, B));
  const readyEvery = READY_EVERY_SECONDS * P.config.ticksPerSecond;
  const inputs: Inputs = (t, st, out) => {
    for (let k = 0; k < brains.length; k++) {
      const id = ids[k]!;
      const input = think(brains[k]!, st);
      if (t === 1) out.push({ id, input, events: JOIN | READY, joinPack: k & 1, coat: botCoat(id, P.coatCount), name: botName(id) });
      else out.push({ id, input, events: t % readyEvery === 1 ? READY : 0 });
    }
  };
  return { s, brains, inputs };
}

/** The pitch-frame step from one point toward another, of A.2's 32. */
function stepToward(fx: number, fy: number, tx: number, ty: number): number {
  return ((datan2(ty - fy, tx - fx) + 67108864) >>> 27) & 31; // half a step, 2^26, rounds to the nearest
}

// --- The scenarios ---

const S = (n: number | null, digits = 3): string => (n === null ? 'not reached' : `${n.toFixed(digits)} s`);
const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A scene from scenes.ts, its members' inputs its own. */
function sceneScenario(group: string, id: string, scene: Scene, length: number, more: Partial<Scenario> = {}, measures?: (P: SimParams, s: MatchState) => Measure[]): Scenario {
  return {
    id, group, label: scene.name, length, ...more,
    setup: (P, _B, seed) => {
      const s = sceneStart(scene, P, seed);
      return { s, inputs: fromScene(scene), measures: measures?.(P, s) ?? [] };
    },
  };
}

const KICKOFFS = 'Kickoffs and matches';
const PUSHES = 'Pushes (C-18)';
const SLIP = 'Slip-out and dribbles (C-21)';
const HITS = 'Simultaneous hits';
const BOWLING = 'Bowling (Q-8, C-5)';
const NETTING = "Shots into the goal's netting (C-48)";
const CONTACTS = 'Contacts, forces and touches';
const GOLDENS = 'Golden runs';

function kickoffs(): Scenario[] {
  const out: Scenario[] = [];
  for (let n = 1; n <= 4; n++) {
    out.push({
      id: `kickoff-${n}-bots`, group: KICKOFFS, label: `A kickoff at ${n} a side, bots`, length: 3600,
      setup: (P, B, seed) => {
        const s = placedMatch(P, n, { phase: KICKOFF_COUNTDOWN, seed, matchMinutes: P.config.matchLengthDefaultMinutes });
        const brains = asBots(P, B, s, seed);
        return { s, brains, inputs: botInputs(brains) };
      },
    });
    out.push({
      id: `kickoff-${n}-chasey`, group: KICKOFFS, label: `A kickoff at ${n} a side, seeded chasey`, length: 3600,
      setup: (P, _B, seed) => {
        const s = placedMatch(P, n, { phase: KICKOFF_COUNTDOWN, seed, matchMinutes: P.config.matchLengthDefaultMinutes });
        const scene: Scene = { name: 'chasey', packSize: n, phase: KICKOFF_COUNTDOWN, mirrored: false, input: chasey(seed, 'all') };
        return { s, inputs: fromScene(scene) };
      },
    });
  }
  out.push({
    id: 'bot-match-2', group: KICKOFFS, label: "A 2-a-side bot match: the regulation mark's, by seed", length: 3600,
    setup: (P, B, seed) => botMatchSetup(P, B, seed, 2),
  });
  out.push({
    id: 'bot-match-4', group: KICKOFFS, label: 'A 4-a-side bot match', length: 3600,
    setup: (P, B, seed) => botMatchSetup(P, B, seed, 4),
  });
  out.push({
    id: 'practice', group: KICKOFFS, label: 'Practice: the keyboard on A1 against a bot', keyboard: true, length: 3600,
    setup: (P, B, seed) => {
      const s = placedMatch(P, 1, { phase: KICKOFF_COUNTDOWN, seed, matchMinutes: P.config.matchLengthDefaultMinutes });
      const bot = botIds(hostOf(seed))[0]!;
      const T = s.terriers[1]!;
      T.id = bot;
      T.name = botName(bot);
      T.coat = botCoat(bot, P.coatCount);
      const brain = newBrain(bot, 0, P, B);
      const person = s.terriers[0]!.id;
      return {
        s, brains: [brain],
        inputs: (_t, st, out) => {
          out.push({ id: person, input: NOTHING, events: 0 });
          out.push({ id: bot, input: think(brain, st), events: 0 });
        },
      };
    },
  });
  return out;
}

function pushes(): Scenario[] {
  const out: Scenario[] = [];
  const layouts: ['train' | 'line' | 'round', number[]][] = [['train', [1, 2, 4]], ['line', [2, 4]], ['round', [2, 4]]];
  for (const [layout, counts] of layouts) {
    for (const m of counts) {
      for (const frame of ['pitch', 'ball'] as const) {
        out.push(sceneScenario(PUSHES, `push-${layout}-${m}-${frame}`, pushScene(layout, m, frame), 600, {
          reference: (c) => S(pushTime(layout, m, frame, c, 600).seconds),
        }, (P) => [pushTo95(P)]));
      }
    }
  }
  return out;
}

function slipOuts(): Scenario[] {
  const out: Scenario[] = [];
  for (let packSize = 1; packSize <= 4; packSize++) {
    for (const thetaDeg of [30, 45]) {
      for (const holding of ['ball frame', 'pitch frame, opposite'] as const) {
        const c: RestCase = { packSize, thetaDeg, holding };
        out.push(sceneScenario(SLIP, `rest-${packSize}-${thetaDeg}-${holding === 'ball frame' ? 'ball' : 'opposite'}`, restScene(c), 480, {
          reference: (k) => S(ballOnTerriers(c, 6, k).down),
        }, (P) => [downTime(P, true)]));
      }
    }
  }
  for (const thetaDeg of [20, 30, 40, 50]) {
    const c: RestCase = { packSize: 1, thetaDeg, holding: 'sitting' };
    out.push(sceneScenario(SLIP, `sitting-${thetaDeg}`, restScene(c), 480, { reference: (k) => S(ballOnTerriers(c, 6, k).down) }, (P) => [downTime(P, true)]));
  }
  for (let n = 1; n <= 4; n++) {
    for (const zoomies of [false, true]) {
      out.push(sceneScenario(SLIP, `pinch-${n}${zoomies ? '-zoomies' : ''}`, pinchScene(n, zoomies), 900, {
        reference: (k) => S(kickoffPinch(n, zoomies, 8, k).down),
      }, (P) => [downTime(P, true)]));
    }
  }
  out.push(sceneScenario(SLIP, 'squeeze', SQUEEZE, 1200));
  const dribbles: [string, 'ball' | 'pitch', boolean, number, number | undefined, number][] = [
    ['dribble-ball-run', 'ball', false, 0, undefined, 0],
    ['dribble-ball-zoomies', 'ball', true, 0, undefined, 0],
    ['dribble-pitch-run', 'pitch', false, 0, undefined, 0],
    ['dribble-pitch-zoomies', 'pitch', true, 0, undefined, 0],
    // slipout.test.ts's lowest hop: ball view, 3 steps aside, zoomies from 9 m/s.
    ['dribble-lowest-hop', 'ball', true, 0.1125, 9, 3],
  ];
  for (const [id, frame, zoomies, runUp, from, stepOff] of dribbles) {
    out.push(sceneScenario(SLIP, id, dribbleScene(frame, zoomies, runUp, from, stepOff), 360, {
      reference: (k) => `lowest hop ${dribble(frame, zoomies, runUp, k, from, stepOff).hopAngles[0].toFixed(2)}° from vertical`,
    }, (P, s) => [hopAngles(P, s.terriers[0]!.id)]));
  }
  return out;
}

/** hits.test.ts's k hitters at run speed into a resting ball, all meeting
 *  it in one substep, from the floor or level, side by side or aimed at
 *  its centre, with the drive, idle friction and the rolling slowdown off. */
function hits(): Scenario[] {
  const out: Scenario[] = [];
  const along = [[0], [-0.26, 0.26], [-0.52, 0, 0.52], [-0.78, -0.26, 0.26, 0.78]];
  const angles = [[0], [-25, 25], [-35, 0, 35], [-55, -20, 20, 55]];
  for (const level of [false, true]) {
    for (const layout of ['parallel', 'centre'] as const) {
      for (let k = 1; k <= 4; k++) {
        out.push({
          id: `hits-${k}-${level ? 'level' : 'floor'}-${layout}`, group: HITS,
          label: `${k} hitter${k > 1 ? 's' : ''} ${level ? 'level' : 'from the floor'}, ${layout === 'parallel' ? 'side by side' : 'aimed at the centre'}`,
          length: 30,
          over: () => ({ accelerationMetresPerSecond2: 0, idleFrictionMetresPerSecond2: 0, rollingSlowdownMetresPerSecond2: 0, ...(level ? { gravityMetresPerSecond2: 0 } : {}) }),
          setup: (P) => {
            const s = placedMatch(P, 4);
            for (let j = 0; j < 8; j++) park(P, s, j);
            placeBall(P, s, 0, 0);
            const R = P.ballRadius, r = P.terrierRadius;
            const dz = level ? 0 : R - r;
            const z = level ? R : r;
            const v = P.runSpeed;
            // Each starts 20.5 substeps of travel short, so all first overlap in substep 21.
            const lead = v * P.dt * 20.5;
            const d = new Float64Array(2);
            for (let j = 0; j < k; j++) {
              const T = s.terriers[2 * j]!;
              if (layout === 'parallel') {
                const y = along[k - 1]![j]!;
                place(P, s, 2 * j, -Math.sqrt((R + r) * (R + r) - dz * dz - y * y) - lead, y, z);
                T.vx = v;
              } else {
                const deg = angles[k - 1]![j]!;
                dir((HALF_TURN + fractionOfTurn(deg < 0 ? 360 + deg : deg, 360)) >>> 0, d);
                const reach = Math.sqrt((R + r) * (R + r) - dz * dz) + lead;
                place(P, s, 2 * j, reach * d[0]!, reach * d[1]!, z);
                T.vx = -v * d[0]!;
                T.vy = -v * d[1]!;
              }
            }
            return { s, inputs: everyoneIdle, measures: [ballSpeedAfter(30)] };
          },
        });
      }
    }
  }
  return out;
}

function bowling(): Scenario[] {
  const out: Scenario[] = [];
  for (const v of [5, 3]) {
    out.push({
      id: `bowling-shot-${v}`, group: BOWLING, label: `A ball rolled at a standing terrier at ${v} m/s`, length: 180,
      setup: (P) => {
        const s = placedMatch(P, 1);
        park(P, s, 1);
        place(P, s, 0, 0, -6);
        s.terriers[0]!.heading = HALF_TURN;
        s.terriers[0]!.overheadRef = HALF_TURN;
        placeBall(P, s, -4, -6, P.ballRadius, v, 0, 0);
        return { s, inputs: everyoneIdle, measures: [bowledOver(P, s.terriers[0]!.id)] };
      },
    });
  }
  const zoomiesPush = dribbleScene('pitch', true, 2, 9);
  out.push(sceneScenario(BOWLING, 'c5-zoomies-push', { ...zoomiesPush, name: "C-5: a push at zoomies speed, the ball's leaving speed" }, 240, {}, (_P, s) => [leavingSpeed(s.terriers[0]!.id)]));
  const dribbling = dribbleScene('ball', false);
  out.push({
    id: 'c5-dribble-into-rival', group: BOWLING, label: 'C-5: a ball dribbled at a run meets a standing rival', length: 360,
    setup: (P) => {
      const s = sceneStart(dribbling, P);
      place(P, s, 1, 0, 0);
      s.terriers[1]!.heading = HALF_TURN;
      s.terriers[1]!.overheadRef = HALF_TURN;
      return { s, inputs: fromScene(dribbling), measures: [bowledOver(P, s.terriers[1]!.id)] };
    },
  });
  out.push({
    id: 'c5-pounce-from-air', group: BOWLING, label: "C-5: a pounce from the air into a resting ball, its leaving speed", length: 120,
    setup: (P) => {
      const s = placedMatch(P, 1);
      park(P, s, 1);
      place(P, s, 0, -2, 0);
      s.terriers[0]!.heading = 0;
      s.terriers[0]!.overheadRef = 0;
      placeBall(P, s, 0, 0);
      // Jump at once; pounce in the air at tick 10, on the way up.
      const inputs = byIndex(s, (k, t) => (k === 0 ? encodeInput({ jump: 1, pounce: t >= 10 ? 1 : 0 }) : NOTHING));
      return { s, inputs, measures: [leavingSpeed(s.terriers[0]!.id)] };
    },
  });
  return out;
}

/** §9.6's netting shots: from 3 m in front of the +x goal line, aimed
 *  through the mouth's centre at an angle in plan, rolling, high (centre
 *  2 m up) or lobbed (4 m/s up), with nobody near: the architect's. */
export function nettingShot(speed: number, angleDeg: number, kind: 'rolling' | 'high' | 'lobbed'): Scenario {
  return {
    id: `netting-${speed}-${angleDeg}-${kind}`, group: NETTING, label: `A ${kind} shot at ${speed} m/s, ${angleDeg}° in plan`, length: 600,
    setup: (P) => {
      const s = placedMatch(P, 1);
      park(P, s, 0);
      park(P, s, 1);
      const a = (angleDeg * Math.PI) / 180;
      const back = 3;
      const z = kind === 'high' ? 2 : P.ballRadius;
      placeBall(P, s, P.pitch.goalLineX - back, -Math.tan(a) * back, z, speed * Math.cos(a), speed * Math.sin(a), kind === 'lobbed' ? 4 : 0);
      return { s, inputs: everyoneIdle, measures: [nettingRebound(P)] };
    },
  };
}

export const NETTING_SPEEDS = [5, 10];
export const NETTING_ANGLES = [0, 20, 35];
export const NETTING_KINDS = ['rolling', 'high', 'lobbed'] as const;

function nettingShots(): Scenario[] {
  return NETTING_SPEEDS.flatMap((v) => NETTING_ANGLES.flatMap((a) => NETTING_KINDS.map((kind) => nettingShot(v, a, kind))));
}

/** 1 a side, placed in play, both terriers parked; setup places what the scenario needs. */
function placed(P: SimParams, setup: (s: MatchState) => void): MatchState {
  const s = placedMatch(P, 1);
  park(P, s, 0);
  park(P, s, 1);
  setup(s);
  return s;
}

function face(s: MatchState, k: number, heading: number): void {
  s.terriers[k]!.heading = heading >>> 0;
  s.terriers[k]!.overheadRef = heading >>> 0;
}

/** The re-arm gap's cases (§9.6): a push from contact for 2 s should count
 *  one touch; a ball shot at a wall from 2 m and met on its rebound, two. */
function touchScenarios(): Scenario[] {
  const out: Scenario[] = [];
  for (const frame of ['ball', 'pitch'] as const) {
    for (const zoomies of [false, true]) {
      const scene = dribbleScene(frame, zoomies);
      out.push(sceneScenario(CONTACTS, `touches-push-${frame}-${zoomies ? 'zoomies' : 'run'}`,
        { ...scene, name: `Touches: a push from contact for 2 s, ${frame} frame${zoomies ? ', zoomies' : ''}` }, 120, {},
        (_P, s) => [touchCount(s.terriers[0]!.id)]));
    }
  }
  out.push({
    id: 'touches-wall-rebound', group: CONTACTS, label: 'Touches: a ball pounced at a wall from 2 m, then met on its rebound', length: 180,
    setup: (P) => {
      // The ball's surface 2 m from the +y wall; the terrier 0.5 m short of
      // it pounces at once and holds nothing, then, once the ball is back
      // off the wall, holds at it in the ball frame to meet it.
      const y = P.pitch.shape.widthMetres / 2 - P.ballRadius - 2;
      const s = placed(P, (st) => {
        placeBall(P, st, 0, y);
        place(P, st, 0, 0, y - touchReach(P) - 0.5);
        face(st, 0, QUARTER_TURN);
      });
      const shoot = encodeInput({ pounce: 1 });
      const meet = encodeInput({ step: 0, frame: FRAME_BALL, pounce: 1 });
      let back = false;
      const inputs = byIndex(s, (k, _t, st) => {
        if (k !== 0) return NOTHING;
        if (st.ball.vy < 0) back = true;
        return back ? meet : shoot;
      });
      return { s, inputs, measures: [reboundTouches(s.terriers[0]!.id), touchCount(s.terriers[0]!.id)] };
    },
  });
  return out;
}

function contacts(): Scenario[] {
  const out: Scenario[] = [
    sceneScenario(CONTACTS, 'resting-ball', RESTING_BALL, 3000),
    sceneScenario(CONTACTS, 'rolling-ball', ROLLING_BALL, 3000),
    sceneScenario(CONTACTS, 'wall-scrum', WALL_SCRUM, 3000),
    sceneScenario(CONTACTS, 'corner-scrum', CORNER_SCRUM, 3000),
  ];
  out.push({
    id: 'roll-3', group: CONTACTS, label: "A 3 m/s ball's roll (A.5: 9 m)", length: 900,
    setup: (P) => {
      const s = placed(P, (st) => placeBall(P, st, -12, 0, P.ballRadius, 3, 0, 0));
      return { s, inputs: everyoneIdle, measures: [rollDistance()] };
    },
  });
  out.push({
    id: 'head-on', group: CONTACTS, label: 'Terriers meeting head-on at run speed', length: 120,
    setup: (P) => {
      const s = placed(P, (st) => {
        place(P, st, 0, -3, 6);
        place(P, st, 1, 3, 6);
        face(st, 0, 0);
        face(st, 1, HALF_TURN);
        st.terriers[0]!.vx = P.runSpeed;
        st.terriers[1]!.vx = -P.runSpeed;
      });
      return { s, inputs: byIndex(s, (k) => (k === 0 ? pitchDir(0) : pitchDir(16))), measures: [headOn(s.terriers[0]!.id, s.terriers[1]!.id)] };
    },
  });
  out.push({
    id: 'run-from-rest', group: CONTACTS, label: 'Run speed from rest (0.4 s at 15 m/s²)', length: 120,
    setup: (P) => {
      const s = placed(P, (st) => place(P, st, 0, -10, -6));
      return { s, inputs: byIndex(s, (k) => (k === 0 ? pitchDir(0) : NOTHING)), measures: [toRunSpeed(P, s.terriers[0]!.id)] };
    },
  });
  out.push({
    id: 'push-idle', group: CONTACTS, label: 'A pusher moving an idle terrier (D-6: 3.5 m/s²)', length: 60,
    setup: (P) => {
      const s = placed(P, (st) => {
        place(P, st, 0, -10 - 2 * P.terrierRadius, -6);
        place(P, st, 1, -10, -6);
      });
      return { s, inputs: byIndex(s, (k) => (k === 0 ? pitchDir(0) : NOTHING)), measures: [pushedAcceleration(P, s.terriers[1]!.id)] };
    },
  });
  out.push(...touchScenarios());
  out.push({
    id: 'alternating-pounces', group: CONTACTS, label: 'Two rivals pouncing in turn on a still terrier (the tumble guard)', length: 1800,
    setup: (P) => {
      const s = placedMatch(P, 2);
      park(P, s, 2);
      place(P, s, 0, 0, -8);
      place(P, s, 1, -1.5, -8);
      place(P, s, 3, 1.5, -8);
      face(s, 1, 0);
      face(s, 3, HALF_TURN);
      const target = s.terriers[0]!.id;
      const rivals = [s.terriers[1]!.id, s.terriers[3]!.id];
      const presses = [0, 0];
      let turn = 0;
      // As soon as a pounce could tumble the target, the rival whose turn it
      // is pounces, if it can; each holds toward the target meanwhile.
      const inputs: Inputs = (_t, st, out) => {
        const A = terrier(st, target)!;
        for (const T of st.terriers) {
          const r = rivals.indexOf(T.id);
          if (r < 0) {
            out.push({ id: T.id, input: NOTHING, events: 0 });
            continue;
          }
          const ready = A.tumble === 0 && A.guard === 0 && T.lunge === 0 && T.pounceWait === 0 && T.tumble === 0 && !T.sitting;
          if (r === turn && ready) {
            presses[r]!++;
            turn = 1 - turn;
          }
          out.push({ id: T.id, input: encodeInput({ step: stepToward(T.x, T.y, A.x, A.y), frame: FRAME_PITCH, pounce: presses[r]! }), events: 0 });
        }
      };
      return { s, inputs, measures: [tumbleShare(P, target)] };
    },
  });
  out.push({
    id: 'c47-circle', group: CONTACTS, label: 'C-47: holding sideways in ball view, 3 m from a resting ball', length: 1200,
    setup: (P) => {
      const s = placed(P, (st) => {
        place(P, st, 0, -3, 0);
        face(st, 0, 0);
      });
      return { s, inputs: byIndex(s, (k) => (k === 0 ? ballDir(8) : NOTHING)), measures: [lapDrift(s.terriers[0]!.id)] };
    },
  });
  return out;
}

/** A golden run (design §7.1): its script's own start and inputs. */
function goldenScenario(spec: ScriptSpec): Scenario {
  return {
    id: `golden-${slug(spec.name)}`, group: GOLDENS, label: spec.name, length: spec.ticks,
    setup: (P) => {
      const s = spec.start === 'genesis' ? genesis({ packSize: spec.packSize, matchMinutes: spec.matchMinutes }, P) : sceneStart(spec.start, P, spec.seed);
      return { s, inputs: (t, st, out) => void scriptTickInputs(spec, t, st, out) };
    },
  };
}

export const SCENARIOS: readonly Scenario[] = [
  ...kickoffs(),
  ...pushes(),
  ...slipOuts(),
  ...hits(),
  ...bowling(),
  ...nettingShots(),
  ...contacts(),
  ...[...GOLDEN_SCRIPTS, CANARY_SCRIPT].map(goldenScenario),
];

export const scenarioOf = (id: string): Scenario | undefined => SCENARIOS.find((s) => s.id === id);

// --- A recording, played back ---

/** Whether the recording's last tick reached its final hash. */
function finalHash(r: Recording, ticks: number): Measure {
  let got: string | null = null;
  return {
    label: 'final hash',
    tick(s, run) {
      if (got === null && run.ticks === ticks) got = hashState(s);
    },
    done: () => got !== null,
    result: () => ({ matches: got === null ? null : got === r.final, hash: got }),
    text: () => (got === null ? `${ticks} ticks to play` : got === r.final ? `${got}: the recording's` : `${got}, NOT the recording's ${r.final}`),
  };
}

/** A recording as a scenario: its own configuration, its start, and its
 *  inputs tick by tick, then nothing. */
export function recordingScenario(r: Recording, name: string): Scenario {
  return {
    id: 'recording', group: 'Recordings', label: `Recording: ${name}`, length: r.ticks.length,
    over: () => r.config,
    setup: (P) => {
      const bytes = fromHex(r.start);
      const s = bytes && decodeState(bytes, P);
      if (!s) throw new Error("the recording's start doesn't decode under its configuration");
      const t0 = s.tick;
      return {
        s,
        inputs: (t, _st, out) => {
          for (const x of r.ticks[t - t0 - 1] ?? []) out.push(x);
        },
        measures: [finalHash(r, r.ticks.length)],
      };
    },
  };
}
