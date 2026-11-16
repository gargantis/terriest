import { describe, expect, it, vi } from 'vitest';
import { chasey, pinch, type ScriptSpec, scriptConfig, scriptInputs, scriptStart } from './scripts';
import { makeSim, step } from './step';
import { mirrorMismatches } from './testing';
import type { SlipOutName } from './config';

// These run whole scripted matches; under a parallel run they need more than vitest's 5 s.
vi.setConfig({ testTimeout: 120_000 });

// PLAN §16 P8 (D-4, D-5): a mirrored kickoff gives a point-mirrored state at
// every pack size, compared by value (x and y negated, z equal, angles a
// half turn on, everything else equal), on the pitch and on D-4's second
// shape. Checked after every substep.

function mirroredRun(spec: ScriptSpec): { firstMismatch: string | null; contacts: number; slipOuts: number; apex: number } {
  const C = scriptConfig(spec);
  const sim = makeSim(C, spec.packSize);
  const s = scriptStart(spec, C);
  let firstMismatch: string | null = null;
  let sub = 0;
  let apex = 0;
  sim.probe = (st) => {
    sub++;
    apex = Math.max(apex, st.ball.z);
    if (firstMismatch === null) {
      const m = mirrorMismatches(st, 1);
      if (m.length > 0) firstMismatch = `tick ${st.tick + 1}, substep ${sub}: ${m[0]}`;
    }
  };
  const inputs: (number | null)[] = [];
  for (let t = 1; t <= spec.ticks && firstMismatch === null; t++) step(sim, s, scriptInputs(spec, t, inputs));
  return { firstMismatch, contacts: sim.physics.stats.contacts, slipOuts: sim.physics.stats.slipOuts, apex };
}

const kickoff = (packSize: number, pitch: 'main' | 'second', seed: number, slipOut: SlipOutName = 'drafted'): ScriptSpec => ({
  name: `mirrored kickoff ${packSize}, ${pitch}, ${slipOut}`, packSize, pitch, slipOut, ticks: 2400,
  start: 'countdown', mirrored: true, input: chasey(seed, 'all'),
});

describe('P8: mirrored kickoffs stay exactly mirrored, by value', () => {
  for (const pitch of ['main', 'second'] as const) {
    for (let packSize = 1; packSize <= 4; packSize++) {
      it(`pack size ${packSize}, ${pitch} pitch, seeded inputs in all three frames`, () => {
        const r = mirroredRun(kickoff(packSize, pitch, 40 + packSize));
        expect(r.firstMismatch).toBeNull();
        expect(r.contacts).toBeGreaterThan(0);
      });
    }
  }

  it('under the slip-out rules M0 compares, through pinches and slip-outs', () => {
    const rows: string[] = [];
    for (const rule of ['flag42', 'flag42E0', 'wideFlagE0', 'drafted'] as SlipOutName[]) {
      for (let packSize = 1; packSize <= 4; packSize++) {
        for (const spec of [kickoff(packSize, 'main', 90 + packSize, rule), { ...pinch(packSize, rule, packSize % 2 === 0), ticks: 900 }]) {
          const r = mirroredRun(spec);
          expect(r.firstMismatch, spec.name).toBeNull();
          rows.push(`${spec.name}: ${r.slipOuts} slip-outs, apex ${(r.apex - 0.8).toFixed(2)} m`);
        }
      }
    }
    console.log(`[P8]\n  ${rows.join('\n  ')}`);
  }, 120_000);

  it('notices a mirror broken by one bit', () => {
    const spec = kickoff(2, 'main', 7);
    const C = scriptConfig(spec);
    const s = scriptStart(spec, C);
    expect(mirrorMismatches(s)).toEqual([]);
    s.terriers[1]!.x = s.terriers[1]!.x * (1 + Number.EPSILON);
    expect(mirrorMismatches(s).length).toBe(1);
    const t = scriptStart(spec, C);
    t.terriers[3]!.heading = (t.terriers[3]!.heading + 1) >>> 0;
    expect(mirrorMismatches(t)[0]).toMatch(/heading/);
    makeSim(C, 2);
  });
});
