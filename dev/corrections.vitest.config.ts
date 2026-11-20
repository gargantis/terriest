import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { buildInputs } from '../scripts/build-inputs.mjs';

// The correction measurement only (M3's design §9, §1.38), never part of the
// gate, which tests its arithmetic in dev/corrections.test.ts:
//   TERRIEST_CORRECTIONS_OUT="$OUT/results.json" npx vitest run --config dev/corrections.vitest.config.ts
// with $OUT a folder outside the repository, as research/corrections/
// REPORT.md's section 1.12 runs it, so the tree stays clean between runs.
// dev/corrections.measure.ts says what it runs, where it writes and how to
// choose. TERRIEST_CORRECTIONS_MEASURING lets it register its tests, so the
// gate's import of it registers none. The cap check collects garbage before
// each run, so the worker gets Node's --expose-gc (§9.6). The build inputs'
// hash is defined as the gate's vitest.config.ts defines it, for
// src/build-info.ts (design §1.31). One file, its sections one after
// another; the verbose reporter shows each match's and profile's line as
// it goes.
const root = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root,
  define: { __TERRIEST_BUILD_INPUTS__: JSON.stringify(buildInputs(root)) },
  test: {
    include: ['dev/corrections.measure.ts'],
    environment: 'node',
    reporters: ['verbose'],
    env: { TERRIEST_CORRECTIONS_MEASURING: '1' },
    pool: 'forks',
    execArgv: ['--expose-gc'],
    testTimeout: 7_200_000,
    hookTimeout: 60_000,
  },
});
