// The simulation as the scene sees it (src/contract.ts): a SimSource the
// scene advances by its clock and reads as MatchViews. Also a replay bench
// for M0 run 3's tick cost, which its caller times: src/sim reads no clock.
//
// In views, a tick that never happened (A.1's 0xFFFFFFFF) reads as −1, and a
// match with no goal yet leaves lastGoal out.

import type { BallView, MatchView, SimSource, TerrierView } from '../contract.ts';
import { NEVER, SLIP_OUT_RULES, type SlipOutName } from './config.ts';
import { hashState } from './codec.ts';
import type { SolverStats } from './physics.ts';
import { findScript, type ScriptSpec, scriptConfig, scriptInputs, scriptStart, showcase } from './scripts.ts';
import { ANIM_PHASES, cloneState, type MatchState } from './state.ts';
import { makeSim, type Sim, step } from './step.ts';

export interface SimSourceOptions {
  /** 1 to 4 a side. With a named script, it must match the script's. */
  packSize?: number;
  /** A golden script's name, or a spec; by default the lively showcase. */
  script?: string | ScriptSpec;
  /** The slip-out rule; by default the script's (the showcase's is M0's pick). */
  slipOut?: SlipOutName;
}

export interface SpikeSimSource extends SimSource {
  readonly script: ScriptSpec;
  /** The state's hash, for determinism checks. */
  hash(): string;
  /** The solver's counters since the start. */
  stats(): Readonly<SolverStats>;
  readonly state: Readonly<MatchState>;
}

const tick = (t: number): number => (t === NEVER ? -1 : t);

function resolve(opts: SimSourceOptions): ScriptSpec {
  let spec: ScriptSpec;
  if (opts.script === undefined || opts.script === 'showcase') spec = showcase(opts.packSize ?? 4);
  else if (typeof opts.script === 'string') {
    const found = findScript(opts.script);
    if (!found) throw new Error(`no script named ${opts.script}`);
    spec = found;
  } else spec = opts.script;
  if (opts.packSize !== undefined && opts.packSize !== spec.packSize) {
    throw new Error(`script ${spec.name} plays ${spec.packSize} a side, not ${opts.packSize}`);
  }
  if (spec.packSize < 1 || spec.packSize > 4) throw new Error(`pack size ${spec.packSize} is outside 1–4`);
  return opts.slipOut ? { ...spec, slipOut: opts.slipOut } : spec;
}

export function viewOf(s: MatchState): MatchView {
  const terriers: TerrierView[] = s.terriers.map((t) => ({
    pack: t.pack, spot: t.spot, coat: t.coat,
    x: t.x, y: t.y, z: t.z, vx: t.vx, vy: t.vy, vz: t.vz,
    heading: t.heading,
    phase: ANIM_PHASES[t.anim]!,
    phaseStartTick: tick(t.animStart),
    gait: t.gait,
    lastBallContactTick: tick(t.lastBallContactTick),
  }));
  const b = s.ball;
  const ball: BallView = {
    x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz,
    lastHitTick: tick(b.lastHitTick), lastHitStrength: b.lastHitStrength,
  };
  const view: MatchView = { tick: s.tick, terriers, ball };
  if (s.lastGoalTick !== NEVER) view.lastGoal = { tick: s.lastGoalTick, pack: s.lastGoalPack === 0 ? 0 : 1 };
  return view;
}

export function createSimSource(opts: SimSourceOptions = {}): SpikeSimSource {
  const spec = resolve(opts);
  const C = scriptConfig(spec);
  if (!(spec.slipOut in SLIP_OUT_RULES)) throw new Error(`no slip-out rule ${spec.slipOut}`);
  const sim: Sim = makeSim(C, spec.packSize);
  const s = scriptStart(spec, C);
  const inputs: (number | null)[] = [];
  return {
    packSize: spec.packSize,
    script: spec,
    state: s,
    view: () => viewOf(s),
    advance(ticks: number) {
      const n = Math.max(0, Math.floor(ticks));
      for (let i = 0; i < n; i++) step(sim, s, scriptInputs(spec, s.tick + 1, inputs));
    },
    hash: () => hashState(s),
    stats: () => sim.physics.stats,
  };
}

/** M0 run 3's replay: each tick() finalises one tick from the base state and
 *  re-predicts the window from it, window + 1 steps in all, as roslambo's
 *  timeline does every tick (C-2). burst(n) steps n ticks from a copy of the
 *  base, for the worst single ticks (a resync about 30, a joiner's catch-up
 *  about 42, a late-vote repair up to about 270). The caller times them. */
export interface ReplayBench {
  readonly script: ScriptSpec;
  tick(): void;
  burst(steps: number): void;
  /** Solver counters, cumulative: contacts per substep is contacts / substeps. */
  stats(): Readonly<SolverStats>;
  readonly base: Readonly<MatchState>;
}

export function createReplayBench(opts: SimSourceOptions & { window?: number; warmTicks?: number } = {}): ReplayBench {
  const spec = resolve({ ...opts, script: opts.script ?? 'scrum in the corner, flag42' });
  const C = scriptConfig(spec);
  const sim = makeSim(C, spec.packSize);
  const window = opts.window ?? 12;
  const base = scriptStart(spec, C);
  const inputs: (number | null)[] = [];
  for (let i = 0; i < (opts.warmTicks ?? 0); i++) step(sim, base, scriptInputs(spec, base.tick + 1, inputs));
  const fresh = sim.physics.stats;
  fresh.substeps = 0; fresh.contacts = 0; fresh.floorContacts = 0; fresh.maxContacts = 0; fresh.slipOuts = 0;
  const from = (s: MatchState, n: number): void => {
    for (let i = 0; i < n; i++) step(sim, s, scriptInputs(spec, s.tick + 1, inputs));
  };
  return {
    script: spec,
    base,
    tick() {
      from(base, 1); // finalise
      from(cloneState(base), window); // predict the window again
    },
    burst(steps: number) {
      from(cloneState(base), steps);
    },
    stats: () => sim.physics.stats,
  };
}
