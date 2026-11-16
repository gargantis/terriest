// The solver switch for a whole test run (M0's cost revisit). With
// TERRIEST_SPIKE_SOLVER set to a spec from src/solver-settings.ts, every
// configuration the tests make starts from that variant's settings, so
// §16's behaviour tests run under it:
//   TERRIEST_SPIKE_SOLVER=i4+p1 npx vitest run --exclude src/sim/golden.test.ts
// The golden hashes change with any setting by design, so a variant's run
// leaves golden.test.ts out. Unset, nothing changes. vitest runs this file
// before each test file, in that file's own module graph.
import { applySolverDefaults } from '../src/solver-settings.ts';

applySolverDefaults(process.env.TERRIEST_SPIKE_SOLVER);
