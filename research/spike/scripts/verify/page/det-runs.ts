// Extra scripted runs for the verification of run 1, none of them in the
// goldens: new seeds, unmirrored kickoffs at every pack size on both shapes,
// the scrums with seeded inputs, a long run and two pinches, hashed every
// 100 ticks. Node (scripts/verify/driver.mjs) and each browser
// (scripts/verify/page/main.ts) run this same function, and the hashes are
// compared across engines.

import { chasey, findScript, pinch, type ScriptSpec, scriptConfig, scriptInputs, scriptStart } from '../../../src/sim/scripts.ts';
import { makeSim, step } from '../../../src/sim/step.ts';
import { hashState } from '../../../src/sim/codec.ts';
import type { SlipOutName } from '../../../src/sim/config.ts';

export interface ExtraRun { name: string; ticks: number; hashes: string[]; final: string; contacts: number; slipOuts: number }

export const EVERY = 100;

export function extraSpecs(): ScriptSpec[] {
  const specs: ScriptSpec[] = [];
  for (const pitch of ['main', 'second'] as const) {
    for (let p = 1; p <= 4; p++) {
      for (const rule of ['flag42', 'drafted'] as SlipOutName[]) {
        const seed = 1000 + 37 * p + (pitch === 'second' ? 500 : 0) + (rule === 'flag42' ? 7 : 0);
        specs.push({ name: `x kickoff ${p}, ${pitch}, ${rule}, unmirrored`, packSize: p, pitch, slipOut: rule, ticks: 3000, start: 'countdown', mirrored: false, input: chasey(seed, 'all') });
      }
    }
  }
  for (const base of ['scrum at the wall, flag42', 'scrum in the corner, flag42', 'scrum at the wall, flag42E0']) {
    const spec = findScript(base);
    if (!spec) throw new Error(`no script ${base}`);
    specs.push({ ...spec, name: `x ${base}, seeded contact inputs`, ticks: 3000, input: chasey(77 + specs.length, 'contact') });
  }
  specs.push({ name: 'x long run, 42+flag', packSize: 4, pitch: 'main', slipOut: 'flag42', ticks: 15000, start: 'countdown', mirrored: false, input: chasey(4242, 'all') });
  specs.push({ ...pinch(4, 'wideFlagE0', true), name: 'x pinch 4, zoomies, wide+flag+e0' });
  specs.push({ ...pinch(3, 'flag44', true), name: 'x pinch 3, zoomies, 44+flag' });
  return specs;
}

export function runExtra(): ExtraRun[] {
  return extraSpecs().map((spec) => {
    const C = scriptConfig(spec);
    const sim = makeSim(C, spec.packSize);
    const s = scriptStart(spec, C);
    const inputs: (number | null)[] = [];
    const hashes: string[] = [];
    for (let t = 1; t <= spec.ticks; t++) {
      step(sim, s, scriptInputs(spec, t, inputs));
      if (t % EVERY === 0) hashes.push(hashState(s));
    }
    return { name: spec.name, ticks: spec.ticks, hashes, final: hashState(s), contacts: sim.physics.stats.contacts, slipOuts: sim.physics.stats.slipOuts };
  });
}
