// M0's cost revisit (PLAN §17 M0's stop rule; REPORT.md §4): the solver's
// four switchable settings, named in a short spec so a page's URL, an
// environment variable or a script's argument can pick a variant:
//   base             no change: the simulation's defaults
//   m0               M0's settings: 8 iterations, 2 position passes, the
//                    floor's contacts in steps 5 and 6, 4 substeps a tick
//   i<N>             N solver iterations (D-5 step 5, forward and back sweeps)
//   p<N>             N position passes (D-5 step 6)
//   floor, nofloor   the floor's contacts in or out of steps 5 and 6
//   s<N>             N substeps a tick (D-3)
// joined by '+', ',' or spaces, later tokens winning: 'i4+p1+nofloor'.
// A URL's query reads '+' as a space, which parses the same.

import { DEFAULT_CONFIG, type SimConfig } from './sim/config.ts';

export interface SolverSettings {
  iterations: number;
  positionPasses: number;
  floorInSolve: boolean;
  substeps: number;
}

/** The settings M0 measured, and the spike's defaults until the revisit. */
export const M0_SOLVER: Readonly<SolverSettings> = { iterations: 8, positionPasses: 2, floorInSolve: true, substeps: 4 };

/** A configuration's solver settings. */
export function solverOf(C: Pick<SimConfig, keyof SolverSettings>): SolverSettings {
  return { iterations: C.iterations, positionPasses: C.positionPasses, floorInSolve: C.floorInSolve, substeps: C.substeps };
}

/** The settings a spec changes. Throws on a token it doesn't know. */
export function parseSolver(spec: string): Partial<SolverSettings> {
  const out: Partial<SolverSettings> = {};
  for (const token of spec.split(/[+,\s]+/).filter(Boolean)) {
    if (token === 'base') continue;
    if (token === 'm0') {
      Object.assign(out, M0_SOLVER);
      continue;
    }
    if (token === 'floor' || token === 'nofloor') {
      out.floorInSolve = token === 'floor';
      continue;
    }
    const m = /^([ips])(\d+)$/.exec(token);
    if (!m) throw new Error(`solver: unknown token ${token}; expected base, m0, i<N>, p<N>, floor, nofloor or s<N>`);
    const n = Number(m[2]);
    if (m[1] === 'p') out.positionPasses = n;
    else if (n < 1) throw new Error(`solver: ${token}: ${m[1] === 'i' ? 'iterations' : 'substeps'} start at 1`);
    else if (m[1] === 'i') out.iterations = n;
    else out.substeps = n;
  }
  return out;
}

/** All four settings, spelled out: 'i8 p2 floor s4'. */
export function solverLabel(s: SolverSettings): string {
  return `i${s.iterations} p${s.positionPasses} ${s.floorInSolve ? 'floor' : 'nofloor'} s${s.substeps}`;
}

/** The settings as their changes from M0's: 'm0' for none, else 'i4+p1'. */
export function solverName(s: SolverSettings): string {
  const parts: string[] = [];
  if (s.iterations !== M0_SOLVER.iterations) parts.push(`i${s.iterations}`);
  if (s.positionPasses !== M0_SOLVER.positionPasses) parts.push(`p${s.positionPasses}`);
  if (s.floorInSolve !== M0_SOLVER.floorInSolve) parts.push(s.floorInSolve ? 'floor' : 'nofloor');
  if (s.substeps !== M0_SOLVER.substeps) parts.push(`s${s.substeps}`);
  return parts.length ? parts.join('+') : 'm0';
}

/**
 * Makes a spec the defaults of every configuration made after it in this
 * process, by changing DEFAULT_CONFIG: for a test run or a script run
 * under one variant (test/solver-setup.ts, scripts/revisit/). The page and
 * the cost bench take their settings explicitly instead. Returns the
 * settings now in force.
 */
export function applySolverDefaults(spec: string | undefined): SolverSettings {
  if (spec !== undefined && spec.trim() !== '') Object.assign(DEFAULT_CONFIG, parseSolver(spec));
  return solverOf(DEFAULT_CONFIG);
}
