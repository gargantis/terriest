// The golden replays (PLAN §16 Determinism, D-23; design §1.15, §7.2): each
// scripted run's hash every 500 ticks, its final hash, what it ended as,
// the events seen at tick ends, and the solver's counters, which Node and
// every engine must reproduce exactly (goldens.json); what a run's result
// says it failed to cover; and the canary's hash. The M0 spike's golden.ts
// and roslambo's, with the events counted and the coverage asserted.
// Exact operations only (D-1): it ships in the determinism chunk, and from
// M4 the canary runs at start-up.

import { hashState } from './codec';
import type { TickInput } from './input';
import { defaultParams, type SimParams } from './params';
import { sceneStart } from './scenes';
import { CANARY_SCRIPT, GOLDEN_SCRIPTS, scriptTickInputs, type ScriptSpec } from './scripts';
import { ENDED, genesis, type MatchState, ZOOMING } from './state';
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

/** What goldens.json holds (design §7.2). */
export interface Goldens {
  codec: number;
  checkpointEvery: number;
  canary: string;
  runs: GoldenResult[];
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

/** Every golden run, in order. */
export function goldenSuite(P: SimParams = defaultParams): GoldenResult[] {
  return GOLDEN_SCRIPTS.map((spec) => replay(spec, P));
}

/** The canary's final hash (D-23). */
export function canaryHash(P: SimParams = defaultParams): string {
  return replay(CANARY_SCRIPT, P).final;
}

const PHASE_NAMES = ['warm-up', 'the start countdown', 'a kickoff countdown', 'play', 'a celebration', 'the end'] as const;

/** What a run's result says it didn't cover of its spec; [] when it
 *  covered it all (design §7.2). */
export function coverageProblems(spec: ScriptSpec, r: GoldenResult): string[] {
  const problems: string[] = [];
  const c = spec.covers;
  if (r.name !== spec.name) problems.push(`the result is ${r.name}'s, not ${spec.name}'s`);
  const counts: [string, number, number | undefined][] = [
    ['goals', r.goals, c.goals], ['pounces', r.pounces, c.pounces], ['tumbles', r.tumbles, c.tumbles], ['hits', r.hits, c.hits],
    ['terrier-ticks zooming', r.zooms, c.zooms],
    ['bounces off the floor or a piece', r.floorBounces + r.pieceBounces, c.bounces], ['push substeps', r.pushes, c.pushes],
    ['slip-outs', r.slipOuts, c.slipOuts], ['the most contacts in a substep', r.maxContacts, c.maxContacts],
  ];
  for (const [what, got, least] of counts) if (least !== undefined && !(got >= least)) problems.push(`${what}: ${got}, not at least ${least}`);
  for (const p of c.phases ?? []) if (((r.phasesSeen >>> p) & 1) === 0) problems.push(`never in ${PHASE_NAMES[p]}`);
  if (c.overtime !== undefined && r.overtimeSeen !== c.overtime) problems.push(c.overtime ? 'never in overtime' : 'went to overtime');
  if (c.end !== undefined) {
    const decided = r.phase === ENDED && r.score[0] !== r.score[1];
    const ended = c.end === 'lead' ? decided && !r.overtime : decided && r.overtime;
    if (!ended) problems.push(c.end === 'lead' ? "didn't end at 0:00 with a pack ahead" : "didn't end by an overtime goal");
  }
  for (const u of r.unmet) problems.push(`unmet: ${u}`);
  return problems;
}
