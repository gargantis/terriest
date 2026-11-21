// One golden replay (PLAN §16 Determinism, D-23; design §1.15, §7.2): a
// scripted run from tick 0, its hash every CHECKPOINT_EVERY ticks, its
// final hash, what it ended as, the events seen at tick ends, and the
// solver's counters. Moved out of golden.ts, unchanged, by M4's phase 2a
// (M4's design §1.50, M4-Q5), so the canary's replay, which the page's
// module holds, reaches none of the golden runs: golden.ts's suite imports
// them, and re-exports this. It ships in the page's module and the
// determinism chunk, so exact operations only (D-1).

import { hashState } from './codec';
import type { TickInput } from './input';
import { defaultParams, type SimParams } from './params';
import { sceneStart } from './placing';
import { scriptTickInputs } from './script-inputs';
import type { ScriptSpec } from './scripts';
import { genesis, type MatchState, ZOOMING } from './state';
import { makeSim, step } from './step';

export const CHECKPOINT_EVERY = 500; // not a setting

export interface GoldenResult {
  name: string;
  /** The hash every CHECKPOINT_EVERY ticks. */
  checkpoints: string[];
  final: string;
  // The state the run ended in.
  tick: number;
  phase: number;
  overtime: boolean;
  score: [number, number];
  terriers: number;
  // Events seen at tick ends: the score rising, lunges and tumbles begun,
  // the ball's last hit tick changing, and terriers zooming, counted a
  // terrier a tick.
  goals: number;
  pounces: number;
  tumbles: number;
  hits: number;
  zooms: number;
  // The solver's counters (design §1.8).
  floorBounces: number;
  pieceBounces: number;
  pushes: number;
  contacts: number;
  maxContacts: number;
  slipOuts: number;
  /** Bit p: phase p was seen at a tick's end. */
  phasesSeen: number;
  overtimeSeen: boolean;
  /** The checks that didn't hold, or weren't reached. */
  unmet: string[];
}

/** The script's state at tick 0: genesis, or its placed scene. */
function scriptStart(spec: ScriptSpec, P: SimParams): MatchState {
  if (spec.start === 'genesis') return genesis({ packSize: spec.packSize, matchMinutes: spec.matchMinutes }, P);
  if (spec.start.packSize !== spec.packSize) throw new Error(`${spec.name}: a ${spec.start.packSize}-a-side scene for a ${spec.packSize}-a-side run`);
  return sceneStart(spec.start, P, spec.seed);
}

/** Replays a script from tick 0 and records its result. */
export function replay(spec: ScriptSpec, P: SimParams = defaultParams): GoldenResult {
  const sim = makeSim(P, spec.packSize);
  const s = scriptStart(spec, P);
  const checks = spec.checks ?? [];
  // Each check's index, by tick, and whether it held.
  const order = checks.map((_, k) => k).sort((a, b) => checks[a]!.tick - checks[b]!.tick || a - b);
  const held = checks.map(() => false);
  let next = 0;
  // Whether each terrier, by ID, was lunging or waiting, and tumbled or
  // guarded, before the tick: a pounce begins only from neither, and so
  // does a tumble (D-6), so one that is either after the tick began it then.
  const ids: string[] = [];
  const pouncing: boolean[] = [];
  const tumbling: boolean[] = [];
  const inputs: TickInput[] = [];
  const checkpoints: string[] = [];
  let goals = 0, pounces = 0, tumbles = 0, hits = 0, zooms = 0, phasesSeen = 0;
  let overtimeSeen = false;
  for (let t = 1; t <= spec.ticks; t++) {
    const scored = s.score[0] + s.score[1];
    ids.length = 0;
    pouncing.length = 0;
    tumbling.length = 0;
    for (const T of s.terriers) {
      ids.push(T.id);
      pouncing.push(T.lunge > 0 || T.pounceWait > 0);
      tumbling.push(T.tumble > 0 || T.guard > 0);
    }
    step(sim, s, scriptTickInputs(spec, t, s, inputs));
    goals += s.score[0] + s.score[1] - scored;
    if (s.ball.lastHitTick === t) hits++;
    for (const T of s.terriers) {
      const k = ids.indexOf(T.id);
      if (!(k >= 0 && pouncing[k]) && (T.lunge > 0 || T.pounceWait > 0)) pounces++;
      if (!(k >= 0 && tumbling[k]) && (T.tumble > 0 || T.guard > 0)) tumbles++;
      if (T.anim === ZOOMING) zooms++;
    }
    phasesSeen |= 1 << s.phase;
    if (s.overtime) overtimeSeen = true;
    if (t % CHECKPOINT_EVERY === 0) checkpoints.push(hashState(s));
    while (next < order.length && checks[order[next]!]!.tick <= t) {
      const k = order[next++]!;
      held[k] = checks[k]!.tick === t && checks[k]!.holds(s);
    }
  }
  const st = sim.physics.stats;
  return {
    name: spec.name, checkpoints, final: hashState(s),
    tick: s.tick, phase: s.phase, overtime: s.overtime, score: [s.score[0], s.score[1]], terriers: s.terriers.length,
    goals, pounces, tumbles, hits, zooms,
    floorBounces: st.floorBounces, pieceBounces: st.pieceBounces, pushes: st.pushes,
    contacts: st.contacts, maxContacts: st.maxContacts, slipOuts: st.slipOuts,
    phasesSeen, overtimeSeen,
    unmet: checks.filter((_, k) => !held[k]).map((c) => `tick ${c.tick}: ${c.what}`),
  };
}
