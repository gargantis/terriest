import { describe, expect, it } from 'vitest';
import { makeConfig, SUBSTEPS, substepDt, substepsPerSecond } from '../src/sim/config';
import { createReplayBench } from '../src/sim/source';
import { run, scenario } from '../src/sim/testing';
import { M0_SOLVER, parseSolver, solverLabel, solverName, solverOf } from '../src/solver-settings';

// M0's cost revisit: the solver's four settings switch from a spec, and
// TERRIEST_SPIKE_SOLVER (test/solver-setup.ts) reaches every test's
// configurations and the step loop.

describe('solver specs (src/solver-settings.ts)', () => {
  it('parses each token, later tokens winning', () => {
    expect(parseSolver('base')).toEqual({});
    expect(parseSolver('')).toEqual({});
    expect(parseSolver('i4+p1')).toEqual({ iterations: 4, positionPasses: 1 });
    expect(parseSolver('i6 nofloor,s3')).toEqual({ iterations: 6, floorInSolve: false, substeps: 3 });
    expect(parseSolver('nofloor+floor')).toEqual({ floorInSolve: true });
    expect(parseSolver('i4+m0')).toEqual(M0_SOLVER);
    expect(parseSolver('p0')).toEqual({ positionPasses: 0 });
    for (const bad of ['i0', 's0', 'q3', 'i', 'floors', 'i4.5']) expect(() => parseSolver(bad), bad).toThrow();
  });

  it('labels and names settings', () => {
    expect(solverLabel(M0_SOLVER)).toBe('i8 p2 floor s4');
    expect(solverName(M0_SOLVER)).toBe('m0');
    expect(solverName({ ...M0_SOLVER, ...parseSolver('s3+i4+nofloor') })).toBe('i4+nofloor+s3');
  });

  it('keeps D-3 substeps exact: a substep is 1/240 s at 4', () => {
    expect(substepDt(makeConfig({ substeps: 4 }))).toBe(1 / 240);
    expect(substepDt(makeConfig({ substeps: 3 }))).toBe(1 / 180);
    expect(substepsPerSecond(makeConfig({ substeps: 3 }))).toBe(180);
    expect(SUBSTEPS).toBe(4);
  });

  it('refuses settings that are not whole numbers in range', () => {
    for (const over of [{ substeps: 0 }, { substeps: 2.5 }, { iterations: 0 }, { positionPasses: -1 }]) {
      expect(() => scenario(1, over), JSON.stringify(over)).toThrow();
    }
  });
});

describe('the switch reaches the tests (TERRIEST_SPIKE_SOLVER)', () => {
  const spec = process.env.TERRIEST_SPIKE_SOLVER ?? '';
  const want = parseSolver(spec);

  it(`every configuration a test makes carries the run's settings (${spec || 'unset'})`, () => {
    const got = solverOf(makeConfig());
    for (const [k, v] of Object.entries(want)) expect(got[k as keyof typeof got], k).toBe(v);
    expect(solverOf(scenario(2).sim.C)).toEqual(got);
    expect(solverOf(createReplayBench({ script: 'scrum at the wall, flag42' }).config)).toEqual(got);
  });

  it('a tick steps the configuration\'s substeps', () => {
    for (const substeps of [3, 4, 5]) {
      const sc = scenario(1, { substeps });
      let n = 0;
      sc.sim.probe = () => { n++; };
      run(sc, 7);
      expect(n).toBe(7 * substeps);
      expect(sc.sim.physics.stats.substeps).toBe(7 * substeps);
    }
  });

  it('a bench takes its own settings over the defaults', () => {
    const bench = createReplayBench({ script: 'scrum at the wall, flag42', config: { iterations: 3, substeps: 2 } });
    expect(bench.config.iterations).toBe(3);
    bench.tick();
    expect(bench.stats().substeps).toBe(13 * 2);
  });
});
