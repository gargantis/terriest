// Replays the scripted runs and hashes them at checkpoints (PLAN §16
// Determinism, M0 run 1), as roslambo's golden.ts does: the same suite is
// checked in Node by golden.test.ts and in each browser engine through the
// production bundle, against goldens.json.

import { hashState } from './codec.ts';
import { CANARY_SCRIPT, GOLDEN_SCRIPTS, type ScriptSpec, scriptConfig, scriptInputs, scriptStart } from './scripts.ts';
import { makeSim, step } from './step.ts';

export const CHECKPOINT_EVERY = 500;

export interface GoldenResult {
  name: string;
  checkpoints: string[]; // the hash every CHECKPOINT_EVERY ticks
  final: string;
  score: [number, number];
  phase: number;
  /** Contacts the solver saw, summed over substeps, and the most in one. */
  contacts: number;
  maxContacts: number;
  slipOuts: number;
}

export function replay(spec: ScriptSpec): GoldenResult {
  const C = scriptConfig(spec);
  const sim = makeSim(C, spec.packSize);
  const s = scriptStart(spec, C);
  const checkpoints: string[] = [];
  const inputs: (number | null)[] = [];
  for (let t = 1; t <= spec.ticks; t++) {
    step(sim, s, scriptInputs(spec, t, inputs));
    if (t % CHECKPOINT_EVERY === 0) checkpoints.push(hashState(s));
  }
  const st = sim.physics.stats;
  return {
    name: spec.name, checkpoints, final: hashState(s), score: [s.score[0], s.score[1]], phase: s.phase,
    contacts: st.contacts, maxContacts: st.maxContacts, slipOuts: st.slipOuts,
  };
}

export function goldenSuite(scripts: readonly ScriptSpec[] = GOLDEN_SCRIPTS): GoldenResult[] {
  return scripts.map(replay);
}

export function canaryHash(): string {
  return replay(CANARY_SCRIPT).final;
}
