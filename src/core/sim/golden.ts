// The golden replays (PLAN §16 Determinism, D-23; design §1.15, §7.2): each
// scripted run's hash every 500 ticks, its final hash, what it ended as,
// the events seen at tick ends, and the solver's counters, which Node and
// every engine must reproduce exactly (goldens.json); what a run's result
// says it failed to cover; and the canary's hash. The M0 spike's golden.ts
// and roslambo's, with the events counted and the coverage asserted.
// Exact operations only (D-1): it ships in the determinism chunk. From M4
// the canary runs at start-up, and its script, its hash and the one replay
// are canary.ts's and replay.ts's, re-exported here, so the page's module,
// which takes canaryHash, holds no other run (M4-Q5).

import { defaultParams, type SimParams } from './params';
import { type GoldenResult, replay } from './replay';
import { GOLDEN_SCRIPTS, type ScriptSpec } from './scripts';
import { ENDED } from './state';

// From M4 the one replay is replay.ts's and the canary's hash canary.ts's, each re-exported here
// unchanged, so the page's module, which takes canaryHash, holds no golden run (M4-Q5).
export { CHECKPOINT_EVERY, type GoldenResult, replay } from './replay';
export { canaryHash } from './canary';

/** What goldens.json holds (design §7.2). */
export interface Goldens {
  codec: number;
  checkpointEvery: number;
  canary: string;
  runs: GoldenResult[];
}

/** Every golden run, in order. */
export function goldenSuite(P: SimParams = defaultParams): GoldenResult[] {
  return GOLDEN_SCRIPTS.map((spec) => replay(spec, P));
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
